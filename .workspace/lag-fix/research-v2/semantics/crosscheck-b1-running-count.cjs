#!/usr/bin/env node
'use strict';
/**
 * Independent cross-check for B② (top-level runningSubagentCount undercount).
 * Purpose: do not let the B1 verdict rest on a single harness. This script is written
 * from scratch (different extraction scaffolding from harness-b1-*) and drives the
 * byte-exact live `annotateRunningSubagentCounts` plus the byte-exact live final-cut
 * block. Offline, read-only, deterministic. Exit 1 only if the self-proof fails.
 */
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const HOST = '/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js';
const PIN = '1b9915f505996912c6f49b12b0c3f4a8261a74f26422f68f5d22cab2bc078a62';
const OUT = path.join(__dirname, 'results', 'b1-running-count-crosscheck.json');
const lines = [];

function out(s) { lines.push(s); process.stdout.write(`${s}\n`); }
function die(s) { process.stderr.write(`SELF-PROOF FAILURE: ${s}\n`); process.exit(1); }

const src = fs.readFileSync(HOST, 'utf8');
const sha = crypto.createHash('sha256').update(src, 'utf8').digest('hex');
if (sha !== PIN) die(`host sha256 ${sha} != pinned ${PIN}`);

/** Bracket matcher that skips strings/templates/comments/regex. */
function match(text, openIdx) {
  const open = text[openIdx];
  const close = { '{': '}', '(': ')', '[': ']' }[open];
  let depth = 0; let i = openIdx; let prev = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); if (i < 0) break; continue; }
    if (ch === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); if (e < 0) die('unterminated comment'); i = e + 2; continue; }
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch; i += 1;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === q) { i += 1; break; }
        if (q === '`' && text[i] === '$' && text[i + 1] === '{') { i = match(text, i + 1); continue; }
        i += 1;
      }
      prev = q; continue;
    }
    if (ch === '/' && '(,=:[!&|?{};+-*%~^<>'.includes(prev)) {
      let j = i + 1; let cls = false;
      while (j < text.length) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === '[') cls = true; else if (text[j] === ']') cls = false;
        else if (text[j] === '/' && !cls) break; else if (text[j] === '\n') die('newline in regex');
        j += 1;
      }
      i = j + 1; prev = '/'; continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) { depth -= 1; if (depth === 0) return i + 1; }
    if (!/\s/.test(ch)) prev = ch;
    i += 1;
  }
  die(`unbalanced ${open}`);
}

function sliceFunction(name) {
  const anchor = `function ${name}(`;
  if (src.split(anchor).length !== 2) die(`anchor ${anchor} count != 1`);
  const start = src.indexOf(anchor);
  const end = match(src, src.indexOf('{', start));
  const slice = src.slice(start, end);
  if (src.slice(start, end) !== slice) die(`byte identity ${name}`);
  return { slice, start, end };
}
function sliceRange(fromNeedle, toNeedle, inclusiveEnd) {
  const a = src.indexOf(fromNeedle);
  if (a < 0 || src.indexOf(fromNeedle, a + 1) >= 0) die(`needle not unique: ${fromNeedle.slice(0, 40)}`);
  const b = src.indexOf(toNeedle, a);
  if (b < 0) die(`end needle missing: ${toNeedle.slice(0, 40)}`);
  const end = b + toNeedle.length;
  const slice = src.slice(a, end);
  if (!slice.includes(fromNeedle) || !slice.includes(toNeedle)) die('range slice incomplete');
  if (inclusiveEnd === false) die('unused');
  return { slice, start: a, end };
}
const lineOf = (o) => src.slice(0, o).split('\n').length;

const annotate = sliceFunction('annotateRunningSubagentCounts');
const sessionListUpdatedAt = sliceFunction('sessionListUpdatedAt');
const cut = sliceRange(
  'items.sort((a, b) => b.updatedAt - a.updatedAt);',
  'return annotateRunningSubagentCounts(ctx, retained);',
);
const maxConst = sliceRange('const SUBAGENT_LIST_MAX = ', ': 200;');
const attachedKeep = sliceRange(
  'const attachedSubagents = attachedSessions.filter((session) => session.header.origin === "subagent");',
  'for (const session of attachedSubagents.slice(0, SUBAGENT_LIST_MAX)) keep.add(session.id);',
);

out(`self-proof: host sha256 pinned (${sha.slice(0, 16)}…)`);
out(`self-proof: slices — annotate @line ${lineOf(annotate.start)} (${annotate.slice.length}B), final-cut @line ${lineOf(cut.start)} (${cut.slice.length}B), SUBAGENT_LIST_MAX @line ${lineOf(maxConst.start)}, attached-keep @line ${lineOf(attachedKeep.start)}`);
if (!annotate.slice.includes('const childrenOf = new Map();')) die('annotate slice lacks childrenOf');
if (!annotate.slice.includes('for (const session of ctx.sessions.list()) liveStatus.set(session.id, ctx.agents.get(session.id)?.status === "running");')) die('annotate slice lacks liveStatus pass');
if (!cut.slice.includes('const subagentItems = items.filter((item) => item.origin === "subagent");')) die('cut slice lacks subagentItems');
if (!cut.slice.includes('const overflow = subagentItems.slice(SUBAGENT_LIST_MAX);')) die('cut slice lacks overflow');

