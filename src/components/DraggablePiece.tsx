/**
 * One draggable piece, driven by React Native's PanResponder.
 *
 * PanResponder ships inside React Native itself, so dragging needs no extra
 * native module in the plugin package, and it treats pen and finger alike.
 *
 * The piece moves with an Animated value while it is held, so a drag redraws
 * only this piece and not the whole board, which keeps e-ink refresh local. On
 * release the board decides where it belongs (see dropPiece) and the piece
 * snaps there straight away rather than after a re-render, so there is never a
 * frame of it jumping back to where it started.
 */
import React, {memo, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {Animated, PanResponder, StyleSheet} from 'react-native';

import type {Point} from '../board/geometry';
import type {PieceKind} from '../board/pieces';
import PieceGlyph from './PieceGlyph';

interface Props {
  id: string;
  kind: PieceKind;
  /** Where the piece rests, in board coordinates. */
  centre: Point;
  /** Touch target edge, in dp. */
  hit: number;
  glyph: number;
  /**
   * Resolve a drop at a board point; returns where the piece should settle.
   * `tapped` is true when the piece was touched and let go without moving.
   */
  onDrop: (id: string, centre: Point, tapped: boolean) => Point;
}

/** Movement below this, in dp, counts as a tap rather than a drag. */
const TAP_SLOP = 8;

function DraggablePiece({id, kind, centre, hit, glyph, onDrop}: Props) {
  const [held, setHeld] = useState(false);
  const topLeft = (c: Point) => ({x: c.x - hit / 2, y: c.y - hit / 2});

  const pos = useRef(new Animated.ValueXY(topLeft(centre))).current;
  /** Top-left at rest; the drag is measured from here. */
  const origin = useRef(topLeft(centre));

  // The responder is created once, so it reads live values through a ref.
  const live = useRef({id, hit, onDrop});
  live.current = {id, hit, onDrop};

  useLayoutEffect(() => {
    origin.current = {x: centre.x - hit / 2, y: centre.y - hit / 2};
    pos.setValue(origin.current);
  }, [centre.x, centre.y, hit, pos]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Keep the piece even if a parent would like the gesture.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => setHeld(true),
        onPanResponderMove: (_e, g) => {
          pos.setValue({
            x: origin.current.x + g.dx,
            y: origin.current.y + g.dy,
          });
        },
        onPanResponderRelease: (_e, g) => {
          const {hit: h} = live.current;
          const dropped = {
            x: origin.current.x + g.dx + h / 2,
            y: origin.current.y + g.dy + h / 2,
          };
          const tapped = Math.abs(g.dx) < TAP_SLOP && Math.abs(g.dy) < TAP_SLOP;
          const settled = live.current.onDrop(live.current.id, dropped, tapped);
          origin.current = {x: settled.x - h / 2, y: settled.y - h / 2};
          pos.setValue(origin.current);
          setHeld(false);
        },
        onPanResponderTerminate: () => {
          pos.setValue(origin.current);
          setHeld(false);
        },
      }),
    [pos],
  );

  return (
    <Animated.View
      {...responder.panHandlers}
      style={[
        styles.piece,
        {
          width: hit,
          height: hit,
          transform: pos.getTranslateTransform(),
        },
        held ? styles.held : styles.resting,
      ]}
      accessibilityRole="adjustable"
      accessibilityLabel={`${kind} ${id}`}>
      <PieceGlyph kind={kind} size={glyph} />
    </Animated.View>
  );
}

export default memo(DraggablePiece);

const styles = StyleSheet.create({
  piece: {
    position: 'absolute',
    left: 0,
    top: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Lift the piece being dragged above the others.
  held: {zIndex: 10},
  resting: {zIndex: 1},
});
