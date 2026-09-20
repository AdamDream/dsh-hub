"""Phase 3: capability battery -> accuracy + answer-overlap between models."""
import sys, json, hashlib
sys.path.insert(0,'.')
from probe_lib import post, save
from prompts import CAPABILITY, SUMMARIZE_PROMPT

MODELS = ["deepseek-v4-flash","deepseek-v4.1-flash","glm-5.3-flash","qwen3.8-flash"]
recs = []
for m in MODELS:
    for q in CAPABILITY:
        r = post("/chat/completions", {"model": m, "messages":[{"role":"user","content":q["prompt"]}],
                 "temperature":0, "max_tokens":512})
        rec = {"model":m,"qid":q["id"],"kind":q["kind"],"status":r["status"],
               "elapsed":round(r["elapsed"],3),"raw":r["raw"]}
        try:
            d = json.loads(r["raw"]); ch = d["choices"][0]["message"]
            rec["content"] = ch.get("content") or ""
            rec["reasoning_content"] = ch.get("reasoning_content") or ""
            rec["content_sha"] = hashlib.sha256(rec["content"].encode()).hexdigest()[:16]
            u = d.get("usage") or {}
            rec["prompt_tokens"] = u.get("prompt_tokens")
            rec["completion_tokens"] = u.get("completion_tokens")
        except Exception as e:
            rec["parse_error"] = repr(e)
        recs.append(rec)
        print(m, q["id"], repr((rec.get("content") or "")[:60]), flush=True)
    # summarization sub-test
    r = post("/chat/completions", {"model": m, "messages":[{"role":"user","content":SUMMARIZE_PROMPT}],
             "temperature":0, "max_tokens":512})
    rec = {"model":m,"qid":"c13_summary","kind":"format_summary","status":r["status"],
           "elapsed":round(r["elapsed"],3),"raw":r["raw"]}
    try:
        d = json.loads(r["raw"]); ch = d["choices"][0]["message"]
        rec["content"] = ch.get("content") or ""
        rec["reasoning_content"] = ch.get("reasoning_content") or ""
        rec["content_sha"] = hashlib.sha256(rec["content"].encode()).hexdigest()[:16]
        u = d.get("usage") or {}
        rec["prompt_tokens"] = u.get("prompt_tokens")
        rec["completion_tokens"] = u.get("completion_tokens")
    except Exception as e:
        rec["parse_error"] = repr(e)
    recs.append(rec)
    print(m, "c13_summary", repr((rec.get("content") or "")[:70]), flush=True)
save("raw_phase3_capability.json", recs)
print("TOTAL", len(recs))
