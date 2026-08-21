#!/usr/bin/env bash
# verify-dispatch.sh — confirm GitHub's repository_dispatch registry is live
# before triggering a full 30-minute Android build.
#
# Usage:
#   GITHUB_TOKEN=<pat> GITHUB_REPOSITORY=owner/repo bash .github/scripts/verify-dispatch.sh
#
# Or with the gh CLI already authenticated:
#   GITHUB_REPOSITORY=owner/repo bash .github/scripts/verify-dispatch.sh
#
# The script fires a lightweight `verify-dispatch` event (handled by
# .github/workflows/verify-dispatch.yml) and polls for a new run for up to 30 s.
# Exit 0 = dispatch is working.  Exit 1 = silent-drop state detected.

set -euo pipefail

REPO="${GITHUB_REPOSITORY:?Set GITHUB_REPOSITORY to owner/repo}"
TOKEN="${GITHUB_TOKEN:-$(gh auth token 2>/dev/null || true)}"
if [[ -z "$TOKEN" ]]; then
  echo "ERROR: set GITHUB_TOKEN or authenticate with 'gh auth login'" >&2
  exit 1
fi

WORKFLOW="verify-dispatch.yml"
TIMEOUT=30
POLL_INTERVAL=3

auth_header() { printf 'Authorization: Bearer %s' "$TOKEN"; }

# Capture the timestamp just before firing so we only look at new runs.
BEFORE_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "Firing repository_dispatch (types: verify-dispatch) against $REPO …"
HTTP_STATUS="$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST \
  -H "$(auth_header)" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/${REPO}/dispatches" \
  -d "{\"event_type\":\"verify-dispatch\",\"client_payload\":{\"triggered_by\":\"verify-dispatch.sh\"}}")"

if [[ "$HTTP_STATUS" != "204" ]]; then
  echo "ERROR: dispatch returned HTTP $HTTP_STATUS (expected 204)." >&2
  exit 1
fi
echo "Dispatch accepted (HTTP 204).  Polling for a new run (timeout ${TIMEOUT}s) …"

DEADLINE=$(( $(date +%s) + TIMEOUT ))
RUN_ID=""

while [[ $(date +%s) -lt $DEADLINE ]]; do
  RUNS_JSON="$(curl -s \
    -H "$(auth_header)" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?event=repository_dispatch&per_page=5")"

  # Find the first run created at or after BEFORE_ISO.
  RUN_ID="$(printf '%s\n' "$RUNS_JSON" | \
    python3 -c "
import sys, json, datetime
data = json.load(sys.stdin)
cutoff = datetime.datetime.fromisoformat('${BEFORE_ISO}'.replace('Z','+00:00'))
for r in data.get('workflow_runs', []):
    created = datetime.datetime.fromisoformat(r['created_at'].replace('Z','+00:00'))
    if created >= cutoff:
        print(r['id'])
        break
" 2>/dev/null || true)"

  if [[ -n "$RUN_ID" ]]; then
    break
  fi

  sleep "$POLL_INTERVAL"
done

if [[ -z "$RUN_ID" ]]; then
  echo "FAIL: no new run appeared within ${TIMEOUT}s." >&2
  echo "" >&2
  echo "GitHub's dispatch registry is in a silent-drop state." >&2
  echo "This can happen after rapid workflow file changes (especially adding/removing" >&2
  echo "workflow_call: from build-android.yml).  Wait 10–20 minutes and retry." >&2
  echo "You can also trigger the build manually from the GitHub Actions UI in the" >&2
  echo "meantime." >&2
  exit 1
fi

echo "OK: new run created — run_id=${RUN_ID}"
echo "View at: https://github.com/${REPO}/actions/runs/${RUN_ID}"
echo ""
echo "GitHub's dispatch registry is live.  Safe to fire a 'build-android' event."
exit 0
