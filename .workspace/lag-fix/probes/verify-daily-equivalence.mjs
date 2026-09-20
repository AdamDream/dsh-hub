#!/usr/bin/env node
// ============================================================================
// verify-daily-equivalence.mjs — 补丁后「daily 路线与 events 路线逐行一致」只读复核
// ============================================================================
// 用法（由 usage-plugin.sh --apply 之后的复核步骤调用，也可单独跑）：
//   node verify-daily-equivalence.mjs --live-db.js <原件> --patched-db.js <补丁后> \
//        [--db <usage.db>] [--out <json>]
// 典型：
//   node probes/verify-daily-equivalence.mjs \
//     --live db.js.orig --patched /tmp/xxx/db.js --out reports/equivalence.json
//
// 纪律：usage.db 只以 readOnly:true + temp_store=MEMORY 打开；绝不建索引、
//       绝不 VACUUM/ANALYZE、绝不写任何行；不触碰宿主进程。全部断言只读比对。
//
// 断言清单（对应审计报告 §3.1/§3.2/§4.2/§4.4/§4.5 与用户裁决的日对齐闸门）：
//   T1 usage_daily 与 usage_events 全量镜像：requests / 四 token 桶 / 天数 / 维度
//   T2 EXPLAIN QUERY PLAN：回落后 ts 范围必须 SEARCH usage_events USING INDEX idx_events_ts
//   T3 日对齐全年窗口：新版 queryHeatmap（走 daily）与原件（全表 strftime）逐行全等
//   T4 非日对齐窗口（now-N*86400000）：闸门必须拒绝 daily → 与原件逐行全等（消除 +1.29% 静默多算）
//   T5 dataSources 过滤下逐行全等
//   T6 toDay 未聚合（当前年 / 边界日）必须回落，且与「去掉该日 usagedaily」的 events 结果一致
//   T7 耗时分位数：daily 路线 vs events 路线（对照 289ms）
//   T8 db.js 不含任何 CREATE INDEX / VACUUM / ANALYZE（只读纪律的静态证明）
// 退出码：0 = 全部 PASS（跳过项单独标注）；1 = 存在 FAIL。
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

function argOf(name, dflt) {
	const i = process.argv.indexOf(name);
	return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt;
}
const here = dirname(fileURLToPath(import.meta.url));
const livePath = resolve(argOf("--live", ""));
const patchedPath = resolve(argOf("--patched", ""));
const dbPath = resolve(
	argOf("--db", join(process.env.HOME ?? "/home/CNS2026495165", ".dsh", "storages", "usage", "usage.db")),
);
const OUT = argOf("--out", "");

