// Analyse a cpu-profile campaign JSON: per-window top-30 self time, bundle
// attribution, named-chain totals, event-rate scaling, and anchor-symbol proof.
import fs from 'node:fs';
import path from 'node:path';

const BASE = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/cpu-profile';
const OUT = path.join(BASE, 'out');
const argv = process.argv.slice(2);
const STAMP = argv[0] || 'cpu2';
const src = path.join(OUT, `campaign-${STAMP}.json`);
const d = JSON.parse(fs.readFileSync(src, 'utf8'));

const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const avg = (a) => (a.length ? r3(a.reduce((x, y) => x + y, 0) / a.length) : null);
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return r3(s[Math.floor((s.length - 1) * 0.5)]); };
const sum = (a) => r3(a.reduce((x, y) => x + y, 0));

// ---------- source region map for the deployed runtime bundle (line -> source file)
const RUNTIME_LIB = '/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js';
let regions = [];
try {
  const lines = fs.readFileSync(RUNTIME_LIB, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) { const m = /\/\/#region\s+(.+)$/.exec(lines[i]); if (m) regions.push({ line: i + 1, file: m[1].trim() }); }
} catch { }
const regionOf = (line) => { let best = null; for (const r of regions) { if (r.line <= line) best = r; else break; } return best ? best.file : null; };

// ---------- anchor symbols
const ANCHORS = ['buildListSnapshot', 'projectList', 'flattenLineage', 'markDirty', 'ensureFresh', 'applyMutation', 'recordMutation', 'syncCompletedNotifications', 'rebuildRemote', 'querySelectorAll'];
const anchorProof = {};
for (const w of d.windows) {
  for (const f of w.profile.selfTop) for (const a of ANCHORS) {
    if (!(f.fn || '').includes(a)) continue;
    if (!anchorProof[a]) anchorProof[a] = { symbol: a, windows: 0, selfMs: 0, maxPerS: 0, urls: new Set(), lines: new Set(), scenarioPerS: {} };
    const p = anchorProof[a];
    p.windows++; p.selfMs = r3(p.selfMs + f.selfMs);
    const perS = r3(f.selfMs / w.window.profiledSec);
    p.maxPerS = Math.max(p.maxPerS, perS);
    p.scenarioPerS[w.scenario] = r3((p.scenarioPerS[w.scenario] || 0) + perS);
    p.urls.add(f.url || '(none)'); p.lines.add(f.line);
  }
}
for (const a of Object.values(anchorProof)) {
  a.urls = [...a.urls].slice(0, 3); a.lines = [...a.lines].slice(0, 6);
  a.regionByLine = a.lines.map((l) => ({ line: l, region: regionOf(l) }));
}

// ---------- per-scenario summary
const scenAgg = {};
for (const w of d.windows) {
  const s = w.scenario;
  if (!scenAgg[s]) scenAgg[s] = { scenario: s, n: 0, pages: {}, script: [], task: [], recalc: [], layout: [], rafPerS: [], rafOver50: 0, rafOver100: 0, rafMax: [], ltN: 0, ltPerS: [], ltMax: [], wsIn: [], wsInTotal: 0, byKind: {}, byPayloadType: {}, nodes: [], mutRec: [], jsListeners: [], samples: [], gapWindows: 0 };
  const a = scenAgg[s]; a.n++;
  a.pages[w.meta.page] = (a.pages[w.meta.page] || 0) + 1;
  a.script.push(w.cdp.ScriptMsPerS); a.task.push(w.cdp.TaskMsPerS); a.recalc.push(w.cdp.RecalcMsPerS); a.layout.push(w.cdp.LayoutMsPerS);
  a.rafPerS.push(w.raf.perS); a.rafOver50 += w.raf.intervals.over50; a.rafOver100 += w.raf.intervals.over100;
  if (w.raf.intervals.max != null) a.rafMax.push(w.raf.intervals.max);
  a.ltN += w.longtasks.n; a.ltPerS.push(w.longtasks.perS); if (w.longtasks.maxMs != null) a.ltMax.push(w.longtasks.maxMs);
  a.wsIn.push(w.ws.inboundPerS); a.wsInTotal += w.ws.dirs.in;
  for (const [k, v] of Object.entries(w.ws.byKind || {})) a.byKind[k] = (a.byKind[k] || 0) + v;
  for (const [k, v] of Object.entries(w.ws.byPayloadType || {})) a.byPayloadType[k] = (a.byPayloadType[k] || 0) + v;
  a.nodes.push(w.state.nodes); a.mutRec.push(w.mutations.records);
  a.jsListeners.push(w.cdp.JSEventListeners); a.samples.push(w.profile.sampleCount);
  if (!(w.integrity.rafExpected && w.integrity.rafRateSane && w.integrity.muReady && w.integrity.observerAlive)) a.gapWindows++;
}
for (const a of Object.values(scenAgg)) {
  a.scriptMsPerS = avg(a.script); a.scriptMedian = med(a.script); a.scriptMax = a.script.length ? r3(Math.max(...a.script)) : null;
  a.taskMsPerS = avg(a.task); a.recalcMsPerS = avg(a.recalc); a.layoutMsPerS = avg(a.layout);
  a.rafPerS_avg = avg(a.rafPerS); a.rafMaxSeen = a.rafMax.length ? r3(Math.max(...a.rafMax)) : null;
  a.ltPerS_avg = avg(a.ltPerS); a.ltMaxSeen = a.ltMax.length ? r3(Math.max(...a.ltMax)) : null;
  a.wsInPerS_avg = avg(a.wsIn); a.wsInPerSMax = a.wsIn.length ? r3(Math.max(...a.wsIn)) : null;
  a.nodes_avg = avg(a.nodes); a.jsListenersLast = a.jsListeners[a.jsListeners.length - 1]; a.samples_avg = avg(a.samples);
  a.totalSeconds = r3(a.n * 12);
  for (const k of Object.keys(a.byKind)) a.byKind[k + '/s'] = r3(a.byKind[k] / a.totalSeconds);
}

// ---------- per-window top-30 (app functions; V8 internal buckets marked)
const V8_INTERNAL = /^\((?:idle|program|garbage collector|root|no name|unlinked)\)$/;
const windows = d.windows.map((w) => ({
  label: w.label, scenario: w.scenario, profiledSec: w.window.profiledSec, startISO: w.window.startISO, endISO: w.window.endISO,
  page: w.meta.page, session: w.meta.session || null, tab: w.state.activeSettingsTab || null, action: w.window.action || null,
  nodes: w.state.nodes, wsIn: w.ws.dirs.in, wsInPerS: w.ws.inboundPerS, wsOut: w.ws.dirs.out, byKind: w.ws.byKind, byPayloadType: w.ws.byPayloadType,
  scriptMsPerS: w.cdp.ScriptMsPerS, taskMsPerS: w.cdp.TaskMsPerS, recalcMsPerS: w.cdp.RecalcMsPerS, layoutMsPerS: w.cdp.LayoutMsPerS,
  scriptMs: w.cdp.ScriptDuration, taskMs: w.cdp.TaskDuration, recalcMs: w.cdp.RecalcStyleDuration, layoutMs: w.cdp.LayoutDuration,
  nodesDelta: w.cdp.NodesDelta, jsListeners: w.cdp.JSEventListeners,
  rafPerS: w.raf.perS, rafP50: w.raf.intervals.p50, rafP95: w.raf.intervals.p95, rafP99: w.raf.intervals.p99, rafMax: w.raf.intervals.max, rafOver50: w.raf.intervals.over50, rafOver100: w.raf.intervals.over100,
  ltN: w.longtasks.n, ltPerS: w.longtasks.perS, ltMaxMs: w.longtasks.maxMs, ltTotalMs: w.longtasks.totalMs, ltTop: w.longtasks.top,
  mutRecords: w.mutations.records, mutAdded: w.mutations.added, mutAttrs: w.mutations.attrs, mutChars: w.mutations.chars, mutTargets: w.mutations.topTargets,
  eventTiming: w.eventTiming, clickToPaint: w.clickToPaint.stats,
  samples: w.profile.sampleCount, intervalUs: w.profile.intervalUs,
  integrity: w.integrity,
  top30: w.profile.selfTop.slice(0, 30).map((f) => ({ fn: f.fn, url: (f.url || '').split('/').pop(), line: f.line, selfMs: f.selfMs, selfPct: f.selfPct, msPerS: r3(f.selfMs / w.window.profiledSec), v8internal: V8_INTERNAL.test(f.fn), region: regionOf(f.line) })),
  bundles: w.profile.bundles.map((b) => ({ bundle: b.bundle, selfMs: b.selfMs, selfMsPerS: r3(b.selfMs / w.window.profiledSec), samples: b.samples, fns: b.fns })),
}));

// ---------- event-rate scaling (linear fit of chain ms/s against inbound WS frames/s)
const CHAINS = ['buildListSnapshot', 'projectList', 'flattenLineage', 'markDirty', 'rebuildRemote', 'querySelectorAll', 'ensureFresh', 'getListSnapshot', 'applyMutation', 'recordMutation', 'syncCompletedNotifications', 'im', 'render', 'apply'];
function fit(points) {
  const n = points.length; if (n < 3) return { n, slope: null, intercept: null, r2: null };
  const mx = avg(points.map((p) => p.x)); const my = avg(points.map((p) => p.y));
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of points) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const r2 = sxx === 0 || syy === 0 ? null : (sxy * sxy) / (sxx * syy);
  return { n, slope: r3(slope), intercept: r3(my - slope * mx), r2: r3(r2), mx: r3(mx), my: r3(my) };
}
const scaling = {};
for (const c of CHAINS) {
  const pts = [];
  for (const w of d.windows) {
    let ms = 0;
    for (const f of w.profile.selfTop) if ((f.fn || '').includes(c)) ms += f.selfMs;
    if (ms > 0) pts.push({ x: w.ws.inboundPerS, y: r3(ms / w.window.profiledSec), label: w.label, scen: w.scenario });
  }
  const perScen = {};
  for (const w of d.windows) { let ms = 0; for (const f of w.profile.selfTop) if ((f.fn || '').includes(c)) ms += f.selfMs; perScen[w.scenario] = r3((perScen[w.scenario] || 0) + ms / w.window.profiledSec); }
  scaling[c] = { chain: c, windowsWithHits: pts.length, totalWindows: d.windows.length, perScenarioPerS: perScen, fit: fit(pts), points: pts.map((p) => ({ x: r3(p.x), y: p.y, label: p.label })) };
}

