---
name: Fire TV APK packaging
description: Compact Android APK release decision and update-selection rules for StreamVault.
---

Android release builds must publish compact physical-ARM APKs, never a universal VLC package: `StreamVault.apk` is the ARM32 Fire TV/older Android asset, while the named ARM64 asset serves modern Android phones. Never package emulator (`x86` / `x86_64`) libraries.

**Why:** Fire TV hardware can expose a 32-bit userspace even on 64-bit hardware, so an arm64-only package is not a safe generic update. A real Fire OS installation of the ARM-only 159 MB universal VLC build completed with a Done-only screen but did not install the app, consistent with staging-space failure. Separate device-specific APKs restore viable package sizes.

**How to apply:** Restrict React Native architectures to physical ARM targets, then build non-universal ABI splits. Do not combine Android `ndk.abiFilters` with ABI splits: Gradle rejects that configuration. Stage the ARM32 file under the stable `StreamVault.apk` name and publish both named ARM32 and ARM64 assets. Keep device-aware updater selection and legacy fallbacks so existing installs transition safely. Set Android `versionCode` from the monotonically increasing CI build number so package updates are accepted.