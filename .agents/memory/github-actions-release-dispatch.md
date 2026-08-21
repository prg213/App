---
name: GitHub Actions release dispatch
description: Reliable triggering rules for the Android release workflow.
---

Keep the Android workflow's top-level `"on"` key quoted and support both `workflow_dispatch` and the named repository-dispatch fallback. Do NOT add `workflow_call:` to this workflow file.

**Why:** Adding `workflow_call:` to `build-android.yml` poisoned GitHub's workflow-dispatch and repository-dispatch registry for that file: all subsequent dispatch attempts silently returned HTTP 204 but produced zero runs. Removing `workflow_call:` and pushing the clean file is required to restore normal dispatch behaviour, but GitHub's handler may remain silently broken for 30–60+ minutes after the corruption. During that window, dispatch events are accepted (HTTP 204) with no runs created.

**How to apply:**
1. Never add `workflow_call:` to `build-android.yml`.
2. Prefer the manual trigger. If GitHub rejects it with "Workflow does not have 'workflow_dispatch'" before any run is created, emit one `repository_dispatch` and wait up to 60 seconds.
3. If `repository_dispatch` events return HTTP 204 but produce no runs, the registry is in a silent-drop state. Wait 10–20 minutes, then try one more dispatch. In the meantime, tell the user they can trigger the build manually from the GitHub Actions UI.
4. Never retry after a release run actually exists, since that would create duplicate signed builds.

**Safe workflow triggers:** `workflow_dispatch` (with inputs) + `repository_dispatch: types: [build-android]` only. No `push:`, no `pull_request:`, no `workflow_call:`.