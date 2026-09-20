#!/usr/bin/env python3
"""adam 网关 deepseek-v4-flash vs deepseek-v4.1-flash 同体性探针。

证据全部落盘到 raw/ 目录（每个请求一份完整 JSON）。
用法: python3 probe.py <suite>
suite: meta | tokenizer | determinism | params | logprob
"""
import json, os, sys, time, hashlib, urllib.request, urllib.error

BASE = "https://llmapi.roboscience.xyz/v1"
import yaml
KEY = yaml.safe_load(open(os.path.expanduser("~/.dsh/.credentials.yaml")))["refs"]["ADAM_API_KEY"]
RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw")
os.makedirs(RAW, exist_ok=True)

MS = {
    "ds-flash": "deepseek-v4-flash",
    "ds41-flash": "deepseek-v4.1-flash",
    "ds-pro": "deepseek-v4-pro",
    "glm-flash": "glm-5.3-flash",   # 阳性对照：确定是另一种模型
    "qwen38-flash": "qwen3.8-flash",
}


def call(model, payload, tag, timeout=180):
    body = dict(payload)
    body["model"] = model
    data = json.dumps(body).encode()
    req = urllib.request.Request(BASE + "/chat/completions", data=data,
                                headers={"Authorization": "Bearer " + KEY,
                                         "Content-Type": "application/json"})
    t0 = time.time()
    rec = {"tag": tag, "model": model, "request": body, "t0": t0}
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
        txt = r.read().decode()
        rec["status"] = r.status
        rec["headers"] = {k: v for k, v in r.headers.items()}
        rec["raw"] = txt
        try:
            rec["json"] = json.loads(txt)
        except Exception:
            pass
    except urllib.error.HTTPError as e:
        rec["status"] = e.code
        rec["headers"] = {k: v for k, v in e.headers.items()}
        rec["raw"] = e.read().decode()[:4000]
    except Exception as e:
        rec["status"] = -1
        rec["error"] = f"{type(e).__name__}: {e}"
    rec["elapsed"] = round(time.time() - t0, 3)
    fn = os.path.join(RAW, f"{tag}.json")
    with open(fn, "w") as f:
        json.dump(rec, f, ensure_ascii=False, indent=1)
    return rec


def brief(rec):
    j = rec.get("json") or {}
    u = j.get("usage") or {}
    ch = (j.get("choices") or [{}])[0]
    msg = ch.get("message") or {}
    content = (msg.get("content") or "")
    return {
        "status": rec.get("status"),
        "resp_model": j.get("model"),
        "id": j.get("id"),
        "sysfpr": j.get("system_fingerprint"),
        "usage": u,
        "finish": ch.get("finish_reason"),
        "content_sha": hashlib.sha256(content.encode()).hexdigest()[:16],
        "content_len": len(content),
        "content_head": content[:160].replace("\n", "\\n"),
        "elapsed": rec.get("elapsed"),
        "err": (rec.get("raw") or "")[:200] if not j else None,
    }


# ---------------- tokenizer fingerprint strings ----------------
TOK_PROBES = {
    "zh_common": "今天天气很好，我们一起去公园散步吧。",
    "zh_rare": "龘靐齉爩麤灪龖厵纞虋饢鱻羴犇毳",
    "en_prose": "The quick brown fox jumps over the lazy dog near the riverbank.",
    "code_py": "def f(x: int) -> int:\n    return x ** 2 + 1\n",
    "json_blob": '{"a":1,"b":[true,null,"x"],"c":{"d":3.14}}',
    "digits": "1234567890" * 8,
    "emoji": "😀😃😄😁😆😅🤣😂🙂🙃😉😊😇" * 3,
    "mixed_ws": "a  b\t\tc\n\n\nd     e",
    "url_path": "https://llmapi.roboscience.xyz/v1/chat/completions?x=1&y=2",
    "cjk_punct": "「测试」——……（一）、；：？！【】《》",
    "base64ish": "aGVsbG8gd29ybGQgdGhpcyBpcyBhIHRlc3Q=",
    "sql": "SELECT id, name FROM users WHERE age > 30 ORDER BY id DESC LIMIT 10;",
    "long_repeat": "测试" * 100,
    "hash_like": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
}


