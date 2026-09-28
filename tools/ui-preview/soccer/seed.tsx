/**
 * Scenario setup for Soccer Board: put a pitch page with a drill on it into the
 * simulated note, using the plugin's own code wherever it has some.
 */
import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import PitchSheet from '../../../src/components/PitchSheet';
import { getContext, pitchPngPath, placePiece } from '../../../src/page/pageOps';
import type { PieceKind } from '../../../src/page/pieceShapes';
import { CURRENT_PAGE } from '../src/mocks/sn-plugin-lib';
import { NOTE, addElements, addLayer, registerImage } from '../src/mocks/note';

/** Draw the plugin's pitch sheet and keep it as the pitch PNG for this page size. */
export async function preparePitchImage(): Promise<string> {
  const { width, height } = CURRENT_PAGE.pageSize;
  const host = document.createElement('div');
  const root = createRoot(host);
  flushSync(() => root.render(<PitchSheet width={width} height={height} onLayout={() => {}} />));
  const node = host.firstElementChild as HTMLElement;
  const path = await pitchPngPath({ width, height });
  registerImage(path, { node, width, height });
  return path;
}

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

/** Make the current page a pitch page holding the rondo drill and some arrows. */
export async function seedDrill(): Promise<void> {
  const { width, height } = CURRENT_PAGE.pageSize;
  NOTE.pages[NOTE.current].template = await preparePitchImage();
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
