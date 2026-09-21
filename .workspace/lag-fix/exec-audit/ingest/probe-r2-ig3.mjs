#!/usr/bin/env node
/**
 * probe-r2-ig3.mjs — U-IG3 判别（第二版：不依赖 SQLite 临时表，避免 temp-store 噪声）。
 * 隔离同上：库在 ./scratch，源只读。
 */
import { mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = '/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib';
const { openUsageDb, ensureSchema, insertEvent, rebuildDailyForDays } = await import(`file://${LIB}/db.js`);
const { foldDshSource } = await import(`file://${LIB}/ingest-dsh.js`);

const scratch = resolve(HERE, 'scratch2');
rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });

const log = (...a) => { console.log(...a); };
const out = { env: { node: process.version, TZ: process.env.TZ ?? '(unset)', now: new Date().toString() } };

// ---------- B: 同键 DELETE→INSERT 两遍 ----------
{
  const db = await openUsageDb(resolve(scratch, 'b.db'));
  ensureSchema(db);
  const ts = new Date(2025, 7, 24, 13, 0, 0).getTime();
  insertEvent(db, { data_source: 'dsh', session_id: 'sB', dedup_key: 't1:s1', ts, model: 'm1', provider: 'p', project: '/tmp/proj', turn: 1, step: 1, is_subagent: false, input_tokens: 1, output_tokens: 2, cache_read_tokens: 3, cache_write_tokens: 4 });
  let err = null, rows = null;
  try {
    rebuildDailyForDays(db, ['2025-08-24']);
    rebuildDailyForDays(db, ['2025-08-24']);
    rows = db.prepare('SELECT day, data_source, model, project, requests FROM usage_daily').all();
  } catch (e) { err = `${e.constructor.name}: ${e.message}`; }
  out.B_sameKeyTwice = { error: err, rows };
  db.close();
}

// ---------- C: 少传一天 → 必抛 UNIQUE？ ----------
{
  const db = await openUsageDb(resolve(scratch, 'c.db'));
  ensureSchema(db);
  const mk = (ts, k) => insertEvent(db, { data_source: 'dsh', session_id: 'sC', dedup_key: k, ts, model: 'm1', provider: 'p', project: '/tmp/proj', turn: 1, step: 1, is_subagent: false, input_tokens: 5, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0 });
  mk(new Date(2025, 7, 24, 23, 0, 0).getTime(), 't1:s1');
  mk(new Date(2025, 7, 25, 1, 0, 0).getTime(), 't2:s1');
  rebuildDailyForDays(db, ['2025-08-24', '2025-08-25']);
  const before = db.prepare('SELECT day, model, requests FROM usage_daily ORDER BY day').all();
  let err = null;
  try { rebuildDailyForDays(db, ['2025-08-25']); } catch (e) { err = `${e.constructor.name}: ${e.message}`; }
  out.C_missingDay = { before, error: err };
  db.close();
}

// ---------- C2: 同一事务内 DELETE 全部 → 无冲突（对照：证明不是"裸 INSERT"本身错） ----------
{
  const db = await openUsageDb(resolve(scratch, 'c2.db'));
  ensureSchema(db);
  insertEvent(db, { data_source: 'dsh', session_id: 'sC2', dedup_key: 't1:s1', ts: new Date(2025, 7, 24, 12, 0, 0).getTime(), model: 'm1', provider: 'p', project: '/tmp/proj', turn: 1, step: 1, is_subagent: false, input_tokens: 5, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0 });
  rebuildDailyForDays(db, ['2025-08-24']);
  let err = null;
  try { rebuildDailyForDays(db, ['2025-08-24']); } catch (e) { err = e.message; }
  out.C2_repeatCorrectDay = { error: err };
  db.close();
}

// ---------- D: 真实 fold（只读源） ----------
const dbR = await openUsageDb(resolve(scratch, 'real.db'));
ensureSchema(dbR);
const t0 = Date.now();
const res = foldDshSource(dbR, undefined, {});
const wall = Date.now() - t0;
out.D_realFold = {
  wallMs: wall, scanned: res.scanned, newEvents: res.newEvents,
  failedFiles: res.failedFiles.length,
  failures: res.failedFiles.map((f) => ({
    file: String(f.file).replace('/home/CNS2026495165/.dsh/sessions/', ''),
    error: String(f.error).slice(0, 240),
  })),
};
const kinds = {};
for (const f of res.failedFiles) {
  const s = String(f.error);
  const k = s.includes('UNIQUE') ? 'UNIQUE' : s.includes('unable to open') ? 'OPEN' : 'OTHER';
  kinds[k] = (kinds[k] ?? 0) + 1;
}
out.D_failureKinds = kinds;

// ---------- E: daily 是否陈旧（纯 JS 比对，不用临时表） ----------
const dailyRows = dbR.prepare('SELECT day, data_source, model, project, requests FROM usage_daily').all();
const evRows = dbR.prepare('SELECT ts, data_source, model, project FROM usage_events').all();
const p2 = (n) => String(n).padStart(2, '0');
const jsDay = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const trueMap = new Map();
for (const e of evRows) {
  const k = `${jsDay(e.ts)}|${e.data_source}|${e.model ?? '(unknown)'}|${e.project ?? '(unknown)'}`;
  trueMap.set(k, (trueMap.get(k) ?? 0) + 1);
}
const dailyMap = new Map();
for (const d of dailyRows) {
  dailyMap.set(`${d.day}|${d.data_source}|${d.model}|${d.project}`, d.requests);
}
const mismatched = [], orphans = [], missing = [];
for (const [k, c] of dailyMap) if (trueMap.has(k) && trueMap.get(k) !== c) mismatched.push({ k, daily: c, true: trueMap.get(k) });
for (const [k] of dailyMap) if (!trueMap.has(k)) orphans.push(k);
for (const [k, c] of trueMap) if (!dailyMap.has(k)) missing.push({ k, true: c });
out.E_dailyVsTrue = {
  events: evRows.length, dailyRows: dailyRows.length,
  trueKeys: trueMap.size, dailyKeys: dailyMap.size,
  mismatchedCount: mismatched.length, orphanCount: orphans.length, missingCount: missing.length,
  mismatchedFirst10: mismatched.slice(0, 10), orphanFirst10: orphans.slice(0, 10), missingFirst10: missing.slice(0, 10),
};
out.D_maxDay = dbR.prepare('SELECT MAX(day) AS d FROM usage_daily').get().d;
dbR.close();

console.log(JSON.stringify(out, null, 2));
log('DONE');
