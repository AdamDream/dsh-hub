#!/usr/bin/env python3
"""Aggregate the raw probe output into host-rpc-latency.json (no body contents, shapes only)."""
import json
import statistics as st
from collections import defaultdict
from pathlib import Path

OUT = Path(__file__).resolve().parent
HOST = "http://127.0.0.1:3080"
HOST_PID = 10806

ENDPOINTS = {
    "settings.describe": {
        "mount": "/api/settings.describe",
        "wire_method": "settings.describe",
        "payload": {},
        "source": "host plugin dsh-host-apiproxy: /home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js:3475-3483",
    },
    "pluginInventory.list": {
        "mount": "/api/pluginInventory/list",
        "wire_method": "pluginInventory/list",
        "payload": {"args": {}},
        "source": "typert Remote /api/<namespace>/<method>; host impl dsh-host-plugin-inventory/lib/index.js:96-112",
    },
    "llm.providers": {
        "mount": "/api/llm.providers",
        "wire_method": "llm.providers",
        "payload": {},
        "source": "dsh-host-apiproxy/lib/index.js:3569-3597",
    },
    "llm.models": {
        "mount": "/api/llm.models",
        "wire_method": "llm.models",
        "payload": {},
        "source": "dsh-host-apiproxy/lib/index.js:3595-3597 -> buildModelCatalog index.js:1010-1052",
    },
    "credentials.describe": {
        "mount": "/api/credentials.describe",
        "wire_method": "credentials.describe",
        "payload": {"refs": ["DEEPSEEK_API_KEY", "ADAM_API_KEY", "OPENCODE_GO_API_KEY"]},
        "source": "dsh-host-apiproxy/lib/index.js:3524-3540",
    },
}


def load_jsonl(name):
    p = OUT / name
    if not p.exists():
        return []
    return [json.loads(line) for line in p.read_text().splitlines() if line.strip()]


