---
name: VLC mini↔fullscreen transition bugs
description: Root causes and fixes for stream restarts and poor visual quality when transitioning between mini-player and fullscreen on Android/Fire TV
---

## Architecture (confirmed correct)

ONE VLCPlayer lives in the actual mini-player FocusablePressable in each phone
and TV layout. The fullscreen route is controls-only when it has a native
handoff ID, so it never mounts a second VLC decoder.

At rest, the VLC TextureView must use `absoluteFill` inside that real
FocusablePressable. Its native layout callback then receives exactly the
preview box’s dimensions. The mini-player is never an empty focus/touch
placeholder with a separately-positioned root-level VLC sibling.

## Container-owned fullscreen layout

Fullscreen changes the parent preview region to fill its Live TV layout while
the persistent VLC child remains an `absoluteFill` child of the same
FocusablePressable. The surface never receives measured screen coordinates,
negative offsets, animated bounds, or a temporary overflow escape.

On Fire TV, the tab shell is also part of that parent layout: it normally
reserves the permanent sidebar width. During a persistent fullscreen handoff,
the shell must remove that sidebar and its scene margin so the preview parent
can fill the physical window.

The Live TV root also has normal overscan padding and three-panel chrome.
Fullscreen must override that padding to zero, remove the non-video panels from
layout, and center the persistent 16:9 preview against black so unusual TV
viewports letterbox instead of stretching the stream.

The handoff waits one layout frame before showing or removing fullscreen
controls. This preserves the single decoder while allowing normal React Native
layout to resize the TextureView for orientation and resolution changes.

Why layout bounds instead of transforms:
- SurfaceView composites on a separate layer; CSS scale transforms move the wrapper but not the video content.
- Animating layout bounds causes Android to resize the Surface → VLC renders at target resolution throughout.
- No pixelation, no clipping issues, works for both SurfaceView and TextureView.

Why NOT useNativeDriver:true:
- top/left/width/height are layout properties, not compositor properties.
- useNativeDriver:true can only animate opacity, transform, etc.

## Bug 1 — stale tabBlurredAtRef → vlcReloadKey++ on fullscreen return (FIXED)

tabBlurredAtRef retained timestamps from previous tab navigations. On return from fullscreen,
stale-tab check (Date.now() - blurredAt > 30_000) fired → setVlcReloadKey(k+1) → VLC key changed.

Fix: `tabBlurredAtRef.current = null` inside the goingToPlayerRef early-return in the
useFocusEffect blur cleanup (index.tsx).

## Bug 2 — player.tsx creates second VLC via timing race (FIXED)

usesPersistentNativeSurface was: `USES_NATIVE_VLC && isLive && nativeSurfaceHandoff?.id === nativeSurfaceHandoffId`

nativeSurfaceHandoff?.id is React context STATE (async). If nativeSurfaceTransitionRef has no handler,
onComplete() fires in ~1 rAF (~16ms) — before React commits the state update. null !== "1" → false →
second VLC decoder created on same stream URL → server kicks one → stream restart.

Also: null === null (direct launch) incorrectly returned true → no VLC in player.tsx → no picture.

Fix: `nativeSurfaceHandoffId !== null` (route params, synchronous):
```tsx
const usesPersistentNativeSurface = USES_NATIVE_VLC && isLive && nativeSurfaceHandoffId !== null;
```

## Bug 3 — false "Connecting to stream" overlay (FIXED)

player.tsx initialises isBuffering = true. For controls-only path, no VLC → onPlaying never fires.
Fix: useEffect([usesPersistentNativeSurface, isLive]) calls setIsBuffering(false) + setIsPlaying(true).

## Bug 4 — focus-effect safety fallback cancels fullscreen entry (FIXED)

The Live TV screen's focus effect depends on the native surface mode. Changing
that mode to fullscreen re-runs the effect before the transparent player route
has necessarily blurred the tab. Its interrupted-navigation safety fallback
must not immediately change the mode back to mini while fullscreen navigation
is still in flight.

**Why:** The result is a fullscreen control bar layered over the still-small
Live TV preview: the player route opens, but the persistent VLC owner's parent
has already been collapsed.

**How to apply:** Gate the mini-mode safety fallback on the fullscreen
navigation marker. The player route remains solely responsible for returning
the owner to mini mode immediately before it removes its controls route.

## Host, focus, and overlay rules

The animated native child remains non-focusable, non-accessible, and uses
`pointerEvents="none"`. Its enclosing FocusablePressable therefore retains
phone touch, Fire TV D-pad, and OK ownership. Android loading, error, LIVE,
and expand-hint overlays belong above the nested native child and must also
not intercept the Pressable.

On Fire TV, the visible focus ring is a child of that same FocusablePressable,
so it cannot appear away from the video. Channel rows route RIGHT to the
preview; preview LEFT returns to the playing channel, DOWN reaches guide
controls, and UP/RIGHT remain anchored on the player.

