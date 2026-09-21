#!/usr/bin/env node
'use strict';
/**
 * exec-b1/probe-b1-counterfactual.mjs —— DU-B1-A/B 的**反事实几何**自证（只读，不建真实会话）。
 *
 * 契约：审计 §4.3（A5 反事实「必须通过」）+ 用户指令「用 `globalThis.__DSH_SUBAGENT_LIST_MAX=2`
 *       + 3 个子代理的低成本几何复现『201 subagent 且第 201 条 running』；真起 201 会话不建议」。
 *
 * ## 为什么这是**真**反事实，而不是自证循环
 *
 * 被测函数体**不是手抄**，而是从两个**真实产物**里按大括号配平切出来的字节：
 *
 *   legacy（修订前）  ← `deployed` 的 `lib/index.js`（现行部署 = B1 已打但 B② 有缺陷）
 *   fixed （修订后）  ← `dryrun/index.js`（v2 规格对 pre-image 重放的候选件）
 *
 * 冷路径的 `filter → sort → slice(0, MAX)` **也照实复刻**（含真比较器、真 MAX 常量），
 * 于是「哪一行被截断」由**真代码路径**决定，而不是由夹具作者指定。
 *
 * ## 期望值（全部由「未截断的同一 items 调同一函数」独立确立，不引外部真值）
 *
 *   1. MAX=2 + 3 subagent（**最低成本几何**）：legacy 截断通道 0 / fixed 1
 *   2. 两级链 p → a(running) → c-201(running)，c-201 被截断：legacy 1 → fixed 2
 *   3. 201 subagent 全量几何（审计 §4.3 的原始形态）：legacy 0 → fixed 1
 *   4. 零回归（无截断常规场景）：两版逐行一致
 *   5. 冷行（不在 live 表）不得被凭空计数：两版都 0
 *   6. 血缘环 a↔b：fixed 仍终止且不虚增
 *
 * 用法：node probe-b1-counterfactual.mjs [--report FILE.json]
 * 退出码：0 = 全部通过 / 2 = 有失败
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const optOf = (n, d) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
const REPORT = optOf('--report', join(HERE, 'results', 'probe-b1-counterfactual.json'));

const HOME = process.env.HOME ?? '/home/CNS2026495165';
const DSH = join(HOME, '.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib');
const FIXED_FILE = join(HERE, 'dryrun', 'index.js');

const report = { at: new Date().toISOString(), fixtures: [], checks: [], outcome: 'PENDING' };
let bad = 0;
const check = (group, name, ok, detail = '') => {
  report.checks.push({ group, name, ok: Boolean(ok), detail: String(detail) });
  if (!ok) bad += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${group}] ${name}${detail ? `  — ${detail}` : ''}`);
};
const info = (m) => console.log(`      ${m}`);

// ---------------------------------------------------------------------------
// 0) 从真实产物切出被测字节（不手抄）
// ---------------------------------------------------------------------------
const srcLegacy = readFileSync(join(DSH, 'index.js'), 'utf8');
const srcFixed = readFileSync(FIXED_FILE, 'utf8');

/** 大括号配平切片（跳过字符串/模板/注释）。 */
function sliceAt(text, at) {
  const braceAt = text.indexOf('{', at);
  let depth = 0;
  for (let i = braceAt; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i += 1;
      while (i < text.length) { if (text[i] === '\\') { i += 2; continue; } if (text[i] === q) break; i += 1; }
      continue;
    }
    if (c === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2); if (i < 0) break; i += 1; continue; }
    if (c === '{') depth += 1;
    else if (c === '}') { depth -= 1; if (depth === 0) return text.slice(at, i + 1); }
  }
  throw new Error('切片未配平');
}
const AGG = 'function annotateRunningSubagentCounts(';
const legacySrc = sliceAt(srcLegacy, srcLegacy.indexOf(AGG));
const fixedSrc = sliceAt(srcFixed, srcFixed.indexOf(AGG));
const legacyFn = new Function(`${legacySrc}; return annotateRunningSubagentCounts;`)();
const fixedFn = new Function(`${fixedSrc}; return annotateRunningSubagentCounts;`)();

