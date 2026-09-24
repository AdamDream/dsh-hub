#!/usr/bin/env bash
# blur-inventory.sh — hold the shared probe mutex for ONE short provenance run,
# then release it. Same protocol as tools/campaign.sh: acquire once with
# lock.mjs (owner = this shell's own live pid), export PANEL_LOCK_PRECLAIMED=1
# so the runner never re-acquires or releases a lock it does not own, and
# release only if owner.txt's own "pid:" line is ours.
set -uo pipefail
D=/home/CNS2026495165/dsh/.workspace/lag-fix/exec-mask
T="$D/tools"; L="$D/logs"
mkdir -p "$L" "$D/raw/harness"
STAMP=$(date +%Y%m%dT%H%M%S)
LOG="$L/blur-inventory-$STAMP.log"
exec > >(tee "$LOG") 2>&1
echo "=== BLUR INVENTORY START $(date -Is) wrapper pid=$$ ==="
echo "loadavg: $(cat /proc/loadavg)"
node "$T/lock.mjs" status
node "$T/lock.mjs" acquire 180 --owner-pid $$ || { echo "LOCK-UNAVAILABLE — refusing to force it; stopping."; exit 3; }
cleanup() { echo "--- releasing lock ---"; node "$T/lock.mjs" release --owner-pid $$; echo "=== BLUR INVENTORY END $(date -Is) ==="; }
trap cleanup EXIT INT TERM
export PANEL_LOCK_PRECLAIMED=1
node "$T/blur-inventory.mjs" \
  --bundlePatch "$D/candidate/client.js" \
  --arms normal,patch \
  --vw 2560 --vh 1440 --dsf 2 \
  --run blurinv
rc=$?
echo "--- blur-inventory rc=$rc"
exit $rc
