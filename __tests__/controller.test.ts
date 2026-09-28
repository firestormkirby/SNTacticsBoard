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

// The native module, as the bridge sees it.
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
  setPieces: jest.fn(),
  startTicking: jest.fn(),
  stopTicking: jest.fn(),
};
NativeModules.SoccerPalette = mockPalette;

import {
  closePanelThen,
  copyThisPage,
  getCurrentPieces,
  handle,
  loadLayoutAsPage,
  loadLayoutHere,
  saveThisPage,
  addPitch,
  pageToScreen,
  panelOpened,
  screenToPage,
  setButtonOn,
  showButton,
  startPaletteController,
  stopPaletteController,
} from '../src/palette/controller';
import {PALETTE_EVENT} from '../src/palette/bridge';
import {getContext, readPieces} from '../src/page/pageOps';
import {loadPaletteSettings} from '../src/palette/settings';
import {deleteLayout, listLayouts} from '../src/layouts/layoutStore';

const at = (x: number, y: number, rotation = 0) => ({
  x,
  y,
  screenWidth: 1404,
  screenHeight: 1872,
  rotation,
  toolType: 2,
});
const handles = () => mockPalette.setPieces.mock.calls.at(-1)![0];
const settle = async () => {
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setImmediate(r));
  }
};

beforeEach(async () => {
  mockNote = createFakeNote();
  mockNote.sdk.PluginManager = {
    closePluginView: jest.fn(async () => true),
    showPluginView: jest.fn(async () => true),
  } as any;
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
      pageToScreen(
        {x: 960, y: 1280},
        {width: 1920, height: 2560},
        {width: 1024, height: 1365},
      ),
    ).toEqual({x: 512, y: expect.closeTo(682.5, 0)});
  });

  it('refuses a turned screen rather than guessing', () => {
    expect(screenToPage(at(10, 10, 1), {width: 1404, height: 1872})).toBeNull();
  });
});

describe('pieces', () => {
  it('drops a new piece where it was let go, with the pen or a finger', async () => {
    await handle({type: 'drop', kind: 'cone', ...at(300, 500)});
    const [piece] = await readPieces(await getContext());
    expect(piece).toMatchObject({kind: 'cone', x: 300, y: 500});
    expect(handles()).toEqual([{id: piece.id, kind: 'cone', x: 300, y: 500}]);
    expect(ToastAndroid.show).not.toHaveBeenCalled();
  });

  it('moves a piece dragged on the page, and removes one dropped on the button', async () => {
    await handle({type: 'drop', kind: 'attacker', ...at(300, 500)});
    const id = handles()[0].id;
    await handle({type: 'move', id, ...at(700, 900)});
    expect(handles()).toEqual([{id, kind: 'attacker', x: 700, y: 900}]);

    await handle({type: 'remove', id});
    expect(handles()).toEqual([]);
    expect(await readPieces(await getContext())).toEqual([]);
  });

  it('refuses to place on a turned screen', async () => {
    await handle({type: 'drop', kind: 'cone', ...at(300, 500, 1)});
    expect(await readPieces(await getContext())).toEqual([]);
    expect((ToastAndroid.show as jest.Mock).mock.calls[0][0]).toMatch(
      /upright/,
    );
  });

  it('keeps the pieces on the page to hand for the menu', async () => {
    await handle({type: 'drop', kind: 'ball', ...at(100, 200)});
    expect(getCurrentPieces()?.pieces.map(p => p.kind)).toEqual(['ball']);
  });
});

describe('following the page', () => {
  it('lays the handles out again when the page turns', async () => {
    await handle({type: 'drop', kind: 'cone', ...at(300, 500)});
    mockNote.sdk.PluginFileAPI.insertNotePage({
      notePath: mockNote.state.notePath,
      page: 1,
      template: 'x',
    });
    mockNote.state.current = 1;
    await handle({type: 'tick'});
    expect(handles()).toEqual([]);
    mockNote.state.current = 0;
    await handle({type: 'tick'});
    expect(handles()).toHaveLength(1);
  });

  it('takes the handles down away from a note', async () => {
    await handle({type: 'drop', kind: 'cone', ...at(300, 500)});
    mockNote.state.notePath = '/storage/emulated/0/Document/book.pdf';
    await handle({type: 'tick'});
    expect(handles()).toEqual([]);
  });

  it('does not read the note while the menu is open', async () => {
    panelOpened();
    const spy = jest.spyOn(mockNote.sdk.PluginCommAPI, 'getCurrentPageNum');
    await handle({type: 'tick'});
    expect(spy).not.toHaveBeenCalled();
    expect(mockPalette.hide).toHaveBeenCalled();
    expect(mockPalette.stopTicking).toHaveBeenCalled();
  });
});