/** 真 MAX 常量：从候选件里切出该表达式并在 `globalThis.__DSH_SUBAGENT_LIST_MAX=2` 下求值。 */
function realMax(override) {
  const at = srcFixed.indexOf('const SUBAGENT_LIST_MAX = Number.isFinite(');
  const end = srcFixed.indexOf(';', srcFixed.indexOf('  : 200', at));
  const expr = srcFixed.slice(at + 'const SUBAGENT_LIST_MAX = '.length, end);
  const prev = globalThis.__DSH_SUBAGENT_LIST_MAX;
  if (override === undefined) delete globalThis.__DSH_SUBAGENT_LIST_MAX;
  else globalThis.__DSH_SUBAGENT_LIST_MAX = override;
  try { return new Function(`return (${expr});`)(); }
  finally { if (prev === undefined) delete globalThis.__DSH_SUBAGENT_LIST_MAX; else globalThis.__DSH_SUBAGENT_LIST_MAX = prev; }
}
/** 真比较器（两代），从产物里切，不手抄。 */
const CMP_FIXED_SRC = '(a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt) || (a.id < b.id ? -1 : 1)';
const CMP_LEGACY_SRC = '(a, b) => b.updatedAt - a.updatedAt';
const cmpFixed = new Function(`return ${CMP_FIXED_SRC};`)();
const cmpLegacy = new Function(`return ${CMP_LEGACY_SRC};`)();

report.extracted = {
  legacyFile: join(DSH, 'index.js'), fixedFile: FIXED_FILE,
  legacyBodyBytes: Buffer.byteLength(legacySrc), fixedBodyBytes: Buffer.byteLength(fixedSrc),
  legacyHas: {
    'parentId = item.parentSessionId': legacySrc.includes('const parentId = item.parentSessionId;'),
    'for (const session of liveSessions)': legacySrc.includes('for (const session of liveSessions)'),
  },
  fixedHas: {
    'parentId = session.header.parentSession': fixedSrc.includes('const parentId = session.header.parentSession;'),
    'liveSessions 同源一趟': fixedSrc.includes('for (const session of liveSessions)'),
  },
  maxDefault: realMax(undefined), maxOverride2: realMax(2),
};
check('extract', '被测字节确实切自真实产物：legacy 含缺陷源行、fixed 含同源建边行',
  report.extracted.legacyHas['parentId = item.parentSessionId'] && report.extracted.fixedHas['parentId = session.header.parentSession'],
  `legacy ${Buffer.byteLength(legacySrc)} B / fixed ${Buffer.byteLength(fixedSrc)} B`);
check('extract', '真 MAX 常量：默认 200；`globalThis.__DSH_SUBAGENT_LIST_MAX=2` 时 == 2',
  report.extracted.maxDefault === 200 && report.extracted.maxOverride2 === 2,
  `default=${report.extracted.maxDefault} override=${report.extracted.maxOverride2}`);

