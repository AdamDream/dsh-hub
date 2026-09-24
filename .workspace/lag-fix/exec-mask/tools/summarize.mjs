/*
 * summarize.mjs — turn the raw harness JSON into the per-arm/per-phase tables,
 * the V1/V2/V3 validity verdicts, the arm-to-arm paired judgement, the c2f
 * guardrail and the failure list.
 *
 * usage: node summarize.mjs [--rawdir <dir>] [--pixdiff <pixdiff.json>] [--out <RESULTS.md>]
 *
 * Judgement rules (fixed in advance, same as the audit's §6.2 criteria):
 *   primary   : per "modal-open" phase, >50 ms frame count (target 0) and frame
 *               interval p95 (target <= 16.8 ms)
 *   secondary : LoAF entry count (target ~0)
 *   guardrail : click->first DOM change median must not degrade (baseline 16.65 ms)
 *   paired    : only same-rep arm-to-arm comparisons are used for judgement.
 */
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/exec-mask';
const RAWDIR = argOf('--rawdir', path.join(DIR, 'raw', 'harness'));
const PIXDIFF = argOf('--pixdiff', null);
const OUT = argOf('--out', path.join(RAWDIR, 'RESULTS.md'));
const NARRATIVE = argOf('--narrative', path.join(DIR, 'tools', 'results-narrative.md'));
const JUDGE = argOf('--judge', path.join(RAWDIR, 'judgement.json'));

const NOT_MODAL = new Set(['IDLE_BASE', 'CLOSE', 'POSCTL_pre', 'POSCTL_120', 'POSCTL_120_inpanel']);
const isModal = (l) => !NOT_MODAL.has(l);
const r2 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 100) / 100);
const r1 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10) / 10);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sum = (a) => a.reduce((x, y) => x + y, 0);

// ------------------------------------------------------------------ load raw
const files = fs.readdirSync(RAWDIR).filter((f) => /^perf-.*\.json$/.test(f));
const runs = [];
for (const f of files) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(RAWDIR, f), 'utf8')); } catch (e) { continue; }
  if (j.arm) continue;                       // per-arm split file: the combined file already has it
  if (!j.reps) continue;
  runs.push({ file: f, j });
}
const armRecs = [];   // one row per (run, rep, arm)
for (const { file, j } of runs) {
  for (const rep of j.reps) {
    armRecs.push({
      file, run: j.run, rep: rep.rep, arm: rep.arm || 'normal', vp: j.viewport, dsf: j.dsf,
      loadavg: rep.loadavgAtRepStart, foreignAtRepStart: rep.censusAtRepStart ? rep.censusAtRepStart.foreign : null,
      error: rep.error || null,
      phases: rep.phases || [],
      V3: { interceptions: rep.interceptionCount ?? null, shaOk: rep.interceptionSha256Ok ?? null,
            served: rep.servedBundle || null, verdict: rep.bundleVerdict || null,
            maskBackdropFilter: rep.maskStyle ? rep.maskStyle.backdropFilter : null,
            maskBackground: rep.maskStyle ? rep.maskStyle.background : null },
      shots: rep.shotMeta || null,
    });
  }
}
const byRun = {};
for (const a of armRecs) (byRun[a.run] = byRun[a.run] || []).push(a);

// ------------------------------------------------------------ phase helpers
const get = (a, label) => a.phases.find((p) => p.label === label) || null;
const modal = (a) => a.phases.filter((p) => isModal(p.label));
const mAx = (arr, f) => (arr.length ? Math.max(...arr.map(f).filter((v) => v != null)) : null);

