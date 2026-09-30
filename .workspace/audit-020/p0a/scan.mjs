#!/usr/bin/env node
/**
 * P0-A 只读扫描器：用 0.2.0 的**真实** format catalog 对整根会话逐份"读打开"，并分类拒因。
 *
 * 口径说明（重要）：
 *  - 读打开（read-open）时 0.2.0 走 `historicalSessionFormatCatalog`（v0–v3，current=v3），
 *    **不需要** v3→v4 边的 child facts；child facts 只在写打开发布 v4 后继时用。
 *    源码：dsh-session-persistence-jsonl/lib/index.js:2222（历史子代取证用 historical 目录）、
 *          dsh-session-format-catalog/lib/index.js:91-111（historical 目录定义）。
 *  - v4 源（本语料为 0）走 `sessionFormatCatalog`。
 *  - 与 T21 `triage-current.mjs` 的口径一致（validation:'current', recovery:'recoverable'）。
 *
 * 用法：node scan.mjs <sessionsRoot> <out.jsonl> [--quiet]
 *
 * ⚠ 口径警告（2026-09-30 WP1 复核后加入）：本脚本**自己拼帧**后喂 catalog，
 *   因此它只能证明「codec 层可解码」，**不能**证明「持久层可枚举」。
 *   0.2.0 的 `list()` 走 `listArtifacts`，要求**首帧恰好只有一行 header**
 *   （`dsh-session-persistence-jsonl/lib/index.js:2293-2295`），失败会被 `:3040-3044` 静默跳过。
 *   ⇒ 任何产物必须**同时**过 `framecheck.mjs`（首帧闸门）才可用；两把闸门缺一不可。
 */
import * as fs from "node:fs";
import * as zlib from "node:zlib";
import { pathToFileURL } from "node:url";

const NM = "/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020/prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai";
const { historicalSessionFormatCatalog, sessionFormatCatalog } = await import(
  pathToFileURL(NM + "/dsh-session-format-catalog/lib/index.js").href
);

const root = process.argv[2];
const outPath = process.argv[3];
const quiet = process.argv.includes("--quiet");

/** Walk for *.jsonl.zstd up to depth 3 (root/<project>/<sessionId>/file). */
function collect(dir, depth = 0, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = dir + "/" + entry.name;
    if (entry.isDirectory() && depth < 3) collect(p, depth + 1, acc);
    else if (entry.isFile() && entry.name.endsWith(".jsonl.zstd")) acc.push(p);
  }
  return acc;
}

/** zstd frame walker (multi-frame logs). */
function scanFrames(buf) {
  const frames = [];
  let off = 0;
  const rd = (i, n) => {
    let v = 0;
    for (let k = n - 1; k >= 0; k--) v = v * 256 + buf[i + k];
    return v;
  };
  while (off < buf.length) {
    if (buf.length - off < 4 || rd(off, 4) !== 0xfd2fb528) break;
    const start = off;
    off += 4;
    if (off >= buf.length) break;
    const desc = buf[off++];
    const fcsFlag = desc >> 6;
    const single = (desc >> 5) & 1;
    const checksum = (desc >> 2) & 1;
    const dictFlag = desc & 3;
    const fcsSize = fcsFlag === 0 ? (single ? 1 : 0) : [2, 4, 8][fcsFlag - 1];
    if (!single) {
      if (off >= buf.length) break;
      off += 1;
    }
    if (off + [0, 1, 2, 4][dictFlag] + fcsSize > buf.length) break;
    off += [0, 1, 2, 4][dictFlag] + fcsSize;
    let ok = false;
    while (off + 3 <= buf.length) {
      const bh = buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16);
      off += 3;
      const last = bh & 1;
      const size = bh >>> 3;
      if (((bh >> 1) & 3) === 3 || off + size > buf.length) break;
      off += size;
      if (last) {
        ok = true;
        break;
      }
    }
    if (!ok) break;
    if (checksum) {
      if (off + 4 > buf.length) break;
      off += 4;
    }
    frames.push({ start, end: off });
  }
  return frames;
}

const PACKED = new Set(["text-chunks", "reasoning-chunks", "tool-call-chunks"]);

const files = collect(root).sort();
const out = fs.createWriteStream(outPath);
let done = 0;
const t0 = Date.now();

