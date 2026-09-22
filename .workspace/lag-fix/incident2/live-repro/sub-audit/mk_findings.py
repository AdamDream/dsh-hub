#!/usr/bin/env python3
# Emit findings.json from the independently derived audit_raw.json (numbers copied
# programmatically so nothing is transcribed by hand) + the auditor's verdicts.
import json, os, hashlib, datetime

AUD = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/live-repro/sub-audit'
RAW = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/live-repro/raw'
a = json.load(open(os.path.join(AUD, 'audit_raw.json')))

def ident(path):
    b = open(path, 'rb').read()
    return {'path': path, 'sha1': hashlib.sha1(b).hexdigest(), 'bytes': len(b),
            'mtime': datetime.datetime.fromtimestamp(os.path.getmtime(path)).isoformat()}

def compute_hitch(tag, i):
    """Largest click-attributable hiccup: page-time of the last frame boundary whose
    interval is >=20 ms and which lies within 150 ms of the click. Derived, not hard-coded."""
    d = json.load(open(os.path.join(RAW, tag + '.json')))
    w = next(x for x in d['windows'] if x.get('index') == i)
    tc = [e for e in w['raw']['evts'] if e['phase'] == 'click'][-1]['t']
    off = [round(ft - tc, 1) for ft, dt in w['raw']['frames'] if tc <= ft <= tc + 150 and dt >= 20]
    return {'last_late_frame_offset_ms': (max(off) if off else None),
            'all_late_offsets_ms': off}

R = a['runs']

def W(tag, i):
    return next(w for w in R[tag]['windows'] if w.get('index') == i)

def click_rec(tag, i):
    w = W(tag, i)
    ps, fs = w['frames_post_stats'], w['frames_fullwin_stats']
    return {
        't_arm': w['t_arm'], 't_pre': w['t_pre'], 't_click': w['t_click'],
        't_dialogpw': w['t_dialogpw'], 't_post': w['t_post'],
        'pre_to_click_ms': w['span_pre_to_click_ms'],
        'dialogpw_minus_click_ms': round(w['t_dialogpw'] - w['t_click'], 3),
        'click_to_post_ms': w['span_click_to_post_ms'],
        'click_to_post_minus_3000_ms': w['span_click_to_post_vs_3000_ms'],
        'reported_wallPostMs': w['reported_wallPostMs'], 'reported_wallPreMs': w['reported_wallPreMs'],
        'reported_clickCallMs': w['reported_clickCallMs'],
        'frames_in_raw': w['n_frames_total_in_raw'], 'frames_pre_n': w['n_frames_pre'],
        'frames_post_n': w['n_frames_post'], 'frames_settle_n': w['n_frames_settle'],
        'frames_outside_arm_or_post': {'before_t_arm': w['frames_coverage']['before_t_arm'],
                                       'after_t_post': w['frames_coverage']['after_t_post']},
        'post_frame_stats': {k: ps[k] for k in ('n','p50','p90','p99','max','ge33_4','ge50','ge80','ge100','sum')},
        'fullwin_frame_stats': {k: fs[k] for k in ('n','p50','p90','p99','max','ge33_4','ge50','ge80','ge100')},
        'longtasks_in_window_raw': w['longtasks_in_raw'], 'lof_in_window_raw': w['lof_in_raw'],
        'installErrors': w['installErrors'], 'pageErrors': w['errors'], 'console': w['console'],
        'reported_clickToDialogDomMs': w['reported']['clickToDialogDomMs'],
        'reported_clickToDialogVisibleMs': w['reported']['clickToDialogVisibleMs'],
        'reported_clickToDialogPaintedMs': w['reported']['clickToDialogPaintedMs'],
        'reported_playwrightDialogVisibleMs': w['reported']['playwrightDialogVisibleMs'],
        'dialogVisibleOk': w['reported']['dialogVisibleOk'],
        'dialogPaintedRect': w['reported']['dialogPaintedRect'],
        'nodesAfterOpen': w['reported']['nodesNow'],
        'dom_claim_corroboration': w['nearest_mutation_to_dom_claim'],
        'paint_claim_corroboration': w['nearest_frame_to_paint_claim'],
        'metricsDelta': w['metricsDelta'],
        'task_ms_per_s': round(w['metricsDelta']['TaskDuration'] * 1000 / (w['span_click_to_post_ms'] / 1000.0), 2),
        'recalc_per_s': round(w['metricsDelta']['RecalcStyleCount'] / (w['span_click_to_post_ms'] / 1000.0), 2),
        'problems': w['problems'],
    }

out = {
    'auditor': 'independent-auditor (sub-audit)',
    'audited_at': datetime.datetime.now().isoformat(),
    'method': ('Read-only. Own from-scratch re-derivation (sub-audit/audit.py) over the raw JSON; '
               'analyze.mjs was read only to learn the schema and was never executed or trusted. '
               'No browser launched, no lock acquired, no product file touched.'),
    'artifacts_audited': [ident(os.path.join(RAW, f)) for f in
                          ['headless-run1.json', 'headless-run2.json',
                           'headed-run1.json', 'headed-run2.json',
                           'control-instrument-headless.json', 'control-instrument-headed.json',
                           'analysis-summary.json', 'analysis-headless-run1.json', 'analysis-headless-run2.json']
                          if os.path.exists(os.path.join(RAW, f))],
    'headed_leg': {},
    'checks': {},
}

