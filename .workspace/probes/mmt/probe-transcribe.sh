#!/usr/bin/env bash
# 探针2：转录保真度对照 —— adam 网关 deepseek-v4.1-flash vs deepseek-v4-flash-vision-exp
# 用法：bash probe-transcribe.sh <图片路径> <模型>
set -uo pipefail
OUT="$(cd "$(dirname "$0")" && pwd)"
BASE="https://llmapi.roboscience.xyz/v1"
IMG="${1:?图片路径}"
MODEL="${2:-deepseek-v4.1-flash}"
KEY=$(python3 -c "import yaml;print(yaml.safe_load(open('/home/CNS2026495165/.dsh/.credentials.yaml'))['refs']['ADAM_API_KEY'])")

REQ="$OUT/req-trans-$(echo "$MODEL" | tr -c 'a-zA-Z0-9' '_').json"
python3 - "$IMG" "$MODEL" "$REQ" <<'PY'
import base64,json,sys,os
img,model,out=sys.argv[1],sys.argv[2],sys.argv[3]
from PIL import Image
im=Image.open(img).convert("RGB"); im.thumbnail((1400,1400))
tmp=os.path.join(os.path.dirname(out),"probe-t.jpg"); im.save(tmp,"JPEG",quality=88)
b64=base64.b64encode(open(tmp,'rb').read()).decode()
prompt=("完整转录这张图片中的所有可见文字（逐字，含标签、按钮、数值、标题、说明行）；"
        "同时客观描述界面构成与颜色。不要省略任何一处文字。")
req={"model":model,"max_tokens":2000,"messages":[{"role":"user","content":[
 {"type":"text","text":prompt},
 {"type":"image_url","image_url":{"url":"data:image/jpeg;base64,"+b64}}]}]}
open(out,'w').write(json.dumps(req))
print(f"[req] {model} <- {img} {im.size} -> {out}")
PY

curl -s --max-time 240 -w '\n[http_code=%{http_code}]' "$BASE/chat/completions" \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' --data-binary @"$REQ" \
  | tee "$OUT/trans-$(echo "$MODEL" | tr -c 'a-zA-Z0-9' '_').resp.json" \
  | python3 -c "
import sys,json
raw=sys.stdin.read(); body=raw.rsplit('[http_code=',1)[0]
try:
    d=json.loads(body)
    if 'choices' in d:
        m=d['choices'][0].get('message',{})
        print('ACCEPTED model=',d.get('model'),'finish=',d['choices'][0].get('finish_reason'))
        print('--- content ---'); print((m.get('content') or '')[:2500])
    else: print('REJECTED:',str(d)[:400])
except Exception: print('RAW:',body[:500])
print('http',raw.rsplit('[http_code=',1)[-1].rstrip(']'))
"
