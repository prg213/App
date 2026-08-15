/**
 * Module-level store for the EPG (TV Guide) horizontal and vertical scroll
 * offsets.
 *
 * Keeping these values at module level (rather than purely in React refs)
 * allows `resetEpgScrollState()` to be called from `doLogout` in AppContext
 * without importing the full GuideScreen component tree — which would create
 * a circular dependency and pollute the test environment with UI imports.
 *
 * FullGuide reads these values to initialise its refs on mount and writes
 * them back via its onScroll handlers so the module-level store stays current.
 */

// ── Module-level state ────────────────────────────────────────────────────────

/** Horizontal (time-axis) scroll offset of the EPG grid, in pixels. */
let _epgScrollX = 0;

/** Vertical (channel-axis) scroll offset of the EPG grid, in pixels. */
let _epgScrollY = 0;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Resets both scroll offsets to zero.
 * Called from `doLogout` so the guide always opens at the current time slot
 * on the next login rather than restoring a stale position (#400).
 */
export function resetEpgScrollState(): void {
  _epgScrollX = 0;
  _epgScrollY = 0;
}

export function getEpgScrollX(): number {
  return _epgScrollX;
}

export function setEpgScrollX(v: number): void {
  _epgScrollX = v;
}

export function getEpgScrollY(): number {
  return _epgScrollY;
}

export function setEpgScrollY(v: number): void {
  _epgScrollY = v;
}
