#!/usr/bin/env node
/**
 * WP1 验证器：对 0.2.0 侧「转换后语料」逐份独立验证（Q1 读打开 / Q2 写打开 v4 全链 / Q3 保真三项）。
 *
 * 设计纪律
 *  - 只读 corpus/ 与 converted/；只写 verify/ 边界内。
 *  - 全部解码走 **0.2.0 官方件真实代码**（$B），不自行复刻编解码语义：
 *    · Q1     historicalSessionFormatCatalog            （$B/dsh-session-format-catalog/lib/index.js:91-111）
 *    · Q2     createSessionFormatCatalogWithChildren    （同文件 :80-86）
 *    · facts  historicalChildCatalogSource              （$B/dsh-session-format-v3-to-v4/lib/index.js:871-883）
 *    · 物理闸 readFirstZstdLine / listArtifacts          （$B/dsh-session-persistence-jsonl/lib/index.js:3293-3325 / :3031-3057）
 *  - 唯一"复刻"的是 0.2.0 的两行断言 assertZstdHeaderFrame（:$2293-2295）的快速等价判定；
 *    真件原型的 readFirstZstdLine 对**全量逐份实跑**，作为该判定的主证据。
 *
 * 用法：
 *   node --max-old-space-size=8192 verify-v4.mjs              # 全量
 *   node --max-old-space-size=8192 verify-v4.mjs --limit 25   # 冒烟（pass2 限 25，pass0/1 仍全量）
 *   node --max-old-space-size=8192 verify-v4.mjs --reframe 2508
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import * as crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const P0A = path.resolve(HERE, "..");
const CORPUS = path.join(P0A, "corpus", "sessions");
const CONVERTED = path.join(P0A, "converted", "sessions");
const OUT_FILE = path.join(HERE, "per-file.jsonl");
const SUMMARY_FILE = path.join(HERE, "summary.json");

const B = "/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020/prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf("--" + name);
  if (i < 0) return def;
  const v = args[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
};
const LIMIT = Number(flag("limit", 0)) || 0;
const QUIET = args.includes("--quiet");
const REFRAME = Number(flag("reframe", 0)) || 0;
const PHYS = String(flag("phys", "real"));

// ---------------------------------------------------------------- 0.2.0 官方件
const catMod = await import(pathToFileURL(B + "/dsh-session-format-catalog/lib/index.js").href);
const { historicalSessionFormatCatalog, sessionFormatCatalog, createSessionFormatCatalogWithChildren } = catMod;
const v34 = await import(pathToFileURL(B + "/dsh-session-format-v3-to-v4/lib/index.js").href);
const { historicalChildCatalogSource } = v34;
const persMod = await import(pathToFileURL(B + "/dsh-session-persistence-jsonl/lib/index.js").href);
const JsonlSessionPersistence = persMod.default;

const RESTORE_READ = { recovery: "recoverable", validation: "current" };          // Q1 读打开口径
const RESTORE_V4 = { recovery: "recoverable", validation: "current" };            // Q2 口径（工单指定）
const RESTORE_V4_TX = { recovery: "recoverable", validation: "transformed" };     // 写打开真实口径（:2704-2707）

// ---------------------------------------------------------------- zstd 帧遍历（物理层，不涉事件语义）
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

/** 0.2.0 :2293-2295 assertZstdHeaderFrame 的等价判定。 */
function headerFrameOk(plaintext) {
  return plaintext.length > 0 && plaintext.indexOf(10) === plaintext.length - 1;
}

/**
 * 内存受控读取：headerOnly 时只解 frame#0；full 时逐帧解并分行（不做整体 Buffer.concat）。
 * 返回 frame0 的 sha256 与长度，供"分帧无损"逐字节比对，且不留存大缓冲。
 */
function readLog(p, { headerOnly = false } = {}) {
  const buf = fs.readFileSync(p);
  const frames = scanFrames(buf);
  const firstPt = frames.length ? zlib.zstdDecompressSync(buf.subarray(frames[0].start, frames[0].end)) : Buffer.alloc(0);
  const firstFrameOk = headerFrameOk(firstPt);
  const frame0Sha = crypto.createHash("sha256").update(firstPt).digest("hex");
  const frame0Len = firstPt.length;
  const nl = firstPt.indexOf(10);
  const headerLine = (nl < 0 ? firstPt : firstPt.subarray(0, nl)).toString("utf8");
  if (headerOnly) return { bufLen: buf.length, frameCount: frames.length, headerLine, firstFrameOk, frame0Sha, frame0Len };
  const lines = [];
  const pushText = (pt) => {
    const s = pt.toString("utf8");
    for (const l of s.split("\n")) if (l.length) lines.push(l);
  };
  pushText(firstPt);
  for (let i = 1; i < frames.length; i++) pushText(zlib.zstdDecompressSync(buf.subarray(frames[i].start, frames[i].end)));
  return { bufLen: buf.length, frameCount: frames.length, headerLine: lines[0], firstFrameOk, frame0Sha, frame0Len, lines };
}

// ---------------------------------------------------------------- 稳定规范化 / 哈希 / 差异
function canon(v) {
  if (v === null) return "null";
  const t = typeof v;
  if (t === "number") return Number.isFinite(v) ? JSON.stringify(v) : JSON.stringify(String(v));
  if (t === "boolean" || t === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (t === "object") {
    const ks = Object.keys(v).sort();
    return "{" + ks.map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  }
  return JSON.stringify(String(v));
}
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const EVENT_DROP = new Set(["time", "seq"]);
const ROW_DROP = new Set(["time", "time0", "seq", "seq0"]);
function dropEnvelope(node, keys) {
  const out = {};
  for (const [k, v] of Object.entries(node)) if (!keys.has(k)) out[k] = v;
  return out;
}
/** 扣除白名单：subagent/descriptor.data.version 与 plugin-snapshot 的空 sections。 */
function stripWhitelist(node) {
  if (Array.isArray(node)) return node.map(stripWhitelist);
  if (node && typeof node === "object") {
    const isDesc = node.type === "subagent/descriptor";
    const isPluginSnapshot = node.kind === "plugin" && node.form === "snapshot";
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (isDesc && k === "data" && v && typeof v === "object" && !Array.isArray(v)) {
        const d = {};
        for (const [dk, dv] of Object.entries(v)) {
          if (dk === "version") continue;
          d[dk] = stripWhitelist(dv);
        }
        out[k] = d;
        continue;
      }
      if (isPluginSnapshot && k === "sections" && Array.isArray(v) && v.length === 0) continue;
      out[k] = stripWhitelist(v);
    }
    return out;
  }
  return node;
}
function diffPaths(a, b, p, out, max = 40) {
  if (out.length >= max) return;
  const ta = a === null ? "null" : Array.isArray(a) ? "array" : typeof a;
  const tb = b === null ? "null" : Array.isArray(b) ? "array" : typeof b;
  if (a === undefined && b !== undefined) return void out.push({ path: p, kind: "added", b });
  if (b === undefined && a !== undefined) return void out.push({ path: p, kind: "removed", a });
  if (ta !== tb) return void out.push({ path: p, kind: "type", a: ta, b: tb });
  if (ta === "array") {
    if (a.length !== b.length) out.push({ path: p + ".length", kind: "len", a: a.length, b: b.length });
    for (let i = 0; i < Math.max(a.length, b.length) && out.length < max; i++) diffPaths(a[i], b[i], `${p}[${i}]`, out, max);
    return;
  }
  if (ta === "object") {
    const ks = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of [...ks].sort()) {
      if (out.length >= max) break;
      diffPaths(a[k], b[k], p ? `${p}.${k}` : k, out, max);
    }
    return;
  }
  if (a !== b) out.push({ path: p, kind: "value", a, b });
}

