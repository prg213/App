/**
 * Regression guard — first-channel load fix must not restart a healthy stream.
 *
 * Background
 * ──────────
 * The fullscreen mount effect in player.tsx was extended to handle a race where
 * the Live TV tab writes liveUrlRef BEFORE its async replaceAsync resolves.
 * On the very first channel watch this left the shared player in 'idle' or
 * 'error' status even though liveUrlRef.current already equalled params.url,
 * so play() alone did nothing and the screen stayed black.
 *
 * The fix force-replaces the stream only when the player is in 'idle' or
 * 'error' — states that only occur during that first-channel race.  When the
 * stream is already loading or playing (the normal mini-player expand path)
 * the fix must stay silent so it never introduces a reload blip.
 *
 * Covered scenarios
 * ─────────────────
 * A. URL matches + player.playing === true (playing state)
 *      → no replace call; stream left untouched.
 *
 * B. URL matches + player.playing === false + status not 'idle'/'error'
 *      (e.g. 'loading' / 'readyToPlay') — expanding from mini-player while
 *      the stream is still buffering.
 *      → no replace call; play() is called at most (resume-only).
 *
 * C. URL matches + player.playing === false + status === 'idle'
 *      → replace + play called (first-channel fix activates).
 *
 * D. URL matches + player.playing === false + status === 'error'
 *      → replace + play called (first-channel fix activates on failed stream).
 *
 * E. URL does NOT match
 *      → replace + play always called (normal channel-switch path).
 *
 * All tests use source-text inspection of player.tsx — no native modules
 * required, consistent with the rest of this test suite.
 */

const fs   = require('fs');
const path = require('path');

const PLAYER_PATH = path.resolve(__dirname, '../app/player.tsx');
const player: string = fs.readFileSync(PLAYER_PATH, 'utf-8');

// ── Locate the mount effect ───────────────────────────────────────────────────
// The effect is `useEffect(() => { if (!isLive || isWeb) return; … }, []);`
// Anchor on the comment that explains the liveUrlRef equality guard.
const EFFECT_ANCHOR =
  'Ensure the correct URL is loaded in the shared player when opening fullscreen.';

const effectStart = player.indexOf(EFFECT_ANCHOR);

function getEffectBody(): string {
  if (effectStart === -1) throw new Error('Mount effect anchor not found in player.tsx');
  // The effect closes with `}, []); // eslint-disable-line react-hooks/exhaustive-deps`
  // Find the closing ], []); that terminates this specific useEffect.
  const closeMarker = '// eslint-disable-line react-hooks/exhaustive-deps';
  const closePos = player.indexOf(closeMarker, effectStart);
  if (closePos === -1) throw new Error('Mount effect closing marker not found');
  return player.slice(effectStart, closePos + closeMarker.length);
}

// ── Helper: locate the liveUrlRef-match branch ───────────────────────────────
// The branch starts at `if (liveUrlRef.current === params.url) {`
function getUrlMatchBranch(body: string): string {
  const branchStart = body.indexOf('liveUrlRef.current === params.url');
  if (branchStart === -1) throw new Error('URL-match branch not found in mount effect');
  // The else clause begins after the closing brace of this if block.
  // We extract from the branch start up to (but not including) the else.
  const elsePos = body.indexOf('} else {', branchStart);
  if (elsePos === -1) throw new Error('else clause not found after URL-match branch');
  return body.slice(branchStart, elsePos);
}

function getUrlMismatchBranch(body: string): string {
  const elsePos = body.indexOf('} else {');
  if (elsePos === -1) throw new Error('else clause not found in mount effect body');
  return body.slice(elsePos);
}

// =============================================================================
// A. Playing state — no replace
// =============================================================================

