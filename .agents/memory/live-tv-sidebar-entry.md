---
name: Live TV sidebar entry
description: Fire TV behavior when the viewer activates Live TV from the sidebar.
---

# Live TV sidebar entry

- **Rule:** On TV, a single OK press on the Live TV sidebar item must open the category and channel panels with All Channels selected, focused by the remote, and loading its full list immediately.
- **Why:** Restoring an old channel-focused node or defaulting to Favourites makes the entry action feel unpredictable and requires extra remote presses before the main list is available.
- **How to apply:** Reset category selection and stored focus before navigation focus is restored; make All Channels the first fallback category while preserving normal category navigation after entry.

## Category-panel remote contract

- **Rule:** On TV, category BACK/LEFT goes to the active Live TV sidebar item; category OK plays and focuses the first channel; category RIGHT targets that same first channel.
- **Why:** The category panel is a navigation step, not a dead end. Each direction needs a predictable outcome without relying on Fire OS spatial-focus inference.
- **How to apply:** Track category focus for BACK handling, set native LEFT/RIGHT targets after list rows mount, and retain category-activation intent until the first channel is ready to preview.