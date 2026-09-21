import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = mkdtempSync(join(process.cwd(), "scratch/ts-"));
const out = { tmpdir: tmpdir(), TMPDIR: process.env.TMPDIR ?? null, cases: [] };
function attempt(label, pragma) {
  const p = join(dir, `${label}.db`);
  const db = new DatabaseSync(p);
  try {
    if (pragma) db.exec(pragma);
    db.exec("CREATE TABLE t (day TEXT, ds TEXT, m TEXT, pr TEXT, n INTEGER)");
    const ins = db.prepare("INSERT INTO t VALUES (?,?,?,?,1)");
    db.exec("BEGIN");
    for (let i = 0; i < 5000; i++) ins.run(`d${i % 40}`, "ds", `m${i % 7}`, `p${i % 11}`);
    db.exec("COMMIT");
    const t0 = Date.now();
    const rows = db.prepare("SELECT day, ds, COALESCE(m,'x'), COALESCE(pr,'y'), COUNT(*) FROM t GROUP BY 1,2,3,4").all();
    out.cases.push({ label, ok: true, rows: rows.length, ms: Date.now() - t0 });
  } catch (e) { out.cases.push({ label, ok: false, error: String(e.message) }); }
  finally { try { db.close(); } catch {} }
}
attempt("no-pragma", null);
attempt("temp_store-2", "PRAGMA temp_store = 2");
rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify(out, null, 2));
