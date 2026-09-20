import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { enumerateDshSessions, parseDshSession } from "/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib/ingest-dsh.js";

// A) worst-case single file: the largest session log on disk
const root = process.env.HOME + "/.dsh/sessions";
const files = enumerateDshSessions().sort((a, b) => b.size - a.size);
console.log("=== largest session logs (full re-parse when mtime/size changes) ===");
for (const f of files.slice(0, 3)) {
  const t0 = performance.now();
  const buf = readFileSync(f.file);
  const t1 = performance.now();
  let ev = -1;
  try { ev = parseDshSession(buf).events.length; } catch {}
  const t2 = performance.now();
  console.log(`  ${(f.size / 1e6).toFixed(2)} MB  read=${(t1 - t0).toFixed(1)}ms  decode+JSON.parse=${(t2 - t1).toFixed(1)}ms  BLOCKING=${(t2 - t0).toFixed(1)}ms events=${ev}`);
}

// B) the 2368 unconditional sync getSyncState() SELECTs per pass
const db = new DatabaseSync(process.env.HOME + "/.dsh/storages/usage/usage.db", { readOnly: true });
const stmt = db.prepare("SELECT * FROM sync_state WHERE source = ?");
const t3 = performance.now();
for (const f of files) stmt.get("dsh:" + f.file);
const t4 = performance.now();
console.log(`\ngetSyncState() x${files.length} sync SELECTs = ${(t4 - t3).toFixed(1)} ms`);
db.close();
