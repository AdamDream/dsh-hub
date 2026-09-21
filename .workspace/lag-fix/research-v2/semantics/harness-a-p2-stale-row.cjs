#!/usr/bin/env node
'use strict';
/**
 * Harness A — P2 "stale-row" (address-chain synthetic child residue) executable counterfactual.
 *
 * Method: the function under test (`SessionRuntime.projectList`), its class neighbours
 * (`eligible`, `pruneScopes`) and every free function it calls are **programmatically
 * extracted as byte-exact slices** of the live client bundle. Nothing under test is
 * re-typed. Extraction is guarded by:
 *   (0) pinned sha256 of the target file,
 *   (1) anchor presence asserts,
 *   (2) `slice === source.slice(start, end)` byte identity,
 *   (3) `Proto[method].toString() === slice` at runtime (proves the executing object
 *       really holds the extracted source),
 *   (4) a mutation-control extraction that must FAIL (proves the guard is not vacuous).
 * Any of these failing throws and exits 1.
 *
 * Everything not extracted (the snapshot store, the SessionManager, ctx/selection) is a
 * harness double whose contract is anchored on quoted real source lines recorded in
 * `storeContractEvidence` — labelled `code-inference`, while every scenario verdict below
 * is labelled `executed`.
 *
 * Offline, side-effect free, deterministic. No sandbox escalation, no product edits.
 *
 * Usage: node harness-a-p2-stale-row.cjs
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TARGET = '/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js';
const EXPECTED_SHA256 = 'd71a8ca524307aa35b74c5504ce396458cd6cdd38bd2759be8e16bd1b783d69b';
const OUT_DIR = path.join(__dirname, 'results');
const OUT_JSON = path.join(OUT_DIR, 'p2-stale-row.json');

const findings = [];
const extractionProof = {};
const results = {};

function fatal(msg) {
  process.stderr.write(`\n[extraction/self-proof FAILURE] ${msg}\n`);
  process.exit(1);
}

function record(name, ok, detail, evidence, expected, observed) {
  const entry = {
    assertion: name,
    status: ok === true ? 'PASS' : ok === false ? 'FAIL' : 'INCONCLUSIVE',
    detail,
    evidence,
  };
  if (expected !== undefined) entry.expected = expected;
  if (observed !== undefined) entry.observed = observed;
  findings.push(entry);
  process.stdout.write(`${entry.status}: ${name}${detail ? ` -> ${detail}` : ''}\n`);
  return entry;
}

/* ------------------------------------------------------------------ *
 * 1. byte-exact programmatic extraction
 * ------------------------------------------------------------------ */

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Line number (1-based) of a byte offset. */
function lineOf(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

/**
 * Brace/paren aware scanner: returns the index just past the bracket that closes the
 * bracket at `openIndex`, skipping strings, template literals, comments and regex literals.
 */
function matchBracket(text, openIndex) {
  const open = text[openIndex];
  const pairs = { '{': '}', '(': ')', '[': ']' };
  const close = pairs[open];
  if (close === undefined) throw new Error(`matchBracket: ${JSON.stringify(open)} is not an opening bracket`);
  let depth = 0;
  let i = openIndex;
  let prevSignificant = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '/') {
      i = text.indexOf('\n', i);
      if (i === -1) break;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) throw new Error('matchBracket: unterminated block comment');
      i = end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === quote) { i += 1; break; }
        if (quote === '`' && text[i] === '$' && text[i + 1] === '{') {
          i = matchBracket(text, i + 1) ;
          continue;
        }
        i += 1;
      }
      prevSignificant = quote;
      continue;
    }
    // regex literal heuristic: '/' in a value position
    if (ch === '/' && '(,=:[!&|?{};+-*%~^<>'.includes(prevSignificant)) {
      let j = i + 1;
      let inClass = false;
      while (j < text.length) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === '[') inClass = true;
        else if (text[j] === ']') inClass = false;
        else if (text[j] === '/' && !inClass) break;
        else if (text[j] === '\n') throw new Error('matchBracket: newline inside regex literal');
        j += 1;
      }
      i = j + 1;
      prevSignificant = '/';
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    if (!/\s/.test(ch)) prevSignificant = ch;
    i += 1;
  }
  throw new Error(`matchBracket: unbalanced ${open} at offset ${openIndex}`);
}

/** Extract `function name(...) { ... }` — byte exact. Throws when the anchor is absent. */
function extractFunction(source, name) {
  const anchor = `\t\tfunction ${name}(`;
  const occurrences = source.split(anchor).length - 1;
  if (occurrences !== 1) throw new Error(`anchor for function ${name} appears ${occurrences} times, expected exactly 1`);
  const start = source.indexOf(anchor);
  const braceAt = source.indexOf('{', start);
  const end = matchBracket(source, braceAt);
  const slice = source.slice(start, end);
  if (source.slice(start, end) !== slice) throw new Error(`slice identity check failed for ${name}`);
  return { slice, start, end, line: lineOf(source, start) };
}

