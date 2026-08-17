/**
 * Regression guard — stale-URL re-resolve must not loop or reload a healthy stream.
 *
 * Background
 * ──────────
 * The fullscreen mount effect resets `didResolveStaleUrlRef` to `false` every
 * time the player enters fullscreen (even when the stream is playing fine).
 * The statusChange handler also resets it to `false` on `readyToPlay`.
 *
 * If the re-resolve path were keyed on the reset alone — rather than on an
 * actual error status — it could fire after an expand of a healthy stream and
 * issue an unnecessary `player.replace()` that interrupts playback.
 *
 * This file pins the correct behaviour:
 *
 *   A. The re-resolve gate (`!didResolveStaleUrlRef.current`) is only evaluated
 *      inside the `status === 'error'` block — NOT inside `readyToPlay`.
 *
 *   B. The `readyToPlay` branch resets `didResolveStaleUrlRef` but NEVER calls
 *      `player.replace()`.
 *
 *   C. The mount effect resets `didResolveStaleUrlRef` but NEVER calls the
 *      async re-resolve path (it only calls replace() for the idle/error
 *      first-channel fix — a different, synchronous branch).
 *
 *   D. `resolveSessionRef` is bumped on `readyToPlay` so any in-flight
 *      re-resolve from a prior error is silently discarded when the stream
 *      recovers on its own.
 *
 *   E. The actual `player.replace(freshUrl)` in the re-resolve path is guarded
 *      by a session-token equality check, preventing a stale async result from
 *      clobbering a stream that is already playing after recovery.
 *
 * All tests are source-text inspection of player.tsx — no native modules needed.
 */

const fs   = require('fs');
const path = require('path');

const PLAYER_PATH = path.resolve(__dirname, '../app/player.tsx');
const src: string = fs.readFileSync(PLAYER_PATH, 'utf-8');

// ── Locate the statusChange listener block ────────────────────────────────────
// Starts at the addListener call; ends just before the timeUpdate listener.
const STATUS_CHANGE_ANCHOR = "player.addListener('statusChange',";
const STATUS_CHANGE_END    = "player.addListener('timeUpdate',";

function getStatusChangeBlock(): string {
  const start = src.indexOf(STATUS_CHANGE_ANCHOR);
  if (start === -1) throw new Error("statusChange listener anchor not found");
  const end = src.indexOf(STATUS_CHANGE_END, start);
  if (end === -1) throw new Error("timeUpdate listener anchor not found (expected after statusChange)");
  return src.slice(start, end);
}

// ── Locate the readyToPlay sub-block ─────────────────────────────────────────
// From `if (status === 'readyToPlay')` up to the error block that follows it.
const READY_ANCHOR = "if (status === 'readyToPlay')";
const ERROR_ANCHOR = "if (status === 'error' || error)";

function getReadyToPlayBlock(statusBlock: string): string {
  const start = statusBlock.indexOf(READY_ANCHOR);
  if (start === -1) throw new Error("readyToPlay block not found");
  const end = statusBlock.indexOf(ERROR_ANCHOR, start);
  if (end === -1) throw new Error("error block boundary not found after readyToPlay");
  return statusBlock.slice(start, end);
}

// ── Locate the error sub-block ───────────────────────────────────────────────
function getErrorBlock(statusBlock: string): string {
  const start = statusBlock.indexOf(ERROR_ANCHOR);
  if (start === -1) throw new Error("error block not found");
  return statusBlock.slice(start);
}

// ── Locate the mount effect ───────────────────────────────────────────────────
const MOUNT_EFFECT_ANCHOR =
  'Ensure the correct URL is loaded in the shared player when opening fullscreen.';

function getMountEffect(): string {
  const start = src.indexOf(MOUNT_EFFECT_ANCHOR);
  if (start === -1) throw new Error('Mount effect anchor not found in player.tsx');
  const closeMarker = '// eslint-disable-line react-hooks/exhaustive-deps';
  const closePos = src.indexOf(closeMarker, start);
  if (closePos === -1) throw new Error('Mount effect closing marker not found');
  return src.slice(start, closePos + closeMarker.length);
}

// =============================================================================
// A. Re-resolve gate is only inside the error block, not in readyToPlay
// =============================================================================

