#!/usr/bin/env node
'use strict';
/**
 * exec-b1/apply-B1-v2.mjs —— 单元 B1（B1-fix2）**落地脚本**。
 *
 * 交付单元：DU-B1-A（冷排序策略②B1）/ DU-B1-B（running 计数策略①A2）/ DU-B1-C（回放规格 v2）
 *            / DU-B1-D（哨兵夹具同步）/ DU-B1-E（pre-image 与回滚固化）
 * 契约：`exec-audit/b1/audit.md` §2/§3/§4；裁决：`exec-audit/b1/DECISIONS.md`
 *
 * ## 姿势（审计 §3.1，不得偏离）
 *
 * **对 pre-image 重放**，不是「在 live 上打增量补丁」：
 *
 *     deployed  --(必须等于)-->  applyServerFilter(pre_image)          [审计 §0-E2 不变量]
 *     pre_image --(本脚本)----->  target                            [sha256 必须等于期望值]
 *
 * 于是「规格 == 产物」这条不变量在修订后**恢复**，单一写入者、回滚点不变。
 *
 * ## 三态（**不要混淆**）
 *
 *   | 版本 | index.js sha256 | 角色 |
 *   |---|---|---|
 *   | deployed（现行部署） | `1b9915f5…` | patch 目标（`--apply` 写入它） |
 *   | pre-image | `142aac84…` | **规格输入**（`backup/B1/server/20260920-154039/lib/**`） |
 *   | target（v2 产物） | `96ad39b7…` | 写入后必须逐字节相等 |
 *
 *   ⚠️ `backup/B1/server/b1fix-20260920-183319/index.buggy.js`（`f568f8a9…`）**不是 pre-image**，
 *      它是「B1 已打但 `ctx` 缺参」的**中间故障态**；本脚本与回滚脚本都**只认** `20260920-154039/lib/**`。
 *
 * ## 用法
 *
 *   node apply-B1-v2.mjs                    # 默认 dry-run：全量校验，输出候选到内存并落盘到 --out，**不写 deployed**
 *   node apply-B1-v2.mjs --apply            # 真正写入 deployed（transactional；失败自动回滚）
 *   node apply-B1-v2.mjs --apply --out DIR  # 写入 DIR 而非 deployed（沙箱内端到端演练）
 *   node apply-B1-v2.mjs --report FILE.json # 指定报告落盘路径
 *
 * 写入前的**硬闸门**（任一不符即拒绝写入，exit 2）：
 *   1. deployed 两个文件 sha256 == 记录的现行部署值；
 *   2. pre-image 两个文件 sha256 == 记录的 pre-image 值；
 *   3. `applyServerFilter(pre_image)` 产出的 candidate sha256 == 记录的 target 值（自证不硬编码）；
 *   4. **锚点闸门**：14 条替换锚点 / 文件、24 条并集锚点 / 文件，**全部按期望命中**（撞车锚点按注册表计数）；
 *   5. `node --check`（两个候选件）+「引入标识符本文件内有声明」语义校验（`node --check` 查不出未声明标识符）。
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, renameSync, unlinkSync, chmodSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
/** 权威规格（v2）：落地后写出的字节由它决定。 */
const SPEC = require(join(HERE, 'B1-transform.v2.cjs'));
/** v1 规格只读副本：仅用于自证「规格对 pre-image 重放 == 现行部署」这条不变量。 */
const SPEC_V1 = require(join(HERE, 'spec', 'B1-transform.v1.cjs'));
const A = require(join(HERE, 'lib', 'anchors.cjs'));

// ---------------------------------------------------------------------------
// 路径与 pin
// ---------------------------------------------------------------------------
const HOME = process.env.HOME ?? '/home/CNS2026495165';
const DSH = join(HOME, '.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib');
/** **唯一权威 pre-image 目录**（审计 §5.1）。 */
const PRE = join(HERE, '..', 'backup', 'B1', 'server', '20260920-154039', 'lib');
/** ⚠️ 非 pre-image 的中间故障态（仅用于断言「不得被当作 pre-image」）。 */
const BUGGY = join(HERE, '..', 'backup', 'B1', 'server', 'b1fix-20260920-183319', 'index.buggy.js');

