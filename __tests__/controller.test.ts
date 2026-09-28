import {DeviceEventEmitter, NativeModules, ToastAndroid} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {createFakeNote} from './helpers/fakeNote';

let mockNote = createFakeNote();
jest.mock('sn-plugin-lib', () => ({
  get PluginCommAPI() {
    return mockNote.sdk.PluginCommAPI;
  },
  get PluginFileAPI() {
    return mockNote.sdk.PluginFileAPI;
  },
  get PluginNoteAPI() {
    return mockNote.sdk.PluginNoteAPI;
  },
  get PluginManager() {
    return mockNote.sdk.PluginManager;
  },
  get FileUtils() {
    return mockNote.sdk.FileUtils;
  },
}));

// The native palette, as the bridge sees it.
const mockPalette = {
  canDrawOverlays: jest.fn(async () => true),
  requestOverlayPermission: jest.fn(),
  getScreenInfo: jest.fn(async () => ({
    width: 1404,
    height: 1872,
    density: 1.41,
    rotation: 0,
  })),
  show: jest.fn(async () => true),
  hide: jest.fn(),
  isShowing: jest.fn(async () => true),
  setMoveMode: jest.fn(),
};
NativeModules.SoccerPalette = mockPalette;

import {
  handle,
  pageToScreen,
  screenToPage,
  startPaletteController,
  stopPaletteController,
} from '../src/palette/controller';
import {PALETTE_EVENT} from '../src/palette/bridge';
import {readPieces, getContext} from '../src/page/pageOps';

const at = (x: number, y: number, rotation = 0) => ({
  x,
  y,
  screenWidth: 1404,
  screenHeight: 1872,
  rotation,
});

beforeEach(async () => {
  mockNote = createFakeNote();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  jest.spyOn(ToastAndroid, 'show').mockImplementation(() => {});
  stopPaletteController();
});

describe('coordinates', () => {
  it('maps the screen straight onto an upright page', () => {
    expect(screenToPage(at(702, 936), {width: 1404, height: 1872})).toEqual({
      x: 702,
      y: 936,
    });
    expect(
      screenToPage(
        {...at(512, 683), screenWidth: 1024, screenHeight: 1365},
        {width: 1920, height: 2560},
      ),
    ).toEqual({x: 960, y: expect.closeTo(1280.9, 0)});
    expect(
      pageToScreen(
        {x: 960, y: 1280},
        {width: 1920, height: 2560},
        {width: 1024, height: 1365},
      ),
    ).toEqual({
      x: 512,
      y: expect.closeTo(682.7, 0),
    });
  });

  it('refuses a turned screen rather than guessing', () => {
    expect(screenToPage(at(10, 10, 1), {width: 1404, height: 1872})).toBeNull();
  });
});

describe('palette events', () => {
  it('drops a piece where the finger let go', async () => {
    await handle({type: 'drop', kind: 'cone', toolType: 1, ...at(300, 500)});
    const [piece] = await readPieces(await getContext());
    expect(piece).toMatchObject({kind: 'cone', x: 300, y: 500});
    expect(ToastAndroid.show).not.toHaveBeenCalled();
  });

  it('tells the user once when a pen was used to drag', async () => {
    await handle({type: 'drop', kind: 'ball', toolType: 2, ...at(300, 500)});
    await handle({type: 'drop', kind: 'ball', toolType: 2, ...at(400, 500)});
    expect(ToastAndroid.show).toHaveBeenCalledTimes(1);
    expect((ToastAndroid.show as jest.Mock).mock.calls[0][0]).toMatch(/finger/);
  });

  it('refuses to place on a turned screen', async () => {
    await handle({type: 'drop', kind: 'cone', toolType: 1, ...at(300, 500, 1)});
    expect(await readPieces(await getContext())).toEqual([]);
    expect((ToastAndroid.show as jest.Mock).mock.calls[0][0]).toMatch(
      /upright/,
    );
  });

  it('enters move mode with the page pieces, then moves and removes them', async () => {
    await handle({
      type: 'drop',
      kind: 'attacker',
      toolType: 1,
      ...at(300, 500),
    });
    await handle({type: 'action', action: 'move'});
    const [, pieces, size] = mockPalette.setMoveMode.mock.calls.at(-1)!;
    expect(pieces).toEqual([
      {id: expect.any(String), kind: 'attacker', x: 300, y: 500},
    ]);
    expect(size).toBeGreaterThan(40);

    const id = pieces[0].id;
    await handle({type: 'move', id, toolType: 1, ...at(700, 900)});
    expect(mockPalette.setMoveMode.mock.calls.at(-1)![1][0]).toMatchObject({
      x: 700,
      y: 900,
    });

    await handle({type: 'remove', id});
    expect(mockPalette.setMoveMode.mock.calls.at(-1)![1]).toEqual([]);
    expect(await readPieces(await getContext())).toEqual([]);
  });

  it('copies the page and reports where it went', async () => {
    await handle({type: 'action', action: 'copy'});
    expect(mockNote.state.current).toBe(1);
    expect((ToastAndroid.show as jest.Mock).mock.calls[0][0]).toBe(
      'Copied to page 2.',
    );
  });

  it('saves where the palette was docked', async () => {
    await handle({type: 'position', side: 'left', y: 420});
    expect(
      JSON.parse((await AsyncStorage.getItem('snsoccer:palette:v1'))!),
    ).toEqual({
      side: 'left',
      y: 420,
    });
  });
});

it('handles events in order and explains failures', async () => {
  startPaletteController();
  mockNote.state.notePath = '/storage/emulated/0/Document/book.pdf';
  DeviceEventEmitter.emit(PALETTE_EVENT, {type: 'action', action: 'pitch'});
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  expect((ToastAndroid.show as jest.Mock).mock.calls[0][0]).toMatch(
    /Open a note/,
  );
});
