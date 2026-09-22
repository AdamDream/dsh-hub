#!/usr/bin/env python3
# INDEPENDENT re-derivation of the incident2/live-repro measurements.
# Written from scratch by the auditor; does not import or execute analyze.mjs.
# Read-only over raw/*.json. Writes audit_raw.json into the auditor's own out dir.
import json, os, math, glob, sys

RAW = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/live-repro/raw'
OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/live-repro/sub-audit'
TAGS = sorted(os.path.basename(p)[:-5] for p in glob.glob(os.path.join(RAW, '*-run*.json'))
              if not os.path.basename(p).startswith('analysis-'))
CTL  = sorted(os.path.basename(p)[:-5] for p in glob.glob(os.path.join(RAW, 'control-instrument-*.json')))

def pctl_nearest_rank(vals, p):
    """Nearest-rank percentile: index ceil(p/100*n)-1 on the sorted list."""
    if not vals: return None
    s = sorted(vals)
    k = max(0, min(len(s)-1, math.ceil(p/100.0*len(s))-1))
    return s[k]

def pctl_linear(vals, p):
    """Linear-interpolation percentile (a different convention, for cross-check)."""
    if not vals: return None
    s = sorted(vals)
    if len(s) == 1: return s[0]
    pos = (len(s)-1)*p/100.0
    lo, hi = math.floor(pos), math.ceil(pos)
    return s[lo] + (s[hi]-s[lo])*(pos-lo)

def fstats(dts):
    if not dts:
        return {'n': 0}
    return {
        'n': len(dts),
        'min': round(min(dts), 3),
        'p50': round(pctl_nearest_rank(dts, 50), 3),
        'p90': round(pctl_nearest_rank(dts, 90), 3),
        'p99': round(pctl_nearest_rank(dts, 99), 3),
        'p99_lin': round(pctl_linear(dts, 99), 3),
        'max': round(max(dts), 3),
        'mean': round(sum(dts)/len(dts), 3),
        'sum': round(sum(dts), 3),
        'ge33_4': sum(1 for v in dts if v >= 33.4),
        'ge50':   sum(1 for v in dts if v >= 50),
        'ge80':   sum(1 for v in dts if v >= 80),
        'ge100':  sum(1 for v in dts if v >= 100),
        'ge200':  sum(1 for v in dts if v >= 200),
        'raf_per_s': round(1000.0/(sum(dts)/len(dts)), 2),
    }

def load(tag):
    with open(os.path.join(RAW, tag + '.json')) as f:
        return json.load(f)

report = {'tags_used': TAGS, 'controls': {}, 'runs': {}}

# --------------------------------------------------------------------------
# Controls (F)
# --------------------------------------------------------------------------
for c in CTL:
    d = load(c)
    e = {'mode': d.get('mode'), 'stallMs': d.get('stallMs'), 'verdict': d.get('verdict'),
         'fatal': (d.get('fatal') or '')[:200],
         'lock_acquired': (d.get('lock') or {}).get('acquired'),
         'lock_waitedMs': (d.get('lock') or {}).get('waitedMs'),
         'lockReleased': d.get('lockReleased')}
    ctl = d.get('control')
    if ctl:
        e['control_frames_n'] = len(ctl.get('frames') or [])
        e['control_frameStats_rederived'] = fstats([f[1] for f in ctl['frames']])
        e['control_longtasks'] = len(ctl.get('longtasks') or [])
        e['control_lof'] = len(ctl.get('lof') or [])
        e['control_task_ms'] = (ctl.get('metricsDelta') or {}).get('TaskDuration')
        e['control_errors'] = ctl.get('errors')
    e['has_injected_block'] = 'injected' in d
    if 'injected' in d:
        inj = d['injected']
        e['injected_frameStats'] = fstats([f[1] for f in (inj.get('frames') or [])])
        e['injected_longtasks'] = inj.get('longtasks')
        e['injected_lof_n'] = len(inj.get('lof') or [])
    e['busyMs'] = d.get('injectedBusyMs')
    report['controls'][c] = e

