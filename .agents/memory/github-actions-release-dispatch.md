---
name: GitHub Actions release dispatch
description: Reliable triggering rules for the Android release workflow.
---

Keep the Android workflow’s top-level `"on"` key quoted and support both `workflow_dispatch` and the named repository-dispatch fallback.

**Why:** GitHub can briefly reject the manual-dispatch API with “Workflow does not have workflow_dispatch” even when the remote file visibly declares it. In this incident, the fallback produced the correct single release run after the workflow configuration was normalized.

**How to apply:** Prefer the manual trigger. If GitHub rejects it before creating a run, verify the remote workflow definition, then emit one `repository_dispatch` event of the configured type. Never retry after a release run actually exists, since that would create duplicate signed builds.