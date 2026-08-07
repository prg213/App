/**
 * Shared utilities for computing watch-progress ratios from history entries.
 *
 * These are exported so both the screen components (via useMemo) and tests
 * import the same production algorithm — ensuring a change to the logic
 * automatically breaks the relevant test.
 */

import type { WatchHistoryEntry } from '@/types';

/**
 * Builds a map of  movieId → progress (0–1) from a list of watch-history
 * entries filtered to type === 'movie'.
 *
 * History is expected to be stored newest-first so the first occurrence of
 * each id wins (most-recently-watched position takes precedence).
 *
 * Guards:
 *   - `duration` is falsy (0, undefined, null) → entry is skipped (avoids ÷0)
 *   - `position` is null/undefined              → entry is skipped
 */
export function buildMovieProgressMap(
  history: WatchHistoryEntry[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of history) {
    if (!map.has(e.id) && e.position != null && e.duration) {
      map.set(e.id, e.position / e.duration);
    }
  }
  return map;
}

/**
 * Builds a map of  seriesId → progress (0–1) from a list of watch-history
 * entries filtered to type === 'series'.
 *
 * Series episode entries are keyed by `parentId` (the series id) so the
 * progress bar appears on the series poster card, not the individual episode.
 * Falls back to `id` when `parentId` is absent (stand-alone / mini-series).
 *
 * Same newest-first and falsy-duration guards as buildMovieProgressMap.
 */
export function buildSeriesProgressMap(
  history: WatchHistoryEntry[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of history) {
    const key = e.parentId ?? e.id;
    if (!map.has(key) && e.position != null && e.duration) {
      map.set(key, e.position / e.duration);
    }
  }
  return map;
}