const PIN = {
  deployed: {
    'index.js': '1b9915f505996912c6f49b12b0c3f4a8261a74f26422f68f5d22cab2bc078a62',
    'types/api-proxy.js': 'f5c34a439043b9d5771286a76c8b16210951c25d7d5873b168bcc947720eac0d',
  },
  pre: {
    'index.js': '142aac84e462173aeb6acc3e36d97b5c6aae2a31a087b91f99cffeff48378374',
    'types/api-proxy.js': '7f56fb805fe4d8afbdbd9dee0c3e641acaf2d9c9831de0b7ea018e92b9343036',
  },
  target: {
    'index.js': '96ad39b7c37e1e0ab7ef07d991ee86f103c649b0ff595317ca32b6990a2c3310',
    'types/api-proxy.js': 'f4752c39623f863f9e5c9e455d1226d933bc1950e7b8c12b92cce87658165734',
  },
  targetBytes: { 'index.js': 217279, 'types/api-proxy.js': 175895 },
  buggyNotPreImage: 'f568f8a9e67ef123b8f08e659a435bbdff09dfc895e12a9729426c6b30051434',
};
const FILES = ['index.js', 'types/api-proxy.js'];
/** 两个候选件的**规格来源**：逐个文件独立重放，不共用中间态。 */
const SPEC_NOTE = {
  'index.js': '宿主实际加载（package.json main/exports["."] → lib/index.js）',
  'types/api-proxy.js': '同一逻辑源的独立构建；**运行时不可达**（无 exports 子路径、无 import 者）',
};

/** `usedIdentifiers` 白名单：被读文件派生的合法标识符（不是硬编码猜测，见 identifyUndeclared）。 */
const GLOBAL_WHITELIST = new Set(['Map', 'Set', 'Number', 'Math', 'Object', 'Array', 'String', 'Boolean', 'JSON',
  'globalThis', 'Date', 'Reflect', 'Symbol', 'Promise', 'Error', 'TypeError', 'RangeError', 'ReferenceError',
  'WeakMap', 'WeakSet', 'RegExp', 'Intl', 'BigInt', 'NaN', 'Infinity', 'undefined', 'isFinite', 'isNaN', 'parseInt',
  'parseFloat', 'queueMicrotask', 'structuredClone', 'console', 'process', 'require', 'import', 'eval', 'Function']);

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const optOf = (n, d) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
const APPLY = flag('--apply');
const OUT = optOf('--out', null);
const BACKUP_ROOT = optOf('--backup-root', join(HERE, '..', 'backup', 'B1', 'server'));
const REPORT = optOf('--report', join(HERE, 'results', `apply-B1-v2.${APPLY ? 'APPLY' : 'DRYRUN'}.json`));

// ---------------------------------------------------------------------------
// 报告骨架
// ---------------------------------------------------------------------------
const report = {
  at: new Date().toISOString(), mode: APPLY ? 'APPLY' : 'DRYRUN', targetDir: OUT ?? DSH, checks: [],
  anchors: {}, identifiers: {}, shas: {}, backups: null, writes: [], outcome: 'PENDING',
};
let exitCode = 0;
function check(name, ok, detail = '') {
  report.checks.push({ name, ok: Boolean(ok), detail: String(detail) });
  if (!ok) exitCode = Math.max(exitCode, 2);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  return Boolean(ok);
}
function info(m) { console.log(`      ${m}`); }
const sha = (t) => createHash('sha256').update(typeof t === 'string' ? Buffer.from(t, 'utf8') : t).digest('hex');
function fail(message) {
  report.outcome = 'REFUSED';
  console.error(`\n[REFUSED] ${message}`);
  writeReport();
  process.exit(2);
}

