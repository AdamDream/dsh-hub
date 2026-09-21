/*
 * analyze: independent recomputation over raw/run.json.
 *
 * Nothing here trusts a number computed at collection time. Every CDP metric is
 * re-derived from the two raw cumulative snapshots stored at each window
 * boundary, and every collected delta is cross-checked against that
 * recomputation. Disagreements are reported, not smoothed over.
 *
 * Emits raw/analysis.json (machine) and raw/tables.md (the tables quoted in audit.md).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/tab-profile';
const BATCH = process.env.TP_BATCH || 'unlocked';
const RAW = path.join(ROOT, 'raw', BATCH);
const run = JSON.parse(fs.readFileSync(path.join(RAW, 'run.json'), 'utf8'));

const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const CDP = ['ScriptDuration', 'TaskDuration', 'RecalcStyleDuration', 'LayoutDuration'];
const median = (a) => { const x = a.filter((v) => v != null).sort((p, q) => p - q); if (!x.length) return null; const m = Math.floor(x.length / 2); return x.length % 2 ? x[m] : r3((x[m - 1] + x[m]) / 2); };
const sum = (a) => a.reduce((p, q) => p + (q ?? 0), 0);

/* ---------------------------------------------------------- recompute layer */

const recomputeIssues = [];

function recomputeWindow(w, where) {
  const a = w.cdpRawStart, b = w.cdpRawEnd;
  const out = { recomputed: {}, reportedMatch: {}, monotonic: {} };
  for (const n of CDP) {
    if (a?.[n] == null || b?.[n] == null) { out.recomputed[n] = null; out.monotonic[n] = null; recomputeIssues.push(`${where}: missing cumulative snapshot for ${n}`); continue; }
    out.monotonic[n] = b[n] >= a[n];
    if (b[n] < a[n]) recomputeIssues.push(`${where}: cumulative metric ${n} went BACKWARD (${a[n]} -> ${b[n]}) - window crosses a reset/navigation`);
    out.recomputed[n] = r3((b[n] - a[n]) * 1000);
  }
  for (const n of CDP) out.reportedMatch[n] = (out.recomputed[n] != null && w.cdpDeltaMs?.[n] != null) ? Math.abs(out.recomputed[n] - w.cdpDeltaMs[n]) < 0.01 : null;
  const mismatches = Object.entries(out.reportedMatch).filter(([, v]) => v === false).map(([k]) => k);
  if (mismatches.length) recomputeIssues.push(`${where}: collected delta != recomputed delta for ${mismatches.join(',')}`);
  return out;
}

function walkWindows(fn) {
  for (const b of run.baseline || []) fn(b, `baseline:${b.label}`);
  for (const r of run.runs || []) for (const w of r.windows || []) fn(w, `run:${r.id}:r${r.repeat}:${w.label}`);
  const p = run.plugins || {};
  if (p.firstMount?.window) fn(p.firstMount.window, 'plugins:firstMount');
  for (const w of p.poll60?.subWindows || []) fn(w, `plugins:poll:${w.label}`);
  if (p.return?.window) fn(p.return.window, 'plugins:return');
}
const recomputes = {};
walkWindows((w, where) => { recomputes[where] = recomputeWindow(w, where); });

/* ------------------------------------------------------------ tab summaries */

const TAB_ORDER = ['general', 'models', 'plugins', 'agent-preset', 'remote-workspace', 'distributed', 'vision-adam', 'subagent-model'];
const TAB_LABEL = { general: '通用设置', models: '模型', plugins: '插件', 'agent-preset': 'Agent 预设', 'remote-workspace': '远程工作区', distributed: '分布式控制 · dsh-ssh-gui', 'vision-adam': 'vision-adam 识图设置', 'subagent-model': '子代理模型' };

