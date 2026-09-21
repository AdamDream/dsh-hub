#!/usr/bin/env node
/**
 * apply-P2AC.mjs — P2 address-chain stale row（P-AC）落地脚本（独立单元，独立标记，独立 pre-image）。
 *
 * ┌─ 用法 ────────────────────────────────────────────────────────────────┐
 * │  node apply-P2AC.mjs                          # dry-run（默认）：只打印将要写的内容，不写任何文件 │
 * │  node apply-P2AC.mjs --dry-run                # 同上（显式）                                      │
 * │  node apply-P2AC.mjs --print-target=<path>    # 把变换结果写到 <path>（生成候选件；dry-run 语义）  │
 * │  node apply-P2AC.mjs --apply                  # 真正写 deployed 目标（自动 pre-image + node --check）│
 * │  node apply-P2AC.mjs --rollback               # 用本单元最近一次 pre-image 还原目标                │
 * │  node apply-P2AC.mjs --preimage-only          # 只落 pre-image（快照），不写目标（主 agent 首步可用）│
 * │  node apply-P2AC.mjs --apply --target=<path>  # 覆盖目标（仅用于沙箱演练/对拍）                    │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ 回滚铁律（不可换次序）─────────────────────────────────────────────────┐
 * │  ① P2AC 本脚本 --rollback    → 目标回到 d71a8ca5…                        │
 * │  ② B1/C1 --rollback          → runtime 回到 458c0898、ui 回到 baac1913   │
 * │  ③ C1 --rollback             → runtime 回到 baseline aba836a0            │
 * │                                                                         │
 * │  ✘ 禁止用 C1 --rollback 当作 P2AC 的回滚手段：它还原的是 aba836a0 baseline， │
 * │    会连带抹掉 B1 的 `:8572` 行（runningSubagentCount 判据）与 P1/P2 全部。 │
 * │  ✘ 禁止把本改动塞进 patches/client-runtime-perf.sh（C1），也不要塞进 B1 脚本。│
 * │  ✘ 不得复用 `* / dsh-perf-fix P2 v1 * /` 或 `* / dsh-lag-fix B1/C1 * /`： │
 * │    后者是两个脚本的幂等判据，复用会让 workspace-ui-runsubagent-count.sh 误判。│
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * 落地语义（审计 audit.md §2.2 / §3.2，逐字节照抄，不重新设计）：
 *   A1 `:9294` 之前插入 1 行声明（**4 Tab = projectList 方法体顶层**，T1 陷阱）
 *   A2 `seen.add(childId);`（**6 Tab**，全文件唯一）之后插入 1 行登记
 *   A3 `:9327` 回拷行 2 行替换（**5 Tab**）+ 旧散文注释**连行带换行整行删除**（T3 陷阱）
 *   闸门 `:9340` 4 行替换（**4 Tab**），成员性键集校验
 *
 * 安全闸门（任一不满足即 exit 1，绝不写）：
 *   G1 目标 sha256 == d71a8ca5…（除非 --allow-unknown-preimage；仅沙箱演练用）
 *   G2 4 个锚点在目标里**各恰好命中 1 次**（唯一命中才写）
 *   G3 幂等：目标已含本单元标记（`* / p2ac-fix * /`）⇒ SKIP（不重复插入）
 *   G4 写前自动 pre-image（cp -p + sha256 + META.txt），写后 node --check
 *   G5 引入标识符本文件内声明校验（chainRowIds / reusableByIdKeys）
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TARGET_DEFAULT = '/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js';
const PREIMAGE_ROOT = path.join(HERE, 'preimage');
const EXPECTED_PRE_SHA256 = 'd71a8ca524307aa35b74c5504ce396458cd6cdd38bd2759be8e16bd1b783d69b';
const MARKER = '/* p2ac-fix */';
const UNIT = 'P2AC-unit';

/* ---------- args ---------- */
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit === undefined ? dflt : hit.slice(n.length + 3);
};
const APPLY = flag('apply');
const ROLLBACK = flag('rollback');
const PREIMAGE_ONLY = flag('preimage-only');
const PRINT_TARGET = opt('print-target');
const TARGET = opt('target', TARGET_DEFAULT);
const ALLOW_UNKNOWN = flag('allow-unknown-preimage');
const DRY = !APPLY && !ROLLBACK && PRINT_TARGET === undefined;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const countLit = (hay, needle) => hay.split(needle).length - 1;
const tabsOf = (line) => (line.match(/^\t*/) || [''])[0];
const tabCount = (line) => tabsOf(line).length;
const say = (s) => process.stdout.write(`${s}\n`);
const die = (s) => { process.stderr.write(`\n[P2AC ABORT] ${s}\n`); process.exit(1); };

