#!/usr/bin/env node
/**
 * apply-CC-cursor-fix.mjs — 把 CC 游标 off-by-one 修复最小同构地打到 **deployed** ingest-cc.js。
 *
 * 为什么不是 cp source：deployed 与 source 是独立拷贝（deployed 为功能超集），
 * 本项目铁律禁止整文件覆盖（2026-09-21 已真实踩到一次）。
 *
 * 修复两处（与 source 同契约）：
 *   F1 consumedBytes：文件以 `\n` 结尾时原文多算 1 字节 → last_offset 变 size+1。
 *   F2 遗留游标自愈：生产库已有 388 条 size+1 的行，不夹回就仍会跳一字节；
 *      夹回后还能把当时被跳过的记录重新读入。
 *
 * 用法：node apply-CC-cursor-fix.mjs [--apply]
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const DSH = process.env.HOME + '/.dsh/profiles/node_modules/@local/dsh-usage/lib';
const WORK = '/home/CNS2026495165/dsh/.workspace/lag-fix';
const MARK = 'dsh-perf-fix CC-cursor v1';
const apply = process.argv.includes('--apply');
const T = '[ \\t]+';

const target = path.join(DSH, 'ingest-cc.js');
const before = readFileSync(target, 'utf8');
if (before.includes(MARK)) {
  console.log(`[skip] ingest-cc.js 已含 ${MARK}`);
  process.exit(0);
}

const rules = [
  {
    name: 'F1 consumedBytes 不再多算 1 字节',
    find: new RegExp(
      `(${T})const consumedBytes = Buffer\\.byteLength\\(completeLines\\.join\\("\\\\n"\\) \\+ "\\\\n"\\);\\n`,
    ),
    replace: (m) =>
      `${m[1]}/* ${MARK}: 文件以换行结尾时，completeLines.join + 换行的写法会比 text\n` +
      `${m[1]}   多算 1 字节（join 已带回该换行）→ last_offset 写成 size+1 → 下一轮 subarray(size+1)\n` +
      `${m[1]}   跳过新内容首字节，追加批次第一条记录被静默丢弃。实测复现见\n` +
      `${m[1]}   .workspace/lag-fix/research-v2/cc-cursor/repro-cc-cursor.mjs */\n` +
      `${m[1]}const consumedBytes = endsWithNewline\n` +
      `${m[1]}\t? Buffer.byteLength(text)\n` +
      `${m[1]}\t: Buffer.byteLength(completeLines.join("\\n") + "\\n");\n`,
  },
  {
    name: 'F2 遗留 size+1 游标自愈',
    find: new RegExp(
      `(${T})offset = size >= Number\\(state\\.last_offset\\) \\? Number\\(state\\.last_offset\\) : 0;\\n`,
    ),
    replace: (m) =>
      `${m[1]}/* ${MARK}: 遗留游标（size+1）夹回 state.size —— 既不再跳字节，\n` +
      `${m[1]}   也让当时被跳过的记录在下一轮被重新读入（自愈）。 */\n` +
      `${m[1]}const cursor = Number(state.last_offset);\n` +
      `${m[1]}const legacyOverrun = Number(state.size) + 1 === cursor;\n` +
      `${m[1]}const usable = legacyOverrun ? Number(state.size) : cursor;\n` +
      `${m[1]}offset = size >= usable ? usable : 0;\n`,
  },
];

let text = before;
let failed = 0;
for (const rule of rules) {
  const hits = text.match(new RegExp(rule.find.source, 'g'));
  const count = hits ? hits.length : 0;
  if (count !== 1) {
    console.log(`[FAIL] ${rule.name}: 锚点命中 ${count} 次（要求 1 次）→ 拒绝写入`);
    failed += 1;
    continue;
  }
  text = text.replace(rule.find, (...args) => rule.replace(args));
  console.log(`[ok]   ${rule.name}`);
}
if (failed > 0) {
  console.log('\n锚点校验失败：未写入任何文件（fail-closed）。');
  process.exit(1);
}

const candidateDir = path.join(WORK, 'research-v2/cc-cursor/candidate');
mkdirSync(candidateDir, { recursive: true });
const candidate = path.join(candidateDir, 'ingest-cc.js');
writeFileSync(candidate, text);
try {
  execFileSync('node', ['--check', candidate], { stdio: 'pipe' });
  console.log(`[check] node --check OK（候选）`);
} catch (error) {
  console.log(`[check] node --check FAILED\n${String(error.stderr ?? error).slice(0, 600)}`);
  process.exit(2);
}
// 本次未引入新标识符（cursor/legacyOverrun/usable 都是本块内局部 const），仍做一次存在性自检。
for (const name of ['cursor', 'legacyOverrun', 'usable']) {
  if (!new RegExp(`(?:let|const|var)\\s+${name}\\b`).test(text)) {
    console.log(`[FAIL] 引入的 \`${name}\` 无声明 → 运行时会 ReferenceError`);
    process.exit(3);
  }
}
console.log('[verify] 局部标识符声明齐全 ✓');

if (!apply) {
  console.log('\n(dry-run：未写入 live 文件)');
  process.exit(0);
}
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
const backupDir = path.join(WORK, `backup/CC-cursor-${stamp}`);
mkdirSync(backupDir, { recursive: true });
copyFileSync(target, path.join(backupDir, 'pre-ingest-cc.js'));
writeFileSync(target, text);
try {
  execFileSync('node', ['--check', target], { stdio: 'pipe' });
  console.log(`[check] node --check OK（live）`);
} catch (error) {
  console.log(`[check] live node --check FAILED —— 已回滚\n${String(error.stderr ?? error).slice(0, 400)}`);
  copyFileSync(path.join(backupDir, 'pre-ingest-cc.js'), target);
  process.exit(4);
}
console.log(`[applied] ${target}\n[backup]  ${backupDir}/pre-ingest-cc.js`);
console.log('[next] 宿主半生效需重启；重启后再跑 cc-cursor 复现与真实规模观察。');
