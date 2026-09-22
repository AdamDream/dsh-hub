#!/bin/bash
# 面2（P2AC）A/B 驱动 — 使用**冻结**器械快照，避免共享 tools/firstopen-ab.mjs 被并行编辑造成漂移。
#   instrument: tools/frozen-20260922T1023/{firstopen-ab.mjs,stubs.js}
#   输出: raw/firstopen-p2ac-<cond>-r<k>.json
# 纪律: 单浏览器、窗口串行、每窗口自带闸门（--gatemax 180000）、crash 后换 label 重试（不覆盖已成功产物）。
set -u
cd /home/CNS2026495165/dsh/.workspace/lag-fix/incident2/regression || exit 1
TOOL=tools/frozen-20260922T1023/firstopen-ab.mjs
LOG=logs/p2ac-face-run.log
mkdir -p raw logs
: >> "$LOG"

run_until_ok() {   # $1=cond  $2=final_label
  local cond="$1" label="$2"
  for attempt in 1 2 3; do
    local use="$label"
    [ "$attempt" -gt 1 ] && use="${label}-try${attempt}"
    echo "=== $(date -Is) START cond=$cond label=$use attempt=$attempt ===" | tee -a "$LOG"
    node "$TOOL" --cond "$cond" --label "$use" --settle 6000 --dwell 6000 --gatemax 180000 >>"$LOG" 2>&1
    local rc=$?
    if [ "$rc" -eq 0 ]; then
      echo "=== $(date -Is) OK   cond=$cond label=$use ===" | tee -a "$LOG"
      return 0
    fi
    echo "=== $(date -Is) FAIL cond=$cond label=$use exit=$rc (retrying) ===" | tee -a "$LOG"
    sleep 5
  done
  echo "=== $(date -Is) GIVEUP cond=$cond label=$label ===" | tee -a "$LOG"
  return 1
}

for k in 1 2 3; do
  run_until_ok base     "p2ac-base-r$k"
  run_until_ok p2ac-old "p2ac-old-r$k"
done
echo "ALL P2AC WINDOWS DONE $(date -Is)"
ls -la raw/firstopen-p2ac-*.json
