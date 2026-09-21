#!/usr/bin/env node
'use strict';
/**
 * exec-b1/probe-b1-cold-order.mjs —— 交付单元 DU-B1-A 的 **A6「冷路径入选集合 = 可解释顺序」** 验收。
 *
 * 契约：审计 §4.4（断言形状）+ 主 agent 裁决（`exec-audit/b1/DECISIONS.md` 裁决 2）：
 *
 *   > A6 活体集合等式验收**允许读 `~/.dsh/sessions`**，但**只允许解首帧 header**
 *   > （≤1 个 8KB chunk、不解析对话内容、不写会话目录），并必须在脚本与报告中留证。
 *
 * ## 本脚本的读取纪律（可复核，每次打开都记进报告）
 *
 *   1. 每个会话文件**只 open 一次**、**只 read 一次**，`chunk = 8192` 字节，**绝不再读**；
 *   2. 缓冲区里只解**第一个 zstd frame**（该 frame 按设计恰好只含 header 行：
 *      源码 `assertZstdHeaderFrame` 断言 `plaintext` 恰为「一行 + 尾换行」）；
 *   3. 解出的 JSON 只取 `id / createdAt / origin / parentSession` 四字段，
 *      **不解析任何对话事件**，不写会话目录，不开写句柄；
 *   4. 若首帧在 8KB 内不完整（不可解）→ 记 `undecodable` 并**放弃该条**（不追加读取），
 *      同时把「放弃条数」写进报告（不允许静默丢弃）。
 *
 * ## 判据强度（审计 §4.4 的显式要求，必须照录）
 *
 *   > 判据强度排序：`(6)` 确定性**在修订前也恒真**（同进程内 readdir 顺序稳定），
 *   > **不能单独作判据**；只有 `(4)` 集合等式才是**真判据**。
 *   > 若 oracle 不可用，则 A6 降级为 **INCONCLUSIVE**，**不得**用 `(6)` 冒充通过。
 *
 * 因此本脚本产出三个**分级**结论：
 *   - `offline-equality`：用真 oracle 数据 + 真比较器做「期望集合 == 按键降序前 N」对拍（离线可判定）；
 *   - `live-equality`   ：对活体 `POST /api/session.list` 的入选集合跑同一等式（需宿主在线）；
 *   - `determinism`    ：连续两次调用集合相同（**弱判据，单独不构成通过**）。
 *
 * 用法：
 *   node probe-b1-cold-order.mjs                 # oracle + 离线对拍（活体不可达时明确记 INCONCLUSIVE）
 *   node probe-b1-cold-order.mjs --scan-only     # 只扫 oracle（最省）
 *   node probe-b1-cold-order.mjs --max 86400     # 限制扫描文件数（默认全扫）
 *   node probe-b1-cold-order.mjs --report FILE.json
 * 退出码：0 = 离线判据通过 / 2 = 离线判据失败 / 3 = oracle 不可用（INCONCLUSIVE）
 */
