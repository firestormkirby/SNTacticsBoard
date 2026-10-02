/**
 * The ⓘ that hangs an explanation off a heading or a setting, as in
 * Modulanner's panel. The bubble itself is App's, which owns which topic is
 * open: one overlay rather than one per icon.
 */
import React from 'react';
import {Pressable, StyleSheet, Text} from 'react-native';
import type {StyleProp, ViewStyle} from 'react-native';

import {INK, PAPER} from './colors';
import {z, zb} from './scale';

/**
 * Bigger than the glyph: a pen tap on e-ink is less exact than a click, and
 * an overshoot should land in dead space, not on the control beside it.
 */
const HIT_SLOP = {top: 12, bottom: 12, left: 12, right: 12};

export default function InfoIcon({
  onPress,
  style,
}: {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      style={({pressed}) => [s.icon, pressed && s.iconPressed, style]}>
      {/* Inverted when pressed, not greyed: grey is often invisible on e-ink. */}
      {({pressed}) => <Text style={[s.text, pressed && s.textPressed]}>i</Text>}
    </Pressable>
  );
}

const s = StyleSheet.create({
  icon: {
    width: z(26),
    height: z(26),
    borderRadius: z(13),
    borderWidth: zb(2),
    borderColor: INK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPressed: {backgroundColor: INK},
  text: {
    fontSize: z(15),
    lineHeight: z(19),
    fontWeight: 'bold',
    fontStyle: 'italic',
    color: INK,
  },
  textPressed: {color: PAPER},
});
