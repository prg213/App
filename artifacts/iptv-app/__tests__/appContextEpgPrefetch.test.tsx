/**
 * Tests for the EPG prefetch behaviour in AppContextProvider.
 *
 * Renders the REAL AppContextProvider so a regression in the prefetch effect
 * (wrong query key, missing credentials type check, wrong staleTime) would
 * actually fail these tests.
 *
 * Covers:
 *   - Xtream credentials at startup immediately trigger queryClient.prefetchQuery
 *     with the key ['xmltv-epg', credentials] and staleTime: 30 * 60_000,
 *     without waiting for MAC verification to complete.
 *   - M3U credentials do NOT trigger a prefetch (no XMLTV feed available).
 */

// ── Mocks (must precede all imports) ──────────────────────────────────────────

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

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

jest.mock('@/services/macAddress', () => ({
  getDeviceMac: jest.fn(async () => 'AA:BB:CC:DD:EE:FF'),
}));

jest.mock('@/services/tmdb', () => ({
  clearTmdbTrailerCache: jest.fn(),
}));

jest.mock('@/services/reminderUrlCache', () => ({
  clearReminderRefreshCache: jest.fn(),
}));

// AppContext imports resetChannelMenuState from LiveChannelMenu; the real
// LiveChannelMenu transitively depends on expo-image and react-native UI
// primitives not available in the node test environment.  Stub it out.
jest.mock('@/components/LiveChannelMenu', () => ({
  resetChannelMenuState: jest.fn(),
  LiveChannelMenu: () => null,
}));

jest.mock('@/services/epgScrollState', () => ({
  resetEpgScrollState: jest.fn(),
}));

jest.mock('@/services/epgFilterState', () => ({
  resetEpgFilterState: jest.fn(),
  getEpgFavFilterActive: jest.fn(() => false),
  setEpgFavFilterActive: jest.fn(),
}));

jest.mock('@/services/favoritesSync', () => ({
  resetSessionPushFailures: jest.fn(),
}));

// Stub out the heavy EPG parser — we only care that prefetchQuery is called,
// not that the parser actually runs.
jest.mock('@/services/epgService', () => ({
  fetchAndParseXmltv: jest.fn(async () => new Map()),
}));

// Stub the URL builder; its return value is used inside the prefetch queryFn
// but we only need prefetchQuery to be invoked with the right arguments.
jest.mock('@/services/xtreamApi', () => ({
  getXtreamXmltvUrl: jest.fn(() => 'http://example.com/xmltv'),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import React from 'react';
import { act, create } from 'react-test-renderer';
import * as SecureStore from 'expo-secure-store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppContextProvider } from '../context/AppContext';

// ── Helpers ────────────────────────────────────────────────────────────────────

// React 19 requires this flag so act() works in non-jsdom environments.
// @ts-ignore
global.IS_REACT_ACT_ENVIRONMENT = true;

// Silence the "react-test-renderer is deprecated" React 19 noise.
const _origError = console.error;
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation((...args) => {
    if (typeof args[0] === 'string' && args[0].includes('react-test-renderer is deprecated')) return;
    _origError.call(console, ...args);
  });
});
afterAll(() => { (console.error as jest.Mock).mockRestore?.(); });

/**
 * Render AppContextProvider with a fresh QueryClient whose prefetchQuery is
 * already spied upon.  Returns the spy so callers can assert against it.
 */
async function renderWithCreds(credsObject: object): Promise<jest.SpyInstance> {
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
    JSON.stringify(credsObject),
  );

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const prefetchSpy = jest.spyOn(qc, 'prefetchQuery');

  await act(async () => {
    create(
      <QueryClientProvider client={qc}>
        <AppContextProvider>{null}</AppContextProvider>
      </QueryClientProvider>,
    );
  });
  // Flush remaining microtasks (Promise chains inside useEffect).
  await act(async () => {});

  return prefetchSpy;
}

// ── Test setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(store).forEach((k) => delete store[k]);

  // Default: MAC is still active so stored credentials are trusted at startup.
  global.fetch = jest.fn().mockResolvedValue({
    ok:   true,
    json: jest.fn().mockResolvedValue({ status: 'active' }),
  }) as unknown as typeof fetch;
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('AppContextProvider — EPG prefetch on startup', () => {

  /**
   * Test 1 — Xtream credentials trigger a prefetch.
   *
   * When valid Xtream credentials are present in SecureStore and the MAC check
   * succeeds, the startup effect must call queryClient.prefetchQuery with the
   * query key ['xmltv-epg', credentials] and staleTime: 30 * 60_000 — the
   * exact same values used by the Guide screen's useQuery so the cache is
   * pre-warmed and the Guide renders without a loading spinner on cold open.
   */
  test('prefetchQuery is called with the correct key and staleTime for Xtream credentials', async () => {
    const xtreamCreds = {
      type:     'xtream',
      host:     'http://example.com',
      username: 'user',
      password: 'pass',
    };

    const prefetchSpy = await renderWithCreds(xtreamCreds);

    expect(prefetchSpy).toHaveBeenCalledTimes(1);
    expect(prefetchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey:  ['xmltv-epg', xtreamCreds],
        staleTime: 30 * 60_000,
      }),
    );
  });

  test('starts the EPG prefetch before the startup MAC check finishes', async () => {
    const xtreamCreds = {
      type:     'xtream',
      host:     'http://example.com',
      username: 'user',
      password: 'pass',
    };
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
      JSON.stringify(xtreamCreds),
    );

    // Keep activation verification pending. The EPG request must still have
    // started — waiting here was the bug that made TV Guide download on demand.
    global.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof fetch;

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const prefetchSpy = jest.spyOn(qc, 'prefetchQuery');

    await act(async () => {
      create(
        <QueryClientProvider client={qc}>
          <AppContextProvider>{null}</AppContextProvider>
        </QueryClientProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(prefetchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['xmltv-epg', xtreamCreds],
      }),
    );
  });

  /**
   * Test 2 — M3U credentials do NOT trigger a prefetch.
   *
   * M3U playlists have no associated XMLTV feed, so the EPG prefetch effect
   * must be a no-op when credentials.type is 'm3u'.  Calling prefetchQuery
   * with an unresolvable queryFn would waste bandwidth and produce a dangling
   * error in the query cache.
   */
  test('prefetchQuery is NOT called for M3U credentials (no XMLTV feed)', async () => {
    const m3uCreds = {
      type:   'm3u',
      m3uUrl: 'http://example.com/playlist.m3u',
    };

    const prefetchSpy = await renderWithCreds(m3uCreds);

    expect(prefetchSpy).not.toHaveBeenCalled();
  });

  /**
   * Test 3 — No credentials stored → no prefetch.
   *
   * When the app starts without any stored credentials (fresh install or after
   * logout), the effect must not attempt to prefetch.
   */
  test('prefetchQuery is NOT called when no credentials are stored', async () => {
    // SecureStore already returns null by default (see beforeEach / jest.mock).
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const prefetchSpy = jest.spyOn(qc, 'prefetchQuery');

    await act(async () => {
      create(
        <QueryClientProvider client={qc}>
          <AppContextProvider>{null}</AppContextProvider>
        </QueryClientProvider>,
      );
    });
    await act(async () => {});

    expect(prefetchSpy).not.toHaveBeenCalled();
  });
});
