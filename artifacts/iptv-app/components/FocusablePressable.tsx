import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

export interface FocusablePressableProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /**
   * Style applied when the element receives D-pad / keyboard focus.
   * Pass an empty object `{}` to suppress the default cyan ring.
   * Defaults to a 2px #00E5FF border (matches the sidebar focus ring).
   */
  focusedStyle?: StyleProp<ViewStyle>;
}

/**
 * Drop-in replacement for Pressable and TouchableOpacity that adds reliable
 * D-pad / remote focus highlighting on Android TV and Amazon Fire OS.
 *
 * The Pressable style-callback `focused` prop does not fire on Fire OS; this
 * component uses onFocus/onBlur state which works on every platform.
 */
export function FocusablePressable({
  style,
  focusedStyle,
  onFocus,
  onBlur,
  children,
  ...props
}: FocusablePressableProps) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      focusable
      accessible
      {...props}
      style={[
        style,
        focused && (focusedStyle !== undefined ? focusedStyle : styles.defaultFocused),
      ] as StyleProp<ViewStyle>}
      onFocus={(e) => { setFocused(true); onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); onBlur?.(e); }}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  defaultFocused: {
    borderWidth: 2,
    borderColor: '#00E5FF',
  },
});