describe('the button', () => {
  it('opens the menu on a long press, taking the overlay down first', async () => {
    await handle({type: 'longPress'});
    expect(mockPalette.hide).toHaveBeenCalled();
    expect(mockNote.sdk.PluginManager.showPluginView).toHaveBeenCalled();
  });

  it('remembers where it was put and whether the palette was open', async () => {
    await handle({type: 'position', x: 40, y: 600});
    await handle({type: 'open', open: true});
    expect(await loadPaletteSettings()).toMatchObject({
      x: 40,
      y: 600,
      open: true,
    });
    await showButton();
    expect(mockPalette.show).toHaveBeenLastCalledWith(
      expect.objectContaining({x: 40, y: 600, open: true, pieceSize: 63}),
    );
    expect(mockPalette.startTicking).toHaveBeenCalledWith(1000);
  });

  it('stays down if the menu opens while it is coming up', async () => {
    const coming = showButton(); // the plugin loading...
    panelOpened(); // ...because the menu is opening
    expect(await coming).toBe(false);
    expect(mockPalette.show).not.toHaveBeenCalled();
    expect(mockPalette.startTicking).not.toHaveBeenCalled();
  });
});

describe('menu actions', () => {
  it('copies after the menu closes, then brings the button back', async () => {
    await setButtonOn(true);
    startPaletteController();
    panelOpened();
    await settle();
    mockPalette.show.mockClear();
    await closePanelThen(copyThisPage);
    // The button is back up before the menu closes, not after.
    expect(mockPalette.show).toHaveBeenCalledTimes(1);
    expect(mockPalette.show.mock.invocationCallOrder[0]).toBeLessThan(
      (mockNote.sdk.PluginManager.closePluginView as jest.Mock).mock
        .invocationCallOrder[0],
    );
    await settle();
    expect(mockNote.state.current).toBe(1);
    expect((ToastAndroid.show as jest.Mock).mock.calls.at(-1)[0]).toBe(
      'Copied to page 2.',
    );
  });

  it('says where the page went when it cannot go there', async () => {
    mockNote = createFakeNote({noJump: true});
    expect(await addPitch().catch(e => e.message)).toMatch(/prepare the pitch/);
    mockNote.state.files.add(
      '/storage/emulated/0/EXPORT/SNSoccer/pitch-1404x1872.png',
    );
    expect(await addPitch()).toBe(
      'Pitch added as page 2, after this one. Turn the page to see it.',
    );
  });

  const LIB = '/storage/emulated/0/EXPORT/SNSoccer/Layouts.note';
  const libPages = () => mockNote.state.notes.get(LIB) ?? [];
  const tags = () => libPages().map(p => p.keywords.join(' '));
  const closeMenu = async () => {
    startPaletteController();
    panelOpened();
    await closePanelThen(async () => {});
    await settle();
  };

  it('saves a whole page, tagged by keyword, and adds it back', async () => {
    mockNote.state.pages[0].elements.push({type: 0, numInPage: 900});
    await handle({type: 'drop', kind: 'cone', ...at(300, 500)});
    expect(await saveThisPage('Rondo')).toBe('Saved "Rondo".');

    expect(tags()).toEqual(['~BOARD:White:Rondo']);
    const [saved] = await listLayouts();
    expect(saved).toMatchObject({
      name: 'Rondo',
      keyword: '~BOARD:White:Rondo',
      template: 'White',
      marks: 1,
    });
    expect(saved.pieces).toHaveLength(1);

    // Clear the page, then bring the layout back as a new page.
    mockNote.state.pages[0].elements = [];
    expect(await loadLayoutAsPage(saved)).toBe('"Rondo" added as page 2.');
    expect(mockNote.state.current).toBe(1);
    const copy = mockNote.state.pages[1];
    expect(copy.template).toBe(saved.background);
    expect(copy.elements.length).toBeGreaterThan(1);
    expect(copy.keywords).toEqual([]); // the tag stays in the layouts note
    expect((await readPieces(await getContext())).map(p => p.kind)).toEqual([
      'cone',
    ]);
  });

  it('names the template: a pitch page, and copies of it, are Soccer Field', async () => {
    mockNote.state.files.add(
      '/storage/emulated/0/EXPORT/SNSoccer/pitch-1404x1872.png',
    );
    await addPitch();
    await copyThisPage(); // page 3 is a copy of the pitch page
    await saveThisPage('From a copy');
    expect(tags()).toEqual(['~BOARD:Soccer Field:From a copy']);
  });

  it('finds pages by keyword, wherever they are in the note', async () => {
    await saveThisPage('A');
    await saveThisPage('B');
    // Someone reorders the layouts note by hand.
    libPages().reverse();
    const b = (await listLayouts()).find(l => l.name === 'B')!;
    mockNote.state.pages[0].elements = [];
    await loadLayoutAsPage(b);
    expect(mockNote.state.pages[1].template).toBe(b.background);
  });

  it('replaces a page saved again under the same name', async () => {
    await saveThisPage('A');
    await saveThisPage('B');
    await saveThisPage('a');
    expect(tags()).toEqual(['~BOARD:White:B', '~BOARD:White:a']);
    expect((await listLayouts()).map(l => l.name)).toEqual(['a', 'B']);
  });

  it('keeps the list in line with the layouts note', async () => {
    await saveThisPage('A');
    await saveThisPage('B');
    await saveThisPage('C');

    // Deleted in the menu: its page goes once the menu has closed.
    await deleteLayout((await listLayouts()).find(l => l.name === 'B')!.id);
    await closeMenu();
    expect(tags()).toEqual(['~BOARD:White:A', '~BOARD:White:C']);

    // Deleted in the Note app, and one tagged there by hand.
    libPages().splice(0, 1);
    libPages()[0].keywords.push('~BOARD:Kanban:Warm-up');
    await closeMenu();
    expect((await listLayouts()).map(l => [l.name, l.template])).toEqual([
      ['Warm-up', 'Kanban'],
      ['C', 'White'],
    ]);
  });

  it("leaves the last page, untagged, when it can't be removed", async () => {
    await saveThisPage('Only');
    await deleteLayout((await listLayouts())[0].id);
    await closeMenu();
    expect(libPages()).toHaveLength(1);
    expect(tags()).toEqual(['']);
    expect(await listLayouts()).toEqual([]);
  });

  it('tags pages saved before keywords', async () => {
    await saveThisPage('Old');
    const [old] = await listLayouts();
    libPages()[0].keywords = [];
    await AsyncStorage.setItem(
      'snsoccer:layouts:v1',
      JSON.stringify([{...old, keyword: undefined, libPage: 0}]),
    );
    await closeMenu();
    expect(tags()).toEqual(['~BOARD:White:Old']);
    expect((await listLayouts())[0].keyword).toBe('~BOARD:White:Old');
  });

  it('loads a layout in place of the pieces on the page', async () => {
    await handle({type: 'drop', kind: 'cone', ...at(300, 500)});
    const msg = await loadLayoutHere('Rondo', [
      {kind: 'attacker', x: 0.5, y: 0.5},
      {kind: 'ball', x: 0.25, y: 0.75},
    ]);
    expect(msg).toBe('Loaded "Rondo".');
    const pieces = await readPieces(await getContext());
    expect(pieces.map(p => [p.kind, p.x, p.y]).sort()).toEqual(
      [
        ['attacker', 702, 936],
        ['ball', 351, 1404],
      ].sort(),
    );
  });

  it('explains failures', async () => {
    startPaletteController();
    mockNote.state.notePath = '/storage/emulated/0/Document/book.pdf';
    DeviceEventEmitter.emit(PALETTE_EVENT, {
      type: 'drop',
      kind: 'cone',
      ...at(1, 1),
    });
    await settle();
    expect((ToastAndroid.show as jest.Mock).mock.calls[0][0]).toMatch(
      /Open a note/,
    );
  });
});
