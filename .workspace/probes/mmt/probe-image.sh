#!/usr/bin/env bash
# 探针（修正版）：图像输入实测 —— deepseek-v4.1-flash vs deepseek-v4-flash-vision-exp
# 用法：bash probe-image.sh
# 凭据运行期解析，不回显；请求体在 Python 内构造（避免 argv 超限）
set -uo pipefail
OUT="$(cd "$(dirname "$0")" && pwd)"
BASE="https://llmapi.roboscience.xyz/v1"
KEY=$(python3 -c "import yaml;print(yaml.safe_load(open('/home/CNS2026495165/.dsh/.credentials.yaml'))['refs']['ADAM_API_KEY'])")

mkreq() { # $1=model $2=prompt $3=out
python3 - "$1" "$2" "$3" <<'PY'
import base64,json,sys
model,prompt,out=sys.argv[1],sys.argv[2],sys.argv[3]
b64=base64.b64encode(open(__import__('os').path.join(__import__('os').path.dirname(out) if False else '/home/CNS2026495165/dsh/.workspace/probes/mmt','probe.jpg'),'rb').read()).decode()
req={"model":model,"max_tokens":900,"messages":[{"role":"user","content":[
 {"type":"text","text":prompt},
 {"type":"image_url","image_url":{"url":"data:image/jpeg;base64,"+b64}}]}]}
open(out,'w').write(json.dumps(req))
print(f"[req] {model} -> {out} ({len(json.dumps(req))} bytes)")
PY
}

ask() { # $1=model $2=out
  mkreq "$1" "完整转录这张图片中的所有文字；若没有文字请明确说明「无文字」，并客观描述画面主体数量、颜色、服饰与构图。" "$2"
  echo "--- $1 ---"
  curl -s --max-time 180 -w '\n[http_code=%{http_code}]' "$BASE/chat/completions" \
    -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' --data-binary @"$2" \
    | tee "${2%.json}.resp.json" | python3 -c "
import sys,json
raw=sys.stdin.read()
body=raw.rsplit('[http_code=',1)[0]
try:
    d=json.loads(body)
    if 'choices' in d:
        m=d['choices'][0].get('message',{})
        print('ACCEPTED model=',d.get('model'),'finish=',d['choices'][0].get('finish_reason'))
        print('content:',(m.get('content') or '')[:1200])
        rc=m.get('reasoning_content') or ''
        if rc: print('reasoning:',rc[:300])
    else:
        print('REJECTED:',str(d)[:400])
except Exception as e:
    print('RAW:',body[:400])
print(raw.rsplit('[http_code=',1)[-1].rstrip(']'))
"
}

echo "=== A. deepseek-v4.1-flash（会话当前模型）图像输入 ==="
ask deepseek-v4.1-flash "$OUT/req-41flash.json"
echo
echo "=== B. deepseek-v4-flash 图像输入 ==="
ask deepseek-v4-flash "$OUT/req-v4flash.json"
echo
echo "=== C. deepseek-v4-flash-vision-exp（网关专有视觉实验模型）==="
ask deepseek-v4-flash-vision-exp "$OUT/req-visionexp.json"