# --------------------------------------------------------------------------
# Per-tag
# --------------------------------------------------------------------------
for tag in TAGS:
    d = load(tag)
    R = {'mode': d.get('mode'), 'run': d.get('run'), 'file': os.path.join(RAW, tag + '.json'),
         'gateOutcome': d.get('gateOutcome'), 'lockReleased': d.get('lockReleased'),
         'lock': d.get('lock'), 'page': d.get('page'), 'gpu': d.get('gpu'),
         'navMs': d.get('navMs'), 'launchMs': d.get('launchMs'),
         'windows': [], 'cross': {}, 'census': {}, 'markerProof': {}}
    marks_global = d.get('marks') or {}
    wins = d.get('windows') or []

    # ---- A: slicing -------------------------------------------------------
    for w in wins:
        if w.get('name') == 'idle':
            R['windows'].append({'name': 'idle', 'wallMs': w.get('wallMs'),
                                 'metricsDelta': w.get('metricsDelta')})
            continue
        i = w.get('index')
        if w.get('invalid'):
            R['windows'].append({'name': w.get('name'), 'invalid': True,
                                 'reason': w.get('invalidReason')})
            continue
        pg = w.get('raw') or {}
        m = pg.get('marks') or {}
        evts = pg.get('evts') or []
        frames = pg.get('frames') or []
        clicks = [e for e in evts if e.get('phase') == 'click']
        t_click = clicks[-1]['t'] if clicks else None
        t_pre = m.get(f't_pre{i}')
        t_post = m.get(f't_post{i}')
        t_arm = m.get(f't_arm{i}') if i > 1 else m.get('t_arm')
        t_dpw = m.get(f't_dialogpw{i}')
        problems = []
        if t_click is None: problems.append('no capture-phase click event in raw.evts')
        if t_pre is None:   problems.append(f'mark t_pre{i} missing')
        if t_post is None:  problems.append(f'mark t_post{i} missing')
        if t_arm is None:   problems.append(f'mark t_arm{i} missing')
        if t_click is not None and t_pre is not None and t_click < t_pre:
            problems.append('t_post/t_pre ordering: t_click < t_pre')
        if t_click is not None and t_post is not None and t_post < t_click:
            problems.append('t_post < t_click')
        if t_dpw is not None and t_click is not None and t_dpw < t_click:
            problems.append('t_dialogpw < t_click')
        # marks snapshot vs global marks consistency
        markmismatch = []
        for k, v in m.items():
            if k in marks_global and abs(marks_global[k] - v) > 1e-6:
                markmismatch.append({'mark': k, 'in_window_snapshot': v, 'global': marks_global[k]})
        # event ordering
        phases = [e.get('phase') for e in evts]
        evt_monotone = all(evts[j]['t'] <= evts[j+1]['t'] for j in range(len(evts)-1))
        # frames coverage
        ft = [f[0] for f in frames]
        outside = None
        if frames:
            outside = {'before_t_arm': sum(1 for t in ft if t_arm is not None and t < t_arm),
                       'after_t_post': sum(1 for t in ft if t_post is not None and t > t_post),
                       'first_t': ft[0], 'last_t': ft[-1],
                       't_arm': t_arm, 't_post': t_post}
        # window slices
        def sl(a, b, strict_start=False):
            out = []
            for t, dt in frames:
                if t is None: continue
                if a is not None and b is not None and a <= t <= b:
                    if strict_start and (t - dt) < a: continue
                    out.append({'t': t, 'dt': dt})
            return out
        pre = sl(t_pre, t_click)
        post = sl(t_click, t_post)
        post_strict = sl(t_click, t_post, strict_start=True)
        fullwin = sl(t_pre, t_post)
        settle = sl(t_arm, t_pre) if i > 1 else None
        # mutation cross-check of dialog insertion
        muts = pg.get('mutations') or []
        dom_claim = t_click + w['clickToDialogDomMs'] if (t_click is not None and w.get('clickToDialogDomMs') is not None) else None
        nearest_mut = None
        if dom_claim is not None and muts:
            c = min(muts, key=lambda mm: abs(mm.get('t', 1e18) - dom_claim))
            nearest_mut = {'mut_t': c.get('t'), 'delta_ms': round(c.get('t', 0) - dom_claim, 3)}
        # frame nearest the double-rAF paint mark
        paint_claim = t_click + w['clickToDialogPaintedMs'] if (t_click is not None and w.get('clickToDialogPaintedMs') is not None) else None
        nearest_frame = None
        if paint_claim is not None and frames:
            c = min(frames, key=lambda f: abs(f[0]-paint_claim))
            nearest_frame = {'frame_t': c[0], 'delta_ms': round(c[0]-paint_claim, 3), 'frame_dt': c[1]}

        R['windows'].append({
            'name': w.get('name'), 'index': i,
            't_arm': t_arm, 't_pre': t_pre, 't_click': t_click, 't_dialogpw': t_dpw, 't_post': t_post,
            'span_arm_to_pre_ms': round(t_pre-t_arm, 3) if (t_pre is not None and t_arm is not None) else None,
            'span_pre_to_click_ms': round(t_click-t_pre, 3) if (t_click is not None and t_pre is not None) else None,
            'span_click_to_post_ms': round(t_post-t_click, 3) if (t_post is not None and t_click is not None) else None,
            'span_click_to_post_vs_3000_ms': round((t_post-t_click)-3000, 3) if (t_post is not None and t_click is not None) else None,
            'reported_wallPreMs': w.get('wallPreMs'), 'reported_wallPostMs': w.get('wallPostMs'),
            'reported_clickCallMs': w.get('clickCallMs'),
            'n_evts': len(evts), 'evt_phases': phases, 'evt_monotone': evt_monotone,
            'n_frames_total_in_raw': len(frames),
            'n_frames_pre': len(pre), 'n_frames_post': len(post), 'n_frames_post_strict': len(post_strict),
            'n_frames_fullwin': len(fullwin), 'n_frames_settle': (len(settle) if settle is not None else None),
            'frames_coverage': outside,
            'frames_pre_stats': fstats([f['dt'] for f in pre]),
            'frames_post_stats': fstats([f['dt'] for f in post]),
            'frames_fullwin_stats': fstats([f['dt'] for f in fullwin]),
            'settle_stats': (fstats([f['dt'] for f in settle]) if settle else None),
            'marks_snapshot_vs_global_mismatch': markmismatch,
            'problems': problems,
            'reported': {k: w.get(k) for k in ('clickToDialogDomMs','clickToDialogVisibleMs','clickToDialogPaintedMs',
                                               'playwrightDialogVisibleMs','dialogVisibleOk','dialogPaintedRect','nodesNow')},
            'metricsDelta': w.get('metricsDelta'),
            'longtasks_in_raw': len(pg.get('longtasks') or []),
            'lof_in_raw': len(pg.get('lof') or []),
            'installErrors': pg.get('installErrors'),
            'console': pg.get('console'), 'errors': pg.get('errors'), 'vis': pg.get('vis'), 'resizes': pg.get('resizes'),
            'mutations': muts,
            'dom_claim_page_t': dom_claim,
            'nearest_mutation_to_dom_claim': nearest_mut,
            'paint_claim_page_t': paint_claim,
            'nearest_frame_to_paint_claim': nearest_frame,
        })

    # ---- D: idle & pre-click baselines ------------------------------------
    c1 = next((w for w in wins if w.get('index') == 1 and w.get('raw')), None)
    idle = None
    if c1:
        m = c1['raw'].get('marks') or {}
        fr = c1['raw'].get('frames') or []
        t0, t1 = m.get('t_arm'), m.get('t_pre1')
        idf = [{'t': t, 'dt': dt} for t, dt in fr if t0 <= t <= t1]
        idle = {'t_arm': t0, 't_pre1': t1, 'spanMs': round(t1-t0, 3),
                'frameStats': fstats([f['dt'] for f in idf]),
                'longtasks': len(c1['raw'].get('longtasks') or []),
                'lof': len(c1['raw'].get('lof') or []),
                'mutations': len(c1['raw'].get('mutations') or []),
                'console': c1['raw'].get('console'), 'errors': c1['raw'].get('errors'),
                'metricsDelta': (d['windows'][0].get('metricsDelta') if d.get('windows') else None)}
    R['idle'] = idle

    # last-3s-before-each-click (from whichever raw frame series covers it)
    pre3 = []
    for i in (1, 2, 3):
        w = next((x for x in wins if x.get('index') == i and x.get('raw')), None)
        if not w: continue
        m = w['raw'].get('marks') or {}
        tc = m.get(f't_pre{i}')
        fr = w['raw'].get('frames') or []
        seg = [dt for t, dt in fr if tc is not None and tc-3000 <= t <= tc]
        pre3.append({'index': i, 't_pre': tc, 'n': len(seg),
                     't_covered_from': (min((t for t, _ in fr if tc-3000 <= t <= tc), default=None)),
                     'stats': fstats(seg)})
    R['pre3s_before_click'] = pre3

    # ---- G: census / gate -------------------------------------------------
    for k in ('censusStart','censusBeforeLaunch','censusAfterLaunch','censusAtIdleEnd',
              'censusAfterClick1','censusAfterClick2','censusAfterClick3','censusEnd'):
        c = d.get(k)
        if not c: continue
        R['census'][k] = {'at': c.get('at'), 'total': c.get('mainInstancesTotal'),
                          'mine': c.get('mainInstancesMine'), 'foreign': c.get('foreignMainInstances'),
                          'helperProcs': c.get('helperProcs'), 'binaryKinds': c.get('binaryKinds'),
                          'lockDirPresent': c.get('lockDirPresent'), 'lockOwner': c.get('lockOwner'),
                          'lockHeldByThisLine': c.get('lockHeldByThisLine'),
                          'foreignList': c.get('foreign'), 'mineList': c.get('mine')}
    R['closedBeforeClick2'] = d.get('closedBeforeClick2')
    R['closedBeforeClick3'] = d.get('closedBeforeClick3')

    # ---- H: marker proof --------------------------------------------------
    mp = d.get('markerProof') or {}
    for k, v in mp.items():
        if k.startswith('__'):
            continue
        R['markerProof'][k] = {'url': v.get('url'), 'url_rev': v.get('rev'), 'sha1_12': v.get('sha1_12'),
                               'rev_matches_sha1': v.get('rev') == v.get('sha1_12'),
                               'ok': v.get('ok'), 'status': v.get('status'), 'bytes': v.get('bytes'),
                               'markers': v.get('markers')}
    R['markerProof_loadedResources_n'] = len(mp.get('__loadedResources') or [])
    R['markerProof_loadedResources'] = mp.get('__loadedResources')

    # ---- whole-file frame statistics (all frames present in the file) -----
    allframes = []
    for w in wins:
        for f in (w.get('raw') or {}).get('frames') or []:
            allframes.append(f)
    R['all_raw_frames'] = fstats([f[1] for f in allframes])
    R['global_max_frame'] = max(allframes, key=lambda f: f[1]) if allframes else None
    R['global_frames_ge80'] = [f for f in allframes if f[1] >= 80]
    R['global_frames_ge50'] = [f for f in allframes if f[1] >= 50]

    report['runs'][tag] = R

with open(os.path.join(OUT, 'audit_raw.json'), 'w') as f:
    json.dump(report, f, indent=1)
print('wrote', os.path.join(OUT, 'audit_raw.json'))
print('tags:', TAGS)
print('controls:', CTL)
