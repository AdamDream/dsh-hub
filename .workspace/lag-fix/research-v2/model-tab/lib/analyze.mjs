/*
 * model-tab: independent recomputation + verdicts from raw window records.
 * Reads raw/phase-*.json, recomputes every derived number from the stored CDP
 * cumulative snapshots, and applies pre-declared criteria. Writes analysis.json.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/model-tab';
const RAW = path.join(ROOT, 'raw');
const files = fs.readdirSync(RAW).filter((f) => /^phase-.*\.json$/.test(f) && (process.env.SMOKE ? true : !/smoke/.test(f)));
const tagFilter = process.argv[2];
const chosen = tagFilter ? files.filter((f) => f.includes(tagFilter)) : files;
if (!chosen.length) { console.error('no phase files', files); process.exit(1); }

const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pearson = (xs, ys) => {
  const n = xs.length; if (n < 3) return null;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
};

const windows = [];
const integrity = { windows: 0, cdpBackward: [], reportedVsRecomputedMismatch: [], issues: [] };
for (const f of chosen) {
  const j = JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
  for (const r of j.runs || []) {
    integrity.windows++;
    const m0 = r.cdpRawStart, m1 = r.cdpRawEnd;
    const rec = (k) => r3(m1[k] - m0[k]);
    /* Nodes is a live gauge, not a cumulative counter: it legitimately falls. */
    const mismatch = ['ScriptDuration', 'TaskDuration', 'RecalcStyleDuration', 'LayoutDuration']
      .filter((k) => rec(k) < 0);
    if (mismatch.length) integrity.cdpBackward.push({ file: f, id: r.id, keys: mismatch });
    const secs = r.durationMs / 1000;
    const wsEvent = r.ws.byType['session/event'] || 0;
    const wsProj = r.ws.byType['session/projection'] || 0;
    const w = {
      file: f, id: r.id, cycle: r.cycle, seqIndex: r.seqIndex, tab: r.tab, muted: r.muted,
      t0: r.t0, t1: r.t1, durationMs: r.durationMs, wallMs: r.wallMs,
      cdp: {
        scriptMs: rec('ScriptDuration'), taskMs: rec('TaskDuration'), recalcMs: rec('RecalcStyleDuration'), layoutMs: rec('LayoutDuration'),
        scriptPerSec: r3(rec('ScriptDuration') / secs), taskPerSec: r3(rec('TaskDuration') / secs),
        recalcPerSec: r3(rec('RecalcStyleDuration') / secs), layoutPerSec: r3(rec('LayoutDuration') / secs),
        nodesDelta: rec('Nodes'), jsHeapDeltaMB: r3((m1.JSHeapUsedSize - m0.JSHeapUsedSize) / 1048576),
      },
      fps: r.fps, frames: r.frames,
      frameGap: r.frameGap, over50Per100: r.over50Per100,
      longtasks: { n: r.longtasks.n, max: r.longtasks.max, sum: r.longtasks.sum },
      ws: { event: wsEvent, eventPerSec: r3(wsEvent / secs), projection: wsProj, projectionPerSec: r3(wsProj / secs), delivered: r.ws.delivered, dropped: r.ws.dropped, bytesPerSec: Math.round(r.ws.bytes / secs), byType: r.ws.byType, sub: r.ws.sub, muted: r.ws.muted },
      http: { total: r.http.total, byMethod: r.http.byMethod }, xhr: r.xhr.total,
      timers: r.timers,
      mutations: r.mutations,
      react: {
        commits: r.react.commitsInWindow, commitsPerSec: r3(r.react.commitsInWindow / secs),
        commitsInPanel: r.react.commitsInPanelInWindow,
        fibersPanel: r.react.fibersPanelInWindow, fibersAll: r.react.fibersAllInWindow,
        fibersPerCommitAll: r.react.commitsInWindow ? r3(r.react.fibersAllInWindow / r.react.commitsInWindow) : null,
        fibersPerCommitPanel: r.react.commitsInPanelInWindow ? r3(r.react.fibersPanelInWindow / r.react.commitsInPanelInWindow) : null,
        fibersPanelPerSec: r3(r.react.fibersPanelInWindow / secs), fibersAllPerSec: r3(r.react.fibersAllInWindow / secs),
        walkMsPerSec: r3(r.react.walkMsInWindow / secs),
        setterCalls: r.react.setterCallsInWindow, setterSites: r.react.setterSites,
        ownersPanel: r.react.ownersPanel, ownersAll: r.react.ownersAll, tagsPanel: r.react.tagsPanel,
        panelSetSize: r.react.panelSetSize, unmounts: r.react.unmounts, postCommit: r.react.postCommit, rootCommits: r.react.rootCommits,
        commitDurSample: (r.react.commitLog || []).slice(0, 200).map((c) => c.dur),
      },
      dom: r.dom, panelRows: r.panel.rows, panelTextLen: r.panel.textLen, panelHead: (r.panel.head || '').slice(0, 90),
      load: {
        browsersPre: r.externalLoad.concurrentBrowserLaunchers, browsersPost: r.externalLoad.concurrentBrowserLaunchersPost,
        cpuBusyDelta: r.externalLoad.cpuBusyDelta, browserJiffiesDelta: r.externalLoad.browserJiffiesDelta,
        loadSeries: (r.externalLoad.loadSeries || []).map((x) => ({ t: x.t, load1: x.load1, browsers: x.browsers })),
        load1Pre: r.externalLoad.pre.load ? r.externalLoad.pre.load.load1 : null,
        load1Post: r.externalLoad.post.load ? r.externalLoad.post.load.load1 : null,
        siblingNodeProcs: r.externalLoad.siblingNodeProcs,
      },
      errors: r.errors.length,
    };
    windows.push(w);
  }
}

