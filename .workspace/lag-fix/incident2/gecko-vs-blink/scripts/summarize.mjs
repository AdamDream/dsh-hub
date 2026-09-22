#!/usr/bin/env node
/*
 * summarize.mjs — aggregate the raw run JSONs into the comparison table.
 * Reads raw/run-*.json (plus checks DPR self-proof and injection evidence),
 * emits raw/summary.json and prints a markdown table.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const arg = (n, d = null) => { const h = process.argv.find((a) => a === `--${n}` || a.startsWith(`--${n}=`)); return !h ? d : (h.includes('=') ? h.slice(h.indexOf('=') + 1) : true); };
const RAW = path.resolve(ROOT, String(arg('dir', 'raw')));
const OUT = path.resolve(ROOT, String(arg('out', 'raw/summary.json')));

const files = fs.readdirSync(RAW).filter((f) => /^run-.*\.json$/.test(f)).sort();

/** per-event tick cost from raw driver counters */
function tickOf(j) {
  const st = (j.metrics && j.metrics.scenarioTicks) || {};
  const n = st.tickN || 0;
  const mean = n ? +(st.tickTotal / n).toFixed(4) : null;
  const s = (st.tickSamples || []).slice().sort((a, b) => a - b);
  const p95 = s.length ? s[Math.min(s.length - 1, Math.round((s.length - 1) * 0.95))] : null;
  return { n, mean, p95, max: st.tickMax == null ? null : st.tickMax };
}
const runs = [];
for (const f of files) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
    if (!j.ok) continue;
    const cellMatch = /^run-([a-z]+)-dpr(\d)-(.+)-r(\d+)(-reflow)?\.json$/.exec(f);
    runs.push({
      file: f,
      engine: j.cfg.engine === 'firefox' ? 'Gecko' : 'Blink',
      engineKey: j.cfg.engine,
      dpr: j.cfg.dpr,
      cell: j.cfg.cell,
      target: j.cfg.target,
      rep: j.cfg.rep,
      reflow: !!j.cfg.reflow,
      url: j.url,
      p50: j.frameStats.collectorFrames.p50,
      p95: j.frameStats.collectorFrames.p95,
      p99: j.frameStats.collectorFrames.p99,
      max: j.frameStats.collectorFrames.max,
      mean: j.frameStats.collectorFrames.mean,
      frames: j.frameStats.collectorFrames.n,
      over50: j.frameStats.collectorFrames.over50,
      pageP50: j.frameStats.pageFrames.p50,
      rafJsMean: j.rafJsTime && j.rafJsTime.meanMs,
      rafJsTotal: j.rafJsTime && j.rafJsTime.totalMs,
      rafJsMax: j.rafJsTime && j.rafJsTime.maxMs,
      rafJsP95: j.rafJsTime && j.rafJsTime.p95Ms,
      rafJsP99: j.rafJsTime && j.rafJsTime.p99Ms,
      rafOver167: j.rafJsTime && j.rafJsTime.over16_7ms,
      rafOver33: j.rafJsTime && j.rafJsTime.over33_3ms,
      budgetExceedPct: j.rafJsTime && j.rafJsTime.budgetExceedPct,
      domNodes: j.metrics.domNodes,
      dprReadBack: j.dprSelfProof.devicePixelRatioReadBack,
      inner: [j.dprSelfProof.innerWidth, j.dprSelfProof.innerHeight],
      canvas: j.dprSelfProof.canvasBacking,
      ticks: (j.metrics.scenarioTicks && j.metrics.scenarioTicks.ticks) || null,
      moves: (j.metrics.scenarioTicks && j.metrics.scenarioTicks.moves) || null,
      trayOpens: j.metrics.scenarioTicks && j.metrics.scenarioTicks.state ? j.metrics.scenarioTicks.state.over : null,
      /* per-input-event handling cost, derived from the raw counters the driver
       * always persists (tickTotal/tickN/tickSamples) — the computed fields are
       * not relied on. */
      tickMean: tickOf(j).mean, tickP95: tickOf(j).p95, tickMax: tickOf(j).max,
      tickN: tickOf(j).n,
      reflowMean: j.metrics.scenarioTicks && j.metrics.scenarioTicks.reflowMeanMs,
      reflowMax: j.metrics.scenarioTicks && j.metrics.scenarioTicks.reflowMaxMs,
      reflowN: j.metrics.scenarioTicks && j.metrics.scenarioTicks.reflowN,
      longtaskCount: j.longTasks.count,
      loafCount: j.loaf.count,
      loadavg: j.loadavgBefore,
      cdpDelta: j.cdp && j.cdp.delta ? j.cdp.delta : null,
      cdpAbsent: j.cdp && j.cdp.fieldsExplicitlyAbsent ? j.cdp.fieldsExplicitlyAbsent : null,
      cdpKeys: j.cdp && j.cdp.keysPresent ? j.cdp.keysPresent : null,
      cdpWindowMs: j.cdp && j.cdp.metricsWindowMs,
      wallMs: j.metrics && j.metrics.scenarioTicks ? j.metrics.scenarioTicks.elapsedMs : null,
      gfxLines: (j.engineProbe && j.engineProbe.gfxLines) || null,
      launchFlags: j.engineProbe && j.engineProbe.launchFlags ? j.engineProbe.launchFlags : null,
      userJs: j.engineProbe && j.engineProbe.userJs ? j.engineProbe.userJs : null,
      injection: (j.engineProbe && j.engineProbe.injection) || null,
    });
  } catch (e) { console.error('skip ' + f + ': ' + e.message); }
}

