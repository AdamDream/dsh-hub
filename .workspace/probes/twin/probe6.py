#!/usr/bin/env python3
"""第四轮：聚合渠道是否"一名多体/一体多名" + 模板开销结构定位。"""
import json, os, time, urllib.request, urllib.error
import yaml

BASE = "https://llmapi.roboscience.xyz/v1"
KEY = yaml.safe_load(open(os.path.expanduser("~/.dsh/.credentials.yaml")))["refs"]["ADAM_API_KEY"]
RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw")


def post(model, payload, tag, timeout=200):
    body = dict(payload); body["model"] = model
    req = urllib.request.Request(BASE + "/chat/completions", data=json.dumps(body).encode(),
                                headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
    rec = {"tag": tag, "model": model, "request": body}
    t0 = time.time()
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
        rec["status"] = r.status
        txt = r.read().decode(); rec["raw"] = txt[:60000]
        try: rec["json"] = json.loads(txt)
        except Exception: pass
    except urllib.error.HTTPError as e:
        rec["status"] = e.code; rec["raw"] = e.read().decode()[:1500]
    except Exception as e:
        rec["status"] = -1; rec["raw"] = f"{type(e).__name__}: {e}"
    rec["elapsed"] = round(time.time() - t0, 3)
    json.dump(rec, open(os.path.join(RAW, f"{tag}.json"), "w"), ensure_ascii=False, indent=1)
    return rec


print("########## E6a: 聚合渠道 deepseek/* 下的其它别名是否同一模型（logprob 指纹）##########")
CANDS = {"ds41-flash": "deepseek-v4.1-flash", "ds-pro": "deepseek-v4-pro",
         "ds-vision-exp": "deepseek-v4-flash-vision-exp"}
for pk, txt in {"p_zh": "请用一句话说明什么是网关。", "p_hi": "hi"}.items():
    for mk, m in CANDS.items():
        for i in range(2):
            rec = post(m, {"messages": [{"role": "user", "content": txt}], "max_tokens": 2,
                           "temperature": 0, "logprobs": True, "top_logprobs": 5},
                       f"E6a_{mk}_{pk}_r{i}")
            j = rec.get("json") or {}
            ch = (j.get("choices") or [{}])[0]
            lp = ch.get("logprobs") or {}
            arr = lp.get("reasoning_content") or lp.get("content") or []
            first = (arr[0]["token"], round(arr[0]["logprob"], 4),
                     [(t["token"], round(t["logprob"], 4)) for t in (arr[0].get("top_logprobs") or [])]) if arr else None
            print(f"  {pk} {mk:14s} rm={j.get('model')} ptok={(j.get('usage') or {}).get('prompt_tokens')} lp={first} "
                  f"{'' if j else str(rec.get('raw'))[:80]}")

print("\n########## E6b: 模板/前缀开销结构（prompt_tokens 差值随轮数变化）##########")
for mk, m in {"ds-flash": "deepseek-v4-flash", "ds41-flash": "deepseek-v4.1-flash"}.items():
    for nturns in [1, 2, 4, 8]:
        msgs = []
        for i in range(nturns):
            msgs.append({"role": "user" if i % 2 == 0 else "assistant", "content": "hi"})
        rec = post(m, {"messages": msgs, "max_tokens": 1, "temperature": 0}, f"E6b_{mk}_turn{nturns}")
        j = rec.get("json") or {}
        print(f"  {mk:12s} turns={nturns} ptok={(j.get('usage') or {}).get('prompt_tokens')} "
              f"status={rec['status']} {'' if j else str(rec.get('raw'))[:70]}")

print("\n########## E6c: 显式 system 消息是否改变差值 ##########")
for mk, m in {"ds-flash": "deepseek-v4-flash", "ds41-flash": "deepseek-v4.1-flash"}.items():
    for sname, sysmsg in [("none", None), ("short", "S"), ("long", "You are a helpful assistant. " * 10)]:
        msgs = ([{"role": "system", "content": sysmsg}] if sysmsg else []) + [{"role": "user", "content": "hi"}]
        rec = post(m, {"messages": msgs, "max_tokens": 1, "temperature": 0}, f"E6c_{mk}_{sname}")
        j = rec.get("json") or {}
        print(f"  {mk:12s} sys={sname:5s} ptok={(j.get('usage') or {}).get('prompt_tokens')} "
              f"status={rec['status']} {'' if j else str(rec.get('raw'))[:70]}")
