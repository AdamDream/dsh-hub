#!/usr/bin/env node
'use strict';
/**
 * verify-p2-ac-keyset-gate.cjs — 执行前审计的只读对拍脚本（独占 .workspace/lag-fix/exec-audit/p2/）。
 *
 * 审计目标：验证 audit.md §2/§3 给出的 P-AC 落地文本，特别是 §3.2 的 **成员性键集闸门**
 *          （比语义审计已对拍的基数式 P-AC 更强）。
 *
 * 方法：
 *   (1) `projectList` 及全部依赖函数 **按字节自 live bundle 提取**（sha256 钉死 d71a8ca5…）；
 *   (2) 补丁文本 **从 audit.md 的代码块解析**（消除复述漂移）+ 锚点唯一性断言；
 *   (3) 缩进**从源文件实测**（projectList 顶层 4 Tab；链域回拷行 5 Tab；seen.add 行 6 Tab）；
 *   (4) 对 {未改, 成员性闸门, 基数式 P-AC} 三态跑 S1–S5 + S-IDENT + S-CUTOVER。
 *
 * 关键方法学要点：一个场景的两轮必须跑在**同一个 runtime 实例**上，否则 `this.listProjection`
 * 在第二轮为 undefined，P2 的复用分支根本不会进入，测的就不是真实代码路径。
 *
 * 只读：不写产品文件；只写本目录 results/*.json。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TARGET = '/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js';
const EXPECTED_SHA256 = 'd71a8ca524307aa35b74c5504ce396458cd6cdd38bd2759be8e16bd1b783d69b';
const AUDIT_MD = path.join(__dirname, 'audit.md');
const OUT_DIR = path.join(__dirname, 'results');

const findings = [];
function fatal(msg) { process.stderr.write(`\n[FATAL] ${msg}\n`); process.exit(1); }
function record(name, ok, detail, evidence, expected, observed) {
  const e = { assertion: name, status: ok === true ? 'PASS' : ok === false ? 'FAIL' : 'INCONCLUSIVE', detail, evidence };
  if (expected !== undefined) e.expected = expected;
  if (observed !== undefined) e.observed = observed;
  findings.push(e);
  process.stdout.write(`${e.status}: ${name}${detail ? ` -> ${detail}` : ''}\n`);
  return e;
}
const countLit = (hay, needle) => hay.split(needle).length - 1;
const tabsOf = (line) => (line.match(/^\t*/) || [''])[0];
const tabCount = (line) => tabsOf(line).length;
const indentAs = (text, tabs) => text.split('\n').map((l) => (l.trim() === '' ? '' : tabs + l)).join('\n');

/* ---------- 1. target + byte-exact extraction ---------- */
const source = fs.readFileSync(TARGET, 'utf8');
const sha = crypto.createHash('sha256').update(source, 'utf8').digest('hex');
if (sha !== EXPECTED_SHA256) fatal(`target sha256 ${sha} != pinned ${EXPECTED_SHA256}`);

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
  projectList: extractAt(source, '\t\t\tprojectList() {', 'projectList'),
  eligible: extractAt(source, '\t\t\teligible(id) {', 'eligible'),
  pruneScopes: extractAt(source, '\t\t\tpruneScopes() {', 'pruneScopes'),
  workspaceTitleOf: extractAt(source, '\t\tfunction workspaceTitleOf(', 'workspaceTitleOf'),
  displayTitleOf: extractAt(source, '\t\tfunction displayTitleOf(', 'displayTitleOf'),
  sameIdList: extractAt(source, '\t\tfunction sameIdList(', 'sameIdList'),
  sameJobViewList: extractAt(source, '\t\tfunction sameJobViewList(', 'sameJobViewList'),
  sameSubagentCatalogs: extractAt(source, '\t\tfunction sameSubagentCatalogs(', 'sameSubagentCatalogs'),
  sameSubagentCatalogEntries: extractAt(source, '\t\tfunction sameSubagentCatalogEntries(', 'sameSubagentCatalogEntries'),
  indexSubagentDescendants: extractAt(source, '\t\tfunction indexSubagentDescendants(', 'indexSubagentDescendants'),
};
for (const [n, p] of Object.entries(pieces)) if (source.slice(p.start, p.end) !== p.slice) fatal(`byte identity failed for ${n}`);
record('extraction: 10 pieces byte-identical to the live bundle (sha256 pinned)',
  true, `projectList @ line ${pieces.projectList.line}, ${pieces.projectList.slice.length} bytes`, 'executed');

