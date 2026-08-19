---
name: Live TV row alignment
description: Shared sizing rule for the Fire TV category and channel panels.
---

# Live TV row alignment

- **Rule:** Paired category and channel grids need identical row geometry *and* the same visible scroll offset.
- **Why:** Matching row heights prevents size-based drift, but independently-scrolled FlatLists still phase-shift their dividers as channel focus moves down the list.
- **How to apply:** Use one fixed row-height constant and matching `getItemLayout` math for both lists. Mirror channel `onScroll` offsets into the category list; apply the same pattern to Catch-up’s paired grids.

## Rapid D-pad channel navigation

- **Rule:** Do not call animated `scrollToIndex` from a Live TV channel row's `onFocus`.
- **Why:** Fire TV already scrolls a focused FlatList natively. Starting another animation for every repeated D-pad event makes competing motions jump or skip during fast navigation.
- **How to apply:** Let focus events update only the highlighted row. Reserve imperative, non-animated scrolling for restoring a selected channel from outside the list.

## TV viewport safety

- **Rule:** The three-panel TV layout needs a fixed overscan-safe edge margin and its mini-guide must be height-constrained.
- **Why:** Some Fire TV displays report no safe-area inset while clipping outer pixels; an unconstrained guide can also grow beyond the lower edge of the viewport.
- **How to apply:** Keep a small minimum root inset, allow panels to shrink with zero minimum dimensions, and make the guide’s ScrollView fill only the remaining preview height.