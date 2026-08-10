# Fire TV D-pad — CategoryGrid Navigation Test Checklist

**Component:** `CategoryGrid` in `app/(tabs)/guide.tsx`  
**Relevant code:** `wireCard()` function; `TV_WIRE_DELAY_MS` constant; `nextFocusRight` / `nextFocusLeft` wiring  

---

## Purpose

This checklist confirms that D-pad focus can traverse every card in the category
grid on all supported Firestick hardware without getting stuck at a row boundary.
The wiring relies on `setNativeProps({ nextFocusRight, nextFocusLeft })`, which is
applied after a `TV_WIRE_DELAY_MS` delay to give the native view hierarchy time to
attach before `findNodeHandle` is called.  Low-end devices (Firestick Lite) render
more slowly, so the delay must be generous enough for all models.

Run this checklist whenever:
- `TV_WIRE_DELAY_MS` is changed  
- `CategoryGrid` render logic or column count is modified  
- A new Firestick model or Fire OS version is added to the support matrix  

---

## Devices Under Test

| Device | CPU | Chip | Min required |
|---|---|---|---|
| Firestick Lite (2nd gen) | 1.0 GHz quad-core | MT8695 | ✅ must pass |
| Firestick 4K (2nd gen) | 1.7 GHz quad-core | MT8696 | ✅ must pass |
| Firestick 4K Max (2nd gen) | 2.0 GHz quad-core | MT8696T | ✅ must pass |
| Fire TV Cube (3rd gen) | 2.2 GHz hexa-core | T982 | nice-to-have |

---

## Pre-conditions

- App installed via `eas build --profile preview` + ADB sideload **or** a
  TestFlight/EAS internal distribution link.  
- Physical Fire TV remote (D-pad model or Alexa Voice Remote with D-pad ring).  
- The account used must have at least one IPTV provider configured with ≥ 10
  categories so the grid renders at least two rows.  

---

## Test Cases

### TC-01 — Initial focus lands on the first card

**Steps:**  
1. Open the app and navigate to the TV Guide tab.  
2. Do not press any key; observe where the focus ring appears.

**Expected:**  
The first category card (top-left) receives the focus ring within 1 second of the
grid becoming visible.

**Pass / Fail:**  

| Device | Result | Notes |
|---|---|---|
| Firestick Lite | | |
| Firestick 4K | | |

---

### TC-02 — D-pad Right within a row moves focus to the next card

**Steps:**  
1. Focus is on the first card in a row.  
2. Press D-pad Right repeatedly.

**Expected:**  
Focus moves card-by-card to the right.  No card is skipped.  Focus does not jump
to a different row during within-row traversal.

**Pass / Fail:**  

| Device | Result | Notes |
|---|---|---|
| Firestick Lite | | |
| Firestick 4K | | |

---

### TC-03 — D-pad Right from the last card in a row → first card of the next row

**Steps:**  
1. Focus any card that is the last card in its row (rightmost column, or the
   final card when the row is not full).  
2. Press D-pad Right once.

**Expected:**  
Focus moves to the **first card of the immediately following row** — not stuck on
the current card, not jumping to a card two rows down.

**Pass / Fail:**  

| Device | Result | Notes |
|---|---|---|
| Firestick Lite | | |
| Firestick 4K | | |

---

### TC-04 — D-pad Left from the first card in a row → last card of the previous row

**Steps:**  
1. Focus any card that is the first card in its row (leftmost column).  
2. Press D-pad Left once.

**Expected:**  
Focus moves to the **last card of the immediately preceding row** — not stuck, not
jumping two rows up.

**Pass / Fail:**  

| Device | Result | Notes |
|---|---|---|
| Firestick Lite | | |
| Firestick 4K | | |

---

### TC-05 — D-pad Left from the first card of the first row does not wrap

**Steps:**  
1. Focus the very first card (index 0).  
2. Press D-pad Left.

**Expected:**  
Focus does **not** move (or moves to another focusable element such as the sidebar
navigation, depending on layout) — it must not wrap to the last card in the grid.

**Pass / Fail:**  

| Device | Result | Notes |
|---|---|---|
| Firestick Lite | | |
| Firestick 4K | | |

---

### TC-06 — D-pad Right from the very last card does not wrap

**Steps:**  
1. Scroll to the bottom of the grid.  
2. Focus the last category card.  
3. Press D-pad Right.

**Expected:**  
Focus does **not** wrap to the first card.  It either stays on the last card or
moves to another focusable region outside the grid.

**Pass / Fail:**  

| Device | Result | Notes |
|---|---|---|
| Firestick Lite | | |
| Firestick 4K | | |

---

### TC-07 — D-pad Up / Down scrolls the grid vertically

**Steps:**  
1. Focus any card.  
2. Press D-pad Down to move focus down one row.  
3. Continue pressing D-pad Down until the grid auto-scrolls to reveal off-screen rows.  
4. Press D-pad Up to return focus upward.

**Expected:**  
- D-pad Down moves focus to the card in the same column of the row below.  
- D-pad Up moves focus to the card in the same column of the row above.  
- The `FlatList` scrolls automatically to keep the focused card visible.  
- No focus is lost during the scroll animation.

**Pass / Fail:**  

| Device | Result | Notes |
|---|---|---|
| Firestick Lite | | |
| Firestick 4K | | |

---

### TC-08 — Cross-row wiring survives a scroll that virtualises new rows into view

**Steps:**  
1. Focus the first card.  
2. Rapidly press D-pad Down 6–8 times to scroll the list and bring virtualised
   rows into view.  
3. Then press D-pad Right until reaching the last card in the current row.  
4. Press D-pad Right once more.

**Expected:**  
Focus moves to the first card of the next row regardless of whether those rows
were off-screen when the grid first mounted.

**Pass / Fail:**  

| Device | Result | Notes |
|---|---|---|
| Firestick Lite | | |
| Firestick 4K | | |

---

### TC-09 — Selecting a category navigates to the channel list

**Steps:**  
1. Focus any category card.  
2. Press the OK/Select button on the remote.

**Expected:**  
The app transitions to the full-guide channel list for that category.  No focus is
lost or stuck before the transition completes.

**Pass / Fail:**  

| Device | Result | Notes |
|---|---|---|
| Firestick Lite | | |
| Firestick 4K | | |

---

### TC-10 — Focus is stable after returning from the channel list (Back button)

**Steps:**  
1. Select a category (TC-09 passes).  
2. Press the Back button on the remote to return to the category grid.

**Expected:**  
The category grid is visible and the previously-selected card (or the first card)
regains focus automatically.  D-pad navigation continues to work as in TC-02 – TC-08.

**Pass / Fail:**  

| Device | Result | Notes |
|---|---|---|
| Firestick Lite | | |
| Firestick 4K | | |

---

## Sign-off

| Tester | Date | Build version | Overall result |
|---|---|---|---|
| | | | |

---

## Known timing parameters (for regression reference)

| Constant | Value | Location |
|---|---|---|
| `TV_WIRE_DELAY_MS` | 250 ms | `CategoryGrid` in `app/(tabs)/guide.tsx` |

If a future regression is reported specifically on Firestick Lite and TC-03 or
TC-04 fails while passing on Firestick 4K, the first thing to try is increasing
`TV_WIRE_DELAY_MS` to 300–400 ms and re-running TC-03/TC-04 on the Lite unit.
