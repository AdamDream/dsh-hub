#!/usr/bin/env python3
"""温和复测（串行 + 限速 + 熔断）——用于补干净样本，避免打断网关。

1) 非思考模式确定性电池：三模型各 2 次，检验同体基线(ds41 vs ds-pro) vs 跨渠道(ds-flash vs ds41)。
2) 负载敏感结论的慢速复核：max_tokens=990000 / n=2 / response_format=json_object。
3) 混淆界定：给 ds41-flash 注入 system 提示词（含"强制以 We 开头"的阳性对照），
   看能否把首 token 分布推向 ds-flash 的形态（We≈99%）。
"""
import json, os, sys, time, urllib.request, urllib.error, yaml

BASE = "https://llmapi.roboscience.xyz/v1/chat/completions"
KEY = yaml.safe_load(open(os.path.expanduser("~/.dsh/.credentials.yaml")))["refs"]["ADAM_API_KEY"]
RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw")
os.makedirs(RAW, exist_ok=True)

PACE = 2.0          # 每次请求间隔（秒）
CONSEC_FAIL_LIMIT = 5
_state = {"fails": 0}


class Breaker(Exception):
    pass


def call(model, payload, timeout=180, retries=3):
    if _state["fails"] >= CONSEC_FAIL_LIMIT:
        raise Breaker(f"连续 {_state['fails']} 次服务端错误，熔断退出")
    body = dict(payload); body["model"] = model
    for a in range(retries):
        time.sleep(PACE)
        req = urllib.request.Request(BASE, data=json.dumps(body).encode(),
                                    headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
        try:
            r = urllib.request.urlopen(req, timeout=timeout)
            _state["fails"] = 0
            return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            code = e.code; e.read()
            if code in (429, 500, 502, 503, 504):
                _state["fails"] += 1
                if a < retries - 1:
                    time.sleep(3.0 * (a + 1)); continue
            return {"_err": code}
        except Exception as e:
            if a < retries - 1:
                time.sleep(3.0 * (a + 1)); continue
            return {"_err": -1, "_msg": str(e)[:80]}
    return {"_err": -2}


def content(j):
    if "_err" in j:
        return None
    ch = (j.get("choices") or [{}])[0]
    return (ch.get("message") or {}).get("content")


M = {"ds-flash": "deepseek-v4-flash", "ds41-flash": "deepseek-v4.1-flash", "ds-pro": "deepseek-v4-pro"}

PROMPTS = {
    "math": "计算 (17*23+456)/12，只输出最终数字。",
    "fact": "中国的首都是哪里？只回答城市名。",
    "code": "用 Python 写一个判断素数的函数，只输出代码块。",
    "list": "列举三种排序算法名称，每行一个，不要编号。",
    "format": "把 'hello world' 转成大写并反转字符顺序，只输出结果。",
    "pie": "圆周率的前 20 位小数是多少？只输出数字。",
    "sum": "1 到 100 的和是多少？只输出数字。",
    "json": "输出一个 JSON：{\"a\":1,\"b\":[2,3]}，不要额外文字。",
    "translate": "把 'the gateway routes requests' 译成中文，只输出译文。",
    "unit": "1 英里等于多少公里？只输出数字（保留三位小数）。",
    "logic": "如果所有 A 都是 B，所有 B 都是 C，那么所有 A 都是 C 吗？只回答 是 或 否。",
    "style": "用一句话（不超过 20 字）描述秋天的杭州。",
    "count": "字符串 'strawberry' 中有几个字母 r？只输出数字。",
    "date": "2026 年 9 月 18 日是星期几？只输出星期几。",
    "sort": "把 [3,1,4,1,5,9,2,6] 升序排序，只输出结果数组。",
}

if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    out = {}

    if which in ("all", "battery"):
        print("########## 1) 非思考模式确定性电池（串行，各 2 次）##########")
        bat = {}
        try:
            for mk, m in M.items():
                bat[mk] = {}
                for pk, p in PROMPTS.items():
                    reps = []
                    for i in range(2):
                        j = call(m, {"messages": [{"role": "user", "content": p}],
                                     "temperature": 0, "max_tokens": 300,
                                     "thinking": {"type": "disabled"}})
                        reps.append({"text": content(j), "err": j.get("_err"),
                                     "ptok": (j.get("usage") or {}).get("prompt_tokens")})
                    bat[mk][pk] = reps
                    print(f"  [{mk:11s}] {pk:10s} ptok={[r['ptok'] for r in reps]} "
                          f"err={[r['err'] for r in reps]} text={str(reps[0]['text'])[:60]!r}")
        except Breaker as e:
            print("  !! 熔断:", e)
        json.dump(bat, open(os.path.join(RAW, "E9_battery.json"), "w"), ensure_ascii=False, indent=1)
        if bat:
            ms = [m for m in M if m in bat and bat[m]]
            print("\n  逐字节一致矩阵（ds-flash 为参照）:")
            agr = {m: 0 for m in ms}
            for pk in PROMPTS:
                a = bat.get("ds-flash", {}).get(pk, [{}])[0].get("text")
                row = []
                for m in ms:
                    b = bat[m].get(pk, [{}])[0].get("text")
                    same = (a is not None and a == b)
                    row.append("同" if same else ("?" if b is None or a is None else "异"))
                    if same:
                        agr[m] += 1
                print(f"    {pk:10s} " + " ".join(f"{m[:9]}={r}" for m, r in zip(ms, row)))
            print("  与 ds-flash 相同数:", {k: f"{v}/{len(PROMPTS)}" for k, v in agr.items()})
            print("  自身 2 次可复现:", {m: sum(1 for pk in PROMPTS if len({r['text'] for r in bat[m][pk]}) == 1) for m in ms})

    if which in ("all", "limits"):
        print("\n########## 2) 负载敏感结论慢速复核 ##########")
        CASES = {
            "mt_990000": {"messages": [{"role": "user", "content": "hi"}], "max_tokens": 990000, "temperature": 0},
            "n2": {"messages": [{"role": "user", "content": "hi"}], "n": 2, "max_tokens": 8, "temperature": 0},
            "json_obj": {"messages": [{"role": "user", "content": "hi"}],
                         "response_format": {"type": "json_object"}, "max_tokens": 20, "temperature": 0},
        }
        res = {}
        try:
            for ck, pl in CASES.items():
                res[ck] = {}
                for mk, m in M.items():
                    j = call(m, pl)
                    res[ck][mk] = {"err": j.get("_err"), "rm": j.get("model"),
                                   "n_choices": len(j.get("choices") or []),
                                   "ptok": (j.get("usage") or {}).get("prompt_tokens")}
                    print(f"  {ck:10s} {mk:11s} err={res[ck][mk]['err']} rm={res[ck][mk]['rm']} "
                          f"n={res[ck][mk]['n_choices']} ptok={res[ck][mk]['ptok']}")
        except Breaker as e:
            print("  !! 熔断:", e)
        json.dump(res, open(os.path.join(RAW, "E9_limits.json"), "w"), ensure_ascii=False, indent=1)

    if which in ("all", "confound"):
        print("\n########## 3) 混淆界定：system 提示词能否把 ds41 推向 ds-flash 形态 ##########")
        N = 25
        SYSS = {
            "api_default": "You are an AI assistant accessed via an API.",
            "force_We": "You must begin every reasoning block with the exact token 'We'.",
            "official_style": ("You are DeepSeek, an AI assistant created by DeepSeek Company. You are a helpful, "
                               "harmless, and honest assistant. Knowledge cutoff: 2026-03. Current date: 2026-09-18. "
                               "Always answer in the user's language. Think step by step before answering."),
        }
        from collections import Counter
        conf = {}
        try:
            for sn, sv in SYSS.items():
                cnt = Counter()
                for i in range(N):
                    j = call("deepseek-v4.1-flash",
                             {"messages": [{"role": "system", "content": sv},
                                           {"role": "user", "content": "hi"}],
                              "max_tokens": 1, "temperature": 1})
                    ch = (j.get("choices") or [{}])[0]
                    tok = (ch.get("message") or {}).get("reasoning_content")
                    if tok is None:
                        tok = (ch.get("message") or {}).get("content")
                    if j.get("_err") is None:
                        cnt[tok] += 1
                conf[sn] = dict(cnt)
                tot = sum(cnt.values())
                print(f"  ds41-flash + system[{sn:15s}] N={tot} We率={cnt.get('We',0)/max(tot,1):.3f} dist={dict(cnt.most_common(6))}")
        except Breaker as e:
            print("  !! 熔断:", e)
        conf["_baseline_nosystem"] = {"We_rate": 0.567, "note": "来自 E7/A_hi_ds41-flash (85/150)"}
        conf["_dsflash_reference"] = {"We_rate": 0.993, "note": "来自 E7/A_hi_ds-flash (149/150)"}
        json.dump(conf, open(os.path.join(RAW, "E9_confound.json"), "w"), ensure_ascii=False, indent=1)