// ---------------------------------------------------------------------------
// 1) 三态 pin（deployed / pre-image / target），含「buggy 不是 pre-image」负向断言
// ---------------------------------------------------------------------------
console.log('=== 1) 三态 pin ===');
const deployed = {};
for (const rel of FILES) {
  const text = readFileSync(join(DSH, rel), 'utf8');
  const h = sha(text);
  deployed[rel] = text;
  report.shas[`deployed:${rel}`] = h;
  check(`deployed ${rel} sha256 == 记录的现行部署值`, h === PIN.deployed[rel], `${h.slice(0, 16)}… vs ${PIN.deployed[rel].slice(0, 16)}…`);
}
const pre = {};
for (const rel of FILES) {
  const text = readFileSync(join(PRE, rel), 'utf8');
  const h = sha(text);
  pre[rel] = text;
  report.shas[`pre:${rel}`] = h;
  check(`pre-image ${rel} sha256 == 记录的 pre-image 值（唯一权威回滚点）`, h === PIN.pre[rel], `${h.slice(0, 16)}… vs ${PIN.pre[rel].slice(0, 16)}…`);
}
{
  const buggy = readFileSync(BUGGY, 'utf8');
  const h = sha(buggy);
  report.shas['buggy(index.buggy.js)'] = h;
  check('负向：`b1fix-20260920-183319/index.buggy.js` 的 sha **不是**任何 pre-image（中间故障态，回滚不得认它）',
    h === PIN.buggyNotPreImage && h !== PIN.pre['index.js'] && h !== PIN.deployed['index.js'],
    `${h.slice(0, 16)}…（标记为「B1 已打但 ctx 缺参」的中间态）`);
}
check('负向：pre-image 目录内**没有** buggy 文件冒充 pre-image',
  !existsSync(join(PRE, 'index.buggy.js')), `pre-image 目录 = ${PRE}`);

// ---------------------------------------------------------------------------
// 2) 不变量（**用 v1 规格自证**）：applyServerFilter_v1(pre_image) == deployed
//    —— 审计 §0-E2。v2 规格**故意**产出不同字节（= 本次修订），因此 v2 在此处必须**不相等**，
//       该「不等」本身也是一条断言（证明 v2 确实改动了预期的那 4 处）。
// ---------------------------------------------------------------------------
console.log('\n=== 2) 不变量：v1 规格对 pre-image 重放 == 现行部署（审计 §0-E2） ===');
{
  const v1Path = join(HERE, 'spec', 'B1-transform.v1.cjs');
  const patchesPath = join(HERE, '..', 'patches', 'B1-transform.cjs');
  const stripHeader = (t) => t.slice(t.indexOf("'use strict';"));
  check('v1 只读副本的 body 与 `patches/B1-transform.cjs` 逐字节相同（只多 provenance 头注释）',
    stripHeader(readFileSync(v1Path, 'utf8')) === stripHeader(readFileSync(patchesPath, 'utf8')),
    `spec/B1-transform.v1.cjs ↔ patches/B1-transform.cjs（自证副本未被改写）`);
}
for (const rel of FILES) {
  let replayed;
  try { replayed = SPEC_V1.applyServerFilter(pre[rel]); } catch (e) { fail(`v1 规格对 pre-image 重放失败 [${rel}]：${e.message}`); }
  const same = replayed === deployed[rel];
  check(`[${rel}] applyServerFilter_v1(pre_image) 与现行部署**逐字节相同**（审计 §0-E2 不变量成立）`, same,
    `v1 replay ${sha(replayed).slice(0, 16)}… vs deployed ${sha(deployed[rel]).slice(0, 16)}…`);
  check(`[${rel}] v1 规格的 verifyServerFilter 对现行部署零失败（v1 自洽）`, SPEC_V1.verifyServerFilter(deployed[rel]).length === 0,
    JSON.stringify(SPEC_V1.verifyServerFilter(deployed[rel])));
}