/* ---------- 2. anchors + MEASURED indentation ---------- */
const anchorA_old = 'for (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0) byId[id] = previousProjection.byId[id];';
const anchorB_old = 'const nextById = previousProjection !== void 0 && reusedEntries === liveKeys.length ? previousProjection.byId : stableById;';
const oldCarryComment = '/* Carry the previous projection\'s extra rows (address-chain children) forward before diffing. */';

const plLines = pieces.projectList.slice.split('\n');
const lineOfTrim = (needle) => { const l = plLines.find((x) => x.trim() === needle); if (!l) fatal(`source line not found: ${needle.slice(0, 60)}`); return l; };

const SEEN_LINE = lineOfTrim('seen.add(childId);');
const PRE_LINE = lineOfTrim('if (current !== void 0 && currentAddress !== void 0) {');  // 4 tabs; A1 goes ABOVE this
const LIVE_LINE = lineOfTrim('const liveKeys = Object.keys(byId);');
const CARRY_LINE = lineOfTrim(anchorA_old);
const GATE_LINE = lineOfTrim(anchorB_old);
const OLDCOMMENT_LINE = lineOfTrim(oldCarryComment);

const DEPTH = {
  top: tabCount(LIVE_LINE),
  carry: tabCount(CARRY_LINE),
  walk: tabCount(SEEN_LINE),
  ifAddr: tabCount(PRE_LINE),
};
record('indentation measured from the source (never assumed)',
  DEPTH.top === 4 && DEPTH.carry === 5 && DEPTH.walk === 6 && DEPTH.ifAddr === 4,
  `methodBody(top)=${DEPTH.top} carryGuardBody=${DEPTH.carry} walkBody=${DEPTH.walk} ifAddrOpener=${DEPTH.ifAddr}`, 'executed',
  { top: 4, carry: 5, walk: 6, ifAddr: 4 }, DEPTH);
record('the old prose comment sits immediately above the blanket loop at the same depth',
  tabCount(OLDCOMMENT_LINE) === DEPTH.carry && plLines.indexOf(OLDCOMMENT_LINE) === plLines.indexOf(CARRY_LINE) - 1,
  `comment tabs=${tabCount(OLDCOMMENT_LINE)}; adjacent-above=${plLines.indexOf(OLDCOMMENT_LINE) === plLines.indexOf(CARRY_LINE) - 1}`, 'executed');

for (const [label, needle] of [['anchor A (blanket carry-forward)', anchorA_old], ['anchor B (byId identity-reuse)', anchorB_old]]) {
  record(`${label} is byte-unique in the live bundle`, countLit(source, needle) === 1, `${countLit(source, needle)} occurrence(s)`, 'executed', 1, countLit(source, needle));
}
record('B0 (`seen.add(childId);`) is globally byte-unique', countLit(source, SEEN_LINE.trim()) === 1,
  `${countLit(source, SEEN_LINE.trim())} occurrence(s) in the whole file`, 'executed', 1, countLit(source, SEEN_LINE.trim()));
record('A1 anchor (`if (current !== void 0 && currentAddress !== void 0) {`) is unique inside projectList',
  countLit(pieces.projectList.slice, PRE_LINE) === 1,
  `${countLit(pieces.projectList.slice, PRE_LINE)} occurrence(s) at ${tabCount(PRE_LINE)} tabs`, 'executed', 1, countLit(pieces.projectList.slice, PRE_LINE));

/* ---------- 3. parse the patch texts out of audit.md ---------- */
const md = fs.readFileSync(AUDIT_MD, 'utf8');
function blocksAfter(marker, count) {
  const at = md.indexOf(marker);
  if (at === -1) fatal(`audit.md is missing marker: ${marker}`);
  const out = []; let i = at;
  while (out.length < count) {
    i = md.indexOf('```text\n', i);
    if (i === -1) fatal(`audit.md: fewer than ${count} fenced text blocks after ${marker}`);
    const start = i + '```text\n'.length;
    const end = md.indexOf('\n```', start);
    if (end === -1) fatal('audit.md: unterminated code fence');
    out.push(md.slice(start, end)); i = end;
  }
  return out;
}
const carryBlocks = blocksAfter('### 2.2 锚点 A', 3);
const gateBlocks = blocksAfter('### 2.3 锚点 B', 1);

