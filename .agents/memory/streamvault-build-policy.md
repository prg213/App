---
name: StreamVault Build Policy
description: Rules for triggering GitHub Actions APK builds for StreamVault to avoid wasting parallel build minutes.
---

## Rule
Trigger **at most one** GitHub Actions build per session. Batch every code change from the entire session into a single build trigger at the end.

**Why:** The user explicitly called this out after multiple builds were triggered in a single session (one per fix). Each build takes ~10 minutes and consumes CI minutes. Running 6 simultaneous builds wastes resources and clutters the Actions tab.

## How to apply
- Make all code changes first, run `tsc --noEmit` to verify, then trigger one build.
- If a new fix is requested mid-session after a build was already triggered, make the code changes and wait — do not trigger another build until the session is wrapping up or the user asks for one explicitly.
- If excess builds are running, cancel all but the newest using the GitHub Actions API (`POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel`).
