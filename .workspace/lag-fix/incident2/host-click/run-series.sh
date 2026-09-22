#!/usr/bin/env bash
# run-series.sh — 连续 3 次「全新页面 → 点设置」，全程持有共享探针锁（持有期最短、跑完立刻释放）。
#
# 为什么在同一个持锁会话里连跑 3 次：多线实测锁竞争极紧（我 10:16:33 拿到、10:16:34 被别人覆盖），
# 每次单独排队会反复被插队；一次持锁跑完 3 次串行，既满足"独占"又不会把锁长期占死。
set -u
DIR="/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/host-click"
cd "$DIR" || exit 1
mkdir -p logs raw
N="${1:-3}"
echo "[series] start $(date '+%F %T') runs=$N" | tee logs/series.out
for i in $(seq 1 "$N"); do
  echo "[series] === run $i ===" | tee -a logs/series.out
  # 每个 run 自带取锁/释放；run 之间让出 5s，给其它线插队的机会（公平性）
  node host-click-probe.mjs --run "$i" --out "raw/click-run${i}.json" \
       --lock-timeout-s 1800 --interval-ms 50 --pre-ms 3000 --post-ms 3000 \
       >> "logs/run${i}.out" 2>&1
  rc=$?
  echo "[series] run $i exit=$rc" | tee -a logs/series.out
  sleep 5
done
echo "[series] done $(date '+%F %T')" | tee -a logs/series.out
