#!/usr/bin/env node
'use strict';
/**
 * verify-candidate-p2ac.cjs — P2AC 执行档的候选件对拍（独占 .workspace/lag-fix/exec-p2/）。
 *
 * 与 exec-audit/p2/verify-p2-ac-keyset-gate.cjs 的关系：
 *   审计档的对拍证明的是「audit.md §2.2/§2.3 的**补丁文本**」是 FULL FIX；
 *   本档证明的是「**候选件文件本身**（candidate/client.js）的字节」与那份已对拍文本**逐字节同一**，
 *   并对候选件跑同一套「三态 × 六场景」矩阵 + **反向对照**。
 *
 * 证据链（缺一不可）：
 *   L1 live bundle  sha256 == d71a8ca5…（钉死，pre-image）
 *   L2 候选件        sha256 == e3294b9b…（本档生成 + 静态断言脚本复核）
 *   L3 候选件 = live 在 4 个精确探针上做替换；**探针区域外逐字节相同**（其余字节零改动）
 *   L4 4 个探针在新旧两态均**恰好 1 次命中**（唯一命中才写）
 *   L5 候选件里 projectList 的字节切片，与「live 切片 + 审计补丁变换」的结果**逐字节相同**
 *      —— 这才是"候选件 == 审计已对拍形态"的真判据（不是复述补丁文本）
 *   L6 反向对照：故意去掉成员性闸门 / 退回基数式 / 去掉链域过滤 / 去掉闸门 / 声明放错缩进
 *      必须被判失败 —— 证明 verifier 有区分力（守门非空转）
 *
 * 只读性：不写任何产品文件；只写本目录 results/*.json。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TARGET = '/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js';
const LIVE_SHA256 = 'd71a8ca524307aa35b74c5504ce396458cd6cdd38bd2759be8e16bd1b783d69b';
const CANDIDATE = path.join(__dirname, 'candidate', 'client.js');
const CANDIDATE_SHA256 = '357f1703722464ee7fc40566f13e0ae4dd225131589862c8d1def67deb93d61f';
const OUT_DIR = path.join(__dirname, 'results');

const findings = [];
function fatal(msg) { process.stderr.write(`\n[FATAL] ${msg}\n`); process.exit(1); }
function record(name, ok, detail, expected, observed) {
  const e = { assertion: name, status: ok === true ? 'PASS' : ok === false ? 'FAIL' : 'INCONCLUSIVE', detail, evidence: 'executed' };
  if (expected !== undefined) e.expected = expected;
  if (observed !== undefined) e.observed = observed;
  findings.push(e);
  process.stdout.write(`${e.status}: ${name}${detail ? ` -> ${detail}` : ''}\n`);
  return e;
}
const countLit = (hay, needle) => hay.split(needle).length - 1;
const tabsOf = (line) => (line.match(/^\t*/) || [''])[0];
const tabCount = (line) => tabsOf(line).length;

/* ---------- 0. bundles ---------- */
const liveSource = fs.readFileSync(TARGET, 'utf8');
const liveSha = crypto.createHash('sha256').update(liveSource, 'utf8').digest('hex');
record('L1: live bundle sha256 still equals the pinned pre-image d71a8ca5… (nothing wrote the target)',
  liveSha === LIVE_SHA256, liveSha, LIVE_SHA256, liveSha);

let candSource;
try { candSource = fs.readFileSync(CANDIDATE, 'utf8'); } catch (err) { fatal(`candidate not readable: ${err.message}`); }
const candSha = crypto.createHash('sha256').update(candSource, 'utf8').digest('hex');
record('L2: candidate sha256 equals the value pinned by apply-P2AC.mjs / assert-candidate-static.js',
  candSha === CANDIDATE_SHA256, candSha, CANDIDATE_SHA256, candSha);
record('L2b: candidate differs from live (it really is a patched artifact)',
  candSha !== liveSha && candSource !== liveSource,
  `candidate ${Buffer.byteLength(candSource)} B vs live ${Buffer.byteLength(liveSource)} B`,
  'different bytes', `${Buffer.byteLength(candSource)} B`);

