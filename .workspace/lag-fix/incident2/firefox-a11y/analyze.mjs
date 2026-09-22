/*
 * analyze.mjs — turn the raw run JSONs into the verdict table.
 *
 *   1. Every batch is analysed SEPARATELY (light vs heavy workload, headless vs
 *      headed) because batches are not comparable with each other.
 *   2. The SELF-PROOF is checked before any ratio is computed. A condition whose
 *      accessibility-state instrument never worked is never silently counted as
 *      "accessibility off".
 *   3. Ratios are a11y-ON / a11y-OFF, so >1 means accessibility cost time.
 *      Throughput metrics are inverted to keep that reading uniform.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, 'raw');
const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const hit = argv.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  if (!hit) return d;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
};
const OUT = String(flag('out', path.join(HERE, 'proof', 'verdict.json')));

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const median = (a) => {
  const s = a.filter((x) => Number.isFinite(x)).slice().sort((x, y) => x - y);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 1000) / 1000;
};
const r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
const d = (a, x, k) => (a && x && a.median[k] && x.median[k]) ? r3(x.median[k] / a.median[k]) : null;
const inv = (a, x, k) => (a && x && a.median[k] && x.median[k]) ? r3(a.median[k] / x.median[k]) : null;

const GEO_METRICS = ['build', 'mutate', 'animate', 'frameP50', 'frameP95', 'over50',
  'wallMs', 'cpuS', 'thrPerSec', 'reflowPerSec', 'domNodes'];

function rowOf(r) {
  const rep = r.result || {};
  return {
    rep: r.rep, ok: rep.ok === true,
    build: rep.phases?.build ?? null, mutate: rep.phases?.mutate ?? null,
    animate: rep.phases?.animate ?? null,
    frameP50: rep.frames?.p50 ?? null, frameP95: rep.frames?.p95 ?? null, over50: rep.frames?.over50 ?? null,
    domNodes: rep.domNodes ?? null,
    thrPerSec: rep.throughput?.perSec ?? null, thrIters: rep.throughput?.iterations ?? null,
    reflowPerSec: rep.reflow?.perSec ?? null, reflowIters: rep.reflow?.iterations ?? null,
    wallMs: r.wallMs ?? null, cpuS: r.cpuAtResult?.cpuS ?? null, cpuProcs: r.cpuAtResult?.procs ?? null,
    busOn: !!r.busOnAfterRun,
    a11yService: r.chromeReadback?.result?.a11yService ?? null,
    prefForceDisabled: r.chromeReadback?.result?.pref_force_disabled ?? null,
    envSeenByBrowser: r.chromeReadback?.result?.env ?? null,
    readbackOk: !!r.chromeReadback?.ok, readbackErr: r.chromeReadback?.error ?? null,
    loadavg: r.loadavgDuringResult ?? r.interlock?.loadavgAtRun ?? null,
    foreignProbeBrowsers: (r.interlock?.foreignProbeBrowsersBefore || []).length,
    lockStillOurs: r.interlock?.lockStillOurs ?? null,
    leftovers: (r.leftoverPids || []).length,
  };
}

function geckoBatches() {
  const out = {};
  for (const f of fs.readdirSync(RAW).filter((x) => /-matrix\.json$/.test(x))) {
    const j = readJson(path.join(RAW, f));
    if (!j || !Array.isArray(j.runs) || !j.runs.length) continue;
    const pairs = j.runs.map((r) => ({ raw: r, row: rowOf(r) }));
    out[f.replace(/-matrix\.json$/, '')] = { file: f, config: j.config, pairs };
  }
  return out;
}

function summariseGecko(tag, b) {
  const condNames = [...new Set(b.pairs.map((p) => p.raw.condition))];
  const byCondition = {};
  for (const c of condNames) {
    const rows = b.pairs.filter((p) => p.raw.condition === c).map((p) => p.row);
    const med = {};
    for (const k of GEO_METRICS) med[k] = median(rows.map((x) => x[k]));
    byCondition[c] = {
      n: rows.length, rows, median: med,
      a11yServiceRegistered: rows.filter((x) => x.a11yService === 'REGISTERED').length,
      busOn: rows.filter((x) => x.busOn).length,
    };
  }
  const readbackUsable = condNames.some((c) => byCondition[c].rows.some((x) => x.a11yService !== null));
  const busUsable = condNames.some((c) => byCondition[c].busOn > 0);
  const instrument = readbackUsable
    ? 'chrome-scope readback of @mozilla.org/accessibilityService;1'
    : (busUsable ? 'AT-SPI bus membership' : 'NONE (no instrument worked)');
  const onOff = readbackUsable ? (c) => byCondition[c].a11yServiceRegistered : (c) => byCondition[c].busOn;
  const differs = readbackUsable && condNames.some((c) => onOff(c) !== onOff(condNames[0]));
  const allOn = condNames.every((c) => onOff(c) === byCondition[c].n);
  const allOff = condNames.every((c) => onOff(c) === 0);
  const on = byCondition['env-default'], off = byCondition['pref-force-disabled'], clr = byCondition['env-cleared'];
  /* UNIFORM COST CONVENTION, so every number reads the same way:
       > 1  =>  the accessibility-ON condition cost MORE
     time metrics (build/mutate/animate/p95/wallMs/cpuS) -> ON / OFF
     throughput metrics (thrPerSec/reflowPerSec)          -> OFF / ON
     (an earlier revision had these inverted relative to its own label; that is
      recorded in audit.md rather than silently changed.) */
  const ratio = (x) => (on && x) ? Object.fromEntries(GEO_METRICS.map((k) => {
    if (k === 'domNodes') return ['ratio_' + k, d(x, on, k)];
    if (k === 'thrPerSec' || k === 'reflowPerSec') return ['costFactor_' + k, d(on, x, k)];
    return ['costFactor_' + k, inv(on, x, k)];
  })) : null;
  return {
    tag, config: b.config, conditions: condNames, byCondition,
    selfProof: {
      instrument, readbackUsable, busUsable,
      a11yRegisteredPerCondition: Object.fromEntries(condNames.map((c) => [c, `${byCondition[c].a11yServiceRegistered}/${byCondition[c].n}`])),
      busOnPerCondition: Object.fromEntries(condNames.map((c) => [c, `${byCondition[c].busOn}/${byCondition[c].n}`])),
      prefValueReadBack: Object.fromEntries(condNames.map((c) => [c, byCondition[c].rows.map((x) => x.prefForceDisabled)])),
      stateDifferedByCondition: differs, vehicleCanDiscriminate: differs,
      a11yOnInEveryCondition: allOn, a11yOffInEveryCondition: allOff,
      envSeenByBrowser: Object.fromEntries(condNames.map((c) => [c, byCondition[c].rows[0]?.envSeenByBrowser ?? null])),
      note: differs
        ? 'The accessibility engine state differed between conditions, so any timing ratio compares two genuinely different states.'
        : (instrument.startsWith('NONE')
          ? 'No accessibility-state instrument worked -> INCONCLUSIVE, no ratio reported.'
          : (allOn ? 'Accessibility ON in every condition -> conditions did not differ; timing differences are noise.'
            : 'Accessibility OFF in every condition -> this vehicle never activated the engine; it cannot measure its cost.')),
    },
    verdict: differs ? {
      basis: 'median of medians per condition; EVERY costFactor reads the same way: >1 = accessibility-ON cost more (time metrics are ON/OFF, throughput metrics are OFF/ON)',
      costFactor_envDefault_over_prefForceDisabled: ratio(off),
      costFactor_envDefault_over_envCleared: ratio(clr),
      loadavgPerRun: b.pairs.map((p) => p.row.loadavg),
      foreignProbeBrowsersPerRun: b.pairs.map((p) => p.row.foreignProbeBrowsers),
      lockHeldThroughoutBatch: b.pairs.every((p) => p.row.lockStillOurs === true),
    } : null,
  };
}

