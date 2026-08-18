/**
 * Tests for the doLogout ordering guarantee in AppContextProvider.
 *
 * Renders the REAL AppContextProvider so that a regression in its doLogout
 * control flow (wrong order, missing guard) would actually fail these tests.
 *
 * Covers:
 *   - When the MAC check on startup fails (forced logout), saveLogoutReason is
 *     awaited BEFORE clearCredentials so the banner key survives the wipe.
 *   - When logout() is called without a reason (manual logout), saveLogoutReason
 *     is never called — no stale banner key is written.
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

// Capture the AppState listener so tests can fire AppState transitions.
let capturedAppStateListener: ((state: string) => Promise<void>) | null = null;

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn((_event: string, listener: (state: string) => Promise<void>) => {
      capturedAppStateListener = listener;
      return { remove: jest.fn() };
    }),
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
// primitives that are not available in the node test environment.  Stub it
// out so AppContextProvider can be imported and rendered cleanly.
jest.mock('@/components/LiveChannelMenu', () => ({
  resetChannelMenuState: jest.fn(),
  LiveChannelMenu: () => null,
}));

// epgScrollState / epgFilterState are imported by AppContext for reset on logout.
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

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import React, { useRef } from 'react';
import { act, create } from 'react-test-renderer';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppContextProvider, useAppContext } from '../context/AppContext';

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

type CallLog = string[];

/**
 * Install ordered-call tracking on top of the AsyncStorage mocks so that
 * every call to setItem (when key === sv_logout_reason) and multiRemove
 * appends a label to `log` in the order the awaits resolve.
 *
 * The default store pass-through is preserved.
 */
function instrumentStorageOrder(log: CallLog) {
  const setItem     = AsyncStorage.setItem     as jest.MockedFunction<typeof AsyncStorage.setItem>;
  const multiRemove = AsyncStorage.multiRemove as jest.MockedFunction<typeof AsyncStorage.multiRemove>;

  setItem.mockImplementation(async (key: string, value: string) => {
    if (key === 'sv_logout_reason') log.push('saveLogoutReason');
    store[key] = value;
  });

  multiRemove.mockImplementation(async (keys: readonly string[]) => {
    log.push('clearCredentials');
    keys.forEach((k) => delete store[k]);
  });
}

/**
 * Render AppContextProvider with a child that exposes the logout callback and
 * the credentials/isActivated state so tests can inspect them.
 *
 * Returns { renderer, getLogout, getIsActivated }.
 */