// ---------------------------------------------------------------------------
// 夹具构造：live 会话表 + 冷路径真代码（filter→sort→slice）
// ---------------------------------------------------------------------------
/** 真 ctx 夹具：与宿主同形状（`{id, header:{id,parentSession?,origin?,createdAt,delegationDepth,version}}`）。 */
function buildCtx(live) {
  return {
    sessions: {
      list: () => live.map((s) => ({
        id: s.id,
        header: {
          id: s.id, version: 1, createdAt: s.createdAt ?? 1, delegationDepth: s.origin === 'subagent' ? 1 : 0,
          ...(s.parent !== undefined ? { parentSession: s.parent } : {}),
          ...(s.origin !== undefined ? { origin: s.origin } : {}),
        },
      })),
    },
    agents: { get: (id) => (live.find((s) => s.id === id)?.running ? { status: 'running' } : undefined) },
  };
}
/** 复刻**冷路径**：`coldSource.filter(origin===subagent).sort(cmp).slice(0, MAX)` ⇒ 被剔除的 id 集合。 */
function coldTruncation(metas, cmp, max) {
  const ordered = [...metas].filter((m) => m.origin === 'subagent').sort(cmp);
  const kept = ordered.slice(0, max).map((m) => m.id);
  const keptSet = new Set(kept);
  return { kept, dropped: metas.map((m) => m.id).filter((id) => !keptSet.has(id)) };
}
/** 用真函数在给定 items 上算顶层行的 runningSubagentCount。 */
function topCount(fn, live, items) {
  const out = fn(buildCtx(live), items.map((r) => ({ ...r })));
  const top = out.find((r) => r.origin !== 'subagent');
  return { value: top ? top.runningSubagentCount : null, rows: out.map((r) => `${r.sessionId}:${r.runningSubagentCount ?? '-'}`).join(',') };
}

/**
 * 核心夹具：N 条 subagent 挂在顶层 p 上，**最新创建的一条**（@N）running；MAX 可压到 2。
 *
 * 两条路径的**截断集合各自按各自的真比较器**决定（这才是真反事实）：
 *   - legacy 路径：冷候选用 legacy 比较器（`updatedAt` 缺失 ⇒ NaN ⇒ 退化为**目录枚举序**，
 *                 本夹具的枚举序 = createdAt 升序）截断 ⇒ 剔除的是**最新**的那些（含 running 行）；
 *   - fixed  路径：冷候选用 fixed 比较器（`createdAt` 降序）截断 ⇒ 剔除的是**最旧**的那些。
 * 再把各自 items 喂给**对应的真函数**，数顶层行的 runningSubagentCount。
 * 真值由「未截断的同一 items 调同一函数」独立确立（= 1），不引外部真值。
 */
function scenarioOldestRunning(N, max) {
  // origin 必须显式为顶层值：按 live 语义，`origin !== 'subagent'` 的行**不参与** slice 截断。
  const live = [{ id: 'p', createdAt: 0, origin: 'top' },
    ...Array.from({ length: N }, (_, i) => ({ id: `s-${String(i + 1).padStart(3, '0')}`, parent: 'p', origin: 'subagent', createdAt: i + 1, running: i + 1 === N }))];
  const metas = live.filter((s) => s.origin === 'subagent')
    .map((s) => ({ version: 1, id: s.id, createdAt: s.createdAt, delegationDepth: 1, origin: 'subagent' }));
  const truncLegacy = coldTruncation(metas, cmpLegacy, max);   // NaN ⇒ 枚举序（升序）前 max
  const truncFixed = coldTruncation(metas, cmpFixed, max);     // createdAt 降序前 max
  const runningId = `s-${String(N).padStart(3, '0')}`;
  const rowsOf = (ids) => [{ sessionId: 'p' }, ...ids.map((id) => ({ sessionId: id, origin: 'subagent', parentSessionId: 'p' }))];
  const allRows = rowsOf(metas.map((m) => m.id));
  return {
    max, N, runningId,
    legacyDropped: truncLegacy.dropped, fixedDropped: truncFixed.dropped,
    dropped: truncLegacy.dropped, runningDropped: truncLegacy.dropped.includes(runningId),
    legacyKept: truncLegacy.kept, fixedKept: truncFixed.kept,
    legacyTruncated: topCount(legacyFn, live, rowsOf(truncLegacy.kept)).value,
    fixedTruncated: topCount(fixedFn, live, rowsOf(truncFixed.kept)).value,
    legacyFull: topCount(legacyFn, live, allRows).value,
    fixedFull: topCount(fixedFn, live, allRows).value,
  };
}