/** Extract a class method `name(...) { ... }` given its exact indentation prefix. Throws when absent. */
function extractMethod(source, declaration, indent) {
  const anchor = `${indent}${declaration}`;
  const occurrences = source.split(anchor).length - 1;
  if (occurrences !== 1) throw new Error(`anchor for method ${declaration} appears ${occurrences} times, expected exactly 1`);
  const start = source.indexOf(anchor);
  const braceAt = source.indexOf('{', start);
  const end = matchBracket(source, braceAt);
  const slice = source.slice(start, end);
  return { slice, start, end, line: lineOf(source, start) };
}

/** fatal-on-failure wrapper for the pieces we actually execute. */
function mustExtract(fn, ...args) {
  try {
    return fn(...args);
  } catch (error) {
    fatal(error && error.message);
  }
}

const source = fs.readFileSync(TARGET, 'utf8');
const observedSha = sha256(source);
extractionProof.target = TARGET;
extractionProof.targetSha256 = observedSha;
extractionProof.pinnedSha256 = EXPECTED_SHA256;
if (observedSha !== EXPECTED_SHA256) {
  fatal(`target file sha256 ${observedSha} != pinned ${EXPECTED_SHA256} (the artifact under audit changed; re-derive the anchors deliberately)`);
}
record('self-proof: target file sha256 matches pinned value', true, observedSha, 'executed');

const pieces = {
  projectList: mustExtract(extractMethod, source, 'projectList() {', '\t\t\t'),
  eligible: mustExtract(extractMethod, source, 'eligible(id) {', '\t\t\t'),
  pruneScopes: mustExtract(extractMethod, source, 'pruneScopes() {', '\t\t\t'),
  workspaceTitleOf: mustExtract(extractFunction, source, 'workspaceTitleOf'),
  displayTitleOf: mustExtract(extractFunction, source, 'displayTitleOf'),
  sameIdList: mustExtract(extractFunction, source, 'sameIdList'),
  sameJobViewList: mustExtract(extractFunction, source, 'sameJobViewList'),
  sameSubagentCatalogs: mustExtract(extractFunction, source, 'sameSubagentCatalogs'),
  sameSubagentCatalogEntries: mustExtract(extractFunction, source, 'sameSubagentCatalogEntries'),
  indexSubagentDescendants: mustExtract(extractFunction, source, 'indexSubagentDescendants'),
};
extractionProof.pieces = {};
for (const [name, piece] of Object.entries(pieces)) {
  if (source.slice(piece.start, piece.end) !== piece.slice) fatal(`byte identity check failed for ${name}`);
  extractionProof.pieces[name] = {
    lineStart: piece.line,
    byteStart: piece.start,
    byteEnd: piece.end,
    bytes: Buffer.byteLength(piece.slice, 'utf8'),
  };
}

/* Semantic anchors that must live INSIDE the extracted projectList body. */
const requiredAnchors = [
  ['/* dsh-perf-fix P2 v1 */', 'P2 patch version marker'],
  ['const copiedPrevious = previousProjection !== void 0 && sameIdList(previousProjection.ids, ids);', 'P2 identity guard'],
  ['/* Carry the previous projection\'s extra rows (address-chain children) forward before diffing. */', 'carry-forward comment'],
  ['for (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0) byId[id] = previousProjection.byId[id];', 'blanket carry-forward loop (the suspect line)'],
  ['else if (summary.displayTitle !== displayTitle) byId[childId] = {', 'address-chain synthetic-child synthesis'],
  ['const child = subagentsByParent[address.parentSessionId]?.entries.find((entry) => entry.kind === "child" && entry.id === childId);', 'catalog lookup in chain walk'],
  ['address = this.manager.navigationAddress(address.parentSessionId);', 'chain walk step'],
  ['this.list.set(nextProjection);', 'publish'],
];
for (const [needle, label] of requiredAnchors) {
  if (!pieces.projectList.slice.includes(needle)) fatal(`extracted projectList body is missing anchor: ${label} :: ${needle}`);
  if (!source.includes(needle)) fatal(`source lost anchor ${needle}`);
}
extractionProof.projectListAnchorsVerified = requiredAnchors.map(([, label]) => label);
record('self-proof: every semantic anchor found inside the extracted projectList body', true,
  `${requiredAnchors.length} anchors (incl. the carry-forward line)`, 'executed');

/* Assemble the class from the byte-exact slices. */
const factorySource =
  '"use strict";\n' +
  'class ProjectionHarness {\n' +
  pieces.projectList.slice + '\n' +
  pieces.eligible.slice + '\n' +
  pieces.pruneScopes.slice + '\n' +
  '}\n' +
  'ProjectionHarness.prototype.dropScope = function dropScope(id, record) { (this.__dropScopeCalls = this.__dropScopeCalls || []).push({ id, record }); };\n' +
  'return ProjectionHarness;\n';

let factory;
try {
  factory = new Function(
    'displayTitleOf', 'sameIdList', 'sameJobViewList', 'sameSubagentCatalogs',
    factorySource,
  );
} catch (error) {
  fatal(`assembled class failed to compile: ${error && error.message}`);
}
/** Compile byte-exact declaration slices and hand back the named binding. */
function materialize(declarations, name) {
  const body = `${declarations.join('\n')}\nreturn ${name};\n`;
  return new Function(body)();
}
const displayTitleOf = materialize([pieces.workspaceTitleOf.slice, pieces.displayTitleOf.slice], 'displayTitleOf');
const sameIdList = materialize([pieces.sameIdList.slice], 'sameIdList');
const sameJobViewList = materialize([pieces.sameJobViewList.slice], 'sameJobViewList');
const sameSubagentCatalogs = materialize(
  [pieces.sameSubagentCatalogEntries.slice, pieces.sameSubagentCatalogs.slice], 'sameSubagentCatalogs');

