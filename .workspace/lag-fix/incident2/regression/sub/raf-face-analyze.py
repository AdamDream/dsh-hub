#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
面4（主题 rAF 延后）分析器：读 raw/firstopen-raf-*.json（本器械两臂）+ 外部对照窗口，
产出 raw/rAF-face-summary.json（机器可读）并打印 sub/rAF-face.md 所需的表格。

判据
  A. stub 是否生效        : stub.effective（严格口径）/ pathReachable*
  B. 生产是否真调用 rAF   : rAF 调用点栈分类 rafByProdThemeDefer（click 相位单独一列）
  C. theme-sync vs base   : msToVisible / phaseClick.RecalcMsPerS / rafClick.p99 /
                            longtasks.maxMs / taskBusyPct 的中位数与相对差（+ 噪声底）
  D. 结论                 : 见 decide()
"""
import json, glob, os, statistics as st

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(HERE, "raw")


def load(p):
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:
        return None


def med(xs):
    xs = [x for x in xs if x is not None]
    return round(st.median(xs), 3) if xs else None


def iqr(xs):
    xs = sorted(x for x in xs if x is not None)
    if len(xs) < 2:
        return None
    return round(xs[-1] - xs[0], 3)


def valid(d):
    if not d:
        return False
    c = d.get("concurrency") or {}
    n = d.get("nav") or {}
    return c.get("gateOutcome") == "EXCLUSIVE" and n.get("clicked") is True and d.get("overlay") is not None


def metric(d, path):
    cur = d
    for k in path:
        if cur is None:
            return None
        cur = cur.get(k) if isinstance(cur, dict) else None
    return cur


def rows(d):
    """单窗口抽取值"""
    if not d:
        return None
    st_ = d.get("stub") or {}
    rc = (st_.get("rafClassification") or {})
    se = (st_.get("syncEvidence") or {})
    pr = st_.get("pathReachableClick") or {}
    c = ((st_.get("clickProof") or {}).get("counters") or {})
    m = ((st_.get("mountProof") or {}).get("counters") or {})
    nav = d.get("nav") or {}
    conc = d.get("concurrency") or {}
    return {
        "label": d.get("label"), "cond": d.get("cond"),
        "gate": conc.get("gateOutcome"),
        "gateWaitedMs": conc.get("gateWaitedMs"),
        "exclusiveThroughout": conc.get("exclusiveThroughout"),
        "censusStartForeign": (conc.get("censusStart") or {}).get("foreignCount"),
        "censusEndForeign": (conc.get("censusEnd") or {}).get("foreignCount"),
        "verdictHint": d.get("verdictHint"),
        "valid": valid(d),
        "wallS": nav.get("wallS"),
        "msToVisible": metric(d, ["overlay", "msToVisible"]),
        "recalcMsPerS": metric(d, ["phaseClick", "RecalcMsPerS"]),
        "scriptMsPerS": metric(d, ["phaseClick", "ScriptMsPerS"]),
        "taskMsPerS": metric(d, ["phaseClick", "TaskMsPerS"]),
        "recalcStyleCountClick": metric(d, ["phaseClick", "RecalcStyleCount"]),
        "rafP99": metric(d, ["rafClick", "p99"]),
        "rafP50": metric(d, ["rafClick", "p50"]),
        "rafN": metric(d, ["rafClick", "n"]),
        "longtaskMaxMs": metric(d, ["longtasks", "maxMs"]),
        "longtaskN": metric(d, ["longtasks", "n"]),
        "taskBusyPct": d.get("taskBusyPct"),
        "mountRecalcStyleCount": metric(d, ["phaseMount", "RecalcStyleCount"]),
        "mountScriptDuration": metric(d, ["phaseMount", "ScriptDuration"]),
        "mountRecalcDuration": metric(d, ["phaseMount", "RecalcStyleDuration"]),
        # A
        "stubEffectiveStrict": st_.get("effective"),
        "stubMountEffective": st_.get("mountEffective"),
        "reach_applyInClick": pr.get("themeApplyRanInClick"),
        "reach_refreshRan": pr.get("themeRefreshRan"),
        "reach_metaWritesInClick": pr.get("metaContentWritesInClick"),
        "reach_computedReadsInClick": pr.get("computedReadsInClick"),
        "reach_deferByProdInClick": pr.get("themeDeferScheduledByProdInClick"),
        # B
        "rafCallsTotal": rc.get("callsTotal"),
        "rafByHeartbeat": rc.get("byHeartbeat"), "rafByHeartbeatInClick": rc.get("byHeartbeatInClick"),
        "rafByProdThemeDefer": rc.get("byProdThemeDefer"), "rafByProdThemeDeferInClick": rc.get("byProdThemeDeferInClick"),
        "rafByOther": rc.get("byOther"), "rafByOtherInClick": rc.get("byOtherInClick"),
        "rafMountProdDefer": (rc.get("mountPhase") or {}).get("byProdThemeDefer"),
        "rafMountOther": (rc.get("mountPhase") or {}).get("byOther"),
        "rafMountHeartbeat": (rc.get("mountPhase") or {}).get("byHeartbeat"),
        "rafClickDeltaProdDefer": (rc.get("clickPhaseDelta") or {}).get("byProdThemeDefer"),
        "rafClickDeltaHeartbeat": (rc.get("clickPhaseDelta") or {}).get("byHeartbeat"),
        "rafClickDeltaTotal": (rc.get("clickPhaseDelta") or {}).get("callsTotal"),
        "rafProdStackSamples": rc.get("prodStackSamples"),
        "rafOtherSamplesTop": rc.get("otherSamplesTop"),
        "callsPerS": (round(rc["callsTotal"] / nav["wallS"], 2) if rc.get("callsTotal") and nav.get("wallS") else None),
        "rafTotalPerS": (round((rc.get("clickPhaseDelta") or {}).get("callsTotal", 0) / nav["wallS"], 2) if nav.get("wallS") else None),
        # 面4 同步化证据
        "syncExecutedProd": se.get("syncExecutedProd"), "syncExecutedProdInClick": se.get("syncExecutedProdInClick"),
        "syncFallback": se.get("syncFallback"), "syncFallbackInsideCallback": se.get("syncFallbackInsideCallback"),
        "metaWritesInRaf": c.get("tcMetaWritesInRaf"), "readsInRaf": c.get("tcComputedReadsInRaf"),
        "metaWritesInSyncRafCb": se.get("metaWritesInSyncRafCallback"), "readsInSyncRafCb": se.get("computedReadsInSyncRafCallback"),
        "metaContentWrites": c.get("tcMetaContentWrites"), "tcRafScheduled": c.get("tcRafScheduled"),
        "tcSyncInvoked": c.get("tcSyncInvoked"), "tcRefreshRan": c.get("tcRefreshRan"),
        "mountTcRafScheduled": m.get("tcRafScheduled"), "mountMetaWrites": m.get("tcMetaContentWrites"),
        "pageErrors": d.get("pageErrors"), "consoleErrors": d.get("consoleErrors"),
    }


def arm(ds, cond):
    out = {}
    for d in ds:
        if d.get("cond") == cond:
            r = rows(d)
            out[r["label"]] = r
    return out


def main():
    theme_files = sorted(glob.glob(os.path.join(RAW, "firstopen-raf-theme-sync-r*.json")))
    faithful_files = sorted(glob.glob(os.path.join(RAW, "firstopen-raf-theme-sync-fa-r*.json")))
    base_files = sorted(glob.glob(os.path.join(RAW, "firstopen-raf-base-r*.json")))
    ext_files = [os.path.join(RAW, x) for x in
                 ("firstopen-probe-base.json", "firstopen-base-r1.json",
                  "firstopen-reg-base-r1.json", "firstopen-reg-base-r2.json", "firstopen-reg-base-r3.json")]
    repro_files = sorted(glob.glob(os.path.join(RAW, "firstopen-raf-repro-*.json")))
    w2 = [load(p) for p in theme_files]
    w2f = [load(p) for p in faithful_files]
    b2 = [load(p) for p in base_files]
    ext = [load(p) for p in ext_files]
    repro = [load(p) for p in repro_files]

    th_naive = arm(w2, "theme-sync")
    th_faith = arm(w2f, "theme-sync-faithful")
    base = arm(b2, "base")
    n_faith = sum(1 for v in th_faith.values() if v and v["valid"])
    n_naive = sum(1 for v in th_naive.values() if v and v["valid"])
    use_faithful = n_faith >= 2
    theme = th_faith if use_faithful else th_naive
    alt_theme = th_naive if use_faithful else th_faith
    arm_selection = {
        "primary_treatment_arm": "theme-sync-faithful" if use_faithful else "theme-sync(naive)",
        "reason": ("faithful 臂（生产主题调度返回 falsy handle，消除「在飞标志」伪影）有 %d 个有效窗口，作为主治组" % n_faith) if use_faithful
                  else ("faithful 臂有效窗口不足（%d），退回 naive 臂（%d 个有效窗口）" % (n_faith, n_naive)),
        "naive_arm_valid_windows": n_naive, "faithful_arm_valid_windows": n_faith,
        "artifact_note": "naive 同步臂有一个已知伪影：同步执行后生产代码把 rAF 返回的真 handle 写进 themeColorFrame，而该 flag 永远不会被重置 ⇒ 后续 scheduleThemeColorRefresh 全部早退（表现为 prodDefer/metaWrites=1 而 base=2）。faithful 臂对生产主题调度返回 0，使每次 apply 都帧内刷新（与 base 的 2 次对齐）。",
    }
    extb = {}
    for d in ext:
        if d:
            extb[d.get("label")] = rows(d)

    def collect(armdict, key):
        return [v[key] for v in armdict.values() if v and v["valid"]]

    def collect_clean(armdict, key):
        return [v[key] for v in armdict.values() if v and v["valid"] and v.get("exclusiveThroughout")]

    def collect_ext(key):
        return [v[key] for v in extb.values() if v and v["valid"]]

    METRICS = ["msToVisible", "recalcMsPerS", "rafP99", "longtaskMaxMs", "taskBusyPct",
               "scriptMsPerS", "taskMsPerS", "rafTotalPerS", "mountRecalcStyleCount", "rafN",
               "mountScriptDuration", "recalcStyleCountClick"]
    cmp_tbl = {}
    for k in METRICS:
        tv, bv, ev = collect(theme, k), collect(base, k), collect_ext(k)
        tvc, bvc = collect_clean(theme, k), collect_clean(base, k)
        tm, bm = med(tv), med(bv)
        rel = (round((tm - bm) / bm * 100, 1) if (tm is not None and bm not in (None, 0)) else None)
        cmp_tbl[k] = {
            "theme_median": tm, "theme_values": tv, "theme_iqr": iqr(tv),
            "base_median": bm, "base_values": bv, "base_iqr": iqr(bv),
            "rel_diff_pct": rel,
            "abs_diff": (round(tm - bm, 3) if (tm is not None and bm is not None) else None),
            "external_base_values": ev, "external_base_median": med(ev), "external_base_iqr": iqr(ev),
            "theme_median_clean": med(tvc), "theme_values_clean": tvc,
            "base_median_clean": med(bvc), "base_values_clean": bvc,
            "external_base_labels": sorted(extb.keys()),
        }

    noise = {
        "base_arm_iqr": {k: cmp_tbl[k]["base_iqr"] for k in METRICS},
        "external_base_iqr": {k: cmp_tbl[k]["external_base_iqr"] for k in METRICS},
        "theme_arm_iqr": {k: cmp_tbl[k]["theme_iqr"] for k in METRICS},
        "note": "噪声底：本器械 base 臂组内极差 + 外部 base 窗口（多种器械）极差 + theme 臂组内极差",
    }
    contention = {
        "per_window": {f"{a}/{l}": {"gate": v["gate"], "gateWaitedMs": v["gateWaitedMs"],
                                    "exclusiveThroughout": v["exclusiveThroughout"],
                                    "censusStartForeign": v["censusStartForeign"], "censusEndForeign": v["censusEndForeign"]}
                       for a, arm_d in (("theme-sync", theme), ("base", base)) for l, v in arm_d.items()},
        "note": "exclusiveThroughout=False ⇒ 本窗口运行期间同机存在 foreign 浏览器（同线兄弟 agent 竞态），busy%/ScriptMsPerS 等 CPU 侧口径会被抬高；msToVisible/rafP99/RecalcMsPerS/longtask 对之较不敏感。",
    }

    # ---------------- A / B 汇总 ----------------
    def any_true(armdict, key):
        return any(v and v[key] for v in armdict.values())

    def all_null(armdict, key):
        vals = [v[key] for v in armdict.values() if v and v["valid"]]
        return all(x in (None, 0, False, []) for x in vals) if vals else None

    A = {
        "theme_effectiveStrict": {l: v["stubEffectiveStrict"] for l, v in theme.items()},
        "theme_naive_effectiveStrict": {l: v["stubEffectiveStrict"] for l, v in th_naive.items()},
        "theme_faithful_effectiveStrict": {l: v["stubEffectiveStrict"] for l, v in th_faith.items()},
        "base_effectiveStrict": {l: v["stubEffectiveStrict"] for l, v in base.items()},
        "theme_all_effective": all(v["stubEffectiveStrict"] for v in theme.values() if v["valid"]) if theme else None,
        "pathReachableClick_theme": {l: {k: v[k] for k in v if k.startswith("reach_")} for l, v in theme.items()},
        "pathReachableClick_theme_naive": {l: {k: v[k] for k in v if k.startswith("reach_")} for l, v in th_naive.items()},
        "pathReachableClick_base": {l: {k: v[k] for k in v if k.startswith("reach_")} for l, v in base.items()},
    }
    B = {
        "per_window": {l: {k: v[k] for k in v if k.startswith("raf") or k in ("mountTcRafScheduled", "tcRafScheduled")} for l, v in theme.items()},
        "naive_arm_per_window": {l: {k: v[k] for k in v if k.startswith("raf") or k in ("mountTcRafScheduled", "tcRafScheduled")} for l, v in th_naive.items()},
        "base_per_window": {l: {k: v[k] for k in v if k.startswith("raf") or k in ("mountTcRafScheduled", "tcRafScheduled")} for l, v in base.items()},
        "prod_defer_seen": any_true(theme, "rafByProdThemeDefer"),
        "prod_defer_seen_in_click": any_true(theme, "rafByProdThemeDeferInClick"),
        "prod_defer_seen_any_arm": any_true(th_naive, "rafByProdThemeDefer") or any_true(th_faith, "rafByProdThemeDefer") or any_true(base, "rafByProdThemeDefer"),
        "prod_stack_samples": [s for v in list(theme.values()) + list(base.values()) if v and v["rafProdStackSamples"] for s in v["rafProdStackSamples"]][:4],
        "other_callers_top": {l: v["rafOtherSamplesTop"] for l, v in list(theme.items()) + list(base.items()) if v},
        "sync_executed_prod": {l: v["syncExecutedProd"] for l, v in theme.items()},
        "sync_executed_prod_in_click": {l: v["syncExecutedProdInClick"] for l, v in theme.items()},
        "heartbeat_vs_prod_split": "同一窗口内 rafCallsTotal 里 rafByHeartbeat 是器械自身心跳（≈60/s×窗口时长），只有 rafByProdThemeDefer 才是生产调度；据此剥离器械陷阱。",
    }
    D_evidence = {
        "theme_click_meta_writes_all_zero": all_null(theme, "reach_metaWritesInClick"),
        "theme_click_defer_all_zero": all_null(theme, "reach_deferByProdInClick"),
        "theme_click_apply_all_false": not any_true(theme, "reach_applyInClick"),
        "base_click_meta_writes_all_zero": all_null(base, "reach_metaWritesInClick"),
    }
    repro_out = [{
        "label": r.get("label"),
        "control_realRaf": ((r.get("repro") or {}).get("armControl_真rAF")),
        "stubbed_sharedSyncRaf": ((r.get("repro") or {}).get("armStubbed_共享同步rAF")),
        "interpretation": ((r.get("repro") or {}).get("interpretation")),
        "counter_delta": ((r.get("repro") or {}).get("counterDeltaFromArm")),
    } for r in repro if r]

    # ---------------- D 裁决 ----------------
    KEY_METRICS = ["msToVisible", "recalcMsPerS", "rafP99", "taskBusyPct", "longtaskMaxMs"]

    def pair(k):
        """优先用「无 foreign 浏览器并发」的子集中位数；不足则退回全量中位数。"""
        v = cmp_tbl[k]
        t = v["theme_median_clean"] if v["theme_median_clean"] is not None else v["theme_median"]
        b = v["base_median_clean"] if v["base_median_clean"] is not None else v["base_median"]
        noise = max([x for x in (v["theme_iqr"], v["base_iqr"], v["external_base_iqr"]) if x is not None] or [0])
        return t, b, noise

    def decide():
        why = []
        if not theme or not any(v["valid"] for v in theme.values()):
            return "INCONCLUSIVE", "theme-sync 臂没有有效窗口（全部 CONTENDED/异常）"
        # 1) 治疗臂是否真的启用（生产 scheduleThemeColorRefresh 排的 rAF 被同步执行）
        if not any(v["syncExecutedProd"] for v in theme.values() if v["valid"]):
            return "INCONCLUSIVE", "同步化分支未被生产调用命中：无法判定（治疗未真正施加）"
        why.append("治疗已施加：theme 臂 %d/%d 个窗口观测到「生产 scheduleThemeColorRefresh 排的 rAF 被同步执行」(syncExecutedProd≥1，且全部发生在挂载相位)" % (
            sum(1 for v in theme.values() if v["valid"] and v["syncExecutedProd"]), sum(1 for v in theme.values() if v["valid"])))
        # 2) 延后/同步两条路径在点击相位的执行次数
        if D_evidence["theme_click_defer_all_zero"] and D_evidence["theme_click_meta_writes_all_zero"] and D_evidence["theme_click_apply_all_false"]:
            why.append("点击相位：生产排的 rAF=0、meta content 写入=0、ThemePresenter.apply=0（base/theme-sync 两臂一致）⇒ 本路径上「延后的写回」根本没有进入点击帧")
        elif D_evidence["theme_click_defer_all_zero"]:
            why.append("点击相位：生产排的 rAF=0")
        # 3) 五个口径的差 vs 噪声
        detail = []
        beyond = []
        for k in KEY_METRICS:
            t, b, nz = pair(k)
            if t is None and b is None:
                detail.append(f"{k}=两臂皆无（longtask 0 条）")
                continue
            d = None if (t is None or b is None) else round(t - b, 3)
            beyond_noise = (d is not None and abs(d) > 1.5 * nz + 1e-9)
            if beyond_noise:
                beyond.append(k)
            detail.append(f"{k}: theme={t} base={b} Δ={d} 噪声(极差)={nz}{' ←超噪声' if beyond_noise else ''}")
        why.append("；".join(detail))
        if beyond:
            return "PASS", "存在超出噪声的口径：" + ",".join(beyond) + "；" + "；".join(why)
        why.append("无任何口径超出噪声 ⇒ 同步 vs 延后在点击帧无可测差异；结合点击相位零执行，疑虑在本路径上无法成立")
        return "FAIL", "；".join(why)

    verdict, reason = decide()

    summary = {
        "face": "面4 主题 rAF 延后（theme-color meta 写回：延后到下一个 rAF vs 帧内同步）",
        "generated_at": __import__("datetime").datetime.now().astimezone().isoformat(),
        "arm_selection": arm_selection,
        "instrument": {
            "runner": "sub/raf-face-runner.mjs",
            "page_stub": "sub/raf-face-pagestub.js",
            "analyzer": "sub/raf-face-analyze.py",
            "theme_arm_windows": [v["label"] for v in theme.values()],
            "theme_naive_arm_windows": [v["label"] for v in th_naive.values()],
            "theme_faithful_arm_windows": [v["label"] for v in th_faith.values()],
            "base_arm_windows": [v["label"] for v in base.values()],
            "external_control_windows": sorted(extb.keys()),
            "params": {"settle_ms": 6000, "dwell_ms": 6000, "gatemax_ms": 180000},
        },
        "A_stub_effect": A,
        "B_production_raf_calls": B,
        "C_theme_sync_vs_base": cmp_tbl,
        "noise_floor": noise,
        "contention": contention,
        "D_verdict_evidence": D_evidence,
        "repro_shared_harness_defect": repro_out,
        "artifact_check": {
            "note": arm_selection["artifact_note"],
            "prod_defer_per_window": {**{("base/" + l): v["rafByProdThemeDefer"] for l, v in base.items()},
                                      **{("theme-faithful/" + l): v["rafByProdThemeDefer"] for l, v in th_faith.items()},
                                      **{("theme-naive/" + l): v["rafByProdThemeDefer"] for l, v in th_naive.items()}},
            "meta_content_writes_per_window": {**{("base/" + l): v["metaContentWrites"] for l, v in base.items()},
                                               **{("theme-faithful/" + l): v["metaContentWrites"] for l, v in th_faith.items()},
                                               **{("theme-naive/" + l): v["metaContentWrites"] for l, v in th_naive.items()}},
            "meta_writes_in_rAF_callback_per_window": {**{("base/" + l): v["metaWritesInRaf"] for l, v in base.items()},
                                                       **{("theme-faithful/" + l): v["metaWritesInSyncRafCb"] for l, v in th_faith.items()},
                                                       **{("theme-naive/" + l): v["metaWritesInSyncRafCb"] for l, v in th_naive.items()}},
        },
        "per_window": {"theme_primary": theme, "theme_alt": alt_theme, "base": base, "external_base": extb},
        "verdict": {"result": verdict, "reason": reason,
                    "legend": "PASS=疑虑成立(延后把成本推到点击帧)；FAIL=疑虑不成立；INCONCLUSIVE=证据不足"},
    }
    out = os.path.join(RAW, "rAF-face-summary.json")
    with open(out, "w") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    print("wrote", out)
    print(json.dumps({"primary_treatment_arm": arm_selection["primary_treatment_arm"],
                      "A_all_effective": A["theme_all_effective"],
                      "B_prod_defer": B["prod_defer_seen"], "B_prod_defer_in_click": B["prod_defer_seen_in_click"],
                      "verdict": verdict, "reason": reason}, ensure_ascii=False, indent=2))
    print("\n=== C: theme-sync vs base（中位数 / 相对差 / 组内极差 / 外部 base） ===")
    hdr = f"{'metric':24s} {'theme':>8s} {'tClean':>7s} {'base':>8s} {'bClean':>7s} {'Δ%':>7s} {'thIQR':>7s} {'baIQR':>7s} {'extBase':>8s} {'extIQR':>7s}"
    print(hdr)
    for k in METRICS:
        v = cmp_tbl[k]
        print(f"{k:24s} {str(v['theme_median']):>8s} {str(v['theme_median_clean']):>7s} {str(v['base_median']):>8s} "
              f"{str(v['base_median_clean']):>7s} {str(v['rel_diff_pct']):>7s} {str(v['theme_iqr']):>7s} {str(v['base_iqr']):>7s} "
              f"{str(v['external_base_median']):>8s} {str(v['external_base_iqr']):>7s}")
    print("\n=== 逐窗口 ===")
    for armname, a in (("theme(primary)", theme), ("theme(alt)", alt_theme), ("base", base)):
        for l, v in a.items():
            print(f"{armname:11s} {l:26s} valid={v['valid']} exclAll={v['exclusiveThroughout']} gate={v['gate']} waited={v['gateWaitedMs']}ms "
                  f"msToVis={v['msToVisible']} recalcMs/s={v['recalcMsPerS']} rafP99={v['rafP99']} ltMax={v['longtaskMaxMs']} busy%={v['taskBusyPct']} "
                  f"| prodDefer={v['rafByProdThemeDefer']}(click {v['rafByProdThemeDeferInClick']}) hb={v['rafByHeartbeat']}(click {v['rafByHeartbeatInClick']}) "
                  f"other={v['rafByOther']} syncProd={v['syncExecutedProd']} metaWrites={v['metaContentWrites']} metaWritesClick={v['reach_metaWritesInClick']}")


if __name__ == "__main__":
    main()