describe('Scenario A — URL matches, player is playing → no replace call', () => {
  it('the idle/error guard checks player.playing before calling replace', () => {
    // The fix must only replace when the player is NOT playing AND in idle/error.
    // If player.playing is true the condition `!player.playing` is false and the
    // entire replace branch is skipped.
    const body = getEffectBody();
    const matchBranch = getUrlMatchBranch(body);

    // The condition must combine !player.playing with idle/error status check
    expect(matchBranch).toMatch(/!player\.playing.*idle.*error|!player\.playing.*error.*idle/);
  });

  it('no unconditional replace call exists inside the URL-match branch', () => {
    // A bare `player.replace` inside the URL-match branch (outside the
    // idle/error guard) would restart a playing stream on every expand.
    const body       = getEffectBody();
    const matchBranch = getUrlMatchBranch(body);

    // Extract lines containing player.replace — none should appear outside
    // the idle/error if-block.
    // Strategy: the only replace inside the match branch must be guarded by
    // the `st === 'idle' || st === 'error'` condition that immediately precedes it.
    const replacePos = matchBranch.indexOf('player.replace');
    if (replacePos === -1) return; // no replace at all — test passes by definition

    // Find the nearest preceding condition
    const condPos = matchBranch.lastIndexOf('idle', replacePos);
    expect(condPos).toBeGreaterThan(-1); // idle/error condition must precede it
    expect(condPos).toBeLessThan(replacePos);
  });

  it('the playing branch (no idle/error) does not call replace', () => {
    // When player.playing is true, neither the idle/error block nor the
    // `else if (!player.playing)` block executes — no replace should appear
    // in a path reachable when playing===true.
    const body       = getEffectBody();
    const matchBranch = getUrlMatchBranch(body);

    // Confirm there is no replace call outside the !player.playing guard:
    // scan for `player.replace` that is NOT preceded by `!player.playing`
    // within the same block.
    const lines = matchBranch.split('\n');
    let inPlayingGuard = false;
    let replacedOutsideGuard = false;
    for (const line of lines) {
      if (line.includes('!player.playing')) { inPlayingGuard = true; }
      if (!inPlayingGuard && line.includes('player.replace')) {
        replacedOutsideGuard = true;
      }
    }
    expect(replacedOutsideGuard).toBe(false);
  });
});

// =============================================================================
// B. Loading/buffering state — no replace, play() allowed
// =============================================================================

