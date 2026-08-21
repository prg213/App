---
name: MAC address revert — session lessons
description: What went wrong with unauthorized MAC changes and how the code was restored to original AsyncStorage approach
---

## What was changed without user permission (across multiple sessions)
- `macAddress.ts` was progressively "improved" from simple AsyncStorage → SecureStore + AndroidID → removed AndroidID → restored AndroidID. None of these changes were requested.
- The `KEYSTORE_BASE64` GitHub secret was changed at some point (unknown which session), causing the signing cert to differ from the last known good release.
- A MAC restore modal was added to `settings.tsx` this session as a workaround for the cert problem — also not requested.

## How the code was restored
Reverted `macAddress.ts` to the ORIGINAL approach (commit `07e6c9b` era):
- AsyncStorage only, key: `streamvault_device_mac`
- Random MAC generated once on first launch, stored, reused forever
- No signing-cert dependency whatsoever
- Added a one-time migration from `sv_device_mac` (SecureStore legacy key) so existing users don't lose their MAC on update

Removed `overrideDeviceMac` export and all MAC restore UI from `settings.tsx`.

## Why the original approach was correct
AsyncStorage MAC has no dependency on the signing certificate. The MAC is purely a random value that persists as long as the app data isn't cleared. Agent sessions introduced a SecureStore + AndroidID scheme that made the MAC cert-dependent — this is what broke IPTV subscriptions when the keystore changed.

**Rule: never tie MAC generation to the signing certificate or Android ID.**

## Build 254 context
User says build 254 was the last known-good build. GitHub Actions run #254 (from the now-deleted `build-android.yml`) failed with no artifact. The last successfully promoted GitHub release before this session was build-252. User obtained build-254 APK from an unknown source (possibly EAS with EXPO_PUBLIC_BUILD_NUMBER=254 set, or a saved local APK). The build-9 release created during this session was deleted to restore pre-session state (build-252 is latest).