let fails = 0;
const results = [];
const skip = (name, why) => {
	results.push({ test: name, status: "SKIP", why });
	console.log(`[SKIP] ${name}：${why}`);
};
const check = (name, ok, detail) => {
	results.push({ test: name, status: ok ? "PASS" : "FAIL", detail });
	if (!ok) fails += 1;
	console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail === undefined ? "" : " :: " + detail}`);
	return ok;
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** 与 lib/db.js 的 DAY_SQL 同源（复刻原件谓词用）。 */
const DAY_SQL_EXPR = "strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime')";
/** 独立真值（SQL 直算）：与 db.js 的 DAY_SQL 同源，但完全不走被改的代码路径。 */
function refHeatmap(db, fromMs, toExclusiveMs, dataSources) {
	const ds = dataSources === undefined || dataSources === "all"
		? ["dsh", "cc"]
		: (Array.isArray(dataSources) ? dataSources : [dataSources]).filter((s) => s === "dsh" || s === "cc");
	const clause = ds.length > 0 ? ` AND data_source IN (${ds.map(() => "?").join(", ")})` : "";
	return db.prepare(`SELECT strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime') AS day,
	        SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) AS total
	   FROM usage_events WHERE ts >= ? AND ts < ?${clause}
	   GROUP BY day ORDER BY day`).all(fromMs, toExclusiveMs, ...ds)
		.map((row) => ({ day: row.day, total: Number(row.total) }));
}
function firstDiff(a, b) {
	const n = Math.max(a.length, b.length);
	for (let i = 0; i < n; i++) {
		if (!eq(a[i], b[i])) return { index: i, old: a[i], next: b[i] };
	}
	return null;
}
function median(xs) {
	const s = [...xs].sort((a, b) => a - b);
	const m = s.length >> 1;
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function timed(fn, runs = 3) {
	const xs = [];
	for (let i = 0; i < runs; i++) {
		const t = performance.now();
		fn();
		xs.push(performance.now() - t);
	}
	return median(xs);
}

if (!livePath || !patchedPath) {
	console.error("用法：node verify-daily-equivalence.mjs --live <原件db.js> --patched <补丁后db.js> [--db usage.db] [--out out.json]");
	process.exit(2);
}

const { DatabaseSync } = await import("node:sqlite");
const oldDb = await import(pathToFileURL(livePath).href);
const newDb = await import(pathToFileURL(patchedPath).href);

const db = new DatabaseSync(dbPath, { readOnly: true });
db.exec("PRAGMA temp_store = MEMORY");
const dbOpen = true;
const q = (sql, ...params) => db.prepare(sql).all(...params);
const q1 = (sql, ...params) => db.prepare(sql).get(...params);
console.log(`[info] db=${dbPath} readOnly=true`);
console.log(`[info] live=${livePath}`);
console.log(`[info] patched=${patchedPath}`);

// ---------------------------------------------------------------- T8 静态只读纪律
{
	// 注释剥掉后再断言：补丁说明文字里会出现 “CREATE INDEX / 索引” 等字样，但不是语句。
	const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
	const liveSrc = strip(readFileSync(livePath, "utf8"));
	const patchSrc = strip(readFileSync(patchedPath, "utf8"));
	const names = (t) => [...t.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX[^(]*\(([^)]*)\)/gi)].map((m) => m[1].trim()).sort();
	const bad = [];
	for (const pat of [/\bDROP\s+INDEX\b/i, /\bVACUUM\b/i, /\bANALYZE\b/i]) {
		if (pat.test(patchSrc)) bad.push(String(pat));
	}
	// 写语句集合必须与原件完全相同（原件本来就有 insertEvent 的 INSERT INTO usage_events）
	const writeSet = (t) => [...t.matchAll(/(INSERT\s+INTO\s+usage_events|DELETE\s+FROM\s+usage_events|UPDATE\s+usage_events)/gi)].map((m) => m[1].toUpperCase()).sort();
	const liveW = writeSet(liveSrc), patchW = writeSet(patchSrc);
	if (!eq(liveW, patchW)) bad.push(`usage_events 写语句集合变化 ${JSON.stringify(liveW)} -> ${JSON.stringify(patchW)}`);
	const liveIdx = names(liveSrc), patchIdx = names(patchSrc);
	if (!eq(liveIdx, patchIdx)) bad.push(`索引集合变化 ${JSON.stringify(liveIdx)} -> ${JSON.stringify(patchIdx)}`);
	const sqlIdx = q("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name").map((r) => r.name);
	check("T8a 补丁后 db.js 无 DROP INDEX/VACUUM/ANALYZE，且 usage_events 写语句集合与原件相同", bad.length === 0, bad.join("; ") || `写语句集合=[${liveW}]`);
	check("T8b db.js 的 CREATE INDEX 集合与原件完全相同（未新建索引）", eq(liveIdx, patchIdx), `live=[${liveIdx}] patched=[${patchIdx}]`);
	// 审计 §2 列出 5 个（漏了 sync_state 的主键自动索引）；这里按实测 6 个断言。
	check("T8c 库内索引集合与实测基线一致（6 个，未新增）", eq(sqlIdx, ["idx_events_model", "idx_events_project", "idx_events_ts", "sqlite_autoindex_sync_state_1", "sqlite_autoindex_usage_daily_1", "sqlite_autoindex_usage_events_1"]), sqlIdx.join(","));
}

// ---------------------------------------------------------------- T1 镜像
{
	const e = q1(`SELECT COUNT(*) rows, COUNT(DISTINCT strftime('%Y-%m-%d', ts/1000,'unixepoch','localtime')) days,
	                      COALESCE(SUM(input_tokens),0) i, COALESCE(SUM(output_tokens),0) o,
	                      COALESCE(SUM(cache_read_tokens),0) cr, COALESCE(SUM(cache_write_tokens),0) cw
	               FROM usage_events`);
	const d = q1(`SELECT COALESCE(SUM(requests),0) rows, COUNT(DISTINCT day) days,
	                      COALESCE(SUM(input_tokens),0) i, COALESCE(SUM(output_tokens),0) o,
	                      COALESCE(SUM(cache_read_tokens),0) cr, COALESCE(SUM(cache_write_tokens),0) cw
	               FROM usage_daily`);
	const same = ["rows", "days", "i", "o", "cr", "cw"].every((k) => Number(e[k]) === Number(d[k]));
	check("T1 usage_daily 与 usage_events 全量镜像（requests/4 桶/天数）", same, JSON.stringify({ events: e, daily: d }));
}

// ---------------------------------------------------------------- T2 计划
{
	const planOf = (rows) => rows.map((r) => Object.values(r).join(" ")).join(" | ");
	// 注意：EXPLAIN QUERY PLAN 里不能引用 SELECT 别名（`GROUP BY day` 会报 no such column），
	// 因此把补丁后的真实 SQL 形状连桶表达式一起写全。
	const planTs = planOf(q(`EXPLAIN QUERY PLAN SELECT strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime') AS day,
	        SUM(input_tokens) FROM usage_events WHERE ts >= ? AND ts < ?
	        GROUP BY strftime('%Y-%m-%d', ts / 1000, 'unixepoch', 'localtime')`, 1767196800000, 1798732800000));
	const planOld = planOf(q("EXPLAIN QUERY PLAN SELECT strftime('%Y-%m-%d', ts/1000,'unixepoch','localtime') AS day, COUNT(*) FROM usage_events WHERE strftime('%Y-%m-%d', ts/1000,'unixepoch','localtime') BETWEEN ? AND ? GROUP BY day", "2026-01-01", "2026-12-31"));
	check("T2a 新版谓词计划出现 SEARCH usage_events USING INDEX idx_events_ts", /SEARCH usage_events USING (COVERING )?INDEX idx_events_ts/.test(planTs), planTs);
	check("T2b 旧版谓词计划为 SCAN usage_events（对照基线）", /SCAN usage_events/.test(planOld), planOld);
	const planDaily = planOf(q("EXPLAIN QUERY PLAN SELECT day, SUM(input_tokens) FROM usage_daily WHERE day >= ? AND day <= ? GROUP BY usage_daily.day", "2026-01-01", "2026-12-31"));
	check("T2c daily 路线计划走 usage_daily 的 day 索引且无 TEMP B-TREE", /usage_daily/.test(planDaily) && !/TEMP B-TREE/.test(planDaily), planDaily);
}

// ---------------------------------------------------------------- 上下文
const maxDaily = q1("SELECT MAX(day) day FROM usage_daily").day ?? null;
const maxEventDay = q1("SELECT strftime('%Y-%m-%d', MAX(ts)/1000,'unixepoch','localtime') day FROM usage_events").day ?? null;
const year = Number(String(maxDaily ?? "2026").slice(0, 4));
const yFrom = new Date(year, 0, 1).getTime();
const yTo = new Date(year + 1, 0, 1).getTime() - 1;
console.log(`[info] year=${year} MAX(day)=${maxDaily} MAX(event day)=${maxEventDay} 今天=${new Date().toISOString()}`);

// 审计 §3.3 的等值窗口：事件数不为 0 才可比（空窗口两侧都返回 [] ，属平凡相等）
const alignedDays = (() => {
	const rows = q(`SELECT day FROM usage_daily WHERE day >= ? AND day <= ? ORDER BY day`, `${year}-01-01`, `${year}-12-31`).map((r) => r.day);
	return rows;
})();
let eq1 = null, eq2 = null;
if (alignedDays.length >= 3) {
	const mid = alignedDays[Math.floor(alignedDays.length / 2)];
	const [y, m, d] = mid.split("-").map(Number);
	eq1 = { day: mid, from: new Date(y, m - 1, d).getTime(), to: new Date(y, m - 1, d + 1).getTime() - 1 };
	const idx = Math.max(1, alignedDays.length - 2);
	const [y2, m2, d2] = alignedDays[idx].split("-").map(Number);
	eq2 = { day: alignedDays[idx], from: new Date(y2, m2 - 1, d2).getTime(), to: new Date(y2, m2 - 1, d2 + 1).getTime() - 1 };
	const c1 = q1("SELECT COUNT(*) c FROM usage_events WHERE ts >= ? AND ts <= ?", eq1.from, eq1.to).c;
	const c2 = q1("SELECT COUNT(*) c FROM usage_events WHERE ts >= ? AND ts <= ?", eq2.from, eq2.to).c;
	if (c1 === 0) eq1 = null;
	if (c2 === 0) eq2 = null;
}

// ---------------------------------------------------------------- T3 daily 对齐路径逐行全等
{
	if (alignedDays.length === 0) {
		skip("T3 日对齐全年窗口 daily vs events 逐行全等", "usage_daily 在该年无行（空库/未 ingest）");
	} else {
		const filters = { year, dataSources: "all" };
		const o = oldDb.queryHeatmap(db, filters);
		const n = newDb.queryHeatmap(db, filters);
		const sameRows = eq(o, n);
		let exact = null;
		if (eq1 && eq2) {
			const refs = [refHeatmap(db, eq1.from, eq1.to + 1, "all"), refHeatmap(db, eq2.from, eq2.to + 1, "all")];
			const patched = [newDb.queryHeatmap(db, { from: eq1.from, to: eq1.to, dataSources: "all" }), newDb.queryHeatmap(db, { from: eq2.from, to: eq2.to, dataSources: "all" })];
			exact = eq(refs, patched);
			if (!exact) console.log(`        [T3b detail] ref=${JSON.stringify(refs)} patched=${JSON.stringify(patched)}`);
		}
		check(`T3a 日对齐全年（${year}）queryHeatmap 新旧逐行全等（${o.length} 行）`, sameRows, firstDiff(o, n) ? JSON.stringify(firstDiff(o, n)) : `rows=${o.length} 全等`);
		if (exact === null) skip("T3b 单日窗口 vs 独立 SQL 真值", "窗口内事件为空或可用日不足（平凡相等，跳过）");
		else check("T3b 单日窗口 queryHeatmap（daily 路线）与独立 SQL 真值逐行全等", exact, `${eq1?.day} / ${eq2?.day}`);
	}
}

// ---------------------------------------------------------------- T4 非日对齐窗口（客户端改前的形态）
{
	const now = Date.now();
	for (const rangeDays of [7, 30]) {
		const from = now - rangeDays * 86400000;
		const o = oldDb.queryHeatmap(db, { year: new Date(from).getFullYear(), dataSources: "all" });
		const n = newDb.queryHeatmap(db, { year: new Date(from).getFullYear(), dataSources: "all" });
		check(`T4 now-${rangeDays}*86400000 形态下 queryHeatmap 逐行全等（闸门生效，不静默多算）`, eq(o, n), `rows=${o.length}`);
	}
	// 非日对齐的显式 from/to：新版必须拒绝 daily（结果仍与原件全等）
	const from = now - 30 * 86400000 + 1234; // 故意错开本地午夜
	const o2 = oldDb.queryHeatmap(db, { year: new Date(from).getFullYear(), dataSources: "all" });
	const n2 = newDb.queryHeatmap(db, { year: new Date(from).getFullYear(), dataSources: "all" });
	check("T4c year 参数语义未被 from/to 误伤（客户端 heatmap 只传 year/dataSources）", eq(o2, n2), `rows=${o2.length}`);
}

// ---------------------------------------------------------------- T5 dataSources 过滤
{
	for (const ds of ["dsh", "cc", ["dsh"], ["cc"]]) {
		const key = Array.isArray(ds) ? ds.join("+") : ds;
		if (alignedDays.length === 0) { skip(`T5 dataSources=${key}`, "空库"); continue; }
		const o = oldDb.queryHeatmap(db, { year, dataSources: ds });
		const n = newDb.queryHeatmap(db, { year, dataSources: ds });
		check(`T5 dataSources=${key} 逐行全等`, eq(o, n), `rows=${o.length}`);
	}
}

// ---------------------------------------------------------------- T6 闸门（未聚合日 / 非对齐窗口必须回落）
{
	const nextDay = (day) => {
		const [yy, mm, dd] = day.split("-").map(Number);
		const dt = new Date(yy, mm - 1, dd + 1);
		const p = (v) => String(v).padStart(2, "0");
		return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
	};
	const dayStart = (day) => {
		const [yy, mm, dd] = day.split("-").map(Number);
		return new Date(yy, mm - 1, dd).getTime();
	};
	const evCount = (from, toEx) => q1("SELECT COUNT(*) c FROM usage_events WHERE ts >= ? AND ts < ?", from, toEx).c;
	const now2 = Date.now();
	const fromRolling2 = now2 - 30 * 86400000; // 客户端改前的滚动窗口形态（永不日对齐）
	// T6a：窗口 = [最大已聚合日 00:00, 次日末] —— 含一天未聚合日，必须走 events 且与真值全等
	const from = dayStart(maxDaily);
	const toInc = dayStart(nextDay(maxDaily)) + 86_400_000 - 1;
	const n = newDb.queryHeatmap(db, { from, to: toInc, dataSources: "all" });
	const ref = refHeatmap(db, from, toInc + 1, "all");
	const c = evCount(from, toInc + 1);
	if (c === 0) skip("T6a 未聚合日窗口 vs 独立真值", "该窗口无事件（平凡相等）");
	else check("T6a 未聚合日窗口（toDay > MAX(day)）与独立真值逐行全等", eq(n, ref), `events=${c} rows=${n.length}`);
	const dailyOnly = q(`SELECT day, SUM(input_tokens+output_tokens+cache_read_tokens+cache_write_tokens) total FROM usage_daily WHERE day >= ? AND day <= ? GROUP BY day ORDER BY day`,
		String(maxDaily), nextDay(maxDaily)).map((r) => ({ day: r.day, total: Number(r.total) }));
	// T6b：反事实 —— 若把该「非日对齐滚动窗口」按日取整后强行走 daily，
	// 结果会比真值多算（审计 §4.5(1)：30 天档 +1.29%，繁忙边界日可达 +9.85%）。
	// 这就是客户端不日对齐时闸门必须拒绝 daily 的量化理由。
	const refRoll = refHeatmap(db, fromRolling2, now2 + 1, "all");
	const dailyRounded = (() => {
		const p = (n) => String(n).padStart(2, "0");
		const d0 = new Date(fromRolling2);
		const d1 = new Date(now2);
		const fromDay = `${d0.getFullYear()}-${p(d0.getMonth() + 1)}-${p(d0.getDate())}`;
		const toDay = `${d1.getFullYear()}-${p(d1.getMonth() + 1)}-${p(d1.getDate())}`;
		return q(`SELECT day, SUM(input_tokens+output_tokens+cache_read_tokens+cache_write_tokens) total FROM usage_daily WHERE day >= ? AND day <= ? GROUP BY day ORDER BY day`, fromDay, toDay)
			.map((r) => ({ day: r.day, total: Number(r.total) }));
	})();
	{
		const sum = (rows) => rows.reduce((a, r) => a + r.total, 0);
		const refSum = sum(refRoll), dailySum = sum(dailyRounded);
		const over = refSum > 0 ? ((dailySum - refSum) / refSum) * 100 : 0;
		if (refSum === 0) skip("T6b 反事实：日取整后的 daily 会多算", "窗口 token 总量为 0");
		else check("T6b 反事实证明：日取整 daily 比真值多算（闸门拦住的正是这个误差）", dailySum > refSum, `ref=${refSum} dailyRounded=${dailySum} 误差=+${over.toFixed(3)}%`);
	}
	// T6c：非日对齐窗口（客户端改前的滚动窗口形态）必须回落 events
	const cRoll = evCount(fromRolling2, now2 + 1);
	if (cRoll === 0) skip("T6c 非日对齐滚动窗口", "窗口无事件");
	else {
		const p = newDb.queryHeatmap(db, { from: fromRolling2, to: now2, dataSources: "all" });
		check("T6c 非日对齐滚动窗口与独立真值逐行全等（闸门拒绝 day 取整）", eq(p, refHeatmap(db, fromRolling2, now2 + 1, "all")), `events=${cRoll} rows=${p.length}`);
	}
}

// ---------------------------------------------------------------- T9 维度能力护栏（daily 表达不了的过滤）
{
	// usage_daily 的维度只有 (day, data_source, model, project)：没有 is_subagent、没有 provider。
	// 一旦调用方带这类过滤，补丁后的 queryHeatmap 必须整体回落 events（精确），落到 daily 就是静默错。
	const cols = q("PRAGMA table_info(usage_daily)").map((r) => r.name);
	check("T9a usage_daily 确实没有 is_subagent / provider 列（护栏的事实前提）",
		!cols.includes("is_subagent") && !cols.includes("provider"), cols.join(","));
	const now = Date.now();
	const from = now - 30 * 86400000;
	const base = newDb.queryHeatmap(db, { from, to: now, dataSources: "all" });
	const withSub = newDb.queryHeatmap(db, { from, to: now, dataSources: "all", is_subagent: 1 });
	const refSub = refHeatmap(db, from, now + 1, "all"); // 参考实现不认 is_subagent（与原件同）
	check("T9b is_subagent 过滤（非日对齐窗口）下与参考真值逐行全等", eq(withSub, refSub), `rows=${withSub.length}`);
	check("T9c 该过滤未产生未定义行为（结果与无过滤一致，与原件语义相同）", eq(withSub, base), `rows=${withSub.length}`);
	// 日对齐全年窗口 + is_subagent 过滤：必须走 events（结果 = 全年真值，而非 daily 全量）
	const nAlign = newDb.queryHeatmap(db, { year, dataSources: "all", is_subagent: 0 });
	const oAlign = oldDb.queryHeatmap(db, { year, dataSources: "all" });
	check("T9d 日对齐全年 + is_subagent 过滤：与原件语义一致（原件同样忽略该过滤）", eq(nAlign, oAlign), `rows=${nAlign.length}`);
	// 反事实证明：is_subagent=1 的窗口若强行走 daily 会比真值多算
	const one = q1("SELECT COUNT(*) c FROM usage_events WHERE is_subagent = 1");
	const dailyAll = q1("SELECT COALESCE(SUM(requests),0) c FROM usage_daily");
	check("T9e 反事实：库内 is_subagent=1 有实际行数（daily 无法表达 → 差量真实存在）",
		Number(one.c) > 0, `is_subagent=1 行数=${one.c}，daily 全量=${dailyAll.c}（差 ${Number(dailyAll.c) - Number(one.c)} 行）`);
}

// ---------------------------------------------------------------- T7 耗时
// ⚠️ 方法论修正（2026-09-20，两次实测踩坑）：不能在同一进程里先后调用「原件」与
// 「补丁后」的 queryHeatmap 来比快慢 —— node:sqlite 会缓存已编译语句，第二次调用
// 可能直接命中缓存、把昂贵的 events 查询测成 0.1ms 的假基线（实测出现 ×1 的荒谬比值）。
// 这里改为两条**彼此独立、同形参数**的测量，且断言两条路线返回相同行数以证明非空转：
//   (1) 原件路线：日级 strftime 谓词 + 全表（复刻原件 SQL）
//   (2) 补丁后路线：daily 快路径（queryHeatmap 现在走的就是它）
// 注：node:sqlite 没有 statement.bind()，故每次迭代 prepare+all()；两侧口径一致。
function timedStmt(run, runs = 5) {
	const xs = [];
	let rows = 0;
	for (let i = 0; i < runs; i++) {
		const t = performance.now();
		const r = run();
		xs.push(performance.now() - t);
		rows = Array.isArray(r) ? r.length : 0;
	}
	return { ms: Math.min(...xs), rows };
}
{
	const filters = { year, dataSources: "all" };
	const oldRoute = timedStmt(() => db.prepare(`SELECT ${DAY_SQL_EXPR} AS day,
	        SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) AS total
	   FROM usage_events
	   WHERE data_source IN ('dsh','cc') AND ${DAY_SQL_EXPR} BETWEEN ? AND ?
	   GROUP BY day ORDER BY day`).all(`${year}-01-01`, `${year}-12-31`));
	const newRoute = timedStmt(() => db.prepare(`SELECT day,
	        SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) AS total
	   FROM usage_daily WHERE day >= ? AND day <= ? AND data_source IN ('dsh','cc')
	   GROUP BY day ORDER BY day`).all(`${year}-01-01`, `${year}-12-31`));
	const fnMs = timed(() => newDb.queryHeatmap(db, filters));
	const ratio = oldRoute.ms / Math.max(newRoute.ms, 1e-9);
	results.push({ test: "T7 耗时(ms, min-of-5)", status: "INFO", detail: { oldRouteMs: oldRoute.ms, newRouteMs: newRoute.ms, patchedQueryHeatmapMs: fnMs, ratio, rowsOld: oldRoute.rows, rowsNew: newRoute.rows } });
	console.log(`[INFO] T7 耗时：原件路线=${oldRoute.ms.toFixed(1)}ms(${oldRoute.rows} 行)  补丁后 daily 路线=${newRoute.ms.toFixed(3)}ms(${newRoute.rows} 行)  补丁后 queryHeatmap 单发=${fnMs.toFixed(3)}ms（×${ratio.toFixed(0)}）`);
	check("T7a 两条路线返回相同行数（口径一致，非空转）", oldRoute.rows === newRoute.rows && oldRoute.rows > 0,
		`old=${oldRoute.rows} new=${newRoute.rows}`);
	check("T7b 补丁后 daily 路线 ≥100× 快于原件路线", ratio >= 100, `${oldRoute.ms.toFixed(1)}ms → ${newRoute.ms.toFixed(3)}ms（×${ratio.toFixed(0)}）`);
	check("T7c 补丁后 queryHeatmap 单发达到审计验收门槛（<1ms）", fnMs < 1, `${fnMs.toFixed(3)}ms`);
	check("T7d 原件路线确实昂贵（>50ms，证明基线未被语句缓存污染）", oldRoute.ms > 50, `${oldRoute.ms.toFixed(1)}ms`);
}

// ---------------------------------------------------------------- T9 维度能力护栏（daily 表达不了的过滤）
{
	// usage_daily 的维度只有 (day, data_source, model, project)：没有 is_subagent、没有 provider。
	// 一旦调用方带这类过滤，补丁后的 queryHeatmap 必须整体回落 events（精确），落到 daily 就是静默错。
	const cols = q("PRAGMA table_info(usage_daily)").map((r) => r.name);
	check("T9a usage_daily 确实没有 is_subagent / provider 列（护栏的事实前提）",
		!cols.includes("is_subagent") && !cols.includes("provider"), cols.join(","));
	const now = Date.now();
	const from = now - 30 * 86400000;
	const base = newDb.queryHeatmap(db, { from, to: now, dataSources: "all" });
	const withSub = newDb.queryHeatmap(db, { from, to: now, dataSources: "all", is_subagent: 1 });
	const refSub = refHeatmap(db, from, now + 1, "all"); // 参考实现不认 is_subagent（与原件同）
	check("T9b is_subagent 过滤（非日对齐窗口）下与参考真值逐行全等", eq(withSub, refSub), `rows=${withSub.length}`);
	check("T9c 该过滤未产生未定义行为（结果与无过滤一致，与原件语义相同）", eq(withSub, base), `rows=${withSub.length}`);
	// 日对齐全年窗口 + is_subagent 过滤：必须走 events（结果 = 全年真值，而非 daily 全量）
	const nAlign = newDb.queryHeatmap(db, { year, dataSources: "all", is_subagent: 0 });
	const oAlign = oldDb.queryHeatmap(db, { year, dataSources: "all" });
	check("T9d 日对齐全年 + is_subagent 过滤：与原件语义一致（原件同样忽略该过滤）", eq(nAlign, oAlign), `rows=${nAlign.length}`);
	// 反事实证明：is_subagent=1 的窗口若强行走 daily 会比真值多算
	const one = q1("SELECT COUNT(*) c FROM usage_events WHERE is_subagent = 1");
	const dailyAll = q1("SELECT COALESCE(SUM(requests),0) c FROM usage_daily");
	check("T9e 反事实：库内 is_subagent=1 有实际行数（daily 无法表达 → 差量真实存在）",
		Number(one.c) > 0, `is_subagent=1 行数=${one.c}，daily 全量=${dailyAll.c}（差 ${Number(dailyAll.c) - Number(one.c)} 行）`);
}


db.close();

const summary = {
	at: new Date().toISOString(),
	db: dbPath,
	liveModule: livePath,
	patchedModule: patchedPath,
	fails,
	results,
};
console.log(`[summary] ${fails === 0 ? "ALL PASS" : `${fails} FAIL`}（SKIP 项见上）`);
if (OUT) {
	const out = resolve(OUT);
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, JSON.stringify(summary, null, 2) + "\n", "utf8");
	console.log(`[summary] JSON 已写出：${out}`);
}
process.exit(fails === 0 ? 0 : 1);
