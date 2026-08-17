/**
 * Regression guard — rapid D-pad zapping must never fire switchChannel for
 * a channel the user skipped past.
 *
 * Background
 * ──────────
 * showTvChannelPreview in app/player.tsx shows a 250 ms preview overlay and
 * then calls onCommit (which calls switchChannel → player.replace()).  Each
 * new press must cancel the outstanding timer before scheduling a fresh one
 * so that only the final channel in a rapid run triggers a stream load.
 *
 * If the clear-before-set pattern were ever removed, every intermediate
 * channel would call player.replace(), hammering the provider with stream
 * requests and degrading the zapping experience.
 *
 * These tests verify:
 *   1. Source-text: the function clears any pending timer before setting a
 *      new one, the commit delay is exactly 250 ms, and the onCommit call
 *      sits inside the animation callback (not directly in setTimeout).
 *   2. Behavioural: a faithful simulation of the coalescing mechanism (same
 *      clearTimeout → setTimeout → animation-callback chain) proves that N
 *      rapid presses produce exactly ONE commit, targeting the last channel,
 *      and zero commits for every skipped channel.
 */

import fs   from 'fs';
import path from 'path';

// ── Source file ───────────────────────────────────────────────────────────────

const PLAYER_PATH = path.resolve(__dirname, '../app/player.tsx');
const player: string = fs.readFileSync(PLAYER_PATH, 'utf-8');

// ── Extract the showTvChannelPreview body ─────────────────────────────────────

const STP_ANCHOR = 'const showTvChannelPreview = useCallback((';
const STP_CLOSE  = '}, [tvPreviewOpacity, epgMap, nowTs]);';

function getShowTvChannelPreviewBody(): string {
  const start = player.indexOf(STP_ANCHOR);
  if (start === -1) throw new Error('showTvChannelPreview anchor not found in player.tsx');

  const end = player.indexOf(STP_CLOSE, start);
  if (end === -1) throw new Error('showTvChannelPreview closing deps marker not found in player.tsx');

  return player.slice(start, end + STP_CLOSE.length);
}

// =============================================================================
// 1. Source-text: timer coalescing structure is present
// =============================================================================

describe('showTvChannelPreview — timer coalescing structure (source-text)', () => {
  const body = getShowTvChannelPreviewBody();

  it('clears tvPreviewTimerRef.current before setting a new timer', () => {
    // The guard must appear unconditionally at the top of the function body.
    // Pattern: clearTimeout is called, then the ref is nulled, all before the
    // new setTimeout assignment.
    expect(body).toMatch(/clearTimeout\s*\(\s*tvPreviewTimerRef\.current\s*\)/);
    expect(body).toMatch(/tvPreviewTimerRef\.current\s*=\s*null/);

    const clearPos  = body.indexOf('clearTimeout(tvPreviewTimerRef.current)');
    const assignPos = body.lastIndexOf('tvPreviewTimerRef.current = setTimeout(');

    expect(clearPos).toBeGreaterThan(-1);
    expect(assignPos).toBeGreaterThan(-1);
    // The clear must come before the new assignment in source order.
    expect(clearPos).toBeLessThan(assignPos);
  });

  it('commit delay is 250 ms (not the old 700 ms)', () => {
    // The setTimeout that schedules the commit must use 250 ms.
    // 700 ms would be a regression (pre-optimisation value).
    expect(body).toMatch(/setTimeout\s*\(\s*\(\s*\)\s*=>/);
    expect(body).toMatch(/,\s*250\s*\)/);
    expect(body).not.toMatch(/,\s*700\s*\)/);
  });

  it('onCommit is called inside the Animated fade-out callback, not bare in setTimeout', () => {
    // The 250 ms timer starts a fade-out animation; onCommit fires in the
    // animation's completion callback.  A bare `onCommit()` at the top level
    // of the setTimeout body (i.e. before `Animated.timing`) would fire without
    // waiting for the fade, but more critically it would still fire once per
    // press rather than being coalesced — the key guarantee here is that
    // onCommit() only appears inside the Animated.timing().start() callback.
    //
    // Strategy: extract the text between `tvPreviewTimerRef.current = setTimeout(`
    // and the matching closing `)`, then verify onCommit is inside the
    // .start( callback, not before the Animated call.
    const setTimeoutPos = body.indexOf('tvPreviewTimerRef.current = setTimeout(');
    expect(setTimeoutPos).toBeGreaterThan(-1);

    // Find the Animated.timing call inside the setTimeout body
    const animatedPos = body.indexOf('Animated.timing(tvPreviewOpacity', setTimeoutPos);
    expect(animatedPos).toBeGreaterThan(setTimeoutPos);

    // onCommit must appear AFTER the Animated.timing call, not before
    const onCommitPos = body.indexOf('onCommit()', setTimeoutPos);
    expect(onCommitPos).toBeGreaterThan(animatedPos);
  });

  it('the timer guard is placed before any state setters — first thing in the function', () => {
    // The cancel must happen before setTvPreviewChannel / setTvPreviewDir etc.
    // so a rapid press doesn't briefly flash stale state from the previous press.
    const clearPos    = body.indexOf('clearTimeout(tvPreviewTimerRef.current)');
    const statePos    = body.indexOf('setTvPreviewChannel(channel)');

    expect(clearPos).toBeGreaterThan(-1);
    expect(statePos).toBeGreaterThan(-1);
    expect(clearPos).toBeLessThan(statePos);
  });
});

