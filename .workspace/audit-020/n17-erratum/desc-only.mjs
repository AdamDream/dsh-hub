#!/usr/bin/env node
/**
 * WP8 独立复现：**只改 descriptor 版本 2→3** 的语料副本。
 * 目的：把"第一道闸（descriptor）"单独拿掉，从而**独立量出第二道闸的真实规模**。
 * 除 `data.version` 之外不改任何字节（不补 sections、不删字段）。
 *
 * 输入：p0a/corpus/sessions（只读）
 * 输出：n17-erratum/out/desc-only/sessions
 * 用法: node desc-only.mjs <srcRoot> <dstRoot>
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { spawnSync } from "node:child_process";

/** 多帧 zstd 必须用系统 CLI 解（Node 的 zstdDecompressSync 只认单帧）。 */
function zstdDecompressAll(p) {
  const r = spawnSync("zstd", ["-d", "-c", "--no-progress", p], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error("zstd -d failed for " + p + ": " + String(r.stderr).slice(0, 200));
  return r.stdout;
}

const src = process.argv[2];
const dst = process.argv[3];
const only2to3 = process.argv.includes("--only2to3");

function walk(dir, depth = 0, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = dir + "/" + e.name;
    if (e.isDirectory() && depth < 4) walk(p, depth + 1, acc);
    else if (e.isFile()) acc.push(p);
  }
  return acc;
}

const files = walk(src).sort();
let copied = 0, rewritten = 0, descRows = 0, sectionsInjected = 0;
const ZSTD_LEVEL = 1;

for (const p of files) {
  const rel = path.relative(src, p);
  const out = path.join(dst, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (p.endsWith("session.lock")) {
    fs.copyFileSync(p, out);
    copied++;
    continue;
  }
  const raw = zstdDecompressAll(p);
  const lines = raw.toString("utf8").split("\n");
  const trailingNl = lines[lines.length - 1] === "";
  if (trailingNl) lines.pop();
  const outLines = [lines[0]];
  let touched = 0;
  for (let i = 1; i < lines.length; i++) {
    const row = JSON.parse(lines[i]);
    if (row.type === "subagent/descriptor" && row.data && row.data.version === 2) {
      row.data.version = 3;
      descRows++;
      touched++;
    }
    outLines.push(JSON.stringify(row));
  }
  fs.writeFileSync(out, zlib.zstdCompressSync(Buffer.from(outLines.join("\n") + "\n", "utf8"), { level: ZSTD_LEVEL }));
  rewritten++;
  if (touched) copied++;
}
console.log(JSON.stringify({ src, dst, files: files.length, rewritten, locksCopied: copied, descriptorRowsRewritten: descRows, sectionsInjected }));
