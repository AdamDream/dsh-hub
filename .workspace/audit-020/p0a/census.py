#!/usr/bin/env python3
"""P0-A 全量只读预检：对每份 session.jsonl.zstd 按帧解码，统计类型分布与拒因。

只读。输出一行 JSON / 文件到 stdout（由调用方写入 .jsonl）。
用法： python3 census.py <file-list-file> <output-jsonl> [workers]
"""
import json
import os
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor

PACKING = {"text-chunks", "reasoning-chunks", "tool-call-chunks"}


def type_of(line: str):
    i = line.find('"type":"')
    if i < 0:
        return None
    j = line.find('"', i + 8)
    if j < 0:
        return None
    return line[i + 8 : j]


def scan(path: str) -> dict:
    rec = {
        "file": path,
        "bytes": os.path.getsize(path),
        "lines": 0,
        "bad_json": 0,
        "types": {},
        "desc_versions": {},
        "session_version": None,
        "has_chunk_event": False,
        "packing": {},
        "error": None,
    }
    try:
        proc = subprocess.Popen(
            ["zstd", "-dc", path], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
        )
        assert proc.stdout is not None
        for raw in proc.stdout:
            rec["lines"] += 1
            try:
                line = raw.decode("utf-8", "replace")
            except Exception:
                rec["bad_json"] += 1
                continue
            t = type_of(line)
            if t is None:
                rec["bad_json"] += 1
                continue
            rec["types"][t] = rec["types"].get(t, 0) + 1
            if t == "assistant/chunk":
                rec["has_chunk_event"] = True
            if t in PACKING:
                # 记录打包行的字段形状
                try:
                    obj = json.loads(line)
                except Exception:
                    rec["bad_json"] += 1
                    continue
                shape = sorted(obj.keys())
                d = obj.get("data")
                if isinstance(d, dict):
                    shape += ["data:" + k for k in sorted(d.keys())]
                rec["packing"][t] = shape
            elif t == "subagent/descriptor":
                try:
                    obj = json.loads(line)
                    v = (obj.get("data") or {}).get("version")
                    rec["desc_versions"][str(v)] = rec["desc_versions"].get(str(v), 0) + 1
                except Exception:
                    rec["bad_json"] += 1
            elif t == "session":
                try:
                    obj = json.loads(line)
                    rec["session_version"] = obj.get("version")
                except Exception:
                    rec["bad_json"] += 1
        proc.stdout.close()
        proc.wait()
    except Exception as exc:  # noqa: BLE001
        rec["error"] = f"{type(exc).__name__}: {exc}"
    return rec


def main() -> int:
    list_file, out_file = sys.argv[1], sys.argv[2]
    workers = int(sys.argv[3]) if len(sys.argv) > 3 else 16
    with open(list_file) as fh:
        files = [ln.strip() for ln in fh if ln.strip()]
    with open(out_file, "w") as out:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            for i, rec in enumerate(pool.map(scan, files, chunksize=4), 1):
                out.write(json.dumps(rec, ensure_ascii=False) + "\n")
                if i % 200 == 0:
                    out.flush()
                    print(f"  ...{i}/{len(files)}", file=sys.stderr, flush=True)
    print(f"done {len(files)} files -> {out_file}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