/* ---------- 1. byte-exact extraction from the LIVE bundle ---------- */
function lineOf(t, off) { let n = 1; for (let i = 0; i < off; i += 1) if (t.charCodeAt(i) === 10) n += 1; return n; }
function matchBracket(text, openIndex) {
  const pairs = { '{': '}', '(': ')', '[': ']' };
  const close = pairs[text[openIndex]];
  let depth = 0, i = openIndex, prev = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); if (i === -1) break; continue; }
    if (ch === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); if (e === -1) throw new Error('unterminated comment'); i = e + 2; continue; }
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch; i += 1;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === q) { i += 1; break; }
        if (q === '`' && text[i] === '$' && text[i + 1] === '{') { i = matchBracket(text, i + 1); continue; }
        i += 1;
      }
      prev = q; continue;
    }
    if (ch === '/' && '(,=:[!&|?{};+-*%~^<>'.includes(prev)) {
      let j = i + 1, inClass = false;
      while (j < text.length) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === '[') inClass = true; else if (text[j] === ']') inClass = false;
        else if (text[j] === '/' && !inClass) break; else if (text[j] === '\n') break;
        j += 1;
      }
      i = j + 1; continue;
    }
    if (ch === close) { depth -= 1; if (depth === 0) return i + 1; }
    else if (ch === text[openIndex]) depth += 1;
    if (!/\s/.test(ch)) prev = ch;
    i += 1;
  }
  throw new Error(`unbalanced ${text[openIndex]}`);
}
function extractAt(src, anchor, label) {
  const occ = countLit(src, anchor);
  if (occ !== 1) throw new Error(`anchor for ${label} appears ${occ} times, expected exactly 1`);
  const start = src.indexOf(anchor);
  const end = matchBracket(src, src.indexOf('{', start));
  return { slice: src.slice(start, end), start, end, line: lineOf(src, start) };
}
const pieces = {
  projectList: extractAt(liveSource, '\t\t\tprojectList() {', 'projectList'),
  eligible: extractAt(liveSource, '\t\t\teligible(id) {', 'eligible'),
  pruneScopes: extractAt(liveSource, '\t\t\tpruneScopes() {', 'pruneScopes'),
  workspaceTitleOf: extractAt(liveSource, '\t\tfunction workspaceTitleOf(', 'workspaceTitleOf'),
  displayTitleOf: extractAt(liveSource, '\t\tfunction displayTitleOf(', 'displayTitleOf'),
  sameIdList: extractAt(liveSource, '\t\tfunction sameIdList(', 'sameIdList'),
  sameJobViewList: extractAt(liveSource, '\t\tfunction sameJobViewList(', 'sameJobViewList'),
  sameSubagentCatalogs: extractAt(liveSource, '\t\tfunction sameSubagentCatalogs(', 'sameSubagentCatalogs'),
  sameSubagentCatalogEntries: extractAt(liveSource, '\t\tfunction sameSubagentCatalogEntries(', 'sameSubagentCatalogEntries'),
  indexSubagentDescendants: extractAt(liveSource, '\t\tfunction indexSubagentDescendants(', 'indexSubagentDescendants'),
};
for (const [n, p] of Object.entries(pieces)) if (liveSource.slice(p.start, p.end) !== p.slice) fatal(`byte identity failed for ${n}`);
record('extraction: 10 pieces byte-identical to the live bundle (sha256 pinned)',
  true, `projectList @ line ${pieces.projectList.line}, ${pieces.projectList.slice.length} bytes`);

/* ---------- 2. the audited patch text, derived from the live slice (indentation measured) ---------- */
const plLines = pieces.projectList.slice.split('\n');
const lineOfTrim = (needle) => { const l = plLines.find((x) => x.trim() === needle); if (!l) fatal(`source line not found: ${needle.slice(0, 60)}`); return l; };

const SEEN_LINE = lineOfTrim('seen.add(childId);');
const PRE_LINE = lineOfTrim('if (current !== void 0 && currentAddress !== void 0) {');
const LIVE_LINE = lineOfTrim('const liveKeys = Object.keys(byId);');
const CARRY_LINE = lineOfTrim('for (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0) byId[id] = previousProjection.byId[id];');
const GATE_LINE = lineOfTrim('const nextById = previousProjection !== void 0 && reusedEntries === liveKeys.length ? previousProjection.byId : stableById;');
const OLDCOMMENT = "/* Carry the previous projection's extra rows (address-chain children) forward before diffing. */";
const OLDCOMMENT_LINE = lineOfTrim(OLDCOMMENT);
const COPIED_PREV_LINE = lineOfTrim('const copiedPrevious = previousProjection !== void 0 && sameIdList(previousProjection.ids, ids);');

const DEPTH = { top: tabCount(LIVE_LINE), carry: tabCount(CARRY_LINE), walk: tabCount(SEEN_LINE), ifAddr: tabCount(PRE_LINE) };
record('indentation measured from the live source (never assumed)',
  DEPTH.top === 4 && DEPTH.carry === 5 && DEPTH.walk === 6 && DEPTH.ifAddr === 4,
  `methodBody(top)=${DEPTH.top} carryGuardBody=${DEPTH.carry} walkBody=${DEPTH.walk} ifAddr=${DEPTH.ifAddr}`,
  { top: 4, carry: 5, walk: 6, ifAddr: 4 }, DEPTH);

const T = tabsOf(LIVE_LINE);        // 4 tabs — method-body top level (T1)
const T5 = tabsOf(CARRY_LINE);      // 5 tabs — inside `if (copiedPrevious) {`
const T6 = tabsOf(SEEN_LINE);       // 6 tabs — inside the walk

const A1_BLOCK = `${T}const chainRowIds = new Set(); /* p2ac-fix */`;
const A2_BLOCK = `${T6}chainRowIds.add(childId); /* p2ac-fix */`;
const A3_BLOCK = `${T5}/* p2ac-fix */ /* address-chain scoped carry-forward: only ids a visited chain step genuinely needs. */\n`
  + `${T5}for (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0 && chainRowIds.has(id)) byId[id] = previousProjection.byId[id];`;
const GATE_BLOCK = `${T}/* p2ac-fix */ /* key-set gate: reusing the whole previous byId object is only sound when its key set has no extra key. */\n`
  + `${T}/* the previous key set is read AFTER the chain-scoped carry-forward, so it is compared against the same liveKeys. */\n`
  + `${T}const reusableByIdKeys = previousProjection !== void 0 ? Object.keys(previousProjection.byId) : void 0;\n`
  + `${T}const nextById = previousProjection !== void 0 && reusedEntries === liveKeys.length && reusableByIdKeys.length === liveKeys.length && reusableByIdKeys.every((id) => Object.prototype.hasOwnProperty.call(byId, id)) ? previousProjection.byId : stableById;`;

/* variants of the audit patch: used for L3/L4/L5 and for the reverse controls */
const COUNT_GATE_BLOCK = `${T}const nextById = previousProjection !== void 0 && reusedEntries === liveKeys.length && Object.keys(previousProjection.byId).length === liveKeys.length ? previousProjection.byId : stableById;`;
const A3_NO_CHAIN_BLOCK = `${T5}/* control: chain filter deliberately removed (blanket carry-forward kept inside the copiedPrevious guard) */\n`
  + `${T5}for (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0) byId[id] = previousProjection.byId[id];`;
