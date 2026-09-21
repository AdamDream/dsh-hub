// Probe: two DatabaseSync connections on the SAME db file (host query conn + "worker ingester" conn).
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "probe-2conn-"));
const path = join(dir, "t.db");
const host = new DatabaseSync(path);
host.exec("PRAGMA journal_mode = WAL");
host.exec("CREATE TABLE usage_events (id INTEGER PRIMARY KEY, k TEXT UNIQUE, v TEXT) STRICT");
host.exec("CREATE TABLE usage_daily (day TEXT PRIMARY KEY, n INTEGER) STRICT");

const w = new Worker(new URL("./probe-two-conn-worker.mjs", import.meta.url), { workerData: { path } });
const log = (...a) => console.log(...a);
w.on("message", (m) => {
  if (m.stage === "inserted-inside-open-txn") {
    // Host reads WHILE worker has an open write txn (uncommitted): does the host block, error, or see stale?
    const t0 = Date.now();
    try {
      const n = host.prepare("SELECT COUNT(*) AS c FROM usage_events").get().c;
      log(`  host read DURING worker txn: c=${n} waitedMs=${Date.now()-t0} (stale-but-no-error => WAL snapshot ok)`);
    } catch (e) { log(`  host read DURING worker txn: ERROR ${e.code} ${e.message} waitedMs=${Date.now()-t0}`); }
    w.postMessage("commit");
  } else if (m.stage === "committed") {
    const t0 = Date.now();
    const n = host.prepare("SELECT COUNT(*) AS c FROM usage_events").get().c;
    log(`  host read AFTER worker COMMIT: c=${n} waitedMs=${Date.now()-t0} (expect 2 => cross-connection visibility OK)`);
    log(`  host read AFTER worker COMMIT: n2=${n}`);
    w.postMessage("daily");
  } else if (m.stage === "daily-done") {
    const row = host.prepare("SELECT n FROM usage_daily WHERE day='2026-01-01'").get();
    log(`  host read usage_daily AFTER worker rebuild: ${JSON.stringify(row)} => cross-connection aggregate visible`);
    w.postMessage("close");
  } else if (m.stage === "closed") {
    host.close(); rmSync(dir, { recursive: true, force: true });
    console.log("PROBE-2CONN DONE");
  }
});
w.on("error", (e) => { console.log("WORKER_ERROR", e); process.exit(1); });
