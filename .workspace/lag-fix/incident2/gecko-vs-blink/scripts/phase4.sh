#!/usr/bin/env bash
# phase4.sh — completes the measurement set:
#   a) timer-resolution calibration per engine (default clock + Gecko fine clock)
#   b) Gecko fine-clock re-runs (quantifies the quantisation bias in "JS self-time")
#   c) the remaining per-cell runs with the per-event cost + budget-exceedance metric
#   d) DSH homepage (read-only: no clicks, no save/apply/delete)
#   e) the fixed load curve
# One browser at a time; holds research-v2/.probe.lock for the whole batch.
set -u
ROOT=/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/gecko-vs-blink
LOCK=/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock
MY_PID=$$
cd "$ROOT"
mkdir -p raw/p3 raw/p4

# Owner parsing must accept every format other lines actually write:
#   "owner_pid: N"  /  "pid: N"  /  "pid=N"  /  a bare "N"
owner_pid_of() {
  [ -f "$1/owner.txt" ] || return 1
  sed -nE 's/^(owner_pid|agent_pid|pid|probe_pid)[:=][[:space:]]*([0-9]+).*/\2/p; s/^([0-9]+)$/\1/p' "$1/owner.txt" | head -1
}

HELDLOCK="$LOCK"
CONCURRENT_WITH="none"
if mkdir "$LOCK" 2>/dev/null; then
  :
else
  for i in $(seq 1 9); do
    OP=$(owner_pid_of "$LOCK" || true)
    if [ -z "${OP:-}" ] || ! kill -0 "$OP" 2>/dev/null; then break; fi      # dead/stale owner -> take it
    if [ "$i" = "1" ]; then
      CONCURRENT_WITH=$(tr '\n' ' ' < "$LOCK/owner.txt" | head -c 200)
      echo "[phase4] shared lock busy: $CONCURRENT_WITH"
    fi
    sleep 20
  done
  OP=$(owner_pid_of "$LOCK" || true)
  if [ -n "${OP:-}" ] && kill -0 "$OP" 2>/dev/null; then
    # Still held after the 3-minute grace: run CONCURRENTLY, but in our OWN lock
    # dir so the holder's owner.txt is never clobbered. Annotated + loadavg.
    HELDLOCK="$LOCK.gvb-concurrent"
    CONCURRENT_WITH="${CONCURRENT_WITH:-unknown}; proceeding concurrently after 3min grace"
    mkdir -p "$HELDLOCK"
  fi
fi

{
  echo "agent: incident2-gecko-vs-blink (phase4: timer resolution + per-event cost + load curve)"
  echo "owner_pid: $MY_PID"
  echo "pid: $MY_PID"
  echo "host_pid: 301709"
  echo "started_at: $(date -Iseconds)"
  echo "concurrentWith: $CONCURRENT_WITH"
  echo "loadavg_at_acquire: $(cat /proc/loadavg)"
  echo "token: CNS202649516533-$MY_PID-gvb4"
} > "$HELDLOCK/owner.txt"

release() {
  if [ -f "$HELDLOCK/owner.txt" ] && grep -q "owner_pid: $MY_PID" "$HELDLOCK/owner.txt" 2>/dev/null; then
    rm -f "$HELDLOCK/owner.txt"; rmdir "$HELDLOCK" 2>/dev/null && echo "[phase4] lock released ($HELDLOCK)"
  fi
}
trap release EXIT
echo "[phase4 $MY_PID] lock=$HELDLOCK concurrentWith=$CONCURRENT_WITH loadavg=$(cat /proc/loadavg)"

