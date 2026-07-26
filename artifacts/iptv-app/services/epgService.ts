import type { EpgProgram } from '@/types';

// ─── Date Parsing ─────────────────────────────────────────────────────────

/**
 * Parse an XMLTV date string into a UTC Date.
 * Formats accepted:
 *   "20240726190000 +0100"   (with tz offset)
 *   "20240726190000"          (assumed UTC)
 */
function parseXmltvDate(raw: string): Date {
  const s = raw.trim();
  const datePart = s.slice(0, 14);
  const tzPart = s.slice(14).trim();

  const y = +datePart.slice(0, 4);
  const mo = +datePart.slice(4, 6) - 1;
  const d = +datePart.slice(6, 8);
  const h = +datePart.slice(8, 10);
  const m = +datePart.slice(10, 12);
  const sec = +datePart.slice(12, 14) || 0;

  // Build as UTC first
  const date = new Date(Date.UTC(y, mo, d, h, m, sec));

  // Apply timezone shift to convert local → UTC
  if (tzPart.length >= 5) {
    const sign = tzPart[0] === '+' ? 1 : -1;
    const tzH = +tzPart.slice(1, 3);
    const tzM = +tzPart.slice(3, 5);
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

// ─── XMLTV Parser ──────────────────────────────────────────────────────────

/**
 * Parse XMLTV XML string into a Map keyed by channel ID.
 * Deliberately written without DOM/SAX to work in any JS environment.
 */
export function parseXmltv(xml: string): Map<string, EpgProgram[]> {
  const map = new Map<string, EpgProgram[]>();

  const progRe =
    /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;

  let m: RegExpExecArray | null;
  while ((m = progRe.exec(xml)) !== null) {
    const attrs = m[1];
    const body = m[2];

    const startRaw = attrs.match(/\bstart="([^"]*)"/)?.[1];
    const stopRaw = attrs.match(/\bstop="([^"]*)"/)?.[1];
    const channelId = attrs.match(/\bchannel="([^"]*)"/)?.[1];

    if (!startRaw || !stopRaw || !channelId) continue;

    let start: Date, end: Date;
    try {
      start = parseXmltvDate(startRaw);
      end = parseXmltvDate(stopRaw);
    } catch {
      continue;
    }
    if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;

    const titleMatch = body.match(/<title(?:\s[^>]*)?>([^<]*(?:<!\[CDATA\[[\s\S]*?\]\]>[^<]*)*)<\/title>/);
    const descMatch = body.match(/<desc(?:\s[^>]*)?>([^<]*(?:<!\[CDATA\[[\s\S]*?\]\]>[^<]*)*)<\/desc>/);
    const catMatch = body.match(/<category(?:\s[^>]*)?>([^<]*)<\/category>/);
    const iconMatch = body.match(/<icon\s+src="([^"]*)"/);

    const program: EpgProgram = {
      channelId,
      title: titleMatch ? decodeXml(titleMatch[1]) || 'Unknown' : 'Unknown',
      description: descMatch ? decodeXml(descMatch[1]) || undefined : undefined,
      category: catMatch ? decodeXml(catMatch[1]) || undefined : undefined,
      start,
      end,
      icon: iconMatch?.[1],
    };

    if (!map.has(channelId)) map.set(channelId, []);
    map.get(channelId)!.push(program);
  }

  // Sort each channel's programs by start time
  for (const programs of map.values()) {
    programs.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  return map;
}

// ─── Fetch + Parse ─────────────────────────────────────────────────────────

export async function fetchAndParseXmltv(
  url: string,
  signal?: AbortSignal,
): Promise<Map<string, EpgProgram[]>> {
  const res = await fetch(url, {
    signal,
    headers: { Accept: 'application/xml, text/xml, */*' },
  });
  if (!res.ok) throw new Error(`XMLTV fetch failed: ${res.status} ${res.statusText}`);
  const xml = await res.text();
  return parseXmltv(xml);
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