const H = factory(displayTitleOf, sameIdList, sameJobViewList, sameSubagentCatalogs);

/* Runtime identity: the object we execute really carries the extracted text.
 * V8 normalizes a method's source text by dropping the declaration line's leading
 * indentation and the trailing whitespace after the closing brace; every other byte
 * (including the body's own indentation) is preserved. Both the normalized identity and
 * the presence of the suspect line are asserted, and the raw delta is recorded. */
for (const name of ['projectList', 'eligible', 'pruneScopes']) {
  const rt = H.prototype[name].toString();
  const expectedRt = pieces[name].slice.replace(/^[ \t]*/, '').replace(/\s+$/, '');
  if (rt !== expectedRt) {
    fatal(`runtime source mismatch for ${name}: executed object's source text differs from the extracted slice`);
  }
  extractionProof.pieces[name].runtimeSourceEqualsNormalizedSlice = true;
  extractionProof.pieces[name].normalizationDelta = pieces[name].slice.length - rt.length;
}
if (!H.prototype.projectList.toString().includes('/* dsh-perf-fix P2 v1 */')
  || !H.prototype.projectList.toString().includes('for (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0) byId[id] = previousProjection.byId[id];')) {
  fatal('runtime projectList lost the P2 marker or the carry-forward line');
}
record('self-proof: runtime prototype source text === extracted slice (projectList/eligible/pruneScopes)', true,
  `identity after V8 method-source normalization; projectList delta ${extractionProof.pieces.projectList.normalizationDelta} bytes (leading indent + trailing newline)`, 'executed');

/* Mutation control: the guard must not be vacuous. */
let controlFailedLoudly = false;
try {
  extractMethod(source, 'projectListTypo() {', '\t\t\t');
} catch {
  controlFailedLoudly = true;
}
if (!controlFailedLoudly) fatal('mutation control did not fail: the extraction guard is vacuous');
extractionProof.mutationControl = 'extractMethod(source, "projectListTypo() {") threw as required';
record('self-proof: mutation control (missing anchor throws, exit-coded)', true, 'guard is not vacuous', 'executed');

const indexSubagentDescendants = materialize([pieces.indexSubagentDescendants.slice], 'indexSubagentDescendants');

/* ------------------------------------------------------------------ *
 * 2. harness doubles (contract anchored on real source lines)
 * ------------------------------------------------------------------ */

const storeContractEvidence = {
  'createSnapshotStore.getSnapshot': 'client.js:5416 `getSnapshot: () => api.getState(),`',
  'createSnapshotStore.set': 'client.js:5423-5425 `set: (next) => { api.setState(devFreeze(next), true); }`',
  'getListSnapshot': 'client.js:8266-8270 `getListSnapshot() { this.notifier.ensureFresh(); return this.listSnapshotCache; }`',
  'navigationAddress': 'client.js:7906-7915 `navigationAddress(sessionId) { const retained = this.addresses.get(sessionId); ... }`',
  note: 'zustand setState(replace) stores the object reference, so getSnapshot() === the object passed to set(); the P2 guard `this.listProjection === this.list.getSnapshot()` therefore holds on the real store. Harness double preserves object identity across set/getSnapshot.',
};

function makeStore(initial) {
  let state = initial;
  return {
    getSnapshot: () => state,
    set: (next) => { state = next; },
  };
}

function itemOf(id, over) {
  return {
    sessionId: id,
    title: id,
    cwd: `/home/dev/${id}`,
    running: false,
    blank: false,
    updatedAt: 1000,
    ...over,
  };
}

function makeRuntime({ rounds, navigation }) {
  const runtime = new H();
  runtime.scopes = new Map();
  runtime.deferredRemovals = new Set();
  runtime.watched = undefined;
  runtime.list = makeStore({
    ids: [], byId: {}, current: undefined, phase: 'ready',
    subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  });
  const setCalls = [];
  const rawSet = runtime.list.set;
  runtime.list.set = (next) => { setCalls.push(next); rawSet(next); };
  runtime.selection = { snapshot: {}, getSnapshot() { return this.snapshot; }, set(v) { this.snapshot = v; } };
  let round = 0;
  runtime.manager = {
    getListSnapshot: () => rounds[round],
    navigationAddress: (id) => navigation[id],
  };
  runtime.__advance = () => { round += 1; };
  runtime.__setCalls = setCalls;
  return runtime;
}

/**
 * One catalog entry in the real `SubagentListEntry` shape
 * (dsh-subagent/lib/types/list-children.d.ts:30-52): activity is
 * 'running' | 'inactive', mode is 'one-shot' | 'continuable', plus hasChildren.
 */
function childEntry(id, label, activity, mode) {
  return { kind: 'child', id, label, activity, hasChildren: false, mode: mode ?? 'continuable' };
}

function rowOf(projection, id) {
  return projection.byId[id];
}

const scenarios = [];

