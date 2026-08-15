# In-Memory-Only State — StreamVault IPTV

This document catalogs every module-level or session-scoped variable in the
app that is **intentionally kept in JavaScript memory only** and must never be
written to `AsyncStorage` (or any other persistent store).

A cold-start (force-quit + relaunch) restarts the JS runtime from scratch, so
all of these values return to their default without any cleanup code.  If they
were persisted the app could open in a stale, unexpected state.

The CI check `scripts/check-inmemory-not-persisted.sh` enforces this contract
automatically.

---

## 1 · EPG Scroll Offsets

| Variable | File | Type |
|---|---|---|
| `_epgScrollX` | `services/epgScrollState.ts` | `number` |
| `_epgScrollY` | `services/epgScrollState.ts` | `number` |

**Why in-memory only:** The EPG guide should always open at position 0,0 (or
scroll to "now") after a relaunch.  A stale offset stored on disk could snap
the grid to a position in the past or an unexpected horizontal column.

**Reset:** Module initialisation (cold-start).  Also explicitly reset by
`resetEpgScrollState()` on logout.

---

## 2 · EPG Filter State

| Variable | File | Type |
|---|---|---|
| `_selectedCat` | `services/epgFilterState.ts` | `string` |
| `_favFilterActive` | `services/epgFilterState.ts` | `boolean` |

**Why in-memory only:** The category selection and favourites-only filter are
session conveniences.  Persisting them could leave the guide stuck on a
category that no longer exists or a favourites filter with zero results after
channel changes.

**Reset:** Module initialisation.  Also explicitly reset by
`resetEpgFilterState()` on logout.

---

## 3 · Channel Menu Session State

| Variable | File | Type |
|---|---|---|
| `_savedCat` | `components/LiveChannelMenu.tsx` | `string` |
| `_savedSearch` | `components/LiveChannelMenu.tsx` | `string` |
| `_savedScrollOffset` | `components/LiveChannelMenu.tsx` | `number` |
| `_autoSelected` | `components/LiveChannelMenu.tsx` | `boolean` |

**Why in-memory only:** These survive component unmount/remount during a
single app session (e.g. when the player collapses and re-opens the menu) but
must reset on app restart.  Persisting the saved search text or scroll offset
across launches could be confusing and would not reflect the current channel
list.

**Reset:** Module initialisation (cold-start).  Logout explicitly calls
`resetChannelMenuState()` which zeroes all four variables.

---

## 4 · OSD / Player UI Visibility

| Variable | File | Type |
|---|---|---|
| `showInfo` (useState) | `app/player.tsx` | `boolean` |
| `showControls` (useState) | `app/player.tsx` | `boolean` |
| `showChannelMenu` (useState) | `app/player.tsx` | `boolean` |

**Why in-memory only:** OSD and overlay visibility is always transient.  The
overlay should never start open on a fresh launch — that would break TV remote
focus logic and confuse new playback sessions.  These are React component
state, not module-level, so they cannot be accidentally persisted unless
someone explicitly passes them to a storage call.

**Reset:** Component unmount / player navigation away.

---

## 5 · Zap-List / Channel Index Position

| Variable | File | Type |
|---|---|---|
| `channelIdx` (useState) | `app/player.tsx` | `number` |

**Why in-memory only:** The active channel index is initialised from the
navigation params on each player open.  Persisting the last-watched index
separately would duplicate the `sv_recent_channels` history and could cause
the player to start on the wrong channel if the channel list changes between
sessions.

**Reset:** Component mount from navigation params.

---

## 6 · In-Memory Caches

| Variable | File | Type |
|---|---|---|
| `trailerCache` | `services/tmdb.ts` | `Map<string, string \| null>` |
| `posterCache` | `services/tmdb.ts` | `Map<string, string \| null>` |
| `seriesTrailerUrlCache` | `services/tmdb.ts` | `Map<string, string>` |
| `lastNetworkRefreshByCredential` | `services/reminderUrlCache.ts` | `Map<string, number>` |

