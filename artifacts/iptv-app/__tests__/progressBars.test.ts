/**
 * Tests for the Recently Watched progress bar logic in the Movies and Series screens.
 *
 * The progress bars depend on:
 *   1. StorageService.getWatchHistory() returning the persisted entries.
 *   2. buildMovieProgressMap / buildSeriesProgressMap (imported from the real
 *      production utility) producing correct 0–1 ratios from those entries.
 *
 * Importing the production functions means any change to the algorithm that
 * would break the progress bars will also break these tests.
 *
 * Scenarios covered:
 *   - Normal progress:     position / duration in (0, 1)
 *   - Zero position:       progress = 0  (bar shown but empty — correct)
 *   - Position at end:     progress = 1  (bar full)
 *   - Position > duration: progress > 1  (UI should clamp; algorithm doesn't crash)
 *   - Zero duration:       skipped       (falsy guard prevents ÷0)
 *   - Undefined duration:  skipped       (same falsy guard)
 *   - Undefined position:  skipped       (null-check guard)
 *   - Newest-first wins:   first id occurrence used; later duplicates ignored
 *   - Series parentId key: entry keyed by parentId, not episode id
 *   - getWatchHistory:     AsyncStorage round-trip returns stored data
 *   - Focus re-fetch:      second call to getWatchHistory reflects new entries
 *                          and the progressMap built from fresh data is correct
 */

// ── AsyncStorage mock ──────────────────────────────────────────────────────────

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

// Import the REAL production functions — tests break if the algorithm changes.
import { buildMovieProgressMap, buildSeriesProgressMap } from '../utils/progressMap';
import { StorageService } from '../services/storage';
import type { WatchHistoryEntry } from '../types';

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(store).forEach((k) => delete store[k]);
});

