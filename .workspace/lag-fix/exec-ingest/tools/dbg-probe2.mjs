import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { rmSync } from "node:fs";
const p = join(process.cwd(), "scratch/dbg2.db");
rmSync(p, { force: true }); rmSync(p + "-wal", { force: true }); rmSync(p + "-shm", { force: true });
const db = new DatabaseSync(p);
db.exec("CREATE TABLE t (a)");
db.exec("BEGIN");
try {
  db.exec("CREATE TABLE IF NOT EXISTS __ig3_probe (id INTEGER PRIMARY KEY AUTOINCREMENT, deleted TEXT NOT NULL, produced TEXT NOT NULL)");
  const producedProbe = db.prepare("SELECT DISTINCT a FROM t").all();
  const st = db.prepare("INSERT INTO __ig3_probe (deleted, produced) VALUES (?, ?)");
  const info = st.run(JSON.stringify(["x"]), JSON.stringify(producedProbe));
  console.log("insert ok", info);
} catch (e) { console.log("PROBE_ERR:", e.constructor.name, e.message); }
db.exec("COMMIT");
console.log("rows:", db.prepare("SELECT * FROM __ig3_probe").all());
db.close();
