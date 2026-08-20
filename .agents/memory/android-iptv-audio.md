---
name: Android IPTV audio compatibility
description: Decoder choice and recovery rules for IPTV MPEG Layer II streams on Android and Fire TV.
---

On Android and Fire TV, render IPTV playback with libVLC rather than relying on Expo/ExoPlayer for MPEG transport streams that carry MPEG Layer II (MP2) audio. Never reintroduce an automatic Expo audio-track selection or audio-mixing workaround for these streams.

**Why:** The standard Expo/ExoPlayer setup does not include the reliable MP2 transport-stream decoder support needed by affected providers. Forcing an advertised Expo audio track can prevent the entire source—including video—from starting. VLC decodes the audio and video together.

**How to apply:** Keep a single VLC owner across mini-player and fullscreen transitions; on Android route retries, Catch-up URL regeneration, and stale-URL refresh through VLC source state. Convert VLC progress values from milliseconds to the app's seconds-based timeline.

## VLC readiness events

Do not rely solely on the initial VLC `Playing` callback to dismiss a loading UI. Its first event can arrive before React Native has attached the JavaScript listener during a fullscreen surface handoff; progress events expose the runtime playback state even though the package typings omit it. A VLC buffering notification at 100% is terminal startup bookkeeping, not a new stall.

**Why:** A missed `Playing` event or a late 100% buffering event can leave a healthy first channel hidden behind a permanent “Connecting” layer.

**How to apply:** Treat progress that reports active playback as a readiness fallback, and only show a buffering layer for incomplete buffering. Keep true error handling and connection timeouts unchanged.