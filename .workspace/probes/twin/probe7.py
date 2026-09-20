#!/usr/bin/env python3
"""第六轮：带重试的干净分布对比 + 混淆因素界定 + 同渠道多别名同体性。

A) 三提示词 × 四模型，N=150，503/500 自动重试（最多 4 次），保证样本量对齐。
B) 混淆界定：给 ds41-flash/ds-pro 显式注入各种 system 提示词，看 "hi" 的首 token 分布
   能否被推向 ds-flash 的形态（若推不动 => 分布差异来自模型而非提示词）。
C) 同渠道（deepseek/*）多别名：ds-vision-exp 是否与 ds41-flash/ds-pro 同分布。
"""
import json, os, sys, math, time, urllib.request, urllib.error
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import yaml

BASE = "https://llmapi.roboscience.xyz/v1"
KEY = yaml.safe_load(open(os.path.expanduser("~/.dsh/.credentials.yaml")))["refs"]["ADAM_API_KEY"]
RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw")
os.makedirs(RAW, exist_ok=True)
CONC = 5


def one(model, messages, timeout=120, retries=4, extra=None):
    body = {"model": model, "messages": messages, "max_tokens": 1, "temperature": 1}
    if extra:
        body.update(extra)
    for attempt in range(retries):
        req = urllib.request.Request(BASE + "/chat/completions", data=json.dumps(body).encode(),
                                    headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
        try:
            r = urllib.request.urlopen(req, timeout=timeout)
            j = json.loads(r.read().decode())
            ch = (j.get("choices") or [{}])[0]
            m = ch.get("message") or {}
            tok = m.get("reasoning_content")
            if tok is None:
                tok = m.get("content")
            return {"tok": tok, "status": 200, "rm": j.get("model"), "attempts": attempt + 1}
        except urllib.error.HTTPError as e:
            code = e.code
            _ = e.read()
            if code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(0.7 * (attempt + 1))
                continue
            return {"tok": None, "status": code, "attempts": attempt + 1}
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(0.7 * (attempt + 1))
                continue
            return {"tok": None, "status": -1, "err": str(e)[:80], "attempts": attempt + 1}
    return {"tok": None, "status": -2}


def run(tag, model, messages, n, save=True):
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        rows = list(ex.map(lambda _: one(model, messages), range(n)))
    ok = [r for r in rows if r["status"] == 200]
    cnt = Counter(r["tok"] for r in ok)
    retried = sum(1 for r in rows if r.get("attempts", 1) > 1)
    print(f"[{tag}] {model:30s} n={n} ok={len(ok)} retried={retried} {time.time()-t0:.0f}s "
          f"dist={dict(cnt.most_common(8))}")
    if save:
        json.dump({"tag": tag, "model": model, "n": n, "dist": dict(cnt),
                   "rows": rows, "messages": messages},
                  open(os.path.join(RAW, f"E7_{tag}.json"), "w"), ensure_ascii=False, indent=1)
    return cnt


def gtest(c1, c2):
    keys = set(c1) | set(c2)
    n1, n2 = sum(c1.values()), sum(c2.values())
    if n1 == 0 or n2 == 0:
        return None
    g = 0.0
    for k in keys:
        o1, o2 = c1.get(k, 0), c2.get(k, 0)
        e1 = n1 * (o1 + o2) / (n1 + n2); e2 = n2 * (o1 + o2) / (n1 + n2)
        for o, e in ((o1, e1), (o2, e2)):
            if o > 0 and e > 0:
                g += 2 * o * math.log(o / e)
    df = max(len(keys) - 1, 1)
    crit = df * (1 - 2 / (9 * df) + 3.09 * math.sqrt(2 / (9 * df))) ** 3
    return {"G": round(g, 2), "df": df, "G_over_n": round(g / (n1 + n2), 4),
            "crit_0.001": round(crit, 2), "differs_p001": g > crit}


if __name__ == "__main__":
    MODELS = {"ds-flash": "deepseek-v4-flash", "ds41-flash": "deepseek-v4.1-flash",
              "ds-pro": "deepseek-v4-pro", "ds-vision-exp": "deepseek-v4-flash-vision-exp",
              "glm-flash": "glm-5.3-flash"}
    PROMPTS = {"hi": "hi", "zh": "你好", "q1": "What is 2+2?"}
    N = 150
    res = {}
    print("########## A/C) 干净分布对比（含同渠道多别名）##########")
    for pk, txt in PROMPTS.items():
        for mk in ["ds-flash", "ds41-flash", "ds-pro", "ds-vision-exp", "glm-flash"]:
            res[f"A|{pk}|{mk}"] = run(f"A_{pk}_{mk}", MODELS[mk],
                                     [{"role": "user", "content": txt}], N)
    print("\n########## G 检验矩阵（A/C）##########")
    for pk in PROMPTS:
        print(f"--- prompt={pk!r}")
        ks = [m for m in ["ds-flash", "ds41-flash", "ds-pro", "ds-vision-exp", "glm-flash"]]
        for i in range(len(ks)):
            for j in range(i + 1, len(ks)):
                r = gtest(res[f"A|{pk}|{ks[i]}"], res[f"A|{pk}|{ks[j]}"])
                if r:
                    print(f"   {ks[i]:14s} vs {ks[j]:14s} G={r['G']:8.2f} df={r['df']:2d} "
                          f"G/n={r['G_over_n']:.4f} 显著差异(p<0.001)={r['differs_p001']}")

    print("\n########## B) 混淆界定：显式 system 提示词能否把 ds41 推向 ds-flash 形态 ##########")
    SYSS = {
        "none": None,
        "api_default": "You are an AI assistant accessed via an API.",
        "deepseek_id": "You are DeepSeek V4.1, a helpful assistant developed by DeepSeek.",
        "official_style": ("You are DeepSeek, an AI assistant created by DeepSeek Company. "
                           "You are a helpful, harmless, and honest assistant. "
                           "Knowledge cutoff: 2026-03. Current date: 2026-09-18. "
                           "Answer the user's questions carefully and precisely. "
                           "Think step by step before answering. Always respond in the user's language."),
        "force_We": "You must begin every reasoning block with the exact token 'We'.",
    }
    baseline = res["A|hi|ds41-flash"]
    print(f"  基线 ds41-flash(无 system) dist={dict(baseline)}")
    for sn, sv in SYSS.items():
        if sv is None:
            continue
        msgs = [{"role": "system", "content": sv}, {"role": "user", "content": "hi"}]
        c41 = run(f"B_ds41_{sn}", MODELS["ds41-flash"], msgs, N)
        cpr = run(f"B_dspro_{sn}", MODELS["ds-pro"], msgs, N)
        # 与 ds-flash 基线对比
        r1 = gtest(c41, res["A|hi|ds-flash"]); r2 = gtest(cpr, res["A|hi|ds-flash"])
        wr1 = c41.get("We", 0) / max(sum(c41.values()), 1)
        print(f"     system={sn:15s} ds41 We率={wr1:.3f}  vs ds-flash: G/n={r1['G_over_n']:.4f} 显著={r1['differs_p001']}"
              f" | ds-pro vs ds-flash: 显著={r2['differs_p001']}")
    json.dump(res, open(os.path.join(RAW, "E7_summary.json"), "w"), ensure_ascii=False, indent=1)
