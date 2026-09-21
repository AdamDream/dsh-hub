#!/usr/bin/env node
/**
 * probe-r6-boundary-fix.mjs — (A) JS localDay vs SQL strftime 日界一致性（多年/多时区）
 *                            (B) U-IG3 最小修法的候选验证（区间对齐 vs UPSERT）
 * 只读源；库在 ./scratch6。
 */
import { mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = '/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib';
const { openUsageDb, ensureSchema, insertEvent } = await import(`file://${LIB}/db.js`);

const out = { env: { TZ: process.env.TZ ?? '(unset)' } };
const scratch = resolve(HERE, 'scratch6');
rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });
const db = await openUsageDb(resolve(scratch, 'b.db'));
ensureSchema(db);

const p2 = (n) => String(n).padStart(2, '0');
const jsDay = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const sqlDayStmt = db.prepare("SELECT strftime('%Y-%m-%d', ? / 1000, 'unixepoch', 'localtime') AS day");

// ---------- A: 日界一致性（2024–2027 逐日扫描）----------
const diffs = [];
let checked = 0;
for (let dayStart = new Date(2024, 0, 1).getTime(); dayStart < new Date(2027, 0, 1).getTime(); dayStart += 86_400_000) {
  for (const off of [0, 1, -1, 3_600_000, -3_600_000]) {
    const ts = dayStart + off;
    checked += 1;
    const j = jsDay(ts);
    const s = sqlDayStmt.get(ts).day;
    if (j !== s) diffs.push({ ts, iso: new Date(ts).toISOString(), js: j, sql: s });
  }
}
// 真实数据里出现过的年份再做一次逐小时扫描
const hourlyDiffs = [];
let hourlyChecked = 0;
for (const y of [2025, 2026]) {
  for (let t = new Date(y, 0, 1).getTime(); t < new Date(y + 1, 0, 1).getTime(); t += 3_600_000) {
    hourlyChecked += 1;
    const j = jsDay(t); const s = sqlDayStmt.get(t).day;
    if (j !== s) hourlyDiffs.push({ t, iso: new Date(t).toISOString(), js: j, sql: s });
  }
}
out.A_dayBoundary = { checked, diffCount: diffs.length, diffsFirst5: diffs.slice(0, 5), hourlyChecked, hourlyDiffCount: hourlyDiffs.length, hourlyFirst5: hourlyDiffs.slice(0, 5) };

// ---------- B: 最小修法验证 ----------
// 造场景：08-19/08-20/08-24/08-25 有事件；08-21/08-22 已被别的文件写入过 daily 行。
const mkRow = (ts, key, model, project, input) => insertEvent(db, {
  data_source: 'dsh', session_id: 'sF', dedup_key: key, ts, model, provider: 'p', project,
  turn: 1, step: 1, is_subagent: false, input_tokens: input, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0,
});
const D = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
mkRow(D(2026, 8, 19), 't1:s1', 'm1', '/proj', 10);
mkRow(D(2026, 8, 20), 't2:s1', 'm1', '/proj', 20);
mkRow(D(2026, 8, 21), 't3:s1', 'm1', '/proj', 30);   // 间隙日
mkRow(D(2026, 8, 22), 't4:s1', 'm1', '/proj', 40);   // 间隙日
mkRow(D(2026, 8, 24), 't5:s1', 'm1', '/proj', 50);
mkRow(D(2026, 8, 25), 't6:s1', 'm1', '/proj', 60);

