#!/usr/bin/env bash
# 受控加压探测：adam / deepseek-v4.1-flash 的真实上下文窗口
#
# 背景（已确证）：settings.yaml 未声明 contextWindow → 回落 262144
#   → pi-ai 客户端预估把 50 万 token 的正常轮次误判为 CONTEXT_WINDOW_EXCEEDED。
# 已知下界：真实窗口 ≥ 504,264 token（会话 6b9b6c3f 的 504,264 请求成功返回 stopReason:"stop"）。
#
# 本探测只做「加压」：逐档放大 input token，观察网关是接受还是以何种文案拒绝。
# 关键设计：
#   - max_tokens=1：把输出成本压到最小，只买 input 侧信息
#   - 每档独立请求，档间递进；一旦被拒，拒绝文案通常直接写明真实上限
#   - 密钥运行时从 ~/.dsh/.credentials.yaml 读入变量，不落盘、不回显
#   - 载荷写 /tmp（不进仓库），只把响应摘要落到工作区报告
set -u
PROBE_DIR=/tmp/dsh-cw-probe
LOG=/home/CNS2026495165/dsh/.workspace/acceptance-probe/probe-context-window.log
mkdir -p "$PROBE_DIR"
: > "$LOG"

log() { echo "$@" | tee -a "$LOG"; }

# --- 取密钥（不回显） ---
KEY=$(python3 -c "
import yaml
d=yaml.safe_load(open('/home/CNS2026495165/.dsh/.credentials.yaml'))
print(d['refs']['ADAM_API_KEY'])
")
if [ -z "${KEY:-}" ]; then log "FATAL: 未能取得 ADAM_API_KEY"; exit 1; fi
log "密钥已从凭据库读入（长度 ${#KEY}，内容不回显）"

URL="https://llmapi.roboscience.xyz/v1/chat/completions"

build_payload() { # $1 = 目标 token 数（按 ~18 token/行估算）
  local tokens="$1"
  python3 - "$tokens" "$PROBE_DIR/payload.json" <<'PY'
import json,sys
target=int(sys.argv[1]); out=sys.argv[2]
# 每行约 76 字符 ≈ 18 token（英文）；取偏保守的 token/字符比以略微超发
lines_needed=int(target/18)+10
parts=[]
for i in range(lines_needed):
    parts.append(f"Line {i:07d}: the quick brown fox jumps over the lazy dog while the calibration harness records every observation in order.")
filler="\n".join(parts)
body={"model":"deepseek-v4.1-flash","max_tokens":1,
      "messages":[{"role":"user","content":filler+"\n\nReply with the single character: X"}]}
open(out,"w").write(json.dumps(body))
print(f"chars={len(filler)} approx_tokens={len(filler)//4} target={target}")
PY
}

probe() { # $1 = 标签, $2 = 目标 token
  local label="$1" tokens="$2"
  log ""
  log "=== [$label] 目标 input ≈ ${tokens} token ==="
  build_payload "$tokens" | tee -a "$LOG"
  local bytes; bytes=$(stat -c %s "$PROBE_DIR/payload.json")
  log "载荷字节 = $bytes"
  local start; start=$(date +%s)
  local code body
  body=$(curl -sS -o "$PROBE_DIR/resp.$label.json" -w '%{http_code}' \
      --max-time 600 \
      -H "authorization: Bearer $KEY" \
      -H "content-type: application/json" \
      --data-binary @"$PROBE_DIR/payload.json" \
      "$URL" 2>>"$LOG") || true
  code="${body:-000}"
  local elapsed=$(( $(date +%s) - start ))
  log "HTTP=$code  用时=${elapsed}s"
  log "--- 响应体（前 1200 字符） ---"
  head -c 1200 "$PROBE_DIR/resp.$label.json" 2>/dev/null | tee -a "$LOG"
  log ""
  log "--- usage 字段（若有） ---"
  python3 - "$PROBE_DIR/resp.$label.json" <<'PY' 2>&1 | tee -a "$LOG"
import json,sys
try:
    d=json.load(open(sys.argv[1]))
except Exception as e:
    print(f"(响应非 JSON: {e})"); raise SystemExit
if "usage" in d: print("usage =", json.dumps(d["usage"]))
if "error" in d: print("error =", json.dumps(d["error"],ensure_ascii=False)[:800])
print("choices[0].finish_reason =", (d.get("choices") or [{}])[0].get("finish_reason"))
PY
}

log "### 受控加压探测开始 $(date '+%F %T') ###"
log "URL=$URL  model=deepseek-v4.1-flash  max_tokens=1"
log "已知下界：504,264 token 曾成功（会话 6b9b6c3f）"

probe baseline 20000
probe d1_600k 600000
probe d2_1050k 1050000
probe d3_1500k 1500000

log ""
log "### 探测结束 $(date '+%F %T') ###"
