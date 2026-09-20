#!/usr/bin/env bash
# adam 网关「模型替身」自查脚本 —— 串行 + 限速，不会打断网关
# 用法: bash verify_twin.sh            # 全部检查
#       bash verify_twin.sh fp         # 只跑 logprob 指纹
#       bash verify_twin.sh dist 60    # 只跑首token分布(N=60)
set -u

KEY="$(python3 -c "import yaml,os;print(yaml.safe_load(open(os.path.expanduser('~/.dsh/.credentials.yaml')))['refs']['ADAM_API_KEY'])")"
BASE="https://llmapi.roboscience.xyz/v1/chat/completions"
PACE="${PACE:-2}"

call() { # $1=model $2=json-extra
  curl -s -m 180 "$BASE" \
    -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
    -d "{\"model\":\"$1\",\"messages\":[{\"role\":\"user\",\"content\":\"请用一句话说明什么是网关。\"}],\"temperature\":0,\"max_tokens\":2,\"logprobs\":true,\"top_logprobs\":5$2}"
}

fingerprint() {
  echo "=== logprob 指纹（同一上下文，模型间逐位相同 ⇒ 同一实体）==="
  for M in deepseek-v4-flash deepseek-v4.1-flash deepseek-v4-pro deepseek-v4-flash-vision-exp; do
    printf '%-32s ' "$M"
    call "$M" | python3 -c '
import json,sys
j=json.load(sys.stdin)
if "error" in j: print("ERR", str(j)[:80]); raise SystemExit
lp=(j.get("choices") or [{}])[0].get("logprobs") or {}
arr=lp.get("reasoning_content") or lp.get("content") or []
if not arr: print("无 logprobs  rm=%s" % j.get("model")); raise SystemExit
t=arr[0]
print("rm=%-38s %s %.4f %s" % (j.get("model"), t["token"], t["logprob"],
      [(x["token"], round(x["logprob"],4)) for x in (t.get("top_logprobs") or [])]))'
    sleep "$PACE"
  done
}

dist() { # $1=N
  N="${1:-60}"
  echo "=== 首 token 分布（N=$N，temperature=1）==="
  for M in deepseek-v4-flash deepseek-v4.1-flash deepseek-v4-pro; do
    printf '%-32s ' "$M"
    python3 - "$M" "$N" <<'PY'
import json,sys,urllib.request,yaml,os,time
from collections import Counter
m,N=sys.argv[1],int(sys.argv[2])
K=yaml.safe_load(open(os.path.expanduser("~/.dsh/.credentials.yaml")))["refs"]["ADAM_API_KEY"]
cnt=Counter(); fails=0
for i in range(N):
    body=json.dumps({"model":m,"messages":[{"role":"user","content":"hi"}],"max_tokens":1,"temperature":1}).encode()
    r=urllib.request.Request("https://llmapi.roboscience.xyz/v1/chat/completions",data=body,
        headers={"Authorization":"Bearer "+K,"Content-Type":"application/json"})
    try:
        j=json.loads(urllib.request.urlopen(r,timeout=120).read().decode())
        msg=(j.get("choices") or [{}])[0].get("message") or {}
        t=msg.get("reasoning_content")
        cnt[t if t is not None else msg.get("content")]+=1
    except Exception:
        fails+=1
    time.sleep(0.6)
tot=sum(cnt.values())
print("ok=%d fail=%d  %s" % (tot,fails,dict(cnt.most_common(6))))
PY
    sleep "$PACE"
  done
}

case "${1:-all}" in
  fp)   fingerprint ;;
  dist) dist "${2:-60}" ;;
  all)  fingerprint; echo; dist 60 ;;
  *)    echo "用法: bash verify_twin.sh [fp|dist N|all]"; exit 1 ;;
esac

echo
echo "判读：1) 四个名字里若若干行 rm= 与 (token,logprob,top) 完全一致 ⇒ 同一实体。"
echo "      2) logprobs 为空的行说明该渠道不支持 logprobs，只能用 dist 对比。"
echo "      3) dist 中 We 占比接近 99% 的与接近 55~60% 的分属不同实体。"
