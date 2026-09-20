#!/usr/bin/env node
/**
 * test-c1-comparators.mjs —— C1 P2 三个引用稳定化比较器的字段级测试（只读）
 *
 * 为什么需要：P2 会"在内容不变时保留旧对象引用"以避免下游重渲染——这类比较器有**反向风险**：
 *  - 过宽（比较了不存在的字段名 / 漏比字段）→ 内容变了却判定相等 → **界面静默冻结**
 *  - 过窄 → 失去稳定化收益（性能问题，不是正确性问题）
 * 本测试从 **live 补丁件**里程序化抽出四个函数（抽不到即报错），逐字段验证"改一个字段必须判不等"。
 * 与发现 A 线门控死代码同一教训：**声明存在 ≠ 行为生效**。
 *
 * 用法：node tools/test-c1-comparators.mjs [--file <client.js>]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const FILE = arg('--file', path.join(os.homedir(), '.dsh/profiles/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js'));
const src = fs.readFileSync(FILE, 'utf8');

/** 抽出一个具名 function 的完整源码（按花括号配平），抽不到即抛错 */
function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`live 文件里找不到 function ${name}( —— 补丁可能未落地`);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`${name} 花括号不配平`);
}
const NAMES = ['sameIdList', 'sameJobViewList', 'sameSubagentCatalogs', 'sameSubagentCatalogEntries'];
const bodies = NAMES.map((n) => extract(n));
const sandbox = new Function(`${bodies.join('\n')}\nreturn { ${NAMES.join(', ')} };`)();
const { sameIdList, sameJobViewList, sameSubagentCatalogs, sameSubagentCatalogEntries } = sandbox;

let pass = 0, fail = 0;
const t = (desc, got, want) => {
  const ok = got === want;
  console.log(`  ${ok ? '✓' : '✗'} ${desc}  (期望 ${want}，实得 ${got})`);
  ok ? pass++ : fail++;
};

// ── sameIdList ──────────────────────────────────────────────────────────────
console.log('=== sameIdList ===');
const ids = ['a', 'b', 'c'];
t('相同内容的不同数组 → true（稳定化生效）', sameIdList(['a', 'b', 'c'], ids.slice()), true);
t('同一引用 → true', sameIdList(ids, ids), true);
t('元素变化 → false（不得静默冻结）', sameIdList(['a', 'X', 'c'], ids.slice()), false);
t('长度不同 → false', sameIdList(['a', 'b'], ids.slice()), false);
t('previous undefined → false', sameIdList(undefined, ids.slice()), false);
t('空数组对空数组 → true', sameIdList([], []), true);

// ── sameJobViewList：逐字段敏感性 ───────────────────────────────────────────
console.log('\n=== sameJobViewList（逐字段）===');
const JOB_FIELDS = ['id', 'kind', 'label', 'status', 'detail', 'startedAt', 'finishedAt'];
const job = (over = {}) => ({ id: 'j1', kind: 'tool', label: 'bash', status: 'running', detail: 'x', startedAt: 1, finishedAt: 2, ...over });
t('相同内容 → true', sameJobViewList([job()], [job()]), true);
for (const f of JOB_FIELDS) {
  const changed = job({ [f]: typeof job()[f] === 'number' ? 999 : 'CHANGED' });
  t(`字段 ${f} 变化 → false`, sameJobViewList([job()], [changed]), false);
}
t('长度不同 → false', sameJobViewList([job()], [job(), job()]), false);
t('undefined 元素 → false', sameJobViewList([undefined], [job()]), false);
t('空列表 → true', sameJobViewList([], []), true);

// ── sameSubagentCatalogEntries：逐字段敏感性 ────────────────────────────────
console.log('\n=== sameSubagentCatalogEntries（逐字段）===');
const ENT_FIELDS = ['kind', 'id', 'label', 'activity'];
const ent = (over = {}) => ({ kind: 'continuable', id: 's1', label: 'audit', activity: 'running', ...over });
t('相同内容 → true', sameSubagentCatalogEntries([ent()], [ent()]), true);
for (const f of ENT_FIELDS) {
  t(`字段 ${f} 变化 → false`, sameSubagentCatalogEntries([ent()], [ent({ [f]: 'CHANGED' })]), false);
}
t('长度不同 → false', sameSubagentCatalogEntries([ent()], [ent(), ent()]), false);
t('undefined 元素 → false', sameSubagentCatalogEntries([undefined], [ent()]), false);

