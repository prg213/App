---
name: TV rail shared scroll extents
description: Keep synchronized Fire TV Home rails aligned even when they contain different numbers of cards.
---

When horizontally synchronized FlatLists have different item counts, giving each one the same `scrollToOffset` call is not enough: React Native clamps each list to its own content boundary. Shorter rows must receive trailing spacer width so every synchronized rail has the same realized scroll range.

**Why:** Otherwise Home card columns drift at the right edge even though each focus event requests the same offset. A footer spacer participates in the list's item gap, so its width must subtract that adjacent gap to exactly match the longest rail's final-card extent.

**How to apply:** Keep the card stride, list gap, and spacer calculation derived from the same shared layout constants. Whenever a synchronized row gains a footer, verify the equal-content-extent case for unequal row lengths.