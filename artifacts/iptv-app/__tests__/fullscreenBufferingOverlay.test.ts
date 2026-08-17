/**
 * Regression guard — fullscreen live player must not show a stuck "Connecting"
 * spinner over an already-playing stream.
 *
 * Background
 * ──────────
 * PlayerScreen mounts with `isBuffering = true` and relies on a `readyToPlay`
 * status-change event to clear the overlay.  When the user expands a healthy
 * mini-player the shared player never fires a new `readyToPlay` event — it is
 * already streaming.  Without an explicit mount-time check the spinner sits on
 * top of a perfectly good picture indefinitely.
 *
 * The fix reads the shared player's live state at mount and calls
 * `setIsBuffering(false)` immediately when `player.playing` is true OR
 * `status === 'readyToPlay'`.  A genuine cold load (player idle/loading)
 * must NOT clear the overlay — it still needs the future event.
 *
 * Covered scenarios
 * ─────────────────
 * A. URL matches + player.playing === true
 *      → setIsBuffering(false) called at mount — overlay cleared immediately.
 *
 * B. URL matches + status === 'readyToPlay' (paused but ready)
 *      → setIsBuffering(false) called at mount — overlay cleared immediately.
 *
 * C. URL matches + player neither playing nor readyToPlay (cold load / buffering)
 *      → setIsBuffering(false) NOT called at mount — waits for statusChange event.
 *
 * D. URL does NOT match (channel switch path)
 *      → player.replace() runs; mount-time setIsBuffering(false) must not fire.
 *
 * E. Structural — the overlay-clear block is inside the URL-match branch only,
 *    positioned AFTER the idle/error restart guard.
 *
 * All tests use source-text inspection of player.tsx — no native modules
 * required, consistent with the rest of this test suite.
 */

const fs   = require('fs');
const path = require('path');

const PLAYER_PATH = path.resolve(__dirname, '../app/player.tsx');
const player: string = fs.readFileSync(PLAYER_PATH, 'utf-8');

// ── Locate the mount effect ────────────────────────────────────────────────────
// Anchor on the comment that starts the useEffect block.
const EFFECT_ANCHOR =
  'Ensure the correct URL is loaded in the shared player when opening fullscreen.';

const effectStart = player.indexOf(EFFECT_ANCHOR);

function getEffectBody(): string {
  if (effectStart === -1) throw new Error('Mount effect anchor not found in player.tsx');
  const closeMarker = '// eslint-disable-line react-hooks/exhaustive-deps';
  const closePos = player.indexOf(closeMarker, effectStart);
  if (closePos === -1) throw new Error('Mount effect closing marker not found');
  return player.slice(effectStart, closePos + closeMarker.length);
}

// Extract the URL-match branch (if liveUrlRef.current === params.url) body,
// stopping at the else clause.
function getUrlMatchBranch(body: string): string {
  const branchStart = body.indexOf('liveUrlRef.current === params.url');
  if (branchStart === -1) throw new Error('URL-match branch not found in mount effect');
  const elsePos = body.indexOf('} else {', branchStart);
  if (elsePos === -1) throw new Error('else clause not found after URL-match branch');
  return body.slice(branchStart, elsePos);
}

// Extract the URL-mismatch else branch.
function getUrlMismatchBranch(body: string): string {
  const elsePos = body.indexOf('} else {');
  if (elsePos === -1) throw new Error('else clause not found in mount effect body');
  return body.slice(elsePos);
}

// ── Locate the overlay-clear block inside the URL-match branch ────────────────
// Anchored by the explanatory comment the developer left in the code.
const OVERLAY_COMMENT = 'Stuck-"Connecting" fix';

function getOverlayBlock(matchBranch: string): string {
  const commentPos = matchBranch.indexOf(OVERLAY_COMMENT);
  if (commentPos === -1) {
    throw new Error(
      `Overlay-clear comment ("${OVERLAY_COMMENT}") not found in URL-match branch. ` +
      'Was the stuck-spinner fix removed or the comment changed?'
    );
  }
  // Extract from the comment to the closing brace of the if-block (~700 chars
  // covers the comment + condition + setIsBuffering call).
  return matchBranch.slice(commentPos, commentPos + 700);
}