/* ---------- rollback ---------- */
/* 回滚点选择顺序（刻意做成"确定性"，避免沙箱彩排留下的 pre-image 被误当成本单元的回滚点）：
 *   1) --stamp=<stamp> 显式指定；
 *   2) preimage/CANONICAL.txt（由 --preimage-only / --apply 写入的**正式**回滚点）；
 *   3) 否则取最新一枚带 META.txt 的。 */
const CANONICAL = path.join(PREIMAGE_ROOT, 'CANONICAL.txt');
if (ROLLBACK) {
  if (!fs.existsSync(PREIMAGE_ROOT)) die(`no pre-image root at ${PREIMAGE_ROOT}`);
  const stamps = fs.readdirSync(PREIMAGE_ROOT).filter((d) => fs.existsSync(path.join(PREIMAGE_ROOT, d, 'META.txt'))).sort();
  if (stamps.length === 0) die('no pre-image with META.txt');
  const asked = opt('stamp');
  let stamp;
  if (asked) {
    if (!stamps.includes(asked)) die(`--stamp=${asked} not found (have: ${stamps.join(', ')})`);
    stamp = asked;
  } else if (fs.existsSync(CANONICAL)) {
    stamp = fs.readFileSync(CANONICAL, 'utf8').trim().split('\n')[0].trim();
    if (!stamps.includes(stamp)) die(`CANONICAL.txt names ${stamp}, which has no META.txt`);
    say(`[ROLLBACK] using the canonical pre-image ${stamp} (override with --stamp=<stamp>)`);
  } else {
    stamp = stamps[stamps.length - 1];
  }
  say(`[ROLLBACK] available pre-images: ${stamps.join(', ')}`);
  const dir = path.join(PREIMAGE_ROOT, stamp);
  const meta = fs.readFileSync(path.join(dir, 'META.txt'), 'utf8');
  if (!meta.includes(`unit=${UNIT}`)) die(`pre-image ${stamp} does not belong to ${UNIT}`);
  const preSha = (meta.match(/^pre_sha256=(\S+)$/m) || [])[1];
  if (preSha !== EXPECTED_PRE_SHA256) die(`pre-image ${stamp} pins ${preSha}, expected ${EXPECTED_PRE_SHA256}`);
  const pre = fs.readFileSync(path.join(dir, 'client.js'));
  if (sha256(pre) !== preSha) die(`pre-image ${stamp} is corrupt (sha mismatch)`);
  const targetSha = fs.existsSync(TARGET) ? sha256(fs.readFileSync(TARGET)) : '(missing)';
  if (targetSha !== preSha && flag('force') !== true) {
    const live = fs.readFileSync(TARGET, 'utf8');
    if (countLit(live, MARKER) === 0) die(`live target carries no ${MARKER} marker and its sha is not the pre-image — refusing (use --force if you really mean it)`);
  }
  fs.writeFileSync(TARGET, pre);
  say(`[ROLLBACK] ${TARGET} <- ${path.join(dir, 'client.js')} (pre-image ${stamp})`);
  say(`[ROLLBACK] sha256 now ${sha256(fs.readFileSync(TARGET))}`);
  say('[ROLLBACK] 三条自证：');
  say(`  sha256sum  -> ${sha256(fs.readFileSync(TARGET))}  (expect ${EXPECTED_PRE_SHA256})`);
  say(`  grep -c '${MARKER}' -> ${countLit(fs.readFileSync(TARGET, 'utf8'), MARKER)}  (expect 0)`);
  say('  node --check -> 见下（rollback 也跑）');
  execFileSync(process.execPath, ['--check', TARGET], { stdio: 'inherit' });
  say('[ROLLBACK] 铁律：若需继续回滚，次序为 P2AC → B1/C1 → C1；禁止用 C1 --rollback 抹掉 B1/P2AC/P1/P2。');
  process.exit(0);
}