// ---------------------------------------------------------------- 白名单审计（精确计数，非抽样）
const PACKED_TAGS = new Set(["text-chunks", "reasoning-chunks", "tool-call-chunks"]);
/** 统计 R1/R2 的"修复前候选数"与"修复后残留数"。 */
function whitelistAudit(rows) {
  let r1Before = 0;
  let r1After = 0;
  let r2Missing = 0;
  let r2Empty = 0;
  let r2NonEmpty = 0;
  for (const r of rows) {
    if (r.type === "subagent/descriptor") {
      if (r.data?.version !== 3) r1Before++;
      else r1After++;
    }
    const seen = new Set();
    const visit = (node) => {
      if (node === null || typeof node !== "object" || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) return void node.forEach(visit);
      if (node.kind === "plugin" && node.form === "snapshot") {
        if (!Array.isArray(node.sections)) r2Missing++;
        else if (node.sections.length === 0) r2Empty++;
        else r2NonEmpty++;
        return;
      }
      for (const v of Object.values(node)) if (v && typeof v === "object") visit(v);
    };
    visit(r.data);
  }
  return { r1Before, r1After, r2Missing, r2Empty, r2NonEmpty };
}

/** 与 convert.mjs 的 R1+R2 白名单逐字等价的内存对照装置（不是通过判据）。 */
function repairPluginSnapshotSources(row) {
  let changed = false;
  const seen = new Set();
  const visit = (node) => {
    if (node === null || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) return void node.forEach(visit);
    if (node.kind === "plugin" && node.form === "snapshot" && !Array.isArray(node.sections)) {
      node.sections = [];
      changed = true;
      return;
    }
    for (const v of Object.values(node)) if (v && typeof v === "object") visit(v);
  };
  visit(row.data);
  return changed;
}
function applyWhitelistShim(lines) {
  const out = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    let row;
    try {
      row = JSON.parse(lines[i]);
    } catch {
      out.push(lines[i]);
      continue;
    }
    let touched = false;
    if (row.type === "subagent/descriptor") {
      if (row.data?.version !== 3) {
        row.data.version = 3;
        touched = true;
      }
    } else if (row.type === "agent/inbox/spliced" || row.type === "user/message") {
      touched = repairPluginSnapshotSources(row);
    }
    out.push(touched ? JSON.stringify(row) : lines[i]);
  }
  return out;
}

// ---------------------------------------------------------------- 地标计数
const LANDMARKS = ["turn/start", "turn/end", "step/start", "step/end", "assistant/message", "tool/call", "tool/result", "user/message", "agent/inbox/spliced"];
const emptyCounts = () => Object.fromEntries([...LANDMARKS, "assistant/chunk"].map((t) => [t, 0]));
function packedMemberCount(row) {
  const d = row.data ?? {};
  if (row.type === "tool-call-chunks") return Array.isArray(d.args) ? d.args.length : null;
  return Array.isArray(d.texts) ? d.texts.length : null;
}
/** 落库行直接统计：packed 行按 payload.length 展开成 assistant/chunk（v0-to-v1 :1809-1843）。 */
function countFromRows(rows) {
  const c = emptyCounts();
  let packedRows = 0;
  let packedChunks = 0;
  let packedBad = 0;
  for (const r of rows) {
    if (PACKED_TAGS.has(r.type)) {
      packedRows++;
      const n = packedMemberCount(r);
      if (n === null) packedBad++;
      else {
        packedChunks += n;
        c["assistant/chunk"] += n;
      }
      continue;
    }
    if (c[r.type] !== undefined) c[r.type]++;
  }
  return { counts: c, packedRows, packedChunks, packedBad };
}
function countFromEvents(events) {
  const c = emptyCounts();
  for (const e of events) if (c[e.type] !== undefined) c[e.type]++;
  return c;
}

// ---------------------------------------------------------------- 错误归类
function classify(err) {
  const msg = String(err?.message ?? err).replace(/[0-9]+/g, "N").slice(0, 220);
  if (/unsupported descriptor version/.test(msg)) return "descriptor-version";
  if (/unknown historical event type/.test(msg)) return "unknown-event-type";
  if (/source sections must be an array/.test(msg)) return "inbox-spliced-sections";
  if (/seq gap/.test(msg)) return "seq-gap";
  if (/requires explicit historical child facts/.test(msg)) return "needs-child-facts";
  if (/first frame is not exactly one header line/.test(msg)) return "zstd-first-frame-not-header-only";
  if (/catalog|child/i.test(msg)) return "child-facts:" + msg.slice(0, 60);
  return (err?.name ?? "Error") + ": " + msg.slice(0, 100);
}

// ---------------------------------------------------------------- 枚举
function walk(dir, depth = 0, acc = [], filter = (n) => n.endsWith(".jsonl.zstd")) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth < 3) walk(p, depth + 1, acc, filter);
    else if (e.isFile() && filter(e.name)) acc.push(p);
  }
  return acc;
}
const relOf = (root, p) => path.relative(root, p);
function versionOfName(name) {
  const base = name.replace(/\.jsonl\.zstd$/, "");
  const m = /\.v(\d+)$/.exec(base);
  return m ? Number(m[1]) : 0;
}

const corpusFiles = walk(CORPUS).sort();
const convFiles = walk(CONVERTED).sort();
const corpusByRel = new Map(corpusFiles.map((p) => [relOf(CORPUS, p), p]));
const convByRel = new Map(convFiles.map((p) => [relOf(CONVERTED, p), p]));
const allRel = [...new Set([...corpusByRel.keys(), ...convByRel.keys()])].sort();
const onlyCorpus = [...corpusByRel.keys()].filter((r) => !convByRel.has(r));
const onlyConv = [...convByRel.keys()].filter((r) => !corpusByRel.has(r));
const corpusLocks = walk(CORPUS, 0, [], (n) => n === "session.lock").length;
const convLocks = walk(CONVERTED, 0, [], (n) => n === "session.lock").length;
// 非 .zstd / 非 lock 的其它文件（legacyLayout 风险）
const corpusOther = walk(CORPUS, 0, [], (n) => !n.endsWith(".jsonl.zstd") && n !== "session.lock").map((p) => relOf(CORPUS, p));
const convOther = walk(CONVERTED, 0, [], (n) => !n.endsWith(".jsonl.zstd") && n !== "session.lock").map((p) => relOf(CONVERTED, p));

if (!QUIET)
  process.stderr.write(
    `[verify-v4] corpus=${corpusFiles.length} converted=${convFiles.length} relUnion=${allRel.length} onlyCorpus=${onlyCorpus.length} onlyConv=${onlyConv.length} locks=${corpusLocks}/${convLocks} other=${corpusOther.length}/${convOther.length}\n`,
  );

