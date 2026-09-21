#!/bin/bash
# Census the machine during the locked window: foreign browser instances, load, and any
# unrelated node processes that would pollute a CPU profile.
OUT=/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/cpu-profile/raw/census.log
L=/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock
echo "=== census start $(date -Is) ===" >> "$OUT"
while :; do
  LOCK=$([ -d "$L" ] && echo HELD || echo RELEASED)
  HB=$(pgrep -fc "headless_shell --disable-field-trial-config" 2>/dev/null || echo 0)
  CH=$(pgrep -fc "chrome-linux/chrome" 2>/dev/null || echo 0)
  PL=$(pgrep -fc "playwright" 2>/dev/null || echo 0)
  NODE=$(pgrep -fc "node " 2>/dev/null || echo 0)
  LOAD=$(cut -d' ' -f1-3 /proc/loadavg)
  CPU=$(awk '/^cpu /{u=$2+$4; t=$2+$3+$4+$5+$6+$7+$8; printf "%.1f", (t>0? 100*u/t : 0)}' /proc/stat)
  echo "$(date -Is) lock=$LOCK headless_shell=$HB chrome=$CH playwright_procs=$PL node=$NODE cpu_busy=$CPU% load=$LOAD" >> "$OUT"
  sleep 15
done
