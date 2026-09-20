import json, os, time, yaml, urllib.request, urllib.error, hashlib

BASE = "https://llmapi.roboscience.xyz/v1"
KEY = yaml.safe_load(open(os.path.expanduser("~/.dsh/.credentials.yaml")))["refs"]["ADAM_API_KEY"]
HERE = os.path.dirname(os.path.abspath(__file__))

def post(path, payload, timeout=180, stream=False):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(payload).encode(),
        headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"},
        method="POST")
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
        return {"ok": True, "status": 200, "elapsed": time.time()-t0,
                "raw": body.decode("utf-8", "replace")}
    except urllib.error.HTTPError as e:
        return {"ok": False, "status": e.code, "elapsed": time.time()-t0,
                "raw": e.read().decode("utf-8", "replace")}
    except Exception as e:
        return {"ok": False, "status": None, "elapsed": time.time()-t0, "raw": repr(e)}

def get(path, timeout=60):
    req = urllib.request.Request(BASE + path,
        headers={"Authorization": "Bearer " + KEY}, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return "HTTP %s: %s" % (e.code, e.read().decode("utf-8","replace"))
    except Exception as e:
        return repr(e)

def save(name, obj):
    p = os.path.join(HERE, name)
    with open(p, "w") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    return p
