import React, { forwardRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

type StyleValue = StyleProp<ViewStyle> | ((focused: boolean) => StyleProp<ViewStyle>);

export interface FocusablePressableProps extends Omit<PressableProps, 'style'> {
  style?: StyleValue;
  /**
   * Style applied when the element receives D-pad / keyboard focus.
   * Pass an empty object `{}` to suppress the default cyan ring.
   * Defaults to a 2px #00E5FF border (matches the sidebar focus ring).
   *
   * Note: has no effect when `style` is a function — in that case the
   * function receives the `focused` boolean and is responsible for all
   * focus-dependent styling.
   */
  focusedStyle?: StyleProp<ViewStyle>;
  /**
   * TV / Fire OS D-pad routing: node handle of the element that should receive
   * focus when the user presses D-pad down from this element.
   * Obtain the handle with `findNodeHandle(ref.current)`.
   */
  nextFocusDown?: number | null;
  /** D-pad up routing — node handle, same convention as nextFocusDown. */
  nextFocusUp?: number | null;
  /** D-pad left routing — node handle, same convention as nextFocusDown. */
  nextFocusLeft?: number | null;
  /** D-pad right routing — node handle, same convention as nextFocusDown. */
  nextFocusRight?: number | null;
}

/**
 * Drop-in replacement for Pressable and TouchableOpacity that adds reliable
 * D-pad / remote focus highlighting on Android TV and Amazon Fire OS.
 *
 * The Pressable style-callback `focused` prop does not fire on Fire OS; this
 * component uses onFocus/onBlur state which works on every platform.
 *
 * Two usage patterns are supported:
 *
 * 1. Plain style + optional focusedStyle (original API — used by cards, guide, etc.)
 *    <FocusablePressable style={styles.card} focusedStyle={styles.ring}>
 *    A default 2px #00E5FF ring is applied when focusedStyle is omitted.
 *
 * 2. Style callback receiving the focus boolean (used by detail-page buttons):
 *    <FocusablePressable style={(focused) => [styles.btn, focused && styles.ring]}>
 *    The callback is called with true/false driven by onFocus/onBlur state;
 *    focusedStyle is ignored in this mode.
 */
export const FocusablePressable = forwardRef<View, FocusablePressableProps>(
  function FocusablePressable(
    { style, focusedStyle, onFocus, onBlur, children, ...props },
    ref,
  ) {
    const [focused, setFocused] = useState(false);

    const resolvedStyle: StyleProp<ViewStyle> = typeof style === 'function'
      ? style(focused)
      : [
          style,
          focused && (focusedStyle !== undefined ? focusedStyle : styles.defaultFocused),
        ] as StyleProp<ViewStyle>;

    return (
      <Pressable
        ref={ref}
        focusable
        accessible
        {...props}
        style={resolvedStyle}
        onFocus={(e) => { setFocused(true); onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); onBlur?.(e); }}
      >
        {children}
      </Pressable>
    );
  },
);

const styles = StyleSheet.create({
  defaultFocused: {
    borderWidth: 2,
    borderColor: '#00E5FF',
  },
});
