---
name: GitHub Actions release dispatch
description: Reliable triggering rules for the Android release workflow; failure modes and their fixes.
---

## Golden rule: trigger from the GitHub UI

When programmatic dispatch is failing, go to the workflow's Actions page in the browser and click **Run workflow**. The UI uses a web session (CSRF), not the API registry, so it bypasses every stale-registry problem described below.

**Build candidate:** https://github.com/prg213/App/actions/workflows/build-android.yml → Run workflow → branch: main → release_action: build-candidate

**Promote:** same page → release_action: promote-candidate → fill in candidate_run_id + device_validation_notes (must contain: fire, android, upgrade, launch, mp2).

---

## Known failure modes

### 1. `workflow_call:` corrupts dispatch registry
Adding `workflow_call:` to `build-android.yml` poisons GitHub's dispatch registry for that file. Both `workflow_dispatch` (422) and `repository_dispatch` (204, zero runs) silently fail. Removing `workflow_call:` is required but GitHub's handler may stay broken for 30–60+ minutes afterward. **Never add `workflow_call:` to build-android.yml.**

### 2. Multi-line `if:` using `>-` block scalar silently skips all jobs
A job `if:` written as:
```yaml
    if: >-
      condition_a ||
      condition_b
```
causes GitHub to produce a workflow run with 0 eligible jobs (immediately completes as "failure"). This is NOT a registry issue — the run IS created, but no jobs execute. **Always write `if:` as a single-line inline string.**

### 3. Push triggers on non-default branches read from the default branch
For `push: branches: [release-trigger/*]` triggers, GitHub reads the workflow file from the **default branch** (main), not the pushed branch. Fixing the workflow on the trigger branch only has no effect. Fix must go to main.

### 4. New repository_dispatch event types take 45-60+ minutes to register
A brand-new workflow file with a new `repository_dispatch` type will silently drop all dispatch events for up to an hour after the file is first pushed. Dispatching too early produces HTTP 204 but creates no runs. **Wait at least 45 minutes before dispatching a new event type.**

### 5. Modifying an existing workflow file temporarily breaks its dispatch routing
Every push to a workflow file resets its dispatch registry state. After modifying `verify-dispatch.yml`, its `verify-dispatch` events were silently dropped for ~20+ minutes.

### 6. `release-trigger/*` branch push trigger does not help when registry is broken
Even a fresh commit to a matching branch produces a run with 0 jobs if the workflow's registry or `if:` condition is broken. This is not a reliable escape hatch.

---

## Safe workflow triggers
```yaml
"on":
  workflow_dispatch:
    inputs: { ... }
  repository_dispatch:
    types: [build-android]
```
- No `push:`, no `pull_request:`, no `workflow_call:`
- Build job must have no `if:` condition (or a simple single-line inline `if:`)
- Promote job keeps its `if: github.event_name == 'workflow_dispatch' && inputs.release_action == 'promote-candidate'`

## Current workflow file state (after this session)
- `build-android.yml` on main: no `if:` on build job; `workflow_dispatch + repository_dispatch + push:release-trigger/*` triggers. Registry is stale/broken.
- `verify-dispatch.yml` on main: has a full build job that runs when `github.event.action == 'android-build-now'` or `github.event.action == 'verify-dispatch' && client_payload.run_build == true`. Registry is stale.
- `android-build-now.yml` on main: standalone build workflow, `repository_dispatch: types: [android-build-now]`. Registry not yet active (< 60 min).
- All three dispatch event types are currently silently dropped. **Use the GitHub UI.**
