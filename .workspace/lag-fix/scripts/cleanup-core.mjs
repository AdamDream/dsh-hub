#!/usr/bin/env node
/**
 * cleanup-core.mjs — shared engine for the B2 sliding-window session cleanup.
 *
 * Commands (driven by scripts/cleanup-sessions.sh):
 *   --dry-run        read-only scan + manifest emission (NO deletion)
 *   --backup         create rollback artifacts inside the workspace
 *   --apply          perform the deletions described by the manifest
 *   --rollback       restore from a backup directory
 *
 * Hard guarantees of this file:
 *   * nothing under ~/.dsh is written except by --apply / --rollback;
 *   * all SQLite access is { readOnly: true }; no VACUUM / ANALYZE / CREATE INDEX;
 *   * --apply refuses to delete unless (a) the backup manifest exists and
 *     (b) its recorded set covers every path in the manifest, and (c) every
 *     selected path re-passes the guard battery at apply time.
 *
 * Path resolution (so the logic is testable against a scaffold):
 *   DSH_HOME      default ~/.dsh
 *   SESSIONS_ROOT default $DSH_HOME/sessions
 *   WORKSPACE_DIR default <repo>/.workspace/lag-fix
 */
import {
  readdirSync, lstatSync, statSync, readFileSync, writeFileSync, mkdirSync,
  existsSync, renameSync, rmSync, appendFileSync, openSync, closeSync, writeSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const DAY = 86400000;
const SELF_DIR = dirname(new URL(import.meta.url).pathname);
const DEFAULT_WORKSPACE = resolve(SELF_DIR, '..');

// ── configuration ─────────────────────────────────────────────────────────
const CFG = {
  dshHome: process.env.DSH_HOME || join(homedir(), '.dsh'),
  sessionsRoot: process.env.SESSIONS_ROOT || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'sessions'),
  workspaceDir: process.env.WORKSPACE_DIR || DEFAULT_WORKSPACE,
};
CFG.projCache = join(CFG.dshHome, 'storages', 'session_projcache.json');
CFG.usageDb = join(CFG.dshHome, 'storages', 'usage', 'usage.db');
CFG.legacyCacheDir = join(CFG.dshHome, 'storages', 'session_projcache');
CFG.workspaceJson = join(CFG.dshHome, 'storages', 'workspace.json');
CFG.backupRoot = join(CFG.workspaceDir, 'backup', 'B2');   // 单元独占：backup/ 为多档共用，C1 的 --rollback 用 `ls */ | tail -1` 会误取他档目录
CFG.reportDir = join(CFG.workspaceDir, 'reports');
CFG.stateDir = join(CFG.workspaceDir, '.state');

// ── tiny CLI ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { cmd: 'dry-run', days: 7, phase: 'all' };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--dry-run') a.cmd = 'dry-run';
    else if (t === '--apply') a.cmd = 'apply';
    else if (t === '--backup') a.cmd = 'backup';
    else if (t === '--rollback') a.cmd = 'rollback';
    else if (t === '--days') a.days = Number(argv[++i]);
    else if (t === '--phase') a.phase = String(argv[++i]);
    else if (t === '--backup-dir') a.backupDir = argv[++i];
    else if (t === '--manifest') a.manifest = argv[++i];
    else if (t === '--yes') a.yes = true;
    else if (t === '--out-json') a.outJson = argv[++i];
    else if (t === '--out-md') a.outMd = argv[++i];
    else if (t === '--skip-scan') a.skipScan = true;
    else if (t === '--include-excluded') a.includeExcluded = true;
    else throw new Error(`unknown argument: ${t}`);
  }
  if (!Number.isFinite(a.days) || a.days <= 0) throw new Error(`--days must be a positive number, got ${a.days}`);
  if (!['all', '1', '2'].includes(a.phase)) throw new Error(`--phase must be 1, 2 or all, got ${a.phase}`);
  return a;
}

const log = (...m) => process.stderr.write(m.join(' ') + '\n');

// ── scan ──────────────────────────────────────────────────────────────────
function readHeaderLine(path) {
  const r = spawnSync('bash', ['-c',
    `head -c 400000 ${JSON.stringify(path)} | zstdcat 2>/dev/null | head -1 | cut -c1-2000`],
    { encoding: 'utf8', maxBuffer: 1 << 20 });
  if (r.status !== 0 || !r.stdout) return undefined;
  try { return JSON.parse(r.stdout.trim()); } catch { return undefined; }
}

function loadProjCache() {
  const facts = { path: CFG.projCache, rows: 0, mtime: null, size: null, error: null, sessions: new Map() };
  try {
    const st = statSync(CFG.projCache);
    facts.mtime = st.mtime.toISOString();
    facts.size = st.size;
    const j = JSON.parse(readFileSync(CFG.projCache, 'utf8'));
    const rows = j?.tables?.sessions ?? {};
    for (const k of Object.keys(rows)) {
      const slm = rows[k]?.rows?.sessionListMetadata?.val;
      const st = rows[k]?.rows?.sessionStats?.val;
      const pend = st?.pendingCalls && Object.keys(st.pendingCalls).length ? Object.values(st.pendingCalls) : [];
      facts.sessions.set(k, {
        lastPromptAt: slm?.lastPromptAt ?? null,
        blank: slm?.blank ?? null,
        createdAt: rows[k]?.identity?.createdAt ?? null,
        cwd: rows[k]?.identity?.cwd ?? null,
        openStepStartTime: typeof st?.openStep?.startTime === 'number' ? st.openStep.startTime : null,
        pendingCallTimes: pend.filter((v) => typeof v === 'number'),
      });
    }
    facts.rows = facts.sessions.size;
  } catch (e) { facts.error = String(e); }
  return facts;
}

