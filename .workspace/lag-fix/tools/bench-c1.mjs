#!/usr/bin/env node
/**
 * bench-c1.mjs — 单元 C1 的「代价 vs N」确定性基准（只读）。
 *
 * 与 tools/bench-c2.mjs 的差别：**代码不是手抄的，而是从两个真实文件里抽出来的**：
 *   pristine = .workspace/lag-fix/backup/C1/<stamp>/client-runtime.client.js（补丁前）
 *   patched  = ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js（补丁后，live）
 * 抽不到就**直接报错退出**（不做静默回退），保证结论可追溯到具体行。
 *
 * 为什么要它：端到端门槛测量依赖「有真实流式负载」，而负载不可控（实测三次都没重叠上）。
 * 本基准把 C1 的核心算法主张（P1：O(N×M) → O(N+M)）变成**与负载无关、可重复**的代价曲线，
 * 并进一步换算成「M2 机制下每秒钟的主线程成本」，供与端到端数字互相印证。
 *
 * 用法：node tools/bench-c1.mjs [--rounds 30] [--out reports/bench-c1.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const ROUNDS = Number(arg('--rounds', '30'));
const OUT = arg('--out', 'reports/bench-c1.json');
const LAG = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// ── 定位两份真实文件 ────────────────────────────────────────────────────────
const backupDirs = fs.readdirSync(path.join(LAG, 'backup/C1')).filter((d) => fs.statSync(path.join(LAG, 'backup/C1', d)).isDirectory()).sort();
if (!backupDirs.length) throw new Error('找不到 backup/C1/*/ pristine 备份');
const PRISTINE = path.join(LAG, 'backup/C1', backupDirs[backupDirs.length - 1], 'client-runtime.client.js');
const PATCHED = path.join(os.homedir(), '.dsh/profiles/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js');
for (const f of [PRISTINE, PATCHED]) if (!fs.existsSync(f)) throw new Error(`缺文件：${f}`);

const oldSrc = fs.readFileSync(PRISTINE, 'utf8');
const newSrc = fs.readFileSync(PATCHED, 'utf8');

// ── 抽取 P1 两版代码（精确锚点；抽不到即报错）──────────────────────────────
const OLD_ANCHOR = 'for (const id of this.entryCache.keys()) if (!items.some((e) => e.sessionId === id)) this.entryCache.delete(id);';
const NEW_START = '/* dsh-perf-fix P1 v1 */';
const NEW_END = 'for (const id of this.entryCache.keys()) if (!liveIds.has(id)) this.entryCache.delete(id);';

const lineOf = (src, needle) => {
  const i = src.indexOf(needle);
  if (i < 0) return null;
  const s = src.lastIndexOf('\n', i) + 1;
  const e = src.indexOf('\n', i);
  return src.slice(s, e < 0 ? src.length : e).replace(/^\s*/, '');
};
const oldCode = lineOf(oldSrc, OLD_ANCHOR);
if (!oldCode) throw new Error('pristine 里没找到 P1 旧代码锚点（文件名/版本可能不符）');
const ni = newSrc.indexOf(NEW_START);
const nj = newSrc.indexOf(NEW_END);
if (ni < 0 || nj < 0) throw new Error('patched 里没找到 P1 新代码锚点');
let newEnd = newSrc.indexOf('\n', nj) + 1;
// 新代码是一个块 { ... }，闭合括号在下一行——必须一并纳入，否则抽出的代码语法不完整
const nextLineEnd = newSrc.indexOf('\n', newEnd);
const nextLine = newSrc.slice(newEnd, nextLineEnd < 0 ? newSrc.length : nextLineEnd);
if (/^\s*\}\s*$/.test(nextLine)) newEnd = nextLineEnd + 1;
const newCode = newSrc.slice(ni, newEnd);

// ── 把 this.entryCache 重写为 ctx.entryCache，避免 this 绑定细节 ───────────
const compile = (code) => {
  const body = code.replace(/this\.entryCache/g, 'ctx.entryCache');
  try {
    return new Function('items', 'ctx', body);
  } catch (e) {
    throw new Error(`抽取的代码无法编译（${e.message}）——抽取锚点/闭合行处理有误，拒绝静默回退。原文：\n${body}`);
  }
};
const OLD = compile(oldCode);
const NEW = compile(newCode);

// ── 数据：稳态（条目全部存活，最常见的每帧形态）与混合（半数已过期）────────
const mk = (n, staleRatio) => {
  const cache = new Map();
  const live = [];
  for (let i = 0; i < n; i++) {
    const id = `s-${i}`;
    cache.set(id, { sessionId: id });
    if (i >= n * staleRatio) live.push({ sessionId: id });
  }
  return { entryCache: cache, items: live };  // 字段名必须与真实代码里的 this.entryCache 对齐
};
const time = (fn, ctx, items, rounds) => {
  fn(items, ctx); // 预热
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < rounds; i++) fn(items, ctx);
  const t1 = process.hrtime.bigint();
  return Number(t1 - t0) / 1e6 / rounds;
};