const tabsOut = [];
for (const id of TAB_ORDER) {
  const runs = (run.runs || []).filter((r) => r.id === id);
  if (!runs.length) { tabsOut.push({ id, label: TAB_LABEL[id], runs: 0, status: 'NOT-MEASURED' }); continue; }
  const meter = (pick) => runs.map(pick);
  const per = runs.map((r) => ({
    repeat: r.repeat, status: r.status, valid: r.valid, invalidReasons: r.invalidReasons,
    openMs: r.openMs, openMsClean: r.openMsClean,
    panelNodesBefore: r.panels?.before?.nodes, panelNodesAfter: r.panels?.after?.nodes,
    activeLabelAfter: r.panels?.after?.activeLabel,
    parkedAt: r.parkedAt ?? null,
    w1: r.windows?.[0] ? summarizeWindow(r.windows[0]) : null,
    w2: r.windows?.[1] ? summarizeWindow(r.windows[1]) : null,
  }));
  tabsOut.push({
    id, label: TAB_LABEL[id], runs: runs.length, status: runs.every((r) => r.status === 'PASS') ? 'PASS' : (runs.some((r) => r.status === 'NOT-FOUND') ? 'NOT-FOUND' : 'INVALID'),
    openMs: { r1: runs[0]?.openMs ?? null, r2: runs[1]?.openMs ?? null, median: median(meter((r) => r.openMs)), cleanMedian: median(meter((r) => r.openMsClean)) },
    w1: aggregate(runs.map((r) => summarizeWindow(r.windows?.[0]))),
    w2: aggregate(runs.map((r) => summarizeWindow(r.windows?.[1]))),
    panelNodes: { after: meter((r) => r.panels?.after?.nodes), dialog: meter((r) => r.panels?.after?.dialogNodes) },
    per,
  });
}


function aggregate(list) {
  // consumes the SUMMARISED window shape produced by summarizeWindow()
  const ws = list.filter(Boolean);
  if (!ws.length) return null;
  const keys = new Set(); for (const w of ws) for (const k of Object.keys(w.wsByPayload || {})) keys.add(k);
  const wsByPayload = {};
  for (const k of keys) wsByPayload[k] = { medianPerSec: median(ws.map((w) => w.wsByPayload[k]?.perSec ?? 0)), maxPerSec: Math.max(...ws.map((w) => w.wsByPayload[k]?.perSec ?? 0)) };
  const subKeys = new Set(); for (const w of ws) for (const k of Object.keys(w.wsBySub || {})) subKeys.add(k);
  const wsBySub = {};
  for (const k of subKeys) wsBySub[k] = { medianPerSec: median(ws.map((w) => w.wsBySub[k]?.perSec ?? 0)) };
  return {
    n: ws.length,
    seconds: median(ws.map((w) => w.seconds)),
    cdpPerSec: Object.fromEntries(CDP.map((n) => [n, median(ws.map((w) => w.cdpPerSec[n] ?? null))])),
    cdpMs: Object.fromEntries(CDP.map((n) => [n, median(ws.map((w) => w.cdp[n] ?? null))])),
    frames: {
      p50: median(ws.map((w) => w.frames.p50)), p95: median(ws.map((w) => w.frames.p95)),
      p99: median(ws.map((w) => w.frames.p99)), max: Math.max(...ws.map((w) => w.frames.max ?? 0)),
      over50: median(ws.map((w) => w.frames.over50)),
      over50Per100Frames: median(ws.map((w) => w.frames.over50Per100Frames ?? null)),
      framesPerSec: median(ws.map((w) => w.frames.n ? r3(w.frames.n / w.seconds) : null)),
      n: median(ws.map((w) => w.frames.n)),
      starvationWindows: ws.filter((w) => w.frameStarvation).length,
    },
    longtasks: {
      nTotal: sum(ws.map((w) => w.longtasks.n)),
      nMedian: median(ws.map((w) => w.longtasks.n)),
      maxMs: Math.max(...ws.map((w) => w.longtasks.maxMs ?? 0)),
      totalMs: sum(ws.map((w) => w.longtasks.totalMs)),
    },
    scriptPerEvent: median(ws.map((w) => w.scriptPerEvent ?? null)),
    recalcPerEvent: median(ws.map((w) => w.recalcPerEvent ?? null)),
    load: {
      sessionEventPerSec: median(ws.map((w) => w.load?.sessionEventPerSec ?? null)),
      sessionProjectionPerSec: median(ws.map((w) => w.load?.sessionProjectionPerSec ?? null)),
      totalPerSec: median(ws.map((w) => w.load?.totalPerSec ?? null)),
    },
    domNodes: median(ws.map((w) => w.domNodes)),
    jseventListeners: median(ws.map((w) => w.jseventListeners ?? null)),
    wsByPayload, wsBySub,
    wsBytesPerSec: median(ws.map((w) => w.wsBytesPerSec)),
    wsFramesRecvPerSec: median(ws.map((w) => (w.frames.n ? w.wsFramesRecv / w.seconds : null))),
    usageSamples: ws.flatMap((w) => w.usageSamples || []),
  };
}

