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

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import React, { useRef } from 'react';
import { act, create } from 'react-test-renderer';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

  multiRemove.mockImplementation(async (keys: string[]) => {
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

  let renderer: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(
      <AppContextProvider>
        <Consumer />
      </AppContextProvider>,
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
   * Test 1 — Forced logout via startup MAC check:
   *
   * AppContextProvider's startup useEffect finds stored credentials but the
   * server reports the MAC is no longer active.  It calls doLogout('deactivated').
   * saveLogoutReason must be awaited BEFORE clearCredentials.
   */
  test('saveLogoutReason is called before clearCredentials when the startup MAC check fails', async () => {
    // Credentials present in SecureStore so the startup check runs.
    const fakeCreds = JSON.stringify({
      url:      'http://example.com',
      username: 'user',
      password: 'pass',
    });
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(fakeCreds);

    // Server reports MAC is gone → doLogout('deactivated').
    global.fetch = jest.fn().mockResolvedValue({
      ok:   true,
      json: jest.fn().mockResolvedValue({ status: 'inactive' }),
    }) as unknown as typeof fetch;

    const callLog: CallLog = [];
    instrumentStorageOrder(callLog);

    await renderProvider();

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
   */
  test('banner key written before forced logout survives the credential wipe', async () => {
    const fakeCreds = JSON.stringify({
      url:      'http://example.com',
      username: 'user',
      password: 'pass',
    });
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(fakeCreds);

    global.fetch = jest.fn().mockResolvedValue({
      ok:   true,
      json: jest.fn().mockResolvedValue({ status: 'inactive' }),
    }) as unknown as typeof fetch;

    await renderProvider();

    // sv_logout_reason must still be present after credentials were cleared.
    expect(store['sv_logout_reason']).toBe('deactivated');
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
