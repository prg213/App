---
name: Android IPTV audio compatibility
description: Audio-track selection and focus rules for IPTV streams that expose MPEG Layer II audio on Android and Fire TV.
---

When Android exposes live or VOD audio tracks but the current audio track is null, explicitly select the provider-default track or the first available track. Configure both shared live and fullscreen players with non-mixing audio output.

**Why:** Some IPTV providers expose MPEG audio layer II tracks without marking one as selected. The native player can report the track while outputting silence until the app selects it.

**How to apply:** Run the fallback after each player-ready audio-track probe. Preserve any user-selected or preferred-language track; use the fallback only when no active track exists.