def suite_tokenizer(models):
    out = {}
    for mk in models:
        m = MS[mk]
        rows = {}
        for pk, txt in TOK_PROBES.items():
            # 每条消息本身有 ~4 token 模板开销；比较的是相对差异
            rec = call(m, {"messages": [{"role": "user", "content": txt}],
                           "max_tokens": 1, "temperature": 0}, f"tok_{mk}_{pk}")
            u = (rec.get("json") or {}).get("usage") or {}
            rows[pk] = {"prompt_tokens": u.get("prompt_tokens"), "status": rec.get("status"),
                        "err": None if rec.get("json") else (rec.get("raw") or "")[:120]}
        out[mk] = rows
        print(mk, json.dumps(rows, ensure_ascii=False))
    json.dump(out, open(os.path.join(RAW, "tokenizer_summary.json"), "w"), ensure_ascii=False, indent=1)
    return out


# ---------------- determinism / behavioral battery ----------------
DET_PROMPTS = {
    "selfid": "你是谁？请用一句话回答，并说明你的模型名称与版本号。",
    "math": "计算 17*23+456/12 的结果，先给出思考要点再给最终答案。",
    "zh_essay": "用大约120字介绍杭州西湖，要求语言平实。",
    "code": "用 Python 写一个函数，返回斐波那契数列前 n 项，要求带类型标注。",
    "translate": "把这句话翻译成英文：我们明天上午十点在会议室讨论网关的模型路由策略。",
    "reason": "一个班有 40 名学生，其中 25 人喜欢数学，20 人喜欢物理，8 人两者都喜欢。问两者都不喜欢的有多少人？请给出计算过程。",
    "rand": "请输出一个 1 到 1000 之间的随机整数，只输出数字。",
    "list": "列举三种常见的负载均衡算法，每种一句话说明。",
}


def suite_determinism(models, reps=3):
    out = {}
    for mk in models:
        m = MS[mk]
        out[mk] = {}
        for pk, txt in DET_PROMPTS.items():
            outs = []
            for i in range(reps):
                rec = call(m, {"messages": [{"role": "user", "content": txt}],
                               "temperature": 0, "max_tokens": 400}, f"det_{mk}_{pk}_r{i}")
                j = rec.get("json") or {}
                ch = (j.get("choices") or [{}])[0]
                content = ((ch.get("message") or {}).get("content") or "")
                outs.append({"sha": hashlib.sha256(content.encode()).hexdigest()[:16],
                             "text": content, "usage": j.get("usage"),
                             "resp_model": j.get("model"), "id": j.get("id"),
                             "finish": ch.get("finish_reason"), "status": rec.get("status"),
                             "err": None if j else (rec.get("raw") or "")[:150]})
            out[mk][pk] = outs
        print(f"[det] {mk} done")
    json.dump(out, open(os.path.join(RAW, "determinism_summary.json"), "w"), ensure_ascii=False, indent=1)
    return out


