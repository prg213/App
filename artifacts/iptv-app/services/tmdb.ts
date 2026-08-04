/**
 * TMDB (The Movie Database) trailer lookup.
 *
 * Uses the free TMDB API v3 to search for a title, then fetches its video
 * list and returns the YouTube key of the best official trailer.
 *
 * Env var: EXPO_PUBLIC_TMDB_API_KEY
 */

const TMDB_KEY = process.env.EXPO_PUBLIC_TMDB_API_KEY ?? '';
const BASE = 'https://api.themoviedb.org/3';

// ── In-memory LRU cache ──────────────────────────────────────────────────────
// Keyed by "<title>:<kind>", value is the resolved YouTube video ID or null.
// A sentinel of null means "we looked and found nothing" — avoids re-fetching.
const CACHE_MAX = 200;
const trailerCache = new Map<string, string | null>();

function cacheGet(key: string): { hit: true; value: string | null } | { hit: false } {
  if (!trailerCache.has(key)) return { hit: false };
  // Move to end (most-recently-used) to maintain LRU order.
  const value = trailerCache.get(key)!;
  trailerCache.delete(key);
  trailerCache.set(key, value);
  return { hit: true, value };
}

function cacheSet(key: string, value: string | null): void {
  if (trailerCache.has(key)) trailerCache.delete(key);
  else if (trailerCache.size >= CACHE_MAX) {
    // Evict the oldest entry (first key in insertion order).
    const oldest = trailerCache.keys().next().value;
    if (oldest !== undefined) trailerCache.delete(oldest);
  }
  trailerCache.set(key, value);
}

/** Clear the trailer cache (call on logout or account switch). */
export function clearTmdbTrailerCache(): void {
  trailerCache.clear();
}

interface TmdbSearchResult {
  id: number;
}

interface TmdbVideo {
  key: string;       // YouTube video ID
  site: string;      // "YouTube" | "Vimeo" | …
  type: string;      // "Trailer" | "Teaser" | "Clip" | …
  official: boolean;
}

/**
 * Look up the official YouTube trailer video ID for a given title on TMDB.
 *
 * Priority: official Trailer → any Trailer → official Teaser → any YouTube video.
 * Returns null when the key is missing, TMDB can't find the title, or the
 * network request fails.
 */
export async function getTmdbTrailerVideoId(
  title: string,
  kind: 'movie' | 'tv',
): Promise<string | null> {
  if (!TMDB_KEY || !title) return null;

  const cacheKey = `${title}:${kind}`;
  const cached = cacheGet(cacheKey);
  if (cached.hit) return cached.value;

  try {
    // ── 1. Search for the title ──────────────────────────────────────────────
    const searchRes = await fetch(
      `${BASE}/search/${kind}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&page=1`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!searchRes.ok) { cacheSet(cacheKey, null); return null; }

    const searchData = (await searchRes.json()) as { results: TmdbSearchResult[] };
    const tmdbId = searchData.results?.[0]?.id;
    if (!tmdbId) { cacheSet(cacheKey, null); return null; }

    // ── 2. Fetch videos for that title ───────────────────────────────────────
    const videosRes = await fetch(
      `${BASE}/${kind}/${tmdbId}/videos?api_key=${TMDB_KEY}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!videosRes.ok) { cacheSet(cacheKey, null); return null; }

    const videosData = (await videosRes.json()) as { results: TmdbVideo[] };
    const yt = videosData.results.filter((v) => v.site === 'YouTube');

    // ── 3. Pick the best result ───────────────────────────────────────────────
    const best =
      yt.find((v) => v.type === 'Trailer' && v.official) ??
      yt.find((v) => v.type === 'Trailer') ??
      yt.find((v) => v.type === 'Teaser' && v.official) ??
      yt.find((v) => v.type === 'Teaser') ??
      yt[0];

    const videoId = best?.key ?? null;
    cacheSet(cacheKey, videoId);
    return videoId;
  } catch {
    return null;
  }
}