// ---------------------------------------------------------------------------
// 3) target pin：规格重放 == 记录的期望 sha（自证期望值不是硬编码）
// ---------------------------------------------------------------------------
console.log('\n=== 3) target pin（候选件 sha256 必须等于审计期望值） ===');
const candidate = {};
for (const rel of FILES) {
  const out = SPEC.applyServerFilter(pre[rel]);
  const h = sha(out);
  candidate[rel] = out;
  report.shas[`target:${rel}`] = h;
  report.shas[`targetBytes:${rel}`] = Buffer.byteLength(out, 'utf8');
  check(`[${rel}] 候选件 sha256 == 审计给出的期望值`, h === PIN.target[rel], `${h.slice(0, 16)}… vs ${PIN.target[rel].slice(0, 16)}…`);
  check(`[${rel}] 候选件字节数 == 审计给出的期望值`, Buffer.byteLength(out, 'utf8') === PIN.targetBytes[rel],
    `${Buffer.byteLength(out, 'utf8')} B vs ${PIN.targetBytes[rel]} B`);
  const vf = SPEC.verifyServerFilter(out);
  check(`[${rel}] verifyServerFilter(候选件) 零失败`, vf.length === 0, JSON.stringify(vf));
}

// ---------------------------------------------------------------------------
// 4) 锚点闸门（**硬闸门**：非唯一/计数不符即拒绝写入）
// ---------------------------------------------------------------------------
console.log('\n=== 4) 锚点闸门（deployed 与 target 双向） ===');
for (const rel of FILES) {
  const d = A.probeAnchors(deployed[rel], 'deployed');
  const t = A.probeAnchors(candidate[rel], 'target');
  const ds = A.structuralPost(deployed[rel]);
  const ts = A.structuralPost(candidate[rel]);
  report.anchors[rel] = {
    deployed: { rows: d.rows, failures: d.failures },
    target: { rows: t.rows, failures: t.failures },
    structuralDeployed: ds.failures, structuralTarget: ts.failures,
  };
  const repl = t.rows.filter((r) => r.kind === 'replacement').length;
  check(`[${rel}] deployed 侧锚点：${d.rows.length} 条（含替换 ${repl} 条）全部按期望命中`, d.failures.length === 0,
    d.failures.length === 0 ? `锚点并集 ${d.rows.length} 条 / 替换 ${repl} 条（每条恰好命中，含撞车锚点按注册表计数）` : d.failures.join(' | '));
  check(`[${rel}] target 侧锚点：${t.rows.length} 条全部按期望命中`, t.failures.length === 0,
    t.failures.length === 0 ? 'ok' : t.failures.join(' | '));
  check(`[${rel}] deployed 侧结构判据：确认修订**尚未**落地（S1 撞车 2 次等）`, ds.failures.length === 6, `${ds.failures.length} 项未达标（预期 6）`);
  check(`[${rel}] target 侧结构判据：裸比较器恰好剩 1 次 + 血缘边同源 + 缺陷源清零`, ts.failures.length === 0,
    ts.failures.length === 0 ? ts.checks.map((c) => `${c.id}=${c.actual}`).join(' ') : ts.failures.join(' | '));
}

