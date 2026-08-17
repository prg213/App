---
name: TV EPG D-pad focus & synced panning
description: How Fire TV guide grid wires D-pad focus imperatively and keeps all rows panning together
---
# TV EPG D-pad focus & synced panning (app/(tabs)/guide.tsx, TVEpgRow)

- Native spatial nav can't cross virtualised horizontal FlatLists on Fire OS, so all focus routing is imperative `setNativeProps` done in each programme cell's `onFocus`.
- UP/DOWN target the **same-time programme cell** in the adjacent row via a shared `allProgRows` registry (rowIndex → {items, refs}) owned by FullGuide; falls back to the adjacent row's channel cell. Registry cleared on category change alongside `allChannelRefs`.
- RIGHT on the last cell pins `nextFocusRight` to self so focus stops at row end; non-last cells pin to the mounted neighbour or clear with `-1` (Android View.NO_ID) to avoid stale self-pins from recycling.
- All rows pan together via time-based `epg:syncScroll` DeviceEventEmitter broadcast (pixel offsets are NOT time-aligned across rows — 60px min cell widths distort them; always convert offset↔time per row).
- **Feedback-loop guard:** every programmatic scroll (mount restore, jump-to-now, jumpToTime, sync apply) calls `beginProgrammaticScroll(expectedOffset, settleMs)`; onScroll echoes matching the expected offset end suppression, wall-clock timer is the backstop. User pans broadcast via 80 ms trailing debounce — never per-frame (architect flagged per-frame emits as a Fire TV perf killer).
- **Why:** first implementation emitted per scroll frame and used only a 200 ms timer guard; review found broadcast storms + rebroadcast cascades. Keep debounce + expected-offset consumption if touching this code.
