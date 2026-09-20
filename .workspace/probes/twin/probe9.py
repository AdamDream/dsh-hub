#!/usr/bin/env python3
"""第七轮：关闭 thinking 后的确定性逐字节对比。

关闭 thinking 后无 reasoning 采样，temperature=0 时同模型应高度可复现。
比较：同模型基线(ds41 vs ds-pro, ds41 vs ds41) / 跨渠道(ds-flash vs ds41) / 异体对照(glm)。
若 ds-flash 与 ds41 的一致率显著低于"同体基线"，则两渠道不是同一权重。
"""
import json, os, time, urllib.request, urllib.error, yaml

BASE = "https://llmapi.roboscience.xyz/v1/chat/completions"
KEY = yaml.safe_load(open(os.path.expanduser("~/.dsh/.credentials.yaml")))["refs"]["ADAM_API_KEY"]
RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw")

MODELS = {"ds-flash": "deepseek-v4-flash", "ds41-flash": "deepseek-v4.1-flash",
          "ds-pro": "deepseek-v4-pro", "glm-flash": "glm-5.3-flash"}

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


def call(model, prompt, thinking_off=True, max_tokens=300, timeout=180, retries=3):
    body = {"model": model, "messages": [{"role": "user", "content": prompt}],
            "temperature": 0, "max_tokens": max_tokens}
    if thinking_off:
        body["thinking"] = {"type": "disabled"}
    for a in range(retries):
        req = urllib.request.Request(BASE, data=json.dumps(body).encode(),
                                    headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
        try:
            r = urllib.request.urlopen(req, timeout=timeout)
            return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            code = e.code; e.read()
            if code in (429, 500, 502, 503, 504) and a < retries - 1:
                time.sleep(1.0 * (a + 1)); continue
            return {"_err": code}
        except Exception as e:
            if a < retries - 1:
                time.sleep(1.0 * (a + 1)); continue
            return {"_err": -1, "_msg": str(e)[:80]}
    return {"_err": -2}


def text_of(j):
    if "_err" in j:
        return None
    ch = (j.get("choices") or [{}])[0]
    m = ch.get("message") or {}
    return m.get("content")


if __name__ == "__main__":
    out = {}
    REPS = 3
    for mk, m in MODELS.items():
        out[mk] = {}
        for pk, p in PROMPTS.items():
            got = []
            for i in range(REPS):
                j = call(m, p)
                got.append({"text": text_of(j), "err": j.get("_err"),
                            "rm": j.get("model"), "ptok": (j.get("usage") or {}).get("prompt_tokens"),
                            "ctok": (j.get("usage") or {}).get("completion_tokens")})
            out[mk][pk] = got
            uniq = len({g["text"] for g in got if g["text"] is not None})
            print(f"[{mk:11s}] {pk:10s} uniq={uniq}/{REPS} ptok={[g['ptok'] for g in got]} "
                  f"head={str(got[0]['text'])[:45]!r}")
        json.dump(out, open(os.path.join(RAW, "E8_nothink.json"), "w"), ensure_ascii=False, indent=1)

    print("\n########## 逐 prompt 一致率矩阵（取各模型首次输出比对）##########")
    ms = list(MODELS)
    print(f"{'prompt':10s} " + " ".join(f"{m[:9]:>10s}" for m in ms))
    agree = {m: 0 for m in ms}
    for pk in PROMPTS:
        row = []
        a = out["ds-flash"][pk][0]["text"]
        for mk in ms:
            b = out[mk][pk][0]["text"]
            same = (a == b)
            row.append("同" if same else "异")
            if same:
                agree[mk] += 1
        print(f"{pk:10s} " + " ".join(f"{r:>10s}" for r in row) + f"   | ds-flash 原文={str(a)[:30]!r}")
    print("\n与 ds-flash 首答逐字节相同数:", {k: f"{v}/{len(PROMPTS)}" for k, v in agree.items()})
    # 同模型内部可复现性
    print("\n各模型自身 3 次可复现率:")
    for mk in ms:
        tot = sum(1 for pk in PROMPTS if len({g["text"] for g in out[mk][pk] if g["text"] is not None}) == 1)
        print(f"  {mk:11s} {tot}/{len(PROMPTS)}")
