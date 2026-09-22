#!/usr/bin/env node
/*
 * verdict.mjs — applies the pre-declared decision rules to raw/aggregate.json and
 * prints the conclusions in the exact wording used by audit.md, so the audit's
 * numbers are reproducible instead of hand-copied.
 *
 * Pre-declared rules (fixed BEFORE the data was looked at):
 *   STABLE-60  : every rep has p95 <= 20 ms AND zero frames > 50 ms.
 *                (60 Hz vsync = 16.67 ms; p95 <= 20 ms means >=95 % of frames land
 *                 in the same vsync as the previous one, and >50 ms means at least
 *                 three vsyncs were missed in a row = a visible hitch.)
 *   MARGINAL   : p95 > 20 ms but no frame > 50 ms.
 *   DROPPING   : at least one frame > 50 ms (or p99 > 50 ms).
 *   ATTRIBUTION: for a DROPPING config, the largest of the traced
 *                Script / Recalc / Layout / Paint / Composite sums names the owner;
 *                main-thread share = (Script+Recalc+Layout) / 3000 ms window.
 *   DSH-COMPARE: DSH must exceed the WORST DSH-free config on >50 ms frame count
 *                for a "DSH is heavier than the worst harmless page" claim; equal
 *                or lower => the claim is refuted.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const agg = JSON.parse(fs.readFileSync(path.join(HERE, 'raw', 'aggregate.json'), 'utf8'));
const rawRuns = agg.rows;
const r1 = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 10) / 10 : null);

const minimal = agg.groups.filter((g) => g.target === 'minimal' && g.gpu === 'default');
const byMode = (m) => minimal.filter((g) => g.mode === m).sort((a, b) => (b.fps || 0) - (a.fps || 0));

function rule(runs) {
  if (!runs.length) return 'NO-DATA';
  const stable = runs.every((r) => (r.p95 != null && r.p95 <= 20) && (r.gt50 || 0) === 0);
  const marginal = runs.every((r) => (r.gt50 || 0) === 0) && !stable;
  if (stable) return 'STABLE-60';
  if (marginal) return 'MARGINAL';
  return 'DROPPING';
}
const runsOf = (g) => rawRuns.filter((r) => !r.error && r.mode === g.mode && r.gpu === g.gpu && r.target === g.target && r.cellId === g.cellId);

const out = [];
out.push('## 预声明判据（在查看数据前固定）');
out.push('');
out.push('- STABLE-60：每一次运行的 p95 ≤ 20ms 且 >50ms 帧数为 0');
out.push('- MARGINAL：无 >50ms 帧，但 p95 > 20ms');
out.push('- DROPPING：存在 >50ms 帧（或 p99 > 50ms）');
out.push('- 归属：对 DROPPING 配置，trace 分组中 Script/Recalc/Layout/Paint/Composite 时长最大者负责');
out.push('');
for (const mode of ['headless', 'headed']) {
  const gs = byMode(mode);
  out.push(`### ${mode}（GPU=default，` + `${gs.length} 个配置）`);
  out.push('');
  out.push('| cell | 场景 | reps | fps | p95 | p99 | max | >50ms | 判定 | 主线程 Script/Recalc/Layout |');
  out.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const g of gs) {
    const rs = runsOf(g);
    out.push(`| ${g.cellId} | ${g.scenario} | ${rs.length} | ${r1(g.fps)} | ${r1(g.p95)} | ${r1(g.p99)} | ${g.max} | ${g.gt50} | ${rule(rs)} | ${r1(g.scriptMs)}/${r1(g.recalcMs)}/${r1(g.layoutMs)} ms |`);
  }
  out.push('');
  const worst = gs.filter((g) => rule(runsOf(g)) !== 'STABLE-60');
  out.push(`- **${mode} 下无法保持 60fps 的配置**: ${worst.length ? worst.map((g) => `${g.cellId}(${rule(runsOf(g))})`).join(', ') : '无'}`);
  out.push(`- ${mode} 最好: ${gs[0] ? gs[0].cellId + ' fps=' + r1(gs[0].fps) : 'n/a'}；最差: ${gs.length ? gs[gs.length - 1].cellId + ' fps=' + r1(gs[gs.length - 1].fps) : 'n/a'}`);
  out.push('');
}

/* attribution */
out.push('## 掉帧归属（trace 分组，headless/headed 各自）');
out.push('');
out.push('| mode | cell | 判定 | Script | Recalc | Layout | Paint | Composite | 最大项 | 主线程占比 |');
out.push('|---|---|---|---|---|---|---|---|---|---|');
for (const g of agg.groups.filter((x) => x.target === 'minimal' && x.traceMs)) {
  const rs = runsOf(g);
  const v = rule(rs);
  const t = g.traceMs;
  const items = [['Script', t.script], ['Recalc', t.style], ['Layout', t.layout], ['Paint', t.paint], ['Composite', t.composite]];
  const top = items.slice().sort((a, b) => b[1] - a[1])[0];
  out.push(`| ${g.mode} | ${g.cellId} | ${v} | ${t.script} | ${t.style} | ${t.layout} | ${t.paint} | ${t.composite} | **${top[0]}** | ${g.mainThreadPctOfWindow}% |`);
}
out.push('');

/* DSH comparison */
const dsh = rawRuns.filter((r) => r.dsh && r.dsh.move);
if (dsh.length) {
  out.push('## DSH 对照判定');
  out.push('');
  for (const r of dsh) {
    const mode = r.mode;
    const gs = byMode(mode);
    const best = gs[0], worst = gs[gs.length - 1];
    const m = r.dsh.move;
    out.push(`- DSH（${mode}，1 次页面加载）: fps=${r1(m.fpsMean)} p50=${r1(m.p50)} p95=${r1(m.p95)} p99=${r1(m.p99)} max=${m.max} >50ms=${m.gt50} LongTask=${m.lt} 最长LongTask=${m.longestLt}ms Script=${r1(m.Script_ms)}ms Recalc=${r1(m.RecalcStyle_ms)}ms Layout=${r1(m.Layout_ms)}ms`);
    if (best) out.push(`  - 同模式最好无害页: ${best.cellId} fps=${r1(best.fps)} p95=${r1(best.p95)} >50ms=${best.gt50}`);
    if (worst) out.push(`  - 同模式最差无害页: ${worst.cellId} fps=${r1(worst.fps)} p95=${r1(worst.p95)} >50ms=${worst.gt50}`);
    if (worst) {
      const heavier = (m.gt50 || 0) > (worst.gt50 || 0) || (m.p95 || 0) > (worst.p95 || 0) * 1.25;
      out.push(`  - 判定: DSH 的卡**${heavier ? '显著重于' : '不显著重于'}**最差的无害页（DSH >50ms=${m.gt50} vs 最差页 >50ms=${worst.gt50}；DSH p95=${r1(m.p95)} vs ${r1(worst.p95)}）`);
    }
  }
  out.push('');
}
const txt = out.join('\n');
fs.writeFileSync(path.join(HERE, 'verdict.md'), txt + '\n');
console.log(txt);
console.log('\n-> verdict.md');
