#!/usr/bin/env node
/**
 * WP8 / N17 独立复现扫描器（执行档自写，**不复制** p0a/scan.mjs 的实现）。
 *
 * 与协调者口径的**独立点**：
 *  1) zstd 解压改用系统 CLI `zstd -d -c`（外部可复现），而不是自写 zstd 帧游走器；
 *     帧列表则由 `zstd --list -v` 独立取得，用于证明"多帧"事实。
 *  2) 读打开用 0.2.0 真实 catalog：
 *     header.version <= 3 -> historicalSessionFormatCatalog (currentVersion 3)
 *     否则 -> sessionFormatCatalog (currentVersion 4)
 *     options = { recovery: 'recoverable', validation: 'current' }
 *  3) 拒因分类**不复制**协调者的正则表，改为记录原始 message，
 *     再由本脚本在报告侧做独立归类（classify()）。
 *
 * 用法: node scan.mjs <sessionsRoot> <out.jsonl> [--quiet]
 * 只读；不写被扫描目录。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const NM = "/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020/prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai";
const { historicalSessionFormatCatalog, sessionFormatCatalog } = await import(
  pathToFileURL(NM + "/dsh-session-format-catalog/lib/index.js").href
);

const root = process.argv[2];
const outPath = process.argv[3];
const quiet = process.argv.includes("--quiet");
if (!root || !outPath) {
  console.error("usage: node scan.mjs <sessionsRoot> <out.jsonl> [--quiet]");
  process.exit(2);
}

const PACKED = new Set(["text-chunks", "reasoning-chunks", "tool-call-chunks"]);

function collect(dir, depth = 0, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = dir + "/" + entry.name;
    if (entry.isDirectory() && depth < 4) collect(p, depth + 1, acc);
    else if (entry.isFile() && entry.name.endsWith(".jsonl.zstd")) acc.push(p);
    else if (entry.isFile() && entry.name === "session.lock") acc.push("LOCK\t" + p);
  }
  return acc;
}

const all = collect(root);
const locks = all.filter((x) => x.startsWith("LOCK\t")).map((x) => x.slice(5));
const files = all.filter((x) => !x.startsWith("LOCK\t")).sort();

/** 解压：用系统 zstd CLI（独立于 Node 自写帧游走器）。 */
function zstdDecode(p) {
  return execFileSync("zstd", ["-d", "-c", "--no-progress", p], { maxBuffer: 1 << 30 });
}

/** 独立取帧数（zstd --list -v 末行 `# Zstandard Frames: N`）。 */
function zstdFrameCount(p) {
  try {
    const out = execFileSync("zstd", ["--list", "-v", p], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const m = out.match(/# Zstandard Frames:\s*(\d+)/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * 独立归类：只根据真实 codec 抛出的 message 文本做归类，标注 isDataShape 与否。
 */
function classify(err) {
  const msg = String(err?.message ?? err);
  if (/unsupported descriptor version/i.test(msg)) return "descriptor-version";
  if (/sections/i.test(msg) && /array/i.test(msg)) return "plugin-source-sections";
  if (/unknown historical event type/i.test(msg)) return "unknown-event-type";
  if (/seq gap/i.test(msg)) return "seq-gap";
  if (/requires explicit historical child facts/i.test(msg)) return "needs-child-facts";
  if (/malformed/i.test(msg)) return "malformed-row";
  return "other:" + msg.slice(0, 60);
}

const out = fs.createWriteStream(outPath);
let done = 0, okCount = 0;
const t0 = Date.now();

for (const p of files) {
  const rec = {
    path: p,
    rel: path.relative(root, p),
    ok: false,
    cls: null,
    err: null,
    version: null,
    id: null,
    bytes: null,
    frames: null,
    rows: 0,
    packed: 0,
    descriptors: {},
    snapshotSourcesWithoutSections: 0,
    events: null,
    runExpansions: null,
  };
  try {
    const buf = fs.readFileSync(p);
    rec.bytes = buf.length;
    rec.frames = zstdFrameCount(p);
    const text = zstdDecode(p).toString("utf8");
    const lines = text.split("\n").filter((l) => l.length > 0);
    const header = JSON.parse(lines[0]);
    rec.version = header.version;
    rec.id = header.id;
    const rows = lines.slice(1).map((l) => JSON.parse(l));
    rec.rows = rows.length;

    // --- 与 codec 无关的结构事实 ---
    for (const r of rows) {
      if (r.type === "subagent/descriptor") {
        const k = "v" + (r.data && r.data.version);
        rec.descriptors[k] = (rec.descriptors[k] ?? 0) + 1;
      }
      if (PACKED.has(r.type)) rec.packed += 1;
      if (r.type === "agent/inbox/spliced" && Array.isArray(r.data?.inserted)) {
        for (const ins of r.data.inserted) {
          const s = ins?.message?.source;
          if (s && s.kind === "plugin" && s.form === "snapshot" && !Array.isArray(s.sections)) {
            rec.snapshotSourcesWithoutSections += 1;
          }
        }
      }
    }

    // --- 真实 codec 读打开 ---
    const catalog = header.version <= 3 ? historicalSessionFormatCatalog : sessionFormatCatalog;
    const restore = catalog.createRestore(header, { recovery: "recoverable", validation: "current" });
    for (const row of rows) restore.decodeRow(row);
    const artifact = restore.finish();
    rec.ok = true;
    rec.events = artifact?.events?.length ?? null;
    rec.runExpansions = artifact?.events?.filter?.((e) => e.type === "assistant/chunk")?.length ?? null;
    okCount++;
  } catch (e) {
    rec.err = (e?.name ?? "Error") + ": " + String(e?.message ?? e).slice(0, 300);
    rec.cls = classify(e);
  }
  out.write(JSON.stringify(rec) + "\n");
  done++;
  if (!quiet && done % 250 === 0) process.stderr.write(`  ...${done}/${files.length}\n`);
}
out.end();
process.stderr.write(
  JSON.stringify({
    root,
    files: files.length,
    locks: locks.length,
    lockPaths: locks.slice(0, 5),
    ok: okCount,
    rejected: files.length - okCount,
    seconds: Math.round((Date.now() - t0) / 1000),
    out: outPath,
  }) + "\n"
);
