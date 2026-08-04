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
const posterCache = new Map<string, string | null>();

function lruGet(cache: Map<string, string | null>, key: string): { hit: true; value: string | null } | { hit: false } {
  if (!cache.has(key)) return { hit: false };
  // Move to end (most-recently-used) to maintain LRU order.
  const value = cache.get(key)!;
  cache.delete(key);
  cache.set(key, value);
  return { hit: true, value };
}

function lruSet(cache: Map<string, string | null>, key: string, value: string | null): void {
  if (cache.has(key)) cache.delete(key);
  else if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

// Keep the old names as thin wrappers so existing callers are unaffected.
function cacheGet(key: string) { return lruGet(trailerCache, key); }
function cacheSet(key: string, value: string | null) { lruSet(trailerCache, key, value); }

/** Clear the trailer and poster caches (call on logout or account switch). */
export function clearTmdbTrailerCache(): void {
  trailerCache.clear();
  posterCache.clear();
}

interface TmdbSearchResult {
  id: number;
  poster_path?: string | null;
}

interface TmdbVideo {
  key: string;       // YouTube video ID
  site: string;      // "YouTube" | "Vimeo" | …
  type: string;      // "Trailer" | "Teaser" | "Clip" | …
  official: boolean;
}

const YT_SEARCH_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/125.0.0.0 Safari/537.36';

/**
 * Scrape the top N video IDs from a YouTube search results page.
 *
 * YouTube embeds all video data in the page HTML as a JSON blob. We fetch the
 * search page with a desktop Chrome UA and pull up to `max` unique video IDs.
 * Returning multiple candidates lets the player auto-advance when a video has
 * embedding disabled (error 150/152).
 */
async function youtubeSearchVideoIds(query: string, max = 6): Promise<string[]> {
  try {
    const url =
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query + ' official trailer')}` +
      `&sp=EgIQAQ%3D%3D`; // filter: videos only
    const res = await fetch(url, {
      headers: { 'User-Agent': YT_SEARCH_UA, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const m of html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)) {
      if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
      if (ids.length >= max) break;
    }
    return ids;
  } catch {
    return [];
  }
}

// Kept for backward compat — callers that only want one ID.
async function youtubeSearchVideoId(query: string): Promise<string | null> {
  const ids = await youtubeSearchVideoIds(query, 1);
  return ids[0] ?? null;
}

// ── Candidates cache ──────────────────────────────────────────────────────────
// Stores ordered arrays of YouTube video IDs so TrailerModal can retry on error.
const candidatesCache = new Map<string, string[]>();

/**
 * Return an ordered list of YouTube video ID candidates for a title.
 *
 * Priority inside the list:
 *   1. TMDB official Trailer(s) → any Trailer → official Teaser → any YouTube video
 *   2. YouTube search scrape top results (up to 6)
 *
 * Having multiple candidates lets the player auto-advance when a video has
 * embedding disabled (YouTube error 150/152) without closing the modal.
 *
 * Returns [] when every attempt fails or both keys are missing.
 */
export async function getTmdbTrailerCandidates(
  title: string,
  kind: 'movie' | 'tv',
): Promise<string[]> {
  if (!title) return [];

  const cacheKey = `cands:${title}:${kind}`;
  const cached = candidatesCache.get(cacheKey);
  if (cached) return cached;

  const seen = new Set<string>();
  const push = (id: string) => { if (id && !seen.has(id)) { seen.add(id); candidates.push(id); } };
  const candidates: string[] = [];

  if (TMDB_KEY) {
    try {
      const searchRes = await fetch(
        `${BASE}/search/${kind}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&page=1`,
        { signal: AbortSignal.timeout(8_000) },
      );
      if (searchRes.ok) {
        const searchData = (await searchRes.json()) as { results: TmdbSearchResult[] };
        const tmdbId = searchData.results?.[0]?.id;
        if (tmdbId) {
          const videosRes = await fetch(
            `${BASE}/${kind}/${tmdbId}/videos?api_key=${TMDB_KEY}`,
            { signal: AbortSignal.timeout(8_000) },
          );
          if (videosRes.ok) {
            const videosData = (await videosRes.json()) as { results: TmdbVideo[] };
            const yt = videosData.results.filter((v) => v.site === 'YouTube');
            // Ranked order: official trailer → any trailer → official teaser → rest
            const ranked = [
              ...yt.filter((v) => v.type === 'Trailer' && v.official),
              ...yt.filter((v) => v.type === 'Trailer' && !v.official),
              ...yt.filter((v) => v.type === 'Teaser' && v.official),
              ...yt.filter((v) => v.type === 'Teaser' && !v.official),
              ...yt.filter((v) => v.type !== 'Trailer' && v.type !== 'Teaser'),
            ];
            ranked.forEach((v) => push(v.key));
          }
        }
      }
    } catch {
      // fall through to scrape
    }
  }

  // YouTube scrape gives us more candidates when TMDB has none or few
  const scraped = await youtubeSearchVideoIds(title, 6);
  scraped.forEach(push);

  if (candidatesCache.size >= CACHE_MAX) {
    const oldest = candidatesCache.keys().next().value;
    if (oldest !== undefined) candidatesCache.delete(oldest);
  }
  candidatesCache.set(cacheKey, candidates);
  return candidates;
}

/**
 * Look up the official YouTube trailer video ID for a given title.
 *
 * @deprecated Prefer getTmdbTrailerCandidates — it returns multiple IDs so the
 * player can auto-retry when a video has embedding disabled.
 */
export async function getTmdbTrailerVideoId(
  title: string,
  kind: 'movie' | 'tv',
): Promise<string | null> {
  if (!title) return null;

  const cacheKey = `${title}:${kind}`;
  const cached = cacheGet(cacheKey);
  if (cached.hit) return cached.value;

  const candidates = await getTmdbTrailerCandidates(title, kind);
  const videoId = candidates[0] ?? null;
  cacheSet(cacheKey, videoId);
  return videoId;
}

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

/**
 * Look up the TMDB poster URL for a given title.
 *
 * Returns a full `https://image.tmdb.org/t/p/w500/{poster_path}` URL, or null
 * when the key is missing, TMDB can't find the title, or the network fails.
 * Results are cached with the same LRU strategy as the trailer lookup.
 */
export async function getTmdbPosterUrl(
  title: string,
  kind: 'movie' | 'tv',
): Promise<string | null> {
  if (!TMDB_KEY || !title) return null;

  const cacheKey = `poster:${title}:${kind}`;
  const cached = lruGet(posterCache, cacheKey);
  if (cached.hit) return cached.value;

  try {
    const searchRes = await fetch(
      `${BASE}/search/${kind}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&page=1`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!searchRes.ok) { lruSet(posterCache, cacheKey, null); return null; }

    const searchData = (await searchRes.json()) as { results: TmdbSearchResult[] };
    const result = searchData.results?.[0];
    if (!result?.poster_path) { lruSet(posterCache, cacheKey, null); return null; }

    const url = `${TMDB_IMAGE_BASE}${result.poster_path}`;
    lruSet(posterCache, cacheKey, url);
    return url;
  } catch {
    return null;
  }
}