// ---------- runtime / C2 bundle attribution per scenario
const bundleByScen = {};
for (const w of d.windows) {
  const s = w.scenario; bundleByScen[s] = bundleByScen[s] || {};
  for (const b of w.profile.bundles) bundleByScen[s][b.bundle] = r3((bundleByScen[s][b.bundle] || 0) + b.selfMs / w.window.profiledSec);
}
const bundleTable = {};
for (const [s, m] of Object.entries(bundleByScen)) bundleTable[s] = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 12);

const summary = {
  generatedAt: new Date().toISOString(), source: src, meta: d.meta, errors: d.errors,
  anchorProof, regionOfHotLines: [...new Set(windows.flatMap((w) => w.top30.filter((f) => f.url.includes('dsh-client-runtime')).map((f) => f.line)))].slice(0, 40).map((l) => ({ line: l, region: regionOf(l) })),
  scenAgg, bundleTable, scaling, windows,
};
fs.writeFileSync(path.join(OUT, `analysis-${STAMP}.json`), JSON.stringify(summary, null, 2));

// ---------------- console digest
console.log('# campaign', STAMP, '|', d.meta.stamp, '| windows:', d.windows.length, '| errors:', JSON.stringify(d.errors));
console.log('\n## anchor-symbol proof (captured in CDP profile, top-200 self-time per window)');
for (const a of Object.values(anchorProof)) console.log(`  ${a.symbol.padEnd(26)} windows=${String(a.windows).padStart(3)} selfMs=${String(a.selfMs).padStart(9)} maxPerS=${String(a.maxPerS).padStart(8)} urls=${JSON.stringify(a.urls)} lines=${JSON.stringify(a.lines)} regions=${JSON.stringify(a.regionByLine.map((x) => x.region))}`);

