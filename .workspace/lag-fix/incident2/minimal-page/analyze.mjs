#!/usr/bin/env node
/*
 * analyze.mjs — turns the raw per-run JSON of measure.mjs into
 *   raw/aggregate.json   machine-readable decision matrix
 *   matrix.md            the human table used by audit.md
 *
 * Pure post-processing: no browser, no lock, read-only over ./raw.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, 'raw');
const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--tags=')) || '').slice(7);
const TAGF = only ? only.split(',') : null;

const med = (a) => {
  const v = a.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((x, y) => x - y);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round(((v[m - 1] + v[m]) / 2) * 100) / 100;
};
const maxOf = (a) => { const v = a.filter((x) => typeof x === 'number' && Number.isFinite(x)); return v.length ? Math.max(...v) : null; };
const r1 = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 10) / 10 : null);

/* ------------------------------------------------------------ load corpus */
const files = fs.readdirSync(RAW).filter((f) => f.endsWith('-summary.json'));
const corpus = [];
for (const f of files) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8')); } catch { continue; }
  if (TAGF && !TAGF.includes(j.tag)) continue;
  const target = (j.config && j.config.target) || 'minimal';
  corpus.push({ tag: j.tag, target, file: f, runs: j.results || [], lock: j.lock || null });
}

const rows = [];
for (const c of corpus) {
  for (const r of c.runs) {
    const base = {
      tag: c.tag, target: c.target, cellId: r.cellId, rep: r.rep, mode: r.mode, gpu: r.gpu,
      trace: !!r.trace, scenario: r.scenario, desc: r.desc,
      error: r.error || null,
      foreignMax: r.censusDuringMax, foreignAfter: r.censusAfter ? r.censusAfter.foreignInstanceTotal : null,
      loadBefore: r.loadBefore ? r.loadBefore.l1 : null, loadAfter: r.loadAfter ? r.loadAfter.l1 : null,
      browserClosed: r.browserClosed,
    };
    if (r.primary) {
      const s = r.primary.stats || {}, d = r.primary.perfDelta || {};
      Object.assign(base, {
        fps: s.fpsMean, p50: s.p50, p95: s.p95, p99: s.p99, max: s.max, mean: s.mean,
        gt16_7: s.gt16_7, gt20: s.gt20, gt33: s.gt33, gt50: s.gt50, gt100: s.gt100,
        missed: s.framesMissedVs60, frames: s.frameCount,
        scriptMs: d.Script_ms, recalcMs: d.RecalcStyle_ms, layoutMs: d.Layout_ms, taskMs: d.Task_ms,
        layoutCount: d.LayoutCount, recalcCount: d.RecalcStyleCount,
        longtasks: r.primary.longtaskCount, loafs: r.primary.loafCount,
        longtaskDurSum: r.primary.longtaskDurSum, loafDurSum: r.primary.loafDurSum,
        loavesGt50: r.primary.loavesGt50,
        longestLt: r.primary.longestLongtask ? r.primary.longestLongtask.dur : null,
        visibility: r.primary.visibility, hasFocus: r.primary.hasFocus,
        screenW: r.primary.screenInfo ? r.primary.screenInfo.w : null,
        moves: r.primary.counters ? r.primary.counters.moves : null,
        ripples: r.primary.counters ? r.primary.counters.ripplesSpawned : null,
        trayOpens: r.primary.counters ? r.primary.counters.trayOpens : null,
        trayCloses: r.primary.counters ? r.primary.counters.trayCloses : null,
        driveHz: r.primary.drive ? r.primary.drive.effectiveHz : null,
        movesSent: r.primary.drive ? r.primary.drive.movesSent : null,
      });
    }
    if (r.trace) {
      const g = (r.trace.groups) || {};
      base.tg = {
        script: g.script ? g.script.ms : null, style: g.style ? g.style.ms : null,
        layout: g.layout ? g.layout.ms : null, paint: g.paint ? g.paint.ms : null,
        composite: g.composite ? g.composite.ms : null,
      };
      base.traceTop = (r.trace.topEvents || []).slice(0, 8);
      base.traceBuf = r.trace.bufferUsageMaxPercent;
      base.traceFps = r.trace.stats ? r.trace.stats.fpsMean : null;
      base.traceP95 = r.trace.stats ? r.trace.stats.p95 : null;
    }
    if (r.dshPhase) {
      base.dsh = {
        clickSelector: r.dshPhase.clickSelector, clickError: r.dshPhase.clickError,
        idle: r.dshPhase.idle ? { ...r.dshPhase.idle.stats, lt: r.dshPhase.idle.lt } : null,
        open: r.dshPhase.open ? { ...r.dshPhase.open.stats, lt: r.dshPhase.open.lt, tabs: r.dshPhase.open.visibleTabs } : null,
        move: r.dshPhase.move ? { ...r.dshPhase.move.stats, ...r.dshPhase.move.perfDelta, lt: r.dshPhase.move.longtaskCount, loaf: r.dshPhase.move.loafCount, longestLt: r.dshPhase.move.longestLongtask ? r.dshPhase.move.longestLongtask.dur : null, visibility: r.dshPhase.move.visibility } : null,
      };
    }
    rows.push(base);
  }
}