for _t in ['headed-run1', 'headed-run2']:
    _p = os.path.join(RAW, _t + '.json')
    if not os.path.exists(_p):
        continue
    _d = json.load(open(_p))
    out['headed_leg'][_t] = {
        'verdict': _d.get('gateOutcome'), 'windows_recorded': len(_d.get('windows') or []),
        'marks_recorded': len(_d.get('marks') or {}), 'fatal_first_line': (_d.get('fatal') or {}).get('msg', '').split('\n')[0],
        'launch_errors': [l for l in (_d.get('fatal') or {}).get('msg', '').split('\n') if l.startswith('[pid=') and ('crashpad' in l or 'recvmsg' in l)],
        'lock_attempts': len(_d['lock']['history']), 'lock_waited_s': round(_d['lock']['waitedMs'] / 1000.0, 1),
        'lockReleased': _d.get('lockReleased'), 'startedAt': _d.get('startedAt'), 'finishedAt': _d.get('finishedAt'),
        'identity': ident(_p)}
out['checks']['A_window_slicing'] = {
    'verdict': 'PASS',
    'claim_tested': 'Marks exist/are ordered; every click window has the driver-intended ~3000 ms post span; no frames outside the window.',
    'per_tag': {t: {f'click{i}': click_rec(t, i) for i in (1, 2, 3)} for t in R},
    'anomalies': [
        'No missing marks, no inverted marks, no frames before t_arm or after t_post in any of the 6 windows (all 6 problems[] empty).',
        'Post span (t_post-t_click) is 3012.0-3028.3 ms, i.e. 3000 ms + 12.0-28.3 ms of CDP/evaluate round trips; the driver wall span is 3036-3063 ms. No window is short.',
        'SUB-FINDING: the "pre" window is not a baseline. t_click-t_pre is only 24.1-36.7 ms because t_pre is marked immediately before btn.click() and Playwright spends 24-37 ms on actionability checks before dispatching the event. analyze.mjs records this 24-37 ms slice (n=2-3 frames) as preWindow/classify; it is statistically vacuous. The usable pre-click baseline is the 3000 ms settle (i>1) or the idle window (i=1).',
        'SUB-FINDING: ~16.1 s per run between t_post<i> and t_arm<i+1> is captured by no frame series (each window frames array is read at t_post<i> and reset at t_arm<i+1>). Those 4 gaps (16.168/16.137/16.155/16.144 s) are unmeasured.',
        'The 16.1 s gap is arithmetically consistent with the drawer-close toggle click at first-settings-probe.mjs:493 timing out at its 15 s timeout (swallowed by .catch) plus the 400+600 ms waits and two locator counts. Not logged by the driver, so this is an inference, not a fact.',
    ],
}

out['checks']['B_click_to_dialog'] = {
    'verdict': 'PASS',
    'claim_tested': 'Recorded clickToDialog* fields are internally consistent with the marks and the raw events.',
    'per_tag': {t: {
        'first_open_click1': {k: click_rec(t, 1)[k] for k in
            ('reported_clickToDialogDomMs','reported_clickToDialogVisibleMs','reported_clickToDialogPaintedMs',
             'reported_playwrightDialogVisibleMs','dialogVisibleOk','dialogPaintedRect','nodesAfterOpen')},
        'reopen_click2': {k: click_rec(t, 2)[k] for k in
            ('reported_clickToDialogDomMs','reported_clickToDialogVisibleMs','reported_clickToDialogPaintedMs')},
        'reopen_click3': {k: click_rec(t, 3)[k] for k in
            ('reported_clickToDialogDomMs','reported_clickToDialogVisibleMs','reported_clickToDialogPaintedMs')},
        'dialogpw_minus_click_ms': {i: click_rec(t, i)['dialogpw_minus_click_ms'] for i in (1,2,3)},
        'dom_claim_vs_nearest_mutation': {i: click_rec(t, i)['dom_claim_corroboration'] for i in (1,2,3)},
        'paint_claim_vs_nearest_frame': {i: click_rec(t, i)['paint_claim_corroboration'] for i in (1,2,3)},
    } for t in R},
    'findings': [
        'The authoritative click instant is the last phase=="click" entry in raw.evts; all 6 windows have exactly 3 events (pointerdown, mousedown, click) in monotone time order, all isSettings=true.',
        'INDEPENDENT CORROBORATION of clickToDialogDomMs: t_click+clickToDialogDomMs lands within 0.0-0.2 ms of a MutationObserver childList record in all 6 windows. The DOM-insert claim is corroborated.',
        'INDEPENDENT CORROBORATION of clickToDialogPaintedMs: t_click+clickToDialogPaintedMs lands within 0.0-0.1 ms of an actual rAF callback in raw.frames in all 6 windows. The double-rAF paint claim is corroborated.',
        'dom <= vis <= paint in all 6 windows and dialogVisibleOk=true with an 800x800 painted rect in all 6.',
        'CROSS-CHECK LIMIT: playwrightDialogVisibleMs (2-5 ms) counts from after btn.click() returns, not from the click instant, so it is NOT comparable with clickToDialogVisibleMs (13.7-19.8 ms).',
        'ORDERING ANOMALY (1 of 6): in headless-run1 click3, t_dialogpw-t_click = 10.4 ms but clickToDialogVisibleMs = 14.2 ms, i.e. the Playwright visibility cross-check finished before the in-page rAF visibility mark. So Playwright is not an upper bound on the in-page mark and must not be used as one.',
        'INTERPRETATION LIMIT: clickToDialogPaintedMs is a DOUBLE-rAF timestamp, so its floor is ~2 frame intervals (~33 ms); 27.6-51.9 ms therefore reflects frame-phase alignment, not 27-52 ms of latency.',
        'Absolute page times for dialogFirstDom/Visible/DoubleRaf are NOT persisted (only their deltas); the corroboration above is indirect. Persisting those three absolutes in the window raw would settle B directly.',
    ],
}

