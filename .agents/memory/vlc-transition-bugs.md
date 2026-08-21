---
name: VLC mini↔fullscreen transition bugs
description: Root causes and fixes for stream restarts and poor visual quality when transitioning between mini-player and fullscreen on Android/Fire TV
---

## Architecture (confirmed correct)

ONE VLCPlayer lives in NativeStreamPlayer.android.tsx, key={`${source}:${reloadKey ?? 0}`}.

Render sites (after the layout-bounds animation fix):
- index.tsx (phone layout): root-level Animated.View, last child of <View style={styles.root}>
- index.tsx (TV layout): root-level Animated.View, last child of <View flex:1>
- player.tsx: NO VLC — controls-only transparent modal when nativeSurfaceHandoffId !== null

VLC is NEVER inside the mini-player FocusablePressable on Android anymore.
The FocusablePressable is a pure touch target for the VLC path (miniPlayerRef, onPress, onFocus/Blur).

## Animation approach (current — layout bounds)

vlcTop, vlcLeft, vlcWidth, vlcHeight are Animated.Values animated with useNativeDriver:false.

Mini state: values = measured mini-player screen-absolute coords (via measureInWindow).
Fullscreen: values = (0, 0, screenWidth, screenHeight).
Animation: Easing.out(Easing.cubic), 220ms.

Why layout bounds instead of transforms:
- SurfaceView composites on a separate layer; CSS scale transforms move the wrapper but not the video content.
- Animating layout bounds causes Android to resize the Surface → VLC renders at target resolution throughout.
- No pixelation, no clipping issues, works for both SurfaceView and TextureView.

Why NOT useNativeDriver:true:
- top/left/width/height are layout properties, not compositor properties.
- useNativeDriver:true can only animate opacity, transform, etc.

Position initialization:
- useEffect on isLivePreviewActive → measureInWindow → seeds vlcTop/Left/Width/Height.
- handleMiniPlayerLayout (onLayout of phone FocusablePressable) → re-measures on layout changes.
- runNativeSurfaceTransition always re-measures mini-player before animating (handles safe-area changes).

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

## Stacking order for root-level VLC container

Root layout children (last = topmost in z-order):
1. Left panel (cats)
2. Middle panel (channels)
3. Right panel (previewPanel / TVLiveLayout video panel)
4. VLC Animated.View — LAST → naturally above all panels (no explicit zIndex needed)
5. D-pad focus ring — SIBLING after VLC → above VLC

FocusablePressable (miniPlayerRef) is BELOW the VLC container (earlier in JSX), so:
- Touch events: VLC has pointerEvents="none" → passes through to FocusablePressable ✓
- Focus ring: separate Animated.View sibling AFTER VLC → visible ✓
- Buffering/error/hint/badge: INSIDE VLC container → visible ✓

## Key invariants to preserve in future changes

1. vlcReloadKey must NOT be incremented on fullscreen transition (only on channel switch, error retry, catch-up return)
2. isLivePreviewActive must NOT become false during goingToPlayerRef=true blur cleanup
3. nativeSurfaceHandoffId (params) must be set BEFORE navigate() is called in handleWatch/handleWatchChannel
4. player.tsx must NOT render NativeStreamPlayer when nativeSurfaceHandoffId !== null (controls-only)
5. tabBlurredAtRef must be nulled in the goingToPlayerRef early-return
6. NativeStreamPlayer must remain at ROOT level in index.tsx (not inside any overflow:hidden container)
7. vlcTop/Left/Width/Height must be re-measured before each animation (both expand and collapse)
8. The FocusablePressable body for USES_NATIVE_VLC must remain empty (pure touch target)

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