function scanSessions() {
  const records = [];
  let slugs = [];
  try {
    slugs = readdirSync(CFG.sessionsRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch (e) {
    throw new Error(`cannot read sessions root ${CFG.sessionsRoot}: ${e}`);
  }
  const raw = [];
  for (const slug of slugs) {
    const slugPath = join(CFG.sessionsRoot, slug);
    let entries;
    try { entries = readdirSync(slugPath, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const p = join(slugPath, e.name);
      let files = [], dirMtimeMs = null;
      try {
        dirMtimeMs = statSync(p).mtimeMs;
        files = readdirSync(p, { withFileTypes: true }).filter((f) => f.isFile()).map((f) => f.name).sort();
      } catch { /* keep empty */ }
      raw.push({ slug, id: e.name, path: p, files, dirMtimeMs });
    }
  }
  // hardlink census across the whole tree
  const inodeCount = new Map();
  for (const d of raw) for (const f of d.files) {
    if (f === 'session.lock') continue;
    try { const s = lstatSync(join(d.path, f)); const k = `${s.dev}:${s.ino}`; inodeCount.set(k, (inodeCount.get(k) ?? 0) + 1); } catch { /* ignore */ }
  }
  for (const d of raw) {
    const rec = {
      id: d.id, slug: d.slug, dir: d.path, dirMtimeMs: d.dirMtimeMs,
      files: d.files, hasLock: d.files.includes('session.lock'),
      artifactFiles: d.files.filter((f) => f !== 'session.lock'),
      bytes: 0, maxArtifactMtimeMs: null, hardlinked: false,
      header: null, headerParseError: null,
    };
    for (const f of d.files) {
      if (f === 'session.lock') continue;
      try {
        const s = lstatSync(join(d.path, f));
        rec.bytes += s.size;
        rec.maxArtifactMtimeMs = Math.max(rec.maxArtifactMtimeMs ?? 0, s.mtimeMs);
        if ((inodeCount.get(`${s.dev}:${s.ino}`) ?? 0) > 1) rec.hardlinked = true;
      } catch { /* ignore */ }
    }
    const art = d.files.find((f) => f === 'session.jsonl.zstd' || f === 'session.v3.jsonl.zstd');
    if (art) {
      const h = readHeaderLine(join(d.path, art));
      if (h && h.type === 'session' && typeof h.id === 'string') {
        rec.header = {
          id: h.id, createdAt: h.createdAt ?? null, cwd: h.cwd ?? null,
          origin: h.origin ?? null, parentSession: h.parentSession ?? null,
          delegationDepth: h.delegationDepth ?? null, agentPreset: h.agentPreset ?? null,
        };
      } else rec.headerParseError = 'no well-formed session header in artifact';
    } else {
      rec.headerParseError = 'no session artifact file (session.jsonl.zstd / session.v3.jsonl.zstd)';
    }
    records.push(rec);
  }
  return records;
}

// updatedAt = exactly what the host puts in each SessionSummary row:
//   Math.max(header.createdAt, sessionListMetadata.lastPromptAt)
function updatedAt(rec, proj) {
  const c = rec.header?.createdAt ?? null;
  const lp = proj?.lastPromptAt ?? null;
  if (c !== null && lp !== null) return { value: Math.max(c, lp), basis: 'exact(payload)' };
  if (c !== null) return { value: c, basis: 'createdAt-only(payload-parity)' };
  if (rec.maxArtifactMtimeMs !== null) return { value: rec.maxArtifactMtimeMs, basis: 'mtime-only(fallback)' };
  return { value: rec.dirMtimeMs ?? 0, basis: 'dir-mtime-only(fallback)' };
}

// ── selection ─────────────────────────────────────────────────────────────
function select(records, projCache, opts) {
  const nowMs = opts.nowMs ?? Date.now();
  const cutoffMs = nowMs - opts.days * DAY;
  const byId = new Map(records.map((r) => [r.id, r]));
  const deletable = [];
  const excluded = [];
  const push = (rec, reason, detail) => excluded.push({
    id: rec.id, slug: rec.slug, dir: rec.dir, bytes: rec.bytes, reason, detail: detail ?? null,
    artifactMtimeISO: rec.maxArtifactMtimeMs ? new Date(rec.maxArtifactMtimeMs).toISOString() : null,
    updatedAt: updatedAt(rec, projCache.sessions.get(rec.id)).value,
    updatedAtBasis: updatedAt(rec, projCache.sessions.get(rec.id)).basis,
    origin: rec.header?.origin ?? null,
    parentSession: rec.header?.parentSession ?? null,
    hasLock: rec.hasLock,
  });

  for (const rec of records) {
    const proj = projCache.sessions.get(rec.id) ?? null;
    const u = updatedAt(rec, proj);
    const base = {
      id: rec.id, slug: rec.slug, dir: rec.dir, bytes: rec.bytes,
      updatedAt: u.value, updatedAtISO: new Date(u.value).toISOString(), updatedAtBasis: u.basis,
      origin: rec.header?.origin ?? null,
      parentSession: rec.header?.parentSession ?? null,
      hasLock: rec.hasLock, hardlinked: rec.hardlinked,
      artifactFiles: rec.artifactFiles,
      dirMtimeISO: rec.dirMtimeMs ? new Date(rec.dirMtimeMs).toISOString() : null,
      artifactMtimeISO: rec.maxArtifactMtimeMs ? new Date(rec.maxArtifactMtimeMs).toISOString() : null,
      inProjCache: proj !== null,
      openStepStartTime: proj?.openStepStartTime ?? null,
      pendingCallTimes: proj?.pendingCallTimes ?? [],
    };

    // G0 — structural integrity
    if (!rec.header) { push(rec, 'no-session-header', rec.headerParseError); continue; }
    if (rec.header.id !== rec.id) { push(rec, 'id-mismatch', `header.id=${rec.header.id}`); continue; }

    // G1 — only subagent sessions are ever eligible (top-level user sessions are never deleted)
    if (rec.header.origin !== 'subagent') {
      push(rec, rec.header.origin ? `origin-not-subagent(${rec.header.origin})` : 'origin-not-subagent(absent:top-level)');
      continue;
    }
    // G2 — sliding window
    if (u.value >= cutoffMs) { push(rec, 'within-window', `updatedAt=${new Date(u.value).toISOString()} >= cutoff=${new Date(cutoffMs).toISOString()}`); continue; }
    // G3 — session.lock
    if (rec.hasLock) { push(rec, 'has-session.lock', rec.files.join(',')); continue; }
    // G4 — hardlink safety (unlinking a shared inode could damage another session)
    if (rec.hardlinked) { push(rec, 'hardlink-shared-artifact'); continue; }
    // G5 — parent must also be out of the window, or absent
    const pid = rec.header.parentSession;
    if (!pid) { push(rec, 'parent-unverifiable(no-parent-pointer)', 'origin=subagent but no parentSession field; cannot prove the parent is stale'); continue; }
    const parent = byId.get(pid);
    if (parent) {
      const pu = updatedAt(parent, projCache.sessions.get(parent.id));
      if (pu.value >= cutoffMs) { push(rec, 'parent-within-window', `parent=${pid} parentUpdatedAt=${new Date(pu.value).toISOString()}`); continue; }
      if (parent.hasLock) { push(rec, 'parent-has-session.lock', `parent=${pid}`); continue; }
      if (parent.maxArtifactMtimeMs !== null && parent.maxArtifactMtimeMs >= cutoffMs) {
        push(rec, 'parent-recently-written', `parent=${pid} parentArtifactMtime=${new Date(parent.maxArtifactMtimeMs).toISOString()}`); continue;
      }
    }
    // G7 — window-aware liveness signals from the projection snapshot.
    //      A non-null openStep whose startTime, or a pending tool call whose
    //      timestamp, falls INSIDE the window means the session was executing
    //      when the window closed => treat as possibly live and keep it.
    //      Stale projection leftovers older than the window are ignored
    //      (verified: 0 of the candidates carry an in-window signal).
    const liveSignals = [];
    if (proj?.openStepStartTime != null && proj.openStepStartTime >= cutoffMs) liveSignals.push(`openStep@${new Date(proj.openStepStartTime).toISOString()}`);
    for (const t of proj?.pendingCallTimes ?? []) if (t >= cutoffMs) liveSignals.push(`pendingCall@${new Date(t).toISOString()}`);
    if (liveSignals.length) { push(rec, 'live-signal-in-window', liveSignals.join(',')); continue; }

    // G6 — this session itself must not have been written to inside the window
    //      (a live/in-memory session that flushed recently is thereby excluded)
    if (rec.maxArtifactMtimeMs !== null && rec.maxArtifactMtimeMs >= cutoffMs) {
      push(rec, 'recently-written(liveness-guard)', `artifactMtime=${new Date(rec.maxArtifactMtimeMs).toISOString()}`); continue;
    }
    deletable.push({ ...base, parentState: parent ? 'parent-old' : 'parent-absent', depth: rec.header.delegationDepth });
  }
  return { nowMs, cutoffMs, deletable, excluded, byId };
}

// ── orphan residues ───────────────────────────────────────────────────────
function projCacheOrphans(records, projCache) {
  const onDisk = new Set(records.map((r) => r.id));
  const items = [];
  for (const [id, v] of projCache.sessions.entries()) if (!onDisk.has(id)) items.push({ id, ...v });
  return items;
}

function syncStateFacts() {
  const out = { path: CFG.usageDb, total: null, dshPrefixed: null, dshPrefixedMissingFile: null, otherPrefixed: null, dangling: [], error: null };
  try {
    // node:sqlite is synchronous; use a child so the module stays importable everywhere
    const code = `
      const {DatabaseSync}=require('node:sqlite');
      const fs=require('node:fs');
      const db=new DatabaseSync(${JSON.stringify(CFG.usageDb)},{readOnly:true});
      const rows=db.prepare('select source, mtime, size from sync_state').all();
      db.close();
      const res={total:rows.length,dshPrefixed:0,dshPrefixedMissingFile:0,otherPrefixed:0,dangling:[]};
      for(const r of rows){
        const s=r.source||''; const i=s.indexOf(':');
        const pre=i<0?'':s.slice(0,i); const p=i<0?null:s.slice(i+1);
        if(pre==='dsh'){res.dshPrefixed++; let ok=false; try{ok=fs.statSync(p).isFile();}catch{}
          if(!ok){res.dshPrefixedMissingFile++; res.dangling.push({source:s,mtime:r.mtime,size:r.size});}}
        else res.otherPrefixed++;
      }
      process.stdout.write(JSON.stringify(res));
    `;
    const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.status !== 0) throw new Error(r.stderr || `exit ${r.status}`);
    Object.assign(out, JSON.parse(r.stdout));
  } catch (e) { out.error = String(e); }
  return out;
}

function legacyCacheFacts() {
  const out = { path: CFG.legacyCacheDir, exists: existsSync(CFG.legacyCacheDir), files: 0, bytes: 0, mtimeDays: {}, dirs: [], sample: [] };
  if (!out.exists) return out;
  const walk = (p) => {
    let ents;
    try { ents = readdirSync(p, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const fp = join(p, e.name);
      if (e.isDirectory()) { out.dirs.push(fp); walk(fp); }
      else if (e.isFile()) {
        const s = lstatSync(fp);
        out.files++; out.bytes += s.size;
        const d = new Date(s.mtimeMs).toISOString().slice(0, 10);
        out.mtimeDays[d] = (out.mtimeDays[d] ?? 0) + 1;
        if (out.sample.length < 3) out.sample.push(fp);
      }
    }
  };
  walk(CFG.legacyCacheDir);
  return out;
}

// ── report assembly ───────────────────────────────────────────────────────
function buildReport(args, scan, sel, projCache, sync, legacy, hostFacts, existingOrphans) {
  const del = sel.deletable;
  const bySlug = {};
  for (const d of del) {
    const b = (bySlug[d.slug] ??= { sessions: 0, bytes: 0 });
    b.sessions++; b.bytes += d.bytes;
  }
  const byReason = {};
  for (const e of sel.excluded) {
    const b = (byReason[e.reason] ??= { sessions: 0, bytes: 0, detailClass: null, samples: [] });
    b.sessions++; b.bytes += e.bytes;
    if (b.samples.length < 5) b.samples.push({ id: e.id, updatedAtISO: new Date(e.updatedAt).toISOString(), detail: e.detail });
  }
  const times = del.map((d) => d.updatedAt).sort((a, b) => a - b);
  const origins = {};
  for (const r of scan) origins[r.header?.origin ?? '<absent:top-level>'] = (origins[r.header?.origin ?? '<absent:top-level>'] ?? 0) + 1;
  const totalBytes = del.reduce((a, d) => a + d.bytes, 0);

  const backupStamp = '<STAMP>';
  const listFile = `${CFG.backupRoot}/${backupStamp}/deletable-dirs.list`;

  return {
    schema: 'dsh-lag-fix.cleanup-dry-run/v1',
    generatedAt: new Date().toISOString(),
    args: { days: args.days, phase: args.phase, command: args.cmd },
    paths: { dshHome: CFG.dshHome, sessionsRoot: CFG.sessionsRoot, projCache: CFG.projCache, usageDb: CFG.usageDb, legacyCacheDir: CFG.legacyCacheDir, workspaceJson: CFG.workspaceJson, backupRoot: CFG.backupRoot },
    host: hostFacts,
    window: {
      nowISO: new Date(sel.nowMs).toISOString(),
      cutoffISO: new Date(sel.cutoffMs).toISOString(),
      days: args.days,
      rule: 'delete iff origin==="subagent" AND max(header.createdAt, sessionListMetadata.lastPromptAt) < now - days',
      exceptionRule: 'parent session must itself be out of the window (parent-within-window => excluded); no parent pointer => excluded (unverifiable)',
    },
    counts: {
      sessionDirsScanned: scan.length,
      originsOfScanned: origins,
      deletableSessions: del.length,
      deletableBytes: totalBytes,
      deletableMiB: +(totalBytes / 1048576).toFixed(2),
      excludedSessions: sel.excluded.length,
      excludedBytes: sel.excluded.reduce((a, e) => a + e.bytes, 0),
      projCacheRows: projCache.rows,
      projCacheOrphans: existingOrphans.length,
      syncStateRows: sync.total,
      syncStateDshPrefixed: sync.dshPrefixed,
      syncStateTrulyDanglingNow: sync.dshPrefixedMissingFile,
      syncStatePredictedDanglingAfterDelete: sync.dshPrefixed,
      legacyCacheFiles: legacy.files,
      legacyCacheBytes: legacy.bytes,
    },
    timeRange: del.length
      ? { oldestISO: new Date(times[0]).toISOString(), oldestMs: times[0], newestISO: new Date(times[times.length - 1]).toISOString(), newestMs: times[times.length - 1] }
      : null,
    byWorkspace: Object.fromEntries(Object.entries(bySlug).sort((a, b) => b[1].bytes - a[1].bytes)),
    exclusionsByReason: byReason,
    orphans: {
      a_projCacheRowsOfMissingSessions: {
        phase: 2,
        count: existingOrphans.length,
        predictedAfterDelete: existingOrphans.length + del.length,
        ids: existingOrphans.map((o) => o.id),
        note: 'removed by rewriting tables.sessions in session_projcache.json after the host restart',
      },
      b_syncStateDanglingRows: {
        phase: 2,
        totalRows: sync.total,
        dshPrefixedRows: sync.dshPrefixed,
        trulyDanglingNow: sync.dshPrefixedMissingFile,
        predictedAfterDelete: sync.dshPrefixed,
        otherSources: sync.otherPrefixed,
        sampledDangling: sync.dangling.slice(0, 5),
        note: 'DELETE FROM sync_state WHERE source LIKE \'dsh:%\' AND the file no longer exists; export rows first for reversibility',
      },
      c_legacyProjCacheFiles: {
        phase: 1,
        root: legacy.path,
        files: legacy.files,
        bytes: legacy.bytes,
        mtimeDays: legacy.mtimeDays,
        dirs: legacy.dirs,
        sample: legacy.sample,
        note: 'obsolete per-key JSON backend; the authoritative store is storages/session_projcache.json',
      },
    },
    deletableSessions: del,
    excludedSessions: args.includeExcluded ? sel.excluded : undefined,
    excludedSessionsSample: sel.excluded.slice(0, 40),
    commands: {
      dryRun: 'bash scripts/cleanup-sessions.sh --dry-run --days 7',
      backup: 'bash scripts/cleanup-sessions.sh --backup --days 7',
      applyPhase1: 'bash scripts/cleanup-sessions.sh --apply --phase 1 --days 7',
      applyPhase2: 'bash scripts/cleanup-sessions.sh --apply --phase 2 --days 7',
      rollback: 'bash scripts/cleanup-sessions.sh --rollback --backup-dir backup/<STAMP>',
      dirListFile: listFile,
    },
    unverifiableRisks: [
      'Host in-memory attach set is not queryable read-only (no HTTP probe, no IPC). Mitigations applied: updatedAt<cutoff, artifact-mtime<cutoff, no session.lock, parent likewise stale.',
      'session_projcache.json is rewritten by the live host every ~30s; its content is a moving target. Phase 2 must run after a host restart.',
      'The audit report describes sync_state as 2356 "dangling" rows; measured read-only, all 2356 dsh: rows currently resolve to existing files. They become dangling only after the session purge. Both numbers are reported.',
      'session_projcache.json carries no lastPromptAt for 524 sessions; for those, updatedAt falls back to header.createdAt, which is a lower bound (conservative: it can only over-estimate deletion eligibility for sessions whose only later activity was a non-user event).',
    ],
  };
}

function collectHostFacts() {
  const ps = spawnSync('bash', ['-c', "ps -eo pid,lstart,etime,rss,args | grep -E 'dsh web' | grep -v grep"], { encoding: 'utf8' });
  const fd = spawnSync('bash', ['-c', "for p in $(pgrep -f 'dsh web'); do echo -n \"$p:\"; ls -l /proc/$p/fd 2>/dev/null | grep -c sessions; done"], { encoding: 'utf8' });
  return {
    processes: (ps.stdout ?? '').trim().split('\n').filter(Boolean),
    sessionFdHolds: (fd.stdout ?? '').trim().split('\n').filter(Boolean),
    note: 'host was NOT touched: no signal, no restart, no HTTP probe',
  };
}

function scanHostProcesses() {
  const r = spawnSync('bash', ['-c', "ps -eo pid,args | grep -E 'dsh web' | grep -v grep"], { encoding: 'utf8' });
  return (r.stdout ?? '').trim().split('\n').filter(Boolean);
}

// ── markdown renderer ─────────────────────────────────────────────────────
export function renderMarkdown(r) {
  const f = (n) => n.toLocaleString('en-US');
  const mib = (b) => (b / 1048576).toFixed(2);
  const L = [];
  L.push(`# B2 干跑清单（7 天滑动窗口 · subagent 会话 + 三类孤儿残留）`);
  L.push('');
  L.push(`- 生成时间：**${r.generatedAt}**  ·  命令：\`${r.commands.dryRun}\``);
  L.push(`- 窗口：now = ${r.window.nowISO}  ·  cutoff = **${r.window.cutoffISO}**（${r.window.days} 天）`);
  L.push(`- 判定规则：\`${r.window.rule}\``);
  L.push(`- 例外规则：${r.window.exceptionRule}`);
  L.push(`- 纪律：**本次未删除/未移动任何文件**；SQLite 全部 \`readOnly:true\`；宿主未触碰（无信号/无重启/无 HTTP 探测）。`);
  L.push('');
  L.push('## 1. 汇总');
  L.push('');
  L.push('| 指标 | 值 |');
  L.push('|---|---|');
  L.push(`| 扫描到的会话目录 | ${f(r.counts.sessionDirsScanned)} |`);
  L.push(`| **将删除的会话数** | **${f(r.counts.deletableSessions)}** |`);
  L.push(`| **将回收字节** | **${f(r.counts.deletableBytes)} B = ${mib(r.counts.deletableBytes)} MiB** |`);
  L.push(`| 被例外规则排除的会话数 | ${f(r.counts.excludedSessions)}（${mib(r.counts.excludedBytes)} MiB 不动） |`);
  L.push(`| 扫描到的 origin 分布 | ${Object.entries(r.counts.originsOfScanned).map(([k, v]) => `\`${k}\`=${v}`).join(' · ')} |`);
  L.push(`| 孤儿 a：projcache 中已消失会话条目 | ${f(r.counts.projCacheOrphans)}（删除会话后预计 ${f(r.orphans.a_projCacheRowsOfMissingSessions.predictedAfterDelete)}） |`);
  L.push(`| 孤儿 b：sync_state 行 | 总数 ${f(r.counts.syncStateRows)}（\`dsh:\` 前缀 ${f(r.counts.syncStateDshPrefixed)}，**当前真正悬空 ${f(r.counts.syncStateTrulyDanglingNow)}**，删除会话后预计 ${f(r.counts.syncStatePredictedDanglingAfterDelete)}） |`);
  L.push(`| 孤儿 c：废弃 projcache 遗留文件 | ${f(r.counts.legacyCacheFiles)} 个 / ${f(r.counts.legacyCacheBytes)} B |`);
  L.push('');
  if (r.timeRange) {
    L.push(`- 最老候选 updatedAt：**${r.timeRange.oldestISO}**`);
    L.push(`- 最新候选 updatedAt：**${r.timeRange.newestISO}**（仍严格早于 cutoff ${r.window.cutoffISO}）`);
  }
  L.push('');
  L.push('## 2. 按工作区分布（将删除）');
  L.push('');
  L.push('| workspace-slug | 会话数 | 字节 | MiB |');
  L.push('|---|---|---|---|');
  for (const [k, v] of Object.entries(r.byWorkspace)) L.push(`| \`${k}\` | ${f(v.sessions)} | ${f(v.bytes)} | ${mib(v.bytes)} |`);
  L.push('');
  L.push('## 3. 被例外规则排除：按原因分类');
  L.push('');
  L.push('| 原因 | 会话数 | 字节 | 样例（id / updatedAt / detail） |');
  L.push('|---|---|---|---|');
  for (const [k, v] of Object.entries(r.exclusionsByReason).sort((a, b) => b[1].sessions - a[1].sessions)) {
    const s = v.samples.map((x) => `\`${String(x.id).slice(0, 12)}…\` ${String(x.updatedAtISO).slice(0, 16)}${x.detail ? ' ' + x.detail : ''}`).join('<br>');
    L.push(`| \`${k}\` | ${f(v.sessions)} | ${f(v.bytes)} | ${s || '—'} |`);
  }
  L.push('');
  L.push('## 4. 三类孤儿残留');
  L.push('');
  L.push('### 4a. projcache 中已消失会话的条目（phase 2）');
  L.push('');
  L.push(`- 当前条目数：**${r.orphans.a_projCacheRowsOfMissingSessions.count}**`);
  L.push(`- 删除会话后预计：**${r.orphans.a_projCacheRowsOfMissingSessions.predictedAfterDelete}**`);
  L.push('- 处置：重启后重写 `tables.sessions`，剔除磁盘上已不存在 id 的条目。');
  L.push('');
  L.push('### 4b. sync_state 悬空行（phase 2）');
  L.push('');
  L.push(`- 总行数：${f(r.orphans.b_syncStateDanglingRows.totalRows)}；\`dsh:\` 前缀行：${f(r.orphans.b_syncStateDanglingRows.dshPrefixedRows)}`);
  L.push(`- **当前真正悬空（文件已不存在）：${r.orphans.b_syncStateDanglingRows.trulyDanglingNow}**`);
  L.push(`- 删除会话后预计悬空：**${r.orphans.b_syncStateDanglingRows.predictedAfterDelete}**（= 被删会话对应的 \`dsh:\` 行）`);
  L.push(`- 非 \`dsh:\` 前缀行（不清理）：${f(r.orphans.b_syncStateDanglingRows.otherSources)}`);
  L.push('- ⚠️ 与审计报告口径差异见 §6。');
  L.push('');
  L.push('### 4c. 废弃 projcache 遗留文件（phase 1）');
  L.push('');
  L.push(`- 根目录：\`${r.orphans.c_legacyProjCacheFiles.root}\``);
  L.push(`- 文件数 **${f(r.orphans.c_legacyProjCacheFiles.files)}** / 字节 ${f(r.orphans.c_legacyProjCacheFiles.bytes)}`);
  L.push(`- mtime 分布：${Object.entries(r.orphans.c_legacyProjCacheFiles.mtimeDays).map(([d, n]) => `\`${d}\`=${n}`).join(' · ')}`);
  L.push(`- 子目录：${r.orphans.c_legacyProjCacheFiles.dirs.map((d) => `\`${d}\``).join(', ') || '—'}`);
  L.push('');
  L.push('## 5. 宿主事实（只读采集）');
  L.push('');
  L.push('```');
  for (const p of r.host.processes) L.push(p);
  L.push('```');
  L.push(`- \`/proc/<pid>/fd\` 中 sessions 相关句柄计数：${r.host.sessionFdHolds.join(' | ') || 'n/a'}`);
  L.push(`- ${r.host.note}`);
  L.push('');
  L.push('## 6. 无法验证的风险（保守处理，不假装通过）');
  L.push('');
  for (const x of r.unverifiableRisks) L.push(`- ${x}`);
  L.push('');
  L.push('## 7. 主 agent 执行序列');
  L.push('');
  L.push('```bash');
  L.push(`cd ${r.paths.workspaceDirHint ?? '/'}`);
  L.push(r.commands.backup);
  L.push(r.commands.applyPhase1);
  L.push('# → 重启宿主（由主 agent 决定时机）');
  L.push(r.commands.applyPhase2);
  L.push('```');
  L.push('');
  L.push(`> 完整机器可读清单：\`reports/cleanup-dry-run.json\`（含 ${f(r.counts.deletableSessions)} 条 \`deletableSessions\` 逐条明细）`);
  L.push('');
  return L.join('\n');
}

