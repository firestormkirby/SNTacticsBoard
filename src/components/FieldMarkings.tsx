/**
 * A football pitch drawn from plain Views: black lines on white. Goals are at
 * the top and bottom, or with `landscape`, at the left and right.
 *
 * Every marking is laid out in portrait metres and then placed through
 * `place()`, which applies the quarter-turn for landscape. Boxes stay boxes and
 * circles stay circles, so nothing is drawn with a rotate transform, which
 * keeps lines crisp on e-ink and in the exported image.
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
  /** Goals at the left and right. The top goal goes to the left. */
  landscape?: boolean;
}

type End = 'top' | 'bottom';

interface Placed {
  left: number;
  top: number;
  width: number;
  height: number;
}

export default function FieldMarkings({
  width,
  height,
  landscape = false,
}: Props) {
  // dp per metre: the canvas's long side is always the pitch's length.
  const s = width / (landscape ? CANVAS_METRES.h : CANVAS_METRES.w);
  const line = Math.max(3, Math.round(s * 0.3));
  const m = PITCH.margin;
  const cx = CANVAS_METRES.w / 2;
  const cy = CANVAS_METRES.h / 2;

  /**
   * A rectangle in portrait metres -> dp on this canvas. In landscape the
   * portrait canvas is turned a quarter-turn anticlockwise.
   */
  const place = (x: number, y: number, w: number, h: number): Placed =>
    landscape
      ? {
          left: y * s,
          top: (CANVAS_METRES.w - x - w) * s,
          width: h * s,
          height: w * s,
        }
      : {left: x * s, top: y * s, width: w * s, height: h * s};

  /** An axis-aligned outline, in metres. */
  const box = (x: number, y: number, w: number, h: number, fill?: string) => (
    <View
      style={[
        styles.abs,
        place(x, y, w, h),
        {borderWidth: line, backgroundColor: fill},
      ]}
    />
  );

  /** A filled dot, centred on a point in metres. */
  const dot = (x: number, y: number) => {
    const d = Math.max(line * 2.5, 0.8 * s) / s; // metres
    return (
      <View
        style={[styles.abs, styles.dot, place(x - d / 2, y - d / 2, d, d)]}
      />
    );
  };

  /** A full circle outline, in metres. */
  const ring = (x: number, y: number, r: number) => (
    <View
      style={[
        styles.abs,
        styles.ring,
        place(x - r, y - r, 2 * r, 2 * r),
        {borderRadius: r * s, borderWidth: line},
      ]}
    />
  );

  /**
   * The part of a circle that falls inside a clip rectangle. Used for the
   * penalty arcs and the corner arcs: a whole ring, with a window over it.
   */
  const arc = (
    key: string,
    centre: {x: number; y: number},
    r: number,
    clip: {x: number; y: number; w: number; h: number},
  ) => {
    const window = place(clip.x, clip.y, clip.w, clip.h);
    const circle = place(centre.x - r, centre.y - r, 2 * r, 2 * r);
    return (
      <View key={key} style={[styles.abs, styles.clip, window]}>
        <View
          style={[
            styles.abs,
            styles.ring,
            {
              ...circle,
              left: circle.left - window.left,
              top: circle.top - window.top,
              borderRadius: r * s,
              borderWidth: line,
            },
          ]}
        />
      </View>
    );
  };

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
          place(m, cy - line / s / 2, PITCH.width, line / s),
        ]}
      />
      {ring(cx, cy, PITCH.circleRadius)}
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
