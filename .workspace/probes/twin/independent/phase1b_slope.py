"""Phase 1b: tokenizer slope probe.
prompt_tokens = O + slope*N  (N = number of copies of an ASCII filler line).
O = chat-template overhead; slope = tokens per copy -> pure tokenizer fingerprint,
robust to template differences. Also records cached_tokens to detect prefix caching.
"""
import sys, json, hashlib
sys.path.insert(0,'.')
from probe_lib import post, save

MODELS = ["deepseek-v4-flash","deepseek-v4.1-flash","glm-5.3-flash","qwen3.8-flash"]
FILLER = "The quick brown fox jumps over the lazy dog and then runs away quickly."
recs=[]
for m in MODELS:
    for n in (1, 2, 4, 8, 16):
        body = "\n".join([FILLER]*n)
        r = post("/chat/completions", {"model":m,"messages":[{"role":"user","content":body}],
                 "temperature":0,"max_tokens":8})
        rec={"model":m,"n":n,"chars":len(body),"status":r["status"],"raw":r["raw"]}
        try:
            d=json.loads(r["raw"]); u=d.get("usage") or {}
            rec["prompt_tokens"]=u.get("prompt_tokens")
            rec["cached_tokens"]=(u.get("prompt_tokens_details") or {}).get("cached_tokens")
            rec["completion_tokens"]=u.get("completion_tokens")
            rec["upstream_model"]=d.get("model")
        except Exception as e: rec["parse_error"]=repr(e)
        recs.append(rec)
        print(m,"n=",n,"pt=",rec.get("prompt_tokens"),"cached=",rec.get("cached_tokens"),flush=True)
save("raw_phase1b_slope.json", recs)

# per-model least-squares slope + intercept over n in {2,4,8,16} (skip n=1 to avoid warmup)
print("\n== slope (tokens per 66-char filler line) ==")
for m in MODELS:
    pts=[(r["n"],r["prompt_tokens"]) for r in recs if r["model"]==m and r.get("prompt_tokens") and r["n"]>=2]
    n=len(pts); sx=sum(p[0] for p in pts); sy=sum(p[1] for p in pts)
    sxx=sum(p[0]**2 for p in pts); sxy=sum(p[0]*p[1] for p in pts)
    slope=(n*sxy-sx*sy)/(n*sxx-sx*sx); inter=(sy-slope*sx)/n
    print("%-22s slope=%.3f  intercept=%.2f  (chars/line=66)"%(m,slope,inter))
