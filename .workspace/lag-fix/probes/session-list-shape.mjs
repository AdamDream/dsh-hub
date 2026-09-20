#!/usr/bin/env node
/**
 * probes/session-list-shape.mjs — 单元 B1 只读探针
 * ============================================================================
 * 目的：用**一次** `POST /api/session.list` 验证「过滤 + 聚合字段」是否生效。
 * 全程只读：不写任何文件（可选落盘报告）、不重启、不压测、不触碰宿主进程。
 *
 * 用法：
 *   node probes/session-list-shape.mjs                 # 打印结论 + 与基线比对
 *   node probes/session-list-shape.mjs --baseline <p>  # 用真实 payload 快照当基线（默认 settings-lag/session_list.json）
 *   node probes/session-list-shape.mjs --out <p>       # 把本次响应存到工作区（默认不落盘）
 *   node probes/session-list-shape.mjs --url http://127.0.0.1:3080
 *
 * 验收断言（对应 audit-subagent-filter.md §7 的 A1/A2/A3 + 聚合字段）：
 *   A1 条目数       2361 → ≤ 284（顶层 + 200）
 *   A2 响应字节     3,885,937 → ≤ 500 KB
 *   A3 顶层会话     84 条逐 ID 相等（一条不少、不多）
 *   A6 聚合字段     全部顶层行出现 `runningSubagentCount`（number）
 *   A7 subagent 行  ≤ 200，且是 updatedAt 最新的那批
 * ============================================================================
 */

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};

const URL_BASE = argOf('--url', process.env.B1_URL ?? 'http://127.0.0.1:3080');
const BASELINE_PATH = argOf(
  '--baseline',
  process.env.B1_BASELINE ?? resolve(ROOT, '../settings-lag/session_list.json')
);
const OUT_PATH = argOf('--out', process.env.B1_OUT ?? '');
const MAX_SUBAGENTS = Number(argOf('--max-subagents', process.env.B1_MAX ?? '200'));
// 硬门槛 = 顶层条数 + MAX_SUBAGENTS（审计给的 284 是「84 顶层 + 200」的快照值；
// 顶层会话会随使用增长，故这里按当前快照动态计算，避免把正常增量误判为失败）。
const ITEM_LIMIT = (topCount) => topCount + MAX_SUBAGENTS;
const BYTE_LIMIT = 500 * 1024;

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) console.log(`[PASS] ${name}`);
  else {
    failures += 1;
    console.log(`[FAIL] ${name}${detail ? ' — ' + detail : ''}`);
  }
};
const info = (msg) => console.log(`       ${msg}`);

const itemsOf = (envelope) => envelope?.result?.value?.items ?? envelope?.items ?? null;

// ---------------------------------------------------------------------------
// 基线（离线快照：settings-lag/session_list.json）
// ---------------------------------------------------------------------------
let baseline = null;
try {
  const raw = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const items = itemsOf(raw);
  if (Array.isArray(items)) {
    baseline = {
      path: BASELINE_PATH,
      count: items.length,
      bytes: Buffer.byteLength(JSON.stringify(items), 'utf8'),
      topIds: new Set(items.filter((r) => r.origin !== 'subagent').map((r) => r.sessionId)),
      topNewestAt: Math.max(...items.filter((r) => r.origin !== 'subagent').map((r) => r.updatedAt ?? 0)),
      subCount: items.filter((r) => r.origin === 'subagent').length,
    };
  }
} catch (err) {
  console.log(`[WARN] 基线快照不可用（${BASELINE_PATH}）：${err.message}`);
}

// ---------------------------------------------------------------------------
// 单发只读请求
// ---------------------------------------------------------------------------
const url = `${URL_BASE.replace(/\/$/, '')}/api/session.list`;
const body = JSON.stringify({
  type: 'client-request',
  rpcId: randomUUID(),
  method: 'session.list',
  payload: {},
});

const FROM_FILE = argOf('--from-file', process.env.B1_FROM_FILE ?? '');
let text;
if (FROM_FILE) {
  // 离线复核模式：对已捕获的响应重放断言（不发任何 HTTP，便于反复验证探针本身）
  text = readFileSync(FROM_FILE, 'utf8');
  console.log(`离线复核：${FROM_FILE}（0 次 HTTP）  响应 ${Buffer.byteLength(text, 'utf8')} B`);
} else {
  console.log(`POST ${url}（1 次，只读）`);
  const started = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
  } catch (err) {
    console.log(`[FAIL] 请求失败：${err.message}`);
    process.exit(2);
  }
  text = await res.text();
  const elapsed = Date.now() - started;
  console.log(`HTTP ${res.status}  ${elapsed} ms  原始响应 ${Buffer.byteLength(text, 'utf8')} B`);
  if (!res.ok) {
    console.log(`[FAIL] 非 2xx：${text.slice(0, 300)}`);
    process.exit(2);
  }
}

let envelope;
try {
  envelope = JSON.parse(text);
} catch (err) {
  console.log(`[FAIL] 响应不是 JSON：${err.message}`);
  process.exit(2);
}
if (envelope?.result?.ok === false) {
  console.log(`[FAIL] 业务错误：${JSON.stringify(envelope.result.error ?? envelope.result).slice(0, 300)}`);
  process.exit(2);
}
const items = itemsOf(envelope);
if (!Array.isArray(items)) {
  console.log(`[FAIL] 响应里没有 items：${Object.keys(envelope ?? {}).join(',')}`);
  process.exit(2);
}

