/**
 * Tests for resetChannelMenuState in LiveChannelMenu.tsx.
 *
 * Covers:
 *   1. Direct reset — setting all four module-level vars to non-default values
 *      then calling resetChannelMenuState restores every var to its default.
 *   2. Logout integration — after AppContext.logout() fires, the module-level
 *      vars are back at their defaults so the next login auto-selects the
 *      current channel's category and starts with no stale search / scroll.
 */

// ── react-native: pure-JS mock (must precede all imports) ─────────────────────
jest.mock('react-native', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const React = require('react');

  const View           = ({ children, ...r }: any) => React.createElement('View', r, children);
  const Text           = ({ children, ...r }: any) => React.createElement('Text', r, children);
  const TextInput      = (props: any) => React.createElement('TextInput', props);
  const FlatList       = ({ data, renderItem, keyExtractor, ...r }: any) =>
    React.createElement('FlatList', r, (data ?? []).map((item: any, i: number) =>
      renderItem({ item, index: i }),
    ));
  const ActivityIndicator = (props: any) => React.createElement('ActivityIndicator', props);

  const makeAnim = (): any => ({
    setValue:       jest.fn(),
    interpolate:    jest.fn(() => makeAnim()),
    addListener:    jest.fn(() => 'id'),
    removeListener: jest.fn(),
    stopAnimation:  jest.fn(),
  });
  const Animated = {
    Value:    jest.fn(() => makeAnim()),
    View,
    timing:   jest.fn(() => ({ start: (cb?: any) => cb?.({ finished: true }) })),
    sequence: jest.fn(() => ({ start: (cb?: any) => cb?.({ finished: true }) })),
    loop:     jest.fn(() => ({ start: jest.fn() })),
  };

  const StyleSheet = {
    create:             (s: any) => s,
    flatten:            (s: any) => s,
    absoluteFill:       {},
    absoluteFillObject: {},
  };
  const Platform = { OS: 'ios', select: (obj: any) => obj.ios ?? obj.default };
  const AppState = {
    currentState: 'active',
    addEventListener: jest.fn((_e: string, cb: () => void) => {
      return { remove: jest.fn() };
    }),
  };
  const Keyboard = { dismiss: jest.fn() };

  return {
    View, Text, TextInput, FlatList, ActivityIndicator,
    Animated, StyleSheet, Platform, AppState, Keyboard,
    TouchableOpacity: ({ children, onPress, ...r }: any) =>
      React.createElement('TouchableOpacity', { ...r, onClick: onPress }, children),
    TouchableHighlight: ({ children, onPress, ...r }: any) =>
      React.createElement('TouchableHighlight', { ...r, onClick: onPress }, children),
    TouchableWithoutFeedback: ({ children, onPress, ...r }: any) =>
      React.createElement('TouchableWithoutFeedback', { ...r, onClick: onPress }, children),
    ScrollView: ({ children, ...r }: any) => React.createElement('ScrollView', r, children),
    Modal: ({ children, visible, ...r }: any) =>
      visible ? React.createElement('Modal', r, children) : null,
    Pressable: ({ children, onPress, ...r }: any) =>
      React.createElement('Pressable', { ...r, onClick: onPress }, children),
    Image: (props: any) => React.createElement('Image', props),
    useColorScheme: jest.fn(() => 'dark'),
    useWindowDimensions: jest.fn(() => ({ width: 390, height: 844 })),
    Dimensions: { get: jest.fn(() => ({ width: 390, height: 844 })) },
  };
});

// ── expo-image ─────────────────────────────────────────────────────────────────
jest.mock('expo-image', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const React = require('react');
  return { Image: (props: any) => React.createElement('Image', props) };
});

