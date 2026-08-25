import React, { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { fireTvNavigation } from '@/lib/fireTvNavigationController';

type StyleValue = StyleProp<ViewStyle> | ((focused: boolean) => StyleProp<ViewStyle>);

export interface FocusablePressableProps extends Omit<PressableProps, 'style'> {
  style?: StyleValue;
  focusedStyle?: StyleProp<ViewStyle>;
  nextFocusDown?: number | null;
  nextFocusUp?: number | null;
  nextFocusLeft?: number | null;
  nextFocusRight?: number | null;
  /** Optional stable ID used by the global Fire TV focus registry. */
  tvFocusId?: string;
  /** Logical focus zone for global navigation bookkeeping. */
  tvFocusZone?: 'sidebar' | 'content' | 'modal' | 'player';
}

export const FocusablePressable = forwardRef<View, FocusablePressableProps>(
  function FocusablePressable(
    { style, focusedStyle, onFocus, onBlur, children, tvFocusId, tvFocusZone = 'content', ...props },
    ref,
  ) {
    const [focused, setFocused] = useState(false);
    const innerRef = useRef<View | null>(null);

    const { nextFocusUp, nextFocusDown, nextFocusLeft, nextFocusRight } = props;
    useEffect(() => {
      if (!Platform.isTV) return;
      const patch: Record<string, number> = {};
      if (typeof nextFocusUp === 'number') patch.nextFocusUp = nextFocusUp;
      if (typeof nextFocusDown === 'number') patch.nextFocusDown = nextFocusDown;
      if (typeof nextFocusLeft === 'number') patch.nextFocusLeft = nextFocusLeft;
      if (typeof nextFocusRight === 'number') patch.nextFocusRight = nextFocusRight;
      if (Object.keys(patch).length === 0) return;

      let cancelled = false;
      const apply = () => {
        if (cancelled) return;
        try { (innerRef.current as any)?.setNativeProps?.(patch); } catch {}
      };
      const frame = requestAnimationFrame(apply);
      const timer = setTimeout(apply, 100);
      return () => {
        cancelled = true;
        cancelAnimationFrame(frame);
        clearTimeout(timer);
      };
    }, [nextFocusUp, nextFocusDown, nextFocusLeft, nextFocusRight]);

    useEffect(() => {
      if (!Platform.isTV || !tvFocusId) return;
      const node = innerRef.current ? (require('react-native').findNodeHandle(innerRef.current) as number | null) : null;
      fireTvNavigation.register({ id: tvFocusId, zone: tvFocusZone, node });
      return () => fireTvNavigation.unregister(tvFocusId);
    }, [tvFocusId, tvFocusZone]);

    const forwardedRef = useRef(ref);
    forwardedRef.current = ref;

    const setRefs = useCallback((node: View | null) => {
      innerRef.current = node;
      const fwd = forwardedRef.current;
      if (typeof fwd === 'function') fwd(node);
      else if (fwd) (fwd as React.MutableRefObject<View | null>).current = node;
      if (Platform.isTV && tvFocusId) {
        const nodeHandle = node ? (require('react-native').findNodeHandle(node) as number | null) : null;
        fireTvNavigation.register({ id: tvFocusId, zone: tvFocusZone, node: nodeHandle });
      }
    }, [tvFocusId, tvFocusZone]);

    const resolvedStyle: StyleProp<ViewStyle> = typeof style === 'function'
      ? style(focused)
      : [style, focused && (focusedStyle !== undefined ? focusedStyle : styles.defaultFocused)] as StyleProp<ViewStyle>;

    return (
      <Pressable
        ref={setRefs}
        focusable
        accessible
        {...props}
        style={resolvedStyle}
        onFocus={(e) => {
          setFocused(true);
          if (Platform.isTV && tvFocusId) fireTvNavigation.setCurrent(tvFocusId);
          onFocus?.(e);
        }}
        onBlur={(e) => { setFocused(false); onBlur?.(e); }}
      >
        {children}
      </Pressable>
    );
  },
);

const styles = StyleSheet.create({
  defaultFocused: { borderWidth: 2, borderColor: '#00E5FF' },
});