// 复刻 deployed 的行为（内联，等价于 rebuildDailyForDays）
const localDayMs = (day) => { const [y, m, d] = String(day).split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
const deployedRebuild = (days) => {
  const placeholders = days.map(() => '?').join(', ');
  const lo = days.reduce((a, d) => Math.min(a, localDayMs(d)), Number.POSITIVE_INFINITY);
  const hi = days.reduce((a, d) => Math.max(a, localDayMs(d)), Number.NEGATIVE_INFINITY) + 86_400_000;
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM usage_daily WHERE day IN (${placeholders})`).run(...days);
    db.prepare(`INSERT INTO usage_daily (day, data_source, model, project, requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
SELECT strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime') AS day, data_source, COALESCE(model,'(unknown)'), COALESCE(project,'(unknown)'),
 COUNT(*), SUM(input_tokens), SUM(output_tokens), SUM(cache_read_tokens), SUM(cache_write_tokens)
FROM usage_events WHERE ts >= ? AND ts < ?
GROUP BY day, data_source, COALESCE(model,'(unknown)'), COALESCE(project,'(unknown)')`).run(lo, hi);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
};
// 候选修法 A：区间对齐 —— DELETE 覆盖 [lo,hi) 内**所有**已有 day
const fixRange = (days) => {
  const lo = days.reduce((a, d) => Math.min(a, localDayMs(d)), Number.POSITIVE_INFINITY);
  const hi = days.reduce((a, d) => Math.max(a, localDayMs(d)), Number.NEGATIVE_INFINITY) + 86_400_000;
  db.exec('BEGIN');
  try {
    // 删除 [lo,hi) 覆盖的**全部** day（含未声明的间隙日），使 DELETE 集合 ⊇ INSERT 产出集合
    const spanDays = [];
    for (let t = lo; t < hi; t += 86_400_000) spanDays.push(jsDay(t));
    const ph = spanDays.map(() => '?').join(', ');
    db.prepare(`DELETE FROM usage_daily WHERE day IN (${ph})`).run(...spanDays);
    db.prepare(`INSERT INTO usage_daily (day, data_source, model, project, requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
SELECT strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime') AS day, data_source, COALESCE(model,'(unknown)'), COALESCE(project,'(unknown)'),
 COUNT(*), SUM(input_tokens), SUM(output_tokens), SUM(cache_read_tokens), SUM(cache_write_tokens)
FROM usage_events WHERE ts >= ? AND ts < ?
GROUP BY day, data_source, COALESCE(model,'(unknown)'), COALESCE(project,'(unknown)')`).run(lo, hi);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
};
// 候选修法 B：UPSERT
const fixUpsert = (days) => {
  const lo = days.reduce((a, d) => Math.min(a, localDayMs(d)), Number.POSITIVE_INFINITY);
  const hi = days.reduce((a, d) => Math.max(a, localDayMs(d)), Number.NEGATIVE_INFINITY) + 86_400_000;
  db.exec('BEGIN');
  try {
    const ph = days.map(() => '?').join(', ');
    db.prepare(`DELETE FROM usage_daily WHERE day IN (${ph})`).run(...days);
    db.prepare(`INSERT INTO usage_daily (day, data_source, model, project, requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
SELECT strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime') AS day, data_source, COALESCE(model,'(unknown)'), COALESCE(project,'(unknown)'),
 COUNT(*), SUM(input_tokens), SUM(output_tokens), SUM(cache_read_tokens), SUM(cache_write_tokens)
FROM usage_events WHERE ts >= ? AND ts < ?
GROUP BY day, data_source, COALESCE(model,'(unknown)'), COALESCE(project,'(unknown)')
ON CONFLICT(day, data_source, model, project) DO UPDATE SET
 requests=excluded.requests, input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens,
 cache_read_tokens=excluded.cache_read_tokens, cache_write_tokens=excluded.cache_write_tokens`).run(lo, hi);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
};

const dailySnapshot = () => db.prepare('SELECT day, requests, input_tokens FROM usage_daily ORDER BY day').all();
// 基线：先让间隙日有 daily 行（模拟"别的文件已写过"）
deployedRebuild(['2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-24', '2026-08-25']);
out.B0_baseline = dailySnapshot();

const gapDays = ['2026-08-19', '2026-08-20', '2026-08-24', '2026-08-25'];
let e1 = null;
try { deployedRebuild(gapDays); } catch (e) { e1 = e.message; }
out.B1_deployed_repro = { error: e1, after: dailySnapshot() };

let e2 = null;
try { fixRange(gapDays); } catch (e) { e2 = e.message; }
out.B2_fixRange = { error: e2, after: dailySnapshot() };

let e3 = null;
try { fixUpsert(gapDays); } catch (e) { e3 = e.message; }
out.B3_fixUpsert = { error: e3, after: dailySnapshot() };

// 产物等价性：两种修法后 daily 是否等于"全量重算"
const full = db.prepare(`SELECT strftime('%Y-%m-%d', ts/1000,'unixepoch','localtime') AS day, COUNT(*) AS requests, SUM(input_tokens) AS input_tokens
FROM usage_events GROUP BY 1 ORDER BY 1`).all();
out.B4_fullRecompute = full;
out.B_equivalence = {
  fixRangeEqualsFull: JSON.stringify(out.B2_fixRange.after.map((r) => [r.day, r.requests, r.input_tokens])) === JSON.stringify(full.map((r) => [r.day, r.requests, r.input_tokens])),
  fixUpsertEqualsFull: JSON.stringify(out.B3_fixUpsert.after.map((r) => [r.day, r.requests, r.input_tokens])) === JSON.stringify(full.map((r) => [r.day, r.requests, r.input_tokens])),
};

db.close();
console.log(JSON.stringify(out, null, 2));
