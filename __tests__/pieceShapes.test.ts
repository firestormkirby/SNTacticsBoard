import {
  PIECE_KINDS,
  newPieceId,
  parseTag,
  pieceSizeFor,
  shapeBounds,
  shapesFor,
  tagFor,
} from '../src/page/pieceShapes';

describe.each(PIECE_KINDS)('%s shapes', kind => {
  const size = pieceSizeFor(1404);
  const c = {x: 500, y: 700};
  const shapes = shapesFor(kind, c, size);

  it('stay inside the piece box, around the centre', () => {
    const b = shapeBounds(shapes);
    expect(b.left).toBeGreaterThanOrEqual(c.x - size / 2 - 1);
    expect(b.right).toBeLessThanOrEqual(c.x + size / 2 + 1);
    expect(b.top).toBeGreaterThanOrEqual(c.y - size / 2 - 1);
    expect(b.bottom).toBeLessThanOrEqual(c.y + size / 2 + 1);
  });

  it('are built from geometry the SDK accepts', () => {
    for (const s of shapes) {
      expect(['straightLine', 'GEO_circle', 'GEO_polygon']).toContain(s.type);
      if (s.type === 'GEO_circle') {
        expect(s.radius).toBeGreaterThan(0);
      } else {
        expect(s.points.length).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

it('closes each triangle of the cone: polygons are drawn as open lines', () => {
  const [cone] = shapesFor('cone', {x: 500, y: 700}, 60);
  const pts = cone.type === 'GEO_polygon' ? cone.points : [];
  expect(pts.length % 4).toBe(0);
  for (let i = 0; i < pts.length; i += 4) {
    expect(pts[i + 3]).toEqual(pts[i]);
  }
});

it('keeps each piece to one element, two for the X', () => {
  // The Note app takes ~60 ms per inserted element.
  const count = (k: (typeof PIECE_KINDS)[number]) =>
    shapesFor(k, {x: 500, y: 700}, 86).length;
  expect(PIECE_KINDS.map(count)).toEqual([2, 1, 1, 1]);
});

it('draws the four pieces differently', () => {
  const sig = (k: (typeof PIECE_KINDS)[number]) =>
    shapesFor(k, {x: 0, y: 0}, 60)
      .map(s => `${s.type}:${s.type === 'GEO_circle' ? 0 : s.points.length}`)
      .join();
  expect(new Set(PIECE_KINDS.map(sig)).size).toBe(4);
});

it('round-trips tags and rejects anything else', () => {
  const tag = {kind: 'cone' as const, id: 'ab12cd01', x: 101, y: 202};
  expect(parseTag(tagFor(tag))).toEqual(tag);
  expect(parseTag('')).toBeNull();
  expect(parseTag('planner:label')).toBeNull();
  expect(parseTag('tacticsboard:v1:dragon:x:1:2')).toBeNull();
  expect(parseTag(undefined)).toBeNull();
});

it('makes distinct ids', () => {
  const ids = new Set(Array.from({length: 200}, () => newPieceId(123456)));
  expect(ids.size).toBe(200);
});