/* --------------------------------------------------------------- validity */
/* FIXED (review S6): runs used to be pooled as long as they did not throw.
 * A run whose page was hidden/unfocused, or which sent no mouse events in an
 * interaction cell, or which produced no trace of the interaction it claims to
 * measure, is now flagged instead of silently joining a median. */
function validity(r) {
  const issues = [];
  if (r.visibility && r.visibility !== 'visible') issues.push('page-not-visible');
  if (r.hasFocus === false) issues.push('no-focus');
  if (r.scenario && r.scenario !== 'none' && (!r.moves || r.moves < 30)) issues.push('moves=' + (r.moves ?? 'null'));
  if ((r.scenario === 'hover' || r.scenario === 'both') && !(r.trayOpens > 0)) issues.push('trayOpens=0(hover-did-nothing)');
  if (r.scenario === 'ripple' || r.scenario === 'both' || r.scenario === 'hover') {
    if (!(r.ripples > 0)) issues.push('ripples=0');
  }
  if (!r.frames || r.frames < 30) issues.push('frames=' + (r.frames ?? 'null'));
  if (r.foreignMax > 0) issues.push('foreignBrowsers=' + r.foreignMax);
  return issues;
}
for (const r of rows) {
  if (r.error) { r.validity = ['run-error']; continue; }
  r.validity = validity(r);
  r.valid = r.validity.filter((x) => !/^foreignBrowsers=/.test(x)).length === 0;
}

/* --------------------------------------------------------------- grouping */
const keyOf = (r) => `${r.mode}|${r.gpu}|${r.target}|${r.cellId}`;
const groups = new Map();
for (const r of rows) {
  if (r.error) continue;
  const k = keyOf(r);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}