async function renderProvider() {
  let logoutFn: (() => Promise<void>) | null = null;
  let isActivatedVal = false;

  function Consumer() {
    const ctx = useAppContext();
    // Keep references fresh on every render.
    logoutFn       = ctx.logout;
    isActivatedVal = ctx.isActivated;
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
  // Flush remaining microtasks (Promise chains inside useEffect).
  await act(async () => {});

  return {
    renderer: renderer!,
    getLogout:      () => logoutFn!,
    getIsActivated: () => isActivatedVal,
  };
}

// ── Test setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(store).forEach((k) => delete store[k]);
  capturedAppStateListener = null;

  // Default: no stored credentials, MAC active.
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  global.fetch = jest.fn().mockResolvedValue({
    ok:   true,
    json: jest.fn().mockResolvedValue({ status: 'active' }),
  }) as unknown as typeof fetch;

  // Restore default AsyncStorage pass-throughs after clearAllMocks.
  (AsyncStorage.getItem as jest.Mock).mockImplementation(
    async (key: string) => store[key] ?? null,
  );
  (AsyncStorage.setItem as jest.Mock).mockImplementation(
    async (key: string, value: string) => { store[key] = value; },
  );
  (AsyncStorage.removeItem as jest.Mock).mockImplementation(
    async (key: string) => { delete store[key]; },
  );
  (AsyncStorage.multiRemove as jest.Mock).mockImplementation(
    async (keys: string[]) => { keys.forEach((k) => delete store[k]); },
  );
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('AppContextProvider — doLogout ordering', () => {

  /**
   * Test 1 — Forced logout via sustained MAC check failures:
   *
   * A single startup failure no longer immediately deactivates the session
   * (#257 — cold-start hiccup protection).  Deactivation only happens after
   * MAX_CONSECUTIVE_MAC_FAILURES (5) failures across the startup + foreground
   * paths.  This test confirms that once the threshold IS reached,
   * saveLogoutReason is still awaited BEFORE clearCredentials.
   */
  test('saveLogoutReason is called before clearCredentials when the failure threshold is reached', async () => {
    // Credentials present in SecureStore so the startup check runs.
    const fakeCreds = JSON.stringify({
      url:      'http://example.com',
      username: 'user',
      password: 'pass',
    });
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(fakeCreds);

    // All fetch calls (startup + 4 foreground) report MAC inactive.
    global.fetch = jest.fn().mockResolvedValue({
      ok:   true,
      json: jest.fn().mockResolvedValue({ status: 'inactive' }),
    }) as unknown as typeof fetch;

    const callLog: CallLog = [];
    instrumentStorageOrder(callLog);

    // Startup: counter → 1, user stays logged in (below threshold).
    await renderProvider();

    // 4 more foreground 'active' events → counter reaches 5 → doLogout.
    for (let i = 0; i < 4; i++) {
      await act(async () => { await capturedAppStateListener!('active'); });
      await act(async () => {});
    }

    // Both calls must have happened and in the correct order.
    expect(callLog).toContain('saveLogoutReason');
    expect(callLog).toContain('clearCredentials');
    expect(callLog.indexOf('saveLogoutReason')).toBeLessThan(
      callLog.indexOf('clearCredentials'),
    );
  });

  /**
   * Test 2 — Manual logout (no reason):
   *
   * The public logout() callback calls doLogout() without a reason.
   * The `if (reason)` guard in doLogout must prevent saveLogoutReason from
   * being called; only clearCredentials should run.
   */
  test('saveLogoutReason is NOT called when the user triggers a manual logout', async () => {
    const callLog: CallLog = [];
    instrumentStorageOrder(callLog);

    // No credentials → startup check skipped; component mounts cleanly.
    const { getLogout } = await renderProvider();

    // Call the real logout() from the live context.
    await act(async () => {
      await getLogout()();
    });

    expect(callLog).not.toContain('saveLogoutReason');
    expect(callLog).toContain('clearCredentials');
  });

  /**
   * Test 3 — Banner key survives clearCredentials (storage invariant):
   *
   * sv_logout_reason is intentionally absent from clearCredentials' multiRemove
   * list so the key written by saveLogoutReason persists past the credential
   * wipe and is readable by the activation screen.
   *
   * Requires 5 total failures to reach the threshold (#257).
   */
  test('banner key written before forced logout survives the credential wipe', async () => {
    const fakeCreds = JSON.stringify({
      url:      'http://example.com',
      username: 'user',
      password: 'pass',
    });
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(fakeCreds);

    // All fetch calls (startup + 4 foreground) report MAC inactive.
    global.fetch = jest.fn().mockResolvedValue({
      ok:   true,
      json: jest.fn().mockResolvedValue({ status: 'inactive' }),
    }) as unknown as typeof fetch;

    // Startup: counter → 1, user stays logged in (below threshold).
    await renderProvider();

    // 4 more foreground events → counter reaches 5 → doLogout('deactivated').
    for (let i = 0; i < 4; i++) {
      await act(async () => { await capturedAppStateListener!('active'); });
      await act(async () => {});
    }

    // sv_logout_reason must still be present after credentials were cleared.
    expect(store['sv_logout_reason']).toBe('deactivated');
  });

  /**
   * Test 3b — Single startup MAC failure does NOT log the user out (#257):
   *
   * A transient server blip at cold-start (one inactive response) must not
   * force a logout.  The shared consecutiveMacFailRef counter is at 1, below
   * the threshold of 5, so isActivated must remain true after startup.
   */
  test('a single inactive response at startup does NOT log the user out', async () => {
    const fakeCreds = JSON.stringify({
      url:      'http://example.com',
      username: 'user',
      password: 'pass',
    });
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(fakeCreds);

    // Startup check returns inactive once — counter → 1, below threshold of 5.
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok:   true,
      json: jest.fn().mockResolvedValue({ status: 'inactive' }),
    }) as unknown as typeof fetch;

    // renderProvider handles act() wrapping and microtask flushing.
    const { getIsActivated } = await renderProvider();
    // One extra flush in case the new code path (setCredentials/setIsActivated
    // inside the else branch) schedules updates in a subsequent microtask batch.
    await act(async () => {});

    // Counter is 1 (below threshold of 5) — user must still be activated.
    expect(getIsActivated()).toBe(true);
    // No logout reason written to storage.
    expect(store['sv_logout_reason']).toBeUndefined();
  });

  /**
   * Test 4 — No banner key written after a manual logout:
   *
   * After a voluntary logout, sv_logout_reason must not exist in storage so
   * the activation screen does not incorrectly show the admin-removal banner.
   */
  test('no banner key is written when the user logs out voluntarily', async () => {
    const { getLogout } = await renderProvider();

    await act(async () => {
      await getLogout()();
    });

    expect(store['sv_logout_reason']).toBeUndefined();
  });
});

// ── Consecutive MAC failure counter (#190) ─────────────────────────────────────