// ---------------------------------------------------------------------------
// 夹具 1（**最低成本几何**）：MAX=2 + 3 个子代理，最旧那条 running
// ---------------------------------------------------------------------------
console.log('\n=== 夹具 1（最低成本几何）：__DSH_SUBAGENT_LIST_MAX=2 + 3 个子代理，第 3 条 running ===');
{
  const r = scenarioOldestRunning(3, report.extracted.maxOverride2);
  report.fixtures.push({ id: 'F1-low-cost-max2', ...r });
  info(`真截断通道：被剔除 ${JSON.stringify(r.dropped)}（running 行被剔除 = ${r.runningDropped}）`);
  check('F1', '未截断时 same items 真值 = 1（排除「状态查询失败」这一解释）', r.legacyFull === 1 && r.fixedFull === 1,
    `legacy=${r.legacyFull} fixed=${r.fixedFull}`);
  check('F1', '修订前：截断通道漏计为 **0**（缺陷实跑成立）', r.legacyTruncated === 0, `legacy=${r.legacyTruncated}`);
  check('F1', '修订后：截断通道仍为 **1**（A2 关闭「收口截断」通道）', r.fixedTruncated === 1, `fixed=${r.fixedTruncated}`);
}

// ---------------------------------------------------------------------------
// 夹具 2：两级链 p → a(running) → c(running)。
//   F2a = 「**自身行**被剔除的 running 后代」：legacy 由 items 建边 ⇒ 查不到 c 的入边贡献
//         （c 的 edge 需要 c 这一行存在）⇒ 只数到 a = 1；fixed 沿 live 血缘 ⇒ 2。
//   F2b = 「**祖先行**被剔除的 running 后代」：a 行不存在 ⇒ legacy 连 a 都不知道，
//         更谈不上 c ⇒ **完全漏计** = 0；fixed 仍为 2。
//         这一格是 A2 相对「补 keep-set 豁免」的关键优势：豁免只能救「自身行」，救不了「祖先行」。
// ---------------------------------------------------------------------------
console.log('\n=== 夹具 2：两级链 p → a(running) → c(running) ===');
{
  const live = [{ id: 'p', createdAt: 0, origin: 'top' },
    { id: 'a', parent: 'p', origin: 'subagent', createdAt: 1, running: true },
    { id: 'c', parent: 'a', origin: 'subagent', createdAt: 2, running: true }];
  const rowsAll = [{ sessionId: 'p' },
    { sessionId: 'a', origin: 'subagent', parentSessionId: 'p' },
    { sessionId: 'c', origin: 'subagent', parentSessionId: 'a' }];
  const full = topCount(fixedFn, live, rowsAll).value;
  const legacyFull = topCount(legacyFn, live, rowsAll).value;

  // F2a：c 自身行被剔除（a 保留）
  const rowsA = [{ sessionId: 'p' }, { sessionId: 'a', origin: 'subagent', parentSessionId: 'p' }];
  const legacyA = topCount(legacyFn, live, rowsA).value;
  const fixedA = topCount(fixedFn, live, rowsA).value;

  // F2b：a 祖先行被剔除（c 保留）
  const rowsB = [{ sessionId: 'p' }, { sessionId: 'c', origin: 'subagent', parentSessionId: 'a' }];
  const legacyB = topCount(legacyFn, live, rowsB).value;
  const fixedB = topCount(fixedFn, live, rowsB).value;

  report.fixtures.push({ id: 'F2-two-level-chain', full, legacyFull, legacyA, fixedA, legacyB, fixedB,
    rowsA, rowsB });
  check('F2', '未截断真值 = 2（a + c，两版一致）', full === 2 && legacyFull === 2, `fixed=${full} legacy=${legacyFull}`);
  check('F2a', '「自身行被剔除」：修订前 = **1**（只数到 a），修订后 = **2**（审计 §2.2 的 1→2）',
    legacyA === 1 && fixedA === 2, `legacy=${legacyA} → fixed=${fixedA}`);
  check('F2b', '「祖先行被剔除」：修订前 **完全漏计** = 0，修订后仍 = 2（keep-set 豁免救不了这一格）',
    legacyB === 0 && fixedB === 2, `legacy=${legacyB} → fixed=${fixedB}`);
}