/* ------------------------------------------------------------------ *
 * 3. scenario S1 — the reported stale row (address cleared)
 * ------------------------------------------------------------------ */
{
  const pRound1 = itemOf('p', { title: 'Parent' });
  const rounds = [
    { // round 1: the app is focused on the address-chain synthetic child 'child'
      items: [pRound1], current: 'child', phase: 'ready',
      subagentsByParent: { p: { state: 'ready', parentAvailable: true, entries: [childEntry('child', 'Child', 'running')] } },
      jobsBySession: {}, currentAddress: { parentSessionId: 'p', childSessionId: 'child', mode: 'view' },
    },
    { // round 2: navigation returned to the parent -> address cleared, catalog gone, items unchanged
      items: [itemOf('p', { title: 'Parent' })], current: 'p', phase: 'ready',
      subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
    },
  ];
  const runtime = makeRuntime({ rounds, navigation: {} });
  runtime.projectList();
  const after1 = runtime.list.getSnapshot();
  const syntheticCreatedInRound1 = rowOf(after1, 'child') !== undefined;
  record('S1 precondition: round 1 synthesizes the address-chain child row',
    syntheticCreatedInRound1 && after1.ids.length === 1 && after1.ids[0] === 'p',
    `ids=${JSON.stringify(after1.ids)} byIdKeys=${JSON.stringify(Object.keys(after1.byId))}`, 'executed');

  runtime.__advance();
  runtime.projectList();
  const after2 = runtime.list.getSnapshot();
  const staleRow = rowOf(after2, 'child');
  const residue = staleRow !== undefined;
  const descendants = indexSubagentDescendants(after2.byId).get('p');
  const eligibleChild = runtime.eligible('child');
  const eligibleParent = runtime.eligible('p');

  const s1 = {
    scenario: 'S1 — address cleared between rounds, manager items unchanged (ids=[p])',
    previousProjection_ids: after1.ids,
    current_byId_keys: Object.keys(after2.byId),
    current_ids: after2.ids,
    stale_row_present: residue,
    stale_row: staleRow ?? null,
    id_not_in_ids: residue && !after2.ids.includes('child'),
    client_indexSubagentDescendants_for_p: descendants ?? null,
    scope_eligible_child: eligibleChild,
    scope_eligible_parent: eligibleParent,
    scope_consistent: eligibleChild === true,
    verdict: residue ? 'STALE ROW CONFIRMED' : 'no residue',
    evidence: 'executed',
  };
  scenarios.push(s1);
  record('S1: synthetic child row still residually present in published byId after the address is cleared',
    residue, `byId keys = ${JSON.stringify(Object.keys(after2.byId))}, ids = ${JSON.stringify(after2.ids)}`,
    'executed', false, residue);
  record('S1: the residual row is keyed by an id absent from the projection ids list',
    residue && !after2.ids.includes('child'), `ids=${JSON.stringify(after2.ids)}`, 'executed', true, residue && !after2.ids.includes('child'));
  record('S1: the residual row is consumed by the real client indexSubagentDescendants(byId)',
    descendants !== undefined && descendants.count >= 1,
    `indexSubagentDescendants(byId).get("p") = ${JSON.stringify(descendants)} while ids=[p]`, 'executed',
    'count>=1 (the synthesised row survives and is still counted)', descendants ?? null);
  record('S1: byId advertises a row whose scope the same round prunes (projection/scope divergence)',
    residue === true && eligibleChild === false && eligibleParent === true,
    `eligible("child")=${eligibleChild}, eligible("p")=${eligibleParent} (extracted real predicate)`, 'executed',
    'child not eligible while the row is published', { child: eligibleChild, p: eligibleParent });
}

/* ------------------------------------------------------------------ *
 * 4. scenario S2 — control: address retained AND catalog present (must keep the child)
 * ------------------------------------------------------------------ */
{
  const rounds = [
    {
      items: [itemOf('p', { title: 'Parent' })], current: 'child', phase: 'ready',
      subagentsByParent: { p: { state: 'ready', parentAvailable: true, entries: [childEntry('child', 'Child', 'running')] } },
      jobsBySession: {}, currentAddress: { parentSessionId: 'p', childSessionId: 'child', mode: 'view' },
    },
    { // round 2: address retained, catalog retained, label renamed
      items: [itemOf('p', { title: 'Parent' })], current: 'child', phase: 'ready',
      subagentsByParent: { p: { state: 'ready', parentAvailable: true, entries: [childEntry('child', 'ChildRenamed', 'inactive')] } },
      jobsBySession: {}, currentAddress: { parentSessionId: 'p', childSessionId: 'child', mode: 'view' },
    },
  ];
  const runtime = makeRuntime({ rounds, navigation: {} });
  runtime.projectList();
  runtime.__advance();
  runtime.projectList();
  const after = runtime.list.getSnapshot();
  const row = rowOf(after, 'child');
  scenarios.push({
    scenario: 'S2 control — address retained, catalog retained, child renamed',
    current_byId_keys: Object.keys(after.byId),
    row: row ?? null,
    verdict: row === undefined ? 'REGRESSION: child dropped' : row.displayTitle === 'ChildRenamed' ? 'child kept and refreshed' : 'child kept but title stale',
    evidence: 'executed',
  });
  record('S2 control: child row kept while the address still points at it', row !== undefined,
    `displayTitle=${row && row.displayTitle}`, 'executed', 'present', row !== undefined);
  record('S2 control: kept row is refreshed from the live catalog, not frozen at the carried value',
    row !== undefined && row.displayTitle === 'ChildRenamed', `displayTitle=${row && row.displayTitle}`, 'executed',
    'ChildRenamed', row && row.displayTitle);
}

