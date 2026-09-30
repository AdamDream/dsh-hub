#!/usr/bin/env node
/**
 * P0-A 转换器：把 0.1.1 世代的历史会话（v0/v3 物理格式）规范化为 **0.2.0 读打开可接受**的 v0/v3 日志。
 *
 * 设计纪律
 *  - 只在**语料副本**上运行；源根 `~/.dsh/sessions` 全程只读。
 *  - 物理格式、文件名、header 一律不变（仍是 v0/v3）⇒ 0.2.0 之后仍会按其惰性写时升级发布 v4 后继。
 *  - 只做**可证的最小白名单修复**，每条都记录到报告；不做任何"重排/重写语义"。
 *  - 不删除任何事件。若某份日志在修复后仍无法打开，如实标为失败，不伪造通过。
 *
 * 修复白名单（每条都有 0.2.0 源码判定点）
 *  R1 subagent/descriptor: data.version 2 → 3
 *     判定点 dsh-session-format-v0-to-v1/lib/index.js:1582-1587 + :1289-1291（只接受 3）
 *  R2 agent/inbox/spliced: inserted[].source.form === "snapshot" 而 sections 非数组 → sections = []
 *     判定点 同上 :942-947（plainSourceValue → pluginSourceValue：snapshot 必须带数组 sections）
 *
 * 用法：node convert.mjs <inRoot> <outRoot> <report.jsonl> [--dry]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const [, , inRoot, outRoot, reportPath] = process.argv;
const dry = process.argv.includes("--dry");

function walk(dir, depth = 0, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth < 3) walk(p, depth + 1, acc);
    else if (e.isFile()) acc.push(p);
  }
  return acc;
}

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

/** 修复一条落库记录；返回是否改动 + 改动标签。 */
function repairRow(row, tags) {
  if (row.type === "subagent/descriptor") {
    const v = row.data?.version;
    if (v !== 3) {
      row.data.version = 3;
      tags.push(`R1:descriptor v${v}->3`);
      return true;
    }
    return false;
  }
  if (row.type === "agent/inbox/spliced" || row.type === "user/message") {
    return repairPluginSnapshotSources(row, tags);
  }
  return false;
}

/**
 * R2：把任何「插件消息来源」里 `form === "snapshot"` 却缺 `sections` 数组的位置补成 `[]`。
 *
 * 依据（逐条可复现）：
 *  - 0.2.0 只接受 `sections` 为数组：dsh-session-format-v0-to-v1/lib/index.js:942-947
 *    （`pluginSourceValue`：form==="snapshot" ⇒ `arrayValue(source["sections"], …)`）。
 *  - 但 emit 侧**至今**写的就是不带 sections 的形状，且 0.1.1 与 0.2.0 **逐字节相同**：
 *    `dsh-taste/lib/learner.js:219`（`diff` 返回空）
 *    ⇒ 缺 `sections` 是**写入侧的既有形态**，不是数据损坏；
 *      `sections: []` 是"该 snapshot 未列任何小节"的忠实最小补全，不新增任何内容。
 *  - 同一形状在 v0 里出现在三处消息位置：`user/message.data.source`、
 *    `agent/inbox/spliced.data.inserted[].source`、以及带 `message` 包装的 `[].message.source`。
 *    故这里做**有界递归**（只认 kind==="plugin" 的对象），三处一次覆盖。
 */
function repairPluginSnapshotSources(row, tags) {
  let changed = false;
  const seen = new Set();
  const visit = (node) => {
    if (node === null || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node.kind === "plugin" && node.form === "snapshot" && !Array.isArray(node.sections)) {
      node.sections = [];
      tags.push("R2:plugin snapshot sections ->[]");
      changed = true;
      return;
    }
    for (const value of Object.values(node)) {
      if (value !== null && typeof value === "object") visit(value);
    }
  };
  visit(row.data);
  return changed;
}

const files = walk(inRoot).sort();
const report = fs.createWriteStream(reportPath);
let n = 0;
const agg = { logs: 0, locks: 0, other: 0, changed: 0, unchanged: 0, r1: 0, r2: 0, bytesIn: 0, bytesOut: 0 };

for (const src of files) {
  const rel = path.relative(inRoot, src);
  const dst = path.join(outRoot, rel);
  const base = path.basename(src);
  if (!base.endsWith(".jsonl.zstd")) {
    // lock 文件（0 字节）与其它：按字节原样复制，语义见 T21 §3.6
    if (base === "session.lock") agg.locks++;
    else agg.other++;
    if (!dry) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
    report.write(JSON.stringify({ rel, kind: "copy" }) + "\n");
    continue;
  }
  agg.logs++;
  const inBuf = fs.readFileSync(src);
  agg.bytesIn += inBuf.length;
  const frames = scanFrames(inBuf);
  const parts = frames.map((f) => zlib.zstdDecompressSync(inBuf.subarray(f.start, f.end)));
  const raw = Buffer.concat(parts).toString("utf8");
  const lines = raw.split("\n").filter((l) => l.length);
  const headerLine = lines[0];
  const header = JSON.parse(headerLine);
  const tags = [];
  const outLines = [headerLine];
  for (let i = 1; i < lines.length; i++) {
    const row = JSON.parse(lines[i]);
    if (repairRow(row, tags)) outLines.push(JSON.stringify(row));
    else outLines.push(lines[i]); // 未改动行逐字节保留
  }
  const bodyLines = outLines.slice(1);
  /* ⚠ 物理布局闸门（2026-09-30 由 WP1 复核实证，协调者已修）：
   * 0.2.0 真实持久层要求**首帧恰好只有一行 header**
   *   `$B/dsh-session-persistence-jsonl/lib/index.js:2293-2295`（`assertZstdHeaderFrame`）
   *   且 `:3040-3044`（`listArtifacts`）会把该错误静默 `continue` ⇒ **整根枚举为空**。
   * 所以必须分帧：frame#0 = header 行单独一帧，frame#1 = 其余所有事件行。
   * 依据另见 `:2951`（`readZstdPrefix` 同断言）。**不要把全部行压成一帧。** */
  const headerFrame = zlib.zstdCompressSync(Buffer.from(`${headerLine}\n`, "utf8"), { level: 3 });
  const bodyFrame = bodyLines.length === 0
    ? Buffer.alloc(0)
    : zlib.zstdCompressSync(Buffer.from(`${bodyLines.join("\n")}\n`, "utf8"), { level: 3 });
  const packed = Buffer.concat([headerFrame, bodyFrame]);
  agg.bytesOut += packed.length;
  const rec = {
    rel,
    kind: "log",
    version: header.version,
    rows: lines.length - 1,
    changed: tags.length > 0,
    tags: [...new Set(tags.map((t) => t.split("->")[0].split(" ")[0]))],
    tagCount: tags.length,
    bytesIn: inBuf.length,
    bytesOut: packed.length,
  };
  report.write(JSON.stringify(rec) + "\n");
  if (tags.length > 0) agg.changed++;
  else agg.unchanged++;
  for (const t of tags) {
    if (t.startsWith("R1:")) agg.r1++;
    else if (t.startsWith("R2:")) agg.r2++;
  }
  if (!dry) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, packed);
  }
  n++;
  if (n % 500 === 0) process.stderr.write(`  ...${n} logs\n`);
}
report.end();
process.stderr.write(`convert done: ${JSON.stringify(agg)}\n`);
