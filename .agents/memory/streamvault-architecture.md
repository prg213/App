---
name: StreamVault IPTV Architecture
description: Key decisions and gotchas for the StreamVault IPTV mobile app and API server.
---

## App structure
- `artifacts/iptv-app` — Expo SDK 57 React Native app (Android-first, landscape-only, Expo Go compatible)
- `artifacts/api-server` — Express API server; activation + device CRUD + admin panel at `GET /api/admin`
- `lib/db` — Drizzle ORM with `devicesTable` (mac_address, host, username, password, m3u_url, type)
- `lib/api-client-react` — codegen'd React Query hooks (avoid for activation.tsx — use direct useQuery instead to prevent cross-package QueryClient context mismatch)

## Auth / activation flow
- App generates a stable pseudo-MAC once on first launch, persisted in AsyncStorage via `services/macAddress.ts`
- `app/_layout.tsx` → `AppContextProvider` → `useSegments` + `useRouter` → redirects to `/activation` or `/(tabs)` based on `isActivated`
- Activation screen uses direct `useQuery` + `fetch` (NOT the generated hook — cross-package React Query instances break context)
- Credentials stored in AsyncStorage (NOT SecureStore — Expo Go incompatible)

## Landscape layout
- `app.json`: `"orientation": "landscape"` — locked landscape-only
- `app/(tabs)/_layout.tsx`: persistent left sidebar (190px) using custom `tabBar` prop + `sceneStyle: { marginLeft: 190 }`
- All content screens: two-panel `flexDirection: 'row'` — left category list (~170px) + right content
- Sidebar tabs: Live TV, TV Guide, Movies, Series, Search, Settings

## IPTV data flow
- Xtream Codes: `services/xtreamApi.ts` calls `/player_api.php` directly from the device
- M3U: `services/m3uParser.ts` fetches + parses; channels/categories returned
- All IPTV data uses `@tanstack/react-query` with `staleTime: 5min`
- M3U connections only get Live TV (no VOD/Series/EPG — those require Xtream Codes)

## EPG / TV Guide
- `services/epgService.ts`: regex-based XMLTV parser (no native XML module needed)
  - `parseXmltv(xml)` → `Map<channelId, EpgProgram[]>`
  - `fetchAndParseXmltv(url, signal)` — fetches XMLTV + parses
  - Handles timezone offsets, CDATA, HTML entities, base64 decoding
- `services/xtreamApi.ts`: `getXtreamXmltvUrl(creds)` → `host/xmltv.php?username=&password=`
- `app/(tabs)/guide.tsx`: full synchronized EPG grid
  - Left fixed column (145px): channel logos + names (FlatList, vertical scroll)
  - Top: time header (every 30 min, ScrollView horizontal scrollEnabled=false, synced to grid)
  - Right: horizontal ScrollView → vertical FlatList of program rows
  - Sync: gridHorizRef.onScroll → timeHeaderRef.scrollTo; rightListRef.onScroll ↔ leftListRef.scrollToOffset
  - Red "now" indicator line at current time position
  - Tap program → modal with title, times, duration, description + "Watch Live" button
  - EPG cached 30 min (staleTime); channel IDs matched via `channel.epgId ?? channel.id`
- EPG only available for Xtream Codes connections (XMLTV endpoint not available for M3U)

## Player
- `expo-video` (`useVideoPlayer` + `VideoView`) — SDK 57 replacement for deprecated expo-av
- `expo-av` was removed (caused "Cannot find native module 'ExponentAV'" in SDK 57 Expo Go)
- Custom controls overlay (auto-hides after 3.5 s), seek ±10 s for VOD, live mode hides seek
- Navigate to `/player?url=URL&title=TITLE&type=live|vod|series`
- Player events via `player.addListener('statusChange'|'playingChange'|'timeUpdate', cb)` — NOT `useEvent` (not exported in this expo-video version)

## Key gotchas
- `expo-av` removed in SDK 57 Expo Go → use `expo-video`; also remove `expo-av` from `app.json` plugins
- `useEvent` is NOT exported from expo-video in SDK 57 — use `player.addListener()` + `useEffect`
- Cross-package QueryClient mismatch: generated hooks from `@workspace/api-client-react` see a different context than the app's provider → use `useQuery` directly in activation.tsx
- Single-quoted strings with apostrophes in JSX arrays break bundler → use double quotes
- `sceneStyle: { marginLeft: SIDEBAR_W }` is the correct Tabs prop (not `contentStyle`) for SDK 57
- XMLTV files can be 10-50MB; parse on demand, cache 30 min; show loading state
