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

  try {
    // ── 1. Search for the title ──────────────────────────────────────────────
    const searchRes = await fetch(
      `${BASE}/search/${kind}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&page=1`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!searchRes.ok) return null;

    const searchData = (await searchRes.json()) as { results: TmdbSearchResult[] };
    const tmdbId = searchData.results?.[0]?.id;
    if (!tmdbId) return null;

    // ── 2. Fetch videos for that title ───────────────────────────────────────
    const videosRes = await fetch(
      `${BASE}/${kind}/${tmdbId}/videos?api_key=${TMDB_KEY}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!videosRes.ok) return null;

    const videosData = (await videosRes.json()) as { results: TmdbVideo[] };
    const yt = videosData.results.filter((v) => v.site === 'YouTube');

    // ── 3. Pick the best result ───────────────────────────────────────────────
    const best =
      yt.find((v) => v.type === 'Trailer' && v.official) ??
      yt.find((v) => v.type === 'Trailer') ??
      yt.find((v) => v.type === 'Teaser' && v.official) ??
      yt.find((v) => v.type === 'Teaser') ??
      yt[0];

    return best?.key ?? null;
  } catch {
    return null;
  }
}
