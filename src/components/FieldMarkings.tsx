/**
 * A portrait football pitch drawn from plain Views: black lines on white, goals
 * at the top and the bottom.
 *
 * No SVG library, on purpose. Every native module a plugin adds has to be
 * compiled into its package, and borders plus `overflow: hidden` clipping are
 * enough for lines, circles and arcs.
 */
import React from 'react';
import {StyleSheet, View} from 'react-native';

import {CANVAS_METRES, PITCH} from '../board/geometry';
import {INK, NET, PAPER} from './palette';

interface Props {
  width: number;
  height: number;
}

type End = 'top' | 'bottom';

export default function FieldMarkings({width, height}: Props) {
  const s = width / CANVAS_METRES.w; // dp per metre
  const line = Math.max(3, Math.round(s * 0.3));
  const m = PITCH.margin;
  const cx = CANVAS_METRES.w / 2;
  const cy = CANVAS_METRES.h / 2;

  /** An axis-aligned outline, in metres. */
  const box = (x: number, y: number, w: number, h: number, fill?: string) => (
    <View
      style={[
        styles.abs,
        {
          left: x * s,
          top: y * s,
          width: w * s,
          height: h * s,
          borderWidth: line,
          backgroundColor: fill,
        },
      ]}
    />
  );

  /** A filled dot, centred on a point in metres. */
  const dot = (x: number, y: number) => {
    const d = Math.max(line * 2.5, 0.8 * s);
    return (
      <View
        style={[
          styles.abs,
          styles.dot,
          {left: x * s - d / 2, top: y * s - d / 2, width: d, height: d},
        ]}
      />
    );
  };

  /**
   * The part of a circle that falls inside a clip rectangle. Used for the
   * penalty arcs and the corner arcs: a whole ring, with a window over it.
   */
  const arc = (
    key: string,
    centre: {x: number; y: number},
    r: number,
    clip: {x: number; y: number; w: number; h: number},
  ) => (
    <View
      key={key}
      style={[
        styles.abs,
        styles.clip,
        {
          left: clip.x * s,
          top: clip.y * s,
          width: clip.w * s,
          height: clip.h * s,
        },
      ]}>
      <View
        style={[
          styles.abs,
          styles.ring,
          {
            left: (centre.x - r - clip.x) * s,
            top: (centre.y - r - clip.y) * s,
            width: 2 * r * s,
            height: 2 * r * s,
            borderRadius: r * s,
            borderWidth: line,
          },
        ]}
      />
    </View>
  );

  const renderEnd = (end: End) => {
    const top = end === 'top';
    const goalLine = top ? m : m + PITCH.length;
    const inward = top ? 1 : -1;
    const pa = PITCH.penaltyAreaDepth;
    const ga = PITCH.goalAreaDepth;
    const spotY = goalLine + inward * PITCH.penaltySpot;
    // How far the penalty arc bulges beyond the penalty area.
    const arcDepth = PITCH.circleRadius - (pa - PITCH.penaltySpot);

    return (
      <React.Fragment key={end}>
        {/* Goal: outside the line, lightly shaded so it reads as a net. */}
        {box(
          cx - PITCH.goalWidth / 2,
          top ? goalLine - PITCH.goalDepth : goalLine,
          PITCH.goalWidth,
          PITCH.goalDepth,
          NET,
        )}
        {box(
          cx - PITCH.penaltyAreaWidth / 2,
          top ? goalLine : goalLine - pa,
          PITCH.penaltyAreaWidth,
          pa,
        )}
        {box(
          cx - PITCH.goalAreaWidth / 2,
          top ? goalLine : goalLine - ga,
          PITCH.goalAreaWidth,
          ga,
        )}
        {dot(cx, spotY)}
        {arc(`${end}-d`, {x: cx, y: spotY}, PITCH.circleRadius, {
          x: cx - PITCH.circleRadius,
          y: top ? goalLine + pa : goalLine - pa - arcDepth,
          w: 2 * PITCH.circleRadius,
          h: arcDepth,
        })}
      </React.Fragment>
    );
  };

  const r = PITCH.cornerRadius;
  const left = m;
  const right = m + PITCH.width;
  const topLine = m;
  const bottomLine = m + PITCH.length;

  return (
    <View style={[styles.canvas, {width, height}]}>
      {box(m, m, PITCH.width, PITCH.length)}
      {/* Halfway line */}
      <View
        style={[
          styles.abs,
          styles.fill,
          {
            left: m * s,
            top: cy * s - line / 2,
            width: PITCH.width * s,
            height: line,
          },
        ]}
      />
      <View
        style={[
          styles.abs,
          styles.ring,
          {
            left: (cx - PITCH.circleRadius) * s,
            top: (cy - PITCH.circleRadius) * s,
            width: 2 * PITCH.circleRadius * s,
            height: 2 * PITCH.circleRadius * s,
            borderRadius: PITCH.circleRadius * s,
            borderWidth: line,
          },
        ]}
      />
      {dot(cx, cy)}
      {renderEnd('top')}
      {renderEnd('bottom')}
      {arc('c-tl', {x: left, y: topLine}, r, {x: left, y: topLine, w: r, h: r})}
      {arc('c-tr', {x: right, y: topLine}, r, {
        x: right - r,
        y: topLine,
        w: r,
        h: r,
      })}
      {arc('c-bl', {x: left, y: bottomLine}, r, {
        x: left,
        y: bottomLine - r,
        w: r,
        h: r,
      })}
      {arc('c-br', {x: right, y: bottomLine}, r, {
        x: right - r,
        y: bottomLine - r,
        w: r,
        h: r,
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {backgroundColor: PAPER, overflow: 'hidden'},
  abs: {position: 'absolute', borderColor: INK},
  fill: {backgroundColor: INK},
  dot: {backgroundColor: INK, borderRadius: 999},
  ring: {backgroundColor: 'transparent'},
  clip: {overflow: 'hidden'},
});
