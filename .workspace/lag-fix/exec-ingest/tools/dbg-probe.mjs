import { join } from "node:path";
import { loadLib, SCRATCH } from "../tests/lib/harness.mjs";
const lib = await loadLib(join(process.cwd(), "scratch/lib-dbg"));
const dbPath = join(SCRATCH, "dbg-fixBonly.db");
const db = await lib.db.openUsageDb(dbPath);
const noon = (d) => { const [y,m,dd] = d.split("-").map(Number); return new Date(y, m-1, dd, 12).getTime(); };
lib.db.insertEvent(db, { data_source:"dsh", session_id:"s1", dedup_key:"t1:s1", ts: noon("2026-08-19"), model:"m", project:"p", input_tokens:1, output_tokens:2, cache_read_tokens:0, cache_write_tokens:0 });
lib.db.insertEvent(db, { data_source:"dsh", session_id:"s2", dedup_key:"t1:s2", ts: noon("2026-08-25"), model:"m", project:"p", input_tokens:1, output_tokens:2, cache_read_tokens:0, cache_write_tokens:0 });
try { lib.db.rebuildDailyForDays(db, ["2026-08-19", "2026-08-25"]); } catch (e) { console.log("THREW", e.message); }
console.log("tables:", db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
try { console.log("probe rows:", db.prepare("SELECT * FROM __ig3_probe").all()); } catch (e) { console.log("probe read err:", e.message); }
db.close();