describe('AppContextProvider — consecutive MAC failure counter', () => {
  const FAKE_CREDS = JSON.stringify({
    url:      'http://example.com',
    username: 'user',
    password: 'pass',
  });

  // Track the most-recently rendered provider so afterEach can unmount it,
  // which triggers the useEffect cleanup and clears the setInterval handle.
  let currentRenderer: ReturnType<typeof import('react-test-renderer').create> | null = null;

  afterEach(async () => {
    if (currentRenderer) {
      await act(async () => { currentRenderer!.unmount(); });
      currentRenderer = null;
    }
  });

  /**
   * Renders the provider with credentials already stored so the startup MAC
   * check succeeds and isActivated becomes true.
   * The first fetch call (startup) returns 'active'; subsequent calls are
   * controlled per-test via `fireForegrounded`.
   */
  async function renderActivatedProvider() {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(FAKE_CREDS);

    // Startup fetch → MAC still active so the user is logged in.
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok:   true,
      json: jest.fn().mockResolvedValue({ status: 'active' }),
    });

    const { renderer, getIsActivated } = await renderProvider();
    currentRenderer = renderer;
    return { renderer, getIsActivated };
  }

  type ForegroundResult = 'active' | 'inactive' | 'network-error' | 'server-error';

  /**
   * Simulates the app returning to the foreground.
   *
   * 'active' / 'inactive' — server responds OK with the given status.
   * 'network-error'        — fetch rejects (connection refused, timeout, etc.).
   * 'server-error'         — server responds with a non-OK HTTP status.
   *
   * isMacStillRegistered silently returns true for the latter two so they
   * must never count against the deactivation counter.
   */
  async function fireForegrounded(result: ForegroundResult) {
    switch (result) {
      case 'network-error':
        (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network request failed'));
        break;
      case 'server-error':
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
        break;
      default:
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok:   true,
          json: jest.fn().mockResolvedValue({ status: result }),
        });
    }
    await act(async () => { await capturedAppStateListener!('active'); });
    // Flush any remaining microtasks queued inside the listener.
    await act(async () => {});
  }

  /**
   * Test A — 4 consecutive server-confirmed deactivations do NOT log the user out.
   *
   * The threshold is 5; the user must remain activated after 4 back-to-back
   * inactive responses.
   */
  test('4 consecutive MAC deactivation responses do NOT log the user out', async () => {
    const { getIsActivated } = await renderActivatedProvider();
    expect(getIsActivated()).toBe(true);

    for (let i = 0; i < 4; i++) {
      await fireForegrounded('inactive');
    }

    expect(getIsActivated()).toBe(true);
  });

  /**
   * Test B — A single success between failures resets the counter.
   *
   * 4 failures → 1 success → 4 more failures must still keep the user logged
   * in because the success zeroed the streak.
   */
  test('a success resets the failure counter so a new streak of 4 still keeps the user in', async () => {
    const { getIsActivated } = await renderActivatedProvider();
    expect(getIsActivated()).toBe(true);

    // 4 consecutive failures — not yet at the threshold.
    for (let i = 0; i < 4; i++) {
      await fireForegrounded('inactive');
    }
    expect(getIsActivated()).toBe(true);

    // One success — counter must be reset to 0.
    await fireForegrounded('active');
    expect(getIsActivated()).toBe(true);

    // 4 more failures after the reset — counter is back to 4, still under 5.
    for (let i = 0; i < 4; i++) {
      await fireForegrounded('inactive');
    }

    expect(getIsActivated()).toBe(true);
  });

  /**
   * Test C — 5 back-to-back server-confirmed deactivations DO trigger logout.
   *
   * After 5 consecutive inactive responses the provider must call doLogout
   * and isActivated must flip to false.
   */
  test('5 consecutive MAC deactivation responses trigger logout', async () => {
    const { getIsActivated } = await renderActivatedProvider();
    expect(getIsActivated()).toBe(true);

    for (let i = 0; i < 5; i++) {
      await fireForegrounded('inactive');
    }

    expect(getIsActivated()).toBe(false);
  });

  /**
   * Test D — A fetch rejection (brief network drop) does NOT count against
   * the deactivation counter and does NOT log the user out.
   *
   * isMacStillRegistered catches all exceptions and returns true so that
   * transient network errors are completely transparent to the logout logic.
   * This test confirms that regression cannot happen silently: even many
   * network errors in a row leave the user logged in, and when the server
   * later confirms the MAC is gone the counter starts from 0.
   */
  test('fetch rejections (network drops) do not count toward deactivation and keep the user logged in', async () => {
    const { getIsActivated } = await renderActivatedProvider();
    expect(getIsActivated()).toBe(true);

    // 4 network errors — each silently resolves to stillActive=true, so the
    // counter is never incremented (it is reset to 0 on each success).
    for (let i = 0; i < 4; i++) {
      await fireForegrounded('network-error');
    }
    expect(getIsActivated()).toBe(true);

    // 4 server-confirmed deactivations after the network errors.
    // If network errors were incorrectly counted (4 + 4 = 8 ≥ 5) this would
    // have triggered a logout, exposing the regression.
    for (let i = 0; i < 4; i++) {
      await fireForegrounded('inactive');
    }

    // Counter is at 4 (only the inactive responses count) — still under 5.
    expect(getIsActivated()).toBe(true);
  });

  /**
   * Test E — A non-OK HTTP response (server-side error) does NOT count against
   * the deactivation counter.
   *
   * isMacStillRegistered returns true when res.ok is false so that server
   * errors and maintenance windows never log the user out.
   */
  test('non-OK server responses do not count toward deactivation and keep the user logged in', async () => {
    const { getIsActivated } = await renderActivatedProvider();
    expect(getIsActivated()).toBe(true);

    // Many server errors — none should increment the failure counter.
    for (let i = 0; i < 10; i++) {
      await fireForegrounded('server-error');
    }

    expect(getIsActivated()).toBe(true);
  });
});

// ── Startup failure + success resets counter (#266) ───────────────────────────
//
// A MAC check failure at cold-start increments the shared consecutiveMacFailRef
// counter (streak = 1).  A subsequent foreground success must reset it to 0 so
// the user needs a full fresh streak of 5 failures to be logged out — not 4.