/* ---------- 1. read + G3 idempotence (checked BEFORE G1 so a patched target never reads as "drifted") ---------- */
if (!fs.existsSync(TARGET)) die(`target not found: ${TARGET}`);
const original = fs.readFileSync(TARGET, 'utf8');
const preSha = sha256(Buffer.from(original, 'utf8'));
const markerCountProbe = countLit(original, MARKER);
if (markerCountProbe > 0) {
  if (PRINT_TARGET !== undefined) die(`G3 FAILED: input already carries ${markerCountProbe} × ${MARKER} — use the unpatched pre-image as input`);
  say(`[P2AC] G3: SKIP — target already carries ${markerCountProbe} × ${MARKER} (idempotent no-op); nothing to do.`);
  say(`[P2AC] G3: target sha256 = ${preSha}`);
  process.exit(0);
}

say(`[P2AC] mode        : ${APPLY ? 'APPLY' : ROLLBACK ? 'ROLLBACK' : PREIMAGE_ONLY ? 'PREIMAGE-ONLY (no write to target)' : PRINT_TARGET ? 'PRINT-TARGET (dry-run semantics)' : 'DRY-RUN'}`);
say(`[P2AC] target      : ${TARGET}`);
say(`[P2AC] pre sha256  : ${preSha}`);
say(`[P2AC] expected pre: ${EXPECTED_PRE_SHA256}`);
if (preSha !== EXPECTED_PRE_SHA256 && !ALLOW_UNKNOWN && PRINT_TARGET === undefined && !PREIMAGE_ONLY) {
  die(`G1 FAILED: target sha256 ${preSha} != pinned pre-image ${EXPECTED_PRE_SHA256}\n`
    + '  → 盘面已变（可能是别的补丁已落地）；锚点必须重新推导，不得凭本脚本盲写。');
}
if (preSha !== EXPECTED_PRE_SHA256 && PRINT_TARGET !== undefined) {
  say(`[P2AC] NOTE: pre sha differs from the pinned value but --print-target was given (sandbox rehearsal allowed).`);
}

/* ---------- 3. G4 pre-image ---------- */
let stamp = null;
if (APPLY || PREIMAGE_ONLY) {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
  const dir = path.join(PREIMAGE_ROOT, stamp);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'client.js'), original);
  fs.writeFileSync(path.join(dir, 'client.js.sha256'), `${sha256(Buffer.from(original, 'utf8'))}  client.js\n`);
  fs.writeFileSync(path.join(dir, 'META.txt'), [
    `unit=${UNIT}`,
    `stamp=${stamp}`,
    `target=${TARGET}`,
    `pre_sha256=${sha256(Buffer.from(original, 'utf8'))}`,
    `marker=${MARKER}`,
    'rollback_order=P2AC -> B1/C1 -> C1',
    'forbidden_rollback=C1 --rollback (restores aba836a0 baseline and wipes B1 :8572 + P1 + P2)',
    '',
  ].join('\n'));
  say(`[P2AC] G4: pre-image written to ${dir}`);
  if (!PREIMAGE_ONLY) {
    /* 只有真正落到 deployed 目标的那次才更新"正式回滚点"，沙箱彩排不覆盖 */
    fs.writeFileSync(CANONICAL, `${stamp}\n`);
  }
}
if (PREIMAGE_ONLY) {
  fs.writeFileSync(CANONICAL, `${stamp}\n`);
  say(`[P2AC] canonical rollback point recorded: ${CANONICAL} -> ${stamp}`);
  say('[P2AC] --preimage-only: pre-image captured, target deliberately UNTOUCHED.');
  process.exit(0);
}

/* ---------- 4. G2 anchors + measured indentation ---------- */
const A1_ANCHOR = '\t\t\t\tif (current !== void 0 && currentAddress !== void 0) {';
const A2_ANCHOR = '\t\t\t\t\t\tseen.add(childId);';
const A2_PROBE = 'seen.add(childId);';
const PRE_PROBE = A1_ANCHOR.trim();
const A3_ANCHOR = 'for (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0) byId[id] = previousProjection.byId[id];';
const GATE_ANCHOR = 'const nextById = previousProjection !== void 0 && reusedEntries === liveKeys.length ? previousProjection.byId : stableById;';
const OLD_COMMENT = "/* Carry the previous projection's extra rows (address-chain children) forward before diffing. */";