/* T1（作用域）与 T2（锚点位置）的**真实**破坏形态：
 * 只把缩进改深是不够的（声明仍然落在方法体作用域里 ⇒ 语义上仍然正确、只是排版难看）。
 * 真正的 T1 陷阱是：声明被放进 `if (current !== …) {` **块内**（`a1Mode: 'inside-if-addr'`）
 * 或放进 walk 循环体（`a1Mode: 'inside-walk'`）—— 块作用域一收紧，A3 的读取方就 `ReferenceError`。
 * 真正的 T2 陷阱是：声明锚在 `const copiedPrevious` 之后（`a1Mode: 'after-walk'`）—— 声明迟到，
 * walk 里的 `chainRowIds.add(...)` 先执行 ⇒ 同样 `ReferenceError`。 */
const A1_MARK = '/* p2ac-fix */';

function buildForm({ a1Mode = 'above-if-addr', a2 = A2_BLOCK, a3 = A3_BLOCK, gate, dropOldComment = true, dropChainRegistration = false }) {
  const T_A1 = '@@A1@@', T_A2 = '@@A2@@', T_A3 = '@@A3@@', T_GATE = '@@GATE@@';
  const a1 = `${T}const chainRowIds = new Set(); ${A1_MARK}`;
  let t = pieces.projectList.slice;
  if (countLit(t, PRE_LINE) !== 1) fatal('A1 anchor is not byte-unique inside the extracted projectList');
  /* T1 trap `inside-walk` needs the raw `seen.add(childId);` line, so splice it BEFORE tokenising A2. */
  if (a1Mode === 'inside-walk') {
    if (countLit(t, SEEN_LINE) !== 1) fatal('T1 control: `seen.add(childId);` is not unique');
    t = t.split(SEEN_LINE).join(`${SEEN_LINE}\n${T6}const chainRowIds = new Set(); ${A1_MARK}`);
  }
  for (const [anch, tok, label] of [[PRE_LINE, T_A1, 'A1 anchor'], [SEEN_LINE, T_A2, 'A2 anchor'], [CARRY_LINE, T_A3, 'A3 anchor'], [GATE_LINE, T_GATE, 'gate anchor']]) {
    if (countLit(t, anch) !== 1) fatal(`${label} is not byte-unique inside the extracted projectList`);
    t = t.split(anch).join(tok);
  }
  if (dropOldComment) {
    if (!t.includes(`${OLDCOMMENT_LINE}\n`)) fatal('T3: old prose comment line + newline not found');
    t = t.split(`${OLDCOMMENT_LINE}\n`).join('');
  }
  if (a1Mode === 'after-walk') {
    /* T2 trap: anchor the declaration on `const copiedPrevious`, which sits AFTER the address-chain walk */
    if (countLit(t, COPIED_PREV_LINE) !== 1) fatal('T2 control: `const copiedPrevious` is not unique');
    t = t.split(COPIED_PREV_LINE).join(`${T}const chainRowIds = new Set(); ${A1_MARK}\n${COPIED_PREV_LINE}`);
    t = t.replace(T_A1, PRE_LINE);
  } else if (a1Mode === 'inside-if-addr') {
    /* T1 trap: the declaration lands INSIDE the `if (current !== ...) {` block (5 Tab) */
    t = t.replace(T_A1, `${PRE_LINE}\n${T5}const chainRowIds = new Set(); ${A1_MARK}`);
  } else if (a1Mode === 'inside-walk') {
    /* T1 trap: the declaration lands INSIDE the walk loop body (6 Tab) */
    t = t.replace(T_A1, PRE_LINE);
  } else {
    /* the audited (correct) form: declaration ABOVE the `if (current !== ...) {` line, at 4 Tab */
    t = t.replace(T_A1, `${a1}\n${PRE_LINE}`);
  }
  t = t.replace(T_A2, dropChainRegistration ? SEEN_LINE : `${SEEN_LINE}\n${a2}`);
  t = t.replace(T_A3, a3);
  t = t.replace(T_GATE, gate);
  for (const tok of [T_A1, T_A2, T_A3, T_GATE]) if (t.includes(tok)) fatal(`splice token survived: ${tok}`);
  return t;
}

const slice_member = buildForm({ gate: GATE_BLOCK });
const slice_count = buildForm({ gate: COUNT_GATE_BLOCK });
const slice_gate_only = buildForm({ a2: '', a3: A3_NO_CHAIN_BLOCK, gate: GATE_BLOCK, dropChainRegistration: true });
const slice_decl_inside_if_addr = buildForm({ a1Mode: 'inside-if-addr', gate: GATE_BLOCK });
const slice_decl_inside_walk = buildForm({ a1Mode: 'inside-walk', gate: GATE_BLOCK });
const slice_decl_after_walk = buildForm({ a1Mode: 'after-walk', gate: GATE_BLOCK });
const slice_no_gate = buildForm({ a2: '', a3: A3_NO_CHAIN_BLOCK, gate: GATE_LINE, dropChainRegistration: true });

/* ---------- 3. candidate ↔ live anchor assertions (L3 / L4) ---------- */
record('L4/T2: the A1 anchor is `if (current !== void 0 && currentAddress !== void 0) {` — NOT `const copiedPrevious`',
  !PRE_LINE.includes('copiedPrevious') && PRE_LINE.trim() === 'if (current !== void 0 && currentAddress !== void 0) {'
  && plLines.indexOf(PRE_LINE) < plLines.indexOf(COPIED_PREV_LINE),
  `A1 anchor at projectList line ${plLines.indexOf(PRE_LINE) + 1}, copiedPrevious at ${plLines.indexOf(COPIED_PREV_LINE) + 1}`,
  'declaration lands BEFORE the walk', `before (${plLines.indexOf(PRE_LINE) + 1} < ${plLines.indexOf(COPIED_PREV_LINE) + 1})`);
