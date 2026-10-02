/**
 * Scenario setup for Tactics Board: put a drill on a page of the simulated
 * note, using the plugin's own code wherever it has some.
 */
import { getContext, placePiece } from '../../../src/page/pageOps';
import type { PieceKind } from '../../../src/page/pieceShapes';
import { CURRENT_PAGE } from '../src/mocks/sn-plugin-lib';
import { NOTE, addElements, addLayer } from '../src/mocks/note';

type Placement = [PieceKind, number, number];

/** A 4v2 rondo in a coned square, with an exit gate, as page fractions. */
export const RONDO: Placement[] = [
  ['cone', 0.38, 0.40], ['cone', 0.62, 0.40], ['cone', 0.38, 0.60], ['cone', 0.62, 0.60],
  ['cone', 0.45, 0.76], ['cone', 0.55, 0.76],
  ['attacker', 0.50, 0.41], ['attacker', 0.39, 0.50], ['attacker', 0.61, 0.50], ['attacker', 0.50, 0.59],
  ['defender', 0.46, 0.47], ['defender', 0.54, 0.53],
  ['ball', 0.43, 0.42],
];

/** Pen strokes: a pass and a run, each with an arrowhead, as page fractions. */
const ARROWS: Array<Array<[number, number]>> = [
  [[0.41, 0.49], [0.45, 0.455], [0.485, 0.425]],
  [[0.475, 0.415], [0.462, 0.42]],
  [[0.475, 0.415], [0.47, 0.432]],
  [[0.61, 0.52], [0.63, 0.58], [0.60, 0.66], [0.53, 0.72]],
  [[0.53, 0.72], [0.54, 0.705]],
  [[0.53, 0.72], [0.548, 0.723]],
];

/** Put the rondo drill and some arrows on the current page. */
export async function seedDrill(): Promise<void> {
  const { width, height } = CURRENT_PAGE.pageSize;
  addLayer(NOTE.current, { layerId: 1, name: 'Pieces' });

  const ctx = await getContext();
  for (const [kind, fx, fy] of RONDO) {
    await placePiece(ctx, kind, { x: fx * width, y: fy * height });
  }
  addElements(
    NOTE.current,
    ARROWS.map(line => ({
      type: 0,
      layerNum: 0,
      previewStroke: line.map(([fx, fy]) => ({ x: Math.round(fx * width), y: Math.round(fy * height) })),
    })),
  );
}
