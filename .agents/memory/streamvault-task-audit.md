---
name: StreamVault task audit complete
description: All PROPOSED tasks swept; all genuine gaps implemented. Tracks what was done vs. already present.
---

# StreamVault task audit complete

All 68 PROPOSED tasks have been swept and accounted for across two sessions.

## Already implemented in code (no work needed)
#5, #9, #10, #20, #22, #24, #25, #30, #31, #42, #43, #69, #70, #95, #110, #116, #117, #118, #119, #120, #121, #125, #126, #127, #128, #129 (partial), #130 (WebView), #137, #138, #142, #151, #152, #155, #158 (movies + series), #165, #166, #171, #172, #189, #190, #200, #248, #253, #267, #292, #306

## Implemented this session (final commit f4f7424)
- **#129**: Block `onTrailer` tap when offline (visual guard existed but handler still fired)
- **#11**: `pruneBlockedChannelIds` added to ParentalContext; called from `index.tsx` after `fetchedChannels` loads
- **#21**: AsyncStorage-backed pending push queue (`sv_pending_push_movies/series`); cleared on logout; `movies.tsx` + `series.tsx` updated
- **#231**: TS2339 fixes — `credentials.deviceMac` → `deviceMac` in `movies.tsx`/`series.tsx`; `data?.info?.X` → `data?.series?.X` in `series/[id].tsx`
- **#343**: One-time "Press ▶ to reach ▲▼ buttons" hint in `DraggableFavList` (TV only, hides after first move via `hasMovedOnce` state)
- **#344**: `ScrollView` ref + `scrollTo(newIdx * rowHeight)` after D-pad move in `DraggableFavList`
- **#199**: `__tests__/helpers/notificationsMock.ts` factory + `notificationsMockCompleteness.test.ts`
- **#279**: Startup-hiccup + interval-path counter test in `appContextLogout.test.tsx`
- **#298**: AppState `'inactive'` pauses interval test
- **#299**: Interval stays off after logout + foreground test

## Previously implemented (earlier commits)
Batches 1–3 from previous session: #122, #165, #124, #266, #249, #307, #315, #323, #324, #123, #23

## Open follow-ups proposed
- #345: Test coverage for AsyncStorage pending-fav push across restart
- #346: Test coverage for pruneBlockedChannelIds
- #347: Channels push-failure persistence (same pattern as movies/series)
