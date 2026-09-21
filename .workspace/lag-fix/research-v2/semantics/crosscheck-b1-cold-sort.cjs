#!/usr/bin/env node
'use strict';
/**
 * Independent cross-check for B① (cold-path "most recent 200" candidate selection).
 * Extracts, byte-exactly and from the live artifacts:
 *   - `fromHeaderLine` / `isHeaderLine` from dsh-session-persistence-jsonl/lib/index.js
 *     (the function that actually produces the meta shape `persistence.list()` returns),
 *   - the cold-candidate block (const coldSource … .slice(0, SUBAGENT_LIST_MAX);) from
 *     dsh-host-apiproxy/lib/index.js,
 *   - the comparator expression inside that block.
 * Then it runs the real pipeline over real-shape cold metas under two different
 * enumeration orders. Offline, read-only, deterministic. Exit 1 only on self-proof failure.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HOST = '/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js';
const PERSIST = '/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js';
const PIN_HOST = '1b9915f505996912c6f49b12b0c3f4a8261a74f26422f68f5d22cab2bc078a62';
const PIN_PERSIST = '8b6ebc4509a3e969ab3ad6e0dfb553ae4861e5b101831afed23e593d148d97f3';
const OUT = path.join(__dirname, 'results', 'b1-cold-sort-crosscheck.json');
const lines = [];
const out = (s) => { lines.push(s); process.stdout.write(`${s}\n`); };
const die = (s) => { process.stderr.write(`SELF-PROOF FAILURE: ${s}\n`); process.exit(1); };

const hostSrc = fs.readFileSync(HOST, 'utf8');
const persistSrc = fs.readFileSync(PERSIST, 'utf8');
const shaHost = crypto.createHash('sha256').update(hostSrc, 'utf8').digest('hex');
const shaPersist = crypto.createHash('sha256').update(persistSrc, 'utf8').digest('hex');
if (shaHost !== PIN_HOST) die(`host sha256 mismatch: ${shaHost}`);
if (shaPersist !== PIN_PERSIST) die(`persistence sha256 mismatch: ${shaPersist}`);
out(`self-proof: pinned sha256 for both artifacts (host ${shaHost.slice(0, 12)}…, persistence ${shaPersist.slice(0, 12)}…)`);

function match(text, openIdx) {
  const open = text[openIdx];
  const close = { '{': '}', '(': ')', '[': ']' }[open];
  let depth = 0; let i = openIdx; let prev = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); if (i < 0) break; continue; }
    if (ch === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); if (e < 0) die('comment'); i = e + 2; continue; }
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
const lineOf = (text, o) => text.slice(0, o).split('\n').length;

function sliceFn(text, name) {
  const anchor = `function ${name}(`;
  if (text.split(anchor).length !== 2) die(`anchor ${anchor} count != 1`);
  const start = text.indexOf(anchor);
  const end = match(text, text.indexOf('{', start));
  return { slice: text.slice(start, end), start, end };
}
function sliceRange(text, from, to) {
  const a = text.indexOf(from);
  if (a < 0 || text.indexOf(from, a + 1) >= 0) die(`needle not unique: ${from.slice(0, 48)}`);
  const b = text.indexOf(to, a);
  if (b < 0) die(`end needle missing: ${to.slice(0, 48)}`);
  const end = b + to.length;
  return { slice: text.slice(a, end), start: a, end };
}

const fromHeaderLine = sliceFn(persistSrc, 'fromHeaderLine');
const isHeaderLine = sliceFn(persistSrc, 'isHeaderLine');
const coldBlock = sliceRange(hostSrc,
  'const coldSource = (await persistence.list(signal));',
  '.slice(0, SUBAGENT_LIST_MAX);');
const maxConst = sliceRange(hostSrc, 'const SUBAGENT_LIST_MAX = ', ': 200;');

out(`self-proof: slices — fromHeaderLine @persistence:${lineOf(persistSrc, fromHeaderLine.start)}, isHeaderLine @persistence:${lineOf(persistSrc, isHeaderLine.start)}, cold-candidate block @host:${lineOf(hostSrc, coldBlock.start)}-${lineOf(hostSrc, coldBlock.end)} (${coldBlock.slice.length}B)`);

const headerApi = new Function(`${fromHeaderLine.slice}\n${isHeaderLine.slice}\nreturn { fromHeaderLine, isHeaderLine };`)();
const SUBAGENT_LIST_MAX = new Function(`${maxConst.slice}\nreturn SUBAGENT_LIST_MAX;`)();
if (SUBAGENT_LIST_MAX !== 200) die(`SUBAGENT_LIST_MAX = ${SUBAGENT_LIST_MAX}`);

/* The real header line shape written by the persistence layer. */
const headerLine = {
  type: 'session', version: 0, id: 's1', createdAt: 1_700_000_000_000,
  cwd: '/home/dev/project', parentSession: 'p-root', delegationDepth: 1, origin: 'subagent',
  agentPreset: 'standard-glm',
};
if (!headerApi.isHeaderLine(headerLine)) die('fixture rejected by the real isHeaderLine');
const realMeta = headerApi.fromHeaderLine(headerLine);
out(`real meta produced by the extracted fromHeaderLine: keys = [${Object.keys(realMeta).join(', ')}]`);
if (Object.hasOwn(realMeta, 'updatedAt')) die('real meta unexpectedly carries updatedAt');
out('PASS  real cold meta has NO updatedAt key (executed through the real fromHeaderLine)');

