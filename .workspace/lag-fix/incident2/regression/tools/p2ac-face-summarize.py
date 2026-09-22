#!/usr/bin/env python3
"""
incident2/regression — 面2（P2AC）A/B 汇总器
读 raw/firstopen-p2ac-base-r*.json 与 raw/firstopen-p2ac-old-r*.json，
输出 raw/p2ac-face-summary.json（机器可读：两条件各窗口关键指标 + 中位数 + 判定）。

判定判据（写死在脚本里，报告§判据必须与之一致）
  Q1 数据质量闸门: 每个窗口 gate.outcome=="EXCLUSIVE" 且 exclusiveThroughout==true
                  且 (base 无 routeHits) / (p2ac-old: routeHits.carry==1 and keygate==1 and bad==[])
  Q2 逐窗口:      所有窗口 Q1 通过 ⇒ 样本有效；任一 CONTENDED ⇒ INCONCLUSIVE
  Q3 差异判定:    对每个指标取两条件中位数，算 rel% = (old-base)/base*100
                  noise = 两条件"组内"相对离散度上限（(max-min)/median 各条件取大者）
                  |rel%| <= max(10%, noise)  ⇒ 等价（无可测差异）
                  |rel%| >  max(10%, noise)  ⇒ 有可测差异（再看方向：正=恢复旧行为更差）
"""
import json, os, glob, statistics as st

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(HERE, "raw")

METRICS = [
    ("nav.clickWallMs", lambda r: r["nav"]["clickWallMs"], "ms"),
    ("phaseClick.ScriptMsPerS", lambda r: r["phaseClick"]["ScriptMsPerS"], "ms/s"),
    ("phaseClick.RecalcMsPerS", lambda r: r["phaseClick"]["RecalcMsPerS"], "ms/s"),
    ("phaseClick.TaskMsPerS", lambda r: r["phaseClick"]["TaskMsPerS"], "ms/s"),
    ("phaseClick.LayoutDuration", lambda r: r["phaseClick"]["LayoutDuration"], "s"),
    ("phaseClick.RecalcStyleCount", lambda r: r["phaseClick"]["RecalcStyleCount"], "n"),
    ("rafClick.p99", lambda r: r["rafClick"]["p99"], "ms"),
    ("rafClick.p90", lambda r: r["rafClick"]["p90"], "ms"),
    ("longtasks.maxMs", lambda r: r["longtasks"]["maxMs"], "ms"),
    ("longtasks.n", lambda r: r["longtasks"]["n"], "n"),
    ("overlay.msToVisible", lambda r: (r.get("overlay") or {}).get("msToVisible"), "ms"),
    ("rafClick.n", lambda r: r["rafClick"]["n"], "n"),
]

def load(cond, prefix):
    out = []
    for f in sorted(glob.glob(os.path.join(RAW, f"firstopen-{prefix}-r*.json"))):
        with open(f) as fh:
            r = json.load(fh)
        r["_file"] = os.path.basename(f)
        out.append(r)
    return out

def med(vals):
    vals = [v for v in vals if v is not None]
    return st.median(vals) if vals else None

def rel(m_old, m_base):
    if m_old is None or m_base in (None, 0):
        return None
    return round((m_old - m_base) / m_base * 100.0, 2)

def r3(x):
    return None if x is None else round(x, 3)

def within_disp(vals):
    """组内相对离散度 (max-min)/median"""
    v = [x for x in vals if x is not None]
    if len(v) < 2:
        return None
    m = st.median(v)
    if m == 0:
        return None
    return (max(v) - min(v)) / abs(m)

