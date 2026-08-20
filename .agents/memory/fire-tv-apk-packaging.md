---
name: Fire TV APK packaging
description: Universal Android APK release decision and update-selection rules for StreamVault.
---

Android release builds must publish one universal `StreamVault.apk` containing both `armeabi-v7a` and `arm64-v8a` native libraries. The in-app updater uses that generic asset for the universal release, while retaining architecture-specific fallback selection for older split releases.

**Why:** The creator explicitly prioritizes one download that works on both Fire TV and mobile, accepting the larger VLC-inclusive APK and the known Fire TV installation risk. Fire TV hardware can expose a 32-bit userspace even on 64-bit hardware, so an arm64-only package is not a safe generic update.

**How to apply:** Build the two physical ARM targets into a universal APK, stage and release only `StreamVault.apk`, and keep the generic update asset available. Keep legacy split-asset fallback behavior so existing installs can transition safely. Set Android `versionCode` from the monotonically increasing CI build number so package updates are accepted.