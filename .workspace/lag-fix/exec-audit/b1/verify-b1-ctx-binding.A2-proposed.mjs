#!/usr/bin/env node
/**
 * probes/verify-b1-ctx-binding.mjs — B1 补丁「聚合函数作用域绑定」的行为验证（只读）
 * ============================================================================
 * 背景（2026-09-20 生产事故）：B1 补丁把 annotateRunningSubagentCounts 写成**模块级**函数，
 * 函数体引用 `ctx`，而 `ctx` 只是 createApiProxy(ctx, defaults) 的形参 —— 不在该函数作用域内。
 * 后果：宿主重启（补丁生效）后 POST /api/session.list 抛
 *       `handler failure: ReferenceError: ctx is not defined` → HTTP 500 → GUI 会话列表全空白。
 *
 * 为什么此前 4 条审计 + 语义测试都没抓到：测试用 `new Function('ctx', fnSrc + '…')`
 * **把 ctx 注入成包装函数形参**，等于替被测代码补上了缺失的绑定 —— 缺陷在测试里不可能显形。
 *
 * 本探针的判据（自带反向对照，避免再次"测试无法证伪实现"）：
 *   相 A（正向） 从被验证文件抽出真实函数体，**不注入 ctx**，用 (ctx, rows) 调用 → 必须成功且计数正确
 *   相 B（反向） 把同一函数体改回旧签名 `(items)` 后再跑 → **必须**抛 ReferenceError
 *   相 B 不抛 = 本探针失效（说明注入又出现了），判 INCONCLUSIVE 而非 PASS
 *
 * 用法:
 *   node probes/verify-b1-ctx-binding.mjs                       # 验已安装宿主件（默认）
 *   node probes/verify-b1-ctx-binding.mjs --file <path>         # 验指定文件（如 dry-run 产物）
 *   node probes/verify-b1-ctx-binding.mjs --out <path.json>     # 落盘证据
 * 退出码: 0 = PASS / 1 = FAIL / 2 = INCONCLUSIVE
 * ============================================================================
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
const FILE = argOf('--file', '/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js');
const OUT = argOf('--out', null);

const report = { at: new Date().toISOString(), file: FILE, checks: [], verdict: 'PENDING' };
const check = (name, ok, detail) => { report.checks.push({ name, ok: Boolean(ok), detail }); return Boolean(ok); };

// ---- 抽出真实的 annotateRunningSubagentCounts 函数体（按大括号配平，不靠写死行号） ----
const src = readFileSync(FILE, 'utf8');
const at = src.search(/function annotateRunningSubagentCounts\(/);
if (at === -1) { report.verdict = 'FAIL'; report.checks.push({ name: '定位聚合函数', ok: false, detail: '未找到 annotateRunningSubagentCounts' }); emit(); }
const braceAt = src.indexOf('{', at);
let depth = 0;
let end = -1;
for (let i = braceAt; i < src.length; i += 1) {
  const c = src[i];
  if (c === '{') depth += 1;
  else if (c === '}') { depth -= 1; if (depth === 0) { end = i + 1; break; } }
}
const fnSrc = src.slice(at, end);
const signature = src.slice(at, src.indexOf('{', at)).trim();
check('定位聚合函数', end > at, `signature = ${signature.replace(/\s+/g, ' ')}`);
check('签名声明 ctx 形参', /\(\s*ctx\s*,/.test(signature), signature.replace(/\s+/g, ' '));

// ---- 夹具：3 层血缘链 + 1 条无父顶层，只有部分 live ----
const rows = [
  { sessionId: 'top1', origin: undefined, parentSessionId: undefined },
  { sessionId: 'sub-a', origin: 'subagent', parentSessionId: 'top1' },
  { sessionId: 'sub-b', origin: 'subagent', parentSessionId: 'sub-a' },
  { sessionId: 'sub-c', origin: 'subagent', parentSessionId: 'top1' },
  { sessionId: 'sub-orphan', origin: 'subagent', parentSessionId: 'top2' },
  { sessionId: 'top2', origin: undefined, parentSessionId: undefined },
];
const running = new Set(['sub-a', 'sub-b', 'sub-orphan']);
const fakeCtx = {
  sessions: { list: () => rows.map((r) => ({ id: r.sessionId, header: { id: r.sessionId, version: 1, createdAt: 1, delegationDepth: r.origin === 'subagent' ? 1 : 0, ...(r.parentSessionId !== undefined ? { parentSession: r.parentSessionId } : {}), ...(r.origin !== undefined ? { origin: r.origin } : {}) } })) },
  agents: { get: (id) => (running.has(id) ? { status: 'running' } : undefined) },
};

// ---- 相 A：正向 —— 不注入 ctx，靠函数自身签名接收 ----
let phaseA = { ok: false, error: null, counts: null };
try {
  const fn = new Function(`${fnSrc}; return annotateRunningSubagentCounts;`)();
  const out = fn(fakeCtx, rows.map((r) => ({ ...r })));
  const counts = Object.fromEntries(out.filter((r) => r.origin !== 'subagent').map((r) => [r.sessionId, r.runningSubagentCount]));
  // top1 后代 = sub-a, sub-b, sub-c（3 条），其中 live = sub-a, sub-b → 2
  // top2 后代 = sub-orphan，live → 1
  const expect = { top1: 2, top2: 1 };
  phaseA = { ok: JSON.stringify(counts) === JSON.stringify(expect), error: null, counts, expect };
  check('相A 正向：不注入 ctx 调用不抛错', true, 'no throw');
  check('相A 正向：runningSubagentCount 语义正确', phaseA.ok, `实得 ${JSON.stringify(counts)} 期望 ${JSON.stringify(expect)}`);
} catch (e) {
  phaseA.error = String(e && e.message ? e.message : e);
  check('相A 正向：不注入 ctx 调用不抛错', false, phaseA.error);
}

// ---- 相 B：反向对照 —— 还原旧签名 (items)，必须抛 ReferenceError ----
let phaseB = { threw: false, error: null };
try {
  const legacySrc = fnSrc.replace(/function annotateRunningSubagentCounts\(\s*ctx\s*,\s*items\s*\)/, 'function annotateRunningSubagentCounts(items)');
  const legacyFn = new Function(`${legacySrc}; return annotateRunningSubagentCounts;`)();
  legacyFn(rows.map((r) => ({ ...r })));
  phaseB.threw = false;
} catch (e) {
  phaseB.threw = e instanceof ReferenceError;
  phaseB.error = String(e && e.message ? e.message : e);
}
check('相B 反向对照：旧签名必须抛 ReferenceError（探针有效性自证）', phaseB.threw, phaseB.error ?? '未抛错 → 反向对照失效');

report.phaseA = phaseA;
report.phaseB = phaseB;
const failed = report.checks.filter((c) => !c.ok);
// 若相 B 未抛错，说明本探针丧失了证伪能力 → INCONCLUSIVE（不假装 PASS）
if (!phaseB.threw) report.verdict = 'INCONCLUSIVE';
else report.verdict = failed.length === 0 ? 'PASS' : 'FAIL';
emit();

function emit() {
  for (const c of report.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
  console.log(`\n[verdict] ${report.verdict}   file=${path.basename(FILE)}`);
  if (OUT) { writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n', 'utf8'); console.log(`[out] ${OUT}`); }
  process.exit(report.verdict === 'PASS' ? 0 : report.verdict === 'INCONCLUSIVE' ? 2 : 1);
}
