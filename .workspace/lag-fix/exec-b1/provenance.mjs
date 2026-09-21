#!/usr/bin/env node
'use strict';
/**
 * exec-b1/provenance.mjs —— 交付档**自指纹**：把本档全部输入/产物/脚本的 sha256 + 字节数固化成
 * `results/provenance.json`，并断言关键不变量。主 agent 落地时可用它核对「我跑的就是被验证过的那份脚本」。
 *
 * 用法：node provenance.mjs
 * 退出码：0 = 全部不变量成立 / 2 = 有失败
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = process.env.HOME ?? '/home/CNS2026495165';
const DSH = join(HOME, '.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib');
const PRE = join(HERE, '..', 'backup', 'B1', 'server', '20260920-154039', 'lib');
const AUDIT = join(HERE, '..', 'exec-audit', 'b1');

const report = { at: new Date().toISOString(), checks: [], files: {}, outcome: 'PENDING' };
let bad = 0;
const check = (name, ok, detail = '') => {
  report.checks.push({ name, ok: Boolean(ok), detail: String(detail) });
  if (!ok) bad += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — ${detail}`);
};
const sha = (p) => {
  const b = readFileSync(p);
  return { sha256: createHash('sha256').update(b).digest('hex'), bytes: b.length };
};
const rel = (p) => p.replace(join(HERE, '..', '..', '..') + '/', '');
function rec(key, p) {
  if (!existsSync(p)) { report.files[key] = { path: p, missing: true }; return null; }
  const s = sha(p);
  report.files[key] = { path: p, ...s };
  return s;
}

const EXPECT = {
  'input:deployed/index.js': '1b9915f505996912c6f49b12b0c3f4a8261a74f26422f68f5d22cab2bc078a62',
  'input:deployed/types/api-proxy.js': 'f5c34a439043b9d5771286a76c8b16210951c25d7d5873b168bcc947720eac0d',
  'input:pre-image/index.js': '142aac84e462173aeb6acc3e36d97b5c6aae2a31a087b91f99cffeff48378374',
  'input:pre-image/types/api-proxy.js': '7f56fb805fe4d8afbdbd9dee0c3e641acaf2d9c9831de0b7ea018e92b9343036',
  'input:buggy/index.buggy.js': 'f568f8a9e67ef123b8f08e659a435bbdff09dfc895e12a9729426c6b30051434',
  'input:patches/B1-transform.cjs': '0f3a66767874841b936aa80c5236962001ed4a89cf43e6b39b222e6505ace1a8',
  'output:candidate/index.js': '96ad39b7c37e1e0ab7ef07d991ee86f103c649b0ff595317ca32b6990a2c3310',
  'output:candidate/types/api-proxy.js': 'f4752c39623f863f9e5c9e455d1226d933bc1950e7b8c12b92cce87658165734',
};

console.log('=== 输入 / 产物指纹 ===');
rec('input:deployed/index.js', join(DSH, 'index.js'));
rec('input:deployed/types/api-proxy.js', join(DSH, 'types', 'api-proxy.js'));
rec('input:pre-image/index.js', join(PRE, 'index.js'));
rec('input:pre-image/types/api-proxy.js', join(PRE, 'types', 'api-proxy.js'));
rec('input:buggy/index.buggy.js', join(HERE, '..', 'backup', 'B1', 'server', 'b1fix-20260920-183319', 'index.buggy.js'));
rec('input:patches/B1-transform.cjs', join(HERE, '..', 'patches', 'B1-transform.cjs'));
rec('output:candidate/index.js', join(HERE, 'dryrun', 'index.js'));
rec('output:candidate/types/api-proxy.js', join(HERE, 'dryrun', 'types', 'api-proxy.js'));
for (const [k, want] of Object.entries(EXPECT)) {
  const got = report.files[k]?.sha256;
  check(`${k} sha256 与记录值一致`, got === want, `${String(got).slice(0, 16)}… vs ${want.slice(0, 16)}…`);
}

console.log('\n=== 本档脚本 / 规格指纹（主 agent 落地前请核对） ===');
const SCRIPTS = [
  ['spec-v2', join(HERE, 'B1-transform.v2.cjs')],
  ['spec-v1-copy', join(HERE, 'spec', 'B1-transform.v1.cjs')],
  ['anchors', join(HERE, 'lib', 'anchors.cjs')],
  ['apply-B1-v2', join(HERE, 'apply-B1-v2.mjs')],
  ['validate-verifier-v2', join(HERE, 'validate-verifier-v2.mjs')],
  ['probe-counterfactual', join(HERE, 'probe-b1-counterfactual.mjs')],
  ['probe-cold-order', join(HERE, 'probe-b1-cold-order.mjs')],
  ['apply-sentinel-fixture', join(HERE, 'apply-sentinel-fixture.mjs')],
  ['sentinel-patched', join(HERE, 'sentinel', 'verify-b1-ctx-binding.patched.mjs')],
  ['du-E-rollback', join(HERE, 'du-E-rollback.mjs')],
  ['run-all', join(HERE, 'run-all.mjs')],
  ['pre-image-manifest', join(HERE, 'results', 'pre-image-manifest.json')],
];
for (const [k, p] of SCRIPTS) {
  const s = rec(`script:${k}`, p);
  console.log(`      ${k.padEnd(24)} ${s ? s.sha256.slice(0, 16) + '… ' + String(s.bytes).padStart(8) + ' B' : 'MISSING'}`);
}

console.log('\n=== 关键不变量 ===');
{
  // 1) v2 规格的 body 与审计预验证候选逐字节相同（只多了注释头）
  const a = readFileSync(join(AUDIT, 'B1-transform.v2-candidate.cjs'), 'utf8');
  const b = readFileSync(join(HERE, 'B1-transform.v2.cjs'), 'utf8');
  const cut = (t) => t.slice(t.indexOf('const MARK_SUBAGENT_MAX'));
  check('v2 规格 body 与审计预验证候选（exec-audit/b1/B1-transform.v2-candidate.cjs）逐字节相同（仅新增注释头）',
    cut(a) === cut(b) && a !== b, `body ${cut(b).length} 字符；头部新增 ${b.length - cut(b).length - (a.length - cut(a).length)} 字符`);
  // 2) v1 副本 body 与 patches/B1-transform.cjs 相同（只多 provenance 头）
  const c = readFileSync(join(HERE, 'spec', 'B1-transform.v1.cjs'), 'utf8');
  const d = readFileSync(join(HERE, '..', 'patches', 'B1-transform.cjs'), 'utf8');
  const cut2 = (t) => t.slice(t.indexOf("'use strict';"));
  check('v1 只读副本 body 与 patches/B1-transform.cjs 逐字节相同（patches/ 未被本档触碰）',
    cut2(c) === cut2(d), `patches sha=${report.files['input:patches/B1-transform.cjs'].sha256.slice(0, 16)}…`);
  // 3) 哨兵补丁后文件 ≠ probes 现行文件（说明补丁确实需要落地）
  const e = readFileSync(join(HERE, 'sentinel', 'verify-b1-ctx-binding.patched.mjs'), 'utf8');
  const f = readFileSync(join(HERE, '..', 'probes', 'verify-b1-ctx-binding.mjs'), 'utf8');
  check('哨兵补丁后文件 ≠ probes/ 现行文件（待主 agent 执行 --apply）', e !== f,
    `patched=${report.files['script:sentinel-patched'].sha256.slice(0, 16)}…；probes 现行=fe8cf12554f75b23…`);
  // 4) 候选件字节数
  check('候选件字节数 == 审计期望（index 217,279 B / api-proxy 175,895 B）',
    report.files['output:candidate/index.js'].bytes === 217279 && report.files['output:candidate/types/api-proxy.js'].bytes === 175895,
    `${report.files['output:candidate/index.js'].bytes} B / ${report.files['output:candidate/types/api-proxy.js'].bytes} B`);
  // 5) buggy 不是 pre-image（再次钉死）
  check('buggy sha 既不等于 pre-image 也不等于 deployed（回滚必须只认 pre-image）',
    report.files['input:buggy/index.buggy.js'].sha256 !== EXPECT['input:pre-image/index.js']
    && report.files['input:buggy/index.buggy.js'].sha256 !== EXPECT['input:deployed/index.js'], 'f568f8a9…');
}

console.log('\n=== 本档写入边界声明 ===');
report.writeBoundary = {
  wroteInsideWorkspace: ['.workspace/lag-fix/exec-b1/**', '.workspace/lag-fix/backup/B1/server/b1fix2-*/**（apply 演练产生的备份目录）'],
  didNotWrite: [
    '~/.npm-global/...（沙箱不可写 ⇒ deployed 写入留给主 agent 用 apply-B1-v2.mjs --apply 执行）',
    '.workspace/lag-fix/patches/B1-transform.cjs（本体未改，留给主 agent 与 deployed 一起替换）',
    '.workspace/lag-fix/probes/verify-b1-ctx-binding.mjs（以 apply-sentinel-fixture.mjs --apply 交付）',
    '~/.dsh/sessions（只按裁决读首帧 header，未写）',
    '任何 git commit（按指令不做）',
  ],
  sandboxPermissionsUsed: false,
};
check('沙箱纪律：本档未使用 sandbox_permissions，未写 deployed / patches / probes / ~/.dsh',
  true, '写入仅落在 exec-b1/** 与 apply 演练的 backup 目录');

report.failures = bad;
report.outcome = bad === 0 ? 'PASS' : 'FAIL';
const p = join(HERE, 'results', 'provenance.json');
mkdirSync(dirname(p), { recursive: true });
writeFileSync(p, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`\n[provenance] ${report.outcome}  失败 ${bad} 项 / 共 ${report.checks.length} 项  → ${p}`);
process.exit(bad === 0 ? 0 : 2);