const anchorSpec = [
  ['A1', A1_ANCHOR, 'T2: A1 must be the `if (current !== …) {` line itself, never `const copiedPrevious`'],
  ['A2', A2_PROBE, 'A2 must be the globally unique `seen.add(childId);`'],
  ['A3', A3_ANCHOR, 'A3 is the blanket carry-forward line'],
  ['GATE', GATE_ANCHOR, 'the byId identity-reuse gate line'],
];
say('\n[P2AC] G2: anchor uniqueness (whole file, byte-exact)');
let anchorsOk = true;
for (const [id, probe, why] of anchorSpec) {
  const n = countLit(original, probe);
  say(`  ${id}: ${n} occurrence(s) — ${probe.slice(0, 72)}${probe.length > 72 ? '…' : ''}`);
  if (n !== 1) { anchorsOk = false; say(`      ✘ expected exactly 1. ${why}`); }
}
/* the A1/A2 byte forms also carry the indent → assert the measured depth here */
const A1_OCC = countLit(original, A1_ANCHOR);
const A2_OCC = countLit(original, A2_ANCHOR);
say(`  A1 (with 4 Tab prefix): ${A1_OCC} occurrence(s)   A2 (with 6 Tab prefix): ${A2_OCC} occurrence(s)`);
if (A1_OCC !== 1 || A2_OCC !== 1) anchorsOk = false;
const oldCommentOcc = countLit(original, OLD_COMMENT);
say(`  A3' (old prose comment, must be deleted whole): ${oldCommentOcc} occurrence(s)`);
if (oldCommentOcc !== 1) anchorsOk = false;
if (!anchorsOk) die('G2 FAILED: an anchor is not uniquely present — STOP (stop condition: 锚点非唯一命中).');

/* indentation, measured not assumed */
const T = tabsOf(A1_ANCHOR);      // 4 tabs — projectList method-body top level (T1)
const T5 = '\t'.repeat(5);        // inside `if (copiedPrevious) {`
const T6 = '\t'.repeat(6);        // inside the walk
if (tabCount(A1_ANCHOR) !== 4 || tabCount(A2_ANCHOR) !== 6) die('measured indentation is not 4/6 Tab — abort');
const A1_BLOCK = `${T}const chainRowIds = new Set(); ${MARKER}`;
const A2_BLOCK = `${T6}chainRowIds.add(childId); ${MARKER}`;
const A3_BLOCK = `${T5}${MARKER} /* address-chain scoped carry-forward: only ids a visited chain step genuinely needs. */\n`
  + `${T5}for (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0 && chainRowIds.has(id)) byId[id] = previousProjection.byId[id];`;
const GATE_BLOCK = `${T}${MARKER} /* key-set gate: reusing the whole previous byId object is only sound when its key set has no extra key. */\n`
  + `${T}/* the previous key set is read AFTER the chain-scoped carry-forward, so it is compared against the same liveKeys. */\n`
  + `${T}const reusableByIdKeys = previousProjection !== void 0 ? Object.keys(previousProjection.byId) : void 0;\n`
  + `${T}const nextById = previousProjection !== void 0 && reusedEntries === liveKeys.length && reusableByIdKeys.length === liveKeys.length && reusableByIdKeys.every((id) => Object.prototype.hasOwnProperty.call(byId, id)) ? previousProjection.byId : stableById;`;

/* ---------- 5. splice ---------- *
 * 三个陷阱的落地方式（audit.md §2.2.1 / §7.4）：
 *  T1 A1 的声明必须是 **4 Tab**（projectList 方法体顶层），因为读取方 A3 在 `if (copiedPrevious) {`
 *     块里、**不在** `if (current !== …) {` 块里 —— 放进 5 Tab 会 `ReferenceError: chainRowIds is not defined`。
 *  T2 A1 的锚点必须是 `if (current !== …) {` **这一行**，不得锚 `const copiedPrevious`（会插到 walk 之后）。
 *  T3 旧散文注释必须**连行带换行整行删除**；只替换文本会留下 8 Tab 孤立缩进。
 *
 * ⚠️ 实测踩到的第四个坑（本脚本已用整行锚点规避）：若用「去掉缩进的探针串」做 split/join，
 *    切点会落在**行中间**，探针之前的缩进字节被留在前半段，替换文本自带的缩进再叠上去 ⇒
 *    缩进翻倍（A3 变 10 Tab、闸门变 8 Tab），而 A3 行里那条旧语句原样残留（条件仍是 `byId[id] === void 0`），
 *    于是"看着像替换成功、语义却没变"。故 A3 / 闸门一律走 **整行替换**（行首 Tab 由探针行实测取得）。
 */
let text = original;

