import type { Channel, Category } from '@/types';

function attr(line: string, key: string): string | undefined {
  const re = new RegExp(`${key}="([^"]*?)"`);
  return line.match(re)?.[1] || undefined;
}

export function parseM3U(content: string): {
  channels: Channel[];
  categories: Category[];
} {
  const lines = content.split('\n').map((l) => l.trim());
  const channels: Channel[] = [];
  const catMap = new Map<string, number>();
  let num = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('#EXTINF:')) continue;

    // Find the next non-comment line (stream URL)
    let urlLine = '';
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].startsWith('#') && lines[j]) {
        urlLine = lines[j];
        break;
      }
    }
    if (!urlLine) continue;

    const commaIdx = line.lastIndexOf(',');
    const name =
      commaIdx !== -1 ? line.slice(commaIdx + 1).trim() : 'Unknown';

    const logo = attr(line, 'tvg-logo');
    const groupTitle = attr(line, 'group-title') || 'Uncategorized';
    const epgId = attr(line, 'tvg-id');

    catMap.set(groupTitle, (catMap.get(groupTitle) ?? 0) + 1);

    channels.push({
      id: epgId || `ch-${++num}`,
      name,
      logo,
      groupTitle,
      streamUrl: urlLine,
      epgId,
      num,
    });
  }

  const categories: Category[] = Array.from(catMap.entries()).map(
    ([name, count]) => ({ id: name, name, count }),
  );

  return { channels, categories };
}

export async function fetchAndParseM3U(url: string): Promise<{
  channels: Channel[];
  categories: Category[];
}> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching M3U`);
  const text = await res.text();
  return parseM3U(text);
}
