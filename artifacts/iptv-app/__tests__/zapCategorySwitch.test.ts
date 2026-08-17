/**
 * Regression guard — switching channel categories during a zap must cancel
 * the pending commit across the FULL two-stage path AND synchronously when
 * the user selects a channel from a different category.
 *
 * Background
 * ──────────
 * showTvChannelPreview arms a 250 ms setTimeout.  When it fires, it nulls
 * tvPreviewTimerRef.current and starts a 120 ms Animated.timing fade-out;
 * onCommit (→ switchChannel) only runs in that animation's completion
 * callback.  There is therefore a TWO-STAGE commit path:
 *
 *   Stage 1 (t = 0 … 250 ms): tvPreviewTimerRef holds the live timer.
 *     Cancellation: clearTimeout via handleMenuSelectChannel / useEffect.
 *
 *   Stage 2 (t = 250 … 370 ms): setTimeout has fired; tvPreviewTimerRef is
 *     already null; Animated.timing is running.
 *     Cancellation: gen counter (zapGenRef.current !== gen check).
 *
 * The passive useEffect([channelList]) handles both stages as a backstop, but
 * React defers passive effects — they may flush AFTER the animation completion
 * callback runs.  Therefore handleMenuSelectChannel must ALSO advance
 * zapGenRef.current synchronously (and clear the timer) before calling
 * setChannelList / switchChannel, so the gen guard fires even when the effect
 * hasn't been committed yet.
 *
 * These tests verify:
 *   Source-text:
 *     1. zapGenRef is declared and snapshotted in showTvChannelPreview.
 *     2. Animation callback guards onCommit with the gen check.
 *     3. tvPreviewTimerRef.current is nulled when the 250 ms timeout fires.
 *     4. handleMenuSelectChannel increments zapGenRef synchronously before
 *        setChannelList / switchChannel.
 *     5. useEffect([channelList]) also increments zapGenRef (backstop).
 *     6. useEffect([channelList]) clears tvPreviewTimerRef + resets state.
 *     7. Unmount cleanup still exists.
 *   Behavioural:
 *     8. Stage-1 cancel via handleMenuSelectChannel (synchronous).
 *     9. Stage-2 cancel via gen guard when handleMenuSelectChannel is
 *        called after the timeout fires but before the animation completes
 *        (the passive-effect delay scenario).
 *    10. Stage-2 cancel via gen guard when the passive useEffect fires.
 *    11. Normal commit fires when no cancellation occurs.
 *    12. Post-commit category switch is a safe no-op.
 *    13. Zapping after a category switch commits the new channel.
 *    14. Rapid zap → Stage-2 handleMenuSelectChannel → no commit.
 */

import fs   from 'fs';
import path from 'path';

// ── Source file ───────────────────────────────────────────────────────────────

const PLAYER_PATH = path.resolve(__dirname, '../app/player.tsx');
const player: string = fs.readFileSync(PLAYER_PATH, 'utf-8');

// ── Helpers ───────────────────────────────────────────────────────────────────

function getShowTvChannelPreviewBody(): string {
  const ANCHOR = 'const showTvChannelPreview = useCallback((';
  const CLOSE  = '}, [tvPreviewOpacity, epgMap, nowTs]);';
  const start  = player.indexOf(ANCHOR);
  if (start === -1) throw new Error('showTvChannelPreview anchor not found');
  const end = player.indexOf(CLOSE, start);
  if (end === -1) throw new Error('showTvChannelPreview closing deps not found');
  return player.slice(start, end + CLOSE.length);
}

function getChannelListEffectBlock(): string {
  const OPEN  = '// Cancel any pending zap-preview timer when the channel list is replaced';
  const CLOSE = '}, [channelList]);';
  const start = player.indexOf(OPEN);
  if (start === -1) throw new Error('channelList useEffect open marker not found');
  const end = player.indexOf(CLOSE, start);
  if (end === -1) throw new Error('channelList useEffect closing deps not found');
  return player.slice(start, end + CLOSE.length);
}

function getHandleMenuSelectChannelBody(): string {
  const ANCHOR = 'const handleMenuSelectChannel = useCallback(';
  const CLOSE  = '[switchChannel],\n  );';
  const start  = player.indexOf(ANCHOR);
  if (start === -1) throw new Error('handleMenuSelectChannel anchor not found');
  const end = player.indexOf(CLOSE, start);
  if (end === -1) throw new Error('handleMenuSelectChannel closing deps not found');
  return player.slice(start, end + CLOSE.length);
}

