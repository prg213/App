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

## Channel return and preview continuity

- **Rule:** Channel LEFT/BACK returns to the channel's own category and keeps the preview playing. Playback stops only when category focus exits to the Live TV sidebar.
- **Why:** Browsing is a focus action, not a stop action; clearing the selected channel while moving back to categories creates an unexpected black preview.
- **How to apply:** Resolve the channel's provider category to its category node, expose that focus action to the screen's BACK handler, and distinguish a category→sidebar blur from a category→channel blur. Keep a remote LEFT fallback for category rows that virtualization has unmounted.

## Preview-panel return target

- **Rule:** Preview, Catch-up, and mini-guide LEFT/BACK always return to the currently playing channel, not whichever channel was last highlighted.
- **Why:** Browsing can move the highlight away from an active preview; returning to that stale highlight is disorienting and contradicts the screen's playing state.
- **How to apply:** Share a playing-channel focus action between native LEFT targets and the screen BACK handler. If the playing row belongs to another category, switch to that category and focus it after its list is ready.