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

/**
 * Scrape the first video ID from a YouTube search results page.
 *
 * YouTube embeds all video data in the page HTML as a JSON blob. We fetch the
 * search page with a desktop Chrome UA (same as the WebView) and pull the first
 * `"videoId":"XXXXXXXXXXX"` match. This avoids showing the YouTube search UI
 * when TMDB has no trailer entry for a title.
 */
async function youtubeSearchVideoId(query: string): Promise<string | null> {
  try {
    const url =
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query + ' official trailer')}` +
      `&sp=EgIQAQ%3D%3D`; // filter: videos only
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
          'AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/125.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    // YouTube inlines video IDs in multiple places; the first match is the top result.
    const match = html.match(/"videoId":"([A-Za-z0-9_-]{11})"/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Look up the official YouTube trailer video ID for a given title.
 *
 * Priority:
 *   1. TMDB official Trailer → any Trailer → official Teaser → any YouTube video
 *   2. YouTube search scrape (first result) — so callers always get a playable
 *      video ID instead of falling back to a search-results page.
 *
 * Returns null only when every attempt fails or the TMDB key is missing.
 */
export async function getTmdbTrailerVideoId(
  title: string,
  kind: 'movie' | 'tv',
): Promise<string | null> {
  if (!title) return null;

  const cacheKey = `${title}:${kind}`;
  const cached = cacheGet(cacheKey);
  if (cached.hit) return cached.value;

  let videoId: string | null = null;

  if (TMDB_KEY) {
    try {
      // ── 1. Search for the title on TMDB ────────────────────────────────────
      const searchRes = await fetch(
        `${BASE}/search/${kind}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&page=1`,
        { signal: AbortSignal.timeout(8_000) },
      );

      if (searchRes.ok) {
        const searchData = (await searchRes.json()) as { results: TmdbSearchResult[] };
        const tmdbId = searchData.results?.[0]?.id;

        if (tmdbId) {
          // ── 2. Fetch videos for that title ───────────────────────────────────
          const videosRes = await fetch(
            `${BASE}/${kind}/${tmdbId}/videos?api_key=${TMDB_KEY}`,
            { signal: AbortSignal.timeout(8_000) },
          );

          if (videosRes.ok) {
            const videosData = (await videosRes.json()) as { results: TmdbVideo[] };
            const yt = videosData.results.filter((v) => v.site === 'YouTube');

            const best =
              yt.find((v) => v.type === 'Trailer' && v.official) ??
              yt.find((v) => v.type === 'Trailer') ??
              yt.find((v) => v.type === 'Teaser' && v.official) ??
              yt.find((v) => v.type === 'Teaser') ??
              yt[0];

            videoId = best?.key ?? null;
          }
        }
      }
    } catch {
      // fall through to YouTube scrape
    }
  }

  // ── 3. YouTube search scrape fallback ──────────────────────────────────────
  // Runs when TMDB key is absent, the title isn't in TMDB yet, or TMDB has no
  // video entries — ensures users always see a playing trailer, never a search page.
  if (!videoId) {
    videoId = await youtubeSearchVideoId(title);
  }

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
