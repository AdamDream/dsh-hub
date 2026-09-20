# -*- coding: utf-8 -*-
"""Analysis part 2: capability grading, overlap, seed reproducibility, perf."""
import json, os, re, statistics, collections, itertools
sys_path=os.path.dirname(os.path.abspath(__file__))
import sys; sys.path.insert(0, sys_path)
HERE=sys_path
from prompts import CAPABILITY
def L(n):
    p=os.path.join(HERE,n); return json.load(open(p)) if os.path.exists(p) else None
MODELS=["deepseek-v4-flash","deepseek-v4.1-flash","glm-5.3-flash","qwen3.8-flash"]
res={}

def norm(s):
    s=(s or "").strip()
    s=re.sub(r"^```[a-zA-Z]*\n?","",s); s=re.sub(r"\n?```$","",s)
    return s.strip()
def strip_think(s):
    s=re.sub(r"<think(ing)?>.*?</think(ing)?>","",s or "",flags=re.S)
    return s.strip()

def grade(kind, content, expect):
    c=strip_think(norm(content))
    flat=" ".join(c.lower().split())
    if kind=="numeric":
        nums=re.findall(r"-?\d[\d,]*\.?\d*", c.replace(",", ""))
        nums=[x for x in nums if x not in ("",)]
        for x in nums:
            try:
                if abs(float(x)-float(expect))<1e-6: return True, x
            except: pass
        return False, nums[:4]
    if kind=="exact":
        return flat.strip(" .")==str(expect).lower(), flat[:80]
    if kind=="regex":
        return bool(re.search(expect, c, flags=re.M)), c[:80]
    if kind=="contains_all":
        return all(k.lower() in flat for k in expect), flat[:100]
    if kind=="json_fields":
        m=re.search(r"\{.*\}", c, flags=re.S)
        if not m: return False, c[:80]
        try:
            o=json.loads(m.group(0))
            return all(k in o and o[k]==v for k,v in expect.items()), json.dumps(o)[:100]
        except Exception as e: return False, "parse_error"
    if kind=="format_summary":
        lines=[l for l in c.splitlines() if l.strip()]
        ok = len(lines)==3 and all(l.strip().startswith("- ") for l in lines) \
             and all(len(l.split())<=17 for l in lines)
        return ok, "%d lines"%len(lines)
    return None, c[:80]

p3=L("raw_phase3_capability.json")
if p3:
    exp={q["id"]:q for q in CAPABILITY}
    exp["c13_summary"]={"id":"c13_summary","kind":"format_summary","expect":None}
    per={}
    for r in p3:
        q=exp.get(r["qid"],{})
        ok,detail=grade(q.get("kind"), r.get("content"), q.get("expect"))
        r["grade_pass"]=ok; r["grade_detail"]=detail
        per.setdefault(r["model"],{})[r["qid"]]={"pass":ok,"detail":detail,
            "content":r.get("content"),"sha":r.get("content_sha"),
            "pt":r.get("prompt_tokens"),"ct":r.get("completion_tokens"),
            "upstream":r.get("raw") and json.loads(r["raw"]).get("model")}
    res["capability"]=per
    acc={m:round(sum(1 for v in d.values() if v["pass"])/len(d),4) for m,d in per.items()}
    res["capability_accuracy"]=acc
    # per-question pass matrix + answer-string identity
    matrix={}
    for qid in sorted(exp):
        row={m:per.get(m,{}).get(qid,{}).get("pass") for m in MODELS}
        same={}
        for a,b in itertools.combinations(MODELS,2):
            ca=strip_think(norm(per.get(a,{}).get(qid,{}).get("content")))
            cb=strip_think(norm(per.get(b,{}).get(qid,{}).get("content")))
            same["%s|%s"%(a,b)]= (ca==cb and ca!="")
        matrix[qid]={"pass":row,"identical_answer":same}
    res["capability_matrix"]=matrix
    # overlap: token-level Jaccard of answers between models
    def toks(s): return collections.Counter(re.findall(r"\w+", (s or "").lower()))
    jac={}
    for a,b in itertools.combinations(MODELS,2):
        vals=[]
        for qid in exp:
            ca=strip_think(norm(per.get(a,{}).get(qid,{}).get("content")))
            cb=strip_think(norm(per.get(b,{}).get(qid,{}).get("content")))
            ta,tb=toks(ca),toks(cb)
            inter=sum((ta&tb).values()); uni=sum((ta|tb).values())
            vals.append(inter/uni if uni else 0.0)
        jac["%s|%s"%(a,b)]={"mean_jaccard":round(statistics.mean(vals),4),
                            "median":round(statistics.median(vals),4),
                            "per_q":dict(zip(sorted(exp),[round(v,3) for v in vals]))}
    res["answer_overlap_jaccard"]=jac
    # per-question prompt_tokens (same text!) -> tokenizer fingerprint on real battery
    ptrow={}
    for qid in sorted(exp):
        ptrow[qid]={m:per.get(m,{}).get(qid,{}).get("pt") for m in MODELS}
    res["capability_prompt_tokens"]=ptrow
    # pairwise pt equality
    pe={}
    for a,b in itertools.combinations(MODELS,2):
        eq=sum(1 for qid in exp if ptrow[qid][a]==ptrow[qid][b])
        diffs=[ptrow[qid][a]-ptrow[qid][b] for qid in exp if ptrow[qid][a] and ptrow[qid][b]]
        pe["%s|%s"%(a,b)]={"equal":eq,"n":len(exp),
            "mean_diff":round(statistics.mean(diffs),2) if diffs else None,
            "min_diff":min(diffs) if diffs else None,"max_diff":max(diffs) if diffs else None}
    res["prompt_token_pairwise"]=pe

