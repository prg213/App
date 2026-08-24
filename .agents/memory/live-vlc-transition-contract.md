---
name: VLC mini/fullscreen transition contract
description: Durable constraints for seamless Android and Fire TV live playback.
---

Keep exactly one mounted native VLC surface throughout Live TV and fullscreen
controls. The fullscreen route borrows that surface and must not create, remount,
or reload a second decoder.

**Why:** Android TextureView can display a blank or stale frame while animated
through intermediate bounds, and duplicate decoders can make the provider
disconnect or restart the stream.

**How to apply:** Change only the real owner's layout in one committed pass; do
not animate the native surface bounds. On a fullscreen zap, carry the complete
channel identity (source URL, ID, metadata, EPG, and category) back to Live TV.
When returning with BACK, derive source and metadata from the same active entry,
using shared state only as a fallback.