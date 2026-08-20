---
name: Fire TV APK packaging
description: Compact Android ABI split release policy for Fire TV and mobile.
---

Android release builds must publish compact ABI split APKs. `StreamVault.apk` and `StreamVault-armeabi-v7a.apk` are the ARM32 Fire TV-compatible downloads; `StreamVault-arm64-v8a.apk` is the compact modern-phone download. Never package emulator (`x86` / `x86_64`) libraries.

**Why:** A universal VLC APK grew from 89 MB to 152 MB when both ARM libraries were bundled and would not install on the Firestick. The previously working compact ARM32 APK remains compatible with Fire TV and compatible ARM mobile devices; a dedicated ARM64 file avoids forcing phones to download both libraries.

**How to apply:** Restrict React Native architectures to physical ARM targets and enable ABI splits without a universal APK. Stage the ARM32 release as `StreamVault.apk` plus the explicit ARM32 name, and stage the ARM64 release separately. Keep `StreamVault.apk` as the stable website and Fire TV updater link. Set Android `versionCode` from the monotonically increasing CI build number so package updates are accepted.