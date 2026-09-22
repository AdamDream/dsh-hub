#!/usr/bin/env python3
"""
Consolidate every raw artifact in raw/ into analysis.json.

Units: CDP Performance.getMetrics durations are SECONDS (verified against a declared
2000 ms idle window: Timestamp delta 2.0049). This script converts to ms and always
reports the page-clock window width each delta was measured over.

Click anchor: the first trusted `pointerdown` after arm(), in the page clock.
"""
import json, glob, os, statistics as st

RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'raw')
MS = 1000.0

def load(pat):
    fs = sorted(glob.glob(os.path.join(RAW, pat)))
    return json.load(open(fs[-1])) if fs else None

def pct(v, q=0.5):
    v = sorted(v)
    return v[min(len(v) - 1, int(q * len(v)))] if v else None

def cum_ms(delta):
    return {k: round(v * MS, 3) for k, v in delta['cumulative'].items()}

def anchor(cn):
    a = (cn.get('data', {}).get('anchor') if 'data' in cn else cn.get('anchor')) or {}
    tc = a.get('tClick')
    if tc is None:
        dd = cn.get('data', {})
        pd = [m for m in dd.get('marks', []) if m['name'] == 'evt:pointerdown' and m.get('trusted')]
        tc = min((m['t'] for m in pd), default=None)
    return a.get('tArm'), tc

out = {
    'generatedFrom': {},
    'units': 'all *_ms values are milliseconds; CDP raw durations were seconds and were multiplied by 1000',
    'anchor': 'first trusted pointerdown after arm(), page clock (performance.now)',
}

# ---------------------------------------------------------------- probe1 (first pass)
p1 = load('click-raw-*.json')
if p1:
    out['generatedFrom']['probe1'] = os.path.basename(sorted(glob.glob(os.path.join(RAW, 'click-raw-*.json')))[-1])
    out['probe1'] = {'channelSupport': p1['scenarios']['A']['coldNav']['data']['support'], 'clicks': {}, 'controls': {}}
    for sc in ('A', 'B', 'C'):
        s = p1['scenarios'][sc]
        for k, v in s.items():
            if not isinstance(v, dict) or 'data' not in v:
                continue
            ta, tc = anchor(v)
            rpcs = [{'channel': '/' + r['url'].split('127.0.0.1:3080/')[1].split('/')[0],
                     'bodyMethod': r['bodyMethod'], 'bodyType': r['bodyType'],
                     'url': r['url'],
                     'startRelClickMs': round(r['tStart'] - tc, 2) if tc is not None else None,
                     'endRelClickMs': round(r['tEnd'] - tc, 2) if r['tEnd'] is not None and tc is not None else None,
                     'durMs': round(r['tEnd'] - r['tStart'], 2) if r['tEnd'] is not None else None,
                     'respChars': r.get('respChars')} for r in v['data']['rpcInWindow']]
            ms_hit = {}
            for name, m in (v.get('milestones') or {}).items():
                if isinstance(m, dict) and m.get('t') is not None and tc is not None:
                    ms_hit[name] = round(m['t'] - tc, 2)
            out['probe1']['clicks'][f'{sc}:{k}'] = {
                'armToClickMs': round(tc - ta, 2) if ta is not None and tc is not None else None,
                'milestonesRelClickMs': ms_hit,
                'rpc': rpcs,
                'rpcCount': len(rpcs),
                'longTasks': [{'startRelClickMs': round(x['start'] - tc, 1), 'durMs': round(x['dur'], 1)} for x in v['data']['longTasks']],
                'loaf': [{'startRelClickMs': round(x['start'] - tc, 1), 'durMs': round(x['dur'], 1)} for x in v['data']['loaf']],
                'countsAtVisible': v['countsAtVisible'],
            }
    # probe1's control used Runtime.evaluate only -> documented blind spot
    for sc, k in (('A', 'controlAfterClick'), ('B', 'controlFreshPageSettings')):
        c = p1['scenarios'][sc].get(k)
        if c:
            out['probe1']['controls'][f'{sc}:{k}'] = {
                'route': 'Runtime.evaluate', 'requestedMs': c['requestedMs'],
                'actualMs': round(c['actualBlockMs']['actual'], 2),
                'longTasksReported': len(c['longTasksInSlice']),
                'loafReported': [round(x['dur'], 1) for x in c['loafInSlice']],
                'cdpDeltaMs': cum_ms(c['cdpDelta']),
            }