/* ------------------------------------------------------------------ *
 * 5. scenario S3 — control: address retained, catalog ABSENT (the case the carry-forward exists for)
 * ------------------------------------------------------------------ */
{
  const rounds = [
    {
      items: [itemOf('p', { title: 'Parent' })], current: 'child', phase: 'ready',
      subagentsByParent: { p: { state: 'ready', parentAvailable: true, entries: [childEntry('child', 'Child', 'running')] } },
      jobsBySession: {}, currentAddress: { parentSessionId: 'p', childSessionId: 'child', mode: 'view' },
    },
    { // round 2: retained address survives, catalog not (re)loaded this round
      items: [itemOf('p', { title: 'Parent' })], current: 'child', phase: 'ready',
      subagentsByParent: {}, jobsBySession: {},
      currentAddress: { parentSessionId: 'p', childSessionId: 'child', mode: 'view' },
    },
  ];
  const runtime = makeRuntime({ rounds, navigation: { p: undefined } });
  runtime.projectList();
  runtime.__advance();
  runtime.projectList();
  const after = runtime.list.getSnapshot();
  const row = rowOf(after, 'child');
  scenarios.push({
    scenario: 'S3 control — address retained (manager.navigationAddress(p)=undefined, catalog absent)',
    current_byId_keys: Object.keys(after.byId),
    row: row ?? null,
    verdict: row === undefined ? 'REGRESSION: child dropped' : 'child kept (this is the case the carry-forward serves)',
    evidence: 'executed',
  });
  record('S3 control: child row kept from the carried previous projection when the catalog is absent',
    row !== undefined, `displayTitle=${row && row.displayTitle}`, 'executed', 'present', row !== undefined);
}

/* ------------------------------------------------------------------ *
 * 6. scenario S4 — address retargeted to a second child (old child also left behind)
 * ------------------------------------------------------------------ */
{
  const rounds = [
    {
      items: [itemOf('p', { title: 'Parent' })], current: 'child1', phase: 'ready',
      subagentsByParent: { p: { state: 'ready', parentAvailable: true, entries: [childEntry('child1', 'C1', 'running')] } },
      jobsBySession: {}, currentAddress: { parentSessionId: 'p', childSessionId: 'child1', mode: 'view' },
    },
    {
      items: [itemOf('p', { title: 'Parent' })], current: 'child2', phase: 'ready',
      subagentsByParent: { p: { state: 'ready', parentAvailable: true, entries: [childEntry('child2', 'C2', 'running')] } },
      jobsBySession: {}, currentAddress: { parentSessionId: 'p', childSessionId: 'child2', mode: 'view' },
    },
  ];
  const runtime = makeRuntime({ rounds, navigation: {} });
  runtime.projectList();
  runtime.__advance();
  runtime.projectList();
  const after = runtime.list.getSnapshot();
  const both = rowOf(after, 'child1') !== undefined && rowOf(after, 'child2') !== undefined;
  scenarios.push({
    scenario: 'S4 — address retargeted child1 -> child2',
    current_byId_keys: Object.keys(after.byId),
    child1_present: rowOf(after, 'child1') !== undefined,
    child2_present: rowOf(after, 'child2') !== undefined,
    verdict: both ? 'both phantom-ish rows retained: the abandoned child1 row survives the retarget' : 'retarget handled',
    evidence: 'executed',
  });
  record('S4: the abandoned address-chain child row survives an address retarget',
    both, `byId keys = ${JSON.stringify(Object.keys(after.byId))}`, 'executed',
    'only child2', both);
}

/* ------------------------------------------------------------------ *
 * 7. scenario S5 — bound of the defect: any ids change clears the residue
 * ------------------------------------------------------------------ */
{
  const rounds = [
    {
      items: [itemOf('p', { title: 'Parent' })], current: 'child', phase: 'ready',
      subagentsByParent: { p: { state: 'ready', parentAvailable: true, entries: [childEntry('child', 'Child', 'running')] } },
      jobsBySession: {}, currentAddress: { parentSessionId: 'p', childSessionId: 'child', mode: 'view' },
    },
    { // round 2: a second top-level session appears -> sameIdList false -> no carry-forward
      items: [itemOf('p', { title: 'Parent' }), itemOf('q', { title: 'Other' })], current: 'p', phase: 'ready',
      subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
    },
  ];
  const runtime = makeRuntime({ rounds, navigation: {} });
  runtime.projectList();
  runtime.__advance();
  runtime.projectList();
  const after = runtime.list.getSnapshot();
  const cleared = rowOf(after, 'child') === undefined;
  scenarios.push({
    scenario: 'S5 — bound: ids list changes (second top-level session appears)',
    current_ids: after.ids,
    current_byId_keys: Object.keys(after.byId),
    residue_cleared: cleared,
    verdict: cleared ? 'residue clears as soon as the id list changes' : 'residue survives an ids change',
    evidence: 'executed',
  });
  record('S5 (bound): the residue is not permanent — any ids-list change clears it',
    cleared, `ids=${JSON.stringify(after.ids)} byId=${JSON.stringify(Object.keys(after.byId))}`, 'executed',
    'cleared', cleared);
}

