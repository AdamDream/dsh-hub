import { workerData, parentPort } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { queryHeatmap, rebuildDailyForDays } from "./lib/db.js";

const db = new DatabaseSync(workerData.filePath);
db.exec("PRAGMA journal_mode = WAL");
// the worker's own module instance starts with a COLD cache
const statsBefore = globalThis.__cacheStats ? JSON.parse(JSON.stringify(globalThis.__cacheStats)) : "(undefined at worker start)";
rebuildDailyForDays(db, ["2026-01-05"]);
queryHeatmap(db, { year: 2026 });
const statsAfter = JSON.parse(JSON.stringify(globalThis.__cacheStats));
db.close();
parentPort.postMessage({ statsBefore, statsAfter });
