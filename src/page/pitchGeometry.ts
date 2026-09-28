/**
 * Pitch dimensions, for drawing the pitch background.
 *
 * Everything is measured in metres against a regulation 68 x 105 pitch, then
 * scaled to whatever rectangle the pitch is drawn into. The pitch runs along
 * the long side of that rectangle: goals at the top and bottom of a portrait
 * page, at the left and right of a landscape one.
 */

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