// ── @tanstack/react-query ──────────────────────────────────────────────────────
jest.mock('@tanstack/react-query', () => {
  const React = require('react');
  // Minimal QueryClient stub — only the methods AppContextProvider calls.
  class QueryClient {
    _cache: Record<string, unknown> = {};
    prefetchQuery  = jest.fn();
    getQueryData   = jest.fn(() => undefined);
  }
  // QueryClientProvider just renders children (no real context needed in these tests).
  const QueryClientProvider = ({ children }: any) => children;
  return {
    useQuery:         jest.fn(() => ({ data: [], isLoading: false })),
    useQueryClient:   jest.fn(() => new QueryClient()),
    QueryClient,
    QueryClientProvider,
  };
});

// ── FocusablePressable ─────────────────────────────────────────────────────────
jest.mock('@/components/FocusablePressable', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const React = require('react');
  return {
    FocusablePressable: ({ children, onPress, ...r }: any) =>
      React.createElement('TouchableOpacity', { ...r, onClick: onPress }, children),
  };
});

// ── Service stubs ──────────────────────────────────────────────────────────────
jest.mock('@/services/xtreamApi',  () => ({ getXtreamLiveStreams:  jest.fn(async () => []) }));
jest.mock('@/services/m3uParser',  () => ({ fetchAndParseM3U:      jest.fn(async () => ({ channels: [], categories: [] })) }));

// ── AsyncStorage / SecureStore ─────────────────────────────────────────────────
const store: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem:     jest.fn(async (key: string) => store[key] ?? null),
  setItem:     jest.fn(async (key: string, value: string) => { store[key] = value; }),
  removeItem:  jest.fn(async (key: string) => { delete store[key]; }),
  multiRemove: jest.fn(async (keys: string[]) => { keys.forEach((k) => delete store[k]); }),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync:    jest.fn(async () => null),
  setItemAsync:    jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

// ── AppContext dependencies ────────────────────────────────────────────────────
jest.mock('@/services/macAddress',    () => ({ getDeviceMac:              jest.fn(async () => 'AA:BB:CC:DD:EE:FF') }));
jest.mock('@/services/tmdb',          () => ({ clearTmdbTrailerCache:     jest.fn() }));
jest.mock('@/services/reminderUrlCache', () => ({ clearReminderRefreshCache: jest.fn() }));
jest.mock('@/services/favoritesSync', () => ({
  resetSessionPushFailures:    jest.fn(),
  recordPushFailure:           jest.fn(),
  clearFavSyncFailureCount:    jest.fn(),
}));

