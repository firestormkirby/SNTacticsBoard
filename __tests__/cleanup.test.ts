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

import {cleanUp, describeCleanup, formatBytes} from '../src/page/cleanup';
import {
  backgroundOf,
  getContext,
  keptRenders,
  saveToLibrary,
} from '../src/page/pageOps';

const DIR = '/storage/emulated/0/EXPORT/SNTacticsBoard';
const LIB = `${DIR}/Layouts.note`;
const libPages = () => mockNote.state.notes.get(LIB)!;

beforeEach(async () => {
  mockNote = createFakeNote();
  await AsyncStorage.clear();
});

describe('the clean-up', () => {
  it('deletes repeated and unused backgrounds, keeping what pages are on', async () => {
    await saveToLibrary(await getContext(), 'A'); // renders White.png
    const white = `${DIR}/White.png`;
    // An earlier build's render of the same image, and one nothing is on.
    const old = `${DIR}/layout-mun5ngyw.png`;
    const unused = `${DIR}/page-mun5oiqe.png`;
    mockNote.state.files.add(old);
    mockNote.state.md5.set(old, `md5:${white}`);
    mockNote.state.files.add(unused);

    const r = await cleanUp();
    expect(r).toMatchObject({files: 2, pages: 0});
    expect(mockNote.state.files.has(white)).toBe(true);
    expect(mockNote.state.files.has(old)).toBe(false);
    expect(mockNote.state.files.has(unused)).toBe(false);
    expect(mockNote.state.files.has(LIB)).toBe(true);
  });

  it('points a page on a deleted image at the one kept', async () => {
    await saveToLibrary(await getContext(), 'A');
    const white = `${DIR}/White.png`;
    // A page on an old render that's the same image as White.png.
    const old = `${DIR}/layout-mun5ngyw.png`;
    mockNote.state.files.add(old);
    mockNote.state.md5.set(old, `md5:${white}`);
    mockNote.state.pages[0].template = old;

    await cleanUp();
    expect(Object.values(await keptRenders())).toContain(white);
  });

  it('takes out untagged pages of Layouts.note, and nothing tagged', async () => {
    await saveToLibrary(await getContext(), 'A');
    await saveToLibrary(await getContext(), 'B');
    // A load that didn't finish left a page with no keyword between them.
    libPages().splice(1, 0, {...libPages()[0], keywords: []});
    expect(libPages()).toHaveLength(3);

    expect(await cleanUp()).toMatchObject({pages: 1});
    expect(libPages().map(p => p.keywords)).toEqual([
      ['~BOARD:White:A'],
      ['~BOARD:White:B'],
    ]);
  });

  it("leaves Layouts.note's pages alone while it's open", async () => {
    await saveToLibrary(await getContext(), 'A');
    libPages().push({...libPages()[0], keywords: []});
    mockNote.state.notePath = LIB;
    expect(await cleanUp()).toMatchObject({pages: 0});
    expect(libPages()).toHaveLength(2);
  });

  it('renders a background again after its image is cleaned up', async () => {
    const ctx = await getContext();
    const png = await backgroundOf(ctx);
    mockNote.state.files.delete(png);
    expect(await backgroundOf(ctx)).toBe(png);
  });

  it('says what it did', () => {
    expect(describeCleanup({files: 0, pages: 0, freed: 0})).toBe(
      'Nothing to clean up.',
    );
    expect(describeCleanup({files: 18, pages: 1, freed: 18 * 3179188})).toBe(
      'Cleaned up 18 images and 1 leftover page, freeing 55 MB.',
    );
    expect(formatBytes(228239)).toBe('223 KB');
    expect(formatBytes(3179188)).toBe('3.0 MB');
  });
});
