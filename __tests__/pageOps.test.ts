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

import {
  NotANoteError,
  copyPage,
  getContext,
  movePiece,
  placePiece,
  readPieces,
  removePiece,
  replacePieces,
} from '../src/page/pageOps';

describe.each([
  ['firmware that keeps userData', false],
  ['firmware that drops userData', true],
])('on %s', (_name, dropsUserData) => {
  beforeEach(async () => {
    mockNote = createFakeNote({dropsUserData});
    await AsyncStorage.clear();
  });

  it('places, finds, moves and removes pieces', async () => {
    const ctx = await getContext();
    const x = await placePiece(ctx, 'attacker', {x: 300, y: 400});
    const o = await placePiece(ctx, 'defender', {x: 600, y: 900});

    let pieces = await readPieces(ctx);
    expect(pieces.map(p => [p.kind, p.x, p.y]).sort()).toEqual(
      [
        ['attacker', 300, 400],
        ['defender', 600, 900],
      ].sort(),
    );

    await movePiece(ctx, x.id, {x: 320, y: 1200});
    pieces = await readPieces(ctx);
    expect(pieces.find(p => p.id === x.id)).toMatchObject({x: 320, y: 1200});
    expect(pieces.find(p => p.id === o.id)).toMatchObject({x: 600, y: 900});

    expect(await removePiece(ctx, o.id)).toBe(true);
    pieces = await readPieces(ctx);
    expect(pieces.map(p => p.id)).toEqual([x.id]);
  });

  it('replaces every piece on the page, and only the pieces', async () => {
    const ctx = await getContext();
    mockNote.state.pages[0].elements.push({
      type: 0,
      numInPage: 900,
      userData: '',
    });
    await placePiece(ctx, 'cone', {x: 100, y: 100});
    await placePiece(ctx, 'ball', {x: 200, y: 200});
    await replacePieces(ctx, [{kind: 'attacker', x: 500, y: 600}]);
    const pieces = await readPieces(ctx);
    expect(pieces.map(p => [p.kind, p.x, p.y])).toEqual([
      ['attacker', 500, 600],
    ]);
    expect(
      mockNote.state.pages[0].elements.some(e => e.numInPage === 900),
    ).toBe(true);
  });

  it("leaves the user's own drawing alone", async () => {
    const ctx = await getContext();
    // A user's circle and a stroke, drawn before any piece.
    mockNote.state.pages[0].elements.push(
      {type: 0, numInPage: 900, userData: ''},
      {
        type: 700,
        numInPage: 901,
        userData: '',
        geometry: {
          type: 'GEO_circle',
          ellipseCenterPoint: {x: 50, y: 50},
          ellipseMajorAxisRadius: 20,
        },
      },
    );
    const piece = await placePiece(ctx, 'ball', {x: 700, y: 700});
    await movePiece(ctx, piece.id, {x: 710, y: 720});
    await removePiece(ctx, piece.id);
    expect(mockNote.state.pages[0].elements.map(e => e.numInPage)).toEqual([
      900, 901,
    ]);
  });
});

describe('pages', () => {
  beforeEach(async () => {
    mockNote = createFakeNote();
    await AsyncStorage.clear();
  });

  it('keeps pieces inside the page', async () => {
    const ctx = await getContext();
    const p = await placePiece(ctx, 'cone', {x: -40, y: 99999});
    expect(p.x).toBeGreaterThan(0);
    expect(p.y).toBeLessThan(ctx.pageSize.height);
  });

  it('puts pieces on the Pieces layer where a page has one', async () => {
    mockNote.state.pages[0].layers.push({layerId: 1, name: 'Pieces'});
    await placePiece(await getContext(), 'attacker', {x: 500, y: 500});
    expect(
      new Set(mockNote.state.pages[0].elements.map(e => e.layerNum)),
    ).toEqual(new Set([1]));
  });

  it('copies background, drawings and pieces to the next page', async () => {
    const ctx = await getContext();
    mockNote.state.pages[0].elements.push({
      type: 0,
      numInPage: 500,
      userData: '',
    });
    const piece = await placePiece(ctx, 'defender', {x: 400, y: 400});

    expect(await copyPage(ctx)).toEqual({page: 1, jumped: true});
    expect(mockNote.state.current).toBe(1);
    expect(mockNote.state.pages[1].template).toMatch(/page-\d{8}-\d{6}\.png$/);
    expect(mockNote.state.pages[1].elements.length).toBe(
      mockNote.state.pages[0].elements.length,
    );

    // The copied piece can be moved on the copy without touching the original.
    const copyCtx = await getContext();
    await movePiece(copyCtx, piece.id, {x: 800, y: 800});
    expect((await readPieces(copyCtx))[0]).toMatchObject({x: 800, y: 800});
    expect((await readPieces(ctx))[0]).toMatchObject({x: 400, y: 400});
  });

  it("still adds the page on firmware that can't jump to it", async () => {
    mockNote = createFakeNote({noJump: true});
    const ctx = await getContext();
    expect(await copyPage(ctx)).toEqual({page: 1, jumped: false});
    expect(mockNote.state.pages).toHaveLength(2);
    expect(mockNote.state.current).toBe(0);
  });

  it('refuses a file that is not a note', async () => {
    mockNote.state.notePath = '/storage/emulated/0/Document/book.pdf';
    await expect(getContext()).rejects.toBeInstanceOf(NotANoteError);
  });
});
