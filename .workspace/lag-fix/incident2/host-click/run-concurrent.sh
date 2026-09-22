#!/usr/bin/env bash
# run-concurrent.sh — 协调者裁决（方案 c）规则 2 下的 3 次点击测量：
# 先原子取锁；取不到超过 180s 即并发运行，并落盘 concurrentWith / loadavg / PSI。
set -u
DIR="/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/host-click"
cd "$DIR" || exit 1
for i in "$@"; do
  echo "[conc] === run $i $(date '+%T') ===" >> logs/concurrent.out
  node host-click-probe.mjs --run "$i" --out "raw/click-run${i}.json" \
       --concurrent-after-s 180 --interval-ms 50 --pre-ms 3000 --post-ms 3000 \
       >> "logs/run${i}.out" 2>&1
  echo "[conc] run $i exit=$? $(date '+%T')" >> logs/concurrent.out
  sleep 5
done
echo "[conc] done $(date '+%T')" >> logs/concurrent.out