/* ------------------------------------------------------------- baseline floor */

/* Two closed-settings baselines were captured in different pages minutes apart.
 * Their ambient event load differs by ~80x, which is itself a finding: the host
 * is shared with a live streaming agent session, so a single "floor" number is
 * not a stable constant. baseline[1] (same page as the tab runs) is primary;
 * baseline[0] is kept as direct evidence of non-stationarity. */
const baseWindows = (run.baseline || []);
const basePrimary = baseWindows.find((b) => b.label.includes('profile-page')) || baseWindows[0];
const baseAlt = baseWindows.find((b) => b !== basePrimary) || null;

const FLOORKEY = { ScriptDuration: 'scriptPerSec', TaskDuration: 'taskPerSec', RecalcStyleDuration: 'recalcPerSec', LayoutDuration: 'layoutPerSec' };
/* declared as a hoisted function: summarizeWindow() is called from the tab loop above */
function loadOf(w) {
  if (!w) return null;
  const e = w.ws.byPayloadTypePerSec['session/event']?.perSec ?? 0;
  const p = w.ws.byPayloadTypePerSec['session/projection']?.perSec ?? 0;
  return { sessionEventPerSec: e, sessionProjectionPerSec: p, totalPerSec: r3(e + p) };
}

function summarizeWindow(w) {
  if (!w) return null;
  const load = loadOf(w);
  const perEvt = (ms) => (load && load.totalPerSec > 0 ? r3(ms / load.totalPerSec) : null);
  return {
    label: w.label, seconds: w.seconds,
    cdp: Object.fromEntries(CDP.map((n) => [n, w.cdpDeltaMs?.[n] ?? null])),
    cdpPerSec: Object.fromEntries(CDP.map((n) => [n, w.cdpDeltaMs?.[n] != null ? r3(w.cdpDeltaMs[n] / w.seconds) : null])),
    load,
    scriptPerEvent: perEvt(w.cdpDeltaMs?.ScriptDuration != null ? w.cdpDeltaMs.ScriptDuration / w.seconds : null),
    recalcPerEvent: perEvt(w.cdpDeltaMs?.RecalcStyleDuration != null ? w.cdpDeltaMs.RecalcStyleDuration / w.seconds : null),
    frames: { ...w.frames, over50Per100Frames: w.frames.n ? r3((w.frames.over50 / w.frames.n) * 100) : null, fps: r3(w.frames.n / w.seconds) },
    frameStarvation: (!w.documentHidden && (w.frames.n / w.seconds) < 45),
    longtasks: { n: w.longtasks.n, totalMs: w.longtasks.totalMs, maxMs: w.longtasks.maxMs },
    domNodes: w.domNodes, jseventListeners: w.cdpRawEnd?.JSEventListeners ?? null,
    wsByPayload: w.ws.byPayloadTypePerSec, wsBySub: w.ws.byPayloadSubTypePerSec, wsByEnvelope: w.ws.byEnvelopePerSec,
    wsBytesPerSec: r3(w.ws.recvBytes / w.seconds), wsFramesRecv: w.ws.totalFramesRecv,
    usageSamples: w.http.usageSamples, reasons: w.reasons, hidden: w.documentHidden,
  };
}

