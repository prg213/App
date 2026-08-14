import { useCallback, useRef } from 'react';
import { Platform, type View } from 'react-native';
import { useFocusEffect } from 'expo-router';

export interface FocusRestoreOptions {
  /** Delay before the imperative .focus() call (ms). Default 250. */
  delay?: number;
  /**
   * Optional externally-owned fallback ref (e.g. a Back button ref the screen
   * already uses for other imperative focus calls). When provided it is used
   * as `firstRef` instead of an internally created ref.
   */
  targetRef?: React.RefObject<View | null>;
  /** When true (default) the restore effect is a no-op off-TV. */
  tvOnly?: boolean;
}

export interface FocusRestore {
  /**
   * Node of the last D-pad-focused item. Screens may clear this manually
   * (e.g. when the category changes and the old card unmounts).
   */
  lastFocusedRef: React.MutableRefObject<View | null>;
  /** Fallback target focused when no item has been focused yet. */
  firstRef: React.RefObject<View | null>;
  /** Call from each item's onFocus with its View node. */
  markFocused: (node: View | null | undefined) => void;
  /**
   * Reset the last-focused position so the next screen entry falls back to
   * firstRef (e.g. when the category or search query changes).
   */
  clearFocus: () => void;
}

/**
 * #357: Shared TV D-pad focus-restoration hook.
 *
 * Encapsulates the pattern used across screens: remember the last
 * D-pad-focused item node; when the screen regains navigation focus, restore
 * focus to it after a short delay (the native view must be mounted and laid
 * out before .focus() works). Falls back to `firstRef` (e.g. the first
 * category item or a Back button) when nothing was focused yet.
 *
 * No-op on non-TV platforms — touch behaviour is unchanged.
 */
export function useFocusRestore(options: FocusRestoreOptions = {}): FocusRestore {
  const { delay = 250, targetRef, tvOnly = true } = options;
  const lastFocusedRef = useRef<View | null>(null);
  const internalFirstRef = useRef<View | null>(null);
  const firstRef = targetRef ?? internalFirstRef;

  const markFocused = useCallback((node: View | null | undefined) => {
    if (node) lastFocusedRef.current = node;
  }, []);

  const clearFocus = useCallback(() => {
    lastFocusedRef.current = null;
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (tvOnly && !Platform.isTV) return;
      const target = lastFocusedRef.current ?? firstRef.current;
      const t = setTimeout(() => (target as any)?.focus?.(), delay);
      return () => clearTimeout(t);
    }, [delay]),
  );

  return { lastFocusedRef, firstRef, markFocused, clearFocus };
}