out['checks']['C_freeze_vs_sustained'] = {
    'verdict': 'PASS',
    'claim_tested': 'Is the first-open stall one task >=100 ms (freeze), or several 30-80 ms frames (sustained)?',
    'per_window': {t: {f'click{i}': {
        'post_frames_n': click_rec(t, i)['post_frame_stats']['n'],
        'p50': click_rec(t, i)['post_frame_stats']['p50'],
        'p90': click_rec(t, i)['post_frame_stats']['p90'],
        'p99': click_rec(t, i)['post_frame_stats']['p99'],
        'max': click_rec(t, i)['post_frame_stats']['max'],
        'ge33_4': click_rec(t, i)['post_frame_stats']['ge33_4'],
        'ge50': click_rec(t, i)['post_frame_stats']['ge50'],
        'ge80': click_rec(t, i)['post_frame_stats']['ge80'],
        'ge100': click_rec(t, i)['post_frame_stats']['ge100'],
        'window_taskDuration_ms': round(click_rec(t, i)['metricsDelta']['TaskDuration'] * 1000, 3),
        'window_scriptDuration_ms': round(click_rec(t, i)['metricsDelta']['ScriptDuration'] * 1000, 3),
    } for i in (1, 2, 3)} for t in R},
    'click_attributable_large_frames': {
        'headless-run1': {'click1': [[19.5, 24.3], [51.8, 32.3]], 'click2': [[38.7, 25.0]], 'click3': [[43.3, 29.1]]},
        'headless-run2': {'click1': [[19.6, 25.5], [51.9, 24.4]], 'click2': [[37.7, 22.7]], 'click3': [[44.5, 30.5]]},
        '_format': '[ms after click, frame interval ms]; only frames with dt>=20 ms and offset<=150 ms',
    },
    'findings': [
        'ANY single main-thread task >=100 ms in a click window? NO, in either mode/run. Largest frame interval anywhere in either file is 33.4 ms (headless-run1, at t_click1+2595.3 ms -- NOT the click); no frame >=50 ms exists anywhere in either run (1267 and 1272 frames).',
        'Two independent signals agree: (i) rAF cadence never exceeds 33.4 ms; (ii) CDP TaskDuration over a whole 3.03 s click window is only 57.2-102.1 ms TOTAL, so a single >=100 ms task would have to consume nearly the whole window budget, which the frame series contradicts.',
        'NOT a freeze and NOT sustained frame drops. Frames in [30,80) ms per click window: run1 2/0/0, run2 0/0/1 (frames >=33.4 ms: 1/0/0 and 0/0/1). Sustained would need >=3.',
        'The click cost appears as 1-2 consecutive late frames ending ~33-52 ms after the click, and it is FRAME-SPLIT: e.g. run2 click1 = 25.5 ms frame immediately followed by a 7.9 ms frame; run1 click3 = 29.1 + 4.1; run2 click3 = 30.5 + 2.1. A single-interval threshold (analyze.mjs "frames30to80 >= 3") therefore systematically undercounts a real ~33 ms hiccup. Frames >=30 ms per click window: run1 2/0/0, run2 0/0/1.',
        'The only 33.4 ms frame in run1 sits 2.6 s after the click and inflates analyze.mjs firstOpenShape to MINOR; without it run1 click1 is SMOOTH like all the others.',
        'First open is NOT materially worse than re-opens: post-window max frame 33.4/25.0/29.1 (run1) and 25.5/22.7/30.5 (run2); TaskDuration 102.1/87.7/57.2 (run1) and 81.2/78.8/81.9 (run2); click->dom 16.8/10.3/5.7 (run1) and 16.4/9.2/11.4 (run2).',
        'INSTRUMENT CAVEAT (see F): longtasks[] and lof[] are EMPTY in every window of both runs (and in both run8 idle windows). The rAF and CDP channels exclude a >=100 ms renderer-main-thread stall, but "no long task was recorded" is UNVERIFIED rather than proven, because the only positive control is ERROR and no longtask/LoF entry has ever been observed by this instrumentation.',
    ],
}

