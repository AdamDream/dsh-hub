#!/usr/bin/env bash
# run-batch.sh — 逐 cell 取锁测量；每个 cell 独立取锁，取不到就跳过（继续下一个），
#                因此一条命令总能**存下已完成的部分**，不会因某次抢锁失败而全军覆没。
#
# 用法：bash run-batch.sh <label> <lockWaitMs> <cell1> [cell2 ...]
# 说明：不重定向 stdout 到 tail（实测 tail 缓冲会在 SIGTERM 时吞掉全部输出）；
#       每个 cell 的日志由 harness 自己落盘到 logs/matrix-<label>-<cell>.log
set -u
LABEL="$1"; shift
WAIT="$1"; shift
cd "$(dirname "$0")"
for cell in "$@"; do
  echo "===== $cell ====="
  node matrix.mjs --cells "$cell" --reps 2 --label "${LABEL}-${cell}" \
       --lock-retry-min-ms 1500 --lock-retry-max-ms 3500 --lock-wait-ms "$WAIT" >/dev/null 2>&1
  rc=$?
  lg="logs/matrix-${LABEL}-${cell}.log"
  if [ -f "$lg" ]; then
    # 只打印结果行（隐藏每次抢锁的噪声）
    grep -E " r[0-9]:|acquired|NOT ACQUIRED|FATAL|INSTRUMENT|error" "$lg" | tail -6
  fi
  echo "   exit=$rc"
done
echo "===== batch done ====="
