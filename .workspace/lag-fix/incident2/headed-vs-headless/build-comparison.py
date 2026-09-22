#!/usr/bin/env python3
"""Rebuild the A/B/C comparison tables from the raw artifacts (recomputable)."""
import json, glob, os, statistics as st

ROOT = os.path.dirname(os.path.abspath(__file__))
ARMS = ['A', 'C-nogpu', 'C-gpu', 'B']

def load(pattern):
    out = []
    for f in sorted(glob.glob(os.path.join(ROOT, pattern))):
        if 'warmup' in f or 'smoke' in f or 'systeminfo' in f:
            continue
        try:
            out.append((os.path.basename(f), json.load(open(f))))
        except Exception:
            pass
    return out

def one(d):
    fr = d.get('frames', {}) or {}
    ia = fr.get('interval_after_click', {}) or {}
    lt = d.get('longtasks', {}) or {}
    ci = d.get('cdp_delta_interpreted', {}) or {}
    cd = d.get('cdp_delta', {}) or {}
    pp = d.get('cdp_paint_presence', {}) or {}
    sc = d.get('screen_initial', {}) or {}
    return {
        'click_to_panel_visible_frame_ms': fr.get('click_to_panel_visible_frame_ms'),
        'click_to_next_frame_ms': fr.get('click_to_next_frame_ms'),
        'frame_p50': ia.get('p50'), 'frame_p95': ia.get('p95'), 'frame_p99': ia.get('p99'),
        'frame_max': ia.get('max'), 'frames_n': ia.get('n'),
        'frames_over_50ms': ia.get('over50'),
        'frames_over_50ms_ratio': fr.get('frames_over_50ms_ratio_after_click'),
        'threshold_over50_ratio': 0.02,
        'longtask_n': lt.get('n'), 'longtask_max_ms': lt.get('max_ms'),
        'longtask_total_ms': lt.get('total_ms'), 'longtask_ms_per_s': lt.get('per_s'),
        'longtask_window': 'document lifetime up to the post-settle snapshot (dominated by page-load tasks, NOT the click window)',
        'longtask_entries': lt.get('entries'),
        'click_at_ms': fr.get('click_frame', {}).get('click_at_ms') if isinstance(fr.get('click_frame'), dict) else None,
        'longtasks_after_click_n': len([e for e in (lt.get('entries') or []) if (fr.get('click_frame') or {}).get('click_at_ms') is not None and e.get('start_ms', 0) >= (fr.get('click_frame') or {}).get('click_at_ms')]),
        'threshold_over50_ratio': 0.02,
        'ScriptDuration_ms': ci.get('ScriptDuration_ms'), 'TaskDuration_ms': ci.get('TaskDuration_ms'),
        'RecalcStyleDuration_ms': ci.get('RecalcStyleDuration_ms'), 'LayoutDuration_ms': ci.get('LayoutDuration_ms'),
        'LayoutCount': cd.get('LayoutCount'), 'RecalcStyleCount': cd.get('RecalcStyleCount'),
        'Paint_present': pp.get('Paint_present'), 'Paint_value': pp.get('Paint_value'),
        'CompositeLayers_present': pp.get('CompositeLayers_present'),
        'CompositeLayers_value': pp.get('CompositeLayers_value'),
        'devicePixelRatio': sc.get('devicePixelRatio'),
        'viewport': f"{sc.get('innerWidth')}x{sc.get('innerHeight')}",
        'screen_refreshRate': sc.get('refreshRate'),
        'invalid_reasons': d.get('invalid_reasons', []),
    }

campaign = {}
runs = {}
for f, d in load('raw/v2-*.json'):
    arm = (d.get('meta') or {}).get('arm') or '?'
    runs.setdefault(arm, {})[f] = one(d)
    campaign.setdefault(arm, []).append((f, one(d), d))

# startup/control probe artifacts
probe = {}
for f in sorted(glob.glob(os.path.join(ROOT, 'raw/startup-*.json'))):
    d = json.load(open(f))
    probe[os.path.basename(f)] = d