// ---------------------------------------------------------------- 真件物理闸门
async function realHeaderFrameGate(p) {
  try {
    await JsonlSessionPersistence.prototype.readFirstZstdLine.call({}, p, undefined);
    return { ok: true };
  } catch (e) {
    return { ok: false, cls: classify(e), message: String(e?.message ?? e).slice(0, 200) };
  }
}
function realBackend(root) {
  const o = Object.create(JsonlSessionPersistence.prototype);
  o.root = root;
  o.compression = "zstd";
  o.config = { root };
  o.name = "wp1-verify";
  o.ctx = { logger: { warn() {}, info() {}, debug() {}, error() {} } };
  o.coldLogMemo = new Map();
  o.migrationPreparations = new Map();
  o.generationFormat = {
    currentVersion: sessionFormatCatalog.currentVersion,
    encodeHeader: (h, c) => sessionFormatCatalog.encodeCurrentHeader(h, c),
    encodeEvent: (e) => sessionFormatCatalog.encodeCurrentEvent(e),
    isUnsupportedMigrationError: () => true,
  };
  return o;
}
async function realListArtifacts(root) {
  try {
    const list = await JsonlSessionPersistence.prototype.listArtifacts.call(realBackend(root), undefined);
    return { ok: true, count: list.length, ids: list.map((a) => a.header.id), versions: [...new Set(list.map((a) => a.sourceVersion))].sort() };
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e).slice(0, 240) };
  }
}

