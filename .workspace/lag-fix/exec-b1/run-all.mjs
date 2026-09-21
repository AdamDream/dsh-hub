#!/usr/bin/env node
'use strict';
/**
 * exec-b1/run-all.mjs —— B1-fix2 交付档的**一键复跑**（只读 + 落盘报告）。
 *
 * 用法：
 *   node run-all.mjs            # 沙箱内全量复跑（不写 deployed、不改 probes/）
 *   node run-all.mjs --post     # **重启后**的活体验收口径（加 --expect-deployed，A6-live 升格为硬断言）
 *
 * 退出码：0 = 全部 PASS / 2 = 有 FAIL
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const POST = process.argv.includes('--post');
const STEPS = [
  { id: 'anchor-probe(audit-tool)', cmd: ['node', [join(HERE, '..', 'exec-audit', 'b1', 'anchor-probe.cjs')]], label: '审计锚点探针（40 锚点，0 失败）' },
  { id: 'fix-replay(audit-tool)', cmd: ['node', [join(HERE, '..', 'exec-audit', 'b1', 'fix-replay.cjs')]], label: '审计回放（40 项，v2 规格 sha 自证）' },
  { id: 'verify-v2-selfcheck(audit-tool)', cmd: ['node', [join(HERE, '..', 'exec-audit', 'b1', 'verify-v2-selfcheck.cjs')]], label: '审计 9 项自证（M1–M5/W1/C1）' },
  { id: 'apply-B1-v2(DRYRUN)', cmd: ['node', [join(HERE, 'apply-B1-v2.mjs')]], label: '落地脚本 dry-run（三态 pin + 锚点闸门 + node --check）' },
  { id: 'validate-verifier-v2', cmd: ['node', [join(HERE, 'validate-verifier-v2.mjs')]], label: 'V1–V7 差分提取 + 反向对照 + 破坏性自证' },
  { id: 'probe-b1-counterfactual', cmd: ['node', [join(HERE, 'probe-b1-counterfactual.mjs')]], label: '反事实几何（MAX=2 低成本 + 201 原始 + 零回归/冷行/环）' },
  { id: 'probe-b1-cold-order', cmd: ['node', [join(HERE, 'probe-b1-cold-order.mjs'), ...(POST ? ['--expect-deployed'] : [])]], label: 'A6 冷路径集合等式（oracle 只解首帧 header）' },
  { id: 'apply-sentinel-fixture(DRYRUN)', cmd: ['node', [join(HERE, 'apply-sentinel-fixture.mjs')]], label: '哨兵夹具三向自证（dry-run）' },
  { id: 'du-E-rollback', cmd: ['node', [join(HERE, 'du-E-rollback.mjs')]], label: 'pre-image / 回滚固化（含 buggy 非 pre-image 负向钉死）' },
  { id: 'node --check candidates', cmd: ['node', ['--check', join(HERE, 'dryrun', 'index.js')]], label: '候选件 index.js 语法' },
  { id: 'node --check candidates(module)', cmd: ['node', ['--check', join(HERE, 'dryrun', 'types', 'api-proxy.js')]], label: '候选件 types/api-proxy.js 语法' },
  { id: 'node --check sentinel(patched)', cmd: ['node', ['--check', join(HERE, 'sentinel', 'verify-b1-ctx-binding.patched.mjs')]], label: '更新后哨兵脚本语法' },
  { id: 'node --check runner-scripts', cmd: ['node', ['--check', join(HERE, 'run-all.mjs')]], label: '本脚本语法' },
  { id: 'provenance', cmd: ['node', [join(HERE, 'provenance.mjs')]], label: '自指纹 + 写入边界声明' },
];

const results = { at: new Date().toISOString(), mode: POST ? 'POST-RESTART' : 'SANDBOX', steps: [], outcome: 'PENDING' };
let failed = 0;
for (const s of STEPS) {
  const t0 = Date.now();
  let code = 0; let out = '';
  try { out = execFileSync(s.cmd[0], s.cmd[1], { encoding: 'utf8', stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { code = e.status ?? 1; out = String(e.stdout ?? '') + String(e.stderr ?? ''); }
  const ms = Date.now() - t0;
  const tail = out.trim().split('\n').slice(-3).join(' | ');
  results.steps.push({ id: s.id, label: s.label, cmd: [s.cmd[0], ...s.cmd[1]].join(' '), exitCode: code, ms, tail });
  if (code !== 0) failed += 1;
  console.log(`${code === 0 ? 'PASS' : 'FAIL'}  [${code}] ${s.label}  (${ms} ms)`);
  console.log(`      ${tail}`);
}
results.failed = failed;
results.outcome = failed === 0 ? 'PASS' : 'FAIL';
const p = join(HERE, 'results', `run-all.${POST ? 'POST' : 'SANDBOX'}.json`);
mkdirSync(dirname(p), { recursive: true });
writeFileSync(p, JSON.stringify(results, null, 2) + '\n', 'utf8');
console.log(`\n[run-all] ${results.outcome}  失败 ${failed}/${STEPS.length}  → ${p}`);
process.exit(failed === 0 ? 0 : 2);