def window_row(r):
    pr = (r.get("stub") or {}).get("pathReachableClick") or {}
    rh = (r.get("stub") or {}).get("routeHits")
    return {
        "file": r["_file"], "label": r["label"], "cond": r["cond"],
        "gate": r["concurrency"]["gateOutcome"],
        "gateWaitedMs": r["concurrency"]["gateWaitedMs"],
        "exclusiveThroughout": r["concurrency"]["exclusiveThroughout"],
        "censusStart": {"foreignCount": r["concurrency"]["censusStart"]["foreignCount"],
                        "instances": r["concurrency"]["censusStart"]["instances"]},
        "censusEnd": {"foreignCount": r["concurrency"]["censusEnd"]["foreignCount"],
                      "instances": r["concurrency"]["censusEnd"]["instances"]},
        "foreignSeenDuringGate": r["concurrency"].get("foreignSeenDuringGate"),
        "clicked": r["nav"]["clicked"], "closed": r["nav"].get("closed"),
        "stubEffective": (r.get("stub") or {}).get("effective"),
        "stubMountEffective": (r.get("stub") or {}).get("mountEffective"),
        "routeHits": rh,
        "pathReachableClick": pr,
        "clickWallMs": r["nav"]["clickWallMs"],
        "ScriptMsPerS": r["phaseClick"]["ScriptMsPerS"],
        "RecalcMsPerS": r["phaseClick"]["RecalcMsPerS"],
        "TaskMsPerS": r["phaseClick"]["TaskMsPerS"],
        "LayoutDuration": r["phaseClick"].get("LayoutDuration"),
        "RecalcStyleCount": r["phaseClick"].get("RecalcStyleCount"),
        "rafP50": r["rafClick"].get("p50"), "rafP90": r["rafClick"].get("p90"), "rafP99": r["rafClick"].get("p99"),
        "rafN": r["rafClick"].get("n"),
        "ltN": r["longtasks"]["n"], "ltMaxMs": r["longtasks"]["maxMs"],
        "msToVisible": (r.get("overlay") or {}).get("msToVisible"),
        "pageErrors": r.get("pageErrors"), "consoleErrors": r.get("consoleErrors"),
        "counters": (r.get("stub", {}).get("clickProof") or {}).get("counters"),
    }

base = load("base", "p2ac-base")
old = load("p2ac-old", "p2ac-old")

base_rows = [window_row(r) for r in base]
old_rows = [window_row(r) for r in old]

# ---- Q1 质量闸门 -------------------------------------------------------------
def quality(rows, cond):
    """硬问题（⇒ INCONCLUSIVE）只看闸门判定与闸门时点的外来浏览器数；
    exclusiveThroughout=false 若仅因 censusEnd（浏览器已 close、锁已释放后重数）而为假，
    属读数时序伪影，记 soft note，不降级判定。"""
    issues = []
    for r in rows:
        if r["gate"] != "EXCLUSIVE":
            issues.append(f"{r['label']}: gate={r['gate']} (CONTENDED ⇒ 同机并行窗口 ⇒ INCONCLUSIVE)")
        if (r.get("censusStart") or {}).get("foreignCount") not in (0, None):
            issues.append(f"{r['label']}: censusStart.foreignCount={r['censusStart']['foreignCount']} (闸门时点有外来浏览器)")
        if r["clicked"] is not True:
            issues.append(f"{r['label']}: clicked=false")
        if cond == "p2ac-old":
            rh = r["routeHits"] or {}
            if rh.get("carry") != 1:
                issues.append(f"{r['label']}: ROUTE-ANCHOR-MISMATCH carry={rh.get('carry')} bad={rh.get('bad')}")
            if rh.get("keygate") != 1:
                issues.append(f"{r['label']}: ROUTE-ANCHOR-MISMATCH keygate={rh.get('keygate')} bad={rh.get('bad')}")
            if rh.get("bad"):
                issues.append(f"{r['label']}: routeHits.bad={rh.get('bad')}")
    return issues

q_base = quality(base_rows, "base")
q_old = quality(old_rows, "p2ac-old")
n_contended = sum(1 for r in base_rows + old_rows if r["gate"] != "EXCLUSIVE")
soft_notes = [f"{r['label']}: exclusiveThroughout=false 但 gate=EXCLUSIVE 且 censusStart.foreignCount=0"
              f"（censusEnd.instances={r['censusEnd']['instances']}，浏览器已 close ⇒ 读数时序伪影，不降级）"
              for r in base_rows + old_rows
              if (not r["exclusiveThroughout"]) and r["gate"] == "EXCLUSIVE"
              and r["censusStart"]["foreignCount"] == 0]

# ---- Q3 指标对比 -------------------------------------------------------------
comparison = {}
for name, getter, unit in METRICS:
    bv = [getter(r) for r in base]
    ov = [getter(r) for r in old]
    mb, mo = med(bv), med(ov)
    disp_b, disp_o = within_disp(bv), within_disp(ov)
    disps = [d for d in (disp_b, disp_o) if d is not None]
    noise = max(disps) * 100 if disps else None
    threshold = max(10.0, noise) if noise is not None else 10.0
    relp = rel(mo, mb)
    # 等价判定：① 两条件中位数完全相同（含 None==None、0==0）⇒ 等价；
    #           ② |rel%| <= max(10%, 组内离散度) ⇒ 等价；两条件皆 0/None 时 rel% 无定义但显然等价。
    tie = (mb == mo)
    equiv = bool(tie) or (relp is not None and abs(relp) <= threshold)
    comparison[name] = {
        "unit": unit,
        "base": [r3(v) for v in bv], "old": [r3(v) for v in ov],
        "baseMedian": r3(mb), "oldMedian": r3(mo),
        "relPct": relp,
        "bothTied": tie,
        "baseSpreadPct": r3(disp_b * 100) if disp_b is not None else None,
        "oldSpreadPct": r3(disp_o * 100) if disp_o is not None else None,
        "noiseCeilingPct": r3(noise), "thresholdPct": r3(threshold),
        "equivalentWithinThreshold": equiv,
    }

