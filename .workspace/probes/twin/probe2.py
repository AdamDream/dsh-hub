#!/usr/bin/env python3
"""补充探针：错误串指纹 / 视觉输入 / 响应头 / 上游标识泄露。"""
import json, os, base64, time, urllib.request, urllib.error
import yaml

BASE = "https://llmapi.roboscience.xyz/v1"
KEY = yaml.safe_load(open(os.path.expanduser("~/.dsh/.credentials.yaml")))["refs"]["ADAM_API_KEY"]
RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw")
os.makedirs(RAW, exist_ok=True)

MS = {"ds-flash": "deepseek-v4-flash", "ds41-flash": "deepseek-v4.1-flash",
      "ds-pro": "deepseek-v4-pro", "ds-vision": "deepseek-v4-flash-vision-exp",
      "glm-flash": "glm-5.3-flash"}

# 1x1 红点 PNG
PNG = ("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/"
       "q842iAAAAAElFTkSuQmCC")

ERRS = {
    "max_tokens_huge": {"messages": [{"role": "user", "content": "hi"}], "max_tokens": 99999999999},
    "temp_bad": {"messages": [{"role": "user", "content": "hi"}], "temperature": 99},
    "empty_msgs": {"messages": []},
    "bad_role": {"messages": [{"role": "wizard", "content": "hi"}], "max_tokens": 4},
    "bad_param": {"messages": [{"role": "user", "content": "hi"}], "max_tokens": 4, "totally_unknown_param": 1},
    "neg_max": {"messages": [{"role": "user", "content": "hi"}], "max_tokens": -5},
}


def post(payload, model, tag, timeout=120):
    body = dict(payload); body["model"] = model
    req = urllib.request.Request(BASE + "/chat/completions", data=json.dumps(body).encode(),
                                headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"})
    rec = {"tag": tag, "model": model, "request": body}
    t0 = time.time()
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
        rec["status"] = r.status
        rec["headers"] = dict(r.headers.items())
        txt = r.read().decode()
        rec["raw"] = txt[:6000]
        try:
            rec["json"] = json.loads(txt)
        except Exception:
            pass
    except urllib.error.HTTPError as e:
        rec["status"] = e.code
        rec["headers"] = dict(e.headers.items())
        rec["raw"] = e.read().decode()[:3000]
    except Exception as e:
        rec["status"] = -1; rec["raw"] = f"{type(e).__name__}: {e}"
    rec["elapsed"] = round(time.time() - t0, 3)
    json.dump(rec, open(os.path.join(RAW, f"{tag}.json"), "w"), ensure_ascii=False, indent=1)
    return rec


print("########## 错误串指纹 ##########")
for mk, m in MS.items():
    print(f"--- {mk} ({m})")
    for ek, ep in ERRS.items():
        r = post(ep, m, f"err_{mk}_{ek}")
        print(f"  {ek:16s} status={r['status']} {str(r.get('raw'))[:150]!r}")

print("\n########## 视觉输入 ##########")
vmsg = [{"role": "user", "content": [
    {"type": "text", "text": "这张图片是什么颜色？只回答颜色。"},
    {"type": "image_url", "image_url": {"url": "data:image/png;base64," + PNG}}]}]
for mk, m in MS.items():
    r = post({"messages": vmsg, "max_tokens": 60, "temperature": 0}, m, f"vis_{mk}")
    j = r.get("json") or {}
    c = ((j.get("choices") or [{}])[0].get("message") or {}).get("content")
    print(f"  {mk:12s} status={r['status']} model={j.get('model')} content={str(c)[:120]!r} "
          f"err={None if j else str(r.get('raw'))[:120]!r}")

print("\n########## 响应头对比 ##########")
for mk, m in MS.items():
    r = post({"messages": [{"role": "user", "content": "hi"}], "max_tokens": 4}, m, f"hdr_{mk}")
    h = {k.lower(): v for k, v in (r.get("headers") or {}).items()}
    keep = {k: v for k, v in h.items() if k in
            ("server", "content-type", "x-request-id", "x-oneapi-request-id", "date",
             "cf-ray", "x-new-api-request-id", "via", "x-envoy-upstream-service-time")}
    print(f"  {mk:12s} {json.dumps(keep, ensure_ascii=False)}")
