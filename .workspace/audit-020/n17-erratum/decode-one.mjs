#!/usr/bin/env node
/**
 * WP8 独立反证脚本：对指定的单个日志文件做
 *  (a) 解压 -> 统计顶层打包行（text-chunks/reasoning-chunks/tool-call-chunks）及其 payload 长度
 *  (b) 用 0.2.0 真实 catalog 读打开（recovery:recoverable, validation:current）
 *  (c) 断言展开出的 assistant/chunk 事件数 == 打包行 payload 长度之和
 * 只读。用法: node decode-one.mjs <file.jsonl.zstd>
 */
import * as fs from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const NM = "/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020/prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai";
const { historicalSessionFormatCatalog, sessionFormatCatalog } = await import(
  pathToFileURL(NM + "/dsh-session-format-catalog/lib/index.js").href
);

const PACKED = new Set(["text-chunks", "reasoning-chunks", "tool-call-chunks"]);
const p = process.argv[2];
const buf = fs.readFileSync(p);
const text = execFileSync("zstd", ["-d", "-c", "--no-progress", p], { maxBuffer: 1 << 30 }).toString("utf8");
const lines = text.split("\n").filter((l) => l.length);
const header = JSON.parse(lines[0]);
const rows = lines.slice(1).map((l) => JSON.parse(l));

const packedRows = rows.filter((r) => PACKED.has(r.type));
let payloadTotal = 0;
const kinds = {};
for (const r of packedRows) {
  const payload = Array.isArray(r.data?.texts) ? r.data.texts : Array.isArray(r.data?.args) ? r.data.args : [];
  payloadTotal += payload.length;
  kinds[r.type] = (kinds[r.type] ?? 0) + 1;
}

const mode = process.argv[3] ?? "recoverable";
const catalog = header.version <= 3 ? historicalSessionFormatCatalog : sessionFormatCatalog;
const restore = catalog.createRestore(header, { recovery: mode, validation: "current" });
for (const row of rows) restore.decodeRow(row);
const artifact = restore.finish();
const events = artifact.events ?? [];
const chunks = events.filter((e) => e.type === "assistant/chunk");

console.log(
  JSON.stringify(
    {
      path: p,
      headerVersion: header.version,
      rows: rows.length,
      packedRowKinds: kinds,
      packedRows: packedRows.length,
      packedPayloadTotal: payloadTotal,
      readOk: true,
      totalEvents: events.length,
      assistantChunkEvents: chunks.length,
      chunkCountMatchesPayloadTotal: chunks.length === payloadTotal,
      firstChunkSeq: chunks[0]?.seq ?? null,
      sampleChunkTypes: [...new Set(chunks.map((c) => c.data?.chunk?.type))].sort(),
    },
    null,
    1
  )
);
