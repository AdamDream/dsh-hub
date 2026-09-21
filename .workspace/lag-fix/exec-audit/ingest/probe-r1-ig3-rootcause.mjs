#!/usr/bin/env node
/**
 * probe-r1-ig3-rootcause.mjs — U-IG3 根因判别探针（只读 + 临时库）。
 *
 * 隔离：DB 只写在 .workspace/lag-fix/exec-audit/ingest/scratch/ 下；
 *       只**读** ~/.dsh/sessions；绝不调用 resolveDbPath()；不触碰生产 usage.db；不重启宿主。
 *
 * 判别三个候选：
 *   (1) "GROUP BY 键与 UNIQUE 键不一致"  → 构造：JS localDay 与 SQL strftime 对同一 ts 是否同值
 *   (2) "裸 INSERT 未 upsert"            → 构造：同事务 DELETE 后 INSERT 同键是否冲突（理论不冲突）
 *   (3) "DELETE 的 day 集合 ⊂ INSERT 产出的 day 集合" → 构造：故意少传一个 day，看是否必冲突
 * 再用真实 sessions root 实跑 fold，抓真实失败文件名 + 当天 usage_daily 现状。
 */
import { mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = '/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib';
const dbMod = await import(`file://${LIB}/db.js`);
const { openUsageDb, ensureSchema, insertEvent, rebuildDailyForDays } = dbMod;

const out = {};
out.env = {
  node: process.version,
  TZ: process.env.TZ ?? '(unset)',
  date: new Date().toString(),
  resolvedLocalDay: new Intl.DateTimeFormat().resolvedOptions().timeZone,
};

const scratch = resolve(HERE, 'scratch');
rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });

const db = await openUsageDb(resolve(scratch, 'r1.db'));
ensureSchema(db);

