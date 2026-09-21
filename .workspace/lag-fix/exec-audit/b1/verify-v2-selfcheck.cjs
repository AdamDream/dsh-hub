#!/usr/bin/env node
'use strict';
/**
 * verify-v2-selfcheck.cjs — B1-fix2 回放规格新增断言的**反向对照自证**（只读）。
 *
 * 教训（2026-09-20）：`node --check` 只验语法，查不出 `ctx is not defined` 这类**未声明标识符**；
 * 而此前的语义测试又把 ctx 注入成包装函数形参，等于替被测代码补上缺失绑定 —— 缺陷在测试里不可能显形。
 * 因此本文件对每条新断言都构造一个**必须被拒绝的变异**；凡"变异也没报错"的断言一律判空转（self-proof failure）。
 *
 * 判据：
 *   正向：v2 规格重放产物 → verifyServerFilter 必须 0 失败；
 *   反向 M1..M5：每个变异必须**至少**触发一条失败，且指名道姓的失败信息要能命中；
 *   控制 W1：无关的中性编辑（加一行注释）不得新增失败（防误报）。
 */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const t = require('./B1-transform.v2-candidate.cjs');
const PRE = '/home/CNS2026495165/dsh/.workspace/lag-fix/backup/B1/server/20260920-154039/lib';

let bad = 0;
const check = (name, ok, detail = '') => {
  if (!ok) bad += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const clean = t.applyServerFilter(readFileSync(join(PRE, 'index.js'), 'utf8'));
const cleanMod = t.applyServerFilter(readFileSync(join(PRE, 'types/api-proxy.js'), 'utf8'));

check('正向：v2 重放产物（index.js）verifyServerFilter 零失败', t.verifyServerFilter(clean).length === 0, JSON.stringify(t.verifyServerFilter(clean)));
check('正向：v2 重放产物（types/api-proxy.js）verifyServerFilter 零失败', t.verifyServerFilter(cleanMod).length === 0, JSON.stringify(t.verifyServerFilter(cleanMod)));

/** 变异表：每个变异必须被拒绝，且失败信息需匹配 expect（正则）。 */
const MUTATIONS = [
  {
    id: 'M1',
    why: '去掉 ctx 形参（2026-09-20 生产事故原形；node --check 查不出）',
    apply: (s) => s.replace('function annotateRunningSubagentCounts(ctx, items) {', 'function annotateRunningSubagentCounts(items) {')
      .replace('return annotateRunningSubagentCounts(ctx, retained);', 'return annotateRunningSubagentCounts(retained);'),
    expect: /未声明|未接收 ctx|签名未声明/,
  },
  {
    id: 'M2',
    why: '只改函数体引用 ctx、签名保留（形参不匹配）',
    apply: (s) => s.replace('function annotateRunningSubagentCounts(ctx, items) {', 'function annotateRunningSubagentCounts(a, b) {'),
    expect: /首形参不是 ctx|未声明/,
  },
  {
    id: 'M3',
    why: '冷候选比较器退回裸 b.updatedAt - a.updatedAt（B① 缺陷原形）',
    apply: (s) => s.replace('.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt) || (a.id < b.id ? -1 : 1))', '.sort((a, b) => b.updatedAt - a.updatedAt)'),
    expect: /期望 1 实得 2|期望 1 实得 0/,
  },
  {
    id: 'M4',
    why: '血缘边退回由已截断行构建（B② 缺陷原形）',
    apply: (s) => s.replace('const parentId = session.header.parentSession;', 'const parentId = item.parentSessionId;'),
    expect: /期望 0 实得 1|期望 1 实得 0/,
  },
  {
    id: 'M5',
    why: '调用点只传一个实参（arity 不符）',
    apply: (s) => s.replace('return annotateRunningSubagentCounts(ctx, retained);', 'return annotateRunningSubagentCounts(retained);'),
    expect: /调用点|期望 1 实得 0/,
  },
];

for (const m of MUTATIONS) {
  const mutated = m.apply(clean);
  const changed = mutated !== clean;
  const failures = t.verifyServerFilter(mutated);
  const hit = failures.some((f) => m.expect.test(f));
  check(`${m.id} 反向对照被拒绝：${m.why}`, changed && failures.length > 0 && hit,
    `变异生效=${changed} 失败项=${failures.length} 命中预期=${hit} :: ${failures.slice(0, 2).join(' | ') || '（无失败 → 该断言空转！）'}`);
}

// 控制项：中性编辑不得引入误报
{
  const benign = clean.replace('\nfunction sessionListFields(', '\n/* benign audit note */\nfunction sessionListFields(');
  check('W1 控制：无关的中性注释编辑不得新增失败（防误报）',
    benign !== clean && t.verifyServerFilter(benign).length === 0,
    JSON.stringify(t.verifyServerFilter(benign)));
}

// 对照项：现行已部署状态（v1）必须被判失败 —— 证明 verifier 确实在检查本轮修订
{
  const live = readFileSync('/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js', 'utf8');
  const vLive = t.verifyServerFilter(live);
  check('C1 对照：现行已部署 v1 状态被判失败（verifier 对本轮修订确有区分力）', vLive.length > 0, `${vLive.length} 项：${vLive.slice(0, 3).join(' | ')}`);
}

console.log(`\n[self-check] ${bad === 0 ? 'PASS' : `FAIL（${bad} 项）`}`);
process.exit(bad === 0 ? 0 : 1);
