// READ-ONLY census of session headers under ~/.dsh/sessions.
// Reads only the first zstd frame's first line (the session header) per session dir.
import { readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ROOT = join(homedir(), '.dsh', 'sessions');
const out = [];
const dirs = [];
for (const ws of readdirSync(ROOT)) {
  const wsp = join(ROOT, ws);
  let st;
  try { st = statSync(wsp); } catch { continue; }
  if (!st.isDirectory()) continue;
  for (const sid of readdirSync(wsp)) dirs.push({ ws, sid, dir: join(wsp, sid) });
}

let skipped = 0;
const BATCH = 200;
for (let i = 0; i < dirs.length; i += BATCH) {
  const batch = dirs.slice(i, i + BATCH);
  const files = [];
  for (const d of batch) {
    const f = join(d.dir, 'session.jsonl.zstd');
    try { if (statSync(f).isFile()) files.push({ ...d, file: f }); else skipped++; }
    catch { skipped++; }
  }
  if (files.length === 0) continue;
  // One zstd -dc per file; head -c 4000 keeps only the header line, then zstd exits on SIGPIPE.
  const res = spawnSync('bash', ['-c',
    files.map(f => `printf '%s\\t' ${JSON.stringify(f.file)}; zstd -dc ${JSON.stringify(f.file)} 2>/dev/null | head -c 4000 | head -n 1`).join('\n')
  ], { maxBuffer: 1024 * 1024 * 64, encoding: 'utf8' });
  const lines = (res.stdout ?? '').split('\n');
  const byPath = new Map(files.map(f => [f.file, f]));
  for (const line of lines) {
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    const path = line.slice(0, tab);
    const meta = byPath.get(path);
    if (meta === undefined) continue;
    let h = null;
    try { h = JSON.parse(line.slice(tab + 1)); } catch { h = null; }
    out.push({
      ws: meta.ws, sid: meta.sid,
      id: h?.id, parent: h?.parentSession, origin: h?.origin,
      createdAt: h?.createdAt, cwd: h?.cwd, depth: h?.delegationDepth,
      parse: h !== null,
    });
  }
}

const byId = new Map();
for (const r of out) if (typeof r.id === 'string') byId.set(r.id, r);
// Session ids on disk are bare uuids; parentSession is usually "session-<uuid>".
const norm = (v) => (typeof v === 'string' ? v.replace(/^session-/, '') : v);
const ids = new Set([...byId.keys()].map(norm));

const subagents = out.filter(r => r.origin === 'subagent');
const orphans = subagents.filter(r => r.parent === undefined || !ids.has(norm(r.parent)));
const parMissing = subagents.filter(r => r.parent !== undefined && !ids.has(norm(r.parent)));
const noParentField = subagents.filter(r => r.parent === undefined);

// Parent origins
let parentIsSubagent = 0, parentIsTop = 0;
for (const r of subagents) {
  if (r.parent === undefined) continue;
  const p = byId.get(norm(r.parent)) ?? byId.get(r.parent);
  if (p === undefined) continue;
  if (p.origin === 'subagent') parentIsSubagent++; else parentIsTop++;
}

// Subagent counts per top-level root
const rootOf = (r) => {
  const seen = new Set(); let cur = r;
  while (cur !== undefined && cur.parent !== undefined) {
    const p = byId.get(norm(cur.parent)) ?? byId.get(cur.parent);
    if (p === undefined || seen.has(p.id)) return p === undefined ? null : p.id;
    seen.add(p.id); cur = p;
  }
  return cur?.id ?? null;
};
const roots = new Map();
let rootUnresolved = 0;
for (const r of subagents) {
  const root = rootOf(r);
  if (root === null) { rootUnresolved++; continue; }
  roots.set(root, (roots.get(root) ?? 0) + 1);
}
const topRuns = [...roots.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

const summary = {
  sessionDirs: dirs.length,
  headersParsed: out.length,
  unparsedHeaders: out.filter(r => !r.parse).length,
  skippedNoArtifact: skipped,
  topLevel: out.filter(r => r.origin !== 'subagent').length,
  subagents: subagents.length,
  subagentMissingParentField: noParentField.length,
  subagentParentNotOnDisk: parMissing.length,
  subagentParentIsSubagent: parentIsSubagent,
  subagentParentIsTopLevel: parentIsTop,
  subagentRootUnresolved: rootUnresolved,
  distinctRootsForSubagents: roots.size,
  topRootsBySubagentCount: topRuns,
  oldestCreatedAt: Math.min(...out.map(r => r.createdAt ?? Infinity)),
  newestCreatedAt: Math.max(...out.map(r => r.createdAt ?? 0)),
};
console.log(JSON.stringify(summary, null, 2));
