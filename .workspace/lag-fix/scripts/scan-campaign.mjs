#!/usr/bin/env node
/**
 * scan-campaign.mjs — READ-ONLY fact collector for the B2 cleanup unit.
 *
 * Emits one JSON line per session directory under ~/.dsh/sessions, plus a
 * trailing summary object.  It never writes to ~/.dsh, never deletes, never
 * moves.  All SQLite access is { readOnly: true }.
 *
 * Usage: node scan-campaign.mjs > /tmp/campaign.jsonl
 */
import { readdirSync, lstatSync, readFileSync, statSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const HOME = homedir();
const SESSIONS_ROOT = join(HOME, '.dsh', 'sessions');
const PROJCACHE = join(HOME, '.dsh', 'storages', 'session_projcache.json');
const USAGE_DB = join(HOME, '.dsh', 'storages', 'usage', 'usage.db');
const LEGACY_PROJCACHE_DIR = join(HOME, '.dsh', 'storages', 'session_projcache');

const out = [];
const now = Date.now();
const DAY = 86400000;

/* ── 1. projcache-derived metadata (sessionListMetadata.lastPromptAt) ───── */
const projMeta = new Map(); // sessionId -> {lastPromptAt, blank, createdAt, cwd}
let projCacheFacts = { rows: 0, error: null, mtime: null, size: null };
try {
  const st = statSync(PROJCACHE);
  projCacheFacts.mtime = st.mtime.toISOString();
  projCacheFacts.size = st.size;
  const j = JSON.parse(readFileSync(PROJCACHE, 'utf8'));
  const rows = j?.tables?.sessions ?? {};
  const keys = Object.keys(rows);
  projCacheFacts.rows = keys.length;
  for (const k of keys) {
    const r = rows[k] ?? {};
    const slm = r?.rows?.sessionListMetadata?.val;
    projMeta.set(k, {
      lastPromptAt: slm?.lastPromptAt ?? null,
      blank: slm?.blank ?? null,
      createdAt: r?.identity?.createdAt ?? null,
      cwd: r?.identity?.cwd ?? null,
    });
  }
} catch (e) {
  projCacheFacts.error = String(e);
}

/* ── 2. enumerate session directories ──────────────────────────────────── */
function readHeader(path) {
  // One zstd frame holds the header line; inflated prefix is enough.
  const r = spawnSync('bash', ['-c',
    `head -c 400000 ${JSON.stringify(path)} | zstdcat 2>/dev/null | head -1 | cut -c1-2000`],
    { encoding: 'utf8', maxBuffer: 1 << 20 });
  if (r.status !== 0 || !r.stdout) return undefined;
  try { return JSON.parse(r.stdout.trim()); } catch { return undefined; }
}

const slugs = readdirSync(SESSIONS_ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory()).map((e) => e.name).sort();

const inodeMap = new Map(); // artifact path -> {dev, ino, nlink}
const dirs = [];

for (const slug of slugs) {
  const slugPath = join(SESSIONS_ROOT, slug);
  let entries;
  try { entries = readdirSync(slugPath, { withFileTypes: true }); }
  catch { continue; }
  for (const e of entries) {
    const p = join(slugPath, e.name);
    if (!e.isDirectory()) continue; // reject the obsolete flat-file layout
    let files = [];
    let dirStat = null;
    try {
      dirStat = statSync(p);
      files = readdirSync(p, { withFileTypes: true })
        .filter((f) => f.isFile()).map((f) => f.name).sort();
    } catch { /* unreadable dir: report as-is */ }
    dirs.push({ slug, id: e.name, path: p, files, dirMtime: dirStat?.mtimeMs ?? null });
  }
}

for (const d of dirs) {
  for (const f of d.files) {
    if (f !== 'session.lock') {
      try {
        const s = lstatSync(join(d.path, f));
        inodeMap.set(join(d.path, f), { dev: s.dev, ino: s.ino, nlink: s.nlink });
      } catch { /* ignore */ }
    }
  }
}
// share count across the whole sessions tree (hardlink detection)
const inodeCount = new Map();
for (const v of inodeMap.values()) {
  const k = `${v.dev}:${v.ino}`;
  inodeCount.set(k, (inodeCount.get(k) ?? 0) + 1);
}

/* ── 3. per-session record ─────────────────────────────────────────────── */
for (const d of dirs) {
  const rec = {
    slug: d.slug,
    id: d.id,
    dir: d.path,
    files: d.files,
    dirMtimeMs: d.dirMtime,
    hasLock: d.files.includes('session.lock'),
    artifactPaths: d.files.filter((f) => f !== 'session.lock'),
    sessionFilePresent: d.files.some((f) => f === 'session.jsonl.zstd' || f === 'session.v3.jsonl.zstd'),
    bytes: 0,
    maxArtifactMtimeMs: null,
    header: null,
    headerParseError: null,
    hardlinked: false,
    projCache: null,
  };
  for (const f of d.files) {
    if (f === 'session.lock') continue;
    const fp = join(d.path, f);
    try {
      const s = lstatSync(fp);
      rec.bytes += s.size;
      rec.maxArtifactMtimeMs = Math.max(rec.maxArtifactMtimeMs ?? 0, s.mtimeMs);
      const k = `${s.dev}:${s.ino}`;
      if ((inodeCount.get(k) ?? 0) > 1) rec.hardlinked = true;
    } catch { /* ignore */ }
  }
  const art = d.files.find((f) => f === 'session.jsonl.zstd' || f === 'session.v3.jsonl.zstd');
  if (art) {
    const h = readHeader(join(d.path, art));
    if (h && h.type === 'session' && typeof h.id === 'string') {
      rec.header = {
        id: h.id,
        createdAt: h.createdAt ?? null,
        cwd: h.cwd ?? null,
        origin: h.origin ?? null,
        parentSession: h.parentSession ?? null,
        delegationDepth: h.delegationDepth ?? null,
        agentPreset: h.agentPreset ?? null,
      };
    } else {
      rec.headerParseError = 'no well-formed session header line';
    }
  }
  const pm = projMeta.get(d.id) ?? null;
  rec.projCache = pm;
  rec.inProjCache = pm !== null;
  out.push(rec);
}

/* ── 4. orphan class A: projcache rows whose session is gone ───────────── */
const onDiskIds = new Set(dirs.map((d) => d.id));
const projOrphans = [];
for (const [k, v] of projMeta.entries()) if (!onDiskIds.has(k)) projOrphans.push({ id: k, ...v });

/* ── 5. orphan class B: dangling sync_state rows (read-only sqlite) ────── */
let syncFacts = { total: null, dangling: null, error: null, sample: [] };
try {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(USAGE_DB, { readOnly: true });
  syncFacts.total = db.prepare('select count(*) c from sync_state').get().c;
  const rows = db.prepare('select source, mtime, size from sync_state').all();
  const dangling = [];
  for (const r of rows) {
    const m = /^dsh:(.*)$/.exec(r.source ?? '');
    const p = m ? m[1] : null;
    let exists = false;
    if (p) { try { exists = statSync(p).isFile(); } catch { exists = false; } }
    if (!exists) dangling.push({ source: r.source, mtime: r.mtime, size: r.size });
  }
  syncFacts.dangling = dangling.length;
  syncFacts.sample = dangling.slice(0, 5);
  db.close();
} catch (e) {
  syncFacts.error = String(e);
}

/* ── 6. orphan class C: legacy projcache dir ───────────────────────────── */
let legacyFacts = { files: 0, bytes: 0, dirs: [], mtimes: {}, error: null, sample: [] };
try {
  const walk = (p) => {
    let ents;
    try { ents = readdirSync(p, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const fp = join(p, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.isFile()) {
        const s = lstatSync(fp);
        legacyFacts.files += 1;
        legacyFacts.bytes += s.size;
        const day = new Date(s.mtimeMs).toISOString().slice(0, 10);
        legacyFacts.mtimes[day] = (legacyFacts.mtimes[day] ?? 0) + 1;
        if (legacyFacts.sample.length < 3) legacyFacts.sample.push(fp);
      }
    }
  };
  walk(LEGACY_PROJCACHE_DIR);
  for (const e of readdirSync(LEGACY_PROJCACHE_DIR, { withFileTypes: true })) {
    if (e.isDirectory()) legacyFacts.dirs.push(join(LEGACY_PROJCACHE_DIR, e.name));
  }
} catch (e) {
  legacyFacts.error = String(e);
}

/* ── emit ──────────────────────────────────────────────────────────────── */
process.stdout.write(JSON.stringify({
  kind: 'meta',
  generatedAt: new Date(now).toISOString(),
  nowMs: now,
  sessionsRoot: SESSIONS_ROOT,
  projCacheFacts,
  syncFacts,
  legacyFacts,
  dshProcesses: (() => {
    const r = spawnSync('bash', ['-c', "ps -eo pid,lstart,etime,rss,args | grep -E 'dsh web' | grep -v grep"], { encoding: 'utf8' });
    return (r.stdout ?? '').trim().split('\n').filter(Boolean);
  })(),
  fdHolds: (() => {
    const r = spawnSync('bash', ['-c', "for p in $(pgrep -f 'dsh web'); do ls -l /proc/$p/fd 2>/dev/null | grep -c sessions; done"], { encoding: 'utf8' });
    return (r.stdout ?? '').trim();
  })(),
}) + '\n');
for (const r of out) process.stdout.write(JSON.stringify({ kind: 'session', ...r }) + '\n');
process.stdout.write(JSON.stringify({ kind: 'projcache_orphans', count: projOrphans.length, items: projOrphans }) + '\n');
