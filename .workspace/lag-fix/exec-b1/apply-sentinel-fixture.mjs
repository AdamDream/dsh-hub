#!/usr/bin/env node
'use strict';
/**
 * exec-b1/apply-sentinel-fixture.mjs —— **DU-B1-D：哨兵夹具同步**（默认 dry-run，`--apply` 才写）。
 *
 * 契约：审计 §3.3 末尾的「🔴 必须同步的附带产物」+ `DECISIONS.md` 决策 5。
 *
 * ## 为什么必做（否则重启后**必然误报**）
 *
 * `probes/verify-b1-ctx-binding.mjs` 的 `fakeCtx.sessions.list()` 现在只回 `{ id }`，**没有 `header`**。
 * B② 的 A2 修订让函数体读 `session.header.parentSession` ⇒ 夹具会抛
 * `TypeError: Cannot read properties of undefined (reading 'parentSession')` ⇒ 哨兵**相 A 判 FAIL**。
 * 这是**夹具**缺陷，不是产品缺陷 —— 但会让「重启后复测」出现假失败。
 *
 * ## 本脚本做的事
 *
 *   1. 把夹具那一行替换为携带 `header`（含 `parentSession` / `origin` / `createdAt` / `delegationDepth`）的版本；
 *   2. 加一段 provenance 注释，写明「A2 后必须携带 header」与「**不得削弱相 B**」；
 *   3. 三向自证（写到 `exec-b1/sentinel/` 供核验，**不改 probes/ 原文件**）：
 *        · 对 **v2 候选件**（`dryrun/index.js`）→ 必须 PASS；
 *        · 对 **现行部署**（`~/.npm-global/.../lib/index.js`，v1）→ 必须 PASS（**向前兼容**）；
 *        · **相 B 反向对照**在两种产物上都必须仍抛 `ReferenceError`（证伪能力未被削弱）。
 *
 * 用法：
 *   node apply-sentinel-fixture.mjs            # dry-run：生成补丁后文件 + 三向自证，不写 probes/
 *   node apply-sentinel-fixture.mjs --apply    # 写回 probes/verify-b1-ctx-binding.mjs
 * 退出码：0 = 全部通过 / 2 = 失败（含「夹具未命中」这类硬错误）
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const optOf = (n, d) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
const APPLY = argv.includes('--apply');
const REPORT = optOf('--report', join(HERE, 'results', `apply-sentinel-fixture.${APPLY ? 'APPLY' : 'DRYRUN'}.json`));

const HOME = process.env.HOME ?? '/home/CNS2026495165';
const PROBE = join(HERE, '..', 'probes', 'verify-b1-ctx-binding.mjs');
const DSH = join(HOME, '.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js');
const CANDIDATE = join(HERE, 'dryrun', 'index.js');
const SENTINEL_DIR = join(HERE, 'sentinel');

const report = { at: new Date().toISOString(), mode: APPLY ? 'APPLY' : 'DRYRUN', checks: [], variantResults: {}, outcome: 'PENDING' };
let bad = 0;
const check = (name, ok, detail = '') => {
  report.checks.push({ name, ok: Boolean(ok), detail: String(detail) });
  if (!ok) bad += 1;
  const shown = typeof detail === 'string' && detail ? detail : String(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — ${shown}`);
};
const info = (m) => console.log(`      ${m}`);
const sha = (t) => createHash('sha256').update(t).digest('hex');

// ---------------------------------------------------------------------------
// 1) 定位并替换夹具行（**按内容特征**，不手写行号）
// ---------------------------------------------------------------------------
const src = readFileSync(PROBE, 'utf8');
report.source = { path: PROBE, sha256: sha(src), bytes: Buffer.byteLength(src) };
const OLD_FIXTURE = "  sessions: { list: () => rows.map((r) => ({ id: r.sessionId })) },";
const NEW_FIXTURE_LINES = [
  '  // ⚠️ B1-fix2（B② 策略①A2）：聚合函数已改由 `ctx.sessions.list()` 的 `header.parentSession` 建边，',
  '  //    因此夹具必须给出与宿主同形状的 `header`。**不得**为此改成 `new Function(\'ctx\', …)` 注入',
  '  //    （那会替被测代码补上缺失绑定 —— 正是 2026-09-20 事故的成因）。',
  '  sessions: { list: () => rows.map((r) => ({ id: r.sessionId, header: { id: r.sessionId, version: 1, createdAt: 1, delegationDepth: r.origin === \'subagent\' ? 1 : 0, ...(r.parentSessionId !== undefined ? { parentSession: r.parentSessionId } : {}), ...(r.origin !== undefined ? { origin: r.origin } : {}) } })) },',
];
const idx = src.split('\n').findIndex((l) => l === OLD_FIXTURE);
const occurrences = src.split(OLD_FIXTURE).length - 1;
check('fixture', '夹具行按内容特征唯一命中（不依赖行号）', occurrences === 1,
  `命中 ${occurrences} 次 @ 第 ${idx + 1} 行`);
if (occurrences !== 1) {
  report.outcome = 'REFUSED';
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.error('\n[REFUSED] 夹具锚点非唯一 —— 拒绝写入（避免误改哨兵语义）');
  process.exit(2);
}
// 幂等：若已含 header 说明已打过
if (src.includes("header: { id: r.sessionId, version: 1, createdAt: 1, delegationDepth:")) {
  info('夹具已含 header —— 幂等跳过替换，仅重跑三向自证');
}
const patched = src.replace(OLD_FIXTURE, NEW_FIXTURE_LINES.join('\n'));
report.patchedSha = sha(patched);
check('fixture', '替换后文件仍是合法 ESM（node --check）', (() => {
  const tmp = join(SENTINEL_DIR, 'verify-b1-ctx-binding.patched.mjs');
  mkdirSync(SENTINEL_DIR, { recursive: true });
  writeFileSync(tmp, patched, 'utf8');
  try { execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' }); return true; }
  catch (e) { info(String(e.stderr).slice(0, 300)); return false; }
})(), 'node --check');

// ---------------------------------------------------------------------------
// 2) 三向自证：v2 候选件 / 现行部署 / 相 B 反向对照
// ---------------------------------------------------------------------------
const patchedPath = join(SENTINEL_DIR, 'verify-b1-ctx-binding.patched.mjs');
mkdirSync(SENTINEL_DIR, { recursive: true });
writeFileSync(patchedPath, patched, 'utf8');

/** 跑一个哨兵变体，返回 {code, out}。 */
function runSentinel(script, file) {
  const outJson = join(SENTINEL_DIR, `out-${sha(script + file).slice(0, 8)}.json`);
  let code = 0; let out = '';
  try {
    out = execFileSync(process.execPath, [script, '--file', file, '--out', outJson], { stdio: 'pipe', encoding: 'utf8' });
  } catch (e) { code = e.status ?? 1; out = String(e.stdout ?? '') + String(e.stderr ?? ''); }
  let parsed = null;
  try { parsed = JSON.parse(readFileSync(outJson, 'utf8')); } catch { /* 无输出文件 */ }
  return { code, out: out.trim(), report: parsed, outJson };
}
const TARGETS = [
  { id: 'v2-candidate', label: 'v2 候选件（dryrun/index.js）', file: CANDIDATE },
  { id: 'deployed-v1', label: '现行部署（v1，向前兼容）', file: DSH },
];
info('');
for (const t of TARGETS) {
  const r = runSentinel(patchedPath, t.file);
  report.variantResults[t.id] = { code: r.code, verdict: r.report?.verdict ?? null, checks: r.report?.checks ?? [], file: t.file };
  info(`--- 更新后夹具 × ${t.label}`);
  for (const c of r.report?.checks ?? []) info(`    ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
  info(`    [verdict] ${r.report?.verdict} (exit ${r.code})`);
  check(`sentinel`, `更新后夹具 × ${t.label} → **PASS**`, r.report?.verdict === 'PASS' && r.code === 0,
    `verdict=${r.report?.verdict} exit=${r.code}`);
  check(`sentinel`, `更新后夹具 × ${t.label} → **相 B 反向对照仍抛 ReferenceError**（证伪能力未削弱）`,
    r.report?.phaseB?.threw === true, `phaseB.threw=${r.report?.phaseB?.threw} err=${r.report?.phaseB?.error ?? '无'}`);
}
// 对照组：**旧夹具**对 v2 候选件必须 FAIL（证明「不更新夹具 ⇒ 重启后假失败」这一论断为真）
{
  const r = runSentinel(PROBE, CANDIDATE);
  report.variantResults['v1-fixture-vs-v2-candidate'] = { code: r.code, verdict: r.report?.verdict ?? null, checks: r.report?.checks ?? [] };
  info(`--- 对照：**现行（未更新）夹具** × v2 候选件`);
  for (const c of r.report?.checks ?? []) info(`    ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
  info(`    [verdict] ${r.report?.verdict} (exit ${r.code})`);
  check('control', '对照：**现行未更新夹具**对 v2 候选件判 FAIL（证明「不同步夹具 ⇒ 重启后假失败」成立）',
    r.report?.verdict === 'FAIL', `verdict=${r.report?.verdict}；失败项=${(r.report?.checks ?? []).filter((c) => !c.ok).map((c) => c.name).join(' / ')}`);
}

// ---------------------------------------------------------------------------
// 3) 写入（仅 --apply）
// ---------------------------------------------------------------------------
if (report.variantResults['v2-candidate']?.verdict !== 'PASS'
  || report.variantResults['deployed-v1']?.verdict !== 'PASS') {
  report.outcome = 'REFUSED';
  console.error('\n[REFUSED] 三向自证未全通过 —— 拒绝写入 probes/');
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n', 'utf8');
  process.exit(2);
}
if (!APPLY) {
  report.writes = [{ path: patchedPath, sha256: report.patchedSha, dryRun: true }];
  info(`\ndry-run：补丁后哨兵已落盘 → ${patchedPath}（**未触碰** probes/）`);
  check('dry-run', '未触碰 probes/verify-b1-ctx-binding.mjs（sha 与读入时一致）',
    sha(readFileSync(PROBE, 'utf8')) === report.source.sha256, 'probes 原文件未变');
} else {
  writeFileSync(PROBE, patched, 'utf8');
  check('apply', 'probes/verify-b1-ctx-binding.mjs 已更新为携带 header 的夹具',
    sha(readFileSync(PROBE, 'utf8')) === report.patchedSha, sha(patched).slice(0, 16) + '…');
  const after = runSentinel(PROBE, CANDIDATE);
  check('apply', '写入后直接从 probes/ 跑哨兵 × v2 候选件 = PASS', after.report?.verdict === 'PASS',
    `verdict=${after.report?.verdict}`);
  report.writes = [{ path: PROBE, sha256: report.patchedSha, dryRun: false }];
}
report.failures = bad;
report.outcome = report.outcome === 'REFUSED' ? 'REFUSED' : (bad === 0 ? 'PASS' : 'FAIL');
mkdirSync(dirname(REPORT), { recursive: true });
writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`\n[mode=${report.mode}] outcome=${report.outcome}  失败 ${bad} 项 / 共 ${report.checks.length} 项  → ${REPORT}`);
process.exit(report.outcome === 'PASS' ? 0 : 2);
