---
name: Fire TV APK packaging
description: Universal Android APK release decision for StreamVault — one file for Firestick ARM32 and modern Android ARM64.
---

A single universal `StreamVault.apk` is the correct release artefact, published as `make_latest: true`. It must contain both `armeabi-v7a` (Firestick) and `arm64-v8a` (modern Android phones) native libraries, compressed with deflate (compress_type 8) via `useLegacyPackaging true` in Gradle. Two compact split APKs are also emitted alongside it as emergency fallbacks but are not the primary download.

**Why:** The creator confirmed that one download link is the required experience. An ARM32-only APK failed on mobile; a separate ARM64 APK added friction. The previous universal attempt (build 249, ~152 MB) was too large for some Firestick devices because native libraries were stored uncompressed. Compressing them with `packagingOptions { jniLibs { useLegacyPackaging true } }` brings the universal file to ~144 MB, which has been verified to install on both Firestick and modern Android phone (build 252, confirmed by the creator).

**How to apply:**
- Keep `universalApk true` with `useLegacyPackaging true` in the `withReleaseAbis` Expo config plugin.
- CI stages the universal output as `StreamVault.apk` (`make_latest: true`, `prerelease: false`).
- Split files (`StreamVault-armeabi-v7a.apk`, `StreamVault-arm64-v8a.apk`) are published alongside but not promoted as the primary download.
- After every release, verify the universal APK contains `lib/armeabi-v7a/` and `lib/arm64-v8a/` entries with compression_type 8 (deflate).
- The in-app updater (`selectUpdateAsset`) prefers `StreamVault.apk` for all Android targets; ABI splits are retained only as older-release fallbacks.
- Never set Android versionCode manually — derive it from `EXPO_PUBLIC_BUILD_NUMBER` (GitHub run number) for monotonic installs.