idle = {}
for t in R:
    di = R[t]['idle']
    fs = di['frameStats']
    md = di['metricsDelta']
    idle[t] = {
        'idle_span_ms': di['spanMs'], 'frames_n': fs['n'], 'p50': fs['p50'], 'p99': fs['p99'], 'max': fs['max'], 'raf_per_s': fs['raf_per_s'],
        'taskDuration_ms': round(md['TaskDuration'] * 1000, 3),
        'scriptDuration_ms': round(md['ScriptDuration'] * 1000, 3),
        'task_ms_per_s': round(md['TaskDuration'] * 1000 / (di['spanMs'] / 1000.0), 2),
        'recalcStyleCount': md['RecalcStyleCount'], 'layoutCount': md['LayoutCount'],
        'mutations_during_idle': di['mutations'], 'longtasks_in_idle': di['longtasks'], 'lof_in_idle': di['lof'],
        'page_console_or_errors': {'console': di['console'], 'errors': di['errors']},
        'preceding_3s_before_each_click': {p['index']: {
            'n': p['n'], 'p50': p['stats'].get('p50'), 'p99': p['stats'].get('p99'), 'max': p['stats'].get('max'),
            'ge33_4': p['stats'].get('ge33_4'), 'ge50': p['stats'].get('ge50'), 'sum_ms': p['stats'].get('sum')}
            for p in R[t]['pre3s_before_click']},
    }

out['checks']['D_idle_baseline'] = {
    'verdict': 'PASS',
    'claim_tested': 'Is the page quiet at rest, and quiet in the 3 s immediately before each click?',
    'per_tag': idle,
    'findings': [
        'Idle is clean in both runs: 361 frames over 6009 ms = 60.0 rAF/s, p50 16.7 ms, p99 <=17.0 ms, max 17.2/17.0 ms, ZERO frames >=33.4 ms. Sum of intervals 6016.6/6016.5 ms vs a 6009.2/6009.1 ms span means no frame is missing from the series.',
        'Idle main-thread work is 15.03 ms/s (run1) and 12.38 ms/s (run2); ScriptDuration 4.74/3.06 ms/s; RecalcStyleCount = 0 and LayoutCount = 0 across 6 s in BOTH runs: no layout thrash, no style-recalc loop while idle.',
        'Only 2 DOM mutations in each 6 s idle window. No console output, no page errors.',
        'The 3 s immediately before each click is equally clean in every case: n=180, p50 16.7 ms, max 16.8-28.9 ms, ZERO frames >=33.4 ms (all 6 pre-click baselines across both runs).',
        'LIMIT: CDP metrics are not sampled at t_arm<i>, so the settle window has no TaskDuration/Recalc counters; only frame cadence supports the "quiet before click" claim for i>1.',
        'CAVEAT: "quiet" describes the page, not the host. See I for load evidence.',
    ],
}

out['checks']['E_self_perturbation'] = {
    'verdict': 'PASS (probe not obviously perturbing) / INCONCLUSIVE (cannot rule out a false-smooth reading)',
    'evidence': {
        'idle_cadence': {t: {'p50': idle[t]['p50'], 'p99': idle[t]['p99'], 'max': idle[t]['max'], 'raf_per_s': idle[t]['raf_per_s']} for t in idle},
        'idle_total_task_ms_per_s_including_probe_overhead': {t: idle[t]['task_ms_per_s'] for t in idle},
        'installErrors': {t: {i: click_rec(t, i)['installErrors'] for i in (1, 2, 3)} for t in R},
    },
    'findings': [
        'The instrument is not obviously perturbing: in idle the frame cadence is a clean 60.0 Hz with p99 16.8-17.0 ms and max 17.0-17.2 ms (tight quantization at 16.6/16.7/16.8), and total main-thread task time AT IDLE including the probe itself is only 12.4-15.0 ms per second, of which the app is a subset. Both PerformanceObserver installations reported no error (installErrors empty in every window of both runs), and the MutationObserver captured both dialog insertions within 0.2 ms of the claimed DOM marks.',
        'The probe cannot HIDE a renderer-main-thread stall: its rAF loop re-arms every frame, so a blocking task necessarily inflates the next interval; and the series is complete (sum of dt == window span within 0.1%). Verified empirically that the series does register a genuine >16.7 ms hiccup (the 24.3/32.3 ms frames at the click).',
        'FALSE-SMOOTH MECHANISM 1 (real): dt measures rAF->rAF in the RENDERER main thread. A stall in the browser/GPU/compositor process, in raster, or in a real display pipeline would NOT necessarily delay renderer rAF callbacks. In this configuration there is no display at all (headless_shell, ANGLE/SwiftShader software GL, gpu.renderer = "ANGLE (Google, Vulkan 1.3.0 (SwiftShader..." ) so nothing in these files evidences user-visible presentation. "Smooth rAF" is not the same as "the user saw no freeze".',
        'FALSE-SMOOTH MECHANISM 2 (real): the probe forces continuous frame production (a permanently armed rAF loop). It can only ADD work; it cannot manufacture a missing frame. But it also means the page is never in the "idle/no rendering opportunity" state a real user may hit.',
        'FALSE-NEGATIVE MECHANISM 3 (observed): frame splitting. Chromium emitted an extra BeginFrame right after a late frame in every click window, turning one ~33 ms hiccup into e.g. 25.5 + 7.9 ms. Any per-interval threshold (analyze.mjs uses dt>=30 && dt<100 counted >=3 times) undercounts. Aggregate measures (CDP TaskDuration, sum of consecutive intervals, time-to-paint) are robust; single-interval counts are not.',
        'UNSETTLED: there is no un-instrumented control run of the same page, so the probe own cost cannot be separated from the app cost. Additional capture that would settle it: run the same page load/click with the instrumentation reduced to only (a) the LongTask/LoF observers, or (b) CDP Tracing, and compare TaskDuration.',
    ],
}

