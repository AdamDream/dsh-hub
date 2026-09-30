#!/usr/bin/env node
/** WP8: 独立分析 scan-baseline.jsonl / scan-after.jsonl，输出逐份计数与拒因清单。 */
import * as fs from "node:fs";

const file = process.argv[2];
const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.length);
const recs = lines.map((l) => JSON.parse(l));

const total = recs.length;
const ok = recs.filter((r) => r.ok);
const bad = recs.filter((r) => !r.ok);
const packedTotal = recs.filter((r) => r.packed > 0).length;
const packedOk = ok.filter((r) => r.packed > 0).length;

const byCls = {};
for (const r of bad) byCls[r.cls] = (byCls[r.cls] ?? 0) + 1;
const byErr = {};
for (const r of bad) {
  const k = (r.err || "").replace(/\d+/g, "N").slice(0, 160);
  byErr[k] = (byErr[k] ?? 0) + 1;
}
const byVer = {};
for (const r of recs) {
  const k = "v" + r.version;
  byVer[k] = byVer[k] ?? { total: 0, ok: 0, rejected: 0 };
  byVer[k].total++;
  r.ok ? byVer[k].ok++ : byVer[k].rejected++;
}
const compressedOk = ok.filter((r) => r.packed > 0).length;

console.log(
  JSON.stringify(
    {
      file,
      total,
      ok: ok.length,
      rejected: bad.length,
      readableRate: +(ok.length / total).toFixed(4),
      filesWithPackedRows: packedTotal,
      packedRowsReadableAtBaseline: packedOk,
      byVersion: byVer,
      rejectionClasses: byCls,
      topErrorMessages: Object.entries(byErr).sort((a, b) => b[1] - a[1]).slice(0, 8),
    },
    null,
    1
  )
);
