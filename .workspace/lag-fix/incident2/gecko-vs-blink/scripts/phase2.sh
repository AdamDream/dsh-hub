#!/usr/bin/env bash
# phase2.sh — remaining measurements: the 4 DSH-homepage runs (re-run after the
# harness bugfix) + the per-frame load curve on both engines.
# Same discipline: one browser at a time, shared lock held for the batch.
set -u
ROOT=/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/gecko-vs-blink
LOCK=/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock
MY_PID=$$
cd "$ROOT"

CONCURRENT_WITH="none"
if mkdir "$LOCK" 2>/dev/null; then :; else
  [ -f "$LOCK/owner.txt" ] && CONCURRENT_WITH=$(tr '\n' ' ' < "$LOCK/owner.txt" | head -c 200)
  for i in $(seq 1 9); do
    OP=$(grep -oE '^pid=[0-9]+' "$LOCK/owner.txt" 2>/dev/null | head -1 | tr -dc '0-9')
    if [ -z "$OP" ] || ! kill -0 "$OP" 2>/dev/null; then break; fi
    sleep 20
  done
fi
cat > "$LOCK/owner.txt" <<EOF
agent: incident2-gecko-vs-blink (phase2: DSH re-run + load curve)
line: engine=chromium+firefox dsh-rerun loadcurve
purpose: same page/anim measured on both engines; frame-delivery-vs-load curve
owner_pid: $MY_PID
pid: $MY_PID
host_pid: 301709
started_at: $(date -Iseconds)
started_epoch: $(date +%s)
concurrentWith: $CONCURRENT_WITH
loadavg_at_acquire: $(cat /proc/loadavg)
token: CNS202649516533-$MY_PID-gvb2
note: single browser at a time; release = rm owner.txt && rmdir
EOF
release() {
  if [ -f "$LOCK/owner.txt" ] && grep -q "owner_pid: $MY_PID" "$LOCK/owner.txt" 2>/dev/null; then
    rm -f "$LOCK/owner.txt"; rmdir "$LOCK" 2>/dev/null && echo "[phase2 $MY_PID] lock released"
  fi
}
trap release EXIT
echo "[phase2 $MY_PID] holding lock; concurrentWith=$CONCURRENT_WITH"

PORT=18900
# 1) DSH homepage, both engines, 2 reps each (read-only: no clicks, no save/apply/delete)
for ENGINE in chromium firefox; do
  for R in 1 2; do
    PORT=$((PORT+1))
    echo "=== [$(date +%T)] DSH $ENGINE rep=$R"
    timeout 300 node scripts/run-one.mjs --engine=$ENGINE --dpr=1 --cell=idle-floor --target=dsh \
      --rep=$R --ms=8000 --port=$PORT --tag=gvb-$ENGINE-dsh-r$R --out=raw/run-$ENGINE-dpr1-dsh-r$R.json 2>&1 | sed 's/^/    /'
    sleep 2
  done
done

# 2) per-frame load curve (rAF-locked busy work), identical code both engines
for ENGINE in chromium firefox; do
  PORT=$((PORT+1))
  echo "=== [$(date +%T)] LOADCURVE $ENGINE port=$PORT"
  timeout 400 node scripts/loadcurve.mjs --engine=$ENGINE --cell=combined --dpr=1 \
    --levels=0,4,8,12,16,20,28 --ms=3000 --passes=2 --port=$PORT 2>&1 | sed 's/^/    /'
  sleep 2
done

echo "[phase2 $MY_PID] done at $(date -Iseconds) loadavg=$(cat /proc/loadavg)"