// ------------------------------------------------------------------ V1 / V2 / V3
const V = { V1: [], V2: [], V3: [] };
for (const a of armRecs) {
  for (const lbl of ['POSCTL_120', 'POSCTL_120_inpanel']) {
    const p = get(a, lbl);
    V.V1.push({ run: a.run, rep: a.rep, arm: a.arm, phase: lbl, frameMax: p ? p.frameMax : null, framesGt50: p ? p.framesGt50 : null, injectedMs: lbl === 'POSCTL_120' ? (a.phases && null) : null, verdict: p && p.frameMax != null && p.frameMax >= 90 ? 'PASS' : 'FAIL' });
  }
  const mm = modal(a);
  V.V2.push({ run: a.run, rep: a.rep, arm: a.arm, modalOpenPhases: mm.length, phasesWithJank: mm.filter((p) => p.framesGt50 >= 1).length, totalGt50: sum(mm.map((p) => p.framesGt50 || 0)), maxFrameMax: mAx(mm, (p) => p.frameMax), idleGt50: (get(a, 'IDLE_BASE') || {}).framesGt50 ?? null, closeGt50: (get(a, 'CLOSE') || {}).framesGt50 ?? null });
  V.V3.push({ run: a.run, rep: a.rep, arm: a.arm, ...a.V3 });
}

// --------------------------------------------------------------- per-phase table
function tables(rows) {
  const byArm = {};
  for (const a of rows) (byArm[a.arm] = byArm[a.arm] || []).push(a);
  const arms = Object.keys(byArm);
  const labels = [...new Set(rows.flatMap((a) => a.phases.map((p) => p.label)))];
  const order = ['IDLE_BASE', 'OPEN', 'SEC_1_first_view', 'SCROLL_first', 'CLOSE', 'POSCTL_pre', 'POSCTL_120', 'POSCTL_120_inpanel'];
  labels.sort((x, y) => {
    const ix = order.indexOf(x), iy = order.indexOf(y);
    if (ix >= 0 || iy >= 0) return (ix < 0 ? 999 : ix) - (iy < 0 ? 999 : iy);
    return x.localeCompare(y);
  });
  const out = [];
  for (const label of labels) {
    const row = { label, arms: {} };
    for (const arm of arms) {
      const ps = byArm[arm].map((a) => get(a, label)).filter(Boolean);
      row.arms[arm] = {
        n: ps.length,
        framesGt50: ps.map((p) => p.framesGt50),
        frameMax: ps.map((p) => r1(p.frameMax)),
        frameP95: ps.map((p) => r1(p.frameP95)),
        loafCount: ps.map((p) => p.loafCount),
        c2f: ps.map((p) => r2(p.clickToFirstChangeMs)),
        muts: ps.map((p) => p.muts),
        medGt50: median(ps.map((p) => p.framesGt50)),
        medFrameMax: r1(median(ps.map((p) => p.frameMax))),
        medP95: r1(median(ps.map((p) => p.frameP95))),
        medLoaf: median(ps.map((p) => p.loafCount)),
        medC2f: r2(median(ps.map((p) => p.clickToFirstChangeMs).filter((v) => v != null))),
      };
    }
    out.push(row);
  }
  return { arms, rows: out };
}

