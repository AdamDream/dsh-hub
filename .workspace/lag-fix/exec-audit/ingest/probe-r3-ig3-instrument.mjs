#!/usr/bin/env node
/**
 * probe-r3-ig3-instrument.mjs — 抓住 U-IG3 失败现场的真实输入。
 * 只读源 + 全部落盘在 ./scratch3；绝不碰生产库。
 *
 * 手法：包一层 DatabaseSync，记录每个 statement 的 SQL + 参数；
 * 当 foldDshSource 报出某个失败文件时，把该文件单独重放进**同一个库**，
 * 并把 rebuildDailyForDays 的 (days / GROUP BY 产出 / 失败键) 全部打出来。
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = '/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib';
const { openUsageDb, ensureSchema } = await import(`file://${LIB}/db.js`);
const { foldDshSource } = await import(`file://${LIB}/ingest-dsh.js`);

const scratch = resolve(HERE, 'scratch3');
rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });

const out = { env: { TZ: process.env.TZ ?? '(unset)', now: new Date().toString() } };

// 记录最近一次 rebuild 的输入
const trace = { lastRebuild: null, sqlLog: [] };
function instrument(db) {
  const realPrepare = db.prepare.bind(db);
  const realExec = db.exec.bind(db);
  const observed = [];
  db.prepare = (sql) => {
    const st = realPrepare(sql);
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (/usage_daily/.test(s)) {
      const realRun = st.run.bind(st);
      st.run = (...args) => {
        try { return realRun(...args); }
        catch (e) { observed.push({ sql: s.slice(0, 260), args, error: `${e.message}` }); throw e; }
      };
      const realAll = st.all.bind(st);
      st.all = (...args) => {
        try { const r = realAll(...args); if (/INSERT INTO usage_daily/.test(s) === false) observed.push({ sql: s.slice(0, 260), args, rows: r.length }); return r; }
        catch (e) { observed.push({ sql: s.slice(0, 260), args, error: `${e.message}` }); throw e; }
      };
    }
    return st;
  };
  db.exec = (sql) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (/usage_daily|BEGIN|COMMIT|ROLLBACK/.test(s)) observed.push({ exec: s.slice(0, 200) });
    return realExec(sql);
  };
  return observed;
}

const db = await openUsageDb(resolve(scratch, 'inst.db'));
ensureSchema(db);
const observed = instrument(db);

const t0 = Date.now();
const res = foldDshSource(db, undefined, {});
out.foldWallMs = Date.now() - t0;
out.scanned = res.scanned;
out.newEvents = res.newEvents;
out.failedFiles = res.failedFiles.map((f) => ({
  file: String(f.file).replace('/home/CNS2026495165/.dsh/sessions/', ''),
  error: String(f.error).slice(0, 200),
}));

// 现场：失败文件的真实路径 + 相关 usage_daily 行
const failing = res.failedFiles.filter((f) => String(f.error).includes('UNIQUE'));
out.uniqueFailCount = failing.length;

// 逐个失败文件：重放该文件的 rebuild（直接调用 foldDshSource 的单文件根不可行），
// 改为在**当前库**上重算"该文件事件所影响的 day 集合"的理论值，并与 usage_daily 对照。
const p2 = (n) => String(n).padStart(2, '0');
const jsDay = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };

// 关键判定：库内 usage_daily 是否存在"同一逻辑键的 NULL 变体"共存
const nullVariant = db.prepare(`
  SELECT (model IS NULL) AS model_null, (project IS NULL) AS project_null, COUNT(*) AS n
  FROM usage_daily GROUP BY 1,2`).all();
out.dailyNullVariants = nullVariant;

const dailyAll = db.prepare('SELECT day, data_source, model, project, requests FROM usage_daily ORDER BY day, model, project').all();
out.dailyRowCount = dailyAll.length;

// 是否存在 (model IS NULL) 或 (project IS NULL) 的行？
out.dailyRowsWithNull = dailyAll.filter((r) => r.model === null || r.project === null).length;

// 是否存在同 (day,data_source,model,project) 重复？不可能（PK），但验证
// 是否存在 '(unknown)' 之外的字面量
const distinctModel = db.prepare('SELECT DISTINCT model FROM usage_daily LIMIT 40').all();
out.distinctModels = distinctModel.map((r) => r.model);

// 抓最后的 rebuild 相关联的 observed 错误
out.observedErrors = observed.filter((o) => o.error).slice(-10);
out.observedTail = observed.slice(-14);

// 手工复算：把整库的 daily 全量重建（全 day 集合）——若成功，说明"少传 day"才是关键
const allDays = [...new Set(dailyAll.map((r) => r.day))].sort();
let fullRebuildErr = null;
try {
  const { rebuildDailyForDays } = await import(`file://${LIB}/db.js`);
  rebuildDailyForDays(db, allDays);
} catch (e) { fullRebuildErr = `${e.message}`; }
out.fullRebuildAllDays = { days: allDays.length, error: fullRebuildErr };

// 复算后 daily 是否收敛
const evRows = db.prepare('SELECT ts, data_source, model, project FROM usage_events').all();
const tm = new Map();
for (const e of evRows) { const k = `${jsDay(e.ts)}|${e.data_source}|${e.model ?? '(unknown)'}|${e.project ?? '(unknown)'}`; tm.set(k, (tm.get(k) ?? 0) + 1); }
const dm = new Map();
for (const r of db.prepare('SELECT day, data_source, model, project, requests FROM usage_daily').all()) dm.set(`${r.day}|${r.data_source}|${r.model}|${r.project}`, r.requests);
let mis = 0, orph = 0, miss = 0;
for (const [k, c] of dm) { if (!tm.has(k)) orph++; else if (tm.get(k) !== c) mis++; }
for (const [k] of tm) if (!dm.has(k)) miss++;
out.afterFullRebuild = { mismatched: mis, orphan: orph, missing: miss, trueKeys: tm.size, dailyKeys: dm.size };

db.close();
writeFileSync(resolve(HERE, 'out-r3.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  foldWallMs: out.foldWallMs, scanned: out.scanned, newEvents: out.newEvents,
  uniqueFailCount: out.uniqueFailCount, failedFiles: out.failedFiles.length,
  dailyNullVariants: out.dailyNullVariants, dailyRowsWithNull: out.dailyRowsWithNull,
  dailyRowCount: out.dailyRowCount, distinctModels: out.distinctModels,
  fullRebuildAllDays: out.fullRebuildAllDays, afterFullRebuild: out.afterFullRebuild,
  observedErrors: out.observedErrors, observedTail: out.observedTail,
}, null, 2));