// =============================================================================
// 1. Source-text: zapGenRef declaration + snapshot
// =============================================================================

describe('zapGenRef — declaration and snapshot (source-text)', () => {
  it('zapGenRef is declared as a useRef(0)', () => {
    expect(player).toMatch(/zapGenRef\s*=\s*useRef\s*\(\s*0\s*\)/);
  });

  it('showTvChannelPreview snapshots the generation before the setTimeout', () => {
    const body = getShowTvChannelPreviewBody();
    expect(body).toMatch(/const\s+gen\s*=\s*zapGenRef\.current/);
    const genPos        = body.indexOf('const gen = zapGenRef.current');
    const setTimeoutPos = body.indexOf('tvPreviewTimerRef.current = setTimeout(');
    expect(genPos).toBeGreaterThan(-1);
    expect(setTimeoutPos).toBeGreaterThan(-1);
    expect(genPos).toBeLessThan(setTimeoutPos);
  });
});

// =============================================================================
// 2. Source-text: animation callback gen guard
// =============================================================================

describe('animation callback — gen guard (source-text)', () => {
  let body: string;
  beforeAll(() => { body = getShowTvChannelPreviewBody(); });

  it('contains if (zapGenRef.current !== gen) return inside the .start() callback', () => {
    expect(body).toMatch(/if\s*\(\s*zapGenRef\.current\s*!==\s*gen\s*\)\s*return/);
  });

  it('gen guard appears before onCommit()', () => {
    const guardPos  = body.indexOf('zapGenRef.current !== gen');
    const commitPos = body.indexOf('onCommit()');
    expect(guardPos).toBeGreaterThan(-1);
    expect(commitPos).toBeGreaterThan(-1);
    expect(guardPos).toBeLessThan(commitPos);
  });

  it('gen guard is inside the fade-out Animated.timing .start() callback', () => {
    const animPos  = body.indexOf('Animated.timing(tvPreviewOpacity, { toValue: 0');
    const guardPos = body.indexOf('zapGenRef.current !== gen');
    expect(animPos).toBeGreaterThan(-1);
    expect(guardPos).toBeGreaterThan(animPos);
  });
});

// =============================================================================
// 3. Source-text: tvPreviewTimerRef nulled when timeout fires
// =============================================================================

describe('tvPreviewTimerRef — nulled on timeout fire (source-text)', () => {
  it('tvPreviewTimerRef.current is set to null inside the setTimeout body before Animated.timing', () => {
    const body = getShowTvChannelPreviewBody();

    // The setTimeout body must assign null BEFORE starting the animation.
    const setTimeoutPos = body.indexOf('tvPreviewTimerRef.current = setTimeout(');
    expect(setTimeoutPos).toBeGreaterThan(-1);

    // Extract from after `setTimeout(` to the end of its body
    const innerStart = setTimeoutPos + 'tvPreviewTimerRef.current = setTimeout('.length;
    const inner = body.slice(innerStart);

    // null assignment must appear before Animated.timing toValue:0 in the inner body
    const nullPos  = inner.indexOf('tvPreviewTimerRef.current = null');
    const animPos  = inner.indexOf('Animated.timing(tvPreviewOpacity, { toValue: 0');
    expect(nullPos).toBeGreaterThan(-1);
    expect(animPos).toBeGreaterThan(-1);
    expect(nullPos).toBeLessThan(animPos);
  });
});

// =============================================================================
// 4. Source-text: handleMenuSelectChannel advances gen synchronously
// =============================================================================

describe('handleMenuSelectChannel — synchronous gen advancement (source-text)', () => {
  let body: string;
  beforeAll(() => { body = getHandleMenuSelectChannelBody(); });

  it('increments zapGenRef.current', () => {
    expect(body).toMatch(/zapGenRef\.current\s*\+=\s*1/);
  });

  it('gen increment appears before setChannelList', () => {
    const genPos  = body.indexOf('zapGenRef.current += 1');
    const listPos = body.indexOf('setChannelList(');
    expect(genPos).toBeGreaterThan(-1);
    expect(listPos).toBeGreaterThan(-1);
    expect(genPos).toBeLessThan(listPos);
  });

  it('gen increment appears before switchChannel', () => {
    const genPos    = body.indexOf('zapGenRef.current += 1');
    const switchPos = body.indexOf('switchChannel(');
    expect(genPos).toBeGreaterThan(-1);
    expect(switchPos).toBeGreaterThan(-1);
    expect(genPos).toBeLessThan(switchPos);
  });

  it('clears tvPreviewTimerRef when a timer is pending', () => {
    expect(body).toMatch(/clearTimeout\s*\(\s*tvPreviewTimerRef\.current\s*\)/);
    expect(body).toMatch(/tvPreviewTimerRef\.current\s*=\s*null/);
  });
});

