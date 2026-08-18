/**
 * #399 — EPG filter state resets cleanly after logout.
 *
 * The TV Guide (guide.tsx) holds two filter values in a module-level store
 * (epgFilterState.ts) that is synced from React component state:
 *
 *   - selectedCat     — which category the user drilled into; null = picker.
 *   - favFilterActive — whether the Favourites-only channel filter is on.
 *
 * `resetEpgFilterState()` is called from AppContext.doLogout() so both vars
 * are reset to their defaults before the next login, regardless of whether
 * the screen component unmounts.
 *
 * Covers:
 *   1. Direct unit test — dirtying both vars then calling resetEpgFilterState
 *      restores every var to its default.
 *   2. Logout integration — after AppContext.logout() fires, the module-level
 *      vars are back at their defaults so the next login starts fresh with the
 *      category picker and the Favourites filter off.
 */

// ── react-native: minimal mock (must precede all imports) ─────────────────────
jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

// ── AsyncStorage / SecureStore ─────────────────────────────────────────────────
const store: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem:     jest.fn(async (k: string) => store[k] ?? null),
  setItem:     jest.fn(async (k: string, v: string) => { store[k] = v; }),
  removeItem:  jest.fn(async (k: string) => { delete store[k]; }),
  multiRemove: jest.fn(async (keys: string[]) => { keys.forEach((k) => delete store[k]); }),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync:    jest.fn(async () => null),
  setItemAsync:    jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

// ── AppContext dependencies ────────────────────────────────────────────────────
jest.mock('@/services/macAddress', () => ({
  getDeviceMac: jest.fn(async () => 'AA:BB:CC:DD:EE:FF'),
}));

jest.mock('@/services/tmdb', () => ({
  clearTmdbTrailerCache: jest.fn(),
}));

jest.mock('@/services/reminderUrlCache', () => ({
  clearReminderRefreshCache: jest.fn(),
}));

jest.mock('@/services/favoritesSync', () => ({
  resetSessionPushFailures: jest.fn(),
  recordPushFailure:        jest.fn(),
  clearFavSyncFailureCount: jest.fn(),
}));

jest.mock('@/components/LiveChannelMenu', () => ({
  resetChannelMenuState: jest.fn(),
}));

jest.mock('@/services/storage', () => ({
  StorageService: {
    saveCredentials:       jest.fn(async () => {}),
    getCredentials:        jest.fn(async () => null),
    clearCredentials:      jest.fn(async () => {}),
    saveLogoutReason:      jest.fn(async () => {}),
    clearStartupFailCount: jest.fn(async () => {}),
    getStartupFailCount:   jest.fn(async () => 0),
    saveStartupFailCount:  jest.fn(async () => {}),
    setPrefSearchQuery:    jest.fn(async () => {}),
    getFavorites:          jest.fn(async () => []),
  },
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import React from 'react';
import { act, create } from 'react-test-renderer';
import * as SecureStore from 'expo-secure-store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  resetEpgFilterState,
  _getEpgFilterStateForTest,
  _setEpgFilterStateForTest,
} from '../services/epgFilterState';
import { AppContextProvider, useAppContext } from '../context/AppContext';

// ── Constants ──────────────────────────────────────────────────────────────────

/** Non-default values that simulate a guide that was actively used. */
const DIRTY_STATE = {
  selectedCat:     'sports',
  favFilterActive: true,
} as const;

// ── Global test setup ──────────────────────────────────────────────────────────

// React 19 requires this flag so act() works in non-jsdom environments.
// @ts-ignore
global.IS_REACT_ACT_ENVIRONMENT = true;

// Silence "react-test-renderer is deprecated" React 19 noise.
const _origError = console.error;
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation((...args) => {
    if (typeof args[0] === 'string' && args[0].includes('react-test-renderer is deprecated')) return;
    _origError.call(console, ...args);
  });
});
afterAll(() => { (console.error as jest.Mock).mockRestore?.(); });

// ── Per-test setup ─────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(store).forEach((k) => delete store[k]);

  // No stored credentials → startup MAC check skipped.
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);

  // Default fetch → MAC active.
  global.fetch = jest.fn().mockResolvedValue({
    ok:   true,
    json: jest.fn().mockResolvedValue({ status: 'active' }),
  }) as unknown as typeof fetch;

  // Reset module-level state to defaults before each test so tests are isolated.
  resetEpgFilterState();
});

// ── Helper: render AppContextProvider and expose logout ────────────────────────

