---
name: VLC Android release compatibility
description: Native build constraints for react-native-vlc-media-player in the Expo 57 Android release pipeline.
---

Use the project-owned Expo plugin rather than the VLC package's bundled Expo plugin, and preserve the pnpm patch for the VLC package's Android Gradle file.

**Why:** The bundled plugin searches for a Gradle anchor removed by Expo 57. The package also declares Android Gradle Plugin 4.0.2 in its library build script, which is incompatible with the root Android toolchain. LibVLC itself declares a minimum SDK of 26 and needs to retain its own `libc++_shared.so` when native libraries merge.

**How to apply:** When changing Expo, React Native, Gradle, or the VLC package, validate a clean signed Android build. Keep the Android API floor at 26 unless replacing the native decoder, and verify the local plugin still removes only React Native's conflicting C++ runtime copy.

The current LibVLC interface does not expose `IVLCVout.updateVideoSurfaces()`, and Expo 57's `ReactProp` annotation does not accept `defaultString`. Resize the attached Vout with `setWindowSize` plus the scale setting, and declare the string prop without an annotation default.

**Why:** The cloud Android compiler rejects both removed APIs before it can produce an APK; neither is required to preserve the existing player or stream during a presentation-only resize.

**How to apply:** After changing the pnpm patch, keep its unified-diff hunk counts accurate, refresh the lockfile's patched-dependency hash, and verify a clean install can apply the patch before submitting the next signed build.