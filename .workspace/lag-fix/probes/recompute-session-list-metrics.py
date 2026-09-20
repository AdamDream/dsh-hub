#!/usr/bin/env python3
"""会话列表规模的口径复算工具（一个文件一个口径，避免张冠李戴）。

用法：
  python3 recompute-session-list-metrics.py <captured-response.json> [more.json ...]

输出每个文件：
  envelope_bytes   整份响应文件的字节数（= HTTP 响应体长度）
  items            条目数
  non_subagent     非 subagent 行数（origin !== "subagent"；即侧边栏可见行）
  subagent         origin === "subagent" 行数
  items_bytes_utf8 items 数组按 UTF-8 紧凑序列化的字节数（ensure_ascii=False，**推荐口径**）
  items_bytes_ascii 同上但 ensure_ascii=True（中文被转义 → 明显偏大，仅作对照，勿引用）
  overshoot_x      只算 items（去掉投影字段）的字节占 envelope 的比例，用于说明"字节不只看行数"
"""
import json
import sys
import os


def metrics(path: str) -> dict:
    if not os.path.exists(path):
        return {"file": os.path.basename(path), "error": "文件不存在"}
    raw = open(path, encoding="utf-8").read()
    j = json.loads(raw)
    items = None
    for probe in (lambda o: o["result"]["value"]["items"],
                  lambda o: o["result"]["items"],
                  lambda o: o["items"]):
        try:
            cand = probe(j)
            if isinstance(cand, list):
                items = cand
                break
        except Exception:
            continue
    if items is None:
        return {"file": os.path.basename(path), "error": "未找到 items 数组", "envelope_bytes": len(raw.encode())}
    compact_utf8 = json.dumps(items, ensure_ascii=False, separators=(",", ":")).encode()
    compact_ascii = json.dumps(items, ensure_ascii=True, separators=(",", ":")).encode()
    return {
        "file": os.path.basename(path),
        "envelope_bytes": len(raw.encode()),
        "items": len(items),
        "non_subagent": sum(1 for x in items if isinstance(x, dict) and x.get("origin") != "subagent"),
        "subagent": sum(1 for x in items if isinstance(x, dict) and x.get("origin") == "subagent"),
        "items_bytes_utf8": len(compact_utf8),
        "items_bytes_ascii": len(compact_ascii),
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    out = [metrics(p) for p in sys.argv[1:]]
    w = max(len(os.path.basename(p)) for p in sys.argv[1:])
    for m in out:
        if "error" in m:
            print(f"{m['file']:<{w}}  ✗ {m['error']}（envelope={m.get('envelope_bytes')}）")
            continue
        print(f"{m['file']:<{w}}  envelope={m['envelope_bytes']:>9,}  items={m['items']:>5} "
              f"(非sub={m['non_subagent']:>4} / sub={m['subagent']:>5})  "
              f"items_bytes(utf8)={m['items_bytes_utf8']:>9,}  items_bytes(ascii)={m['items_bytes_ascii']:>9,}")