const med = (a) => { const s = a.filter((v) => v != null).sort((x, y) => x - y); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : +((s[m - 1] + s[m]) / 2).toFixed(4); };
const rng = (a) => { const s = a.filter((v) => v != null); return s.length ? [Math.min(...s), Math.max(...s)] : null; };
const ratio = (a, b) => (a == null || b == null || b === 0) ? null : +(a / b).toFixed(3);

/* group key */
const key = (r) => `${r.engineKey}|${r.cell}|${r.target}|dpr${r.dpr}${r.reflow ? '|reflow' : ''}`;
const groups = {};
for (const r of runs) (groups[key(r)] ||= []).push(r);

const table = [];
for (const [k, rs] of Object.entries(groups)) {
  const g = {
    key: k, engine: rs[0].engine, engineKey: rs[0].engineKey, cell: rs[0].cell, target: rs[0].target,
    dpr: rs[0].dpr, reflow: rs[0].reflow, reps: rs.length,
    p50: rs.map((r) => r.p50), p95: rs.map((r) => r.p95), p99: rs.map((r) => r.p99), max: rs.map((r) => r.max),
    over50: rs.map((r) => r.over50), frames: rs.map((r) => r.frames),
    rafJsMean: rs.map((r) => r.rafJsMean), rafJsTotal: rs.map((r) => r.rafJsTotal), rafJsMax: rs.map((r) => r.rafJsMax),
    rafJsP95: rs.map((r) => r.rafJsP95), rafJsP99: rs.map((r) => r.rafJsP99),
    rafOver167: rs.map((r) => r.rafOver167), rafOver33: rs.map((r) => r.rafOver33),
    budgetExceedPct: rs.map((r) => r.budgetExceedPct),
    reflowMean: rs.map((r) => r.reflowMean), reflowMax: rs.map((r) => r.reflowMax),
    tickMean: rs.map((r) => r.tickMean), tickP95: rs.map((r) => r.tickP95), tickMax: rs.map((r) => r.tickMax), tickN: rs.map((r) => r.tickN),
    domNodes: rs.map((r) => r.domNodes), ticks: rs.map((r) => r.ticks),
    dprReadBack: rs.map((r) => r.dprReadBack), canvas: rs.map((r) => r.canvas),
    median: {}, range: {},
  };
  for (const f of ['p50', 'p95', 'p99', 'max', 'rafJsMean', 'rafJsTotal', 'rafJsMax', 'rafJsP95', 'rafJsP99', 'rafOver167', 'rafOver33', 'budgetExceedPct', 'reflowMean', 'reflowMax', 'tickMean', 'tickP95', 'tickMax', 'tickN', 'frames', 'over50', 'domNodes', 'ticks']) {
    g.median[f] = med(g[f]); g.range[f] = rng(g[f]);
  }
  table.push(g);
}

