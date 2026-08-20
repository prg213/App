---
name: Live TV row alignment
description: Shared sizing rule for the Fire TV category and channel panels.
---

# Live TV row alignment

- **Rule:** Live TV category and channel grids need identical row geometry but independent vertical scroll positions.
- **Why:** Mirroring channel scrolling into categories makes the selected category move unexpectedly while the viewer browses channels.
- **How to apply:** Use one fixed row-height constant and matching `getItemLayout` math for both lists. Let category focus/selection control the category list; never mirror channel `onScroll` into it.

## Rapid D-pad channel navigation

- **Rule:** Do not call animated `scrollToIndex` from a Live TV channel row's `onFocus`.
- **Why:** Fire TV already scrolls a focused FlatList natively. Starting another animation for every repeated D-pad event makes competing motions jump or skip during fast navigation.
- **How to apply:** Let focus events update only the highlighted row. Reserve imperative, non-animated scrolling for restoring a selected channel from outside the list.

## Channel list performance

- **Rule:** Do not synchronously persist the channel highlight for every Fire TV focus event.
- **Why:** Channel rows contain logos and EPG progress, so a parent-list redraw for every held D-pad event causes visible scrolling jank.
- **How to apply:** Let the focused row paint immediately at the native level, coalesce the persistent highlight update until movement pauses, and keep the virtualized channel render window conservative.

## TV viewport safety

- **Rule:** The three-panel TV layout needs a fixed overscan-safe edge margin and its mini-guide must be height-constrained.
- **Why:** Some Fire TV displays report no safe-area inset while clipping outer pixels; an unconstrained guide can also grow beyond the lower edge of the viewport.
- **How to apply:** Keep a small minimum root inset, allow panels to shrink with zero minimum dimensions, and make the guide’s ScrollView fill only the remaining preview height.