const agg = [];
for (const [k, rs] of groups) {
  const [mode, gpu, target, cellId] = k.split('|');
  const pick = (f) => rs.map(f).filter((x) => x != null);
  agg.push({
    key: k, mode, gpu, target, cellId, scenario: rs[0].scenario, desc: rs[0].desc, n: rs.length,
    tags: [...new Set(rs.map((r) => r.tag))],
    validRuns: rs.filter((r) => r.valid).length,
    invalidRuns: rs.filter((r) => !r.valid).length,
    validityIssues: [...new Set(rs.flatMap((r) => r.validity || []))],
    fps: med(pick((r) => r.fps)), p50: med(pick((r) => r.p50)), p95: med(pick((r) => r.p95)),
    p99: med(pick((r) => r.p99)), max: maxOf(pick((r) => r.max)), meanIv: med(pick((r) => r.mean)),
    gt50: rs.reduce((a, r) => a + (r.gt50 || 0), 0),
    gt50PerRep: med(pick((r) => r.gt50)),
    gt20: rs.reduce((a, r) => a + (r.gt20 || 0), 0),
    gt16_7: rs.reduce((a, r) => a + (r.gt16_7 || 0), 0),
    missed: rs.reduce((a, r) => a + (r.missed || 0), 0),
    frames: med(pick((r) => r.frames)),
    scriptMs: med(pick((r) => r.scriptMs)), recalcMs: med(pick((r) => r.recalcMs)),
    layoutMs: med(pick((r) => r.layoutMs)), taskMs: med(pick((r) => r.taskMs)),
    layoutCount: med(pick((r) => r.layoutCount)), recalcCount: med(pick((r) => r.recalcCount)),
    longtasks: rs.reduce((a, r) => a + (r.longtasks || 0), 0),
    longestLt: maxOf(pick((r) => r.longestLt)),
    foreignMax: maxOf(pick((r) => r.foreignMax)),
    loadMax: maxOf(pick((r) => r.loadBefore)),
    visibility: [...new Set(rs.map((r) => r.visibility))].join(','),
    moves: med(pick((r) => r.moves)), ripples: med(pick((r) => r.ripples)), trayOpens: med(pick((r) => r.trayOpens)),
    trayCloses: med(pick((r) => r.trayCloses)), driveHz: med(pick((r) => r.driveHz)),
    screenW: med(pick((r) => r.screenW)),
    scriptShare: null, styleShare: null, layoutShare: null, paintShare: null, compositeShare: null,
    traceN: 0,
  });
}
/* trace groups for the same key come from separate runs with trace=true */
const tGroups = new Map();
for (const r of rows) {
  if (r.error || !r.tg) continue;
  const k = keyOf(r);
  if (!tGroups.has(k)) tGroups.set(k, []);
  tGroups.get(k).push(r);
}
for (const a of agg) {
  const rs = tGroups.get(a.key);
  if (!rs || !rs.length) continue;
  const pick = (f) => rs.map(f).filter((x) => x != null);
  const s = med(pick((r) => r.tg.script)) || 0, st = med(pick((r) => r.tg.style)) || 0,
    la = med(pick((r) => r.tg.layout)) || 0, pa = med(pick((r) => r.tg.paint)) || 0,
    co = med(pick((r) => r.tg.composite)) || 0;
  const tot = s + st + la + pa + co;
  a.traceN = rs.length;
  a.traceMs = { script: s, style: st, layout: la, paint: pa, composite: co, groupedTotal: r1(tot) };
  /* FIXED (review B2): traceShare could be null when a trace pass matched no
   * complete events, and the table then dereferenced it -> TypeError -> neither
   * matrix.md nor aggregate.json was ever written. */
  a.traceShare = tot > 0 ? {
    script: Math.round((s / tot) * 1000) / 10, style: Math.round((st / tot) * 1000) / 10,
    layout: Math.round((la / tot) * 1000) / 10, paint: Math.round((pa / tot) * 1000) / 10,
    composite: Math.round((co / tot) * 1000) / 10,
  } : null;
  a.traceTop = rs[0].traceTop;
  a.traceBuf = maxOf(pick((r) => r.traceBuf));
  a.traceBufReported = rs.some((r) => r.traceBufReported);
  a.traceFps = med(pick((r) => r.traceFps));
  a.traceP95 = med(pick((r) => r.traceP95));
  a.traceWindowMs = med(pick((r) => r.traceWindowMs));
  /* FIXED (review B4): the window was hard-coded to 3000 ms while the real
   * window is --dwell and is not guaranteed to be exactly 3 s. */
  a.mainThreadPctOfWindow = a.traceWindowMs
    ? Math.round(((s + st + la) / a.traceWindowMs) * 1000) / 10
    : null;
}

/* ------------------------------------------------------------------ tables */
const sortKey = (a) => `${a.target}|${a.mode}|${a.gpu}|${a.cellId}`;
const sortedAgg = agg.slice().sort((x, y) => sortKey(x).localeCompare(sortKey(y)));

const L = [];
L.push('# 最小复现页判定矩阵（自动生成，勿手改）');
L.push('');
L.push(`生成时间: ${new Date().toISOString()}  ·  分组数: ${agg.length}  ·  有效运行数: ${rows.filter((r) => !r.error).length}  ·  出错运行数: ${rows.filter((r) => r.error).length}`);
L.push('');
L.push('列说明: fps=3s 平均帧率中位数; p50/p95/p99/max=帧间隔 ms 中位数(除 max 取各次运行最大值); >50ms=各次运行累计 >50ms 帧数; LongTask=累计;');
L.push('Script/Recalc/Layout = CDP Performance.getMetrics 窗口增量中位数(ms); foreignMax=运行期间/精确 census 到的外来浏览器实例数上限; load1=运行前 loadavg 1min 上限.');
L.push('');
L.push('| target | mode | gpu | cell | 场景 | reps | tags | fps | p50 | p95 | p99 | max | >50ms | LongTask | Script | Recalc | Layout | 掉帧(>16.7) | foreignMax | load1 | 可见性 |');
L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const a of sortedAgg) {
  L.push(`| ${a.target} | ${a.mode} | ${a.gpu} | ${a.cellId} | ${a.scenario} | ${a.n} | ${a.tags.join('+')} | ${r1(a.fps)} | ${r1(a.p50)} | ${r1(a.p95)} | ${r1(a.p99)} | ${a.max} | ${a.gt50} | ${a.longtasks} | ${r1(a.scriptMs)} | ${r1(a.recalcMs)} | ${r1(a.layoutMs)} | ${a.missed} | ${a.foreignMax} | ${r1(a.loadMax)} | ${a.visibility} |`);
}

