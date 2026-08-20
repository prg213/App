---
name: Fire TV cross-panel focus fallback
description: Handling unreliable native D-pad routes between independently virtualized TV panels.
---

When a Fire TV D-pad route crosses independently virtualized panels, do not trust
`nextFocusLeft` alone. Mark the source panel as a pending return and, if the
wrong receiving panel gains focus, immediately request focus on the intended
control.

**Why:** Fire OS can ignore an otherwise valid explicit native focus target and
apply its spatial heuristic instead, which sent LEFT from the Live TV preview,
Catch-up, and mini-guide directly to Categories.

**How to apply:** Keep the normal explicit `nextFocus*` target for the fast
path. For a control whose only valid directional exit is known, maintain a
short-lived source marker and inspect the unexpected destination's `onFocus`.
Clear the marker once the intended focus destination is reached, so normal
navigation into that panel remains unchanged.