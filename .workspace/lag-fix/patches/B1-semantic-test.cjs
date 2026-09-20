'use strict';
/**
 * B1-semantic-test.cjs — 单元 B1 的语义自测（不依赖 live 宿主）。单元独占命名（B1- 前缀）。
 *
 * 目的：在沙箱内证明「过滤 + 聚合」这两段注入代码在**真实数据**上行为正确：
 *   1) 过滤：用真实 payload `session_list.json` 的 2,361 条行做输入，
 *      断言最终保留「全部顶层行 + 最近 200 条 subagent」且顶层一条不丢；
 *   2) 聚合：在两个独立作用域里分别求 `annotateRunningSubagentCounts` 与
 *      客户端等价的 `indexSubagentDescendants`，逐 id 比对 running 计数相等；
 *   3) N=0 边界：只保留顶层；N=∞ 边界：一条不丢。
 *
 * 运行：node patches/B1-semantic-test.cjs          （在 .workspace/lag-fix 下）
 * 退出码 0 = 全部通过。
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HERE = __dirname;
const ROOT = path.dirname(HERE);
const PAYLOAD = process.env.B1_PAYLOAD ?? path.resolve(ROOT, '../settings-lag/session_list.json');

let failures = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`[PASS] ${name}`);
  else {
    failures += 1;
    console.log(`[FAIL] ${name}${detail ? ' — ' + detail : ''}`);
  }
}

// ---------------------------------------------------------------------------
// 真实 payload
// ---------------------------------------------------------------------------
const raw = JSON.parse(fs.readFileSync(PAYLOAD, 'utf8'));
const items = raw.items ?? raw.result?.value?.items ?? raw.result?.items ?? raw.value?.items;
if (!Array.isArray(items)) throw new Error(`无法从 ${PAYLOAD} 取到 items`);
const topLevel = items.filter((r) => r.origin !== 'subagent');
const subagents = items.filter((r) => r.origin === 'subagent');
console.log(`payload: ${items.length} 行（顶层 ${topLevel.length} / subagent ${subagents.length}）`);

// ---------------------------------------------------------------------------
// 1) 过滤逻辑（与打补丁后注入的三段逻辑逐字对应）
// ---------------------------------------------------------------------------
const SUBAGENT_LIST_MAX = 200;

function filterRetained(rows, max) {
  // (a) 内存分支
  const attachedSessions = rows;
  const attachedSubagents = attachedSessions.filter((s) => s.origin === 'subagent');
  attachedSubagents.sort((a, b) => b.updatedAt - a.updatedAt);
  const keep = new Set();
  for (const s of attachedSessions) if (s.origin !== 'subagent') keep.add(s.sessionId);
  for (const s of attachedSubagents.slice(0, max)) keep.add(s.sessionId);
  const kept = attachedSessions.filter((s) => keep.has(s.sessionId));
  // (b) 排序收口（真实代码里是无条件执行的）
  kept.sort((a, b) => b.updatedAt - a.updatedAt);
  const subagentItems = kept.filter((r) => r.origin === 'subagent');
  const overflow = subagentItems.slice(max);
  return overflow.length === 0 ? kept : kept.filter((r) => !overflow.some((d) => d.sessionId === r.sessionId));
}

const retained = filterRetained(items.map((r) => ({ ...r })), SUBAGENT_LIST_MAX);
const retainedTop = retained.filter((r) => r.origin !== 'subagent');
const retainedSub = retained.filter((r) => r.origin === 'subagent');

const topIdsIn = new Set(topLevel.map((r) => r.sessionId));
const topIdsOut = new Set(retainedTop.map((r) => r.sessionId));
const missing = [...topIdsIn].filter((id) => !topIdsOut.has(id));
const extra = [...topIdsOut].filter((id) => !topIdsIn.has(id));

check(`N=200：顶层会话逐 ID 相等（${topIdsIn.size} 条）`, missing.length === 0 && extra.length === 0,
  `缺 ${missing.length} / 多 ${extra.length}${missing.length ? ' 例：' + missing.slice(0, 3).join(',') : ''}`);
check(`N=200：subagent 行数 ≤ ${SUBAGENT_LIST_MAX}`, retainedSub.length <= SUBAGENT_LIST_MAX, `实得 ${retainedSub.length}`);
check(`N=200：条目总数 ≤ 顶层+${SUBAGENT_LIST_MAX}`, retained.length <= topIdsIn.size + SUBAGENT_LIST_MAX,
  `实得 ${retained.length}`);

// 保留的 subagent 必须是「updatedAt 最新的 200 条」
const expectedSubIds = new Set([...subagents].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, SUBAGENT_LIST_MAX).map((r) => r.sessionId));
const wrongSub = retainedSub.filter((r) => !expectedSubIds.has(r.sessionId));
check('N=200：保留的 subagent 全为 updatedAt 最新的 200 条', wrongSub.length === 0, `越界 ${wrongSub.length}`);

// 字节估算（按 JSON 序列化）
const bytes = (rows) => Buffer.byteLength(JSON.stringify(rows), 'utf8');
console.log(`字节：全量 ${bytes(items)} → 保留 ${bytes(retained)}（−${(100 * (1 - bytes(retained) / bytes(items))).toFixed(1)}%）`);
check('N=200：字节 ≤ 500KB', bytes(retained) <= 500 * 1024, `实得 ${bytes(retained)}`);

// N=0 边界
const zero = filterRetained(items.map((r) => ({ ...r })), 0);
check('N=0：只剩顶层', zero.every((r) => r.origin !== 'subagent') && zero.filter((r) => r.origin !== 'subagent').length === topIdsIn.size,
  `实得 ${zero.length} 行`);
// N=∞ 边界（用 1e9 模拟）
const all = filterRetained(items.map((r) => ({ ...r })), 1e9);
check('N=∞：一条不丢', all.length === items.length, `${all.length} vs ${items.length}`);

// ---------------------------------------------------------------------------
// 2) 聚合函数（从「已打补丁的 index.js 副本」里抽出来，在两个独立作用域求值）
// ---------------------------------------------------------------------------
/**
 * 定位最新一次 dry-run 产出的已打补丁副本（tmp/B1/dryrun-&lt;stamp&gt;/b1-index.patched.js）。
 * 产物目录带时间戳（多档并行时避免同名互覆），故这里按 mtime 取最新，而不是写死单一路径。
 * 可用 B1_PATCHED / B1_UI_PATCHED / B1_RUNTIME_PATCHED 显式覆盖。
 */
