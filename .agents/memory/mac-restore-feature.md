---
name: MAC restore feature
description: Settings screen has a Restore button next to the MAC address that lets the user manually override the stored MAC, bypassing the Android SSAID derivation.
---

## What was added
- `overrideDeviceMac(mac: string): Promise<void>` exported from `services/macAddress.ts` — validates XX:XX:XX:XX:XX:XX format, writes to SecureStore, clears in-memory cache.
- Settings screen (`app/(tabs)/settings.tsx`): "Restore" pressable next to the MAC address display opens a Modal with a TextInput. On confirm, calls `overrideDeviceMac`. User must force-close and reopen the app for the new MAC to propagate through AppContext.

## Why this exists
EAS builds use a different signing key than GitHub Actions. Android SSAID is scoped to (package × signing key), so installing an EAS APK after a GitHub Actions APK changes the derived MAC. The Restore feature lets the user fix their MAC without needing to reinstall the correct signing-key APK.

**How to apply:** Whenever a MAC mismatch occurs due to signing-key change, tell the user: Settings → MAC Address → Restore → enter the MAC shown in their IPTV provider portal.
