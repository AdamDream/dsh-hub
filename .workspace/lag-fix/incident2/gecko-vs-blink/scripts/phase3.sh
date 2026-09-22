#!/usr/bin/env bash
# phase3.sh — re-measure with the per-input-event cost metric + frame-budget
# exceedance sampling (added after phase1), plus the fixed load curve.
set -u
ROOT=/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/gecko-vs-blink
LOCK=/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock
MY_PID=$$; cd "$ROOT"
CONCURRENT_WITH="none"
if mkdir "$LOCK" 2>/dev/null; then :; else
  [ -f "$LOCK/owner.txt" ] && CONCURRENT_WITH=$(tr '\n' ' ' < "$LOCK/owner.txt" | head -c 200)
  for i in $(seq 1 9); do OP=$(grep -oE '^pid=[0-9]+' "$LOCK/owner.txt" 2>/dev/null | head -1 | tr -dc '0-9'); if [ -z "$OP" ] || ! kill -0 "$OP" 2>/dev/null; then break; fi; sleep 20; done
fi
cat > "$LOCK/owner.txt" <<EOF
agent: incident2-gecko-vs-blink (phase3: per-event cost + budget exceedance)
owner_pid: $MY_PID
pid: $MY_PID
host_pid: 301709
started_at: $(date -Iseconds)
concurrentWith: $CONCURRENT_WITH
loadavg_at_acquire: $(cat /proc/loadavg)
token: CNS202649516533-$MY_PID-gvb3
