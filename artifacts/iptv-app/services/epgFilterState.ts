/**
 * Module-level store for the EPG (TV Guide) filter state.
 *
 * Keeping these values at module level (rather than purely in React's useState)
 * has two benefits:
 *
 *   1. `resetEpgFilterState()` can be called from `doLogout` in AppContext so
 *      the next login always starts with the category picker and no Favourites
 *      filter, regardless of how React Navigation handles the guide's lifecycle.
 *
 *   2. The state is directly readable/writable by unit tests via the
 *      `_get*` / `_set*ForTest` helpers, enabling lightweight tests that do
 *      not need to mount the full 2 600-line GuideScreen component.
 *
 * GuideScreen and FullGuide initialise their useState from these values and
 * sync back via useEffect on every state change.
 */

// ── Module-level state ────────────────────────────────────────────────────────

/** Which category the user has drilled into; null = show the category picker. */
let _selectedCat: string | null = null;

/** Whether the Favourites-only channel filter is active. */
let _favFilterActive = false;

// ── Public API ────────────────────────────────────────────────────────────────

/** Called from doLogout — resets both vars so the next login starts fresh. */
export function resetEpgFilterState(): void {
  _selectedCat     = null;
  _favFilterActive = false;
}

export function getEpgSelectedCat(): string | null {
  return _selectedCat;
}

export function setEpgSelectedCat(v: string | null): void {
  _selectedCat = v;
}

export function getEpgFavFilterActive(): boolean {
  return _favFilterActive;
}

export function setEpgFavFilterActive(v: boolean): void {
  _favFilterActive = v;
}

// ── Test-only helpers (never imported outside __tests__) ─────────────────────

/** Returns a snapshot of both module-level values. */
export function _getEpgFilterStateForTest(): {
  selectedCat: string | null;
  favFilterActive: boolean;
} {
  return { selectedCat: _selectedCat, favFilterActive: _favFilterActive };
}

/**
 * Writes non-default values so tests can simulate a "dirty" guide state
 * without mounting any React components.
 */
export function _setEpgFilterStateForTest(v: {
  selectedCat?: string | null;
  favFilterActive?: boolean;
}): void {
  if ('selectedCat'     in v) _selectedCat     = v.selectedCat ?? null;
  if ('favFilterActive' in v) _favFilterActive  = v.favFilterActive ?? false;
}