// ---------------------------------------------------------------- 0.1.1 侧对照解码
// 工单点名的只读输入：/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/
// 其中 dsh-session-format-{catalog,format,v0-to-v1,...} 全部是**悬空符号链接**（指向已不存在的
// .npm-global/.../0.2.0 之外的旧全局树），故 0.1.1 的 format-catalog 路径不可用；
// 但 0.1.1 的原生解码器在 dsh-session-persistence-jsonl@0.1.1-rc.2 内，且 readZstdPrefix 不用 this，
// 可用原型调用做**真实 0.1.1 侧解码**。
const LEGACY = Number(flag("legacy011", 0)) || 0;
if (LEGACY) {
  const L011 = "/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js";
  const res = { module: L011, probe: {}, formatPackages: {} };
  for (const p of ["dsh-session-format-catalog", "dsh-session-format", "dsh-session-format-v0-to-v1", "dsh-session-format-v1-to-v2", "dsh-session-format-v2-to-v3"]) {
    const target = "/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/" + p;
    res.formatPackages[p] = { exists: fs.existsSync(target), link: fs.existsSync(target) ? null : (() => { try { return fs.readlinkSync(target); } catch { return null; } })() };
  }
  const mod = await import(pathToFileURL(L011).href);
  const Proto = mod.default.prototype;
  res.probe.readZstdPrefixIsThisFree = !/this\./.test(Proto.readZstdPrefix.toString());
  const sample = LEGACY >= allRel.length ? allRel : allRel.filter((_, i) => i % Math.ceil(allRel.length / LEGACY) === 0).slice(0, LEGACY);
  const dec011 = async (p) => {
    const r = await Proto.readZstdPrefix.call({}, fs.readFileSync(p), undefined);
    return r.events;
  };
  const typeHist = (evs, h = {}) => {
    for (const e of evs) h[e.type] = (h[e.type] ?? 0) + 1;
    return h;
  };
  const summary = {
    corpus: { n: 0, ok: 0, fail: 0, classes: {}, totalEvents: 0, types: {} },
    converted: { n: 0, ok: 0, fail: 0, classes: {}, totalEvents: 0, types: {} },
    pair: { n: 0, eventCountEqual: 0, rawEqual: 0, strippedEqual: 0, mismatches: [] },
  };
  const LIM = LEGACY >= allRel.length ? allRel : sample;
  for (const rel of LIM) {
    let evC = null;
    let evV = null;
    let errC = null;
    let errV = null;
    try {
      evC = await dec011(corpusByRel.get(rel));
      summary.corpus.ok++;
      summary.corpus.totalEvents += evC.length;
      typeHist(evC, summary.corpus.types);
    } catch (e) {
      summary.corpus.fail++;
      errC = classify(e);
      summary.corpus.classes[errC] = (summary.corpus.classes[errC] ?? 0) + 1;
    }
    try {
      evV = await dec011(convByRel.get(rel));
      summary.converted.ok++;
      summary.converted.totalEvents += evV.length;
      typeHist(evV, summary.converted.types);
    } catch (e) {
      summary.converted.fail++;
      errV = classify(e);
      summary.converted.classes[errV] = (summary.converted.classes[errV] ?? 0) + 1;
    }
    summary.corpus.n++;
    summary.converted.n++;
    if (evC && evV) {
      summary.pair.n++;
      const norm = (evs) => evs.map((e) => canon(dropEnvelope(e, EVENT_DROP))).join("\n");
      const strip = (evs) => evs.map((e) => canon(stripWhitelist(dropEnvelope(e, EVENT_DROP)))).join("\n");
      const cntEq = evC.length === evV.length;
      const rawEq = cntEq && sha(norm(evC)) === sha(norm(evV));
      const strEq = cntEq && sha(strip(evC)) === sha(strip(evV));
      if (cntEq) summary.pair.eventCountEqual++;
      if (rawEq) summary.pair.rawEqual++;
      if (strEq) summary.pair.strippedEqual++;
      if (!strEq && summary.pair.mismatches.length < 10) {
        const d = [];
        diffPaths(stripWhitelist(evC), stripWhitelist(evV), "", d, 10);
        summary.pair.mismatches.push({ rel, eventCount: { corpus: evC.length, converted: evV.length }, diff: d });
      }
    } else if (summary.pair.mismatches.length < 10) {
      summary.pair.mismatches.push({ rel, decodeFailure: { corpus: errC, converted: errV } });
    }
  }
  res.probe.summary = summary;
  fs.writeFileSync(path.join(HERE, "legacy-011-result.json"), JSON.stringify(res, null, 2));
  console.log(
    JSON.stringify(
      {
        module: res.module,
        readZstdPrefixIsThisFree: res.probe.readZstdPrefixIsThisFree,
        formatPackages: res.formatPackages,
        summary: { ...summary, corpus: { ...summary.corpus, types: undefined }, converted: { ...summary.converted, types: undefined } },
        corpusTypes: summary.corpus.types,
        convertedTypes: summary.converted.types,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

// ---------------------------------------------------------------- current-generation 读路径边界
// 0.2.0 :2937 readZstdPrefix（经 :2782 readStoredLog / :2795 decodeStoredLog）是**当前代(v4)**读路径；
// 对历史 v0/v3 文件它按设计拒绝（"older than the supported v4, and this build ships no upgrade path"）。
// 本模式把该边界固化为可复跑证据，避免把它误当成历史根的门槛。
const CURGEN = Number(flag("curgen", 0)) || 0;
if (CURGEN) {
  const n = Math.min(CURGEN, allRel.length);
  const step = Math.ceil(allRel.length / n);
  const picked = allRel.filter((_, i) => i % step === 0).slice(0, n);
  const res = { mode: "curgen", n: picked.length, ok: 0, fail: 0, classes: {}, samples: [] };
  for (const rel of picked) {
    const p = convByRel.get(rel);
    try {
      const r = await JsonlSessionPersistence.prototype.readZstdPrefix.call({}, fs.readFileSync(p), undefined);
      res.ok++;
      if (res.samples.length < 2) res.samples.push({ rel, ok: true, events: r.events.length, metaVersion: r.meta?.version });
    } catch (e) {
      res.fail++;
      const c = classify(e);
      res.classes[c] = (res.classes[c] ?? 0) + 1;
      if (res.samples.length < 2) res.samples.push({ rel, ok: false, cls: c, message: String(e?.message ?? e).slice(0, 180) });
    }
  }
  fs.writeFileSync(path.join(HERE, "curgen-result.json"), JSON.stringify(res, null, 2));
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}

// ---------------------------------------------------------------- 可复现反证：单帧 vs 分帧
// 旧 convert.mjs 把「header 行 + 全部行」压成**一个** frame；本模式在 verify 边界内重建该形态，
// 用真件 readFirstZstdLine/listArtifacts 复现"整根枚举为空"——不依赖已被替换的旧产物，可复跑。
const SINGLEFRAME = Number(flag("singleframe", 0)) || 0;
if (SINGLEFRAME || REFRAME) {
  const mode = SINGLEFRAME ? "singleframe" : "reframe";
  const total = allRel.length;
  const want = SINGLEFRAME || REFRAME;
  const take = want >= total ? total : Math.max(1, want);
  const picked = want >= total ? allRel : allRel.filter((_, i) => i % Math.ceil(total / take) === 0).slice(0, take);
  const outRoot = path.join(HERE, mode, "sessions");
  fs.rmSync(path.join(HERE, mode), { recursive: true, force: true });
  let n = 0;
  for (const rel of picked) {
    const src = convByRel.get(rel);
    if (!src) continue;
    const l = readLog(src);
    let packed;
    if (SINGLEFRAME) {
      packed = zlib.zstdCompressSync(Buffer.from(l.lines.join("\n") + "\n", "utf8"), { level: 3 }); // 旧 convert.mjs 形态
    } else {
      const headerFrame = zlib.zstdCompressSync(Buffer.from(l.lines[0] + "\n", "utf8"), { level: 3 });
      const restFrame = zlib.zstdCompressSync(Buffer.from(l.lines.slice(1).join("\n") + "\n", "utf8"), { level: 3 });
      packed = Buffer.concat([headerFrame, restFrame]); // 修复后形态：frame#0 = 恰好一行 header
    }
    const dst = path.join(outRoot, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, packed);
    n++;
  }
  for (const p of walk(CONVERTED, 0, [], (nm) => nm === "session.lock")) {
    const dst = path.join(outRoot, relOf(CONVERTED, p));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(p, dst);
  }
  let gateOk = 0;
  let gateFail = 0;
  const failClasses = {};
  let firstErr = null;
  for (const rel of picked.slice(0, 60)) {
    const r = await realHeaderFrameGate(path.join(outRoot, rel));
    if (r.ok) gateOk++;
    else {
      gateFail++;
      failClasses[r.cls] = (failClasses[r.cls] ?? 0) + 1;
      if (!firstErr) firstErr = r.message;
    }
  }
  const res = {
    mode,
    sampledFiles: n,
    gateSample: { n: Math.min(60, picked.length), ok: gateOk, fail: gateFail, failClasses, firstError: firstErr },
    listArtifacts_sampledRoot: await realListArtifacts(outRoot),
    listArtifacts_corpus: { count: (await realListArtifacts(CORPUS)).count },
    listArtifacts_converted: { count: (await realListArtifacts(CONVERTED)).count },
  };
  fs.writeFileSync(path.join(HERE, mode + "-result.json"), JSON.stringify(res, null, 2));
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}

// ---------------------------------------------------------------- Pass 0：物理 header（只解 frame#0）
if (!QUIET) process.stderr.write("[verify-v4] pass0 headers (frame#0 only)...\n");
const meta = new Map();
for (const rel of allRel) {
  const rec = { rel };
  const cp = corpusByRel.get(rel);
  const vp = convByRel.get(rel);
  if (cp) {
    try {
      const l = readLog(cp, { headerOnly: true });
      rec.corpusHeaderLine = l.headerLine;
      rec.corpusHeader = JSON.parse(l.headerLine);
      rec.corpusFrames = l.frameCount;
      rec.corpusFirstFrameOk = l.firstFrameOk;
      rec.corpusFrame0Sha = l.frame0Sha;
      rec.corpusFrame0Len = l.frame0Len;
      rec.corpusBytes = l.bufLen;
    } catch (e) {
      rec.corpusReadError = String(e?.message ?? e).slice(0, 160);
    }
  }
  if (vp) {
    try {
      const l = readLog(vp, { headerOnly: true });
      rec.convHeaderLine = l.headerLine;
      rec.convHeader = JSON.parse(l.headerLine);
      rec.convFrames = l.frameCount;
      rec.convFirstFrameOk = l.firstFrameOk;
      rec.convFrame0Sha = l.frame0Sha;
      rec.convFrame0Len = l.frame0Len;
      rec.convBytes = l.bufLen;
    } catch (e) {
      rec.convReadError = String(e?.message ?? e).slice(0, 160);
    }
  }
  meta.set(rel, rec);
}
function histogram(arr) {
  const h = {};
  for (const v of arr) h[v] = (h[v] ?? 0) + 1;
  return h;
}
if (!QUIET) {
  const f = [...meta.values()];
  process.stderr.write(`[verify-v4]   convFrames=${JSON.stringify(histogram(f.map((m) => m.convFrames)))} corpusFrames>=2: ${f.filter((m) => (m.corpusFrames ?? 0) >= 2).length}/${f.length}\n`);
  process.stderr.write(`[verify-v4]   firstFrameOk conv=${f.filter((m) => m.convFirstFrameOk).length}/${f.length} corpus=${f.filter((m) => m.corpusFirstFrameOk).length}/${f.length}\n`);
  process.stderr.write(`[verify-v4]   frame0Sha equal conv==corpus: ${f.filter((m) => m.convFrame0Sha && m.convFrame0Sha === m.corpusFrame0Sha).length}/${f.length}\n`);
}

// ---------------------------------------------------------------- Pass 1：child facts
if (!QUIET) process.stderr.write("[verify-v4] pass1 child facts (prepareCatalogFacts 口径)...\n");
const bestByDir = new Map();
for (const rel of allRel) {
  if (!convByRel.has(rel)) continue;
  const dir = path.dirname(rel);
  const v = versionOfName(path.basename(rel));
  const cur = bestByDir.get(dir);
  if (!cur || v > cur.v) bestByDir.set(dir, { rel, v });
}
const selectedRel = new Set([...bestByDir.values()].map((x) => x.rel));
const factsByParent = new Map();
const childFailures = [];
let childDecoded = 0;
let childUnavailable = 0;
for (const rel of [...selectedRel].sort()) {
  const vp = convByRel.get(rel);
  let artifact;
  try {
    const l = readLog(vp);
    const restore = historicalSessionFormatCatalog.createRestore(JSON.parse(l.headerLine), RESTORE_READ);
    for (let i = 1; i < l.lines.length; i++) restore.decodeRow(JSON.parse(l.lines[i]));
    artifact = restore.finish();
    childDecoded++;
  } catch (e) {
    childUnavailable++;
    childFailures.push({ rel, cls: classify(e), error: String(e?.message ?? e).slice(0, 180) });
    let hdr;
    try {
      hdr = historicalSessionFormatCatalog.readHeader(JSON.parse(meta.get(rel).convHeaderLine)).header;
    } catch {
      hdr = undefined;
    }
    if (hdr?.origin === "subagent" && hdr.parentSession !== undefined) {
      const arr = factsByParent.get(hdr.parentSession) ?? [];
      arr.push({ childId: hdr.id, childCreatedAt: hdr.createdAt, descriptorCount: 0, descriptor: null, sourcePath: vp });
      factsByParent.set(hdr.parentSession, arr);
    }
    continue;
  }
  const h = artifact.header;
  if (h.origin !== "subagent" || h.parentSession === undefined) continue;
  try {
    const fact = historicalChildCatalogSource(artifact);
    const arr = factsByParent.get(h.parentSession) ?? [];
    arr.push({ ...fact, sourcePath: vp });
    factsByParent.set(h.parentSession, arr);
  } catch (e) {
    childFailures.push({ rel, cls: classify(e), error: String(e?.message ?? e).slice(0, 180) });
    const arr = factsByParent.get(h.parentSession) ?? [];
    arr.push({ childId: h.id, childCreatedAt: h.createdAt, descriptorCount: 0, descriptor: null, sourcePath: vp });
    factsByParent.set(h.parentSession, arr);
  }
}
const totalFacts = [...factsByParent.values()].reduce((a, b) => a + b.length, 0);
if (!QUIET)
  process.stderr.write(
    `[verify-v4]   selected=${selectedRel.size} childDecoded=${childDecoded} childUnavailable=${childUnavailable} parentsWithFacts=${factsByParent.size} totalFacts=${totalFacts}\n`,
  );

// ---------------------------------------------------------------- Pass 2：主验证
if (!QUIET) process.stderr.write("[verify-v4] pass2 main...\n");
const out = fs.createWriteStream(OUT_FILE);
const target = LIMIT ? allRel.slice(0, LIMIT) : allRel;
const t0 = Date.now();
let done = 0;

const agg = {
  env: { node: process.version, generatedAt: new Date().toISOString(), args, root: { CORPUS, CONVERTED } },
  files: {
    total: allRel.length, corpus: corpusFiles.length, converted: convFiles.length,
    onlyCorpus, onlyConv, locks: { corpus: corpusLocks, converted: convLocks },
    otherFiles: { corpus: corpusOther, converted: convOther },
    convertedBasenames: histogram(convFiles.map((p) => path.basename(p))),
    corpusBasenames: histogram(corpusFiles.map((p) => path.basename(p))),
    convertedFrames: histogram([...meta.values()].map((m) => m.convFrames)),
    corpusFramesTwoPlus: [...meta.values()].filter((m) => (m.corpusFrames ?? 0) >= 2).length,
    distinctSessionDirs: bestByDir.size,
  },
  q1: { targetPass: 0, targetFail: 0, targetClasses: {}, baselinePass: 0, baselineFail: 0, baselineClasses: {}, targetFailList: [], baselineFailList: [] },
  q2: {
    pass: 0, fail: 0, classes: {}, failList: [],
    transformedPass: 0, transformedFail: 0, transformedClasses: {}, transformedFailList: [],
    parentsWithFacts: factsByParent.size, totalFacts, childDecoded, childUnavailable, childFailures,
    sameTurnHash: 0, diffTurnHash: 0,
  },
  q3_1: { rawHeaderLineEqual: 0, rawHeaderLineDiff: [], fieldMismatch: [], seedLengthFiles: [], isSeededFiles: [], jsonDeepDiff: [] },
  framing: {
    frame0ByteEqual: 0, frame0ByteDiff: [], restLineCountEqual: 0, restVerbatimEqual: 0,
    restDifferingRowsWhitelistOnly: 0, restNonWhitelistLineDiff: [], cleanFilesVerbatimEqual: 0, cleanFiles: 0,
  },
  q3_2: { landmarkDiffFiles: [], rowsVsEventsNotes: [], totalCorpus: emptyCounts(), totalConv: emptyCounts(), totalCorpusFromEvents: emptyCounts(), totalConvFromEvents: emptyCounts(), packedRows: 0, packedChunks: 0, packedBad: 0 },
  q3_3: {
    rowsStrippedEqual: 0, rowsRawEqual: 0, rowsNonWhitelistDiff: [], rowsWhitelistDiffFiles: 0,
    eventsStrippedEqual: 0, eventsRawEqual: 0, eventsSourceRefused: 0,
    eventsShimStrippedEqual: 0, eventsShimRawEqual: 0, eventsShimErrors: 0,
    whitelistAudit: { r1Before: 0, r1After: 0, r2Missing: 0, r2Empty: 0, r2NonEmpty: 0 },
    whitelistAuditConv: { r1Before: 0, r1After: 0, r2Missing: 0, r2Empty: 0, r2NonEmpty: 0 },
    exactTargets: { r1Files: 0, r2Files: 0, cleanFiles: 0 },
  },
  physical: { convFirstFrameOk: 0, corpusFirstFrameOk: 0, realConvOk: 0, realConvFail: 0, realConvClasses: {}, realCorpusOk: 0, realCorpusFail: 0, realCorpusClasses: {}, realFailSamples: [] },
};

for (const rel of target) {
  const rec = { rel, version: null };
  const m = meta.get(rel);
  rec.version = m?.convHeader?.version ?? m?.corpusHeader?.version ?? null;
  const cp = corpusByRel.get(rel);
  const vp = convByRel.get(rel);
  try {
    const CL = readLog(cp);
    const VL = readLog(vp);
    rec.bytes = { corpus: CL.bufLen, converted: VL.bufLen };
    rec.frames = { corpus: CL.frameCount, converted: VL.frameCount };

    // ---------------- Q3.1 头部不变量
    const q31 = { rawLineEqual: CL.headerLine === VL.headerLine, fields: {}, mismatch: [] };
    if (q31.rawLineEqual) agg.q3_1.rawHeaderLineEqual++;
    else agg.q3_1.rawHeaderLineDiff.push(rel);
    const hc = m.corpusHeader;
    const hv = m.convHeader;
    for (const f of ["id", "createdAt", "cwd", "parentSession", "origin", "delegationDepth", "agentPreset"]) {
      const eq = canon(hc[f]) === canon(hv[f]);
      q31.fields[f] = { corpus: hc[f] ?? null, converted: hv[f] ?? null, equal: eq };
      if (!eq) q31.mismatch.push(f);
    }
    // seedLength → isSeeded（0.2.0 v0-to-v1 :1707/:1720/:1728）
    const seedEq = canon(hc.seedLength) === canon(hv.seedLength);
    const isSeedEq = canon(hc.isSeeded) === canon(hv.isSeeded);
    q31.fields.seedLength = { corpus: hc.seedLength ?? null, converted: hv.seedLength ?? null, equal: seedEq };
    q31.fields.isSeeded = { corpus: hc.isSeeded ?? null, converted: hv.isSeeded ?? null, equal: isSeedEq };
    if (hc.seedLength !== undefined) agg.q3_1.seedLengthFiles.push(rel);
    if (hc.isSeeded !== undefined) agg.q3_1.isSeededFiles.push(rel);
    if (!seedEq) q31.mismatch.push("seedLength");
    if (!isSeedEq) q31.mismatch.push("isSeeded");
    const deep = [];
    diffPaths(hc, hv, "", deep, 20);
    q31.deepDiff = deep;
    if (deep.length) agg.q3_1.jsonDeepDiff.push({ rel, deep });
    if (q31.mismatch.length) agg.q3_1.fieldMismatch.push({ rel, mismatch: q31.mismatch });
    rec.q3_1 = q31;

    // ---------------- 行对象
    const corpsRows = CL.lines.slice(1).map((l) => JSON.parse(l));
    const convRows = VL.lines.slice(1).map((l) => JSON.parse(l));
    const rowLineC = CL.lines.slice(1);
    const rowLineV = VL.lines.slice(1);

    // ---------------- Q3.1b 分帧无损
    const q31b = {
      frame0ByteEqual: CL.frame0Sha === VL.frame0Sha,
      frame0Sha: { corpus: CL.frame0Sha, converted: VL.frame0Sha },
      frame0Len: { corpus: CL.frame0Len, converted: VL.frame0Len },
      corpusFrames: CL.frameCount,
      convertedFrames: VL.frameCount,
      restLines: { corpus: rowLineC.length, converted: rowLineV.length },
    };
    q31b.restLineCountEqual = rowLineC.length === rowLineV.length;
    q31b.restVerbatimEqual = q31b.restLineCountEqual && rowLineC.every((l, i) => l === rowLineV[i]);
    // frame>=1 逐行：文本不同的行，扣除白名单后必须**逐字段相等**（顺序/内容不变量）
    const differing = [];
    let nonWL = null;
    if (q31b.restLineCountEqual) {
      for (let i = 0; i < rowLineC.length; i++) {
        if (rowLineC[i] === rowLineV[i]) continue;
        differing.push(i);
        const oc = canon(stripWhitelist(dropEnvelope(corpsRows[i], ROW_DROP)));
        const ov = canon(stripWhitelist(dropEnvelope(convRows[i], ROW_DROP)));
        if (oc !== ov && nonWL === null) nonWL = { rowIndex: i, type: corpsRows[i]?.type };
      }
    } else {
      nonWL = { rowIndex: -1, type: "<lineCountMismatch>", corpus: rowLineC.length, converted: rowLineV.length };
    }
    q31b.restDifferingRows = differing.length;
    q31b.restDifferingRowsWhitelistOnly = nonWL === null;
    if (!q31b.frame0ByteEqual) agg.framing.frame0ByteDiff.push(rel);
    if (q31b.restLineCountEqual) agg.framing.restLineCountEqual++;
    if (q31b.restVerbatimEqual) agg.framing.restVerbatimEqual++;
    if (nonWL === null) agg.framing.restDifferingRowsWhitelistOnly++;
    else agg.framing.restNonWhitelistLineDiff.push({ rel, ...nonWL });
    const wa0 = whitelistAudit(corpsRows);
    if (wa0.r1Before === 0 && wa0.r2Missing === 0) {
      agg.framing.cleanFiles++;
      if (q31b.restVerbatimEqual) agg.framing.cleanFilesVerbatimEqual++;
    }
    if (q31b.frame0ByteEqual) agg.framing.frame0ByteEqual++;
    rec.q3_1b = q31b;

    // 白名单审计（精确计数）
    const wa = whitelistAudit(corpsRows);
    const wb = whitelistAudit(convRows);
    for (const k of Object.keys(agg.q3_3.whitelistAudit)) agg.q3_3.whitelistAudit[k] += wa[k];
    for (const k of Object.keys(agg.q3_3.whitelistAuditConv)) agg.q3_3.whitelistAuditConv[k] += wb[k];
    if (wa.r1Before > 0) agg.q3_3.exactTargets.r1Files++;
    if (wa.r2Missing > 0) agg.q3_3.exactTargets.r2Files++;
    if (wa.r1Before === 0 && wa.r2Missing === 0) agg.q3_3.exactTargets.cleanFiles++;
    rec.whitelistAudit = { corpus: wa, converted: wb };

    // ---------------- Q3.2 地标计数
    const cCount = countFromRows(corpsRows);
    const vCount = countFromRows(convRows);
    for (const t of Object.keys(cCount.counts)) {
      agg.q3_2.totalCorpus[t] += cCount.counts[t];
      agg.q3_2.totalConv[t] += vCount.counts[t];
    }
    agg.q3_2.packedRows += cCount.packedRows;
    agg.q3_2.packedChunks += cCount.packedChunks;
    agg.q3_2.packedBad += cCount.packedBad;
    const landmarkDiff = [];
    for (const t of Object.keys(cCount.counts)) {
      if (cCount.counts[t] !== vCount.counts[t]) landmarkDiff.push({ type: t, corpus: cCount.counts[t], converted: vCount.counts[t] });
    }
    if (corpsRows.length !== convRows.length) landmarkDiff.push({ type: "<rowCount>", corpus: corpsRows.length, converted: convRows.length });

    // ---------------- Q3.3 行级稳定规范化哈希
    const normRows = (rows) => rows.map((r) => canon(dropEnvelope(r, ROW_DROP)));
    const stripRows = (rows) => rows.map((r) => canon(stripWhitelist(dropEnvelope(r, ROW_DROP))));
    const rowsRawH = { corpus: sha(normRows(corpsRows).join("\n")), converted: sha(normRows(convRows).join("\n")) };
    const rowsStripH = { corpus: sha(stripRows(corpsRows).join("\n")), converted: sha(stripRows(convRows).join("\n")) };
    if (rowsRawH.corpus === rowsRawH.converted) agg.q3_3.rowsRawEqual++;
    if (rowsStripH.corpus === rowsStripH.converted) agg.q3_3.rowsStrippedEqual++;
    // 扣除白名单后的严格差异（任何一条即非白名单差异）
    const stripDiff = [];
    diffPaths(stripWhitelist(corpsRows), stripWhitelist(convRows), "", stripDiff, 20);
    if (stripDiff.length) agg.q3_3.rowsNonWhitelistDiff.push({ rel, paths: stripDiff.slice(0, 12) });
    if (corpsRows.length !== convRows.length || rowsRawH.corpus !== rowsRawH.converted) agg.q3_3.rowsWhitelistDiffFiles++;

    // ---------------- Q1 读打开
    const decodeWith = (catalog, headerLine0, lines, opts) => {
      const restore = catalog.createRestore(JSON.parse(headerLine0), opts);
      for (let i = 1; i < lines.length; i++) restore.decodeRow(JSON.parse(lines[i]));
      return restore.finish();
    };
    const q1 = {};
    let convArtifact = null;
    let baseArtifact = null;
    try {
      convArtifact = decodeWith(historicalSessionFormatCatalog, VL.headerLine, VL.lines, RESTORE_READ);
      q1.target = { ok: true, events: convArtifact.events.length, headerVersion: convArtifact.header.version };
      agg.q1.targetPass++;
    } catch (e) {
      q1.target = { ok: false, cls: classify(e), error: String(e?.message ?? e).slice(0, 200) };
      agg.q1.targetFail++;
      agg.q1.targetClasses[q1.target.cls] = (agg.q1.targetClasses[q1.target.cls] ?? 0) + 1;
      agg.q1.targetFailList.push({ rel, cls: q1.target.cls, error: q1.target.error });
    }
    try {
      baseArtifact = decodeWith(historicalSessionFormatCatalog, CL.headerLine, CL.lines, RESTORE_READ);
      q1.baseline = { ok: true, events: baseArtifact.events.length, headerVersion: baseArtifact.header.version };
      agg.q1.baselinePass++;
    } catch (e) {
      q1.baseline = { ok: false, cls: classify(e), error: String(e?.message ?? e).slice(0, 200) };
      agg.q1.baselineFail++;
      agg.q1.baselineClasses[q1.baseline.cls] = (agg.q1.baselineClasses[q1.baseline.cls] ?? 0) + 1;
      agg.q1.baselineFailList.push({ rel, cls: q1.baseline.cls, error: q1.baseline.error });
    }
    rec.q1 = q1;
    // 注：解码后的 v2/v3 词汇表**不含** assistant/chunk（v1→v2 :6 把它从 dispositions 剔除，
    // :4 用 AssistantStreamAccumulator 折叠进 assistant/message/assistant/attempt/system/message）。
    // 故地标比对以"落库行 + packed 展开"为准；解码投影仅作参考，不参与判据。
    const rowsVsEvents = [];
    if (convArtifact) {
      const ce = countFromEvents(convArtifact.events);
      for (const t of Object.keys(ce)) agg.q3_2.totalConvFromEvents[t] += ce[t];
      const mismatch = Object.keys(ce).filter((t) => ce[t] !== vCount.counts[t]);
      rowsVsEvents.push(...mismatch.map((t) => ({ type: t, rowsExpanded: vCount.counts[t], decodedEvents: ce[t] })));
    }
    if (baseArtifact) {
      const ce = countFromEvents(baseArtifact.events);
      for (const t of Object.keys(ce)) agg.q3_2.totalCorpusFromEvents[t] += ce[t];
    }
    if (landmarkDiff.length) agg.q3_2.landmarkDiffFiles.push({ rel, landmarkDiff });
    if (rowsVsEvents.length) agg.q3_2.rowsVsEventsNotes.push({ rel, rowsVsEvents });
    rec.q3_2 = {
      rows: { corpus: corpsRows.length, converted: convRows.length },
      packedRows: cCount.packedRows, packedChunks: cCount.packedChunks,
      countsCorpusRows: cCount.counts, countsConvRows: vCount.counts,
      countsCorpusEvents: baseArtifact ? countFromEvents(baseArtifact.events) : null,
      countsConvEvents: convArtifact ? countFromEvents(convArtifact.events) : null,
      diff: landmarkDiff,
      rowsVsEventsNote: rowsVsEvents.length ? rowsVsEvents : null,
    };

    // ---------------- Q2 写打开 v4 全链（绑定真实 child facts）
    const q2 = {};
    let logicalId;
    try {
      logicalId = historicalSessionFormatCatalog.readHeader(JSON.parse(VL.headerLine)).header.id;
    } catch {
      logicalId = undefined;
    }
    const facts = (logicalId !== undefined && factsByParent.get(logicalId)) || [];
    q2.facts = facts.length;
    q2.factIds = facts.map((f) => f.childId);
    const runV4 = (opts) => {
      const catalog = createSessionFormatCatalogWithChildren(facts);
      const restore = catalog.createRestore(JSON.parse(VL.headerLine), opts);
      for (let i = 1; i < VL.lines.length; i++) restore.decodeRow(JSON.parse(VL.lines[i]));
      return restore.finish();
    };
    try {
      const art = runV4(RESTORE_V4);
      q2.current = { ok: true, headerVersion: art.header.version, events: art.events.length, inheritedEventCount: art.inheritedEventCount };
      agg.q2.pass++;
    } catch (e) {
      q2.current = { ok: false, cls: classify(e), error: String(e?.message ?? e).slice(0, 220) };
      agg.q2.fail++;
      agg.q2.classes[q2.current.cls] = (agg.q2.classes[q2.current.cls] ?? 0) + 1;
      agg.q2.failList.push({ rel, cls: q2.current.cls, error: q2.current.error });
    }
    try {
      const art = runV4(RESTORE_V4_TX);
      q2.transformed = { ok: true, headerVersion: art.header.version, events: art.events.length };
      agg.q2.transformedPass++;
    } catch (e) {
      q2.transformed = { ok: false, cls: classify(e), error: String(e?.message ?? e).slice(0, 220) };
      agg.q2.transformedFail++;
      agg.q2.transformedClasses[q2.transformed.cls] = (agg.q2.transformedClasses[q2.transformed.cls] ?? 0) + 1;
      agg.q2.transformedFailList.push({ rel, cls: q2.transformed.cls, error: q2.transformed.error });
    }
    rec.q2 = q2;

    // ---------------- Q3.3 事件级哈希
    const normEv = (evs) => evs.map((e) => canon(dropEnvelope(e, EVENT_DROP)));
    const stripEv = (evs) => evs.map((e) => canon(stripWhitelist(dropEnvelope(e, EVENT_DROP))));
    const q33 = {
      rows_raw_hash: rowsRawH, rows_stripped_hash: rowsStripH,
      rows_raw_equal: rowsRawH.corpus === rowsRawH.converted,
      rows_stripped_equal: rowsStripH.corpus === rowsStripH.converted,
      rows_strip_diff: stripDiff.slice(0, 10),
    };
    if (baseArtifact && convArtifact) {
      const er = { corpus: sha(normEv(baseArtifact.events).join("\n")), converted: sha(normEv(convArtifact.events).join("\n")) };
      const es = { corpus: sha(stripEv(baseArtifact.events).join("\n")), converted: sha(stripEv(convArtifact.events).join("\n")) };
      q33.events_raw_hash = er;
      q33.events_stripped_hash = es;
      q33.events_raw_equal = er.corpus === er.converted;
      q33.events_stripped_equal = es.corpus === es.converted;
      if (q33.events_raw_equal) agg.q3_3.eventsRawEqual++;
      if (q33.events_stripped_equal) agg.q3_3.eventsStrippedEqual++;
      if (!q33.events_stripped_equal) {
        const d = [];
        diffPaths(stripWhitelist(baseArtifact.events), stripWhitelist(convArtifact.events), "", d, 20);
        q33.events_strip_diff = d;
      }
    } else {
      q33.events_source_refused = true;
      agg.q3_3.eventsSourceRefused++;
    }
    // 对照装置：源侧应用白名单 shim 后解码（全字段口径逐份可比）
    try {
      const shimLines = applyWhitelistShim(CL.lines);
      const shimArt = decodeWith(historicalSessionFormatCatalog, shimLines[0], shimLines, RESTORE_READ);
      if (convArtifact) {
        const sr = { sourceShim: sha(normEv(shimArt.events).join("\n")), converted: sha(normEv(convArtifact.events).join("\n")) };
        const ss = { sourceShim: sha(stripEv(shimArt.events).join("\n")), converted: sha(stripEv(convArtifact.events).join("\n")) };
        q33.events_shim_raw_hash = sr;
        q33.events_shim_stripped_hash = ss;
        q33.events_shim_raw_equal = sr.sourceShim === sr.converted;
        q33.events_shim_stripped_equal = ss.sourceShim === ss.converted;
        if (q33.events_shim_raw_equal) agg.q3_3.eventsShimRawEqual++;
        if (q33.events_shim_stripped_equal) agg.q3_3.eventsShimStrippedEqual++;
        if (!q33.events_shim_stripped_equal) {
          const d = [];
          diffPaths(stripWhitelist(shimArt.events), stripWhitelist(convArtifact.events), "", d, 20);
          q33.events_shim_strip_diff = d;
        }
      }
    } catch (e) {
      q33.events_shim_error = String(e?.message ?? e).slice(0, 200);
      agg.q3_3.eventsShimErrors++;
    }
    rec.q3_3 = q33;

    // ---------------- 物理闸门
    const phys = { convFirstFrameOk: m.convFirstFrameOk ?? null, corpusFirstFrameOk: m.corpusFirstFrameOk ?? null };
    if (m.convFirstFrameOk) agg.physical.convFirstFrameOk++;
    if (m.corpusFirstFrameOk) agg.physical.corpusFirstFrameOk++;
    if (PHYS === "real") {
      const rc = await realHeaderFrameGate(vp);
      phys.realConv = rc;
      if (rc.ok) agg.physical.realConvOk++;
      else {
        agg.physical.realConvFail++;
        agg.physical.realConvClasses[rc.cls] = (agg.physical.realConvClasses[rc.cls] ?? 0) + 1;
        if (agg.physical.realFailSamples.length < 3) agg.physical.realFailSamples.push({ rel, message: rc.message });
      }
      const rb = await realHeaderFrameGate(cp);
      phys.realCorpus = rb;
      if (rb.ok) agg.physical.realCorpusOk++;
      else {
        agg.physical.realCorpusFail++;
        agg.physical.realCorpusClasses[rb.cls] = (agg.physical.realCorpusClasses[rb.cls] ?? 0) + 1;
      }
    }
    rec.physical = phys;
  } catch (e) {
    rec.fatal = String(e?.stack ?? e).slice(0, 400);
  }
  out.write(JSON.stringify(rec) + "\n");
  done++;
  if (!QUIET && done % 100 === 0)
    process.stderr.write(`  ...${done}/${target.length} (${Math.round((Date.now() - t0) / 1000)}s, q2 pass=${agg.q2.pass})\n`);
}

if (!QUIET) process.stderr.write("[verify-v4] root-level real listArtifacts...\n");
agg.physical.listArtifacts = {
  corpus: await realListArtifacts(CORPUS),
  converted: await realListArtifacts(CONVERTED),
};

const n = LIMIT ? target.length : allRel.length;
agg.verdict = {
  q1_baseline_rate: +(100 * agg.q1.baselinePass / Math.max(1, agg.q1.baselinePass + agg.q1.baselineFail)).toFixed(2),
  q1_target_rate: +(100 * agg.q1.targetPass / Math.max(1, agg.q1.targetPass + agg.q1.targetFail)).toFixed(2),
  q1_target_100pct: agg.q1.targetFail === 0,
  q2_rate: +(100 * agg.q2.pass / Math.max(1, agg.q2.pass + agg.q2.fail)).toFixed(2),
  q2_all_current: agg.q2.fail === 0,
  q2_transformed_rate: +(100 * agg.q2.transformedPass / Math.max(1, agg.q2.transformedPass + agg.q2.transformedFail)).toFixed(2),
  q3_1_all_headers_equal: agg.q3_1.rawHeaderLineDiff.length === 0 && agg.q3_1.fieldMismatch.length === 0,
  q3_2_only_assistant_chunk: agg.q3_2.landmarkDiffFiles.every((f) => f.landmarkDiff.every((d) => d.type === "assistant/chunk")),
  q3_2_files_with_landmark_diff: agg.q3_2.landmarkDiffFiles.length,
  q3_2_rows_vs_decoded_notes: agg.q3_2.rowsVsEventsNotes.length,
  framing_frame0_byte_equal: agg.framing.frame0ByteEqual,
  framing_rest_line_count_equal: agg.framing.restLineCountEqual,
  framing_rest_verbatim_equal: agg.framing.restVerbatimEqual,
  framing_rest_diff_whitelist_only: agg.framing.restDifferingRowsWhitelistOnly,
  framing_clean_files_verbatim_equal: `${agg.framing.cleanFilesVerbatimEqual}/${agg.framing.cleanFiles}`,
  framing_rest_nonwhitelist_line_diff: agg.framing.restNonWhitelistLineDiff.length,
  q3_3_rows_raw_equal: agg.q3_3.rowsRawEqual,
  q3_3_rows_stripped_equal: agg.q3_3.rowsStrippedEqual,
  q3_3_rows_nonwhitelist_violations: agg.q3_3.rowsNonWhitelistDiff.length,
  q3_3_events_stripped_equal: agg.q3_3.eventsStrippedEqual,
  q3_3_events_source_refused: agg.q3_3.eventsSourceRefused,
  q3_3_events_shim_stripped_equal: agg.q3_3.eventsShimStrippedEqual,
  q3_3_events_shim_raw_equal: agg.q3_3.eventsShimRawEqual,
  physical_conv_first_frame_ok: agg.physical.convFirstFrameOk,
  physical_real_gate_conv_ok: agg.physical.realConvOk,
  physical_real_gate_conv_fail: agg.physical.realConvFail,
  physical_real_gate_corpus_ok: agg.physical.realCorpusOk,
  physical_listArtifacts_converted: agg.physical.listArtifacts.converted.count ?? 0,
  physical_listArtifacts_corpus: agg.physical.listArtifacts.corpus.count ?? null,
  evaluatedFiles: n,
};

out.end();
fs.writeFileSync(SUMMARY_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), args, agg }, null, 2));
console.log(JSON.stringify(agg.verdict, null, 2));
process.stderr.write(`\n[verify-v4] done ${done} files in ${Math.round((Date.now() - t0) / 1000)}s\n`);
process.stderr.write(`[verify-v4] q1 target ${agg.q1.targetPass}/${agg.q1.targetPass + agg.q1.targetFail} | baseline ${agg.q1.baselinePass}/${agg.q1.baselinePass + agg.q1.baselineFail}\n`);
process.stderr.write(`[verify-v4] q2 current ${agg.q2.pass}/${agg.q2.pass + agg.q2.fail} | transformed ${agg.q2.transformedPass}/${agg.q2.transformedPass + agg.q2.transformedFail}\n`);
process.stderr.write(`[verify-v4] q3.1 header-line-equal ${agg.q3_1.rawHeaderLineEqual} fieldMismatch=${agg.q3_1.fieldMismatch.length}\n`);
process.stderr.write(`[verify-v4] framing frame0-byte-equal ${agg.framing.frame0ByteEqual} rest-linecount-equal ${agg.framing.restLineCountEqual} rest-verbatim-equal ${agg.framing.restVerbatimEqual} rest-diff-whitelist-only ${agg.framing.restDifferingRowsWhitelistOnly} clean-verbatim ${agg.framing.cleanFilesVerbatimEqual}/${agg.framing.cleanFiles}\n`);
process.stderr.write(`[verify-v4] q3.2 landmark-diff-files ${agg.q3_2.landmarkDiffFiles.length}\n`);
process.stderr.write(`[verify-v4] q3.3 rows-raw-equal ${agg.q3_3.rowsRawEqual} rows-stripped-equal ${agg.q3_3.rowsStrippedEqual} nonWhitelist=${agg.q3_3.rowsNonWhitelistDiff.length} events-stripped-equal ${agg.q3_3.eventsStrippedEqual} (sourceRefused ${agg.q3_3.eventsSourceRefused}) shim-stripped-equal ${agg.q3_3.eventsShimStrippedEqual}\n`);
process.stderr.write(`[verify-v4] physical real-gate conv ok=${agg.physical.realConvOk} fail=${agg.physical.realConvFail}; corpus ok=${agg.physical.realCorpusOk} fail=${agg.physical.realCorpusFail}\n`);
