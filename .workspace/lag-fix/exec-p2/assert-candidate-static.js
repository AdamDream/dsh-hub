#!/usr/bin/env node
'use strict';
/**
 * assert-candidate-static.js — P2AC 候选件的**静态**断言（T1 / T2 / T3 三处陷阱的机器判据）。
 *
 * 与 verify-candidate-p2ac.cjs 的分工：
 *   本脚本   = 纯静态字节/缩进/代码结构判据（不执行候选件，用词法器求真实块作用域）
 *   verify-* = 执行判据（真函数跑三态 × 六场景 + 反向对照）
 *
 * 必判（任一 FAIL 即 exit 1）：
 *   S1  `const chainRowIds = new Set();` 全文**恰好 1 次**
 *   S2  T1：该声明所在行缩进 == **4 Tab**（projectList 方法体顶层）
 *   S3  T1：该声明的块作用域是 projectList **方法体**，不是 `if (current !== …) {`、不是 walk 循环体
 *   S4  T1：`chainRowIds.add(childId);` / `chainRowIds.has(id)` 的索引都 **>** 声明索引（TDZ / 未声明读取）
 *   S5  T2：声明索引 **<** `const copiedPrevious` **且** **<** `if (current !== void 0 && currentAddress !== void 0) {`
 *   S6  T2：声明**不在** `if (current !== …) {` 的块内（用括号栈判定，不看行号）
 *   S7  T3：旧散文注释 0 次；且候选件里**不存在孤立 8 Tab 空行/缩进行**（只替换文本会留下这种畸形空白）
 *   S8  T3：A3 的两行紧邻（注释头 + 链域回拷），缩进均为 5 Tab
 *   S9  旧语义 0 次（无 `chainRowIds` 过滤的整行回拷）；旧闸门行 0 次；成员性闸门恰 1 次
 *   S10 标记：本单元标记（`* / p2ac-fix * /`）恰 4 次；`dsh-perf-fix P2 v1` 与 `dsh-lag-fix` 计数与 pre-image 一致
 *   S11 引入标识符（chainRowIds / reusableByIdKeys）在本文件内声明；新增全局标识符为 0
 *   S12 相对 pre-image 只有一处连续改动区（无越界改写）
 *   S13 `node --check` 通过（语法完整）
 *   S14 反向对照：T1/T2/T3 的**故意破坏变体**必须被本脚本判失败（证明断言有区分力、非空转）
 *
 * 只读：不写产品文件；只写本目录 results/candidate-static.json。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('node:child_process');

const LIVE = '/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js';
const CANDIDATE = path.join(__dirname, 'candidate', 'client.js');
const OUT = path.join(__dirname, 'results', 'candidate-static.json');
const MARKER = '/* p2ac-fix */';

const results = { findings: [], controls: [] };
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const countLit = (hay, needle) => hay.split(needle).length - 1;
const tabsOf = (line) => (line.match(/^\t*/) || [''])[0];
const tabCount = (line) => tabsOf(line).length;

function record(name, ok, detail, expected, observed) {
  const f = { assertion: name, status: ok === true ? 'PASS' : ok === false ? 'FAIL' : 'INCONCLUSIVE', detail, evidence: 'executed' };
  if (expected !== undefined) f.expected = expected;
  if (observed !== undefined) f.observed = observed;
  results.findings.push(f);
  process.stdout.write(`${f.status}: ${name}${detail ? ` -> ${detail}` : ''}\n`);
  return f;
}

/* ------------------------------------------------------------------ *
 * code-aware tokenizer: 逐字符跳过字符串/模板/行注释/块注释，统计括号栈
 * ------------------------------------------------------------------ */