describe('Scenario A — re-resolve gate lives in error block only', () => {
  it('!didResolveStaleUrlRef.current gate appears inside the error block', () => {
    const statusBlock = getStatusChangeBlock();
    const errorBlock  = getErrorBlock(statusBlock);

    expect(errorBlock).toMatch(/!\s*didResolveStaleUrlRef\.current/);
  });

  it('!didResolveStaleUrlRef.current gate does NOT appear inside the readyToPlay block', () => {
    const statusBlock      = getStatusChangeBlock();
    const readyToPlayBlock = getReadyToPlayBlock(statusBlock);

    // The re-resolve gate must not leak into the healthy-stream branch
    expect(readyToPlayBlock).not.toMatch(/!\s*didResolveStaleUrlRef\.current/);
  });

  it('the re-resolve activation (didResolveStaleUrlRef = true) only occurs in the error block', () => {
    // `didResolveStaleUrlRef.current = true` is written only when the re-resolve
    // path actually starts — that assignment must not appear in readyToPlay.
    const statusBlock      = getStatusChangeBlock();
    const readyToPlayBlock = getReadyToPlayBlock(statusBlock);

    expect(readyToPlayBlock).not.toMatch(/didResolveStaleUrlRef\.current\s*=\s*true/);
  });
});

// =============================================================================
// B. readyToPlay resets the ref but does NOT call player.replace()
// =============================================================================

