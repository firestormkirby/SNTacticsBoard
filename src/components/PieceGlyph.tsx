/**
 * How each piece looks. Shape carries all the meaning:
 *
 *   X  Team X player  two crossed bars
 *   O  Team O player  a ring with a white centre
 *   ▲  cone           a solid triangle
 *   ●  ball           a small solid disc
 *
 * Each glyph sits on a white halo, so a piece dropped on a pitch line stays
 * legible instead of merging into the black.
 */
import React from 'react';
import {StyleSheet, View} from 'react-native';

import type {PieceKind} from '../page/pieceShapes';
import {INK, PAPER} from './colors';

interface Props {
  kind: PieceKind;
  /** Edge of the square the glyph is drawn in, in dp. */
  size: number;
}

export default function PieceGlyph({kind, size}: Props) {
  const stroke = Math.max(4, Math.round(size * 0.17));
  const halo = Math.max(2, Math.round(size * 0.07));
  return (
    <View
      style={[styles.box, {width: size, height: size}]}
      pointerEvents="none">
      {kind === 'attacker' && <Cross size={size} stroke={stroke} halo={halo} />}
      {kind === 'defender' && <Ring size={size} stroke={stroke} halo={halo} />}
      {kind === 'cone' && <Cone size={size} halo={halo} />}
      {kind === 'ball' && <Ball size={size} halo={halo} />}
    </View>
  );
}

type GlyphProps = {size: number; stroke: number; halo: number};

function Cross({size, stroke, halo}: GlyphProps) {
  const length = size * 1.05;
  const bar = (angle: string, thickness: number, color: string) => (
    <View
      key={`${angle}-${color}`}
      style={[
        styles.abs,
        {
          width: length + (color === PAPER ? 2 * halo : 0),
          height: thickness,
          borderRadius: thickness / 2,
          backgroundColor: color,
          transform: [{rotate: angle}],
        },
      ]}
    />
  );
  return (
    <>
      {bar('45deg', stroke + 2 * halo, PAPER)}
      {bar('-45deg', stroke + 2 * halo, PAPER)}
      {bar('45deg', stroke, INK)}
      {bar('-45deg', stroke, INK)}
    </>
  );
}

function Ring({size, stroke, halo}: GlyphProps) {
  const d = size * 0.86;
  return (
    <>
      <View
        style={[
          styles.abs,
          {
            width: d + 2 * halo,
            height: d + 2 * halo,
            borderRadius: d / 2 + halo,
            backgroundColor: PAPER,
          },
        ]}
      />
      <View
        style={[
          styles.abs,
          {
            width: d,
            height: d,
            borderRadius: d / 2,
            borderWidth: stroke,
            borderColor: INK,
            backgroundColor: PAPER,
          },
        ]}
      />
    </>
  );
}

/** Border-trick triangle: zero-size box, transparent sides, solid bottom. */
function triangle(w: number, h: number, color: string, offsetY = 0) {
  return (
    <View
      key={color}
      style={[
        styles.abs,
        styles.triangle,
        {
          borderLeftWidth: w / 2,
          borderRightWidth: w / 2,
          borderBottomWidth: h,
          borderBottomColor: color,
          transform: [{translateY: offsetY}],
        },
      ]}
    />
  );
}

function Cone({size, halo}: {size: number; halo: number}) {
  const w = size * 0.8;
  const h = size * 0.78;
  // The halo triangle is larger on every side; nudge it so its centroid
  // matches the black one.
  return (
    <>
      {triangle(w + 3 * halo, h + 3 * halo, PAPER, -halo * 0.25)}
      {triangle(w, h, INK)}
    </>
  );
}

function Ball({size, halo}: {size: number; halo: number}) {
  const d = size * 0.52;
  return (
    <View
      style={[
        styles.abs,
        {
          width: d + 2 * halo,
          height: d + 2 * halo,
          borderRadius: d / 2 + halo,
          borderWidth: halo,
          borderColor: PAPER,
          backgroundColor: INK,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  box: {alignItems: 'center', justifyContent: 'center'},
  abs: {position: 'absolute'},
  triangle: {
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
