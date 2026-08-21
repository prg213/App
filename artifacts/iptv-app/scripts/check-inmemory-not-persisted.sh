#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# check-inmemory-not-persisted.sh
#
# Guard: confirm that known in-memory-only state variables are never written
# to AsyncStorage anywhere in the app source.
#
# This script is a thin shell wrapper around the Python implementation
# (check-inmemory-not-persisted.py) which reliably handles multiline
# AsyncStorage calls by tracking parenthesis depth rather than relying on
# line-local grep patterns.  Both the canonical `AsyncStorage` import name
# and the dynamic-import alias `AS` (used throughout player.tsx and tab
# screens) are detected.
#
# See docs/inmemory-only-state.md for the full catalogue and rationale.
#
# Usage
# -----
#   Run locally:   bash artifacts/iptv-app/scripts/check-inmemory-not-persisted.sh
#   Run in CI:     see .github/workflows/dispatch-probe-tmp.yml
#
# Self-test mode
# --------------
#   Before scanning app source, the script verifies that the Python checker
#   correctly *detects* violations in the fixture file:
#     scripts/test-fixtures/inmemory-violation-examples.tsx
#
#   The self-test asserts all 7 category labels appear in the checker's
#   output (not just that it exits non-zero).  A missing category means that
#   entire class of violation would go undetected in production.
#
#   Only after the self-test passes does the script proceed to scan the real
#   app source for violations.
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PY="${SCRIPT_DIR}/check-inmemory-not-persisted.py"
FIXTURE_DIR="${SCRIPT_DIR}/test-fixtures"

# ---------------------------------------------------------------------------
# 1. Self-test: run the detector against the fixture directory and verify that
#    every expected category label appears in the output.
# ---------------------------------------------------------------------------
echo "=== Self-test: verifying detector catches all known violation categories ==="

# Capture the detector's output (it should exit 1 on the fixture)
FIXTURE_OUTPUT=$(python3 "${PY}" --scan-dir "${FIXTURE_DIR}" 2>&1 || true)

# The 7 forbidden-identifier categories (must match the keys in FORBIDDEN dict).
# These are verified in both Phase A (direct inline) and Phase B (pre-computed).
EXPECTED_CATEGORIES=(
  "EPG scroll offsets"
  "EPG filter state"
  "Channel menu session state"
  "OSD/player UI visibility"
  "Zap-list/channel index"
  "In-memory caches"
  "Session push-failure counter"
)

# Dynamic-key detection is a structural check (not a FORBIDDEN identifier
# match), so it only applies to Phase A (no pre-computed-variable variant).
DYNAMIC_KEY_CATEGORIES=(
  "Dynamic-key writes"
)

SELFTEST_FAILED=0

# ── Phase A: verify each category appears at all (direct-inline coverage) ──
echo "Phase A — direct-inline violations:"
for cat in "${EXPECTED_CATEGORIES[@]}"; do
  if echo "${FIXTURE_OUTPUT}" | grep -qF "[${cat}]"; then
    echo "  ✓ ${cat}"
  else
    echo "  ✗ MISSING: ${cat}"
    SELFTEST_FAILED=1
  fi
done

# ── Phase B: verify each category also detected via pre-computed tracing ──
echo ""
echo "Phase B — pre-computed variable tracing:"
for cat in "${EXPECTED_CATEGORIES[@]}"; do
  # Look for the "pre-computed variable" tag combined with the category label
  if echo "${FIXTURE_OUTPUT}" | grep -A3 "\[${cat}\]" | grep -q "pre-computed variable"; then
    echo "  ✓ ${cat}"
  else
    echo "  ✗ MISSING precomputed detection: ${cat}"
    SELFTEST_FAILED=1
  fi
done

# ── Phase C: dynamic-key detection (Phase A only — no precomputed variant) ──
echo ""
echo "Phase C — dynamic-key violation detection:"
for cat in "${DYNAMIC_KEY_CATEGORIES[@]}"; do
  if echo "${FIXTURE_OUTPUT}" | grep -qF "[${cat}]"; then
    echo "  ✓ ${cat}"
  else
    echo "  ✗ MISSING: ${cat}"
    SELFTEST_FAILED=1
  fi
done

if [[ "${SELFTEST_FAILED}" -eq 1 ]]; then
  echo ""
  echo "SELF-TEST FAILED: one or more violation categories were not detected"
  echo "  in the fixture: ${FIXTURE_DIR}"
  echo "  The detector is broken — fix check-inmemory-not-persisted.py and"
  echo "  update the fixture before trusting the guard for real source scans."
  echo ""
  echo "Full fixture scan output:"
  echo "${FIXTURE_OUTPUT}"
  exit 1
fi

# Belt-and-suspenders: detector must exit non-zero on the fixture
if python3 "${PY}" --scan-dir "${FIXTURE_DIR}" > /dev/null 2>&1; then
  echo ""
  echo "SELF-TEST FAILED: detector exited 0 (clean) on the fixture — it should"
  echo "  have reported violations and exited non-zero."
  exit 1
fi

echo ""
echo "Self-test passed — all 8 categories detected (7 forbidden-identifier"
echo "  categories in Phase A + Phase B; Dynamic-key writes in Phase C)."
echo ""

# ---------------------------------------------------------------------------
# 2. Real scan: no violations allowed in app source
# ---------------------------------------------------------------------------
echo "=== Scanning app source for in-memory-only state written to AsyncStorage ==="
python3 "${PY}"
