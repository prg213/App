---
name: GitHub Actions dispatch registry
description: The repo's Actions dispatch registry is broken — workflow_dispatch returns 422 even for new files; every push triggers 0-job runs via an unknown required-workflow ruleset.
---

## Current state
- `build-android.yml` was renamed to `release-android.yml` (commit b850342).
- `workflow_dispatch` on `release-android.yml` returns 422 "Workflow does not have 'workflow_dispatch' trigger" — this is a false negative from GitHub's stale dispatch registry.
- Every push to main triggers a 0-job push run for the workflow file; the run completes as "failure" in < 1 minute. This is caused by an unknown repository ruleset (or branch protection required workflow) that fires the workflow file on every push, but since the YAML has no push trigger, 0 jobs run.
- `workflow_dispatch` was working on 2026-08-20 (run 32427431257, commit 6343b6c4). It broke some time during 2026-08-21.

## Root cause
Prior sessions added/removed `workflow_call` and a push trigger rapidly, poisoning GitHub's internal dispatch registry for `build-android.yml`. Renaming to `release-android.yml` did NOT clear the registry — GitHub may be tracking at the repo level, not the file level.

## Recovery
GitHub's registry typically recovers on its own over hours/days. No known programmatic fix. 
- Do NOT add `workflow_call` trigger.
- Do NOT add/remove triggers rapidly (each commit adds latency).
- Check registry with: `curl -s -H "Authorization: Bearer $GITHUB_TOKEN" -X POST "https://api.github.com/repos/prg213/App/actions/workflows/release-android.yml/dispatches" -d '{"ref":"main","inputs":{...}}'`

**Why:** GitHub maintains an internal registry of workflow triggers that can get out of sync with the YAML when workflow files are created/deleted/modified rapidly or when incompatible triggers (workflow_call) are added. Recovery is time-based.

## Workaround
Use EAS Build (ubuntu-24.04-jdk-17-ndk-r27b image) until GitHub Actions recovers:
`EXPO_TOKEN=$EXPO_TOKEN npx eas build --platform android --profile preview --non-interactive --no-wait`
Note: EAS uses credential set KYpC-gXKPE which is a DIFFERENT signing key from the GitHub Actions production keystore. Installing an EAS APK changes the Android SSAID and therefore the derived MAC address.

## MAC consequence
- Android SSAID is scoped to (package_name × signing_key) on Android 8+.
- GitHub Actions prod keystore → SSAID_prod → MAC_prod.
- EAS keystore KYpC-gXKPE → SSAID_eas → MAC_eas.
- To restore MAC_prod, the user must install a GitHub Actions APK (requires uninstall of EAS version first).
- Alternatively: use the Settings → MAC Address → Restore feature (added in commit b850342) to manually enter the old MAC.