// =============================================================================
// A. player.playing === true → overlay cleared immediately
// =============================================================================

describe('Scenario A — URL matches, player.playing=true → overlay cleared at mount', () => {
  it('the overlay-clear block checks player.playing', () => {
    const body         = getEffectBody();
    const matchBranch  = getUrlMatchBranch(body);
    const overlayBlock = getOverlayBlock(matchBranch);

    // The condition must reference player.playing
    expect(overlayBlock).toMatch(/player\.playing/);
  });

  it('setIsBuffering(false) is called inside the overlay-clear block', () => {
    const body         = getEffectBody();
    const matchBranch  = getUrlMatchBranch(body);
    const overlayBlock = getOverlayBlock(matchBranch);

    expect(overlayBlock).toMatch(/setIsBuffering\s*\(\s*false\s*\)/);
  });

  it('setIsBuffering(false) is NOT called unconditionally (requires condition)', () => {
    // The call must be inside an if-block, not at the top level of the branch.
    const body        = getEffectBody();
    const matchBranch = getUrlMatchBranch(body);
    const overlayBlock = getOverlayBlock(matchBranch);

    // There must be an `if (` before setIsBuffering(false)
    const ifPos         = overlayBlock.indexOf('if (');
    const setBufferingPos = overlayBlock.indexOf('setIsBuffering(false)');

    expect(ifPos).toBeGreaterThan(-1);
    expect(setBufferingPos).toBeGreaterThan(-1);
    expect(ifPos).toBeLessThan(setBufferingPos);
  });
});

// =============================================================================
// B. status === 'readyToPlay' → overlay cleared immediately
// =============================================================================