describe('AppContextProvider — startup failure + foreground success resets counter (#266)', () => {
  const FAKE_CREDS = JSON.stringify({
    url:      'http://example.com',
    username: 'user',
    password: 'pass',
  });

  let currentRenderer: ReturnType<typeof import('react-test-renderer').create> | null = null;

  afterEach(async () => {
    if (currentRenderer) {
      await act(async () => { currentRenderer!.unmount(); });
      currentRenderer = null;
    }
  });

  /** Provider whose startup MAC check returns 'inactive' (counter → 1, user stays in per #257). */
  async function renderStartupFailedProvider() {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(FAKE_CREDS);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok:   true,
      json: jest.fn().mockResolvedValue({ status: 'inactive' }),
    });
    const { renderer, getIsActivated } = await renderProvider();
    currentRenderer = renderer;
    return { getIsActivated };
  }

  async function fireForegrounded(result: 'active' | 'inactive') {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok:   true,
      json: jest.fn().mockResolvedValue({ status: result }),
    });
    await act(async () => { await capturedAppStateListener!('active'); });
    await act(async () => {});
  }

  /**
   * Test I — startup failure then foreground success resets the counter.
   *
   * counter after startup 'inactive':   1  (stays logged in — below threshold of 5)
   * counter after foreground 'active':  0  (success resets the streak)
   * counter after 4 foreground 'inactive': 4  (still under threshold)
   * counter after 5th foreground 'inactive': 5 → logout
   */
  test('startup failure followed by a foreground success resets the counter, requiring 5 fresh failures to log out', async () => {
    const { getIsActivated } = await renderStartupFailedProvider();
    // Startup 'inactive' → counter=1, user still activated (below threshold of 5)
    expect(getIsActivated()).toBe(true);

    // One foreground success → counter must reset to 0
    await fireForegrounded('active');
    expect(getIsActivated()).toBe(true);

    // 4 foreground failures → counter=4, still under threshold
    for (let i = 0; i < 4; i++) {
      await fireForegrounded('inactive');
    }
    expect(getIsActivated()).toBe(true);

    // 5th foreground failure → counter=5, logout triggered
    await fireForegrounded('inactive');
    expect(getIsActivated()).toBe(false);
  });
});

// ── Consecutive MAC failure counter — background polling path (#256) ──────────
//
// These tests exercise the setInterval branch inside startMacInterval, which
// runs every 5 minutes in the background.  The same consecutiveMacFailRef
// counter is shared with the foreground-listener path; these tests confirm that
// a refactor cannot silently break or disconnect the interval branch.

describe('AppContextProvider — consecutive MAC failure counter (interval path)', () => {
  const FAKE_CREDS = JSON.stringify({
    url:      'http://example.com',
    username: 'user',
    password: 'pass',
  });

  // 5-minute polling interval (must match startMacInterval's INTERVAL_MS).
  const INTERVAL_MS = 5 * 60_000;

  let currentRenderer: ReturnType<typeof import('react-test-renderer').create> | null = null;

  beforeEach(() => {
    // Fake timers let us advance the clock past the 5-minute interval without
    // waiting real wall-clock time.
    jest.useFakeTimers();
  });

  afterEach(async () => {
    if (currentRenderer) {
      await act(async () => { currentRenderer!.unmount(); });
      currentRenderer = null;
    }
    // Restore real timers so subsequent describes are unaffected.
    jest.useRealTimers();
  });

  /**
   * Renders the provider with credentials pre-loaded so the startup MAC check
   * succeeds, isActivated becomes true, and startMacInterval is called.
   */
  async function renderActivatedProvider() {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(FAKE_CREDS);

    // Startup fetch → MAC still active.
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok:   true,
      json: jest.fn().mockResolvedValue({ status: 'active' }),
    });

    const { renderer, getIsActivated } = await renderProvider();
    currentRenderer = renderer;
    return { getIsActivated };
  }

  type TickResult = 'active' | 'inactive' | 'network-error' | 'server-error';

  /**
   * Advances the fake clock by one 5-minute interval tick and awaits the
   * async interval callback (including its fetch call and any state updates).
   *
   * jest.advanceTimersByTimeAsync (Jest 29) fires the setInterval callback and
   * awaits any promises it schedules before resolving, so the counter and state
   * are fully settled when this helper returns.
   */
  async function fireTick(result: TickResult) {
    switch (result) {
      case 'network-error':
        (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network request failed'));
        break;
      case 'server-error':
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
        break;
      default:
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok:   true,
          json: jest.fn().mockResolvedValue({ status: result }),
        });
    }
    // Advance the fake clock, awaiting all async timer callbacks (Jest 29 API).
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    // Flush any React state updates triggered by doLogout (setIsActivated etc.).
    await act(async () => {});
  }

  /**
   * Test F — 4 interval ticks reporting inactive do NOT log the user out.
   *
   * The threshold is 5; four consecutive inactive responses from the periodic
   * poll must leave the user logged in.
   */
  test('4 interval ticks reporting inactive do NOT log the user out', async () => {
    const { getIsActivated } = await renderActivatedProvider();
    expect(getIsActivated()).toBe(true);

    for (let i = 0; i < 4; i++) {
      await fireTick('inactive');
    }

    expect(getIsActivated()).toBe(true);
  });

  /**
   * Test G — A success tick resets the counter so a new streak of 4 still
   * keeps the user logged in.
   *
   * 4 failures → 1 success → 4 more failures must not trigger logout because
   * the success zeroed the shared consecutiveMacFailRef counter.
   */
  test('a success tick resets the failure counter so 4 more inactive ticks keep the user in', async () => {
    const { getIsActivated } = await renderActivatedProvider();
    expect(getIsActivated()).toBe(true);

    // 4 consecutive failures — counter reaches 4, still under the threshold.
    for (let i = 0; i < 4; i++) {
      await fireTick('inactive');
    }
    expect(getIsActivated()).toBe(true);

    // One success — counter must be reset to 0.
    await fireTick('active');
    expect(getIsActivated()).toBe(true);

    // 4 more failures after the reset — counter is back to 4, under threshold.
    for (let i = 0; i < 4; i++) {
      await fireTick('inactive');
    }

    expect(getIsActivated()).toBe(true);
  });

  /**
   * Test H — 5 consecutive interval ticks reporting inactive DO trigger logout.
   *
   * After 5 back-to-back inactive responses from the periodic poll, doLogout
   * must be called and isActivated must flip to false.
   */
  test('5 consecutive interval ticks reporting inactive trigger logout', async () => {
    const { getIsActivated } = await renderActivatedProvider();
    expect(getIsActivated()).toBe(true);

    for (let i = 0; i < 5; i++) {
      await fireTick('inactive');
    }

    expect(getIsActivated()).toBe(false);
  });

  /**
   * Test I (interval) — fetch rejections (network drops) in interval ticks do
   * NOT increment the deactivation counter and do NOT log the user out.
   *
   * isMacStillRegistered catches all thrown exceptions and returns true, so
   * each network-error tick is treated as a success (counter stays at 0).
   * This test confirms that even many back-to-back network errors cannot push
   * the shared consecutiveMacFailRef counter toward the logout threshold.
   *
   * After the network errors, four server-confirmed 'inactive' ticks are fired.
   * If network errors were incorrectly counted (e.g. 10 errors + 4 inactives ≥ 5)
   * this assertion would expose the regression.
   */
  test('fetch rejections (network drops) in interval ticks do not count toward deactivation and keep the user logged in', async () => {
    const { getIsActivated } = await renderActivatedProvider();
    expect(getIsActivated()).toBe(true);

    // 10 network-error ticks — each resolves to stillActive=true inside
    // isMacStillRegistered, so the counter is reset to 0 each time.
    for (let i = 0; i < 10; i++) {
      await fireTick('network-error');
    }
    expect(getIsActivated()).toBe(true);

    // 4 server-confirmed inactive ticks — counter climbs from 0 to 4, still
    // below the threshold of 5, so the user must remain logged in.
    for (let i = 0; i < 4; i++) {
      await fireTick('inactive');
    }

    expect(getIsActivated()).toBe(true);
  });

  /**
   * Test J (interval) — non-OK HTTP responses in interval ticks do NOT count
   * toward the deactivation counter and do NOT log the user out.
   *
   * isMacStillRegistered returns true when res.ok is false so that server
   * errors and maintenance windows never log the user out, regardless of how
   * many back-to-back ticks return a non-OK status.
   */
  test('non-OK server responses in interval ticks do not count toward deactivation and keep the user logged in', async () => {
    const { getIsActivated } = await renderActivatedProvider();
    expect(getIsActivated()).toBe(true);

    // 10 server-error ticks — none should increment the failure counter.
    for (let i = 0; i < 10; i++) {
      await fireTick('server-error');
    }

    expect(getIsActivated()).toBe(true);
  });
});

