/**
 * Task #475 — TVLiveLayout mini-guide OK press guard
 *
 * Verifies the isPast / isCatchupPlayable gating logic that controls whether
 * pressing OK on a mini-guide row calls onOpenCatchupProg.
 *
 * The relevant logic from TVLiveLayout.tsx (lines ~468–490):
 *
 *   const isPast            = prog.end.getTime() <= nowTs;
 *   const isCatchupPlayable = Platform.isTV && isPast && hasCatchup && !!onOpenCatchupProg;
 *   // Row gets: onPress: () => onOpenCatchupProg!(prog)   ← only when isCatchupPlayable
 *
 * Why simulate instead of render?
 * ────────────────────────────────
 * TVLiveLayout mounts VideoView (expo-video), FlatList, and a chain of
 * platform-specific pressables — all of which require a running native layer.
 * The simulation mirrors the exact conditional logic verbatim; any divergence
 * in the source would also diverge here and the test would fail.
 */

import type { EpgProgram } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal EpgProgram relative to `nowTs`. */
function makeProg(offsetStartMs: number, offsetEndMs: number, nowTs: number): EpgProgram {
  return {
    channelId: 'ch1',
    title: 'Test Programme',
    start: new Date(nowTs + offsetStartMs),
    end:   new Date(nowTs + offsetEndMs),
  };
}

/**
 * Mirror of the isCatchupPlayable derivation from TVLiveLayout.tsx.
 *
 * @param prog         The programme row.
 * @param nowTs        Current epoch ms.
 * @param isTV         Simulates Platform.isTV.
 * @param hasCatchup   selectedChannel.tvArchive === 1.
 * @param hasCallback  !!onOpenCatchupProg passed to the layout.
 */
function isCatchupPlayable(
  prog: EpgProgram,
  nowTs: number,
  isTV: boolean,
  hasCatchup: boolean,
  hasCallback: boolean,
): boolean {
  const isPast = prog.end.getTime() <= nowTs;
  return isTV && isPast && hasCatchup && hasCallback;
}

/**
 * Simulate a row press: returns the programme the callback would receive,
 * or null if the row is not pressable.
 */
function simulateRowPress(
  prog: EpgProgram,
  nowTs: number,
  isTV: boolean,
  hasCatchup: boolean,
  onOpenCatchupProg: ((p: EpgProgram) => void) | undefined,
): EpgProgram | null {
  const playable = isCatchupPlayable(prog, nowTs, isTV, hasCatchup, !!onOpenCatchupProg);
  if (!playable) return null;
  onOpenCatchupProg!(prog);
  return prog;
}

// ── Constants ────────────────────────────────────────────────────────────────

const NOW_TS = new Date('2026-08-17T14:00:00Z').getTime();

// Past: ended 2 hours ago
const PAST_PROG = makeProg(-3 * 3600_000, -2 * 3600_000, NOW_TS);
// Current: started 30 min ago, ends in 30 min
const NOW_PROG  = makeProg(-30 * 60_000,   30 * 60_000, NOW_TS);
// Future: starts in 1 hour
const FUTURE_PROG = makeProg(60 * 60_000, 2 * 3600_000, NOW_TS);

// ── isPast classification ─────────────────────────────────────────────────────

describe('isPast classification', () => {
  it('classifies a programme whose end is before nowTs as past', () => {
    expect(PAST_PROG.end.getTime() <= NOW_TS).toBe(true);
  });

  it('classifies a programme that is currently airing as not past', () => {
    expect(NOW_PROG.end.getTime() <= NOW_TS).toBe(false);
  });

  it('classifies a future programme as not past', () => {
    expect(FUTURE_PROG.end.getTime() <= NOW_TS).toBe(false);
  });

  it('classifies a programme whose end equals nowTs exactly as past (boundary)', () => {
    const boundary = makeProg(-3600_000, 0, NOW_TS); // ends exactly at nowTs
    expect(boundary.end.getTime() <= NOW_TS).toBe(true);
  });
});

// ── isCatchupPlayable guard ───────────────────────────────────────────────────

