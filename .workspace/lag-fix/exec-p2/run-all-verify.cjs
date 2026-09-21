#!/usr/bin/env node
'use strict';
/**
 * run-all-verify.cjs — P2AC 执行档的一键自证（按固定顺序跑全部闸门，汇总 exit code）。
 *
 * 顺序（前一步失败不阻断后一步的"信息采集"，但总 exit code 反映真实失败面）：
 *   0. pre-image 核对 + 候选件可复现      verify-preimage.cjs
 *   1. 候选件静态断言（T1/T2/T3 + 反向对照）  assert-candidate-static.js
 *   2. 候选件对拍（三态 × 六场景 + 反向对照） verify-candidate-p2ac.cjs
 *   3. 改前态 baseline harness（18/18，缺陷必须复现）  research-v2/semantics/harness-a-p2-stale-row.cjs
 *      ⚠️ 会重写该 harness 自己的产物 research-v2/semantics/results/p2-stale-row.json（脚本设计行为，非产品文件）
 *   4. 候选态 harness（18/18，缺陷必须消失）  harness-a-p2-stale-row-post-p2ac.cjs
 *
 * 另附：sandbox 彩排（把 pre-image 复制到 exec-p2/sandbox 再 --apply / --rollback），证明写路径与回滚真的可用。
 * 全程**不写 deployed 目标**（deployed 写入由主 agent 执行）。
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('node:child_process');

const HERE = __dirname;
const RESULTS = path.join(HERE, 'results');
fs.mkdirSync(RESULTS, { recursive: true });

const steps = [];
function run(label, cmd, args, opts = {}) {
  const started = Date.now();
  const r = spawnSync(cmd, args, { cwd: opts.cwd || HERE, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const ms = Date.now() - started;
  const tail = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n').slice(-3).join(' | ');
  const code = r.status === null ? -1 : r.status;
  steps.push({ label, cmd: `${path.basename(cmd)} ${args.join(' ')}`, exitCode: code, ms, tail });
  process.stdout.write(`\n=== [${code === 0 ? 'OK' : 'FAIL'}] ${label} (exit=${code}, ${ms} ms)\n`);
  process.stdout.write(tail.split(' | ').map((l) => `    ${l}`).join('\n') + '\n');
  if (code !== 0) process.stdout.write(`    (output above is the tail; full output follows)\n`);
  return { code, stdout: r.stdout || '', stderr: r.stderr || '' };
}

run('0. pre-image + candidate reproducibility', process.execPath, ['verify-preimage.cjs']);
run('1. candidate static assertions (T1/T2/T3 + reverse controls)', process.execPath, ['assert-candidate-static.js']);
run('2. candidate variant matrix (3 forms x 6 scenarios + reverse controls)', process.execPath, ['verify-candidate-p2ac.cjs']);
run('3. PRE-state baseline harness (defect must reproduce; pins the live bundle)',
  process.execPath, [path.join('..', 'research-v2', 'semantics', 'harness-a-p2-stale-row.cjs')]);
run('4. POST-state harness (defect must be gone; pins the candidate)',
  process.execPath, ['harness-a-p2-stale-row-post-p2ac.cjs']);

/* sandbox rehearsal: prove the write path and the rollback really work, without touching the deployed file */
const sandbox = path.join(HERE, 'sandbox');
fs.mkdirSync(sandbox, { recursive: true });
const preDir = fs.readdirSync(path.join(HERE, 'preimage')).filter((d) => fs.existsSync(path.join(HERE, 'preimage', d, 'META.txt'))).sort()[0];
fs.copyFileSync(path.join(HERE, 'preimage', preDir, 'client.js'), path.join(sandbox, 'deployed-client.js'));
const applied = run('5a. sandbox rehearsal: --apply on a COPY of the pre-image',
  process.execPath, ['apply-P2AC.mjs', '--apply', `--target=${path.join(sandbox, 'deployed-client.js')}`]);
const appliedSha = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(sandbox, 'deployed-client.js'))).digest('hex');
const candSha = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(HERE, 'candidate', 'client.js'))).digest('hex');
steps.push({ label: '5b. sandbox apply result == candidate bytes', exitCode: appliedSha === candSha ? 0 : 1, ms: 0, tail: `${appliedSha} vs ${candSha}` });
process.stdout.write(`\n=== [${appliedSha === candSha ? 'OK' : 'FAIL'}] 5b. sandbox apply result == candidate bytes (${appliedSha})\n`);
run('6a. sandbox rehearsal: idempotent re-apply must SKIP (exit 0)',
  process.execPath, ['apply-P2AC.mjs', '--apply', `--target=${path.join(sandbox, 'deployed-client.js')}`]);
const rolled = run('6b. sandbox rehearsal: --rollback must restore the pre-image byte for byte',
  process.execPath, ['apply-P2AC.mjs', '--rollback', `--target=${path.join(sandbox, 'deployed-client.js')}`]);
const rolledSha = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(sandbox, 'deployed-client.js'))).digest('hex');
const preSha = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(HERE, 'preimage', preDir, 'client.js'))).digest('hex');
steps.push({ label: '6c. sandbox rollback restored the pre-image bytes', exitCode: rolledSha === preSha ? 0 : 1, ms: 0, tail: `${rolledSha} vs ${preSha}` });
process.stdout.write(`\n=== [${rolledSha === preSha ? 'OK' : 'FAIL'}] 6c. sandbox rollback restored the pre-image bytes (${rolledSha})\n`);

const failed = steps.filter((s) => s.exitCode !== 0);
const out = {
  generatedBy: 'exec-p2/run-all-verify.cjs',
  steps,
  passed: steps.length - failed.length,
  failed: failed.length,
  deployed_target_written: false,
  note: 'deployed 写入由主 agent 执行：node apply-P2AC.mjs --apply（自动 pre-image + 写后 node --check）',
};
fs.writeFileSync(path.join(RESULTS, 'run-all-verify.json'), `${JSON.stringify(out, null, 2)}\n`);
process.stdout.write(`\n===== SUMMARY: ${out.passed}/${steps.length} steps OK, ${out.failed} failed\n`);
for (const s of steps) process.stdout.write(`  [${s.exitCode === 0 ? 'OK  ' : 'FAIL'}] ${s.label}\n`);
process.stdout.write(`raw json: ${path.join(RESULTS, 'run-all-verify.json')}\n`);
process.exit(failed.length === 0 ? 0 : 1);