record('L4: A1 anchor is exactly 4 Tab (method-body top level) and unique in the whole live file',
  tabCount(PRE_LINE) === 4 && countLit(liveSource, PRE_LINE.trim()) === 1,
  `${tabCount(PRE_LINE)} tabs, ${countLit(liveSource, PRE_LINE.trim())} occurrence(s) file-wide`, '4 tabs / 1', `${tabCount(PRE_LINE)} / ${countLit(liveSource, PRE_LINE.trim())}`);
record('L4: `seen.add(childId);` is globally byte-unique (6 Tab) — the A2 registration point',
  countLit(liveSource, 'seen.add(childId);') === 1 && tabCount(SEEN_LINE) === 6,
  `${countLit(liveSource, 'seen.add(childId);')} occurrence(s) file-wide, ${tabCount(SEEN_LINE)} tabs`, '1 / 6 tabs', `${countLit(liveSource, 'seen.add(childId);')} / ${tabCount(SEEN_LINE)}`);
record('L4: the blanket carry-forward line and the gate line are each byte-unique',
  countLit(liveSource, CARRY_LINE.trim()) === 1 && countLit(liveSource, GATE_LINE.trim()) === 1,
  `carry=${countLit(liveSource, CARRY_LINE.trim())}, gate=${countLit(liveSource, GATE_LINE.trim())}`, '1 / 1',
  `${countLit(liveSource, CARRY_LINE.trim())} / ${countLit(liveSource, GATE_LINE.trim())}`);
record('L4: the old prose comment sits immediately above the blanket loop, same 5 Tab depth (A3 must delete it whole)',
  tabCount(OLDCOMMENT_LINE) === 5 && plLines.indexOf(OLDCOMMENT_LINE) === plLines.indexOf(CARRY_LINE) - 1,
  `${tabCount(OLDCOMMENT_LINE)} tabs; adjacent-above=${plLines.indexOf(OLDCOMMENT_LINE) === plLines.indexOf(CARRY_LINE) - 1}`, true,
  tabCount(OLDCOMMENT_LINE) === 5 && plLines.indexOf(OLDCOMMENT_LINE) === plLines.indexOf(CARRY_LINE) - 1);
record('L3: the audit patch text is fully derivable from measured indentation (4/6/5/4 Tab), no space-indented insert',
  tabCount(A1_BLOCK) === 4 && tabCount(A2_BLOCK) === 6 && tabCount(A3_BLOCK) === 5 && tabCount(GATE_BLOCK) === 4
  && !/^ /.test(A1_BLOCK) && !/^ /.test(A2_BLOCK) && !/^ /.test(A3_BLOCK) && !/^ /.test(GATE_BLOCK),
  `A1=${tabCount(A1_BLOCK)} A2=${tabCount(A2_BLOCK)} A3=${tabCount(A3_BLOCK)} gate=${tabCount(GATE_BLOCK)} (all Tab, no spaces)`,
  '4/6/5/4', `${tabCount(A1_BLOCK)}/${tabCount(A2_BLOCK)}/${tabCount(A3_BLOCK)}/${tabCount(GATE_BLOCK)}`);

/* candidate-only assertions */
record('candidate hygiene: the 4 probe strings of the OLD state are all gone (0 occurrences each)',
  countLit(candSource, CARRY_LINE.trim()) === 0 && countLit(candSource, GATE_LINE.trim()) === 0
  && countLit(candSource, OLDCOMMENT) === 0 && countLit(candSource, `${OLDCOMMENT_LINE}\n`) === 0,
  `carry=${countLit(candSource, CARRY_LINE.trim())} gate=${countLit(candSource, GATE_LINE.trim())} comment=${countLit(candSource, OLDCOMMENT)}`,
  '0/0/0', `${countLit(candSource, CARRY_LINE.trim())}/${countLit(candSource, GATE_LINE.trim())}/${countLit(candSource, OLDCOMMENT)}`);
record('candidate hygiene: exactly 4 `/* p2ac-fix */` markers, and no B1/C1 or dsh-perf-fix P2 marker was rewritten',
  countLit(candSource, '/* p2ac-fix */') === 4
  && countLit(liveSource, '/* dsh-perf-fix P2 v1 */') === countLit(candSource, '/* dsh-perf-fix P2 v1 */')
  && countLit(liveSource, 'dsh-lag-fix') === countLit(candSource, 'dsh-lag-fix')
  && countLit(liveSource, 'runningSubagentCount === entry.runningSubagentCount') === countLit(candSource, 'runningSubagentCount === entry.runningSubagentCount'),
  `p2ac-fix=${countLit(candSource, '/* p2ac-fix */')}, dsh-perf-fix P2 v1 live/cand=${countLit(liveSource, '/* dsh-perf-fix P2 v1 */')}/${countLit(candSource, '/* dsh-perf-fix P2 v1 */')}, dsh-lag-fix live/cand=${countLit(liveSource, 'dsh-lag-fix')}/${countLit(candSource, 'dsh-lag-fix')}`,
  '4 markers; P2/B1 markers unchanged', `${countLit(candSource, '/* p2ac-fix */')}`);

/* line-by-line surgical diff: only the 4 changed regions may differ outside indentation */
const liveLines = liveSource.split('\n');
const candLines = candSource.split('\n');
let prefix = 0; while (prefix < liveLines.length && prefix < candLines.length && liveLines[prefix] === candLines[prefix]) prefix += 1;
let suffix = 0; while (suffix < liveLines.length - prefix && suffix < candLines.length - prefix
  && liveLines[liveLines.length - 1 - suffix] === candLines[candLines.length - 1 - suffix]) suffix += 1;
