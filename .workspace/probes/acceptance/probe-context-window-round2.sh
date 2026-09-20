#!/usr/bin/env bash
# 加压探测第二轮：把边界夹到"刚好 1.0M 上下"，并加一个已知成功档做对照
# （第一轮结论：833,612 token 接受；≈1.46M 被拒但文案是 get_channel_failed 而非长度错误，
#   因此需要 ① 1.0M 档 ② 已知成功档复跑，用来区分"尺寸边界"与"偶发渠道路由失败"）
set -u
PROBE_DIR=/tmp/dsh-cw-probe2
LOG=/home/CNS2026495165/dsh/.workspace/probes/acceptance/probe-context-window-round2.log
mkdir -p "$PROBE_DIR"; : > "$LOG"
log() { echo "$@" | tee -a "$LOG"; }

KEY=$(python3 -c "
import yaml
d=yaml.safe_load(open('/home/CNS2026495165/.dsh/.credentials.yaml'))
print(d['refs']['ADAM_API_KEY'])
")
[ -z "${KEY:-}" ] && { log "FATAL: 无密钥"; exit 1; }
log "密钥已读入（长度 ${#KEY}，不回显）"
URL="https://llmapi.roboscience.xyz/v1/chat/completions"

# 第一轮实测校准：target 600000 → 实际 prompt_tokens 833,612（系数 ≈1.389）
probe() { # $1 标签, $2 target, $3 预期实际 token
  local label="$1" target="$2" expect="$3"
  log ""; log "=== [$label] target=$target  预期实际≈$expect token ==="
  python3 - "$target" "$PROBE_DIR/p.$label.json" <<'PY'
import json,sys
target=int(sys.argv[1]); out=sys.argv[2]
lines=int(target/18)+10
filler="\n".join(f"Line {i:07d}: the quick brown fox jumps over the lazy dog while the calibration harness records every observation in order." for i in range(lines))
json.dump({"model":"deepseek-v4.1-flash","max_tokens":1,
           "messages":[{"role":"user","content":filler+"\n\nReply with the single character: X"}]}, open(out,"w"))
print(f"chars={len(filler)} bytes={len(filler)}")
PY
  local start; start=$(date +%s)
  local code
  code=$(curl -sS -o "$PROBE_DIR/r.$label.json" -w '%{http_code}' --max-time 600 \
      -H "authorization: Bearer $KEY" -H "content-type: application/json" \
      --data-binary @"$PROBE_DIR/p.$label.json" "$URL" 2>>"$LOG") || true
  log "HTTP=${code:-000}  用时=$(( $(date +%s) - start ))s"
  python3 - "$PROBE_DIR/r.$label.json" <<'PY' 2>&1 | tee -a "$LOG"
import json,sys
try: d=json.load(open(sys.argv[1]))
except Exception as e: print(f"(非 JSON: {e})"); raise SystemExit
if "usage" in d: print("prompt_tokens =", d["usage"].get("prompt_tokens"), " finish_reason =", (d.get("choices") or [{}])[0].get("finish_reason"))
if "error" in d: print("error =", json.dumps(d["error"],ensure_ascii=False)[:400])
PY
}

log "### 第二轮 $(date '+%F %T') ###"
probe just_under_1M 719000 "≈1.00M"
probe control_833k  600000 "≈833,612"
probe just_over_1M  760000 "≈1.06M"
log ""; log "### 结束 $(date '+%F %T') ###"
