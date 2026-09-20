#!/usr/bin/env python3
"""原生多模态能力测试：deepseek-v4-pro 是否与 deepseek-v4.1-flash 一样原生支持图片。

设计要点（关键在于"能证伪"）：
- 用**不可猜的非词（nonce）**与**需要逐图跟踪的纯色**做判据：看不见图的模型不可能逐图答对。
- **对照组**：已知声明支持图片的 deepseek-v4.1-flash / deepseek-v4-flash-vision-exp 为阳性对照；
  已知看不见图的 deepseek-v4-flash 为阴性对照。
- **无图对照**：同一问题不带图片再问一次，用于识别"不看图也能瞎答对"的情况。
- 记录响应里的 model 字段：图片请求是否被路由到别的渠道（此前观察到 ds-pro 带图时回显自身名）。
- 串行 + 限速，避免打断网关（此前高并发导致 503）。
"""
import base64, json, os, sys, time, urllib.request, urllib.error
import yaml

D = os.path.dirname(os.path.abspath(__file__))
BASE = "https://llmapi.roboscience.xyz/v1/chat/completions"
KEY = yaml.safe_load(open(os.path.expanduser("~/.dsh/.credentials.yaml")))["refs"]["ADAM_API_KEY"]
TRUTH = json.load(open(os.path.join(D, "truth.json")))

MODELS = {
    "ds-pro":        "deepseek-v4-pro",              # ← 待测对象（settings 未声明 input: image）
    "ds41-flash":    "deepseek-v4.1-flash",          # 阳性对照（已声明 image，且与 pro 同体）
    "ds-vision-exp": "deepseek-v4-flash-vision-exp",  # 阳性对照（已声明 image）
    "ds-flash":      "deepseek-v4-flash",            # 阴性对照（未声明，实测看不见图）
}

QUESTION = {
    "color": "这张图片主要是什么颜色？只回答一个颜色词（红/绿/蓝/其它）。",
    "text":  "图片里的文字是什么？只逐字转录字符本身。",
    "count": "图中有几个圆形？只回答数字。",
}


def b64(name):
    return base64.b64encode(open(os.path.join(D, name + ".png"), "rb").read()).decode()


def call(model, content, max_tokens=600, thinking_off=True, timeout=180, retries=3):
    body = {"model": model, "messages": [{"role": "user", "content": content}],
            "temperature": 0, "max_tokens": max_tokens}
    if thinking_off:
        body["thinking"] = {"type": "disabled"}
    for a in range(retries):
        time.sleep(1.5)
        req = urllib.request.Request(BASE, data=json.dumps(body).encode(),
                                    headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
        try:
            r = urllib.request.urlopen(req, timeout=timeout)
            j = json.loads(r.read().decode())
            ch = (j.get("choices") or [{}])[0]
            m = ch.get("message") or {}
            u = j.get("usage") or {}
            return {"ok": True, "rm": j.get("model"), "content": m.get("content"),
                    "reasoning_len": len(m.get("reasoning_content") or ""),
                    "ptok": u.get("prompt_tokens"), "ctok": u.get("completion_tokens"),
                    "reasoning_tok": (u.get("completion_tokens_details") or {}).get("reasoning_tokens")}
        except urllib.error.HTTPError as e:
            code = e.code; body_txt = e.read().decode()[:200]
            if code in (429, 500, 502, 503, 504) and a < retries - 1:
                time.sleep(3.0 * (a + 1)); continue
            return {"ok": False, "err": f"HTTP {code} {body_txt[:120]}"}
        except Exception as e:
            if a < retries - 1:
                time.sleep(3.0 * (a + 1)); continue
            return {"ok": False, "err": str(e)[:120]}
    return {"ok": False, "err": "retries exhausted"}


def run_with_image(model, name, meta):
    q = QUESTION[meta["kind"]]
    content = [{"type": "text", "text": q},
               {"type": "image_url", "image_url": {"url": "data:image/png;base64," + b64(name)}}]
    r = call(model, content)
    r.update({"case": name, "kind": meta["kind"], "truth": meta["truth"]})
    return r


def run_no_image(model, kind):
    r = call(model, QUESTION[kind])
    r.update({"case": "NO_IMAGE", "kind": kind, "truth": None})
    return r


if __name__ == "__main__":
    results = {}
    use = sys.argv[1].split(",") if len(sys.argv) > 1 else list(MODELS)
    for mk in use:
        m = MODELS[mk]
        print(f"\n########## {mk}  ({m})")
        results[mk] = {"model": m, "with_image": [], "no_image": []}
        for name, meta in TRUTH.items():
            r = run_with_image(m, name, meta)
            results[mk]["with_image"].append(r)
            verdict = "ERR" if not r["ok"] else "OK"
            print(f"  [{verdict}] {name:16s} 真值={meta['truth']!s:6s} rm={r.get('rm')} "
                  f"ptok={r.get('ptok')} ctok={r.get('ctok')} reason_tok={r.get('reasoning_tok')} "
                  f"ans={str(r.get('content'))[:60]!r} {r.get('err','')}")
        for kind in ("color", "text"):
            r = run_no_image(m, kind)
            results[mk]["no_image"].append(r)
            print(f"  [无图对照 {kind:5s}] rm={r.get('rm')} ans={str(r.get('content'))[:60]!r} {r.get('err','')}")
    json.dump(results, open(os.path.join(D, "results.json"), "w"), ensure_ascii=False, indent=1)
    print("\n== saved results.json ==")
