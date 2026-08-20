---
name: Fire TV APK packaging
description: Universal Android APK release decision and update-selection rules for StreamVault.
---

Android release builds must publish one universal `StreamVault.apk` containing both `armeabi-v7a` and `arm64-v8a` native libraries, but never emulator (`x86` / `x86_64`) libraries. The in-app updater uses that generic asset for the universal release, while retaining architecture-specific fallback selection for older split releases.

**Why:** The creator explicitly prioritizes one download that works on both Fire TV and mobile. Fire TV hardware can expose a 32-bit userspace even on 64-bit hardware, so an arm64-only package is not a safe generic update. A universal build that also carries desktop-emulator VLC libraries can become too large for Fire OS installation.

**How to apply:** Restrict both React Native architectures and Android NDK packaging to the two physical ARM targets before building the universal APK. Stage and release only `StreamVault.apk`, and keep the generic update asset available. Keep legacy split-asset fallback behavior so existing installs can transition safely. Set Android `versionCode` from the monotonically increasing CI build number so package updates are accepted.