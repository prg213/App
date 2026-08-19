---
name: EPG startup prefetch
description: Required ordering for silently warming the Xtream XMLTV cache before a viewer opens TV Guide.
---

## Rule
Begin the EPG prefetch immediately after stored Xtream credentials load, before any MAC/activation network check completes and before the app renders the tab experience. Use the exact same React Query key and cache policy as TV Guide.

**Why:** MAC validation can take up to ten seconds. Starting EPG only after it resolves leaves the user able to reach TV Guide before the background request has even begun, defeating the perceived-fast-load requirement.

**How to apply:** Keep the prefetch fire-and-forget so startup never blocks. The Guide must share its query key with the prefetch so React Query joins an in-flight request or reads the completed cache instead of beginning another download. Trigger the same prefetch on a newly activated account.