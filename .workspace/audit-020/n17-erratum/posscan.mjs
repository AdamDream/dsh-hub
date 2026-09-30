import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
const root = process.argv[2];
function walk(d, dep = 0, acc = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = d + "/" + e.name;
    if (e.isDirectory() && dep < 4) walk(p, dep + 1, acc);
    else if (e.isFile() && e.name.endsWith(".jsonl.zstd")) acc.push(p);
  }
  return acc;
}
const files = walk(root).sort();
const pos = { "user/message.data.source": 0, "agent/inbox/spliced.data.inserted[].source": 0, "assistant/message.data.message.source": 0, "session/title-llm-request.data.messages[].source": 0, "tool/result.data.message.source": 0 };
const filesHit = { "user/message.data.source": new Set(), "agent/inbox/spliced.data.inserted[].source": new Set(), "assistant/message.data.message.source": new Set(), "session/title-llm-request.data.messages[].source": new Set(), "tool/result.data.message.source": new Set() };
const plugins = {};
let scanned = 0;
for (const p of files) {
  const r = spawnSync("zstd", ["-d", "-c", "--no-progress", p], { maxBuffer: 1 << 30 });
  if (r.status !== 0) continue;
  scanned++;
  const rows = r.stdout.toString("utf8").split("\n").filter(Boolean).slice(1);
  for (const line of rows) {
    const row = JSON.parse(line);
    const check = (src, key) => {
      if (src && src.kind === "plugin" && src.form === "snapshot" && !Array.isArray(src.sections)) {
        pos[key]++;
        filesHit[key].add(p);
        plugins[src.plugin] = (plugins[src.plugin] ?? 0) + 1;
      }
    };
    if (row.type === "user/message") check(row.data?.source, "user/message.data.source");
    if (row.type === "agent/inbox/spliced" && Array.isArray(row.data?.inserted))
      for (const e of row.data.inserted) check(e?.source, "agent/inbox/spliced.data.inserted[].source");
    if (row.type === "assistant/message") check(row.data?.message?.source, "assistant/message.data.message.source");
    if (row.type === "tool/result") check(row.data?.message?.source, "tool/result.data.message.source");
    if (row.type === "session/title-llm-request" && Array.isArray(row.data?.messages))
      for (const m of row.data.messages) check(m?.source, "session/title-llm-request.data.messages[].source");
  }
}
const out = { scanned, occurrences: pos, filesAffected: Object.fromEntries(Object.entries(filesHit).map(([k, v]) => [k, v.size])), emitterPlugins: plugins };
console.log(JSON.stringify(out, null, 1));
