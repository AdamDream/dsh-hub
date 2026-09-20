# -*- coding: utf-8 -*-
"""Analysis: parse all raw phases -> statistics tables -> analysis.json"""
import json, os, re, statistics, itertools, collections
HERE=os.path.dirname(os.path.abspath(__file__))
def L(n):
    p=os.path.join(HERE,n)
    return json.load(open(p)) if os.path.exists(p) else None

MODELS=["deepseek-v4-flash","deepseek-v4.1-flash","glm-5.3-flash","qwen3.8-flash"]
res={}

# ---------- Phase 1b: tokenizer slope ----------
p1b=L("raw_phase1b_slope.json")
if p1b:
    slope={}
    for m in MODELS:
        pts=[(r["n"],r["prompt_tokens"]) for r in p1b if r["model"]==m and r.get("prompt_tokens") and r["n"]>=2]
        n=len(pts); sx=sum(p[0] for p in pts); sy=sum(p[1] for p in pts)
        sxx=sum(p[0]**2 for p in pts); sxy=sum(p[0]*p[1] for p in pts)
        sl=(n*sxy-sx*sy)/(n*sxx-sx*sx); it=(sy-sl*sx)/n
        slope[m]={"slope":round(sl,4),"intercept":round(it,3),
                  "pts":pts,"cached":[ (r["n"],r.get("cached_tokens")) for r in p1b if r["model"]==m]}
    res["tokenizer_slope"]=slope

# ---------- Phase 2: self-consistency + cross-model ----------
p2=L("raw_phase2_consistency.json")
if p2:
    # group: model -> prompt -> list of (content_sha, full_sha, content)
    g=collections.defaultdict(lambda: collections.defaultdict(list))
    for r in p2: g[r["model"]][r["prompt_id"]].append(r)
    self_cons={}
    for m in MODELS:
        rows=[]
        for pid,rs in sorted(g[m].items()):
            shas=[r.get("content_sha") for r in rs]
            fshas=[r.get("full_sha") for r in rs]
            uniq=len(set(shas)); funiq=len(set(fshas))
            rows.append({"prompt_id":pid,"n":len(rs),"uniq_content":uniq,"uniq_full":funiq,
                         "identical_content":uniq==1,"identical_full":funiq==1})
        self_cons[m]={"per_prompt":rows,
            "content_all_identical_rate": round(sum(1 for r in rows if r["identical_content"])/len(rows),4),
            "full_all_identical_rate": round(sum(1 for r in rows if r["identical_full"])/len(rows),4),
            "pooled_pairwise": round(sum((r["n"]-1)/r["n"] for r in rows)/len(rows),4)}
    res["self_consistency"]=self_cons
    # cross-model: per prompt, take the 5 outputs of A and 5 of B, compute
    #  - set-overlap: fraction of A outputs byte-identical to at least one B output (and vice versa)
    #  - pooled pairwise identical probability
    def cross(a,b):
        rows=[]
        for pid in sorted(g[a]):
            A=[r.get("content_sha") for r in g[a][pid]]; B=[r.get("content_sha") for r in g[b][pid]]
            sa,sb=set(A),set(B)
            inter=len(sa&sb)
            pa=sum(1 for x in A if x in sb)/len(A)
            pb=sum(1 for x in B if x in sa)/len(B)
            rows.append({"prompt_id":pid,"a_uniq":len(sa),"b_uniq":len(sb),"shared_modes":inter,
                         "frac_a_in_b":round(pa,3),"frac_b_in_a":round(pb,3),
                         "identical_sets":sa==sb,
                         "a_modal_in_b": (collections.Counter(A).most_common(1)[0][0] in sb),
                         "hashes_a":sorted(sa),"hashes_b":sorted(sb)})
        n=len(rows)
        return {"pairs":rows,
            "prompts_with_identical_sets":sum(1 for r in rows if r["identical_sets"]),
            "prompts_modal_a_also_in_b":sum(1 for r in rows if r["a_modal_in_b"]),
            "mean_frac_a_in_b":round(sum(r["frac_a_in_b"] for r in rows)/n,4),
            "mean_frac_b_in_a":round(sum(r["frac_b_in_a"] for r in rows)/n,4)}
    res["cross_model_consistency"]={
        "A_vs_B":cross("deepseek-v4-flash","deepseek-v4.1-flash"),
        "A_vs_glm":cross("deepseek-v4-flash","glm-5.3-flash"),
        "A_vs_qwen":cross("deepseek-v4-flash","qwen3.8-flash"),
        "B_vs_glm":cross("deepseek-v4.1-flash","glm-5.3-flash"),
        "glm_vs_qwen":cross("glm-5.3-flash","qwen3.8-flash"),
    }
    # prompt_tokens in the consistency phase (same prompts across models)
    pt={}
    for pid in sorted(g["deepseek-v4-flash"]):
        row={}
        for m in MODELS:
            vals=[r.get("prompt_tokens") for r in g[m].get(pid,[]) if r.get("prompt_tokens")]
            row[m]=sorted(set(vals))
        pt[pid]=row
    res["phase2_prompt_tokens"]=pt
    # output length profile per model (completion tokens), same prompts
    ln={}
    for m in MODELS:
        vals=[r.get("completion_tokens") for r in p2 if r["model"]==m and r.get("completion_tokens")]
        ln[m]={"n":len(vals),"mean":round(statistics.mean(vals),2),"median":statistics.median(vals),
               "min":min(vals),"max":max(vals),"stdev":round(statistics.pstdev(vals),2)}
    res["output_tokens_profile"]=ln
json.dump(res, open(os.path.join(HERE,"analysis_partial.json"),"w"), ensure_ascii=False, indent=1)
print(json.dumps(res, ensure_ascii=False, indent=1)[:200])
print("OK")
