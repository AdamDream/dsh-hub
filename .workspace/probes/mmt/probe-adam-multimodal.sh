#!/usr/bin/env bash
# 探针：adam 网关 deepseek-v4.1-flash 是否支持原生多模态（图像输入）
# 用法：bash probe-adam-multimodal.sh
# 凭据：从 ~/.dsh/.credentials.yaml 运行期解析 ADAM_API_KEY（不回显）
set -uo pipefail
OUT="$(cd "$(dirname "$0")" && pwd)"
BASE="https://llmapi.roboscience.xyz/v1"
MODEL="${MODEL:-deepseek-v4.1-flash}"
IMG="$OUT/probe.jpg"

KEY=$(python3 -c "import yaml;print(yaml.safe_load(open('/home/CNS2026495165/.dsh/.credentials.yaml'))['refs']['ADAM_API_KEY'])")
[ -n "$KEY" ] || { echo "FAIL: 无 ADAM_API_KEY"; exit 1; }

# 缩小测试图（避免大 payload），保持可辨识
python3 - "$IMG" <<'PY'
import sys
from PIL import Image
src="/home/CNS2026495165/.dsh/wallpapers/37758c1c-9ca8-47d2-bade-3048ab825fb6.png"
im=Image.open(src).convert("RGB")
im.thumbnail((768,768))
im.save(sys.argv[1],"JPEG",quality=85)
print(f"[img] {im.size} -> {sys.argv[1]}")
PY

echo "=== 1. /v1/models 中是否有 $MODEL / 模态元数据 ==="
curl -s --max-time 60 "$BASE/models" -H "Authorization: Bearer $KEY" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);ms=d.get('data',d);ids=[m.get('id') for m in ms] if isinstance(ms,list) else [];print('模型数',len(ids));print('目标存在:', '$MODEL' in ids);print([i for i in ids if 'v4' in str(i) or 'flash' in str(i)])" 2>&1 | head -5

echo "=== 2. 纯文本基线（确认模型可用）==="
curl -s --max-time 120 "$BASE/chat/completions" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
 -d "{\"model\":\"$MODEL\",\"max_tokens\":32,\"messages\":[{\"role\":\"user\",\"content\":\"只回复两个字：可用\"}]}" \
 | tee "$OUT/text-baseline.json" | python3 -c "import sys,json;d=json.load(sys.stdin);print('OK' if 'choices' in d else 'ERR');print(str(d)[:300])"

echo "=== 3. 图像输入实测（image_url data URI）==="
B64=$(base64 -w0 "$IMG")
python3 - "$B64" "$MODEL" > "$OUT/req.json" <<'PY'
import json,sys
b64,model=sys.argv[1],sys.argv[2]
req={"model":model,"max_tokens":600,"messages":[{"role":"user","content":[
 {"type":"text","text":"完整转录这张图片中的所有文字；若没有文字请说明，并客观描述画面主体、颜色与构图。"},
 {"type":"image_url","image_url":{"url":"data:image/jpeg;base64,"+b64}}]}]}
print(json.dumps(req))
PY
curl -s --max-time 180 -w '\n[http_code=%{http_code}]\n' "$BASE/chat/completions" \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  --data-binary @"$OUT/req.json" | tee "$OUT/image-probe.json" | tail -c 2500

echo "=== 4. 对照：deepseek-v4-flash 同样请求 ==="
MODEL=deepseek-v4-flash bash -c "B64=\$(base64 -w0 '$IMG'); python3 - <<'PY' > '$OUT/req2.json'
import json
b64=open('/dev/stdin').read() if False else None
PY
true" 2>/dev/null
python3 - "$B64" > "$OUT/req2.json" <<'PY'
import json,sys
b64=sys.argv[1]
req={"model":"deepseek-v4-flash","max_tokens":300,"messages":[{"role":"user","content":[
 {"type":"text","text":"这张图里有几只动物？什么颜色？"},
 {"type":"image_url","image_url":{"url":"data:image/jpeg;base64,"+b64}}]}]}
print(json.dumps(req))
PY
curl -s --max-time 180 -w '\n[http_code=%{http_code}]\n' "$BASE/chat/completions" \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  --data-binary @"$OUT/req2.json" | tee "$OUT/image-probe-v4flash.json" | tail -c 1200
echo "=== 产物：$OUT ==="