const A1_TEXT = carryBlocks[0];
const A2_TEXT = carryBlocks[1];
const A3_SENTINEL = 'p2ac-fix-A3-do-not-insert-twice';
const A3_TEXT = carryBlocks[2].split('\n').filter((l) => !l.includes(A3_SENTINEL)).join('\n');
const GATE_TEXT = gateBlocks[0];

const A1_BLOCK = indentAs(A1_TEXT, tabsOf(LIVE_LINE));   // A1 lives in the function-body scope (4 tabs)
const A2_BLOCK = indentAs(A2_TEXT, tabsOf(SEEN_LINE));
const A3_BLOCK = indentAs(A3_TEXT, tabsOf(CARRY_LINE));
const GATE_BLOCK = indentAs(GATE_TEXT, tabsOf(LIVE_LINE));

record('audit.md §2.2 parses as A1 (1 line) / A2 (1 line) / A3 (2 lines after sentinel removal)',
  A1_TEXT.trim() === 'const chainRowIds = new Set(); /* p2ac-fix */'
  && A2_TEXT.trim() === 'chainRowIds.add(childId); /* p2ac-fix */'
  && A3_TEXT.split('\n').length === 2
  && A3_TEXT.split('\n')[0].trim().startsWith('/* p2ac-fix */')
  && A3_TEXT.split('\n')[1].includes('chainRowIds.has(id)')
  && countLit(A3_TEXT, 'const chainRowIds') === 0,
  `A1="${A1_TEXT.trim()}", A2="${A2_TEXT.trim()}", A3=${A3_TEXT.split('\n').length} lines`, 'executed');
record('audit.md §2.3 parses as a 4-line gate block with a well-formed comment head',
  GATE_TEXT.split('\n').length === 4
  && GATE_TEXT.split('\n')[0].trim().startsWith('/* p2ac-fix */')
  && countLit(GATE_TEXT, '/*') === countLit(GATE_TEXT, '*/')
  && GATE_TEXT.split('\n')[3].includes('const nextById'),
  `${GATE_TEXT.split('\n').length} lines; /* = ${countLit(GATE_TEXT, '/*')}, */ = ${countLit(GATE_TEXT, '*/')}`, 'executed');
record('patch texts re-indented to the measured depths',
  tabCount(A1_BLOCK) === DEPTH.ifAddr && tabCount(A2_BLOCK) === DEPTH.walk
  && tabCount(A3_BLOCK) === DEPTH.carry && tabCount(GATE_BLOCK) === DEPTH.top,
  `A1=${tabCount(A1_BLOCK)} A2=${tabCount(A2_BLOCK)} A3=${tabCount(A3_BLOCK)} gate=${tabCount(GATE_BLOCK)} (expect ${DEPTH.ifAddr}/${DEPTH.walk}/${DEPTH.carry}/${DEPTH.top})`, 'executed');

