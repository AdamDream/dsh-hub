"""Phase 5: streaming TTFT + throughput profile (~10 requests/model) + usage cross-check."""
import sys, json, time, hashlib
sys.path.insert(0,'.')
from probe_lib import KEY, BASE, save
import urllib.request

MODELS = ["deepseek-v4-flash","deepseek-v4.1-flash","glm-5.3-flash","qwen3.8-flash"]
PROMPT = "Write a short paragraph of about 80 words about why the sky is blue."
REPS = 10
recs = []
for m in MODELS:
    for i in range(REPS):
        payload = {"model": m, "messages":[{"role":"user","content":PROMPT}],
                   "temperature":0, "max_tokens":400, "stream": True,
                   "stream_options":{"include_usage": True}}
        req = urllib.request.Request(BASE+"/chat/completions", data=json.dumps(payload).encode(),
            headers={"Authorization":"Bearer "+KEY,"Content-Type":"application/json"}, method="POST")
        t0=time.time(); ttft=None; chunks=[]; err=None
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                for line in r:
                    if ttft is None and line.strip():
                        ttft = time.time()-t0
                    chunks.append(line.decode("utf-8","replace"))
        except Exception as e:
            err = repr(e)
        total = time.time()-t0
        usage=None; ct=None; id_=None; up=None
        for c in chunks:
            if c.startswith("data: ") and "usage" in c:
                try:
                    d=json.loads(c[6:])
                    if d.get("usage"): usage=d["usage"]
                    if d.get("model"): up=d["model"]
                    if d.get("id"): id_=d["id"]
                except: pass
        if usage: ct = usage.get("completion_tokens")
        recs.append({"model":m,"iter":i,"ttft":round(ttft,3) if ttft else None,
                     "total":round(total,3),"completion_tokens":ct,"usage":usage,
                     "upstream_model":up,"id":id_,"n_chunks":len(chunks),"error":err})
        tp = (ct/total) if (ct and total) else None
        print(m, i, "ttft=", recs[-1]["ttft"], "total=", recs[-1]["total"], "ct=", ct,
              "tok/s=%.2f"%tp if tp else "", flush=True)
save("raw_phase5_perf.json", recs)
print("TOTAL", len(recs))
