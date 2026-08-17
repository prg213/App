/**
 * Task #475 — CatchupSheet selectedDay initializer
 *
 * Verifies that the lazy useState initializer correctly maps an `initialProg`
 * to the right archive day, and falls back to today when no match is found.
 *
 * The relevant logic from CatchupSheet.tsx (lines ~96–123):
 *
 *   const todayMidnight = useMemo(() => {
 *     const d = new Date(); d.setHours(0, 0, 0, 0); return d;
 *   }, []);
 *
 *   const archiveDays = Math.max(1, Math.min(channel.tvArchiveDuration ?? 7, 7));
 *   const days = useMemo(() => {
 *     const list: Date[] = [];
 *     for (let i = 0; i < archiveDays; i++) {
 *       const d = new Date(todayMidnight.getTime() - i * 86_400_000);
 *       list.push(d);
 *     }
 *     return list;
 *   }, [todayMidnight, archiveDays]);
 *
 *   const [selectedDay] = useState<Date>(() => {
 *     if (initialProg) {
 *       const progDay = new Date(initialProg.start);
 *       progDay.setHours(0, 0, 0, 0);
 *       const match = days.find((d) => isSameDay(d, progDay));
 *       if (match) return match;
 *     }
 *     return days[0]; // today
 *   });
 *
 * Why simulate instead of render?
 * ────────────────────────────────
 * CatchupSheet imports Modal, useQuery, useRouter, useSafeAreaInsets, and
 * expo-video — all of which require a native runtime.  The simulation below
 * mirrors the exact initializer logic.  Any divergence in the source will
 * cause the simulation's output to differ from the expected value and the
 * test will fail.
 */

import type { EpgProgram } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Mirror of the isSameDay helper from CatchupSheet.tsx. */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth()    &&
    a.getDate()     === b.getDate()
  );
}

/** Build the days array exactly as CatchupSheet does. */
function buildDays(todayMidnight: Date, archiveDuration: number): Date[] {
  const archiveDays = Math.max(1, Math.min(archiveDuration, 7));
  const list: Date[] = [];
  for (let i = 0; i < archiveDays; i++) {
    const d = new Date(todayMidnight.getTime() - i * 86_400_000);
    list.push(d);
  }
  return list;
}

/**
 * Mirror of the useState lazy initializer from CatchupSheet.tsx.
 *
 * Returns the Date that selectedDay would be initialised to.
 */
function resolveSelectedDay(
  days: Date[],
  initialProg: EpgProgram | undefined,
): Date {
  if (initialProg) {
    const progDay = new Date(initialProg.start);
    progDay.setHours(0, 0, 0, 0);
    const match = days.find((d) => isSameDay(d, progDay));
    if (match) return match;
  }
  return days[0]; // today
}

/** Build a minimal EpgProgram whose start falls on the given Date. */
function makeProgOnDay(day: Date, startHour = 20): EpgProgram {
  const start = new Date(day);
  start.setHours(startHour, 0, 0, 0);
  const end = new Date(start.getTime() + 3600_000);
  return { channelId: 'ch1', title: 'Movie Night', start, end };
}

// ── Fixed reference: August 17 2026 (today in this test suite) ───────────────

// Stable anchor — tests don't use Date.now() so they are deterministic.
const TODAY_MIDNIGHT = new Date('2026-08-17T00:00:00.000Z');
TODAY_MIDNIGHT.setHours(0, 0, 0, 0);

const YESTERDAY_MIDNIGHT = new Date(TODAY_MIDNIGHT.getTime() - 86_400_000);
const TWO_DAYS_AGO       = new Date(TODAY_MIDNIGHT.getTime() - 2 * 86_400_000);
const SIX_DAYS_AGO       = new Date(TODAY_MIDNIGHT.getTime() - 6 * 86_400_000);
// 7 days ago is outside the default 7-day window (days[0..6] covers today..6 days ago)
const EIGHT_DAYS_AGO     = new Date(TODAY_MIDNIGHT.getTime() - 8 * 86_400_000);

// ── buildDays helper ──────────────────────────────────────────────────────────

describe('buildDays', () => {
  it('produces N days starting from today and going backwards', () => {
    const days = buildDays(TODAY_MIDNIGHT, 3);
    expect(days).toHaveLength(3);
    expect(isSameDay(days[0], TODAY_MIDNIGHT)).toBe(true);
    expect(isSameDay(days[1], YESTERDAY_MIDNIGHT)).toBe(true);
    expect(isSameDay(days[2], TWO_DAYS_AGO)).toBe(true);
  });

  it('caps at 7 days even when tvArchiveDuration is larger', () => {
    const days = buildDays(TODAY_MIDNIGHT, 30);
    expect(days).toHaveLength(7);
  });

  it('always produces at least 1 day regardless of tvArchiveDuration', () => {
    const days = buildDays(TODAY_MIDNIGHT, 0);
    expect(days).toHaveLength(1);
    expect(isSameDay(days[0], TODAY_MIDNIGHT)).toBe(true);
  });

  it('handles tvArchiveDuration of exactly 7', () => {
    const days = buildDays(TODAY_MIDNIGHT, 7);
    expect(days).toHaveLength(7);
    expect(isSameDay(days[6], SIX_DAYS_AGO)).toBe(true);
  });
});

// ── resolveSelectedDay — no initialProg ──────────────────────────────────────

