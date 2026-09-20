"""Phase 2: self-consistency baseline (N=5, temperature=0) + cross-model exact-match."""
import sys, json, hashlib, itertools
sys.path.insert(0,'.')
from probe_lib import post, save
from prompts import P_PROMPTS

MODELS = ["deepseek-v4-flash","deepseek-v4.1-flash","glm-5.3-flash","qwen3.8-flash"]
N = 5
recs = []
for m in MODELS:
    for pid, p in P_PROMPTS.items():
        for i in range(N):
            r = post("/chat/completions", {"model": m, "messages":[{"role":"user","content":p}],
                     "temperature":0, "max_tokens":512})
            rec = {"model":m,"prompt_id":pid,"iter":i,"status":r["status"],
                   "elapsed":round(r["elapsed"],3),"raw":r["raw"]}
            try:
                d = json.loads(r["raw"])
                ch = d["choices"][0]["message"]
                rec["upstream_model"] = d.get("model")
                rec["content"] = ch.get("content") or ""
                rec["reasoning_content"] = ch.get("reasoning_content") or ""
                rec["finish_reason"] = d["choices"][0].get("finish_reason")
                u = d.get("usage") or {}
                rec["prompt_tokens"] = u.get("prompt_tokens")
                rec["completion_tokens"] = u.get("completion_tokens")
                rec["reasoning_tokens"] = (u.get("completion_tokens_details") or {}).get("reasoning_tokens")
                rec["content_sha"] = hashlib.sha256(rec["content"].encode()).hexdigest()[:16]
                rec["full_sha"] = hashlib.sha256((rec["content"]+"\x00"+rec["reasoning_content"]).encode()).hexdigest()[:16]
            except Exception as e:
                rec["parse_error"] = repr(e)
            recs.append(rec)
            print(m, pid, i, "ct=", rec.get("completion_tokens"), flush=True)
save("raw_phase2_consistency.json", recs)
print("TOTAL", len(recs))