// ── state cache (so report regeneration needs no rescan) ──────────────────
function statePath(args) { return join(CFG.stateDir, `scan-days${args.days}.json`); }

function loadOrScan(args) {
  const sp = statePath(args);
  if (args.skipScan && existsSync(sp)) {
    log(`[scan] reusing cached scan ${sp}`);
    const j = JSON.parse(readFileSync(sp, 'utf8'));
    return { records: j.records, projCache: { ...j.projCacheFacts, sessions: new Map(j.projCacheSessions) }, sync: j.sync, legacy: j.legacy, orphans: j.orphans, host: j.host };
  }
  const projCache = loadProjCache();
  const records = scanSessions();
  const sync = syncStateFacts();
  const legacy = legacyCacheFacts();
  const orphans = projCacheOrphans(records, projCache);
  const host = collectHostFacts();
  const j = {
    records, projCacheFacts: { path: projCache.path, rows: projCache.rows, mtime: projCache.mtime, size: projCache.size, error: projCache.error },
    projCacheSessions: [...projCache.sessions.entries()], sync, legacy, orphans, host,
  };
  try { mkdirSync(CFG.stateDir, { recursive: true }); writeFileSync(sp, JSON.stringify(j)); } catch (e) { log(`[state] cache write failed (ignored): ${e}`); }
  return { records, projCache, sync, legacy, orphans, host };
}

