/**
 * #412: UI preference storage — get + set coverage.
 *
 * Exercises every new device-scoped preference method added in task #408:
 *   getPrefMovieSort / setPrefMovieSort
 *   getPrefSeriesSort / setPrefSeriesSort
 *   getPrefLiveCat / setPrefLiveCat
 *   getPrefPlaybackSpeed / setPrefPlaybackSpeed
 *
 * These keys live under the @pref_* namespace (DEVICE_PREF_KEYS) and are
 * intentionally NOT cleared on logout.
 *
 * Pattern mirrors clearCredentials.test.ts: AsyncStorage is mocked with a
 * module-level `store` object (no `default:` wrapper — CJS interop) so that
 * getItem/setItem work against real in-memory state and jest.clearAllMocks()
 * can reset call history without losing the implementation.
 */

// ── In-memory backing store shared by all mock methods ────────────────────────

const store: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem:     jest.fn(async (key: string) => store[key] ?? null),
  setItem:     jest.fn(async (key: string, value: string) => { store[key] = value; }),
  removeItem:  jest.fn(async (key: string) => { delete store[key]; }),
  multiRemove: jest.fn(async (keys: string[]) => { keys.forEach((k) => delete store[k]); }),
  multiGet:    jest.fn(async () => []),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync:    jest.fn(async () => null),
  setItemAsync:    jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

import { StorageService, DEVICE_PREF_KEYS } from '../services/storage';

// ── Reset state between tests ─────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(store).forEach((k) => delete store[k]);
});

// ── getPrefMovieSort / setPrefMovieSort ───────────────────────────────────────

describe('getPrefMovieSort / setPrefMovieSort', () => {
  it('returns null when nothing is stored', async () => {
    expect(await StorageService.getPrefMovieSort()).toBeNull();
  });

  it('returns null for an unrecognised stored value', async () => {
    store[DEVICE_PREF_KEYS.PREF_MOVIE_SORT] = 'bogus';
    expect(await StorageService.getPrefMovieSort()).toBeNull();
  });

  it('round-trips "newest"', async () => {
    await StorageService.setPrefMovieSort('newest');
    expect(await StorageService.getPrefMovieSort()).toBe('newest');
  });

  it('round-trips "name"', async () => {
    await StorageService.setPrefMovieSort('name');
    expect(await StorageService.getPrefMovieSort()).toBe('name');
  });

  it('round-trips "rating"', async () => {
    await StorageService.setPrefMovieSort('rating');
    expect(await StorageService.getPrefMovieSort()).toBe('rating');
  });

  it('overwrites a previously stored value', async () => {
    await StorageService.setPrefMovieSort('newest');
    await StorageService.setPrefMovieSort('rating');
    expect(await StorageService.getPrefMovieSort()).toBe('rating');
  });

  it('writes to the correct DEVICE_PREF_KEYS key', async () => {
    await StorageService.setPrefMovieSort('name');
    expect(store[DEVICE_PREF_KEYS.PREF_MOVIE_SORT]).toBe('name');
  });
});

// ── getPrefSeriesSort / setPrefSeriesSort ─────────────────────────────────────

describe('getPrefSeriesSort / setPrefSeriesSort', () => {
  it('returns null when nothing is stored', async () => {
    expect(await StorageService.getPrefSeriesSort()).toBeNull();
  });

  it('returns null for an unrecognised stored value', async () => {
    store[DEVICE_PREF_KEYS.PREF_SERIES_SORT] = 'alphabetical';
    expect(await StorageService.getPrefSeriesSort()).toBeNull();
  });

  it('round-trips "newest"', async () => {
    await StorageService.setPrefSeriesSort('newest');
    expect(await StorageService.getPrefSeriesSort()).toBe('newest');
  });

  it('round-trips "name"', async () => {
    await StorageService.setPrefSeriesSort('name');
    expect(await StorageService.getPrefSeriesSort()).toBe('name');
  });

  it('round-trips "rating"', async () => {
    await StorageService.setPrefSeriesSort('rating');
    expect(await StorageService.getPrefSeriesSort()).toBe('rating');
  });

  it('overwrites a previously stored value', async () => {
    await StorageService.setPrefSeriesSort('name');
    await StorageService.setPrefSeriesSort('newest');
    expect(await StorageService.getPrefSeriesSort()).toBe('newest');
  });

  it('writes to the correct DEVICE_PREF_KEYS key', async () => {
    await StorageService.setPrefSeriesSort('rating');
    expect(store[DEVICE_PREF_KEYS.PREF_SERIES_SORT]).toBe('rating');
  });
});

// ── getPrefLiveCat / setPrefLiveCat ───────────────────────────────────────────