function blinkBatches() {
  const out = {};
  for (const f of fs.readdirSync(RAW).filter((x) => /^blink.*-summary\.json$/.test(x))) {
    const j = readJson(path.join(RAW, f));
    if (!j || !Array.isArray(j.runs) || !j.runs.length) continue;
    const metricKeys = ['build', 'mutate', 'animate', 'frameP50', 'frameP95', 'over50', 'domNodes',
      'thrPerSec', 'reflowPerSec', 'workloadWallMs', 'taskDurationS', 'scriptDurationS',
      'layoutDurationS', 'recalcStyleDurationS'];
    const runs = j.runs.map((r) => {
      const m = r.cdpMetrics || {};
      return {
        condition: r.condition, rep: r.rep, ok: r.result?.ok === true,
        build: r.result?.phases?.build ?? null, mutate: r.result?.phases?.mutate ?? null,
        animate: r.result?.phases?.animate ?? null,
        frameP50: r.result?.frames?.p50 ?? null, frameP95: r.result?.frames?.p95 ?? null,
        over50: r.result?.frames?.over50 ?? null, domNodes: r.result?.domNodes ?? null,
        thrPerSec: r.result?.throughput?.perSec ?? null, reflowPerSec: r.result?.reflow?.perSec ?? null,
        workloadWallMs: r.workloadWallMs ?? null,
        taskDurationS: m.TaskDuration ?? null, scriptDurationS: m.ScriptDuration ?? null,
        layoutDurationS: m.LayoutDuration ?? null, recalcStyleDurationS: m.RecalcStyleDuration ?? null,
        a11yState: r.a11yStateBeforeLines ?? null, a11yStateAfter: r.a11yStateAfterLines ?? null,
        a11yReadbackOk: !!r.a11yStateBefore?.ok, a11yReadbackErr: r.a11yStateBefore?.error ?? null,
        noSandbox: !!r.usedNoSandbox,
        lockStillOurs: r.lockStillOursAtStart ?? null, loadavg: r.loadavgDuringRun ?? null,
        flags: { forceRendererA11y: r.forceRendererA11y, envCleared: r.envCleared, args: r.launchedArgs },
      };
    });
    const condNames = [...new Set(runs.map((r) => r.condition))];
    const byCondition = {};
    for (const c of condNames) {
      const rows = runs.filter((r) => r.condition === c);
      const med = {};
      for (const k of metricKeys) med[k] = median(rows.map((x) => x[k]));
      byCondition[c] = { n: rows.length, rows, median: med };
    }
    const base = byCondition['env-default-nofag'], fag = byCondition['force-renderer'], clr = byCondition['env-cleared-nofag'];
    const cmp = (x) => (base && x) ? {
      costFactor_thrPerSec: inv(base, x, 'thrPerSec'),
      costFactor_reflowPerSec: inv(base, x, 'reflowPerSec'),
      costFactor_build: d(base, x, 'build'), costFactor_mutate: d(base, x, 'mutate'),
      costFactor_animate: d(base, x, 'animate'), costFactor_frameP95: d(base, x, 'frameP95'),
      costFactor_taskDuration: d(base, x, 'taskDurationS'),
      costFactor_layoutDuration: d(base, x, 'layoutDurationS'),
      costFactor_recalcStyle: d(base, x, 'recalcStyleDurationS'),
      costFactor_workloadWall: d(base, x, 'workloadWallMs'),
    } : null;
    out[f.replace(/-summary\.json$/, '')] = {
      tag: f, config: j.config, byCondition,
      selfProof: {
        a11yReadbackAvailable: runs.some((r) => r.a11yReadbackOk),
        a11yReadbackError: runs.find((r) => r.a11yReadbackErr)?.a11yReadbackErr ?? null,
        statePerCondition: Object.fromEntries(condNames.map((c) => [c, byCondition[c].rows.map((r) => ({ rep: r.rep, state: r.a11yState }))])),
      },
      verdict: {
        basis: 'median of medians per condition; >1 = the compared condition was SLOWER',
        forceRendererAccessibility_over_envDefault: cmp(fag),
        envCleared_over_envDefault: cmp(clr),
        loadavgPerRun: runs.map((r) => r.loadavg),
        lockHeldThroughoutBatch: runs.every((r) => r.lockStillOurs === true),
      },
    };
  }
  return out;
}

