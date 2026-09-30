import * as fs from "node:fs";
import * as zlib from "node:zlib";
import { pathToFileURL } from "node:url";
const NM = "/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020/prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai";
const cat = await import(pathToFileURL(NM + "/dsh-session-format-catalog/lib/index.js").href);
const path = process.argv[2];
const buf = fs.readFileSync(path);
const lines = zlib.zstdDecompressSync(buf).toString("utf8").split("\n").filter((l) => l.length);
const header = JSON.parse(lines[0]);
const rows = lines.slice(1).map((l) => JSON.parse(l));
console.log("header.version", header.version, "rows", rows.length);
const catalog = header.version <= 3 ? cat.historicalSessionFormatCatalog : cat.sessionFormatCatalog;
try {
  const r = catalog.createRestore(header, { recovery: "recoverable", validation: "current" });
  for (const row of rows) r.decodeRow(row);
  const a = r.finish();
  console.log("OK events", a.events?.length, "header", JSON.stringify(a.header));
} catch (e) {
  console.log("THROWN name:", e.name);
  console.log("isFormatError:", e.constructor?.name);
  console.log("message:", String(e.message).slice(0, 300));
}