describe('Scenario B — URL matches, player status is loading/readyToPlay → no replace', () => {
  it('the fallback else-if branch calls play() but not replace()', () => {
    // The `else if (!player.playing)` branch (status is neither idle nor error)
    // should call player.play() to resume a stream that was paused, but must
    // NOT call player.replace() which would interrupt a buffering stream.
    const body        = getEffectBody();
    const matchBranch = getUrlMatchBranch(body);

    // Find the else-if branch: `} else if (!player.playing) {`
    const elseIfPos = matchBranch.indexOf('} else if (!player.playing)');
    expect(elseIfPos).toBeGreaterThan(-1);

    // Extract the else-if block body (up to its closing brace)
    const elseIfBody = matchBranch.slice(elseIfPos, elseIfPos + 200);

    // play() must be present
    expect(elseIfBody).toMatch(/player\.play\(\)/);

    // replace() must NOT appear in this block
    expect(elseIfBody).not.toMatch(/player\.replace\(/);
  });

  it('status is read from the player object, not hardcoded', () => {
    // The fix reads `(player as any).status` dynamically — a hardcoded
    // string comparison against the status variable would be fragile.
    const body = getEffectBody();
    expect(body).toMatch(/\(player as any\)\.status|(player as any)\['status'\]/);
  });
});

// =============================================================================
// C. Idle state — replace + play must fire
// =============================================================================

describe('Scenario C — URL matches, status is idle → replace + play called', () => {
  it("idle status is one of the conditions that triggers replace+play", () => {
    const body        = getEffectBody();
    const matchBranch = getUrlMatchBranch(body);

    // The guard must contain `st === 'idle'`
    expect(matchBranch).toMatch(/st\s*===\s*['"]idle['"]/);
  });

  it('replace is called before play inside the idle/error block', () => {
    const body        = getEffectBody();
    const matchBranch = getUrlMatchBranch(body);

    // Locate the idle/error guard block
    const guardPos = matchBranch.indexOf("st === 'idle'");
    expect(guardPos).toBeGreaterThan(-1);

    // Within the next 200 chars, replace must precede play
    const guardBody  = matchBranch.slice(guardPos, guardPos + 200);
    const replacePos = guardBody.indexOf('player.replace(');
    const playPos    = guardBody.indexOf('player.play()');

    expect(replacePos).toBeGreaterThan(-1);
    expect(playPos).toBeGreaterThan(-1);
    expect(replacePos).toBeLessThan(playPos);
  });

  it('the URL passed to replace() in the idle/error block is params.url', () => {
    const body        = getEffectBody();
    const matchBranch = getUrlMatchBranch(body);

    const guardPos  = matchBranch.indexOf("st === 'idle'");
    const guardBody = matchBranch.slice(guardPos, guardPos + 200);

    expect(guardBody).toMatch(/player\.replace\s*\(\s*params\.url\s*\)/);
  });
});

// =============================================================================
// D. Error state — replace + play must fire
// =============================================================================

describe('Scenario D — URL matches, status is error → replace + play called', () => {
  it("error status is one of the conditions that triggers replace+play", () => {
    const body        = getEffectBody();
    const matchBranch = getUrlMatchBranch(body);

    // The guard must contain `st === 'error'`
    expect(matchBranch).toMatch(/st\s*===\s*['"]error['"]/);
  });

  it('idle and error are combined with OR in the guard', () => {
    const body        = getEffectBody();
    const matchBranch = getUrlMatchBranch(body);

    // Both conditions on a single line/expression joined by ||
    expect(matchBranch).toMatch(
      /st\s*===\s*['"]idle['"]\s*\|\|\s*st\s*===\s*['"]error['"]|st\s*===\s*['"]error['"]\s*\|\|\s*st\s*===\s*['"]idle['"]/
    );
  });
});

// =============================================================================
// E. URL does NOT match — replace + play always called (channel-switch path)
// =============================================================================

describe('Scenario E — URL does not match → replace + play always called', () => {
  it('the else branch updates liveUrlRef to params.url', () => {
    const body        = getEffectBody();
    const mismatchBranch = getUrlMismatchBranch(body);

    expect(mismatchBranch).toMatch(/liveUrlRef\.current\s*=\s*params\.url/);
  });

  it('the else branch calls replace with params.url', () => {
    const body        = getEffectBody();
    const mismatchBranch = getUrlMismatchBranch(body);

    expect(mismatchBranch).toMatch(/player\.replace\s*\(\s*params\.url\s*\)/);
  });

  it('the else branch calls play() after replace()', () => {
    const body        = getEffectBody();
    const mismatchBranch = getUrlMismatchBranch(body);

    const replacePos = mismatchBranch.indexOf('player.replace(params.url)');
    const playPos    = mismatchBranch.indexOf('player.play()');

    expect(replacePos).toBeGreaterThan(-1);
    expect(playPos).toBeGreaterThan(-1);
    expect(replacePos).toBeLessThan(playPos);
  });
});

// =============================================================================
// F. Structural invariant — the guard is inside the URL-match branch only
// =============================================================================

describe('Structural invariant — idle/error guard is scoped to the URL-match branch', () => {
  it("idle/error guard does not appear in the URL-mismatch (else) branch", () => {
    // The else branch always replaces regardless of status — it must not
    // contain a status guard that would accidentally suppress a needed replace.
    const body        = getEffectBody();
    const mismatchBranch = getUrlMismatchBranch(body);

    // The mismatch branch should not contain a st === 'idle' / 'error' gate
    expect(mismatchBranch).not.toMatch(/st\s*===\s*['"]idle['"]/);
    expect(mismatchBranch).not.toMatch(/st\s*===\s*['"]error['"]/);
  });

  it('the mount effect runs only once (empty dependency array)', () => {
    // A non-empty dep array would re-run the effect after every param change,
    // causing repeated replaces on channel-switch animations.
    // The empty array is enforced by the eslint-disable comment on the same line.
    const body = getEffectBody();
    expect(body).toMatch(/},\s*\[\s*\]\s*\)?\s*;?\s*\/\/\s*eslint-disable-line react-hooks\/exhaustive-deps/);
  });

  it('the mount effect is guarded by isLive so it never fires for VOD', () => {
    // VOD streams use a local player — the shared-player guard must be skipped.
    const body = getEffectBody();
    expect(body).toMatch(/if\s*\(\s*!isLive.*return/);
  });
});
