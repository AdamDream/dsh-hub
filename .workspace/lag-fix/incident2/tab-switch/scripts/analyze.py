#!/usr/bin/env python3
"""analyze.py — 把 raw/tabswitch-run1.json 折算成逐标签表、同窗倍数、判定。"""
import json, statistics as st, sys, collections

P = sys.argv[1] if len(sys.argv) > 1 else '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/tab-switch/raw/tabswitch-run1.json'
R = json.load(open(P, encoding='utf-8'))

def med(xs):
    xs = [x for x in xs if x is not None]
    return round(st.median(xs), 2) if xs else None
def mx(xs):
    xs = [x for x in xs if x is not None]
    return round(max(xs), 2) if xs else None
def mn(xs):
    xs = [x for x in xs if x is not None]
    return round(min(xs), 2) if xs else None
def rng(xs):
    xs = [x for x in xs if x is not None]
    return (round(min(xs), 2), round(max(xs), 2)) if xs else None

W = R['windows']
def sel(pred): return [w for w in W if pred(w)]

print('=' * 110)
print('RUN', P.split('/')[-1], '| stage', R.get('stage'), '| windows', len(W))
print('positiveControlVerdict:', json.dumps(R.get('positiveControlVerdict'), ensure_ascii=False, indent=1))
print('concurrency_at_start:', json.dumps(R.get('concurrency_at_start')))
print('concurrency_at_end  :', json.dumps(R.get('concurrency_at_end')))
print('lock owner sanity:', 'released=' + str(R.get('release', {}).get('released')))

# ---------- 采集台账：每次鼠标点击记账（纪律可审计） ----------
clicks = [w['label'] for w in W if 'SCROLL' not in w['label']]
print('\n点击类窗口数:', len(clicks))
print('滚动类窗口数:', len([w for w in W if 'SCROLL' in w['label']]))

# ---------- 阳性对照矩阵 ----------
print('\n' + '=' * 110)
print('阳性对照矩阵（注入方式 × 通道）')
print(f"{'kind':10} {'req':>5} {'actual':>8} {'longtask_max':>13} {'loaf_max':>9} {'frameMax':>9} {'frames>50':>10} {'ScriptDuration':>15}")
for p in R.get('positiveControl', []):
    print(f"{p['kind']:10} {p['requested_ms']:>5} {str(p['actual_block_ms']):>8} {str(p['longtask_max_ms']):>13} {str(p['loaf_max_ms']):>9} {str(p['frames'].get('max')):>9} {str(p['frames_over50']):>10} {str(p['cdpDelta'].get('ScriptDuration')):>15}")

# ---------- NULL 基线 ----------
NULLS = sel(lambda w: w['label'].startswith('NULL'))
def agg(ws):
    return dict(
        n=len(ws),
        content_med=med([w['clickToContentMs'] for w in ws]), content_range=rng([w['clickToContentMs'] for w in ws]),
        lt_cnt=sum(len(w['longtasks']) for w in ws),
        lt_ms_total=round(sum(w['longtask_total_ms'] for w in ws), 2),
        lt_ms_med=med([w['longtask_total_ms'] for w in ws]),
        f95=med([w['frames'].get('p95') for w in ws]), f99=med([w['frames'].get('p99') for w in ws]),
        fmax=mx([w['frames'].get('max') for w in ws]), over50=sum(w['frames'].get('over50') or 0 for w in ws),
        rpc=med([w['rpc']['total_calls'] for w in ws]), rpc_max=mx([w['rpc']['total_calls'] for w in ws]),
        dlg_nodes=med([w['dom']['dialogNodes'] for w in ws]), dlg_svg=med([w['dom']['dialogSvg'] for w in ws]),
        L=med([w['cdpDelta'].get('LayoutCount', 0) for w in ws]),
        S=med([w['cdpDelta'].get('RecalcStyleCount', 0) for w in ws]),
        LD=med([w['cdpDelta'].get('LayoutDuration', 0) for w in ws]),
        RSD=med([w['cdpDelta'].get('RecalcStyleDuration', 0) for w in ws]),
        ScD=med([w['cdpDelta'].get('ScriptDuration', 0) for w in ws]),
        churn_add=med([w['churn']['added'] for w in ws]), churn_rem=med([w['churn']['removed'] for w in ws]),
        layoutReads=med([sum(w['layoutReads'].values()) for w in ws]),
        firstFrame=med([w.get('firstFrameAfterClickMs') for w in ws]),
    )