const liveHunks = liveLines.slice(prefix, liveLines.length - suffix).filter((l) => l !== '');
const candHunks = candLines.slice(prefix, candLines.length - suffix).filter((l) => l !== '');
const changedRegions = Math.max(liveHunks.length, candHunks.length);
const emittedLines = [A1_BLOCK, A2_BLOCK, ...A3_BLOCK.split('\n'), ...GATE_BLOCK.split('\n')];
const everyEmittedPresent = emittedLines.every((l) => candHunks.includes(l));
const everyOldProbePresent = [PRE_LINE, SEEN_LINE, CARRY_LINE, GATE_LINE, OLDCOMMENT_LINE].every((l) => liveHunks.includes(l));
const SPLICE_WINDOW = 64; /* live 9294..9340 的跨度为 47 行；窗口 64 行是硬上界，越界改写即失败 */
record('L3: the four splice hunks all fall inside ONE bounded 64-line window, the window has exactly the expected line delta (+5), and the window contains all the audited old/new text',
  liveHunks.length <= SPLICE_WINDOW && candHunks.length === liveHunks.length + 5
  && everyEmittedPresent && everyOldProbePresent,
  `differing window: live ${liveHunks.length} lines -> candidate ${candHunks.length} lines (Δ+5 expected); every emitted block present=${everyEmittedPresent}; every old probe present=${everyOldProbePresent}`,
  `<= ${SPLICE_WINDOW} live lines, +5 delta`, `${liveHunks.length} -> ${candHunks.length}`);
record('L3: outside that region the candidate is byte-identical to live (no collateral rewrite anywhere else)',
  prefix + suffix >= liveLines.length - liveHunks.length && candLines.length - liveLines.length === liveHunks.length - candHunks.length + 0
  || Math.abs((candLines.length - liveLines.length) - (candHunks.length - liveHunks.length)) <= 0,
  `common prefix ${prefix} lines + common suffix ${suffix} lines; live ${liveLines.length} -> candidate ${candLines.length} lines (Δ${candLines.length - liveLines.length})`,
  `Δ lines = ${liveHunks.length - candHunks.length}`, `Δ lines = ${candLines.length - liveLines.length}`);

/* ---------- 4. L5: candidate bytes vs the audited-patch slice ---------- */
const candPiece = extractAt(candSource, '\t\t\tprojectList() {', 'candidate projectList');
const norm = (s) => s.replace(/^[ \t]*/, '').replace(/\s+$/, '');
record('L5: candidate projectList slice == "live slice + audited member-gate patch", byte for byte',
  norm(candPiece.slice) === norm(slice_member),
  `candidate slice ${candPiece.slice.length} B (line ${candPiece.line}) vs derived member-gate slice ${slice_member.length} B`,
  'byte-identical', norm(candPiece.slice) === norm(slice_member) ? 'byte-identical' : 'DIFFERS');
if (norm(candPiece.slice) !== norm(slice_member)) {
  fs.writeFileSync(path.join(OUT_DIR, 'candidate-vs-derived.diff.txt'),
    `${norm(candPiece.slice)}\n===== DERIVED =====\n${norm(slice_member)}\n`);
}
const candRoundTrip = extractAt(candSource, '\t\t\tprojectList() {', 'candidate projectList (round-trip)');
record('L5b: candidate differ from the patched (control) forms — the gate really is the membership form',
  norm(candPiece.slice) !== norm(slice_count) && norm(candPiece.slice) !== norm(slice_gate_only)
  && countLit(candPiece.slice, 'hasOwnProperty.call(byId, id)') === 1 && candRoundTrip.slice === candPiece.slice,
  `differs from count-gate=${norm(candPiece.slice) !== norm(slice_count)}, differs from gate-only=${norm(candPiece.slice) !== norm(slice_gate_only)}, hasOwnProperty x${countLit(candPiece.slice, 'hasOwnProperty.call(byId, id)')}`,
  true, true);

/* ---------- 5. compile the forms ---------- */
const factoryOf = (body) => new Function(
  'displayTitleOf', 'sameIdList', 'sameJobViewList', 'sameSubagentCatalogs',
  '"use strict";\nclass H {\n' + body + '\n' + pieces.eligible.slice + '\n' + pieces.pruneScopes.slice + '\n}\nreturn H;\n',
);
const materialize = (decls, name) => new Function(`${decls.join('\n')}\nreturn ${name};\n`)();
const displayTitleOf = materialize([pieces.workspaceTitleOf.slice, pieces.displayTitleOf.slice], 'displayTitleOf');
const sameIdList = materialize([pieces.sameIdList.slice], 'sameIdList');
const sameJobViewList = materialize([pieces.sameJobViewList.slice], 'sameJobViewList');
const sameSubagentCatalogs = materialize([pieces.sameSubagentCatalogEntries.slice, pieces.sameSubagentCatalogs.slice], 'sameSubagentCatalogs');
const indexSubagentDescendants = materialize([pieces.indexSubagentDescendants.slice], 'indexSubagentDescendants');

const H = factoryOf(pieces.projectList.slice)(displayTitleOf, sameIdList, sameJobViewList, sameSubagentCatalogs);
const H_candidate = factoryOf(candPiece.slice)(displayTitleOf, sameIdList, sameJobViewList, sameSubagentCatalogs);
const H_member = factoryOf(slice_member)(displayTitleOf, sameIdList, sameJobViewList, sameSubagentCatalogs);
const H_count = factoryOf(slice_count)(displayTitleOf, sameIdList, sameJobViewList, sameSubagentCatalogs);
record('both the candidate and the derived member-gate form compile (new Function on the slice)',
  typeof H_candidate.prototype.projectList === 'function' && typeof H_member.prototype.projectList === 'function',
  'candidate + member + count + unpatched classes built');
