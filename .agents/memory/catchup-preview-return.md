---
name: Catch-up preview return
description: Preserve the Live TV mini-preview while opening and returning from full-screen Catch-up playback.
---

# Catch-up preview return

**Rule:** Starting Catch-up from Live TV must preserve the current live channel and restore its stream in the mini-preview when the viewer backs out of full-screen Catch-up.

**Why:** Catch-up and Live TV share one player. Catch-up replaces the player's source, and normal navigation cleanup would otherwise clear the Live TV selection, returning viewers to an empty preview or the wrong stream.

**How to apply:** Record the live channel only when a Catch-up programme starts, bypass ordinary tab-exit clearing for that temporary route, then reload the saved live stream and remount the mini-preview surface on return. Closing the Catch-up chooser without playing anything must leave the existing preview alone.