## Key invariants to preserve in future changes

1. vlcReloadKey must NOT be incremented on fullscreen transition (only on channel switch, error retry, catch-up return)
2. isLivePreviewActive must NOT become false during goingToPlayerRef=true blur cleanup
3. nativeSurfaceHandoffId (params) must be set BEFORE navigate() is called in handleWatch/handleWatchChannel
4. player.tsx must NOT render NativeStreamPlayer when nativeSurfaceHandoffId !== null (controls-only)
5. tabBlurredAtRef must be nulled in the goingToPlayerRef early-return
6. NativeStreamPlayer must remain physically inside the real mini-player
   FocusablePressable and use its layout at rest.
7. Fullscreen must expand the preview container, not the VLC child. The
   TextureView always remains within its real parent at `absoluteFill`.
8. Never restore screen-coordinate measurements, negative offsets, animated
   VLC width/height, or overflow escapes for the native surface.

## BACK collapse completion

Only the bounds animation that finishes at the mini-player rect may remove the
transparent fullscreen route. A repeated Firestick BACK during the shrink must
be ignored, and the tab focus return must not start a second mini resize.

**Why:** Cancelling one `Animated.parallel` invokes its completion callback with
`finished: false`. Popping the route from that callback exposes a moving native
surface before it reaches the preview, which can present as a black, blank, or
stale frame.

**How to apply:** Guard the persistent BACK path for its in-flight lifetime,
call route navigation only when the animation callback reports `finished`, and
on return skip `transitionNativeSurface('mini')` when the mode is already mini.

## Native playback-prop stability

The Android VLC wrapper is memoized and the persistent live surface receives
stable event callbacks. A preview/fullscreen change must only update the outer
surface bounds, not re-send VLC playback props.

**Why:** A parent layout render may create fresh native prop objects. Even when
the React key is unchanged, reapplying controlled defaults such as volume or
mute can overwrite state owned by libVLC.

**How to apply:** Keep all transition-only values on the outer
`Animated.View`; let the native component re-render only for a real stream
input change (URL, explicit reload/retry, pause, seek, or resize mode).

## Stable libVLC output buffer for Fire TV handoffs

The VLC TextureView must allocate its libVLC output window at the physical
display size once, when the surface/player is created. Do not call
`setWindowSize` from its React Native layout-change listener.

**Why:** On Fire OS, changing the React Native parent from the mini preview to
fullscreen is a normal TextureView resize. Calling `setWindowSize` at the same
time forces libVLC to reconfigure its output, which can clear the texture for a
black frame even though decoding and audio continue.

**How to apply:** Keep the VLC output buffer stable and let TextureView scale
that buffer within the changing real owner container. Preserve this as a pnpm
patch so a clean Android build receives it; test it with a frozen pnpm install.

## Audio without preview video

For the Android VLC module, continued audio after a fullscreen return means the
TextureView is still mounted: its native `onDetachedFromWindow` stops playback.
Treat the failure as stale layout/output-window binding or compositor stacking,
not as a reason to recreate the decoder.

**Why:** The module forwards TextureView layout changes to libVLC's
`setWindowSize`. On some Fire OS compositor paths, a completed collapse can
leave that live texture without its final preview-size update, producing audio
with no visible video.

**How to apply:** Keep the VLC child in the real non-flattened mini-player
host and let ordinary parent layout changes resize it. Never reload the source,
remount VLC, or assign the native child screen-coordinate bounds to repair a
visual issue.

## Fullscreen handoff loading flash

The fullscreen controls route must know it has borrowed the persistent native
surface on its first render. Do not initialize it as buffering and clear that
state in an effect.

**Why:** Effects run after the first frame. The generic opaque “Connecting to
stream” overlay can cover a healthy persistent VLC texture, making a visual
handoff look like a decoder restart.

**How to apply:** Derive handoff ownership synchronously from the route handoff
ID, initialize loading state from that value, and exclude persistent handoffs
from generic loading overlays. Keep the route transparent; it owns controls,
not video.

## Fire TV focus handoff

Preview/fullscreen navigation must restore D-pad focus through a dedicated
post-collapse signal, not through the VLC surface or the resize animation.

**Why:** The fullscreen route owns Firestick BACK while focused; its removal
changes native focus after the shrink completes. Requesting preview focus while
the modal is still active can silently fail and leave the remote without a
usable target.

**How to apply:** Emit the restore signal only from the completed collapse
callback. The Live TV screen stores it while unfocused, then requests focus on
the stable preview Pressable after navigation focus returns, with one short
Fire-OS retry. Keep VLC pointer-events disabled and non-focusable.

## Navigation config (player.tsx route)

_layout.tsx: animation: 'none', presentation: 'transparentModal' (Android).
This means player.tsx appears instantly as a transparent overlay — no slide animation conflicts.
The tab screen (with VLC) stays rendered beneath it. ✓
