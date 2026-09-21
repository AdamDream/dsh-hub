#!/usr/bin/env node
'use strict';
/**
 * exec-b1/validate-verifier-v2.mjs —— **回放规格 v2 的 `verifyServerFilter` 自证**（只读）。
 *
 * 交付单元：DU-B1-C（回放规格 v2）。契约：审计 §3.2（T1–T4）/ §3.3（V1–V7 + 反向对照自证）/ §4.1。
 *
 * 本脚本不重复审计已跑的 9 项，而是把它变成**可复核的产物**，并补齐三件审计未显式固化的事：
 *
 *   1. **V1–V7 与 T1–T4 的差分提取**：直接 diff `spec/B1-transform.v1.cjs` 与
 *      `B1-transform.v2.cjs` 的源码，把「新增的字面量计数断言」**由源码派生**（不手抄），
 *      再与审计 §3.3 的七条逐条对账 —— 防止「声称加了 7 条但实际只加了 5 条」。
 *   2. **9 项判据**：正向 2（两个候选件零失败）+ 反向 M1–M5（必须被拒）+ 控制 W1 + 对照 C1
 *      （**现行 v1 部署必须被判失败**，以证明 verifier 有区分力）。
 *   3. **verifier 自身不得空转**：把 verifier 的每类判据**逐条破坏**（让该判据的探针失效），
 *      断言对应 check 由 PASS 变 FAIL —— 若破坏后仍 PASS，说明该 check 是空转（本档判 REWORK）。
 *
 * 用法：node validate-verifier-v2.mjs [--report FILE.json]
 * 退出码：0 = 全部通过 / 2 = 有失败
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const V1 = require(join(HERE, 'spec', 'B1-transform.v1.cjs'));
const V2 = require(join(HERE, 'B1-transform.v2.cjs'));

const argv = process.argv.slice(2);
const optOf = (n, d) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
const REPORT = optOf('--report', join(HERE, 'results', 'validate-verifier-v2.json'));

const HOME = process.env.HOME ?? '/home/CNS2026495165';
const DSH = join(HOME, '.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib');
const PRE = join(HERE, '..', 'backup', 'B1', 'server', '20260920-154039', 'lib');

const report = { at: new Date().toISOString(), groups: [], checks: [], outcome: 'PENDING' };
let bad = 0;
const check = (group, name, ok, detail = '') => {
  report.checks.push({ group, name, ok: Boolean(ok), detail: String(detail) });
  if (!ok) bad += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${group}] ${name}${detail ? `  — ${detail}` : ''}`);
};
const info = (m) => console.log(`      ${m}`);
const sha = (t) => createHash('sha256').update(Buffer.from(t, 'utf8')).digest('hex');

const FILES = { 'index.js': 'bundled', 'types/api-proxy.js': 'module' };
const clean = {}; const cleanMod = {}; const deployed = {}; const preText = {};
for (const [rel, key] of Object.entries(FILES)) {
  clean[key] = V2.applyServerFilter(readFileSync(join(PRE, rel), 'utf8'));
  cleanMod[key] = V1.applyServerFilter(readFileSync(join(PRE, rel), 'utf8'));
  deployed[key] = readFileSync(join(DSH, rel), 'utf8');
  preText[key] = readFileSync(join(PRE, rel), 'utf8');
}

// ---------------------------------------------------------------------------
// 0) 前提：三态关系（v1 规格 == 现行部署；v2 规格 == 候选；v2 ≠ v1）
// ---------------------------------------------------------------------------
console.log('=== 0) 前提：规格 == 产物的三态关系 ===');
for (const [rel, key] of Object.entries(FILES)) {
  check('premise', `[${rel}] v1 规格重放 == 现行部署（审计 §0-E2）`, cleanMod[key] === deployed[key], sha(deployed[key]).slice(0, 16) + '…');
  check('premise', `[${rel}] v2 规格重放 ≠ 现行部署（修订确实发生）`, clean[key] !== deployed[key], `${sha(clean[key]).slice(0, 16)}… vs ${sha(deployed[key]).slice(0, 16)}…`);
  check('premise', `[${rel}] v1 规格重放 ≠ v2 规格重放`, cleanMod[key] !== clean[key], '两代规格产出的字节不同');
}

// ---------------------------------------------------------------------------
// 1) V1–V7 的**差分提取**（由两份规格源码派生，不手抄）
// ---------------------------------------------------------------------------
console.log('\n=== 1) V1–V7 差分提取（由 spec v1/v2 源码派生） ===');
/** 从 verifyServerFilter 的「字面量计数断言表」中抽 `[literal, expected]` 行。 */
function countAssertionsOf(src) {
  const at = src.indexOf('function verifyServerFilter(text) {');
  const end = src.indexOf('for (const [literal, expected] of [', at);
  const stop = src.indexOf(']) {', end);
  const block = src.slice(end, stop);
  const rows = [];
  for (const m of block.matchAll(/\[\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*\]/g)) rows.push([m[1].replace(/\\'/g, "'"), Number(m[2])]);
  return rows;
}
const v1Src = readFileSync(join(HERE, 'spec', 'B1-transform.v1.cjs'), 'utf8');
const v2Src = readFileSync(join(HERE, 'B1-transform.v2.cjs'), 'utf8');
const a1 = countAssertionsOf(v1Src);
const a2 = countAssertionsOf(v2Src);
const key = (r) => `${r[0]}::${r[1]}`;
const set1 = new Set(a1.map(key));
const added = a2.filter((r) => !set1.has(key(r)));
const removed = a1.filter((r) => !new Set(a2.map(key)).has(key(r)));
report.derived = { v1LiteralAssertions: a1.length, v2LiteralAssertions: a2.length, added, removed };

info(`v1 字面量计数断言 ${a1.length} 条 → v2 ${a2.length} 条；新增 ${added.length} 条、删除 ${removed.length} 条`);
for (const [lit, exp] of added) info(`  + 期望 ${exp} 次：${lit}`);

/** 审计 §3.3 的七条（按「新增字面量计数断言 + 函数体/调用点结构断言」两类）。 */
const NEW_COUNT_ASSERTIONS = [
  { v: 'V1', lit: 'const liveSessions = ctx.sessions.list();', exp: 1, why: '血缘边未改为 live 同源（或改了两处）' },
  { v: 'V2a', lit: 'const parentId = session.header.parentSession;', exp: 1, why: 'B② 缺陷原形回归（边仍来自 items）' },
  { v: 'V2b', lit: 'const parentId = item.parentSessionId;', exp: 0, why: 'B② 缺陷原形仍在' },
  { v: 'V3a', lit: '(b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)', exp: 1, why: 'B① 修复被抹掉' },
  { v: 'V3b', lit: '(a.id < b.id ? -1 : 1)', exp: 1, why: 'B① tiebreak 被抹掉' },
  { v: 'V4', lit: 'b.updatedAt - a.updatedAt', exp: 1, why: '冷候选退回裸比较器 / 误改收口排序（撞车断言）' },
];
{
  const addedMap = new Map(added.map((r) => [key(r), r]));
  for (const n of NEW_COUNT_ASSERTIONS) {
    const hit = addedMap.get(`${n.lit}::${n.exp}`);
    check('diff', `${n.v} 新增计数断言「${n.lit}」期望 ${n.exp} 次 —— 已由源码差分证实存在`, hit !== undefined, n.why);
  }
  check('diff', 'V5/V6/V7（结构断言：函数体自由标识符 / 首形参 / 调用点 arity）在 v2 中新增，且 v1 中不存在',
    v2Src.includes('freeIdentifierRoots') && v2Src.includes('聚合函数首形参不是 ctx') && v2Src.includes('聚合函数调用点实参不匹配')
    && !v1Src.includes('freeIdentifierRoots') && !v1Src.includes('聚合函数首形参不是 ctx'),
    'v1 无、v2 有 ⇒ 确为本轮新增');
  // 允许「删除」但必须是零条（v2 不得削弱 v1 的任何既有断言）
  check('diff', 'v2 **未删除** v1 的任何既有字面量计数断言（只增不减，防削弱）', removed.length === 0,
    removed.length === 0 ? `v1 ${a1.length} 条全部保留` : JSON.stringify(removed));
  check('diff', '新增计数断言条数 == 审计 §3.3 所载（V1/V2×2/V3×2/V4 = 6 条）', added.length === 6, `实得 ${added.length} 条`);
  report.groups.push({ name: 'diff', v1: a1, v2: a2, added, removed });
}

// ---------------------------------------------------------------------------
// 2) 九项判据（正向 2 + 反向 5 + 控制 1 + 对照 1）
// ---------------------------------------------------------------------------
console.log('\n=== 2) 九项判据 ===');
for (const [rel, key] of Object.entries(FILES)) {
  const vf = V2.verifyServerFilter(clean[key]);
  check('forward', `正向：v2 候选件 [${rel}] verifyServerFilter 零失败`, vf.length === 0, JSON.stringify(vf));
}
const MUTATIONS = [
  { id: 'M1', why: '去掉 ctx 形参（2026-09-20 生产事故原形；node --check 查不出）',
    apply: (s) => s.replace('function annotateRunningSubagentCounts(ctx, items) {', 'function annotateRunningSubagentCounts(items) {')
      .replace('return annotateRunningSubagentCounts(ctx, retained);', 'return annotateRunningSubagentCounts(retained);'),
    expect: /未声明|未接收 ctx|签名未声明/ },
  { id: 'M2', why: '形参改名（函数体仍引用 ctx ⇒ 形参不匹配）',
    apply: (s) => s.replace('function annotateRunningSubagentCounts(ctx, items) {', 'function annotateRunningSubagentCounts(a, b) {'),
    expect: /首形参不是 ctx|未声明/ },
  { id: 'M3', why: '冷候选比较器退回裸 b.updatedAt - a.updatedAt（B① 缺陷原形）',
    apply: (s) => s.replace('.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt) || (a.id < b.id ? -1 : 1))', '.sort((a, b) => b.updatedAt - a.updatedAt)'),
    expect: /期望 1 实得 2|期望 1 实得 0/ },
  { id: 'M4', why: '血缘边退回由已截断行构建（B② 缺陷原形）',
    apply: (s) => s.replace('const parentId = session.header.parentSession;', 'const parentId = item.parentSessionId;'),
    expect: /期望 0 实得 1|期望 1 实得 0/ },
  { id: 'M5', why: '调用点只传一个实参（arity 不符）',
    apply: (s) => s.replace('return annotateRunningSubagentCounts(ctx, retained);', 'return annotateRunningSubagentCounts(retained);'),
    expect: /调用点|期望 1 实得 0/ },
];
for (const m of MUTATIONS) {
  const mutated = m.apply(clean.bundled);
  const changed = mutated !== clean.bundled;
  const failures = V2.verifyServerFilter(mutated);
  const hit = failures.some((f) => m.expect.test(f));
  check('reverse', `${m.id} 反向对照被拒绝：${m.why}`, changed && failures.length > 0 && hit,
    `变异生效=${changed} 失败项=${failures.length} 命中预期=${hit} :: ${failures.slice(0, 2).join(' | ') || '（无失败 → 该断言空转！）'}`);
}
{
  const benign = clean.bundled.replace('\nfunction sessionListFields(', '\n/* benign audit note */\nfunction sessionListFields(');
  check('control', 'W1 控制：无关的中性注释编辑不得新增失败（防误报）',
    benign !== clean.bundled && V2.verifyServerFilter(benign).length === 0, JSON.stringify(V2.verifyServerFilter(benign)));
}
for (const [rel, key] of Object.entries(FILES)) {
  const v = V2.verifyServerFilter(deployed[key]);
  check('contrast', `C1 对照：现行 v1 部署 [${rel}] 被判失败（verifier 对本轮修订确有区分力）`, v.length > 0,
    `${v.length} 项：${v.slice(0, 3).join(' | ')}`);
}

// ---------------------------------------------------------------------------
// 3) verifier 自身不得空转：逐条判据的**破坏性自证**
//   方法：临时把 v2 规格里某条判据的探针字面量改掉（只在内存里的副本上），
//   断言该判据在「候选件」上由 PASS 变 FAIL。若破坏后仍 PASS ⇒ 该判据空转。
// ---------------------------------------------------------------------------
console.log('\n=== 3) verifier 破坏性自证（每条判据都必须能被证伪） ===');
const tmpDir = join(HERE, 'dryrun');
mkdirSync(tmpDir, { recursive: true });
/** 载入一份被篡改的 v2 规格副本（内存生成 → 落临时文件 → require → 删除）。 */
function specWithBroken(pattern, replacement, tag) {
  const src = v2Src.replace(pattern, replacement);
  if (src === v2Src) throw new Error(`破坏性自证的探针未命中 [${tag}]：${pattern}`);
  const p = join(tmpDir, `.broken-${tag}.cjs`);
  writeFileSync(p, src, 'utf8');
  delete require.cache[require.resolve(p)];
  return require(p);
}
const BREAKS = [
  { tag: 'V1', pattern: `['const liveSessions = ctx.sessions.list();', 1]`, replacement: `['const liveSessions = ctx.sessions.list();', 0]` },
  { tag: 'V4', pattern: `['b.updatedAt - a.updatedAt', 1]`, replacement: `['b.updatedAt - a.updatedAt', 2]` },
  { tag: 'V6', pattern: `if (params[0] !== 'ctx')`, replacement: `if (false)` },
  { tag: 'V7', pattern: `if (args.length !== params.length || args[0] !== 'ctx')`, replacement: `if (false)` },
  { tag: 'V5', pattern: `.filter((name) => !GLOBAL_ROOTS.has(name));`, replacement: `.filter(() => false);` },
];
/** 每个破坏项配一个「应当因此被漏掉」的变异：破坏后该变异不得再被这条判据拒绝。 */
const BREAK_PAIRS = {
  V1: { mut: (s) => s.replace('const liveSessions = ctx.sessions.list();\n', '') },
  V4: { mut: (s) => s.replace('.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt) || (a.id < b.id ? -1 : 1))', '.sort((a, b) => b.updatedAt - a.updatedAt)') },
  V6: { mut: (s) => s.replace('function annotateRunningSubagentCounts(ctx, items) {', 'function annotateRunningSubagentCounts(a, b) {') },
  V7: { mut: (s) => s.replace('return annotateRunningSubagentCounts(ctx, retained);', 'return annotateRunningSubagentCounts(retained);') },
  V5: { mut: (s) => s.replace('const parentId = session.header.parentSession;', 'const parentId = someUndeclaredThing.parentSession;') },
};
for (const b of BREAKS) {
  const intact = V2.verifyServerFilter(clean.bundled);
  const before = intact.length;
  let brokenSpec;
  try { brokenSpec = specWithBroken(b.pattern, b.replacement, b.tag); }
  catch (e) { check('self-proof', `${b.tag} 破坏性自证：探针字面量可被替换`, false, e.message); continue; }
  const mutated = BREAK_PAIRS[b.tag].mut(clean.bundled);
  const afterIntact = brokenSpec.verifyServerFilter(clean.bundled).length;
  const afterMutated = brokenSpec.verifyServerFilter(mutated).length;
  const beforeMutated = V2.verifyServerFilter(mutated).length;
  // 判据：未破坏时该变异被拒（≥1 项失败）；破坏后该变异**不再**被这条判据拒（失败数下降）
  const ok = beforeMutated >= 1 && afterMutated < beforeMutated;
  check('self-proof', `${b.tag} 破坏性自证：破坏该判据后，对应变异不再被这条判据拒绝（失败数 ${beforeMutated} → ${afterMutated}）`,
    ok, `未破坏时对候选件失败数=${before}，破坏后=${afterIntact}`);
}

// ---------------------------------------------------------------------------
// 4) 结论
// ---------------------------------------------------------------------------
report.failures = bad;
report.outcome = bad === 0 ? 'PASS' : 'FAIL';
mkdirSync(dirname(REPORT), { recursive: true });
writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`\n[self-proof] ${report.outcome}  失败 ${bad} 项 / 共 ${report.checks.length} 项  → ${REPORT}`);
process.exit(bad === 0 ? 0 : 2);
