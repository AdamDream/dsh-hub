import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
const db = new DatabaseSync(":memory:");
db.exec("create table t(a)");
const w = new Worker(new URL("./probe-db-clone-worker.mjs", import.meta.url), { workerData: { db } });
w.on("error", (e) => { console.log("WORKER_ERROR:", e.constructor.name, "|", String(e.message).slice(0,300)); process.exit(0); });
w.on("message", (m) => console.log("WORKER_MSG:", m));