// =============================================================================
// 2. Behavioural: simulation with Jest fake timers
// =============================================================================

// Faithful simulation of the coalescing mechanism from showTvChannelPreview.
// We omit the Animated layer (no native modules in Jest) and call onCommit
// synchronously when the animation callback would fire — the coalescing
// property depends only on the clearTimeout → setTimeout structure, not on
// the animation duration.

interface SimRef { current: ReturnType<typeof setTimeout> | null }

function makeZapSimulator() {
  const timerRef: SimRef = { current: null };

  // Returns the channel passed to onCommit when the timer fires.
  function zapPreview(channel: string, onCommit: (ch: string) => void): void {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    timerRef.current = setTimeout(() => {
      // Simulate the Animated.timing completion callback calling onCommit.
      onCommit(channel);
    }, 250);
  }

  return { zapPreview, timerRef };
}

describe('showTvChannelPreview — coalescing behavioural (fake timers)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(()  => jest.useRealTimers());

  it('a single press fires onCommit exactly once after 250 ms', () => {
    const { zapPreview } = makeZapSimulator();
    const commits: string[] = [];

    zapPreview('ch-1', (ch) => commits.push(ch));

    expect(commits).toHaveLength(0);          // nothing yet
    jest.advanceTimersByTime(250);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toBe('ch-1');
  });

  it('two rapid presses fire onCommit exactly once, for the second channel', () => {
    const { zapPreview } = makeZapSimulator();
    const commits: string[] = [];

    zapPreview('ch-1', (ch) => commits.push(ch));
    jest.advanceTimersByTime(100);            // 100 ms — still within delay
    zapPreview('ch-2', (ch) => commits.push(ch));
    jest.advanceTimersByTime(250);            // fire the second timer

    expect(commits).toHaveLength(1);
    expect(commits[0]).toBe('ch-2');          // ch-1 was cancelled
  });

  it('N rapid presses fire onCommit exactly once, targeting the last channel', () => {
    const { zapPreview } = makeZapSimulator();
    const commits: string[] = [];

    const channels = ['ch-1', 'ch-2', 'ch-3', 'ch-4', 'ch-5'];
    let elapsed = 0;

    // Each press comes 40 ms after the previous — well inside the 250 ms window.
    for (const ch of channels) {
      zapPreview(ch, (c) => commits.push(c));
      if (ch !== channels[channels.length - 1]) {
        jest.advanceTimersByTime(40);
        elapsed += 40;
      }
    }

    // At this point 160 ms have elapsed; the last timer needs 250 ms to fire.
    expect(commits).toHaveLength(0);          // nothing committed yet

    jest.advanceTimersByTime(250);            // fire the surviving timer
    expect(commits).toHaveLength(1);
    expect(commits[0]).toBe('ch-5');          // only the last channel
  });

  it('skipped channels never appear in the commit list', () => {
    const { zapPreview } = makeZapSimulator();
    const commits: string[] = [];

    const channels = ['ch-A', 'ch-B', 'ch-C', 'ch-D', 'ch-E', 'ch-F', 'ch-G'];

    for (const ch of channels) {
      zapPreview(ch, (c) => commits.push(c));
      jest.advanceTimersByTime(30);           // 30 ms between presses
    }

    jest.advanceTimersByTime(250);

    // Every intermediate channel must be absent from the commit list.
    const skipped = channels.slice(0, -1);
    for (const ch of skipped) {
      expect(commits).not.toContain(ch);
    }
    expect(commits).toEqual(['ch-G']);
  });

  it('a pause long enough to expire the timer commits that channel and starts fresh', () => {
    // User taps ch-1, waits > 250 ms, then taps ch-2.
    // Both should commit (separate zap sessions).
    const { zapPreview } = makeZapSimulator();
    const commits: string[] = [];

    zapPreview('ch-1', (ch) => commits.push(ch));
    jest.advanceTimersByTime(300);            // > 250 ms → ch-1 commits
    zapPreview('ch-2', (ch) => commits.push(ch));
    jest.advanceTimersByTime(300);            // > 250 ms → ch-2 commits

    expect(commits).toEqual(['ch-1', 'ch-2']);
  });

  it('pressing again before 250 ms resets the countdown — commit fires 250 ms after the last press', () => {
    const { zapPreview } = makeZapSimulator();
    const commits: string[] = [];

    zapPreview('ch-1', (ch) => commits.push(ch));
    jest.advanceTimersByTime(200);            // 200 ms — timer not yet fired
    zapPreview('ch-2', (ch) => commits.push(ch));

    // Only 200 ms have passed since the second press — not enough to commit.
    jest.advanceTimersByTime(200);
    expect(commits).toHaveLength(0);

    // Now 250 ms since the second press — commit fires.
    jest.advanceTimersByTime(50);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toBe('ch-2');
  });
});