B = agg(NULLS)
print('\n' + '=' * 110)
print('NULL 同窗基线（面板内惰性点击，不切栏目）:')
print(json.dumps({k: v for k, v in B.items()}, ensure_ascii=False))

# ---------- 逐标签 ----------
tabs = [t['text'] for t in R['nav']['tabs']]
def windows_for(tab, phases=('SWEEP', 'PING')):
    return [w for w in W if any(w['label'].startswith(p) for p in phases) and w['label'].endswith('→ ' + tab)]

print('\n' + '=' * 110)
print('逐标签表（SWEEP 3 轮 + PING 3 轮；均含从别的栏目切过来的真实切换）')
hdr = f"{'栏目':22} {'n':>2} {'内容可见ms':>22} {'LT次':>5} {'LTms':>7} {'p95':>6} {'max':>7} {'>50':>4} {'RPC':>4} {'dlg节点':>7} {'dlgSVG':>6} {'ΔLayout':>7} {'ΔRecalc':>7} {'ΔScript':>7} {'Δchurn+':>8}"
print(hdr); print('-' * len(hdr))
rows = {}
for t in tabs:
    a = agg(windows_for(t))
    rows[t] = a
    print(f"{t[:22]:22} {a['n']:>2} {str(a['content_range']):>22} {a['lt_cnt']:>5} {a['lt_ms_total']:>7} {str(a['f95']):>6} {str(a['fmax']):>7} {a['over50']:>4} {str(a['rpc']):>4} {str(a['dlg_nodes']):>7} {str(a['dlg_svg']):>6} {str(a['L']):>7} {str(a['S']):>7} {str(a['ScD']):>7} {str(a['churn_add']):>8}")

# ---------- 同窗倍数 ----------
print('\n' + '=' * 110)
print('同窗倍数（栏目 / NULL），并给「是否可测差异」判定（判据：该栏目 6 个窗口的值域与 NULL 的值域是否分离）')
print(f"{'栏目':22} {'内容ms倍数':>10} {'LTms倍数':>9} {'RPC倍数':>8} {'节点倍数':>8} {'ΔLayout倍数':>11} {'ΔRecalc倍数':>11} {'ΔScript倍数':>12} {'可测?':>6}")
diffs = {}
for t in tabs:
    a = rows[t]
    def r(x, b):
        if b in (None, 0): return None
        return round(x / b, 2) if x is not None else None
    content_sep = None
    ws = windows_for(t)
    cvals = [w['clickToContentMs'] for w in ws if w['clickToContentMs'] is not None]
    nvals = [w['clickToContentMs'] for w in NULLS if w['clickToContentMs'] is not None]
    rpc_sep = None
    rv = [w['rpc']['total_calls'] for w in ws]; nv = [w['rpc']['total_calls'] for w in NULLS]
    sep_rpc = (min(rv) > max(nv)) if rv and nv else None
    sep_c = (min(cvals) > max(nvals)) if cvals and nvals else None
    diffs[t] = dict(
        content_mult=r(a['content_med'], B['content_med']),
        lt_mult=r(a['lt_ms_med'] if a['lt_ms_med'] else 0, B['lt_ms_med'] if B['lt_ms_med'] else None),
        rpc_mult=r(a['rpc'], B['rpc']), nodes_mult=r(a['dlg_nodes'], B['dlg_nodes']),
        L_mult=r(a['L'], B['L']), S_mult=r(a['S'], B['S']), ScD_mult=r(a['ScD'], B['ScD']),
        rpc_separable=sep_rpc, content_separable=sep_c,
        content_range=a['content_range'], rpc_range=rng(rv),
    )
    print(f"{t[:22]:22} {str(diffs[t]['content_mult']):>10} {str(diffs[t]['lt_mult']):>9} {str(diffs[t]['rpc_mult']):>8} {str(diffs[t]['nodes_mult']):>8} {str(diffs[t]['L_mult']):>11} {str(diffs[t]['S_mult']):>11} {str(diffs[t]['ScD_mult']):>12} {('YES' if sep_rpc or sep_c else 'no'):>6}")

# ---------- per-tab RPC 方法名 ----------
print('\n' + '=' * 110)
print('逐栏目「每次切换发出的 RPC 方法名」（合并窗口内出现的全部方法）')
for t in tabs:
    ws = windows_for(t)
    c = collections.Counter()
    for w in ws:
        for k, v in w['rpc']['by_method'].items():
            c[k] += v['n']
    per = round(sum(c.values()) / max(1, len(ws)), 2)
    print(f"  {t[:26]:26} 平均 {per:>5} 次/切换  " + '; '.join(f'{k}×{v}' for k, v in c.most_common(12)))

