/**
 * The page that gets exported: the pitch and every placed piece, laid out on a
 * full, screen-sized sheet of white. It is the same way round as the screen,
 * so a drill exported in landscape comes out as a landscape page.
 *
 * It is rendered from the same components as the board, but at page size,
 * rather than photographing the on-screen pitch and scaling it up: the lines
 * and shapes are drawn natively at full resolution and stay sharp on e-ink.
 * The tray is left out, so unused pieces never reach the note.
 *
 * Pieces keep their size relative to the pitch, so the page looks like the
 * board did. The white either side of the pitch is room for handwritten notes.
 */
import React, {forwardRef} from 'react';
import {StyleSheet, View} from 'react-native';

import type {BoardState} from '../board/boardState';
import {fitPitch, fromFieldFraction, pitchBreadth} from '../board/geometry';
import {PIECES_BY_ID} from '../board/pieces';
import FieldMarkings from './FieldMarkings';
import PieceGlyph from './PieceGlyph';
import {PAPER} from './palette';

interface Props {
  width: number;
  height: number;
  board: BoardState;
  /** On-screen glyph size over the on-screen pitch's breadth. */
  glyphShare: number;
  /** Called once the sheet has been laid out and can be captured. */
  onLayout: () => void;
}

/** Share of the page height left blank above and below the pitch. */
const PAGE_MARGIN = 0.03;

const ExportSheet = forwardRef<View, Props>(function ExportSheet(
  {width, height, board, glyphShare, onLayout},
  ref,
) {
  const inset = height * PAGE_MARGIN;
  const field = fitPitch({
    x: inset,
    y: inset,
    w: width - 2 * inset,
    h: height - 2 * inset,
  });
  const glyph = Math.round(pitchBreadth(field) * glyphShare);

  return (
    // collapsable={false}: Android may otherwise flatten this View away, and
    // react-native-view-shot needs a real native view to draw.
    <View
      ref={ref}
      collapsable={false}
      onLayout={onLayout}
      style={[styles.sheet, {width, height}]}
      pointerEvents="none">
      <View style={[styles.abs, {left: field.x, top: field.y}]}>
        <FieldMarkings
          width={field.w}
          height={field.h}
          landscape={field.landscape}
        />
      </View>
      {board.placed.map(p => {
        const def = PIECES_BY_ID.get(p.id);
        if (!def) {
          return null;
        }
        const c = fromFieldFraction(p, field);
        return (
          <View
            key={p.id}
            style={[
              styles.abs,
              {
                left: c.x - glyph / 2,
                top: c.y - glyph / 2,
                width: glyph,
                height: glyph,
              },
            ]}>
            <PieceGlyph kind={def.kind} size={glyph} />
          </View>
        );
      })}
    </View>
  );
});

export default ExportSheet;

const styles = StyleSheet.create({
  sheet: {position: 'absolute', left: 0, top: 0, backgroundColor: PAPER},
  abs: {position: 'absolute'},
});
