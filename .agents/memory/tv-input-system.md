---
name: TV input & navigation system
description: Three shared hooks centralising BackHandler, onHWKeyEvent, and focus restoration for the Firestick/Android TV remote. Applied across all tab screens and the player.
---

## The Three Hooks

**`hooks/useBackHandler.ts`**
- Wraps `useFocusEffect + BackHandler.addEventListener` — handler is ONLY active while the screen is focused.
- Uses a ref internally; callers never memoize the handler.
- Replaces 9 scattered `useFocusEffect(useCallback(() => { BackHandler... }))` blocks.
- **Why:** `index.tsx` had a plain `useEffect` (active on every tab simultaneously) — fixed here.

**`hooks/useTVRemote.ts`**
- Subscribes to `DeviceEventEmitter('onHWKeyEvent')` gated on `useFocusEffect` focus ref.
- Keys: `playPause`, `channelUp`, `channelDown`, `fastForward`, `rewind`, `menu`.
- No-op on phones/tablets (`Platform.isTV === false`).
- Uses a ref for focus tracking (not `useIsFocused`) because `@react-navigation/native` is not directly typed in this project.

**`hooks/useFocusRestore.ts`**
- Returns `{ firstRef, markFocused, clearFocus }`.
- `firstRef`: attach to the default first focusable item (fallback).
- `markFocused(node)`: call from `onFocus` to record the last-focused node.
- `clearFocus()`: call on category/filter change to reset to firstRef.
- Internally wraps `useFocusEffect(useCallback(() => setTimeout(focus, delay), []))`.

## What was migrated

| File | Change |
|---|---|
| `index.tsx` | BackHandler bug fix: `useEffect` → `useBackHandler` |
| `catchup.tsx` | `useFocusEffect+BackHandler` → `useBackHandler` |
| `movies.tsx` | BackHandler + lastFocusedCardRef → `useBackHandler` + `useFocusRestore` |
| `series.tsx` | BackHandler + lastFocusedCardRef → `useBackHandler` + `useFocusRestore` |
| `search.tsx` | `useFocusEffect+BackHandler` → `useBackHandler` |
| `guide.tsx` | DeviceEventEmitter → `useTVRemote`; `useEffect+BackHandler` → `useBackHandler` |
| `player.tsx` | Added `useTVRemote` (Play/Pause, Ch Up/Down, FF/RW); `scheduleHide` no-op on TV |
| `TVLiveLayout.tsx` | `lastFocusedChRef+useFocusEffect` → `useFocusRestore` |

## Player media key behaviour (TV only)
- `playPause` key-up: show controls if hidden (VOD), else toggle play
- `channelUp` key-up: `handleNextChannel()` in live mode
- `channelDown` key-up: `handlePrevChannel()` in live mode
- `fastForward` key-up: `seek(+30)` in VOD/catchup
- `rewind` key-up: `seek(-30)` in VOD/catchup

## TV overlay behaviour
- `scheduleHide` returns early on `Platform.isTV` — controls stay until BACK is pressed.
- Live TV info bar already had no auto-hide (unchanged).

## What was NOT migrated (left for follow-up)
- `guide.tsx` TimePicker sub-component BackHandler (plain `useEffect`, correct for modal)
- `catchup.tsx` multi-column focus restore (bespoke refs)
- `player.tsx` BackHandler blocks (plain `useEffect`, correct for fullscreen modal)

**Why:** `useBackHandler` uses `useFocusEffect` which is screen-level. Player BackHandlers have complex `isLive/isWeb` conditional logic; `useFocusEffect` vs `useEffect` doesn't matter since the player mounts fresh each time.
