---
name: TV list focus window
description: Expected Fire TV D-pad scrolling behavior for independently scrolling vertical lists.
---

For D-pad vertical lists, calculate a focus window from the list's current
scroll offset, not from the focused item alone. Preserve that offset while the
highlight moves among rows already visible; move the list by one row only when
focus crosses the top or bottom visible edge.

**Why:** Recomputing the offset solely from each focused item scrolls UP as soon
as focus leaves the bottom row, even though rows above remain visible. This
feels like a jump rather than normal TV navigation.

**How to apply:** Track each virtualized list's own scroll offset through its
scroll events and update it when requesting a focus scroll. Do not share the
offset between side-by-side category and channel columns.

## Cross-column row handoff

When moving RIGHT from Categories or LEFT/BACK from Channels, use the same row
index in the destination column and copy the source column's current offset
before requesting focus.

**Why:** The viewer expects the focus to move straight across the screen to the
row physically opposite, rather than jumping to the first item or to a
semantically related category elsewhere in the list.

**How to apply:** Keep direct native focus targets for the fast path, but retain
an indexed focus fallback for virtualized rows that have not mounted yet. Align
the destination only for the cross-column handoff; ordinary UP/DOWN browsing
continues to use each list's own focus window.