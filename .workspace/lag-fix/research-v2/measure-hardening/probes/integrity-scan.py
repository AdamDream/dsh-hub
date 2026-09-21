#!/usr/bin/env python3
"""
integrity-scan.py — 采集窗口完整性扫描（只读）

背景：协调者通报另一条线（tab-profile）在 ~15:04–15:13 执行过
`pkill -f playwright_chromiumdev_profile`，误杀兄弟线 Chromium，并泄漏一个浏览器存活 24 分钟。
本脚本回答："我自己的采集窗口里，有没有'浏览器意外退出 / 页面崩溃 / 连接中断 / 数据缺失'的窗口？"

**判定原则（重要，避免自欺）**——真正算"中断证据"的只有 E1–E4：
  E1 artifact 级：recovery_events 非空 / signalled / 浏览器代数 >1 / watchdog_fired
  E2 该窗口的采集尝试被中断（浏览器代际切换后重试），或 invalid_reasons 含 crash/closed/abort/attempts/timeout
  E3 连接中断：同一 socket URL 出现 >1 个实例，或收到 close/error 事件
     （**仅新探针版本有该仪表**；旧批次无此字段 ⇒ 记 not-instrumented，**不得**当成"无中断"）
  E4 数据缺失：metrics 为空 / rAF 区间缺失 / common_interval 缺失 / activity=unknown

以下**不算**中断证据（本脚本 v1 曾误判，v2 已修正为仅供参考）：
  ✗ `session/subscribed` 帧：它是"客户端订阅了某会话"，**新会话出现也会触发**，并非重连信号；
    本机他线频繁新建会话 ⇒ 属常态
  ✗ WS 每秒桶空洞：空闲秒本来就没有帧；只有"两侧都活跃的内部空洞"才值得看一眼
  ✗ `per_socket` 里 `events.host` 时有时无：该 socket 只在有帧时才进入聚合，属常态

另外单独报告与 15:04–15:13 事故时段的**重叠**：这是"环境不可控"的污染理由，不是中断证据。
"""
import json
import glob
import os
import sys
from datetime import datetime, timezone, timedelta

TZ = timezone(timedelta(hours=8))
INC_S = datetime(2026, 9, 21, 15, 4, 0, tzinfo=TZ)
INC_E = datetime(2026, 9, 21, 15, 13, 0, tzinfo=TZ)
SKIP = {"integrity-scan.json"}


def hhmmss(ms):
    return datetime.fromtimestamp(ms / 1000, TZ).strftime("%H:%M:%S")


def ovl(a, b):
    if a is None or b is None:
        return False
    return a < INC_E.timestamp() * 1000 and b > INC_S.timestamp() * 1000


def scan(path):
    d = json.load(open(path))
    f = d.get("framework", {})
    lock = f.get("lock") or {}
    out = {
        "file": os.path.basename(path),
        "label": d.get("label"),
        "probe": (d.get("provenance") or {}).get("probe_sha256", "")[:12],
        "recovery_events": f.get("recovery_events") or [],
        "signalled": f.get("signalled"),
        "generations": f.get("browser_generations"),
        "watchdog_fired": f.get("watchdog_fired"),
        "terminated_reason": f.get("terminated_reason"),
        "lock_acquired": lock.get("acquired"),
        "reconnect_instrumented": None,
        "windows": [],
    }
    wins = d.get("windows") or []
    if wins:
        out["reconnect_instrumented"] = (wins[0].get("ws_detail") or {}).get("socket_instances") is not None

    for w in wins:
        m = w.get("metrics") or {}
        det = w.get("ws_detail") or {}
        clk = w.get("clock") or {}
        off = clk.get("offset_page_minus_node_ms")
        ci = w.get("common_interval") or {}
        a, b = ci.get("t_start_ms"), ci.get("t_end_ms")
        ws = we = None
        if off is not None and a is not None and b is not None:
            ws, we = a - off, b - off

        hard, info = [], []
        if not m:
            hard.append("E4:metrics-missing")
        if m and m.get("frame_p99_ms") is None:
            hard.append("E4:raf-missing")
        if not ci:
            hard.append("E4:common-interval-missing")
        if w.get("activity_class") == "unknown":
            hard.append("E4:activity-unknown")
        for r in w.get("invalid_reasons") or []:
            if any(t in r for t in ("crash", "closed", "abort", "attempts", "timeout")):
                hard.append(f"E2:{r}")

        si = det.get("socket_instances")
        if si is None:
            info.append("reconnect:not-instrumented")
        else:
            rec = det.get("reconnects") or []
            if rec:
                hard.append("E3:ws-reconnect(" + ",".join(f"{x['url'].rsplit('/',1)[-1]}x{x['instances']}" for x in rec) + ")")
            ev = sum((s.get("close_events") or 0) + (s.get("error_events") or 0) for s in si)
            if ev:
                hard.append(f"E3:ws-close-or-error({ev})")

        kinds = det.get("by_kind") or {}
        if kinds.get("session/subscribed"):
            info.append(f"session-subscribed({kinds['session/subscribed']})|非重连证据")

        out["windows"].append({
            "phase": w.get("phase"),
            "index": w.get("index"),
            "gen": w.get("page_generation"),
            "valid": w.get("valid"),
            "wall": f"{hhmmss(ws)}–{hhmmss(we)}" if ws else None,
            "incident_overlap": ovl(ws, we),
            "hard_evidence": hard,
            "info": info,
            "foreign": (w.get("concurrency") or {}).get("foreign_instances_max"),
            "host_pid": w.get("host_pid"),
            "invalid_reasons": w.get("invalid_reasons") or [],
        })
    return out