// ── Interval pauses on background and resumes on foreground (#278) ─────────────
//
// Confirms that stopMacInterval is called when the app goes to the background
// so the 5-minute timer does not keep firing while the app is invisible, and
// that startMacInterval restarts correctly on the next 'active' event.

describe('AppContextProvider — interval pauses on background and resumes on active (#278)', () => {
  const FAKE_CREDS = JSON.stringify({
    url:      'http://example.com',
    username: 'user',
    password: 'pass',
  });
  const INTERVAL_MS = 5 * 60_000;

  let currentRenderer: ReturnType<typeof import('react-test-renderer').create> | null = null;

  beforeEach(() => { jest.useFakeTimers(); });

  afterEach(async () => {
    if (currentRenderer) {
      await act(async () => { currentRenderer!.unmount(); });
      currentRenderer = null;
    }
    jest.useRealTimers();
  });

  /** Provider whose startup MAC check succeeds; interval starts immediately. */
  async function renderActivatedProvider() {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(FAKE_CREDS);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok:   true,
      json: jest.fn().mockResolvedValue({ status: 'active' }),
    });
    const { renderer, getIsActivated } = await renderProvider();
    currentRenderer = renderer;
    return { getIsActivated };
  }

  async function fireBackground() {
    await act(async () => { await capturedAppStateListener!('background'); });
    await act(async () => {});
  }

  async function fireActive(fetchResult: 'active' | 'inactive' = 'active') {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok:   true,
      json: jest.fn().mockResolvedValue({ status: fetchResult }),
    });
    await act(async () => { await capturedAppStateListener!('active'); });
    await act(async () => {});
  }

  /**
   * Test I — backgrounding stops the interval so no MAC fetch fires.
   *
   * After the startup succeeds the interval is running.  Going to the
   * background must clear it, so advancing the clock by 5 minutes does not
   * produce any additional fetch calls.
   */
  test('going to background stops the interval — no fetch fires after the clock advances', async () => {
    await renderActivatedProvider();

    // Startup fetch already happened (count = 1).  Interval is now running.
    const fetchesAfterStartup = (global.fetch as jest.Mock).mock.calls.length;

    // App goes to background — stopMacInterval must be called.
    await fireBackground();

    // Advance the clock past the 5-minute mark — interval must NOT fire.
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    await act(async () => {});

    expect((global.fetch as jest.Mock).mock.calls.length).toBe(fetchesAfterStartup);
  });

  /**
   * Test J — re-foregrounding after a background pause restarts the interval.
   *
   * background → advance clock (no fetch) → active → advance clock again →
   * the interval fires and produces at least one additional fetch call.
   */
  test('re-foregrounding after background restarts the interval so the next tick fetches', async () => {
    await renderActivatedProvider();

    // Go dark — interval stops.
    await fireBackground();
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    await act(async () => {});

    const fetchesBeforeResume = (global.fetch as jest.Mock).mock.calls.length;

    // App returns to foreground — foreground check fires + startMacInterval.
    await fireActive('active');

    // Advance clock by one full interval (> 2-min grace window) so the tick fires.
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok:   true,
      json: jest.fn().mockResolvedValue({ status: 'active' }),
    });
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    await act(async () => {});

    // At least one extra fetch beyond the foreground check proves the interval is running.
    expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThan(fetchesBeforeResume + 1);
  });
});

