import { useCallback, useEffect, useRef } from 'react';
import { BackHandler, DeviceEventEmitter, Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';

// Fire OS builds do not consistently surface the remote BACK key through
// React Native's `hardwareBackPress` event. Some send it only through the
// react-native-tvos `onHWKeyEvent` emitter. Keep a single LIFO dispatcher so
// those raw events retain the same "most local overlay first" semantics as
// BackHandler instead of broadcasting the action to every mounted screen.
const tvBackHandlers: Array<() => boolean> = [];
let tvBackSubscription: { remove: () => void } | null = null;
let lastHandledBackAt = 0;

function ensureTvBackSubscription() {
  if (tvBackSubscription || !Platform.isTV) return;
  tvBackSubscription = DeviceEventEmitter.addListener('onHWKeyEvent', (event: {
    eventType?: string;
    eventKeyAction?: number;
  }) => {
    const eventType = event.eventType?.toLowerCase();
    // Key-up only prevents a held BACK key from dismissing multiple layers.
    if (!['back', 'backspace', 'escape'].includes(eventType ?? '') || event.eventKeyAction === 0) return;
    const now = Date.now();
    // Some Fire OS versions emit both onHWKeyEvent and hardwareBackPress for
    // the same physical press. Consume the duplicate after the first handler.
    if (now - lastHandledBackAt < 180) return;

    for (let i = tvBackHandlers.length - 1; i >= 0; i -= 1) {
      if (tvBackHandlers[i]()) {
        lastHandledBackAt = now;
        return;
      }
    }
  });
}

function releaseTvBackSubscriptionIfUnused() {
  if (tvBackHandlers.length !== 0 || !tvBackSubscription) return;
  tvBackSubscription.remove();
  tvBackSubscription = null;
}

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
      const invoke = () => {
        // Avoid handling the same physical Fire TV press through both event
        // systems. Returning true keeps BackHandler from falling through.
        if (Date.now() - lastHandledBackAt < 180) return true;
        const handled = handlerRef.current();
        if (handled) lastHandledBackAt = Date.now();
        return handled;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', invoke);

      if (Platform.isTV) {
        tvBackHandlers.push(invoke);
        ensureTvBackSubscription();
      }

      return () => {
        sub.remove();
        const index = tvBackHandlers.indexOf(invoke);
        if (index !== -1) tvBackHandlers.splice(index, 1);
        releaseTvBackSubscriptionIfUnused();
      };
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