/* ---------- 4. apply the patch ---------- */
function applyP2AC(text, gateForm) {
  const gate = gateForm === 'count'
    ? indentAs(
        GATE_TEXT.split('\n')
          .filter((l) => !l.includes('p2ac-fix */') && !l.includes('const reusableByIdKeys'))
          .map((l) => (l.includes('const nextById')
            ? 'const nextById = previousProjection !== void 0 && reusedEntries === liveKeys.length && Object.keys(previousProjection.byId).length === liveKeys.length ? previousProjection.byId : stableById;'
            : l))
          .join('\n'),
        tabsOf(LIVE_LINE),
      )
    : GATE_BLOCK;
  if (gateForm === 'count' && (gate.includes('reusableByIdKeys') || gate.includes('p2ac-fix */'))) fatal('count form contaminated');
  if (gateForm === 'member' && !gate.includes('hasOwnProperty')) fatal('member form lost the membership check');

  const T_A1 = '@@P2AC_A1@@', T_A2 = '@@P2AC_A2@@', T_A3 = '@@P2AC_A3@@', T_GATE = '@@P2AC_GATE@@';
  let t = text;
  t = t.split(PRE_LINE).join(T_A1);
  t = t.split(SEEN_LINE).join(T_A2);
  t = t.split(`${OLDCOMMENT_LINE}\n`).join('');
  t = t.split(CARRY_LINE).join(T_A3);
  t = t.split(GATE_LINE).join(T_GATE);
  for (const tok of [T_A1, T_A2, T_A3, T_GATE]) {
    if (countLit(t, tok) !== 1) fatal(`tokenisation lost splice site ${tok} (count=${countLit(t, tok)})`);
  }
  t = t.replace(T_A1, `${A1_BLOCK}\n${PRE_LINE}`);
  t = t.replace(T_A2, `${SEEN_LINE}\n${A2_BLOCK}`);
  t = t.replace(T_A3, A3_BLOCK);
  t = t.replace(T_GATE, gate);
  for (const tok of [T_A1, T_A2, T_A3, T_GATE]) if (t.includes(tok)) fatal(`splice token survived: ${tok}`);
  if (t === text) fatal(`patch form ${gateForm} did not change the text`);

  if (countLit(t, 'const chainRowIds = new Set();') !== 1) fatal(`declaration count = ${countLit(t, 'const chainRowIds = new Set();')}, expected 1`);
  if (countLit(t, oldCarryComment) !== 0) fatal('stale prose comment survived');
  if (countLit(t, anchorA_old) !== 0) fatal('blanket carry-forward survived');
  if (t.indexOf('chainRowIds.add(childId);') < t.indexOf('const chainRowIds = new Set();')) fatal('A2 precedes A1 (TDZ)');
  const gateBody = gate.split('\n').slice(-1)[0];
  if (countLit(t, gateBody) !== 1) fatal(`gate body appears ${countLit(t, gateBody)} times`);
  if (t.indexOf(gateBody) < t.indexOf(`${LIVE_LINE}\n`)) fatal('gate body precedes liveKeys');
  return t;
}

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
let H_member, H_count;
try {
  H_member = factoryOf(applyP2AC(pieces.projectList.slice, 'member'))(displayTitleOf, sameIdList, sameJobViewList, sameSubagentCatalogs);
  H_count = factoryOf(applyP2AC(pieces.projectList.slice, 'count'))(displayTitleOf, sameIdList, sameJobViewList, sameSubagentCatalogs);
} catch (err) { fatal(`patched variant failed to compile: ${err.message}`); }
record('both patched variants compile (new Function on the patched slice)', true, 'member + count forms', 'executed');
const normSlice = pieces.projectList.slice.replace(/^[ \t]*/, '').replace(/\s+$/, '');
record('unpatched prototype source still equals the extracted slice (extraction fidelity)',
  H.prototype.projectList.toString() === normSlice, `${H.prototype.projectList.toString().length} bytes`, 'executed');
record('patched prototypes differ from the unpatched one (patch really applied)',
  H_member.prototype.projectList.toString() !== normSlice && H_count.prototype.projectList.toString() !== normSlice,
  `member=${H_member.prototype.projectList.toString().length} count=${H_count.prototype.projectList.toString().length} bytes (unpatched ${normSlice.length})`, 'executed');
record('marker hygiene: the pre-existing `/* dsh-perf-fix P2 v1 */` is untouched, no B1/C1 marker is touched, and the new marker is distinct',
  countLit(H_member.prototype.projectList.toString(), '/* dsh-perf-fix P2 v1 */') === 1
  && countLit(H_member.prototype.projectList.toString(), 'dsh-lag-fix') === 0
  && countLit(H_member.prototype.projectList.toString(), '/* p2ac-fix */') === 4,
  `dsh-perf-fix P2 v1 x${countLit(H_member.prototype.projectList.toString(), '/* dsh-perf-fix P2 v1 */')}, `
  + `dsh-lag-fix x${countLit(H_member.prototype.projectList.toString(), 'dsh-lag-fix')}, `
  + `p2ac-fix x${countLit(H_member.prototype.projectList.toString(), '/* p2ac-fix */')} (A2 + A3 head + gate head + gate note)`,
  'executed', 'dsh-perf-fix x1 / dsh-lag-fix x0 / p2ac-fix x4');

/* ---------- 5. doubles ---------- */
function makeStore(initial) { let state = initial; return { getSnapshot: () => state, set: (n) => { state = n; } }; }
const itemOf = (id, over) => ({ sessionId: id, title: id, cwd: `/home/dev/${id}`, running: false, blank: false, updatedAt: 1000, ...over });
const childEntry = (id, label, activity, mode) => ({ kind: 'child', id, label, activity, hasChildren: false, mode: mode ?? 'continuable' });
const initialState = () => ({ ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined });

/**
 * A scenario runs BOTH rounds on the SAME instance: that is what keeps
 * `this.listProjection === this.list.getSnapshot()` true and therefore keeps the P2 reuse path
 * under test reachable. A fresh instance for round 1 would silently bypass it.
 */
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
/** CUTOVER: round 0 runs the extracted (unpatched) class, round 1 the patched one, carrying listProjection. */
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