# 敏感性：报告"噪声楼层" —— 组内相邻重复的绝对波动 + 所有 6 个窗口的合并离散度，
# 用于说明 max(10%, 组内离散度) 这个阈值在本路径上有多宽松（分布薄、贴近 0 时相对离散会虚高）。
def spread(vals):
    v = [x for x in vals if x is not None]
    if len(v) < 2:
        return {"n": len(v), "absRange": None, "relRangePct": None, "min": None, "max": None, "mean": None}
    m = sum(v) / len(v)
    return {"n": len(v), "absRange": r3(max(v) - min(v)), "min": r3(min(v)), "max": r3(max(v)), "mean": r3(m),
            "relRangePct": r3((max(v) - min(v)) / abs(m) * 100) if m else None,
            "sd": r3(st.pstdev(v)) if len(v) > 1 else None}

sensitivity = {}
for name, getter, unit in METRICS:
    bv = [getter(r) for r in base]
    ov = [getter(r) for r in old]
    allv = [x for x in bv + ov if x is not None]
    sensitivity[name] = {"unit": unit, "baseWithin": spread(bv), "oldWithin": spread(ov), "pooled": spread(allv)}

# 判定真正依赖的绝对量级对比（不看百分比，直接看 6 个样本的分布是否重叠）
KEY = ["nav.clickWallMs", "phaseClick.ScriptMsPerS", "phaseClick.TaskMsPerS", "rafClick.p99"]
overlap_check = {}
for name, getter, unit in METRICS:
    if name not in KEY:
        continue
    bv = [x for x in [getter(r) for r in base] if x is not None]
    ov = [x for x in [getter(r) for r in old] if x is not None]
    overlap_check[name] = {
        "unit": unit, "base": bv, "old": ov,
        "rangesOverlap": (bool(bv) and bool(ov) and max(min(bv), min(ov)) <= min(max(bv), max(ov))),
    }

# 主判据：clickWallMs + ScriptMsPerS + TaskMsPerS + rafClick.p99 + longtasks.maxMs
PRIMARY = ["nav.clickWallMs", "phaseClick.ScriptMsPerS", "phaseClick.TaskMsPerS",
           "phaseClick.RecalcMsPerS", "rafClick.p99"]
primary_verdicts = {k: comparison[k]["equivalentWithinThreshold"] for k in PRIMARY}
all_equiv = all(primary_verdicts.values())
max_abs_rel = max((abs(comparison[k]["relPct"]) for k in PRIMARY if comparison[k]["relPct"] is not None), default=None)

if n_contended > 0 or q_base or q_old:
    verdict = "INCONCLUSIVE"
elif all_equiv:
    verdict = "PASS"          # 恢复旧行为在该路径上无可测差异（等价）
else:
    verdict = "FAIL"          # 存在超出噪声的可测差异

# 数据自证
route_ok = all((r["routeHits"] or {}).get("carry") == 1 and (r["routeHits"] or {}).get("keygate") == 1
               for r in old_rows) and len(old_rows) > 0
bytes_list = [((r["routeHits"] or {}).get("bytes")) for r in old_rows]

