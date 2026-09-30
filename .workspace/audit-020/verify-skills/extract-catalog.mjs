// Extract every <available_skills> catalog block from a decompressed session jsonl.
import { readFileSync } from "node:fs";
const f = process.argv[2];
const lines = readFileSync(f, "utf8").split("\n").filter(Boolean);
let n = 0;
for (const [i, l] of lines.entries()) {
  if (!l.includes("available_skills")) continue;
  n++;
  let j;
  try { j = JSON.parse(l); } catch { continue; }
  const text = (j.data?.content || []).map((c) => c.text || "").join("");
  const m = text.match(/<available_skills>[\s\S]*?<\/available_skills>/);
  if (!m) continue;
  const names = [...m[0].matchAll(/^- `([^`]+)`/gm)].map((x) => x[1]);
  console.log(`#${n} line=${i + 1} seq=${j.seq} type=${j.type} at=${new Date(j.time).toISOString()} update=${text.includes("replacement")} count=${names.length}`);
  for (const x of names) console.log("   - " + x);
}