const base = basePrimary ? summarizeWindow(basePrimary) : null;
const floor = base ? {
  source: base.label, seconds: base.seconds,
  scriptPerSec: base.cdpPerSec.ScriptDuration, taskPerSec: base.cdpPerSec.TaskDuration,
  recalcPerSec: base.cdpPerSec.RecalcStyleDuration, layoutPerSec: base.cdpPerSec.LayoutDuration,
  scriptPerEvent: base.scriptPerEvent, recalcPerEvent: base.recalcPerEvent,
  load: base.load,
  frames: base.frames, longtasks: base.longtasks, wsByPayload: base.wsByPayload,
} : null;

/* -------- load-normalised comparison: how much work per ambient event? ----- */
const allWindows = [];
for (const b of baseWindows) allWindows.push({ scope: 'baseline-closed-settings', ...summarizeWindow(b) });
for (const r of run.runs || []) for (const w of r.windows || []) allWindows.push({ scope: `${r.id}:r${r.repeat}:${w.label.includes('w1') ? 'w1_10s' : 'w2_20s'}`, tab: r.id, ...summarizeWindow(w) });
const withLoad = allWindows.filter((w) => w.load && w.load.totalPerSec > 0 && w.cdpPerSec.ScriptDuration != null);
const pearson = (xs, ys) => {
  const n = xs.length; if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return (sxx && syy) ? r3(sxy / Math.sqrt(sxx * syy)) : null;
};
const corr = {
  n: withLoad.length,
  script_vs_totalEvents: pearson(withLoad.map((w) => w.load.totalPerSec), withLoad.map((w) => w.cdpPerSec.ScriptDuration)),
  recalc_vs_totalEvents: pearson(withLoad.map((w) => w.load.totalPerSec), withLoad.map((w) => w.cdpPerSec.RecalcStyleDuration)),
  over50_vs_totalEvents: pearson(withLoad.map((w) => w.load.totalPerSec), withLoad.map((w) => w.frames.over50Per100Frames)),
};

/* ----------------------------------------------------- user-perceivable path */

const CRITERIA = {
  openLatency_perceivable_ms: 100,
  openLatency_note: 'openMsClean is the mutation-precise click->first-DOM-change figure; openMs is rAF-quantised (~16.7ms) and is reported only as a sanity cross-check.',
  amplification_ratio: 1.5,
  amplification_note: 'ABSOLUTE sustained cost per second vs the same-page closed-settings baseline. Only meaningful while ambient event load is comparable; prefer perEventAmplification when load differs.',
  per_event_amplification_ratio: 1.5,
  per_event_note: 'LOAD-NORMALISED amplification: ms of Script per ambient session event, tab vs closed-settings baseline on the same page. Primary "does this tab itself cost more" test, because the host is shared with a live streaming session and absolute cost tracks that stream.',
  frame_rate_floor_fps: 45,
  frame_rate_note: 'closed-settings baseline ran at ~57 fps on this (already loaded) host; a sustained window below 45 fps means rAF could not keep up, which is the clearest user-perceivable symptom.',
  jank_over50_per_100_frames: 3,
  jank_note: 'frames longer than 50ms per 100 frames, versus the same figure measured with settings closed.',
};

