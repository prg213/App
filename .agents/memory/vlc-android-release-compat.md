---
name: VLC Android release compatibility
description: Native build constraints for react-native-vlc-media-player in the Expo 57 Android release pipeline.
---

Use the project-owned Expo plugin rather than the VLC package's bundled Expo plugin, and preserve the pnpm patch for the VLC package's Android Gradle file.

**Why:** The bundled plugin searches for a Gradle anchor removed by Expo 57. The package also declares Android Gradle Plugin 4.0.2 in its library build script, which is incompatible with the root Android toolchain. LibVLC itself declares a minimum SDK of 26 and needs to retain its own `libc++_shared.so` when native libraries merge.

**How to apply:** When changing Expo, React Native, Gradle, or the VLC package, validate a clean signed Android build. Keep the Android API floor at 26 unless replacing the native decoder, and verify the local plugin still removes only React Native's conflicting C++ runtime copy.