describe('Scenario B — readyToPlay resets didResolveStaleUrlRef without calling replace()', () => {
  it('readyToPlay block resets didResolveStaleUrlRef to false', () => {
    const statusBlock      = getStatusChangeBlock();
    const readyToPlayBlock = getReadyToPlayBlock(statusBlock);

    expect(readyToPlayBlock).toMatch(/didResolveStaleUrlRef\.current\s*=\s*false/);
  });

  it('readyToPlay block does NOT call player.replace()', () => {
    // A replace() here would restart a stream that just reported it is healthy.
    const statusBlock      = getStatusChangeBlock();
    const readyToPlayBlock = getReadyToPlayBlock(statusBlock);

    expect(readyToPlayBlock).not.toMatch(/player\.replace\s*\(/);
  });

  it('readyToPlay block clears reconnect state (setIsReconnecting, setIsResolvingUrl)', () => {
    // These state updates confirm the block is correctly winding down error state,
    // not initiating a new stream load.
    const statusBlock      = getStatusChangeBlock();
    const readyToPlayBlock = getReadyToPlayBlock(statusBlock);

    expect(readyToPlayBlock).toMatch(/setIsReconnecting\s*\(\s*false\s*\)/);
    expect(readyToPlayBlock).toMatch(/setIsResolvingUrl\s*\(\s*false\s*\)/);
  });
});

// =============================================================================
// C. Mount effect resets the ref but does NOT invoke the async re-resolve path
// =============================================================================

describe('Scenario C — mount effect resets didResolveStaleUrlRef without triggering re-resolve', () => {
  it('mount effect contains didResolveStaleUrlRef.current = false', () => {
    const mountEffect = getMountEffect();
    expect(mountEffect).toMatch(/didResolveStaleUrlRef\.current\s*=\s*false/);
  });

  it('mount effect does NOT call getXtreamLiveStreams (the async re-resolve fetch)', () => {
    // getXtreamLiveStreams is only called from the statusChange error path.
    // The mount effect must never reach it directly.
    const mountEffect = getMountEffect();
    expect(mountEffect).not.toMatch(/getXtreamLiveStreams/);
  });

  it('mount effect does NOT call fetchAndParseM3U (the M3U re-resolve fetch)', () => {
    // Same constraint: M3U re-resolution is only triggered on stream error.
    const mountEffect = getMountEffect();
    expect(mountEffect).not.toMatch(/fetchAndParseM3U/);
  });

  it('mount effect does NOT evaluate !didResolveStaleUrlRef.current as a re-resolve gate', () => {
    // The mount effect writes the ref — it must not read it as a branch condition.
    const mountEffect = getMountEffect();
    expect(mountEffect).not.toMatch(/!\s*didResolveStaleUrlRef\.current/);
  });
});

// =============================================================================
// D. resolveSessionRef is bumped on readyToPlay to cancel in-flight re-resolves
// =============================================================================

describe('Scenario D — resolveSessionRef bump cancels in-flight re-resolve on recovery', () => {
  it('readyToPlay block increments resolveSessionRef', () => {
    const statusBlock      = getStatusChangeBlock();
    const readyToPlayBlock = getReadyToPlayBlock(statusBlock);

    // The session counter must be bumped so stale async re-resolve callbacks
    // detect the mismatch and bail out without replacing the healthy stream.
    expect(readyToPlayBlock).toMatch(/resolveSessionRef\.current\s*\+=/);
  });

  it('resolveSessionRef increment comes after the didResolveStaleUrlRef reset', () => {
    // Order matters: reset the gate first, then advance the session so any
    // in-flight closure sees the new token and discards its result.
    const statusBlock      = getStatusChangeBlock();
    const readyToPlayBlock = getReadyToPlayBlock(statusBlock);

    const resetPos    = readyToPlayBlock.indexOf('didResolveStaleUrlRef.current = false');
    const sessionBump = readyToPlayBlock.indexOf('resolveSessionRef.current +=');

    expect(resetPos).toBeGreaterThan(-1);
    expect(sessionBump).toBeGreaterThan(-1);
    expect(resetPos).toBeLessThan(sessionBump);
  });
});

// =============================================================================
// E. The replace() in the re-resolve path is guarded by session-token equality
// =============================================================================

describe('Scenario E — re-resolve replace() is protected by session-token equality check', () => {
  it('the re-resolve async closure captures resolveSession before yielding', () => {
    // `const resolveSession = resolveSessionRef.current` must be captured
    // synchronously so it can be compared after the async fetch returns.
    const statusBlock = getStatusChangeBlock();
    const errorBlock  = getErrorBlock(statusBlock);

    expect(errorBlock).toMatch(/const resolveSession\s*=\s*resolveSessionRef\.current/);
  });

  it('a session-token equality check guards the path inside the async closure', () => {
    // `resolveSession !== resolveSessionRef.current` — if the token has changed,
    // the closure returns without calling replace(), preventing a stale async
    // result from clobbering a stream that recovered on its own.
    const statusBlock = getStatusChangeBlock();
    const errorBlock  = getErrorBlock(statusBlock);

    expect(errorBlock).toMatch(/resolveSession\s*!==\s*resolveSessionRef\.current/);
  });

  it('player.replace(freshUrl) is only called when freshUrl differs from activeUrlRef', () => {
    // `freshUrl !== activeUrlRef.current` — a URL that matches the current
    // stream is not worth replacing; the check prevents a no-op reload that
    // would cause a visible buffering blip on a healthy stream.
    const statusBlock = getStatusChangeBlock();
    const errorBlock  = getErrorBlock(statusBlock);

    expect(errorBlock).toMatch(/freshUrl\s*&&\s*freshUrl\s*!==\s*activeUrlRef\.current/);
  });

  it('player.replace(freshUrl) is only present inside the re-resolve async IIFE', () => {
    // Confirm the replace is wrapped in an async IIFE — not called synchronously
    // in the error handler body — so the session-token guard has time to run.
    const statusBlock = getStatusChangeBlock();
    const errorBlock  = getErrorBlock(statusBlock);

    // The IIFE pattern: `(async () => { … })()`
    const asyncPos   = errorBlock.indexOf('(async () =>');
    const replacePos = errorBlock.indexOf('player.replace(freshUrl)', asyncPos < 0 ? 0 : asyncPos);

    expect(asyncPos).toBeGreaterThan(-1);
    expect(replacePos).toBeGreaterThan(asyncPos);
  });
});

// =============================================================================
// F. Structural invariant — error block is the sole place re-resolve fires
// =============================================================================

describe('Structural invariant — re-resolve is gated on error status alone', () => {
  it('the re-resolve gate combines activeChannelIdRef check with !didResolveStaleUrlRef check', () => {
    // Both conditions must be present — channelId ensures there is a channel to
    // re-resolve, and the flag ensures we only attempt it once per error episode.
    const statusBlock = getStatusChangeBlock();
    const errorBlock  = getErrorBlock(statusBlock);

    expect(errorBlock).toMatch(
      /activeChannelIdRef\.current\s*&&\s*!\s*didResolveStaleUrlRef\.current|!\s*didResolveStaleUrlRef\.current\s*&&\s*activeChannelIdRef\.current/,
    );
  });

  it('setIsResolvingUrl(true) only appears inside the error block, not in readyToPlay', () => {
    // This state flag shows "Refreshing stream…" — it must only appear when
    // the stream is actually in error, never on a healthy readyToPlay.
    const statusBlock      = getStatusChangeBlock();
    const readyToPlayBlock = getReadyToPlayBlock(statusBlock);
    const errorBlock       = getErrorBlock(statusBlock);

    expect(errorBlock).toMatch(/setIsResolvingUrl\s*\(\s*true\s*\)/);
    expect(readyToPlayBlock).not.toMatch(/setIsResolvingUrl\s*\(\s*true\s*\)/);
  });
});
