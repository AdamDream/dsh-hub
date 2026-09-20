#!/usr/bin/env bash
# 渠道可用性实测：deepseek-v4.1-flash vs deepseek-v4-flash（极小请求，成本可忽略）
#
# 动机：18:17:30 一个 inputTokens=0 的极小请求也被 503 model_not_found /
# "No available channel ... under group auto" 拒掉 → 说明 v4.1-flash 的「通道不可用」
# 与请求尺寸无关，因此先前"大尺寸被拒 = 超出窗口"的推断不成立，必须实测通道可用率。
set -u
LOG=/home/CNS2026495165/dsh/.workspace/probes/acceptance/channel-availability.log
: > "$LOG"
log() { echo "$@" | tee -a "$LOG"; }

KEY=$(python3 -c "
import yaml
d=yaml.safe_load(open('/home/CNS2026495165/.dsh/.credentials.yaml'))
print(d['refs']['ADAM_API_KEY'])
")
[ -z "${KEY:-}" ] && { log "FATAL: 无密钥"; exit 1; }
URL="https://llmapi.roboscience.xyz/v1/chat/completions"

probe_model() { # $1=model  $2=次数
  local model="$1" n="$2" ok=0 bad=0
  log ""
  log "=== $model（$n 次极小请求，max_tokens=2） ==="
  for i in $(seq 1 "$n"); do
    code=$(curl -sS -o /tmp/ch.resp.json -w '%{http_code}' --max-time 60 \
        -H "authorization: Bearer $KEY" -H "content-type: application/json" \
        -d "{\"model\":\"$model\",\"max_tokens\":2,\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}" \
        "$URL" 2>/dev/null) || code=000
    if [ "$code" = "200" ]; then ok=$((ok+1)); tag="OK";
    else
      bad=$((bad+1)); tag="FAIL($code)"
      err=$(python3 -c "
import json
try:
    d=json.load(open('/tmp/ch.resp.json')); e=d.get('error') or {}
    print((e.get('code') or '')+': '+(e.get('message') or '')[:110])
except Exception as ex: print('(非 JSON)')
" 2>/dev/null)
      log "    #$i $tag  $err"
    fi
    [ "$code" = "200" ] && log "    #$i $tag"
    sleep 1
  done
  log "  → $model 结果: 成功 $ok / 失败 $bad（共 $n）"
}

log "### 渠道可用性实测 $(date '+%F %T') ###"
probe_model deepseek-v4.1-flash 10
probe_model deepseek-v4-flash 10
log ""
log "### 结束 $(date '+%F %T') ###"
