#!/usr/bin/env python3
"""scroll_ab.py — 汇总 run2 / run4 的滚动 A/B/C 与子标签数据。"""
import json, sys, collections

def load(p):
    try: return json.load(open(p, encoding='utf-8'))
    except Exception as e: return {'error': str(e), 'windows': []}

R2 = load('/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/tab-switch/raw/tabswitch-run2.json')
R4 = load('/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/tab-switch/raw/tabswitch-run4.json')

def summarize(R, title):
    print('=' * 108)
    print(title, '| stage', R.get('stage'), '| windows', len(R.get('windows', [])))
    if R.get('fatal'): print('  FATAL:', R['fatal'][:300])
    if R.get('fidelity'): print('  fidelity:', json.dumps(R['fidelity'], ensure_ascii=False))
    if R.get('layers'): print('  layers:', json.dumps(R['layers'], ensure_ascii=False))
    print(f"  {'窗口':42} {'valid':>5} {'n':>4} {'p50':>6} {'p95':>6} {'p99':>6} {'max':>7} {'>50':>4} {'LT':>3} {'LTms':>6} {'RPC':>4} {'ΔL':>4} {'ΔS':>4} {'ΔLayoutDur':>10} {'read':>5} {'churn+':>7} {'nodes':>6} {'svg':>4}")
    for w in R.get('windows', []):
        f = w.get('frames', {})
        print(f"  {w['label'][:42]:42} {str(w.get('valid')):>5} {str(f.get('n')):>4} {str(f.get('p50')):>6} {str(f.get('p95')):>6} {str(f.get('p99')):>6} {str(f.get('max')):>7} {str(f.get('over50')):>4} {str(len(w.get('longtasks', []))):>3} {str(w.get('longtask_total_ms')):>6} {str(w.get('rpc', {}).get('total')):>4} {str(w.get('cdpDelta', {}).get('LayoutCount')):>4} {str(w.get('cdpDelta', {}).get('RecalcStyleCount')):>4} {str(w.get('cdpDelta', {}).get('LayoutDuration')):>10} {str(sum(w.get('layoutReads', {}).values())):>5} {str(w.get('churn', {}).get('added')):>7} {str(w.get('dom', {}).get('dialogNodes')):>6} {str(w.get('dom', {}).get('dialogSvg')):>4}")
    return R

summarize(R2, 'RUN2（A→B→C 正序）')
print()
summarize(R4, 'RUN4（C→B→A 逆序复现 + 插件子标签）')

# 汇总对比
def pick(R, pat):
    return [w for w in R.get('windows', []) if pat in w['label']]
print('\n' + '=' * 108)
print('滚动臂对比（p95 帧间隔 / max / LTms）—— 正序(run2) vs 逆序(run4)')
for arm, pats in [('A 原样', ['A原样', ' A原样']), ('B 无壁纸固定层', ['B无壁纸固定层']), ('C 无backdrop-filter', ['C无backdrop-filter'])]:
    for name, R in [('run2', R2), ('run4', R4)]:
        ws = [w for w in R.get('windows', []) if any(p in w['label'] for p in pats)]
        if not ws: print(f'  {arm:22} {name}: (none)'); continue
        p95 = [w['frames']['p95'] for w in ws if w['frames'].get('p95') is not None]
        mx = [w['frames']['max'] for w in ws if w['frames'].get('max') is not None]
        lt = sum(w['longtask_total_ms'] for w in ws)
        print(f'  {arm:22} {name}: n={len(ws)} p95={[round(x,1) for x in p95]} max={mx} LTms={lt}')
for name, R in [('run2', R2), ('run4', R4)]:
    ws = [w for w in R.get('windows', []) if 'IDLE' in w['label']]
    if ws:
        print(f"  {'IDLE 不滚动':22} {name}: n={len(ws)} p95={[w['frames']['p95'] for w in ws]} max={[w['frames']['max'] for w in ws]}")

# 子标签
for name, R in [('run4', R4)]:
    sub = [w for w in R.get('windows', []) if w['label'].startswith('SUBTAB')]
    if sub:
        print('\n' + '=' * 108)
        print('插件子标签切换（', name, '）')
        print(json.dumps(R.get('subTabDom'), ensure_ascii=False))
        print('nodeCountsPerSubTab:', json.dumps(R.get('nodeCountsPerSubTab'), ensure_ascii=False))
        for w in sub:
            meth = '; '.join(f"{k}×{v['n']}" for k, v in w['rpc']['by'].items())
            ms = []
            for v in w['rpc']['by'].values(): ms.extend(v['ms'])
            print(f"  {w['label']:34} valid={w['valid']} f95={w['frames']['p95']} max={w['frames']['max']} >50={w['frames']['over50']} LT={len(w['longtasks'])}/{w['longtask_total_ms']}ms rpc={w['rpc']['total']} nodes={w['dom']['dialogNodes']} svg={w['dom']['dialogSvg']} ΔL={w['cdpDelta'].get('LayoutCount')} ΔS={w['cdpDelta'].get('RecalcStyleCount')} ΔScD={w['cdpDelta'].get('ScriptDuration')} churn+={w['churn']['added']}")
            if meth: print(f"        rpc: {meth}  ms={sorted(round(x,1) for x in ms)}")