/* cross-engine ratio per (cell,dpr,reflow) */
const pairs = [];
const cellset = new Set(table.map((g) => `${g.cell}|${g.target}|dpr${g.dpr}|${g.reflow}`));
for (const cs of cellset) {
  const [cell, target, dprS, rf] = cs.split('|');
  const b = table.find((g) => g.engineKey === 'chromium' && `${g.cell}|${g.target}|dpr${g.dpr}|${g.reflow}` === cs);
  const f = table.find((g) => g.engineKey === 'firefox' && `${g.cell}|${g.target}|dpr${g.dpr}|${g.reflow}` === cs);
  if (!b || !f) continue;
  pairs.push({
    cell, target, dpr: +dprS.replace('dpr', ''), reflow: rf === 'true',
    reps: { blink: b.reps, gecko: f.reps },
    blink: { p50: b.median.p50, p95: b.median.p95, p99: b.median.p99, max: b.median.max, rafJsMean: b.median.rafJsMean, rafJsP95: b.median.rafJsP95, rafOver167: b.median.rafOver167, budgetExceedPct: b.median.budgetExceedPct, reflowMean: b.median.reflowMean, tickMean: b.median.tickMean, tickP95: b.median.tickP95, frames: b.median.frames },
    gecko: { p50: f.median.p50, p95: f.median.p95, p99: f.median.p99, max: f.median.max, rafJsMean: f.median.rafJsMean, rafJsP95: f.median.rafJsP95, rafOver167: f.median.rafOver167, budgetExceedPct: f.median.budgetExceedPct, reflowMean: f.median.reflowMean, tickMean: f.median.tickMean, tickP95: f.median.tickP95, frames: f.median.frames },
    geckoOverBlink: {
      p50: ratio(f.median.p50, b.median.p50),
      p95: ratio(f.median.p95, b.median.p95),
      p99: ratio(f.median.p99, b.median.p99),
      max: ratio(f.median.max, b.median.max),
      rafJsMean: ratio(f.median.rafJsMean, b.median.rafJsMean),
      reflowMean: ratio(f.median.reflowMean, b.median.reflowMean),
      tickMean: ratio(f.median.tickMean, b.median.tickMean),
      tickMax: ratio(f.median.tickMax, b.median.tickMax),
      tickP95: ratio(f.median.tickP95, b.median.tickP95),
      rafJsP95: ratio(f.median.rafJsP95, b.median.rafJsP95),
      frames: ratio(f.median.frames, b.median.frames),
    },
    blinkRange: { p50: b.range.p50, rafJsMean: b.range.rafJsMean, reflowMean: b.range.reflowMean, tickMean: b.range.tickMean },
    geckoRange: { p50: f.range.p50, rafJsMean: f.range.rafJsMean, reflowMean: f.range.reflowMean, tickMean: f.range.tickMean },
  });
}

/* within-engine DPR effect (dpr2 / dpr1) */
const dprEffects = [];
for (const engineKey of ['chromium', 'firefox']) {
  const cells = new Set(table.filter((g) => g.engineKey === engineKey).map((g) => `${g.cell}|${g.target}|${g.reflow}`));
  for (const cs of cells) {
    const g1 = table.find((g) => g.engineKey === engineKey && `${g.cell}|${g.target}|${g.reflow}` === cs && g.dpr === 1);
    const g2 = table.find((g) => g.engineKey === engineKey && `${g.cell}|${g.target}|${g.reflow}` === cs && g.dpr === 2);
    if (!g1 || !g2) continue;
    const [cell, target, rf] = cs.split('|');
    dprEffects.push({
      engine: g1.engine, cell, target, reflow: rf === 'true',
      dpr1: { p50: g1.median.p50, p95: g1.median.p95, max: g1.median.max, rafJsMean: g1.median.rafJsMean, frames: g1.median.frames, canvas: g1.canvas[0] },
      dpr2: { p50: g2.median.p50, p95: g2.median.p95, max: g2.median.max, rafJsMean: g2.median.rafJsMean, frames: g2.median.frames, canvas: g2.canvas[0] },
      factor: {
        p50: ratio(g2.median.p50, g1.median.p50), p95: ratio(g2.median.p95, g1.median.p95),
        max: ratio(g2.median.max, g1.median.max), rafJsMean: ratio(g2.median.rafJsMean, g1.median.rafJsMean),
        frames: ratio(g2.median.frames, g1.median.frames),
        canvasPixels: ratio(g2.canvas[0] ? g2.canvas[0][0] * g2.canvas[0][1] : null, g1.canvas[0] ? g1.canvas[0][0] * g1.canvas[0][1] : null),
      },
    });
  }
}

