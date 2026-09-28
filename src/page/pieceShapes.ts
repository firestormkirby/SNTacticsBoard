/**
 * How a piece is drawn on a note page: as native geometry (lines, circles and
 * polygons) in page pixels, the coordinate system `Geometry.points` and
 * `ellipseCenterPoint` use.
 *
 * Shape carries the meaning, as on the screen:
 *
 *   X  Team X player  two crossed bars
 *   O  Team O player  a heavy ring
 *   ▲  cone           a solid triangle
 *   ●  ball           a small solid disc
 *
 * Geometry has no fill, so the solid shapes are nested outlines a few pixels
 * apart. That reads as solid at any pen width the firmware turns out to use:
 * the SDK's docs don't give `penWidth` units, only a minimum of 100.
 *
 * Every element carries a `userData` tag naming the piece, its id and its
 * centre, which is how the plugin finds its own pieces on a page again.
 */

export type PieceKind = 'attacker' | 'defender' | 'cone' | 'ball';

export const PIECE_KINDS: readonly PieceKind[] = [
  'attacker',
  'defender',
  'cone',
  'ball',
];

export interface Point {
  x: number;
  y: number;
}

export type GeoSpec =
  | {type: 'straightLine'; points: [Point, Point]}
  | {type: 'GEO_circle'; center: Point; radius: number}
  | {type: 'GEO_polygon'; points: Point[]};

/** Pen settings for every piece element. Tune `width` on a device. */
export const PIECE_PEN = {
  /** 0x00 black. */
  color: 0x00,
  /** 10 = fineliner: an even line with no pressure variation. */
  type: 10,
  width: 300,
};

/** Spacing, in page pixels, between the nested outlines of a solid shape. */
const FILL_STEP = 3;

/** Piece size on the page, in page pixels, for a page of this width. */
export function pieceSizeFor(pageWidth: number): number {
  return Math.round(pageWidth * 0.045);
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const pt = (x: number, y: number): Point => ({x: r1(x), y: r1(y)});

/** The geometry for one piece, centred on `c`, `size` pixels across. */
export function shapesFor(kind: PieceKind, c: Point, size: number): GeoSpec[] {
  switch (kind) {
    case 'attacker': {
      const h = size * 0.4;
      const shapes: GeoSpec[] = [];
      // Three parallel strokes per bar, so the X is as heavy as the O.
      for (const o of [-FILL_STEP / 2, 0, FILL_STEP / 2]) {
        shapes.push({
          type: 'straightLine',
          points: [pt(c.x - h + o, c.y - h - o), pt(c.x + h + o, c.y + h - o)],
        });
        shapes.push({
          type: 'straightLine',
          points: [pt(c.x - h - o, c.y + h - o), pt(c.x + h - o, c.y - h - o)],
        });
      }
      return shapes;
    }
    case 'defender': {
      const r = size * 0.42;
      return [0, 1, 2].map(i => ({
        type: 'GEO_circle' as const,
        center: pt(c.x, c.y),
        radius: r1(r - i * FILL_STEP * 0.7),
      }));
    }
    case 'cone': {
      // Apex up, centred in the piece box.
      const w = size * 0.8;
      const hgt = size * 0.78;
      const apex = {x: c.x, y: c.y - hgt / 2};
      const left = {x: c.x - w / 2, y: c.y + hgt / 2};
      const right = {x: c.x + w / 2, y: c.y + hgt / 2};
      // Shrink toward the centroid until the triangle is a speck.
      const g = {x: c.x, y: c.y + hgt / 6};
      const shapes: GeoSpec[] = [];
      const steps = Math.max(1, Math.floor(hgt / 3 / FILL_STEP));
      for (let i = 0; i <= steps; i++) {
        const k = 1 - i / (steps + 1);
        const toward = (p: Point) =>
          pt(g.x + (p.x - g.x) * k, g.y + (p.y - g.y) * k);
        shapes.push({
          type: 'GEO_polygon',
          points: [toward(apex), toward(right), toward(left)],
        });
      }
      return shapes;
    }
    case 'ball': {
      const r = size * 0.26;
      const shapes: GeoSpec[] = [];
      for (let rad = r; rad > 0.5; rad -= FILL_STEP) {
        shapes.push({
          type: 'GEO_circle',
          center: pt(c.x, c.y),
          radius: r1(rad),
        });
      }
      return shapes;
    }
  }
}

/** Every point a piece's geometry touches, for bounds checks and hit tests. */
export function shapeBounds(shapes: GeoSpec[]): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const take = (x: number, y: number) => {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  };
  for (const s of shapes) {
    if (s.type === 'GEO_circle') {
      take(s.center.x - s.radius, s.center.y - s.radius);
      take(s.center.x + s.radius, s.center.y + s.radius);
    } else {
      for (const p of s.points) {
        take(p.x, p.y);
      }
    }
  }
  return {left, top, right, bottom};
}

// ── Tags ────────────────────────────────────────────────────────────────────

const TAG_PREFIX = 'snsoccer:v1';

export interface PieceTag {
  kind: PieceKind;
  id: string;
  /** Centre in page pixels. */
  x: number;
  y: number;
}

export function tagFor(p: PieceTag): string {
  return `${TAG_PREFIX}:${p.kind}:${p.id}:${Math.round(p.x)}:${Math.round(
    p.y,
  )}`;
}

/** Read a tag written by `tagFor`; anything else is not one of ours. */
export function parseTag(userData: unknown): PieceTag | null {
  if (typeof userData !== 'string' || !userData.startsWith(TAG_PREFIX + ':')) {
    return null;
  }
  const [, , kind, id, x, y] = userData.split(':');
  const cx = Number(x);
  const cy = Number(y);
  if (
    !PIECE_KINDS.includes(kind as PieceKind) ||
    !id ||
    !Number.isFinite(cx) ||
    !Number.isFinite(cy)
  ) {
    return null;
  }
  return {kind: kind as PieceKind, id, x: cx, y: cy};
}

let counter = 0;

/** A short id, unique within a page for any realistic number of pieces. */
export function newPieceId(now = Date.now()): string {
  counter = (counter + 1) % 1296;
  return now.toString(36).slice(-6) + counter.toString(36).padStart(2, '0');
}
