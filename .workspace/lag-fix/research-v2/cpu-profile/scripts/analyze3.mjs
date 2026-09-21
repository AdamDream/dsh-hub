// Final analyser for the locked campaign (cpuL schema): per-window top-30 self time,
// bundle attribution, named-chain totals and ratios, anchor-symbol proof, WS typing.
import fs from 'node:fs';
import path from 'node:path';
const BASE = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/cpu-profile';
const OUT = path.join(BASE, 'out');
const STAMP = process.argv[2] || 'cpuL';
const d = JSON.parse(fs.readFileSync(path.join(OUT, `campaign-${STAMP}.json`), 'utf8'));
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const avg = (a) => (a && a.length ? r3(a.reduce((x, y) => x + y, 0) / a.length) : null);

const RUNTIME_LIB = '/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js';
const LAYOUT_LIB = '/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js';
const regMap = (f) => { const o = []; try { const L = fs.readFileSync(f, 'utf8').split('\n'); for (let i = 0; i < L.length; i++) { const m = /\/\/#region\s+(.+)$/.exec(L[i]); if (m) o.push({ line: i + 1, file: m[1].trim() }); } } catch { } return o; };
const RR = regMap(RUNTIME_LIB), LR = regMap(LAYOUT_LIB);
const regionFor = (f) => { const regs = /dsh-client-ui-layout/.test(f.url) ? LR : /dsh-client-runtime/.test(f.url) ? RR : null; if (!regs) return null; let best = null; for (const r of regs) { if (r.line <= f.line) best = r; else break; } return best ? best.file : null; };

const V8I = /^\((?:idle|program|garbage collector|root|no name|unlinked)\)$/;
const isApply = (f) => f.fn === 'apply' && /dsh-client-ui-layout/.test(f.url);
const CHAIN_DEFS = {
  ThemePresenter_apply: (f) => isApply(f),
  buildListSnapshot: (f) => (f.fn || '') === 'buildListSnapshot',
  projectList: (f) => (f.fn || '') === 'projectList',
  flattenLineage: (f) => (f.fn || '') === 'flattenLineage',
  markDirty: (f) => (f.fn || '') === 'markDirty',
  ensureFresh: (f) => (f.fn || '') === 'ensureFresh',
  getListSnapshot: (f) => (f.fn || '') === 'getListSnapshot',
  list_set_applyMutation: (f) => (f.fn || '') === 'applyMutation' || (f.fn || '') === 'recordMutation',
  syncCompletedNotifications: (f) => (f.fn || '') === 'syncCompletedNotifications',
  rebuildRemote: (f) => (f.fn || '') === 'rebuildRemote',
  querySelectorAll: (f) => (f.fn || '') === 'querySelectorAll',
  sessionChainSum: (f) => ['buildListSnapshot', 'projectList', 'flattenLineage', 'markDirty', 'ensureFresh', 'getListSnapshot', 'applyMutation', 'recordMutation', 'syncCompletedNotifications'].includes(f.fn || ''),
};

const windows = d.windows.map((w) => {
  const bt = w.profile.busyTop || w.profile.top;
  const chainMs = {}; const chainFn = {};
  for (const [k, pred] of Object.entries(CHAIN_DEFS)) { const hits = bt.filter(pred); chainMs[k] = r3(hits.reduce((a, f) => a + f.selfMs, 0)); chainFn[k] = [...new Set(hits.map((f) => `${f.fn}@${(f.url || '').split('/').pop()}:${f.line}`))]; }
  const applyMs = chainMs.ThemePresenter_apply;
  return {
    label: w.label, scenario: w.scenario, page: w.meta.page, session: w.meta.session || null, tab: w.state.activeSettingsTab || null, action: w.window.action ? w.window.action.action : null,
    wallSec: w.window.wallSec, nodes: w.state.nodes, wsIn: w.ws.in, wsInPerS: w.ws.inboundPerS, wsOut: w.ws.out, byKind: w.ws.byKind, byPayloadType: w.ws.byPayloadType, topSessionIds: w.ws.topSessionIds,
    scriptMs: w.cdp.ScriptDuration, scriptMsPerS: w.cdp.ScriptMsPerS, taskMs: w.cdp.TaskDuration, taskMsPerS: w.cdp.TaskMsPerS,
    recalcMs: w.cdp.RecalcStyleDuration, recalcMsPerS: w.cdp.RecalcMsPerS, recalcCount: w.cdp.RecalcStyleCount,
    layoutMs: w.cdp.LayoutDuration, layoutMsPerS: w.cdp.LayoutMsPerS, layoutCount: w.cdp.LayoutCount,
    busyMs: w.profile.busyMs, busyMsPerS: w.profile.busyMsPerS, reconcileRatio: w.reconcile.ratio,
    applyMs, applyMsPerS: r3(applyMs / w.window.profileWallSec), applyShareOfScript: r3(applyMs / Math.max(0.001, w.cdp.ScriptDuration)), applyShareOfBusy: r3(applyMs / Math.max(0.001, w.profile.busyMs)),
    chainMs, chainFn,
    rafPerS: w.raf.perS, rafP50: w.raf.intervals.p50, rafP95: w.raf.intervals.p95, rafP99: w.raf.intervals.p99, rafMax: w.raf.intervals.max, rafOver50: w.raf.intervals.over50, rafOver100: w.raf.intervals.over100,
    ltN: w.longtasks.n, ltMaxMs: w.longtasks.maxMs, ltTotalMs: w.longtasks.totalMs, lafN: w.laf.n,
    mutRecords: w.mutations.records, bodyStyleWrites: w.bodyStyleWrites, bodyStyleMut: w.bodyStyleMutationRecords, bodyWritesPerS: w.bodyStyleWritesPerS,
    samples: w.profile.sampleCount, msPerSample: w.profile.msPerSample,
    top30: (w.profile.top || []).slice(0, 30).map((f) => ({ fn: f.fn, bundle: (f.url || '').split('/').pop().split('?')[0], url: f.url, line: f.line, selfMs: f.selfMs, selfPct: f.selfPct, msPerS: r3(f.selfMs / w.window.profileWallSec), v8: V8I.test(f.fn), region: regionFor(f) })),
    bundles: (w.profile.bundles || []).map((b) => ({ bundle: b.bundle, selfMs: b.selfMs, msPerS: r3(b.selfMs / w.window.profileWallSec) })),
    integrity: w.integrity,
  };
});

// per-scenario
const scen = {};
for (const w of windows) {
  const s = w.scenario; if (!scen[s]) scen[s] = { scenario: s, n: 0, ok: 0, acc: { script: [], task: [], recalc: [], layout: [], busy: [], apply: [], applyShareScript: [], wsIn: [], raf: [], nodes: [], bodyWrites: [] }, rafOver50: 0, ltN: 0, lafN: 0, mut: 0, chainPerS: {}, bundlePerS: {}, pages: {}, tabs: {} };
  const a = scen[s]; a.n++;
  a.pages[w.page] = (a.pages[w.page] || 0) + 1; if (w.tab) a.tabs[w.tab] = (a.tabs[w.tab] || 0) + 1;
  a.acc.script.push(w.scriptMsPerS); a.acc.task.push(w.taskMsPerS); a.acc.recalc.push(w.recalcMsPerS); a.acc.layout.push(w.layoutMsPerS); a.acc.busy.push(w.busyMsPerS);
  a.acc.apply.push(w.applyMsPerS); a.acc.applyShareScript.push(w.applyShareOfScript);
  a.acc.wsIn.push(w.wsInPerS); a.acc.raf.push(w.rafPerS); a.rafOver50 += w.rafOver50; a.ltN += w.ltN; a.lafN += w.lafN; a.acc.nodes.push(w.nodes); a.mut += w.mutRecords; a.acc.bodyWrites.push(w.bodyWritesPerS);
  if (w.integrity.rafOk && w.integrity.rafRateSane && w.integrity.unitOk) a.ok++;
  for (const [k, ms] of Object.entries(w.chainMs)) a.chainPerS[k] = r3((a.chainPerS[k] || 0) + ms / w.wallSec);
  for (const b of w.bundles) a.bundlePerS[b.bundle] = r3((a.bundlePerS[b.bundle] || 0) + b.msPerS);
}
for (const a of Object.values(scen)) {
  for (const k of ['script', 'task', 'recalc', 'layout', 'busy', 'apply', 'wsIn', 'raf', 'nodes', 'bodyWrites']) a[k + 'Avg'] = avg(a.acc[k]);
  a.applyShareOfScriptAvg = avg(a.acc.applyShareScript);
  delete a.acc;
}

const chains = {};
for (const w of windows) for (const [k, ms] of Object.entries(w.chainMs)) {
  if (!chains[k]) chains[k] = { chain: k, windowsWithHits: 0, totalWindows: windows.length, selfMs: 0, maxMsPerS: 0, perScenarioMsPerS: {}, fns: new Set() };
  const c = chains[k]; if (ms > 0) { c.windowsWithHits++; c.selfMs = r3(c.selfMs + ms); c.maxMsPerS = Math.max(c.maxMsPerS, r3(ms / w.wallSec)); c.perScenarioMsPerS[w.scenario] = r3((c.perScenarioMsPerS[w.scenario] || 0) + ms / w.wallSec); }
  for (const f of w.chainFn[k]) c.fns.add(f);
}
for (const c of Object.values(chains)) c.fns = [...c.fns].slice(0, 6);

// world totals for ratios
const tot = { script: 0, busy: 0, apply: 0, chain: 0, recalc: 0, layout: 0, task: 0 };
for (const w of d.windows) {
  tot.script += w.cdp.ScriptDuration || 0; tot.busy += w.profile.busyMs || 0; tot.recalc += w.cdp.RecalcStyleDuration || 0; tot.layout += w.cdp.LayoutDuration || 0; tot.task += w.cdp.TaskDuration || 0;
  const bt = w.profile.busyTop || [];
  tot.apply += bt.filter(isApply).reduce((a, f) => a + f.selfMs, 0);
  tot.chain += bt.filter(CHAIN_DEFS.sessionChainSum).reduce((a, f) => a + f.selfMs, 0);
}
tot.applyShareOfScript = r3(tot.apply / Math.max(0.001, tot.script));
tot.applyShareOfBusy = r3(tot.apply / Math.max(0.001, tot.busy));
tot.chainShareOfScript = r3(tot.chain / Math.max(0.001, tot.script));
tot.chainShareOfBusy = r3(tot.chain / Math.max(0.001, tot.busy));
tot.applyOverChain = r3(tot.apply / Math.max(0.001, tot.chain));
tot.scriptShareOfTask = r3(tot.script / Math.max(0.001, tot.task));
tot.recalcShareOfTask = r3(tot.recalc / Math.max(0.001, tot.task));
tot.layoutShareOfTask = r3(tot.layout / Math.max(0.001, tot.task));

fs.writeFileSync(path.join(OUT, `analysis-${STAMP}.json`), JSON.stringify({ meta: d.meta, errors: d.errors, scen, chains, windows, totals: tot }, null, 2));

const L = []; const P = (s) => { L.push(s); console.log(s); };
P(`# analysis ${STAMP}: windows=${d.windows.length} errors=${JSON.stringify(d.errors)}`);
P(`meta: ${JSON.stringify(d.meta)}`);
P('\n## anchor-symbol proof (per-function self time from CDP Profiler)');
for (const c of Object.values(chains)) P(`  ${c.chain.padEnd(28)} hitWindows=${String(c.windowsWithHits).padStart(2)}/${c.totalWindows} totalSelfMs=${String(c.selfMs).padStart(10)} maxMsPerS=${String(c.maxMsPerS).padStart(9)} fns=${JSON.stringify(c.fns)}`);
P('\n## per-scenario');
P('scenario               n ok | script/s task/s recalc/s layout/s | busy/s | apply/s apply/script | wsIn/s | raf/s >50 | ltN lafN | bodyWrites/s mut | nodes');
for (const a of Object.values(scen)) P(`${a.scenario.padEnd(22)} ${String(a.n).padStart(2)} ${String(a.ok).padStart(2)} | ${String(a.scriptAvg).padStart(8)} ${String(a.taskAvg).padStart(6)} ${String(a.recalcAvg).padStart(8)} ${String(a.layoutAvg).padStart(8)} | ${String(a.busyAvg).padStart(6)} | ${String(a.applyAvg).padStart(7)} ${String(a.applyShareOfScriptAvg).padStart(12)} | ${String(a.wsInAvg).padStart(7)} | ${String(a.rafAvg).padStart(5)} ${String(a.rafOver50).padStart(4)} | ${String(a.ltN).padStart(3)} ${String(a.lafN).padStart(4)} | ${String(a.bodyWritesAvg).padStart(12)} ${String(a.mut).padStart(4)} | ${String(a.nodesAvg).padStart(5)}`);
P('\n## per-scenario chain ms/s');
for (const a of Object.values(scen)) P(`  ${a.scenario.padEnd(22)} ${JSON.stringify(a.chainPerS)}`);
P('\n## per-scenario bundle ms/s');
for (const a of Object.values(scen)) P(`  ${a.scenario.padEnd(22)} ${JSON.stringify(Object.entries(a.bundlePerS).sort((x, y) => y[1] - x[1]).slice(0, 6))}`);
P('\n## window detail');
for (const w of windows) {
  P(`\n--- ${w.label} [${w.scenario}] wall=${w.wallSec}s page=${w.page} session=${w.session} tab=${w.tab} action=${w.action}`);
  P(`    nodes=${w.nodes} wsIn=${w.wsIn}(${w.wsInPerS}/s) byPayloadType=${JSON.stringify(w.byPayloadType)} topSessionIds=${JSON.stringify(w.topSessionIds)}`);
  P(`    script=${w.scriptMs}ms(${w.scriptMsPerS}/s) task=${w.taskMs}ms(${w.taskMsPerS}/s) recalc=${w.recalcMs}ms(${w.recalcMsPerS}/s n=${w.recalcCount}) layout=${w.layoutMs}ms(${w.layoutMsPerS}/s n=${w.layoutCount})`);
  P(`    profileBusy=${w.busyMs}ms(${w.busyMsPerS}/s) reconcileRatio=${w.reconcileRatio} apply=${w.applyMs}ms(${w.applyMsPerS}/s) apply/script=${w.applyShareOfScript} apply/busy=${w.applyShareOfBusy}`);
  P(`    raf=${w.rafPerS}/s p50=${w.rafP50} p95=${w.rafP95} p99=${w.rafP99} max=${w.rafMax} >50=${w.rafOver50} >100=${w.rafOver100} ltN=${w.ltN} ltMax=${w.ltMaxMs} lafN=${w.lafN}`);
  P(`    bodyStyleWrites=${w.bodyStyleWrites}(${w.bodyWritesPerS}/s) observedBodyStyleMutations=${w.bodyStyleMut} allMutationRecords=${w.mutRecords}`);
  P(`    chains: ${JSON.stringify(Object.fromEntries(Object.entries(w.chainMs).filter(([, v]) => v > 0)))}`);
  P(`    top30:`);
  for (const f of w.top30) P(`      ${String(f.msPerS).padStart(10)} ms/s ${String(f.selfMs).padStart(10)}ms ${String(f.selfPct).padStart(6)}%  ${f.fn} @${f.bundle}:${f.line}${f.region ? ' <' + f.region + '>' : ''}${f.v8 ? ' [v8]' : ''}`);
}
P('\n## world totals + headline ratios');
P(`  ${JSON.stringify(tot)}`);
fs.writeFileSync(path.join(OUT, `analysis-${STAMP}.txt`), L.join('\n'));
P(`\nwritten out/analysis-${STAMP}.json / .txt`);
