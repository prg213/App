---
name: StreamVault task audit complete
description: Status of all 48 PROPOSED tasks swept and implemented in a full audit session
---

## Genuine gaps fixed (commits cd4ecc7 → a889c05)

- **#11** Orphaned blockedCategoryIds: `pruneBlockedCategories` added to ParentalContext; called from index.tsx on rawCategories change.
- **#24** Native AirPlay picker: CastButton uses `expo-video`'s `VideoAirPlayButton` (not an Alert).
- **#31** VOD foreground retry: AppState handler in player.tsx now retries VOD streams on foreground return (was live-only).
- **#110** Reschedule guard: `handleReschedule` warns and bails when lead time ≥ time to start.
- **#122** Recent searches cleared on logout: `RECENT_SEARCHES` added to `clearCredentials` multiRemove.
- **#124** Provider trailer URL priority: series.tsx/movies.tsx now use `item.trailerUrl` first, fall back to TMDB.
- **#125** Live TV `reminders:changed` listener: index.tsx subscribes to event so miniReminderIds stays in sync cross-screen.
- **#126** Backfill gate reset on logout: `clearReminderRefreshCache()` called in `doLogout`.
- **#127** Pull-to-refresh bypass: `backfillStreamUrls(r, true)` (force flag) bypasses 15-min gate and failure backoff.
- **#138** Stale-URL safety net: `didResolveStaleUrlRef.current = false` reset on URL-match branch; index.tsx retry skips when fullscreen open.
- **#142** Lead-time AppState refresh: AppState listener in reminders.tsx reloads lead time on foreground.
- **#172** Poster sharpness: MovieCard + SeriesCard use expo-image with `cachePolicy="memory-disk"`.
- **#189/#190** Periodic MAC check: 10-min interval in AppContext skips if foreground check ran within 2 min; forces logout on fail.
- **Playback speed** persistence: `@pref_playback_speed` read/written via AsyncStorage in player.tsx.

## Confirmed already implemented (no change needed)
Tasks 5, 9, 10, 20, 21, 22, 25, 30, 42, 43, 69, 70, 95, 116, 117, 118, 119, 121, 123, 128, 129, 130, 137, 151, 152, 155, 165, 166, 171, 172, 187 — all verified present in codebase.

## Deferred (low priority / complex)
- **#23** Failed-push persistence: in-memory retry queue lost on app close. Mitigated because local AsyncStorage is source-of-truth and next startup merges remote → local.
- **#155** TMDB poster disk cache: in-memory only. Mitigated by expo-image `cachePolicy="memory-disk"` caching rendered pixels natively.

**Why:** Both deferred tasks require significant AsyncStorage plumbing for marginal UX gain given existing mitigations.
