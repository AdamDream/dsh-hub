#!/bin/bash
# Wait for the cross-line probe lock, acquire it atomically, then IMMEDIATELY run the
# exclusive-gated CPU-profile batch while holding it. Releases the lock at the end.
set -u
L=/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock
DIR=/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/cpu-profile
DEADLINE=$(( $(date +%s) + 1500 ))     # wait at most 25 min for the lock
ACQ=0

while [ $ACQ -eq 0 ]; do
  if mkdir "$L" 2>/dev/null; then
    cat > "$L/owner.txt" <<EOF
agent: cpu-profile (subagent, workspace .workspace/lag-fix/research-v2/cpu-profile)
line: EXCLUSIVE re-run of CDP Profiler top-down attribution (coordinator-mandated exclusivity)
host_pid: 1390375
pid: $$
started_at: $(date -Is)
started_epoch: $(date +%s)
purpose: per-window gate requires foreignCount==0 && lock held by this line; census recorded at window start/end
note: every window records a browser-instance census; foreignCount>0 flags the window CONTENDED/INCONCLUSIVE
EOF
    ACQ=1; echo "[lock] ACQUIRED at $(date -Is)"
    break
  fi
  # stale recovery only if owner is >25 min old AND its pid is gone
  if [ -f "$L/owner.txt" ]; then
    SE=$(grep -m1 '^started_epoch:' "$L/owner.txt" | awk '{print $2}')
    OP=$(grep -m1 '^pid:' "$L/owner.txt" | awk '{print $2}')
    NOW=$(date +%s)
    if [ -n "$SE" ] && [ $(( NOW - SE )) -gt 1500 ]; then
      if [ -z "$OP" ] || ! kill -0 "$OP" 2>/dev/null; then
        echo "[lock] STALE (age $(( NOW - SE ))s pid=$OP gone) -> preempting $(date -Is)"
        cp "$L/owner.txt" "$DIR/raw/preempted-owner-$(date +%s).txt" 2>/dev/null
        rmdir "$L" 2>/dev/null && continue
      fi
    fi
  fi
  if [ "$(date +%s)" -gt "$DEADLINE" ]; then echo "[lock] TIMEOUT waiting for lock"; exit 3; fi
  S=$((20 + RANDOM % 21)); echo "[lock] waiting ${S}s $(date +%H:%M:%S) owner=$(head -1 $L/owner.txt 2>/dev/null)"
  sleep $S
done

cd "$DIR"
echo "[run] starting exclusive-gated batch at $(date -Is)"
node scripts/capture6.mjs --scenarios all --reps 1 --win 8000 --gatemax 120000 --stamp cpuX
RC=$?
echo "[run] batch exit=$RC at $(date -Is)"
rmdir "$L" 2>/dev/null && echo "[lock] RELEASED" || echo "[lock] release failed (already removed?)"
exit $RC