// ─────────────────────────────────────────────────────────────────────────────
// buildMovieProgressMap  (production utility, same function used by movies.tsx)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildMovieProgressMap', () => {
  it('returns correct 0–1 ratio for a mid-progress entry', () => {
    const history: WatchHistoryEntry[] = [
      { id: 'm1', title: 'Dune', type: 'movie', position: 30, duration: 120, timestamp: 1 },
    ];
    const map = buildMovieProgressMap(history);
    expect(map.get('m1')).toBeCloseTo(0.25);
  });

  it('returns 0 when position is 0 (bar visible but empty — expected, not a blank bug)', () => {
    const history: WatchHistoryEntry[] = [
      { id: 'm2', title: 'Interstellar', type: 'movie', position: 0, duration: 90, timestamp: 1 },
    ];
    const map = buildMovieProgressMap(history);
    expect(map.get('m2')).toBe(0);
    // Key exists — UI receives 0 and renders the bar at 0 width, not absent
    expect(map.has('m2')).toBe(true);
  });

  it('returns 1 when position equals duration (film fully watched)', () => {
    const history: WatchHistoryEntry[] = [
      { id: 'm3', title: 'Inception', type: 'movie', position: 100, duration: 100, timestamp: 1 },
    ];
    const map = buildMovieProgressMap(history);
    expect(map.get('m3')).toBe(1);
  });

  it('returns > 1 when position exceeds duration (no crash; UI is expected to clamp to 1)', () => {
    const history: WatchHistoryEntry[] = [
      { id: 'm4', title: 'Tenet', type: 'movie', position: 150, duration: 100, timestamp: 1 },
    ];
    const map = buildMovieProgressMap(history);
    expect(map.get('m4')).toBeGreaterThan(1);
    // The production card clamps to Math.min(progress, 1) when rendering bar width.
    // This test confirms the utility itself doesn't throw or return NaN.
    expect(Number.isFinite(map.get('m4')!)).toBe(true);
  });

  it('skips entry when duration is 0 — division-by-zero guard (falsy check)', () => {
    const history: WatchHistoryEntry[] = [
      { id: 'm5', title: 'Unknown', type: 'movie', position: 10, duration: 0, timestamp: 1 },
    ];
    const map = buildMovieProgressMap(history);
    expect(map.has('m5')).toBe(false);
  });

  it('skips entry when duration is undefined', () => {
    const history: WatchHistoryEntry[] = [
      { id: 'm6', title: 'No Duration', type: 'movie', position: 10, duration: undefined, timestamp: 1 },
    ];
    const map = buildMovieProgressMap(history);
    expect(map.has('m6')).toBe(false);
  });

  it('skips entry when position is undefined', () => {
    const history: WatchHistoryEntry[] = [
      { id: 'm7', title: 'No Position', type: 'movie', position: undefined, duration: 90, timestamp: 1 },
    ];
    const map = buildMovieProgressMap(history);
    expect(map.has('m7')).toBe(false);
  });

  it('uses the first (newest) entry when the same id appears more than once', () => {
    // History is stored newest-first; the first occurrence must win.
    const history: WatchHistoryEntry[] = [
      { id: 'm8', title: 'Film', type: 'movie', position: 60, duration: 120, timestamp: 200 },
      { id: 'm8', title: 'Film', type: 'movie', position: 10, duration: 120, timestamp: 100 },
    ];
    const map = buildMovieProgressMap(history);
    expect(map.get('m8')).toBeCloseTo(0.5);  // 60/120, not 10/120
    expect(map.size).toBe(1);
  });

  it('handles an empty history array without throwing', () => {
    expect(() => buildMovieProgressMap([])).not.toThrow();
    expect(buildMovieProgressMap([]).size).toBe(0);
  });

  it('handles multiple different movies independently', () => {
    const history: WatchHistoryEntry[] = [
      { id: 'a', title: 'A', type: 'movie', position: 10, duration: 100, timestamp: 1 },
      { id: 'b', title: 'B', type: 'movie', position: 50, duration: 100, timestamp: 1 },
    ];
    const map = buildMovieProgressMap(history);
    expect(map.get('a')).toBeCloseTo(0.1);
    expect(map.get('b')).toBeCloseTo(0.5);
    expect(map.size).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildSeriesProgressMap  (production utility, same function used by series.tsx)
// ─────────────────────────────────────────────────────────────────────────────

describe('buildSeriesProgressMap', () => {
  it('keys by parentId so progress appears on the series poster, not the episode', () => {
    const history: WatchHistoryEntry[] = [
      {
        id: 'ep1',
        parentId: 'series1',
        title: 'Episode 1',
        type: 'series',
        position: 20,
        duration: 40,
        timestamp: 1,
      },
    ];
    const map = buildSeriesProgressMap(history);
    expect(map.get('series1')).toBeCloseTo(0.5);
    // Episode id must NOT be used as a card key
    expect(map.has('ep1')).toBe(false);
  });

  it('falls back to id when parentId is absent (stand-alone / mini-series)', () => {
    const history: WatchHistoryEntry[] = [
      { id: 's1', title: 'Mini-series', type: 'series', position: 15, duration: 30, timestamp: 1 },
    ];
    const map = buildSeriesProgressMap(history);
    expect(map.get('s1')).toBeCloseTo(0.5);
  });

  it('uses the most-recent episode when multiple episodes share the same parentId', () => {
    const history: WatchHistoryEntry[] = [
      // ep3 is newest (timestamp 300) and must win
      { id: 'ep3', parentId: 'seriesX', title: 'Ep 3', type: 'series', position: 30, duration: 60, timestamp: 300 },
      { id: 'ep2', parentId: 'seriesX', title: 'Ep 2', type: 'series', position: 10, duration: 60, timestamp: 200 },
    ];
    const map = buildSeriesProgressMap(history);
    expect(map.get('seriesX')).toBeCloseTo(0.5);  // ep3: 30/60
    expect(map.size).toBe(1);
  });

  it('skips entry when duration is 0 — division-by-zero guard', () => {
    const history: WatchHistoryEntry[] = [
      { id: 'ep0', parentId: 'seriesY', title: 'Ep 0', type: 'series', position: 5, duration: 0, timestamp: 1 },
    ];
    const map = buildSeriesProgressMap(history);
    expect(map.has('seriesY')).toBe(false);
  });

  it('skips entry when duration is undefined', () => {
    const history: WatchHistoryEntry[] = [
      { id: 'epA', parentId: 'seriesZ', title: 'Ep A', type: 'series', position: 5, duration: undefined, timestamp: 1 },
    ];
    const map = buildSeriesProgressMap(history);
    expect(map.has('seriesZ')).toBe(false);
  });

  it('skips entry when position is undefined', () => {
    const history: WatchHistoryEntry[] = [
      { id: 'epB', parentId: 'seriesW', title: 'Ep B', type: 'series', position: undefined, duration: 60, timestamp: 1 },
    ];
    const map = buildSeriesProgressMap(history);
    expect(map.has('seriesW')).toBe(false);
  });

  it('returns 0 when position is 0', () => {
    const history: WatchHistoryEntry[] = [
      { id: 'ep0pos', parentId: 's0', title: 'Ep', type: 'series', position: 0, duration: 60, timestamp: 1 },
    ];
    const map = buildSeriesProgressMap(history);
    expect(map.get('s0')).toBe(0);
    expect(map.has('s0')).toBe(true);
  });

  it('returns 1 when episode is fully watched', () => {
    const history: WatchHistoryEntry[] = [
      { id: 'epFull', parentId: 'sFull', title: 'Ep', type: 'series', position: 60, duration: 60, timestamp: 1 },
    ];
    const map = buildSeriesProgressMap(history);
    expect(map.get('sFull')).toBe(1);
  });

  it('handles an empty history array without throwing', () => {
    expect(() => buildSeriesProgressMap([])).not.toThrow();
    expect(buildSeriesProgressMap([]).size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// StorageService.getWatchHistory — AsyncStorage round-trip + focus re-fetch
// ─────────────────────────────────────────────────────────────────────────────

describe('StorageService.getWatchHistory and focus re-fetch', () => {
  it('returns an empty array when storage is empty', async () => {
    const result = await StorageService.getWatchHistory();
    expect(result).toEqual([]);
  });

  it('returns stored entries after addToHistory', async () => {
    const entry: WatchHistoryEntry = {
      id: 'movie-42',
      title: 'The Matrix',
      type: 'movie',
      position: 45,
      duration: 136,
      timestamp: 1000,
    };
    await StorageService.addToHistory(entry);
    const result = await StorageService.getWatchHistory();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('movie-42');
    expect(result[0].position).toBe(45);
    expect(result[0].duration).toBe(136);
  });

  it('re-fetching after a new entry reflects updated storage (simulates useFocusEffect re-fetch)', async () => {
    // First call — storage empty (screen mounts while nothing watched yet)
    const before = await StorageService.getWatchHistory();
    expect(before).toHaveLength(0);

    // User watches something while screen is inactive
    await StorageService.addToHistory({
      id: 'ep-new',
      parentId: 'series-7',
      title: 'New Episode',
      type: 'series',
      position: 12,
      duration: 24,
      timestamp: 2000,
    });

    // useFocusEffect fires when screen regains focus → getWatchHistory called again
    const after = await StorageService.getWatchHistory();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe('ep-new');

    // The refreshed history produces the correct progress map
    const seriesOnly = after.filter((e) => e.type === 'series');
    const map = buildSeriesProgressMap(seriesOnly);
    expect(map.get('series-7')).toBeCloseTo(0.5);
  });

  it('progress map built from re-fetched history reflects an updated position after background play', async () => {
    // User watched 25% of a film before backgrounding the app
    await StorageService.addToHistory({
      id: 'bg-movie',
      title: 'Background Film',
      type: 'movie',
      position: 30,
      duration: 120,
      timestamp: 1000,
    });

    const firstFetch = await StorageService.getWatchHistory();
    const mapBefore = buildMovieProgressMap(firstFetch.filter((e) => e.type === 'movie'));
    expect(mapBefore.get('bg-movie')).toBeCloseTo(0.25);

    // User returns from background and continues the film (addToHistory deduplicates,
    // placing the updated entry at the front so it wins in the progressMap)
    await StorageService.addToHistory({
      id: 'bg-movie',
      title: 'Background Film',
      type: 'movie',
      position: 90,
      duration: 120,
      timestamp: 2000,
    });

    // useFocusEffect fires → getWatchHistory called again
    const secondFetch = await StorageService.getWatchHistory();
    const mapAfter = buildMovieProgressMap(secondFetch.filter((e) => e.type === 'movie'));

    // Progress bar must reflect resumed position, not the stale one
    expect(mapAfter.get('bg-movie')).toBeCloseTo(0.75);
  });

  it('filters type correctly so series history never bleeds into movie progress map', async () => {
    await StorageService.addToHistory({
      id: 'movie-1', title: 'Film', type: 'movie', position: 10, duration: 100, timestamp: 1,
    });
    await StorageService.addToHistory({
      id: 'ep-1', parentId: 'series-1', title: 'Episode', type: 'series', position: 5, duration: 50, timestamp: 2,
    });

    const all = await StorageService.getWatchHistory();
    const movieMap  = buildMovieProgressMap(all.filter((e) => e.type === 'movie'));
    const seriesMap = buildSeriesProgressMap(all.filter((e) => e.type === 'series'));

    expect(movieMap.has('movie-1')).toBe(true);
    expect(movieMap.has('series-1')).toBe(false);
    expect(seriesMap.has('series-1')).toBe(true);
    expect(seriesMap.has('movie-1')).toBe(false);
  });

  it('addToHistory deduplicates by id so a resumed film appears exactly once', async () => {
    await StorageService.addToHistory({
      id: 'film-x', title: 'Film X', type: 'movie', position: 20, duration: 100, timestamp: 1,
    });
    await StorageService.addToHistory({
      id: 'film-x', title: 'Film X', type: 'movie', position: 80, duration: 100, timestamp: 2,
    });

    const result = await StorageService.getWatchHistory();
    expect(result).toHaveLength(1);
    expect(result[0].position).toBe(80); // most recent update wins
  });

  it('history is capped at 100 entries so storage never grows unbounded', async () => {
    for (let i = 0; i < 100; i++) {
      await StorageService.addToHistory({
        id: `m${i}`, title: `Movie ${i}`, type: 'movie', position: i, duration: 100, timestamp: i,
      });
    }
    await StorageService.addToHistory({
      id: 'm100', title: 'Movie 100', type: 'movie', position: 50, duration: 100, timestamp: 200,
    });

    const result = await StorageService.getWatchHistory();
    expect(result).toHaveLength(100);
    expect(result[0].id).toBe('m100'); // newest first
  });
});
