/**
 * Module-level singleton that lets the Sidebar and per-screen BackHandlers
 * coordinate D-pad focus without prop-drilling or a React context.
 *
 * Usage:
 *   import { sidebarNav } from '@/lib/sidebarNav';
 *
 *   // In Sidebar (on mount):
 *   sidebarNav.focus = () => firstNavRef.current?.focus?.();
 *
 *   // In a screen BackHandler (when nothing left to pop):
 *   sidebarNav.focus(); return true;
 */
export const sidebarNav = {
  /**
   * Moves D-pad focus to the first sidebar nav item.
   * Overwritten by the Sidebar component on mount.
   */
  focus: (() => {}) as () => void,
  /**
   * Native node handle of the first sidebar nav item (TV only).
   * Set by the Sidebar on mount; rails pass it as `nextFocusLeft` on their
   * first card so pressing D-pad LEFT jumps straight to the nav menu.
   */
  handle: null as number | null,
};
