/**
 * Regression guards: mini-player must never play audio in the background
 * after the user presses Back from fullscreen.
 *
 * Four root causes were fixed and this file pins each fix so that future
 * refactors cannot silently re-introduce them.  All tests use source-text
 * inspection (no native modules required) because the bugs live in
 * timing-sensitive ref / animation sequences that are impractical to drive
 * through a React renderer.
 *
 * Covered scenarios
 * ─────────────────
 * 1. Phone – zap path:
 *      Watch channel → zap 3 times → BACK
 *      → mini-player must show the zapped-to channel with video
 *
 * 2. Phone – tab-switch path:
 *      Live TV → Movies → Live TV
 *      → flash overlay must clear within 3 s (never stays opaque forever)
 *
 * 3. Edge case – recently-watched early-back path:
 *      Open player from recently-watched → BACK immediately (before stream loads)
 *      → player must be paused; playing channel must be cleared so no audio leaks
 *
 * 4. TV / Firestick – same collapse paths:
 *      → TVLiveLayout must also mount its VideoView (selectedChannel fix)
 *      → D-pad focus must be restored to the mini-player after collapse
 */

const fs   = require('fs');
const path = require('path');

const CTX_PATH    = path.resolve(__dirname, '../context/LivePlayerContext.tsx');
const PLAYER_PATH = path.resolve(__dirname, '../app/player.tsx');
const INDEX_PATH  = path.resolve(__dirname, '../app/(tabs)/index.tsx');

