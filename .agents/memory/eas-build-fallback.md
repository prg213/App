---
name: EAS Build fallback for Android APK
description: How to trigger an EAS cloud APK build when GitHub Actions dispatch is broken.
---

## Working EAS configuration

- Expo account: `prg123s-team` (authenticated via `EXPO_TOKEN` Replit secret)
- Project: `@prg123s-team/iptv-app` (ID: `59c1a73f-acee-4b59-b359-e64f696ac921`)
- EAS already has Android credentials stored: `Build Credentials KYpC-gXKPE (default)`
- Build URL format: `https://expo.dev/accounts/prg123s-team/projects/iptv-app/builds/<build-id>`

## One-liner to start a build

```bash
cd artifacts/iptv-app
EXPO_TOKEN="${EXPO_TOKEN}" EAS_NO_VCS=1 eas build \
  --platform android \
  --profile preview \
  --non-interactive \
  --no-wait
```

- `EAS_NO_VCS=1` bypasses the git VCS requirement (needed in Replit).
- `--no-wait` returns immediately; EAS builds in the cloud (~20-30 min).
- `--non-interactive` required for automation.

## eas.json preview profile (android)

```json
{
  "distribution": "internal",
  "android": {
    "buildType": "apk",
    "image": "ubuntu-26.04-jdk-17-ndk-r27b-sdk-57"
  },
  "env": {
    "EXPO_PUBLIC_DOMAIN": "streamvault.rip",
    "EXPO_PUBLIC_TMDB_API_KEY": "312ee14dd7f250471da1174324be2bda",
    "EXPO_PUBLIC_BUILD_NUMBER": "263"
  }
}
```

**Why `ubuntu-26.04-jdk-17-ndk-r27b-sdk-57`:** This is the only EAS image with NDK r27 (needed for the VLC native module). The older `ubuntu-22.04-jdk-17-ndk-r27b` does NOT exist in EAS.

## Signing key difference

EAS uses its own managed keystore (`KYpC-gXKPE`), which is **different** from the GitHub Actions keystore (`KEYSTORE_BASE64` GitHub secret, password `streamvault123`, alias `streamvault`). Installing an EAS-built APK over a GitHub-signed build requires:
1. Uninstall the existing app
2. Install the EAS APK fresh

This is acceptable for fix validation but not for production upgrades. For production: use GitHub Actions with the original keystore.

## Increasing `EXPO_PUBLIC_BUILD_NUMBER`

Increment the number in eas.json before each new build to avoid Android's versionCode conflicts.