/* ------------------------------------------------------------ aggregates */
const byId = {};
for (const w of windows) (byId[w.id] = byId[w.id] || []).push(w);

const sum = (a, k) => { const v = a.map(k).filter((x) => x != null); return v.length ? mean(v) : null; };

const agg = {};
for (const [id, ws] of Object.entries(byId)) {
  agg[id] = {
    n: ws.length, tab: ws[0].tab,
    fps: r3(sum(ws, (w) => w.fps)),
    fpsList: ws.map((w) => w.fps),
    framesMean: r3(sum(ws, (w) => w.frames)),
    frameP50: r3(median(ws.map((w) => w.frameGap.p50))), frameP95: r3(median(ws.map((w) => w.frameGap.p95))), frameP99: r3(median(ws.map((w) => w.frameGap.p99))),
    frameMax: Math.max(...ws.map((w) => w.frameGap.max)),
    over50Per100: r3(sum(ws, (w) => w.over50Per100)),
    scriptPerSec: r3(sum(ws, (w) => w.cdp.scriptPerSec)), taskPerSec: r3(sum(ws, (w) => w.cdp.taskPerSec)),
    recalcPerSec: r3(sum(ws, (w) => w.cdp.recalcPerSec)), layoutPerSec: r3(sum(ws, (w) => w.cdp.layoutPerSec)),
    longtasksN: r3(sum(ws, (w) => w.longtasks.n)), longtaskMax: Math.max(...ws.map((w) => w.longtasks.max)),
    eventPerSec: r3(sum(ws, (w) => w.ws.eventPerSec)), projectionPerSec: r3(sum(ws, (w) => w.ws.projectionPerSec)),
    wsBytesPerSec: r3(sum(ws, (w) => w.ws.bytesPerSec)),
    commits: r3(sum(ws, (w) => w.react.commits)), commitsInPanel: r3(sum(ws, (w) => w.react.commitsInPanel)),
    fibersAll: r3(sum(ws, (w) => w.react.fibersAll)), fibersPanel: r3(sum(ws, (w) => w.react.fibersPanel)),
    fibersPerCommitAll: r3(sum(ws, (w) => w.react.fibersPerCommitAll)),
    domNodes: r3(median(ws.map((w) => w.dom.totalNodes))),
    panelNodes: r3(median(ws.map((w) => w.dom.panelNodes))),
    panelRows: ws[0].panelRows,
    httpTotal: r3(sum(ws, (w) => w.http.total)),
    panelTextLen: r3(median(ws.map((w) => w.panelTextLen))),
    load1Mean: r3(sum(ws, (w) => w.load.load1Pre)),
    browsersMean: r3(sum(ws, (w) => w.load.browsersPre)),
  };
}