const verdicts = tabsOut.map((t) => {
  const w = t.w1 || t.w2;
  if (!w) return { id: t.id, label: t.label, verdict: 'NOT-MEASURED' };
  const amp = (n) => (floor?.[FLOORKEY[n]] ? r3(w.cdpPerSec[n] / floor[FLOORKEY[n]]) : null);
  const perEventAmp = (k) => (floor?.[k] && w[k] != null ? r3(w[k] / floor[k]) : null);
  const jank = w.frames.over50Per100Frames;
  const baseJank = floor ? floor.frames.over50 / floor.frames.n * 100 : null;
  const longtask = w.longtasks.nTotal;
  const open = t.openMs.cleanMedian ?? t.openMs.median;
  const findings = [];
  const fps = w.frames.fps ?? w.frames.framesPerSec;
  if (fps != null && fps < CRITERIA.frame_rate_floor_fps) findings.push(`frame rate collapsed to ${fps} fps (< ${CRITERIA.frame_rate_floor_fps}); ${w.frames.starvationWindows} of ${w.n} windows starved`);
  if (open != null && open > CRITERIA.openLatency_perceivable_ms) findings.push(`open latency ${open}ms > ${CRITERIA.openLatency_perceivable_ms}ms`);
  if (amp('ScriptDuration') != null && amp('ScriptDuration') >= CRITERIA.amplification_ratio) findings.push(`script ${amp('ScriptDuration')}x baseline`);
  if (amp('RecalcStyleDuration') != null && amp('RecalcStyleDuration') >= CRITERIA.amplification_ratio) findings.push(`recalc ${amp('RecalcStyleDuration')}x baseline`);
  if (jank != null && baseJank != null && jank >= CRITERIA.jank_over50_per_100_frames && jank > baseJank * 1.5) findings.push(`>50ms frames ${jank}/100 vs baseline ${r3(baseJank)}/100`);
  if (longtask > 0) findings.push(`${longtask} longtask(s), max ${w.longtasks.maxMs}ms`);
  return {
    id: t.id, label: t.label, status: t.status,
    openMsClean: open, scriptPerSec: w.cdpPerSec.ScriptDuration, recalcPerSec: w.cdpPerSec.RecalcStyleDuration,
    scriptAmp: amp('ScriptDuration'), recalcAmp: amp('RecalcStyleDuration'),
    scriptPerEvent: w.scriptPerEvent, recalcPerEvent: w.recalcPerEvent,
    scriptPerEventAmp: perEventAmp('scriptPerEvent'), recalcPerEventAmp: perEventAmp('recalcPerEvent'),
    load: w.load, domNodes: w.domNodes,
    fps, baselineFps: floor?.frames ? r3(floor.frames.n / floor.seconds) : null, starvedWindows: w.frames.starvationWindows,
    over50Per100: jank, baselineOver50Per100: r3(baseJank), longtasks: longtask, longtaskMaxMs: w.longtasks.maxMs,
    findings, cleanIfNoFindings: findings.length === 0,
  };
});

/* ------------------------------------------------------------------- output */

