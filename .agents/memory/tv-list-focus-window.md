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