function mdTable(t, label0 = 'phase') {
  const arms = t.arms;
  const head = `| ${label0} | ` + arms.map((a) => `${a}: >50ms frames (per rep) | ${a}: frameMax ms | ${a}: p95 ms | ${a}: LoAF | ${a}: c2f ms`).join(' | ') + ' |';
  const sep = '|' + '---|'.repeat(arms.length * 5 + 1);
  const lines = [head, sep];
  for (const r of t.rows) {
    const cells = arms.map((a) => {
      const c = r.arms[a];
      if (!c || !c.n) return '- | - | - | - | -';
      return `${c.framesGt50.join('/')} (med ${c.medGt50}) | ${c.frameMax.join('/')} (med ${c.medFrameMax}) | ${c.frameP95.join('/')} | ${c.loafCount.join('/')} | ${c.c2f.join('/')}`;
    });
    lines.push(`| ${r.label} | ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

// --------------------------------------------------- paired arm-to-arm judgement
function paired(rows, aArm, bArm) {
  // The campaign ran `--reps 1` three times per arm set, so EVERY invocation is
  // labelled rep 1. The pairing instance is therefore the INVOCATION (raw file),
  // not the rep number -- pairing on rep alone silently used only one invocation.
  const inst = [...new Set(rows.map((r) => r.file))].sort();
  const out = [];
  for (const file of inst) {
    const tag = (file.match(/(\d{6}Z)\.json$/) || [null, file])[1];
    const ra = rows.find((r) => r.file === file && r.arm === aArm && !r.error);
    const rb = rows.find((r) => r.file === file && r.arm === bArm && !r.error);
    if (!ra || !rb) { out.push({ rep: tag, skipped: `invocation has no usable ${!ra ? aArm : bArm} arm` }); continue; }
    const labels = [...new Set([...ra.phases, ...rb.phases].map((p) => p.label))].filter(isModal);
    for (const label of labels) {
      const pa = get(ra, label), pb = get(rb, label);
      if (!pa || !pb) { out.push({ rep: tag, label, skipped: 'phase missing in one arm' }); continue; }
      out.push({ rep: tag, label, gt50: [pa.framesGt50, pb.framesGt50], maxF: [r1(pa.frameMax), r1(pb.frameMax)], p95: [r1(pa.frameP95), r1(pb.frameP95)], loaf: [pa.loafCount, pb.loafCount],
                 c2f: [r2(pa.clickToFirstChangeMs), r2(pb.clickToFirstChangeMs)] });
    }
  }
  return out;
}

// ------------------------------------------------------------------ render
const L = [];
const P = (s) => L.push(s);
P('# exec-mask — results (real bundle swap: backdrop-filter removed from the settings mask)');
P('');
P(`generated: ${new Date().toISOString()}  ·  raw dir: \`${RAWDIR}\``);
P('');
P('Instrument: the audit\'s own runner/probe (`incident2/why-these-two/tools/panel-compare.mjs` + `inpage-probe.js`),');
P('copied unchanged in every measured respect, plus ONE added capability: `--bundlePatch` installs a context route that');
P('serves the candidate bytes for `/plugins/@deepseek-ai/dsh-client-ui-settings-general/client.js`, so the fix is a REAL');
P('bundle swap (fresh page, fresh context per arm) rather than an in-page style override.');
P('');
P('Arms per rep: `normal` (no route) -> `patch` (route serves the candidate) -> `normal2` (no route again).');
P('Only same-rep arm-to-arm pairing is used for judgement; no cross-batch absolute comparison is made.');
P('');

// coverage
P('## 0. Coverage / provenance');
P('');
P('| run | file | vp@dsf | arms | reps (usable) | run started | loadavg@start | foreign browsers @rep start |');
P('|---|---|---|---|---|---|---|---|');
for (const { file, j } of runs) {
  const usable = j.reps.filter((r) => !r.error).length;
  const fa = j.reps.map((r) => (r.censusAtRepStart ? r.censusAtRepStart.foreign : '?')).join('/');
  P(`| ${j.run} | ${file} | ${j.viewport.join('x')}@${j.dsf} | ${(j.arms || [j.reps[0] && j.reps[0].arm]).join(',')} | ${usable}/${j.reps.length} | ${j.startedAt} | ${j.loadavg} | ${fa} |`);
}
P('');
const bp = (runs.find((r) => r.j.bundlePatch) || {}).j;
P(`Bundle under test: \`${bp && bp.bundlePatch ? bp.bundlePatch.path : 'n/a'}\``);
if (bp && bp.bundlePatch) P(`  sha256 \`${bp.bundlePatch.sha256}\`, ${bp.bundlePatch.bytes} bytes; pre-image sha256 \`${bp.preimage.sha256}\`; served URL \`${bp.bundleUrl}\``);
P('');

// V gates
P('## 1. Validity gates');
P('');
P('### V1 — instrument live? (in-page `window.__block(120)` positive control must show frameMax ~100–117 ms)');
P('');
P('| run | rep | arm | phase | frameMax ms | >50ms frames | verdict |');
P('|---|---|---|---|---|---|---|');
for (const v of V.V1) if (v.frameMax != null) P(`| ${v.run} | ${v.rep} | ${v.arm} | ${v.phase} | ${v.frameMax} | ${v.framesGt50} | ${v.verdict} |`);
const v1bad = V.V1.filter((v) => v.frameMax != null && v.verdict === 'FAIL');
const v1all = V.V1.filter((v) => v.frameMax != null);
P('');
P(`**V1: ${v1all.length && v1bad.length === 0 ? 'PASS' : (v1all.length ? 'PARTIAL/FAIL' : 'NOT MEASURED')}** — ${v1all.length - v1bad.length}/${v1all.length} positive controls reached >=90 ms frameMax.`);
P('');
P('### V2 — baseline reproduced? (`normal` arm at 2560x1440 must show modal-open phases with >50 ms frames)');
P('');
P('| run | rep | arm | modal-open phases | phases with >=1 >50ms frame | total >50ms frames | max frameMax ms | IDLE_BASE >50 | CLOSE >50 |');
P('|---|---|---|---|---|---|---|---|---|');
for (const v of V.V2) P(`| ${v.run} | ${v.rep} | ${v.arm} | ${v.modalOpenPhases} | ${v.phasesWithJank} | ${v.totalGt50} | ${v.maxFrameMax} | ${v.idleGt50} | ${v.closeGt50} |`);
P('');
P('### V3 — patch actually served?');
P('');
P('| run | rep | arm | interceptions | route sha ok | bytes the PAGE fetched (sha256) | bundle verdict | computed backdrop-filter on div.VOzbGW_mask |');
P('|---|---|---|---|---|---|---|---|');
for (const v of V.V3) P(`| ${v.run} | ${v.rep} | ${v.arm} | ${v.interceptions} | ${v.shaOk} | ${v.served ? (v.served.sha256 || v.served.error || '?') : '?'} (${v.served && v.served.bytes ? v.served.bytes : '?'} B) | ${v.verdict} | \`${v.maskBackdropFilter}\` |`);
P('');

// per-run tables
for (const runName of Object.keys(byRun)) {
  const rows = byRun[runName].filter((a) => !a.error);
  if (!rows.length) continue;
  const vp = rows[0].vp;
  P(`## 2.${runName} — per-phase table (${vp.join('x')}@${rows[0].dsf})`);
  P('');
  P('`>50ms frames` / `frameMax` / `p95` / `LoAF` / `c2f` are printed per rep, with the median in parentheses for the primary metric.');
  P('');
  P(mdTable(tables(rows)));
  P('');
}

// paired judgement
P('## 3. Same-rep arm-to-arm pairing (primary judgement)');
P('');
for (const [runName, rows0] of Object.entries(byRun)) {
  const rows = rows0.filter((a) => !a.error);
  const arms = [...new Set(rows.map((r) => r.arm))];
  if (!arms.includes('patch')) continue;
  for (const [aA, bA] of [['normal', 'patch'], ['patch', 'normal2'], ['normal', 'normal2']]) {
    if (!arms.includes(aA) || !arms.includes(bA)) continue;
    const pr = paired(rows, aA, bA);
    const ok = pr.filter((x) => !x.skipped);
    const went0 = ok.filter((x) => x.gt50[0] >= 1 && x.gt50[1] === 0);
    const ret = ok.filter((x) => x.gt50[0] >= 1 && x.gt50[1] >= 1);
    const worse = ok.filter((x) => x.gt50[1] > x.gt50[0]);
    P(`**${runName} · ${aA} -> ${bA}** (${ok.length} paired modal-open phase-instances, ${pr.length - ok.length} unpaired)`);
    P('');
    P(`- phases that went from >=1 >50 ms frame (${aA}) to **0** (${bA}): **${went0.length}**${went0.length ? ' (' + went0.map((x) => `${x.label}@${x.rep}`).join(', ') + ')' : ''}`);
    P(`- phases still janky in ${bA}: **${ret.length}** (${ret.map((x) => `${x.label}@${x.rep}:${x.gt50[0]}->${x.gt50[1]}`).join(', ') || 'none'})`);
    P(`- phases WORSE in ${bA}: ${worse.length} (${worse.map((x) => `${x.label}@${x.rep}:${x.gt50[0]}->${x.gt50[1]}`).join(', ') || 'none'})`);
    P(`- totals: >50 ms frames ${sum(ok.map((x) => x.gt50[0]))} -> ${sum(ok.map((x) => x.gt50[1]))}; max frameMax ${Math.max(...ok.map((x) => x.maxF[0]))} -> ${Math.max(...ok.map((x) => x.maxF[1]))} ms`);
    P(`- p95 medians: ${median(ok.map((x) => x.p95[0]))} -> ${median(ok.map((x) => x.p95[1]))} ms; LoAF totals ${sum(ok.map((x) => x.loaf[0]))} -> ${sum(ok.map((x) => x.loaf[1]))}`);
    const c2fa = ok.map((x) => x.c2f[0]).filter((v) => v != null), c2fb = ok.map((x) => x.c2f[1]).filter((v) => v != null);
    P(`- c2f (click->first DOM change) median ${r2(median(c2fa))} -> ${r2(median(c2fb))} ms (n=${c2fa.length}/${c2fb.length})`);
    P('');
  }
}

// c2f guardrail detail
P('## 4. Guardrail: click -> first DOM change (c2f)');
P('');
P(`Baseline to not degrade: **16.65 ms** (audit, 8 sections, nearly flat).`);
P('');
P('| run | arm | vp | n phases with c2f | median c2f ms | p90 c2f ms | max c2f ms |');
P('|---|---|---|---|---|---|---|');
for (const runName of Object.keys(byRun)) {
  for (const arm of [...new Set(byRun[runName].map((r) => r.arm))]) {
    const rows = byRun[runName].filter((r) => r.arm === arm && !r.error);
    const all = rows.flatMap((r) => r.phases.map((p) => p.clickToFirstChangeMs)).filter((v) => v != null);
    if (!all.length) continue;
    const s = [...all].sort((a, b) => a - b);
    P(`| ${runName} | ${arm} | ${rows[0].vp.join('x')} | ${all.length} | ${r2(median(all))} | ${r2(s[Math.floor(0.9 * s.length)])} | ${r2(s[s.length - 1])} |`);
  }
}
P('');

// pixdiff
if (PIXDIFF && fs.existsSync(PIXDIFF)) {
  const pd = JSON.parse(fs.readFileSync(PIXDIFF, 'utf8'));
  P('## 5. Appearance equivalence (per-pixel, decoder cross-validated against PIL)');
  P('');
  P('Screenshots were taken at the identical point of the phase sequence, in the same settled state and at the same scroll');
  P('position, in each arm; the panel rect and the computed mask style were recorded with each shot.');
  P('');
  for (const kind of [...new Set(pd.pairs.map((p) => p.kind))]) {
    const ps = pd.pairs.filter((p) => p.kind === kind);
    P(`### ${kind}`);
    P('');
    P('| run | vp | rep | shot | state match | mean | median | p99 | max Δ | >2/255 | >8/255 | >32/255 | outside-panel >8 | inside-panel >8 | panel backdrop-filter A/B |');
    P('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const p of ps) {
      const inside = p.where.gt8Counts.insideCore + p.where.gt8Counts.edgeBand;
      P(`| ${p.run || '-'} | ${(p.viewport || []).join('x')} | ${p.rep} | ${p.shot} | nav=${p.stateMatch.nav} tab=${p.stateMatch.tab} scroll=${p.stateMatch.scroll} panel=${p.stateMatch.panel} | ${p.maxChannelDelta.mean} | ${p.maxChannelDelta.p50} | ${p.maxChannelDelta.p99} | ${p.maxChannelDelta.max} | ${p.frac.gt2}% | ${p.frac.gt8}% | ${p.frac.gt32}% | ${p.where.gt8Counts.outsidePanel} px | ${inside} px | \`${p.maskStyleA.backdropFilter}\` / \`${p.maskStyleB.backdropFilter}\` |`);
    }
    for (const p of ps) {
      P('');
      P(`- \`${p.shot}\` rep${p.rep}: ${p.w}×${p.h} dev px, panel rect (dev px) ${JSON.stringify(p.panelRectDev)}; per-channel mean Δ R/G/B/A = ${p.perChannel.r.meanAbs}/${p.perChannel.g.meanAbs}/${p.perChannel.b.meanAbs}/${p.perChannel.a.meanAbs}, median Δ = ${p.perChannel.r.medianAbs}/${p.perChannel.g.medianAbs}/${p.perChannel.b.medianAbs}/${p.perChannel.a.medianAbs}, max Δ = ${p.perChannel.r.maxAbs}/${p.perChannel.g.maxAbs}/${p.perChannel.b.maxAbs}/${p.perChannel.a.maxAbs}`);
      P(`  region shares of ALL pixels: panel-core ${p.where.pixelSharePct.insideCore}% / panel-edge-band ${p.where.pixelSharePct.edgeBand}% / outside-panel ${p.where.pixelSharePct.outsidePanel}%; >2/255 pixels located: core ${p.where.gt2Counts.insideCore}, edge band ${p.where.gt2Counts.edgeBand}, outside ${p.where.gt2Counts.outsidePanel}`);
      P(`  bbox of >2/255 pixels (dev px): ${JSON.stringify(p.where.gt2BBoxDev)}`);
      P(`  8x8 grid: share of each cell's pixels with Δ>2/255: ${JSON.stringify(p.where.grid8x8Gt2PctOfCell)}`);
    }
    P('');
  }
  if (pd.skipped.length) { P(`_unpaired/skipped shots: ${JSON.stringify(pd.skipped)}_`); P(''); }
}

// failures
P('## 6. Failed / Invalid / Not Verified');
P('');
const failed = armRecs.filter((r) => r.error);
if (!failed.length) P('- No arm-record reported an execution error.');
for (const f of failed) P(`- **${f.run} rep${f.rep} ${f.arm}**: ${f.error}`);
const v1fail = v1bad.map((v) => `${v.run} r${v.rep} ${v.arm} ${v.phase} (frameMax ${v.frameMax})`);
if (v1fail.length) P(`- V1 positive control below 90 ms (frame channel doubt): ${v1fail.join('; ')}`);
const v3fail = V.V3.filter((v) => v.arm === 'patch' && (v.shaOk !== true || v.verdict !== 'PATCH-SERVED'));
if (!v3fail.length) P('- V3: every `patch` arm served the candidate bytes (route hit + sha256 of the bytes the page actually fetched).');
else P(`- **V3 failures**: ${v3fail.map((v) => `${v.run} r${v.rep} ${v.arm} interceptions=${v.interceptions} verdict=${v.verdict}`).join('; ')}`);
const v3non = V.V3.filter((v) => v.arm !== 'patch' && v.verdict && v.verdict !== 'PREIMAGE-SERVED');
if (v3non.length) P(`- **Non-patch arm did NOT serve the pre-image** (route leak or bundle drift): ${v3non.map((v) => `${v.run} r${v.rep} ${v.arm}=${v.verdict}`).join('; ')}`);
const noshots = armRecs.filter((r) => !r.error && !r.shots);
P(`- Arms with no screenshots (expected: all but the shot rep): ${noshots.length}`);
P('');

// artifacts
P('## 7. Artifacts (absolute paths)');
P('');
for (const f of files) P(`- \`${path.join(RAWDIR, f)}\``);
for (const { file, j } of runs) {
  const stamp = (file.match(/-(\d{8}T\d{6}Z)\.json$/) || [])[1] || '';
  P(`- \`${path.join(DIR, 'logs', `panel-${j.run}-${j.order || 'A'}-chrome-headless-${stamp}.log`)}\``);
}
P(`- \`${path.join(DIR, 'logs', 'harness-diff.patch')}\` (full unified diff of the copied runner)`);
P(`- \`${path.join(DIR, 'logs', 'pixdiff-all.log')}\``);
P(`- \`${path.join(DIR, 'raw', 'harness', 'harness-notes.md')}\``);
P(`- \`${path.join(DIR, 'raw', 'harness', 'judgement.json')}\``);
P(`- \`${path.join(DIR, 'raw', 'harness', 'pixdiff-all.json')}\``);
P(`- \`${path.join(DIR, 'raw', 'harness', 'pixdiff-smoke.json')}\``);
for (const f of ['blur-inventory-normal.json', 'blur-inventory-patch.json', 'blur-inventory-compare.json']) {
  const fp = path.join(DIR, 'raw', 'harness', f);
  if (fs.existsSync(fp)) P(`- \`${fp}\``);
}
P(`- shot PNGs (21 files backing the 15 DISTINCT compared pairs; \`shots/<run>-r<rep>-<arm>-<vw>-<name>.png\`):`);
const shotFiles = fs.readdirSync(path.join(DIR, 'shots')).sort().map((f) => path.join(DIR, 'shots', f));
P(`  - ${shotFiles.length} files, e.g. \`${shotFiles[0]}\` … \`${shotFiles[shotFiles.length - 1]}\``);
P('');

// ---- splice the hand-written narrative (VERDICT at the top, the 6b disclosures
// inside the failure section, the provenance/limits/commands blocks at the end).
// Keeping it in a separate source file means regenerating the generated tables
// can never clobber it again (it did once -- see RESULTS.md 6b(12)).
let text = L.join('\n') + '\n';
if (NARRATIVE && fs.existsSync(NARRATIVE)) {
  const nar = fs.readFileSync(NARRATIVE, 'utf8');
  // line-based, NOT a regex: `\Z` is not valid in JS regex and silently became a
  // literal 'Z' alternative, which truncated the blocks at the first capital Z
  // (inside `VOzbGW_mask`). Markers must be alone on their own line.
  const narLines = nar.split('\n');
  const block = (name) => {
    const st = narLines.findIndex((l) => l.trim() === '@@' + name + '@@');
    if (st < 0) return '';
    let en = narLines.length;
    for (let i = st + 1; i < narLines.length; i++) if (/^@@[A-Z0-9]+@@\s*$/.test(narLines[i])) { en = i; break; }
    return narLines.slice(st + 1, en).join('\n').trim();
  };
  const top = block('TOP'), sec6b = block('SEC6B'), end = block('END');
  const introAnchor = 'Only same-rep arm-to-arm pairing is used for judgement; no cross-batch absolute comparison is made.\n';
  if (top && text.includes(introAnchor)) text = text.replace(introAnchor, introAnchor + '\n' + top + '\n', 1);
  const sec7 = '## 7. Artifacts (absolute paths)';
  if (sec6b && text.includes(sec7)) text = text.replace(sec7, sec6b + '\n' + sec7, 1);
  if (end) text = text.replace(/\n## 8\. Honesty boundary[\s\S]*$/, '\n');   // drop a previously spliced END block
  text = text.trimEnd() + '\n\n' + end + '\n';
  console.log(`narrative spliced from ${NARRATIVE} (top ${top.length}B, 6b ${sec6b.length}B, end ${end.length}B)`);
} else console.log('WARNING: no narrative file — RESULTS.md will contain generated tables only');
fs.writeFileSync(OUT, text);
fs.writeFileSync(JUDGE, JSON.stringify({ generatedAt: new Date().toISOString(), V1: V.V1, V2: V.V2, V3: V.V3, armRecs: armRecs.map((a) => ({ run: a.run, rep: a.rep, arm: a.arm, error: a.error, phases: a.phases.length })) }, null, 2));
console.log(`wrote ${OUT}\nwrote ${JUDGE}`);