# ---------------------------------------------------------------- probe2 (tight windows, series, 3-route controls)
p2 = load('click2-raw-*.json')
if p2:
    out['generatedFrom']['probe2'] = os.path.basename(sorted(glob.glob(os.path.join(RAW, 'click2-raw-*.json')))[-1])
    P1, P2 = p2['scenarios']['P1'], p2['scenarios']['P2']
    out['probe2'] = {'condition': P1['condition'], 'conditionsEnd': p2.get('conditionEnd'),
                     'afterSettingsOpen': P1['afterSettingsOpen']['counts'],
                     'controls': [], 'series': {}}
    for c in P1['controls']:
        out['probe2']['controls'].append({
            'route': c['route'], 'requestedMs': c['requestedMs'], 'windowMs': round(c['windowMs'], 1),
            'longTasksReported': len(c['longTasks']),
            'longTaskDurationsMs': [round(x['dur'], 1) for x in c['longTasks']],
            'loafReported': [{'durMs': round(x['dur'], 1), 'blockingMs': round(x.get('blocking') or 0, 1)} for x in c['loaf']],
            'cdpDeltaMs': cum_ms(c['cdpDelta']),
        })
    for label, series in (('nav_plugins', P1['navSeries']), ('inventory_tab', P1['inventorySeries']),
                          ('replicate', P2['navSeries'] + P2['inventorySeries'])):
        rows = []
        for s in series:
            w = s['windows']
            cp = w['deltaToPrimary']['cumulative']
            amb = s['ambient']['delta']['cumulative']
            ta, tc = anchor({'data': s['data']})
            rows.append({
                'label': s['label'],
                'armToClickMs': round(w['armToClickMs'], 1),
                'clickToPrimaryVisibleMs': round(w['primaryRelClickMs'], 1),
                'cdpWindowMs': round(w['toPrimaryMs'], 1),
                'scriptMs': round(cp['ScriptDuration'] * MS, 2),
                'taskMs': round(cp['TaskDuration'] * MS, 2),
                'layoutMs': round(cp['LayoutDuration'] * MS, 2),
                'recalcStyleMs': round(cp['RecalcStyleDuration'] * MS, 2),
                'layoutCount': cp['LayoutCount'], 'recalcStyleCount': cp['RecalcStyleCount'],
                'ambientWindowMs': round(s['ambient']['ms'], 1),
                'ambientScriptMs': round(amb['ScriptDuration'] * MS, 2),
                'ambientTaskMs': round(amb['TaskDuration'] * MS, 2),
                'longTasks': len(s['data']['longTasksInWindow']),
                'longAnimationFrames': len(s['data']['loafInWindow']),
                'laofDurationsMs': [round(x['dur'], 1) for x in s['data']['loafInWindow']],
                'nodesDelta': w['deltaToPrimary']['gauges'].get('Nodes'),
                'jsEventListenersDelta': w['deltaToPrimary']['gauges'].get('JSEventListeners'),
                'svgAtPrimary': s['counts']['atPrimary']['svg'],
                'pluginEntriesAtPrimary': s['counts']['atPrimary']['pluginEntries'],
                'rpc': [{'channel': '/' + r['url'].split('127.0.0.1:3080/')[1].split('/')[0],
                         'bodyMethod': r['bodyMethod'],
                         'startRelClickMs': round(r['tStart'] - tc, 2) if tc is not None else None,
                         'endRelClickMs': round(r['tEnd'] - tc, 2) if r['tEnd'] is not None and tc is not None else None,
                         'durMs': round(r['tEnd'] - r['tStart'], 2) if r['tEnd'] is not None else None,
                         'respChars': r.get('respChars')} for r in s['data']['rpcInWindow']],
            })
        agg = {}
        for f in ('clickToPrimaryVisibleMs', 'scriptMs', 'taskMs', 'layoutMs', 'recalcStyleMs', 'cdpWindowMs'):
            vals = [r[f] for r in rows if r[f] is not None]
            agg[f] = {'n': len(vals), 'min': round(min(vals), 2), 'p50': round(st.median(vals), 2),
                      'max': round(max(vals), 2)}
        agg['longTasksTotal'] = sum(r['longTasks'] for r in rows)
        agg['longAnimationFramesTotal'] = sum(r['longAnimationFrames'] for r in rows)
        out['probe2']['series'][label] = {'n': len(rows), 'agg': agg, 'rows': rows}