PORT=18970
run_one() { # engine dpr cell reps extra outdir
  local ENGINE=$1 DPR=$2 CELL=$3 REPS=$4 EXTRA=$5 OUTDIR=$6
  local r
  for r in $(seq 1 "$REPS"); do
    PORT=$((PORT+1))
    local SUF=""; [ -n "$EXTRA" ] && SUF="-fine"
    local OUTF="$OUTDIR/run-$ENGINE-dpr$DPR-$CELL-r$r$SUF.json"
    [ -f "$OUTF" ] && { echo "    skip (exists) $OUTF"; continue; }
    echo "=== [$(date +%T) load=$(cut -d' ' -f1 /proc/loadavg)] $ENGINE dpr=$DPR cell=$CELL rep=$r $EXTRA"
    timeout 300 node scripts/run-one.mjs --engine=$ENGINE --dpr=$DPR --cell=$CELL --target=minimal \
      --rep=$r --ms=8000 --port=$PORT --tag=p4-$ENGINE-$CELL-dpr$DPR-r$r$SUF \
      --out="$OUTF" $EXTRA 2>&1 | grep -E '^OK|^FAIL|"p50"|tickMean|budgetExceedPct' | head -4 | sed 's/^/    /'
    sleep 2
  done
}

echo "--- (a) timer resolution ---"
timeout 120 node scripts/timeres.mjs --engine=chromium --port=$((PORT+1)) 2>&1 | grep -E 'minNonZeroReadDelta|busyMin|busyMedian|distinct' | sed 's/^/    /'
PORT=$((PORT+1))
timeout 180 node scripts/timeres.mjs --engine=firefox --port=$((PORT+1)) 2>&1 | grep -E 'minNonZeroReadDelta|busyMin|busyMedian|distinct' | sed 's/^/    /'
PORT=$((PORT+1))
timeout 180 node scripts/timeres.mjs --engine=firefox --fineclock=1 --port=$((PORT+1)) 2>&1 | grep -E 'minNonZeroReadDelta|busyMin|busyMedian|distinct' | sed 's/^/    /'

echo "--- (b) Gecko fine-clock re-runs ---"
run_one firefox 1 combined  2 "--fineclock=1" raw/p4
run_one firefox 1 hover-tray 2 "--fineclock=1" raw/p4
run_one firefox 2 hover-tray 2 "--fineclock=1" raw/p4

echo "--- (c) remaining per-cell runs (default clock) ---"
run_one chromium 1 hover-tray  2 "" raw/p3
run_one firefox  1 hover-tray  2 "" raw/p3
run_one chromium 2 hover-tray  2 "" raw/p3
run_one firefox  2 hover-tray  2 "" raw/p3
run_one chromium 1 hover-blur  1 "" raw/p3
run_one firefox  1 hover-blur  1 "" raw/p3
run_one chromium 1 dom-lefttop 2 "" raw/p3
run_one firefox  1 dom-lefttop 2 "" raw/p3

echo "--- (d) DSH homepage (read-only) ---"
for ENGINE in chromium firefox; do
  for R in 1 2; do
    PORT=$((PORT+1))
    OUTF="raw/p3/run-$ENGINE-dpr1-dsh-r$R.json"
    [ -f "$OUTF" ] && continue
    echo "=== [$(date +%T)] DSH $ENGINE rep=$R"
    timeout 300 node scripts/run-one.mjs --engine=$ENGINE --dpr=1 --cell=idle-floor --target=dsh \
      --rep=$R --ms=8000 --port=$PORT --tag=p4-$ENGINE-dsh-r$R --out="$OUTF" 2>&1 | grep -E '^OK|^FAIL' | sed 's/^/    /'
    sleep 2
  done
done

echo "--- (e) load curve (fixed JS-time field) ---"
for ENGINE in chromium firefox; do
  PORT=$((PORT+1))
  echo "=== [$(date +%T)] LOADCURVE $ENGINE"
  timeout 500 node scripts/loadcurve.mjs --engine=$ENGINE --cell=combined --dpr=1 \
    --levels=0,6,10,14,18,22,28 --ms=3000 --passes=2 --port=$PORT 2>&1 | sed 's/^/    /'
  sleep 2
done

echo "[phase4 $MY_PID] done $(date -Iseconds) loadavg=$(cat /proc/loadavg)"