# ---------- REPEAT ----------
print('\n' + '=' * 110)
print('「再次点击同一标签」（无栏目变化）:')
for w in sel(lambda w: w['label'].startswith('REPEAT')):
    print(f"  {w['label']:44} changed={w['contentChanged']} LT={len(w['longtasks'])}/{w['longtask_total_ms']}ms RPC={w['rpc']['total_calls']} ΔL={w['cdpDelta'].get('LayoutCount')} ΔS={w['cdpDelta'].get('RecalcStyleCount')} ΔScD={w['cdpDelta'].get('ScriptDuration')} churn+={w['churn']['added']}")

# ---------- 首屏 open ----------
print('\n逐轮趋势（检查是否有累积/泄漏）：')
for t in tabs:
    ws = windows_for(t)
    seq = [(w['label'].split(' ')[0] + w['label'].split(' ')[1], w['clickToContentMs'], len(w['longtasks']), w['rpc']['total_calls'], w['dom']['dialogNodes']) for w in ws]
    print(f"  {t[:26]:26} " + ' | '.join(f"{s[0]} {s[1]}ms lt{s[2]} rpc{s[3]} n{s[4]}" for s in seq))

# ---------- SCROLL ----------
print('\n' + '=' * 110)
print('滚动（每段 ≈2.2s，逐段）')
print(f"{'窗口':40} {'range':>6} {'帧n':>5} {'p95':>6} {'max':>7} {'>50':>4} {'LT次':>5} {'LTms':>7} {'ΔLayout':>8} {'ΔRecalc':>8} {'ΔLayoutDur':>11} {'ΔScript':>8} {'churn+':>7} {'layoutReads':>11}")
sw = [w for w in W if 'SCROLL' in w['label']]
for w in sw:
    print(f"{w['label'][:40]:40} {str(w.get('seg', {}).get('range')):>6} {w['frames'].get('n'):>5} {str(w['frames'].get('p95')):>6} {str(w['frames'].get('max')):>7} {w['frames'].get('over50'):>4} {len(w['longtasks']):>5} {w['longtask_total_ms']:>7} {str(w['cdpDelta'].get('LayoutCount')):>8} {str(w['cdpDelta'].get('RecalcStyleCount')):>8} {str(w['cdpDelta'].get('LayoutDuration')):>11} {str(w['cdpDelta'].get('ScriptDuration')):>8} {str(w['churn']['added']):>7} {str(sum(w['layoutReads'].values())):>11}")

if sw:
    print('\n滚动速率对比（每段时长按 2.2s 归一；NULL 窗按 1.6s 归一）')
    for t in sorted(set(w['label'].split(' ')[1] for w in sw)):
        sub = [w for w in sw if w['label'].split(' ')[1] == t]
        print(f"  {t[:24]:24} ΔRecalc/s={round(sum(w['cdpDelta'].get('RecalcStyleCount',0) for w in sub)/ (len(sub)*2.2),2)} ΔLayout/s={round(sum(w['cdpDelta'].get('LayoutCount',0) for w in sub)/(len(sub)*2.2),2)} LTms/s={round(sum(w['longtask_total_ms'] for w in sub)/(len(sub)*2.2),2)} churn+/s={round(sum(w['churn']['added'] for w in sub)/(len(sub)*2.2),1)}")
    print(f"  {'NULL(不滚动)':24} ΔRecalc/s={round(sum(w['cdpDelta'].get('RecalcStyleCount',0) for w in NULLS)/(len(NULLS)*1.6),2)} ΔLayout/s={round(sum(w['cdpDelta'].get('LayoutCount',0) for w in NULLS)/(len(NULLS)*1.6),2)} LTms/s={round(sum(w['longtask_total_ms'] for w in NULLS)/(len(NULLS)*1.6),2)} churn+/s={round(sum(w['churn']['added'] for w in NULLS)/(len(NULLS)*1.6),1)}")

print('\nscrollRanges:', json.dumps(R.get('scrollRanges'), ensure_ascii=False))
print('errors:', json.dumps(R.get('errors', [])[:6], ensure_ascii=False))
print('fatal:', R.get('fatal'))