// ── Interval grace window after a foreground check (#189) ─────────────────────
//
// startMacInterval skips a tick when a foreground check ran within the last
// 2 minutes (SKIP_AFTER_FOREGROUND_MS).  These tests confirm the guard works
// correctly in both directions: tick IS skipped within the window, and IS
// processed once the window has elapsed.

describe('AppContextProvider — interval grace window after foreground check (#189)', () => {
  const FAKE_CREDS = JSON.stringify({
    url:      'http://example.com',
    username: 'user',
    password: 'pass',
  });

  // Must match startMacInterval's INTERVAL_MS and SKIP_AFTER_FOREGROUND_MS.
  const INTERVAL_MS            = 5 * 60_000; // 5 minutes
  const SKIP_AFTER_FOREGROUND_MS = 2 * 60_000; // 2-minute grace window

  let currentRenderer: ReturnType<typeof import('react-test-renderer').create> | null = null;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(async () => {
    if (currentRenderer) {
      await act(async () => { currentRenderer!.unmount(); });
      currentRenderer = null;
    }
    jest.useRealTimers();
  });

  /**
   * Renders the provider with stored credentials so the startup MAC check
   * succeeds, isActivated is true, lastForegroundCheckRef is stamped at T=0,
   * and startMacInterval is called.
   *
   * Returns the total number of fetch calls made during startup so tests can
   * count incremental calls without being coupled to the exact startup count.
   */
  async function renderActivatedProvider() {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(FAKE_CREDS);

    // Startup fetch → MAC still active.
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok:   true,
      json: jest.fn().mockResolvedValue({ status: 'active' }),
    });

    const { renderer } = await renderProvider();
    currentRenderer = renderer;

    const fetchCountAfterStartup = (global.fetch as jest.Mock).mock.calls.length;
    return { fetchCountAfterStartup };
  }

  /**
   * Test K — interval tick within the 2-minute grace window is skipped.
   *
   * Timeline (fake clock):
   *   T = 0        : startup — lastForegroundCheckRef = 0, interval starts.
   *   T = 4 min    : AppState 'active' (foreground) — lastForegroundCheckRef = 4 min.
   *   T = 5 min    : first interval tick fires.
   *                  Date.now() − lastForegroundCheckRef = 1 min < 2 min → SKIP.
   *
   * fetch must NOT be called by the interval tick; total fetch count must
   * equal startup (1) + foreground check (1) = 2.
   */
  test('interval tick within the 2-minute grace window does not call fetch', async () => {
    const { fetchCountAfterStartup } = await renderActivatedProvider();

    // Advance clock to T=4 min and fire a foreground check.
    // This stamps lastForegroundCheckRef at fake-now = 4 min.
    await jest.advanceTimersByTimeAsync(4 * 60_000);
    await act(async () => {});

    // Provide the mock response consumed by the foreground MAC check.
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok:   true,
      json: jest.fn().mockResolvedValue({ status: 'active' }),
    });
    await act(async () => { await capturedAppStateListener!('active'); });
    await act(async () => {});

    const fetchCountAfterForeground = (global.fetch as jest.Mock).mock.calls.length;
    // Sanity: the foreground check did consume exactly one more fetch call.
    expect(fetchCountAfterForeground).toBe(fetchCountAfterStartup + 1);

    // Advance the remaining 1 minute so the interval tick fires at T=5 min.
    // Date.now() − lastForegroundCheckRef = 1 min < SKIP_AFTER_FOREGROUND_MS → SKIP.
    // Do NOT register a mock fetch response — the tick must not reach isMacStillRegistered.
    await jest.advanceTimersByTimeAsync(INTERVAL_MS - 4 * 60_000);
    await act(async () => {});

    // fetch call count must be unchanged — the interval tick was suppressed.
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(fetchCountAfterForeground);
  });

  /**
   * Test L — interval tick after the grace window has elapsed does call fetch.
   *
   * Timeline (fake clock):
   *   T = 0        : startup — lastForegroundCheckRef = 0, interval starts.
   *   T = 1 min    : AppState 'active' (foreground) — lastForegroundCheckRef = 1 min.
   *   T = 5 min    : first interval tick fires.
   *                  Date.now() − lastForegroundCheckRef = 4 min > 2 min → NOT skipped.
   *
   * fetch MUST be called by the interval tick; total fetch count must equal
   * startup (1) + foreground check (1) + interval tick (1) = 3.
   */
  test('interval tick after the grace window has elapsed does call fetch', async () => {
    const { fetchCountAfterStartup } = await renderActivatedProvider();

    // Advance clock to T=1 min and fire a foreground check.
    // lastForegroundCheckRef = 1 min; the upcoming interval tick at T=5 min is 4 min later.
    await jest.advanceTimersByTimeAsync(1 * 60_000);
    await act(async () => {});

    // Mock response for the foreground MAC check.
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok:   true,
      json: jest.fn().mockResolvedValue({ status: 'active' }),
    });
    await act(async () => { await capturedAppStateListener!('active'); });
    await act(async () => {});

    const fetchCountAfterForeground = (global.fetch as jest.Mock).mock.calls.length;
    expect(fetchCountAfterForeground).toBe(fetchCountAfterStartup + 1);

    // Advance the remaining 4 minutes so the interval tick fires at T=5 min.
    // Date.now() − lastForegroundCheckRef = 4 min > SKIP_AFTER_FOREGROUND_MS → NOT skipped.
    // Provide the mock response that the interval tick will consume.
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok:   true,
      json: jest.fn().mockResolvedValue({ status: 'active' }),
    });
    await jest.advanceTimersByTimeAsync(INTERVAL_MS - 1 * 60_000);
    await act(async () => {});

    // fetch call count must have increased by exactly one (the interval tick).
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(fetchCountAfterForeground + 1);
  });
});

