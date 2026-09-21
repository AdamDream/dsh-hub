import { workerData, parentPort } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(workerData.dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("CREATE TABLE usage_events (id INTEGER PRIMARY KEY, ts INTEGER, data_source TEXT) STRICT");
db.exec("BEGIN");
const ins = db.prepare("INSERT INTO usage_events (ts, data_source) VALUES (?, 'dsh')");
for (let i = 0; i < 500; i += 1) ins.run(1756000000000 + i);
db.exec("COMMIT");
// Park EXACTLY like the barrier design: hold until the host releases us.
parentPort.postMessage("parked");
Atomics.wait(new Int32Array(workerData.sab), 0, 0);
db.close();