function spliceWholeLine(src, probe, replacement, label) {
  const occ = countLit(src, probe);
  if (occ !== 1) die(`${label}: probe appears ${occ} times, expected exactly 1 — abort`);
  const line = src.split('\n').find((l) => l.trim() === probe);
  if (line === undefined) die(`${label}: probe is not a whole trimmed line — abort`);
  const full = `${line}\n`;
  if (!src.includes(full)) die(`${label}: line+newline not found — abort`);
  return src.split(full).join(`${replacement}\n`);
}

/* T3 first: delete the old prose comment line INCLUDING its newline (measured 5 Tab) */
if (!text.includes(`${T5}${OLD_COMMENT}\n`)) die('T3 FAILED: old prose comment is not on its own measured-indent line with a newline — refuse to splice');
text = text.split(`${T5}${OLD_COMMENT}\n`).join('');
/* A1: declaration ABOVE the `if (current !== …) {` line, in the method-body scope (4 Tab) */
text = spliceWholeLine(text, PRE_PROBE, `${A1_BLOCK}\n${A1_ANCHOR}`, 'A1');
/* A2: registration immediately AFTER `seen.add(childId);` */
text = spliceWholeLine(text, A2_ANCHOR.trim(), `${A2_ANCHOR}\n${A2_BLOCK}`, 'A2');
/* A3: whole-line replacement of the blanket carry-forward line */
text = spliceWholeLine(text, A3_ANCHOR, A3_BLOCK, 'A3');
/* gate: whole-line replacement with the 4-line membership-gate block */
text = spliceWholeLine(text, GATE_ANCHOR, GATE_BLOCK, 'gate');

/* ---------- 6. post-conditions (T1/T2/T3 机器判据 + G5 标识符声明校验） ---------- */
const post = [];
const chk = (name, ok, detail) => { post.push({ check: name, status: ok ? 'PASS' : 'FAIL', detail }); if (!ok) die(`${name} FAILED: ${detail}`); };

chk('declaration unique', countLit(text, 'const chainRowIds = new Set();') === 1, `${countLit(text, 'const chainRowIds = new Set();')} occurrence(s)`);
chk('T1 declaration at 4 Tab (method-body top level)',
  text.split('\n').filter((l) => l.includes('const chainRowIds = new Set();')).every((l) => tabCount(l) === 4),
  `indent=${text.split('\n').filter((l) => l.includes('const chainRowIds = new Set();')).map(tabCount).join(',')} Tab`);
chk('T1 declaration precedes the walk registration',
  text.indexOf('const chainRowIds = new Set();') < text.indexOf('chainRowIds.add(childId);'),
  `decl@${text.indexOf('const chainRowIds = new Set();')} < add@${text.indexOf('chainRowIds.add(childId);')}`);
chk('T1 declaration precedes the reader `chainRowIds.has(id)`',
  text.indexOf('const chainRowIds = new Set();') < text.indexOf('chainRowIds.has(id)'),
  `decl@${text.indexOf('const chainRowIds = new Set();')} < read@${text.indexOf('chainRowIds.has(id)')}`);
chk('T2 declaration sits ABOVE the `if (current !== …) {` line (not inside it, not after `const copiedPrevious`)',
  text.indexOf('const chainRowIds = new Set();') < text.indexOf('\t\t\t\tif (current !== void 0 && currentAddress !== void 0) {')
  && text.indexOf('const chainRowIds = new Set();') < text.indexOf('const copiedPrevious ='),
  'declaration index < A1 anchor index and < copiedPrevious index');
chk('T3 the old prose comment is gone (0 occurrences, no stray indent left behind)',
  countLit(text, OLD_COMMENT) === 0 && countLit(text, `${T5}${OLD_COMMENT}\n`) === 0,
  `comment=${countLit(text, OLD_COMMENT)}`);
chk('no orphan 5-Tab / 8-Tab blank line at the A3 site (T3 residual-indent artefact)',
  !/\n[ \t]+\n\t\t\t\t\}\n\t\t\t\tconst liveKeys/.test(text) && countLit(text, `\n${T5}\n`) === 0 && countLit(text, '\n\t\t\t\t\t\t\t\t\n') === 0,
  'no whitespace-only line introduced at the edit site');
chk('old blanket carry-forward is gone (0 occurrences)',
  countLit(text, A3_ANCHOR) === 0, `${countLit(text, A3_ANCHOR)} occurrence(s)`);
chk('old gate line is gone (0 occurrences)', countLit(text, GATE_ANCHOR) === 0, `${countLit(text, GATE_ANCHOR)} occurrence(s)`);
chk('new chain-scoped carry-forward present exactly once',
  countLit(text, 'byId[id] === void 0 && chainRowIds.has(id)') === 1, `${countLit(text, 'byId[id] === void 0 && chainRowIds.has(id)')} occurrence(s)`);
