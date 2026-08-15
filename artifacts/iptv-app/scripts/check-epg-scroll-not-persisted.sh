#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# check-epg-scroll-not-persisted.sh
#
# Guard: confirm that _epgScrollX / _epgScrollY (the phone/tablet EPG scroll
# offsets in guide.tsx) are never written to AsyncStorage.
#
# These variables are intentionally JS-module-level (in-memory only).  A
# cold-start always resets them to 0 because the JS runtime restarts from
# scratch.  If they were ever persisted to AsyncStorage the guide could open
# at a stale scroll position after a force-quit / relaunch.
#
# How it works:
#   1. Search every TypeScript/JavaScript source file for any AsyncStorage
#      call that references an EPG-scroll key by name or value.
#   2. Fail with a descriptive error if a match is found.
#
# Run locally:   bash scripts/check-epg-scroll-not-persisted.sh
# Run in CI:     add a step that calls this script; it exits non-zero on
#                failure so the workflow is marked as failed.
# ---------------------------------------------------------------------------

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Checking that _epgScrollX / _epgScrollY are not persisted to AsyncStorage…"

# Pattern: AsyncStorage API calls (setItem, mergeItem, multiSet, multiMerge)
# combined with any reference to the scroll variable names or plausible storage
# keys.  We search all .ts/.tsx/.js/.jsx files under the app directory.
MATCHES=$(grep -rn \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
  -E "AsyncStorage\.(setItem|mergeItem|multiSet|multiMerge)[^;]*(epgScroll|_epgScrollX|_epgScrollY|epg_scroll|epgScrollX|epgScrollY)" \
  "${ROOT}/app" "${ROOT}/context" "${ROOT}/hooks" "${ROOT}/services" 2>/dev/null || true)

if [[ -n "$MATCHES" ]]; then
  echo ""
  echo "ERROR: EPG scroll offsets appear to be written to AsyncStorage."
  echo "       _epgScrollX / _epgScrollY must remain in-memory-only so that a"
  echo "       cold-start (force-quit + relaunch) always resets them to 0."
  echo ""
  echo "Offending line(s):"
  echo "$MATCHES"
  echo ""
  exit 1
fi

echo "OK — no EPG scroll values are persisted to AsyncStorage."
exit 0