/* ------------------------------------------------------------------ *
 * 8. candidate fix P-A (chain-scoped carry-forward) — counterfactual patch on the extracted slice
 * ------------------------------------------------------------------ */
const CARRY_ANCHOR = '\t\t\t\tfor (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0) byId[id] = previousProjection.byId[id];';
const PATCH_A = [
  '\t\t\t\tconst chainNeeded = /* dsh-fix candidate P-A: only rows the live address chain needs */ new Set();',
  '\t\t\t\t{',
  '\t\t\t\t\tconst seenChain = new Set();',
  '\t\t\t\t\tlet chainAddress = current === void 0 ? void 0 : currentAddress;',
  '\t\t\t\t\twhile (chainAddress !== void 0 && !seenChain.has(chainAddress.childSessionId)) {',
  '\t\t\t\t\t\tseenChain.add(chainAddress.childSessionId);',
  '\t\t\t\t\t\tchainNeeded.add(chainAddress.childSessionId);',
  '\t\t\t\t\t\tchainAddress = this.manager.navigationAddress(chainAddress.parentSessionId);',
  '\t\t\t\t\t}',
  '\t\t\t\t}',
  '\t\t\t\tfor (const id of Object.keys(previousProjection.byId)) if (byId[id] === void 0 && chainNeeded.has(id)) byId[id] = previousProjection.byId[id];',
].join('\n');

/* Second leak channel found by P-A's failure: the whole-byId identity reuse.
 * `reusedEntries === liveKeys.length` only says "every live key was reused"; it never says
 * the previous byId had no further keys, so it republishes the previous object wholesale. */
const REUSE_ANCHOR = '\t\t\t\tconst nextById = previousProjection !== void 0 && reusedEntries === liveKeys.length ? previousProjection.byId : stableById;';
const REUSE_PATCHED = '\t\t\t\tconst nextById = previousProjection !== void 0 && reusedEntries === liveKeys.length && Object.keys(previousProjection.byId).length === liveKeys.length ? previousProjection.byId : stableById;';
const CARRY_DELETED = '\t\t\t\t/* candidate P-D: blanket carry-forward removed */';

/** Apply textual candidate patches to the extracted slice; every anchor must be unique. */
function applyCandidatePatch(id, replacements) {
  let text = pieces.projectList.slice;
  for (const [anchor, replacement] of replacements) {
    const count = text.split(anchor).length - 1;
    if (count !== 1) fatal(`candidate ${id}: anchor appears ${count} times inside the extracted projectList, expected exactly 1`);
    text = text.replace(anchor, replacement);
  }
  if (text === pieces.projectList.slice) fatal(`candidate ${id}: patch did not apply`);
  try {
    return new Function(
      'displayTitleOf', 'sameIdList', 'sameJobViewList', 'sameSubagentCatalogs',
      '"use strict";\nclass PatchedHarness {\n' + text + '\n' + pieces.eligible.slice + '\n' + pieces.pruneScopes.slice + '\n}\nreturn PatchedHarness;\n',
    )(displayTitleOf, sameIdList, sameJobViewList, sameSubagentCatalogs);
  } catch (error) {
    fatal(`candidate ${id} did not compile: ${error && error.message}`);
  }
}

const candidates = [
  {
    id: 'P-A',
    description: 'chain-scoped carry-forward only (carry a previous byId row only when the live address chain still names it)',
    klass: applyCandidatePatch('P-A', [[CARRY_ANCHOR, PATCH_A]]),
    expectation: 'PARTIAL: closes the blanket channel but the byId identity reuse republishes the stale key',
    expectedVerdict: 'PARTIAL',
  },
  {
    id: 'P-B',
    description: 'key-set gate on the byId identity reuse only (keep the blanket carry-forward)',
    klass: applyCandidatePatch('P-B', [[REUSE_ANCHOR, REUSE_PATCHED]]),
    expectation: 'REGRESSION: the blanket carry-forward still injects the stale key into liveKeys, so S1 stays unfixed and the S4 abandoned-child leak also survives',
    expectedVerdict: 'REGRESSION',
  },
  {
    id: 'P-AC',
    description: 'chain-scoped carry-forward + key-set gate on the byId identity reuse (the proposed minimal fix)',
    klass: applyCandidatePatch('P-AC', [[CARRY_ANCHOR, PATCH_A], [REUSE_ANCHOR, REUSE_PATCHED]]),
    expectation: 'FULL: drops the residue and keeps every legitimate row',
    expectedVerdict: 'FULL FIX',
  },
  {
    id: 'P-D',
    description: 'delete the carry-forward entirely + key-set gate (shows why deletion is not enough)',
    klass: applyCandidatePatch('P-D', [[CARRY_ANCHOR, CARRY_DELETED], [REUSE_ANCHOR, REUSE_PATCHED]]),
    expectation: 'REGRESSION: the S3 retained-address/no-catalog row is dropped',
    expectedVerdict: 'REGRESSION',
  },
];