chk('membership gate present exactly once',
  countLit(text, 'reusableByIdKeys.every((id) => Object.prototype.hasOwnProperty.call(byId, id))') === 1,
  `${countLit(text, 'reusableByIdKeys.every((id) => Object.prototype.hasOwnProperty.call(byId, id))')} occurrence(s)`);
chk('marker count == 4 (A1 + A2 + A3 head + gate head) and no foreign marker was touched',
  countLit(text, MARKER) === 4
  && countLit(text, '/* dsh-perf-fix P2 v1 */') === countLit(original, '/* dsh-perf-fix P2 v1 */')
  && countLit(text, 'dsh-lag-fix') === countLit(original, 'dsh-lag-fix'),
  `markers=${countLit(text, MARKER)}, dsh-perf-fix P2 v1 ${countLit(original, '/* dsh-perf-fix P2 v1 */')} -> ${countLit(text, '/* dsh-perf-fix P2 v1 */')}, dsh-lag-fix ${countLit(original, 'dsh-lag-fix')} -> ${countLit(text, 'dsh-lag-fix')}`);
chk('G5 identifier `chainRowIds` is declared inside this file',
  /const chainRowIds = new Set\(\);/.test(text), 'found `const chainRowIds = new Set();`');
chk('G5 identifier `reusableByIdKeys` is declared inside this file',
  /const reusableByIdKeys = previousProjection !== void 0 \? Object\.keys\(previousProjection\.byId\) : void 0;/.test(text),
  'found `const reusableByIdKeys = …`');
chk('no space-indented insert at the four splice sites',
  [A1_BLOCK, A2_BLOCK, A3_BLOCK.split('\n')[0], GATE_BLOCK.split('\n')[0]].every((l) => !/^ /.test(l)),
  'all inserted lines start with Tab');
chk('line-count delta is exactly +5 (A1 +1, A2 +1, A3 +1 (2 new − 1 old line), comment deletion −1, gate +3) — line-number drift is the intended, accounted-for amount',
  text.split('\n').length - original.split('\n').length === 5,
  `${original.split('\n').length} -> ${text.split('\n').length} lines (Δ${text.split('\n').length - original.split('\n').length})`);

/* ---------- 7. syntax ---------- */
const printPath = PRINT_TARGET ? path.resolve(PRINT_TARGET) : (APPLY ? TARGET : null);
if (printPath) {
  fs.mkdirSync(path.dirname(printPath), { recursive: true });
  fs.writeFileSync(printPath, text);
  try {
    execFileSync(process.execPath, ['--check', printPath], { stdio: 'pipe' });
    post.push({ check: 'node --check', status: 'PASS', detail: printPath });
  } catch (err) {
    if (printPath !== TARGET) fs.unlinkSync(printPath);
    die(`node --check FAILED on ${printPath}: ${err.stderr ? err.stderr.toString() : err.message}`);
  }
}

/* ---------- 8. report ---------- */
say('\n[P2AC] post-conditions');
for (const p of post) say(`  ${p.status}: ${p.check}${p.detail ? ` — ${p.detail}` : ''}`);
say('\n[P2AC] emitted patch text (verbatim)');
say('---A1---'); say(A1_BLOCK); say('---A2---'); say(A2_BLOCK); say('---A3---'); say(A3_BLOCK); say('---GATE---'); say(GATE_BLOCK);
say(`\n[P2AC] result sha256 : ${sha256(Buffer.from(text, 'utf8'))}`);
if (DRY) {
  say('[P2AC] DRY-RUN — nothing was written (target untouched; use --apply to land it, --print-target=<path> for a candidate).');
} else if (PRINT_TARGET) {
  say(`[P2AC] candidate written: ${printPath}`);
} else {
  say(`[P2AC] APPLIED to ${TARGET}; pre-image ${path.join(PREIMAGE_ROOT, stamp)}`);
  say('[P2AC] 生效面：client 热面，浏览器刷新即生效（不需要重启 DSH、不需要 pkill）。');
  say('[P2AC] 回滚：node apply-P2AC.mjs --rollback （次序铁律 P2AC → B1/C1 → C1）。');
}
const failed = post.filter((p) => p.status === 'FAIL').length;
process.exit(failed === 0 ? 0 : 1);
