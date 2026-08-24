---
name: Fullscreen sizing constraint
description: React Native fullscreen layout rules for the persistent Android VLC surface.
---

Fullscreen presentation containers must own the complete Android viewport and must not retain the mini-player's fixed 16:9 aspect ratio. Keep mini-player presentation contained, and use cover only for fullscreen presentation; this changes geometry without changing VLC session ownership.

**Why:** A later React Native measurement pass can reapply the inherited mini-player constraint after the first fullscreen layout, producing a narrower video box and black side areas even when the native surface handoff itself is correct.

**How to apply:** When adjusting the persistent VLC transition, inspect the final React Native fullscreen style and its delayed layout behavior before changing native playback, decoder, surface, or session code.