// ---------------------------------------------------------------------------
// 5) 语法 + 语义（node --check 只能验语法；未声明标识符必须另行断言）
// ---------------------------------------------------------------------------
console.log('\n=== 5) 语法（node --check）+ 语义（引入标识符必须在本文件内有声明） ===');
function nodeCheck(text, label) {
  const tmp = join(HERE, 'dryrun', `.syntax-${label}.mjs`);
  mkdirSync(dirname(tmp), { recursive: true });
  writeFileSync(tmp, text, 'utf8');
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: String(e.stderr ?? e.message).slice(0, 400) };
  } finally { try { unlinkSync(tmp); } catch { /* 忽略 */ } }
}
/** 大括号配平切片（跳过字符串/模板/注释）。 */
function sliceBody(text, at) {
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
  throw new Error('未配平');
}
/** 自由标识符根：`a.b` 只算 `a`；关键字/字面量/本块声明（含形参）不计。 */
function freeRoots(body, declared) {
  const stripped = body
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
  const local = new Set(declared);
  const KW = new Set(['const', 'let', 'var', 'for', 'of', 'in', 'if', 'else', 'return', 'continue', 'break',
    'while', 'new', 'true', 'false', 'null', 'void', 'function', 'typeof', 'this', 'do', 'switch', 'case',
    'default', 'await', 'async', 'delete', 'instanceof', 'yield', 'throw', 'try', 'catch', 'finally']);
  for (const m of stripped.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) local.add(m[1]);
  for (const m of stripped.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) local.add(m[1]);
  const roots = new Set();
  for (const m of stripped.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)/g)) {
    const name = m[1];
    if (KW.has(name) || local.has(name)) continue;
    roots.add(name);
  }
  return [...roots].sort();
}
/** 从**被读文件**派生该函数体内合法的外部标识符（不靠手抄白名单）。 */
function externalNamesInFile(text) {
  const names = new Set();
  for (const m of text.matchAll(/(?:^|\n)[ \t]*(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from/g)) for (const p of m[1].split(',')) names.add(p.trim().split(/\s+as\s+/).pop());
  for (const m of text.matchAll(/(?:^|\n)[ \t]*import\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  return names;
}
for (const rel of FILES) {
  const syn = nodeCheck(candidate[rel], basename(rel).replace(/\W/g, '_'));
  check(`[${rel}] node --check 通过（候选件语法合法）`, syn.ok, syn.error ?? 'ok');
  const at = candidate[rel].indexOf('function annotateRunningSubagentCounts(');
  if (at === -1) { check(`[${rel}] 聚合函数存在`, false, '未找到'); continue; }
  const body = sliceBody(candidate[rel], at);
  const sigEnd = body.indexOf('{');
  const params = body.slice(body.indexOf('(') + 1, body.lastIndexOf(')', sigEnd)).split(',').map((s) => s.trim()).filter(Boolean);
  const fileNames = externalNamesInFile(candidate[rel]);
  const roots = freeRoots(body, [...params, ...fileNames]);
  const undeclared = roots.filter((n) => !GLOBAL_WHITELIST.has(n));
  report.identifiers[rel] = { params, roots, undeclared, fileDeclaredSample: [...fileNames].slice(0, 12) };
  check(`[${rel}] 聚合函数首形参 == ctx（V6：9-20 事故直接判据）`, params[0] === 'ctx', `params=[${params.join(', ')}]`);
  check(`[${rel}] 「引入标识符必须在本文件内有声明」：聚合函数体内无未声明标识符（V5）`, undeclared.length === 0,
    undeclared.length === 0 ? `自由标识符根=[${roots.join(', ')}] 全部已声明/内建` : `未声明：[${undeclared.join(', ')}]`);
  check(`[${rel}] 插入文本无未展开的模板字面量残渣（审计 §8 坑#4 回归探针）`,
    !candidate[rel].includes('${u}') && !candidate[rel].includes('${lit('), '未发现 ${…} 残渣');
}

// ---------------------------------------------------------------------------
// 6) 写入（dry-run 默认不写 deployed）
// ---------------------------------------------------------------------------
console.log('\n=== 6) 写入 ===');
const destDir = OUT ?? DSH;
if (exitCode !== 0) fail('闸门未全通过 —— 拒绝任何写入（dry-run 亦不产出候选到目标目录）');

/** 备份 deployed 当前态 → stamp 目录（含 MANIFEST 与 rollback.sh）。 */
function backupDeployed() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  const dir = join(BACKUP_ROOT, `b1fix2-${stamp}`);
  mkdirSync(dir, { recursive: true });
  const entries = [];
  for (const rel of FILES) {
    const dst = join(dir, rel.replace(/\//g, '__'));
    copyFileSync(join(DSH, rel), dst);
    entries.push({ rel, backupPath: dst, deployedSha: sha(deployed[rel]), preImage: { path: join(PRE, rel), sha: PIN.pre[rel] }, target: { sha: PIN.target[rel] } });
  }
  const manifest = {
    unit: 'B1-fix2 (DU-B1-A/DU-B1-B/DU-B1-C/DU-B1-D/DU-B1-E)',
    at: new Date().toISOString(),
    note: 'pre-image（唯一权威回滚点，未被本批次修改）= backup/B1/server/20260920-154039/lib/**；'
      + '本目录只保存**写入前**的 deployed 态副本，便于二次回滚。'
      + '⚠️ backup/B1/server/b1fix-20260920-183319/index.buggy.js (f568f8a9…) **不是** pre-image。',
    rollbackPoint: { dir: join(HERE, '..', 'backup', 'B1', 'server', '20260920-154039', 'lib'), sha: PIN.pre },
    entries,
  };
  writeFileSync(join(dir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  writeFileSync(join(dir, 'pre.sha256.txt'), entries.map((e) => `${e.deployedSha}  ${e.rel}`).join('\n') + '\n', 'utf8');
  const L = DSH;
  const rollback = [
    '#!/usr/bin/env bash',
    '# 回滚 B1-fix2 → pre-image（唯一权威回滚点）。用法：bash rollback.sh',
    'set -euo pipefail',
    `L="${L}"`,
    `B="${join(HERE, '..', 'backup', 'B1', 'server', '20260920-154039', 'lib')}"`,
    `K="$(cd "$(dirname "$0")" && pwd)"`,
    'STAMP="$(date +%Y%m%d-%H%M%S)"',
    '# 0) 先给"当前态"留命副本（回滚本身也可再回滚）',
    'cp -p "$L/index.js"           "$L/index.js.keep-$STAMP"',
    'cp -p "$L/types/api-proxy.js" "$L/types/api-proxy.js.keep-$STAMP"',
    '# 1) 只还原 B1 这两个文件（-p 保留权限与 LF）',
    'cp -p "$B/index.js"           "$L/index.js"',
    'cp -p "$B/types/api-proxy.js" "$L/types/api-proxy.js"',
    '# 2) 断言回滚到位',
    'sha256sum "$L/index.js" "$L/types/api-proxy.js"',
    '#   期望 142aac84e462173aeb6acc3e36d97b5c6aae2a31a087b91f99cffeff48378374',
    '#        7f56fb805fe4d8afbdbd9dee0c3e641acaf2d9c9831de0b7ea018e92b9343036',
    'test "$(grep -c \'dsh-lag-fix\' "$L/index.js" || true)" = "0"',
    'test "$(grep -c \'runningSubagentCount\' "$L/index.js" || true)" = "0"',
    'echo "[rollback] pre-image 已还原；重启宿主后生效（session.list 将回到未过滤全量 2361 行 / ~3.9 MB）"',
    '',
  ].join('\n');
  writeFileSync(join(dir, 'rollback.sh'), rollback, 'utf8');
  chmodSync(join(dir, 'rollback.sh'), 0o755);
  return dir;
}

/** 事务式写入：先全部写 tmp，再逐个 rename；任一失败则用备份回滚已改名者。 */
function transactionalWrite(pairs) {
  const staged = [];
  for (const { rel, text } of pairs) {
    const abs = join(destDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    const tmp = `${abs}.b1fix2-tmp`;
    writeFileSync(tmp, text, 'utf8');
    staged.push({ rel, abs, tmp });
  }
  const done = [];
  try {
    for (const s of staged) { renameSync(s.tmp, s.abs); done.push(s); }
    return { ok: true, done };
  } catch (e) {
    for (const s of done) {
      const keep = join(HERE, 'dryrun', 'partial-rollback');
      mkdirSync(keep, { recursive: true });
      copyFileSync(join(BACKUP_ROOT, basename(s.abs)), join(keep, basename(s.abs)));
    }
    return { ok: false, error: String(e.message), done };
  } finally {
    for (const s of staged) { try { if (existsSync(s.tmp)) unlinkSync(s.tmp); } catch { /* 忽略 */ } }
  }
}

if (!APPLY) {
  // dry-run：把候选件落到工作区（默认 ./dryrun），供主 agent 比对与后续验证脚本消费。
  const outDir = OUT ?? join(HERE, 'dryrun');
  for (const rel of FILES) {
    const abs = join(outDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, candidate[rel], 'utf8');
    report.writes.push({ rel, path: abs, sha256: sha(candidate[rel]), dryRun: true });
    info(`dry-run 候选已落盘：${abs}`);
  }
  // dry-run 也必须自证：落盘后的字节 sha 仍等于期望值
  for (const rel of FILES) {
    const h = sha(readFileSync(join(outDir, rel), 'utf8'));
    check(`[dry-run][${rel}] 落盘候选件 sha256 == 期望值`, h === PIN.target[rel], h.slice(0, 16) + '…');
  }
  check('dry-run：**未触碰** deployed（deployed 两个文件 sha 仍为现行部署值）',
    FILES.every((rel) => sha(readFileSync(join(DSH, rel), 'utf8')) === PIN.deployed[rel]),
    FILES.map((rel) => `${rel}=${sha(readFileSync(join(DSH, rel), 'utf8')).slice(0, 12)}…`).join(' '));
  report.outcome = exitCode === 0 ? 'PASS' : 'FAIL';
} else {
  const backupDir = backupDeployed();
  report.backups = { dir: backupDir, entries: JSON.parse(readFileSync(join(backupDir, 'MANIFEST.json'), 'utf8')).entries };
  info(`deployed 写入前态已备份 → ${backupDir}`);
  const res = transactionalWrite(FILES.map((rel) => ({ rel, text: candidate[rel] })));
  if (!res.ok) {
    // 沙箱/权限受限是**预期内**结果（本档沙箱不可写 ~/.npm-global）：如实报告，不伪装成功、不上报审批。
    const denied = /EACCES|EPERM|EROFS|read-only|permission/i.test(res.error);
    check(`写入 ${destDir} 成功`, false, res.error);
    report.outcome = denied ? 'WRITE_BLOCKED_BY_SANDBOX' : 'WRITE_FAILED';
    report.hint = denied
      ? '路径不可写（沙箱/权限）。请由具备写权限的档执行同一命令：node exec-b1/apply-B1-v2.mjs --apply'
      : '写入失败；已落盘的备份目录可用于回滚。';
    fail(`写入被拒：${res.error}\n  备份在 ${backupDir}（回滚：bash ${join(backupDir, 'rollback.sh')}）`);
  }
  let allOk = true;
  for (const rel of FILES) {
    const text = readFileSync(join(destDir, rel), 'utf8');
    const h = sha(text);
    const ok = h === PIN.target[rel];
    allOk = allOk && ok;
    check(`[apply][${rel}] 写入后 sha256 == 期望值`, ok, `${h.slice(0, 16)}…`);
    const syn = nodeCheck(text, `post-${basename(rel).replace(/\W/g, '_')}`);
    allOk = allOk && syn.ok;
    check(`[apply][${rel}] 写入后 node --check 通过`, syn.ok, syn.error ?? 'ok');
    const t = A.probeAnchors(text, 'target');
    allOk = allOk && t.failures.length === 0;
    check(`[apply][${rel}] 写入后锚点全部按期望命中`, t.failures.length === 0, t.failures.join(' | ') || 'ok');
    report.writes.push({ rel, path: join(destDir, rel), sha256: h, dryRun: false });
  }
  report.outcome = allOk ? 'PASS' : 'FAIL';
  if (!allOk) console.error(`\n[!] 写入完成但后置断言未全通过 —— 回滚：bash ${join(backupDir, 'rollback.sh')}`);
}

writeReport();
console.log(`\n[mode=${report.mode}] outcome=${report.outcome}  checks=${report.checks.filter((c) => c.ok).length}/${report.checks.length}`);
process.exit(report.outcome === 'PASS' ? 0 : 2);

function writeReport() {
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`[report] ${REPORT}`);
}
