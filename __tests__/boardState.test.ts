import {
  EMPTY_BOARD,
  deserializeBoard,
  dropPiece,
  pieceCentre,
  placePiece,
  returnToTray,
  serializeBoard,
  tapPiece,
} from '../src/board/boardState';
import {computeLayout} from '../src/board/geometry';

const layout = computeLayout(994, 1250); // A Nomad-sized board area, in dp.
const {field} = layout;
const mid = {x: field.x + field.w / 2, y: field.y + field.h / 2};

describe('dropPiece', () => {
  it('places a piece dropped on the pitch where it was let go', () => {
    const {state, settleAt} = dropPiece(EMPTY_BOARD, layout, 'x1', mid);
    expect(state.placed).toEqual([{id: 'x1', x: 0.5, y: 0.5}]);
    expect(settleAt.x).toBeCloseTo(mid.x);
    expect(settleAt.y).toBeCloseTo(mid.y);
  });

  it('sends a piece dropped outside the pitch back to its tray slot', () => {
    const placed = placePiece(EMPTY_BOARD, 'cone2', {x: 0.2, y: 0.3});
    const inTray = {x: layout.tray.x + 5, y: layout.tray.y + 5};
    const {state, settleAt} = dropPiece(placed, layout, 'cone2', inTray);
    expect(state.placed).toEqual([]);
    expect(settleAt).toEqual(layout.slots.cone2);
  });

  it('moves the last-dropped piece to the top of the stack', () => {
    let s = placePiece(EMPTY_BOARD, 'x1', {x: 0.1, y: 0.1});
    s = placePiece(s, 'o1', {x: 0.2, y: 0.2});
    s = dropPiece(s, layout, 'x1', mid).state;
    expect(s.placed.map(p => p.id)).toEqual(['o1', 'x1']);
  });

  it('leaves state untouched when a tray piece is dropped back in the tray', () => {
    const {state} = dropPiece(EMPTY_BOARD, layout, 'ball1', {x: -50, y: -50});
    expect(state).toBe(EMPTY_BOARD);
  });
});

describe('tapPiece', () => {
  it('takes a tapped piece off the pitch and back to its slot', () => {
    const s = placePiece(EMPTY_BOARD, 'o3', {x: 0.4, y: 0.6});
    const {state, settleAt} = tapPiece(s, layout, 'o3');
    expect(state.placed).toEqual([]);
    expect(settleAt).toEqual(layout.slots.o3);
  });

  it('does nothing to a piece already in the tray', () => {
    expect(tapPiece(EMPTY_BOARD, layout, 'o3').state).toBe(EMPTY_BOARD);
  });
});

describe('placePiece / returnToTray', () => {
  it('clamps positions onto the canvas and ignores unknown ids', () => {
    const s = placePiece(EMPTY_BOARD, 'x2', {x: -1, y: 3});
    expect(s.placed).toEqual([{id: 'x2', x: 0, y: 1}]);
    expect(placePiece(s, 'nope', {x: 0.5, y: 0.5})).toBe(s);
  });

  it('returns pieces to the tray', () => {
    const s = placePiece(EMPTY_BOARD, 'x2', {x: 0.5, y: 0.5});
    expect(returnToTray(s, 'x2').placed).toEqual([]);
    expect(returnToTray(s, 'x3')).toBe(s);
  });
});

describe('pieceCentre', () => {
  it('uses the tray slot for pieces not on the pitch', () => {
    expect(pieceCentre(EMPTY_BOARD, layout, 'o4')).toEqual(layout.slots.o4);
  });

  it('keeps a placed piece at the same share of the pitch on another device', () => {
    const s = placePiece(EMPTY_BOARD, 'x1', {x: 0.25, y: 0.75});
    const manta = computeLayout(1024, 1280);
    const c = pieceCentre(s, manta, 'x1');
    expect((c.x - manta.field.x) / manta.field.w).toBeCloseTo(0.25);
    expect((c.y - manta.field.y) / manta.field.h).toBeCloseTo(0.75);
  });
});

describe('persistence format', () => {
  it('round-trips a board', () => {
    let s = placePiece(EMPTY_BOARD, 'x1', {x: 0.1, y: 0.9});
    s = placePiece(s, 'ball1', {x: 0.5, y: 0.5});
    expect(deserializeBoard(serializeBoard(s))).toEqual(s);
  });

  it('treats missing or corrupt data as an empty board', () => {
    expect(deserializeBoard(null)).toEqual(EMPTY_BOARD);
    expect(deserializeBoard('{not json')).toEqual(EMPTY_BOARD);
    expect(deserializeBoard('{"version":1}')).toEqual(EMPTY_BOARD);
  });

  it('keeps valid pieces and drops invalid ones', () => {
    const json = JSON.stringify({
      version: 1,
      placed: [
        {id: 'x1', x: 0.5, y: 0.5},
        {id: 'ghost', x: 0.5, y: 0.5},
        {id: 'o1', x: 'left', y: 0.5},
        {id: 'o2', x: 2, y: 0.5},
        {id: 'x1', x: 0.1, y: 0.2},
      ],
    });
    expect(deserializeBoard(json).placed).toEqual([{id: 'x1', x: 0.1, y: 0.2}]);
  });
});
