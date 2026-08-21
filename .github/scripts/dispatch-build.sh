#!/usr/bin/env bash
# dispatch-build.sh — fire a build-android repository_dispatch and confirm
# that GitHub actually created a new workflow run within 90 seconds.
#
# Usage:
#   GITHUB_TOKEN=<pat> GITHUB_REPOSITORY=owner/repo bash .github/scripts/dispatch-build.sh
#
# Or with the gh CLI already authenticated:
#   GITHUB_REPOSITORY=owner/repo bash .github/scripts/dispatch-build.sh
#
# GitHub's workflow_dispatch / repository_dispatch registry can silently
# accept a dispatch event (HTTP 204) without ever creating a run.  This is
# most likely to happen after rapid workflow file changes — especially adding
# or removing workflow_call: from build-android.yml.  This script detects the
# silent-drop state and tells you to trigger manually instead of leaving you
# waiting for a build that will never start.
#
# The script never re-dispatches automatically.  Firing a second event before
# you know the first was dropped risks creating duplicate signed release builds.
#
# Exit codes:
#   0 — dispatch succeeded; a new run was confirmed.
#   1 — silent-drop detected, or an error occurred.  See output for details.

set -euo pipefail

REPO="${GITHUB_REPOSITORY:?Set GITHUB_REPOSITORY to owner/repo}"
TOKEN="${GITHUB_TOKEN:-$(gh auth token 2>/dev/null || true)}"
if [[ -z "$TOKEN" ]]; then
  echo "ERROR: set GITHUB_TOKEN or authenticate with 'gh auth login'" >&2
  exit 1
fi

WORKFLOW="build-android.yml"
TIMEOUT=90
POLL_INTERVAL=5
ACTIONS_URL="https://github.com/${REPO}/actions/workflows/${WORKFLOW}"

auth_header() { printf 'Authorization: Bearer %s' "$TOKEN"; }

# Capture the timestamp just before firing so we only look at new runs.
BEFORE_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "Firing repository_dispatch (types: build-android) against ${REPO} …"
HTTP_STATUS="$(curl -s -o /dev/null -w '%{http_code}' \
  -X POST \
  -H "$(auth_header)" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/${REPO}/dispatches" \
  -d '{"event_type":"build-android","client_payload":{"triggered_by":"dispatch-build.sh"}}')"

if [[ "$HTTP_STATUS" != "204" ]]; then
  echo "ERROR: dispatch returned HTTP ${HTTP_STATUS} (expected 204)." >&2
  echo "The request was rejected outright.  Check your GITHUB_TOKEN permissions" >&2
  echo "and confirm the repository name is correct." >&2
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
  echo "" >&2
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
  echo "DISPATCH DROPPED — no new run appeared within ${TIMEOUT}s." >&2
  echo "" >&2
  echo "GitHub silently accepted the event (HTTP 204) but never created" >&2
  echo "a workflow run.  This is a known GitHub registry issue that can" >&2
  echo "occur after rapid changes to build-android.yml (especially adding" >&2
  echo "or removing workflow_call:).  The registry usually recovers within" >&2
  echo "10–20 minutes." >&2
  echo "" >&2
  echo "DO NOT re-run this script immediately — a duplicate dispatch" >&2
  echo "before the registry clears could create two signed release builds." >&2
  echo "" >&2
  echo "Action required: trigger the build manually from the GitHub UI:" >&2
  echo "  ${ACTIONS_URL}" >&2
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >&2
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "OK: new build run confirmed — run_id=${RUN_ID}"
echo "View at: https://github.com/${REPO}/actions/runs/${RUN_ID}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