/* DPR self-proof audit */
const dprProof = runs.map((r) => ({
  file: r.file, engine: r.engine, dprRequested: r.dpr, dprReadBack: r.dprReadBack,
  match: r.dprReadBack === r.dpr, inner: r.inner, canvas: r.canvas,
  injection: r.injection ? { mc: r.injection.mc, drv: r.injection.drv } : null,
}));

const summary = {
  schema: 'gvb.summary/1',
  generatedAt: new Date().toISOString(),
  runCount: runs.length,
  groups: table.map((g) => ({ ...g, values: undefined, p50: undefined, p95: undefined, p99: undefined, max: undefined, over50: undefined, frames: undefined, rafJsMean: undefined, rafJsTotal: undefined, rafJsMax: undefined, reflowMean: undefined, reflowMax: undefined, domNodes: undefined, ticks: undefined, dprReadBack: undefined, canvas: undefined, range: undefined, median: g.median, ranges: g.range })),
  crossEngine: pairs.sort((a, b) => (a.cell + a.dpr + a.reflow).localeCompare(b.cell + b.dpr + b.reflow)),
  dprEffects,
  dprProof,
  cdpMetricKeys: [...new Set(runs.flatMap((r) => r.cdpKeys || []))].sort(),
  cdpAbsentFields: [...new Set(runs.flatMap((r) => r.cdpAbsent || []))].sort(),
  runs,
};

fs.writeFileSync(OUT, JSON.stringify(summary, null, 1));

/* ---- print ---- */
console.log('# groups\n');
console.log('| engine | cell | target | dpr | reflow | reps | p50 (range) | p95 | p99 | max | >50ms | frames | rafJs mean | rafJs p95 | raf>16.7ms | exceed% | reflow mean | tick mean | domNodes |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const g of table.sort((a, b) => (a.engine + a.cell + a.dpr).localeCompare(b.engine + b.cell + b.dpr))) {
  console.log(`| ${g.engine} | ${g.cell} | ${g.target} | ${g.dpr} | ${g.reflow} | ${g.reps} | ${g.median.p50} [${(g.range.p50 || []).join(', ')}] | ${g.median.p95} | ${g.median.p99} | ${g.median.max} | ${g.median.over50} | ${g.median.frames} | ${g.median.rafJsMean} | ${g.median.rafJsP95} | ${g.median.rafOver167} | ${g.median.budgetExceedPct} | ${g.median.reflowMean ?? '-'} | ${g.median.tickMean ?? '-'} | ${g.median.domNodes} |`);
}
console.log('\n# Gecko / Blink ratios (median of reps)\n');
console.log('| cell | target | dpr | reflow | p50 | p95 | p99 | max | rafJs mean | rafJs p95 | reflow mean | tick mean | tick max | frames |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const p of pairs) {
  console.log(`| ${p.cell} | ${p.target} | ${p.dpr} | ${p.reflow} | ${p.geckoOverBlink.p50} | ${p.geckoOverBlink.p95} | ${p.geckoOverBlink.p99} | ${p.geckoOverBlink.max} | ${p.geckoOverBlink.rafJsMean} | ${p.geckoOverBlink.rafJsP95} | ${p.geckoOverBlink.reflowMean ?? '-'} | ${p.geckoOverBlink.tickMean ?? '-'} | ${p.geckoOverBlink.tickMax ?? '-'} | ${p.geckoOverBlink.frames} |`);
}
console.log('\n# DPR factor (dpr2 / dpr1, per engine)\n');
console.log('| engine | cell | target | p50 | p95 | max | rafJs mean | frames | canvasArea x |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const d of dprEffects) {
  console.log(`| ${d.engine} | ${d.cell} | ${d.target} | ${d.factor.p50} | ${d.factor.p95} | ${d.factor.max} | ${d.factor.rafJsMean} | ${d.factor.frames} | ${d.factor.canvasPixels} |`);
}
const bad = dprProof.filter((d) => !d.match);
console.log(`\nDPR self-proof: ${dprProof.length - bad.length}/${dprProof.length} runs read back exactly the requested devicePixelRatio`, bad.length ? 'MISMATCHES: ' + JSON.stringify(bad) : '');
console.log('\nCDP metric keys seen (Blink): ' + JSON.stringify(summary.cdpMetricKeys));
console.log('CDP fields explicitly ABSENT in headless (never fabricated): ' + JSON.stringify(summary.cdpAbsentFields));
console.log('\n-> ' + OUT);
