/**
 * TVLiveLayout mini-guide OK press guard
 *
 * Verifies the isPast / isCatchupRowPlayable gating logic that controls whether
 * pressing OK on a mini-guide row calls onOpenCatchupProg, AND that the
 * channelHasCatchup derivation uses strict equality (tvArchive === 1) so that
 * tvArchive: 0 and absent tvArchive keep catch-up fully locked.
 *
 * Tests import the real production helpers from utils/catchup.ts so that any
 * change to the guards in source code will break these tests immediately.
 *
 * The relevant logic from TVLiveLayout.tsx:
 *
 *   const hasCatchup        = channelHasCatchup(selectedChannel);
 *   const isPast            = prog.end.getTime() <= nowTs;
 *   const isCatchupPlayable = isCatchupRowPlayable(prog, nowTs, Platform.isTV, hasCatchup, !!onOpenCatchupProg);
 *   // Row gets: onPress: () => onOpenCatchupProg!(prog)   ← only when isCatchupPlayable
 *
 * Why simulate instead of render?
 * ────────────────────────────────
 * TVLiveLayout mounts VideoView (expo-video), FlatList, and a chain of
 * platform-specific pressables — all of which require a running native layer.
 * The simulation uses the real production helpers verbatim; any divergence
 * in the source immediately propagates to these tests.
 */

import type { EpgProgram } from '../types';
import { channelHasCatchup, isCatchupRowPlayable } from '../utils/catchup';

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
 * Simulate a row press using the real production helpers: returns the programme
 * the callback would receive, or null if the row is not pressable.
 */
function simulateRowPress(
  prog: EpgProgram,
  nowTs: number,
  isTV: boolean,
  hasCatchup: boolean,
  onOpenCatchupProg: ((p: EpgProgram) => void) | undefined,
): EpgProgram | null {
  const playable = isCatchupRowPlayable(prog, nowTs, isTV, hasCatchup, !!onOpenCatchupProg);
  if (!playable) return null;
  onOpenCatchupProg!(prog);
  return prog;
}

// ── Constants ────────────────────────────────────────────────────────────────

const NOW_TS = new Date('2026-08-17T14:00:00Z').getTime();

// Past: ended 2 hours ago
const PAST_PROG   = makeProg(-3 * 3600_000,  -2 * 3600_000, NOW_TS);
// Current: started 30 min ago, ends in 30 min
const NOW_PROG    = makeProg(-30 * 60_000,    30 * 60_000,  NOW_TS);
// Future: starts in 1 hour
const FUTURE_PROG = makeProg(60 * 60_000, 2 * 3600_000,    NOW_TS);

// ── channelHasCatchup — tvArchive strict equality (production function) ───────

describe('channelHasCatchup — tvArchive strict equality', () => {
  it('is true when tvArchive is exactly 1', () => {
    expect(channelHasCatchup({ tvArchive: 1 } as any)).toBe(true);
  });

  it('is false when tvArchive is 0', () => {
    expect(channelHasCatchup({ tvArchive: 0 } as any)).toBe(false);
  });

  it('is false when tvArchive field is absent (undefined)', () => {
    expect(channelHasCatchup({} as any)).toBe(false);
  });

  it('is false when the channel object is undefined', () => {
    expect(channelHasCatchup(undefined)).toBe(false);
  });

  it('is false when the channel object is null', () => {
    expect(channelHasCatchup(null)).toBe(false);
  });

  it('is false when tvArchive is 2 (only exactly 1 qualifies)', () => {
    expect(channelHasCatchup({ tvArchive: 2 } as any)).toBe(false);
  });

  it('is false when tvArchive is -1', () => {
    expect(channelHasCatchup({ tvArchive: -1 } as any)).toBe(false);
  });
});

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

// ── isCatchupRowPlayable guard (production function) ─────────────────────────

describe('isCatchupRowPlayable — TV + catchup channel + callback present', () => {
  it('is true for a past row on a catchup channel when on TV', () => {
    expect(isCatchupRowPlayable(PAST_PROG, NOW_TS, true, true, true)).toBe(true);
  });

  it('is false for the current (now-airing) row even on a catchup channel', () => {
    expect(isCatchupRowPlayable(NOW_PROG, NOW_TS, true, true, true)).toBe(false);
  });

  it('is false for a future row even on a catchup channel', () => {
    expect(isCatchupRowPlayable(FUTURE_PROG, NOW_TS, true, true, true)).toBe(false);
  });

  it('is false when Platform.isTV is false (phone/tablet)', () => {
    expect(isCatchupRowPlayable(PAST_PROG, NOW_TS, false, true, true)).toBe(false);
  });

  it('is false when the channel has no catch-up (hasCatchup = false)', () => {
    expect(isCatchupRowPlayable(PAST_PROG, NOW_TS, true, false, true)).toBe(false);
  });

  it('is false when onOpenCatchupProg was not passed (hasCallback = false)', () => {
    expect(isCatchupRowPlayable(PAST_PROG, NOW_TS, true, true, false)).toBe(false);
  });

  it('is false when neither catchup nor callback is present', () => {
    expect(isCatchupRowPlayable(PAST_PROG, NOW_TS, true, false, false)).toBe(false);
  });
});

// ── End-to-end: channel object → channelHasCatchup → isCatchupRowPlayable ─────

describe('end-to-end: tvArchive value flows through to playability', () => {
  it('allows catch-up playback when tvArchive === 1', () => {
    const hasCatchup = channelHasCatchup({ tvArchive: 1 } as any);
    expect(isCatchupRowPlayable(PAST_PROG, NOW_TS, true, hasCatchup, true)).toBe(true);
  });

  it('blocks catch-up playback when tvArchive === 0', () => {
    const hasCatchup = channelHasCatchup({ tvArchive: 0 } as any);
    expect(isCatchupRowPlayable(PAST_PROG, NOW_TS, true, hasCatchup, true)).toBe(false);
  });

  it('blocks catch-up playback when tvArchive field is absent', () => {
    const hasCatchup = channelHasCatchup({} as any);
    expect(isCatchupRowPlayable(PAST_PROG, NOW_TS, true, hasCatchup, true)).toBe(false);
  });

  it('blocks catch-up playback when channel is null', () => {
    const hasCatchup = channelHasCatchup(null);
    expect(isCatchupRowPlayable(PAST_PROG, NOW_TS, true, hasCatchup, true)).toBe(false);
  });

  it('blocks catch-up playback when channel is undefined', () => {
    const hasCatchup = channelHasCatchup(undefined);
    expect(isCatchupRowPlayable(PAST_PROG, NOW_TS, true, hasCatchup, true)).toBe(false);
  });

  it('blocks the callback from firing when tvArchive is 0', () => {
    const cb = jest.fn();
    const hasCatchup = channelHasCatchup({ tvArchive: 0 } as any);
    simulateRowPress(PAST_PROG, NOW_TS, true, hasCatchup, cb);
    expect(cb).not.toHaveBeenCalled();
  });

  it('blocks the callback from firing when tvArchive field is absent', () => {
    const cb = jest.fn();
    const hasCatchup = channelHasCatchup({} as any);
    simulateRowPress(PAST_PROG, NOW_TS, true, hasCatchup, cb);
    expect(cb).not.toHaveBeenCalled();
  });

  it('fires the callback when tvArchive is exactly 1', () => {
    const cb = jest.fn();
    const hasCatchup = channelHasCatchup({ tvArchive: 1 } as any);
    simulateRowPress(PAST_PROG, NOW_TS, true, hasCatchup, cb);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(PAST_PROG);
  });
});

// ── Callback receives the correct programme ───────────────────────────────────

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
