/**
 * Thin client for the /api/favourites endpoints.
 *
 * All push methods are fire-and-forget — they never throw so callers don't
 * need try/catch.  The AsyncStorage copy is always the source-of-truth for
 * the UI; the server is a durable backup that lets favourites survive
 * re-installs and travel across devices.
 *
 * Crucially, each push only updates its own category (PATCH semantics), so
 * toggling a channel favourite cannot clobber movie or series favourites that
 * were set on another device and not yet loaded locally.
 */

import type { FavoriteChannel, FavoriteMovie, FavoriteSeries } from '@/types';

const DOMAIN = process.env.EXPO_PUBLIC_DOMAIN ?? '';
function apiBase() {
  return DOMAIN ? `https://${DOMAIN}/api` : null;
}

export interface RemoteFavourites {
  channels: FavoriteChannel[];
  movies: FavoriteMovie[];
  series: FavoriteSeries[];
}

/** Fetch all favourites for a MAC from the server. Returns null on failure. */
export async function fetchRemoteFavourites(mac: string): Promise<RemoteFavourites | null> {
  const base = apiBase();
  if (!base || !mac) return null;
  try {
    const res = await fetch(`${base}/favourites?mac=${encodeURIComponent(mac)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      channels: Array.isArray(data.channels) ? (data.channels as FavoriteChannel[]) : [],
      movies: Array.isArray(data.movies) ? (data.movies as FavoriteMovie[]) : [],
      series: Array.isArray(data.series) ? (data.series as FavoriteSeries[]) : [],
    };
  } catch {
    return null;
  }
}

/**
 * Push only the channel favourites for this device's account.
 * Does not touch movies or series — safe to call from the Live TV tab alone.
 */
export async function pushRemoteChannels(mac: string, items: FavoriteChannel[]): Promise<void> {
  await patchCategory(mac, 'channels', items);
}

/**
 * Push only the movie favourites for this device's account.
 * Does not touch channels or series.
 */
export async function pushRemoteMovies(mac: string, items: FavoriteMovie[]): Promise<void> {
  await patchCategory(mac, 'movies', items);
}

/**
 * Push only the series favourites for this device's account.
 * Does not touch channels or movies.
 */
export async function pushRemoteSeries(mac: string, items: FavoriteSeries[]): Promise<void> {
  await patchCategory(mac, 'series', items);
}

async function patchCategory(mac: string, kind: string, items: unknown[]): Promise<void> {
  const base = apiBase();
  if (!base || !mac) return;
  try {
    await fetch(`${base}/favourites/${kind}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mac, items }),
    });
  } catch {
    // Offline — local state is still consistent; server will be updated next toggle.
  }
}

/**
 * Merge local and remote favourite lists.
 * Remote is treated as the canonical ordered set; any local-only items
 * (added while offline) are appended so they are not silently dropped.
 */
export function mergeFavourites<T extends { id: string }>(remote: T[], local: T[]): T[] {
  const remoteIds = new Set(remote.map((i) => i.id));
  const localOnly = local.filter((i) => !remoteIds.has(i.id));
  return [...remote, ...localOnly];
}
