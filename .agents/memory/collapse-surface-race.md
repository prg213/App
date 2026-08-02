---
name: Collapse surface race fix
description: How the fullscreen→mini-player collapse avoids a permanently black mini-player preview.
---

## The bug
After collapsing from fullscreen, the mini-player preview was permanently black.

## Root cause (final, confirmed)
expo-video's `VideoView` calls `player.setVideoSurface(null)` on **every** unmount,
regardless of whether another VideoView has since taken over the surface.
There is no reference counting.

During collapse the overlay `Animated.View` contains a `VideoView`.
When the overlay unmounts (after the animation), it calls `setVideoSurface(null)`,
clearing whatever surface the mini-player VideoView had just set.
No timing fix (rAFs, separate React commits, batching) can reliably prevent this
because the null call always wins if it runs last.

Secondary issue: if `router.back()` (React Navigation) takes > 200 ms, the
200 ms timeout fires first, clears `isCollapsingRef`, and `useFocusEffect` takes
the "normal tab switch" path — setting `flashOverlayOpacity = 1` (black overlay).
Since ExoPlayer stays in `STATE_READY` when re-attaching to a new surface,
`readyToPlay` never re-fires, so that overlay is permanent.

## Fix (final)
**Remove the VideoView from the overlay before the collapse animation starts.**

`setOverlayHasVideo(false)` is called synchronously inside `triggerCollapse`,
before the animation runs. The fullscreen VideoView in `player.tsx` is already
unmounted by the caller at this point, so the overlay was showing black anyway —
removing the VideoView has zero visual impact but means the overlay's eventual
unmount makes no `setVideoSurface` call at all.

With no VideoView in the overlay, `setOverlayVisible(false)` and `setVideoKey(k+1)`
can safely run in the same React batch: React always runs all unmount effects before
all mount effects within a single commit, so `key=K` unmounts (`setVideoSurface null`)
before `key=K+1` mounts (`setVideoSurface miniSurface`).

`setOverlayHasVideo(true)` is reset at the start of every expand so the overlay
shows live video during the expand animation.

## Why readyToPlay doesn't re-fire
ExoPlayer stays in `STATE_READY` when a new TextureView surface is attached to an
already-playing stream. expo-video only emits `statusChange → readyToPlay` on a
`STATE_READY` *transition*. Any `flashOverlayOpacity = 1` set when readyToPlay
won't fire is therefore permanent — never set it during a collapse return.

## Key refs in LivePlayerContext
- `collapseRestorePendingRef` — set at collapse start, cleared only by `useFocusEffect`;
  ensures `useFocusEffect` always takes the no-flashOverlay branch on collapse returns.
- `pendingCollapseRemountRef` — set at collapse start, cleared by the 200 ms timeout;
  tells `useFocusEffect` whether to register the callback or call `setVideoKey` directly.
- `overlayHasVideo` (state) — controls whether the overlay Animated.View renders a VideoView.