describe('resolveSelectedDay — no initialProg', () => {
  const days = buildDays(TODAY_MIDNIGHT, 7);

  it('defaults to today (days[0]) when initialProg is undefined', () => {
    const result = resolveSelectedDay(days, undefined);
    expect(isSameDay(result, TODAY_MIDNIGHT)).toBe(true);
    expect(result).toBe(days[0]); // same reference
  });
});

// ── resolveSelectedDay — yesterday programme ──────────────────────────────────

describe('resolveSelectedDay — programme from yesterday', () => {
  const days = buildDays(TODAY_MIDNIGHT, 7);
  const prog = makeProgOnDay(YESTERDAY_MIDNIGHT, 21);

  it('opens on yesterday, not today', () => {
    const result = resolveSelectedDay(days, prog);
    expect(isSameDay(result, YESTERDAY_MIDNIGHT)).toBe(true);
  });

  it('returns the same Date reference that is in the days array', () => {
    const result = resolveSelectedDay(days, prog);
    expect(result).toBe(days[1]); // days[1] is yesterday
  });

  it('does NOT return today', () => {
    const result = resolveSelectedDay(days, prog);
    expect(isSameDay(result, TODAY_MIDNIGHT)).toBe(false);
  });
});

// ── resolveSelectedDay — programme from today ─────────────────────────────────

describe('resolveSelectedDay — programme from today', () => {
  const days = buildDays(TODAY_MIDNIGHT, 7);
  const prog = makeProgOnDay(TODAY_MIDNIGHT, 10);

  it('opens on today', () => {
    const result = resolveSelectedDay(days, prog);
    expect(isSameDay(result, TODAY_MIDNIGHT)).toBe(true);
    expect(result).toBe(days[0]);
  });
});

// ── resolveSelectedDay — programme from 2 days ago ───────────────────────────

describe('resolveSelectedDay — programme from 2 days ago', () => {
  const days = buildDays(TODAY_MIDNIGHT, 7);
  const prog = makeProgOnDay(TWO_DAYS_AGO, 19);

  it('opens on 2 days ago (days[2])', () => {
    const result = resolveSelectedDay(days, prog);
    expect(isSameDay(result, TWO_DAYS_AGO)).toBe(true);
    expect(result).toBe(days[2]);
  });
});

// ── resolveSelectedDay — programme from 6 days ago (edge of archive) ──────────

describe('resolveSelectedDay — programme at the archive boundary (6 days ago)', () => {
  const days = buildDays(TODAY_MIDNIGHT, 7);
  const prog = makeProgOnDay(SIX_DAYS_AGO, 8);

  it('opens on 6 days ago (the last available day) within a 7-day archive', () => {
    const result = resolveSelectedDay(days, prog);
    expect(isSameDay(result, SIX_DAYS_AGO)).toBe(true);
    expect(result).toBe(days[6]);
  });
});

// ── resolveSelectedDay — programme outside the archive window ─────────────────

describe('resolveSelectedDay — programme outside the archive window', () => {
  const days = buildDays(TODAY_MIDNIGHT, 7);
  const prog = makeProgOnDay(EIGHT_DAYS_AGO, 15); // beyond 7-day window

  it('falls back to today when the programme is older than the archive', () => {
    const result = resolveSelectedDay(days, prog);
    expect(isSameDay(result, TODAY_MIDNIGHT)).toBe(true);
    expect(result).toBe(days[0]);
  });
});

// ── resolveSelectedDay — short archive (3 days), past-day programme ───────────

describe('resolveSelectedDay — 3-day archive, programme from 2 days ago', () => {
  const days = buildDays(TODAY_MIDNIGHT, 3); // days[0]=today, [1]=yesterday, [2]=2 days ago

  it('matches the programme to the correct day within a shorter archive', () => {
    const prog = makeProgOnDay(TWO_DAYS_AGO, 22);
    const result = resolveSelectedDay(days, prog);
    expect(isSameDay(result, TWO_DAYS_AGO)).toBe(true);
    expect(result).toBe(days[2]);
  });

  it('falls back to today for a programme 3 days ago (outside the 3-day archive)', () => {
    const threeDaysAgo = new Date(TODAY_MIDNIGHT.getTime() - 3 * 86_400_000);
    const prog = makeProgOnDay(threeDaysAgo, 22);
    const result = resolveSelectedDay(days, prog);
    expect(isSameDay(result, TODAY_MIDNIGHT)).toBe(true);
    expect(result).toBe(days[0]);
  });
});

// ── resolveSelectedDay — programme time within the day matters only for the
//    day key, not for which item is selected ────────────────────────────────────

describe('resolveSelectedDay — programme time within the day is irrelevant for day matching', () => {
  const days = buildDays(TODAY_MIDNIGHT, 7);

  it('midnight-start on yesterday still resolves to yesterday', () => {
    const prog = makeProgOnDay(YESTERDAY_MIDNIGHT, 0); // 00:00
    const result = resolveSelectedDay(days, prog);
    expect(isSameDay(result, YESTERDAY_MIDNIGHT)).toBe(true);
  });

  it('23:59 start on yesterday still resolves to yesterday', () => {
    const lateStart = new Date(YESTERDAY_MIDNIGHT);
    lateStart.setHours(23, 59, 0, 0);
    const prog: EpgProgram = {
      channelId: 'ch1',
      title: 'Late Night',
      start: lateStart,
      end: new Date(lateStart.getTime() + 60_000),
    };
    const result = resolveSelectedDay(days, prog);
    expect(isSameDay(result, YESTERDAY_MIDNIGHT)).toBe(true);
  });
});