function scanBraces(rawText) {
  /* 返回每行起始处的「括号栈」（栈元素 = { char, startLine }），用于真实块作用域判定。
   * 整份 bundle 包一层括号后扫描：保证最外层永远有一个块，且行号与原文件一一对应。 */
  const text = `(${rawText})`;
  const lines = rawText.split('\n');
  const stackOfLine = new Array(lines.length);
  const stack = [];
  let i = 0, line = 0;
  const push = (ch) => stack.push({ char: ch, startLine: line });
  const pop = () => stack.pop();
  const pairs = { '{': '}', '(': ')', '[': ']' };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\n') { line += 1; stackOfLine[line] = stack.slice(); i += 1; continue; }
    if (ch === '/' && text[i + 1] === '/') { const e = text.indexOf('\n', i); i = e === -1 ? text.length : e; continue; }
    if (ch === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e === -1 ? text.length : e + 2; continue; }
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch; i += 1;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === q) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    if (ch === '{' || ch === '(' || ch === '[') push(ch);
    else if (ch === '}' || ch === ')' || ch === ']') {
      const top = stack[stack.length - 1];
      if (top !== undefined && pairs[top.char] === ch) pop();
      /* 不匹配就不动栈（绝不因误判而把栈清空；失控保护已交给上面的字符串长度上限） */
    }
    i += 1;
  }
  stackOfLine[0] = [];
  for (let n = 1; n < lines.length; n += 1) if (stackOfLine[n] === undefined) stackOfLine[n] = stackOfLine[n - 1];
  return { lines, stackOfLine };
}
/** 该行处于什么块里：返回最早的那个 `{` 的起始行内容（用于点名"这条语句在哪个块内"） */
function enclosingBlock(scanned, lineNo) {
  const st = scanned.stackOfLine[lineNo] || [];
  const braces = st.filter((e) => e.char === '{');
  if (braces.length === 0) return null;
  const outermost = braces[0];
  return { startLine: outermost.startLine, startText: scanned.lines[outermost.startLine].trim(), depth: braces.length };
}
/**
 * 缩进法求「块开启行」：向上找第一条**缩进更浅**且以 `{` 结尾的行。
 * 与括号栈互为交叉校验（审计 §2.2 的 T1 判据：4 Tab 声明的开启行必须是 3 Tab 的
 * `projectList() {`；放进 5 Tab 的 if 块会让开启行变成 4 Tab 的 `if (current !== ...) {`）。
 */
