/**
 * Task #433 — EPG guard: first-load and re-fetch integration tests.
 *
 * Exercises the queryFn pattern used by guide.tsx and index.tsx via
 * QueryClient.fetchQuery so the QueryClient machinery (cache reads/writes,
 * staleTime, etc.) is part of the test:
 *
 *   queryFn: ({ signal }) => {
 *     const previous = queryClient.getQueryData(['xmltv-epg', credentials]);
 *     return fetchAndParseXmltv(xmltvUrl, signal, previous);
 *   }
 *
 * Using fetchQuery means:
 *   1. The queryFn closure captures the same `queryClient` that runs the query
 *      (mirrors the screen components exactly).
 *   2. After each call the QueryClient writes the return value to its cache, so
 *      subsequent queries receive the stored map via getQueryData — proving the
 *      full round-trip works.
 *   3. If the queryFn stopped calling queryClient.getQueryData and passing the
 *      result to fetchAndParseXmltv, the "re-fetch blocked" assertions would
 *      fail because `previous` would always be undefined and the guard would
 *      never fire.
 *
 * Covers:
 *   1. First fetch (empty cache) — any result accepted, guard bypassed.
 *   2. Re-fetch with tiny result — guard blocks it; original cached map kept.
 *   3. Re-fetch with healthy result — new map replaces the cached entry.
 *   4. Stale-while-revalidate: healthy background refresh lands in cache.
 *   5. Stale-while-revalidate: corrupted refresh is blocked; cache unchanged.
 */

import { QueryClient } from '@tanstack/react-query';
import { fetchAndParseXmltv } from '../services/epgService';
import type { EpgProgram } from '@/types';

// ── XMLTV helpers ─────────────────────────────────────────────────────────────

const FIXED_NOW = new Date('2024-07-26T12:00:00Z');
const FIXED_NOW_MS = FIXED_NOW.getTime();

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0');
}

function toXmltvDate(d: Date): string {
  return (
    `${pad(d.getUTCFullYear(), 4)}` +
    `${pad(d.getUTCMonth() + 1)}` +
    `${pad(d.getUTCDate())}` +
    `${pad(d.getUTCHours())}` +
    `${pad(d.getUTCMinutes())}` +
    `${pad(d.getUTCSeconds())}` +
    ' +0000'
  );
}

function inWindowProg(channel: string, title = 'Show'): string {
  const s = toXmltvDate(new Date(FIXED_NOW_MS - 30 * 60_000));
  const e = toXmltvDate(new Date(FIXED_NOW_MS + 30 * 60_000));
  return `<programme start="${s}" stop="${e}" channel="${channel}"><title>${title}</title></programme>`;
}