/* --------------------------------------------------- pairwise contrasts */
const pair = (aId, bId, label) => {
  const A = agg[aId], B = agg[bId];
  if (!A || !B) return null;
  const rel = (x, y) => (x != null && y ? r3((x - y) / y) : null);
  return {
    label, a: aId, b: bId,
    fpsDelta: r3(A.fps - B.fps), fpsRatio: B.fps ? r3(A.fps / B.fps) : null,
    scriptPerSecDelta: r3(A.scriptPerSec - B.scriptPerSec), scriptRatio: B.scriptPerSec ? r3(A.scriptPerSec / B.scriptPerSec) : null,
    taskPerSecDelta: r3(A.taskPerSec - B.taskPerSec),
    recalcPerSecDelta: r3(A.recalcPerSec - B.recalcPerSec),
    layoutPerSecDelta: r3(A.layoutPerSec - B.layoutPerSec),
    over50Delta: r3(A.over50Per100 - B.over50Per100),
    frameP50Delta: r3(A.frameP50 - B.frameP50), frameP95Delta: r3(A.frameP95 - B.frameP95), frameP99Delta: r3(A.frameP99 - B.frameP99),
    longtaskDelta: r3(A.longtasksN - B.longtasksN),
    domNodesDelta: r3(A.domNodes - B.domNodes), panelNodesDelta: r3(A.panelNodes - B.panelNodes),
    commitsDelta: r3(A.commits - B.commits), commitsInPanelDelta: r3(A.commitsInPanel - B.commitsInPanel),
    fibersAllDelta: r3(A.fibersAll - B.fibersAll), fibersPanelDelta: r3(A.fibersPanel - B.fibersPanel),
    fibersPerCommitAllDelta: r3((A.fibersPerCommitAll || 0) - (B.fibersPerCommitAll || 0)),
    eventPerSecDelta: r3(A.eventPerSec - B.eventPerSec),
  };
};

const contrasts = {
  'models-natural vs general-natural (same ambient load, adjacent windows)': pair('models-natural', 'general-natural'),
  'models-allmute vs general-allmute (both muted, adjacent windows)': pair('models-allmute', 'general-allmute'),
  'models-natural vs models-allmute (churn switched OFF, same tab)': pair('models-natural', 'models-allmute'),
  'general-natural vs general-allmute (churn switched OFF, control tab)': pair('general-natural', 'general-allmute'),
};

/* ------------------------------------------------------------ correlations */
const valid = windows.filter((w) => w.durationMs > 5000);
const corr = {
  fps_vs_eventPerSec: r3(pearson(valid.map((w) => w.ws.eventPerSec), valid.map((w) => w.fps))),
  script_vs_eventPerSec: r3(pearson(valid.map((w) => w.ws.eventPerSec), valid.map((w) => w.cdp.scriptPerSec))),
  fps_vs_commits: r3(pearson(valid.map((w) => w.react.commits), valid.map((w) => w.fps))),
  fps_vs_fibersAll: r3(pearson(valid.map((w) => w.react.fibersAll), valid.map((w) => w.fps))),
  fps_vs_load1: r3(pearson(valid.map((w) => w.load.load1Pre ?? 0), valid.map((w) => w.fps))),
  framesPerSec_vs_wallClock: r3(pearson(valid.map((w) => w.durationMs), valid.map((w) => w.frames))),
};
const corrTab = {};
for (const [id, ws] of Object.entries(byId)) {
  const v = ws.filter((w) => w.durationMs > 5000);
  corrTab[id] = {
    n: v.length,
    fps_vs_eventPerSec: r3(pearson(v.map((w) => w.ws.eventPerSec), v.map((w) => w.fps))),
    script_vs_eventPerSec: r3(pearson(v.map((w) => w.ws.eventPerSec), v.map((w) => w.cdp.scriptPerSec))),
    fps_vs_fibersAll: r3(pearson(v.map((w) => w.react.fibersAll), v.map((w) => w.fps))),
  };
}