// =============================================================================
// 5–6. Source-text: useEffect([channelList]) is a backstop
// =============================================================================

describe('useEffect([channelList]) — backstop gen + cleanup (source-text)', () => {
  let block: string;
  beforeAll(() => { block = getChannelListEffectBlock(); });

  it('depends only on [channelList]', () => {
    expect(block).toMatch(/},\s*\[\s*channelList\s*\]\s*\);/);
  });

  it('increments zapGenRef.current unconditionally', () => {
    expect(block).toMatch(/zapGenRef\.current\s*\+=\s*1/);
    // Must be outside (before) any if-guard so it fires even when no timer pending
    const genPos   = block.indexOf('zapGenRef.current += 1');
    const guardPos = block.indexOf('if (tvPreviewTimerRef.current)');
    expect(genPos).toBeGreaterThan(-1);
    if (guardPos !== -1) expect(genPos).toBeLessThan(guardPos);
  });

  it('clears tvPreviewTimerRef and resets overlay state', () => {
    expect(block).toMatch(/clearTimeout\s*\(\s*tvPreviewTimerRef\.current\s*\)/);
    expect(block).toMatch(/setTvPreviewChannel\s*\(\s*null\s*\)/);
    expect(block).toMatch(/setTvPreviewDir\s*\(\s*null\s*\)/);
    expect(block).toMatch(/setTvPreviewNowProg\s*\(\s*null\s*\)/);
  });
});

// =============================================================================
// 7. Source-text: unmount cleanup still exists
// =============================================================================

describe('unmount cleanup — still present (source-text)', () => {
  it('the unmount-only useEffect([]) still clears tvPreviewTimerRef', () => {
    const marker = "// Clean up the TV preview timer on unmount so it can't fire after the";
    const start  = player.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const snippet = player.slice(start, start + 300);
    expect(snippet).toMatch(/},\s*\[\s*\]\s*\);/);
    expect(snippet).toMatch(/clearTimeout\s*\(\s*tvPreviewTimerRef\.current\s*\)/);
  });
});

// =============================================================================
// 8–14. Behavioural simulation (fake timers)
// =============================================================================

/**
 * Faithful simulation matching the revised player.tsx structure:
 *
 *   showTvChannelPreview:
 *     • clears+nulls timerRef before starting
 *     • snapshots gen at call time
 *     • setTimeout(250): nulls timerRef THEN starts 120 ms "animation"
 *     • animation callback: gen guard → onCommit
 *
 *   handleMenuSelectChannel (synchronous path):
 *     • increments gen
 *     • clearTimeout if timer still pending; nulls timerRef + resets state
 *     • does NOT wait for React passive effect
 *
 *   useEffect([channelList]) (passive/deferred backstop):
 *     • increments gen + clears timer (same logic, just deferred)
 */

interface SimRef<T> { current: T }

function makeZapSim() {
  const timerRef: SimRef<ReturnType<typeof setTimeout> | null> = { current: null };
  const zapGenRef: SimRef<number> = { current: 0 };
  const state = { channel: null as string | null, dir: null as string | null };
  const commits: string[] = [];

  // ── showTvChannelPreview ─────────────────────────────────────────────────
  function zapPreview(channel: string, dir: 'prev' | 'next'): void {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const gen = zapGenRef.current;
    state.channel = channel;
    state.dir = dir;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;         // <-- nulled when timeout fires
      setTimeout(() => {               // 120 ms animation window
        if (zapGenRef.current !== gen) return;
        state.channel = null;
        state.dir = null;
        commits.push(channel);
      }, 120);
    }, 250);
  }

  // ── handleMenuSelectChannel (synchronous) ────────────────────────────────
  function menuSelectChannel(): void {
    zapGenRef.current += 1;            // advance gen immediately
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      state.channel = null;
      state.dir = null;
    }
    // setChannelList / switchChannel happen after this point
  }

  // ── useEffect([channelList]) — deferred backstop ─────────────────────────
  function channelListEffect(): void {
    zapGenRef.current += 1;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      state.channel = null;
      state.dir = null;
    }
  }

  return { zapPreview, menuSelectChannel, channelListEffect, timerRef, zapGenRef, state, commits };
}

