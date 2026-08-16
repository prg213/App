/**
 * Task #429 — fetchAndParseXmltv corruption guard.
 *
 * Verifies that a near-empty or suspiciously-small XMLTV parse result does
 * NOT overwrite a healthy previously-cached EPG map.
 */

import { fetchAndParseXmltv } from '../services/epgService';
import type { EpgProgram } from '@/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

const FIXED_NOW = new Date('2024-07-26T12:00:00Z');
const FIXED_NOW_MS = FIXED_NOW.getTime();

function inWindowProg(channel: string, title = 'Show'): string {
  const s = toXmltvDate(new Date(FIXED_NOW_MS - 30 * 60_000));
  const e = toXmltvDate(new Date(FIXED_NOW_MS + 30 * 60_000));
  return `<programme start="${s}" stop="${e}" channel="${channel}"><title>${title}</title></programme>`;
}

function xmltvDoc(...programmes: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n${programmes.join('\n')}\n</tv>`;
}

/** Build a fake healthy EPG Map with `size` distinct channel entries. */
function buildPreviousMap(size: number): Map<string, EpgProgram[]> {
  const map = new Map<string, EpgProgram[]>();
  const base = FIXED_NOW_MS;
  for (let i = 0; i < size; i++) {
    map.set(`ch${i}`, [
      {
        channelId: `ch${i}`,
        title: `Show ${i}`,
        start: new Date(base - 30 * 60_000),
        end:   new Date(base + 30 * 60_000),
      },
    ]);
  }
  return map;
}

// ── Mock global fetch ─────────────────────────────────────────────────────────

function mockFetch(xml: string): void {
  (global as any).fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => xml,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('fetchAndParseXmltv — truncation guard', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS));
  afterEach(() => jest.restoreAllMocks());

  it('returns a healthy result when no previousMap is supplied', async () => {
    // 5 channels in the fresh response — no previous to compare against
    const xml = xmltvDoc(...Array.from({ length: 5 }, (_, i) => inWindowProg(`ch${i}`)));
    mockFetch(xml);

    const result = await fetchAndParseXmltv('http://example.com/epg.xml');
    expect(result.size).toBe(5);
  });

  it('returns a healthy result when the previous map is empty', async () => {
    // Previous map exists but is empty — guard does not apply
    const xml = xmltvDoc(inWindowProg('ch0'), inWindowProg('ch1'));
    mockFetch(xml);

    const prev = new Map<string, EpgProgram[]>();
    const result = await fetchAndParseXmltv('http://example.com/epg.xml', undefined, prev);
    expect(result.size).toBe(2);
  });

  it('accepts a result that is exactly at the 25 % threshold', async () => {
    // Previous: 20 channels. Threshold = ceil(20 × 0.25) = 5.
    // Fresh result: 5 channels — should be accepted.
    const prev = buildPreviousMap(20);
    const xml = xmltvDoc(...Array.from({ length: 5 }, (_, i) => inWindowProg(`ch${i}`)));
    mockFetch(xml);

    const result = await fetchAndParseXmltv('http://example.com/epg.xml', undefined, prev);
    expect(result.size).toBe(5);
    // Should be the new map, NOT the previous
    expect(result).not.toBe(prev);
  });

  it('preserves the previous map when the fresh result is below the 25 % threshold', async () => {
    // Previous: 20 channels. Threshold = ceil(20 × 0.25) = 5.
    // Fresh result: 4 channels — below threshold, guard should kick in.
    const prev = buildPreviousMap(20);
    const xml = xmltvDoc(...Array.from({ length: 4 }, (_, i) => inWindowProg(`ch${i}`)));
    mockFetch(xml);

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await fetchAndParseXmltv('http://example.com/epg.xml', undefined, prev);

    expect(result).toBe(prev);           // same reference — old data preserved
    expect(result.size).toBe(20);        // all previous channels intact
    warnSpy.mockRestore();
  });

  it('preserves the previous map when the fresh result is completely empty', async () => {
    // A truncated download produces zero channels — must not wipe the guide.
    const prev = buildPreviousMap(50);
    const xml = '<tv></tv>'; // no programmes at all
    mockFetch(xml);

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await fetchAndParseXmltv('http://example.com/epg.xml', undefined, prev);

    expect(result).toBe(prev);
    expect(result.size).toBe(50);
    warnSpy.mockRestore();
  });

  it('logs a warning when the guard discards the fresh result', async () => {
    const prev = buildPreviousMap(20);
    const xml = xmltvDoc(inWindowProg('ch0')); // only 1 channel
    mockFetch(xml);

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await fetchAndParseXmltv('http://example.com/epg.xml', undefined, prev);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[EPG]'),
    );
    warnSpy.mockRestore();
  });

  it('does NOT warn when the fresh result is healthy', async () => {
    const prev = buildPreviousMap(10);
    // 8 channels — well above 25 % of 10 (threshold = 3)
    const xml = xmltvDoc(...Array.from({ length: 8 }, (_, i) => inWindowProg(`ch${i}`)));
    mockFetch(xml);

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await fetchAndParseXmltv('http://example.com/epg.xml', undefined, prev);

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('accepts a full-size fresh result and replaces the previous map', async () => {
    const prev = buildPreviousMap(10);
    // 10 fresh channels with different IDs
    const xml = xmltvDoc(...Array.from({ length: 10 }, (_, i) => inWindowProg(`new-ch${i}`)));
    mockFetch(xml);

    const result = await fetchAndParseXmltv('http://example.com/epg.xml', undefined, prev);

    expect(result).not.toBe(prev);         // new map
    expect(result.size).toBe(10);
    expect(result.has('new-ch0')).toBe(true);
  });
});

// ── Startup empty-result guard ────────────────────────────────────────────────
//
// Task #432: when the app launches fresh (no in-memory previous map) and the
// XMLTV download is empty or corrupt, the function must THROW so react-query
// retries rather than caching an empty map and blanking the guide.

describe('fetchAndParseXmltv — startup empty-result guard', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS));
  afterEach(() => jest.restoreAllMocks());

  it('throws when the fresh result has zero channels and no previous map is provided', async () => {
    const xml = '<tv></tv>'; // no programmes
    mockFetch(xml);

    await expect(fetchAndParseXmltv('http://example.com/epg.xml')).rejects.toThrow('[EPG]');
  });

  it('throws when the fresh result has zero channels and an empty previous map is provided', async () => {
    const xml = '<tv></tv>';
    mockFetch(xml);

    const emptyPrev = new Map<string, EpgProgram[]>();
    await expect(
      fetchAndParseXmltv('http://example.com/epg.xml', undefined, emptyPrev),
    ).rejects.toThrow('[EPG]');
  });

  it('does NOT throw when a healthy previous map exists (existing guard handles it)', async () => {
    // With a healthy previous map the existing shrink-ratio guard fires first
    // and returns the previous data — the startup throw must not interfere.
    const prev = buildPreviousMap(20);
    const xml = '<tv></tv>'; // zero channels → below 25 % threshold
    mockFetch(xml);

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await fetchAndParseXmltv('http://example.com/epg.xml', undefined, prev);

    // Returns previous data, does not throw
    expect(result).toBe(prev);
    expect(result.size).toBe(20);
    warnSpy.mockRestore();
  });

  it('returns healthy data normally when no previous map is provided', async () => {
    // Normal first-launch with a valid XMLTV feed — must not throw.
    const xml = xmltvDoc(...Array.from({ length: 10 }, (_, i) => inWindowProg(`ch${i}`)));
    mockFetch(xml);

    const result = await fetchAndParseXmltv('http://example.com/epg.xml');
    expect(result.size).toBe(10);
  });
});