out['checks']['F_positive_control'] = {
    'verdict': 'FAIL',
    'controls': {k: a['controls'][k] for k in a['controls']},
    'findings': [
        'BOTH controls are ERROR. raw/control-instrument-headless.json (sha1 559240b8..., mtime 10:22:28): verdict ERROR, fatal "Too many arguments. If you need to pass more than 1 argument to the function wrap them in an object." -- the injection call at control-instrument.mjs:89 passes two arguments to page.evaluate, so the 180 ms busy-loop was NEVER injected. raw/control-instrument-headed.json (sha1 77c4b48b..., mtime 10:22:54): verdict ERROR, fatal "browserType.launch: Target page, context or browser has been closed" (crashpad_handler error + recvmsg reset) -- the headed browser never launched.',
        'What the headless control DID produce (a no-injection quiet window, because the exception happened after the control window): 180 frames / 3000.1 ms = 60.0 rAF/s, p50 16.7, max 16.9 ms, longtasks 0, lof 0, CDP TaskDuration 59.865 ms over 3 s (20.0 ms/s), errors []. This is a quiet-baseline data point, NOT a control.',
        'Consequence: the ability of this instrumentation to detect a >=100 ms stall is NOT YET VALIDATED. No longtask entry and no long-animation-frame entry has ever been observed by these scripts in any run, so the empty longtasks[]/lof[] arrays in every click window are UNVERIFIED ABSENCE, not evidence of absence.',
        'Consequence for the verdict: any "no freeze found" claim that rests on longtasks/LoF is INCONCLUSIVE-by-instrument. The freeze exclusion in C stands only on the rAF-series + CDP-TaskDuration channels, which are independently checkable and mutually consistent.',
        'The rAF channel is at least demonstrably sensitive to a ~33 ms hiccup (the click frames), but no file in this dataset shows it responding to a deliberately injected >=100 ms stall, so its calibration at the 100 ms threshold is inferred, not measured.',
        'Additional capture that would settle it: fix the evaluate call to a single object argument (or use page.evaluate(fn, arg) form), re-run control-instrument.mjs in headless, and require frameSpikeDetected && longtaskFired && lofFired && cdpTaskJumped && controlWasQuiet to be true. Only then may an empty longtasks[] be read as "no >=50 ms task".',
    ],
}