describe('getPrefLiveCat / setPrefLiveCat', () => {
  it('returns null when nothing is stored', async () => {
    expect(await StorageService.getPrefLiveCat()).toBeNull();
  });

  it('round-trips an arbitrary category string', async () => {
    await StorageService.setPrefLiveCat('Sports');
    expect(await StorageService.getPrefLiveCat()).toBe('Sports');
  });

  it('round-trips a different category string', async () => {
    await StorageService.setPrefLiveCat('News');
    expect(await StorageService.getPrefLiveCat()).toBe('News');
  });

  it('overwrites a previously stored category', async () => {
    await StorageService.setPrefLiveCat('Sports');
    await StorageService.setPrefLiveCat('Movies');
    expect(await StorageService.getPrefLiveCat()).toBe('Movies');
  });

  it('writes to the correct DEVICE_PREF_KEYS key', async () => {
    await StorageService.setPrefLiveCat('Kids');
    expect(store[DEVICE_PREF_KEYS.PREF_LIVE_CAT]).toBe('Kids');
  });
});

// ── getPrefPlaybackSpeed / setPrefPlaybackSpeed ───────────────────────────────

describe('getPrefPlaybackSpeed / setPrefPlaybackSpeed', () => {
  it('returns null when nothing is stored', async () => {
    expect(await StorageService.getPrefPlaybackSpeed()).toBeNull();
  });

  it('returns null for a stored zero (invalid — must be > 0)', async () => {
    store[DEVICE_PREF_KEYS.PREF_PLAYBACK_SPEED] = '0';
    expect(await StorageService.getPrefPlaybackSpeed()).toBeNull();
  });

  it('returns null for a stored negative value', async () => {
    store[DEVICE_PREF_KEYS.PREF_PLAYBACK_SPEED] = '-1';
    expect(await StorageService.getPrefPlaybackSpeed()).toBeNull();
  });

  it('returns null for a non-numeric string', async () => {
    store[DEVICE_PREF_KEYS.PREF_PLAYBACK_SPEED] = 'fast';
    expect(await StorageService.getPrefPlaybackSpeed()).toBeNull();
  });

  it('round-trips 1.0 (normal speed)', async () => {
    await StorageService.setPrefPlaybackSpeed(1.0);
    expect(await StorageService.getPrefPlaybackSpeed()).toBe(1.0);
  });

  it('round-trips 1.5', async () => {
    await StorageService.setPrefPlaybackSpeed(1.5);
    expect(await StorageService.getPrefPlaybackSpeed()).toBe(1.5);
  });

  it('round-trips 2.0', async () => {
    await StorageService.setPrefPlaybackSpeed(2.0);
    expect(await StorageService.getPrefPlaybackSpeed()).toBe(2.0);
  });

  it('overwrites a previously stored speed', async () => {
    await StorageService.setPrefPlaybackSpeed(1.5);
    await StorageService.setPrefPlaybackSpeed(2.0);
    expect(await StorageService.getPrefPlaybackSpeed()).toBe(2.0);
  });

  it('writes the speed as a string to the correct DEVICE_PREF_KEYS key', async () => {
    await StorageService.setPrefPlaybackSpeed(1.25);
    expect(store[DEVICE_PREF_KEYS.PREF_PLAYBACK_SPEED]).toBe('1.25');
  });
});

// ── mock-factory completeness (double-check via makeStorageMock) ──────────────

describe('makeStorageMock includes all 8 new UI pref methods (#412)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { makeStorageMock } = require('./helpers/storageMock');

  it('has a stub function for each of the 8 new methods', () => {
    const mock = makeStorageMock();
    const newMethods = [
      'getPrefMovieSort',
      'setPrefMovieSort',
      'getPrefSeriesSort',
      'setPrefSeriesSort',
      'getPrefLiveCat',
      'setPrefLiveCat',
      'getPrefPlaybackSpeed',
      'setPrefPlaybackSpeed',
    ] as const;

    for (const method of newMethods) {
      expect(typeof mock[method]).toBe('function');
    }
  });

  it('default get stubs resolve to null (no preference set)', async () => {
    const mock = makeStorageMock();
    expect(await mock.getPrefMovieSort()).toBeNull();
    expect(await mock.getPrefSeriesSort()).toBeNull();
    expect(await mock.getPrefLiveCat()).toBeNull();
    expect(await mock.getPrefPlaybackSpeed()).toBeNull();
  });

  it('default set stubs resolve to undefined', async () => {
    const mock = makeStorageMock();
    expect(await mock.setPrefMovieSort('newest')).toBeUndefined();
    expect(await mock.setPrefSeriesSort('name')).toBeUndefined();
    expect(await mock.setPrefLiveCat('Sports')).toBeUndefined();
    expect(await mock.setPrefPlaybackSpeed(1.5)).toBeUndefined();
  });

  it('get overrides are applied correctly', async () => {
    const mock = makeStorageMock({
      getPrefMovieSort:     jest.fn().mockResolvedValue('rating'),
      getPrefSeriesSort:    jest.fn().mockResolvedValue('newest'),
      getPrefLiveCat:       jest.fn().mockResolvedValue('Kids'),
      getPrefPlaybackSpeed: jest.fn().mockResolvedValue(2.0),
    });
    expect(await mock.getPrefMovieSort()).toBe('rating');
    expect(await mock.getPrefSeriesSort()).toBe('newest');
    expect(await mock.getPrefLiveCat()).toBe('Kids');
    expect(await mock.getPrefPlaybackSpeed()).toBe(2.0);
  });
});
