---
name: TV Home dashboard & row navigation
description: Fire TV Home fixed non-scrolling dashboard layout and the tvRowNav registry for D-pad UP/DOWN between horizontal carousels.
---

# TV Home dashboard

- On `Platform.isTV`, Home renders a fixed flex-column dashboard (no vertical page scroll): Recently Watched strip (intrinsic, slimmed on TV) + flex:1 sections (Continue Watching, Latest Movies, Latest TV Shows). Cards fill row height via `height:'100%'` + `aspectRatio`, so freeing vertical space makes posters bigger automatically. Phone keeps the ScrollView path untouched.
- **Rule:** rows glide on focus — every card's onFocus calls `scrollToIndex({viewPosition:0.35})` on its own FlatList (try/catch + `onScrollToIndexFailed` fallback; missing that prop throws → release crash).
- **tvRowNav** (`lib/tvRowNav.ts`): module registry of rows in visual order; cards register nodes by (rowId,index) via callback refs; on focus, `setNativeProps({nextFocusUp/Down})` targets the adjacent row's *remembered* (last-focused) card, pinned to self at edges so focus can't vanish.
- **Why:** Fire OS native spatial focus can't move UP/DOWN between independently virtualized horizontal FlatLists (same limitation as the EPG grid); declarative props are unreliable.
- **How to apply:** any new carousel screen on TV should reuse tvRowNav + focus-glide instead of relying on native focus search.
