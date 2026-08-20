---
name: Playback wake-lock tags
description: Preventing Android screen-lock races during mini-player and fullscreen playback handoffs.
---

Each concurrently mounted playback surface must call Expo KeepAwake without a shared explicit tag, so Expo assigns an owner-specific tag.

**Why:** Expo KeepAwake stores active tags as a set, not a reference count. If the mini-player and fullscreen surface share a tag, unmounting either one clears the only tag and re-enables screen sleep while the other surface continues playing.

**How to apply:** Keep the wake lock scoped to mounted playback surfaces, but never reuse one fixed tag across mini-player, fullscreen, catch-up, or overlays that can overlap during handoff.