describe('Scenario B — URL matches, status=readyToPlay → overlay cleared at mount', () => {
  it("the overlay-clear condition includes status === 'readyToPlay'", () => {
    const body         = getEffectBody();
    const matchBranch  = getUrlMatchBranch(body);
    const overlayBlock = getOverlayBlock(matchBranch);

    expect(overlayBlock).toMatch(/st\s*===\s*['"]readyToPlay['"]/);
  });

  it('player.playing and readyToPlay are joined with OR so either triggers the clear', () => {
    const body         = getEffectBody();
    const matchBranch  = getUrlMatchBranch(body);
    const overlayBlock = getOverlayBlock(matchBranch);

    // Both sides of the OR: `player.playing || st === 'readyToPlay'`
    // (order may vary, so we just confirm both appear with || between them)
    expect(overlayBlock).toMatch(
      /player\.playing\s*\|\|\s*st\s*===\s*['"]readyToPlay['"]|st\s*===\s*['"]readyToPlay['"]\s*\|\|\s*player\.playing/
    );
  });
});

// =============================================================================
// C. Cold load (idle/loading) → overlay stays until statusChange fires
// =============================================================================

describe('Scenario C — URL matches, player idle/loading → overlay NOT cleared at mount', () => {
  it('setIsBuffering(false) is only called inside a conditional, never unconditionally', () => {
    // If setIsBuffering(false) were called unconditionally in the URL-match
    // branch, a cold load would hide the spinner before the stream is ready.
    // Verify the call is always gated.
    const body        = getEffectBody();
    const matchBranch = getUrlMatchBranch(body);

    // Split by lines; any line that contains setIsBuffering(false) and does
    // NOT follow an `if (` in the surrounding context (within 3 lines) is a
    // regression.  Strategy: count bare top-level setIsBuffering(false) calls.
    const lines = matchBranch.split('\n');
    let depth = 0; // brace depth relative to branch start
    let bareCall = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      // Track depth so we can identify top-level statements (depth 0)
      for (const ch of line) {
        if (ch === '{') depth++;
        if (ch === '}') depth--;
      }
      // A setIsBuffering(false) at depth 0 would be unconditional
      if (line.includes('setIsBuffering(false)') && depth === 0) {
        bareCall = true;
      }
    }

    expect(bareCall).toBe(false);
  });

  it('the overlay-clear block is distinct from and positioned after the idle/error restart block', () => {
    // The idle/error restart block (`if (!player.playing && (st === 'idle' || st === 'error'))`)
    // must appear BEFORE the overlay-clear block so a cold-idle player gets
    // replace+play first and the spinner stays until readyToPlay fires.
    const body        = getEffectBody();
    const matchBranch = getUrlMatchBranch(body);

    const idleGuardPos   = matchBranch.indexOf("st === 'idle'");
    const overlayComment = matchBranch.indexOf(OVERLAY_COMMENT);

    expect(idleGuardPos).toBeGreaterThan(-1);
    expect(overlayComment).toBeGreaterThan(-1);
    // Overlay clear comes after the idle/error restart logic
    expect(overlayComment).toBeGreaterThan(idleGuardPos);
  });
});

// =============================================================================
// D. URL does NOT match (channel-switch path) → no mount-time overlay clear
// =============================================================================

describe('Scenario D — URL does not match (channel switch) → overlay NOT cleared at mount', () => {
  it('the URL-mismatch else branch does not call setIsBuffering(false)', () => {
    // On a genuine channel switch the player starts buffering a new URL —
    // the overlay must stay visible until the stream is ready.
    const body          = getEffectBody();
    const mismatchBranch = getUrlMismatchBranch(body);

    expect(mismatchBranch).not.toMatch(/setIsBuffering\s*\(\s*false\s*\)/);
  });

  it('the overlay-clear comment is absent from the URL-mismatch branch', () => {
    const body           = getEffectBody();
    const mismatchBranch = getUrlMismatchBranch(body);

    expect(mismatchBranch).not.toContain(OVERLAY_COMMENT);
  });
});

// =============================================================================
// E. Structural invariants
// =============================================================================

describe('Structural invariants — overlay-clear block scope and comment', () => {
  it('the explanatory comment is present in the URL-match branch', () => {
    // The comment acts as both documentation and a stable anchor for these tests.
    // Its presence confirms the fix block has not been accidentally deleted.
    const body        = getEffectBody();
    const matchBranch = getUrlMatchBranch(body);

    expect(matchBranch).toContain(OVERLAY_COMMENT);
  });

  it('setIsBuffering(false) in the overlay block follows the if-condition on the next logical line', () => {
    // The pattern must be:
    //   if (player.playing || st === 'readyToPlay') {
    //     setIsBuffering(false);
    //   }
    // Not a ternary or inline expression that could accidentally fire on cold load.
    const body         = getEffectBody();
    const matchBranch  = getUrlMatchBranch(body);
    const overlayBlock = getOverlayBlock(matchBranch);

    // The if condition and the setIsBuffering call must both be present
    const ifLine    = overlayBlock.indexOf('if (');
    const callLine  = overlayBlock.indexOf('setIsBuffering(false)');
    expect(ifLine).toBeGreaterThan(-1);
    expect(callLine).toBeGreaterThan(ifLine);
  });

  it('the statusChange listener also clears isBuffering so a genuine cold load still works', () => {
    // The overlay-clear at mount is the mini-player-expand fast path.
    // The statusChange listener is the fallback for cold loads — it must
    // still call setIsBuffering(false) when status becomes readyToPlay.
    // Anchor on the listener registration line.
    const listenerPos = player.indexOf("player.addListener('statusChange'");
    expect(listenerPos).toBeGreaterThan(-1);

    // Within the next 600 chars (the listener callback body), confirm:
    // 1. 'readyToPlay' status check is present
    // 2. setIsBuffering(false) is called
    const listenerBody = player.slice(listenerPos, listenerPos + 600);
    expect(listenerBody).toMatch(/readyToPlay/);
    expect(listenerBody).toMatch(/setIsBuffering\s*\(\s*false\s*\)/);
  });
});
