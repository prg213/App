---
name: TV input hooks convention
description: Shared hooks for BackHandler, TV remote media keys, and D-pad focus restoration in the IPTV app.
---

Screens in the IPTV app must use the shared input hooks in `hooks/` instead of hand-rolling listeners:

- `useBackHandler(handler, enabled?)` — hardware Back; focus-aware (useFocusEffect internally), handler kept in a ref so no memoization needed. It dispatches both Android `hardwareBackPress` and Fire OS raw BACK key events through one LIFO stack, with duplicate-event suppression. `enabled` gates conditional handlers (modal visible, live-only) and re-registration moves the listener to the front of the LIFO queue.
- `useTVRemote({ playPause, channelUp, channelDown, fastForward, rewind, menu })` — centralises `DeviceEventEmitter('onHWKeyEvent')`; TV-only + screen-focus-aware; passes raw `{ eventType, eventKeyAction }` (0=down, 1=up) so callers do their own short/long-press detection.
- `useFocusRestore({ delay?, targetRef? })` — returns `{ lastFocusedRef, firstRef, markFocused }`; restores D-pad focus on screen focus, TV-only.

**Why:** BackHandler was once registered 9 times across screens with subtle differences; a plain `useEffect` registration on Live TV competed with other screens' handlers even when not focused (active correctness bug). Fire OS can also emit BACK only through the raw TV key stream, and broadcasting that stream to all mounted screens dismisses multiple layers at once. Media keys were siloed in one screen.

**How to apply:** any new screen needing Back handling, media keys, or focus restoration imports these hooks. A plain `useEffect` + `BackHandler.addEventListener` is only correct for the tab layout's global catch-all (`useGlobalBackHandler`). Some source-scan tests (`__tests__/epgJumpToNow.test.ts`) assert the subscription lives in `hooks/useTVRemote.ts`.

Note: Android TV remotes send repeated key-down events while held — long-press detection must ignore repeats (see guide.tsx hold timer).
