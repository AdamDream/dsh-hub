import { workerData, parentPort } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(workerData.path);
db.exec("PRAGMA journal_mode = WAL");
db.exec("BEGIN IMMEDIATE");
db.prepare("INSERT INTO usage_events (ts, data_source) VALUES (?, 'dsh')").run(1756099999999);
parentPort.postMessage("holding");
const until = Date.now() + (workerData.holdMs ?? 400);
while (Date.now() < until) { /* spin holding the txn */ }
db.exec("COMMIT");
db.close();