const geckoRaw = geckoBatches();
/* A batch in which no run produced a result is a FAILED ATTEMPT, not a
   measurement: keep it in the manifest with its reason, but do not let it look
   like evidence. */
for (const [t, b] of Object.entries(geckoRaw)) {
  b.failedBatch = b.pairs.every((p) => !p.row.ok);
  if (b.failedBatch) b.failureReason = b.pairs.map((p) => p.raw.abortedBatch || p.raw.notes || null).filter(Boolean).slice(0, 3);
}
const result = {
  generatedAt: new Date().toISOString(),
  gecko: Object.fromEntries(Object.entries(geckoRaw).map(([t, b]) => [t, summariseGecko(t, b)])),
  blink: blinkBatches(),
  manifest: {
    geckoBatchFiles: Object.values(geckoRaw).map((b) => b.file),
    blinkBatchFiles: fs.readdirSync(RAW).filter((x) => /^blink.*-summary\.json$/.test(x)),
  },
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(result, null, 2));

const L = [];
L.push(`# a11y cost verdict (${result.generatedAt})`);
L.push('\n## Gecko — snap Firefox 155.0.1, separate instance, throwaway profile (the user\'s Firefox untouched)');
for (const [, b] of Object.entries(result.gecko)) {
  const c = b.config || {};
  L.push(`\n### batch \`${b.tag}\` — mode=${c.mode} reps=${c.reps} rows=${c.rows} mut/frame=${c.perFrame} thrMs=${c.thrMs}`);
  if (b.failedBatch) { L.push(`> **FAILED ATTEMPT, not a measurement.** reason: ${JSON.stringify(b.failureReason)}`); continue; }
  L.push('| condition | n | a11ySvc REGISTERED | busOn | domNodes | build ms | mutate ms | animate ms | frame p95 ms | thr/s | reflow/s | wall ms | cpu s |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [name, v] of Object.entries(b.byCondition)) {
    const m = v.median;
    L.push(`| ${name} | ${v.n} | ${v.a11yServiceRegistered} | ${v.busOn} | ${m.domNodes} | ${m.build} | ${m.mutate} | ${m.animate} | ${m.frameP95} | ${m.thrPerSec} | ${m.reflowPerSec} | ${m.wallMs} | ${m.cpuS} |`);
  }
  L.push(`\n- self-proof instrument: **${b.selfProof.instrument}**`);
  L.push(`- a11y service REGISTERED per condition: ${JSON.stringify(b.selfProof.a11yRegisteredPerCondition)}`);
  L.push(`- AT-SPI bus membership per condition: ${JSON.stringify(b.selfProof.busOnPerCondition)}`);
  L.push(`- accessibility.force_disabled read back: ${JSON.stringify(b.selfProof.prefValueReadBack)}`);
  L.push(`- env the browser process actually saw: ${JSON.stringify(b.selfProof.envSeenByBrowser)}`);
  L.push(`- can discriminate: **${b.selfProof.vehicleCanDiscriminate}** — ${b.selfProof.note}`);
  if (b.verdict) {
    L.push('\n**cost factor (a11y ON / a11y OFF)**, >1 = accessibility cost time:');
    L.push('```\n' + JSON.stringify(b.verdict.costFactor_envDefault_over_prefForceDisabled, null, 1) + '\n```');
    L.push('cost factor (env-default / env-cleared):');
    L.push('```\n' + JSON.stringify(b.verdict.costFactor_envDefault_over_envCleared, null, 1) + '\n```');
    L.push(`- loadavg per run: ${JSON.stringify(b.verdict.loadavgPerRun)}`);
    L.push(`- concurrent FOREIGN probe browsers per run: ${JSON.stringify(b.verdict.foreignProbeBrowsersPerRun)}`);
    L.push(`- lock held throughout batch: ${b.verdict.lockHeldThroughoutBatch}`);
  }
}
L.push('\n## Blink — Google Chrome 153.0.8010.52 (system binary, same major as the user\'s), identical page/workload');
for (const [, b] of Object.entries(result.blink)) {
  const c = b.config || {};
  L.push(`\n### batch \`${b.tag}\` — reps=${c.reps} rows=${c.rows} thrMs=${c.thrMs}`);
  L.push('| condition | n | domNodes | build ms | mutate ms | animate ms | frame p95 ms | thr/s | reflow/s | TaskDuration s | LayoutDuration s |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [name, v] of Object.entries(b.byCondition)) {
    const m = v.median;
    L.push(`| ${name} | ${v.n} | ${m.domNodes} | ${m.build} | ${m.mutate} | ${m.animate} | ${m.frameP95} | ${m.thrPerSec} | ${m.reflowPerSec} | ${m.taskDurationS} | ${m.layoutDurationS} |`);
  }
  L.push(`\n- chrome://accessibility readback available: ${b.selfProof.a11yReadbackAvailable}${b.selfProof.a11yReadbackError ? ' (error: ' + b.selfProof.a11yReadbackError + ')' : ''}`);
  L.push('- ratios:\n```\n' + JSON.stringify(b.verdict, null, 1) + '\n```');
}
const txt = L.join('\n');
fs.writeFileSync(path.join(path.dirname(OUT), 'verdict.md'), txt + '\n');
console.log(txt);
console.log('\nwrote', OUT);
