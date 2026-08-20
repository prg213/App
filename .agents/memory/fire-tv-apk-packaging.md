---
name: Fire TV APK packaging
description: One-file universal Android APK release decision for StreamVault.
---

Android release builds must publish one universal `StreamVault.apk` containing both physical ARM targets (`armeabi-v7a` and `arm64-v8a`) for Fire TV and Android mobile devices. Never package emulator (`x86` / `x86_64`) libraries or publish separate device-download assets.

**Why:** The creator has confirmed that a single APK is the expected installation experience and has previously installed it successfully on both Firestick and mobile. Multiple download choices caused an incompatible ARM32 package to be selected on mobile and made the release unnecessarily confusing.

**How to apply:** Restrict React Native architectures to physical ARM targets without enabling ABI splits. Stage the resulting `app-release.apk` as `StreamVault.apk` and publish only that asset. Keep the stable name for the site and in-app updater; legacy asset-selection fallbacks may remain for older releases. Set Android `versionCode` from the monotonically increasing CI build number so package updates are accepted.