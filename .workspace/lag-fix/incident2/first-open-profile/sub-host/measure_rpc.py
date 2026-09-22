#!/usr/bin/env python3
"""Measure first-open settings RPC wall time against the LIVE DSH host (read-only RPCs only).

Each rep is a separate `curl` process (fresh TCP connection), matching how the task
asked for measurement. Raw per-rep numbers land in raw-reps.jsonl; shapes in shapes.json.

NO write-RPCs are issued: only *.describe / *.list / *.providers / models are called.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

BASE = "http://127.0.0.1:3080"
OUT = Path(__file__).resolve().parent
REPS = 15

# (endpoint id, URL path, wire method, payload)
ENDPOINTS = [
    ("settings.describe", "/api/settings.describe", "settings.describe", {}),
    ("pluginInventory.list", "/api/pluginInventory/list", "pluginInventory/list", {"args": {}}),
    ("llm.providers", "/api/llm.providers", "llm.providers", {}),
    ("llm.models", "/api/llm.models", "llm.models", {}),
    ("credentials.describe", "/api/credentials.describe", "credentials.describe",
     {"refs": ["DEEPSEEK_API_KEY", "ADAM_API_KEY", "OPENCODE_GO_API_KEY"]}),
]

WRITE_FMT = (r"http=%{http_code} bytes=%{size_download} total=%{time_total} "
             r"connect=%{time_connect} ttfb=%{time_starttransfer} pretransfer=%{time_pretransfer}")


def curl_once(path, method, payload, rpc_id):
    body = json.dumps({"type": "client-request", "rpcId": rpc_id, "method": method, "payload": payload})
    tmp = OUT / "_body.tmp"
    cmd = [
        "curl", "-s", "-o", str(tmp), "-w", WRITE_FMT,
        "-X", "POST", BASE + path,
        "-H", "content-type: application/json",
        "-d", body,
    ]
    t0 = time.time()
    p = subprocess.run(cmd, capture_output=True, text=True)
    wall = (time.time() - t0) * 1000.0
    out = {}
    for tok in p.stdout.strip().split():
        k, v = tok.split("=", 1)
        out[k] = v
    raw = tmp.read_bytes()
    return {
        "http": int(out.get("http", 0)),
        "bytes": int(float(out.get("bytes", 0))),
        "curl_total_ms": round(float(out.get("total", 0)) * 1000, 3),
        "curl_connect_ms": round(float(out.get("connect", 0)) * 1000, 3),
        "curl_ttfb_ms": round(float(out.get("ttfb", 0)) * 1000, 3),
        "curl_pretransfer_ms": round(float(out.get("pretransfer", 0)) * 1000, 3),
        "wall_process_ms": round(wall, 3),
        "rc": p.returncode,
        "_body": raw,
    }


def shape_of(raw):
    """Top-level keys + item counts only; never the whole body."""
    try:
        doc = json.loads(raw)
    except Exception as exc:  # noqa: BLE001
        return {"parse_error": str(exc), "preview": raw[:120].decode("utf-8", "replace")}
    result = doc.get("result", {})
    value = result.get("value")
    sh = {
        "envelope_keys": sorted(doc.keys()),
        "result_ok": result.get("ok"),
        "result_keys": sorted(result.keys()),
        "error": result.get("error"),
    }
    if isinstance(value, dict):
        sh["value_keys"] = sorted(value.keys())
        counts = {}
        keys = {}
        for k, v in value.items():
            if isinstance(v, list):
                counts[k] = len(v)
                if v and isinstance(v[0], dict):
                    keys[k] = sorted(v[0].keys())
            elif isinstance(v, dict):
                counts[k] = len(v)
                keys[k] = sorted(v.keys())[:10]
        sh["list_or_map_counts"] = counts
        sh["item_keys"] = keys
    return sh


def main():
    rounds = int(sys.argv[1]) if len(sys.argv) > 1 else REPS
    tag = sys.argv[2] if len(sys.argv) > 2 else "run1"
    raw_path = OUT / f"raw-reps-{tag}.jsonl"
    shapes = {}
    with raw_path.open("w") as fh:
        for eid, path, method, payload in ENDPOINTS:
            # one warm-up rep (NOT measured) so that curl/process/DNS noise is not the first sample
            curl_once(path, method, payload, f"{eid}-warmup")
            time.sleep(0.2)
            reps = []
            for i in range(1, rounds + 1):
                r = curl_once(path, method, payload, f"x{i}")
                raw = r.pop("_body")
                r["rep"] = i
                reps.append(r)
                fh.write(json.dumps({"endpoint": eid, **r}) + "\n")
                fh.flush()
                if i == 1:
                    shapes[eid] = shape_of(raw)
                time.sleep(0.05)
            print(f"{eid}: {len(reps)} reps done; status={reps[0]['http']} bytes={reps[0]['bytes']}", flush=True)
    (OUT / "shapes.json").write_text(json.dumps(shapes, indent=2, ensure_ascii=False))
    print("raw ->", raw_path)


if __name__ == "__main__":
    main()