/* ---------- 6. scenarios ---------- */
const S1 = [
  { items: [mkParent()], current: 'child', phase: 'ready', subagentsByParent: cat([childEntry('child', 'Child', 'running')]), jobsBySession: {}, currentAddress: addr('child') },
  { items: [mkParent()], current: 'p', phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined },
];
const S2 = [
  { items: [mkParent()], current: 'child', phase: 'ready', subagentsByParent: cat([childEntry('child', 'Child', 'running')]), jobsBySession: {}, currentAddress: addr('child') },
  { items: [mkParent()], current: 'child', phase: 'ready', subagentsByParent: cat([childEntry('child', 'ChildRenamed', 'inactive')]), jobsBySession: {}, currentAddress: addr('child') },
];
const S3 = [
  { items: [mkParent()], current: 'child', phase: 'ready', subagentsByParent: cat([childEntry('child', 'Child', 'running')]), jobsBySession: {}, currentAddress: addr('child') },
  { items: [mkParent()], current: 'child', phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: addr('child') },
];
const S4 = [
  { items: [mkParent()], current: 'child1', phase: 'ready', subagentsByParent: cat([childEntry('child1', 'C1', 'running')]), jobsBySession: {}, currentAddress: addr('child1') },
  { items: [mkParent()], current: 'child2', phase: 'ready', subagentsByParent: cat([childEntry('child2', 'C2', 'running')]), jobsBySession: {}, currentAddress: addr('child2') },
];
const S5 = [
  { items: [mkParent()], current: 'child', phase: 'ready', subagentsByParent: cat([childEntry('child', 'Child', 'running')]), jobsBySession: {}, currentAddress: addr('child') },
  { items: [mkParent(), itemOf('q', { title: 'Other' })], current: 'p', phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined },
];
const IDENT = [S1[0], { ...S1[0] }];
const NAV_S3 = { p: undefined };

const variants = [
  { id: 'unpatched', K: H, expect: { S1: 'stale', S2: 'ok', S3: 'ok', S4: 'stale', S5: 'cleared', IDENT: 'same-ref' } },
  { id: 'P-AC-member-gate', K: H_member, expect: { S1: 'fixed', S2: 'ok', S3: 'ok', S4: 'fixed', S5: 'cleared', IDENT: 'same-ref' } },
  { id: 'P-AC-count-gate', K: H_count, expect: { S1: 'fixed', S2: 'ok', S3: 'ok', S4: 'fixed', S5: 'cleared', IDENT: 'same-ref' } },
];

const scenarioVerdict = {};
for (const v of variants) {
  const K = v.K;
  const r1 = runRounds(K, S1, navNone);
  const r2 = runRounds(K, S2, navNone);
  const r3 = runRounds(K, S3, NAV_S3);
  const r4 = runRounds(K, S4, navNone);
  const r5 = runRounds(K, S5, navNone);
  const rI = runRounds(K, IDENT, navNone);
  const rC = runCutover(K, S1, navNone);
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
    byIdKeys: { S1: keys(r1.published2), S2: keys(r2.published2), S3: keys(r3.published2), S4: keys(r4.published2), S5: keys(r5.published2), CUTOVER: keys(rC.published2) },
    s1_ids: r1.published2.ids,
    s1_eligible_child: r1.rt.eligible('child'),
    s1_indexSubagentDescendants_for_p: indexSubagentDescendants(r1.published2.byId).get('p') ?? null,
    s2_displayTitle: r2.published2.byId.child?.displayTitle ?? null,
    s3_displayTitle: r3.published2.byId.child?.displayTitle ?? null,
    s_ident_identical_reference: rI.identicalRef,
  };
  for (const s of ['S1', 'S2', 'S3', 'S4', 'S5', 'IDENT']) {
    record(`${v.id} / ${s}: observed=${o[s]}`, o[s] === v.expect[s],
      `byId=${JSON.stringify(scenarioVerdict[v.id].byIdKeys[s] ?? null)}`, 'executed', v.expect[s], o[s]);
  }
}

record('P-AC-member-gate / S1: indexSubagentDescendants(byId) no longer fabricates a child count for p',
  scenarioVerdict['P-AC-member-gate'].s1_indexSubagentDescendants_for_p === null,
  `indexSubagentDescendants(byId).get("p") = ${JSON.stringify(scenarioVerdict['P-AC-member-gate'].s1_indexSubagentDescendants_for_p)}`,
  'executed', null, scenarioVerdict['P-AC-member-gate'].s1_indexSubagentDescendants_for_p);
