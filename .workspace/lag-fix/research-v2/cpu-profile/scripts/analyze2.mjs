// Final analysis for the unit-corrected campaign: per-window top-30 self time,
// bundle attribution, named-chain totals, event-rate scaling, anchor proof.
import fs from 'node:fs';
import path from 'node:path';

const BASE = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/cpu-profile';
const OUT = path.join(BASE, 'out');
const STAMP = process.argv[2] || 'cpu3';
const d = JSON.parse(fs.readFileSync(path.join(OUT, `campaign-${STAMP}.json`), 'utf8'));
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const avg = (a) => (a && a.length ? r3(a.reduce((x, y) => x + y, 0) / a.length) : null);
const med = (a) => { if (!a || !a.length) return null; const s = [...a].sort((x, y) => x - y); return r3(s[Math.floor((s.length - 1) * 0.5)]); };
const p95 = (a) => { if (!a || !a.length) return null; const s = [...a].sort((x, y) => x - y); return r3(s[Math.min(s.length - 1, Math.floor((s.length - 1) * 0.95))]); };

// region map
const RUNTIME_LIB = '/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js';
const LAYOUT_LIB = '/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js';
function regionMap(file) {
  const out = [];
  try { const lines = fs.readFileSync(file, 'utf8').split('\n'); for (let i = 0; i < lines.length; i++) { const m = /\/\/#region\s+(.+)$/.exec(lines[i]); if (m) out.push({ line: i + 1, file: m[1].trim() }); } } catch { }
  return out;
}
const RUNTIME_REGIONS = regionMap(RUNTIME_LIB), LAYOUT_REGIONS = regionMap(LAYOUT_LIB);
const regionOf = (line, which) => { const regs = which === 'layout' ? LAYOUT_REGIONS : RUNTIME_REGIONS; let best = null; for (const r of regs) { if (r.line <= line) best = r; else break; } return best ? best.file : null; };
const regionFor = (f) => (/dsh-client-ui-layout/.test(f.url) ? regionOf(f.line, 'layout') : /dsh-client-runtime/.test(f.url) ? regionOf(f.line, 'runtime') : null);

const ANCHORS = ['buildListSnapshot', 'projectList', 'flattenLineage', 'markDirty', 'ensureFresh', 'getListSnapshot', 'applyMutation', 'recordMutation', 'syncCompletedNotifications', 'rebuildRemote', 'querySelectorAll', 'ThemePresenter', 'apply'];
const anchorProof = {};
for (const w of d.windows) for (const f of w.profile.top) for (const a of ANCHORS) {
  if (!(f.fn || '').includes(a)) continue;
  if (!anchorProof[a]) anchorProof[a] = { symbol: a, windows: 0, selfMs: 0, maxPerS: 0, urls: new Set(), lines: new Set(), perScenario: {}, regions: new Set() };
  const p = anchorProof[a];
  p.windows++; p.selfMs = r3(p.selfMs + f.selfMs); const perS = r3(f.selfMs / w.window.profileWallSec);
  p.maxPerS = Math.max(p.maxPerS, perS); p.perScenario[w.scenario] = r3((p.perScenario[w.scenario] || 0) + perS);
  p.urls.add(f.url || '(none)'); p.lines.add(f.line); const rg = regionFor(f); if (rg) p.regions.add(rg);
}
for (const p of Object.values(anchorProof)) { p.urls = [...p.urls].slice(0, 3); p.lines = [...p.lines].slice(0, 8); p.regions = [...p.regions].slice(0, 4); }

// V8 internals excluded from "app work"
const V8I = /^\((?:idle|program|garbage collector|root|no name|unlinked)\)$/;

// per-window rows
const windows = d.windows.map((w) => ({
  label: w.label, scenario: w.scenario, profiledSec: w.window.profileWallSec, wallSec: w.window.wallSec,
  startISO: w.window.startISO, endISO: w.window.endISO,
  page: w.meta.page, session: w.meta.session || null, tab: w.state.activeSettingsTab || null, action: w.window.action || null,
  nodes: w.state.nodes, wsIn: w.ws.dirs.in, wsInPerS: w.ws.inboundPerS, wsOut: w.ws.dirs.out, byKind: w.ws.byKind, byPayloadType: w.ws.byPayloadType,
  scriptMs: w.cdp.ScriptDuration, scriptMsPerS: w.cdp.ScriptMsPerS, taskMs: w.cdp.TaskDuration, taskMsPerS: w.cdp.TaskMsPerS,
  recalcMs: w.cdp.RecalcStyleDuration, recalcMsPerS: w.cdp.RecalcMsPerS, layoutMs: w.cdp.LayoutDuration, layoutMsPerS: w.cdp.LayoutMsPerS,
  recalcCount: w.cdp.RecalcStyleCount, layoutCount: w.cdp.LayoutCount,
  profileBusyMs: w.profile.busyMs, profileBusyMsPerS: w.reconcile.profileBusyMsPerS, ratio: w.reconcile.ratio_profileBusy_over_scriptPlusRecalc,
  rafPerS: w.raf.perS, rafP50: w.raf.intervals.p50, rafP95: w.raf.intervals.p95, rafP99: w.raf.intervals.p99, rafMax: w.raf.intervals.max, rafOver50: w.raf.intervals.over50, rafOver100: w.raf.intervals.over100,
  ltN: w.longtasks.n, ltMaxMs: w.longtasks.maxMs, ltTotalMs: w.longtasks.totalMs, ltTop: w.longtasks.top,
  lafN: w.longAnimationFrames.n, lafTop: w.longAnimationFrames.top,
  mutRecords: w.mutations.records, mutAttrs: w.mutations.attrs, mutAdded: w.mutations.added, mutTargets: w.mutations.topTargets,
  setProps: w.applyProbe ? w.applyProbe.tokens : null, eventTiming: w.eventTiming, clickToPaint: w.clickToPaint, integrity: w.integrity,
  samples: w.profile.sampleCount, msPerSample: w.profile.msPerSample,
  top30: w.profile.top.slice(0, 30).map((f) => ({ fn: f.fn, url: (f.url || '').split('/').pop(), fullUrl: f.url, line: f.line, selfMs: f.selfMs, selfPct: f.selfPct, msPerS: r3(f.selfMs / w.window.profileWallSec), v8: V8I.test(f.fn), region: regionFor(f) })),
  appTop: w.profile.busyTop.slice(0, 15).map((f) => ({ fn: f.fn, url: (f.url || '').split('/').pop(), line: f.line, selfMs: f.selfMs, msPerS: r3(f.selfMs / w.window.profileWallSec), region: regionFor(f) })),
  bundles: w.profile.bundles.map((b) => ({ bundle: b.bundle, selfMs: b.selfMs, msPerS: r3(b.selfMs / w.window.profileWallSec) })),
}));

// per-scenario
const scen = {};
for (const w of windows) {
  const s = w.scenario; scen[s] = scen[s] || { scenario: s, n: 0, script: [], task: [], recalc: [], layout: [], busy: [], ratio: [], raf: [], rafOver50: 0, rafOver100: 0, rafMax: [], ltN: 0, ltMax: [], lafN: 0, wsIn: [], nodes: [], mut: 0, setProps: 0, ok: 0, page: w.page, tab: w.tab, chainPerS: {}, bundlePerS: {} };
  const a = scen[s]; a.n++;
  a.script.push(w.scriptMsPerS); a.task.push(w.taskMsPerS); a.recalc.push(w.recalcMsPerS); a.layout.push(w.layoutMsPerS);
  a.busy.push(w.profileBusyMsPerS); a.ratio.push(w.ratio); a.raf.push(w.rafPerS);
  a.rafOver50 += w.rafOver50; a.rafOver100 += w.rafOver100; if (w.rafMax != null) a.rafMax.push(w.rafMax);
  a.ltN += w.ltN; if (w.ltMaxMs != null) a.ltMax.push(w.ltMaxMs); a.lafN += w.lafN;
  a.wsIn.push(w.wsInPerS); a.nodes.push(w.nodes); a.mut += w.mutRecords; if (w.setProps != null) a.setProps += w.setProps;
  if (w.integrity.rafExpected && w.integrity.rafRateSane && w.integrity.muReady && w.integrity.observerAlive && w.integrity.unitCheck) a.ok++;
  for (const f of w.appTop) { const k = `${f.fn} @${f.url}:${f.line}`; a.chainPerS[k] = r3((a.chainPerS[k] || 0) + f.msPerS); }
  for (const b of w.bundles) a.bundlePerS[b.bundle] = r3((a.bundlePerS[b.bundle] || 0) + b.msPerS);
}
for (const a of Object.values(scen)) {
  a.scriptMsPerS = avg(a.script); a.scriptMedian = med(a.script); a.scriptMax = a.script.length ? r3(Math.max(...a.script)) : null;
  a.taskMsPerS = avg(a.task); a.recalcMsPerS = avg(a.recalc); a.layoutMsPerS = avg(a.layout);
  a.profileBusyMsPerS = avg(a.busy); a.ratioAvg = avg(a.ratio);
  a.rafPerS = avg(a.raf); a.rafMaxSeen = a.rafMax.length ? r3(Math.max(...a.rafMax)) : null;
  a.ltMaxSeen = a.ltMax.length ? r3(Math.max(...a.ltMax)) : null;
  a.wsInPerS = avg(a.wsIn); a.wsInMax = a.wsIn.length ? r3(Math.max(...a.wsIn)) : null; a.nodesAvg = avg(a.nodes);
  a.topFns = Object.entries(a.chainPerS).sort((x, y) => y[1] - x[1]).slice(0, 12);
  a.bundles = Object.entries(a.bundlePerS).sort((x, y) => y[1] - x[1]).slice(0, 8);
  delete a.chainPerS; delete a.bundlePerS;
}

// chain totals + scaling
const CHAINS = ['buildListSnapshot', 'projectList', 'flattenLineage', 'markDirty', 'ensureFresh', 'getListSnapshot', 'applyMutation', 'recordMutation', 'syncCompletedNotifications', 'rebuildRemote', 'querySelectorAll', 'ThemePresenter', 'apply', 'render', 'recalc', 'commit'];
function fit(pts) {
  const n = pts.length; if (n < 3) return { n, slope: null, r2: null };
  const mx = avg(pts.map((p) => p.x)); const my = avg(pts.map((p) => p.y));
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of pts) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return { n, slope: r3(slope), intercept: r3(my - slope * mx), r2: sxx === 0 || syy === 0 ? null : r3((sxy * sxy) / (sxx * syy)), meanX: r3(mx), meanY: r3(my) };
}
const chainScaling = {};
for (const c of CHAINS) {
  const perScen = {}; const pts = [];
  for (const w of d.windows) {
    let ms = 0;
    for (const f of w.profile.top) if ((f.fn || '').includes(c)) ms += f.selfMs;
    if (ms > 0) { const perS = r3(ms / w.window.profileWallSec); perScen[w.scenario] = r3((perScen[w.scenario] || 0) + perS); pts.push({ x: w.ws.inboundPerS, y: perS, label: w.label }); }
  }
  chainScaling[c] = { chain: c, windowsWithHits: pts.length, totalWindows: d.windows.length, perScenarioMsPerS: perScen, fit: fit(pts), points: pts.map((p) => ({ x: r3(p.x), y: p.y, label: p.label })) };
}

// event-rate sensitivity within a scenario (rank correlation between wsInPerS and script/busy)
const sensitivity = {};
for (const [s, a] of Object.entries(scen)) {
  const ws = windows.filter((w) => w.scenario === s);
  const pairs = ws.map((w) => ({ ws: w.wsInPerS, script: w.scriptMsPerS, busy: w.profileBusyMsPerS, lt: w.ltN, raf: w.rafPerS }));
  sensitivity[s] = { points: pairs.map((p) => ({ ws: r3(p.ws), script: p.script, busy: p.busy, lt: p.lt, raf: r3(p.raf) })), fitScriptVsWs: fit(pairs.map((p) => ({ x: p.ws, y: p.script }))), fitBusyVsWs: fit(pairs.map((p) => ({ x: p.ws, y: p.busy }))), fitLtVsWs: fit(pairs.map((p) => ({ x: p.ws, y: p.lt }))) };
}

const summary = { generatedAt: new Date().toISOString(), source: `campaign-${STAMP}.json`, meta: d.meta, errors: d.errors, anchorProof, scen, chainScaling, sensitivity, windows };
fs.writeFileSync(path.join(OUT, `analysis-${STAMP}.json`), JSON.stringify(summary, null, 2));

// -------- text digest
const L = [];
const P = (s) => { L.push(s); console.log(s); };
P(`# cpu-profile analysis ${STAMP}`);
P(`windows=${d.windows.length} errors=${JSON.stringify(d.errors)}`);
P(`meta=${JSON.stringify({ longSession: d.meta.longSession, streamSource: d.meta.streamSource, winMs: d.meta.winMs, reps: d.meta.reps, unitNote: d.meta.unitNote })}`);
P('\n## anchor-symbol proof (real runtime symbols captured in the CDP profile)');
for (const p of Object.values(anchorProof)) P(`  ${p.symbol.padEnd(26)} windows=${String(p.windows).padStart(3)} selfMs=${String(p.selfMs).padStart(9)} maxMsPerS=${String(p.maxPerS).padStart(8)} lines=${JSON.stringify(p.lines)} regions=${JSON.stringify(p.regions)}`);
P('\n## per-scenario (averages over windows; script/task/recalc/layout are main-thread CDP metrics)');
P('scenario               n ok | script/s med max | task/s recalc/s layout/s | profileBusy/s ratio | wsIn/s max | raf/s >50 >100 p99max | ltN ltMax lafN | mut setProp | nodes');
for (const a of Object.values(scen)) P(`${a.scenario.padEnd(22)} ${String(a.n).padStart(2)} ${String(a.ok).padStart(2)} | ${String(a.scriptMsPerS).padStart(8)} ${String(a.scriptMedian).padStart(5)} ${String(a.scriptMax).padStart(5)} | ${String(a.taskMsPerS).padStart(6)} ${String(a.recalcMsPerS).padStart(8)} ${String(a.layoutMsPerS).padStart(8)} | ${String(a.profileBusyMsPerS).padStart(14)} ${String(a.ratioAvg).padStart(5)} | ${String(a.wsInPerS).padStart(7)} ${String(a.wsInMax).padStart(6)} | ${String(a.rafPerS).padStart(5)} ${String(a.rafOver50).padStart(4)} ${String(a.rafOver100).padStart(4)} ${String(a.rafMaxSeen).padStart(7)} | ${String(a.ltN).padStart(3)} ${String(a.ltMaxSeen).padStart(5)} ${String(a.lafN).padStart(4)} | ${String(a.mut).padStart(5)} ${String(a.setProps).padStart(7)} | ${String(a.nodesAvg).padStart(5)}`);
P('\n## top app functions per scenario (ms/s summed over windows)');
for (const a of Object.values(scen)) P(`  ${a.scenario.padEnd(22)} ${JSON.stringify(a.topFns.slice(0, 6))}`);
P('\n## bundles per scenario (self ms/s)');
for (const a of Object.values(scen)) P(`  ${a.scenario.padEnd(22)} ${JSON.stringify(a.bundles.slice(0, 6))}`);
P('\n## named-chain scaling vs inbound WS frames/s');
for (const c of Object.values(chainScaling)) P(`  ${c.chain.padEnd(26)} hits=${String(c.windowsWithHits).padStart(2)}/${c.totalWindows} slope=${String(c.fit.slope).padStart(9)} r2=${String(c.fit.r2).padStart(7)} perScen=${JSON.stringify(c.perScenarioMsPerS)}`);
P('\n## per-window detail');
for (const w of windows) {
  P(`\n--- ${w.label} [${w.scenario}] ${w.profiledSec}s page=${w.page} session=${w.session} tab=${w.tab} action=${w.action ? w.action.action : '-'}`);
  P(`    nodes=${w.nodes} wsIn=${w.wsIn} (${w.wsInPerS}/s) ${JSON.stringify(w.byKind)}`);
  P(`    script=${w.scriptMs}ms (${w.scriptMsPerS}/s) task=${w.taskMs}ms (${w.taskMsPerS}/s) recalc=${w.recalcMs}ms (${w.recalcMsPerS}/s, n=${w.recalcCount}) layout=${w.layoutMs}ms (n=${w.layoutCount})`);
  P(`    profileBusy=${w.profileBusyMs}ms (${w.profileBusyMsPerS}/s) ratio(busy/script+recalc)=${w.ratio}`);
  P(`    raf=${w.rafPerS}/s p50=${w.rafP50} p95=${w.rafP95} p99=${w.rafP99} max=${w.rafMax} >50=${w.rafOver50} >100=${w.rafOver100}`);
  P(`    longtasks n=${w.ltN} max=${w.ltMaxMs}ms total=${w.ltTotalMs}ms laf=${w.lafN} mut=${w.mutRecords} setProps=${w.setProps} topMutTargets=${JSON.stringify(w.mutTargets)}`);
  P(`    top30:`);
  for (const f of w.top30) P(`      ${String(f.msPerS).padStart(9)} ms/s ${String(f.selfMs).padStart(9)}ms ${String(f.selfPct).padStart(6)}%  ${f.fn} @${f.url}:${f.line}${f.region ? '  <' + f.region + '>' : ''}${f.v8 ? ' [v8]' : ''}`);
}
fs.writeFileSync(path.join(OUT, `analysis-${STAMP}.txt`), L.join('\n'));
P(`\nwritten: out/analysis-${STAMP}.json , out/analysis-${STAMP}.txt`);
