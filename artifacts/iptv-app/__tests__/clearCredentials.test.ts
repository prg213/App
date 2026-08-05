/**
 * Integration-style tests for StorageService.clearCredentials.
 *
 * Goal: guarantee that every per-user AsyncStorage key defined in KEYS is
 * wiped on logout, *except* LOGOUT_REASON which must survive so the
 * activation screen can display a one-time explanation banner.
 *
 * If a developer adds a new key to KEYS but forgets to add it to the
 * multiRemove call inside clearCredentials, the "wipes every per-user key"
 * test below will fail — catching the omission before it reaches production.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

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

import { StorageService, KEYS } from '../services/storage';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Sentinel value written to every key before each "wipe" test. */
const SENTINEL = '"test-value"';

/**
 * All KEYS values that clearCredentials is expected to wipe.
 * LOGOUT_REASON is excluded because it intentionally survives logout.
 */
const PER_USER_KEYS = Object.values(KEYS).filter((k) => k !== KEYS.LOGOUT_REASON);

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(store).forEach((k) => delete store[k]);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('StorageService.clearCredentials', () => {
  test('wipes every per-user AsyncStorage key (all KEYS except LOGOUT_REASON)', async () => {
    // Populate every per-user key with a sentinel value.
    for (const key of PER_USER_KEYS) {
      store[key] = SENTINEL;
    }

    await StorageService.clearCredentials();

    // Every key must be absent after logout.
    for (const key of PER_USER_KEYS) {
      expect(store[key]).toBeUndefined();
    }
  });

  test('preserves LOGOUT_REASON so the activation screen can show a one-time banner', async () => {
    await StorageService.saveLogoutReason('deactivated');
    await StorageService.clearCredentials();

    // LOGOUT_REASON must still be in storage after clearCredentials.
    // saveLogoutReason stores the raw string (not JSON-encoded).
    expect(store[KEYS.LOGOUT_REASON]).toBe('deactivated');
  });

  test('clears channel favourites', async () => {
    store[KEYS.FAVORITES] = JSON.stringify([{ id: 'ch1', name: 'BBC One' }]);
    await StorageService.clearCredentials();
    expect(store[KEYS.FAVORITES]).toBeUndefined();
  });

  test('clears movie favourites', async () => {
    store[KEYS.MOVIE_FAVORITES] = JSON.stringify([{ id: 'm1', title: 'Dune' }]);
    await StorageService.clearCredentials();
    expect(store[KEYS.MOVIE_FAVORITES]).toBeUndefined();
  });

  test('clears series favourites', async () => {
    store[KEYS.SERIES_FAVORITES] = JSON.stringify([{ id: 's1', name: 'Breaking Bad' }]);
    await StorageService.clearCredentials();
    expect(store[KEYS.SERIES_FAVORITES]).toBeUndefined();
  });

  test('clears watch history', async () => {
    store[KEYS.HISTORY] = JSON.stringify([{ id: 'h1', title: 'Episode 1', watchedAt: 0 }]);
    await StorageService.clearCredentials();
    expect(store[KEYS.HISTORY]).toBeUndefined();
  });

  test('clears channels cache', async () => {
    store[KEYS.CHANNELS_CACHE] = JSON.stringify([{ id: 'c1' }]);
    await StorageService.clearCredentials();
    expect(store[KEYS.CHANNELS_CACHE]).toBeUndefined();
  });

  test('clears movies cache', async () => {
    store[KEYS.MOVIES_CACHE] = JSON.stringify([{ id: 'm1' }]);
    await StorageService.clearCredentials();
    expect(store[KEYS.MOVIES_CACHE]).toBeUndefined();
  });

  test('clears parental settings', async () => {
    store[KEYS.PARENTAL] = JSON.stringify({ maxRating: 'pg', lockEnabled: true });
    await StorageService.clearCredentials();
    expect(store[KEYS.PARENTAL]).toBeUndefined();
  });

  test('clears recent channels', async () => {
    store[KEYS.RECENT_CHANNELS] = JSON.stringify([{ id: 'rc1', name: 'Sky Sports' }]);
    await StorageService.clearCredentials();
    expect(store[KEYS.RECENT_CHANNELS]).toBeUndefined();
  });

  test('clears reminders', async () => {
    store[KEYS.REMINDERS] = JSON.stringify([{ id: 'r1', title: 'Match' }]);
    await StorageService.clearCredentials();
    expect(store[KEYS.REMINDERS]).toBeUndefined();
  });

  test('clears preferred audio language', async () => {
    store[KEYS.PREF_AUDIO_LANG] = 'en';
    await StorageService.clearCredentials();
    expect(store[KEYS.PREF_AUDIO_LANG]).toBeUndefined();
  });

  test('clears preferred subtitle language', async () => {
    store[KEYS.PREF_SUBTITLE_LANG] = 'ar';
    await StorageService.clearCredentials();
    expect(store[KEYS.PREF_SUBTITLE_LANG]).toBeUndefined();
  });

  test('clears reminder lead-time preference', async () => {
    store[KEYS.PREF_REMINDER_LEAD_MINS] = '10';
    await StorageService.clearCredentials();
    expect(store[KEYS.PREF_REMINDER_LEAD_MINS]).toBeUndefined();
  });

  test('clears preferred search type', async () => {
    store[KEYS.PREF_SEARCH_TYPE] = 'movies';
    await StorageService.clearCredentials();
    expect(store[KEYS.PREF_SEARCH_TYPE]).toBeUndefined();
  });

  test('clears saved search query', async () => {
    store[KEYS.PREF_SEARCH_QUERY] = 'breaking bad';
    await StorageService.clearCredentials();
    expect(store[KEYS.PREF_SEARCH_QUERY]).toBeUndefined();
  });

  test('clears backfill timestamp', async () => {
    store[KEYS.BACKFILL_TS] = String(Date.now());
    await StorageService.clearCredentials();
    expect(store[KEYS.BACKFILL_TS]).toBeUndefined();
  });

  test('clears recent searches', async () => {
    store[KEYS.RECENT_SEARCHES] = JSON.stringify(['dune', 'avatar']);
    await StorageService.clearCredentials();
    expect(store[KEYS.RECENT_SEARCHES]).toBeUndefined();
  });

  test('succeeds when storage is already empty (no keys to remove)', async () => {
    // All keys absent — clearCredentials must not throw.
    await expect(StorageService.clearCredentials()).resolves.not.toThrow();
  });
});
