#!/usr/bin/env node
'use strict';
/**
 * verify-preimage.cjs — P2AC 的 pre-image / 候选件复现 / live 只读三方核对（只读，不写产品文件）。
 *
 * 检查项  V1  目标 live sha256 == d71a8ca5…（审计首尾一致的同一份字节）
 *        V2  pre-image 目录 client.js sha256 == live sha256（**必须从当前 live 取**；
 *            ⚠️ 审计实测：backup/R4-20260921-115821/deployed/client.js 是宿主侧另一个同名文件
 *            eeb5dcf2…，**不是**本 bundle 的 pre-image，禁止当回滚点）
 *        V3  pre-image META.txt 的 unit/target/pre_sha256/回滚铁律齐全
 *        V4  候选件可**复现**：用 apply-P2AC 的同一套变换在内存里重算 live → 结果 sha256 必须等于
 *            candidate/client.js 的 sha256（证明候选件不是手改出来的）
 *        V5  候选件 = live + 4 处改动，marker 恰 4 个，旧语义 0 处，line delta = +5
 *        V6  live 目标在本次执行档全程**未被写入**（再次核对 sha256，与 V1 相同）
 *
 * 产物：results/preimage-verify.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HERE = __dirname;
const LIVE = '/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js';
const CANDIDATE = path.join(HERE, 'candidate', 'client.js');
const PREIMAGE_ROOT = path.join(HERE, 'preimage');
const EXPECTED_LIVE_SHA = 'd71a8ca524307aa35b74c5504ce396458cd6cdd38bd2759be8e16bd1b783d69b';
const EXPECTED_CAND_SHA = '357f1703722464ee7fc40566f13e0ae4dd225131589862c8d1def67deb93d61f';
const R4_TRAP_SHA = 'eeb5dcf2'; /* 审计警示：另一个同名文件，不是本 bundle 的 pre-image */
const MARKER = '/* p2ac-fix */';

const out = { findings: [] };
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const countLit = (h, n) => h.split(n).length - 1;
function record(name, ok, detail, expected, observed) {
  const f = { assertion: name, status: ok === true ? 'PASS' : ok === false ? 'FAIL' : 'INCONCLUSIVE', detail, evidence: 'executed' };
  if (expected !== undefined) f.expected = expected;
  if (observed !== undefined) f.observed = observed;
  out.findings.push(f);
  process.stdout.write(`${f.status}: ${name}${detail ? ` -> ${detail}` : ''}\n`);
  return f;
}

/* V1 */
const live = fs.readFileSync(LIVE, 'utf8');
const liveSha = sha256(live);
record('V1: live target sha256 == the pinned pre-image d71a8ca5… (this execution run never wrote the deployed file)',
  liveSha === EXPECTED_LIVE_SHA, liveSha, EXPECTED_LIVE_SHA, liveSha);

/* V2 / V3 */
const stamps = fs.existsSync(PREIMAGE_ROOT)
  ? fs.readdirSync(PREIMAGE_ROOT).filter((d) => fs.existsSync(path.join(PREIMAGE_ROOT, d, 'META.txt'))).sort()
  : [];
record('V2: at least one P2AC pre-image exists under exec-p2/preimage (taken from the CURRENT live, not from backup/R4-*)',
  stamps.length >= 1, `${stamps.length} pre-image(s): ${stamps.join(', ') || 'none'}`, '>=1', stamps.length);
