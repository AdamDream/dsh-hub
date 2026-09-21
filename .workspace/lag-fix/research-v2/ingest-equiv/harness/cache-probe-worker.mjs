import { parentPort, workerData } from "node:worker_threads";
import { loadDeployed } from "./deployed-lib.mjs";

const { rebuildDailyForDays, queryHeatmap } = await loadDeployed("db.js");
const { DatabaseSync } = await import("node:sqlite");

const db = new DatabaseSync(workerData.dbPath);
// Real deployed rebuild: this calls invalidateMaxDailyDayCache() — in THIS thread.
rebuildDailyForDays(db, ["2026-01-05"]);
const workerCallAfterRebuild = (() => { try { queryHeatmap(db, { year: 2026 }); return "ok"; } catch (e) { return `${e.code ?? e.name}: ${e.message}`; } })();
db.close();
parentPort.postMessage({ invalidateCalledInWorker: true, workerCallAfterRebuild });