record('unpatched / S1: the residual row is published while eligible(child) is false (projection/scope divergence)',
  scenarioVerdict.unpatched.s1_eligible_child === false && scenarioVerdict.unpatched.observed.S1 === 'stale',
  `eligible("child")=${scenarioVerdict.unpatched.s1_eligible_child}`, 'executed', false, scenarioVerdict.unpatched.s1_eligible_child);

record('cutover / unpatched: a stale row written by the OLD code survives into the next round (baseline defect)',
  scenarioVerdict.unpatched.observed.CUTOVER === 'stale', `byId=${JSON.stringify(scenarioVerdict.unpatched.byIdKeys.CUTOVER)}`,
  'executed', 'stale', scenarioVerdict.unpatched.observed.CUTOVER);
for (const v of ['P-AC-member-gate', 'P-AC-count-gate']) {
  record(`cutover / ${v}: a pre-existing stale row (written by the old code) is dropped on the first patched round`,
    scenarioVerdict[v].observed.CUTOVER === 'fixed', `byId=${JSON.stringify(scenarioVerdict[v].byIdKeys.CUTOVER)}`,
    'executed', 'fixed', scenarioVerdict[v].observed.CUTOVER);
  record(`${v}: P2 identity reuse NOT weakened — unchanged content republishes the identical projection object`,
    scenarioVerdict[v].s_ident_identical_reference === true,
    `published2 === published1 : ${scenarioVerdict[v].s_ident_identical_reference}`, 'executed', true, scenarioVerdict[v].s_ident_identical_reference);
}

/* ---------- 7. artifacts ---------- */
fs.mkdirSync(OUT_DIR, { recursive: true });
const fullFix = (id) => ['S1:fixed', 'S2:ok', 'S3:ok', 'S4:fixed', 'S5:cleared']
  .every((pair) => { const [k, val] = pair.split(':'); return scenarioVerdict[id].observed[k] === val; });
const summary = {
  target: { path: TARGET, sha256: sha, lines: source.split('\n').length },
  auditMd: path.relative(process.cwd(), AUDIT_MD),
  patchTextSource: 'parsed from audit.md §2.2/§2.3 fenced blocks (not re-typed); indentation measured from the live source',
  measuredDepths: DEPTH,
  anchors: {
    a1InsertAbove: PRE_LINE,
    a2RegisterAfter: SEEN_LINE,
    a3Replace: anchorA_old,
    gateReplace: anchorB_old,
    walkRegistrationOccurrencesWholeFile: countLit(source, SEEN_LINE.trim()),
  },
  emittedPatchText: { A1_BLOCK, A2_BLOCK, A3_BLOCK, GATE_BLOCK },
  scenarioVerdict,
  findings,
  summary: {
    unpatched_reproduces_defect: scenarioVerdict.unpatched.observed.S1 === 'stale' && scenarioVerdict.unpatched.observed.S4 === 'stale',
    member_gate_is_full_fix: fullFix('P-AC-member-gate'),
    count_gate_is_full_fix: fullFix('P-AC-count-gate'),
    p2_identity_preserved: scenarioVerdict['P-AC-member-gate'].s_ident_identical_reference === true
      && scenarioVerdict['P-AC-count-gate'].s_ident_identical_reference === true,
    cutover_drops_preexisting_stale_row: scenarioVerdict['P-AC-member-gate'].observed.CUTOVER === 'fixed'
      && scenarioVerdict['P-AC-count-gate'].observed.CUTOVER === 'fixed',
  },
};
fs.writeFileSync(path.join(OUT_DIR, 'p2ac-keyset-gate.json'), `${JSON.stringify(summary, null, 2)}\n`);
const pass = findings.filter((f) => f.status === 'PASS').length;
const fail = findings.filter((f) => f.status === 'FAIL').length;
process.stdout.write(`\nraw json: ${path.join(OUT_DIR, 'p2ac-keyset-gate.json')}\n`);
process.stdout.write(`assertions: ${pass} PASS / ${fail} FAIL\n`);
process.stdout.write(`unpatched_reproduces_defect=${summary.summary.unpatched_reproduces_defect} member_gate_is_full_fix=${summary.summary.member_gate_is_full_fix} count_gate_is_full_fix=${summary.summary.count_gate_is_full_fix} p2_identity_preserved=${summary.summary.p2_identity_preserved} cutover_drops_preexisting_stale_row=${summary.summary.cutover_drops_preexisting_stale_row}\n`);
process.exit(fail === 0 ? 0 : 1);
