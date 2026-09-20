"""Phase 4: reproducibility fingerprint with fixed seed + tokenizer cross-check."""
import sys, json, hashlib
sys.path.insert(0,'.')
from probe_lib import post, save

MODELS = ["deepseek-v4-flash","deepseek-v4.1-flash","glm-5.3-flash","qwen3.8-flash"]
PROMPT = "List exactly five distinct prime numbers between 100 and 200, comma-separated, nothing else."
recs = []
for m in MODELS:
    for seed in (1234, 1234, 1234, 777):
        r = post("/chat/completions", {"model": m, "messages":[{"role":"user","content":PROMPT}],
                 "temperature":0, "seed": seed, "max_tokens":512})
        rec = {"model":m,"seed":seed,"status":r["status"],"elapsed":round(r["elapsed"],3),"raw":r["raw"]}
        try:
            d = json.loads(r["raw"]); ch = d["choices"][0]["message"]
            rec["content"] = ch.get("content") or ""
            rec["reasoning_content"] = ch.get("reasoning_content") or ""
            rec["content_sha"] = hashlib.sha256(rec["content"].encode()).hexdigest()[:16]
            rec["full_sha"] = hashlib.sha256((rec["content"]+"\x00"+rec["reasoning_content"]).encode()).hexdigest()[:16]
            u = d.get("usage") or {}
            rec["prompt_tokens"] = u.get("prompt_tokens")
            rec["completion_tokens"] = u.get("completion_tokens")
            rec["system_fingerprint"] = d.get("system_fingerprint")
        except Exception as e:
            rec["parse_error"] = repr(e)
        recs.append(rec)
        print(m, seed, rec.get("content_sha"), repr((rec.get("content") or "")[:50]), flush=True)
save("raw_phase4_seed.json", recs)
print("TOTAL", len(recs))