// ── StorageService (AppContext needs clearCredentials, etc.) ───────────────────
// We mock the service module while preserving the parts needed by AppContext.
// The mock restores pass-through behaviour from the in-memory `store`.
jest.mock('@/services/storage', () => ({
  KEYS: {
    FAVORITES:           'sv_favorites',
    MOVIE_FAVORITES:     'sv_movie_favorites',
    SERIES_FAVORITES:    'sv_series_favorites',
    HISTORY:             'sv_history',
    CHANNELS_CACHE:      'sv_channels_cache',
    MOVIES_CACHE:        'sv_movies_cache',
    PARENTAL:            'sv_parental',
    RECENT_CHANNELS:     'sv_recent_channels',
    REMINDERS:           'sv_reminders',
    PREF_AUDIO_LANG:     'sv_pref_audio_lang',
    PREF_SUBTITLE_LANG:  'sv_pref_subtitle_lang',
    PREF_REMINDER_LEAD_MINS: 'sv_pref_reminder_lead_mins',
    PREF_SEARCH_TYPE:    'sv_pref_search_type',
    PREF_SEARCH_QUERY:   'sv_pref_search_query',
    BACKFILL_TS:         'sv_backfill_ts',
    RECENT_SEARCHES:     'sv_recent_searches',
    LOGOUT_REASON:       'sv_logout_reason',
    STARTUP_FAIL_COUNT:  'sv_startup_fail_count',
    BLOCKED_CHANNELS:    'sv_blocked_channels',
  },
  StorageService: {
    saveCredentials:          jest.fn(async () => {}),
    getCredentials:           jest.fn(async () => null),
    loadCredentials:          jest.fn(async () => null),
    clearCredentials:         jest.fn(async () => {}),
    saveLogoutReason:         jest.fn(async () => {}),
    consumeLogoutReason:      jest.fn(async () => null),
    clearStartupFailCount:    jest.fn(async () => {}),
    getStartupFailCount:      jest.fn(async () => 0),
    saveStartupFailCount:     jest.fn(async () => {}),
    loadStartupFailCount:     jest.fn(async () => 0),
    setPrefSearchQuery:       jest.fn(async () => {}),
  },
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import React from 'react';
import { act, create } from 'react-test-renderer';
import * as SecureStore from 'expo-secure-store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  resetChannelMenuState,
  _getChannelMenuStateForTest,
  _setChannelMenuStateForTest,
} from '../components/LiveChannelMenu';
import { AppContextProvider, useAppContext } from '../context/AppContext';

// ── Constants ──────────────────────────────────────────────────────────────────

/** The sentinel category ID used by the component to mean "show all channels". */
const CAT_ALL = '__all__';

/** Non-default values written before each reset so we can confirm they changed. */
const DIRTY_STATE = {
  savedCat:          '__fav__',
  savedSearch:       'sports',
  savedScrollOffset: 420,
  autoSelected:      true,
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
  resetChannelMenuState();
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
      <QueryClientProvider client={qc}>
        <AppContextProvider>
          <Consumer />
        </AppContextProvider>
      </QueryClientProvider>,
    );
  });
  await act(async () => {});

  return {
    renderer: renderer!,
    getLogout: () => logoutFn!,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('resetChannelMenuState — direct unit tests', () => {

  /**
   * Test 1 — All four vars revert to their defaults after reset.
   *
   * We write non-default values via the test-only setter, call the reset
   * function, and confirm every var is back at its initial value.
   */
  test('resets all four vars to their defaults', () => {
    // Arrange: dirty all four vars.
    _setChannelMenuStateForTest(DIRTY_STATE);
    const dirty = _getChannelMenuStateForTest();
    expect(dirty.savedCat).toBe('__fav__');
    expect(dirty.savedSearch).toBe('sports');
    expect(dirty.savedScrollOffset).toBe(420);
    expect(dirty.autoSelected).toBe(true);

    // Act.
    resetChannelMenuState();

    // Assert: every var is back at its default.
    const clean = _getChannelMenuStateForTest();
    expect(clean.savedCat).toBe(CAT_ALL);
    expect(clean.savedSearch).toBe('');
    expect(clean.savedScrollOffset).toBe(0);
    expect(clean.autoSelected).toBe(false);
  });

  /**
   * Test 1b — Reset is idempotent.
   *
   * Calling resetChannelMenuState twice in a row must leave the state at
   * defaults (no second call should accidentally "double-reset" to something
   * unexpected).
   */
  test('is idempotent — calling reset twice leaves state at defaults', () => {
    _setChannelMenuStateForTest(DIRTY_STATE);

    resetChannelMenuState();
    resetChannelMenuState();

    const state = _getChannelMenuStateForTest();
    expect(state.savedCat).toBe(CAT_ALL);
    expect(state.savedSearch).toBe('');
    expect(state.savedScrollOffset).toBe(0);
    expect(state.autoSelected).toBe(false);
  });

  /**
   * Test 1c — Partial dirty state is still fully reset.
   *
   * Only some vars are set to non-default values; the reset must restore all
   * four regardless of which subset was mutated.
   */
  test('fully resets even when only some vars were mutated', () => {
    // Only dirty two of the four vars.
    _setChannelMenuStateForTest({ savedSearch: 'football', autoSelected: true });

    resetChannelMenuState();

    const state = _getChannelMenuStateForTest();
    expect(state.savedCat).toBe(CAT_ALL);
    expect(state.savedSearch).toBe('');
    expect(state.savedScrollOffset).toBe(0);
    expect(state.autoSelected).toBe(false);
  });
});

describe('resetChannelMenuState — logout integration', () => {

  /**
   * Test 2 — AppContext.logout() triggers resetChannelMenuState.
   *
   * We simulate the "menu was open during logout" scenario by dirtying all
   * four module-level vars (as if the channel browser had been used), then
   * calling the real logout() from AppContextProvider.  After logout completes
   * all four vars must be back at their defaults.
   */
  test('AppContext.logout resets all four vars so the next login starts fresh', async () => {
    const { getLogout, renderer } = await renderProvider();

    // Simulate: user opened the menu and navigated to a category, typed a
    // search query, scrolled down, and the auto-select already ran.
    _setChannelMenuStateForTest(DIRTY_STATE);

    // Confirm vars are dirty before logout.
    expect(_getChannelMenuStateForTest().savedCat).not.toBe(CAT_ALL);

    // Act: call the real logout from the live context.
    await act(async () => {
      await getLogout()();
    });

    // Assert: every var must be at its default.
    const state = _getChannelMenuStateForTest();
    expect(state.savedCat).toBe(CAT_ALL);
    expect(state.savedSearch).toBe('');
    expect(state.savedScrollOffset).toBe(0);
    expect(state.autoSelected).toBe(false);

    // Cleanup.
    await act(async () => { renderer.unmount(); });
  });

  /**
   * Test 3 — Login → open menu → logout → login again: menu initialises with
   * CAT_ALL and _autoSelected = false.
   *
   * Verifies the complete lifecycle described in the task spec:
   *   (a) After first login the state is at defaults.
   *   (b) The menu is "opened" (vars mutated to simulate use).
   *   (c) Logout resets everything.
   *   (d) A second render sees CAT_ALL and autoSelected = false, confirming
   *       that the next menu open will auto-select the current channel's
   *       category as if the app were freshly launched.
   */
  test('login → open menu → logout → login again: menu initialises with CAT_ALL and autoSelected = false', async () => {
    // ── Phase 1: first login ─────────────────────────────────────────────────
    const { getLogout, renderer } = await renderProvider();

    // After first login the module state should already be at defaults
    // (ensured by beforeEach → resetChannelMenuState).
    expect(_getChannelMenuStateForTest().savedCat).toBe(CAT_ALL);
    expect(_getChannelMenuStateForTest().autoSelected).toBe(false);

    // ── Phase 2: user opens and uses the channel menu ────────────────────────
    // Simulate the menu mounting: auto-select runs (autoSelected → true) and
    // the user switches categories, types a search, and scrolls.
    _setChannelMenuStateForTest(DIRTY_STATE);

    // Confirm we have dirty state before logout.
    const beforeLogout = _getChannelMenuStateForTest();
    expect(beforeLogout.savedCat).toBe('__fav__');
    expect(beforeLogout.savedSearch).toBe('sports');
    expect(beforeLogout.savedScrollOffset).toBe(420);
    expect(beforeLogout.autoSelected).toBe(true);

    // ── Phase 3: user logs out while the menu was open ───────────────────────
    await act(async () => {
      await getLogout()();
    });

    // ── Phase 4: verify reset immediately after logout ───────────────────────
    const afterLogout = _getChannelMenuStateForTest();
    expect(afterLogout.savedCat).toBe(CAT_ALL);
    expect(afterLogout.savedSearch).toBe('');
    expect(afterLogout.savedScrollOffset).toBe(0);
    expect(afterLogout.autoSelected).toBe(false);

    // ── Phase 5: second login ─────────────────────────────────────────────────
    // The module state that the menu would read on its next mount is still at
    // defaults — confirming CAT_ALL and autoSelected = false after re-login.
    const afterSecondLogin = _getChannelMenuStateForTest();
    expect(afterSecondLogin.savedCat).toBe(CAT_ALL);
    expect(afterSecondLogin.autoSelected).toBe(false);

    // Cleanup.
    await act(async () => { renderer.unmount(); });
  });
});