console.log('\n## per-scenario summary');
console.log('scenario                  n  gap script/s  med  max | task/s recalc/s layout/s | wsIn/s max | raf/s >50 >100 p99max | ltN lt/s ltMax | mutRec | nodes | samples');
for (const a of Object.values(scenAgg)) {
  console.log(`${a.scenario.padEnd(24)} ${String(a.n).padStart(2)} ${String(a.gapWindows).padStart(3)} ${String(a.scriptMsPerS).padStart(7)} ${String(a.scriptMedian).padStart(5)} ${String(a.scriptMax).padStart(5)} | ${String(a.taskMsPerS).padStart(6)} ${String(a.recalcMsPerS).padStart(7)} ${String(a.layoutMsPerS).padStart(8)} | ${String(a.wsInPerS_avg).padStart(7)} ${String(a.wsInPerSMax).padStart(6)} | ${String(a.rafPerS_avg).padStart(5)} ${String(a.rafOver50).padStart(4)} ${String(a.rafOver100).padStart(4)} ${String(a.rafMaxSeen).padStart(6)} | ${String(a.ltN).padStart(3)} ${String(a.ltPerS_avg).padStart(5)} ${String(a.ltMaxSeen).padStart(5)} | ${String(sum(a.mutRec)).padStart(6)} | ${String(a.nodes_avg).padStart(5)} | ${String(a.samples_avg).padStart(6)}`);
}

