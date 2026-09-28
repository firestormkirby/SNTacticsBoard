/**
 * A blank pitch filling a page-shaped sheet, to be photographed as a page
 * background. Drawn underneath the panel, so making it never flashes on screen.
 */
import React, {forwardRef} from 'react';
import {StyleSheet, View} from 'react-native';

import {fitPitch} from '../page/pitchGeometry';
import {PAPER} from './colors';
import FieldMarkings from './FieldMarkings';

interface Props {
  width: number;
  height: number;
  onLayout: () => void;
}

/** Share of the page's short side left blank around the pitch. */
const MARGIN = 0.03;

const PitchSheet = forwardRef<View, Props>(function PitchSheet(
  {width, height, onLayout},
  ref,
) {
  const inset = Math.min(width, height) * MARGIN;
  const field = fitPitch({
    x: inset,
    y: inset,
    w: width - 2 * inset,
    h: height - 2 * inset,
  });
  return (
    // collapsable={false}: Android may otherwise flatten this View away, and
    // react-native-view-shot needs a real native view to draw.
    <View
      ref={ref}
      collapsable={false}
      onLayout={onLayout}
      pointerEvents="none"
      style={[styles.sheet, {width, height}]}>
      <View style={[styles.abs, {left: field.x, top: field.y}]}>
        <FieldMarkings
          width={field.w}
          height={field.h}
          landscape={field.landscape}
        />
      </View>
    </View>
  );
});

export default PitchSheet;

const styles = StyleSheet.create({
  sheet: {position: 'absolute', left: 0, top: 0, backgroundColor: PAPER},
  abs: {position: 'absolute'},
});
