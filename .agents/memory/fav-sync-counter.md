---
name: StreamVault fav-sync session counter
description: Module-level push-failure counter in favoritesSync.ts — how it works and what resets it.
---

## Rule
Any push failure (pushRemoteChannels/Movies/Series returning false) increments a module-level counter via `recordPushFailure()`. When the count reaches 3 the calling screen should surface a non-blocking toast. `resetSessionPushFailures()` must be called from `doLogout` in AppContext.tsx.

**Why:** Users don't see silent failures; queued payloads retry on next foreground but the user had no indication their action wasn't saved.

**How to apply:**
- `services/favoritesSync.ts` owns `_sessionPushFailCount`, `recordPushFailure()`, `resetSessionPushFailures()`.
- Currently wired in `app/(tabs)/movies.tsx` and `app/(tabs)/series.tsx` toggle handlers — `app/(tabs)/index.tsx` channels handler does NOT yet show a toast (no Toast component rendered in that file).
- AppContext.tsx imports `resetSessionPushFailures` and calls it inside `doLogout`.
- MovieCard.tsx trailer pill: `onTrailerPress` prop is destructured and renders a `▶ Trailer` pill bottom-left of the poster overlay (touch only, `!Platform.isTV`).