/* Comparator expression, taken out of the live sort call. */
const cmpMatch = /\(a, b\) => (b\.updatedAt - a\.updatedAt)/.exec(coldBlock.slice);
if (cmpMatch === null) die('comparator expression not found inside the extracted cold-candidate block');
const comparator = new Function(`return (a, b) => ${cmpMatch[1]};`)();
const nan = comparator({ id: 'x', createdAt: 1 }, { id: 'y', createdAt: 2 });
out(`comparator (extracted verbatim from host:${lineOf(hostSrc, coldBlock.start)}) on two real-shape metas returns ${nan}`);
if (!Number.isNaN(nan)) die(`expected NaN from the real comparator, got ${nan}`);

/* The real pipeline, run under two enumeration orders. */
const coldFn = new Function('persistence', 'signal', 'SUBAGENT_LIST_MAX',
  `return (async () => { ${coldBlock.slice}\nreturn coldSubagentCandidates; })();`);

function realMetaFor(i) {
  return headerApi.fromHeaderLine({
    type: 'session', version: 0, id: `cold-${String(i).padStart(3, '0')}`, createdAt: 1_700_000_000_000 + i,
    cwd: '/home/dev/project', parentSession: 'p-root', delegationDepth: 1, origin: 'subagent', agentPreset: 'standard-glm',
  });
}
const ascending = [];
for (let i = 1; i <= 201; i += 1) ascending.push(realMetaFor(i));
const descending = [...ascending].reverse();
const permuted = [];
for (let i = 0; i < ascending.length; i += 1) permuted.push(ascending[(i * 7) % ascending.length]);

async function select(metas) {
  const persistence = { list: async () => metas };
  const picked = await coldFn(persistence, undefined, SUBAGENT_LIST_MAX);
  return picked.map((m) => m.id);
}

(async () => {
  const pickAsc = await select(ascending);
  const pickDesc = await select(descending);
  const pickPerm = await select(permuted);
  const droppedAsc = ascending.filter((m) => !pickAsc.includes(m.id)).map((m) => m.id);
  const droppedDesc = ascending.filter((m) => !pickDesc.includes(m.id)).map((m) => m.id);
  const droppedPerm = ascending.filter((m) => !pickPerm.includes(m.id)).map((m) => m.id);
  const result = {
    host: { path: HOST, sha256: shaHost },
    persistence: { path: PERSIST, sha256: shaPersist },
    extraction: {
      fromHeaderLineLine: lineOf(persistSrc, fromHeaderLine.start),
      coldBlockLines: [lineOf(hostSrc, coldBlock.start), lineOf(hostSrc, coldBlock.end)],
      comparatorSource: cmpMatch[1],
      subagentListMaxEvaluated: SUBAGENT_LIST_MAX,
    },
    realHeaderMetaKeys: Object.keys(realMeta),
    real_meta_has_updatedAt: Object.hasOwn(realMeta, 'updatedAt'),
    comparator_returns_NaN: Number.isNaN(nan),
    selection: {
      enumeration_ascending: {
        picked_count: pickAsc.length,
        dropped_ids: droppedAsc,
        dropped_createdAt_rank: droppedAsc.map((id) => Number(id.slice('cold-'.length))),
        picked_max_createdAt_rank: Math.max(...pickAsc.map((id) => Number(id.slice('cold-'.length)))),
      },
      enumeration_descending: {
        picked_count: pickDesc.length,
        dropped_ids: droppedDesc,
        dropped_createdAt_rank: droppedDesc.map((id) => Number(id.slice('cold-'.length))),
      },
      enumeration_permuted_stride7: {
        picked_count: pickPerm.length,
        dropped_ids: droppedPerm,
        dropped_createdAt_rank: droppedPerm.map((id) => Number(id.slice('cold-'.length))),
      },
    },
    sort_key_holds_on_real_shape: false,
    degenerate_behaviour: 'NaN comparator => ToNumber NaN treated as +0 by Array.prototype.sort => the sort is a no-op and the selection equals the enumeration order returned by persistence.list() (readdir order, unsorted)',
    selected_set_varies_with_enumeration_order: new Set([droppedAsc.join(), droppedDesc.join(), droppedPerm.join()]).size > 1,
    evidence: 'executed',
  };
  out(`ascending enumeration: picked ${pickAsc.length}, dropped = ${JSON.stringify(droppedAsc)} (createdAt rank; 201 = newest by createdAt)`);
  out(`descending enumeration: picked ${pickDesc.length}, dropped = ${JSON.stringify(droppedDesc)}`);
  out(`permuted (stride 7) enumeration: picked ${pickPerm.length}, dropped = ${JSON.stringify(droppedPerm)}`);
  out(`selected set depends on enumeration order: ${result.selected_set_varies_with_enumeration_order}`);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  out(`raw json: ${OUT}`);
  if (!result.selected_set_varies_with_enumeration_order) die('expected the selection to depend on enumeration order');
})();
