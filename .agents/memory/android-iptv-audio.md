---
name: Android IPTV audio compatibility
description: Decoder choice and recovery rules for IPTV MPEG Layer II streams on Android and Fire TV.
---

On Android and Fire TV, render IPTV playback with libVLC rather than relying on Expo/ExoPlayer for MPEG transport streams that carry MPEG Layer II (MP2) audio. Never reintroduce an automatic Expo audio-track selection or audio-mixing workaround for these streams.

**Why:** The standard Expo/ExoPlayer setup does not include the reliable MP2 transport-stream decoder support needed by affected providers. Forcing an advertised Expo audio track can prevent the entire source—including video—from starting. VLC decodes the audio and video together.

**How to apply:** Keep a single VLC owner across mini-player and fullscreen transitions; on Android route retries, Catch-up URL regeneration, and stale-URL refresh through VLC source state. Convert VLC progress values from milliseconds to the app's seconds-based timeline.