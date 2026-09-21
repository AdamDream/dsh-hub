// Host-thread half of the MAX(day)-cache-scope test (uses the instrumented COPY).
import { DatabaseSync } from "node:sqlite";
import { queryHeatmap, rebuildDailyForDays } from "./lib/db.js";
import { Worker } from "node:worker_threads";

const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE usage_events (id INTEGER PRIMARY KEY, data_source TEXT NOT NULL, session_id TEXT NOT NULL, dedup_key TEXT NOT NULL, ts INTEGER NOT NULL, model TEXT, provider TEXT, project TEXT, turn INTEGER, step INTEGER, is_subagent INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_write_tokens INTEGER NOT NULL DEFAULT 0, UNIQUE(data_source,session_id,dedup_key)) STRICT`);
db.exec(`CREATE TABLE usage_daily (day TEXT NOT NULL, data_source TEXT NOT NULL, model TEXT, project TEXT, requests INTEGER NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL, cache_write_tokens INTEGER NOT NULL, PRIMARY KEY(day,data_source,model,project)) STRICT`);
const ts = new Date(2026, 0, 5, 12, 0, 0).getTime();
db.prepare("INSERT INTO usage_events (data_source,session_id,dedup_key,ts,model,provider,project,input_tokens,output_tokens) VALUES ('dsh','s','k',?, 'm','p','/x', 10, 1)").run(ts);
db.prepare("INSERT INTO usage_daily (day,data_source,model,project,requests,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens) VALUES ('2026-01-05','dsh','m','/x',1,10,1,0,0)").run();

// 1. warm the HOST cache
const heat1 = queryHeatmap(db, { year: 2026 });
const hostStatsWarm = JSON.parse(JSON.stringify(globalThis.__cacheStats));

// 2. host-side rebuild -> must reset the HOST cache (and invalidate is called)
rebuildDailyForDays(db, ["2026-01-05"]);
const hostStatsAfterHostRebuild = JSON.parse(JSON.stringify(globalThis.__cacheStats));

// 3. real rebuild inside a WORKER (in-memory DB cannot be shared, so this part
//    uses the same instrumented copy but a file-backed DB in a temp dir)
const { mkdtempSync, rmSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const dir = mkdtempSync(join(tmpdir(), "cache-scope-"));
const filePath = join(dir, "t.db");
const file = new DatabaseSync(filePath);
file.exec("PRAGMA journal_mode = WAL");
const SCHEMA = db.prepare("SELECT sql FROM sqlite_master WHERE name IN ('usage_events','usage_daily')").all();
for (const r of SCHEMA) file.exec(r.sql);
file.prepare("INSERT INTO usage_events (data_source,session_id,dedup_key,ts,model,provider,project,input_tokens,output_tokens) VALUES ('dsh','s','k',?, 'm','p','/x', 10, 1)").run(ts);
file.close();

const workerStats = await new Promise((res, rej) => {
	const w = new Worker(new URL("./worker.mjs", import.meta.url), { workerData: { filePath } });
	w.on("message", res); w.on("error", rej);
});

// 4. HOST reads again after the worker's rebuild: was the host cache invalidated?
const heat2 = queryHeatmap(db, { year: 2026 });
const hostStatsAfterWorkerRebuild = JSON.parse(JSON.stringify(globalThis.__cacheStats));

rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify({
	heat1, heat2,
	hostCacheAfterHostRebuild: hostStatsAfterHostRebuild,
	hostCacheAfterWorkerRebuild: hostStatsAfterWorkerRebuild,
	workerCache: workerStats,
	note: "the host cache is per-thread module state; the counters below show whether a worker's invalidate reaches it",
}, null, 2));
