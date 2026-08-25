/**
 * Module-level singleton that lets the Sidebar and per-screen BackHandlers
 * coordinate D-pad focus without prop-drilling or a React context.
 *
 * The native focus behaviour remains backward-compatible, but every active
 * sidebar/content target is now also published to the global Fire TV focus
 * registry so there is one source of truth for focus ownership.
 */
import { findNodeHandle } from 'react-native';
import {
  registerLegacyTvFocus,
  setLegacyTvFocus,
  unregisterLegacyTvFocus,
} from '@/lib/fireTvNavigationCompat';

const SIDEBAR_FOCUS_ID = 'global:sidebar:first';

export const sidebarNav = {
  /**
   * Moves D-pad focus to the first sidebar nav item.
   * Overwritten by the Sidebar component on mount.
   */
  focus: (() => {}) as () => void,

  /** Native node handle of the first sidebar nav item (TV only). */
  handle: null as number | null,

  /** Route name currently holding native focus. */
  focusedRoute: null as string | null,

  /** Home dashboard RIGHT target candidates. */
  homeRightCandidates: new Map<string, any>(),
  activeRoute: null as string | null,
  activeNode: null as any,

  /** Register the global sidebar focus target. */
  setHandle(node: any | null) {
    this.handle = node ? findNodeHandle(node) : null;
    if (this.handle != null) {
      registerLegacyTvFocus(SIDEBAR_FOCUS_ID, 'sidebar', this.handle);
    } else {
      unregisterLegacyTvFocus(SIDEBAR_FOCUS_ID);
    }
  },

  /**
   * Moves focus to the sidebar and records that ownership globally.
   * Existing Sidebar components can continue to overwrite `focus`; this
   * wrapper makes the global focus state update automatic when it is called.
   */
  focusAndTrack() {
    this.focus();
    if (this.handle != null) setLegacyTvFocus(SIDEBAR_FOCUS_ID);
  },

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
          nextFocusRight: targetHandle ?? selfHandle,
        });
      }
    } catch {}
  },

  setActiveRoute(route: string | null, node: any | null) {
    if (this.activeRoute && this.activeNode) {
      const previousId = `legacy:${this.activeRoute}:active`;
      unregisterLegacyTvFocus(previousId);
    }

    this.activeRoute = route;
    this.activeNode = node;

    if (route && node) {
      const nodeHandle = findNodeHandle(node);
      if (nodeHandle != null) {
        registerLegacyTvFocus(`legacy:${route}:active`, 'content', nodeHandle);
      }
    }

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