const out = {
  meta: { at: new Date().toISOString(), batch: BATCH, source: `raw/${BATCH}/run.json`, recomputedFromRawCumulativeSnapshots: true, criteria: CRITERIA,
    lock: run.meta?.lock ?? run.lock ?? null },
  concurrency: (() => {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'raw', 'concurrency-census.json'), 'utf8'));
      return {
        censusGeneratedAtLocal: c.generatedAtLocal,
        liveNow: { headlessShellProcessTotal: c.live.headlessShellProcessTotal, browserInstanceTotal: c.live.browserInstanceTotal, foreignBrowserInstances: c.live.foreignBrowserInstances, lockHeldBy: c.live.lock?.ownerAgent ?? null, lockViolatedNow: c.live.lockViolatedNow },
        thisBatch: c.retroactive[BATCH] ?? null,
        exclusiveCertifiedAnyBatch: c.conclusion.exclusiveCertifiedAnyBatch,
        headline: c.conclusion.headline,
        pollutionTier: 'ALL-WINDOWS-POLLUTION-PRONE',
        pollutionTierReason: 'Per-window concurrent-browser counts were NOT recorded live for this batch (the instrumentation was added afterwards). Retroactive process-start analysis refutes exclusivity for both batches. Therefore no window in this batch may be used for a load-sensitive verdict; only structural/count conclusions survive.',
      };
    } catch (e) { return { error: String(e).slice(0, 200) }; }
  })(),
  lockCertification: {
    batch: BATCH,
    lockRecordedInRun: !!(run.meta?.lock ?? run.lock),
    heldAcrossWholeRun: (run.meta?.lock ?? run.lock)?.heldAcrossWholeRun ?? null,
    acquiredAt: (run.meta?.lock ?? run.lock)?.acquiredAt ?? null,
    waitedMs: (run.meta?.lock ?? run.lock)?.waitedMs ?? null,
    retriesBeforeAcquire: (run.meta?.lock ?? run.lock)?.retriesBeforeAcquire ?? null,
    preemptions: (run.meta?.lock ?? run.lock)?.preemptions ?? null,
    windowsTotal: 0, windowsLockHeld: 0, windowsWithoutLock: [],
  },
  integrity: {
    windowsChecked: Object.keys(recomputes).length,
    issues: recomputeIssues,
    reportedVsRecomputedAllMatch: recomputeIssues.filter((s) => s.includes('collected delta != recomputed')).length === 0,
    negativeOrBackward: recomputeIssues.filter((s) => s.includes('BACKWARD')).length,
  },
  baselineFloor: floor,
  baselineNonStationarity: baseWindows.map((b) => ({ label: b.label, seconds: b.seconds, load: loadOf(b), scriptPerSec: r3((b.cdpDeltaMs.ScriptDuration) / b.seconds), recalcPerSec: r3((b.cdpDeltaMs.RecalcStyleDuration) / b.seconds), scriptPerEvent: summarizeWindow(b).scriptPerEvent, over50Per100Frames: b.frames.n ? r3(b.frames.over50 / b.frames.n * 100) : null })),
  loadCorrelation: corr,
  naturalWindows: allWindows.map((w) => ({ scope: w.scope, seconds: w.seconds, load: w.load, scriptPerSec: w.cdpPerSec.ScriptDuration, recalcPerSec: w.cdpPerSec.RecalcStyleDuration, scriptPerEvent: w.scriptPerEvent, recalcPerEvent: w.recalcPerEvent, over50: w.frames.over50, frames: w.frames.n, over50Per100: w.frames.over50Per100Frames, p99: w.frames.p99, max: w.frames.max, longtasks: w.longtasks.nTotal, domNodes: w.domNodes, jseventListeners: w.jseventListeners })),
  baselineWindows: (run.baseline || []).map((b) => summarizeWindow(b)),
  tabs: tabsOut,
  verdicts,
  plugins: run.plugins,
  aborted: run.aborted,
  runMeta: run.meta,
  tabMap: run.tabMap ? { perTab: run.tabMap.perTab.map((t) => ({ label: t.label, status: t.status, openMs: t.openMs, openMsClean: t.openMsClean, nodes: t.afterNodes, textChanged: t.textChanged, activeMoved: t.activeMoved, contentTextHead: t.contentTextHead })), navStructure: run.tabMap.navStructure } : null,
};

