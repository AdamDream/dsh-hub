"""Phase 1c: tokenizer stress on RARE/high-entropy content (best discriminator),
plus pure-content differential to cancel template overhead entirely."""
import sys, json
sys.path.insert(0,'.')
from probe_lib import post, save
MODELS=["deepseek-v4-flash","deepseek-v4.1-flash","glm-5.3-flash","qwen3.8-flash"]
UNITS = {
 "u1_hex":      "a3f9c2e1b7d4086f5a1c9e3b2d7f0a48",
 "u2_base64":   "TG9yZW0gaXBzdW0gZG9sb3Igc2l0IGFtZXQ=",
 "u3_symbols":  "->{}[]()<>|\\/&*%$#@!~^+=;:'\",.?!",
 "u4_zhrare":   "\u9f8b\u9f98\u9fa0\u9f9c\u9f8d\u9f77\u9f6c\u9f6a",
 "u5_emoji":    "\U0001F600\U0001F602\U0001F60D\U0001F914\U0001F680\U0001F4A1\U0001F525\U0001F30D",
 "u6_words":    "epistemology zymurgy quixotic serendipity obfuscate perspicacious",
 "u7_digits":   "31415926535897932384626433832795028841971693993751",
 "u8_mixed":    "Kubernetes gRPC protobuf \u03b1\u03b2\u03b3 \u4e2d\u6587 42 U+1F600",
}
recs=[]
for m in MODELS:
    for name,u in UNITS.items():
        for k in (1,2,4):
            body="\n".join([u]*k)
            r=post("/chat/completions",{"model":m,"messages":[{"role":"user","content":body}],
                 "temperature":0,"max_tokens":8})
            rec={"model":m,"unit":name,"k":k,"chars":len(body),"status":r["status"],"raw":r["raw"]}
            try:
                d=json.loads(r["raw"]); uu=d.get("usage") or {}
                rec["prompt_tokens"]=uu.get("prompt_tokens")
                rec["cached"]=(uu.get("prompt_tokens_details") or {}).get("cached_tokens")
                rec["upstream_model"]=d.get("model")
            except Exception as e: rec["parse_error"]=repr(e)
            recs.append(rec)
print("%-14s %-16s %-16s %-16s %-16s"%("unit","ds-v4-flash","ds-v4.1-flash","glm-5.3","qwen3.8"))
tbl={}
for name in UNITS:
    row=[]
    for m in MODELS:
        rs={r["k"]:r.get("prompt_tokens") for r in recs if r["model"]==m and r["unit"]==name}
        # slope per unit copy using k=2,4 ; intercept from k=1
        try: sl=rs[4]-rs[2]; sl2=sl/2
        except: sl2=None
        row.append("k1=%s per-copy=%s"%(rs.get(1), sl2))
        tbl.setdefault(m,{})[name]={"k1":rs.get(1),"k2":rs.get(2),"k4":rs.get(4),
                                    "per_copy":sl2,"content_only":(rs.get(1) or 0)}
    print("%-14s %-16s %-16s %-16s %-16s"%(name,*row))
save("raw_phase1c_rare.json",recs)
json.dump(tbl,open("tokenizer_rare_table.json","w"),ensure_ascii=False,indent=1)
# intercept table (k=1 pt) comparison
print("\n== per-unit per-copy slope matrix (should be IDENTICAL for same tokenizer) ==")
print("%-14s %8s %8s %8s %8s"%("unit","ds-v4","ds-v4.1","glm5.3","qwen3.8"))
for name in UNITS:
    print("%-14s %8s %8s %8s %8s"%(name,*[tbl[m][name]["per_copy"] for m in MODELS]))