for (const path of files) {
  const rec = { path, ok: false, cls: null, err: null, version: null, rows: 0, events: null };
  try {
    const buf = fs.readFileSync(path);
    rec.bytes = buf.length;
    const frames = scanFrames(buf);
    const parts = [];
    for (const fr of frames) parts.push(zlib.zstdDecompressSync(buf.subarray(fr.start, fr.end)));
    /* 物理布局闸门（0.2.0 真实持久层要求）：首帧必须恰好只有一行 header。
     * 依据 $B/dsh-session-persistence-jsonl/lib/index.js:2293-2295（assertZstdHeaderFrame）
     * 与 :3040-3044（listArtifacts 静默 continue ⇒ 整根枚举为空）。
     * 这里只做记录；判定为 false 时即使 codec 层通过也必须视为失败。 */
    const firstFrameText = frames.length === 0 ? "" : parts[0].toString("utf8");
    rec.frame0HeaderOnly = firstFrameText.length > 0 && firstFrameText.indexOf("\n") === firstFrameText.length - 1;
    rec.frameCount = frames.length;
    const lines = Buffer.concat(parts).toString("utf8").split("\n").filter((l) => l.length);
    const header = JSON.parse(lines[0]);
    rec.version = header.version;
    rec.id = header.id;
    const rows = lines.slice(1).map((l) => JSON.parse(l));
    rec.rows = rows.length;

    // --- 结构性事实（与 codec 无关的独立取证）---
    const struct = { desc: {}, packed: 0, unknownTypes: {}, splicedBad: 0, seqGaps: 0, firstSeq: null };
    let expect = 0;
    for (const r of rows) {
      if (r.type === "subagent/descriptor") struct.desc["v" + (r.data?.version)] = (struct.desc["v" + (r.data?.version)] ?? 0) + 1;
      if (PACKED.has(r.type)) struct.packed++;
      if (r.type === "agent/inbox/spliced" && Array.isArray(r.data?.inserted)) {
        for (const ins of r.data.inserted) if (ins?.message?.source?.sections !== undefined && !Array.isArray(ins.message.source.sections)) struct.splicedBad++;
      }
      if (typeof r.seq === "number") {
        if (struct.firstSeq === null) struct.firstSeq = r.seq;
      }
    }
    // seq 连续性（把打包行按其 payload 长度计）
    let cursor = struct.firstSeq ?? 0;
    for (const r of rows) {
      if (typeof r.seq !== "number") continue;
      if (r.seq !== cursor) struct.seqGaps++;
      cursor = r.seq + (PACKED.has(r.type)
        ? (Array.isArray(r.data?.texts) ? r.data.texts.length : Array.isArray(r.data?.args) ? r.data.args.length : 1)
        : 1);
    }
    rec.struct = struct;

    // --- 真实 codec 读打开 ---
    const catalog = header.version <= 3 ? historicalSessionFormatCatalog : sessionFormatCatalog;
    const restore = catalog.createRestore(header, { recovery: "recoverable", validation: "current" });
    for (const row of rows) restore.decodeRow(row);
    const artifact = restore.finish();
    rec.ok = true;
    rec.events = artifact.events?.length ?? null;
  } catch (e) {
    const name = e?.name ?? "Error";
    const msg = String(e?.message ?? e).replace(/\d+/g, "N").slice(0, 200);
    rec.cls = /unsupported descriptor version/.test(msg)
      ? "descriptor-version"
      : /unknown historical event type/.test(msg)
        ? "unknown-event-type"
        : /source sections must be an array/.test(msg)
          ? "inbox-spliced-sections"
          : /seq gap/.test(msg)
            ? "seq-gap"
            : /requires explicit historical child facts/.test(msg)
              ? "needs-child-facts"
              : name + ": " + msg.slice(0, 80);
    rec.err = name + ": " + msg;
  }
  out.write(JSON.stringify(rec) + "\n");
  done++;
  if (!quiet && done % 250 === 0) process.stderr.write(`  ...${done}/${files.length} (${Math.round((Date.now() - t0) / 1000)}s)\n`);
}
out.end();
process.stderr.write(`scanned ${done}/${files.length} in ${Math.round((Date.now() - t0) / 1000)}s -> ${outPath}\n`);