agg = {}
NUM = ['click_to_panel_visible_frame_ms', 'click_to_next_frame_ms', 'frame_p50', 'frame_p95', 'frame_p99',
       'frame_max', 'frames_over_50ms', 'frames_over_50ms_ratio', 'longtask_n', 'longtask_max_ms',
       'longtask_ms_per_s', 'ScriptDuration_ms', 'TaskDuration_ms', 'RecalcStyleDuration_ms',
       'LayoutDuration_ms', 'LayoutCount', 'RecalcStyleCount']
for arm, rows in campaign.items():
    a = {'n_reps': len(rows), 'per_rep': {f: r for f, r, _ in rows}, 'median': {}, 'range': {}}
    for k in NUM:
        vals = [r[k] for _, r, _ in rows if isinstance(r.get(k), (int, float))]
        if vals:
            a['median'][k] = round(st.median(vals), 3)
            a['range'][k] = [min(vals), max(vals)]
    a['Paint_present_all'] = sorted({str(r['Paint_present']) for _, r, _ in rows})
    a['CompositeLayers_present_all'] = sorted({str(r['CompositeLayers_present']) for _, r, _ in rows})
    a['startup_longtasks'] = [ (d.get('longtasks') or {}).get('entries') for _, _, d in rows ]
    agg[arm] = a

# harness-version split (v1 vs v2) for provenance
v1 = {}
for f, d in load('raw/[AC]-r*.json'):
    arm = (d.get('meta') or {}).get('arm') or '?'
    v1.setdefault(arm, []).append((f, one(d)))

out = {
    'generated_at': None,
    'protocol': 'research-v2/measure-hardening/docs/PROTOCOL.md v1 (endpoints: frames_over_50ms_ratio<=0.02, long_task_total_ms_per_s<=100, click-to-paint <=100ms secondary)',
    'harness_v2': 'measure-v2.mjs (same file for every arm)',
    'arms': agg,
    'startup_control_probe': probe,
    'harness_v1_superseded': {
        'note': 'v1 files kept for provenance only; v1 had three defects (readiness predicate false-negatives, unwired click->visible marker, marker installed after the rAF loop was registered). All numbers quoted in audit.md come from harness v2.',
        'arms': {k: [f for f, _ in v] for k, v in v1.items()},
    },
    'baseline_status': {
        'status': 'contended',
        'usable_as_baseline': False,
        'statement': "Measurement windows ran while 2 foreign headless_shell instances belonging to a sibling line were present (protocol section 0bis concurrency gate: foreign_instances=2 in every window); loadavg ~5.5. Absolute values (ms, ms/s, fps, p95/p99, over-threshold ratios) therefore must NOT be used as a baseline or for percentage attribution; only the protocol, the gates, the recomputation, and relative/zero/paired comparisons within the same window are usable.",
        'shared_probe_lock': 'not held - shared lock .workspace/lag-fix/research-v2/.probe.lock was held continuously by sibling line incident2-live-repro; our runner waited and then proceeded, recording every window',
    },
}
import datetime
out['generated_at'] = datetime.datetime.now().astimezone().isoformat()
p = os.path.join(ROOT, 'comparison.json')
json.dump(out, open(p, 'w'), ensure_ascii=False, indent=1)
print('wrote', p)
for arm in ARMS:
    a = agg.get(arm)
    if not a:
        print(f'{arm}: NO DATA')
        continue
    m = a['median']
    print(f"{arm}: reps={a['n_reps']} c2vf={m.get('click_to_panel_visible_frame_ms')} p95={m.get('frame_p95')} p99={m.get('frame_p99')} max={m.get('frame_max')} over50={m.get('frames_over_50ms')} o50ratio={m.get('frames_over_50ms_ratio')} lt_n={m.get('longtask_n')} lt_max={m.get('longtask_max_ms')} ltps={m.get('longtask_ms_per_s')} Script={m.get('ScriptDuration_ms')} Task={m.get('TaskDuration_ms')} RecalcDur={m.get('RecalcStyleDuration_ms')} LayoutDur={m.get('LayoutDuration_ms')} LC={m.get('LayoutCount')} RC={m.get('RecalcStyleCount')} Paint={a['Paint_present_all']} Comp={a['CompositeLayers_present_all']}")
