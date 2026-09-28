import {PITCH_ASPECT, fitPitch} from '../src/page/pitchGeometry';
import {pageSizeFor} from '../src/page/capture';

describe('fitPitch', () => {
  it('fills a portrait page with a portrait pitch', () => {
    const f = fitPitch({x: 0, y: 0, w: 1404, h: 1872});
    expect(f.landscape).toBe(false);
    expect(f.w / f.h).toBeCloseTo(PITCH_ASPECT);
    expect(f.x).toBeGreaterThanOrEqual(0);
    expect(f.h).toBeCloseTo(Math.min(1872, 1404 / PITCH_ASPECT));
  });

  it('turns the pitch on a landscape page', () => {
    const f = fitPitch({x: 0, y: 0, w: 2560, h: 1920});
    expect(f.landscape).toBe(true);
    expect(f.h / f.w).toBeCloseTo(PITCH_ASPECT);
  });
});

it('snaps near-miss capture sizes to the real page size', () => {
  expect(pageSizeFor(1920, 2559.4)).toEqual({width: 1920, height: 2560});
  expect(pageSizeFor(1404, 1871.6)).toEqual({width: 1404, height: 1872});
  expect(pageSizeFor(2559.4, 1920)).toEqual({width: 2560, height: 1920});
  expect(pageSizeFor(1000, 1333.3)).toEqual({width: 1000, height: 1333});
});
