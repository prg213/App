---
name: TV mini-player VideoView gating
description: On Firestick, TVLiveLayout only mounts its VideoView when selectedChannel is non-null; miniPlayerRef is null until then. Both must be set before triggerCollapse or the VideoView mount for video to render.
---

## Rule
When returning from a player session that was launched from the Home screen
(recently-watched rail), both `setPlayingChannel(ch)` AND `setSelectedChannel(ch)`
must be called together in the collapse-restore useFocusEffect.

## Why
- `Platform.isTV` causes index.tsx to early-return with `TVLiveLayout`.
  The `previewPanel` containing `ref={miniPlayerRef}` is never mounted.
  → `miniPlayerRef.current` is null on Firestick.

- `TVLiveLayout` conditionally renders its VideoView:
  `{!selectedChannel ? <empty state> : <VideoView/>}`
  → Setting only `playingChannel` has no effect on the VideoView mount.
  → ExoPlayer plays audio (audio decoder needs no surface) but video has
    no surface → audio-only mini-player.

- `triggerCollapse` measures `miniPlayerRef` for its animation endpoint.
  If null (e.g. selectedChannel still null when triggerCollapse runs),
  `measureInWindow` returns zero → animation skipped, `onDone()` fires immediately.

## How to apply
In any collapse-restore path that sets `playingChannel`:
- Also call `setSelectedChannel(ch)` in the SAME synchronous block.
- This makes TVLiveLayout mount its VideoView before the rAF that calls
  `setVideoKey(k+1)`, so the remounted VideoView lands on a real surface.

The stream-load useEffect (`useEffect[selectedChannel?.streamUrl]`) then runs:
- If `liveUrlRef.current === ch.streamUrl` (player.tsx set it when loading),
  it takes the early-return path: `player.play()` only, no replaceAsync.
- Safe and correct — no buffering gap.

## Files
- `app/(tabs)/index.tsx` — `_pendingPlayingChannel` branch in collapse-restore useFocusEffect
- `components/TVLiveLayout.tsx` — accepts `miniPlayerRef` prop, attaches it with
  `collapsable={false}` to the VideoView's FocusablePressable so triggerCollapse
  can measure it after selectedChannel is set.
