#!/usr/bin/env node
/*
 * analyze.mjs — turn the raw per-phase records into the comparison table, the
 * H1..H6 hypothesis tests, and the control verification.
 *
 * PRE-REGISTERED before looking at any measured panel data:
 *   E (user-labelled expensive) = { 通用设置, 插件 }
 *   C (user-labelled cheap)     = every other registered settings section
 *   Positive control passes iff the injected ~120 ms block shows up as a
 *     LongTask with duration >= 90 ms AND frameMax >= 90 ms.
 *   Negative evidence for a "cheap" panel = 0 longtasks AND frameP95 <= 20 ms,
 *     accepted ONLY if the positive control passed in the same rep (channel
 *     proven live), otherwise the panel is INCONCLUSIVE, not "smooth".
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/why-these-two';
const RAW = path.join(DIR, 'raw');
const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const GLOB = argOf('--glob', '');

const EXPENSIVE = new Set(['通用设置', '插件']);
const med = (a) => { const s = a.filter((x) => x != null && !Number.isNaN(x)).sort((x, y) => x - y); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 1000) / 1000; };
const max = (a) => { const s = a.filter((x) => x != null && !Number.isNaN(x)); return s.length ? Math.max(...s) : null; };
const sum = (a) => a.filter((x) => x != null && !Number.isNaN(x)).reduce((p, c) => p + c, 0);
const uniqSorted = (a) => [...new Set(a.filter(Boolean))].sort();

// ---------------------------------------------------------------- load
const SEL = GLOB ? GLOB.split(',').map((x) => x.trim()) : null;
const files = fs.readdirSync(RAW).filter((f) => f.startsWith('panel-') && f.endsWith('.json') && (!SEL || SEL.some((s) => f.includes(s))));
const runs = files.map((f) => ({ file: f, data: JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8')) }));
if (!runs.length) { console.error('no raw files matched'); process.exit(2); }

// ---------------------------------------------------- label -> panel mapping
function classify(run, label) {
  if (label === 'IDLE_BASE') return { panel: 'IDLE (settings closed)', kind: 'idle', panelKey: 'idle' };
  if (label === 'OPEN') return { panel: 'OPEN (click Settings)', kind: 'open', panelKey: 'open' };
  if (label === 'CLOSE') return { panel: 'CLOSE (click close)', kind: 'close', panelKey: 'close' };
  if (label.startsWith('POSCTL')) return { panel: label, kind: 'posctl', panelKey: 'posctl' };
  let mf = /^FOCUS_(NORMAL|ABLATED)_(open|navPlugins|tabList|scrollList|navGeneral|scrollGeneral|close)$/.exec(label);
  if (mf) return { panel: `FOCUS ${mf[1]} / ${mf[2]}`, kind: 'focus', arm: mf[1], step: mf[2], panelKey: `focus:${mf[1]}:${mf[2]}` };
  if (label === 'SEC_1_first_view') return { panel: run.activeAtOpen || '通用设置', kind: 'view', panelKey: 'first', first: true };
  if (label === 'SCROLL_first') return { panel: run.activeAtOpen || '通用设置', kind: 'scroll', panelKey: 'first' };
  if (label === 'SEC_back_first') return { panel: run.activeAtOpen || '通用设置', kind: 'switch-back', panelKey: 'back_first' };
  if (label === 'SEC_plugins_REVISIT') return { panel: '插件', kind: 'revisit', panelKey: 'plugins_revisit' };
  if (label === 'TAB_plugins_REVISIT_list') return { panel: '插件 / 插件列表', kind: 'revisit-tab', panelKey: 'plugins_list_revisit' };
  let m = /^TAB_(S\d+)_(.+?)::tab:(.+?)(_active)?$/.exec(label);
  if (m) return { panel: `${m[2]} / ${m[3]}`, kind: m[4] ? 'tab-active' : 'tab', section: m[2], tab: m[3], panelKey: `tab:${m[2]}:${m[3]}` };
  m = /^SCROLL_tab_(S\d+)_(.+?)::tab:(.+)$/.exec(label);
  if (m) return { panel: `${m[2]} / ${m[3]}`, kind: 'tab-scroll', section: m[2], tab: m[3], panelKey: `tab:${m[2]}:${m[3]}` };
  m = /^SEC_(S\d+)_(.+)$/.exec(label);
  if (m) return { panel: m[2], kind: 'view', sectionKey: m[1], panelKey: `sec:${m[2]}` };
  m = /^SCROLL_(S\d+)_(.+)$/.exec(label);
  if (m) return { panel: m[2], kind: 'scroll', sectionKey: m[1], panelKey: `sec:${m[2]}` };
  return { panel: label, kind: 'other', panelKey: label };
}
function censusKeyFor(label) {
  if (label === 'IDLE_BASE') return 'idleBase';
  if (label === 'OPEN') return 'afterOpen';
  if (label === 'CLOSE') return 'afterClose';
  if (label === 'SEC_1_first_view') return 'sec_1_first';
  if (label === 'SEC_back_first') return 'sec_back_first';
  if (label === 'SEC_plugins_REVISIT') return 'sec_plugins_REVISIT';
  if (label === 'TAB_plugins_REVISIT_list') return 'tab_S3_插件::tab:插件列表';
  let m = /^TAB_(S\d+)_(.+?)::tab:(.+?)(_active)?$/.exec(label);
  if (m) return `tab_${m[1]}_${m[2]}::tab:${m[3]}`;
  m = /^SEC_(S\d+)_(.+)$/.exec(label);
  if (m) return `sec_${m[1]}_${m[2]}`;
  return null;
}

// ------------------------------------------------------------------ flatten
const phases = [];
for (const { file, data } of runs) {
  for (const rep of data.reps || []) {
    const runCtx = { activeAtOpen: rep.activeAtOpen, label: `${data.run}/${data.order}/${data.browser}@${data.viewport.join('x')}dpr${data.dsf}#rep${rep.rep}` };
    const cens = rep.censuses || {};
    for (const ph of rep.phases || []) {
      const cls = classify(runCtx, ph.label);
      const cKey = censusKeyFor(ph.label);
      const census = cKey && cens[cKey] ? cens[cKey] : null;
      phases.push({
        file, run: data.run, order: data.order, browser: data.browser, viewport: data.viewport, dsf: data.dsf,
        rep: rep.rep, label: ph.label, ...cls,
        c2f: ph.clickToFirstChangeMs, c2s: ph.clickToSettledMs,
        frameP50: ph.frameP50, frameP95: ph.frameP95, frameP99: ph.frameP99, frameMax: ph.frameMax,
        framesGt50: ph.framesGt50, framesGt33: ph.framesGt33, nFrames: ph.nFrames,
        ltCount: ph.longtaskCount, ltTotal: ph.longtaskTotal, ltMax: ph.longtaskMax,
        loafCount: ph.loafCount, loafMax: ph.loafMax, loafBlockingMax: ph.loafBlockingMax,
        commits: ph.commits, unmounts: ph.unmounts, muts: ph.muts, performedWork: ph.performedWork,
        scriptMs: ph.cdpDelta ? Math.round(ph.cdpDelta.ScriptDuration * 1000 * 100) / 100 : null,
        taskMs: ph.cdpDelta ? Math.round(ph.cdpDelta.TaskDuration * 1000 * 100) / 100 : null,
        styleMs: ph.cdpDelta ? Math.round(ph.cdpDelta.RecalcStyleDuration * 1000 * 100) / 100 : null,
        layoutMs: ph.cdpDelta ? Math.round(ph.cdpDelta.LayoutDuration * 1000 * 100) / 100 : null,
        styleCount: ph.cdpDelta ? ph.cdpDelta.RecalcStyleCount : null,
        layoutCount: ph.cdpDelta ? ph.cdpDelta.LayoutCount : null,
        nodesDelta: ph.cdpDelta ? ph.cdpDelta.Nodes : null,
        rpcs: (ph.netRpcs || []).map((r) => r.rpcMethod).filter(Boolean),
        rpcDur: sum((ph.netRpcs || []).map((r) => r.durMs)),
        traceOk: ph.trace && !ph.trace.unavailable,
        paintMs: ph.trace ? ph.trace.paintMs : null, rasterMs: ph.trace ? ph.trace.rasterMs : null,
        compositeMs: ph.trace ? ph.trace.compositeMs : null, ultMs: ph.trace ? ph.trace.updateLayerTreeMs : null,
        traceLayoutMs: ph.trace ? ph.trace.layoutMs : null, traceStyleMs: ph.trace ? ph.trace.recalcStyleMs : null,
        decodeMs: ph.trace ? ph.trace.decodeMs : null, gpuMs: ph.trace ? ph.trace.gpuMs : null,
        functionCallMs: ph.trace ? ph.trace.functionCallMs : null, mainThreadMs: ph.trace ? ph.trace.mainThreadMs : null,
        traceWindowMs: ph.trace ? ph.trace.windowMs : null,
        presentationMs: ph.trace ? Math.round(((ph.trace.paintMs || 0) + (ph.trace.rasterMs || 0) + (ph.trace.compositeMs || 0) + (ph.trace.updateLayerTreeMs || 0)) * 100) / 100 : null,
        census: census ? {
          domNodes: census.doc.domNodes, svg: census.doc.svg, docSvg: census.doc.svg,
          optNodes: census.options ? census.options.domNodes : null,
          optSvg: census.options ? census.options.svg : null,
          optSvgDeep: census.options ? census.options.svgDeepEls : null,
          optText: census.options ? census.options.textNodes : null,
          cards: census.counts ? census.counts.pluginCards : null,
          activeNav: census.counts ? census.counts.activeNavLabel : null,
          activeTab: census.counts ? census.counts.activeTab : null,
        } : null,
        scrollInfo: ph.scrollInfo || null,
        raw: { frameSeries: ph.frameSeries, longtasks: ph.longtasks, loafScripts: ph.loafScripts, byName: ph.trace ? ph.trace.byName : null },
      });
    }
  }
}

// -------------------------------------------------------------- aggregation
const byKey = new Map();
for (const p of phases) {
  if (!byKey.has(p.panelKey)) byKey.set(p.panelKey, []);
  byKey.get(p.panelKey).push(p);
}
const agg = [];
for (const [key, list] of byKey) {
  const views = list.filter((p) => p.kind === 'view' || p.kind === 'tab' || p.kind === 'tab-active' || p.kind === 'open' || p.kind === 'close' || p.kind === 'focus' || p.kind === 'revisit' || p.kind === 'revisit-tab' || p.kind === 'switch-back' || p.kind === 'idle');
  const scrolls = list.filter((p) => p.kind === 'scroll' || p.kind === 'tab-scroll');
  const a = {
    panelKey: key, panel: list[0].panel, kind: list[0].kind,
    nView: views.length, nScroll: scrolls.length,
    isExpensiveLabelled: EXPENSIVE.has(list[0].panel) || /插件/.test(list[0].panel),
    // interaction (click) arms
    c2fMed: med(views.map((p) => p.c2f)),
    frameP95Med: med(views.map((p) => p.frameP95)), frameMaxMed: med(views.map((p) => p.frameMax)),
    framesGt50Sum: sum(views.map((p) => p.framesGt50)), framesGt50Max: max(views.map((p) => p.framesGt50)),
    ltCountSum: sum(views.map((p) => p.ltCount)), ltMax: max(views.map((p) => p.ltMax)),
    commitsMed: med(views.map((p) => p.commits)), unmountsMed: med(views.map((p) => p.unmounts)),
    performedWorkMed: med(views.map((p) => p.performedWork)), mutsMed: med(views.map((p) => p.muts)),
    scriptMsMed: med(views.map((p) => p.scriptMs)), taskMsMed: med(views.map((p) => p.taskMs)),
    styleMsMed: med(views.map((p) => p.styleMs)), layoutMsMed: med(views.map((p) => p.layoutMs)),
    styleCountMed: med(views.map((p) => p.styleCount)), nodesDeltaMed: med(views.map((p) => p.nodesDelta)),
    paintMsMed: med(views.map((p) => p.paintMs)), rasterMsMed: med(views.map((p) => p.rasterMs)),
    compositeMsMed: med(views.map((p) => p.compositeMs)), ultMsMed: med(views.map((p) => p.ultMs)),
    presentationMsMed: med(views.map((p) => p.presentationMs)),
    traceOkShare: views.length ? views.filter((p) => p.traceOk).length / views.length : null,
    rpcs: uniqSorted(views.flatMap((p) => p.rpcs)), rpcDurMed: med(views.map((p) => p.rpcDur)),
    // scroll arms
    scrollFrameP95Med: med(scrolls.map((p) => p.frameP95)), scrollFrameMaxMed: med(scrolls.map((p) => p.frameMax)),
    scrollFramesGt50Sum: sum(scrolls.map((p) => p.framesGt50)), scrollLtSum: sum(scrolls.map((p) => p.ltCount)),
    scrollRasterMsMed: med(scrolls.map((p) => p.rasterMs)), scrollPaintMsMed: med(scrolls.map((p) => p.paintMs)),
    scrollCompositeMsMed: med(scrolls.map((p) => p.compositeMs)),
    scrollPresentationMsMed: med(scrolls.map((p) => p.presentationMs)),
    scrollTaskMsMed: med(scrolls.map((p) => p.taskMs)), scrollScriptMsMed: med(scrolls.map((p) => p.scriptMs)),
    scrollPerformedWorkMed: med(scrolls.map((p) => p.performedWork)),
    scrollMaxScroll: max(scrolls.map((p) => (p.scrollInfo ? p.scrollInfo.maxScroll : null))),
    // scale predictors (last census of that panel)
    domNodesMed: med(views.map((p) => (p.census ? p.census.domNodes : null))),
    optNodesMed: med(views.map((p) => (p.census ? p.census.optNodes : null))),
    optSvgMed: med(views.map((p) => (p.census ? p.census.optSvg : null))),
    optSvgDeepMed: med(views.map((p) => (p.census ? p.census.optSvgDeep : null))),
    optTextMed: med(views.map((p) => (p.census ? p.census.optText : null))),
    cardsMed: med(views.map((p) => (p.census ? p.census.cards : null))),
  };
  agg.push(a);
}
agg.sort((x, y) => (y.presentationMsMed || 0) - (x.presentationMsMed || 0));

// --------------------------------------------------------------- H-testing
const sectionPanels = agg.filter((a) => a.panelKey.startsWith('sec:') || a.panelKey === 'first' || a.panelKey === 'back_first' || a.panelKey === 'plugins_revisit');
const tabPanels = agg.filter((a) => a.panelKey.startsWith('tab:'));

function splitByLabel(list) {
  const E = list.filter((a) => a.isExpensiveLabelled);
  const C = list.filter((a) => !a.isExpensiveLabelled);
  return { E, C };
}
function metricSplit(list, field) {
  const { E, C } = splitByLabel(list);
  return {
    expensive: { n: E.length, med: med(E.map((a) => a[field])), values: E.map((a) => ({ panel: a.panel, v: a[field] })) },
    cheap: { n: C.length, med: med(C.map((a) => a[field])), values: C.map((a) => ({ panel: a.panel, v: a[field] })) },
    ratio: (med(E.map((a) => a[field])) && med(C.map((a) => a[field]))) ? Math.round((med(E.map((a) => a[field])) / med(C.map((a) => a[field]))) * 100) / 100 : null,
  };
}
const METRICS = ['c2fMed', 'frameP95Med', 'frameMaxMed', 'ltMax', 'scriptMsMed', 'taskMsMed', 'styleMsMed', 'styleCountMed',
                 'paintMsMed', 'rasterMsMed', 'compositeMsMed', 'ultMsMed', 'presentationMsMed', 'performedWorkMed',
                 'unmountsMed', 'optNodesMed', 'optSvgMed', 'optTextMed', 'cardsMed', 'nodesDeltaMed'];
const splitTable = {};
for (const f of METRICS) splitTable[f] = metricSplit(sectionPanels, f);
const scrollSplitTable = {};
for (const f of ['scrollFrameP95Med', 'scrollFrameMaxMed', 'scrollRasterMsMed', 'scrollPaintMsMed', 'scrollCompositeMsMed', 'scrollPresentationMsMed', 'scrollTaskMsMed', 'scrollScriptMsMed', 'scrollPerformedWorkMed', 'scrollMaxScroll']) {
  scrollSplitTable[f] = metricSplit(sectionPanels, f);
}

// spearman rank correlation between a predictor and a cost metric across sections
function rank(arr) { const idx = arr.map((v, i) => [v, i]).filter(([v]) => v != null); idx.sort((a, b) => a[0] - b[0]); const r = new Array(arr.length).fill(null); idx.forEach(([, i], k) => { r[i] = k + 1; }); return r; }
function spearman(xs, ys) {
  const pairs = xs.map((x, i) => [x, ys[i]]).filter(([a, b]) => a != null && b != null);
  if (pairs.length < 3) return null;
  const X = rank(pairs.map((p) => p[0])), Y = rank(pairs.map((p) => p[1]));
  const n = X.length, mx = (n + 1) / 2, my = (n + 1) / 2;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (X[i] - mx) * (Y[i] - my); dx += (X[i] - mx) ** 2; dy += (Y[i] - my) ** 2; }
  return dx && dy ? Math.round((num / Math.sqrt(dx * dy)) * 1000) / 1000 : null;
}
const COSTS = ['presentationMsMed', 'frameMaxMed', 'framesGt50Sum', 'c2fMed', 'scriptMsMed', 'taskMsMed', 'styleCountMed'];
const PREDICTORS = ['optNodesMed', 'optSvgMed', 'optSvgDeepMed', 'optTextMed', 'cardsMed', 'domNodesMed', 'unmountsMed', 'performedWorkMed', 'nodesDeltaMed', 'ltMax'];
const correlations = {};
for (const c of COSTS) { correlations[c] = {}; for (const p of PREDICTORS) correlations[c][p] = spearman(sectionPanels.map((a) => a[p]), sectionPanels.map((a) => a[c])); }

// ------------------------------------------------------------- controls
const controls = [];
for (const { file, data } of runs) {
  for (const rep of data.reps || []) {
    const get = (l) => (rep.phases || []).find((p) => p.label === l);
    const pre = get('POSCTL_pre'), pos = get('POSCTL_120'), posIn = get('POSCTL_120_inpanel');
    const idle = get('IDLE_BASE');
    controls.push({
      run: data.run, rep: rep.rep,
      posctl: pos ? { ltCount: pos.longtaskCount, ltMax: pos.longtaskMax, frameMax: pos.frameMax, ltTotal: pos.longtaskTotal, pass: (pos.longtaskMax >= 90 || pos.frameMax >= 90) } : null,
      posctlInPanel: posIn ? { ltCount: posIn.longtaskCount, ltMax: posIn.longtaskMax, frameMax: posIn.frameMax, pass: (posIn.longtaskMax >= 90 || posIn.frameMax >= 90) } : null,
      posctlPre: pre ? { ltCount: pre.longtaskCount, frameMax: pre.frameMax } : null,
      idle: idle ? { ltCount: idle.longtaskCount, frameP95: idle.frameP95, frameMax: idle.frameMax, framesGt50: idle.framesGt50, commits: idle.commits, performedWork: idle.performedWork } : null,
    });
  }
}

// ------------------------------------------------- ablation pairing (H6 manipulation check)
const ablation = {};
for (const { data } of runs) {
  if (!data.ablate || data.ablate === 'none') continue;
  for (const rep of data.reps || []) {
    for (const step of ['open', 'navPlugins', 'tabList', 'scrollList', 'navGeneral', 'scrollGeneral', 'close']) {
      const n = (rep.phases || []).find((p) => p.label === `FOCUS_NORMAL_${step}`);
      const n2 = (rep.phases || []).find((p) => p.label === `FOCUS_NORMAL2_${step}`);
      const a = (rep.phases || []).find((p) => p.label === `FOCUS_ABLATED_${step}`);
      if (!n && !a) continue;
      const ppt = (p) => (p && p.trace && !p.trace.unavailable) ? Math.round(((p.trace.paintMs || 0) + (p.trace.rasterMs || 0) + (p.trace.compositeMs || 0) + (p.trace.updateLayerTreeMs || 0)) * 100) / 100 : null;
      (ablation[step] = ablation[step] || []).push({
        run: data.run, viewport: data.viewport, ablate: data.ablate, rep: rep.rep,
        normal: n ? { c2f: n.clickToFirstChangeMs, frameMax: n.frameMax, frameP95: n.frameP95, presentation: ppt(n), taskMs: n.cdpDelta ? n.cdpDelta.TaskDuration * 1000 : null, styleCount: n.cdpDelta ? n.cdpDelta.RecalcStyleCount : null, muts: n.muts, unmounts: n.unmounts } : null,
        ablated: a ? { c2f: a.clickToFirstChangeMs, frameMax: a.frameMax, frameP95: a.frameP95, presentation: ppt(a), taskMs: a.cdpDelta ? a.cdpDelta.TaskDuration * 1000 : null, styleCount: a.cdpDelta ? a.cdpDelta.RecalcStyleCount : null, muts: a.muts, unmounts: a.unmounts } : null,
        scrollNormal: n && n.scrollInfo ? { moved: n.scrollInfo.moved, max: n.scrollInfo.scrollTopMax } : null,
        scrollAblated: a && a.scrollInfo ? { moved: a.scrollInfo.moved, max: a.scrollInfo.scrollTopMax } : null,
        normal2: n2 ? { c2f: n2.clickToFirstChangeMs, frameMax: n2.frameMax, frameP95: n2.frameP95, presentation: ppt(n2), taskMs: n2.cdpDelta ? n2.cdpDelta.TaskDuration * 1000 : null } : null,
      });
    }
  }
}
const ablationSummary = {};
for (const [step, list] of Object.entries(ablation)) {
  ablationSummary[step] = {
    n: list.length,
    normalPresentationMed: med(list.map((x) => x.normal && x.normal.presentation)),
    ablatedPresentationMed: med(list.map((x) => x.ablated && x.ablated.presentation)),
    normalFrameMaxMax: max(list.map((x) => x.normal && x.normal.frameMax)),
    ablatedFrameMaxMax: max(list.map((x) => x.ablated && x.ablated.frameMax)),
    normalTaskMed: med(list.map((x) => x.normal && x.normal.taskMs)),
    ablatedTaskMed: med(list.map((x) => x.ablated && x.ablated.taskMs)),
    normal2PresentationMed: med(list.map((x) => x.normal2 && x.normal2.presentation)),
    normal2FrameMaxMax: max(list.map((x) => x.normal2 && x.normal2.frameMax)),
    normalStyleCountMed: med(list.map((x) => x.normal && x.normal.styleCount)),
    ablatedStyleCountMed: med(list.map((x) => x.ablated && x.ablated.styleCount)),
  };
}

// ------------- H6 prediction test: transitions that DO fire applyWallpaper
// (into/out of the General section, and modal open/close) vs those that do NOT.
// Pre-registered: if the unconditional full-viewport wallpaper rewrite is the
// cost driver, the firing set must be more expensive than the non-firing set.
function firesWallpaper(label) {
  if (label === 'OPEN') return true;
  if (label === 'CLOSE') return true;
  if (label === 'SEC_1_first_view') return true;      // general mounts on open
  if (label === 'SEC_back_first') return true;        // nav -> general
  if (/^SEC_S2_/.test(label)) return true;            // leaves general
  return false;
}
const wpSplit = { fires: [], noFire: [] };
for (const p of phases) {
  if (!['open', 'close', 'view', 'switch-back'].includes(p.kind)) continue;
  if (p.kind === 'view' && !(p.label === 'SEC_1_first_view' || /^SEC_S\d+_/.test(p.label))) continue;
  (firesWallpaper(p.label) ? wpSplit.fires : wpSplit.noFire).push(p);
}
const wpSummary = {
  fires: { n: wpSplit.fires.length, presentationMed: med(wpSplit.fires.map((p) => p.presentationMs)), frameMaxMax: max(wpSplit.fires.map((p) => p.frameMax)), taskMed: med(wpSplit.fires.map((p) => p.taskMs)), styleCountMed: med(wpSplit.fires.map((p) => p.styleCount)), rasterMed: med(wpSplit.fires.map((p) => p.rasterMs)), paintMed: med(wpSplit.fires.map((p) => p.paintMs)), c2fMed: med(wpSplit.fires.map((p) => p.c2f)) },
  noFire: { n: wpSplit.noFire.length, presentationMed: med(wpSplit.noFire.map((p) => p.presentationMs)), frameMaxMax: max(wpSplit.noFire.map((p) => p.frameMax)), taskMed: med(wpSplit.noFire.map((p) => p.taskMs)), styleCountMed: med(wpSplit.noFire.map((p) => p.styleCount)), rasterMed: med(wpSplit.noFire.map((p) => p.rasterMs)), paintMed: med(wpSplit.noFire.map((p) => p.paintMs)), c2fMed: med(wpSplit.noFire.map((p) => p.c2f)) },
  detail: { fires: wpSplit.fires.map((p) => ({ label: p.label, presentation: p.presentationMs, raster: p.rasterMs, paint: p.paintMs })), noFire: wpSplit.noFire.map((p) => ({ label: p.label, presentation: p.presentationMs, raster: p.rasterMs, paint: p.paintMs })) },
};

// ------------------------------------------------------------- H2 (first vs revisit)
const h2 = [];
for (const { data } of runs) {
  for (const rep of data.reps || []) {
    const f = (l) => (rep.phases || []).find((p) => p.label === l);
    const a = f('SEC_S3_插件'), b = f('SEC_plugins_REVISIT');
    const t1 = f('TAB_S3_插件::tab:插件列表'), t2 = f('TAB_plugins_REVISIT_list');
    if (a && b) h2.push({ run: data.run, rep: rep.rep, firstMount: { c2f: a.clickToFirstChangeMs, frameMax: a.frameMax, presentation: a.trace ? a.trace.paintMs + a.trace.rasterMs + a.trace.compositeMs + a.trace.updateLayerTreeMs : null, unmounts: a.unmounts },
                                     revisit: { c2f: b.clickToFirstChangeMs, frameMax: b.frameMax, presentation: b.trace ? b.trace.paintMs + b.trace.rasterMs + b.trace.compositeMs + b.trace.updateLayerTreeMs : null, unmounts: b.unmounts },
                                     tabFirst: t1 ? { c2f: t1.clickToFirstChangeMs, presentation: t1.trace ? t1.trace.paintMs + t1.trace.rasterMs + t1.trace.compositeMs + t1.trace.updateLayerTreeMs : null } : null,
                                     tabRevisit: t2 ? { c2f: t2.clickToFirstChangeMs, presentation: t2.trace ? t2.trace.paintMs + t2.trace.rasterMs + t2.trace.compositeMs + t2.trace.updateLayerTreeMs : null } : null });
  }
}

// --------------------------------------------------------------- H6 (wallpaper / mask)
const h6 = [];
for (const { data } of runs) {
  for (const rep of data.reps || []) {
    const active = rep.activeAtOpen;
    const toGeneral = (rep.phases || []).filter((p) => /SEC_back_first/.test(p.label));
    const away = (rep.phases || []).filter((p) => /^SEC_S\d+_/.test(p.label));
    const ppt = (p) => (p && p.trace && !p.trace.unavailable) ? Math.round(((p.trace.paintMs || 0) + (p.trace.rasterMs || 0) + (p.trace.compositeMs || 0) + (p.trace.updateLayerTreeMs || 0)) * 100) / 100 : null;
    h6.push({ run: data.run, rep: rep.rep, activeAtOpen: active,
              enterFirst: ppt((rep.phases || []).find((p) => p.label === 'SEC_1_first_view')),
              open: ppt((rep.phases || []).find((p) => p.label === 'OPEN')),
              close: ppt((rep.phases || []).find((p) => p.label === 'CLOSE')),
              returnToGeneral: ppt(toGeneral[0]),
              leaveGeneral: away.map((p) => ({ label: p.label, presentation: ppt(p) })),
              perSection: (rep.phases || []).filter((p) => /^SEC_S\d+_|^SEC_1_first_view$|^SEC_back_first$/.test(p.label)).map((p) => ({ label: p.label, presentation: ppt(p), unmounts: p.unmounts, muts: p.muts })) });
  }
}

const out = {
  generatedAt: new Date().toISOString(),
  files, nRuns: runs.length,
  preRegistration: {
    expensiveLabelled: [...EXPENSIVE],
    controls: 'every other registered settings section',
    positiveControlPass: 'injected ~120ms block -> LongTask >= 90ms OR frameMax >= 90ms',
    negativeEvidenceRule: '0 longtasks AND frameP95 <= 20ms, accepted only if the positive control passed in the same rep',
  },
  aggregation: agg,
  sectionPanels, tabPanels,
  splitTable, scrollSplitTable, correlations,
  controls, h2, h6, ablation, ablationSummary, wpSummary,
};
fs.writeFileSync(path.join(DIR, 'analysis.json'), JSON.stringify(out, null, 2));

// ------------------------------------------------------------------ print
const f2 = (x) => (x == null ? '-' : (typeof x === 'number' ? (Math.round(x * 100) / 100).toFixed(2) : x));
console.log('=== runs ===');
for (const f of files) console.log('  ' + f);
console.log('\n=== PER-PANEL INTERACTION TABLE (median across reps) ===');
console.log(['panel', 'n', 'c2f', 'p95', 'fmax', '>50', 'LTmax', 'script', 'task', 'style', 'styleCt', 'paint', 'raster', 'comp', 'ULT', 'PRESENT', 'pw'].join('\t'));
for (const a of agg) console.log([a.panel, a.nView, f2(a.c2fMed), f2(a.frameP95Med), f2(a.frameMaxMed), a.framesGt50Sum, f2(a.ltMax), f2(a.scriptMsMed), f2(a.taskMsMed), f2(a.styleMsMed), f2(a.styleCountMed), f2(a.paintMsMed), f2(a.rasterMsMed), f2(a.compositeMsMed), f2(a.ultMsMed), f2(a.presentationMsMed), f2(a.performedWorkMed)].join('\t'));
console.log('\n=== PER-PANEL SCALE TABLE ===');
console.log(['panel', 'optNodes', 'optSvg', 'svgDeep', 'optText', 'cards', 'domNodes', 'unmounts', 'rpcs', 'maxScroll'].join('\t'));
for (const a of agg) console.log([a.panel, a.optNodesMed, a.optSvgMed, a.optSvgDeepMed, a.optTextMed, a.cardsMed, a.domNodesMed, a.unmountsMed, a.rpcs.join('|') || '-', a.scrollMaxScroll].join('\t'));
console.log('\n=== E(通用设置+插件) vs C(other sections) split ===');
for (const k of METRICS) { const s = splitTable[k]; console.log(`${k.padEnd(20)} E=${f2(s.expensive.med)} (n=${s.expensive.n})  C=${f2(s.cheap.med)} (n=${s.cheap.n})  ratio=${s.ratio ?? '-'}`); }
console.log('\n=== SCROLL split ===');
for (const k of Object.keys(scrollSplitTable)) { const s = scrollSplitTable[k]; console.log(`${k.padEnd(24)} E=${f2(s.expensive.med)}  C=${f2(s.cheap.med)}  ratio=${s.ratio ?? '-'}`); }
console.log('\n=== Spearman(predictor, cost) over sections ===');
for (const c of COSTS) { console.log(c); for (const p of PREDICTORS) { const v = correlations[c][p]; if (v != null) console.log(`   ${p.padEnd(18)} rho=${v}`); } }
console.log('\n=== CONTROLS ===');
for (const c of controls) console.log(`${c.run}/rep${c.rep}  POSCTL ltMax=${c.posctl?.ltMax} frameMax=${c.posctl?.frameMax} PASS=${c.posctl?.pass} | inPanel PASS=${c.posctlInPanel?.pass} | idle ltCount=${c.idle?.ltCount} p95=${f2(c.idle?.frameP95)} commits=${c.idle?.commits}`);
console.log('\n=== H2 first vs revisit (插件) ===');
for (const h of h2) console.log(`${h.run}/rep${h.rep}  first c2f=${h.firstMount.c2f} pres=${f2(h.firstMount.presentation)} unm=${h.firstMount.unmounts} | revisit c2f=${h.revisit.c2f} pres=${f2(h.revisit.presentation)} unm=${h.revisit.unmounts} | tabFirst pres=${f2(h.tabFirst?.presentation)} tabRevisit pres=${f2(h.tabRevisit?.presentation)}`);
console.log('\n=== H6 wallpaper/mask ===');
for (const h of h6) console.log(`${h.run}/rep${h.rep} open=${f2(h.open)} firstSection=${f2(h.enterFirst)} close=${f2(h.close)} returnToGeneral=${f2(h.returnToGeneral)} | perSection=${JSON.stringify(h.perSection.map((x) => [x.label.replace(/^SEC_/, ''), x.presentation, 'unm=' + x.unmounts]))}`);
console.log('\n=== JANK BY PHASE KIND (validated channel = frameMax; LongTask API is blind to injected blocks) ===');
const kindAgg = {};
for (const p of phases) { (kindAgg[p.kind] = kindAgg[p.kind] || []).push(p); }
for (const [k, list] of Object.entries(kindAgg)) {
  const gt = list.map((p) => p.framesGt50);
  console.log(`${k.padEnd(14)} n=${String(list.length).padEnd(4)} framesGt50 sum=${sum(gt)} max=${max(gt)} microFrames=${sum(list.map((p) => p.nFrames))} frameMaxMax=${f2(max(list.map((p) => p.frameMax)))} p95Med=${f2(med(list.map((p) => p.frameP95)))}`);
}
console.log('\n=== SCROLL vs VIEW, per panel (frame channel) ===');
for (const a of agg) {
  const list = byKey.get(a.panelKey) || [];
  const sc = list.filter((p) => p.kind === 'scroll' || p.kind === 'tab-scroll');
  const vw = list.filter((p) => p.kind === 'view' || p.kind === 'tab' || p.kind === 'tab-active');
  if (!sc.length && !vw.length) continue;
  console.log(`${a.panel.slice(0, 30).padEnd(31)} scroll: n=${sc.length} gt50sum=${sum(sc.map((p) => p.framesGt50))} fmaxMax=${f2(max(sc.map((p) => p.frameMax)))} p95med=${f2(med(sc.map((p) => p.frameP95)))} | view: n=${vw.length} gt50sum=${sum(vw.map((p) => p.framesGt50))} fmaxMax=${f2(max(vw.map((p) => p.frameMax)))} p95med=${f2(med(vw.map((p) => p.frameP95)))}`);
}
console.log('\n=== H6 PREDICTION TEST: phases that fire applyWallpaper vs not ===');
console.log(`FIRES    n=${wpSummary.fires.n}  presentation=${f2(wpSummary.fires.presentationMed)}  raster=${f2(wpSummary.fires.rasterMed)}  paint=${f2(wpSummary.fires.paintMed)}  task=${f2(wpSummary.fires.taskMed)}  frameMaxMax=${f2(wpSummary.fires.frameMaxMax)}  c2f=${f2(wpSummary.fires.c2fMed)}`);
console.log(`NO-FIRE  n=${wpSummary.noFire.n}  presentation=${f2(wpSummary.noFire.presentationMed)}  raster=${f2(wpSummary.noFire.rasterMed)}  paint=${f2(wpSummary.noFire.paintMed)}  task=${f2(wpSummary.noFire.taskMed)}  frameMaxMax=${f2(wpSummary.noFire.frameMaxMax)}  c2f=${f2(wpSummary.noFire.c2fMed)}`);
for (const x of wpSummary.detail.fires) console.log('   FIRES   ', x.label, 'pres=' + f2(x.presentation), 'raster=' + f2(x.raster), 'paint=' + f2(x.paint));
for (const x of wpSummary.detail.noFire) console.log('   nofire  ', x.label, 'pres=' + f2(x.presentation), 'raster=' + f2(x.raster), 'paint=' + f2(x.paint));
console.log('\n=== ABLATION (mask/wallpaper neutralised) paired by step ===');
for (const [step, v] of Object.entries(ablationSummary)) console.log(`${step.padEnd(14)} n=${v.n} pres N=${f2(v.normalPresentationMed)} A=${f2(v.ablatedPresentationMed)} N2=${f2(v.normal2PresentationMed)} | frameMaxMax N=${f2(v.normalFrameMaxMax)} A=${f2(v.ablatedFrameMaxMax)} N2=${f2(v.normal2FrameMaxMax)} | task N=${f2(v.normalTaskMed)} A=${f2(v.ablatedTaskMed)}`);
console.log('\n=== SCROLL MOVEMENT PROOF (moved? scrollTopMax) ===');
for (const a of agg) console.log(`${a.panel.padEnd(26)} maxScroll=${a.scrollMaxScroll} scrollP95=${f2(a.scrollFrameP95Med)} scrollPresentation=${f2(a.scrollPresentationMsMed)}`);
console.log('\nwrote analysis.json');