// ── #266 ─────────────────────────────────────────────────────────────────────

describe('AppContextProvider — startup hiccup + recovery does not poison the failure counter (#266)', () => {
  /**
   * Scenario:
   *   1. Cold start → MAC check returns `inactive` → counter = 1 (below threshold;
   *      user stays logged in — this is the "startup hiccup").
   *   2. First foreground → MAC check returns `active` → counter resets to 0.
   *   3. Next 4 foreground checks return `inactive` → counter climbs to 4.
   *      User must STILL be logged in; counter is below the threshold of 5.
   *   4. 5th foreground failure → counter = 5 → doLogout fires.
   *
   * Without the `consecutiveMacFailRef.current = 0` reset on a successful
   * check (AppContext.tsx line ~204), the counter would be stuck at 1 after
   * the hiccup and only need 4 more failures (not 5) to reach the threshold —
   * shortchanging the user's tolerance window.
   */
  test('5 consecutive failures after a mid-session recovery trigger logout, not 4', async () => {
    // Credentials present so the startup MAC check runs.
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(
      JSON.stringify({ url: 'http://example.com', username: 'user', password: 'pass' }),
    );

    // Sequential fetch responses:
    //   startup        → inactive (counter: 0 → 1, still in)
    //   foreground 1   → active   (counter: 1 → 0, recovered)
    //   foreground 2   → inactive (counter: 0 → 1)
    //   foreground 3   → inactive (counter: 1 → 2)
    //   foreground 4   → inactive (counter: 2 → 3)
    //   foreground 5   → inactive (counter: 3 → 4, still in — key assertion)
    //   foreground 6   → inactive (counter: 4 → 5, logout fires)
    const inactive = { ok: true, json: jest.fn().mockResolvedValue({ status: 'inactive' }) };
    const active   = { ok: true, json: jest.fn().mockResolvedValue({ status: 'active'   }) };
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(inactive) // startup
      .mockResolvedValueOnce(active)   // foreground 1 — recovery
      .mockResolvedValueOnce(inactive) // foreground 2
      .mockResolvedValueOnce(inactive) // foreground 3
      .mockResolvedValueOnce(inactive) // foreground 4
      .mockResolvedValueOnce(inactive) // foreground 5 — still in (counter = 4)
      .mockResolvedValueOnce(inactive); // foreground 6 — logout (counter = 5)

    const { getIsActivated } = await renderProvider();

    // After startup hiccup (counter = 1), user must still be active.
    expect(getIsActivated()).toBe(true);

    // Foreground 1: clean check — counter resets to 0.
    await act(async () => { await capturedAppStateListener!('active'); });
    await act(async () => {});
    expect(getIsActivated()).toBe(true);

    // Foreground 2–5: four consecutive failures (counter goes 1 → 4).
    // The user must remain logged in for all four — counter is below 5.
    for (let i = 0; i < 4; i++) {
      await act(async () => { await capturedAppStateListener!('active'); });
      await act(async () => {});
    }
    expect(getIsActivated()).toBe(true); // counter = 4, threshold not reached

    // Foreground 6: fifth consecutive failure — counter hits 5 → doLogout.
    await act(async () => { await capturedAppStateListener!('active'); });
    await act(async () => {});
    expect(getIsActivated()).toBe(false); // logged out
  });
});

// ── #279: startup hiccup + interval-path counter ───────────────────────────────
//
// When startup returns 'inactive' the consecutiveMacFailRef is seeded at 1.
// The FIRST interval tick that returns 'active' must reset the counter to 0.
// After the reset, exactly 5 fresh interval failures are still required to
// trigger doLogout — proving the startup hiccup did not shorten the threshold.

