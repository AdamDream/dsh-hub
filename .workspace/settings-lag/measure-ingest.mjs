import { readFileSync, statSync } from "node:fs";
import { enumerateDshSessions, parseDshSession } from "/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib/ingest-dsh.js";

// 1) the synchronous directory walk the 45s timer performs every pass
let t0 = performance.now();
const files = enumerateDshSessions();
let walkMs = performance.now() - t0;
console.log(`enumerateDshSessions(): files=${files.length} blocking=${walkMs.toFixed(1)} ms`);

// 2) files whose (mtime,size) differ from sync_state are FULLY re-read + re-parsed.
//    Approximate the live set by mtime recency (sync_state holds 2744 rows; the
//    actively-written sessions change every pass).
const now = Date.now();
const recent = files.filter((f) => now - f.mtime < 10 * 60 * 1000).sort((a, b) => b.size - a.size);
console.log(`\nsession logs modified in last 10 min: ${recent.length} (of ${files.length})`);
let totalRead = 0, totalParse = 0, bytes = 0;
for (const f of recent.slice(0, 6)) {
  const r0 = performance.now(); const buf = readFileSync(f.file); const r1 = performance.now();
  let ev = 0, perr = 0;
  try { const p = parseDshSession(buf); ev = p.events.length; perr = p.parseErrors; } catch (e) { ev = -1; }
  const r2 = performance.now();
  totalRead += r1 - r0; totalParse += r2 - r1; bytes += f.size;
  console.log(`  ${(f.size / 1e6).toFixed(2).padStart(6)} MB  readFileSync=${(r1 - r0).toFixed(1)}ms  decode+JSON.parse=${(r2 - r1).toFixed(1)}ms  events=${ev} parseErrors=${perr}  ${f.file.split("/sessions/")[1]}`);
}
console.log(`\nrecent-6 total: bytes=${(bytes / 1e6).toFixed(1)}MB read=${totalRead.toFixed(1)}ms parse=${totalParse.toFixed(1)}ms BLOCKING=${(totalRead + totalParse).toFixed(1)}ms`);
console.log(`plus walk ${walkMs.toFixed(1)}ms + ${files.length} sync SQLite getSyncState() SELECTs`);
console.log(`\nper-pass lower bound with NO changed file: ${walkMs.toFixed(1)}ms walk/stat`);