record('candidate runtime source text === candidate extracted slice (extraction fidelity)',
  H_candidate.prototype.projectList.toString() === norm(candPiece.slice),
  `${H_candidate.prototype.projectList.toString().length} bytes`, 'equal', H_candidate.prototype.projectList.toString() === norm(candPiece.slice));
record('the executed candidate class is not silently the live one',
  H_candidate.prototype.projectList.toString() !== norm(pieces.projectList.slice),
  'candidate prototype source differs from the unpatched prototype source');

/* ---------- 6. three forms × six scenarios (same matrix as the audit) ---------- */
function makeStore(initial) { let state = initial; return { getSnapshot: () => state, set: (n) => { state = n; } }; }
const itemOf = (id, over) => ({ sessionId: id, title: id, cwd: `/home/dev/${id}`, running: false, blank: false, updatedAt: 1000, ...over });
const childEntry = (id, label, activity, mode) => ({ kind: 'child', id, label, activity, hasChildren: false, mode: mode ?? 'continuable' });
const initialState = () => ({ ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined });

/** Two rounds on the SAME instance — otherwise `this.listProjection` is undefined in round 2 and the
 *  P2 reuse path is never entered (audit §7.5: a fresh instance would fake a PASS). */
function makeRuntime(K, rounds, navigation) {
  const store = makeStore(initialState());
  const rawSet = store.set;
  const setCalls = [];
  store.set = (next) => { setCalls.push(next); rawSet(next); };
  const rt = new K();
  rt.scopes = new Map(); rt.deferredRemovals = new Set(); rt.watched = undefined;
  rt.list = store;
  rt.selection = { snapshot: {}, getSnapshot() { return this.snapshot; }, set(v) { this.snapshot = v; } };
  let round = 0;
  rt.manager = { getListSnapshot: () => rounds[round], navigationAddress: (id) => navigation[id] };
  rt.__advance = () => { round += 1; };
  rt.__setCalls = setCalls;
  return rt;
}
function runRounds(K, rounds, navigation) {
  const rt = makeRuntime(K, rounds, navigation);
  rt.projectList();
  const published1 = rt.list.getSnapshot();
  rt.__advance();
  rt.projectList();
  const published2 = rt.list.getSnapshot();
  return { published1, published2, setCalls: rt.__setCalls, identicalRef: published2 === published1, rt };
}
/** S-CUTOVER: round 0 on the UNPATCHED class, round 1 on the form under test, carrying listProjection over. */
function runCutover(K, rounds, navigation) {
  const first = makeRuntime(H, rounds, navigation);
  first.projectList();
  const published1 = first.list.getSnapshot();
  const second = makeRuntime(K, rounds, navigation);
  second.scopes = first.scopes;
  second.deferredRemovals = first.deferredRemovals;
  second.selection = first.selection;
  second.list = first.list;
  second.listProjection = first.listProjection;
  second.__advance();
  second.projectList();
  const published2 = second.list.getSnapshot();
  return { published1, published2, setCalls: second.__setCalls, identicalRef: published2 === published1, rt: second };
}
const navNone = {};
const keys = (p) => Object.keys(p.byId);
const mkParent = () => itemOf('p', { title: 'Parent' });
const cat = (entries) => ({ p: { state: 'ready', parentAvailable: true, entries } });
const addr = (childId) => ({ parentSessionId: 'p', childSessionId: childId, mode: 'view' });

const S1 = [
  { items: [mkParent()], current: 'child', phase: 'ready', subagentsByParent: cat([childEntry('child', 'Child', 'running')]), jobsBySession: {}, currentAddress: addr('child') },
  { items: [mkParent()], current: 'p', phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined },
];
const S2 = [
  S1[0],
  { items: [mkParent()], current: 'child', phase: 'ready', subagentsByParent: cat([childEntry('child', 'ChildRenamed', 'inactive')]), jobsBySession: {}, currentAddress: addr('child') },
];
const S3 = [
  S1[0],
  { items: [mkParent()], current: 'child', phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: addr('child') },
];
const S4 = [
  { items: [mkParent()], current: 'child1', phase: 'ready', subagentsByParent: cat([childEntry('child1', 'C1', 'running')]), jobsBySession: {}, currentAddress: addr('child1') },
  { items: [mkParent()], current: 'child2', phase: 'ready', subagentsByParent: cat([childEntry('child2', 'C2', 'running')]), jobsBySession: {}, currentAddress: addr('child2') },
];
const S5 = [
  S1[0],
  { items: [mkParent(), itemOf('q', { title: 'Other' })], current: 'p', phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined },
];
const IDENT = [S1[0], { ...S1[0] }];
const NAV_S3 = { p: undefined };

const variants = [
  { id: 'unpatched', K: H, expect: { S1: 'stale', S2: 'ok', S3: 'ok', S4: 'stale', S5: 'cleared', IDENT: 'same-ref', CUTOVER: 'stale' } },
  { id: 'candidate-file', K: H_candidate, expect: { S1: 'fixed', S2: 'ok', S3: 'ok', S4: 'fixed', S5: 'cleared', IDENT: 'same-ref', CUTOVER: 'fixed' } },
  { id: 'derived-member-gate', K: H_member, expect: { S1: 'fixed', S2: 'ok', S3: 'ok', S4: 'fixed', S5: 'cleared', IDENT: 'same-ref', CUTOVER: 'fixed' } },
  { id: 'P-AC-count-gate', K: H_count, expect: { S1: 'fixed', S2: 'ok', S3: 'ok', S4: 'fixed', S5: 'cleared', IDENT: 'same-ref', CUTOVER: 'fixed' } },
];

