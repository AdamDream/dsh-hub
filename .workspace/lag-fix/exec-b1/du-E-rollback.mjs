#!/usr/bin/env node
'use strict';
/**
 * exec-b1/du-E-rollback.mjs —— **DU-B1-E：pre-image 与回滚固化的机器可读清单 + 断言器**（只读）。
 *
 * 契约：审计 §5.1/§5.2 + `DECISIONS.md` 决策 6。
 *
 * ## 本脚本要钉死的一件事
 *
 *   **唯一权威 pre-image** = `.workspace/lag-fix/backup/B1/server/20260920-154039/lib/`
 *     · `index.js`          `142aac84e462173aeb6acc3e36d97b5c6aae2a31a087b91f99cffeff48378374`
 *     · `types/api-proxy.js` `7f56fb805fe4d8afbdbd9dee0c3e641acaf2d9c9831de0b7ea018e92b9343036`
 *
 *   ⚠️ **`backup/B1/server/b1fix-20260920-183319/index.buggy.js`（`f568f8a9…`）不是 pre-image** ——
 *      它是「**已打 B1 但 `ctx` 缺参**」的**中间故障态**（就是 2026-09-20 HTTP 500 的那一版）。
 *      用 `index.buggy.js` 回滚 = 把宿主回滚到**已知会 500 的状态**。回滚脚本必须只认前者。
 *
 * 因此本脚本：
 *   1. 断言三个候选文件的 sha 各自等于**记录值**（不是「互相不等」这种弱判据）；
 *   2. 断言 pre-image **不含任何补丁标记**、**不含** `runningSubagentCount`（= 真正 B1 之前）；
 *   3. 断言 `index.buggy.js` **含** `annotateRunningSubagentCounts` 且**不含** `ctx` 形参
 *      （= 独立证实它是「B1 已打、ctx 缺参」的中间态，而非 pre-image）；
 *   4. 断言 pre-image 与现行部署的差异**恰好 4 个 hunk 且全部属 B1**（回滚纯度）；
 *   5. 产出机器可读清单 `results/pre-image-manifest.json`（供回滚脚本/验收脚本消费）。
 *
 * 用法：node du-E-rollback.mjs [--report FILE.json]
 * 退出码：0 = 全部断言通过 / 2 = 有失败（**此时不得执行任何回滚**）
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const optOf = (n, d) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
const REPORT = optOf('--report', join(HERE, 'results', 'du-E-rollback.json'));
const MANIFEST = optOf('--manifest', join(HERE, 'results', 'pre-image-manifest.json'));

const HOME = process.env.HOME ?? '/home/CNS2026495165';
const DSH = join(HOME, '.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib');
const PRE_DIR = join(HERE, '..', 'backup', 'B1', 'server', '20260920-154039', 'lib');
const BUGGY_DIR = join(HERE, '..', 'backup', 'B1', 'server', 'b1fix-20260920-183319');

const PIN = {
  pre: {
    'index.js': '142aac84e462173aeb6acc3e36d97b5c6aae2a31a087b91f99cffeff48378374',
    'types/api-proxy.js': '7f56fb805fe4d8afbdbd9dee0c3e641acaf2d9c9831de0b7ea018e92b9343036',
  },
  deployed: {
    'index.js': '1b9915f505996912c6f49b12b0c3f4a8261a74f26422f68f5d22cab2bc078a62',
    'types/api-proxy.js': 'f5c34a439043b9d5771286a76c8b16210951c25d7d5873b168bcc947720eac0d',
  },
  target: {
    'index.js': '96ad39b7c37e1e0ab7ef07d991ee86f103c649b0ff595317ca32b6990a2c3310',
    'types/api-proxy.js': 'f4752c39623f863f9e5c9e455d1226d933bc1950e7b8c12b92cce87658165734',
  },
  buggy: { 'index.buggy.js': 'f568f8a9e67ef123b8f08e659a435bbdff09dfc895e12a9729426c6b30051434' },
};

const report = { at: new Date().toISOString(), preImageDir: PRE_DIR, checks: [], outcome: 'PENDING' };
let bad = 0;
const check = (name, ok, detail = '') => {
  report.checks.push({ name, ok: Boolean(ok), detail: String(detail) });
  if (!ok) bad += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const info = (m) => console.log(`      ${m}`);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const count = (t, lit) => { let n = 0; for (let i = t.indexOf(lit); i !== -1; i = t.indexOf(lit, i + lit.length)) n += 1; return n; };

// ---------------------------------------------------------------------------
// 1) pre-image pin
// ---------------------------------------------------------------------------
console.log('=== 1) pre-image（唯一权威回滚点）pin ===');
const preText = {};
for (const rel of Object.keys(PIN.pre)) {
  const p = join(PRE_DIR, rel);
  if (!existsSync(p)) { check(`pre-image 存在 [${rel}]`, false, p); continue; }
  const text = readFileSync(p, 'utf8');
  preText[rel] = text;
  const h = sha(Buffer.from(text, 'utf8'));
  check(`pre-image ${rel} sha256 == 记录值`, h === PIN.pre[rel], `${h.slice(0, 16)}… · ${Buffer.byteLength(text)} B · ${p}`);
}
// 「是 pre-image」的**内容**判据（不只看 sha）
{
  const t = preText['index.js'] ?? '';
  const markers = ['dsh-lag-fix', 'dsh-perf-fix', 'dsh-usage', 'P2 v1'];
  const found = markers.filter((m) => t.includes(m));
  check('pre-image 不含任何补丁标记（⇒ 全整文件还原 = 纯 B1 回滚，不连带 C1/runtime/usage）', found.length === 0,
    `命中标记=${JSON.stringify(found)}`);
  check('pre-image 不含 runningSubagentCount（= B1 之前的真实状态）', count(t, 'runningSubagentCount') === 0,
    `出现 ${count(t, 'runningSubagentCount')} 次`);
  check('pre-image 不含 SUBAGENT_LIST_MAX（= B1 之前的真实状态）', count(t, 'SUBAGENT_LIST_MAX') === 0,
    `出现 ${count(t, 'SUBAGENT_LIST_MAX')} 次`);
}

// ---------------------------------------------------------------------------
// 2) 负向钉死：buggy 不是 pre-image
// ---------------------------------------------------------------------------
console.log('\n=== 2) 负向：`index.buggy.js` **不是** pre-image（中间故障态） ===');
{
  const p = join(BUGGY_DIR, 'index.buggy.js');
  const text = readFileSync(p, 'utf8');
  const h = sha(Buffer.from(text, 'utf8'));
  check('index.buggy.js sha256 == 记录值（f568f8a9…）', h === PIN.buggy['index.buggy.js'], `${h.slice(0, 16)}…`);
  check('index.buggy.js sha **不等于** pre-image 的 sha（两者不可互换）', h !== PIN.pre['index.js'], 'f568f8a9… ≠ 142aac84…');
  check('index.buggy.js sha **不等于**现行部署的 sha', h !== PIN.deployed['index.js'], 'f568f8a9… ≠ 1b9915f5…');
  // 独立证实它是「B1 已打但 ctx 缺参」
  const hasAgg = text.includes('function annotateRunningSubagentCounts(');
  const missingCtx = text.includes('function annotateRunningSubagentCounts(items)');
  const hasField = count(text, 'runningSubagentCount') > 0;
  check('index.buggy.js 含聚合函数且**签名缺 ctx 形参**（⇒ 确为「B1 已打、ctx 缺参」的中间故障态，非 pre-image）',
    hasAgg && missingCtx && hasField,
    `含聚合函数=${hasAgg} 签名缺 ctx 形参=${missingCtx} 含 runningSubagentCount=${hasField}`);
  check('对照：pre-image **没有**聚合函数（⇒ 二者不可互换，方向唯一）',
    !(preText['index.js'] ?? '').includes('function annotateRunningSubagentCounts('), 'pre-image 无聚合函数');
  // 回滚误用 buggy 的后果（可判定陈述）
  report.buggyMisuseConsequence =
    '若误用 index.buggy.js 回滚：宿主回到「聚合函数引用 ctx 但签名未声明 ctx」的状态 ⇒ 重启后 '
    + 'POST /api/session.list 抛 ReferenceError: ctx is not defined ⇒ HTTP 500 ⇒ GUI 会话列表全空白（2026-09-20 事故原状）。';
}

// ---------------------------------------------------------------------------
// 3) pre-image → deployed 差异纯度（恰好 4 hunk，全部属 B1）
// ---------------------------------------------------------------------------
console.log('\n=== 3) pre-image → 现行部署的差异纯度 ===');
{
  const diffOf = (a, b) => {
    try { return execFileSync('diff', ['-u', a, b], { encoding: 'utf8' }); }
    catch (e) { return String(e.stdout ?? ''); }   // diff 有差异时 exit 1
  };
  for (const rel of Object.keys(PIN.pre)) {
    const d = diffOf(join(PRE_DIR, rel), join(DSH, rel));
    const hunks = (d.match(/^@@/gm) ?? []).length;
    const added = d.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
    const removed = d.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
    check(`[${rel}] pre-image → deployed 恰好 4 个 hunk（既有基线）`, hunks === 4, `${hunks} 个 hunk；+${added.length}/-${removed.length} 行`);
    // 「新增行全部属 B1」的**可判定**做法：新增行里的标识符/标记必须**全部出现过**在 v1 规格
    // （`spec/B1-transform.v1.cjs`）源码中 —— 即它们都是 B1 自己写进产品的符号。
    // （用正则逐行猜「与 B1 相关」会大量漏判：生成块里大部分是普通 JS 语法行。）
    const specSrc = readFileSync(join(HERE, 'spec', 'B1-transform.v1.cjs'), 'utf8');
    const ids = new Set();
    for (const l of added) for (const m of l.matchAll(/[A-Za-z_$][\w$]*/g)) ids.add(m[0]);
    const notInSpec = [...ids].filter((id) => !specSrc.includes(id)).sort();
    check(`[${rel}] 新增行里的标识符**全部出自 B1 规格**（⇒ 差异 100% 由 B1 引入，回滚不连带其它批次）`,
      notInSpec.length === 0, `新增行标识符 ${ids.size} 个；不在 v1 规格中的 ${notInSpec.length} 个${notInSpec.length ? ': ' + notInSpec.slice(0, 8).join(', ') : ''}`);
    report[`diff_${rel}`] = { hunks, added: added.length, removed: removed.length, identifiersInAdded: ids.size, notInSpec };
  }
}

