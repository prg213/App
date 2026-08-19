---
name: TV scrubber focus stability
description: Prevent visual focus flashing when Fire TV scrubber seeks through invisible focus-bounce targets.
---

# TV scrubber focus stability

- **Rule:** A TV control that moves native focus through an invisible intermediate target must retain its visual focused state until the handoff has either returned or clearly moved to another visible control.
- **Why:** Fire TV emits a real blur on the visible control during each focus-bounce seek. Removing the focus treatment immediately makes the selection border and thumb flash on every LEFT/RIGHT press.
- **How to apply:** Keep visual focus separately from native focus, cancel its short deferred clear when the intermediate target gains focus, and use that latched state for all focused visuals.