function runScenarioWith(Klass, rounds, navigation) {
  const runtime = new Klass();
  runtime.scopes = new Map();
  runtime.deferredRemovals = new Set();
  runtime.list = makeStore({
    ids: [], byId: {}, current: undefined, phase: 'ready',
    subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  });
  runtime.selection = { snapshot: {}, getSnapshot() { return this.snapshot; }, set(v) { this.snapshot = v; } };
  let round = 0;
  runtime.manager = { getListSnapshot: () => rounds[round], navigationAddress: (id) => navigation[id] };
  runtime.projectList();
  round = 1;
  runtime.projectList();
  return runtime.list.getSnapshot();
}

const navNone = {};
const patchChecks = [
  {
    name: 'P-A / S1 (address cleared)',
    rounds: [
      {
        items: [itemOf('p', { title: 'Parent' })], current: 'child', phase: 'ready',
        subagentsByParent: { p: { state: 'ready', parentAvailable: true, entries: [childEntry('child', 'Child', 'running')] } },
        jobsBySession: {}, currentAddress: { parentSessionId: 'p', childSessionId: 'child', mode: 'view' },
      },
      {
        items: [itemOf('p', { title: 'Parent' })], current: 'p', phase: 'ready',
        subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
      },
    ],
    expect: (p) => p.byId.child === undefined,
    want: 'child dropped (residue gone)',
  },
  {
    name: 'P-A / S3 (address retained, catalog absent)',
    rounds: [
      {
        items: [itemOf('p', { title: 'Parent' })], current: 'child', phase: 'ready',
        subagentsByParent: { p: { state: 'ready', parentAvailable: true, entries: [childEntry('child', 'Child', 'running')] } },
        jobsBySession: {}, currentAddress: { parentSessionId: 'p', childSessionId: 'child', mode: 'view' },
      },
      {
        items: [itemOf('p', { title: 'Parent' })], current: 'child', phase: 'ready',
        subagentsByParent: {}, jobsBySession: {},
        currentAddress: { parentSessionId: 'p', childSessionId: 'child', mode: 'view' },
      },
    ],
    expect: (p) => p.byId.child !== undefined,
    want: 'child kept (the carry-forward case still works)',
  },
  {
    name: 'P-A / S2 (address retained, catalog present, renamed)',
    rounds: [
      {
        items: [itemOf('p', { title: 'Parent' })], current: 'child', phase: 'ready',
        subagentsByParent: { p: { state: 'ready', parentAvailable: true, entries: [childEntry('child', 'Child', 'running')] } },
        jobsBySession: {}, currentAddress: { parentSessionId: 'p', childSessionId: 'child', mode: 'view' },
      },
      {
        items: [itemOf('p', { title: 'Parent' })], current: 'child', phase: 'ready',
        subagentsByParent: { p: { state: 'ready', parentAvailable: true, entries: [childEntry('child', 'ChildRenamed', 'inactive')] } },
        jobsBySession: {}, currentAddress: { parentSessionId: 'p', childSessionId: 'child', mode: 'view' },
      },
    ],
    expect: (p) => p.byId.child !== undefined && p.byId.child.displayTitle === 'ChildRenamed',
    want: 'child kept and refreshed',
  },
  {
    name: 'P-A / S4 (address retargeted)',
    rounds: [
      {
        items: [itemOf('p', { title: 'Parent' })], current: 'child1', phase: 'ready',
        subagentsByParent: { p: { state: 'ready', parentAvailable: true, entries: [childEntry('child1', 'C1', 'running')] } },
        jobsBySession: {}, currentAddress: { parentSessionId: 'p', childSessionId: 'child1', mode: 'view' },
      },
      {
        items: [itemOf('p', { title: 'Parent' })], current: 'child2', phase: 'ready',
        subagentsByParent: { p: { state: 'ready', parentAvailable: true, entries: [childEntry('child2', 'C2', 'running')] } },
        jobsBySession: {}, currentAddress: { parentSessionId: 'p', childSessionId: 'child2', mode: 'view' },
      },
    ],
    expect: (p) => p.byId.child1 === undefined && p.byId.child2 !== undefined,
    want: 'only child2 kept',
  },
];
const patchResults = [];
for (const candidate of candidates) {
  const candidateChecks = [];
  for (const check of patchChecks) {
    const scenarioLabel = check.name.replace(/^[^/]*\/\s*/, '');
    const before = runScenarioWith(H, check.rounds, navNone);
    const after = runScenarioWith(candidate.klass, check.rounds, navNone);
    const okBefore = check.expect(before);
    const okAfter = check.expect(after);
    candidateChecks.push({
      scenario: scenarioLabel,
      expectation: check.want,
      unpatched_ok: okBefore,
      patched_ok: okAfter,
      unpatched_byId_keys: Object.keys(before.byId),
      patched_byId_keys: Object.keys(after.byId),
    });
  }
  const fixesReportedDefect = candidateChecks[0].patched_ok === true && candidateChecks[0].unpatched_ok === false;
  const keepsControls = candidateChecks.slice(1).every((r) => r.patched_ok === true);
  const verdict = fixesReportedDefect && keepsControls ? 'FULL FIX'
    : candidateChecks.slice(1).some((r) => r.patched_ok === false) ? 'REGRESSION'
      : 'PARTIAL';
  patchResults.push({
    id: candidate.id,
    description: candidate.description,
    predicted: candidate.expectation,
    checks: candidateChecks,
    fixes_reported_defect: fixesReportedDefect,
    keeps_controls: keepsControls,
    verdict,
    evidence: 'executed',
  });
  record(`candidate ${candidate.id} behaved as predicted -> ${verdict} (predicted ${candidate.expectedVerdict})`,
    verdict === candidate.expectedVerdict,
    `fixes S1=${fixesReportedDefect}, keeps S2/S3/S4=${keepsControls}; S1 byId after patch = ${JSON.stringify(candidateChecks[0].patched_byId_keys)}`,
    'executed', candidate.expectedVerdict, verdict);
}