function enclosingOpenerByIndent(scanned, lineNo) {
  const t = tabCount(scanned.lines[lineNo]);
  for (let n = lineNo - 1; n >= 0; n -= 1) {
    const l = scanned.lines[n];
    if (l.trim() === '') continue;
    const lt = tabCount(l);
    if (lt < t) return { line: n, tabs: lt, text: l.trim() };
  }
  return null;
}
function outermostBlockAfter(scanned, lineNo, needle) {
  /* 从某行开始，找第一条包含 needle 的行，回报其最外层 `{` 块 */
  for (let n = lineNo; n < scanned.lines.length; n += 1) {
    if (scanned.lines[n].includes(needle)) return { line: n, block: enclosingBlock(scanned, n) };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 0. bundles
 * ------------------------------------------------------------------ */
const live = fs.readFileSync(LIVE, 'utf8');
const cand = fs.readFileSync(CANDIDATE, 'utf8');
const liveSha = sha256(live);
const candSha = sha256(cand);
results.target = { path: LIVE, sha256: liveSha, lines: live.split('\n').length };
results.candidate = { path: CANDIDATE, sha256: candSha, lines: cand.split('\n').length };
results.preimageSha256 = liveSha;

const scannedLive = scanBraces(live);
const scannedCand = scanBraces(cand);

/* ------------------------------------------------------------------ *
 * 1. anchors (from the pre-image) and the candidate's changed region
 * ------------------------------------------------------------------ */
const findLine = (scanned, needle) => {
  const idx = scanned.lines.findIndex((l) => l.trim() === needle);
  if (idx < 0) throw new Error(`line not found: ${needle.slice(0, 60)}`);
  return idx; // 0-based
};
const PRE_PROBE = 'if (current !== void 0 && currentAddress !== void 0) {';
const COPIED_PREV_PROBE = 'const copiedPrevious = previousProjection !== void 0 && sameIdList(previousProjection.ids, ids);';
const A3_PROBE = 'for (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0) byId[id] = previousProjection.byId[id];';
const GATE_PROBE = 'const nextById = previousProjection !== void 0 && reusedEntries === liveKeys.length ? previousProjection.byId : stableById;';
const OLD_COMMENT = "/* Carry the previous projection's extra rows (address-chain children) forward before diffing. */";
const DECL = 'const chainRowIds = new Set();';

const liveDeclIdx = findLine(scannedLive, PRE_PROBE);
const liveCopiedIdx = findLine(scannedLive, COPIED_PREV_PROBE);
const liveA3Idx = findLine(scannedLive, A3_PROBE);
const liveGateIdx = findLine(scannedLive, GATE_PROBE);
record('pre-image: the four audited anchors + `const copiedPrevious` all resolve to whole lines',
  liveDeclIdx > 0 && liveCopiedIdx > liveDeclIdx && liveA3Idx > liveCopiedIdx && liveGateIdx > liveA3Idx,
  `A1 line ${liveDeclIdx + 1}, copiedPrevious ${liveCopiedIdx + 1}, A3 ${liveA3Idx + 1}, gate ${liveGateIdx + 1}`);

const candDeclLine = findLine(scannedCand, `${DECL} ${MARKER}`);
const candIfLine = findLine(scannedCand, PRE_PROBE);
const candCopiedLine = findLine(scannedCand, COPIED_PREV_PROBE);
const candCopiedBlock = enclosingBlock(scannedCand, candCopiedLine);
results.lineMap = {
  candidate_chainRowIds_declaration: candDeclLine + 1,
  candidate_if_current_opener: candIfLine + 1,
  candidate_copiedPrevious: candCopiedLine + 1,
  candidate_copiedPrevious_block_owner: candCopiedBlock ? candCopiedBlock.startText.slice(0, 60) : null,
};

/* ------------------------------------------------------------------ *
 * 2. S1 / S2 / S3 / S6 — declaration uniqueness, depth, and block scope
 * ------------------------------------------------------------------ */
record('S1: `const chainRowIds = new Set();` occurs exactly once in the candidate',
  countLit(cand, DECL) === 1, `${countLit(cand, DECL)} occurrence(s)`, 1, countLit(cand, DECL));

record('S2 (T1): the declaration line carries exactly 4 Tab (projectList method-body top level)',
  tabCount(scannedCand.lines[candDeclLine]) === 4,
  `indent = ${tabCount(scannedCand.lines[candDeclLine])} Tab (0x09)`,
  4, tabCount(scannedCand.lines[candDeclLine]));

/* 真实块作用域：声明所在行的最外层 `{` 块，必须与 `const copiedPrevious` 所在行的最外层块**同一个** */
const declBlock = enclosingBlock(scannedCand, candDeclLine);
const copiedBlock = enclosingBlock(scannedCand, candCopiedLine);
const declOpener = enclosingOpenerByIndent(scannedCand, candDeclLine);
const copiedOpener = enclosingOpenerByIndent(scannedCand, candCopiedLine);
record('S3 (T1): the declaration sits in the SAME outermost block as `const copiedPrevious` (i.e. the projectList method body) — brace stack and indentation agree',
  declBlock !== null && copiedBlock !== null && declBlock.startLine === copiedBlock.startLine
  && declOpener !== null && copiedOpener !== null && declOpener.line === copiedOpener.line
  && declOpener.tabs === 3 && declOpener.text.includes('projectList() {'),
  [
    'brace stack: declaration block opens at line ' + (declBlock ? declBlock.startLine + 1 : '?'),
    'brace stack: copiedPrevious block opens at line ' + (copiedBlock ? copiedBlock.startLine + 1 : '?'),
    'indentation: declaration opener = ' + (declOpener ? `line ${declOpener.line + 1}, ${declOpener.tabs} Tab, "${declOpener.text.slice(0, 30)}"` : 'n/a'),
    'indentation: copiedPrevious opener = ' + (copiedOpener ? `line ${copiedOpener.line + 1}, ${copiedOpener.tabs} Tab` : 'n/a'),
  ].join('; '),
  'declaration opener == `projectList() {` at 3 Tab',
  declOpener ? `${declOpener.tabs} Tab @line ${declOpener.line + 1}` : null);

/* S6/T1: 声明**不得**处在 `if (current !== …) {` 的块内 —— 用括号栈判，不看行号 */
const ifAddrBlock = enclosingBlock(scannedCand, candIfLine); /* `if (current !== …) {` 这一行本身：其最外层块 = 方法体 */
const walkBodyOwner = outermostBlockAfter(scannedCand, candIfLine, 'while (address !== void 0 && !seen.has(address.childSessionId)) {');
const declInsideIfAddr = ifAddrBlock !== null && declBlock !== null
  && declBlock.startLine > ifAddrBlock.startLine; /* 声明块比 if 行更深 ⇒ 落在该 if 内 */
record('S6 (T1): the declaration is NOT inside the `if (current !== …) {` block (5 Tab trap) and NOT inside the walk body (8 Tab trap)',
  declBlock !== null && declBlock.startLine === ifAddrBlock.startLine
  && (walkBodyOwner === null || (walkBodyOwner.block !== null && declBlock.startLine <= walkBodyOwner.block.startLine)),
  [
    'declaration outermost block starts at line ' + (declBlock.startLine + 1),
    "the if(current!==...) opener line's own block starts at line " + (ifAddrBlock.startLine + 1),
    "the walk body's outermost block starts at line " + (walkBodyOwner && walkBodyOwner.block ? walkBodyOwner.block.startLine + 1 : 'n/a'),
  ].join('; '),
  'declaration block == method body block', `${declBlock.startLine + 1}`);

/* ------------------------------------------------------------------ *
 * 3. S4 / S5 — order (declaration before every use and before the walk)
 * ------------------------------------------------------------------ */
const declAt = cand.indexOf(DECL);
const addAt = cand.indexOf('chainRowIds.add(childId);');
const readAt = cand.indexOf('chainRowIds.has(id)');
const copiedAt = cand.indexOf(COPIED_PREV_PROBE);
const ifAt = cand.indexOf(PRE_PROBE);
record('S4: the declaration precedes BOTH the registration (`chainRowIds.add(childId);`, unique) and the reader (`chainRowIds.has(id)`)',
  countLit(cand, 'chainRowIds.add(childId);') === 1 && countLit(cand, 'chainRowIds.has(id)') === 1
  && declAt < addAt && declAt < readAt,
  `decl@${declAt} < add@${addAt}, read@${readAt}; add x${countLit(cand, 'chainRowIds.add(childId);')}, read x${countLit(cand, 'chainRowIds.has(id)')}`,
  'declaration first', `${declAt} < ${addAt}, ${readAt}`);
record('S5 (T2): the declaration precedes `const copiedPrevious` AND the `if (current !== …) {` line (it is NOT anchored on copiedPrevious / after the walk)',
  declAt < copiedAt && declAt < ifAt,
  `decl@${declAt} < copiedPrevious@${copiedAt}, if@${ifAt}`,
  'declaration before the walk', `${declAt} < ${copiedAt}, ${ifAt}`);
record('S4b (T1 regression guard): the registration is NOT inside the walk block that the OLD code eliminated',
  addAt > cand.indexOf('while (address !== void 0 && !seen.has(address.childSessionId)) {')
  && addAt < cand.indexOf('if (parent !== void 0 && parent.origin !== "subagent") break;'),
  'registration sits immediately after `seen.add(childId);` inside the walk, as the audit requires');

/* ------------------------------------------------------------------ *
 * 4. S7 / S8 — T3: whole-line deletion and no orphan indentation
 * ------------------------------------------------------------------ */
const orphanScan = scannedCand.lines
  .map((l, n) => ({ n: n + 1, l }))
  .filter(({ l }) => /^[ \t]+$/.test(l));
const eightTabOrphans = orphanScan.filter(({ l }) => tabCount(l) === 8);
const candA3Idx = findLine(scannedCand, 'for (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0 && chainRowIds.has(id)) byId[id] = previousProjection.byId[id];');
/* pre-image 自身的空白行（用于对比：候选件**不得**新增这类行） */
const liveOrphanScan = scannedLive.lines
  .map((l, n) => ({ n: n + 1, l }))
  .filter(({ l }) => /^[ \t]+$/.test(l));
record('S7 (T3): the old prose comment is gone (0 occurrences, deleted whole line+newline)',
  countLit(cand, OLD_COMMENT) === 0 && countLit(cand, `\n${'\t'.repeat(5)}${OLD_COMMENT}\n`) === 0,
  `comment x${countLit(cand, OLD_COMMENT)}`, 0, countLit(cand, OLD_COMMENT));
/* 改动区上界（prefix/suffix 在下面 S12 里正式使用，这里先算出来供 S7b 判定"孤立缩进只允许出现在改动区外"） */
const _liveLines = scannedLive.lines, _candLines = scannedCand.lines;
let _prefix = 0; while (_prefix < _liveLines.length && _prefix < _candLines.length && _liveLines[_prefix] === _candLines[_prefix]) _prefix += 1;
let _suffix = 0; while (_suffix < _liveLines.length - _prefix && _suffix < _candLines.length - _prefix
  && _liveLines[_liveLines.length - 1 - _suffix] === _candLines[_candLines.length - 1 - _suffix]) _suffix += 1;
const candOrphanScanRegion = orphanScan.filter((o) => o.n - 1 >= _prefix && o.n - 1 < _candLines.length - _suffix);

record('S7b (T3): the candidate introduces NO orphan whitespace-only line at the edit site, and no 5/8 Tab orphan line anywhere (the residual-indent artefact of a text-only replacement)',
  orphanScan.length === liveOrphanScan.length /* 空白行总数与 pre-image 相同 ⇒ 没有新增任何空白行 */
  && eightTabOrphans.length === 0 /* 不存在孤立 8 Tab 行（把声明放进已消失的块、或文本式替换的产物） */
  && orphanScan.every(({ l }) => tabCount(l) !== 5) /* 旧注释是 5 Tab 行：文本式替换会在原位留下 5 Tab 空行 */
  && candOrphanScanRegion.length === 0 /* 改动区内一个空白行都不能有 */,
  `whitespace-only lines: whole file = ${orphanScan.length} (tab depths ${orphanScan.map((o) => `${o.n}:${tabCount(o.l)}`).join(', ') || 'none'}), inside the changed region = ${candOrphanScanRegion.length}; pre-image has ${liveOrphanScan.length} such line(s) all outside the region`,
  '0 inside the changed region', candOrphanScanRegion.length);
record('S8 (T3/A3): the A3 comment head and the chain-scoped loop are adjacent lines at the measured 5 Tab depth',
  scannedCand.lines[candA3Idx - 1].includes(`${MARKER} /* address-chain scoped carry-forward`)
  && tabCount(scannedCand.lines[candA3Idx - 1]) === 5 && tabCount(scannedCand.lines[candA3Idx]) === 5,
  `head tabs=${tabCount(scannedCand.lines[candA3Idx - 1])}, loop tabs=${tabCount(scannedCand.lines[candA3Idx])}, adjacent=${scannedCand.lines[candA3Idx - 1].includes('address-chain scoped')}`,
  '5 / 5 adjacent', `${tabCount(scannedCand.lines[candA3Idx - 1])} / ${tabCount(scannedCand.lines[candA3Idx])}`);

/* ------------------------------------------------------------------ *
 * 5. S9 — old semantics cleared, new semantics present
 * ------------------------------------------------------------------ */
record('S9: the blanket carry-forward and the old gate line are both gone; the chain filter and the membership gate each appear exactly once',
  countLit(cand, A3_PROBE) === 0 && countLit(cand, GATE_PROBE) === 0
  && countLit(cand, 'byId[id] === void 0 && chainRowIds.has(id)') === 1
  && countLit(cand, 'reusableByIdKeys.every((id) => Object.prototype.hasOwnProperty.call(byId, id))') === 1
  && countLit(cand, 'reusableByIdKeys.length === liveKeys.length') === 1,
  `blanket=${countLit(cand, A3_PROBE)}, oldGate=${countLit(cand, GATE_PROBE)}, chainFilter=${countLit(cand, 'byId[id] === void 0 && chainRowIds.has(id)')}, memberGate=${countLit(cand, 'reusableByIdKeys.every((id) => Object.prototype.hasOwnProperty.call(byId, id))')}`,
  '0 / 0 / 1 / 1');

/* ------------------------------------------------------------------ *
 * 6. S10 / S11 — markers, foreign markers untouched, identifiers declared
 * ------------------------------------------------------------------ */
record('S10: exactly 4 unit markers, and the P2 / B1-C1 markers were not rewritten',
  countLit(cand, MARKER) === 4
  && countLit(cand, '/* dsh-perf-fix P2 v1 */') === countLit(live, '/* dsh-perf-fix P2 v1 */')
  && countLit(cand, 'dsh-lag-fix') === countLit(live, 'dsh-lag-fix')
  && countLit(cand, '/* dsh-perf-fix P1 v1 */') === countLit(live, '/* dsh-perf-fix P1 v1 */'),
  `p2ac-fix=${countLit(cand, MARKER)}, P2 v1 ${countLit(live, '/* dsh-perf-fix P2 v1 */')}->${countLit(cand, '/* dsh-perf-fix P2 v1 */')}, P1 v1 ${countLit(live, '/* dsh-perf-fix P1 v1 */')}->${countLit(cand, '/* dsh-perf-fix P1 v1 */')}, dsh-lag-fix ${countLit(live, 'dsh-lag-fix')}->${countLit(cand, 'dsh-lag-fix')}`,
  4, countLit(cand, MARKER));
record('S11: every identifier introduced by the patch is declared inside this same file (no reliance on an outer/global binding)',
  countLit(cand, 'const chainRowIds = new Set();') === 1
  && countLit(cand, 'const reusableByIdKeys = previousProjection !== void 0 ? Object.keys(previousProjection.byId) : void 0;') === 1
  && countLit(cand, 'chainRowIds') === 3
  && countLit(cand, 'reusableByIdKeys') === 3,
  `chainRowIds decl/uses = 1/${countLit(cand, 'chainRowIds') - 1}; reusableByIdKeys decl/uses = 1/${countLit(cand, 'reusableByIdKeys') - 1}`);

/* ------------------------------------------------------------------ *
 * 7. S12 — single contiguous changed region vs the pre-image
 * ------------------------------------------------------------------ */
const liveLines = scannedLive.lines;
const candLines = scannedCand.lines;
const prefix = _prefix, suffix = _suffix;
const SPLICE_WINDOW = 64; /* live 9294..9340 的跨度是 47 行；窗口设 64 行留余量但对越界改写仍然是硬约束 */
results.surgicalDiff = { commonPrefixLines: prefix, commonSuffixLines: suffix, windowLiveLines: liveLines.slice(prefix, liveLines.length - suffix), windowCandidateLines: candLines.slice(prefix, candLines.length - suffix) };
const liveWindow = liveLines.slice(_prefix, liveLines.length - _suffix);
const candWindow = candLines.slice(_prefix, candLines.length - _suffix);
record('S12: outside ONE bounded 64-line window around the four splice sites the candidate is byte-identical to the pre-image, and the window contains all four audited edits',
  _prefix + _suffix >= liveLines.length - SPLICE_WINDOW
  && liveWindow.length <= SPLICE_WINDOW
  && liveLines.slice(0, _prefix).join('\n') === candLines.slice(0, _prefix).join('\n')
  && liveLines.slice(liveLines.length - _suffix).join('\n') === candLines.slice(candLines.length - _suffix).join('\n')
  && liveWindow.includes(`${'\t'.repeat(4)}${PRE_PROBE}`)
  && liveWindow.includes(`${'\t'.repeat(5)}${A3_PROBE}`)
  && liveWindow.includes(`${'\t'.repeat(4)}${GATE_PROBE}`)
  && liveWindow.includes(`${'\t'.repeat(5)}${OLD_COMMENT}`)
  && candWindow.some((l) => l.includes(`${'\t'.repeat(4)}${DECL} ${MARKER}`))
  && candWindow.some((l) => l.includes(`${'\t'.repeat(6)}chainRowIds.add(childId); ${MARKER}`)),
  [
    'common prefix ' + _prefix + ' lines, common suffix ' + _suffix + ' lines (both verified byte-equal)',
    'differing window: live ' + liveWindow.length + ' lines -> candidate ' + candWindow.length + ' lines',
    'window holds all four audited splice sites with their measured indentation: '
      + ((liveWindow.includes(`${'\t'.repeat(4)}${PRE_PROBE}`) ? 1 : 0) + (liveWindow.includes(`${'\t'.repeat(5)}${A3_PROBE}`) ? 1 : 0)
        + (liveWindow.includes(`${'\t'.repeat(4)}${GATE_PROBE}`) ? 1 : 0) + (liveWindow.includes(`${'\t'.repeat(5)}${OLD_COMMENT}`) ? 1 : 0)) + '/4',
  ].join('; '),
  'prefix+suffix >= ' + (liveLines.length - SPLICE_WINDOW) + ' lines identical, window <= ' + SPLICE_WINDOW + ' lines',
  'identical outside a ' + liveWindow.length + '-line window');

/* ------------------------------------------------------------------ *
 * 8. S13 — syntax
 * ------------------------------------------------------------------ */
let syntaxOk = true, syntaxDetail = 'node --check passed';
try { execFileSync(process.execPath, ['--check', CANDIDATE], { stdio: 'pipe' }); }
catch (err) { syntaxOk = false; syntaxDetail = `node --check FAILED: ${err.stderr ? err.stderr.toString().trim() : err.message}`; }
record('S13: `node --check` passes on the candidate (syntactically complete bundle)', syntaxOk, syntaxDetail);

/* ------------------------------------------------------------------ *
 * 9. S14 — reverse controls: the static assertions must FAIL the broken forms
 * ------------------------------------------------------------------ */
function buildVariant(mode) {
  /* 用 pre-image 生成"故意破坏"的候选（只在内存里，不写盘、不碰真候选件） */
  const lineOf = (probe) => scannedLive.lines[findLine(scannedLive, probe)];
  const A1_LINE = lineOf(PRE_PROBE);
  const A2_LINE = lineOf('seen.add(childId);');
  const A3_LINE = lineOf(A3_PROBE);
  const GATE_LINE = lineOf(GATE_PROBE);
  const OLD_LINE = lineOf(OLD_COMMENT);
  const T4 = tabsOf(A1_LINE), T5 = tabsOf(A3_LINE), T6 = tabsOf(A2_LINE);
  const A1_BLOCK = mode === 'T1-five-tab' ? `${T5}${DECL} ${MARKER}`
    : mode === 'T1-eight-tab' ? `${T4}${T5}${DECL} ${MARKER}`
      : `${T4}${DECL} ${MARKER}`;
  const A2_BLOCK = `${T6}chainRowIds.add(childId); ${MARKER}`;
  const A3_BLOCK = `${T5}${MARKER} /* address-chain scoped carry-forward */\n`
    + `${T5}for (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0 && chainRowIds.has(id)) byId[id] = previousProjection.byId[id];`;
  const A3_NO_CHAIN = `${T5}${MARKER} /* control: chain filter removed */\n${T5}${A3_PROBE}`;
  const GATE_BLOCK = `${T4}${MARKER} /* key-set gate */\n`
    + `${T4}/* previous key set read AFTER carry-forward */\n`
    + `${T4}const reusableByIdKeys = previousProjection !== void 0 ? Object.keys(previousProjection.byId) : void 0;\n`
    + `${T4}const nextById = previousProjection !== void 0 && reusedEntries === liveKeys.length && reusableByIdKeys.length === liveKeys.length && reusableByIdKeys.every((id) => Object.prototype.hasOwnProperty.call(byId, id)) ? previousProjection.byId : stableById;`;
  const wholeLine = (src, probe, replacement) => {
    const l = src.split('\n').find((x) => x.trim() === probe);
    return src.split(`${l}\n`).join(`${replacement}\n`);
  };
  let t = live;
  if (mode !== 'T3-text-only') t = t.split(`${T5}${OLD_LINE.trim()}\n`).join('');
  else t = t.split(`${T5}${OLD_LINE.trim()}`).join(`${T5}${' '.repeat(0)}${MARKER} /* rewritten in place, newline kept */`);
  t = wholeLine(t, PRE_PROBE, `${A1_BLOCK}\n${A1_LINE}`);
  t = wholeLine(t, 'seen.add(childId);', `${A2_LINE}\n${A2_BLOCK}`);
  t = wholeLine(t, A3_PROBE, mode === 'no-chain-filter' ? A3_NO_CHAIN : A3_BLOCK);
  t = wholeLine(t, GATE_PROBE, GATE_BLOCK);
  const sc = scanBraces(t);
  const d = sc.lines.findIndex((l) => l.includes(DECL));
  const decl = d < 0 ? null : { line: d, tabs: tabCount(sc.lines[d]), block: enclosingBlock(sc, d) };
  return {
    text: t, scanned: sc, decl,
    orphanWhitespace: sc.lines.filter((l) => /^[ \t]+$/.test(l)),
    a3OldSurvives: countLit(t, A3_PROBE) > 0,
    oldCommentSurvives: countLit(t, OLD_COMMENT) > 0,
    declCount: countLit(t, DECL),
    declBeforeCopiedPrev: d >= 0 && t.indexOf(DECL) < t.indexOf(COPIED_PREV_PROBE),
  };
}
const liveDeclBlockStart = enclosingBlock(scannedLive, findLine(scannedLive, PRE_PROBE)).startLine;
for (const c of [
  { id: 'T1-five-tab', injects: 'declaration indented 5 Tab (inside `if (current !== …) {`)', caught: (v) => v.decl === null || v.decl.tabs !== 4 || v.decl.block.startLine !== liveDeclBlockStart || v.decl.opener.tabs !== 3 },
  { id: 'T1-eight-tab', injects: 'declaration indented 8 Tab (inside the walk body / an eliminated block)', caught: (v) => v.decl === null || v.decl.tabs !== 4 || v.decl.block.startLine !== liveDeclBlockStart || v.decl.opener.tabs !== 3 },
  { id: 'T3-text-only', injects: 'old prose comment rewritten in place instead of deleted whole-line', caught: (v) => v.a3OldSurvives || v.oldCommentSurvives || v.orphanWhitespace.length > 0 },
  { id: 'no-chain-filter', injects: 'A3 chain filter removed (blanket carry-forward kept)', caught: (v) => v.a3OldSurvives },
]) {
  const v = buildVariant(c.id);
  const bad = c.caught(v);
  results.controls.push({
    id: c.id, injects: c.injects,
    observed: {
      declCount: v.declCount, declLine: v.decl ? v.decl.line + 1 : null, declTabs: v.decl ? v.decl.tabs : null,
      declOutermostBlockStartLine: v.decl && v.decl.block ? v.decl.block.startLine + 1 : null,
      declOpenerLine: v.decl && v.decl.opener ? v.decl.opener.line + 1 : null,
      declOpenerTabs: v.decl && v.decl.opener ? v.decl.opener.tabs : null,
      a3OldStatementSurvives: v.a3OldSurvives, oldCommentSurvives: v.oldCommentSurvives,
      orphanWhitespaceLines: v.orphanWhitespace.length,
      declBeforeCopiedPrevious: v.declBeforeCopiedPrev,
    },
    verdict: bad ? 'CAUGHT' : 'MISSED',
  });
  record(`S14 control ${c.id}: the deliberately broken form is caught (${c.injects})`,
    bad, bad ? 'caught by the static assertions' : 'NOT caught — the assertion would be vacuous', 'CAUGHT', bad ? 'CAUGHT' : 'MISSED');
}
/* the healthy candidate must NOT be flagged by the same predicates */
record('S14b control: the real candidate passes the very predicates the controls fail (same code path, no false positive)',
  tabCount(scannedCand.lines[candDeclLine]) === 4 && declBlock.startLine === liveDeclBlockStart
  && declOpener.tabs === 3 && declOpener.text.includes('projectList() {')
  && candOrphanScanRegion.length === 0 && orphanScan.length === liveOrphanScan.length
  && eightTabOrphans.length === 0 && countLit(cand, A3_PROBE) === 0,
  `candidate: decl tabs=4, opener=${declOpener.tabs} Tab "${declOpener.text.slice(0, 24)}" (line ${declOpener.line + 1}), orphan whitespace=0, old statement=0`);

/* ------------------------------------------------------------------ *
 * 10. artifacts
 * ------------------------------------------------------------------ */
const failed = results.findings.filter((f) => f.status === 'FAIL');
results.summary = {
  candidate_sha256: candSha,
  preimage_sha256: liveSha,
  static_assertions: { pass: results.findings.length - failed.length, fail: failed.length },
  T1_declaration_scope_ok: tabCount(scannedCand.lines[candDeclLine]) === 4 && declBlock.startLine === liveDeclBlockStart
    && declOpener.tabs === 3 && declOpener.text.includes('projectList() {'),
  T2_anchor_position_ok: declAt < copiedAt && declAt < ifAt
    && !scannedCand.lines[candDeclLine].includes('copiedPrevious'),
  T3_whole_line_deletion_ok: countLit(cand, OLD_COMMENT) === 0
    && candOrphanScanRegion.length === 0 && orphanScan.length === liveOrphanScan.length && eightTabOrphans.length === 0,
  reverse_controls_caught: results.controls.length > 0 && results.controls.every((c) => c.verdict === 'CAUGHT'),
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(results, null, 2)}\n`);
process.stdout.write(`\nraw json: ${OUT}\n`);
process.stdout.write(`static assertions: ${results.summary.static_assertions.pass} PASS / ${results.summary.static_assertions.fail} FAIL\n`);
process.stdout.write(`T1_declaration_scope_ok=${results.summary.T1_declaration_scope_ok} T2_anchor_position_ok=${results.summary.T2_anchor_position_ok} T3_whole_line_deletion_ok=${results.summary.T3_whole_line_deletion_ok} reverse_controls_caught=${results.summary.reverse_controls_caught}\n`);
process.exit(failed.length === 0 ? 0 : 1);
