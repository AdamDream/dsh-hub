#!/usr/bin/env node
/**
 * session-sentinel.mjs — 回归哨兵：session.list 的结构完整性（只读）。
 *
 * 检查项（对应 B1 事故的同类风险面：session.list 500 / 列表空白）：
 *  - ok 位与 HTTP 状态、字节数；
 *  - 条目数 / 顶层数（parentSessionId 为空）/ 子代理数；
 *  - runningSubagentCount 字段覆盖：有多少条目带该字段、类型是否 number、
 *    以及「顶层聚合 = 其子条目求和」是否自洽（覆盖而不只是存在）。
 */
import { writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3080';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/r4-live-verify/raw/session-list.json';
const N = Number(process.argv[process.argv.indexOf('--rounds') + 1] || 5);

const out = { at: new Date().toISOString(), rounds: [], analysis: {} };
const t0 = Date.now();
for (let i = 1; i <= N; i += 1) {
  const start = performance.now();
  const res = await fetch(`${BASE}/api/session.list`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `r4sent-${i}`, method: 'session.list', payload: {} }),
  });
  const text = await res.text();
  const wall = Number((performance.now() - start).toFixed(1));
  let json = null; try { json = JSON.parse(text); } catch { /* ignore */ }
  const value = json?.result?.value;
  const items = Array.isArray(value) ? value : value?.items;
  const rec = {
    round: i, wall, http: res.status, bytes: text.length, ok: json?.result?.ok ?? null,
    kind: Array.isArray(value) ? 'array' : value && typeof value === 'object' ? `object{${Object.keys(value).slice(0, 8).join(',')}}` : String(typeof value),
    entries: Array.isArray(items) ? items.length : null,
  };
  if (Array.isArray(items)) {
    const top = items.filter((e) => !e.parentSessionId && !e.parentId);
    const kids = items.filter((e) => e.parentSessionId || e.parentId);
    const withField = items.filter((e) => Object.prototype.hasOwnProperty.call(e, 'runningSubagentCount'));
    const numField = withField.filter((e) => typeof e.runningSubagentCount === 'number');
    rec.topLevel = top.length;
    rec.children = kids.length;
    rec.runningSubagentCountFieldPresent = withField.length;
    rec.runningSubagentCountNumeric = numField.length;
    rec.fieldCoverage = items.length ? `${withField.length}/${items.length}` : '0/0';
    // 自洽性：顶层条目的 runningSubagentCount 是否等于其直接子条目数
    const byParent = new Map();
    for (const k of kids) byParent.set(k.parentSessionId || k.parentId, (byParent.get(k.parentSessionId || k.parentId) || 0) + 1);
    const mismatches = top.filter((t) => Object.prototype.hasOwnProperty.call(t, 'runningSubagentCount') && t.runningSubagentCount !== (byParent.get(t.sessionId) || 0));
    rec.aggregateMismatches = mismatches.length;
    rec.mismatchSample = mismatches.slice(0, 3).map((m) => ({ sessionId: m.sessionId, runningSubagentCount: m.runningSubagentCount, directChildren: byParent.get(m.sessionId) || 0 }));
    rec.runningNow = items.filter((e) => e.running === true).length;
    rec.blank = items.filter((e) => e.blank === true).length;
    rec.origins = [...new Set(items.map((e) => e.origin).filter(Boolean))];
    if (i === 1) rec.keys = Object.keys(items[0] || {});
  }
  out.rounds.push(rec);
  await new Promise((r) => setTimeout(r, 700));
}
out.analysis = {
  probeMs: Date.now() - t0,
  okAll: out.rounds.every((r) => r.ok === true && r.http === 200),
  wallMin: Math.min(...out.rounds.map((r) => r.wall)),
  wallP50: [...out.rounds.map((r) => r.wall)].sort((a, b) => a - b)[Math.floor(N / 2)],
  wallMax: Math.max(...out.rounds.map((r) => r.wall)),
  entryCountsStable: new Set(out.rounds.map((r) => r.entries)).size,
  topLevelCounts: [...new Set(out.rounds.map((r) => r.topLevel))],
  entryCounts: out.rounds.map((r) => r.entries),
  fieldCoverageAll: out.rounds.every((r) => r.runningSubagentCountFieldPresent === r.entries),
  aggregateConsistent: out.rounds.every((r) => r.aggregateMismatches === 0),
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log('okAll=', out.analysis.okAll, ' entries=', JSON.stringify(out.analysis.entryCounts), ' topLevel=', JSON.stringify(out.analysis.topLevelCounts));
console.log('wall min/p50/max =', out.analysis.wallMin, out.analysis.wallP50, out.analysis.wallMax);
console.log('runningSubagentCount field coverage =', out.rounds[0].fieldCoverage, ' numeric =', out.rounds[0].runningSubagentCountNumeric, ' aggregateConsistent =', out.analysis.aggregateConsistent);
console.log('mismatchSample =', JSON.stringify(out.rounds[0].mismatchSample));
console.log('origins =', JSON.stringify(out.rounds[0].origins), ' runningNow =', out.rounds[0].runningNow);
