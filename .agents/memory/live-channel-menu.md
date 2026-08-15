---
name: Live Channel Menu
description: LiveChannelMenu overlay component for the Firestick Live TV player — architecture, data patterns, and D-pad navigation design.
---

## What it is
`components/LiveChannelMenu.tsx` — fullscreen overlay rendered on top of the playing video (stream never stops). Opened/closed via the Firestick Menu/hamburger button (`useTVRemote.onMenu`).

## Key design decisions

**Data fetching**: Own React Query call (`queryKey: ['live-channels-menu', credentials]`). Same queryFn pattern as `guide.tsx` and `index.tsx`. M3U must use `(await fetchAndParseM3U(url)).channels` — function returns `{ channels, categories }`, NOT a plain array.

**Category derivation**: Derived from `groupTitle` on each channel (works for both Xtream and M3U). Two synthetic entries prepended: `CAT_ALL = '__all__'` and `CAT_FAV = '__fav__'`. Favourites loaded from `StorageService.getFavorites()`.

**Sorting**: Channels sorted by `num` ascending (mirrors `index.tsx`). Provider order preserved when no channel has a num.

**FlatList performance**: Fixed row height `CH_ROW_H = 70` + `getItemLayout` enables reliable `scrollToIndex` on 10 000+ channel lists without needing all items rendered first. `onScrollToIndexFailed` retries after 300 ms.

**Scroll-to-current on open**: `useEffect([isLoading])` — waits for data to load, then `scrollToIndex` + `.focus()` the current channel item. Category change also re-scrolls.

**D-pad navigation**: Entirely via Android TV spatial focus engine. Category panel (22%) and channel panel (78%) are side-by-side; LEFT/RIGHT routes between them automatically. No manual focus routing needed inside the menu.

## BACK handler priority (player.tsx)
1. Channel menu open → close menu (new, highest)
2. Audio picker open → close picker
3. CC picker open → close picker
4. OSD visible → dismiss OSD
5. Controls bar visible → hide controls
6. Nothing open → collapse to mini-player

## Zap list update on channel select
`channelList` in player.tsx changed from `useMemo` → `useState`. When user picks from the menu, `handleMenuSelectChannel` converts `MenuChannelEntry[]` → `ChannelEntry[]`, calls `setChannelList(newList)` then `switchChannel(entry, idx)`. This keeps D-pad LEFT/RIGHT zapping consistent with whatever filter was active in the menu.

**Why:**
- `activeChannelId` derived as `channelList[channelIdx]?.channelId ?? params.channelId` — updates automatically on zap, passed to `<LiveChannelMenu currentChannelId={...} />`.

## StyleSheet gotcha
`StyleSheet.absoluteFill` (not `absoluteFillObject`) — latter was removed from RN types. See runtime-referror-patterns.md.