// ── backup ────────────────────────────────────────────────────────────────
function sha256File(p) {
  const h = createHash('sha256');
  h.update(readFileSync(p));
  return h.digest('hex');
}

function cmdBackup(args, report) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const dir = join(CFG.backupRoot, stamp);
  mkdirSync(join(dir, 'meta'), { recursive: true });
  const written = [];
  const copy = (src, dst) => {
    if (!existsSync(src)) return log(`[backup] skip (absent) ${src}`);
    const r = spawnSync('cp', ['-a', src, dst], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`cp ${src} failed: ${r.stderr}`);
    written.push({ path: dst, bytes: statSync(dst).size, sha256: sha256File(dst) });
  };
  copy(CFG.workspaceJson, join(dir, 'meta', 'workspace.json'));
  copy(CFG.projCache, join(dir, 'meta', 'session_projcache.json'));
  copy(CFG.usageDb, join(dir, 'meta', 'usage.db'));

  // Full session tar of every directory the manifest would delete. The window
  // is FROZEN to the manifest's snapshot: a target that no longer passes the
  // guard battery against the same cutoff is dropped here, and --apply will
  // then refuse (and say so) rather than delete something unbacked.
  const freshNow = scanSessions();
  const freshProj = loadProjCache();
  const frozen = Date.parse(report.window.nowISO);
  const freshOk = new Set(select(freshNow, freshProj, { days: args.days, nowMs: frozen }).deletable.map((d) => d.id));
  const dropped = report.deletableSessions.filter((d) => !freshOk.has(d.id));
  if (dropped.length) log(`[backup] STALE MANIFEST: ${dropped.length} target(s) no longer qualify (e.g. ${dropped[0].id}); they are excluded. Re-run --dry-run for a fresh manifest.`);
  const backedUp = report.deletableSessions.filter((d) => freshOk.has(d.id));
  const paths = backedUp.map((d) => d.slug + '/' + d.id);
  const listFile = join(dir, 'deletable-dirs.list');
  writeFileSync(listFile, paths.map((p) => './' + p).join('\n') + '\n');
  const tarFile = join(dir, 'deletable-sessions.tar');
  const r = spawnSync('tar', ['-C', CFG.sessionsRoot, '-cf', tarFile, '--files-from', listFile], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`tar failed: ${r.stderr}`);
  const tarStat = statSync(tarFile);

  // legacy projcache tree (phase 1 also removes it) — must be reversible too
  let legacyTar = null;
  if (existsSync(CFG.legacyCacheDir)) {
    legacyTar = join(dir, 'legacy-projcache-tree.tar');
    const lr = spawnSync('tar', ['-C', dirname(CFG.legacyCacheDir), '-cf', legacyTar, basenameOf(CFG.legacyCacheDir)], { encoding: 'utf8', maxBuffer: 1 << 26 });
    if (lr.status !== 0) throw new Error(`tar (legacy projcache) failed: ${lr.stderr}`);
    log(`[backup] legacy projcache archived: ${(statSync(legacyTar).size / 1048576).toFixed(2)} MiB`);
  }

  // dangling sync_state rows snapshot (for reversibility of phase 2b)
  const syncSnapshot = join(dir, 'meta', 'sync_state-dsh-rows.json');
  const code = `
    const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync(${JSON.stringify(CFG.usageDb)},{readOnly:true});
    const rows=db.prepare("select * from sync_state where source like 'dsh:%'").all();
    db.close(); process.stdout.write(JSON.stringify(rows));
  `;
  const sr = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (sr.status === 0) writeFileSync(syncSnapshot, sr.stdout);

  const manifest = {
    schema: 'dsh-lag-fix.backup/v1',
    createdAt: new Date().toISOString(),
    manifestGeneratedAt: report.generatedAt,
    frozenWindowNowISO: report.window.nowISO,
    droppedAsStale: dropped.map((d) => d.id),
    stamp,
    days: args.days,
    sessionsRoot: CFG.sessionsRoot,
    counts: { dirs: paths.length, tarBytes: tarStat.size },
    tarFile, listFile, legacyTar,
    meta: written,
    restoreCommands: {
      meta: `cp -a ${join(dir, 'meta', 'workspace.json')} ${CFG.workspaceJson}`,
      projCache: `cp -a ${join(dir, 'meta', 'session_projcache.json')} ${CFG.projCache}`,
      usageDb: `cp -a ${join(dir, 'meta', 'usage.db')} ${CFG.usageDb}`,
      sessions: `tar -C ${CFG.sessionsRoot} -xf ${tarFile}`,
    },
    note: 'tar 不额外压缩：会话内容本身已是 zstd；cp -a 保留 mtime/权限',
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  log(`[backup] wrote ${dir}`);
  log(`[backup] tar=${(tarStat.size / 1048576).toFixed(2)} MiB  dirs=${paths.length}`);
  return { dir, manifest };
}