# seed phase
p4=L("raw_phase4_seed.json")
if p4:
    g=collections.defaultdict(list)
    for r in p4: g[r["model"]].append(r)
    out={}
    for m,rs in g.items():
        s1234=[r for r in rs if r["seed"]==1234]
        out[m]={"n_seed1234":len(s1234),
                "identical_content_within_seed1234":len(set(r.get("content_sha") for r in s1234))==1,
                "identical_full_within_seed1234":len(set(r.get("full_sha") for r in s1234))==1,
                "uniq_content_all":len(set(r.get("content_sha") for r in rs)),
                "contents":{str(r["seed"])+"#"+str(i):(r.get("content") or "")[:120] for i,r in enumerate(rs)},
                "pt":sorted(set(r.get("prompt_tokens") for r in rs)),
                "sysfingerprint":sorted(set(str(r.get("system_fingerprint")) for r in rs))}
    res["seed_reproducibility"]=out
    # cross-model content identity on this prompt
    bym={m:set(r.get("content_sha") for r in rs) for m,rs in g.items()}
    res["seed_cross_model"]={ "%s|%s"%(a,b): bool(bym[a]&bym[b]) for a,b in itertools.combinations(MODELS,2)}

# perf
p5=L("raw_phase5_perf.json")
if p5:
    out={}
    for m in MODELS:
        rs=[r for r in p5 if r["model"]==m and not r.get("error")]
        tt=[r["ttft"] for r in rs if r.get("ttft")]; tot=[r["total"] for r in rs]
        ct=[r["completion_tokens"] for r in rs if r.get("completion_tokens")]
        tp=[c/t for c,t in zip(ct,tot) if c and t]
        out[m]={"n":len(rs),"errors":sum(1 for r in p5 if r["model"]==m and r.get("error")),
            "ttft_mean":round(statistics.mean(tt),3) if tt else None,
            "ttft_median":round(statistics.median(tt),3) if tt else None,
            "ttft_min":round(min(tt),3) if tt else None,"ttft_max":round(max(tt),3) if tt else None,
            "ttft_stdev":round(statistics.pstdev(tt),3) if tt else None,
            "total_mean":round(statistics.mean(tot),3),"total_median":round(statistics.median(tot),3),
            "ct_mean":round(statistics.mean(ct),2) if ct else None,
            "ct_min":min(ct) if ct else None,"ct_max":max(ct) if ct else None,
            "ct_stdev":round(statistics.pstdev(ct),2) if len(ct)>1 else None,
            "tok_per_s_mean":round(statistics.mean(tp),2) if tp else None,
            "upstream":sorted(set(str(r.get("upstream_model")) for r in rs)),
            "raw_cts":ct}
    res["performance"]=out
json.dump(res, open(os.path.join(HERE,"analysis2.json"),"w"), ensure_ascii=False, indent=1)
print("OK analyze2")
