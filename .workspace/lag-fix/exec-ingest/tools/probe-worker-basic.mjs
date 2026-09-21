import { Worker } from "node:worker_threads";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const dir = join(process.cwd(), "scratch");
const wf = join(dir, "probe-w.mjs");
writeFileSync(wf, `
import { parentPort } from "node:worker_threads";
import { openUsageDb } from "${join(process.cwd(), "stage/lib-orig/db.js")}";
parentPort.on("message", async (m) => {
  try {
    const db = await openUsageDb(m.dbPath);
    db.exec("CREATE TABLE IF NOT EXISTS t (a)");
    parentPort.postMessage({ type: "done", id: m.id, threadId: 0, ok: true });
  } catch (e) { parentPort.postMessage({ type: "failed", id: m.id, message: String(e.message) }); }
});
`);
const before = process.getActiveResourcesInfo().filter((r) => r === "Worker").length;
const w = new Worker(wf, { type: "module" });
const msg = await new Promise((res, rej) => { w.on("message", res); w.on("error", rej); w.postMessage({ type: "start", id: 1, dbPath: join(dir, "probe.db") }); });
const mid = process.getActiveResourcesInfo().filter((r) => r === "Worker").length;
console.log(JSON.stringify({ before, mid, msg, threadId: w.threadId, err: null }));
await w.terminate();
await new Promise((r) => setTimeout(r, 200));
const after = process.getActiveResourcesInfo().filter((r) => r === "Worker").length;
console.log(JSON.stringify({ after, threadIdAfter: w.threadId }));