// ── sameSubagentCatalogs：逐字段 + 键集合敏感性 ─────────────────────────────
console.log('\n=== sameSubagentCatalogs（逐字段 + 键集合）===');
const cat = (over = {}) => ({ state: 'ready', error: null, parentAvailable: true, entries: [ent()], ...over });
const wrap = (o) => ({ p1: cat(o) });
t('相同内容 → true', sameSubagentCatalogs(wrap(), wrap()), true);
for (const f of ['state', 'error', 'parentAvailable']) {
  const v = f === 'parentAvailable' ? false : (f === 'error' ? 'boom' : 'loading');
  t(`字段 ${f} 变化 → false`, sameSubagentCatalogs(wrap(), wrap({ [f]: v })), false);
}
t('entries 内容变化 → false', sameSubagentCatalogs(wrap(), wrap({ entries: [ent({ activity: 'done' })] })), false);
t('键增加 → false', sameSubagentCatalogs(wrap(), { p1: cat(), p2: cat() }), false);
t('键删除 → false', sameSubagentCatalogs({ p1: cat(), p2: cat() }, wrap()), false);
t('next undefined → false', sameSubagentCatalogs(wrap(), undefined), false);

// ── 交叉核对：被比较的字段名必须**在整棵依赖树里**真实存在（防"比较了不存在的字段"）──
// 注意：这些记录（JobView / SubagentCatalog）由其它包构造（如 dsh-client-connection），
// 只在 runtime 包里 grep 会误报，因此跨包统计（本目录下的 @deepseek-ai/* 与 dsh-*）。
console.log('\n=== 字段名真实性（跨包；防拼写导致的恒等比较）===');
const roots = [path.join(os.homedir(), '.dsh/profiles/node_modules')];
const files = [];
// 递归有限深度：node_modules 下有作用域目录（@deepseek-ai/*），只扫一层会漏掉（曾是误报来源）
const walk = (dir, depth) => {
  if (depth > 4) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    // 注意：profiles/node_modules 下的 @scope 往往是**符号链接**，withFileTypes 对链接 isDirectory()=false，
    // 只判断 isDirectory() 会整片漏扫（曾是本检查的误报来源）→ 用 statSync 兜底。
    let isDir = e.isDirectory();
    if (!isDir && e.isSymbolicLink()) { try { isDir = fs.statSync(p).isDirectory(); } catch { isDir = false; } }
    if (isDir) {
      if (e.name === 'node_modules') continue;
      if (e.name.startsWith('@')) { walk(p, depth + 1); continue; }   // 作用域目录
      if (e.name === 'lib' || depth <= 1) walk(p, depth + 1);
    } else if (e.name.endsWith('.js') && p.includes('/lib/')) files.push(p);
  }
};
for (const root of roots) walk(root, 0);
const corpus = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
for (const f of [...JOB_FIELDS, ...ENT_FIELDS, 'state', 'error', 'parentAvailable']) {
  const occurrences = (corpus.match(new RegExp(`\\b${f}\\s*:`, 'g')) || []).length;
  console.log(`  ${occurrences > 0 ? '✓' : '⚠️'} ${f}: 作为属性名在 ${files.length} 个文件里出现 ${occurrences} 次`);
  if (occurrences === 0) { fail++; } else { pass++; }
}
console.log('  说明：若某字段在此仍为 0，则该维度比较恒为「undefined !== undefined = false」→ 该维度变化会被漏判（静默冻结），需人工核查。');

console.log(`\n结果：PASS=${pass} FAIL=${fail}`);
console.log(fail === 0
  ? '判定：通过 —— 每个被比较字段都能正确判不等（不会静默冻结），且字段名真实存在'
  : '判定：存在问题 —— 见上方 ✗');
process.exit(fail === 0 ? 0 : 1);