function latestArtifact(name, envOverride) {
  if (envOverride) return envOverride;
  const base = path.resolve(ROOT, 'tmp/B1');
  if (!fs.existsSync(base)) return path.resolve(base, name);
  const found = fs.readdirSync(base)
    .filter((d) => d.startsWith('dryrun'))
    .map((d) => path.join(base, d, name))
    .filter((f) => fs.existsSync(f))
    .map((f) => ({ f, m: fs.statSync(f).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return found.length > 0 ? found[0].f : path.resolve(base, name);
}

const patchedCandidates = [latestArtifact('b1-index.patched.js', process.env.B1_PATCHED)].filter((p) => fs.existsSync(p));
if (patchedCandidates.length === 0) {
  check('聚合：找到已打补丁的副本（先跑 --dry-run 生成）', false, '未找到 tmp/B1/dryrun-*/b1-index.patched.js（先执行 --dry-run）');
} else {
  const src = fs.readFileSync(patchedCandidates[0], 'utf8');
  const fnStart = src.indexOf('function annotateRunningSubagentCounts(items) {');
  const fnSrc = src.slice(fnStart, src.indexOf('\n}', fnStart) + 2);
  check('聚合：从副本抽出 annotateRunningSubagentCounts', fnStart !== -1 && fnSrc.length > 100, `len=${fnSrc.length}`);

  // 真实运行中的 subagent 只有 4 条（报告实测）；用 payload 里 running===true 的行模拟 live agent 表
  const runningIds = new Set(subagents.filter((r) => r.running === true).map((r) => r.sessionId));
  console.log(`payload 中 running===true 的 subagent：${runningIds.size} 条`);

  // 构造「截断后的行 + live agent 表」环境，跑宿主聚合函数
  const rows = retained.map((r) => ({ ...r }));
  const hostSessions = rows.map((r) => ({ id: r.sessionId, header: { id: r.sessionId, origin: r.origin, parentSession: r.parentSessionId, cwd: r.cwd } }));
  const hostCtx = {
    sessions: { list: () => hostSessions },
    agents: { get: (id) => (runningIds.has(id) ? { status: 'running' } : undefined) },
  };
  const makeFn = new Function('ctx', `${fnSrc}; return annotateRunningSubagentCounts;`);
  const annotate = makeFn(hostCtx);
  const afterHost = annotate(rows);

  // 客户端等价实现（照抄 dsh-client-runtime/lib/client.js:10267 indexSubagentDescendants 的计数语义）
  const byId = {};
  for (const r of rows) byId[r.sessionId] = { id: r.sessionId, origin: r.origin, parentId: r.parentSessionId, running: r.running === true };
  const indexed = new Map();
  for (const descendant of Object.values(byId)) {
    if (descendant.origin !== 'subagent') continue;
    const seen = new Set();
    let current = descendant;
    while (current?.origin === 'subagent' && current.parentId !== undefined && !seen.has(current.id)) {
      seen.add(current.id);
      const agg = indexed.get(current.parentId);
      if (agg === undefined) indexed.set(current.parentId, { count: 1, runningCount: descendant.running ? 1 : 0 });
      else {
        agg.count += 1;
        if (descendant.running) agg.runningCount += 1;
      }
      current = byId[current.parentId];
    }
  }

  // 逐顶层会话比对
  const mismatches = [];
  let nonZero = 0;
  for (const row of afterHost) {
    if (row.origin === 'subagent') continue;
    const host = row.runningSubagentCount;
    const client = indexed.get(row.sessionId)?.runningCount ?? 0;
    if (host !== client) mismatches.push(`${row.sessionId}: host=${host} client=${client}`);
    if (host > 0) nonZero += 1;
  }
  check('聚合：每个顶层行都写入了 runningSubagentCount（number）', afterHost.filter((r) => r.origin !== 'subagent').every((r) => typeof r.runningSubagentCount === 'number'));
  check('聚合：计数与客户端 indexSubagentDescendants 逐 id 相等', mismatches.length === 0, mismatches.slice(0, 3).join(' | '));
  console.log(`聚合：${nonZero} 个顶层会话的 runningSubagentCount > 0（payload 快照下）`);

  // A4 前置条件：所有 running 的 subagent 行都必须落在「最近 200 条」窗口内，
  // 否则过滤会把这个正在跑的进程挡在血缘图之外 → 状态点丢失。
  const runningRows = subagents.filter((r) => r.running === true);
  const outsideWindow = runningRows.filter((r) => !retainedSub.some((k) => k.sessionId === r.sessionId));
  check(`聚合：全部 ${runningRows.length} 条 running subagent 都在保留窗口内（状态点可达）`, outsideWindow.length === 0,
    `窗口外 ${outsideWindow.length}：${outsideWindow.slice(0, 3).map((r) => r.sessionId).join(',')}`);

  // 已知边界（如实记录，不在本单元范围内修）：聚合函数从**已下发行**重建父子图，
  // 因此 N=0（subagent 行全过滤）时子代计数会归零。这正是本单元选择 N=200 而非 0 的原因。
  const onlyTop = rows.filter((r) => r.origin !== 'subagent');
  const afterHostN0 = makeFn(hostCtx)(onlyTop.map((r) => ({ ...r })));
  const nonZeroN0 = afterHostN0.filter((r) => (r.runningSubagentCount ?? 0) > 0).length;
  check('边界记录：N=0 时聚合计数归零（已知限制；本单元取 N=200）', nonZeroN0 === 0 && nonZero >= 1,
    `N=0 得 ${nonZeroN0}，N=200 得 ${nonZero}`);
}

console.log(failures === 0 ? '\n===== 语义自测全部 PASS =====' : `\n===== 语义自测 ${failures} 项 FAIL =====`);
process.exit(failures === 0 ? 0 : 1);