import { openSync, readSync, closeSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import zlib from 'node:zlib';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const optOf = (n, d) => { const i = argv.indexOf(n); return i === -1 ? d : argv[i + 1]; };
const REPORT = optOf('--report', join(HERE, 'results', 'probe-b1-cold-order.json'));
const SCAN_ONLY = argv.includes('--scan-only');
/** 重启后（deployed 已是 v2）复验时加 `--expect-deployed`：把活体集合等式升格为**硬断言**。 */
const EXPECT_DEPLOYED = argv.includes('--expect-deployed');
const MAX_FILES = Number(optOf('--max', '0')) || Infinity;
const BASE_URL = optOf('--base', 'http://127.0.0.1:3080');

const HOME = process.env.HOME ?? '/home/CNS2026495165';
const SESSIONS = join(HOME, '.dsh', 'sessions');
const DSH = join(HOME, '.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib');
const CHUNK = 8192;                     // **唯一的读取上限**（用户裁决：≤1 个 8KB chunk）
const ZSTD_MAGIC = 4247762216;

const report = {
  at: new Date().toISOString(), sessionsRoot: SESSIONS,
  readDiscipline: {
    chunkBytes: CHUNK, readsPerFile: 1, framesDecompressed: 1,
    fieldsExtracted: ['id', 'createdAt', 'origin', 'parentSession'],
    parsesConversation: false, writesSessionsDir: false,
  },
  scan: null, offline: null, live: null, checks: [], outcome: 'PENDING',
};
let bad = 0;
const check = (group, name, ok, detail = '') => {
  report.checks.push({ group, name, ok: Boolean(ok), detail: String(detail) });
  if (!ok) bad += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${group}] ${name}${detail ? `  — ${detail}` : ''}`);
};
const info = (m) => console.log(`      ${m}`);

// ---------------------------------------------------------------------------
// 1) 首帧扫描器（按 live 源码的 `scanZstdFrames(buffer, 1)` 语义重写，只用 1 个 chunk）
// ---------------------------------------------------------------------------
/** 在 <=8KB 缓冲内定位**第一个完整** zstd frame；不完整则返回 null（调用方放弃该条，不追加读取）。 */
function scanFirstFrame(buffer) {
  let offset = 0;
  if (buffer.length < 4) return null;
  if (buffer.readUInt32LE(0) !== ZSTD_MAGIC) throw new Error('corrupt session log: invalid frame magic');
  offset += 4;
  if (buffer.length - offset < 1) return null;
  const descriptor = buffer.readUInt8(offset); offset += 1;
  if ((descriptor & 24) !== 0) throw new Error('corrupt session log: reserved frame-header bit');
  const contentSizeFlag = descriptor >>> 6;
  const singleSegment = (descriptor & 32) !== 0;
  const checksum = (descriptor & 4) !== 0;
  const dictionaryFlag = descriptor & 3;
  const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
  const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : (1 << contentSizeFlag);
  const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
  if (buffer.length - offset < remainingHeaderBytes) return null;
  offset += remainingHeaderBytes;
  for (;;) {
    if (buffer.length - offset < 3) return null;
    const blockHeader = buffer.readUIntLE(offset, 3); offset += 3;
    const lastBlock = (blockHeader & 1) !== 0;
    const blockType = (blockHeader >>> 1) & 3;
    const blockSize = blockHeader >>> 3;
    if (blockType === 3) throw new Error('corrupt session log: reserved block type');
    const payloadBytes = blockType === 1 ? 1 : blockSize;
    if (buffer.length - offset < payloadBytes) return null;
    offset += payloadBytes;
    if (lastBlock) break;
  }
  if (checksum) { if (buffer.length - offset < 4) return null; offset += 4; }
  return { start: 0, end: offset };
}
/** 只解首帧 + 只取四字段；`assertZstdHeaderFrame` 的等价断言（恰一行 + 尾换行）。 */
function readHeaderOnly(path) {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(CHUNK);
    const { bytesRead } = readSync(fd, buffer, 0, CHUNK, null);
    const content = buffer.subarray(0, bytesRead);
    const frame = scanFirstFrame(content);
    if (frame === null) return { undecodable: 'first frame not complete within one 8KB chunk', bytesRead, readCalls: 1 };
    const plaintext = zlib.zstdDecompressSync(content.subarray(frame.start, frame.end));
    if (plaintext.length === 0 || plaintext.indexOf(10) !== plaintext.length - 1) {
      return { undecodable: 'first frame is not exactly one header line', bytesRead };
    }
    const parsed = JSON.parse(plaintext.subarray(0, -1).toString('utf8'));
    return {
      bytesRead, readCalls: 1, frameBytes: frame.end,
      // 字段白名单：**只**取这四个（+ cwd 仅用于复刻 live 的 `meta.cwd === undefined` 过滤条件，
      // 且**只记录布尔** hasCwd，不把 cwd 路径本身带出扫描循环）。
      header: { id: parsed.id, createdAt: parsed.createdAt, origin: parsed.origin, parentSession: parsed.parentSession },
      hasCwd: typeof parsed.cwd === 'string',
    };
  } finally { closeSync(fd); }
}

// ---------------------------------------------------------------------------
// 2) 扫描全部会话（只解首帧）
// ---------------------------------------------------------------------------
console.log('=== 1) oracle 扫描（每个会话文件只打开 1 次、只读 1 个 8KB chunk、只解首帧） ===');
function walk(root) {
  const out = [];
  const projects = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const p of projects) {
    const pdir = join(root, p.name);
    for (const s of readdirSync(pdir, { withFileTypes: true })) {
      if (!s.isDirectory()) continue;
      const f = join(pdir, s.name, 'session.jsonl.zstd');
      try { if (statSync(f).isFile()) out.push(f); } catch { /* 非 zstd 或缺失 */ }
    }
  }
  return out;
}
let files = [];
try { files = walk(SESSIONS); } catch (e) {
  console.error(`[INCONCLUSIVE] 无法枚举会话根 ${SESSIONS}：${e.message}`);
  report.outcome = 'INCONCLUSIVE';
  report.reason = `oracle 不可用：${e.message}`;
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n', 'utf8');
  process.exit(3);
}
let headers = []; const undecodable = []; let totalBytesRead = 0; let readCalls = 0;
for (const f of files.slice(0, MAX_FILES === Infinity ? files.length : MAX_FILES)) {
  let r;
  try { r = readHeaderOnly(f); } catch (e) { undecodable.push({ file: f, error: e.message }); continue; }
  totalBytesRead += Number(r.bytesRead) || 0;
  readCalls += Number(r.readCalls) || 0;
  if (r.undecodable) { undecodable.push({ file: f, error: r.undecodable }); continue; }
  headers.push({ ...r.header, file: f, frameBytes: r.frameBytes, hasCwd: r.hasCwd });
}
report.scan = {
  filesFound: files.length, filesScanned: Math.min(files.length, MAX_FILES === Infinity ? files.length : MAX_FILES),
  headersDecoded: headers.length, undecodable: undecodable.length, undecodableSample: undecodable.slice(0, 5),
  // 注意口径：这里统计的是**读取字节数**（每文件恰好一次 read(8192) ⇒ 计满一个 chunk），
  // 与「首帧实际大小」（maxFrameBytes，量级 10^2 B）不是一回事；两者都记录以便复核。
  totalBytesRead, readCalls,
  avgBytesPerFile: (headers.length + undecodable.length) === 0 ? 0 : Math.round(totalBytesRead / (headers.length + undecodable.length)),
  maxFrameBytes: headers.reduce((m, h) => Math.max(m, h.frameBytes), 0),
  idUniqueness: new Set(headers.map((h) => h.id)).size === headers.length,
  originHistogram: headers.reduce((acc, h) => { const k = String(h.origin); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {}),
  createdAtRange: headers.length === 0 ? null : [Math.min(...headers.map((h) => h.createdAt)), Math.max(...headers.map((h) => h.createdAt))],
};
info(`会话文件 ${report.scan.filesFound} 个；成功解出首帧 header ${report.scan.headersDecoded} 个；放弃 ${report.scan.undecodable} 个`);
info(`读取 ${report.scan.readCalls} 次 read(${CHUNK}) = ${totalBytesRead} B（每文件恰好 1 次、绝不追加）；最大首帧仅 ${report.scan.maxFrameBytes} B`);
info(`origin 直方图 ${JSON.stringify(report.scan.originHistogram)}；id 唯一性=${report.scan.idUniqueness}`);
// **首帧完整性自证**：所有成功解出的首帧都必须远小于 8KB chunk，否则「≤1 chunk」不成立
check('discipline', `所有首帧都在 1 个 8KB chunk 内完整（最大 ${report.scan.maxFrameBytes} B）`, report.scan.maxFrameBytes < CHUNK,
  `最大 ${report.scan.maxFrameBytes} B；chunk ${CHUNK} B；共计 ${report.scan.readCalls} 次 read，无任何追加读取`);
check('discipline', '首帧解码后恰好「一行 header + 尾换行」（与 live 源码 assertZstdHeaderFrame 同断言）',
  report.scan.undecodable === 0 || report.scan.headersDecoded > 0,
  `放弃 ${report.scan.undecodable} 条（如实记录，未追加读取）`);
check('discipline', '字段白名单：每会话只取 id/createdAt/origin/parentSession（+cwd 的存在性布尔），不解析对话内容',
  headers.every((h) => Object.keys(h).filter((k) => !['file', 'frameBytes', 'hasCwd'].includes(k))
    .every((k) => ['id', 'createdAt', 'origin', 'parentSession'].includes(k))),
  `字段白名单断言；cwd 只以布尔形式参与（复刻 live 的 meta.cwd===undefined 过滤），路径本身不落盘`);

if (SCAN_ONLY) {
  report.outcome = bad === 0 ? 'PASS(scan-only)' : 'FAIL';
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`\n[verdict] ${report.outcome}  → ${REPORT}`);
  process.exit(bad === 0 ? 0 : 2);
}

// ---------------------------------------------------------------------------
// 3) 离线判据：期望集合 == 「(updatedAt ?? createdAt) 降序 + id 升序」的前 MAX
// ---------------------------------------------------------------------------
console.log('\n=== 2) 离线集合等式（真 oracle 数据 + 真比较器 + 真 MAX 常量） ===');
const CMP_FIXED = (a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt) || (a.id < b.id ? -1 : 1);
const CMP_LEGACY = (a, b) => b.updatedAt - a.updatedAt;
/** 真 MAX 常量（从候选件切出表达式求值，不手抄）。 */
function realMax(override) {
  const src = require('node:fs').readFileSync(join(HERE, 'dryrun', 'index.js'), 'utf8');
  const at = src.indexOf('const SUBAGENT_LIST_MAX = Number.isFinite(');
  const end = src.indexOf(';', src.indexOf('  : 200', at));
  const expr = src.slice(at + 'const SUBAGENT_LIST_MAX = '.length, end);
  const prev = globalThis.__DSH_SUBAGENT_LIST_MAX;
  if (override === undefined) delete globalThis.__DSH_SUBAGENT_LIST_MAX; else globalThis.__DSH_SUBAGENT_LIST_MAX = override;
  try { return new Function(`return (${expr});`)(); }
  finally { if (prev === undefined) delete globalThis.__DSH_SUBAGENT_LIST_MAX; else globalThis.__DSH_SUBAGENT_LIST_MAX = prev; }
}
const MAX = realMax(undefined);
const subsAll = headers.filter((h) => h.origin === 'subagent');
/** live 冷候选池 = `coldSource.filter(origin === 'subagent').sort(cmp).slice(0, MAX)`。
 *  ⚠️ `cold` 的 filter 还要求 `meta.cwd !== undefined`（**本档实跑踩到的 oracle 坑**：
 *  漏掉该条件会多留一批无 cwd 的旧会话 ⇒ 活体集合等式假失败）。此处按 live 语义过滤。 */
const subs = subsAll.filter((h) => h.hasCwd === true);
const subsNoCwd = subsAll.filter((h) => h.hasCwd !== true);
const tops = headers.filter((h) => h.origin !== 'subagent');
info(`oracle 中顶层 ${tops.length} 条 / subagent ${subsAll.length} 条（其中 cwd 缺失被 live 冷 filter 剔除 ${subsNoCwd.length} 条）⇒ 候选池 ${subs.length} 条；真 MAX = ${MAX}`);

/** 三种枚举序（模拟 readdir 顺序差异）+ 两代比较器 ⇒ 入选集合。
 *  ⚠️ harness 坑（本档实跑踩到）：`(i * k) % n` 只有在 `gcd(k, n) === 1` 时才是**置换**；
 *  782 条 subagent 与步长 7 不互素 ⇒ 该式会**重复**索引并丢掉一部分元素（数组还会变短）。
 *  因此此处改用**确定性 Fisher–Yates**（种子固定）产生真置换，并断言每个置换元素集合==全量集合。 */
function seededPermutation(arr, seed) {
  const out = [...arr];
  let s = seed >>> 0;
  const next = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const perms = {
  asScanned: (a) => [...a],
  reversed: (a) => [...a].reverse(),
  shuffled: (a) => seededPermutation(a, 0x9e3779b9),
};
const setsOf = (cmp) => Object.fromEntries(Object.entries(perms).map(([n, p]) => [n, p(subs).sort(cmp).slice(0, MAX).map((h) => h.id)]));
const fixedSets = setsOf(CMP_FIXED);
const legacySets = setsOf(CMP_LEGACY);
const expectFixed = [...subs].sort(CMP_FIXED).slice(0, MAX).map((h) => h.id);
const expectLegacy = legacySets.asScanned;
/**
 * 集合种类数（**顺序无关**）。
 * ⚠️ harness 坑（本档实跑踩到）：若对排序后的数组直接 `new Set(arr.join(','))` 去重，
 * 得到的是「不同**序列**数」而不是「不同**集合**数」——会把同一集合的不同顺序误算成多种，
 * 从而**假报**「入选集合与枚举序有关」。必须按元素多重集比较（本函数）。
 */
const distinctSets = (arrs) => {
  const seen = new Set();
  for (const arr of arrs) seen.add([...arr].sort().join('\u0000'));
  return seen.size;
};
const uniq = distinctSets;
// 置换自证：每个枚举序都必须是**真置换**（同一元素多重集），否则集合对拍无意义
{
  const allIds = subs.map((h) => h.id).sort().join(',');
  const permOk = Object.values(perms).every((p) => p(subs).map((h) => h.id).sort().join(',') === allIds);
  check('offline', '三种枚举序都是**真置换**（同多重集、无重复丢失；步长法与 n 不互素会破坏该前提）', permOk,
    `subs=${subs.length} 条；置换后元素多重集一致`);
}
report.offline = {
  max: MAX, topCount: tops.length, subCount: subs.length, subCountAll: subsAll.length, subCountNoCwd: subsNoCwd.length,
  fixedKinds: uniq(Object.values(fixedSets)), legacyKinds: uniq(Object.values(legacySets)),
  fixedOrderKinds: new Set(Object.values(fixedSets).map((s) => s.join(','))).size,
  legacyOrderKinds: new Set(Object.values(legacySets).map((s) => s.join(','))).size,
  fixedSets: Object.fromEntries(Object.entries(fixedSets).map(([k, v]) => [k, v.slice(0, 8)])),
  legacySets: Object.fromEntries(Object.entries(legacySets).map(([k, v]) => [k, v.slice(0, 8)])),
  expectedSize: expectFixed.length,
  truncated: subs.length > MAX,
  legacyExpectedSize: expectLegacy.length,
  /** 两代比较器给出的入选集合是否相同（若不同，则 A6 活体等式对「是否已修订」有区分力） */
  legacyVsFixedSameSet: distinctSets([expectLegacy]) === distinctSets([expectFixed]),
  legacyVsFixedSameOrder: expectLegacy.join(',') === expectFixed.join(','),
};
info(`修订后比较器：三种枚举序得到 ${report.offline.fixedKinds} 种入选集合（=1 即与枚举序无关）`);
info(`修订前比较器：三种枚举序得到 ${report.offline.legacyKinds} 种入选集合（>1 即名额取决于枚举序）`);
check('offline', '修订后比较器：入选集合与枚举序无关（三种枚举序同集合）', report.offline.fixedKinds === 1,
  `${report.offline.fixedKinds} 种`);
check('offline', '期望集合 == 「(updatedAt ?? createdAt) 降序 + id 升序」前 MAX（集合等式，真判据）',
  Object.values(fixedSets).every((s) => s.join(',') === expectFixed.join(',')),
  `expected=${expectFixed.length} 条；subs=${subs.length}；是否发生截断=${report.offline.truncated}`);
check('offline', '修订前比较器在冷 header 上返回 NaN（键不成立 ⇒ 退化为枚举序）',
  Number.isNaN(CMP_LEGACY(subs[0], subs[1])) || subs.length < 2, `b.updatedAt - a.updatedAt = NaN`);
// 单调性（审计 §4.4-5）：入选里最旧 >= 落选里最新
if (subs.length > MAX) {
  const keptSet = new Set(expectFixed);
  const dropped = subs.filter((h) => !keptSet.has(h.id));
  const retainedOldest = Math.min(...expectFixed.map((id) => subs.find((h) => h.id === id).createdAt));
  const droppedNewest = Math.max(...dropped.map((h) => h.createdAt));
  check('offline', '边界单调性：入选集合里最旧的 createdAt >= 落选者里最新的 createdAt', retainedOldest >= droppedNewest,
    `oldest-kept=${retainedOldest} newest-dropped=${droppedNewest}`);
} else {
  check('offline', `边界单调性：真空成立（oracle 内 subagent ${subs.length} <= MAX ${MAX} ⇒ 无落选者）`, true, '未发生截断');
}

// ---------------------------------------------------------------------------
// 4) 活体集合等式（需宿主在线）—— 不可达则**明确记 INCONCLUSIVE**，不用确定性冒充
// ---------------------------------------------------------------------------
console.log('\n=== 3) 活体集合等式（POST /api/session.list） ===');
async function post(body) {
  const res = await fetch(`${BASE_URL}/api/${body.method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: `b1-cold-${Date.now()}`, ...body }),
    signal: AbortSignal.timeout(15000),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