// ---------------------------------------------------------------------------
// 夹具 3：审计 §4.3 的原始形态（201 subagent、第 201 条 = 最新的一条 running、MAX=200）
// ---------------------------------------------------------------------------
console.log('\n=== 夹具 3：201 subagent、最新一条（第 201 条）running、MAX=200（审计 §4.3 原始反事实） ===');
{
  const r = scenarioOldestRunning(201, report.extracted.maxDefault);
  report.fixtures.push({ id: 'F3-201-subagents', ...r });
  info(`legacy 枚举序截断 ⇒ 剔除 ${JSON.stringify(r.legacyDropped)}（= 最新那一条，正是 running 行）`);
  check('F3', 'legacy 枚举序截断下**第 201 条 running 行确实被剔除**（恰 1 条）',
    r.runningDropped && r.legacyDropped.length === 1, `dropped=${JSON.stringify(r.legacyDropped)}`);
  check('F3', '修订前 0 / 修订后 1（审计 V-1 复现：真值 1 由未截断同 items 独立确立）',
    r.legacyTruncated === 0 && r.fixedTruncated === 1 && r.legacyFull === 1 && r.fixedFull === 1,
    `truncated legacy=${r.legacyTruncated} → fixed=${r.fixedTruncated}；full legacy=${r.legacyFull} fixed=${r.fixedFull}`);
  check('F3', '附注：fixed 比较器下被剔除的是**最旧**的 s-001（B① 语义变更，与被剔除的 running 行无关）',
    r.fixedDropped.join(',') === 's-001', `fixedDropped=${JSON.stringify(r.fixedDropped)}`);
}

// ---------------------------------------------------------------------------
// 夹具 4：零回归（无截断常规场景，逐行一致）
// ---------------------------------------------------------------------------
console.log('\n=== 夹具 4：零回归（无截断常规场景） ===');
{
  const live = [
    { id: 'p1', createdAt: 1 }, { id: 'p2', createdAt: 1 },
    { id: 'a', parent: 'p1', origin: 'subagent', createdAt: 2, running: true },
    { id: 'b', parent: 'a', origin: 'subagent', createdAt: 3, running: true },
    { id: 'c', parent: 'p1', origin: 'subagent', createdAt: 4 },
    { id: 'd', parent: 'p2', origin: 'subagent', createdAt: 5, running: true },
  ];
  const rows = [{ sessionId: 'p1' }, { sessionId: 'p2' },
    ...live.filter((s) => s.origin === 'subagent').map((s) => ({ sessionId: s.id, origin: 'subagent', parentSessionId: s.parent }))];
  const l = topCount(legacyFn, live, rows);
  const f = topCount(fixedFn, live, rows);
  report.fixtures.push({ id: 'F4-zero-regression', legacy: l.rows, fixed: f.rows });
  check('F4', '无截断场景下修订前后**逐行计数完全一致**', l.rows === f.rows, `legacy[${l.rows}] fixed[${f.rows}]`);
  check('F4', '语义值正确（p1=2、p2=1，subagent 行不写该字段）', f.rows === 'p1:2,p2:1,a:-,b:-,c:-,d:-', f.rows);
}

// ---------------------------------------------------------------------------
// 夹具 5：冷行（不在 live 会话表）不得被凭空计数
// ---------------------------------------------------------------------------
console.log('\n=== 夹具 5：冷行不得被计数 ===');
{
  const live = [{ id: 'p', createdAt: 1 }];
  const rows = [{ sessionId: 'p' }, { sessionId: 'cold-1', origin: 'subagent', parentSessionId: 'p' }];
  const l = topCount(legacyFn, live, rows).value;
  const f = topCount(fixedFn, live, rows).value;
  report.fixtures.push({ id: 'F5-cold-row', legacy: l, fixed: f });
  check('F5', '冷行（不在 live 表）两版都为 0（不得凭空计数）', l === 0 && f === 0, `legacy=${l} fixed=${f}`);
}

