import type { EpgProgram } from '@/types';

// ─── Date Parsing ─────────────────────────────────────────────────────────

/**
 * Parse an XMLTV date string into a UTC Date.
 * Accepts: "20240726190000 +0100"  or  "20240726190000"
 */
function parseXmltvDate(raw: string): Date {
  const s = raw.trim();
  const dp = s.slice(0, 14);
  const tz = s.slice(14).trim();

  const date = new Date(Date.UTC(
    +dp.slice(0, 4),
    +dp.slice(4, 6) - 1,
    +dp.slice(6, 8),
    +dp.slice(8, 10),
    +dp.slice(10, 12),
    +dp.slice(12, 14) || 0,
  ));

  if (tz.length >= 5) {
    const sign = tz[0] === '+' ? 1 : -1;
    const tzH = +tz.slice(1, 3);
    const tzM = +tz.slice(3, 5);
    date.setTime(date.getTime() - sign * (tzH * 60 + tzM) * 60_000);
  }

  return date;
}

// ─── XML Helpers ───────────────────────────────────────────────────────────

function decodeXml(str: string): string {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .trim();
}

// Yield to the UI / event loop
function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ─── Async Chunked XMLTV Parser ────────────────────────────────────────────

/**
 * Parse an XMLTV XML string into a Map keyed by channel ID.
 *
 * Runs asynchronously in batches of BATCH_SIZE programmes, yielding
 * to the UI event loop between each batch so the app stays responsive.
 * Also filters to a ±2h / +26h time window to skip most of the file.
 */
const BATCH_SIZE = 200;

export async function parseXmltvAsync(
  xml: string,
  signal?: AbortSignal,
): Promise<Map<string, EpgProgram[]>> {
  const map = new Map<string, EpgProgram[]>();

  // Keep programmes that overlap with [now - 2h, now + 3 days]
  const nowMs = Date.now();
  const windowStart = nowMs - 2 * 60 * 60_000;
  const windowEnd   = nowMs + 3 * 24 * 60 * 60_000;

  // Split on the opening tag — avoids a single giant [\s\S]*? regex over
  // the whole document, which is what caused the main-thread freeze.
  const segments = xml.split('<programme');
  // segment[0] is everything before the first <programme — skip it

  for (let i = 1; i < segments.length; i++) {
    // Yield every BATCH_SIZE items so the JS thread isn't blocked
    if (i % BATCH_SIZE === 0) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      await yieldToUI();
    }

    const seg = segments[i];

    // Find where the opening tag ends and the body begins
    const tagClose = seg.indexOf('>');
    if (tagClose === -1) continue;

    // Find the closing tag
    const bodyEnd = seg.indexOf('</programme>');
    if (bodyEnd === -1) continue;

    const attrs = seg.slice(0, tagClose);
    const body  = seg.slice(tagClose + 1, bodyEnd);

    // Extract required attributes
    const startRaw  = /\bstart="([^"]*)"/.exec(attrs)?.[1];
    const stopRaw   = /\bstop="([^"]*)"/.exec(attrs)?.[1];
    const channelId = /\bchannel="([^"]*)"/.exec(attrs)?.[1];

    if (!startRaw || !stopRaw || !channelId) continue;

    // Quick date parse — skip if outside the window (avoids body parsing too)
    let start: Date, end: Date;
    try {
      start = parseXmltvDate(startRaw);
      end   = parseXmltvDate(stopRaw);
    } catch {
      continue;
    }
    if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;
    if (end.getTime() < windowStart || start.getTime() > windowEnd) continue;

    // Parse body fields
    const titleMatch = /<title[^>]*>([^<]*(?:<!\[CDATA\[[\s\S]*?\]\]>[^<]*)*)<\/title>/.exec(body);
    const descMatch  = /<desc[^>]*>([^<]*(?:<!\[CDATA\[[\s\S]*?\]\]>[^<]*)*)<\/desc>/.exec(body);
    const catMatch   = /<category[^>]*>([^<]*)<\/category>/.exec(body);
    const iconMatch  = /<icon\s+src="([^"]*)"/.exec(body);

    const program: EpgProgram = {
      channelId,
      title:       titleMatch ? decodeXml(titleMatch[1]) || 'Unknown' : 'Unknown',
      description: descMatch  ? decodeXml(descMatch[1])  || undefined : undefined,
      category:    catMatch   ? decodeXml(catMatch[1])   || undefined : undefined,
      start,
      end,
      icon:        iconMatch?.[1],
    };

    const list = map.get(channelId);
    if (list) list.push(program);
    else map.set(channelId, [program]);
  }

  // Sort each channel's programmes by start time
  for (const programmes of map.values()) {
    programmes.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  return map;
}

// ─── Fetch + Parse ─────────────────────────────────────────────────────────

/**
 * Minimum fraction of the previous channel count that a fresh XMLTV result
 * must contain before it is accepted.  A parse result with fewer channels
 * than  (previousSize × XMLTV_SHRINK_RATIO) is treated as a corrupted /
 * truncated download and discarded in favour of the previous data.
 */
const XMLTV_SHRINK_RATIO = 0.25;

export async function fetchAndParseXmltv(
  url: string,
  signal?: AbortSignal,
  previousMap?: Map<string, EpgProgram[]>,
): Promise<Map<string, EpgProgram[]>> {
  const res = await fetch(url, {
    signal,
    headers: { Accept: 'application/xml, text/xml, */*' },
  });
  if (!res.ok) throw new Error(`XMLTV fetch failed: ${res.status} ${res.statusText}`);
  const xml = await res.text();
  const newMap = await parseXmltvAsync(xml, signal);

  // Guard against a corrupt or truncated download silently wiping the guide.
  // If the previous map was healthy and the new result is suspiciously small
  // (less than 25 % of the previous channel count), discard the new result
  // and keep the existing data instead.
  if (previousMap && previousMap.size > 0) {
    const prevSize = previousMap.size;
    const newSize  = newMap.size;
    const minAcceptable = Math.ceil(prevSize * XMLTV_SHRINK_RATIO);

    if (newSize < minAcceptable) {
      console.warn(
        `[EPG] Discarding suspiciously small XMLTV result: ` +
        `${newSize} channel(s) parsed (previous: ${prevSize}, ` +
        `minimum acceptable: ${minAcceptable}). ` +
        `Preserving previous EPG data.`,
      );
      return previousMap;
    }
  }

  return newMap;
}

// ─── Base64 decoder (Xtream Codes encodes EPG titles/desc) ─────────────────

export function tryDecodeBase64(str: string): string {
  if (!str) return '';
  try {
    return atob(str);
  } catch {
    return str;
  }
}
