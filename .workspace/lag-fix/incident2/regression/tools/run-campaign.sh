#!/bin/bash
# 本线 A/B 战役驱动：base×3, tp-off×3, usage-nofetch×3, theme-sync×3
# 每个窗口自带闸门（等 foreignCount==0 + 持锁），串行。
cd /home/CNS2026495165/dsh/.workspace/lag-fix/incident2/regression
SETTLE=${SETTLE:-6000}; DWELL=${DWELL:-6000}; GATE=${GATE:-180000}
for cond in base tp-off usage-nofetch theme-sync; do
  for r in 1 2 3; do
    echo "=== $(date -Iseconds) cond=$cond rep=$r ==="
    node tools/firstopen-ab.mjs --cond "$cond" --label "$cond-r$r" --settle "$SETTLE" --dwell "$DWELL" --gatemax "$GATE" 2>&1 | grep -E '^\[gate\]|^\[win|^       |^wrote'
    sleep 2
  done
done
echo "=== campaign done $(date -Iseconds) ==="