**Why in-memory only:** These caches trade memory for speed.  Writing them to
`AsyncStorage` would accumulate unbounded data across sessions, and URLs /
poster paths go stale over time.

**Cache characteristics (do not conflate):**
- `trailerCache` and `posterCache` use a proper LRU eviction strategy via
  `lruSet` / `lruGet` in `tmdb.ts`, bounded to `CACHE_MAX = 200` entries each.
- `seriesTrailerUrlCache` is an **unbounded** plain `Map` — no size limit, no
  TTL.  It grows throughout the session and is cleared entirely on logout via
  `clearTmdbTrailerCache()`.
- `lastNetworkRefreshByCredential` uses a TTL check (`NETWORK_REFRESH_INTERVAL_MS`)
  at read time; old entries are simply skipped rather than evicted proactively.

**Reset:** Cold-start clears all four.  Logout also calls
`clearTmdbTrailerCache()` (clears all three TMDB Maps) and
`clearReminderRefreshCache()` (clears the credential refresh Map).

---

## 7 · Session Push-Failure Counter

| Variable | File | Type |
|---|---|---|
| `_sessionPushFailCount` | `services/favoritesSync.ts` | `number` |

**Why in-memory only:** This counter tracks how many cloud-sync pushes have
failed in the current login session so that a toast warning can be shown after
≥ 3 failures.  The counter must reset to 0 on every new login; persisting it
would carry stale failure counts into fresh sessions, potentially triggering a
spurious warning on the first push of a brand-new session.

**Reset:** `resetSessionPushFailures()` called from `doLogout()` and on each
successful login.

---

## CI Guard — What It Catches and What It Doesn't

The guard (`scripts/check-inmemory-not-persisted.py`) reliably catches:

- **Multiline write calls** — the detector tracks parenthesis depth, so an
  identifier on a different line from the `setItem`/`multiSet`/`mergeItem`/
  `multiMerge` call is still flagged.
- **Both import aliases** — the canonical `AsyncStorage` name and the
  dynamic-import alias `AS` (used throughout `app/player.tsx` and tab screens)
  are both matched.
- **All write APIs** — `setItem`, `mergeItem`, `multiSet`, `multiMerge`.
- **Pre-computed variables (one level)** — if a forbidden identifier appears in
  a variable assignment within 30 lines before a write call, and that variable
  is passed to the write, the guard traces the assignment and flags it:

  ```ts
  // CAUGHT — one-level trace: channelIdx → rows → multiSet
  const rows: [string, string][] = [['key', JSON.stringify(channelIdx)]];
  AS.multiSet(rows);

  // CAUGHT — one-level trace: trailerCache → dump → setItem
  const dump = JSON.stringify(Array.from(trailerCache.entries()));
  AS.setItem('cache_dump', dump);
  ```

**Known limitation — multi-level indirection:** The tracer only follows one
assignment hop.  A two-level chain (`channelIdx → a → b → write`) will not be
detected.  This is an accepted trade-off; real accidental persistence is almost
always a single-hop mistake.

**TypeScript type annotations** in assignments (`const rows: Type[] = ...`) are
handled; the type annotation is skipped when locating the RHS.

If a new AsyncStorage alias is introduced (beyond `AsyncStorage` and `AS`),
add it to the `WRITE_METHOD_RE` regex in `scripts/check-inmemory-not-persisted.py`.

---

## Adding a New In-Memory Variable

If you introduce a new module-level or session-scoped variable that must not
be persisted:

1. Add an entry to this document under the appropriate category (or create a
   new category).
2. Add a corresponding pattern to `scripts/check-inmemory-not-persisted.sh`
   so CI will catch any future accidental persistence.
3. Add a comment near the variable declaration explaining that it is
   intentionally in-memory only and listing its reset path.
