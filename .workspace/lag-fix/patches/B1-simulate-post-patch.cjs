'use strict';
/**
 * B1-simulate-post-patch.cjs — 生成「打补丁后」的模拟响应，供探针做端到端离线复核。
 *
 * 用途：沙箱内无法重启宿主，因此无法对**真实**打补丁后的服务发请求。
 * 本脚本把「真实 payload（打补丁前的响应）」喂给**与补丁注入代码逐字对应的**过滤 + 聚合逻辑，
 * 产出与宿主应返回的信封同形状的 JSON；再用 probes/session-list-shape.mjs --from-file 复核断言。
 * 这样验证的是「补丁逻辑 + 探针断言」两件事，**不能替代**真实重启后的验收。
 *
 * 运行：node patches/B1-simulate-post-patch.cjs [输入 payload] [输出路径]
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.dirname(__dirname);
const inPath = process.argv[2] ?? path.resolve(ROOT, 'evidence/probe-pre-patch.json');
const outPath = process.argv[3] ?? path.resolve(ROOT, 'evidence/probe-simulated-post-patch.json');

const SUBAGENT_LIST_MAX = 200;
const raw = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const items = raw?.result?.value?.items;
if (!Array.isArray(items)) throw new Error(`${inPath} 里没有 result.value.items`);

// --- (a) 内存分支：顶层全发 + subagent 最近 N 条（与注入代码同逻辑） ---
const attachedSessions = items;
const attachedSubagents = attachedSessions.filter((s) => s.origin === 'subagent');
attachedSubagents.sort((a, b) => b.updatedAt - a.updatedAt);
const keep = new Set();
for (const s of attachedSessions) if (s.origin !== 'subagent') keep.add(s.sessionId);
for (const s of attachedSubagents.slice(0, SUBAGENT_LIST_MAX)) keep.add(s.sessionId);
const cold = []; // 本模拟只覆盖内存分支（真实冷分支同源分流，见 audit 报告）
let retained = attachedSessions.filter((s) => keep.has(s.sessionId));

// --- (b) 排序收口 ---
retained.sort((a, b) => b.updatedAt - a.updatedAt);
const subagentItems = retained.filter((r) => r.origin === 'subagent');
const overflow = subagentItems.slice(SUBAGENT_LIST_MAX);
retained = overflow.length === 0 ? retained : retained.filter((r) => !overflow.some((d) => d.sessionId === r.sessionId));

// --- (c) 聚合字段（与注入的 annotateRunningSubagentCounts 同逻辑） ---
const rows = retained.map((r) => ({ ...r }));
const runningIds = new Set(
  items.filter((r) => r.origin === 'subagent' && r.running === true).map((r) => r.sessionId)
);
{
  const childrenOf = new Map();
  for (const item of rows) {
    const parentId = item.parentSessionId;
    if (parentId === undefined) continue;
    const bucket = childrenOf.get(parentId);
    if (bucket === undefined) childrenOf.set(parentId, [item.sessionId]);
    else bucket.push(item.sessionId);
  }
  const liveStatus = new Map();
  for (const item of rows) liveStatus.set(item.sessionId, runningIds.has(item.sessionId));
  // 真实实现在 ctx.sessions.list() 的 live agent 表上取 running；这里用 payload 的 running 列近似
  for (const item of rows) {
    if (item.origin === 'subagent') continue;
    let count = 0;
    const seen = new Set([item.sessionId]);
    const queue = [item.sessionId];
    while (queue.length > 0) {
      const next = childrenOf.get(queue.shift());
      if (next === undefined) continue;
      for (const childId of next) {
        if (seen.has(childId)) continue;
        seen.add(childId);
        if (liveStatus.get(childId) === true) count += 1;
        queue.push(childId);
      }
    }
    item.runningSubagentCount = count;
  }
}

const envelope = {
  ...raw,
  result: { ...raw.result, value: { ...raw.result.value, items: rows } },
};
fs.writeFileSync(outPath, JSON.stringify(envelope));
const bytes = Buffer.byteLength(JSON.stringify(envelope), 'utf8');
console.log(`模拟后：${rows.length} 条（顶层 ${rows.filter((r) => r.origin !== 'subagent').length} / subagent ${rows.filter((r) => r.origin === 'subagent').length}）/ ${bytes} B`);
console.log(`写出：${outPath}`);
if (cold.length !== 0) console.log('note: cold 分支未参与模拟');
