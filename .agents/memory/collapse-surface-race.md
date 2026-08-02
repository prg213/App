---
name: Collapse surface race fix
description: How the fullscreen→mini-player collapse avoids a permanently black mini-player preview.
---

## The bug
After collapsing from fullscreen, the mini-player preview was permanently black.

## Root cause
Two interacting problems:

1. **Timing race with React Navigation.** `triggerCollapse` calls `onDone()` (router.back()) then starts a 200 ms timeout. If React Navigation takes > 200 ms to complete the back-navigation, the timeout fires first and clears `isCollapsingRef`. When `useFocusEffect` (index.tsx) then fires, it saw `isCollapsingRef = false` and took the *normal* path — setting `flashOverlayOpacity = 1` (black overlay). Since ExoPlayer stays in STATE_READY when re-attaching to a new surface, `readyToPlay` never re-fires, so the overlay stayed permanently black.

2. **Surface ordering.** When `setOverlayVisible(false)` and `setVideoKey(k+1)` batched into the same React commit, the mount/unmount order of `setVideoSurface` native calls was implementation-defined — on some devices the new mini-player VideoView mounted before the overlay unmounted, so the overlay's `setVideoSurface(null)` ran last, clearing the player's output surface.

## Fix
Two new refs added to `LivePlayerContext`:

- **`collapseRestorePendingRef`** — set true at collapse start, cleared *only* by `useFocusEffect`. This lets `useFocusEffect` always identify a collapse focus-return regardless of navigation speed.
- **`pendingCollapseRemountRef`** — set true at collapse start, cleared by the rAF handler after `setOverlayVisible(false)`. `useFocusEffect` checks this to know whether to register a callback (rAF not yet fired) or call `setVideoKey` directly (rAF already ran).

The 200 ms timeout now does `setOverlayVisible(false)` first (its own React commit), then waits 2 `requestAnimationFrame` calls before clearing `pendingCollapseRemountRef` and calling `onCollapseCompleteRef` — guaranteeing the overlay's `setVideoSurface(null)` runs before the mini-player VideoView remounts.

`useFocusEffect` **never** sets `flashOverlayOpacity = 1` on a collapse return, because readyToPlay won't re-fire.

## Why readyToPlay doesn't re-fire
ExoPlayer stays in `STATE_READY` when a new TextureView surface is attached to an already-playing stream. expo-video only emits `statusChange → readyToPlay` on a `STATE_READY` *transition*, not on surface re-attach. Any `flashOverlayOpacity = 1` set during collapse is therefore permanent.