let chosen = null, preMetaOk = false, preMatchesLive = false;
for (const st of stamps) {
  const dir = path.join(PREIMAGE_ROOT, st);
  const pre = fs.readFileSync(path.join(dir, 'client.js'), 'utf8');
  const meta = fs.readFileSync(path.join(dir, 'META.txt'), 'utf8');
  const preSha = sha256(pre);
  const ok = preSha === liveSha && preSha.startsWith('d71a8ca5');
  const metaOk = meta.includes('unit=P2AC-unit') && meta.includes(`target=${LIVE}`)
    && meta.includes(`pre_sha256=${EXPECTED_LIVE_SHA}`)
    && meta.includes('rollback_order=P2AC -> B1/C1 -> C1')
    && meta.includes('forbidden_rollback=C1 --rollback');
  const shaFile = fs.existsSync(path.join(dir, 'client.js.sha256'))
    ? fs.readFileSync(path.join(dir, 'client.js.sha256'), 'utf8').trim().split(/\s+/)[0] : null;
  out.preimages = out.preimages || [];
  out.preimages.push({ stamp: st, sha256: preSha, matchesLive: ok, metaOk, sha256FileMatches: shaFile === preSha, isR4MisleadingFile: preSha.startsWith(R4_TRAP_SHA) });
  if (ok && metaOk) { chosen = { stamp: st, dir, preSha }; preMetaOk = true; preMatchesLive = true; }
}
record('V2b: the chosen pre-image is byte-identical to the current live bundle and is NOT the misleading R4 file',
  preMatchesLive && chosen !== null && !chosen.preSha.startsWith(R4_TRAP_SHA),
  chosen ? `stamp=${chosen.stamp} sha256=${chosen.preSha}` : 'no usable pre-image',
  'sha256 == live && not eeb5dcf2…', chosen ? chosen.preSha : null);
record('V3: META.txt carries unit=P2AC-unit, the absolute target path, pre_sha256, and the rollback iron law (P2AC -> B1/C1 -> C1, C1 --rollback forbidden)',
  preMetaOk, chosen ? `META.txt of ${chosen.stamp} validated` : 'none validated', true, preMetaOk);

/* V4: reproduce the candidate in memory with the same transformation the script applies */
const lineWhitespace = (l) => (l.match(/^\t*/) || [''])[0];
const findLine = (needle) => { const l = live.split('\n').find((x) => x.trim() === needle); if (!l) throw new Error(`nf ${needle.slice(0, 40)}`); return l; };
const PRE = findLine('if (current !== void 0 && currentAddress !== void 0) {');
const SEEN = findLine('seen.add(childId);');
const CARRY = findLine('for (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0) byId[id] = previousProjection.byId[id];');
const GATE = findLine('const nextById = previousProjection !== void 0 && reusedEntries === liveKeys.length ? previousProjection.byId : stableById;');
const OLDCOMMENT = findLine("/* Carry the previous projection's extra rows (address-chain children) forward before diffing. */");
const A1_BLOCK = `${lineWhitespace(PRE)}const chainRowIds = new Set(); ${MARKER}`;
const A2_BLOCK = `${lineWhitespace(SEEN)}chainRowIds.add(childId); ${MARKER}`;
const A3_BLOCK = `${lineWhitespace(CARRY)}${MARKER} /* address-chain scoped carry-forward: only ids a visited chain step genuinely needs. */\n`
  + `${lineWhitespace(CARRY)}for (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0 && chainRowIds.has(id)) byId[id] = previousProjection.byId[id];`;
const GATE_BLOCK = `${lineWhitespace(PRE)}${MARKER} /* key-set gate: reusing the whole previous byId object is only sound when its key set has no extra key. */\n`
  + `${lineWhitespace(PRE)}/* the previous key set is read AFTER the chain-scoped carry-forward, so it is compared against the same liveKeys. */\n`
  + `${lineWhitespace(PRE)}const reusableByIdKeys = previousProjection !== void 0 ? Object.keys(previousProjection.byId) : void 0;\n`
  + `${lineWhitespace(PRE)}const nextById = previousProjection !== void 0 && reusedEntries === liveKeys.length && reusableByIdKeys.length === liveKeys.length && reusableByIdKeys.every((id) => Object.prototype.hasOwnProperty.call(byId, id)) ? previousProjection.byId : stableById;`;
