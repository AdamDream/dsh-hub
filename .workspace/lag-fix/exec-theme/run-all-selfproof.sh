#!/usr/bin/env bash
# run-all-selfproof.sh — run every static/offline self-proof of the theme batch and write the
# raw logs under raw/. READ-ONLY with respect to the deployed tree: nothing here writes to
# ~/.dsh or ~/.npm-global (apply-Theme-v1.mjs runs in DRY-RUN mode).
#
# Usage: bash run-all-selfproof.sh
# Exit: 0 if every step exited 0.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
LOG="$HERE/raw/SELFPROOF-LOG.txt"
: > "$LOG"
RC=0
step() {
  local name="$1"; shift
  echo "" | tee -a "$LOG"
  echo "############################################################" | tee -a "$LOG"
  echo "## $name" | tee -a "$LOG"
  echo "## \$ $*" | tee -a "$LOG"
  echo "############################################################" | tee -a "$LOG"
  "$@" 2>&1 | tee -a "$LOG"
  local rc=${PIPESTATUS[0]}
  echo "## EXIT=$rc" | tee -a "$LOG"
  [ "$rc" -eq 0 ] || RC=1
}

step "1. anchor uniqueness + candidate generation (default scope)" \
  node gen-candidates.mjs
step "2. anchor uniqueness + candidate generation (all units, opt-in)" \
  node gen-candidates.mjs --scope instances,signature,themeColor,overlay,wallpaperShade --target candidates/optin
step "3. candidate syntax" \
  bash -c 'for f in candidates/*.js candidates/optin/*.js; do printf "%-40s " "$f"; node --check "$f" && echo OK; done'
step "4. apply dry-run (default scope) — anchors, pre-image identity, node --check, declared identifiers" \
  node apply-Theme-v1.mjs
step "5. apply dry-run (all units)" \
  node apply-Theme-v1.mjs --scope instances,signature,themeColor,overlay,wallpaperShade --candidates candidates/optin
step "6. verifier + mutation counter-tests (default scope; ui-theme mutation is out of scope here)" \
  node proof/verify-candidates.mjs --allow-unavailable-mutations
step "7. verifier + mutation counter-tests (all units)" \
  node proof/verify-candidates.mjs --candidates candidates/optin
step "8. offline equivalence of the patched apply (stub DOM)" \
  node proof/stub-apply.mjs
step "9. probe CAPTURE self-validation (the rework's requirement: a dead detector must be detectable)" \
  node proof/probe-capture-selftest.mjs
step "10. experiment-harness logic self-test (primary criteria can PASS and can FAIL; reference items stay advisory)" \
  node proof/check-experiment-logic.mjs

echo "" | tee -a "$LOG"
echo "=== SELFPROOF ${RC:0} ===" | tee -a "$LOG"
echo "SELFPROOF $([ $RC -eq 0 ] && echo PASS || echo FAIL)  (full log: raw/SELFPROOF-LOG.txt)"
exit $RC
