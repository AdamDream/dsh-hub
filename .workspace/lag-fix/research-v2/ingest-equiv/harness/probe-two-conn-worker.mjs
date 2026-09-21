import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(workerData.path);
db.exec("PRAGMA journal_mode = WAL");
const ins = db.prepare("INSERT INTO usage_events (k,v) VALUES (?,?)");
db.exec("BEGIN");
ins.run("a", "1"); ins.run("b", "2");
parentPort.postMessage({ stage: "inserted-inside-open-txn" });
await new Promise((r) => parentPort.once("message", r)); // commit
db.exec("COMMIT");
parentPort.postMessage({ stage: "committed" });
await new Promise((r) => parentPort.once("message", r)); // daily
db.exec("BEGIN");
db.prepare("DELETE FROM usage_daily WHERE day='2026-01-01'").run();
db.prepare("INSERT INTO usage_daily (day,n) SELECT '2026-01-01', COUNT(*) FROM usage_events").run();
db.exec("COMMIT");
parentPort.postMessage({ stage: "daily-done" });
await new Promise((r) => parentPort.once("message", r)); // close
db.close();
parentPort.postMessage({ stage: "closed" });
