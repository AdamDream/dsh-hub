#!/bin/bash
# 面2（P2AC）A/B 驱动 — 使用**冻结**器械快照运行全部窗口，避免共享 tools/firstopen-ab.mjs
# 在本面开跑期间被并行编辑（v1→v2→v3…）造成两条件器械不一致。
#   instrument : tools/frozen-20260922T1023/{firstopen-ab.mjs,stubs.js,run-frozen.mjs}
#   raw 落盘   : raw/firstopen-p2ac-base-r{1,2,3}.json / raw/firstopen-p2ac-old-r{1,2,3}.json
# 纪律：单浏览器、窗口串行、每窗口自带闸门（--gatemax 180000）、失败换 label 重试（不覆盖已成功产物）。
set -u
cd /home/CNS2026495165/dsh/.workspace/lag-fix/incident2/regression || exit 1
FRZ=tools/frozen-20260922T1023
TOOL=$FRZ/run-frozen.mjs
SHIMRAW=$FRZ/shim/raw
LOG=logs/p2ac-face-run.log
mkdir -p raw logs "$SHIMRAW"
: >> "$LOG"

run_until_ok() {   # $1=cond(base|p2ac-old)  $2=标签前缀 p2ac-base|p2ac-old  $3=重复号
  local cond="$1" prefix="$2" k="$3"
  local label="$prefix-r$k"
  local attempt use src dst rc
  for attempt in 1 2 3; do
    use="$label"; [ "$attempt" -gt 1 ] && use="${label}-try${attempt}"
    echo "=== $(date -Is) START cond=$cond label=$use attempt=$attempt ===" | tee -a "$LOG"
    node "$TOOL" --cond "$cond" --label "$use" --settle 6000 --dwell 6000 --gatemax 180000 >>"$LOG" 2>&1
    rc=$?
    src="$SHIMRAW/firstopen-$use.json"
    if [ "$rc" -eq 0 ] && [ -f "$src" ]; then
      if [ "$use" = "$label" ]; then
        dst="raw/firstopen-$label.json"
      else
        dst="raw/firstopen-$label-retry$attempt.json"
      fi
      mv -f "$src" "$dst"
      echo "=== $(date -Is) OK   cond=$cond label=$use -> $dst ===" | tee -a "$LOG"
      return 0
    fi
    [ -f "$src" ] && mv -f "$src" "raw/firstopen-superseded-$use.json"
    echo "=== $(date -Is) FAIL cond=$cond label=$use exit=$rc (retrying) ===" | tee -a "$LOG"
    sleep 5
  done
  echo "=== $(date -Is) GIVEUP cond=$cond label=$label ===" | tee -a "$LOG"
  return 1
}

for k in 1 2 3; do
  run_until_ok base     p2ac-base "$k"
  run_until_ok p2ac-old p2ac-old "$k"
done
echo "ALL P2AC WINDOWS DONE $(date -Is)"
ls -la raw/firstopen-p2ac-*.json 2>&1