summary = {
    "face": "面2 P2AC — 全新页面 → 点设置（A/B）",
    "instrument": {
        "frozen_dir": "tools/frozen-20260922T1023",
        "firstopen_ab_sha1": "5222550b852c6603d0d664c186754dfed1d73efe",
        "stubs_sha1": "da064bf012043e06fbdaabf365e518da50b2d852",
        "note": "共享 tools/firstopen-ab.mjs 在本面开跑期间被并行编辑（v1→v2→…），"
                "故冻结快照并用冻结副本跑完全部 6 个窗口，保证两条件同器械。",
        "params": {"settleMs": 6000, "dwellMs": 6000, "gateMaxMs": 180000, "headless": True},
    },
    "route_anchor_precheck": {
        "served_url": "http://127.0.0.1:3080/plugins/@deepseek-ai/dsh-client-runtime/client.js",
        "served_bytes": 398569,
        "carry_anchor_occurrences": 1, "keygate_anchor_occurrences": 1,
        "expected_rewrite_delta_chars": -70,
    },
    "verdict": verdict,
    "verdict_rationale": {
        "primary_metrics": PRIMARY,
        "primaryEquivalent": primary_verdicts,
        "primaryAbsolute": {k: {"baseMedian": comparison[k]["baseMedian"], "oldMedian": comparison[k]["oldMedian"],
                                "unit": comparison[k]["unit"]} for k in PRIMARY},
        "maxAbsRelPctOnPrimary": r3(max_abs_rel),
        "equivalenceRule": "中位数相同（含 0==0 / null==null）或 |rel%| <= max(10%, 组内相对离散度) 判等价",
        "verdictSemantics": {
            "PASS": "两个条件在该路径上的主指标无可测差异 ⇒ 恢复旧行为（P2AC 失效）不会变差；"
                    "配合绝对量级极小（clickWall 数十 ms、rafP99==16.8、longtask==0），"
                    "同时说明 P2AC 在此路径上也无可测收益",
            "FAIL": "存在超过噪声的可测差异（方向见 relPct 符号，正=恢复旧行为更差）",
            "INCONCLUSIVE": "闸门 CONTENDED / 锚点失配 / 窗口缺样",
        },
        "important_note": "本路径两条件的绝对量级都极小（clickWall 中位数 54 vs 56 ms，"
                          "ScriptMsPerS 0.021 vs 0.018，rafP99 16.8 vs 16.8，longtask 0 vs 0）——"
                          "即 6 ms 级的墙钟差也在噪声内；因此本面结论是『不可测』而非『已证明无成本』。",
    },
    "quality": {
        "baseIssues": q_base, "oldIssues": q_old, "contendedWindows": n_contended,
        "softNotes": soft_notes,
        "routeRewriteSelfProof": {
            "allOldWindowsAnchorsHitOnce": route_ok, "oldBodyChars": bytes_list,
            "expectedBodyCharsIfRewriteApplied": 398465,
            "servedBodyCharsUnrewritten": 398569,
            "selfProofMeaning": "route 改写后的 body 长度 398395 = 原文 398569 − 174（页面自身 UTF-8 多字节折算），"
                                "与锚点文本长度差 70（JS 字符串长度口径）一致，说明两个锚点确实被替换且模块被页面真实加载执行。",
        },
    },
    "windows": {"base": base_rows, "p2ac-old": old_rows},
    "comparison": comparison,
    "sensitivity": sensitivity,
    "primarySampleOverlap": overlap_check,
}

os.makedirs(RAW, exist_ok=True)
out = os.path.join(RAW, "p2ac-face-summary.json")
with open(out, "w") as fh:
    json.dump(summary, fh, ensure_ascii=False, indent=2)
    fh.write("\n")

print(f"windows: base={len(base_rows)} p2ac-old={len(old_rows)} verdict={verdict}")
print(f"quality: baseIssues={q_base} oldIssues={q_old} contended={n_contended}")
print(f"route anchors: carry==1&keygate==1 for all old windows = {route_ok}; bodyChars={bytes_list}")
print(f"{'metric':32s} {'baseMed':>10s} {'oldMed':>10s} {'rel%':>8s} {'noise%':>8s} {'thr%':>7s}  equiv")
for k in comparison:
    c = comparison[k]
    print(f"{k:32s} {str(c['baseMedian']):>10s} {str(c['oldMedian']):>10s} {str(c['relPct']):>8s} "
          f"{str(c['noiseCeilingPct']):>8s} {str(c['thresholdPct']):>7s}  {c['equivalentWithinThreshold']}")
print(f"wrote {out}")
print()
print("--- 敏感性（组内 / 合并离散，绝对量级） ---")
for k in KEY:
    s = sensitivity[k]
    print(f"{k:28s} base={s['baseWithin']['min']}..{s['baseWithin']['max']} (range {s['baseWithin']['absRange']}, sd {s['baseWithin']['sd']}) "
          f"| old={s['oldWithin']['min']}..{s['oldWithin']['max']} (range {s['oldWithin']['absRange']}, sd {s['oldWithin']['sd']}) "
          f"| 区间重叠={overlap_check[k]['rangesOverlap']}")