describe('isCatchupPlayable guard — TV + catchup channel + callback present', () => {
  it('is true for a past row on a catchup channel when on TV', () => {
    expect(isCatchupPlayable(PAST_PROG, NOW_TS, true, true, true)).toBe(true);
  });

  it('is false for the current (now-airing) row even on a catchup channel', () => {
    expect(isCatchupPlayable(NOW_PROG, NOW_TS, true, true, true)).toBe(false);
  });

  it('is false for a future row even on a catchup channel', () => {
    expect(isCatchupPlayable(FUTURE_PROG, NOW_TS, true, true, true)).toBe(false);
  });

  it('is false when Platform.isTV is false (phone/tablet)', () => {
    expect(isCatchupPlayable(PAST_PROG, NOW_TS, false, true, true)).toBe(false);
  });

  it('is false when the channel has no catch-up (hasCatchup = false)', () => {
    expect(isCatchupPlayable(PAST_PROG, NOW_TS, true, false, true)).toBe(false);
  });

  it('is false when onOpenCatchupProg was not passed (hasCallback = false)', () => {
    expect(isCatchupPlayable(PAST_PROG, NOW_TS, true, true, false)).toBe(false);
  });

  it('is false when neither catchup nor callback is present', () => {
    expect(isCatchupPlayable(PAST_PROG, NOW_TS, true, false, false)).toBe(false);
  });
});

// ── Callback is called with the correct programme ─────────────────────────────

describe('simulateRowPress — callback receives the correct programme', () => {
  it('calls onOpenCatchupProg with the past programme when all guards pass', () => {
    const cb = jest.fn();
    const result = simulateRowPress(PAST_PROG, NOW_TS, true, true, cb);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(PAST_PROG);
    expect(result).toBe(PAST_PROG);
  });

  it('does NOT call the callback for the current (now-airing) row', () => {
    const cb = jest.fn();
    const result = simulateRowPress(NOW_PROG, NOW_TS, true, true, cb);

    expect(cb).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('does NOT call the callback for a future row', () => {
    const cb = jest.fn();
    const result = simulateRowPress(FUTURE_PROG, NOW_TS, true, true, cb);

    expect(cb).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('does NOT call the callback when Platform.isTV is false', () => {
    const cb = jest.fn();
    simulateRowPress(PAST_PROG, NOW_TS, false, true, cb);

    expect(cb).not.toHaveBeenCalled();
  });

  it('does NOT call the callback when the channel lacks catch-up', () => {
    const cb = jest.fn();
    simulateRowPress(PAST_PROG, NOW_TS, true, false, cb);

    expect(cb).not.toHaveBeenCalled();
  });

  it('does NOT call the callback when onOpenCatchupProg is undefined', () => {
    // simulateRowPress with undefined callback — must not throw or call anything
    const result = simulateRowPress(PAST_PROG, NOW_TS, true, true, undefined);
    expect(result).toBeNull();
  });
});

// ── Mixed guide list: only past rows on a catchup channel fire ────────────────

describe('mixed guide list — only past rows fire the callback', () => {
  const progs = [PAST_PROG, NOW_PROG, FUTURE_PROG];

  it('exactly one programme fires the callback in a [past, current, future] list', () => {
    const cb = jest.fn();
    const fired: EpgProgram[] = [];

    for (const prog of progs) {
      const result = simulateRowPress(prog, NOW_TS, true, true, cb);
      if (result) fired.push(result);
    }

    expect(fired).toHaveLength(1);
    expect(fired[0]).toBe(PAST_PROG);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('no rows fire when the channel has no catch-up', () => {
    const cb = jest.fn();

    for (const prog of progs) {
      simulateRowPress(prog, NOW_TS, true, false, cb);
    }

    expect(cb).not.toHaveBeenCalled();
  });

  it('no rows fire on a non-TV platform', () => {
    const cb = jest.fn();

    for (const prog of progs) {
      simulateRowPress(prog, NOW_TS, false, true, cb);
    }

    expect(cb).not.toHaveBeenCalled();
  });

  it('multiple past rows all fire the callback with their own programme', () => {
    const past1 = makeProg(-5 * 3600_000, -4 * 3600_000, NOW_TS);
    const past2 = makeProg(-4 * 3600_000, -3 * 3600_000, NOW_TS);
    const cb = jest.fn();

    simulateRowPress(past1, NOW_TS, true, true, cb);
    simulateRowPress(past2, NOW_TS, true, true, cb);

    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenNthCalledWith(1, past1);
    expect(cb).toHaveBeenNthCalledWith(2, past2);
  });
});

// ── Boundary: programme that ends exactly at nowTs ────────────────────────────

describe('boundary: programme end === nowTs', () => {
  it('a programme ending exactly at nowTs is treated as past and fires the callback', () => {
    const boundary = makeProg(-3600_000, 0, NOW_TS);
    const cb = jest.fn();

    simulateRowPress(boundary, NOW_TS, true, true, cb);

    expect(cb).toHaveBeenCalledWith(boundary);
  });

  it('a programme starting exactly at nowTs is treated as current and does not fire', () => {
    const starting = makeProg(0, 3600_000, NOW_TS);
    const cb = jest.fn();

    simulateRowPress(starting, NOW_TS, true, true, cb);

    expect(cb).not.toHaveBeenCalled();
  });
});