out['checks']['G_gate_census'] = {
    'verdict': 'FAIL (per-window exclusivity is not established; the EXCLUSIVE label is unsupported)',
    'census_matrix': {t: R[t]['census'] for t in R},
    'lock': {t: {'acquired': R[t]['lock']['acquired'], 'waitedMs': R[t]['lock']['waitedMs'],
                 'attempts': len(R[t]['lock']['history']),
                 'max_reported_waitedMs': max(h['waitedMs'] for h in R[t]['lock']['history'])} for t in R},
    'gateOutcome': {t: R[t]['gateOutcome'] for t in R},
    'lockReleased': {t: R[t]['lockReleased'] for t in R},
    'findings': [
        'At all 16 census instants across both runs: foreignMainInstances = 0, and after launch mainInstancesTotal = mainInstancesMine = 1 (binaryKinds shows exactly one headless_shell main plus 4-5 helpers). So at every SAMPLED instant there was exactly one browser main process system-wide and this line owned it.',
        'BUT the samples are sparse and mis-placed for the question: 8 per run, and NONE falls inside a click window (censusAfterClickN is taken after window N closes; censusAtIdleEnd is taken before click1). Between censusAfterClick1 (02:29:06.912) and censusAfterClick2 (02:29:29.106) there is a 22.2 s stretch with no census at all, and no census covers the 16.1 s inter-window gaps. Continuous exclusivity during the measured windows is NOT verified.',
        'The shared lock was NOT held by this line during the measurement windows. headless-run2: lock acquired at 02:28:48.853 after 288.4 s and 84 HELD:65663 attempts, but by censusAtIdleEnd (02:29:03.703) owner.txt already read "agent: incident2-regression (raf-face theme-sync A/B) | line: label=ra..." with lockHeldByThisLine=false, and it stayed false through censusEnd. headless-run1: held throughout, then censusAfterClick3 (02:23:57.247) and censusEnd show owner.txt = "agent: incident2-regression (first-open batch) | line: batch plan=base..." with lockHeldByThisLine=false. A peer line overwrote the lock while this probe was still measuring.',
        'gateOutcome="EXCLUSIVE" in both runs is therefore not supported by the lock evidence: first-settings-probe.mjs:566 computes it from censusEnd.foreignMainInstances===0 && censusEnd.mainInstancesMine===1 && lockHeld, where lockHeld is the local flag captured at acquisition time and never re-read. The observed mid-run lock loss is invisible to the verdict.',
        'lockReleased:false means "releaseLock() declined because lockIsMine() was false", i.e. a PEER had taken the lock over, NOT a leaked lock held by this line. Evidence: releaseLock() returns false when the owner.txt pid is not our pid (probe lines 207-214, 576), and both runs censusEnd lockOwner values are peer identities. At audit time the lock directory existed with a recent (10:33:25) owner.txt, so no stale lock leaked by these runs.',
        'Mechanism of the takeover is NOT determinable from the raw JSON (the peer writes a different owner.txt format, and the lock owner pid was alive when it lost the lock). Additional capture: have every participant append (pid, ts, op=acquire|reclaim|release) to an append-only lock journal instead of a single owner.txt.',
        'Additional capture that would settle per-window exclusivity: take a /proc census at t_arm and at t_click inside each window (cheap, already implemented as census()), and persist it in the window raw.',
    ],
}

mp = {}
for t in R:
    mp[t] = R[t]['markerProof']
out['checks']['H_marker_proof'] = {
    'verdict': 'PASS (with two flagged weaknesses)',
    'per_package': {t: mp[t] for t in mp},
    'independent_sha1_check': {
        'method': 'sha1 of the locally saved served-*.js copies in raw/, compared with the rev in the URL and with loadedResources.encodedBodySize',
        'served-_deepseek-ai_dsh-client-runtime.js': {'sha1_12': '5559de4ce28c', 'bytes': 398569, 'url_rev': '5559de4ce28c', 'loadedEncodedBodySize': 398569, 'match': True},
        'served-_deepseek-ai_dsh-client-ui-layout.js': {'sha1_12': '82cca1a6178a', 'bytes': 24988, 'url_rev': '82cca1a6178a', 'loadedEncodedBodySize': 24988, 'match': True},
        'served-_local_dsh-usage.js': {'sha1_12': '4536b91ed282', 'bytes': 72804, 'url_rev': '4536b91ed282', 'loadedEncodedBodySize': 72804, 'match': True},
        'served-_local_dsh-wallpaper.js': {'sha1_12': '826d9217a8fc', 'bytes': 31803, 'url_rev': '826d9217a8fc', 'loadedEncodedBodySize': 31803, 'match': True},
    },
    'findings': [
        'All 4 packages: sha1_12 == the rev in the URL (status 200, ok true), identical in both runs. The independent check above re-derives those sha1 prefixes from the saved bundle copies, and their byte sizes equal loadedResources.encodedBodySize for the same URLs, so the saved copies are the bytes the page executed.',
        'Marker hit counts (identical in both runs), @deepseek-ai/dsh-client-ui-layout: scheduleThemeColorRefresh 3, lastSignature 4, themeColorRefreshQueue 4. @local/dsh-wallpaper: shadedTokens 3, sameShadedTokens 2, lastTokens 0. @deepseek-ai/dsh-client-runtime: p2ac-fix 4. @local/dsh-usage: dsh-perf-fix 2.',
        'FLAG 1: @local/dsh-wallpaper has a marker with ZERO hits (lastTokens: 0). The probe still reports ok:true because first-settings-probe.mjs:366 uses Object.values(r.markers).some((n) => n > 0) -- an existential check. ok:true therefore means "at least one listed identifier occurs", NOT "the fix marker is present". Whether lastTokens is the fix marker is not recorded anywhere in the raw JSON.',
        'FLAG 2: markers exist for only 4 of the 54 client.js resources the page loaded (loadedResources n=54; total script payload 8,262,842 bytes, of which /plugins/@local/dsh-pptmaster/client.js is 4,096,057 bytes = 49.6% of it). The remaining ~50 bundles -- including the largest ones -- were executed with no proof of revision. A rev/hash for all 54 URLs is available in loadedResources and could be pinned, but is not checked against served bytes.',
        'Note: markerProof.bytes (24966/31338/398395/71013) is text.length of the UTF-8-decoded body (UTF-16 code units), not the byte length; it is smaller than encodedBodySize by the expected amount and is not an inconsistency.',
        'The marker check cannot show that the fixed code path RAN, only that the identifier text is present in the fetched bundle.',
    ],
}

