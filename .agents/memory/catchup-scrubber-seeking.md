---
name: Catch-up scrubber seeking
description: How Fire TV and touch scrubbers seek Xtream timeshift HLS catch-up programmes.
---

# Catch-up scrubber seeking

- **Rule:** Route every catch-up seek input through one programme-offset URL regeneration path: TV D-pad steps, seek buttons/media keys, and touch scrubber drags.
- **Why:** Timeshift HLS does not expose a seekable `currentTime` through expo-video, so `seekBy()` appears to move the UI but leaves playback at the old programme position.
- **How to apply:** Clamp and floor the programme offset, rebuild the provider URL from that offset, update the wall-clock progress anchor, and reload playback. Use native/cast seek APIs only when the stream is not catch-up.