console.log('\n## bundle self-time per second (top per scenario)');
for (const [s, tab] of Object.entries(bundleTable)) console.log(`  ${s.padEnd(24)} ${JSON.stringify(tab.slice(0, 7))}`);

console.log('\n## named-chain scaling vs inbound WS frames/s');
for (const c of Object.values(scaling)) console.log(`  ${c.chain.padEnd(26)} hits=${String(c.windowsWithHits).padStart(2)}/${c.totalWindows} slope=${String(c.fit.slope).padStart(9)} ms/s per frame/s r2=${String(c.fit.r2).padStart(7)} perScen=${JSON.stringify(c.perScenarioPerS)}`);

console.log('\n## per-window top-30 (first 3 windows + any >=0.2ms/s app fn)');
for (const w of windows) {
  console.log(`\n--- ${w.label} [${w.scenario}] ${w.profiledSec}s page=${w.page} tab=${w.tab} action=${w.action ? w.action.action : '-'} nodes=${w.nodes} wsIn/s=${w.wsInPerS} script/s=${w.scriptMsPerS} mit=${w.integrity.observerAlive ? 'obsOK' : 'obs?'}`);
  for (const f of w.top30) console.log(`     ${String(f.msPerS).padStart(9)} ms/s  ${String(f.selfMs).padStart(9)} ms  ${String(f.selfPct).padStart(6)}%  ${f.fn} @${f.url}:${f.line}${f.region ? '  <' + f.region + '>' : ''}${f.v8internal ? '  [v8]' : ''}`);
}
console.log('\nwritten:', path.join(OUT, `analysis-${STAMP}.json`));