def main():
    files = [p for p in sorted(glob.glob("runs/*.json")) if os.path.basename(p) not in SKIP]
    res = []
    for p in files:
        try:
            res.append(scan(p))
        except Exception as e:
            print(f"  (skip {os.path.basename(p)}: {e})")

    print(f"事故时段（协调者通报 pkill）：{INC_S:%H:%M}–{INC_E:%H:%M}\n")
    print("=== A. artifact 级 ===")
    print(f"{'file':30}{'label':22}{'recov':>6}{'sig':>9}{'gen':>5}{'wd':>6}{'lock':>6}{'reconn-instr':>13}{'win':>5}")
    for r in res:
        print(f"{r['file']:30}{str(r['label'])[:21]:22}{len(r['recovery_events']):>6}"
              f"{str(r['signalled'] or '-'):>9}{str(r['generations']):>5}{str(r['watchdog_fired']):>6}"
              f"{str(r['lock_acquired']):>6}{str(r['reconnect_instrumented']):>13}{len(r['windows']):>5}")

    print("\n=== B. 有真中断证据（E1–E4）的批次/窗口 ===")
    n = 0
    for r in res:
        if r["recovery_events"] or r["signalled"] or r["watchdog_fired"]:
            n += 1
            print(f"  [{r['file']}] E1: recovery={len(r['recovery_events'])} signalled={r['signalled']} "
                  f"watchdog={r['watchdog_fired']} → {r['terminated_reason']}")
            for e in r["recovery_events"]:
                print(f"        {e.get('at')}  {e.get('reason')}  {e.get('action') or ''}")
        for w in r["windows"]:
            if w["hard_evidence"]:
                n += 1
                print(f"  {r['file']:28} {w['phase']:15}#{w['index']} {w['wall']} gen={w['gen']} valid={w['valid']} {w['hard_evidence']}")
    if n == 0:
        print("  （无）")

    print("\n=== C. 与事故时段重叠（污染理由，非中断证据）===")
    for r in res:
        ov = [w for w in r["windows"] if w["incident_overlap"]]
        if ov:
            print(f"  {r['file']:30} {len(ov)}/{len(r['windows'])} 窗口重叠  {ov[0]['wall'].split('–')[0]}–{ov[-1]['wall'].split('–')[1]}")

    print("\n=== D. 并发实例数观察 ===")
    for r in res:
        fv = [w["foreign"] for w in r["windows"] if isinstance(w["foreign"], int)]
        if fv:
            print(f"  {r['file']:30} foreign min={min(fv)} max={max(fv)}  恒为0的窗口={sum(1 for x in fv if x == 0)}/{len(fv)}")

    json.dump(res, open("runs/integrity-scan.json", "w"), ensure_ascii=False, indent=2)
    print(f"\n→ runs/integrity-scan.json（真中断证据条目 {n}）")


if __name__ == "__main__":
    sys.exit(main())
