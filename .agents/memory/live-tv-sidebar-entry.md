---
name: Live TV sidebar entry
description: Fire TV behavior when the viewer activates Live TV from the sidebar.
---

# Live TV sidebar entry

- **Rule:** On TV, a single OK press on the Live TV sidebar item must open the category and channel panels with All Channels selected, focused by the remote, and loading its full list immediately.
- **Why:** Restoring an old channel-focused node or defaulting to Favourites makes the entry action feel unpredictable and requires extra remote presses before the main list is available.
- **How to apply:** Reset category selection and stored focus before navigation focus is restored; make All Channels the first fallback category while preserving normal category navigation after entry.