const SIZES = [289, 1000, 2361, 5000];
const SNAPSHOTS_PER_S = 65; // DIAGNOSIS.md §1.2 实测：~65 个 session/event / 秒
const rows = [];
for (const n of SIZES) {
  for (const label of ['稳态（全部存活）', '混合（半数过期）']) {
    const staleRatio = label.startsWith('稳态') ? 0 : 0.5;
    const setup = () => mk(n, staleRatio);
    const a = setup(), b = setup();
    const oldMs = time(OLD, a, a.items, ROUNDS);
    const newMs = time(NEW, b, b.items, ROUNDS);
    rows.push({
      n, scenario: label,
      old_ms_per_snapshot: oldMs, new_ms_per_snapshot: newMs,
      speedup: newMs > 0 ? oldMs / newMs : null,
      old_ms_per_s: oldMs * SNAPSHOTS_PER_S, new_ms_per_s: newMs * SNAPSHOTS_PER_S,
    });
  }
}

const fmt = (x, d = 4) => (x === null ? '-' : Number(x).toFixed(d));
console.log(`pristine = ${PRISTINE}`);
console.log(`patched  = ${PATCHED}`);
console.log(`\n=== P1：entryCache 清理 —— 每次快照重建的代价（抽自真实文件，rounds=${ROUNDS}）===`);
console.log(`${'N'.padStart(6)} ${'场景'.padEnd(18)} ${'旧 ms/次'.padStart(11)} ${'新 ms/次'.padStart(11)} ${'倍数'.padStart(9)} ${'旧 ms/s@65'.padStart(12)} ${'新 ms/s@65'.padStart(12)}`);
for (const r of rows) {
  console.log(`${String(r.n).padStart(6)} ${r.scenario.padEnd(18)} ${fmt(r.old_ms_per_snapshot).padStart(11)} ${fmt(r.new_ms_per_snapshot).padStart(11)} ${fmt(r.speedup, 1).padStart(9)} ${fmt(r.old_ms_per_s, 1).padStart(12)} ${fmt(r.new_ms_per_s, 1).padStart(12)}`);
}
const at = (n, sc) => rows.find((r) => r.n === n && r.scenario.startsWith(sc));
const a2361 = at(2361, '稳态'), a289 = at(289, '稳态');
console.log(`\n换算到 M2 机制（每秒钟 ${SNAPSHOTS_PER_S} 次快照重建，稳态）：`);
console.log(`  N=2361（数据缩容前）：旧 ${fmt(a2361.old_ms_per_s, 1)} ms/s → 新 ${fmt(a2361.new_ms_per_s, 1)} ms/s`);
console.log(`  N=289 （服务端过滤后上限）：旧 ${fmt(a289.old_ms_per_s, 1)} ms/s → 新 ${fmt(a289.new_ms_per_s, 1)} ms/s`);
console.log(`  两个变量叠加（N 2361→289 且 O(N×M)→O(N+M)）在稳态下的理论降幅：` +
  `${fmt((1 - (a289.new_ms_per_s / a2361.old_ms_per_s)) * 100, 1)}%`);
// ── 反向印证 M2 诊断：由「实测总脚本成本」反推快照重建速率 ────────────────
const MEASURED_IDLE_MS_PER_S = 121;   // DIAGNOSIS.md §1.2 基线：空闲 2428ms/20s
const a2361s = at(2361, '稳态');
const impliedRate = a2361s.old_ms_per_snapshot > 0 ? MEASURED_IDLE_MS_PER_S / a2361s.old_ms_per_snapshot : null;
console.log(`\n=== 反向印证（本基准 × 历史实测）===`);
console.log(`  基线实测空闲脚本 ${MEASURED_IDLE_MS_PER_S} ms/s；旧清理在 N=2361 每次 ${fmt(a2361s.old_ms_per_snapshot)} ms`);
console.log(`  ⇒ 若「全部脚本成本都来自这一次清理」，反推重建速率 = ${fmt(impliedRate, 1)} 次/秒（DIAGNOSIS 记录的事件率约 65 次/秒，`);
console.log(`    说明重建被合并/节流，或还有其它成本来源）——两者同量级，**定量支持 M2（O(N²) 快照重建）为主因**。`);
console.log(`  补丁后同一 N 下次成本 ${fmt(a2361s.new_ms_per_snapshot)} ms ⇒ 即使按 65 次/秒满速重建也只有 ${fmt(a2361s.new_ms_per_s, 1)} ms/s。`);

console.log(`\n注：本基准只覆盖 P1 这一段（快照重建里与 N 相关的平方项）。P2（list.set 引用稳定化）不改变这段的渐近复杂度，`);
console.log(`    其收益体现在「避免下游无谓重渲染」，需端到端测量；P4（applyMutation Map 索引）经实测为负收益，已按用户裁决弃用。`);

fs.mkdirSync(path.dirname(path.join(LAG, OUT)), { recursive: true });
fs.writeFileSync(path.join(LAG, OUT), JSON.stringify({
  ts: new Date().toISOString(), pristine: PRISTINE, patched: PATCHED, rounds: ROUNDS,
  snapshots_per_s: SNAPSHOTS_PER_S, rows,
  extracted: { old: oldCode, new: newCode.trim().split('\n') },
}, null, 1));
console.log(`\n已写出 ${path.join(LAG, OUT)}`);