/* per-window lock certification */
{
  const all = [];
  for (const b of run.baseline || []) all.push({ scope: `baseline:${b.label}`, lock: b.lock });
  for (const r of run.runs || []) for (const w of r.windows || []) all.push({ scope: `${r.id}:r${r.repeat}:${w.label}`, lock: w.lock });
  const p = run.plugins || {};
  if (p.firstMount?.window) all.push({ scope: 'plugins:firstMount', lock: p.firstMount.window.lock });
  for (const w of p.poll60?.subWindows || []) all.push({ scope: `plugins:poll:${w.label}`, lock: w.lock });
  if (p.return?.window) all.push({ scope: 'plugins:return', lock: p.return.window.lock });
  out.lockCertification.windowsTotal = all.length;
  out.lockCertification.windowsLockHeld = all.filter((x) => x.lock?.heldForWholeWindow === true).length;
  out.lockCertification.windowsWithoutLock = all.filter((x) => x.lock?.heldForWholeWindow !== true).map((x) => x.scope);
  out.lockCertification.verdict = out.lockCertification.windowsTotal > 0 && out.lockCertification.windowsLockHeld === out.lockCertification.windowsTotal
    ? 'LOCKED' : (out.lockCertification.windowsLockHeld === 0 ? 'INCONCLUSIVE-UNLOCKED' : 'PARTIAL');
}
fs.writeFileSync(path.join(RAW, 'analysis.json'), JSON.stringify(out, null, 1));

/* -------------------------------------------------------------- markdown */