function xmltvDoc(...programmes: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n${programmes.join('\n')}\n</tv>`;
}

function mockFetch(xml: string): void {
  (global as any).fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => xml,
  });
}

// ── Constants that must match guide.tsx / index.tsx ───────────────────────────

const FAKE_CREDENTIALS = {
  type: 'xtream',
  host: 'http://test.example',
  username: 'u',
  password: 'p',
};
const EPG_QUERY_KEY = ['xmltv-epg', FAKE_CREDENTIALS] as const;
const EPG_URL = 'http://test.example/epg.xml';

// ── Factory: build a QueryClient + queryFn that mirrors the screen code ───────
//
// Both guide.tsx and index.tsx contain:
//
//   const queryClient = useQueryClient();
//   const { data: epgMap } = useQuery({
//     queryKey: ['xmltv-epg', credentials],
//     queryFn: ({ signal }) => {
//       const previous = queryClient.getQueryData<Map<string, EpgProgram[]>>(['xmltv-epg', credentials]);
//       return fetchAndParseXmltv(xmltvUrl!, signal, previous);
//     },
//   });
//
// We replicate this with `fetchQuery` so that:
//   • getQueryData reads from the same QueryClient instance that stores results
//   • Each fetchQuery call updates the cache, so the next call sees the new data
//   • staleTime: 0 forces a network round-trip on every call (simulates SWR background refetch)

function makeQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  // The queryFn is defined inside the same closure that owns queryClient,
  // exactly mirroring how the screen hooks capture useQueryClient().
  async function epgQueryFn({ signal }: { signal?: AbortSignal } = {}): Promise<Map<string, EpgProgram[]>> {
    const previous = queryClient.getQueryData<Map<string, EpgProgram[]>>(EPG_QUERY_KEY);
    return fetchAndParseXmltv(EPG_URL, signal as AbortSignal | undefined, previous);
  }

  // Helper: runs the query through the QueryClient so the cache is updated.
  // staleTime: 0 ensures the network call is always made (no short-circuit).
  async function runQuery(): Promise<Map<string, EpgProgram[]>> {
    return queryClient.fetchQuery({
      queryKey: EPG_QUERY_KEY,
      queryFn: epgQueryFn,
      staleTime: 0,
    });
  }

  return { queryClient, runQuery };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EPG queryFn guard — QueryClient integration (guide.tsx / index.tsx pattern)', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS));
  afterEach(() => jest.restoreAllMocks());

  // ── 1. First fetch: cache is empty ─────────────────────────────────────────
  //
  // getQueryData returns undefined → fetchAndParseXmltv receives no previous
  // map → the startup guard applies.  Results with fewer than XMLTV_MIN_CHANNELS
  // (3) channels are rejected (throw → react-query retries); results at or above
  // the floor are accepted and stored.

  it('first fetch — empty cache — rejects a tiny two-channel result and leaves cache empty', async () => {
    const { queryClient, runQuery } = makeQueryClient();

    // Two channels — below XMLTV_MIN_CHANNELS (3) — must be rejected on first load.
    mockFetch(xmltvDoc(inWindowProg('ch0'), inWindowProg('ch1')));

    await expect(runQuery()).rejects.toThrow('[EPG]');

    // Cache must remain empty — no tiny map should have been stored
    expect(queryClient.getQueryData(EPG_QUERY_KEY)).toBeUndefined();
  });

  it('first fetch — empty cache — rejects a single-channel result and leaves cache empty', async () => {
    const { queryClient, runQuery } = makeQueryClient();

    // One channel — well below XMLTV_MIN_CHANNELS (3) — must throw.
    mockFetch(xmltvDoc(inWindowProg('only-channel')));

    await expect(runQuery()).rejects.toThrow('[EPG]');

    // Cache must remain empty
    expect(queryClient.getQueryData(EPG_QUERY_KEY)).toBeUndefined();
  });

  it('first fetch — empty cache — accepts a result exactly at XMLTV_MIN_CHANNELS and caches it', async () => {
    const { queryClient, runQuery } = makeQueryClient();

    // Three channels — exactly at the minimum floor — must resolve and be cached.
    mockFetch(xmltvDoc(inWindowProg('ch0'), inWindowProg('ch1'), inWindowProg('ch2')));

    const result = await runQuery();

    expect(result.size).toBe(3);
    expect(result.has('ch0')).toBe(true);

    // QueryClient cache is populated after the first successful fetch
    const cached = queryClient.getQueryData<Map<string, EpgProgram[]>>(EPG_QUERY_KEY);
    expect(cached).toBe(result);            // same object reference
    expect(cached!.size).toBe(3);
  });

  // ── 2. Re-fetch: previous map in cache; tiny result is blocked ─────────────
  //
  // First fetchQuery populates the cache with a healthy map.
  // Second fetchQuery fires; queryFn reads the cache via getQueryData, passes
  // it to fetchAndParseXmltv as `previous`; the guard sees a result below the
  // 25 % threshold and returns the previous map unchanged.
  // QueryClient stores the return value (same reference), so cache is unchanged.

  it('re-fetch — tiny result — guard blocks it; cached map is preserved', async () => {
    const { queryClient, runQuery } = makeQueryClient();

    // ── First fetch: 20 healthy channels ──────────────────────────────────────
    mockFetch(xmltvDoc(...Array.from({ length: 20 }, (_, i) => inWindowProg(`ch${i}`))));
    const firstResult = await runQuery();
    expect(firstResult.size).toBe(20);
    expect(queryClient.getQueryData(EPG_QUERY_KEY)).toBe(firstResult);

    // ── Re-fetch: only 3 channels returned (below threshold ceil(20×0.25)=5) ─
    mockFetch(xmltvDoc(inWindowProg('new-ch0'), inWindowProg('new-ch1'), inWindowProg('new-ch2')));

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const secondResult = await runQuery();
    warnSpy.mockRestore();

    // Guard returned the previous map — cache still holds the original 20-channel map
    expect(secondResult).toBe(firstResult);
    expect(queryClient.getQueryData<Map<string, EpgProgram[]>>(EPG_QUERY_KEY)).toBe(firstResult);
    expect(queryClient.getQueryData<Map<string, EpgProgram[]>>(EPG_QUERY_KEY)!.size).toBe(20);

    // The three new channels must not have leaked through
    expect(secondResult.has('new-ch0')).toBe(false);
  });

  it('re-fetch — completely empty XMLTV — cache is preserved', async () => {
    const { queryClient, runQuery } = makeQueryClient();

    mockFetch(xmltvDoc(...Array.from({ length: 30 }, (_, i) => inWindowProg(`ch${i}`))));
    const firstResult = await runQuery();
    expect(firstResult.size).toBe(30);

    // Empty XMLTV response (truncated download)
    mockFetch('<tv></tv>');

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const secondResult = await runQuery();
    warnSpy.mockRestore();

    expect(secondResult).toBe(firstResult);
    expect(queryClient.getQueryData<Map<string, EpgProgram[]>>(EPG_QUERY_KEY)).toBe(firstResult);
  });

  it('re-fetch — guard logs [EPG] warning when it discards the tiny result', async () => {
    const { runQuery } = makeQueryClient();

    mockFetch(xmltvDoc(...Array.from({ length: 20 }, (_, i) => inWindowProg(`ch${i}`))));
    await runQuery();

    // Re-fetch with 1 channel
    mockFetch(xmltvDoc(inWindowProg('tiny-ch')));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await runQuery();

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[EPG]'));
    warnSpy.mockRestore();
  });

  // ── 3. Re-fetch: healthy result replaces the cached map ────────────────────
  //
  // Guard threshold is not triggered; QueryClient stores the new map.
  // After the re-fetch, getQueryData must return the new object (not the old one).

  it('re-fetch — healthy result — new map replaces the old cache entry', async () => {
    const { queryClient, runQuery } = makeQueryClient();

    // First fetch: 10 channels
    mockFetch(xmltvDoc(...Array.from({ length: 10 }, (_, i) => inWindowProg(`ch${i}`))));
    const firstResult = await runQuery();
    expect(firstResult.size).toBe(10);

    // Re-fetch: 10 new channels with fresh IDs (100 % of previous — above threshold)
    mockFetch(xmltvDoc(...Array.from({ length: 10 }, (_, i) => inWindowProg(`fresh-ch${i}`))));

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const secondResult = await runQuery();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();

    // Guard did not fire — new map was accepted
    expect(secondResult).not.toBe(firstResult);
    expect(secondResult.size).toBe(10);
    expect(secondResult.has('fresh-ch0')).toBe(true);

    // QueryClient cache now holds the fresh map
    const cached = queryClient.getQueryData<Map<string, EpgProgram[]>>(EPG_QUERY_KEY);
    expect(cached).toBe(secondResult);
    expect(cached!.has('fresh-ch0')).toBe(true);
  });

  it('re-fetch — result at exact 25 % threshold — accepted and cached', async () => {
    // Previous: 20 channels. Threshold = ceil(20 × 0.25) = 5.
    // Fresh result: exactly 5 channels — boundary should be accepted.
    const { queryClient, runQuery } = makeQueryClient();

    mockFetch(xmltvDoc(...Array.from({ length: 20 }, (_, i) => inWindowProg(`ch${i}`))));
    await runQuery();

    mockFetch(xmltvDoc(...Array.from({ length: 5 }, (_, i) => inWindowProg(`threshold-ch${i}`))));
    const result = await runQuery();

    expect(result.size).toBe(5);
    expect(result.has('threshold-ch0')).toBe(true);
    expect(queryClient.getQueryData<Map<string, EpgProgram[]>>(EPG_QUERY_KEY)).toBe(result);
  });

  // ── 4. Stale-while-revalidate: background refresh cycle ────────────────────
  //
  // Simulates the real SWR pattern: first fetch succeeds → stale → background
  // refetch → QueryClient cache updated (healthy) or left alone (corrupted).

  it('stale-while-revalidate — healthy background refresh updates the cache', async () => {
    const { queryClient, runQuery } = makeQueryClient();

    // Initial load
    mockFetch(xmltvDoc(...Array.from({ length: 15 }, (_, i) => inWindowProg(`ch${i}`, 'First'))));
    const firstResult = await runQuery();
    expect(firstResult.size).toBe(15);

    // Background refetch with updated data (same channel count → above threshold)
    mockFetch(xmltvDoc(...Array.from({ length: 15 }, (_, i) => inWindowProg(`ch${i}`, 'Updated'))));
    const refreshResult = await runQuery();

    // New map landed in cache
    expect(refreshResult).not.toBe(firstResult);
    expect(refreshResult.size).toBe(15);
    expect(refreshResult.has('ch0')).toBe(true);
    expect(queryClient.getQueryData<Map<string, EpgProgram[]>>(EPG_QUERY_KEY)).toBe(refreshResult);
  });

  it('stale-while-revalidate — corrupted background refresh leaves cache intact', async () => {
    const { queryClient, runQuery } = makeQueryClient();

    // Initial load: 12 channels
    mockFetch(xmltvDoc(...Array.from({ length: 12 }, (_, i) => inWindowProg(`ch${i}`))));
    const firstResult = await runQuery();
    expect(firstResult.size).toBe(12);

    // Background refetch returns only 2 channels (below 25 % of 12 → threshold = ceil(3) = 3)
    mockFetch(xmltvDoc(inWindowProg('ch0'), inWindowProg('ch1')));

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const refreshResult = await runQuery();
    warnSpy.mockRestore();

    // Guard blocked the refresh; original data still in cache
    expect(refreshResult).toBe(firstResult);
    expect(queryClient.getQueryData<Map<string, EpgProgram[]>>(EPG_QUERY_KEY)).toBe(firstResult);
    expect(queryClient.getQueryData<Map<string, EpgProgram[]>>(EPG_QUERY_KEY)!.size).toBe(12);
  });
});
