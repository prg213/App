import { Platform } from 'react-native';

/**
 * Reliably move D-pad focus to a native view on TV.
 *
 * Fire OS quirk: bare `ref.focus()` on a host component can silently no-op.
 * Toggling `hasTVPreferredFocus` via setNativeProps forces a native
 * requestFocus (the pattern proven in the player scrubber and sidebar nav).
 * The flag is cleared shortly after so a stale preferred-focus marker can't
 * hijack later focus changes or re-renders.
 */
export function requestTvFocus(node: any) {
  if (!node) return;
  try { node.focus?.(); } catch {}
  if (Platform.isTV) {
    try { node.setNativeProps?.({ hasTVPreferredFocus: true }); } catch {}
    setTimeout(() => {
      try { node.setNativeProps?.({ hasTVPreferredFocus: false }); } catch {}
    }, 250);
  }
}