// ---------- 探针 A：JS localDay vs SQL strftime localtime 一致性 ----------
const tsSamples = [
  Date.UTC(2025, 7, 24, 5, 0, 0),        // 上海 13:00
  Date.UTC(2025, 7, 23, 16, 30, 0),      // 上海次日 00:30 —— 日界附近
  Date.UTC(2026, 2, 8, 4, 30, 0),        // 美国 DST 切换附近（上海无关）
  Date.now(),
  Date.now() - 86_400_000,
];
const jsLocalDay = (ts) => {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
out.A_dayAgreement = tsSamples.map((ts) => {
  const sql = db
    .prepare("SELECT strftime('%Y-%m-%d', ? / 1000, 'unixepoch', 'localtime') AS day")
    .get(ts).day;
  return { ts, iso: new Date(ts).toISOString(), js: jsLocalDay(ts), sql, agree: jsLocalDay(ts) === sql };
});
out.A_allAgree = out.A_dayAgreement.every((r) => r.agree);

// ---------- 探针 B：同键 DELETE→INSERT 在同一事务内是否冲突 ----------
const tsB = new Date(2025, 7, 24, 13, 0, 0).getTime(); // 2025-08-24 本地
insertEvent(db, {
  data_source: 'dsh', session_id: 'sB', dedup_key: 't1:s1', ts: tsB,
  model: 'm1', provider: 'p', project: '/tmp/proj',
  turn: 1, step: 1, is_subagent: false,
  input_tokens: 1, output_tokens: 2, cache_read_tokens: 3, cache_write_tokens: 4,
});
let bErr = null;
let bRows = null;
try {
  rebuildDailyForDays(db, ['2025-08-24']);
  rebuildDailyForDays(db, ['2025-08-24']); // 第二遍：DELETE 后重 INSERT 同键
  bRows = db.prepare('SELECT day, data_source, model, project, requests FROM usage_daily').all();
} catch (e) { bErr = `${e.constructor.name}: ${e.message}`; }
out.B_sameKeyTwice = { error: bErr, rows: bRows };

// ---------- 探针 C：故意少传一天 → 是否必抛 UNIQUE ----------
// 事件跨 08-24 与 08-25 两天；只声明 08-25 → 08-24 的旧 daily 行不会被 DELETE，
// 而 SELECT 的 ts 范围覆盖两天 → GROUP BY 产出 08-24 → INSERT 撞旧行。
const tsC1 = new Date(2025, 7, 24, 23, 0, 0).getTime();
const tsC2 = new Date(2025, 7, 25, 1, 0, 0).getTime();
insertEvent(db, {
  data_source: 'dsh', session_id: 'sC', dedup_key: 't1:s1', ts: tsC1,
  model: 'm1', provider: 'p', project: '/tmp/proj',
  turn: 1, step: 1, is_subagent: false, input_tokens: 5, output_tokens: 5,
  cache_read_tokens: 0, cache_write_tokens: 0,
});
insertEvent(db, {
  data_source: 'dsh', session_id: 'sC', dedup_key: 't2:s1', ts: tsC2,
  model: 'm1', provider: 'p', project: '/tmp/proj',
  turn: 2, step: 1, is_subagent: false, input_tokens: 7, output_tokens: 7,
  cache_read_tokens: 0, cache_write_tokens: 0,
});
rebuildDailyForDays(db, ['2025-08-24', '2025-08-25']); // 先建好两天
const cBefore = db.prepare('SELECT day, model, requests FROM usage_daily ORDER BY day').all();
let cErr = null;
try {
  rebuildDailyForDays(db, ['2025-08-25']); // 少传 08-24
} catch (e) { cErr = `${e.constructor.name}: ${e.message}`; }
out.C_missingDay = { before: cBefore, error: cErr };

// ---------- 探针 D：真实 sessions root 实跑（只读源，库在 scratch）----------
const { foldDshSource } = await import(`file://${LIB}/ingest-dsh.js`);
const db2 = await openUsageDb(resolve(scratch, 'r1-real.db'));
ensureSchema(db2);
const t0 = Date.now();
const res = foldDshSource(db2, undefined, {});
const wall = Date.now() - t0;
out.D_realFold = {
  wallMs: wall,
  scanned: res.scanned,
  newEvents: res.newEvents,
  failedFiles: res.failedFiles.length,
  failures: res.failedFiles.slice(0, 25).map((f) => ({
    file: String(f.file).replace('/home/CNS2026495165/.dsh/sessions/', ''),
    error: String(f.error).slice(0, 220),
  })),
};
out.D_failureKinds = {};
for (const f of res.failedFiles) {
  const k = String(f.error).includes('UNIQUE') ? 'UNIQUE'
    : String(f.error).includes('unable to open') ? 'OPEN'
    : 'OTHER';
  out.D_failureKinds[k] = (out.D_failureKinds[k] ?? 0) + 1;
}
// 失败文件是否真的"没入库"？取第一个 UNIQUE 失败文件的 sync_state 判断。
out.D_dailyRows = db2.prepare('SELECT COUNT(*) AS n FROM usage_daily').get().n;
out.D_maxDay = db2.prepare('SELECT MAX(day) AS d FROM usage_daily').get().d;
db2.close();

// ---------- 探针 E：daily 行是否真的"陈旧"（与 events 重算对比）----------
const db3 = await openUsageDb(resolve(scratch, 'r1-real.db'));
const mismatch = db3.prepare(`
SELECT d.day, d.data_source, d.model, d.project, d.requests AS daily_requests, e.requests AS true_requests
FROM usage_daily d
JOIN (
  SELECT strftime('%Y-%m-%d', ts/1000, 'unixepoch', 'localtime') AS day,
         data_source, COALESCE(model,'(unknown)') AS model, COALESCE(project,'(unknown)') AS project,
         COUNT(*) AS requests
  FROM usage_events GROUP BY 1,2,3,4
) e ON e.day = d.day AND e.data_source = d.data_source AND e.model = d.model AND e.project = d.project
WHERE d.requests <> e.requests
LIMIT 20`).all();
const orphan = db3.prepare(`
SELECT d.day, d.model, d.requests FROM usage_daily d
LEFT JOIN (
  SELECT strftime('%Y-%m-%d', ts/1000, 'unixepoch', 'localtime') AS day,
         data_source, COALESCE(model,'(unknown)') AS model, COALESCE(project,'(unknown)') AS project
  FROM usage_events GROUP BY 1,2,3,4
) e ON e.day = d.day AND e.data_source = d.data_source AND e.model = d.model AND e.project = d.project
WHERE e.day IS NULL LIMIT 20`).all();
const missing = db3.prepare(`
SELECT e.day, e.model, e.requests FROM (
  SELECT strftime('%Y-%m-%d', ts/1000, 'unixepoch', 'localtime') AS day,
         data_source, COALESCE(model,'(unknown)') AS model, COALESCE(project,'(unknown)') AS project,
         COUNT(*) AS requests
  FROM usage_events GROUP BY 1,2,3,4
) e
LEFT JOIN usage_daily d ON d.day = e.day AND d.data_source = e.data_source AND d.model = e.model AND d.project = e.project
WHERE d.day IS NULL LIMIT 20`).all();
out.E_dailyVsTrue = { mismatchedFirst20: mismatch, orphanFirst20: orphan, missingFirst20: missing };
db3.close();

console.log(JSON.stringify(out, null, 2));