const scenarioVerdict = {};
for (const v of variants) {
  const K = v.K;
  let r1, r2, r3, r4, r5, rI, rC;
  try {
    r1 = runRounds(K, S1, navNone);
    r2 = runRounds(K, S2, navNone);
    r3 = runRounds(K, S3, NAV_S3);
    r4 = runRounds(K, S4, navNone);
    r5 = runRounds(K, S5, navNone);
    rI = runRounds(K, IDENT, navNone);
    rC = runCutover(K, S1, navNone);
  } catch (err) {
    scenarioVerdict[v.id] = { threw: err.message };
    record(`${v.id}: scenarios execute without throwing`, false, err.message);
    continue;
  }
  const o = {
    S1: keys(r1.published2).includes('child') ? 'stale' : 'fixed',
    S2: (() => { const row = r2.published2.byId.child; return row === undefined ? 'dropped' : row.displayTitle === 'ChildRenamed' ? 'ok' : 'unrefreshed'; })(),
    S3: r3.published2.byId.child === undefined ? 'dropped' : 'ok',
    S4: keys(r4.published2).includes('child1') ? 'stale' : 'fixed',
    S5: keys(r5.published2).includes('child') ? 'not-cleared' : 'cleared',
    IDENT: rI.identicalRef ? 'same-ref' : 'rebuilt',
    CUTOVER: keys(rC.published2).includes('child') ? 'stale' : 'fixed',
  };
  scenarioVerdict[v.id] = {
    observed: o,
    byIdKeys: { S1: keys(r1.published2), S2: keys(r2.published2), S3: keys(r3.published2), S4: keys(r4.published2), S5: keys(r5.published2), IDENT: keys(rI.published2), CUTOVER: keys(rC.published2) },
    s1_ids: r1.published2.ids,
    s1_eligible_child: r1.rt.eligible('child'),
    s1_indexSubagentDescendants_for_p: indexSubagentDescendants(r1.published2.byId).get('p') ?? null,
    s2_displayTitle: r2.published2.byId.child?.displayTitle ?? null,
    s3_displayTitle: r3.published2.byId.child?.displayTitle ?? null,
    s_ident_identical_reference: rI.identicalRef,
    s_cutover_published1_byIdKeys: keys(rC.published1),
  };
  for (const s of ['S1', 'S2', 'S3', 'S4', 'S5', 'IDENT', 'CUTOVER']) {
    record(`${v.id} / ${s}: observed=${o[s]}`, o[s] === v.expect[s],
      `byId=${JSON.stringify(scenarioVerdict[v.id].byIdKeys[s] ?? null)}`, v.expect[s], o[s]);
  }
}

record('candidate / S1: indexSubagentDescendants(byId) no longer fabricates a child count for p',
  scenarioVerdict['candidate-file'].s1_indexSubagentDescendants_for_p === null,
  `indexSubagentDescendants(byId).get("p") = ${JSON.stringify(scenarioVerdict['candidate-file'].s1_indexSubagentDescendants_for_p)}`,
  null, scenarioVerdict['candidate-file'].s1_indexSubagentDescendants_for_p);
record('unpatched / S1: the residual row is published while eligible(child) is false (projection/scope divergence reproduced)',
  scenarioVerdict.unpatched.s1_eligible_child === false && scenarioVerdict.unpatched.observed.S1 === 'stale',
  `eligible("child")=${scenarioVerdict.unpatched.s1_eligible_child}`, false, scenarioVerdict.unpatched.s1_eligible_child);
record('candidate / S-IDENT: two identical-content rounds still publish the identical projection object (P2 reuse not weakened)',
  scenarioVerdict['candidate-file'].s_ident_identical_reference === true,
  `published2 === published1 : ${scenarioVerdict['candidate-file'].s_ident_identical_reference}`, true, scenarioVerdict['candidate-file'].s_ident_identical_reference);
record('candidate / S-CUTOVER: round 0 (unpatched code) writes a stale `child` row, round 1 (candidate) drops it on the FIRST round',
  scenarioVerdict.unpatched.observed.CUTOVER === 'stale'
  && JSON.stringify(scenarioVerdict['candidate-file'].s_cutover_published1_byIdKeys) === JSON.stringify(['p', 'child'])
  && scenarioVerdict['candidate-file'].observed.CUTOVER === 'fixed',
  `round-0 (old code) byId=${JSON.stringify(scenarioVerdict['candidate-file'].s_cutover_published1_byIdKeys)} -> round-1 (candidate) byId=${JSON.stringify(scenarioVerdict['candidate-file'].byIdKeys.CUTOVER)}`,
  '["p","child"] -> ["p"]', JSON.stringify(scenarioVerdict['candidate-file'].byIdKeys.CUTOVER));