describe('zap-category-switch — behavioural simulation (fake timers)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(()  => jest.useRealTimers());

  // 8. Stage-1 cancel via handleMenuSelectChannel (synchronous)
  it('[Stage 1] menuSelectChannel before 250 ms cancels via clearTimeout', () => {
    const { zapPreview, menuSelectChannel, commits } = makeZapSim();
    zapPreview('ch-5', 'next');
    jest.advanceTimersByTime(100);
    menuSelectChannel();
    jest.advanceTimersByTime(500);
    expect(commits).toHaveLength(0);
  });

  // 9. Stage-2 cancel via gen guard — menuSelectChannel called synchronously
  //    after the 250 ms timeout fires but before the 120 ms animation completes.
  //    This is the "passive-effect delay" scenario: React hasn't flushed the
  //    useEffect yet, but menuSelectChannel ran synchronously.
  it('[Stage 2] menuSelectChannel after 250 ms timeout (timerRef already null) cancels via gen guard', () => {
    const { zapPreview, menuSelectChannel, timerRef, commits } = makeZapSim();
    zapPreview('ch-7', 'prev');
    jest.advanceTimersByTime(250);           // Stage-1 timeout fires; timerRef → null
    expect(timerRef.current).toBeNull();    // confirm timerRef is null (Stage 2)
    menuSelectChannel();                     // synchronous — must block via gen
    jest.advanceTimersByTime(120);           // animation callback fires
    expect(commits).toHaveLength(0);
  });

  // 10. Stage-2 cancel via useEffect([channelList]) backstop
  it('[Stage 2] channelListEffect (passive backstop) also cancels via gen guard', () => {
    const { zapPreview, channelListEffect, timerRef, commits } = makeZapSim();
    zapPreview('ch-4', 'next');
    jest.advanceTimersByTime(250);
    expect(timerRef.current).toBeNull();
    channelListEffect();
    jest.advanceTimersByTime(120);
    expect(commits).toHaveLength(0);
  });

  // 11. Normal commit fires when no cancellation occurs
  it('commit fires normally when no category switch occurs', () => {
    const { zapPreview, commits } = makeZapSim();
    zapPreview('ch-1', 'next');
    jest.advanceTimersByTime(250 + 120 + 10);
    expect(commits).toEqual(['ch-1']);
  });

  // 12. Post-commit category switch is a safe no-op
  it('menuSelectChannel after commit has already fired is a safe no-op', () => {
    const { zapPreview, menuSelectChannel, commits } = makeZapSim();
    zapPreview('ch-3', 'prev');
    jest.advanceTimersByTime(400);          // both stages complete
    menuSelectChannel();
    jest.advanceTimersByTime(500);
    expect(commits).toEqual(['ch-3']);
  });

  // 13. Zapping after a category switch commits the new channel
  it('zapping after menuSelectChannel starts a fresh generation and commits the new channel', () => {
    const { zapPreview, menuSelectChannel, commits } = makeZapSim();
    zapPreview('old-ch', 'next');
    jest.advanceTimersByTime(50);
    menuSelectChannel();
    zapPreview('new-ch', 'next');
    jest.advanceTimersByTime(400);
    expect(commits).toEqual(['new-ch']);
  });

  // 14. Rapid zap → Stage-2 menuSelectChannel → no commit
  it('rapid zap followed by Stage-2 menuSelectChannel (timerRef null) cancels all commits', () => {
    const { zapPreview, menuSelectChannel, timerRef, commits } = makeZapSim();
    zapPreview('ch-1', 'next');
    jest.advanceTimersByTime(40);
    zapPreview('ch-2', 'next');
    jest.advanceTimersByTime(40);
    zapPreview('ch-3', 'next');
    // 80 ms elapsed since the first press; ch-3 timer was armed at t=80 and
    // fires 250 ms later (t=330).  Advance exactly 250 ms from the last press
    // so the Stage-1 timeout fires and timerRef becomes null (Stage 2).
    jest.advanceTimersByTime(250);           // ch-3 timeout fires; timerRef → null
    expect(timerRef.current).toBeNull();    // confirm we are now in Stage 2
    menuSelectChannel();                     // gen guard must kill the animation callback
    jest.advanceTimersByTime(120);
    expect(commits).toHaveLength(0);
  });
});