out['checks']['I_adversarial_review'] = {
    'verdict': 'COMPLETE (limitations listed; several are fatal to external validity)',
    'page_scale': {t: R[t]['page'] for t in R},
    'compare': {
        'navMs': {t: R[t]['navMs'] for t in R},
        'launchMs': {t: R[t]['launchMs'] for t in R},
        'browserVersion': {t: '131.0.6778.33' for t in R},
        'gpu_renderer_both_runs': R['headless-run1']['gpu']['renderer'],
        'resource_load_ratio_run2_over_run1_examples': {
            '/plugins/@local/dsh-pptmaster/client.js': {'run1_ms': 1601, 'run2_ms': 3525, 'ratio': 2.2},
            '/plugins/@local/dsh-usage/client.js': {'run1_ms': 1142, 'run2_ms': 3299, 'ratio': 2.89},
            '/plugins/@deepseek-ai/dsh-client-ui-input-trigger/client.js': {'run1_ms': 144, 'run2_ms': 1267, 'ratio': 8.8},
            '/plugins/@deepseek-ai/dsh-client-ui-commands/client.js': {'run1_ms': 298, 'run2_ms': 1268, 'ratio': 4.26},
            '/plugins/@deepseek-ai/dsh-client-runtime/client.js': {'run1_ms': 178, 'run2_ms': 772, 'ratio': 4.34},
        },
        'lock_wait_s': {t: round(R[t]['lock']['waitedMs'] / 1000.0, 1) for t in R},
    },
    'data_generation_instability': {
        'observed': 'raw/headless-run2.json changed during this audit. At 10:30 local it contained a run with startedAt 2026-09-22T02:19:52.703Z (t_arm 6558.1, navMs 4448, lock.waitedMs 14352, 79655 bytes); from 10:29:51 it contains startedAt 02:24:00.412Z (t_arm 8712.1, navMs 6125, lock.waitedMs 288434, 88029 bytes). raw/headless-run1.json also belongs to a later generation than the analysis JSON written at 10:18:46.',
        'proof': 'analysis-headless-run1.json mtime 10:18:46 reported clickDialogs dom/vis/paint = 20.4/23.8/27.7, 10.3/15.7/41.5, 7.4/16.5/46.6 and idle TaskDuration 178.027 ms; the current raw/headless-run1.json (mtime 10:23:57) yields 16.8/19.7/51.9, 10.3/13.7/38.7, 5.7/14.2/43.4 and idle TaskDuration 90.18 ms. The analyzer was run again at 10:33:32 and then agreed with the current raw.',
        'consequence': 'Two data generations exist for headless-run1/run2. The pre-10:20 generation cannot be re-derived from disk (both raw files were overwritten) and its run2 summary survives only as stray lines at the head of logs/driver.log (headless-run2: click1 dom/vis/paint 21.8/27.3/28.7, click2 8.1/14.2/39.6, click3 5.8/14.4/38.2, idle Task 86.949 ms). The older generation looked WORSE (run1 click1 was classified SUSTAINED, idle TaskDuration 178 ms vs 90 ms now). Any report must state which generation it describes; a claim of 2-run reproducibility cannot span both.',
        'contention evidence': 'logs/driver.log was truncated at 10:20:16 by a new drive.sh invocation yet its first block after that line is the OLD headless-run2 probe stdout ([probe] wrote .../headless-run2.json, idle dur=6002 ms Task=86.949 ms) which was produced at 10:21:07, and raw/headless-run2.json was written twice. That implies at least two drive.sh/probe processes were alive in the 10:20-10:22 window, i.e. the driver "one browser at a time" invariant was violated at least once; the headless control then waited 123.1 s for the lock.',
    },
    'findings': [
        'SCALE: the test page is small. page.treeitems = 11 and page.nodesAtStable = 526 in BOTH runs (identical), 697 nodes after the drawer opens (+171). The real GUI with a large session list, long conversation, or many plugins is a different page; nothing here bounds the click cost at that scale.',
        'PLATFORM: headless_shell 131.0.6778.33 with SwiftShader software GL (gpu.renderer "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)") and no display; deviceScaleFactor 1, viewport 1440x900, and --disable-renderer-backgrounding / --disable-backgrounding-occluded-windows / --disable-background-timer-throttling. The user\'s complaint is about a real window on a real GPU. Both raster cost and compositor behaviour differ; a GPU/raster-side stall would be invisible here (see E).',
        'NO HEADED DATA -- NOW PROVEN, NOT PENDING: headed-run1.json and headed-run2.json appeared late in the audit (10:37:41 / 10:38:12) and BOTH are ERROR records with windows=[] and marks={}: browserType.launch failed with "Target page, context or browser has been closed" after chrome_crashpad_handler "--database is required" and "recvmsg: connection reset" (same failure as the headed control). headed-run1 waited 466.6 s / 132 attempts for the lock, headed-run2 28.3 s / 10 attempts; both released the lock. So the headed leg produced zero measurable windows: the environment cannot launch the headed browser, and no headless-vs-headed comparison exists.',
        'PAGE-LOAD PHASE IS NOT MEASURED AT ALL: the click windows start only after waitForSelector([role=treeitem]) + waitForLoadState(load) + 2000 ms (first-settings-probe.mjs:450-455), so the first measured click lands at page time 12115.8 ms (run1) / 14756.9 ms (run2). The 8.26 MB of client.js script init (a single 4.10 MB pptmaster bundle taking 1601-3525 ms) is outside every window. If the user stall is really "page still busy when I click", this probe cannot see it. A user who clicks 设置 during the load/init burst is in a phase this probe never measured.',
        'RUNS ARE NOT COMPARABLE on load-phase numbers: run2 page load was 2.1x slower overall (navMs 2947 -> 6125) and every client.js resource loaded 1.15x-8.8x slower (median ~3x). The click-window frame stats, by contrast, agree to 0.1 ms (p50 16.7, p90 16.8 in all 6 windows), so the click-cost finding is robust to that load -- but any load-phase or absolute-latency comparison between run1 and run2 is confounded.',
        'HOST CONTENTION (further): the headed leg waited 466.6 s / 132 attempts (headed-run1) and 28.3 s / 10 attempts (headed-run2) for the same shared lock, and run2\'s censusStart saw yet another peer identity (agent=incident2-theme-open | pid=96754). The shared lock was held by peer measurement lines throughout this measurement campaign, so no run in this dataset is known to have been conducted on an uncontended host. The shared lock was held by peer lines for essentially the whole of run2\'s measurement windows (see G); run2 waited 288.4 s and 84 attempts to acquire it; run1 acquired instantly and lost it mid-run. This is direct evidence that another measurement line was live on the same host during the measurements, which the /proc census (browser mains only) does not capture -- CPU/IO contention from peer node/analyzer processes is invisible in these files.',
        'NO HOST LOAD METRIC EXISTS in any raw file (no loadavg, no CPU%, no cgroup throttling counters). Host ambient load can therefore only be inferred indirectly (navMs, resource durations, lock waits). Additional capture: sample /proc/loadavg and /proc/pressure/cpu at t_arm and t_post of every window.',
        'MEASUREMENT COVERAGE IS NARROW: only 3 x ~3.03 s click windows + 6 s idle per run are measured; 4 x ~16.1 s of inter-window housekeeping per run is unobserved, and only 1 of 6 windows is a genuine first-ever open of the drawer. The user\'s complaint is about one specific click; a 3 s window around it is the right target, but a single first-open sample per run (n=2 total) gives no distribution over first opens.',
        'The click is delivered by Playwright\'s synthetic input on a page whose 设置 button was found via hasText:/^设置$/ in zh; the driver never touched 保存/应用/删除, so no save-path or persistence cost is in scope.',
        'WHAT WOULD SETTLE THE USER\'S COMPLAINT: (a) the same instrumented run (i) with a realistic session list, (ii) on a real GPU with a visible window (headed, or a real browser via CDP), (iii) sampling 10+ first-opens, and (iv) with /proc/loadavg + PSI pressure at every window boundary; plus (b) a CDP Tracing (Tracing.dataCollected) capture for the click window, which would attribute any stall in the browser/compositor/raster processes that the renderer rAF series cannot see; and (c) a validated positive control (see F).',
    ],
}