// ---------------------------------------------------------------------------
// 夹具 6：血缘环 a↔b 必须终止
// ---------------------------------------------------------------------------
console.log('\n=== 夹具 6：血缘环终止 ===');
{
  const live = [{ id: 'p', createdAt: 1 },
    { id: 'a', parent: 'b', origin: 'subagent', createdAt: 2, running: true },
    { id: 'b', parent: 'a', origin: 'subagent', createdAt: 3 }];
  const rows = [{ sessionId: 'p' }];
  let ok = true; let v = null; let err = null;
  const t0 = Date.now();
  try { v = topCount(fixedFn, live, rows).value; } catch (e) { ok = false; err = String(e.message); }
  const ms = Date.now() - t0;
  report.fixtures.push({ id: 'F6-cycle', value: v, ms, error: err });
  check('F6', '血缘环（a↔b）下修订版终止且不虚增（p 无入边 ⇒ 0）', ok && v === 0 && ms < 2000, `value=${v} ms=${ms} err=${err ?? '无'}`);
}

// ---------------------------------------------------------------------------
// 夹具 7：**真冷路径全链**（filter→sort→slice 由真比较器 + 真 MAX 驱动）
//   与夹具 1 互补：夹具 1 用 fixed 比较器取截断集合（同一份数据、两代函数共享同一截断集合），
//   此处显式证明「两代比较器对**同一份真实形状 meta**给出的截断集合不同 ⇒ 被剔除的 running 行不同」。
// ---------------------------------------------------------------------------
console.log('\n=== 夹具 7：两代比较器在同一份真实形状冷 meta 上的截断集合对拍 ===');
{
  const N = 3; const max = 2;
  const metas = Array.from({ length: N }, (_, i) => ({ version: 1, id: `s-${i + 1}`, createdAt: i + 1, delegationDepth: 1, origin: 'subagent' }));
  const oldChain = coldTruncation(metas, cmpLegacy, max);
  const newChain = coldTruncation(metas, cmpFixed, max);
  report.fixtures.push({ id: 'F7-comparator-truncation', oldChain, newChain });
  info(`legacy 比较器（NaN）截断集合 = ${JSON.stringify(oldChain.kept)}（= 目录枚举序前 ${max}）`);
  info(`fixed  比较器（createdAt 降序）截断集合 = ${JSON.stringify(newChain.kept)}`);
  check('F7', '两代比较器给出的截断集合**不同**（legacy 在 cold meta 上返回 NaN ⇒ 退化为枚举序）',
    JSON.stringify(oldChain.kept) !== JSON.stringify(newChain.kept),
    `legacy=${JSON.stringify(oldChain.kept)} vs fixed=${JSON.stringify(newChain.kept)}`);
  check('F7', 'legacy 比较器在冷 meta 上返回 NaN（键不成立，实跑）',
    Number.isNaN(cmpLegacy(metas[0], metas[1])), 'b.updatedAt - a.updatedAt = NaN');
  check('F7', 'fixed 比较器在冷 meta 上返回有限数（显式回落 createdAt）',
    Number.isFinite(cmpFixed(metas[0], metas[1])), `cmp=${cmpFixed(metas[0], metas[1])}`);
}

report.failures = bad;
report.outcome = bad === 0 ? 'PASS' : 'FAIL';
mkdirSync(dirname(REPORT), { recursive: true });
writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`\n[verdict] ${report.outcome}  失败 ${bad} 项 / 共 ${report.checks.length} 项  → ${REPORT}`);
process.exit(bad === 0 ? 0 : 2);
