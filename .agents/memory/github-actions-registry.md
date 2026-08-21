---
name: GitHub Actions dispatch registry
description: The repo's Actions dispatch registry is broken — workflow_dispatch returns 422 for all workflow files; build workflow is now in dispatch-probe-tmp.yml; use repository_dispatch to trigger builds.
---


## Current state (as of 2026-08-21)
- Build workflow content lives in `.github/workflows/dispatch-probe-tmp.yml` (ID 339445812).
  - Originally `build-android.yml` → renamed to `release-android.yml` (commit b850342) → merged into `dispatch-probe-tmp.yml` (commit 61ce8fa) to use the cleanest workflow ID.
- `workflow_dispatch` returns 422 "Workflow does not have 'workflow_dispatch' trigger" for ALL workflow files in the repo, including newly created ones. This is a repo-wide registry corruption.
- `repository_dispatch` with `event_type: build-android` returns 204 and triggers a build run. Use this as the interim trigger until `workflow_dispatch` recovers.
- `dispatch-build.sh` uses `repository_dispatch` and polls `dispatch-probe-tmp.yml` for new runs.

## Recovery — SOLVED
**Use a non-main branch (`apk/build`).**

Root cause (confirmed): Every push to `main` that modifies a workflow file triggers a push-event run for that file (branch protection / required workflow). These 0-job runs immediately corrupt the `workflow_dispatch` registry entry for that file. Pushing to a branch does NOT trigger this.

**Working procedure (confirmed 2026-08-21):**
1. Checkout `apk/build` branch (already exists on remote, branched from main)
2. If needed, pull latest: `git merge main`
3. Ensure `dispatch-probe-tmp.yml` uses `on:` (unquoted) and `type: string` inputs (NOT `type: choice`)
4. Push to `apk/build` (NOT main)
5. Dispatch: `curl -X POST ... /workflows/dispatch-probe-tmp.yml/dispatches -d '{"ref":"apk/build",...}'`

**Content rules for dispatch-probe-tmp.yml:**
- Use `on:` not `"on":` 
- Use `type: string` for inputs, NOT `type: choice` (choice input type breaks dispatch registration)
- Keep `repository_dispatch: types: [build-android]` — this is fine
- Never rename the file (the clean dispatch registration is tied to this filename)

**Why:** GitHub maintains an internal registry of workflow triggers that can get out of sync with the YAML when workflow files are created/deleted/modified rapidly or when incompatible triggers (workflow_call) are added. Recovery is time-based.

## MAC consequence
- Android SSAID is scoped to (package_name × signing_key) on Android 8+.
- GitHub Actions prod keystore → SSAID_prod → MAC_prod (correct).
- EAS keystore KYpC-gXKPE → SSAID_eas → MAC_eas (breaks IPTV subscription).
- Builds triggered via `dispatch-build.sh` (repository_dispatch) use the production keystore — MAC_prod preserved.
- Alternatively: use Settings → MAC Address → Restore to manually enter the old MAC.


## Registry ID history
- `build-android.yml`: ID unknown, corrupted
- `release-android.yml`: ID 339400082, corrupted (same ID reused after delete+recreate at same path)
- `dispatch-probe-tmp.yml`: ID 339445812, currently 422 but has clean history — best candidate for recovery
- `build-release.yml`: ID 339448158, corrupted (deleted from repo)
- dispatch probe insight: GitHub reuses the same workflow ID when a file is recreated at the same path — creating at a NEW path gets a new ID, but corruption is now repo-wide anyway.

## Root cause (confirmed)
1. Prior sessions added/removed `workflow_call` and push triggers rapidly, poisoning GitHub's internal dispatch registry for `build-android.yml`.
2. This session's investigation confirmed: when a workflow file is modified and committed, GitHub fires a "push" event run for it within ~90 seconds. This push run (0 jobs, failure) re-evaluates the registry entry and corrupts it for `workflow_dispatch`.
3. The corruption is repo-wide and time-based — even fresh new workflow files (never modified) eventually return 422 after the registry gets sufficiently corrupted.


## Workaround (working NOW)
Trigger builds via `repository_dispatch`:
```bash
GITHUB_REPOSITORY=prg213/App bash .github/scripts/dispatch-build.sh
```
This uses `event_type: build-android` which is handled by `dispatch-probe-tmp.yml`.


## Additional recovery notes
- GitHub's registry typically recovers on its own over hours/days with **no commits touching workflow files**.
- **Do NOT add `workflow_call` trigger** (poisons registry immediately).
- **Do NOT modify workflow files** — each commit that touches a workflow file triggers a push run that resets the recovery timer.
- Check `workflow_dispatch` recovery with:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $GITHUB_TOKEN" \
    -X POST "https://api.github.com/repos/prg213/App/actions/workflows/dispatch-probe-tmp.yml/dispatches" \
    -d '{"ref":"apk/build","inputs":{"release_action":"build-candidate"}}'
  ```
  - 204 = recovered ✓
  - 422 = still broken, wait longer
