import {
  PITCH_ASPECT,
  computeLayout,
  fromFieldFraction,
  isInside,
  toFieldFraction,
} from '../src/board/geometry';
import {PIECES} from '../src/board/pieces';

// Board areas below the toolbar, in dp, for the screens the plugin targets.
const screens: Array<[string, number, number]> = [
  ['Nomad / A5X', 994, 1325 - 76],
  ['Manta', 1024, 1365 - 76],
  ['preview at 1404x1872', 1404, 1872 - 76],
  ['A5X in landscape', 1325, 994 - 76],
  ['Manta in landscape', 1365, 1024 - 76],
];

describe.each(screens)('layout on %s', (_name, w, h) => {
  const layout = computeLayout(w, h);

  it('runs the pitch along the long side of the screen, in proportion', () => {
    const {field} = layout;
    expect(field.landscape).toBe(w > h);
    const long = Math.max(field.w, field.h);
    const short = Math.min(field.w, field.h);
    expect(field.landscape ? field.w : field.h).toBe(long);
    expect(short / long).toBeCloseTo(PITCH_ASPECT);
  });

  it('fits pitch and tray on screen without overlapping', () => {
    expect(layout.field.x).toBeGreaterThanOrEqual(0);
    expect(layout.tray.x + layout.tray.w).toBeLessThanOrEqual(w);
    expect(layout.field.x + layout.field.w).toBeLessThanOrEqual(layout.tray.x);
    expect(layout.field.y + layout.field.h).toBeLessThanOrEqual(h);
  });

  it('gives every piece a tray slot inside the tray', () => {
    for (const p of PIECES) {
      const slot = layout.slots[p.id];
      expect(slot).toBeDefined();
      expect(isInside(slot, layout.tray)).toBe(true);
      expect(isInside(slot, layout.field)).toBe(false);
    }
    expect(layout.trayFreeTop).toBeLessThanOrEqual(
      layout.tray.y + layout.tray.h,
    );
  });

  it('keeps touch targets large enough for a finger', () => {
    expect(layout.hit).toBeGreaterThanOrEqual(56);
  });
});

describe('turning the pitch', () => {
  const portrait = computeLayout(1024, 1289).field;
  const landscape = computeLayout(1365, 948).field;

  it('puts the top goal on the left and the left touchline at the bottom', () => {
    const topGoal = fromFieldFraction({x: 0.5, y: 0}, landscape);
    expect(topGoal.x).toBeCloseTo(landscape.x);
    expect(topGoal.y).toBeCloseTo(landscape.y + landscape.h / 2);
    const leftTouchline = fromFieldFraction({x: 0, y: 0.5}, landscape);
    expect(leftTouchline.y).toBeCloseTo(landscape.y + landscape.h);
  });

  it('maps board points and pitch fractions both ways, either way round', () => {
    for (const field of [portrait, landscape]) {
      for (const f of [
        {x: 0.1, y: 0.2},
        {x: 0.5, y: 0.5},
        {x: 0.9, y: 0.75},
      ]) {
        const back = toFieldFraction(fromFieldFraction(f, field), field);
        expect(back.x).toBeCloseTo(f.x);
        expect(back.y).toBeCloseTo(f.y);
      }
    }
  });
});
