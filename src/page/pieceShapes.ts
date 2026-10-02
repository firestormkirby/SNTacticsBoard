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
 * Each shape is as few elements as it can be, because the Note app takes
 * ~60 ms to insert each one: a drop's wait is mostly that. The nested
 * outlines are joined into one polygon, which the firmware draws as an open
 * line through its points, so a single element can zigzag or spiral to fill
 * a shape. The X is two elements, since its bars cross.
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

/** A closed circle as points about 4 px apart, starting at the right. */
function ring(c: Point, r: number): Point[] {
  const n = Math.max(12, Math.round((2 * Math.PI * r) / 4));
  const points: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (2 * Math.PI * i) / n;
    points.push(pt(c.x + r * Math.cos(a), c.y + r * Math.sin(a)));
  }
  return points;
}

/** The geometry for one piece, centred on `c`, `size` pixels across. */
export function shapesFor(kind: PieceKind, c: Point, size: number): GeoSpec[] {
  switch (kind) {
    case 'attacker': {
      // Each bar is three parallel passes, so the X is as heavy as the O,
      // drawn there and back as one line.
      const h = size * 0.4;
      const offsets = [-FILL_STEP / 2, 0, FILL_STEP / 2];
      const bar = (from: Point, to: Point, nx: number, ny: number) => {
        const points: Point[] = [];
        offsets.forEach((o, i) => {
          const [a, b] = i % 2 === 0 ? [from, to] : [to, from];
          points.push(pt(a.x + nx * o, a.y + ny * o));
          points.push(pt(b.x + nx * o, b.y + ny * o));
        });
        return {type: 'GEO_polygon' as const, points};
      };
      return [
        bar({x: c.x - h, y: c.y - h}, {x: c.x + h, y: c.y + h}, 1, -1),
        bar({x: c.x - h, y: c.y + h}, {x: c.x + h, y: c.y - h}, -1, -1),
      ];
    }
    case 'defender': {
      // A heavy ring: three turns, each a little inside the last.
      const r = size * 0.42;
      const points = [0, 1, 2].flatMap(i => ring(c, r - i * FILL_STEP * 0.7));
      return [{type: 'GEO_polygon', points}];
    }
    case 'cone': {
      // Apex up, centred in the piece box.
      const w = size * 0.8;
      const hgt = size * 0.78;
      const apex = {x: c.x, y: c.y - hgt / 2};
      const left = {x: c.x - w / 2, y: c.y + hgt / 2};
      const right = {x: c.x + w / 2, y: c.y + hgt / 2};
      // Shrink toward the centroid until the triangle is a speck. Each
      // triangle goes back to its apex: three points left the left side off.
      const g = {x: c.x, y: c.y + hgt / 6};
      const points: Point[] = [];
      const steps = Math.max(1, Math.floor(hgt / 3 / FILL_STEP));
      for (let i = 0; i <= steps; i++) {
        const k = 1 - i / (steps + 1);
        const toward = (p: Point) =>
          pt(g.x + (p.x - g.x) * k, g.y + (p.y - g.y) * k);
        points.push(toward(apex), toward(right), toward(left), toward(apex));
      }
      return [{type: 'GEO_polygon', points}];
    }
    case 'ball': {
      // A spiral of shrinking rings down to the centre.
      const r = size * 0.26;
      const points: Point[] = [];
      for (let rad = r; rad > 0.5; rad -= FILL_STEP) {
        points.push(...ring(c, rad));
      }
      points.push(pt(c.x, c.y));
      return [{type: 'GEO_polygon', points}];
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

const TAG_PREFIX = 'tacticsboard:v1';

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
