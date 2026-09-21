#!/usr/bin/env node
/**
 * probe-r4-ig3-key.mjs — 钉死 U-IG3 的精确冲突键。
 * 只读源；库在 ./scratch4。
 *
 * 手法：完整复刻 rebuildDailyForDays 的语句序列，但把 INSERT 拆成
 *   (a) 用同一条 SELECT/GROUP BY 把产出行捞进 JS；
 *   (b) 逐行查 usage_daily 是否已有同键；
 *   (c) 打印冲突键 + 该键现有行的来源时间范围。
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = '/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib';
const { openUsageDb, ensureSchema } = await import(`file://${LIB}/db.js`);
const { foldDshSource } = await import(`file://${LIB}/ingest-dsh.js`);

const scratch = resolve(HERE, 'scratch4');
rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });

const out = { env: { TZ: process.env.TZ ?? '(unset)', now: new Date().toString() } };
const db = await openUsageDb(resolve(scratch, 'k.db'));
ensureSchema(db);

// 记录每次 rebuild 的 days：包装 db.prepare 抓 DELETE 参数 + INSERT 参数
const rebuildCalls = [];
{
  const realPrepare = db.prepare.bind(db);
  let pendingDelete = null;
  db.prepare = (sql) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    const st = realPrepare(sql);
    if (s.startsWith('DELETE FROM usage_daily')) {
      const realRun = st.run.bind(st);
      st.run = (...args) => { pendingDelete = args; return realRun(...args); };
    } else if (s.startsWith('INSERT INTO usage_daily')) {
      const realRun = st.run.bind(st);
      st.run = (...args) => {
        try { const r = realRun(...args); rebuildCalls.push({ days: pendingDelete, lo: args[0], hi: args[1], ok: true }); return r; }
        catch (e) {
          rebuildCalls.push({ days: pendingDelete, lo: args[0], hi: args[1], ok: false, error: e.message });
          // 现场诊断：把同一条 SELECT 的结果与现有行对照
          try {
            const rows = db.prepare(`
SELECT strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime') AS day,
       data_source, COALESCE(model, '(unknown)') AS model, COALESCE(project, '(unknown)') AS project,
       COUNT(*) AS requests
FROM usage_events WHERE ts >= ? AND ts < ?
GROUP BY day, data_source, COALESCE(model, '(unknown)'), COALESCE(project, '(unknown)')`).all(args[0], args[1]);
            const deleted = new Set(pendingDelete ?? []);
            const produced = new Set(rows.map((r) => r.day));
            const inRange = new Set([...deleted].filter((d) => {
              const t = new Date(`${d}T00:00:00`).getTime();
              return t >= args[0] && t < args[1];
            }));
            const daysNotDeleted = rows.filter((r) => !deleted.has(r.day));
            // 对每个"未被 DELETE 的产出 day"，看库里是否已有同键行
            const clash = [];
            for (const r of daysNotDeleted) {
              const hit = db.prepare('SELECT day, model, project, requests FROM usage_daily WHERE day=? AND data_source=? AND model=? AND project=?')
                .get(r.day, r.data_source, r.model, r.project);
              if (hit) clash.push({ produced: r, existing: hit });
            }
            // 也检查"被 DELETE 的 day"是否真的删干净了
            const leftovers = [];
            for (const r of rows) {
              if (!deleted.has(r.day)) continue;
              const hit = db.prepare('SELECT COUNT(*) AS n FROM usage_daily WHERE day=?').get(r.day).n;
              if (hit > 0) leftovers.push({ day: r.day, remaining: hit });
            }
            rebuildCalls[rebuildCalls.length - 1].diag = {
              deletedDays: [...deleted].sort(),
              deletedSetSize: deleted.size,
              producedDays: [...produced].sort(),
              producedCount: rows.length,
              daysNotDeletedCount: daysNotDeleted.length,
              daysNotDeletedSample: daysNotDeleted.slice(0, 6),
              clashCount: clash.length,
              clashSample: clash.slice(0, 6),
              leftovers,
              inRangeNotDeleted: [...produced].filter((d) => !deleted.has(d)).sort(),
            };
          } catch (e2) {
            rebuildCalls[rebuildCalls.length - 1].diagError = String(e2.message);
          }
          throw e;
        }
      };
    }
    return st;
  };
}

const t0 = Date.now();
const res = foldDshSource(db, undefined, {});
out.foldWallMs = Date.now() - t0;
out.scanned = res.scanned;
out.newEvents = res.newEvents;
out.failedCount = res.failedFiles.length;

const failing = rebuildCalls.filter((c) => !c.ok);
out.rebuildCalls = rebuildCalls.length;
out.failingRebuilds = failing.map((c) => ({
  days: c.days, lo: c.lo, hi: c.hi,
  loISO: new Date(c.lo).toString(), hiISO: new Date(c.hi).toString(),
  error: c.error, diag: c.diag, diagError: c.diagError,
}));
out.openErrors = failing.filter((c) => String(c.error).includes('unable to open')).length;
out.uniqueErrors = failing.filter((c) => String(c.error).includes('UNIQUE')).length;

db.close();
writeFileSync(resolve(HERE, 'out-r4.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  foldWallMs: out.foldWallMs, scanned: out.scanned, newEvents: out.newEvents,
  failedCount: out.failedCount, rebuildCalls: out.rebuildCalls,
  openErrors: out.openErrors, uniqueErrors: out.uniqueErrors,
  firstUnique: out.failingRebuilds.find((f) => String(f.error).includes('UNIQUE')),
}, null, 2));