const fullFix = patchResults.find((r) => r.verdict === 'FULL FIX');
results.candidatePatches = {
  anchors: { carryForward: CARRY_ANCHOR.trim(), byIdIdentityReuse: REUSE_ANCHOR.trim() },
  chainScopedCarryReplacement: PATCH_A.split('\n').map((l) => l.replace(/^\t+/, '')).join('\n'),
  keySetGateReplacement: REUSE_PATCHED.trim(),
  candidates: patchResults,
  minimal_fix: fullFix === undefined ? null : {
    id: fullFix.id,
    description: fullFix.description,
    scope: '2 edits inside SessionRuntime.projectList',
    validated_by: 'same harness scenarios as the unpatched code',
  },
};

/* ------------------------------------------------------------------ *
 * 9. emit
 * ------------------------------------------------------------------ */
results.codeInferenceNotes = [
  {
    claim: 'The residual row is reachable by real consumers, but it is not rendered as a top-level row: row enumeration walks list.ids while every descendant aggregation walks list.byId.',
    evidence: 'code-inference',
    anchors: [
      'dsh-client-ui-workspace/lib/client.js:194,224,253 `const descendants = indexSubagentDescendants(list.byId);` (deriveGroups/deriveFlat/deriveSearchResults)',
      'dsh-client-ui-workspace/lib/client.js:226,260 `for (const id of list.ids) { const s = list.byId[id]; ... }` (rows come from ids)',
      'dsh-client-ui-workspace/lib/client.js:171,286 `runningSubagentCount: typeof s.runningSubagentCount === "number" ? s.runningSubagentCount : (descendants.get(s.id)?.runningCount ?? 0)` (byId-derived fallback feeds the sidebar badge)',
      'dsh-client-ui-subagent/lib/client.js:397 `const summaries = useSessions((state) => state.byId);` and :415 `indexSubagentDescendants(summaries)`',
      'dsh-client-ui-subagent/lib/client.js:176-177 `const children = Object.values(summaries).filter((summary) => summary.origin === "subagent" && summary.parentId === parentSessionId);` (catalog loading rows enumerate byId)',
    ],
    consequence: 'While the id list is unchanged, a phantom child row inflates the byId-derived descendant/running aggregates and the subagent catalog rows for its parent, and keeps a frozen `running` flag from the last round it was live.',
  },
  {
    claim: 'projectList also validates `byId[current] !== void 0` before republishing the selection, so a residual row can keep a stale selection alive.',
    evidence: 'code-inference',
    anchors: ['client.js:9366 `} else if (byId[current] !== void 0 && (persisted !== current || ...)) this.selection.set({`'],
  },
  {
    claim: 'The P2 projection is a pure client-side reuse optimization: it does not change what the host sent, only object identity and (in the buggy paths) key sets.',
    evidence: 'code-inference',
    anchors: ['client.js:9322-9327 marker `/* dsh-perf-fix P2 v1 */`', 'client.js:9340 `const nextById = previousProjection !== void 0 && reusedEntries === liveKeys.length ? previousProjection.byId : stableById;`'],
  },
];

results.target = { path: TARGET, sha256: observedSha, lines: source.split('\n').length };
results.extractionProof = extractionProof;
results.storeContractEvidence = storeContractEvidence;
results.scenarios = scenarios;
results.findings = findings;
results.summary = {
  p2_stale_row_reproduced: scenarios[0].stale_row_present === true,
  p2_stale_row_is_true_defect: scenarios[0].stale_row_present === true
    && scenarios[1].row !== undefined && scenarios[2].row !== undefined,
  residue_consumed_by_client_indexSubagentDescendants: scenarios[0].client_indexSubagentDescendants_for_p !== null,
  residue_bounded_by_ids_change: scenarios[4].residue_cleared === true,
  leak_channels: 2,
  candidate_fix_validated: results.candidatePatches.minimal_fix !== null
    ? results.candidatePatches.minimal_fix.id : false,
  evidence_split: { executed_assertions: findings.filter((f) => f.evidence === 'executed').length, code_inference_notes: 1 },
};
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_JSON, `${JSON.stringify(results, null, 2)}\n`);
process.stdout.write(`\nraw json: ${OUT_JSON}\n`);
const failed = findings.filter((f) => f.status === 'FAIL');
process.stdout.write(`assertions: ${findings.length - failed.length} PASS / ${failed.length} FAIL\n`);
process.exit(0);
