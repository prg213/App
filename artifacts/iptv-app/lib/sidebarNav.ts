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
import { findNodeHandle } from 'react-native';

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
  /**
   * Route name currently holding native focus. Content screens clear this
   * while focused so they can distinguish a category → sidebar exit from a
   * category → channel move.
   */
  focusedRoute: null as string | null,
  /**
   * The Home dashboard's RIGHT target candidates. They are registered by the
   * rails as their first cards mount and resolved in visual priority order.
   */
  homeRightCandidates: new Map<string, any>(),
  activeRoute: null as string | null,
  activeNode: null as any,

  applyHomeRightTarget() {
    if (this.activeRoute !== 'home' || !this.activeNode) return;
    const target =
      this.homeRightCandidates.get('recent') ??
      this.homeRightCandidates.get('cw') ??
      this.homeRightCandidates.get('movies') ??
      null;
    try {
      const selfHandle = findNodeHandle(this.activeNode);
      const targetHandle = target ? findNodeHandle(target) : null;
      if (selfHandle != null) {
        this.activeNode.setNativeProps({
          // With no content mounted yet, keep RIGHT on Home rather than
          // allowing Fire OS to choose an unrelated sidebar/content view.
          nextFocusRight: targetHandle ?? selfHandle,
        });
      }
    } catch {}
  },

  setActiveRoute(route: string | null, node: any | null) {
    this.activeRoute = route;
    this.activeNode = node;
    this.applyHomeRightTarget();
  },

  setHomeRightCandidate(row: 'recent' | 'cw' | 'movies', node: any | null) {
    if (node) this.homeRightCandidates.set(row, node);
    else this.homeRightCandidates.delete(row);
    this.applyHomeRightTarget();
  },

  clearHomeRightCandidates() {
    this.homeRightCandidates.clear();
    this.applyHomeRightTarget();
  },
};