// ---------------------------------------------------------------------------
// 4) 机器可读清单（供回滚/验收脚本消费）
// ---------------------------------------------------------------------------
const manifest = {
  at: new Date().toISOString(),
  b1Batch: 'B1-fix2 (DU-B1-A..E)',
  authoritativeRollbackPoint: {
    dir: PRE_DIR,
    note: '唯一权威 pre-image；整文件还原即精确回滚 B1（不连带 C1/runtime/usage）',
    files: Object.fromEntries(Object.entries(PIN.pre).map(([rel, h]) => [rel, { sha256: h, path: join(PRE_DIR, rel) }])),
  },
  deployedBeforePatch: Object.fromEntries(Object.entries(PIN.deployed).map(([rel, h]) => [rel, { sha256: h, path: join(DSH, rel) }])),
  expectedAfterPatch: Object.fromEntries(Object.entries(PIN.target).map(([rel, h]) => [rel, { sha256: h }])),
  notAPreImage: {
    file: join(BUGGY_DIR, 'index.buggy.js'),
    sha256: PIN.buggy['index.buggy.js'],
    why: '这是「B1 已打但 ctx 形参缺失」的中间故障态（2026-09-20 事故原状），不是 pre-image；回滚脚本必须只认 authoritativeRollbackPoint。',
    consequence: report.buggyMisuseConsequence,
  },
  rollbackCommand: [
    'set -euo pipefail',
    `L="${DSH}"`,
    `B="${PRE_DIR}"`,
    'STAMP="$(date +%Y%m%d-%H%M%S)"',
    '# 0) 先给"当前态"留命副本（回滚本身也可再回滚）',
    'cp -p "$L/index.js"           "$L/index.js.keep-$STAMP"',
    'cp -p "$L/types/api-proxy.js" "$L/types/api-proxy.js.keep-$STAMP"',
    '# 1) 只还原 B1 这两个文件（-p 保留权限与 LF）',
    'cp -p "$B/index.js"           "$L/index.js"',
    'cp -p "$B/types/api-proxy.js" "$L/types/api-proxy.js"',
    '# 2) 断言回滚到位',
    `test "$(sha256sum "$L/index.js" | cut -d" " -f1)" = "${PIN.pre['index.js']}"`,
    `test "$(sha256sum "$L/types/api-proxy.js" | cut -d" " -f1)" = "${PIN.pre['types/api-proxy.js']}"`,
    'test "$(grep -c \'dsh-lag-fix\' "$L/index.js" || true)" = "0"',
    'test "$(grep -c \'runningSubagentCount\' "$L/index.js" || true)" = "0"',
    '# 3) 重启宿主（服务器侧改动双向都需要重启；不重启则回滚不生效）',
  ],
  semanticConsequenceOfRollback:
    'session.list 回到未过滤全量（约 2361 行 / ~3.9 MB）⇒ 列表卡顿回归；runningSubagentCount 消失 ⇒ '
    + '客户端自动落 byId 兜底（client.js:171/286 的 typeof === "number" 三元），状态点仍可用但受 byId 截断影响（B② 缺陷回归）。',
};
mkdirSync(dirname(MANIFEST), { recursive: true });
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
check('机器可读清单已落盘（含权威回滚点 + 非-pre-image 警告 + 回滚命令 + 语义后果）', existsSync(MANIFEST), MANIFEST);

report.failures = bad;
report.outcome = bad === 0 ? 'PASS' : 'FAIL';
mkdirSync(dirname(REPORT), { recursive: true });
writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`\n[verdict] ${report.outcome}  失败 ${bad} 项 / 共 ${report.checks.length} 项  → ${REPORT}`);
process.exit(bad === 0 ? 0 : 2);
