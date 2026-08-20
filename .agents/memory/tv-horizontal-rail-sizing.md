---
name: TV horizontal rail sizing
description: Layout rule for horizontally scrolling Fire TV FlatLists on the Home dashboard.
---

For a horizontally scrolling TV rail, apply `flex: 1` to the FlatList viewport when it needs to fill a dashboard row. Do not apply it to the FlatList content container.

**Why:** A flex-sized horizontal content container can resolve to only the viewport width. The native list then has no overflow extent, so calls to move the focused item into view are silently clamped and the rail appears not to scroll.

**How to apply:** Keep the content container limited to padding, gap, and cross-axis alignment. Use a separate style on the FlatList itself for its vertical fill.