L.push('');
L.push('## 归因（CDP trace，Script/Recalc/Layout/Paint/Composite 分组时长）');
L.push('');
L.push('| mode | gpu | cell | reps | Script ms | Recalc ms | Layout ms | Paint ms | Composite ms | 主线程占比 | trace fps | trace p95 | 归因占比 S/R/L/P/C |');
L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const a of sortedAgg.filter((x) => x.traceMs)) {
  const t = a.traceMs, sh = a.traceShare;
  L.push(`| ${a.mode} | ${a.gpu} | ${a.cellId} | ${a.traceN} | ${t.script} | ${t.style} | ${t.layout} | ${t.paint} | ${t.composite} | ${a.mainThreadPctOfWindow}% | ${r1(a.traceFps)} | ${r1(a.traceP95)} | ${sh.script}/${sh.style}/${sh.layout}/${sh.paint}/${sh.composite} |`);
}

/* DSH comparison table */
const dshRows = rows.filter((r) => r.dsh && r.dsh.move);
if (dshRows.length) {
  L.push('');
  L.push('## DSH 对照（只读、仅 1 次页面加载）');
  L.push('');
  for (const r of dshRows) {
    const d = r.dsh;
    L.push(`- tag=${r.tag} mode=${r.mode} gpu=${r.gpu} 点击选择器=${d.clickSelector || '(未命中: ' + d.clickError + ')'} 可见性=${d.move.visibility}`);
    L.push(`  - 空闲(未交互, 1s): fps=${r1(d.idle.fpsMean)} p50=${r1(d.idle.p50)} p95=${r1(d.idle.p95)} max=${d.idle.max} >50ms=${d.idle.gt50} LongTask=${d.idle.lt}`);
    L.push(`  - 点开「设置」后 1.5s: fps=${r1(d.open.fpsMean)} p50=${r1(d.open.p50)} p95=${r1(d.open.p95)} max=${d.open.max} >50ms=${d.open.gt50} LongTask=${d.open.lt}`);
    L.push(`  - 设置页 3s 鼠标移动: fps=${r1(d.move.fpsMean)} p50=${r1(d.move.p50)} p95=${r1(d.move.p95)} p99=${r1(d.move.p99)} max=${d.move.max} >50ms=${d.move.gt50} LongTask=${d.move.lt} LoAF=${d.move.loaf} 最长LongTask=${d.move.longestLt}ms`);
    L.push(`  - 窗口增量: Script=${r1(d.move.Script_ms)}ms Recalc=${r1(d.move.RecalcStyle_ms)}ms Layout=${r1(d.move.Layout_ms)}ms Task=${r1(d.move.Task_ms)}ms`);
  }
}

/* errors + concurrency */
const errRows = rows.filter((r) => r.error);
L.push('');
L.push('## 出错与并发记录');
L.push('');
L.push(`- 出错运行: ${errRows.length}` + (errRows.length ? ` -> ${errRows.map((r) => `${r.tag}/${r.cellId}/r${r.rep}: ${String(r.error).split('\n')[0]}`).join(' ; ')}` : ''));
const fm = maxOf(rows.map((r) => r.foreignMax));
L.push(`- 所有运行中 census 到的外来浏览器实例数上限: ${fm}（0 表示运行期间采样时刻未发现外来实例；本机长期有其它研究线并发，见 audit.md 并发章节）`);
L.push(`- 每条记录的 censusDuringMax / loadBefore / visibility 均已逐次落盘在 raw/*.json`);

const out = { generatedAt: new Date().toISOString(), groups: sortedAgg, rows, crossChecks: { maxForeignInstances: fm } };
fs.writeFileSync(path.join(RAW, 'aggregate.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(HERE, 'matrix.md'), L.join('\n') + '\n');
console.log(L.join('\n'));
console.log(`\n-> raw/aggregate.json, matrix.md (${sortedAgg.length} configs, ${rows.length} runs)`);
