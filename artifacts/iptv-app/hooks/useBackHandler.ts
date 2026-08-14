import { useCallback, useRef } from 'react';
import { BackHandler } from 'react-native';
import { useFocusEffect } from 'expo-router';

/**
 * Register a hardware-back handler that is ONLY active while this screen
 * is focused.  Uses useFocusEffect internally so it registers on screen
 * focus and unregisters on screen blur automatically.
 *
 * This replaces the common mistake of using plain useEffect with
 * BackHandler.addEventListener — plain useEffect leaves the handler active
 * on every screen simultaneously, causing silent cross-screen conflicts.
 *
 * The handler is stored in a ref so callers do not need to memoize it;
 * closing over the latest state/props always works.
 *
 * Handlers fire in LIFO order (most-recently-registered wins).  Return true
 * to consume the event; return false to let it propagate to the next handler
 * (ultimately the global sidebar fallback in the tab layout).
 *
 * @example
 *   useBackHandler(() => {
 *     if (modalOpen)  { closeModal(); return true; }
 *     if (filterOn)   { clearFilter(); return true; }
 *     return false; // let the global handler focus the sidebar
 *   });
 */
export function useBackHandler(handler: () => boolean): void {
  const handlerRef = useRef(handler);
  // Always keep the ref current so the registered callback below never goes stale.
  handlerRef.current = handler;

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener(
        'hardwareBackPress',
        () => handlerRef.current(),
      );
      return () => sub.remove();
    }, []),
  );
}
