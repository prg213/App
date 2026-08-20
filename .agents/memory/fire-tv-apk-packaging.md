---
name: Fire TV APK packaging
description: Release packaging and update-selection rules for StreamVault on Fire TV.
---

Android release builds must generate separate `armeabi-v7a` and `arm64-v8a` APKs instead of a universal APK. The generic `StreamVault.apk` update asset is the `armeabi-v7a` build; the app’s in-app updater must not fall back to an arm64-only asset.

**Why:** LibVLC makes a universal APK too large for many Fire TV devices to download and stage. Fire TV hardware can expose a 32-bit userspace even on 64-bit hardware, so an arm64-only package is not a safe generic update.

**How to apply:** Build both physical ARM assets in CI, keep the generic download name mapped to ARMv7, and set Android `versionCode` from the monotonically increasing CI build number so package updates are accepted.