/* 与 apply-P2AC.mjs 的 spliceWholeLine 完全同构：探针是「行内容（无缩进）」，替换是整行（含换行）。 */
const wholeLine = (src, probe, replacement) => {
  const l = src.split('\n').find((x) => x.trim() === probe.trim());
  if (!l) throw new Error(`probe not a line: ${probe.trim().slice(0, 40)}`);
  return src.split(`${l}\n`).join(`${replacement}\n`);
};
let rebuilt = live;
/* 注意：探针必须是**行内容**（trim 后），否则 split 会切在行中间、把探针前面的缩进留在前半段，
 * 再叠上替换文本自带的缩进 ⇒ 缩进翻倍（这正是 apply-P2AC 开发中实测到的第四个坑，见脚本注释）。 */
rebuilt = rebuilt.split(`${lineWhitespace(OLDCOMMENT)}${OLDCOMMENT.trim()}\n`).join('');
rebuilt = wholeLine(rebuilt, PRE, `${A1_BLOCK}\n${PRE}`);
rebuilt = wholeLine(rebuilt, SEEN, `${SEEN}\n${A2_BLOCK}`);
rebuilt = wholeLine(rebuilt, CARRY, A3_BLOCK);
rebuilt = wholeLine(rebuilt, GATE, GATE_BLOCK);
const rebuiltSha = sha256(rebuilt);

/* V5 */
const cand = fs.readFileSync(CANDIDATE, 'utf8');
const candSha = sha256(cand);
record('V4: the candidate is REPRODUCIBLE — recomputing the transformation from the current live bundle yields the candidate byte for byte',
  rebuiltSha === candSha,
  `rebuilt=${rebuiltSha} candidate=${candSha}`, 'identical', rebuiltSha === candSha ? 'identical' : 'DIFFERS');
record('V5: candidate == candidate sha256 pinned by apply-P2AC.mjs / assert-candidate-static.js / harness副本',
  candSha === EXPECTED_CAND_SHA, candSha, EXPECTED_CAND_SHA, candSha);
record('V5b: candidate carries exactly 4 unit markers, 0 occurrences of the old prose comment, 0 occurrences of the blanket carry-forward',
  countLit(cand, MARKER) === 4 && countLit(cand, OLDCOMMENT.trim()) === 0 && countLit(cand, CARRY.trim()) === 0,
  `markers=${countLit(cand, MARKER)}, oldComment=${countLit(cand, OLDCOMMENT.trim())}, blanket=${countLit(cand, CARRY.trim())}`,
  '4/0/0', `${countLit(cand, MARKER)}/${countLit(cand, OLDCOMMENT.trim())}/${countLit(cand, CARRY.trim())}`);
record('V5c: line delta == +5 (A1 +1, A2 +1, A3 +1, comment removal -1, gate +3)',
  cand.split('\n').length - live.split('\n').length === 5,
  `${live.split('\n').length} -> ${cand.split('\n').length} lines`, '+5', cand.split('\n').length - live.split('\n').length);

/* V6 */
const liveAfter = sha256(fs.readFileSync(LIVE, 'utf8'));
record('V6: the deployed target is untouched after this whole run (start-of-run sha == end-of-run sha)',
  liveAfter === liveSha && liveAfter === EXPECTED_LIVE_SHA, liveAfter, EXPECTED_LIVE_SHA, liveAfter);

out.summary = {
  live_sha256: liveSha,
  chosen_preimage: chosen ? chosen.stamp : null,
  candidate_sha256: candSha,
  candidate_reproducible: rebuiltSha === candSha,
  deployed_target_written: false,
  R4_misleading_preimage_rejected: true,
  findings: { pass: out.findings.filter((f) => f.status === 'PASS').length, fail: out.findings.filter((f) => f.status === 'FAIL').length },
};
fs.mkdirSync(path.join(HERE, 'results'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'results', 'preimage-verify.json'), `${JSON.stringify(out, null, 2)}\n`);
process.stdout.write(`\nraw json: ${path.join(HERE, 'results', 'preimage-verify.json')}\n`);
process.stdout.write(`findings: ${out.summary.findings.pass} PASS / ${out.summary.findings.fail} FAIL\n`);
process.exit(out.summary.findings.fail === 0 ? 0 : 1);
