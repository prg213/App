import { useCallback, useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';
import { useFocusEffect } from 'expo-router';

/**
 * #357: Shared hardware-back-button hook.
 *
 * Registers a BackHandler listener that is active ONLY while the enclosing
 * screen is focused (via useFocusEffect), so per-screen handlers never compete
 * with each other when their screen is in the background.
 *
 * The handler is kept in a ref internally, so callers do NOT need to memoize
 * it — the latest render's closure is always the one invoked, with no
 * re-subscription churn on state changes.
 *
 * BackHandler dispatch is LIFO: the most recently registered listener fires
 * first. Because focused screens (re-)register after the tab layout's global
 * catch-all, per-screen handlers always get first pick; returning `false`
 * propagates to the global handler (which focuses the sidebar).
 *
 * @param handler  Return `true` to consume the press, `false` to propagate.
 * @param enabled  Optional gate (default `true`) for handlers that should only
 *                 be active under some condition (e.g. a modal being visible,
 *                 live-mode only). When it flips to `true` the listener is
 *                 re-registered, moving it to the front of the LIFO queue.
 */
export function useBackHandler(handler: () => boolean, enabled: boolean = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () =>
        handlerRef.current(),
      );
      return () => sub.remove();
    }, [enabled]),
  );
}

/**
 * Variant for components that are NOT screens in a navigator (no navigation
 * context) or that must stay registered regardless of screen focus — e.g. the
 * tab layout's global catch-all. Uses a plain useEffect.
 */
export function useGlobalBackHandler(handler: () => boolean, enabled: boolean = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () =>
      handlerRef.current(),
    );
    return () => sub.remove();
  }, [enabled]);
}
