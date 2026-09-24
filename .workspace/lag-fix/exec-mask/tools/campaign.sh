#!/usr/bin/env bash
# campaign.sh — exec-mask campaign driver.
#
# Holds the shared probe mutex ONCE for the whole campaign (the runners are run
# with PANEL_LOCK_PRECLAIMED=1 so they neither re-acquire nor release it) and
# runs every invocation strictly SEQUENTIALLY: exactly one Playwright browser is
# alive at any moment. Foreign browsers on this box (a real user Chrome and a
# snap Firefox belonging to other workstreams) are never signalled or killed.
#
# usage: bash tools/campaign.sh [stage ...]     (default: all)
set -uo pipefail

D=/home/CNS2026495165/dsh/.workspace/lag-fix/exec-mask
T="$D/tools"; L="$D/logs"
mkdir -p "$L" "$D/raw/harness" "$D/shots"
STAMP=$(date +%Y%m%dT%H%M%S)
LOG="$L/campaign-$STAMP.log"
exec > >(tee "$LOG") 2>&1

echo "=== CAMPAIGN START $(date -Is) wrapper pid=$$ ==="
echo "loadavg: $(cat /proc/loadavg)"
node "$T/lock.mjs" status

node "$T/lock.mjs" acquire 180 --owner-pid $$ || { echo "LOCK-UNAVAILABLE — refusing to force it; stopping."; exit 3; }
cleanup() { echo "--- releasing lock ---"; node "$T/lock.mjs" release --owner-pid $$; echo "=== CAMPAIGN END $(date -Is) ==="; }
trap cleanup EXIT INT TERM
export PANEL_LOCK_PRECLAIMED=1

R="node $T/panel-compare.mjs --sections nav --order A --quiet-wait-ms 0"
PATCH="$D/candidate/client.js"
STAGES="${*:-main guard bridge}"

run_stage() { local name="$1" r="$2" cmd="$3"; echo "--- stage $name rep $r : $cmd"; eval "$cmd"; local rc=$?; echo "--- stage $name rep $r rc=$rc"; return $rc; }

for ST in $STAGES; do
  case "$ST" in
    smoke)
      # (0) PRE-FLIGHT: 1440x900@2, one rep, normal -> patch. Validates the new
      # code paths (route interception, V3 self-proof, shots) cheaply. NOT part
      # of the judgement (1 rep, different label). A failed pre-flight stops the
      # campaign (rc=4) instead of spending half an hour on invalid data.
      run_stage smoke 1 "$R --run smoke --vw 1440 --vh 900 --dsf 2 --reps 1 --arms normal,patch --bundlePatch $PATCH --shots --shot-rep 1"
      echo "--- preflight gate ---"
      node "$T/preflight.mjs" --run smoke || { echo "PREFLIGHT GATE FAILED (rc=$?) — not running the judged campaign"; exit 4; }
      ;;
    main)
      # (1) MAIN JUDGEMENT: 2560x1440@2, arms normal -> patch -> normal2, 3 reps.
      # One invocation per rep (same --run label) so a failed rep cannot take the
      # whole batch with it; same-rep arm-to-arm pairing is what is judged.
      for r in 1 2 3; do
        run_stage main "$r" "$R --run mask2k --vw 2560 --vh 1440 --dsf 2 --reps 1 --arms normal,patch,normal2 --bundlePatch $PATCH --shots --shot-rep 1"
      done
      ;;
    guard)
      # (2) REGRESSION GUARDRAIL: 1440x900@2, arms normal -> patch, 3 reps.
      for r in 1 2 3; do
        run_stage guard "$r" "$R --run guard9 --vw 1440 --vh 900 --dsf 2 --reps 1 --arms normal,patch --bundlePatch $PATCH --shots --shot-rep 1"
      done
      ;;
    bridge)
      # (3) BRIDGE: the audit's own in-page A-B-A style ablation on this
      # instrument, same viewport, so "real bundle swap" and "in-page style
      # override" can be compared. No bundle patch here by design.
      run_stage bridge 1 "$R --run bridge --vw 2560 --vh 1440 --dsf 2 --reps 1 --arms normal --ablate aba"
      ;;
    *) echo "unknown stage $ST" ;;
  esac
done
echo "=== CAMPAIGN STAGES DONE $(date -Is) loadavg: $(cat /proc/loadavg) ==="