const SUBAGENT_LIST_MAX = new Function(`${maxConst.slice}\nreturn SUBAGENT_LIST_MAX;`)();
if (SUBAGENT_LIST_MAX !== 200) die(`SUBAGENT_LIST_MAX evaluated to ${SUBAGENT_LIST_MAX}, expected 200`);

const annotateFn = new Function(`${annotate.slice}\nreturn annotateRunningSubagentCounts;`)();
if (!annotateFn.toString().includes('if (item.origin === "subagent") continue;')) die('annotate runtime source lost the subagent skip');
out('self-proof: runtime annotateRunningSubagentCounts().toString() carries the extracted body');

const cutFn = new Function('items', 'ctx', 'annotateRunningSubagentCounts', 'SUBAGENT_LIST_MAX',
  `${cut.slice}\n`);
out(`self-proof: final-cut block extracted @line ${lineOf(cut.start)}-${lineOf(cut.end)}`);

/* ---- fixture: real row shape (sessionListFields + summarize) ---- */
function topRow(id, over) {
  return { sessionId: id, updatedAt: 1_000_000, running: false, blank: false, cwd: `/home/dev/${id}`, ...over };
}
function subRow(id, parentId, updatedAt, running) {
  return { sessionId: id, updatedAt, running, blank: false, cwd: `/home/dev/${id}`, parentSessionId: parentId, origin: 'subagent' };
}

function makeCtx(runningIds) {
  const ids = new Set(runningIds);
  return {
    sessions: { list: () => [...runningIds, 'p', 'q'].map((id) => ({ id })) },
    agents: { get: (id) => (ids.has(id) ? { status: 'running' } : { status: 'idle' }) },
  };
}

const results = { host: HOST, sha256: sha, extraction: {
  annotate: { line: lineOf(annotate.start), bytes: annotate.slice.length },
  finalCut: { line: lineOf(cut.start), bytes: cut.slice.length },
  attachedKeep: { line: lineOf(attachedKeep.start) },
  subagentListMaxEvaluated: SUBAGENT_LIST_MAX,
}, checks: [], evidence: 'executed' };

function scenario(label, items, runningIds) {
  const ctx = makeCtx(runningIds);
  const truncated = cutFn(items.map((r) => ({ ...r })), ctx, annotateFn, SUBAGENT_LIST_MAX);
  const untruncated = annotateFn(ctx, items.map((r) => ({ ...r })));
  const parentTrunc = truncated.find((r) => r.sessionId === 'p');
  const parentUntrunc = untruncated.find((r) => r.sessionId === 'p');
  const rec = {
    label,
    rows_in: items.length,
    subagent_rows_in: items.filter((r) => r.origin === 'subagent').length,
    rows_out: truncated.length,
    subagent_rows_out: truncated.filter((r) => r.origin === 'subagent').length,
    dropped_subagent_ids: items.filter((r) => r.origin === 'subagent' && !truncated.some((t) => t.sessionId === r.sessionId)).map((r) => r.sessionId).slice(0, 5),
    top_level_runningSubagentCount_after_cut: parentTrunc.runningSubagentCount,
    top_level_runningSubagentCount_without_cut: parentUntrunc.runningSubagentCount,
    evidence: 'executed',
  };
  results.checks.push(rec);
  out(`${label}: rows ${rec.rows_in}->${rec.rows_out}, subagent ${rec.subagent_rows_in}->${rec.subagent_rows_out}, p.runningSubagentCount after cut = ${rec.top_level_runningSubagentCount_after_cut} (without cut = ${rec.top_level_runningSubagentCount_without_cut})`);
  return rec;
}

/* 201 subagents on top-level p; the 201st (oldest) is running. */
const rows201 = [topRow('p')];
for (let i = 1; i <= 200; i += 1) rows201.push(subRow(`s${i}`, 'p', 2_000_000 + i, false));
rows201.push(subRow('s201_running', 'p', 1, true)); // oldest => cut first
const a = scenario('201 subagents, the 201st is running and parented to top-level p', rows201, ['s201_running']);

/* control: the running row is the newest. */
const rows201b = [topRow('p')];
for (let i = 1; i <= 200; i += 1) rows201b.push(subRow(`t${i}`, 'p', 1_000_000 + i, false));
rows201b.push(subRow('t201_running', 'p', 9_000_000, true));
const b = scenario('control: 201 subagents, the running one is the newest', rows201b, ['t201_running']);

/* two-level chain: p -> a(running, kept) -> c(running, cut) */
const chain = [topRow('p'), subRow('a', 'p', 9_000_000, true)];
for (let i = 1; i <= 200; i += 1) chain.push(subRow(`c${i}`, 'p', 1_000_000 + i, false));
chain.push(subRow('c201_running', 'p', 1, true));
const c = scenario('two-level: running grandchild c201_running is cut while its parent a survives', chain, ['a', 'c201_running']);