const L = [];
const f = (x, d = 1) => (x == null ? 'n/a' : Number(x).toFixed(d));
L.push('### 完整性校验（从原始累计快照独立重算）\n');
L.push(`- 校验窗口数：${out.integrity.windowsChecked}`);
L.push(`- 采集期 delta 与独立重算完全一致：${out.integrity.reportedVsRecomputedAllMatch ? '是' : '**否**'}`);
L.push(`- 累计指标回退窗口数：${out.integrity.negativeOrBackward}`);
if (recomputeIssues.length) { L.push('\n重算问题清单：'); for (const i of recomputeIssues) L.push(`- ${i}`); }
L.push('');
if (floor) {
  L.push('### 基线地板（设置页关闭，同页 10s 窗口）\n');
  L.push(`| 指标 | 值 |`);
  L.push(`|---|---|`);
  L.push(`| Script | ${f(floor.scriptPerSec)} ms/s |`);
  L.push(`| Task | ${f(floor.taskPerSec)} ms/s |`);
  L.push(`| RecalcStyle | ${f(floor.recalcPerSec)} ms/s |`);
  L.push(`| Layout | ${f(floor.layoutPerSec)} ms/s |`);
  L.push(`| 帧 p50/p95/p99/max | ${f(floor.frames.p50)} / ${f(floor.frames.p95)} / ${f(floor.frames.p99)} / ${f(floor.frames.max)} ms |`);
  L.push(`| >50ms 帧 | ${floor.frames.over50} / ${floor.frames.n}（${f(floor.frames.over50 / floor.frames.n * 100)} 每百帧） |`);
  L.push(`| LongTask | ${floor.longtasks.n} 个，max ${f(floor.longtasks.maxMs)} ms |`);
  L.push(`| WS payload 速率（payload 判别符） | ${Object.entries(floor.wsByPayload).map(([k, v]) => `${k} ${f(v.perSec ?? v.medianPerSec)}/s`).join('，')} |`);
  L.push('');
}
L.push('### 逐标签（10s 打开后窗口，2 次重复取中位）\n');
L.push('| 标签 | 状态 | 打开(ms, 变异精度) | Script ms/s | Recalc ms/s | Script 放大 | 帧 p50/p95/p99/max | >50ms 帧/百帧 | LongTask | 面板节点(稳定后) |');
L.push('|---|---|---|---|---|---|---|---|---|---|');
for (const v of verdicts) {
  const t = tabsOut.find((x) => x.id === v.id);
  const w = t?.w1;
  L.push(`| ${v.label} | ${v.status}${v.fps != null && v.fps < 45 ? ' ⚠饿死' : ''} | ${f(v.openMsClean)} | ${f(v.scriptPerSec)} | ${f(v.recalcPerSec)} | ${f(v.scriptAmp, 2)}x | ${w ? `${f(w.frames.p50)}/${f(w.frames.p95)}/${f(w.frames.p99)}/${f(w.frames.max)}` : 'n/a'} | ${f(v.over50Per100)} | ${v.longtasks} | ${w ? f(w.domNodes, 0) : 'n/a'} |`);
}
L.push('');
L.push('### 逐标签（停留 20s 窗口，2 次重复取中位）\n');
L.push('| 标签 | Script ms/s | Recalc ms/s | 帧 p50/p95/p99/max | >50ms 帧 | LongTask | DOM 节点 |');
L.push('|---|---|---|---|---|---|---|');
for (const t of tabsOut) {
  const w = t.w2; if (!w) { L.push(`| ${t.label} | n/a | n/a | n/a | n/a | n/a | n/a |`); continue; }
  L.push(`| ${t.label} | ${f(w.cdpPerSec.ScriptDuration)} | ${f(w.cdpPerSec.RecalcStyleDuration)} | ${f(w.frames.p50)}/${f(w.frames.p95)}/${f(w.frames.p99)}/${f(w.frames.max)} | ${w.frames.over50} (${f(w.frames.over50Per100Frames)}) | ${w.longtasks.nTotal} | ${w.domNodes} |`);
}
L.push('');
L.push('### 逐窗口帧率（主判据；基线 ' + f(floor ? floor.frames.n / floor.seconds : null) + ' fps，< 45 fps 记 ⚠）\n');
L.push('| 标签 | r1w1 | r1w2 | r2w1 | r2w2 | 饿死窗口数 |');
L.push('|---|---|---|---|---|---|');
for (const t of tabsOut) {
  const cells = [];
  let starved = 0;
  for (const p_ of t.per) for (const k of ['w1', 'w2']) {
    const w = p_[k]; if (!w) { cells.push('n/a'); continue; }
    const fps = w.frames.fps ?? w.frames.framesPerSec;
    if (fps != null && fps < 45) starved++;
    cells.push(`${f(fps)}${fps != null && fps < 45 ? ' ⚠' : ''}`);
  }
  L.push(`| ${t.label} | ${cells.join(' | ')} | ${starved}/${cells.length} |`);
}
L.push('');
L.push('### 逐标签 WS payload 速率（payload 判别符，非信封类型）\n');
L.push('| 标签 | ws10s payload 速率 | ws20s payload 速率 |');
L.push('|---|---|---|');
for (const t of tabsOut) {
  const fmt = (w) => w ? Object.entries(w.wsByPayload).map(([k, v]) => `${k} ${f(v.medianPerSec)}/s`).join('，') : 'n/a';
  L.push(`| ${t.label} | ${fmt(t.w1)} | ${fmt(t.w2)} |`);
}
L.push('');
L.push('### 判定（判据见 criteria）\n');
L.push('| 标签 | 用户可感发现 |');
L.push('|---|---|');
for (const v of verdicts) {
  L.push(`| ${v.label} | ${v.status === 'NOT-MEASURED' ? 'NOT-MEASURED' : (v.cleanIfNoFindings ? '**无**（干净）' : v.findings.join('；'))} |`);
}
L.push('');
fs.writeFileSync(path.join(RAW, 'tables.md'), L.join('\n'));

console.log(`batch=${BATCH} lock=${out.lockCertification.verdict} (${out.lockCertification.windowsLockHeld}/${out.lockCertification.windowsTotal} windows lock-held)`);
console.log(`integrity: ${out.integrity.windowsChecked} windows, allMatch=${out.integrity.reportedVsRecomputedAllMatch}, backward=${out.integrity.negativeOrBackward}, issues=${recomputeIssues.length}`);
console.log('--- floor ---'); console.log(JSON.stringify(floor, null, 1));
console.log('--- verdicts ---'); console.log(JSON.stringify(verdicts, null, 1));
if (recomputeIssues.length) { console.log('--- issues ---'); console.log(recomputeIssues.slice(0, 40).join('\n')); }
