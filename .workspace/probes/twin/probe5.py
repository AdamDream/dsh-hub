#!/usr/bin/env python3
"""第五轮（统计判决）：同一上下文下首个 reasoning token 的采样分布两样本对比。

设计：
  - 每个模型 N 次请求，temperature=1, max_tokens=1 -> reasoning_content 恰为首 token。
  - 对照组：
      * 同体对照 ds41-flash vs ds-pro（已知 logprob 逐位相同）——用于证明本检验"能判同"。
      * 异体对照 ds41-flash vs glm-5.3-flash —— 用于证明本检验"能判异"。
      * 自身分半对照 ds41 前半 vs 后半 —— 给出零假设下的噪声水平。
  - 判决：ds-flash vs (ds41-flash / ds-pro) 的分布距离落在"同体"区间还是"异体"区间。
"""
import json, os, math, time, urllib.request, urllib.error
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import yaml

BASE = "https://llmapi.roboscience.xyz/v1"
KEY = yaml.safe_load(open(os.path.expanduser("~/.dsh/.credentials.yaml")))["refs"]["ADAM_API_KEY"]
RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw")
os.makedirs(RAW, exist_ok=True)

MS = {"ds-flash": "deepseek-v4-flash", "ds41-flash": "deepseek-v4.1-flash",
      "ds-pro": "deepseek-v4-pro", "glm-flash": "glm-5.3-flash"}

PROMPTS = {
    "hi": "hi",
    "zh": "你好",
}
N = 200
CONC = 5


def one(model, prompt, timeout=120):
    body = {"model": model, "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 1, "temperature": 1}
    req = urllib.request.Request(BASE + "/chat/completions", data=json.dumps(body).encode(),
                                headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
        j = json.loads(r.read().decode())
        ch = (j.get("choices") or [{}])[0]
        m = ch.get("message") or {}
        rc = m.get("reasoning_content")
        c = m.get("content")
        tok = rc if rc is not None else c
        return {"tok": tok, "status": 200, "rm": j.get("model")}
    except urllib.error.HTTPError as e:
        return {"tok": None, "status": e.code, "err": e.read().decode()[:120]}
    except Exception as e:
        return {"tok": None, "status": -1, "err": f"{type(e).__name__}: {e}"}


def run(model, prompt, n, tag):
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        rows = list(ex.map(lambda _: one(model, prompt), range(n)))
    dt = time.time() - t0
    ok = [r for r in rows if r["status"] == 200]
    cnt = Counter(r["tok"] for r in ok)
    errs = Counter(r["status"] for r in rows if r["status"] != 200)
    print(f"[{tag}] model={model} n={n} ok={len(ok)} {dt:.0f}s errs={dict(errs)}")
    print(f"      dist={dict(cnt.most_common(10))}")
    json.dump({"tag": tag, "model": model, "prompt": prompt, "n": n, "rows": rows,
               "dist": dict(cnt), "errors": {str(k): v for k, v in errs.items()}},
              open(os.path.join(RAW, f"E5_{tag}.json"), "w"), ensure_ascii=False, indent=1)
    return cnt


def gtest(c1, c2):
    """G 检验（似然比），并返回归一化距离：G / (n1+n2)，便于跨样本量比较"""
    keys = set(c1) | set(c2)
    n1, n2 = sum(c1.values()), sum(c2.values())
    g = 0.0
    for k in keys:
        o1, o2 = c1.get(k, 0), c2.get(k, 0)
        e1 = n1 * (o1 + o2) / (n1 + n2)
        e2 = n2 * (o1 + o2) / (n1 + n2)
        for o, e in ((o1, e1), (o2, e2)):
            if o > 0 and e > 0:
                g += 2 * o * math.log(o / e)
    df = max(len(keys) - 1, 1)
    return {"G": round(g, 3), "df": df, "G_over_n": round(g / (n1 + n2), 4),
            "chi2_crit_0.001_df%02d" % df: round(_chi2_crit(df, 0.001), 2),
            "p_lt_0.001": g > _chi2_crit(df, 0.001)}


def _chi2_crit(df, alpha):
    # Wilson–Hilferty 近似
    z = {0.05: 1.645, 0.01: 2.326, 0.001: 3.090}[alpha]
    return df * (1 - 2 / (9 * df) + z * math.sqrt(2 / (9 * df))) ** 3


if __name__ == "__main__":
    results = {}
    for pk, prompt in PROMPTS.items():
        for mk, m in MS.items():
            results[f"{pk}|{mk}"] = run(m, prompt, N, f"{pk}_{mk}")
    print("\n########## G 检验矩阵 ##########")
    for pk in PROMPTS:
        keys = [f"{pk}|{mk}" for mk in MS]
        print(f"\n--- prompt={pk!r}")
        for i in range(len(keys)):
            for j in range(i + 1, len(keys)):
                r = gtest(results[keys[i]], results[keys[j]])
                print(f"  {keys[i].split('|')[1]:11s} vs {keys[j].split('|')[1]:11s} "
                      f"G={r['G']:8.2f} df={r['df']:2d} G/n={r['G_over_n']:.4f} p<0.001={r['p_lt_0.001']}")
        # 自身分半（用已存数据）
    json.dump({k: dict(v) for k, v in results.items()},
              open(os.path.join(RAW, "E5_summary.json"), "w"), ensure_ascii=False, indent=1)