/* attached-path keep set: does slice(0, N) pin a running-but-old attached subagent? */
const attachedKeepFn = new Function('attachedSessions', 'sessionListMetadata', 'SUBAGENT_LIST_MAX',
  `${sessionListUpdatedAt.slice}\n${attachedKeep.slice}\nreturn keep;`);
const attachedSessions = [
  { id: 'old_running', header: { origin: 'subagent', createdAt: 1 }, events: { lastPromptAt: 1 } },
  { id: 'new_a', header: { origin: 'subagent', createdAt: 9 }, events: { lastPromptAt: 9 } },
  { id: 'new_b', header: { origin: 'subagent', createdAt: 8 }, events: { lastPromptAt: 8 } },
  { id: 'top', header: { createdAt: 5 }, events: { lastPromptAt: 5 } },
];
const keepSet = attachedKeepFn(attachedSessions, (events) => ({ blank: false, lastPromptAt: events?.lastPromptAt ?? 0 }), 2);
results.attachedKeep = {
  sliceLine: lineOf(attachedKeep.start),
  sliceSource: attachedKeep.slice.split('\n').map((l) => l.trim()).join(' '),
  evaluated: true,
  kept_ids: [...keepSet],
  running_old_subagent_kept: keepSet.has('old_running'),
  note: 'slice(0, SUBAGENT_LIST_MAX) takes the N most-recent attached subagents; the attached path has no running-exemption, so an old-but-running attached subagent can be dropped before items are built.',
  evidence: 'executed',
};
out(`attached-keep (SUBAGENT_LIST_MAX=2 over 3 attached subagents, the oldest one running): kept = ${JSON.stringify(results.attachedKeep.kept_ids)}`);

/* Channel 2: the attached keep-set drops the running subagent BEFORE items are built,
 * so no annotation timing can recover the edge — the row never enters `items`. */
const sessionsForKeep = [
  { id: 'p', header: { createdAt: 5 }, events: { lastPromptAt: 5 } },
  { id: 'new_a', header: { origin: 'subagent', parentSession: 'p', createdAt: 9 }, events: { lastPromptAt: 9 } },
  { id: 'new_b', header: { origin: 'subagent', parentSession: 'p', createdAt: 8 }, events: { lastPromptAt: 8 } },
  { id: 'old_running', header: { origin: 'subagent', parentSession: 'p', createdAt: 1 }, events: { lastPromptAt: 1 } },
];
const keep2 = attachedKeepFn(sessionsForKeep, (events) => ({ blank: false, lastPromptAt: events?.lastPromptAt ?? 0 }), 2);
const itemsFromKeep = sessionsForKeep.filter((s) => keep2.has(s.id)).map((s) => ({
  sessionId: s.id,
  updatedAt: s.header.createdAt,
  running: false,
  blank: false,
  cwd: `/home/dev/${s.id}`,
  ...s.header.parentSession === void 0 ? {} : { parentSessionId: s.header.parentSession },
  ...s.header.origin === void 0 ? {} : { origin: s.header.origin },
}));
const ctxKeep = {
  sessions: { list: () => sessionsForKeep.map((s) => ({ id: s.id })) },
  agents: { get: (id) => ({ status: id === 'old_running' ? 'running' : 'idle' }) },
};
const annotatedFromKeep = annotateFn(ctxKeep, itemsFromKeep.map((r) => ({ ...r })));
const pFromKeep = annotatedFromKeep.find((r) => r.sessionId === 'p');
results.attachedKeepChannel = {
  kept_ids: [...keep2],
  dropped_ids: sessionsForKeep.filter((s) => !keep2.has(s.id)).map((s) => s.id),
  items_built: itemsFromKeep.length,
  top_level_runningSubagentCount: pFromKeep.runningSubagentCount,
  running_dropped_session: 'old_running',
  note: 'the dropped session is live and reported running by ctx.sessions.list()/ctx.agents; the row never reaches items, so annotating before the final cut cannot see the edge either',
  evidence: 'executed',
};
out(`attached keep-set channel: items=${itemsFromKeep.length}, p.runningSubagentCount=${pFromKeep.runningSubagentCount} while the dropped id old_running is live+running`);

results.verdict = {
  b2_undercount_confirmed: a.top_level_runningSubagentCount_after_cut === 0 && a.top_level_runningSubagentCount_without_cut === 1,
  newest_running_control_ok: b.top_level_runningSubagentCount_after_cut === 1,
  cause: 'edges are built from the already-truncated rows (childrenOf), while live status comes from the full ctx.sessions.list()',
  attached_path_has_running_exemption: results.attachedKeep.running_old_subagent_kept === true,
  attached_keep_channel_undercounts: results.attachedKeepChannel.top_level_runningSubagentCount === 0,
  drop_channels: ['final-cut overflow (items already built)', 'attached keep-set slice(0, SUBAGENT_LIST_MAX) (row never enters items)'],
};
out(`verdict: undercount_confirmed=${results.verdict.b2_undercount_confirmed} newest_running_control_ok=${results.verdict.newest_running_control_ok} attached_path_running_exemption=${results.verdict.attached_path_has_running_exemption}`);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(results, null, 2)}\n`);
out(`raw json: ${OUT}`);
