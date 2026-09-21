#!/usr/bin/env python3
"""
recompute-check.py — 复算校验 + 同事件率配对

用途：
  1. 复算校验：验证 artifact 内部自洽（划分成立、速率可由计数/区间重算、门禁字段齐全）。
     任何一条不成立 → 该 artifact 不可用于结论。
  2. 同事件率配对：在同一 artifact 内，按 session/event 速率把 idle 窗口与 settings-* 窗口
     最近邻配对，给出同速率下的差值——这是**单轮内、同 N、同浏览器代数**的近似配对证据。

用法：
  python3 probes/recompute-check.py runs/baseline-live.json
"""
import json
import sys


def q(vals, p):
    v = sorted(vals)
    if not v:
        return None
    idx = (len(v) - 1) * p
    lo, hi = int(idx), min(int(idx) + 1, len(v) - 1)
    return round(v[lo] + (v[hi] - v[lo]) * (idx - lo), 3)


def main(path):
    d = json.load(open(path))
    print(f"artifact: {path}")
    print(f"label={d.get('label')} probe_sha256={str(d.get('provenance',{}).get('probe_sha256'))[:16]}…")
    print(f"bundle={str(d.get('provenance',{}).get('bundle',{}).get('combined_sha256'))[:16]}…")
    print(f"host={json.dumps(d['target']['host'], ensure_ascii=False)}")

    fails = []
    print("\n=== 1. 复算校验 ===")
    for w in d["windows"]:
        tag = f"{w['phase']}[{w['index']}]"
        m, det, ctr = w.get("metrics") or {}, w.get("ws_detail") or {}, w.get("counters") or {}
        # (a) 划分成立
        tot = sum((det.get("by_kind") or {}).values())
        if tot != (m.get("ws_total") or 0):
            fails.append(f"{tag}: 划分不成立 sum(by_kind)={tot} != ws_total={m.get('ws_total')}")
        # (b) 速率可由 count/span 重算
        for key, cnt in (("ws_all", m.get("ws_total")), ("ws_kind:session/event", m.get("ws_session_event"))):
            c = ctr.get(key) or {}
            if c.get("span_ms") and cnt is not None:
                recomputed = round(cnt / (c["span_ms"] / 1000), 1)
                if c.get("rate_per_s") is not None and abs(recomputed - c["rate_per_s"]) > 0.15:
                    fails.append(f"{tag}: {key} 速率不可复算 {recomputed} != {c['rate_per_s']}")
        # (c) 门禁字段齐全
        for k in ("t_start_ms", "t_end_ms", "span_ms"):
            if (ctr.get("raf") or {}).get(k) is None:
                fails.append(f"{tag}: raf.{k} 缺失（缺窗口内真实分母）")
                break
        if w["valid"] and w.get("common_interval") is None:
            fails.append(f"{tag}: valid 但缺 common_interval")
        # (d) 装载门禁痕迹
        p = w.get("page_state") or {}
        if w["phase"].startswith("settings") and w["valid"] and (p.get("dialog_count", 0) < 1 or p.get("panel_nodes", 0) < 1):
            fails.append(f"{tag}: settings 窗口 valid 但 panel 缺失")
        if w["phase"] == "idle" and w["valid"] and p.get("dialog_count", 0) != 0:
            fails.append(f"{tag}: idle 窗口 valid 但有 dialog")
    print(" 划分 / 速率复算 / 分母 / 门禁字段：" + ("全部通过 ✅" if not fails else "❌ 失败项如下"))
    for f in fails:
        print("   -", f)

    fw = d["framework"]
    print(f"\n ready 门禁 ok={fw['gates']['ready']['ok']}  RPC items={d['scale_snapshot'].get('items')}")
    print(f" 契约检查={json.dumps(d['scale_snapshot'].get('checks'))}")
    print(f" browser_generations={fw.get('browser_generations')} recovery_events={len(fw.get('recovery_events') or [])}")
    print(f" invalid_windows={len(d['invalid_runs'])} mutation_guard={d['mutation_guard']['verdict']}")

    print("\n=== 2. 场景判定与超门槛比例 ===")
    for ph, s in d["scenarios"].items():
        if not s.get("windows_total"):
            print(f" {ph:16} {s['verdict']}")
            continue
        th = " ".join(f"{k}={v['ratio']}({v['status']})" for k, v in s["thresholds"].items())
        print(f" {ph:16} n={s['windows_valid']}/{s['windows_total']} {s['verdict']}")
        print(f"                  {th}")

    print("\n=== 3. 同事件率配对（同一 artifact 内，近似配对）===")
    print(" 说明：按 session/event 速率最近邻配对，同 N / 同浏览器代数 / 同窗口长度；")
    print("       负载非受控，速率差 >25% 的配对标注为 loose。")
    idle = [w for w in d["windows"] if w["phase"] == "idle" and w["valid"]]
    irange = [
        (w["metrics"] or {}).get("ws_session_event_rate_per_s")
        for w in idle
        if (w["metrics"] or {}).get("ws_session_event_rate_per_s") is not None
    ]
    for other in ("settings-open", "settings-dwell"):
        cand = [w for w in d["windows"] if w["phase"] == other and w["valid"]]
        if not cand:
            continue
        orange = [
            (w["metrics"] or {}).get("ws_session_event_rate_per_s")
            for w in cand
            if (w["metrics"] or {}).get("ws_session_event_rate_per_s") is not None
        ]
        print(f"\n -- idle vs {other} --")
        if irange and orange:
            lo = max(min(irange), min(orange))
            hi = min(max(irange), max(orange))
            print(
                f"  速率区间 idle=[{min(irange):.1f},{max(irange):.1f}] "
                f"{other}=[{min(orange):.1f},{max(orange):.1f}] "
                f"→ 重叠=[{lo:.1f},{hi:.1f}] "
                + ("✅ 有重叠，可配对" if hi > lo else "❌ **区间不相交：本轮不存在同事件率配对**")
            )
        print(f" {'idle#':>6}{'rate_i':>9}{'p99_i':>8}{'|':>3}{other:>16}{'rate_o':>9}{'p99_o':>8}{'Δp99':>9}{'Δrate%':>9}{'match':>8}")
        for wi in idle:
            ri = (wi["metrics"] or {}).get("ws_session_event_rate_per_s")
            if ri is None:
                continue
            wo = min(
                cand,
                key=lambda w: abs(((w["metrics"] or {}).get("ws_session_event_rate_per_s") or 0) - ri),
            )
            ro = (wo["metrics"] or {}).get("ws_session_event_rate_per_s")
            pi = (wi["metrics"] or {}).get("frame_p99_ms")
            po = (wo["metrics"] or {}).get("frame_p99_ms")
            dr = abs(ro - ri) / max(ri, 1e-9) * 100
            print(
                f" {wi['index']:>6}{ri:>9}{pi:>8}{'|':>3}{other+'#'+str(wo['index']):>16}{ro:>9}{po:>8}"
                f"{(po - pi) if (po is not None and pi is not None) else None:>9}{round(dr,1):>9}"
                f"{('tight' if dr<=25 else 'loose'):>8}"
            )

    print("\n=== 4. 结论级限制 ===")
    print(f" - invalid_fraction: " + json.dumps({k: v.get("invalid_fraction") for k, v in d["scenarios"].items()}))
    print(" - 任何 PASS 都必须带工况标签（N / session-event 速率 / 标签状态），见 docs/PROTOCOL.md §4")
    print(" - 退出码 0 仅表示框架自检通过，且本 artifact 的退出码为", fw["exit_code"])
    return 0 if not fails else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "runs/baseline-live.json"))
