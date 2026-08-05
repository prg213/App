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
