#!/usr/bin/env node
/**
 * apply-B1-perf-hotfix.mjs — 修 B1 引入的比较器 O(N log N × events) 缺陷。
 *
 * 【缺陷】`lib/index.js` 的 attached 分支比较器里直接调用 `sessionListMetadata(events)`：
 *   attachedSubagents.sort((a, b) =>
 *     sessionListUpdatedAt(b.header, sessionListMetadata(b.events)) -
 *     sessionListUpdatedAt(a.header, sessionListMetadata(a.events)));
 * 而 `sessionListMetadata(events)` 是 `for (const event of events) …` 的**整条事件流折叠且无 memo**。
 * ⇒ 每次排序要折 O(N log N) × 2 遍全事件流（attached 里含数万事件的会话）
 * ⇒ 实测 `POST /api/session.list` 单次 **0.31–2.52 s**（9950X、安静机、响应恒 499 KB / 299 items）
 * ⇒ 客户端点设置要等它，落地瞬间触发 38 次连发 commit × 每次重建 600 fiber。
 * 该比较器由 B1 补丁引入（pre-image 中 `sessionListMetadata` 出现 8 次但**不在比较器里**，部署件为 9 次）。
 *
 * 【修法】排序前**每会话只折一次**，排序退化为纯标量比较；**语义完全不变**（同一个 max(createdAt, lastPromptAt)，
 * 且并列顺序与原来一致——原比较器并列时同样保持插入序）。
 *
 * 用法：node apply-B1-perf-hotfix.mjs [--apply]
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const LIB = process.env.HOME + '/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib';
const WORK = '/home/CNS2026495165/dsh/.workspace/lag-fix';
const MARK = 'dsh-lag-fix B1-perf v1';
const apply = process.argv.includes('--apply');

// 锚点：两种排版（TAB / 4 空格）各一条；要求每文件恰好命中 1 次
const anchors = [
  {
    file: 'index.js',
    find: (i) =>
      `\tconst attachedSubagents = attachedSessions.filter((session) => session.header.origin === "subagent");\n` +
      `\tattachedSubagents.sort((a, b) => sessionListUpdatedAt(b.header, sessionListMetadata(b.events)) - sessionListUpdatedAt(a.header, sessionListMetadata(a.events)));\n`,
    replace: (i) =>
      `\tconst attachedSubagents = attachedSessions.filter((session) => session.header.origin === "subagent");\n` +
      `\t/* ${MARK}: 先算一次 recency 再排序。\n` +
      `\t   原写法在比较器里调 sessionListMetadata(events)（O(events) 全事件流折叠、无 memo），\n` +
      `\t   一次排序要折 O(N log N)×2 遍 ⇒ 实测 session.list 单次 0.3–2.5 s。\n` +
      `\t   预计算后每会话只折 1 遍，排序退化为纯标量比较；语义不变（同一 max(createdAt, lastPromptAt)）。 */\n` +
      `\tconst attachedRecency = new Map();\n` +
      `\tfor (const session of attachedSubagents) attachedRecency.set(session.id, sessionListUpdatedAt(session.header, sessionListMetadata(session.events)));\n` +
      `\tattachedSubagents.sort((a, b) => (attachedRecency.get(b.id) ?? 0) - (attachedRecency.get(a.id) ?? 0));\n`,
  },
  {
    file: 'types/api-proxy.js',
    find: () =>
      `  const attachedSubagents = attachedSessions.filter((session) => session.header.origin === 'subagent');\n` +
      `  attachedSubagents.sort((a, b) => sessionListUpdatedAt(b.header, sessionListMetadata(b.events)) - sessionListUpdatedAt(a.header, sessionListMetadata(a.events)));\n`,
    replace: () =>
      `  const attachedSubagents = attachedSessions.filter((session) => session.header.origin === 'subagent');\n` +
      `  /* ${MARK}: 先算一次 recency 再排序（理由同 lib/index.js）。 */\n` +
      `  const attachedRecency = new Map();\n` +
      `  for (const session of attachedSubagents) attachedRecency.set(session.id, sessionListUpdatedAt(session.header, sessionListMetadata(session.events)));\n` +
      `  attachedSubagents.sort((a, b) => (attachedRecency.get(b.id) ?? 0) - (attachedRecency.get(a.id) ?? 0));\n`,
  },
];

let failed = 0;
const outputs = [];
for (const a of anchors) {
  const target = path.join(LIB, a.file);
  const before = readFileSync(target, 'utf8');
  if (before.includes(MARK)) { console.log(`[skip] ${a.file} 已含标记`); continue; }
  // 兜底：先确认「旧的贵比较器」存在且唯一
  const hotRe = /attachedSubagents\.sort\(\(a, b\) => sessionListUpdatedAt\(b\.header, sessionListMetadata\(b\.events\)\)/g;
  const hits = (before.match(hotRe) || []).length;
  console.log(`[pre]  ${a.file}: 贵比较器命中 ${hits} 次（要求 1）`);
  if (hits !== 1) { failed++; continue; }
  const find = a.find();
  const idx = before.indexOf(find);
  const dup = before.indexOf(find, idx + find.length);
  if (idx === -1 || dup !== -1) { console.log(`[FAIL] ${a.file}: 锚点命中 ${idx === -1 ? 0 : 2} 次 → 拒绝写入`); failed++; continue; }
  const after = before.slice(0, idx) + a.replace() + before.slice(idx + find.length);
  outputs.push({ file: a.file, target, before, after });
}
if (failed) { console.log(`\n锚点校验失败 ${failed} 处：未写入任何文件。`); process.exit(1); }

const candDir = path.join(WORK, 'exec-b1/../hotfix-b1perf/candidate');
mkdirSync(candDir, { recursive: true });
for (const o of outputs) {
  const candPath = path.join(candDir, o.file);
  mkdirSync(path.dirname(candPath), { recursive: true });
  writeFileSync(candPath, o.after);
  try { execFileSync('node', ['--check', candPath], { stdio: 'pipe' }); console.log(`[check] node --check OK: ${o.file}`); }
  catch (e) { console.log(`[check] node --check FAILED: ${o.file}\n${String(e.stderr || e).slice(0, 400)}`); process.exit(2); }
  for (const id of ['attachedRecency']) {
    if (!new RegExp(`(?:const|let|var)\\s+${id}\\b`).test(o.after)) { console.log(`[FAIL] ${o.file}: 引入的 ${id} 无声明`); process.exit(3); }
  }
  // 反向断言：修完后不应再有「比较器内折叠」
  if (/attachedSubagents\.sort\(\(a, b\) => sessionListUpdatedAt\(b\.header, sessionListMetadata\(b\.events\)\)/.test(o.after)) {
    console.log(`[FAIL] ${o.file}: 贵比较器仍存在`); process.exit(3);
  }
}
console.log('[verify] 候选件语法 OK、引入标识符有声明、贵比较器已消除 ✓');

if (!apply) { console.log('\n(dry-run：未写入 live 文件)'); process.exit(0); }
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
const backupDir = path.join(WORK, `backup/B1perf-${stamp}`);
mkdirSync(backupDir, { recursive: true });
for (const o of outputs) {
  copyFileSync(o.target, path.join(backupDir, `pre-${o.file.replace('/', '_')}`));
  writeFileSync(o.target, o.after);
  try { execFileSync('node', ['--check', o.target], { stdio: 'pipe' }); }
  catch { console.log(`[check] live node --check FAILED: ${o.file} → 回滚`); copyFileSync(path.join(backupDir, `pre-${o.file.replace('/', '_')}`), o.target); process.exit(4); }
  console.log(`[applied] ${o.target}`);
}
console.log(`[backup]  ${backupDir}`);
console.log('[next] 冷面：需重启宿主后生效；重启后量 session.list 单次耗时（修复前实测 0.31–2.52 s）。');
