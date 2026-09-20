#!/usr/bin/env python3
"""第三轮：绕过 logprobs 缺口 + 能力边界复测 + 采样分布对比。"""
import json, os, sys, time, urllib.request, urllib.error
import yaml

BASE = "https://llmapi.roboscience.xyz/v1"
KEY = yaml.safe_load(open(os.path.expanduser("~/.dsh/.credentials.yaml")))["refs"]["ADAM_API_KEY"]
RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw")
os.makedirs(RAW, exist_ok=True)
MS = {"ds-flash": "deepseek-v4-flash", "ds41-flash": "deepseek-v4.1-flash", "ds-pro": "deepseek-v4-pro"}


def post(model, payload, tag, path="/chat/completions", timeout=200):
    body = dict(payload); body["model"] = model
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(),
                                headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
    rec = {"tag": tag, "model": model, "path": path, "request": body}
    t0 = time.time()
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
        rec["status"] = r.status
        txt = r.read().decode(); rec["raw"] = txt[:100000]
        try: rec["json"] = json.loads(txt)
        except Exception: pass
    except urllib.error.HTTPError as e:
        rec["status"] = e.code; rec["raw"] = e.read().decode()[:2000]
    except Exception as e:
        rec["status"] = -1; rec["raw"] = f"{type(e).__name__}: {e}"
    rec["elapsed"] = round(time.time() - t0, 3)
    json.dump(rec, open(os.path.join(RAW, f"{tag}.json"), "w"), ensure_ascii=False, indent=1)
    return rec


def summarize(rec):
    j = rec.get("json") or {}
    ch = (j.get("choices") or [{}])[0]
    lp = ch.get("logprobs")
    first = None
    if isinstance(lp, dict):
        for k in ("content", "reasoning_content"):
            if lp.get(k):
                t = lp[k][0]
                first = (t["token"], round(t["logprob"], 4),
                         [(x["token"], round(x["logprob"], 4)) for x in (t.get("top_logprobs") or [])][:5])
                break
    return {"status": rec["status"], "rm": j.get("model"), "lp": first,
            "ptok": (j.get("usage") or {}).get("prompt_tokens"),
            "err": None if j else str(rec.get("raw"))[:110]}


print("########## E4a: 旧版 /completions 端点 + logprobs 变体 ##########")
for mk, m in MS.items():
    r1 = post(m, {"prompt": "hi", "max_tokens": 3, "temperature": 0, "logprobs": 5, "echo": True},
              f"E4a_{mk}_completions_lp5", path="/completions")
    print(f"  {mk:12s} /completions lp=5      {summarize(r1)}")
    r2 = post(m, {"prompt": "hi", "max_tokens": 3, "temperature": 0, "logprobs": True, "echo": True},
              f"E4a_{mk}_completions_lpbool", path="/completions")
    print(f"  {mk:12s} /completions lp=True   {summarize(r2)}")
    r3 = post(m, {"messages": [{"role": "user", "content": "hi"}], "max_tokens": 3,
                  "temperature": 0, "logprobs": 5},
              f"E4a_{mk}_chat_lpint")
    print(f"  {mk:12s} /chat lp=5(int)        {summarize(r3)}")

print("\n########## E4b: max_tokens 接受边界 ##########")
for mk, m in MS.items():
    line = []
    for mt in [8192, 65536, 393216, 990000, 1000000, 2000000]:
        r = post(m, {"messages": [{"role": "user", "content": "hi"}], "max_tokens": mt, "temperature": 0},
                 f"E4b_{mk}_{mt}")
        s = summarize(r)
        line.append(f"{mt}:{s['status']}{'' if s['status']==200 else '/'+str(s['err'])[:40]}")
    print(f"  {mk:12s} {line}")

print("\n########## E4c: 参数级拒绝 复测(3 次) ##########")
CASES = {"n2": {"n": 2, "max_tokens": 8}, "json_obj": {"response_format": {"type": "json_object"}, "max_tokens": 20},
         "top_p0": {"top_p": 0.0, "max_tokens": 8}, "temp99": {"temperature": 99, "max_tokens": 8}}
for mk, m in MS.items():
    for ck, extra in CASES.items():
        res = []
        for i in range(3):
            pl = {"messages": [{"role": "user", "content": "hi"}], "temperature": 0}; pl.update(extra)
            r = post(m, pl, f"E4c_{mk}_{ck}_r{i}")
            s = summarize(r)
            res.append(f"{s['status']}:{s['rm']}" + ("" if s['status'] == 200 else f"({str(s['err'])[:45]})"))
        print(f"  {mk:12s} {ck:9s} {res}")

print("\n########## E4d: 采样分布对比（同一近确定性上下文，各 12 次）##########")
# 用一个"高确定度"的续写上下文，看首 token 分布是否重合
CTX = "Question: 2+2=? Answer:"
for mk, m in MS.items():
    toks = []
    for i in range(12):
        r = post(m, {"messages": [{"role": "user", "content": CTX}], "max_tokens": 2, "temperature": 0},
                 f"E4d_{mk}_r{i}")
        j = r.get("json") or {}
        ch = (j.get("choices") or [{}])[0]
        msg = ch.get("message") or {}
        toks.append(((msg.get("reasoning_content") or "")[:20], (msg.get("content") or "")[:20]))
    print(f"  {mk:12s} {toks}")
