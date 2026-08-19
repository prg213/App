---
name: Live TV row alignment
description: Shared sizing rule for the Fire TV category and channel panels.
---

# Live TV row alignment

- **Rule:** The category and channel FlatLists must use the same item height, including matching `getItemLayout` lengths and item styles.
- **Why:** The panels are visually paired; different row heights make their boundaries drift as soon as the channel list scrolls.
- **How to apply:** Treat the channel row height as the shared baseline because it must fit the logo, channel name, and programme text; update both lists together if that baseline changes.