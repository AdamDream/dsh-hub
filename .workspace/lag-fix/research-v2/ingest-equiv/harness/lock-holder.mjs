import { workerData, parentPort } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(workerData.path);
db.exec("PRAGMA journal_mode = WAL");
db.exec("BEGIN IMMEDIATE");
db.prepare("INSERT INTO t(a) VALUES (1)").run();
db.prepare("INSERT INTO t(a) VALUES (2)").run();
parentPort.postMessage("holding");
const until = Date.now() + (workerData.holdMs ?? 1500); while (Date.now() < until) {}
db.exec("COMMIT"); db.close();