def describe(vals):
    v = sorted(vals)
    if not v:
        return None
    n = len(v)
    return {
        "n": n,
        "min": round(v[0], 3),
        "p25": round(v[n // 4], 3),
        "median": round(st.median(v), 3),
        "p75": round(v[(3 * n) // 4], 3),
        "p90": round(v[min(n - 1, int(0.9 * n))], 3),
        "p99": round(v[min(n - 1, int(0.99 * n))], 3),
        "max": round(v[-1], 3),
        "mean": round(st.mean(v), 3),
        "stdev": round(st.pstdev(v), 3),
    }


def main():
    shapes = json.loads((OUT / "shapes.json").read_text())
    run1 = load_jsonl("raw-reps-run1.jsonl")
    run2 = load_jsonl("raw-reps-run2.jsonl")
    ka = load_jsonl("raw-reps-keepalive.jsonl")

    endpoints = {}
    for eid, meta in ENDPOINTS.items():
        r1 = [r for r in run1 if r["endpoint"] == eid]
        r2 = [r for r in run2 if r["endpoint"] == eid]
        k = [r for r in ka if r["endpoint"] == eid]
        total = r1 + r2
        endpoints[eid] = {
            **meta,
            "http_status": sorted({r["http"] for r in total}),
            "response_bytes": sorted({r["bytes"] for r in total}),
            "curl_exit_codes": sorted({r["rc"] for r in total}),
            "reps_curl_ms": [{"phase": "run1", "rep": r["rep"], "total_ms": r["curl_total_ms"],
                              "connect_ms": r["curl_connect_ms"], "ttfb_ms": r["curl_ttfb_ms"],
                              "http": r["http"], "bytes": r["bytes"]} for r in total],
            "reps_keepalive_ms": [{"rep": r["rep"], "ms": r["ms"], "fresh_socket": r["fresh_socket"],
                                   "http": r["status"], "bytes": r["bytes"]} for r in k],
            "stats_curl_run1_n15": describe([r["curl_total_ms"] for r in r1]),
            "stats_curl_run2_n40": describe([r["curl_total_ms"] for r in r2]),
            "stats_curl_combined_n55": describe([r["curl_total_ms"] for r in total]),
            "stats_keepalive_n25": describe([r["ms"] for r in k]),
            "connect_overhead_ms_median": round(st.median([r["curl_connect_ms"] for r in total]), 3),
            "response_shape": shapes.get(eid),
        }

    concurrency = defaultdict(list)
    for r in load_jsonl("raw-reps-concurrent.jsonl"):
        concurrency[r["endpoint"]].append(r)
    concurrent_summary = {e: {
        "width": 4, "reps": len(rs),
        "median_per_request_ms": round(st.median([m for r in rs for m in r["ms"]]), 3),
        "median_burst_wall_ms": round(st.median([r["wall_ms"] for r in rs]), 3),
        "median_intra_burst_spread_ms": round(st.median([r["spread_ms"] for r in rs]), 3),
        "reps": rs,
    } for e, rs in concurrency.items()}

    burst = load_jsonl("raw-reps-burst.jsonl")
    mixed_burst = {
        "description": "the 4 settings-open RPCs fired CONCURRENTLY (as the browser does), 20 reps",
        "median_burst_wall_ms": round(st.median([r["burst_wall_ms"] for r in burst]), 3) if burst else None,
        "min_burst_wall_ms": round(min([r["burst_wall_ms"] for r in burst]), 3) if burst else None,
        "max_burst_wall_ms": round(max([r["burst_wall_ms"] for r in burst]), 3) if burst else None,
        "per_endpoint_median_ms": {e: round(st.median(v), 3) for e, v in (
            (e, [q["ms"] for r in burst for q in r["requests"] if q["endpoint"] == e]) for e in ENDPOINTS
        ) if v} if burst else None,
        "reps": burst,
    }

    ambient = load_jsonl("raw-reps-ambient.jsonl")
    ambient_summary = {
        "description": "interleaved control (no-op credentials.describe refs:[]) at width 1 and 4, and settings.describe at width 4",
        "control_w1_ms": describe([r["control_w1_ms"] for r in ambient]),
        "control_w4_ms": describe([m for r in ambient for m in r["control_w4_ms"]]),
        "settings_describe_w4_ms": describe([m for r in ambient for m in r["heavy_w4_ms"]]),
        "reps": ambient,
    }

    hb = load_jsonl("raw-heartbeat.jsonl")
    hb1 = load_jsonl("raw-heartbeat-run1.jsonl")

    def hb_report(samples, label):
        v = sorted(s["ms"] for s in samples)
        if not v:
            return None
        return {"label": label, "n": len(v), "p50": round(v[len(v) // 2], 3),
                "p90": round(v[int(0.9 * len(v))], 3), "p99": round(v[int(0.99 * len(v))], 3),
                "max": round(v[-1], 3),
                "pct_over_20ms": round(100 * sum(1 for x in v if x > 20) / len(v), 1),
                "samples": samples}

    doc = {
        "generated_at": None,
        "probe": "host-side settings first-open RPC profile",
        "host": {"url": HOST, "pid": HOST_PID, "cmdline": "node /home/CNS2026495165/.npm-global/bin/dsh web"},
        "read_only_statement": "Only read RPCs were issued (*.describe / *.list / *.providers / models). No product file was written; no save/apply/delete call; the host process was never signalled.",
        "load_context": json.loads((OUT / "load-context.json").read_text()),
        "methodology": {
            "curl": "one curl process per rep (fresh TCP connection); -w http_code/size_download/time_total/time_connect/time_starttransfer",
            "keepalive": "node:http single keep-alive socket, 25 reps, isolates handler time from process/connect cost",
            "warmup": "one unmeasured warm-up call per endpoint before each measured set",
            "rpc_envelope": {"type": "client-request", "rpcId": "<echoed>", "method": "<wire method>", "payload": "<per endpoint>"},
        },
        "endpoints": endpoints,
        "concurrency_probe": concurrent_summary,
        "mixed_first_open_burst": mixed_burst,
        "ambient_stall_probe": ambient_summary,
        "heartbeat_probe": {
            "description": "cheapest possible read RPC (credentials.describe with refs:[]) issued back-to-back on one socket for 20 s; a no-op that isolates HOST EVENT-LOOP availability",
            "run1_fast_window": hb_report(hb1, "run1 (10:18)"),
            "run2_slow_window": hb_report(hb, "run2 (10:19)"),
        },
    }

    def enc(o):
        if isinstance(o, dict):
            return {k: enc(v) for k, v in o.items()}
        if isinstance(o, list):
            return [enc(v) for v in o]
        return o

    path = OUT / "host-rpc-latency.json"
    path.write_text(json.dumps(enc(doc), indent=2, ensure_ascii=False))
    print("wrote", path, path.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
