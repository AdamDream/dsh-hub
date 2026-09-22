#!/usr/bin/env bash
# run-extra.sh — 追加确认跑（输出到 raw/click-runN.json，N 从参数起），不覆盖既有的 1/2/3
set -u
DIR="/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/host-click"
cd "$DIR" || exit 1
for i in "$@"; do
  echo "[extra] === run $i ===" >> logs/series2.out
  node host-click-probe.mjs --run "$i" --out "raw/click-run${i}.json" \
       --lock-timeout-s 1800 --interval-ms 50 --pre-ms 3000 --post-ms 3000 \
       >> "logs/run${i}.out" 2>&1
  echo "[extra] run $i exit=$?" >> logs/series2.out
  sleep 5
done