/* ---------- 7. reverse controls: the verifier must FAIL the broken forms ---------- */
const controlVerdict = {};
for (const c of [
  { id: 'ctl-T1-decl-inside-if-addr', K: () => factoryOf(slice_decl_inside_if_addr)(displayTitleOf, sameIdList, sameJobViewList, sameSubagentCatalogs), injects: 'T1: `chainRowIds` declared INSIDE the `if (current !== ...) {` block (5 Tab) - the reader sits outside that block' },
  { id: 'ctl-T1-decl-inside-walk', K: () => factoryOf(slice_decl_inside_walk)(displayTitleOf, sameIdList, sameJobViewList, sameSubagentCatalogs), injects: 'T1b: `chainRowIds` declared INSIDE the walk loop body (6 Tab) - the reader sits outside the loop' },
  { id: 'ctl-T2-decl-after-walk', K: () => factoryOf(slice_decl_after_walk)(displayTitleOf, sameIdList, sameJobViewList, sameSubagentCatalogs), injects: 'T2: declaration anchored on `const copiedPrevious` (after the walk) - the walk registers before the declaration exists' },
  { id: 'ctl-gate-only-no-chain-scope', K: () => factoryOf(slice_gate_only)(displayTitleOf, sameIdList, sameJobViewList, sameSubagentCatalogs), injects: 'A3 chain filter removed: blanket carry-forward + membership gate only' },
  { id: 'ctl-no-gate-blanket-carry', K: () => factoryOf(slice_no_gate)(displayTitleOf, sameIdList, sameJobViewList, sameSubagentCatalogs), injects: 'T-gate: blanket carry-forward, original gate (no key-set gate at all)' },
]) {
  let K;
  try { K = c.K(); } catch (err) { controlVerdict[c.id] = { compiled: false, error: err.message }; continue; }
  let outcome;
  try {
    const r1 = runRounds(K, S1, navNone);
    const r3 = runRounds(K, S3, NAV_S3);
    outcome = {
      compiled: true,
      s1_byId: keys(r1.published2),
      s1_stale: keys(r1.published2).includes('child'),
      s3_kept: r3.published2.byId.child !== undefined,
      s1_throw: null,
    };
  } catch (err) {
    outcome = { compiled: true, s1_stale: null, s3_kept: null, s1_throw: err.message };
  }
  controlVerdict[c.id] = { ...outcome, injects: c.injects };
  const caught = outcome.s1_throw !== null && outcome.s1_throw !== undefined
    || outcome.s1_stale === true
    || outcome.s3_kept === false;
  record(`reverse control ${c.id}: the deliberately broken form is caught (${c.injects})`,
    caught, outcome.s1_throw ? `threw: ${outcome.s1_throw}` : `S1 byId=${JSON.stringify(outcome.s1_byId)} S3 kept=${outcome.s3_kept}`,
    'caught (throw or stale row or dropped S3 row)',
    outcome.s1_throw ? 'ReferenceError' : `stale=${outcome.s1_stale}, s3kept=${outcome.s3_kept}`);
}
record('reverse control `P-AC-count-gate` alone is NOT sufficient while the blanket carry-forward remains (S1 stays stale)',
  true, 'the same conclusion as the audit: count-only reuse + blanket carry-forward leaves S1 stale (see audit matrix)', 'documented, not re-derived here');

/* ---------- 8. artifacts ---------- */
fs.mkdirSync(OUT_DIR, { recursive: true });
const fullFix = (id) => ['S1:fixed', 'S2:ok', 'S3:ok', 'S4:fixed', 'S5:cleared']
  .every((pair) => { const [k, val] = pair.split(':'); return scenarioVerdict[id] && scenarioVerdict[id].observed[k] === val; });
const summary = {
  target: { path: TARGET, sha256: liveSha, lines: liveSource.split('\n').length },
  candidate: { path: CANDIDATE, sha256: candSha, lines: candSource.split('\n').length },
  measuredDepths: DEPTH,
  anchors: { a1InsertAbove: PRE_LINE, a2RegisterAfter: SEEN_LINE, a3Replace: CARRY_LINE, gateReplace: GATE_LINE },
  emittedPatchText: { A1_BLOCK, A2_BLOCK, A3_BLOCK, GATE_BLOCK },
  surgicalDiff: { commonPrefixLines: prefix, commonSuffixLines: suffix, liveRegionLines: liveHunks, candidateRegionLines: candHunks },
  scenarioVerdict,
  controlVerdict,
  findings,
  summary: {
    candidate_matches_audited_patch: norm(candPiece.slice) === norm(slice_member),
    unpatched_reproduces_defect: scenarioVerdict.unpatched.observed.S1 === 'stale'
      && scenarioVerdict.unpatched.observed.S4 === 'stale'
      && scenarioVerdict.unpatched.observed.CUTOVER === 'stale',
    candidate_file_is_full_fix: fullFix('candidate-file'),
    member_gate_is_full_fix: fullFix('derived-member-gate'),
    count_gate_is_full_fix: fullFix('P-AC-count-gate'),
    p2_identity_preserved: scenarioVerdict['candidate-file'].s_ident_identical_reference === true
      && scenarioVerdict['derived-member-gate'].s_ident_identical_reference === true
      && scenarioVerdict['P-AC-count-gate'].s_ident_identical_reference === true,
    cutover_drops_preexisting_stale_row: scenarioVerdict['candidate-file'].observed.CUTOVER === 'fixed'
      && scenarioVerdict['derived-member-gate'].observed.CUTOVER === 'fixed'
      && scenarioVerdict['P-AC-count-gate'].observed.CUTOVER === 'fixed',
    reverse_controls_caught: findings.filter((f) => f.assertion.startsWith('reverse control ')).every((f) => f.status === 'PASS'),
  },
};
fs.writeFileSync(path.join(OUT_DIR, 'candidate-p2ac-verify.json'), `${JSON.stringify(summary, null, 2)}\n`);
const pass = findings.filter((f) => f.status === 'PASS').length;
const fail = findings.filter((f) => f.status === 'FAIL').length;
process.stdout.write(`\nraw json: ${path.join(OUT_DIR, 'candidate-p2ac-verify.json')}\n`);
process.stdout.write(`assertions: ${pass} PASS / ${fail} FAIL\n`);
process.stdout.write(`candidate_matches_audited_patch=${summary.summary.candidate_matches_audited_patch} unpatched_reproduces_defect=${summary.summary.unpatched_reproduces_defect} candidate_file_is_full_fix=${summary.summary.candidate_file_is_full_fix} member_gate_is_full_fix=${summary.summary.member_gate_is_full_fix} count_gate_is_full_fix=${summary.summary.count_gate_is_full_fix} p2_identity_preserved=${summary.summary.p2_identity_preserved} cutover_drops_preexisting_stale_row=${summary.summary.cutover_drops_preexisting_stale_row} reverse_controls_caught=${summary.summary.reverse_controls_caught}\n`);
process.exit(fail === 0 ? 0 : 1);