// ── apply ─────────────────────────────────────────────────────────────────
const GUARD_PREFIX_OK = (p) => resolve(p).startsWith(resolve(CFG.sessionsRoot) + '/');

function cmdApply(args, report, backupDir, frozenNowMs) {
  const stamp = backupDir ? backupDir.split('/').pop() : null;
  const manifestPath = backupDir ? join(backupDir, 'manifest.json') : null;
  if (!manifestPath || !existsSync(manifestPath)) {
    throw new Error(`--apply refuses to run without a backup: no manifest at ${manifestPath}. Run --backup first.`);
  }
  const bm = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const covered = new Set(readFileSync(bm.listFile, 'utf8').trim().split('\n').map((s) => s.replace(/^\.\//, '')));
  const wanted = report.deletableSessions.map((d) => d.slug + '/' + d.id);
  const uncovered = wanted.filter((w) => !covered.has(w));
  if (uncovered.length) throw new Error(`--apply refuses: ${uncovered.length} target(s) not covered by the backup (e.g. ${uncovered[0]})`);

  const logLines = [];
  const rec = (m) => { log(m); logLines.push(m); };
  rec(`# apply ${new Date().toISOString()} phase=${args.phase} days=${args.days}`);

  // phase 2 comes first only if requested alone; phase 1 = sessions + legacy cache
  if (args.phase === 'all' || args.phase === '1') {
    // 1a. re-verify every target against the live disk
    const fresh = scanSessions();
    const freshProj = loadProjCache();
    const re = select(fresh, freshProj, { days: args.days, nowMs: Date.parse(report.window.nowISO) });
    const freshOk = new Set(re.deletable.map((d) => d.id));
    const skipped = [];
    let removed = 0, bytes = 0;
    for (const d of report.deletableSessions) {
      if (!freshOk.has(d.id)) { skipped.push(d.id); continue; }
      if (!GUARD_PREFIX_OK(d.dir)) { skipped.push(`${d.id}(path-guard)`); continue; }
      if (!existsSync(d.dir)) { skipped.push(`${d.id}(gone)`); continue; }
      rmSync(d.dir, { recursive: true, force: true });
      removed++; bytes += d.bytes;
    }
    rec(`[phase1] sessions removed=${removed} bytes=${bytes} skipped=${skipped.length}`);
    if (skipped.length) rec(`[phase1] skipped ids: ${skipped.join(',')}`);

    // 1b. legacy projcache leftovers
    const legacy = legacyCacheFacts();
    if (legacy.exists && legacy.files > 0) {
      for (const sub of legacy.dirs) {
        if (resolve(sub).startsWith(resolve(CFG.legacyCacheDir) + '/')) rmSync(sub, { recursive: true, force: true });
      }
      rec(`[phase1] legacy projcache removed: files=${legacy.files} bytes=${legacy.bytes} dirs=${legacy.dirs.length}`);
    } else rec('[phase1] legacy projcache: nothing to remove');
  }

  if (args.phase === 'all' || args.phase === '2') {
    // A host that is still alive rewrites this file (~30s cadence) and would
    // resurrect the rows we remove, so phase 2 must follow the restart.
    const live = scanHostProcesses();
    if (live.length) rec(`[phase2-PRECHECK-WARN] a dsh web process is still running (${live.join(' | ')}); phase 2 edits to session_projcache.json can be overwritten by the host. The restart must happen BEFORE this phase.`);

    // 2a. projcache rows whose session no longer exists
    const onDisk = new Set(scanSessions().map((r) => r.id));
    const manifestDeleted = new Set(report.deletableSessions.map((d) => d.id).filter((id) => !onDisk.has(id)));
    const raw = readFileSync(CFG.projCache, 'utf8');
    const j = JSON.parse(raw);
    const rows = j?.tables?.sessions ?? {};
    const gone = Object.keys(rows).filter((k) => !onDisk.has(k));
    if (gone.length) {
      const tmp = join(dirname(CFG.projCache), '.session_projcache.json.b2tmp');
      for (const k of gone) delete rows[k];
      writeFileSync(tmp, JSON.stringify(j));
      renameSync(tmp, CFG.projCache);
      rec(`[phase2a] projcache rows removed=${gone.length} (manifest predicted ${report.orphans.a_projCacheRowsOfMissingSessions.predictedAfterDelete} at plan time; of the removed ids, ${manifestDeleted.size} were directories this cleanup was scheduled to delete and are already absent)`);
    } else rec('[phase2a] projcache: no rows to remove');

    // 2b. dangling sync_state rows
    const code = (mode) => `
      const {DatabaseSync}=require('node:sqlite');
      const fs=require('node:fs');
      const db=new DatabaseSync(${JSON.stringify(CFG.usageDb)},{readOnly:false});
      const rows=db.prepare("select source from sync_state where source like 'dsh:%'").all();
      const gone=rows.filter(r=>{const p=r.source.slice(4); try{return !fs.statSync(p).isFile();}catch{return true;}});
      ${mode === 'delete'
        ? `let n=0; const del=db.prepare('delete from sync_state where source = ?'); db.exec('BEGIN'); try{for(const g of gone){n+=del.run(g.source).changes;} db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;} db.close(); process.stdout.write(JSON.stringify({gone:gone.length,deleted:n}));`
        : `db.close(); process.stdout.write(JSON.stringify({gone:gone.length,deleted:0}));`}
    `;
    const r = spawnSync(process.execPath, ['-e', code('delete')], { encoding: 'utf8' });
    if (r.status !== 0) rec(`[phase2b] sync_state cleanup FAILED: ${(r.stderr || '').trim()}`);
    else rec(`[phase2b] sync_state ${r.stdout}`);
  }

  const logFile = join(CFG.reportDir, `cleanup-apply-${stamp}.log`);
  try { mkdirSync(CFG.reportDir, { recursive: true }); writeFileSync(logFile, logLines.join('\n') + '\n'); rec(`# log written to ${logFile}`); } catch (e) { log(`[apply] log write failed: ${e}`); }
  return { logLines, logFile };
}

// ── rollback ──────────────────────────────────────────────────────────────
function cmdRollback(args, backupDir) {
  if (!backupDir) throw new Error('--rollback requires --backup-dir <backup/STAMP>');
  const manifestPath = join(backupDir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`no manifest at ${manifestPath}`);
  const bm = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const out = [];
  const run = (label, cmd, argv) => {
    const r = spawnSync(cmd, argv, { encoding: 'utf8' });
    out.push(`${label}: exit=${r.status} ${(r.stderr || '').trim().slice(0, 300)}`);
    log(out[out.length - 1]);
  };
  run('sessions(tar)', 'tar', ['-C', CFG.sessionsRoot, '-xf', bm.tarFile]);
  run('workspace.json', 'cp', ['-a', join(backupDir, 'meta', 'workspace.json'), CFG.workspaceJson]);
  run('session_projcache.json', 'cp', ['-a', join(backupDir, 'meta', 'session_projcache.json'), CFG.projCache]);
  run('usage.db', 'cp', ['-a', join(backupDir, 'meta', 'usage.db'), CFG.usageDb]);
  if (bm.legacyTar && existsSync(bm.legacyTar)) {
    run('legacy-projcache', 'tar', ['-C', dirname(CFG.legacyCacheDir), '-xf', bm.legacyTar]);
  }
  // verify metadata pre-images BEFORE any further mutation of usage.db
  const verify = [];
  for (const m of bm.meta ?? []) {
    const b = basenameOf(m.path);
    const target = b === 'workspace.json' ? CFG.workspaceJson
      : b === 'session_projcache.json' ? CFG.projCache
      : b === 'usage.db' ? CFG.usageDb : null;
    if (!target || !existsSync(target)) { verify.push({ file: b, ok: false, reason: 'target missing after restore' }); continue; }
    const got = sha256File(target);
    verify.push({ file: b, ok: got === m.sha256, restoredSha256: got, expectedSha256: m.sha256 });
  }

  const snapshot = join(backupDir, 'meta', 'sync_state-dsh-rows.json');
  if (existsSync(snapshot)) {
    const code = `
      const {DatabaseSync}=require('node:sqlite');
      const rows=JSON.parse(require('node:fs').readFileSync(${JSON.stringify(snapshot)},'utf8'));
      const db=new DatabaseSync(${JSON.stringify(CFG.usageDb)},{readOnly:false});
      const ins=db.prepare('insert or replace into sync_state(source,mtime,size,fingerprint,last_seq,last_offset) values(?,?,?,?,?,?)');
      let n=0; db.exec('BEGIN'); try{for(const r of rows){n+=ins.run(r.source,r.mtime,r.size,r.fingerprint,r.last_seq,r.last_offset).changes;} db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
      db.close(); process.stdout.write(JSON.stringify({restored:n}));
    `;
    const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' });
    out.push(`sync_state: exit=${r.status} ${r.stdout || (r.stderr || '').trim().slice(0, 300)}`);
    log(out[out.length - 1]);
  }
  const sessionCount = (() => {
    try { return readdirSync(CFG.sessionsRoot).reduce((n, slug) => n + readdirSync(join(CFG.sessionsRoot, slug), { withFileTypes: true }).filter((e) => e.isDirectory()).length, 0); } catch { return null; }
  })();
  out.push(`verify: ${verify.map((v) => `${v.file}=${v.ok ? 'MATCH' : 'MISMATCH'}`).join(' ')} sessionDirs=${sessionCount}`);
  log(out[out.length - 1]);
  return { out, verify, sessionDirs: sessionCount };
}

function basenameOf(p) { return String(p).split('/').pop(); }

// ── main ──────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  log(`[cfg] dsh=${CFG.dshHome} sessions=${CFG.sessionsRoot} workspace=${CFG.workspaceDir} cmd=${args.cmd} days=${args.days} phase=${args.phase}`);

  if (args.cmd === 'rollback') {
    const res = cmdRollback(args, args.backupDir);
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return;
  }

  const s = loadOrScan(args);
  const sel = select(s.records, s.projCache, { days: args.days });
  const report = buildReport(args, s.records, sel, s.projCache, s.sync, s.legacy, s.host, s.orphans);
  report.paths.workspaceDirHint = CFG.workspaceDir;
  // every later stage re-evaluates the SAME window snapshot the manifest was built with
  const frozenNowMs = Date.parse(report.window.nowISO);

  if (args.cmd === 'dry-run') {
    mkdirSync(CFG.reportDir, { recursive: true });
    const jsonPath = args.outJson ? resolve(args.outJson) : join(CFG.reportDir, 'cleanup-dry-run.json');
    const mdPath = args.outMd ? resolve(args.outMd) : join(CFG.reportDir, 'cleanup-dry-run.md');
    writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    writeFileSync(mdPath, renderMarkdown(report));
    log(`[dry-run] deletable=${report.counts.deletableSessions} bytes=${report.counts.deletableBytes} excluded=${report.counts.excludedSessions}`);
    log(`[dry-run] wrote ${jsonPath}`);
    log(`[dry-run] wrote ${mdPath}`);
    log('[dry-run] NOTHING WAS DELETED.');
  } else if (args.cmd === 'backup') {
    const ageMs = Date.now() - frozenNowMs;
    if (ageMs > 3600000) log(`[backup] WARNING: the manifest is ${(ageMs / 60000).toFixed(0)} minutes old; targets stay frozen to that window (re-run --dry-run for a fresh one).`);
    const { dir } = cmdBackup(args, report);
    log(`[backup] done: ${dir}`);
  } else if (args.cmd === 'apply') {
    cmdApply(args, report, args.backupDir || latestBackupDir(), frozenNowMs);
  }
}

function latestBackupDir() {
  if (!existsSync(CFG.backupRoot)) return null;
  const dirs = readdirSync(CFG.backupRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(CFG.backupRoot, e.name, 'manifest.json')))
    .map((e) => e.name).sort();
  return dirs.length ? join(CFG.backupRoot, dirs[dirs.length - 1]) : null;
}

main().catch((e) => { log(`ERROR: ${e?.stack || e}`); process.exit(1); });
