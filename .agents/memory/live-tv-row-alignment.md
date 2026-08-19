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