try {
  const r1 = await post({ method: 'session.list', payload: {} });
  if (r1.status !== 200) throw new Error(`HTTP ${r1.status}`);
  const rows = r1.json?.result?.value?.items ?? [];
  const liveSubs = new Set(rows.filter((x) => x.origin === 'subagent').map((x) => x.sessionId));
  const liveTops = rows.filter((x) => x.origin !== 'subagent').map((x) => x.sessionId);
  const r2 = await post({ method: 'session.list', payload: {} });
  const rows2 = r2.json?.result?.value?.items ?? [];
  const liveSubs2 = new Set(rows2.filter((x) => x.origin === 'subagent').map((x) => x.sessionId));
  const setEq = (a, bArr) => a.size === bArr.length && bArr.every((id) => a.has(id));
  const matchesFixed = setEq(liveSubs, expectFixed);
  const matchesLegacy = setEq(liveSubs, expectLegacy);
  report.live = {
    reachable: true, httpStatus: r1.status, rows: rows.length, topRows: liveTops.length,
    subRows: liveSubs.size, secondCallSubRows: liveSubs2.size,
    matchesFixedExpectation: matchesFixed, matchesLegacyExpectation: matchesLegacy,
    /** 宿主进程加载的是**启动时**的字节：写入新产物后必须**重启**才会呈现出 fixed 语义。 */
    hostCodeState: matchesFixed ? 'fixed(v2)' : matchesLegacy ? 'legacy(v1) —— 尚未部署或尚未重启' : 'neither（见下方差异）',
  };
  check('live', 'A0：session.list HTTP 200', r1.status === 200, `HTTP ${r1.status}`);
  // 判据分级：写入 v2 产物**之后**仍需一次重启才会呈现 fixed 语义。
  //   - 未加 --expect-deployed（部署前档）：比对结果**如记录**，失败只记 NOT-YET，不判 FAIL；
  //   - 加 --expect-deployed（重启后复验）：升格为硬断言，不匹配即 FAIL。
  if (EXPECT_DEPLOYED) {
    check('live', 'A6-live（post-restart 硬断言）：活体入选集合 == **v2 期望集合**', matchesFixed,
      `live=${liveSubs.size} expected=${expectFixed.length}；宿主码态=${report.live.hostCodeState}`);
  } else {
    check('live', `A6-live [INFO，非 FAIL]：活体入选集合 == v2 期望集合 = ${matchesFixed}；宿主当前码态 = ${report.live.hostCodeState}`,
      true, `live=${liveSubs.size} 条 vs expected=${expectFixed.length} 条；匹配 legacy 期望=${matchesLegacy}；`
        + `部署前该式**必然**不成立（宿主进程加载的是启动时的 v1 字节），写入 v2 后需重启并加 --expect-deployed 复验`);
  }
  check('live', '弱判据（**单独不构成通过**，审计 §4.4）：连续两次调用入选集合相同',
    liveSubs.size === liveSubs2.size && [...liveSubs].every((id) => liveSubs2.has(id)),
    '该断言在修订前也恒真 ⇒ 只能作辅助，不得冒充集合等式');
  report.liveDifference = {
    inLiveNotExpected: [...liveSubs].filter((id) => !new Set(expectFixed).has(id)).slice(0, 5),
    inExpectedNotLive: expectFixed.filter((id) => !liveSubs.has(id)).slice(0, 5),
  };
} catch (e) {
  report.live = { reachable: false, error: String(e.message) };
  info(`活体不可达（${e.message}）⇒ A6-live 记 **INCONCLUSIVE**（不得用确定性断言冒充通过）`);
}
{
  // 判据分级（审计 §4.4 的硬要求）：确定性/活体不可达 ⇒ A6 记 INCONCLUSIVE，不许冒充
  const liveFixed = report.live?.reachable === true && report.live.matchesFixedExpectation === true;
  report.a6Verdict = liveFixed ? 'PASS' : 'INCONCLUSIVE';
  report.a6Reason = liveFixed
    ? '活体入选集合与 v2 期望集合逐元素相等'
    : (report.live?.reachable
      ? `宿主当前码态 = ${report.live.hostCodeState}（写入 v2 产物后需**重启**才能呈现 fixed 语义；离线集合等式已 PASS，活体项待重启后复验）`
      : `活体端点不可达：${report.live?.error ?? 'unknown'}`);
}
report.failures = bad;
report.outcome = bad !== 0 ? 'FAIL'
  : report.a6Verdict === 'PASS' ? 'PASS'
  : 'PASS(offline A6; live A6 INCONCLUSIVE — 需重启后加 --expect-deployed 复验)';
mkdirSync(dirname(REPORT), { recursive: true });
writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`\n[verdict] ${report.outcome}  离线失败 ${bad} 项 / 共 ${report.checks.length} 项；A6 活体判定=${report.a6Verdict}  → ${REPORT}`);
process.exit(bad === 0 ? 0 : 2);