# ---------------- parameter acceptance ----------------
def suite_params(models):
    P = {
        "temp1.5": {"temperature": 1.5, "max_tokens": 8},
        "temp2": {"temperature": 2.0, "max_tokens": 8},
        "top_p0": {"top_p": 0.0, "max_tokens": 8},
        "top_k": {"top_k": 5, "max_tokens": 8},
        "freq_pen": {"frequency_penalty": 1.0, "max_tokens": 8},
        "pres_pen": {"presence_penalty": 1.0, "max_tokens": 8},
        "seed": {"seed": 42, "max_tokens": 8},
        "logprobs": {"logprobs": True, "top_logprobs": 3, "max_tokens": 4},
        "n2": {"n": 2, "max_tokens": 8},
        "json_obj": {"response_format": {"type": "json_object"}, "max_tokens": 30},
        "stop": {"stop": ["\n"], "max_tokens": 16},
        "tools": {"tools": [{"type": "function", "function": {"name": "get_time",
                  "description": "get current time", "parameters": {"type": "object", "properties": {}}}}],
                  "max_tokens": 40},
        "mt_reasoning": {"reasoning_effort": "high", "max_tokens": 8},
        "mt_huge": {"max_tokens": 990000},
        "mt_over": {"max_tokens": 2000000},
        "mt_neg": {"max_tokens": -1},
        "stream_flag": {"stream": True, "max_tokens": 4},
    }
    out = {}
    for mk in models:
        m = MS[mk]
        out[mk] = {}
        for pk, extra in P.items():
            pl = {"messages": [{"role": "user", "content": "hi"}], "temperature": 0}
            pl.update(extra)
            tag = f"par_{mk}_{pk}"
            if pl.get("stream"):
                rec = stream_call(m, pl, tag)
                out[mk][pk] = {"status": rec.get("status"), "chunks": rec.get("n_chunks"),
                               "err": None if rec.get("status") == 200 else (rec.get("raw") or "")[:200]}
            else:
                rec = call(m, pl, tag, timeout=300)
                j = rec.get("json") or {}
                out[mk][pk] = {"status": rec.get("status"), "resp_model": j.get("model"),
                               "has_logprobs": bool((j.get("choices") or [{}])[0].get("logprobs")),
                               "n_choices": len(j.get("choices") or []),
                               "usage": j.get("usage"),
                               "err": None if j else (rec.get("raw") or "")[:220]}
        print(f"[par] {mk} done")
    json.dump(out, open(os.path.join(RAW, "params_summary.json"), "w"), ensure_ascii=False, indent=1)
    return out


def stream_call(model, payload, tag, timeout=120):
    body = dict(payload); body["model"] = model
    req = urllib.request.Request(BASE + "/chat/completions", data=json.dumps(body).encode(),
                                headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
    rec = {"tag": tag, "model": model, "request": body}
    t0 = time.time()
    chunks, ttf = [], None
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
        rec["status"] = r.status
        rec["headers"] = {k: v for k, v in r.headers.items()}
        raw = b""
        while True:
            b = r.read(256)
            if not b:
                break
            raw += b
        rec["raw"] = raw.decode(errors="replace")[:20000]
        for line in rec["raw"].split("\n"):
            if line.startswith("data: ") and line.strip() != "data: [DONE]":
                chunks.append(line[6:])
                if ttf is None:
                    ttf = time.time() - t0
    except urllib.error.HTTPError as e:
        rec["status"] = e.code; rec["raw"] = e.read().decode()[:2000]
    except Exception as e:
        rec["status"] = -1; rec["raw"] = f"{type(e).__name__}: {e}"
    rec["n_chunks"] = len(chunks); rec["ttft"] = ttf; rec["elapsed"] = round(time.time() - t0, 3)
    json.dump(rec, open(os.path.join(RAW, f"{tag}.json"), "w"), ensure_ascii=False, indent=1)
    return rec


def suite_meta(models):
    out = {}
    for mk in models:
        m = MS[mk]
        rec = call(m, {"messages": [{"role": "user", "content": "1+1=?"}], "temperature": 0, "max_tokens": 4},
                   f"meta_{mk}")
        out[mk] = brief(rec)
        print(mk, json.dumps(out[mk], ensure_ascii=False)[:600])
    json.dump(out, open(os.path.join(RAW, "meta_summary.json"), "w"), ensure_ascii=False, indent=1)
    return out


if __name__ == "__main__":
    suite = sys.argv[1]
    models = sys.argv[2].split(",") if len(sys.argv) > 2 else ["ds-flash", "ds41-flash"]
    if suite == "meta":
        suite_meta(models)
    elif suite == "tokenizer":
        suite_tokenizer(models)
    elif suite == "determinism":
        suite_determinism(models, int(sys.argv[3]) if len(sys.argv) > 3 else 3)
    elif suite == "params":
        suite_params(models)
    else:
        print("unknown suite")
