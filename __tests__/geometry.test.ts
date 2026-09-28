import {PITCH_ASPECT, computeLayout, isInside} from '../src/board/geometry';
import {PIECES} from '../src/board/pieces';

// Board areas below the toolbar, in dp, for the screens the plugin targets.
const screens: Array<[string, number, number]> = [
  ['Nomad / A5X', 994, 1325 - 76],
  ['Manta', 1024, 1365 - 76],
  ['preview at 1404x1872', 1404, 1872 - 76],
];

describe.each(screens)('layout on %s', (_name, w, h) => {
  const layout = computeLayout(w, h);

  it('keeps the pitch portrait and in proportion', () => {
    expect(layout.field.h).toBeGreaterThan(layout.field.w);
    expect(layout.field.w / layout.field.h).toBeCloseTo(PITCH_ASPECT);
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
