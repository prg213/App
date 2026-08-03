import type { Channel, Category, Movie, Series, Season, Episode } from '@/types';

interface Creds {
  host: string;
  username: string;
  password: string;
}

function baseUrl(host: string) {
  // Normalise scheme to lowercase — Android's media player rejects "Https://"
  const normalised = host.replace(/^([a-zA-Z][a-zA-Z0-9+\-.]*):\/\//, (_, scheme) => `${scheme.toLowerCase()}://`);
  return normalised.endsWith('/') ? normalised.slice(0, -1) : normalised;
}

async function call<T>(
  creds: Creds,
  action: string,
  params: Record<string, string> = {},
): Promise<T> {
  const url = new URL(`${baseUrl(creds.host)}/player_api.php`);
  url.searchParams.set('username', creds.username);
  url.searchParams.set('password', creds.password);
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Xtream API ${action} returned ${res.status}`);
  return res.json() as Promise<T>;
}

// ─── Live TV ────────────────────────────────────────────────────────────────

export async function getXtreamLiveCategories(
  creds: Creds,
): Promise<Category[]> {
  const data = await call<
    Array<{ category_id: string; category_name: string }>
  >(creds, 'get_live_categories');
  return (data ?? []).map((c) => ({ id: c.category_id, name: c.category_name }));
}

export async function getXtreamLiveStreams(
  creds: Creds,
  categoryId?: string,
): Promise<Channel[]> {
  const params: Record<string, string> = {};
  if (categoryId) params.category_id = categoryId;

  const data = await call<
    Array<{
      stream_id: number;
      name: string;
      stream_icon?: string;
      category_id: string;
      epg_channel_id?: string;
      num: number;
      tv_archive?: number;
      tv_archive_duration?: number;
    }>
  >(creds, 'get_live_streams', params);

  const base = baseUrl(creds.host);
  return (data ?? []).map((s) => ({
    id: String(s.stream_id),
    name: s.name,
    logo: s.stream_icon || undefined,
    groupTitle: s.category_id,
    streamUrl: `${base}/${creds.username}/${creds.password}/${s.stream_id}`,
    epgId: s.epg_channel_id || undefined,
    num: s.num,
    tvArchive: Number(s.tv_archive ?? 0),
    tvArchiveDuration: Number(s.tv_archive_duration ?? 0),
  }));
}

// ─── Catch-up / Archive ──────────────────────────────────────────────────────

/** Decode base64 strings returned by get_simple_data_table (titles/descriptions). */
function b64decode(s: string | undefined): string {
  if (!s) return '';
  try {
    // atob is available in React Native (Hermes) and modern JS runtimes
    return decodeURIComponent(escape(atob(s)));
  } catch {
    return s;
  }
}

/** Archive EPG for one channel — programmes that can be replayed. */
export async function getXtreamCatchupEpg(
  creds: Creds,
  streamId: string,
): Promise<import('@/types').CatchupProgram[]> {
  const data = await call<{
    epg_listings?: Array<{
      id: string;
      title?: string;
      description?: string;
      start: string;               // "2026-07-26 14:00:00" (server-local)
      end?: string;
      stop_timestamp?: string;     // unix seconds
      start_timestamp?: string;    // unix seconds
      has_archive?: number;
      now_playing?: number;
    }>;
  }>(creds, 'get_simple_data_table', { stream_id: streamId });

  return (data?.epg_listings ?? [])
    .map((e) => {
      const startMs = Number(e.start_timestamp) * 1000;
      const endMs = Number(e.stop_timestamp) * 1000;
      return {
        id: e.id,
        title: b64decode(e.title) || 'Untitled',
        description: b64decode(e.description) || undefined,
        start: new Date(startMs),
        end: new Date(endMs),
        hasArchive: Number(e.has_archive ?? 0) === 1,
        serverStart: e.start ?? '',
        startTimestamp: Number(e.start_timestamp ?? 0),
      };
    })
    .filter((p) =>
      Number.isFinite(p.start.getTime()) &&
      Number.isFinite(p.end.getTime()) &&
      // serverStart must look like "YYYY-MM-DD HH:MM[:SS]" to build a valid timeshift URL
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(p.serverStart),
    );
}

/**
 * Timeshift playback URL.
 *
 * Tries the two most common Xtream catchup formats in order — the caller
 * receives both so the player can fall back if the first returns 404.
 *
 * Format A (path-based, XC Panel / Xtream UI):
 *   {host}/{user}/{pass}/timeshift/{streamId}/{duration}/{YYYY-MM-DD}:{HH}-{MM}.m3u8
 *
 * Format B (query-param, used by many UK/EU providers):
 *   {host}/{user}/{pass}/{streamId}?utc={startEpoch}&lutc={endEpoch}
 *
 * IMPORTANT: `serverStart` is the raw server-local "YYYY-MM-DD HH:MM:SS" string
 * from get_simple_data_table. String ops only — never converted through JS Date.
 */
export function getXtreamCatchupUrls(
  creds: Creds,
  streamId: string,
  serverStart: string,
  durationMinutes: number,
  startTimestamp: number,   // unix seconds from get_simple_data_table
): string[] {
  const [d, t] = serverStart.split(' ');
  const [hh, mm] = (t ?? '').split(':');
  const startFmt = `${d}:${hh}-${mm}`; // "2026-07-24:00-05"
  const base = baseUrl(creds.host);
  const u = encodeURIComponent(creds.username);
  const p = encodeURIComponent(creds.password);
  const endTs = startTimestamp + durationMinutes * 60;

  return [
    // Format B first — many providers that 404 on /timeshift/ support this
    `${base}/${u}/${p}/${streamId}?utc=${startTimestamp}&lutc=${endTs}`,
    // Format A — path-based timeshift
    `${base}/${u}/${p}/timeshift/${streamId}/${durationMinutes}/${startFmt}.m3u8`,
  ];
}

/** @deprecated use getXtreamCatchupUrls */
export function getXtreamCatchupUrl(
  creds: Creds,
  streamId: string,
  serverStart: string,
  durationMinutes: number,
): string {
  return getXtreamCatchupUrls(creds, streamId, serverStart, durationMinutes, 0)[1];
}

// ─── VOD / Movies ────────────────────────────────────────────────────────────

export async function getXtreamVodCategories(
  creds: Creds,
): Promise<Category[]> {
  const data = await call<
    Array<{ category_id: string; category_name: string }>
  >(creds, 'get_vod_categories');
  return (data ?? []).map((c) => ({ id: c.category_id, name: c.category_name }));
}

export async function getXtreamVodStreams(
  creds: Creds,
  categoryId?: string,
): Promise<Movie[]> {
  const params: Record<string, string> = {};
  if (categoryId) params.category_id = categoryId;

  const data = await call<
    Array<{
      stream_id: number;
      name: string;
      stream_icon?: string;
      category_id: string;
      container_extension: string;
      rating?: string;
      plot?: string;
      cast?: string;
      director?: string;
      genre?: string;
      releasedate?: string;
      duration?: string;
      added?: string | number;
    }>
  >(creds, 'get_vod_streams', params);

  return (data ?? []).map((m) => ({
    id: String(m.stream_id),
    name: m.name,
    categoryId: m.category_id,
    streamId: String(m.stream_id),
    cover: m.stream_icon || undefined,
    plot: m.plot || undefined,
    cast: m.cast || undefined,
    director: m.director || undefined,
    genre: m.genre || undefined,
    releaseDate: m.releasedate || undefined,
    rating: m.rating || undefined,
    duration: m.duration || undefined,
    containerExtension: m.container_extension || 'mp4',
    added: m.added ? Number(m.added) : undefined,
  }));
}

export async function getXtreamVodInfo(
  creds: Creds,
  vodId: string,
): Promise<Movie | null> {
  try {
    const data = await call<{
      info?: {
        name?: string;
        cover_big?: string;
        plot?: string;
        cast?: string;
        director?: string;
        genre?: string;
        releasedate?: string;
        rating?: string;
        duration_secs?: number;
        youtube_trailer?: string;
      };
      movie_data?: {
        stream_id: number;
        name: string;
        stream_icon?: string;
        category_id: string;
        container_extension: string;
      };
    }>(creds, 'get_vod_info', { vod_id: vodId });

    if (!data?.movie_data) return null;
    const { info, movie_data } = data;
    return {
      id: String(movie_data.stream_id),
      name: movie_data.name,
      categoryId: movie_data.category_id,
      streamId: String(movie_data.stream_id),
      cover: info?.cover_big || movie_data.stream_icon || undefined,
      plot: info?.plot || undefined,
      cast: info?.cast || undefined,
      director: info?.director || undefined,
      genre: info?.genre || undefined,
      releaseDate: info?.releasedate || undefined,
      rating: info?.rating || undefined,
      duration: info?.duration_secs
        ? `${Math.floor(info.duration_secs / 60)} min`
        : undefined,
      containerExtension: movie_data.container_extension || 'mp4',
      trailerUrl: info?.youtube_trailer || undefined,
    };
  } catch {
    return null;
  }
}

export function getXtreamVodUrl(
  creds: Creds,
  streamId: string,
  ext: string,
): string {
  return `${baseUrl(creds.host)}/movie/${creds.username}/${creds.password}/${streamId}.${ext}`;
}

// ─── Series ─────────────────────────────────────────────────────────────────

export async function getXtreamSeriesCategories(
  creds: Creds,
): Promise<Category[]> {
  const data = await call<
    Array<{ category_id: string; category_name: string }>
  >(creds, 'get_series_categories');
  return (data ?? []).map((c) => ({ id: c.category_id, name: c.category_name }));
}

export async function getXtreamSeries(
  creds: Creds,
  categoryId?: string,
): Promise<Series[]> {
  const params: Record<string, string> = {};
  if (categoryId) params.category_id = categoryId;

  const data = await call<
    Array<{
      series_id: number;
      name: string;
      cover?: string;
      plot?: string;
      cast?: string;
      director?: string;
      genre?: string;
      releaseDate?: string;
      rating?: string;
      category_id: string;
      last_modified?: string | number;
    }>
  >(creds, 'get_series', params);

  return (data ?? []).map((s) => ({
    id: String(s.series_id),
    name: s.name,
    cover: s.cover || undefined,
    plot: s.plot || undefined,
    cast: s.cast || undefined,
    director: s.director || undefined,
    genre: s.genre || undefined,
    releaseDate: s.releaseDate || undefined,
    rating: s.rating || undefined,
    categoryId: s.category_id,
    added: s.last_modified ? Number(s.last_modified) : undefined,
  }));
}

export async function getXtreamSeriesInfo(
  creds: Creds,
  seriesId: string,
): Promise<{ series: Series; seasons: Season[] }> {
  const data = await call<{
    info?: {
      name: string;
      cover?: string;
      plot?: string;
      cast?: string;
      director?: string;
      genre?: string;
      releaseDate?: string;
      rating?: string;
      category_id?: string;
      youtube_trailer?: string;
    };
    episodes?: Record<
      string,
      Array<{
        id: string;
        title: string;
        episode_num: number;
        season: number;
        container_extension: string;
        info?: {
          plot?: string;
          duration?: string;
          rating?: string;
          releasedate?: string;
          movie_image?: string;
        };
      }>
    >;
  }>(creds, 'get_series_info', { series_id: seriesId });

  const series: Series = {
    id: seriesId,
    name: data?.info?.name ?? 'Unknown',
    cover: data?.info?.cover || undefined,
    plot: data?.info?.plot || undefined,
    cast: data?.info?.cast || undefined,
    director: data?.info?.director || undefined,
    genre: data?.info?.genre || undefined,
    releaseDate: data?.info?.releaseDate || undefined,
    rating: data?.info?.rating || undefined,
    categoryId: data?.info?.category_id ?? '',
    trailerUrl: data?.info?.youtube_trailer || undefined,
  };

  const seasons: Season[] = [];
  if (data?.episodes) {
    for (const [sNum, eps] of Object.entries(data.episodes)) {
      const seasonNumber = parseInt(sNum, 10);
      seasons.push({
        id: seasonNumber,
        name: `Season ${seasonNumber}`,
        seasonNumber,
        episodes: eps.map(
          (ep): Episode => ({
            id: ep.id,
            title: ep.title || `Episode ${ep.episode_num}`,
            episodeNum: ep.episode_num,
            seasonNum: ep.season,
            streamId: ep.id,
            containerExtension: ep.container_extension || 'mp4',
            info: ep.info
              ? {
                  plot: ep.info.plot,
                  duration: ep.info.duration,
                  rating: ep.info.rating,
                  releaseDate: ep.info.releasedate,
                  cover: ep.info.movie_image,
                }
              : undefined,
          }),
        ),
      });
    }
  }

  seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
  return { series, seasons };
}

export function getXtreamSeriesUrl(
  creds: Creds,
  episodeId: string,
  ext: string,
): string {
  return `${baseUrl(creds.host)}/series/${creds.username}/${creds.password}/${episodeId}.${ext}`;
}

// ─── EPG ─────────────────────────────────────────────────────────────────────

/** Full XMLTV feed URL — parse with epgService.fetchAndParseXmltv() */
export function getXtreamXmltvUrl(creds: Creds): string {
  return `${baseUrl(creds.host)}/xmltv.php?username=${encodeURIComponent(creds.username)}&password=${encodeURIComponent(creds.password)}`;
}

// ─── Account Info ─────────────────────────────────────────────────────────────

export interface XtreamAccountInfo {
  expDate: string | null;   // formatted locale date string
  status: string | null;
  maxConnections: number | null;
  activeConnections: number | null;
}

/** Fetches user_info from the Xtream Codes API (no action param). */
export async function getXtreamAccountInfo(creds: Creds): Promise<XtreamAccountInfo> {
  const url = new URL(`${baseUrl(creds.host)}/player_api.php`);
  url.searchParams.set('username', creds.username);
  url.searchParams.set('password', creds.password);
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Account info ${res.status}`);
  const data = await res.json();
  const info = data?.user_info ?? {};
  const expTs = info.exp_date ? parseInt(info.exp_date, 10) : null;
  return {
    expDate: expTs ? new Date(expTs * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null,
    status: info.status ?? null,
    maxConnections: info.max_connections != null ? parseInt(info.max_connections, 10) : null,
    activeConnections: info.active_cons != null ? parseInt(info.active_cons, 10) : null,
  };
}

/**
 * Tries to extract Xtream credentials from an M3U URL that was generated by
 * an Xtream Codes server (e.g. /get.php?username=X&password=Y&...).
 * Returns null if the URL doesn't follow that pattern.
 */
export function parseXtreamCredsFromM3u(m3uUrl: string): Creds | null {
  try {
    const u = new URL(m3uUrl);
    const username = u.searchParams.get('username');
    const password = u.searchParams.get('password');
    if (username && password) {
      return { host: `${u.protocol}//${u.host}`, username, password };
    }
  } catch {}
  return null;
}