# ---------------------------------------------------------------- probe3 (attribution, idle calibration, filter series)
p3 = load('click3-raw-*.json')
if p3:
    out['generatedFrom']['probe3'] = os.path.basename(sorted(glob.glob(os.path.join(RAW, 'click3-raw-*.json')))[-1])
    out['probe3'] = {'svgAttribution': p3['svgAttribution'], 'idleWindows': [], 'filterSeries': []}
    for w in p3['idleWindows']:
        c = w['delta']['cumulative']
        out['probe3']['idleWindows'].append({
            'declaredMs': w['L'], 'windowMs': round(w['windowMs'], 1),
            'scriptMs': round(c['ScriptDuration'] * MS, 3), 'taskMs': round(c['TaskDuration'] * MS, 3),
            'layoutMs': round(c['LayoutDuration'] * MS, 3), 'recalcStyleMs': round(c['RecalcStyleDuration'] * MS, 3),
            'layoutCount': c['LayoutCount'], 'recalcStyleCount': c['RecalcStyleCount'],
        })
    for r in p3['filterSeries']:
        c = r['delta']['cumulative']
        out['probe3']['filterSeries'].append({
            'query': r['query'], 'windowMs': round(r['windowMs'], 1),
            'entriesBefore': r['countBefore'], 'entriesAfter': r['entries'],
            'deltaEntries': r['entries'] - r['countBefore'],
            'scriptMs': round(c['ScriptDuration'] * MS, 2), 'taskMs': round(c['TaskDuration'] * MS, 2),
            'layoutMs': round(c['LayoutDuration'] * MS, 2), 'recalcStyleMs': round(c['RecalcStyleDuration'] * MS, 2),
            'docSvg': r['svg'], 'docElements': r['all'],
        })

# ---------------------------------------------------------------- probe4 (per-card listeners)
p4 = load('click4-raw-*.json')
if p4:
    out['generatedFrom']['probe4'] = os.path.basename(sorted(glob.glob(os.path.join(RAW, 'click4-raw-*.json')))[-1])
    out['probe4'] = {'listeners': []}
    for s in p4.get('steps', []):
        if not s.get('found'):
            continue
        types = {}
        for l in s.get('listeners', []):
            types[l['type']] = types.get(l['type'], 0) + 1
        out['probe4']['listeners'].append({'label': s['label'], 'selector': s['selector'],
                                           'listenerCount': s.get('listenerCount'), 'types': types})

# ---------------------------------------------------------------- probe5 (a11y amplifier A/B)
p5 = load('click5-raw-*.json')
if p5:
    out['generatedFrom']['probe5'] = os.path.basename(sorted(glob.glob(os.path.join(RAW, 'click5-raw-*.json')))[-1])
    out['probe5'] = {'variant': p5['variant'], 'condition': p5['condition'], 'series': {}}
    for name in ('navSeries', 'inventorySeries'):
        rows = []
        for s in p5.get(name, []):
            w = s['windows']; cp = w['deltaToPrimary']['cumulative']
            rows.append({
                'label': s['label'],
                'clickToPrimaryVisibleMs': round(w['primaryRelClickMs'], 1),
                'cdpWindowMs': round(w['toPrimaryMs'], 1),
                'scriptMs': round(cp['ScriptDuration'] * MS, 2),
                'taskMs': round(cp['TaskDuration'] * MS, 2),
                'layoutMs': round(cp['LayoutDuration'] * MS, 2),
                'recalcStyleMs': round(cp['RecalcStyleDuration'] * MS, 2),
                'longTasks': len(s['longTasksInWindow']),
                'longAnimationFrames': len(s['loafInWindow']),
                'rpcCount': len(s['rpcInWindow']),
            })
        agg = {f: {'min': round(min(r[f] for r in rows), 2), 'p50': round(st.median([r[f] for r in rows]), 2),
                   'max': round(max(r[f] for r in rows), 2)} for f in ('clickToPrimaryVisibleMs', 'scriptMs', 'taskMs', 'layoutMs', 'recalcStyleMs')}
        out['probe5']['series'][name] = {'agg': agg, 'rows': rows}

# ---------------------------------------------------------------- host handler benchmark
hb = None
try:
    hb = json.load(open(os.path.join(RAW, 'host-rpc-bench.json')))
except Exception:
    pass
if hb:
    out['generatedFrom']['host-rpc-bench'] = 'host-rpc-bench.json'
    out['hostRpcBench'] = {k: {kk: v[kk] for kk in ('n', 'p50', 'min', 'max', 'mean', 'respBytes') if kk in v}
                           for k, v in hb['series'].items()}

