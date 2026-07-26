---
name: StreamVault IPTV Architecture
description: Key decisions and gotchas for the StreamVault IPTV mobile app and API server.
---

## App structure
- `artifacts/iptv-app` — Expo 53 React Native app (Android-first, Expo Go compatible)
- `artifacts/api-server` — Express API server; activation + device CRUD + admin panel at `GET /api/admin`
- `lib/db` — Drizzle ORM with `devicesTable` (mac_address, host, username, password, m3u_url, type)
- `lib/api-client-react` — codegen'd React Query hooks; use `setBaseUrl(...)` with `EXPO_PUBLIC_DOMAIN` env var

## Auth / activation flow
- App generates a stable pseudo-MAC once on first launch, persisted in AsyncStorage via `services/macAddress.ts`
- `app/_layout.tsx` → `AppContextProvider` → `useSegments` + `useRouter` → redirects to `/activation` or `/(tabs)` based on `isActivated`
- Activation screen polls `useCheckActivation({ mac })` every 8 s with `refetchInterval`; on `status === 'active'` calls `setActivated(creds)`
- Credentials stored in AsyncStorage (NOT SecureStore — Expo Go incompatible)

## IPTV data flow
- Xtream Codes: `services/xtreamApi.ts` calls `/player_api.php` directly from the device
- M3U: `services/m3uParser.ts` fetches + parses; channels/categories returned
- All IPTV data uses `@tanstack/react-query` with `staleTime: 5min`
- M3U connections only get Live TV (no VOD/Series — those require Xtream Codes)

## Player
- `expo-av` Video component (deprecated in SDK 54, use `expo-video` when upgrading)
- Custom controls overlay (auto-hides after 3.5 s), seek ±10 s for VOD, live mode hides seek
- Navigate to `/player?url=URL&title=TITLE&type=live|vod|series`

## Tabs layout
- `isLiquidGlassAvailable()` from `expo-glass-effect` selects NativeTabs (iOS 26+) vs ClassicTabs
- NativeTabs: `expo-router/unstable-native-tabs` with SF Symbols
- ClassicTabs: `expo-symbols` (iOS), `@expo/vector-icons Feather` (Android)

## Key gotchas
- `expo-clipboard` must be pinned to `~8.0.8` for Expo 53 (57.x installed by default is wrong)
- Player screen: do NOT use CSS `background: 'linear-gradient(...)'` — it's invalid in React Native StyleSheet
- `useNativeDriver: true` warnings on web are expected (JS fallback)
- `expo-av` deprecation warning on web is expected; works fine on native for SDK 53

**Why:**
Decisions were made to maximize Expo Go compatibility (no native modules requiring `expo run:android`). Upgrade path: swap `expo-av` → `expo-video` when moving to SDK 54.
