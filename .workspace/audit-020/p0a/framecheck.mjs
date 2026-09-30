#!/usr/bin/env node
/**
 * 物理布局闸门检查：0.2.0 真实持久层要求**首帧恰好只有一行 header**
 * （依据 $B/dsh-session-persistence-jsonl/lib/index.js:2293-2295 assertZstdHeaderFrame；
 *  :3040-3044 listArtifacts 会把 SessionPersistenceCorruptionError 静默 continue）。
 * 用法：node framecheck.mjs <root> [limit]
 */
import * as fs from "node:fs";
import * as zlib from "node:zlib";
import * as path from "node:path";

const root = process.argv[2];
const limit = Number(process.argv[3] ?? 0);

function scanFrames(buf) {
  const frames = []; let off = 0;
  const rd = (i, n) => { let v = 0; for (let k = n - 1; k >= 0; k--) v = v * 256 + buf[i + k]; return v; };
  while (off < buf.length) {
    if (buf.length - off < 4 || rd(off, 4) !== 0xfd2fb528) break;
    const start = off; off += 4;
    if (off >= buf.length) break;
    const desc = buf[off++];
    const fcsFlag = desc >> 6, single = (desc >> 5) & 1, checksum = (desc >> 2) & 1, dictFlag = desc & 3;
    const fcsSize = fcsFlag === 0 ? (single ? 1 : 0) : [2, 4, 8][fcsFlag - 1];
    if (!single) { if (off >= buf.length) break; off += 1; }
    if (off + [0, 1, 2, 4][dictFlag] + fcsSize > buf.length) break;
    off += [0, 1, 2, 4][dictFlag] + fcsSize;
    let ok = false;
    while (off + 3 <= buf.length) {
      const bh = buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16);
      off += 3; const last = bh & 1, size = bh >>> 3;
      if (((bh >> 1) & 3) === 3 || off + size > buf.length) break;
      off += size; if (last) { ok = true; break; }
    }
    if (!ok) break;
    if (checksum) { if (off + 4 > buf.length) break; off += 4; }
    frames.push({ start, end: off });
  }
  return frames;
}

function walk(dir, depth = 0, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth < 3) walk(p, depth + 1, acc);
    else if (e.isFile() && e.name.endsWith(".zstd")) acc.push(p);
  }
  return acc;
}

const files = walk(root).sort();
const stats = { files: files.length, ok: 0, bad: 0, frameCounts: {}, badExamples: [] };
let n = 0;
for (const f of files) {
  if (limit && n >= limit) break;
  n++;
  const buf = fs.readFileSync(f);
  const frames = scanFrames(buf);
  stats.frameCounts[frames.length] = (stats.frameCounts[frames.length] ?? 0) + 1;
  let first;
  try {
    first = frames.length === 0 ? Buffer.alloc(0) : zlib.zstdDecompressSync(buf.subarray(frames[0].start, frames[0].end));
  } catch (e) {
    stats.bad++; if (stats.badExamples.length < 5) stats.badExamples.push({ f, why: "first frame decode failed: " + e.message });
    continue;
  }
  const isOneLine = first.length > 0 && first.indexOf(10) === first.length - 1;
  if (isOneLine) stats.ok++;
  else {
    stats.bad++;
    if (stats.badExamples.length < 5) stats.badExamples.push({ f, why: `first frame is not exactly one line (len=${first.length}, firstNL=${first.indexOf(10)})` });
  }
}
console.log(JSON.stringify(stats, null, 1));