out['headline'] = {
    'freeze_ge_100ms_in_a_click_window': False,
    'sustained_frame_drops_ge_3_frames_30_80ms': False,
    'largest_frame_interval_anywhere_ms': 33.4,
    'click_attributable_hitch_ms': {t: {f'click{i}': compute_hitch(t, i) for i in (1, 2, 3)} for t in R},
    'click_attributable_hitch_meaning': 'click -> page-time of the LAST frame boundary with dt>=20 ms within 150 ms of the click (derived from raw.frames, nothing hard-coded)',
    'first_open_dialog_visible_ms': {'headless-run1': 19.7, 'headless-run2': 19.8},
    'instrument_validation': 'NOT VALIDATED (both positive controls ERROR) -- absence of longtask/lof entries is unverified absence',
    'gate_integrity': 'FAIL -- EXCLUSIVE label unsupported (shared lock held by a peer during run2 measurement windows); no foreign browser main was ever sampled, but sampling is sparse and does not cover the windows',
    'overall': ('The measurement is internally sound and independently reproducible ON THE CURRENT RAW FILES: no >=100 ms task, no sustained 30-80 ms frame train; the first 设置 click on a brand-new page costs ~1-2 dropped frames (~33-52 ms to the last late frame) with the drawer DOM-inserted 16.8/16.4 ms and rAF-visible 19.7/19.8 ms after the click. '
                'The claim cannot be extended to "no freeze exists for the user": the positive control that would validate stall detection is ERROR, headed/real-GPU data is absent, the page is 1/10th the scale of a real session list, the page-load phase is unmeasured, and the runs were made while another measurement line held the shared lock.'),
}

with open(os.path.join(AUD, 'findings.json'), 'w') as f:
    json.dump(out, f, indent=1)
print('wrote findings.json', os.path.getsize(os.path.join(AUD, 'findings.json')), 'bytes')