describe('AppContextProvider — startup hiccup does not shorten interval failure threshold (#279)', () => {
  const FAKE_CREDS  = JSON.stringify({ url: 'http://example.com', username: 'u', password: 'p' });
  const INTERVAL_MS = 5 * 60_000;

  let currentRenderer: ReturnType<typeof import('react-test-renderer').create> | null = null;

  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(async () => {
    if (currentRenderer) {
      await act(async () => { currentRenderer!.unmount(); });
      currentRenderer = null;
    }
    jest.useRealTimers();
  });

  test('interval success after startup failure resets counter — 5 fresh failures are still needed to logout', async () => {
    const inactive = { ok: true, json: jest.fn().mockResolvedValue({ status: 'inactive' }) };
    const active   = { ok: true, json: jest.fn().mockResolvedValue({ status: 'active'   }) };

    // Startup: returns inactive — counter = 1, user stays in.
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(FAKE_CREDS);
    (global.fetch as jest.Mock).mockResolvedValueOnce(inactive);
    const { renderer, getIsActivated } = await renderProvider();
    currentRenderer = renderer;
    expect(getIsActivated()).toBe(true); // counter = 1, threshold not reached

    // Interval tick 1: active → counter resets to 0.
    (global.fetch as jest.Mock).mockResolvedValueOnce(active);
    await act(async () => { await jest.advanceTimersByTimeAsync(INTERVAL_MS); });
    await act(async () => {});
    expect(getIsActivated()).toBe(true); // counter = 0

    // Interval ticks 2–5: inactive → counter climbs 1 → 4.
    // User must remain logged in for all four — the reset must hold.
    for (let i = 0; i < 4; i++) {
      (global.fetch as jest.Mock).mockResolvedValueOnce(inactive);
      await act(async () => { await jest.advanceTimersByTimeAsync(INTERVAL_MS); });
      await act(async () => {});
    }
    expect(getIsActivated()).toBe(true); // counter = 4, threshold not reached

    // Interval tick 6: inactive → counter = 5 → doLogout.
    (global.fetch as jest.Mock).mockResolvedValueOnce(inactive);
    await act(async () => { await jest.advanceTimersByTimeAsync(INTERVAL_MS); });
    await act(async () => {});
    expect(getIsActivated()).toBe(false); // logged out
  });
});

// ── #298: AppState 'inactive' pauses the interval ─────────────────────────────
//
// The existing #278 tests confirm that 'background' stops the MAC-check
// interval.  This test confirms that 'inactive' (incoming call, notification
// pull-down, etc.) has the same effect — the interval must not fire while
// the app is partially obscured.

describe('AppContextProvider — AppState inactive pauses the MAC-check interval (#298)', () => {
  const FAKE_CREDS  = JSON.stringify({ url: 'http://example.com', username: 'u', password: 'p' });
  const INTERVAL_MS = 5 * 60_000;

  let currentRenderer: ReturnType<typeof import('react-test-renderer').create> | null = null;

  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(async () => {
    if (currentRenderer) {
      await act(async () => { currentRenderer!.unmount(); });
      currentRenderer = null;
    }
    jest.useRealTimers();
  });

  test('AppState inactive stops the interval — no MAC fetch fires while the app is inactive', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(FAKE_CREDS);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true, json: jest.fn().mockResolvedValue({ status: 'active' }),
    });
    const { renderer } = await renderProvider();
    currentRenderer = renderer;

    // Startup complete; interval is running.
    const fetchesAfterStartup = (global.fetch as jest.Mock).mock.calls.length;

    // App transitions to 'inactive' (e.g. incoming phone call overlay).
    await act(async () => { await capturedAppStateListener!('inactive'); });
    await act(async () => {});

    // Advance the clock past one full interval period.
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    await act(async () => {});

    // No extra fetch must have fired — the interval is paused.
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(fetchesAfterStartup);
  });
});

// ── #299: interval stays permanently off after logout ─────────────────────────
//
// After doLogout the isActivatedRef is false and deviceMacRef is empty.
// Re-foregrounding the app must NOT restart the MAC-check interval, and
// advancing the clock must NOT trigger any additional fetch calls.

describe('AppContextProvider — interval stays off permanently after logout (#299)', () => {
  const FAKE_CREDS  = JSON.stringify({ url: 'http://example.com', username: 'u', password: 'p' });
  const INTERVAL_MS = 5 * 60_000;

  let currentRenderer: ReturnType<typeof import('react-test-renderer').create> | null = null;

  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(async () => {
    if (currentRenderer) {
      await act(async () => { currentRenderer!.unmount(); });
      currentRenderer = null;
    }
    jest.useRealTimers();
  });

  test('foregrounding after logout does not restart the MAC-check interval', async () => {
    const inactive = { ok: true, json: jest.fn().mockResolvedValue({ status: 'inactive' }) };

    // Startup succeeds → interval running.
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(FAKE_CREDS);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true, json: jest.fn().mockResolvedValue({ status: 'active' }),
    });
    const { renderer, getIsActivated } = await renderProvider();
    currentRenderer = renderer;

    // Drive 5 consecutive foreground-check failures to trigger doLogout.
    for (let i = 0; i < 5; i++) {
      (global.fetch as jest.Mock).mockResolvedValueOnce(inactive);
      await act(async () => { await capturedAppStateListener!('active'); });
      await act(async () => {});
    }
    expect(getIsActivated()).toBe(false); // confirmed logged out

    const fetchCountAfterLogout = (global.fetch as jest.Mock).mock.calls.length;

    // App re-foregrounds — the AppState 'active' handler must be a no-op
    // because isActivated is false (no credentials, no MAC).
    await act(async () => { await capturedAppStateListener!('active'); });
    await act(async () => {});

    // Advance past one full interval period — interval must NOT fire.
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    await act(async () => {});

    expect((global.fetch as jest.Mock).mock.calls.length).toBe(fetchCountAfterLogout);
  });
});