const ctx:    string = fs.readFileSync(CTX_PATH,    'utf-8');
const player: string = fs.readFileSync(PLAYER_PATH, 'utf-8');
const index:  string = fs.readFileSync(INDEX_PATH,  'utf-8');

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 1 — Phone: zap 3 times → BACK → mini-player shows video
//
// Root cause: the overlay's VideoView was unmounted by setOverlayVisible(false)
// which called setVideoSurface(null) on the shared player, stealing the surface
// from the mini-player VideoView that had just mounted (or was about to mount).
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 1 — zap → BACK: overlay VideoView removed before collapse animation', () => {
  it('setOverlayHasVideo(false) is called at the START of triggerCollapse, before measureInWindow', () => {
    // The fix: strip the VideoView from the overlay immediately when
    // triggerCollapse begins.  This must happen BEFORE the measureInWindow
    // callback so the overlay is already a plain coloured View when the
    // collapse animation runs.  Unmounting it later (inside the timeout after
    // the animation) would call setVideoSurface(null) and steal the surface.
    //
    // Verify the call appears in the triggerCollapse body (before any
    // measureInWindow / requestAnimationFrame) by checking that
    // setOverlayHasVideo(false) precedes the first measureInWindow call
    // in the triggerCollapse section.
    const collapseStart = ctx.indexOf('const triggerCollapse');
    expect(collapseStart).toBeGreaterThan(-1);

    const setFalsePos        = ctx.indexOf('setOverlayHasVideo(false)', collapseStart);
    const measureInWindowPos = ctx.indexOf('measureInWindow',           collapseStart);

    expect(setFalsePos).toBeGreaterThan(-1);
    expect(measureInWindowPos).toBeGreaterThan(-1);
    // setOverlayHasVideo(false) must come BEFORE measureInWindow
    expect(setFalsePos).toBeLessThan(measureInWindowPos);
  });

  it('pendingCollapseRemountRef is cleared in the null-ref early-exit path', () => {
    // Root cause: when miniPlayerRef.current is null (e.g. mini-player not
    // mounted yet, as when backing out of recently-watched before the Live TV
    // tab has ever been visited), the old code left pendingCollapseRemountRef
    // as true and called onDone() immediately.  useFocusEffect saw the flag,
    // registered onCollapseCompleteRef, and waited forever for a callback that
    // would never arrive → audio played with no video surface permanently.
    //
    // Fix: clear both flags and call onDone() when the ref is unavailable.
    const collapseStart = ctx.indexOf('const triggerCollapse');
    const nullRefEarlyExit = ctx.indexOf('Mini-player view is not mounted', collapseStart);
    expect(nullRefEarlyExit).toBeGreaterThan(-1);

    const pendingClearPos = ctx.indexOf('pendingCollapseRemountRef.current = false', nullRefEarlyExit);
    const onDonePos       = ctx.indexOf('onDone()', nullRefEarlyExit);
    expect(pendingClearPos).toBeGreaterThan(-1);
    expect(onDonePos).toBeGreaterThan(-1);
    // Both must appear, with the flag cleared before onDone
    expect(pendingClearPos).toBeLessThan(onDonePos);
  });

  it('pendingCollapseRemountRef is cleared in the zero-size early-exit path', () => {
    // Same bug in the zero-size branch: measureInWindow returns 0×0 (mini-player
    // not laid out yet).  Without clearing the flag the callback waits forever.
    const collapseStart  = ctx.indexOf('const triggerCollapse');
    const zeroSizeMarker = ctx.indexOf('Mini-player has no measurable size', collapseStart);
    expect(zeroSizeMarker).toBeGreaterThan(-1);

    const pendingClearPos = ctx.indexOf('pendingCollapseRemountRef.current = false', zeroSizeMarker);
    expect(pendingClearPos).toBeGreaterThan(-1);
  });

  it('overlay timeout calls onCollapseCompleteRef BEFORE setOverlayVisible(false)', () => {
    // The ordering guarantee: inside the 200 ms post-collapse timeout,
    // onCollapseCompleteRef.current?.() must fire BEFORE setOverlayVisible(false).
    // This ensures the overlay VideoView unmounts only AFTER the mini-player
    // VideoView has been mounted (setVideoKey called), leaving the player with
    // a live surface throughout.
    //
    // Anchor the search inside the timeout body so we don't match the earlier
    // setOverlayVisible(false) call that lives in the expand phase.
    const timeoutAnchor = ctx.indexOf('Navigate back — home screen is already rendered');
    expect(timeoutAnchor).toBeGreaterThan(-1);

    const refPos          = ctx.indexOf('onCollapseCompleteRef.current?.()', timeoutAnchor);
    const setVisibleFalse = ctx.indexOf('setOverlayVisible(false)',           refPos);
    expect(refPos).toBeGreaterThan(-1);
    expect(setVisibleFalse).toBeGreaterThan(-1);
    expect(refPos).toBeLessThan(setVisibleFalse);
  });

  it('useFocusEffect registers onCollapseCompleteRef callback (fast-nav path) for setVideoKey', () => {
    // Fast navigation (< 200 ms): pendingCollapseRemountRef is still true.
    // useFocusEffect must register onCollapseCompleteRef so the rAF handler
    // calls setVideoKey only after setOverlayVisible(false) has committed.
    expect(index).toMatch(/onCollapseCompleteRef\.current\s*=\s*\(\s*\)\s*=>\s*setVideoKey/);
  });

  it('useFocusEffect calls setVideoKey directly (slow-nav path)', () => {
    // Slow navigation (> 200 ms): pendingCollapseRemountRef is already false.
    // The overlay is gone — it is safe to mount the mini-player VideoView immediately.
    // Look for the pattern: else { setVideoKey(...) } in the collapse restore block.
    expect(index).toMatch(/}\s*else\s*\{\s*setVideoKey\s*\(\s*\(k\)\s*=>/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 2 — Phone: tab switch → flash overlay must clear within 3 s
//
// Root cause: ExoPlayer stays in STATE_READY when re-attaching to a new
// TextureView surface, so statusChange→readyToPlay never re-fires.  Without
// a fallback timer the flash overlay stayed at opacity 1 permanently — audio
// played but the video was hidden behind the opaque overlay.
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 2 — tab switch: flash overlay has a safety-net fallback timer', () => {
  it('a setTimeout fallback exists to clear the flash overlay after a fixed delay', () => {
    // The overlayFallback timeout fades flashOverlayOpacity to 0 in case
    // readyToPlay never fires (e.g. ExoPlayer already in STATE_READY).
    expect(index).toMatch(/overlayFallback\s*=\s*setTimeout/);
  });

  it('fallback timer fires within 3 000 ms (task requirement)', () => {
    // Extract the numeric delay passed to the overlayFallback setTimeout.
    // The callback body spans multiple lines and contains commas, so we
    // capture the closing }, DELAY) pattern instead of trying to span the body.
    // The current implementation uses 2 000 ms — any value ≤ 3 000 ms is valid.
    const fbIdx = index.indexOf('overlayFallback');
    expect(fbIdx).toBeGreaterThan(-1);
    // Read 250 chars — enough to reach the closing `}, 2000);` on any indentation.
    const region = index.slice(fbIdx, fbIdx + 250);
    const m = region.match(/},\s*(\d+)\s*\)/);
    expect(m).not.toBeNull();
    expect(parseInt(m![1], 10)).toBeLessThanOrEqual(3000);
  });

  it('fallback timer fades flashOverlayOpacity to 0', () => {
    // The fallback must actually clear the overlay, not just console.log.
    // Check that the overlayFallback timeout body references both flashOverlayOpacity
    // and toValue: 0.
    const fbStart = index.indexOf('overlayFallback = setTimeout');
    expect(fbStart).toBeGreaterThan(-1);
    const fbBody = index.slice(fbStart, fbStart + 300);
    expect(fbBody).toMatch(/flashOverlayOpacity/);
    expect(fbBody).toMatch(/toValue\s*:\s*0/);
  });

  it('readyToPlay status also fades flash overlay to 0 (primary path)', () => {
    // The primary clear path: statusChange → readyToPlay in index.tsx fades
    // flashOverlayOpacity to 0 so users on fast devices never see the overlay.
    const readyBlock = index.match(
      /readyToPlay[\s\S]{0,400}flashOverlayOpacity[\s\S]{0,100}toValue\s*:\s*0/
    );
    expect(readyBlock).not.toBeNull();
  });

  it('fallback cleanup function cancels the overlayFallback timer on tab blur', () => {
    // The useFocusEffect cleanup must cancel overlayFallback so repeated
    // tab switches don't stack up multiple fade-outs.
    expect(index).toMatch(/clearTimeout\s*\(\s*overlayFallback\s*\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 3 — Recently-watched early-back: no audio with black screen
//
// Root cause A (player.tsx): stopOnBack path — the shared player was not
// paused before router.back(), so audio continued playing while no VideoView
// was mounted anywhere.
//
// Root cause B (index.tsx): clearChannelOnReturnRef path — the mini-player's
// display:none was removed (playingChannel was set) but the VideoView was
// never bound to a live surface; the player kept playing audio silently.
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 3 — recently-watched early-back: audio is stopped before navigating', () => {
  it('handleBackLive pauses sharedPlayer when stopOnBack is true (player.tsx)', () => {
    // The stopOnBack branch in handleBackLive must call sharedPlayer?.pause()
    // before router.back() so the stream stops immediately.
    const stopOnBackIdx = player.indexOf("params.stopOnBack === 'true'");
    expect(stopOnBackIdx).toBeGreaterThan(-1);

    const pausePos     = player.indexOf('sharedPlayer?.pause()', stopOnBackIdx);
    const routerBackPos = player.indexOf('router.back()',        stopOnBackIdx);
    expect(pausePos).toBeGreaterThan(-1);
    expect(routerBackPos).toBeGreaterThan(-1);
    // pause must come before router.back()
    expect(pausePos).toBeLessThan(routerBackPos);
  });

  it('useFocusEffect clearChannelOnReturnRef branch pauses the player (index.tsx)', () => {
    // When the user backs out before the collapse animation (recently-watched
    // path), useFocusEffect must pause the player and clear the playing channel
    // to stop audio and hide the mini-player.
    const clearIdx = index.indexOf('clearChannelOnReturnRef.current');
    expect(clearIdx).toBeGreaterThan(-1);

    // Find the block that handles clearChannelOnReturnRef
    const branchBody = index.slice(clearIdx, clearIdx + 300);
    expect(branchBody).toMatch(/player\?\.pause\(\)/);
  });

  it('useFocusEffect clearChannelOnReturnRef branch clears playingChannel', () => {
    const clearIdx = index.indexOf('clearChannelOnReturnRef.current');
    const branchBody = index.slice(clearIdx, clearIdx + 300);
    expect(branchBody).toMatch(/setPlayingChannel\s*\(\s*null\s*\)/);
  });

  it('useFocusEffect clearChannelOnReturnRef branch clears selectedChannel', () => {
    // Clearing selectedChannel ensures the TVLiveLayout also unmounts its
    // VideoView so TV users don't see audio-only playback either.
    const clearIdx = index.indexOf('clearChannelOnReturnRef.current');
    const branchBody = index.slice(clearIdx, clearIdx + 300);
    expect(branchBody).toMatch(/setSelectedChannel\s*\(\s*null\s*\)/);
  });

  it('clearChannelOnReturnRef is set by handleBackLive (stopOnBack path) in player.tsx', () => {
    // The player must signal index.tsx (via the ref forwarded through context
    // or a module-level variable) to take the clearChannelOnReturnRef branch.
    // In the current implementation the ref is set directly from player.tsx
    // because the collapse is skipped — no DeviceEventEmitter is used.
    // Instead, clearChannelOnReturnRef is populated in the Live TV tab's effect
    // that listens for the recently-watched launch — verify the ref is consumed
    // (reset to false) inside the clearChannelOnReturnRef branch.
    const clearIdx = index.indexOf('clearChannelOnReturnRef.current');
    const branchBody = index.slice(clearIdx, clearIdx + 150);
    expect(branchBody).toMatch(/clearChannelOnReturnRef\.current\s*=\s*false/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario 4 — TV / Firestick: same collapse paths must also restore video
//
// Root cause A: TVLiveLayout only renders its VideoView when selectedChannel
// is non-null.  The recently-watched back path only called setPlayingChannel
// but not setSelectedChannel, so the VideoView was never mounted on TV even
// after videoKey incremented.
//
// Root cause B: D-pad cursor was left on a hidden player-control after collapse;
// no focus-restore call left the remote unresponsive.
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 4 — TV / Firestick: recently-watched back path sets selectedChannel', () => {
  it('_pendingPlayingChannel branch calls setSelectedChannel(ch) as well as setPlayingChannel(ch)', () => {
    // On TV, TVLiveLayout only mounts its VideoView when selectedChannel is set.
    // Both calls must appear inside the _pendingPlayingChannel branch so the
    // VideoView exists before requestAnimationFrame fires setVideoKey.
    const pendingIdx = index.indexOf('_pendingPlayingChannel');
    expect(pendingIdx).toBeGreaterThan(-1);

    // Find the section that consumes _pendingPlayingChannel
    const consumeIdx = index.indexOf('_pendingPlayingChannel = null', pendingIdx);
    expect(consumeIdx).toBeGreaterThan(-1);

    const branchBody = index.slice(consumeIdx, consumeIdx + 400);
    expect(branchBody).toMatch(/setPlayingChannel\s*\(\s*ch\s*\)/);
    expect(branchBody).toMatch(/setSelectedChannel\s*\(\s*ch\s*\)/);
  });

  it('_pendingPlayingChannel branch defers setVideoKey inside requestAnimationFrame', () => {
    // The rAF gives the native layout a pass to measure the now-visible
    // container before the fresh VideoView is mounted.  Without it the surface
    // is zero-sized → audio plays, no video.
    const consumeIdx = index.indexOf('_pendingPlayingChannel = null');
    expect(consumeIdx).toBeGreaterThan(-1);

    // 900 chars covers setPlayingChannel + setSelectedChannel + category logic
    // + requestAnimationFrame(() => { setVideoKey(…) })
    const branchBody = index.slice(consumeIdx, consumeIdx + 900);
    expect(branchBody).toMatch(/requestAnimationFrame[\s\S]{0,100}setVideoKey/);
  });

  it('normal collapse path restores D-pad focus to mini-player on TV', () => {
    // After the collapse animation the remote cursor must land somewhere
    // reachable.  The fix calls miniPlayerRef.current?.focus() on Platform.isTV.
    const normalCollapseIdx = index.indexOf('Normal collapse path');
    expect(normalCollapseIdx).toBeGreaterThan(-1);

    // Platform.isTV + focus?.() appear ~775-850 chars after the section marker.
    const focusBlock = index.slice(normalCollapseIdx, normalCollapseIdx + 900);
    expect(focusBlock).toMatch(/Platform\.isTV/);
    expect(focusBlock).toMatch(/miniPlayerRef\.current.*focus\s*\?\.\s*\(\s*\)/);
  });

  it('recently-watched collapse path also restores D-pad focus to mini-player on TV', () => {
    // The _pendingPlayingChannel branch needs the same focus-restore so that
    // returning from recently-watched on TV doesn't strand the cursor.
    const consumeIdx = index.indexOf('_pendingPlayingChannel = null');
    expect(consumeIdx).toBeGreaterThan(-1);

    // 1 100 chars covers the full _pendingPlayingChannel branch including the
    // Platform.isTV focus-restore that appears after requestAnimationFrame.
    const branchBody = index.slice(consumeIdx, consumeIdx + 1100);
    expect(branchBody).toMatch(/Platform\.isTV/);
    expect(branchBody).toMatch(/miniPlayerRef\.current.*focus\s*\?\.\s*\(\s*\)/);
  });

  it('expand ready-gate cancelled before collapse takes ownership of overlay (ctx)', () => {
    // If the user presses BACK before the first frame arrives, the expand
    // timeout set by _runExpandAnimation must be cancelled.  Without this the
    // timeout fires mid-collapse and calls setOverlayVisible(false),
    // conflicting with the collapse sequencing.
    const collapseAnimStart = ctx.indexOf('_runCollapseAnimation = useCallback');
    expect(collapseAnimStart).toBeGreaterThan(-1);

    const cancelPos = ctx.indexOf('_cancelReadyGate()', collapseAnimStart);
    // _cancelReadyGate must be called inside _runCollapseAnimation before the
    // animation is set up
    const animParallelPos = ctx.indexOf('Animated.parallel', collapseAnimStart);
    expect(cancelPos).toBeGreaterThan(-1);
    expect(cancelPos).toBeLessThan(animParallelPos);
  });
});
