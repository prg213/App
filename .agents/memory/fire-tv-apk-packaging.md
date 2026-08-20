---
name: Fire TV APK packaging
description: Safe universal Android APK release policy for Fire TV and modern phones.
---

## Rule

`StreamVault.apk` is the primary universal download and must contain only
`armeabi-v7a` and `arm64-v8a`. Native libraries are legacy-packaged (compressed)
and the candidate must stay at or below 130 MiB. Split assets remain diagnostic
fallbacks only.

**Why:** An earlier universal VLC build reached 152 MB and could not stage on the
Firestick. Both physical ARM payloads are nevertheless required for one download
to update Fire TV and modern phones. Compression materially reduces that payload
without removing VLC's MP2 support.

**How to apply:** Build a candidate first; CI must inspect its size, ABI contents,
compressed JNI entries, VLC libraries, package/version, and signer continuity.
Test that artifact on the target Firestick and modern phone (upgrade, launch, MP2
playback), then promote that exact Actions artifact with the recorded result.
Never rebuild between validation and public release. Keep emulator ABIs excluded
and use the CI build number as the Android version code.