/* ------------------------------------------------------------- verdicts */
const V = [];
const push = (id, claim, verdict, evidence, caveat) => V.push({ claim, verdict, evidence, caveat: caveat || null });

const mn = agg['models-natural'], ma = agg['models-allmute'], gn = agg['general-natural'], ga = agg['general-allmute'];
if (mn && ma) {
  const churnScript = r3(mn.scriptPerSec - ma.scriptPerSec);
  push('Q1', 'On 模型, how much of the measured cost disappears when the event stream is switched off?',
    churnScript > 0 ? 'churn-attributable portion measured' : 'no churn-attributable portion detected',
    { modelsNaturalScriptPerSec: mn.scriptPerSec, modelsAllmuteScriptPerSec: ma.scriptPerSec, deltaMsPerSec: churnScript, fpsNatural: mn.fps, fpsAllmute: ma.fps, commitsNatural: mn.commits, commitsAllmute: ma.commits });
}
push('Q2', 'Does the 模型 panel subtree itself re-render during a high-rate window?',
  mn && mn.fibersPanel === 0 ? 'NO — zero panel-local fiber renders' : 'panel-local renders observed',
  { modelsFibersPanelInWindow: mn ? mn.fibersPanel : null, modelsFibersAllInWindow: mn ? mn.fibersAll : null, modelsCommitsInPanel: mn ? mn.commitsInPanel : null, panelSetSize: null });
push('Q3', 'Is the 模型 tab intrinsically slower than 通用设置 at equal churn?',
  'see contrasts', contrasts['models-natural vs general-natural (same ambient load, adjacent windows)']);

fs.writeFileSync(path.join(RAW, 'analysis.json'), JSON.stringify({ generatedAt: new Date().toISOString(), files: chosen, integrity, windowCount: windows.length, aggregates: agg, contrasts, correlations: corr, correlationsByScenario: corrTab, verdictSeeds: V, windows }, null, 1));

/* --------------------------------------------------------------- console */
const pad = (s, n) => String(s ?? '').padEnd(n);
console.log('files:', chosen.join(', '), '| windows:', windows.length);
console.log('integrity:', JSON.stringify(integrity));
console.log('\nPER-WINDOW');
console.log(pad('id', 17) + pad('cyc', 4) + pad('fps', 7) + pad('frames', 8) + pad('p50', 7) + pad('p95', 8) + pad('>50/100', 9) + pad('LT', 4) + pad('script/s', 9) + pad('recalc/s', 9) + pad('task/s', 9) + pad('ev/s', 8) + pad('proj/s', 8) + pad('commits', 8) + pad('cPanel', 7) + pad('fibAll', 8) + pad('fibPanel', 9) + pad('nodes', 6));
for (const w of windows) {
  console.log(pad(w.id, 17) + pad(w.cycle, 4) + pad(w.fps, 7) + pad(w.frames, 8) + pad(w.frameGap.p50, 7) + pad(w.frameGap.p95, 8) + pad(w.over50Per100, 9) + pad(w.longtasks.n, 4) + pad(w.cdp.scriptPerSec, 9) + pad(w.cdp.recalcPerSec, 9) + pad(w.cdp.taskPerSec, 9) + pad(w.ws.eventPerSec, 8) + pad(w.ws.projectionPerSec, 8) + pad(w.react.commits, 8) + pad(w.react.commitsInPanel, 7) + pad(w.react.fibersAll, 8) + pad(w.react.fibersPanel, 9) + pad(w.dom.totalNodes, 6));
}
console.log('\nAGGREGATES (mean over windows, p-values are medians)');
for (const [id, a] of Object.entries(agg)) console.log(pad(id, 17), JSON.stringify(a));
console.log('\nCONTRASTS');
for (const [k, v] of Object.entries(contrasts)) console.log('--', k, '\n   ', JSON.stringify(v));
console.log('\nCORRELATIONS (all windows)', JSON.stringify(corr));
console.log('CORRELATIONS (per scenario)', JSON.stringify(corrTab));
