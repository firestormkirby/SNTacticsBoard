/**
 * Drag-and-drop state: which pieces are on the pitch, where, and in what
 * stacking order. Pure functions only, so the rules are testable without a
 * device and the UI simply renders whatever these return.
 *
 * A piece that is not in `placed` is in the tray, in its own home slot. That
 * makes "Clear Board" a matter of emptying one list, and means a saved board
 * never has to remember tray positions at all.
 */
import {
  BoardLayout,
  Point,
  fromFieldFraction,
  isInside,
  toFieldFraction,
} from './geometry';
import {PIECES_BY_ID} from './pieces';

export interface PlacedPiece {
  id: string;
  /** Centre of the piece as a fraction of the pitch canvas, 0..1. */
  x: number;
  y: number;
}

export interface BoardState {
  /** Pieces on the pitch, bottom of the stack first. */
  placed: PlacedPiece[];
}

export const EMPTY_BOARD: BoardState = {placed: []};

/** Put a piece on the pitch at a canvas fraction, on top of everything else. */
export function placePiece(
  state: BoardState,
  id: string,
  at: Point,
): BoardState {
  if (!PIECES_BY_ID.has(id)) {
    return state;
  }
  const x = Math.min(1, Math.max(0, at.x));
  const y = Math.min(1, Math.max(0, at.y));
  return {placed: [...state.placed.filter(p => p.id !== id), {id, x, y}]};
}

export function returnToTray(state: BoardState, id: string): BoardState {
  if (!state.placed.some(p => p.id === id)) {
    return state;
  }
  return {placed: state.placed.filter(p => p.id !== id)};
}

/**
 * Resolve a drop. Inside the pitch canvas the piece stays where it was let go;
 * anywhere else (the tray, the gap, off the edge) it goes home to its slot.
 *
 * Returns the new state and the board point the piece should settle at, which
 * the dragged view snaps to without waiting for a re-render.
 */
export function dropPiece(
  state: BoardState,
  layout: BoardLayout,
  id: string,
  centre: Point,
): {state: BoardState; settleAt: Point} {
  if (isInside(centre, layout.field)) {
    const fraction = toFieldFraction(centre, layout.field);
    return {
      state: placePiece(state, id, fraction),
      settleAt: fromFieldFraction(fraction, layout.field),
    };
  }
  return {
    state: returnToTray(state, id),
    settleAt: layout.slots[id] ?? centre,
  };
}

/**
 * A tap, a touch released without dragging, takes a piece off the pitch and
 * back to its tray slot. Tapping a piece already in the tray does nothing.
 */
export function tapPiece(
  state: BoardState,
  layout: BoardLayout,
  id: string,
): {state: BoardState; settleAt: Point} {
  return {
    state: returnToTray(state, id),
    settleAt: layout.slots[id] ?? {x: 0, y: 0},
  };
}

/** Where a piece is drawn right now, in board coordinates. */
export function pieceCentre(
  state: BoardState,
  layout: BoardLayout,
  id: string,
): Point {
  const placed = state.placed.find(p => p.id === id);
  return placed
    ? fromFieldFraction(placed, layout.field)
    : layout.slots[id] ?? {x: 0, y: 0};
}

// ── Persistence format ──────────────────────────────────────────────────────

export const STORAGE_VERSION = 1;

interface StoredBoard {
  version: number;
  placed: PlacedPiece[];
}

export function serializeBoard(state: BoardState): string {
  const stored: StoredBoard = {version: STORAGE_VERSION, placed: state.placed};
  return JSON.stringify(stored);
}

function isFraction(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
}

/**
 * Read a saved board, keeping whatever is still valid. Unknown piece ids (from
 * a future or older inventory), bad coordinates and duplicates are dropped
 * rather than failing the whole load: a half-restored drill beats an empty one.
 */
export function deserializeBoard(json: string | null | undefined): BoardState {
  if (!json) {
    return EMPTY_BOARD;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return EMPTY_BOARD;
  }
  const list = (parsed as Partial<StoredBoard> | null)?.placed;
  if (!Array.isArray(list)) {
    return EMPTY_BOARD;
  }
  let state = EMPTY_BOARD;
  for (const item of list) {
    const p = item as Partial<PlacedPiece> | null;
    if (
      p &&
      typeof p.id === 'string' &&
      PIECES_BY_ID.has(p.id) &&
      isFraction(p.x) &&
      isFraction(p.y)
    ) {
      state = placePiece(state, p.id, {x: p.x, y: p.y});
    }
  }
  return state;
}