if (OUT_PATH) {
  writeFileSync(OUT_PATH, JSON.stringify(envelope));
  info(`响应已落盘：${OUT_PATH}`);
}

// ---------------------------------------------------------------------------
// 指标
// ---------------------------------------------------------------------------
const rowBytes = Buffer.byteLength(JSON.stringify(items), 'utf8');
const envelopeBytes = Buffer.byteLength(text, 'utf8');
const top = items.filter((r) => r.origin !== 'subagent');
const subs = items.filter((r) => r.origin === 'subagent');
const topIds = new Set(top.map((r) => r.sessionId));

console.log('');
console.log(`条目：${items.length}（顶层 ${top.length} / subagent ${subs.length}）`);
console.log(`字节：items ${rowBytes} B / 信封 ${envelopeBytes} B`);

// ---- A1 / A2 ----
check(
  `A1 条目数 ≤ 顶层+${MAX_SUBAGENTS}（当前阈值 ${ITEM_LIMIT(top.length)}；审计快照值为 284）`,
  items.length <= ITEM_LIMIT(top.length),
  `实得 ${items.length}`
);
check('A2 字节 ≤ 500 KB', envelopeBytes <= BYTE_LIMIT, `实得 ${envelopeBytes} B`);
if (baseline) {
  console.log('');
  console.log(`基线：${baseline.count} 条 / ${baseline.bytes} B → 现在 ${items.length} 条 / ${rowBytes} B`);
  info(`条目 −${(100 * (1 - items.length / baseline.count)).toFixed(1)}%，字节 −${(100 * (1 - rowBytes / baseline.bytes)).toFixed(1)}%`);
}

// ---- A3 顶层会话「一条不少」，且不得凭空多出陌生会话 ----
// 判据拆两层（基线是几分钟前的快照，期间新建会话属正常增量）：
//   ① 硬断言：基线里的顶层 ID **一个都不能缺**（过滤绝不能打到顶层会话）；
//   ② 硬断言：多出的 ID 中，其 updatedAt 必须晚于基线里最新顶层行的 updatedAt
//      （即「确实是快照之后新建的」）；否则视为异常多出。
if (baseline) {
  const missing = [...baseline.topIds].filter((id) => !topIds.has(id));
  const extra = [...topIds].filter((id) => !baseline.topIds.has(id));
  check(
    `A3a 顶层会话一条不少（基线 ${baseline.topIds.size} 条）`,
    missing.length === 0,
    `缺 ${missing.length}${missing.length ? '：' + missing.slice(0, 3).join(',') : ''}`
  );
  if (extra.length === 0) {
    check('A3b 顶层会话 ID 集合完全相等', true);
  } else {
    const baselineNewest = baseline.topNewestAt ?? 0;
    const rowsById = new Map(top.map((r) => [r.sessionId, r]));
    const suspicious = extra.filter((id) => (rowsById.get(id)?.updatedAt ?? 0) <= baselineNewest);
    check(
      `A3b 多出的 ${extra.length} 条顶层会话均为快照之后新建（updatedAt > ${baselineNewest}）`,
      suspicious.length === 0,
      `可疑 ${suspicious.length}${suspicious.length ? '：' + suspicious.slice(0, 3).join(',') : ''}`
    );
    info(`多出：${extra.slice(0, 5).join(', ')}${extra.length > 5 ? ` …(+${extra.length - 5})` : ''}`);
  }
} else {
  console.log('[WARN] 无基线快照，跳过 A3（可用 --baseline <真实 payload 路径>）');
}

// ---- A6 聚合字段 ----
const topWithField = top.filter((r) => typeof r.runningSubagentCount === 'number');
check('A6 顶层行全部带 runningSubagentCount（number）', top.length > 0 && topWithField.length === top.length,
  `${topWithField.length}/${top.length}`);
const sumRunning = top.reduce((acc, r) => acc + (typeof r.runningSubagentCount === 'number' ? r.runningSubagentCount : 0), 0);
info(`顶层 runningSubagentCount 之和 = ${sumRunning}（>0 表示状态点有数据）`);
if (topWithField.length === top.length && sumRunning === 0) {
  info('注意：全为 0 不一定是故障——当前可能确实没有 running 子代理。');
}

// ---- A7 subagent 行数 + 是否为最新批次 ----
check(`A7 subagent 行 ≤ ${MAX_SUBAGENTS}`, subs.length <= MAX_SUBAGENTS, `实得 ${subs.length}`);
if (baseline && subs.length > 0 && baseline.subCount > subs.length) {
  const sorted = [...subs].sort((a, b) => b.updatedAt - a.updatedAt);
  const oldest = sorted[sorted.length - 1].updatedAt;
  const newest = sorted[0].updatedAt;
  info(`保留的 subagent updatedAt 区间：[${newest}, ${oldest}]（应为最新的 ${subs.length} 条）`);
}

// ---- 行字段形状（回归对照：9 字段 + 新字段） ----
const fields = new Set();
for (const r of items) for (const k of Object.keys(r)) fields.add(k);
console.log('');
console.log(`行字段并集：${[...fields].sort().join(', ')}`);

console.log('');
console.log(failures === 0 ? '===== 探针全部 PASS =====' : `===== 探针 ${failures} 项 FAIL =====`);
process.exit(failures === 0 ? 0 : 1);
