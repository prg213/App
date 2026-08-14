import { useCallback, useRef } from 'react';
import { Platform, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

interface UseFocusRestoreOptions {
  /**
   * Milliseconds before triggering focus after screen/tab entry.
   * Default: 250.  Use a longer value (400) when the screen content
   * takes extra time to mount (e.g. FlatList with many items).
   */
  delay?: number;
  /**
   * Only restore focus on TV platforms.  Default: true.
   * Pass false if you need the hook to run on phones/tablets too.
   */
  tvOnly?: boolean;
}

export interface FocusRestoreResult {
  /**
   * Attach this ref to the first / default focusable element.
   * Used as the fallback when no item has been focused yet, or
   * after clearFocus() has been called (e.g. on category change).
   */
  firstRef: React.RefObject<View | null>;
  /**
   * Call from an item's onFocus handler to record that node as the
   * last-focused position.  On the next screen entry this node will
   * receive focus automatically.
   *
   * @example
   *   <FocusablePressable
   *     onFocus={() => markFocused(cardRef.current)}
   *   />
   */
  markFocused: (node: View | null) => void;
  /**
   * Reset the last-focused position so the next screen entry falls back
   * to firstRef.  Call this when the content changes enough that the
   * old focus position is no longer valid (e.g. category or search change).
   */
  clearFocus: () => void;
}

/**
 * Standardises the "restore D-pad focus on screen/tab return" pattern that
 * was previously copy-pasted into every screen with slightly different delays
 * and fallback logic.
 *
 * On every useFocusEffect (initial mount AND tab return) the hook fires a
 * single setTimeout that focuses:
 *   1. The last node recorded via markFocused()
 *   2. firstRef.current as the default fallback
 *
 * Safe no-op on phones/tablets when tvOnly is true (the default).
 *
 * @example
 *   const { firstRef, markFocused, clearFocus } = useFocusRestore();
 *
 *   // First/default focusable element:
 *   <FocusablePressable ref={firstRef as any} onFocus={() => markFocused(firstRef.current)} />
 *
 *   // Every other card:
 *   <FocusablePressable onFocus={() => markFocused(cardNode)} />
 *
 *   // When category changes, clear so focus falls back to firstRef:
 *   useEffect(() => { clearFocus(); }, [selectedCat]);
 */
export function useFocusRestore(
  opts: UseFocusRestoreOptions = {},
): FocusRestoreResult {
  const { delay = 250, tvOnly = true } = opts;

  const firstRef = useRef<View | null>(null);
  const lastRef  = useRef<View | null>(null);

  const markFocused = useCallback((node: View | null) => {
    lastRef.current = node;
  }, []);

  const clearFocus = useCallback(() => {
    lastRef.current = null;
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (tvOnly && !Platform.isTV) return;
      const target = lastRef.current ?? firstRef.current;
      const t = setTimeout(() => (target as any)?.focus?.(), delay);
      return () => clearTimeout(t);
    // delay and tvOnly are stable options — not runtime deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  return { firstRef, markFocused, clearFocus };
}
