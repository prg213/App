---
name: Live TV sidebar entry
description: Fire TV behavior when the viewer activates Live TV from the sidebar.
---

# Live TV sidebar entry

- **Rule:** On TV, a single OK press on the Live TV sidebar item must open the category and channel panels with All Channels selected, focused by the remote, and loading its full list immediately without changing an existing mini-preview.
- **Why:** Restoring an old channel-focused node or defaulting to Favourites makes entry unpredictable, while clearing a preview during Live TV navigation needlessly interrupts the stream.
- **How to apply:** Reset category selection and stored focus before navigation focus is restored; make All Channels the first fallback category, but retain the selected/playing channel until a different top-level sidebar destination is activated.

## Category-panel remote contract

- **Rule:** On TV, category BACK/LEFT goes to the active Live TV sidebar item; category OK and category RIGHT focus the first channel; channel OK is the only action that starts or replaces playback.
- **Why:** The category panel is a navigation step, not a playback action. Viewers must be able to browse categories without replacing the active preview.
- **How to apply:** Track category focus for BACK handling, set native LEFT/RIGHT targets after list rows mount, and retain category-activation intent until the first channel is ready to focus without selecting it.

## Channel return and preview continuity

- **Rule:** Channel LEFT/BACK returns to the channel's own category and keeps the preview playing. Category→sidebar navigation also keeps playback; playback stops only when a different top-level sidebar destination is selected.
- **Why:** Browsing and returning to the Live TV menu are focus actions, not stop actions; clearing the selected channel creates an unexpected black preview.
- **How to apply:** Resolve the channel's provider category to its category node, expose that focus action to the screen's BACK handler, and preserve selected/playing state through all Live TV focus transitions. Let normal tab exit handle the stop when another sidebar destination is activated.

## Preview-panel return target

- **Rule:** Preview, Catch-up, and mini-guide LEFT/BACK always return to the currently playing channel, not whichever channel was last highlighted.
- **Why:** Browsing can move the highlight away from an active preview; returning to that stale highlight is disorienting and contradicts the screen's playing state.
- **How to apply:** Share a playing-channel focus action between native LEFT targets and the screen BACK handler. If the playing row belongs to another category, switch to that category and focus it after its list is ready.