async function renderProvider() {
  let logoutFn: (() => Promise<void>) | null = null;

  function Consumer() {
    const ctx = useAppContext();
    logoutFn = ctx.logout;
    return null;
  }

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let renderer: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(
      React.createElement(QueryClientProvider, { client: qc },
        React.createElement(AppContextProvider, null,
          React.createElement(Consumer),
        ),
      ),
    );
  });
  await act(async () => {});

  return {
    renderer: renderer!,
    getLogout: () => logoutFn!,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('resetEpgFilterState — direct unit tests', () => {

  /**
   * Test 1 — Both vars revert to their defaults after reset.
   *
   * We write non-default values via the test-only setter, call the reset
   * function, and confirm every var is back at its initial value.
   */
  test('resets selectedCat and favFilterActive to defaults', () => {
    // Arrange: dirty both vars.
    _setEpgFilterStateForTest(DIRTY_STATE);
    const dirty = _getEpgFilterStateForTest();
    expect(dirty.selectedCat).toBe('sports');
    expect(dirty.favFilterActive).toBe(true);

    // Act.
    resetEpgFilterState();

    // Assert: every var is back at its default.
    const clean = _getEpgFilterStateForTest();
    expect(clean.selectedCat).toBeNull();
    expect(clean.favFilterActive).toBe(false);
  });

  /**
   * Test 1b — Reset is idempotent.
   */
  test('is idempotent — calling reset twice leaves state at defaults', () => {
    _setEpgFilterStateForTest(DIRTY_STATE);

    resetEpgFilterState();
    resetEpgFilterState();

    const state = _getEpgFilterStateForTest();
    expect(state.selectedCat).toBeNull();
    expect(state.favFilterActive).toBe(false);
  });

  /**
   * Test 1c — Partial dirty state is fully reset.
   */
  test('fully resets even when only one var was mutated', () => {
    _setEpgFilterStateForTest({ favFilterActive: true });

    resetEpgFilterState();

    const state = _getEpgFilterStateForTest();
    expect(state.selectedCat).toBeNull();
    expect(state.favFilterActive).toBe(false);
  });
});

describe('resetEpgFilterState — logout integration', () => {

  /**
   * Test 2 — AppContext.logout() triggers resetEpgFilterState.
   *
   * We simulate "the TV Guide was open with a non-default category and the
   * Favourites filter on" by dirtying both module-level vars (as if
   * GuideScreen's useEffect syncs had run), then calling the real logout()
   * from AppContextProvider.  After logout both vars must be at their defaults
   * so the next login starts with the category picker and the filter off.
   */
  test('AppContext.logout resets selectedCat and favFilterActive so the next login starts fresh', async () => {
    const { getLogout, renderer } = await renderProvider();

    // Simulate: user opened the guide, navigated to a category, and turned on
    // the Favourites filter — the useEffect syncs wrote these values.
    _setEpgFilterStateForTest(DIRTY_STATE);

    // Confirm vars are dirty before logout.
    expect(_getEpgFilterStateForTest().selectedCat).toBe('sports');
    expect(_getEpgFilterStateForTest().favFilterActive).toBe(true);

    // Act: call the real logout from the live context.
    await act(async () => {
      await getLogout()();
    });

    // Assert: every var must be at its default.
    const state = _getEpgFilterStateForTest();
    expect(state.selectedCat).toBeNull();
    expect(state.favFilterActive).toBe(false);

    // Cleanup.
    await act(async () => { renderer.unmount(); });
  });

  /**
   * Test 3 — Login → open guide → logout → login again: guide initialises
   * with selectedCat = null and favFilterActive = false.
   *
   * Verifies the complete lifecycle described in the task spec:
   *   (a) After first login the state is at defaults.
   *   (b) The guide is "used" (vars mutated to simulate GuideScreen syncs).
   *   (c) Logout resets everything.
   *   (d) The module-level state that GuideScreen would read on its next
   *       mount is at defaults, confirming no stale category or filter.
   */
  test('login → open guide → logout → login again: guide initialises at defaults', async () => {
    const { getLogout, renderer } = await renderProvider();

    // ── Phase 1: first login ─────────────────────────────────────────────────
    // beforeEach calls resetEpgFilterState(), so defaults are guaranteed.
    expect(_getEpgFilterStateForTest().selectedCat).toBeNull();
    expect(_getEpgFilterStateForTest().favFilterActive).toBe(false);

    // ── Phase 2: user opens the guide, picks a category, enables Favs ───────
    _setEpgFilterStateForTest(DIRTY_STATE);

    const beforeLogout = _getEpgFilterStateForTest();
    expect(beforeLogout.selectedCat).toBe('sports');
    expect(beforeLogout.favFilterActive).toBe(true);

    // ── Phase 3: user logs out while the guide was open ──────────────────────
    await act(async () => {
      await getLogout()();
    });

    // ── Phase 4: state is immediately reset after logout ─────────────────────
    const afterLogout = _getEpgFilterStateForTest();
    expect(afterLogout.selectedCat).toBeNull();
    expect(afterLogout.favFilterActive).toBe(false);

    // ── Phase 5: second login — the module-level state that GuideScreen
    //    reads via getEpgSelectedCat() / getEpgFavFilterActive() is at
    //    defaults, so GuideScreen's useState initializers produce defaults too.
    expect(_getEpgFilterStateForTest().selectedCat).toBeNull();
    expect(_getEpgFilterStateForTest().favFilterActive).toBe(false);

    // Cleanup.
    await act(async () => { renderer.unmount(); });
  });
});
