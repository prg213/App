/**
 * Task #427 — parseXmltvAsync parser resilience tests.
 *
 * Uses the REAL parseXmltvAsync function (not the mock) so the actual parser
 * logic is exercised.  Covers:
 *   - Valid XMLTV — programmes are parsed and grouped by channel
 *   - Missing required attributes (start, stop, channel) — segment skipped
 *   - Unparseable / garbage date strings — segment skipped
 *   - Programmes outside the ±2h / +3-day time window — filtered out
 *   - AbortSignal cancellation (pre-aborted, mid-parse abort)
 *   - CDATA-encoded titles and descriptions
 *   - Empty XML / XML with no programmes
 */

import { parseXmltvAsync } from '../services/epgService';

// ── XML helpers ───────────────────────────────────────────────────────────────

/** Format a Date as an XMLTV timestamp: "YYYYMMDDHHmmss +0000" */
function toXmltvDate(d: Date): string {
  const pad = (n: number, len = 2): string => String(n).padStart(len, '0');
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

/** Build a single <programme> element. */
function makeProg({
  start,
  stop,
  channel,
  title = 'Test Show',
  description,
}: {
  start: string;
  stop: string;
  channel: string;
  title?: string;
  description?: string;
}): string {
  const descEl = description ? `<desc>${description}</desc>` : '';
  return `<programme start="${start}" stop="${stop}" channel="${channel}"><title>${title}</title>${descEl}</programme>`;
}

/** Wrap programme elements in a minimal <tv> document. */
function xmltvDoc(...programmes: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n${programmes.join('\n')}\n</tv>`;
}

// ── Fixed time anchor so window assertions are deterministic ──────────────────

const FIXED_NOW = new Date('2024-07-26T12:00:00Z');
const FIXED_NOW_MS = FIXED_NOW.getTime();

// Timestamps that sit comfortably inside [now−2 h, now+3 days]
const IN_WIN_START = new Date(FIXED_NOW_MS - 30 * 60_000);   // 11:30 UTC
const IN_WIN_STOP  = new Date(FIXED_NOW_MS + 30 * 60_000);   // 12:30 UTC

// Programme that finished before the window opens (end ≤ now−2 h)
const OLD_START = new Date(FIXED_NOW_MS - 4 * 60 * 60_000);  // 08:00
const OLD_STOP  = new Date(FIXED_NOW_MS - 3 * 60 * 60_000);  // 09:00  ← before window

// Programme that starts after the window closes (start ≥ now+3 days)
const FAR_START = new Date(FIXED_NOW_MS + 4 * 24 * 60 * 60_000);
const FAR_STOP  = new Date(FIXED_NOW_MS + 4 * 24 * 60 * 60_000 + 30 * 60_000);

// ─────────────────────────────────────────────────────────────────────────────

describe('parseXmltvAsync — valid input', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS));
  afterEach(() => jest.restoreAllMocks());

  it('returns an empty Map for an empty XML string', async () => {
    const result = await parseXmltvAsync('');
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('returns an empty Map for a <tv> document with no <programme> elements', async () => {
    const result = await parseXmltvAsync('<tv></tv>');
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('parses a single valid programme and groups it by channel ID', async () => {
    const xml = xmltvDoc(
      makeProg({
        start: toXmltvDate(IN_WIN_START),
        stop:  toXmltvDate(IN_WIN_STOP),
        channel: 'ch1',
        title: 'News at Noon',
      }),
    );

    const result = await parseXmltvAsync(xml);
    expect(result.size).toBe(1);
    expect(result.has('ch1')).toBe(true);

    const progs = result.get('ch1')!;
    expect(progs).toHaveLength(1);
    expect(progs[0].channelId).toBe('ch1');
    expect(progs[0].title).toBe('News at Noon');
  });

  it('groups multiple programmes belonging to the same channel', async () => {
    const showA = makeProg({
      start:   toXmltvDate(new Date(FIXED_NOW_MS - 60 * 60_000)),
      stop:    toXmltvDate(new Date(FIXED_NOW_MS)),
      channel: 'ch1',
      title:   'Show A',
    });
    const showB = makeProg({
      start:   toXmltvDate(new Date(FIXED_NOW_MS)),
      stop:    toXmltvDate(new Date(FIXED_NOW_MS + 60 * 60_000)),
      channel: 'ch1',
      title:   'Show B',
    });

    const result = await parseXmltvAsync(xmltvDoc(showA, showB));
    expect(result.get('ch1')).toHaveLength(2);
  });

  it('puts programmes for different channels into separate map entries', async () => {
    const xml = xmltvDoc(
      makeProg({ start: toXmltvDate(IN_WIN_START), stop: toXmltvDate(IN_WIN_STOP), channel: 'ch-sports' }),
      makeProg({ start: toXmltvDate(IN_WIN_START), stop: toXmltvDate(IN_WIN_STOP), channel: 'ch-news' }),
    );

    const result = await parseXmltvAsync(xml);
    expect(result.size).toBe(2);
    expect(result.has('ch-sports')).toBe(true);
    expect(result.has('ch-news')).toBe(true);
  });

  it('returns programmes sorted by start time within each channel', async () => {
    // Insert in reverse order to confirm sort
    const later = makeProg({
      start: toXmltvDate(new Date(FIXED_NOW_MS + 60 * 60_000)),
      stop:  toXmltvDate(new Date(FIXED_NOW_MS + 90 * 60_000)),
      channel: 'ch1',
      title: 'Later',
    });
    const earlier = makeProg({
      start: toXmltvDate(IN_WIN_START),
      stop:  toXmltvDate(IN_WIN_STOP),
      channel: 'ch1',
      title: 'Earlier',
    });

    const result = await parseXmltvAsync(xmltvDoc(later, earlier));
    const progs = result.get('ch1')!;
    expect(progs[0].title).toBe('Earlier');
    expect(progs[1].title).toBe('Later');
  });

  it('populates start and end Date objects on each programme', async () => {
    const xml = xmltvDoc(
      makeProg({
        start: toXmltvDate(IN_WIN_START),
        stop:  toXmltvDate(IN_WIN_STOP),
        channel: 'ch1',
      }),
    );

    const result = await parseXmltvAsync(xml);
    const prog = result.get('ch1')![0];
    expect(prog.start).toBeInstanceOf(Date);
    expect(prog.end).toBeInstanceOf(Date);
    expect(prog.start.getTime()).toBe(IN_WIN_START.getTime());
    expect(prog.end.getTime()).toBe(IN_WIN_STOP.getTime());
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('parseXmltvAsync — missing required attributes', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS));
  afterEach(() => jest.restoreAllMocks());

  it('skips a programme missing the start attribute without throwing', async () => {
    const xml = `<tv><programme stop="${toXmltvDate(IN_WIN_STOP)}" channel="ch1"><title>No Start</title></programme></tv>`;
    await expect(parseXmltvAsync(xml)).resolves.toBeInstanceOf(Map);
    expect((await parseXmltvAsync(xml)).size).toBe(0);
  });

  it('skips a programme missing the stop attribute without throwing', async () => {
    const xml = `<tv><programme start="${toXmltvDate(IN_WIN_START)}" channel="ch1"><title>No Stop</title></programme></tv>`;
    await expect(parseXmltvAsync(xml)).resolves.toBeInstanceOf(Map);
    expect((await parseXmltvAsync(xml)).size).toBe(0);
  });

  it('skips a programme missing the channel attribute without throwing', async () => {
    const xml = `<tv><programme start="${toXmltvDate(IN_WIN_START)}" stop="${toXmltvDate(IN_WIN_STOP)}"><title>No Channel</title></programme></tv>`;
    await expect(parseXmltvAsync(xml)).resolves.toBeInstanceOf(Map);
    expect((await parseXmltvAsync(xml)).size).toBe(0);
  });

  it('skips malformed segments while still parsing valid siblings', async () => {
    const valid = makeProg({
      start:   toXmltvDate(IN_WIN_START),
      stop:    toXmltvDate(IN_WIN_STOP),
      channel: 'ch-good',
      title:   'Good Show',
    });
    const noStart   = `<programme stop="${toXmltvDate(IN_WIN_STOP)}" channel="ch-bad"><title>X</title></programme>`;
    const noStop    = `<programme start="${toXmltvDate(IN_WIN_START)}" channel="ch-bad"><title>Y</title></programme>`;
    const noChannel = `<programme start="${toXmltvDate(IN_WIN_START)}" stop="${toXmltvDate(IN_WIN_STOP)}"><title>Z</title></programme>`;

    const result = await parseXmltvAsync(xmltvDoc(valid, noStart, noStop, noChannel));
    expect(result.size).toBe(1);
    expect(result.has('ch-good')).toBe(true);
    expect(result.has('ch-bad')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('parseXmltvAsync — unparseable date strings', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS));
  afterEach(() => jest.restoreAllMocks());

  it('skips a programme with a garbage start date without throwing', async () => {
    const xml = `<tv><programme start="not-a-date" stop="${toXmltvDate(IN_WIN_STOP)}" channel="ch1"><title>Bad Start</title></programme></tv>`;
    const result = await parseXmltvAsync(xml);
    expect(result.size).toBe(0);
  });

  it('skips a programme with a garbage stop date without throwing', async () => {
    const xml = `<tv><programme start="${toXmltvDate(IN_WIN_START)}" stop="XXXXXXXX" channel="ch1"><title>Bad Stop</title></programme></tv>`;
    const result = await parseXmltvAsync(xml);
    expect(result.size).toBe(0);
  });

  it('skips a programme with empty start and stop strings without throwing', async () => {
    const xml = `<tv><programme start="" stop="" channel="ch1"><title>Empty Dates</title></programme></tv>`;
    const result = await parseXmltvAsync(xml);
    expect(result.size).toBe(0);
  });

  it('continues parsing remaining valid programmes after encountering a bad date', async () => {
    const bad = `<programme start="garbage" stop="garbage" channel="ch-bad"><title>Bad</title></programme>`;
    const good = makeProg({
      start:   toXmltvDate(IN_WIN_START),
      stop:    toXmltvDate(IN_WIN_STOP),
      channel: 'ch-good',
      title:   'Good',
    });

    const result = await parseXmltvAsync(xmltvDoc(bad, good));
    expect(result.size).toBe(1);
    expect(result.get('ch-good')?.[0].title).toBe('Good');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('parseXmltvAsync — time window filtering', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS));
  afterEach(() => jest.restoreAllMocks());

  it('includes a programme whose times sit inside the window', async () => {
    const xml = xmltvDoc(
      makeProg({ start: toXmltvDate(IN_WIN_START), stop: toXmltvDate(IN_WIN_STOP), channel: 'ch1' }),
    );
    expect((await parseXmltvAsync(xml)).size).toBe(1);
  });

  it('excludes a programme that ended more than 2 hours ago', async () => {
    const xml = xmltvDoc(
      makeProg({ start: toXmltvDate(OLD_START), stop: toXmltvDate(OLD_STOP), channel: 'ch1' }),
    );
    expect((await parseXmltvAsync(xml)).size).toBe(0);
  });

  it('excludes a programme that starts more than 3 days in the future', async () => {
    const xml = xmltvDoc(
      makeProg({ start: toXmltvDate(FAR_START), stop: toXmltvDate(FAR_STOP), channel: 'ch1' }),
    );
    expect((await parseXmltvAsync(xml)).size).toBe(0);
  });

  it('includes a programme that started before the window but ends inside it', async () => {
    // Started 3 h ago (outside window open), ends 1 h ago (inside window)
    const xml = xmltvDoc(makeProg({
      start: toXmltvDate(new Date(FIXED_NOW_MS - 3 * 60 * 60_000)),
      stop:  toXmltvDate(new Date(FIXED_NOW_MS - 60 * 60_000)),
      channel: 'ch1',
    }));
    expect((await parseXmltvAsync(xml)).size).toBe(1);
  });

  it('filters out-of-window programmes while keeping in-window ones', async () => {
    const xml = xmltvDoc(
      makeProg({ start: toXmltvDate(OLD_START),    stop: toXmltvDate(OLD_STOP),    channel: 'ch-old',    title: 'Old' }),
      makeProg({ start: toXmltvDate(IN_WIN_START), stop: toXmltvDate(IN_WIN_STOP), channel: 'ch-good',   title: 'Good' }),
      makeProg({ start: toXmltvDate(FAR_START),    stop: toXmltvDate(FAR_STOP),    channel: 'ch-future', title: 'Future' }),
    );
    const result = await parseXmltvAsync(xml);
    expect(result.size).toBe(1);
    expect(result.has('ch-good')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('parseXmltvAsync — AbortSignal cancellation', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS));
  afterEach(() => jest.restoreAllMocks());

  /** Generate N valid programme strings spread across different channels. */
  function makeProgs(n: number): string[] {
    return Array.from({ length: n }, (_, idx) =>
      makeProg({
        start:   toXmltvDate(new Date(FIXED_NOW_MS - 60 * 60_000 + idx * 60_000)),
        stop:    toXmltvDate(new Date(FIXED_NOW_MS              + idx * 60_000)),
        channel: `ch${idx}`,
        title:   `Show ${idx}`,
      }),
    );
  }

  it('throws an AbortError when the signal is already aborted (batch boundary at i=200)', async () => {
    // The abort check fires at every 200th segment (BATCH_SIZE = 200).
    // Supplying 201 programmes means the check at i=200 is reached.
    const xml = xmltvDoc(...makeProgs(201));

    const controller = new AbortController();
    controller.abort(); // aborted before calling

    await expect(parseXmltvAsync(xml, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('throws an AbortError when the signal is aborted while the parser is yielding', async () => {
    // 401 programmes → batch boundaries at i=200 and i=400.
    // The signal is aborted inside the setTimeout(0) that resolves the first
    // yieldToUI() call (at i=200).  The second boundary check at i=400 sees
    // the aborted signal and throws.
    const xml = xmltvDoc(...makeProgs(401));

    const controller = new AbortController();
    const parsePromise = parseXmltvAsync(xml, controller.signal);

    // Abort on the next tick — races with the yieldToUI() setTimeout(0)
    // at i=200.  The second batch (i=400) will observe signal.aborted=true.
    Promise.resolve().then(() => controller.abort());

    await expect(parsePromise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('completes successfully when no AbortSignal is supplied', async () => {
    const xml = xmltvDoc(
      makeProg({ start: toXmltvDate(IN_WIN_START), stop: toXmltvDate(IN_WIN_STOP), channel: 'ch1' }),
    );
    await expect(parseXmltvAsync(xml)).resolves.toBeInstanceOf(Map);
  });

  it('completes successfully when a non-aborted signal is supplied', async () => {
    const xml = xmltvDoc(
      makeProg({ start: toXmltvDate(IN_WIN_START), stop: toXmltvDate(IN_WIN_STOP), channel: 'ch1' }),
    );
    const controller = new AbortController();
    await expect(parseXmltvAsync(xml, controller.signal)).resolves.toBeInstanceOf(Map);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('parseXmltvAsync — CDATA and entity decoding', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS));
  afterEach(() => jest.restoreAllMocks());

  const s = toXmltvDate(IN_WIN_START);
  const e = toXmltvDate(IN_WIN_STOP);

  it('decodes a CDATA-wrapped title', async () => {
    const xml = `<tv><programme start="${s}" stop="${e}" channel="ch1"><title><![CDATA[Breaking & News]]></title></programme></tv>`;
    const result = await parseXmltvAsync(xml);
    expect(result.get('ch1')?.[0].title).toBe('Breaking & News');
  });

  it('decodes a CDATA-wrapped description', async () => {
    const xml = `<tv><programme start="${s}" stop="${e}" channel="ch1"><title>Show</title><desc><![CDATA[A <great> show & more]]></desc></programme></tv>`;
    const result = await parseXmltvAsync(xml);
    expect(result.get('ch1')?.[0].description).toBe('A <great> show & more');
  });

  it('decodes &amp; entity in a plain-text title', async () => {
    const xml = `<tv><programme start="${s}" stop="${e}" channel="ch1"><title>Tom &amp; Jerry</title></programme></tv>`;
    const result = await parseXmltvAsync(xml);
    expect(result.get('ch1')?.[0].title).toBe('Tom & Jerry');
  });

  it('decodes &lt; and &gt; entities in a plain-text description', async () => {
    const xml = `<tv><programme start="${s}" stop="${e}" channel="ch1"><title>Show</title><desc>A &lt;cool&gt; series</desc></programme></tv>`;
    const result = await parseXmltvAsync(xml);
    expect(result.get('ch1')?.[0].description).toBe('A <cool> series');
  });

  it('uses "Unknown" as the title when no <title> element is present', async () => {
    const xml = `<tv><programme start="${s}" stop="${e}" channel="ch1"></programme></tv>`;
    const result = await parseXmltvAsync(xml);
    expect(result.get('ch1')?.[0].title).toBe('Unknown');
  });

  it('leaves description undefined when no <desc> element is present', async () => {
    const xml = xmltvDoc(
      makeProg({ start: s, stop: e, channel: 'ch1' }),
    );
    const result = await parseXmltvAsync(xml);
    expect(result.get('ch1')?.[0].description).toBeUndefined();
  });

  it('multiline CDATA content is decoded and trimmed', async () => {
    const xml = `<tv><programme start="${s}" stop="${e}" channel="ch1"><title><![CDATA[\n  Multiline Show\n]]></title></programme></tv>`;
    const result = await parseXmltvAsync(xml);
    // decodeXml trims the result
    expect(result.get('ch1')?.[0].title).toBe('Multiline Show');
  });
});
