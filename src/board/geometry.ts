/**
 * Pitch dimensions and screen layout.
 *
 * Everything on the pitch is measured in metres against a regulation 68 x 105
 * pitch, then scaled to whatever rectangle the pitch is drawn into. Pieces are
 * stored as fractions of that rectangle, so the same drill lands in the same
 * place on a Nomad, a Manta, and the full-page export.
 *
 * The pitch always runs along the screen's long side: goals at the top and
 * bottom in portrait, at the left and right in landscape. Stored fractions are
 * always in portrait terms (x across the pitch, y from the top goal), and a
 * landscape pitch is the portrait one turned a quarter-turn anticlockwise, as
 * if the whole clipboard had been turned: the top goal ends up on the left.
 */
import {PIECES, TRAY_SECTIONS} from './pieces';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ── Pitch, in metres ────────────────────────────────────────────────────────

export const PITCH = {
  width: 68,
  length: 105,
  /** Run-off drawn around the lines, deep enough for the goals. */
  margin: 4,
  penaltyAreaWidth: 40.32,
  penaltyAreaDepth: 16.5,
  goalAreaWidth: 18.32,
  goalAreaDepth: 5.5,
  penaltySpot: 11,
  circleRadius: 9.15,
  cornerRadius: 1,
  goalWidth: 7.32,
  goalDepth: 2.2,
} as const;

/** The drawn canvas: the pitch plus its margin on every side. */
export const CANVAS_METRES = {
  w: PITCH.width + 2 * PITCH.margin,
  h: PITCH.length + 2 * PITCH.margin,
};

/** Width over height of the portrait pitch, goals at the top and bottom. */
export const PITCH_ASPECT = CANVAS_METRES.w / CANVAS_METRES.h;

/** Where the pitch is drawn, and which way round. */
export interface FieldRect extends Rect {
  /** Goals at the left and right instead of the top and bottom. */
  landscape: boolean;
}

/**
 * Largest pitch-shaped rectangle that fits in `box`, centred. The pitch runs
 * along the box's long side unless `landscape` says otherwise.
 */
export function fitPitch(box: Rect, landscape = box.w > box.h): FieldRect {
  const aspect = landscape ? 1 / PITCH_ASPECT : PITCH_ASPECT;
  const h = Math.min(box.h, box.w / aspect);
  const w = h * aspect;
  return {
    x: box.x + (box.w - w) / 2,
    y: box.y + (box.h - h) / 2,
    w,
    h,
    landscape,
  };
}

/** Width of the pitch across the touchlines, whichever way it is drawn. */
export function pitchBreadth(field: FieldRect): number {
  return field.landscape ? field.h : field.w;
}

// ── Board layout, in dp ─────────────────────────────────────────────────────

export const TOOLBAR_HEIGHT = 76;

const PAD = 14;
const GAP = 14;
const TRAY_COLS = 3;
const TRAY_PAD = 8;
const HEADER_H = 28;
const SECTION_GAP = 6;
/**
 * A tray cell is also a piece's touch target. 64dp is about 9mm on a Nomad or
 * Manta: comfortable for a fingertip, and generous for the pen.
 */
const MAX_CELL = 64;
const MIN_CELL = 44;
/** Drawn size of a piece, as a share of its touch target. */
const GLYPH_SHARE = 0.62;

export interface TrayHeader {
  label: string;
  y: number;
}

export interface BoardLayout {
  width: number;
  height: number;
  /** The pitch canvas, in board coordinates. */
  field: FieldRect;
  /** The holding area pieces start in and return to. */
  tray: Rect;
  trayHeaders: TrayHeader[];
  /** First y in the tray below the last row of slots. */
  trayFreeTop: number;
  /** Centre of each piece's home slot in the tray, by piece id. */
  slots: Record<string, Point>;
  /** Touch target edge length. */
  hit: number;
  /** Drawn piece size. */
  glyph: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Lay out the board: the pitch on the left, as large as the screen allows,
 * and a three-column tray beside it holding every piece not on the pitch. The
 * pitch turns with the screen so it always runs along the long side.
 *
 * `width` and `height` are the board area below the toolbar, in dp.
 */
export function computeLayout(width: number, height: number): BoardLayout {
  const innerH = Math.max(0, height - 2 * PAD);
  const rows = TRAY_SECTIONS.reduce(
    (n, s) => n + Math.ceil(s.count / TRAY_COLS),
    0,
  );
  const fixed = TRAY_SECTIONS.length * (HEADER_H + SECTION_GAP) + 2 * TRAY_PAD;
  const hit = Math.floor(clamp((innerH - fixed) / rows, MIN_CELL, MAX_CELL));
  const glyph = Math.round(hit * GLYPH_SHARE);

  const trayW = TRAY_COLS * hit + 2 * TRAY_PAD;
  const field = fitPitch(
    {
      x: PAD,
      y: PAD,
      w: Math.max(0, width - 2 * PAD - GAP - trayW),
      h: innerH,
    },
    width > height,
  );

  // Keep pitch and tray together, centred across the screen.
  const groupW = field.w + GAP + trayW;
  const shift = Math.max(0, (width - groupW) / 2 - PAD);
  field.x += shift;
  const tray: Rect = {x: field.x + field.w + GAP, y: PAD, w: trayW, h: innerH};

  const trayHeaders: TrayHeader[] = [];
  const slots: Record<string, Point> = {};
  let cursor = tray.y + TRAY_PAD;
  for (const section of TRAY_SECTIONS) {
    trayHeaders.push({label: section.label, y: cursor});
    cursor += HEADER_H;
    const kindPieces = PIECES.filter(p => p.kind === section.kind);
    for (const piece of kindPieces) {
      const col = piece.index % TRAY_COLS;
      const row = Math.floor(piece.index / TRAY_COLS);
      slots[piece.id] = {
        x: tray.x + TRAY_PAD + col * hit + hit / 2,
        y: cursor + row * hit + hit / 2,
      };
    }
    cursor += Math.ceil(section.count / TRAY_COLS) * hit + SECTION_GAP;
  }

  return {
    width,
    height,
    field,
    tray,
    trayHeaders,
    trayFreeTop: cursor,
    slots,
    hit,
    glyph,
  };
}

/**
 * Board point -> fraction of the portrait pitch canvas, clamped onto it.
 * On a landscape pitch, left-to-right runs from the top goal to the bottom
 * one, and bottom-to-top runs across the pitch from its left touchline.
 */
export function toFieldFraction(p: Point, field: FieldRect): Point {
  const u = clamp((p.x - field.x) / field.w, 0, 1);
  const v = clamp((p.y - field.y) / field.h, 0, 1);
  return field.landscape ? {x: 1 - v, y: u} : {x: u, y: v};
}

/** Fraction of the portrait pitch canvas -> board point. */
export function fromFieldFraction(f: Point, field: FieldRect): Point {
  const u = field.landscape ? f.y : f.x;
  const v = field.landscape ? 1 - f.x : f.y;
  return {x: field.x + u * field.w, y: field.y + v * field.h};
}

export function isInside(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}
