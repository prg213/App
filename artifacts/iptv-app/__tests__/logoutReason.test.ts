/**
 * Unit tests for StorageService logout-reason one-shot flow.
 *
 * Covers:
 *   - consumeLogoutReason returns the stored reason on first call and null on
 *     every subsequent call (key is cleared after the first read)
 *   - saveLogoutReason persists the value so consumeLogoutReason can read it
 *   - No reason stored → consumeLogoutReason returns null immediately
 *   - App crash before display (key lingers in storage) — first call on
 *     re-launch still returns the value and clears it
 *   - AsyncStorage read failure → consumeLogoutReason returns null, does not
 *     throw
 *   - AsyncStorage write failure in saveLogoutReason is swallowed silently
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

// We need a fake AsyncStorage that behaves like the real in-memory store so we
// can verify read-then-delete semantics.
const store: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => store[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => { store[key] = value; }),
  removeItem: jest.fn(async (key: string) => { delete store[key]; }),
  multiRemove: jest.fn(async (keys: string[]) => { keys.forEach((k) => delete store[k]); }),
}));

// expo-secure-store is imported by storage.ts but not exercised by these tests.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { StorageService } from '../services/storage';

const getItem    = AsyncStorage.getItem    as jest.MockedFunction<typeof AsyncStorage.getItem>;
const removeItem = AsyncStorage.removeItem as jest.MockedFunction<typeof AsyncStorage.removeItem>;
const setItem    = AsyncStorage.setItem    as jest.MockedFunction<typeof AsyncStorage.setItem>;

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // Reset the in-memory store so each test starts clean.
  Object.keys(store).forEach((k) => delete store[k]);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('StorageService.consumeLogoutReason', () => {
  test('returns null when no reason has been stored', async () => {
    const reason = await StorageService.consumeLogoutReason();
    expect(reason).toBeNull();
    expect(removeItem).not.toHaveBeenCalled();
  });

  test('returns the stored reason on first call and clears the key', async () => {
    await StorageService.saveLogoutReason('deactivated');

    const first = await StorageService.consumeLogoutReason();

    expect(first).toBe('deactivated');
    // The key must have been removed so subsequent calls return null.
    expect(removeItem).toHaveBeenCalledWith('sv_logout_reason');
  });

  test('returns null on second call (key was cleared by the first call)', async () => {
    await StorageService.saveLogoutReason('deactivated');

    const first  = await StorageService.consumeLogoutReason();
    const second = await StorageService.consumeLogoutReason();

    expect(first).toBe('deactivated');
    expect(second).toBeNull();
  });

  test('returns null on all calls after the first consume', async () => {
    await StorageService.saveLogoutReason('deactivated');

    await StorageService.consumeLogoutReason(); // first — consumes
    const results = await Promise.all([
      StorageService.consumeLogoutReason(),
      StorageService.consumeLogoutReason(),
      StorageService.consumeLogoutReason(),
    ]);

    expect(results).toEqual([null, null, null]);
  });

  test('key lingering from a crash is consumed on the very next launch', async () => {
    // Simulate: saveLogoutReason was written, then the app crashed before the
    // activation screen could render and call consumeLogoutReason.
    // The next launch should still read and clear it exactly once.
    store['sv_logout_reason'] = 'deactivated'; // key lingers in storage

    const first  = await StorageService.consumeLogoutReason();
    const second = await StorageService.consumeLogoutReason();

    expect(first).toBe('deactivated');
    expect(second).toBeNull();
  });

  test('returns null and does not throw when AsyncStorage.getItem rejects', async () => {
    getItem.mockRejectedValueOnce(new Error('disk error'));

    await expect(StorageService.consumeLogoutReason()).resolves.toBeNull();
    // removeItem must NOT have been called (we never got a value to clear).
    expect(removeItem).not.toHaveBeenCalled();
  });

  test('returns null (not the reason) when removeItem rejects — catch block swallows the error', async () => {
    await StorageService.saveLogoutReason('deactivated');
    // Simulate a transient storage error during the delete step.
    // The try block calls getItem (succeeds) then removeItem (throws), so the
    // catch block fires and returns null — the key may linger, but no crash.
    removeItem.mockRejectedValueOnce(new Error('delete failed'));

    const result = await StorageService.consumeLogoutReason();

    // The entire try block is abandoned on throw; catch returns null.
    expect(result).toBeNull();
  });
});

describe('StorageService.saveLogoutReason', () => {
  test('persists the reason so consumeLogoutReason can read it', async () => {
    await StorageService.saveLogoutReason('deactivated');

    expect(setItem).toHaveBeenCalledWith('sv_logout_reason', 'deactivated');
  });

  test('does not throw when AsyncStorage.setItem rejects', async () => {
    setItem.mockRejectedValueOnce(new Error('storage full'));

    await expect(StorageService.saveLogoutReason('deactivated')).resolves.not.toThrow();
  });

  test('key is intentionally NOT cleared by clearCredentials', async () => {
    // saveLogoutReason must be written BEFORE clearCredentials so that the
    // activation screen can read it after credentials are gone.  Verify the
    // key is not in the multiRemove list.
    const multiRemove = AsyncStorage.multiRemove as jest.MockedFunction<typeof AsyncStorage.multiRemove>;

    await StorageService.saveLogoutReason('deactivated');
    await StorageService.clearCredentials();

    // sv_logout_reason must NOT appear in any multiRemove call.
    const removedKeys: string[] = multiRemove.mock.calls.flatMap((call) => call[0]);
    expect(removedKeys).not.toContain('sv_logout_reason');

    // The key must still be readable after clearCredentials.
    const reason = await StorageService.consumeLogoutReason();
    expect(reason).toBe('deactivated');
  });
});
