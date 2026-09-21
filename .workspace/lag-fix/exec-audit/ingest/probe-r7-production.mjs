#!/usr/bin/env node
/**
 * probe-r7-production.mjs — 只读生产 usage.db，量化 U-IG3 的后果面：
 *   P1 usage_daily 是否残留 NULL model/project 变体（解释 PK NULL 语义）
 *   P2 usage_daily 与 usage_events 的真实重算是否一致（陈旧性）
 *   P3 usage_daily 行数 / MAX(day)（快路径门控现状）
 * 只读：new DatabaseSync(path, { readOnly: true })。不写、不 VACUUM、不改任何东西。
 */
import { DatabaseSync } from 'node:sqlite';

const P = '/home/CNS2026495165/.dsh/storages/usage/usage.db';
const out = { path: P };
let db;
try {
  db = new DatabaseSync(P, { readOnly: true });
} catch (e) {
  out.openError = e.message;
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}
const q = (sql, ...a) => { try { return db.prepare(sql).all(...a); } catch (e) { return { error: e.message }; } };

out.journalMode = db.prepare('PRAGMA journal_mode').get();
out.busyTimeout = db.prepare('PRAGMA busy_timeout').get();
out.P1_nullVariants = q(`SELECT (model IS NULL) AS model_null, (project IS NULL) AS project_null, COUNT(*) AS n FROM usage_daily GROUP BY 1,2`);
out.P1_eventsNullVariants = q(`SELECT (model IS NULL) AS model_null, (project IS NULL) AS project_null, COUNT(*) AS n FROM usage_events GROUP BY 1,2`);
out.P3_daily = q('SELECT COUNT(*) AS rows FROM usage_daily');
out.P3_maxDay = q('SELECT MAX(day) AS d, MIN(day) AS mn FROM usage_daily');
out.P3_events = q('SELECT data_source, COUNT(*) AS n FROM usage_events GROUP BY 1');

// P2: 逐行比对（不用 SQL 聚合，避免 GROUP BY 临时表；改用 JS 聚合）
const evs = q('SELECT ts, data_source, model, project FROM usage_events');
const dls = q('SELECT day, data_source, model, project, requests FROM usage_daily');
if (Array.isArray(evs) && Array.isArray(dls)) {
  const p2 = (n) => String(n).padStart(2, '0');
  const jsDay = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
  const tm = new Map();
  for (const e of evs) { const k = `${jsDay(e.ts)}|${e.data_source}|${e.model ?? '(unknown)'}|${e.project ?? '(unknown)'}`; tm.set(k, (tm.get(k) ?? 0) + 1); }
  const dm = new Map();
  for (const d of dls) dm.set(`${d.day}|${d.data_source}|${d.model}|${d.project}`, d.requests);
  const mism = [], orph = [], miss = [];
  for (const [k, c] of dm) { if (!tm.has(k)) orph.push(k); else if (tm.get(k) !== c) mism.push({ k, daily: c, true: tm.get(k), delta: tm.get(k) - c }); }
  for (const [k, c] of tm) if (!dm.has(k)) miss.push({ k, true: c });
  out.P2 = {
    eventsRows: evs.length, dailyRows: dls.length, trueKeys: tm.size, dailyKeys: dm.size,
    mismatched: mism.length, mismatchedFirst15: mism.slice(0, 15),
    orphan: orph.length, orphanFirst10: orph.slice(0, 10),
    missing: miss.length, missingFirst15: miss.slice(0, 15),
    maxAbsDelta: mism.reduce((a, r) => Math.max(a, Math.abs(r.delta)), 0),
  };
} else {
  out.P2 = { error: 'read failed', evs, dls };
}
db.close();
console.log(JSON.stringify(out, null, 2));