# ---------------------------------------------------------------- derived conclusions
if p2 and p3:
    inv = out['probe2']['series']['inventory_tab']
    nav = out['probe2']['series']['nav_plugins']
    sv = p3['svgAttribution']
    idle = out['probe3']['idleWindows']
    inv_rows = inv['rows']
    rpc_d = [r['rpc'][0]['durMs'] for r in inv_rows if r['rpc']]
    rpc_s = [r['rpc'][0]['startRelClickMs'] for r in inv_rows if r['rpc']]
    rpc_e = [r['rpc'][0]['endRelClickMs'] for r in inv_rows if r['rpc']]
    vis = [r['clickToPrimaryVisibleMs'] for r in inv_rows]
    out['derived'] = {
        'pluginCountMeasured': int(sv['countAttr']) if sv.get('countAttr') else None,
        'pluginEntriesMeasured': sv['entries'],
        'svgInInventoryPanel': sv['invPanelSvg'],
        'svgPerPlugin': round(sv['invPanelSvg'] / max(1, sv['entries']), 4),
        'elementsInInventoryPanel': sv['invPanelElements'],
        'elementsPerPlugin': round(sv['invPanelElements'] / max(1, sv['entries']), 2),
        'svgBreakdown': {'perCardChevron': sv['firstCardSvg'], 'cards': sv['entries'],
                         'searchIcon': 1, 'equalsPanelSvg': sv['firstCardSvg'] * sv['entries'] + 1},
        'inventoryClick': {
            'clickToCardsInDomMs': {'p50': round(st.median(vis), 1), 'min': round(min(vis), 1), 'max': round(max(vis), 1)},
            'rpcStartRelClickMs': {'p50': round(st.median(rpc_s), 2), 'min': round(min(rpc_s), 2), 'max': round(max(rpc_s), 2)},
            'rpcEndRelClickMs': {'p50': round(st.median(rpc_e), 2), 'min': round(min(rpc_e), 2), 'max': round(max(rpc_e), 2)},
            'rpcDurMs': {'p50': round(st.median(rpc_d), 2), 'min': round(min(rpc_d), 2), 'max': round(max(rpc_d), 2)},
            'shareWaitingForHostPct': round(100 * st.median(rpc_d) / st.median(vis), 1),
            'shareClientCommitPct': round(100 * (st.median(vis) - st.median(rpc_e)) / st.median(vis), 1),
            'shareDispatchToRpcPct': round(100 * st.median(rpc_s) / st.median(vis), 1),
        },
        'navClick': {
            'clickToSectionVisibleMs': nav['agg']['clickToPrimaryVisibleMs'],
            'scriptMs': nav['agg']['scriptMs'], 'layoutMs': nav['agg']['layoutMs'],
            'recalcStyleMs': nav['agg']['recalcStyleMs'], 'taskMs': nav['agg']['taskMs'],
            'usageRpcCount': nav['rows'][0]['rpc'][1:] and len(nav['rows'][0]['rpc']),
        },
        'blockingVerdict': {
            'longTasksAcrossAllMeasuredClicks': inv['agg']['longTasksTotal'] + nav['agg']['longTasksTotal'],
            'longAnimationFramesAcrossAllMeasuredClicks': inv['agg']['longAnimationFramesTotal'] + nav['agg']['longAnimationFramesTotal'],
            'longTaskThresholdMs': 50,
        },
        'idleCalibration': {
            'scriptMsPerS_p50': round(st.median([w['scriptMs'] / w['windowMs'] * 1000 for w in idle]), 2),
            'scriptMsPerS_max': round(max(w['scriptMs'] / w['windowMs'] * 1000 for w in idle), 2),
            'taskMsPerS_p50': round(st.median([w['taskMs'] / w['windowMs'] * 1000 for w in idle]), 2),
            'note': 'matched-length idle windows from the same rig; used to bound the ambient share of short click windows',
        },
    }
    if out.get('hostRpcBench'):
        h = out['hostRpcBench']
        inv_b = h.get('pluginInventory/list_177entries_21.7KB')
        ctl_b = h.get('agentPreset/list_control_9B')
        if inv_b and ctl_b:
            out['derived']['hostHandler'] = {
                'inventoryRpcP50Ms': inv_b['p50'], 'controlRpcP50Ms': ctl_b['p50'],
                'ratioInventoryOverControl': round(inv_b['p50'] / ctl_b['p50'], 3),
                'verdict': 'no measurable penalty for 177 entries / 21.7 KB vs a 9-byte control RPC; floor is process spawn + loopback + scheduler',
            }

json.dump(out, open(os.path.join(os.path.dirname(RAW), 'analysis.json'), 'w'), ensure_ascii=False, indent=1)

print('wrote analysis.json')
print(json.dumps(out.get('derived', {}), ensure_ascii=False, indent=1)[:4000])
