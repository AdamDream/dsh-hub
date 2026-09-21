'use strict';
/**
 * B1 执行前审计 —— 锚点命中计数与**精确字节形态**探针 v2（**只读**）。
 *
 * v1 教训（本次实跑产出）：审计者手写的缩进假设不可信 ——
 *   - `B2b-keep-slice` 在 types/api-proxy.js 里根本不是 8 空格（B1 变换的 `indenter` 对非 TAB 排版
 *     按 pad(2)=2 空格落块），硬编码 8 空格 → 0 命中；
 *   - 裸比较器片段 `(a, b) => b.updatedAt - a.updatedAt` 在**同一文件内出现两次**（冷候选 + 收口），
 *     而按「行首缩进 + .sort」硬编码只命中 1 次 —— 说明**行锚点必须带足以区分的上下文**。
 * v2 因此改为：只给「内容特征串」，行首空白由**被读文件本身**给出（逐命中导出），
 * 命中数即真相；再据此判定该锚点能否作为**恰好命中一次**的替换锚点。
 *
 * 不写产品文件、不重启、不联网。
 */
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const LIVE = '/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-host-apiproxy/lib';
const OUT = __dirname;

const TARGETS = [
  { key: 'index.js', role: '宿主实际加载（package.json main 指向）', path: join(LIVE, 'index.js'),
    pin: '1b9915f505996912c6f49b12b0c3f4a8261a74f26422f68f5d22cab2bc078a62' },
  { key: 'types/api-proxy.js', role: '同源独立构建（main 不指向它）', path: join(LIVE, 'types/api-proxy.js'),
    pin: 'f5c34a439043b9d5771286a76c8b16210951c25d7d5873b168bcc947720eac0d' },
];

/** 出现次数（非行数）。 */
function count(text, lit) {
  let n = 0;
  for (let i = text.indexOf(lit); i !== -1; i = text.indexOf(lit, i + lit.length)) n += 1;
  return n;
}

/** 把一次命中还原为「整行原文 + 行首空白可视化 + 行列号 + 字节偏移」。 */
function describeHit(text, lit, at) {
  const lineStart = text.lastIndexOf('\n', at) + 1;
  const lineEnd = text.indexOf('\n', at + lit.length - 1) === -1 ? text.length : text.indexOf('\n', at + lit.length - 1);
  const line = text.slice(lineStart, lineEnd);
  const lead = (line.match(/^[ \t]*/) ?? [''])[0];
  const lineNo = text.slice(0, at).split('\n').length;
  return {
    byteOffset: at,
    line: lineNo,
    leadWhitespaceEscaped: lead.replace(/\t/g, '\\t').replace(/ /g, '·'),
    leadTabs: (lead.match(/\t/g) ?? []).length,
    leadSpaces: (lead.match(/ /g) ?? []).length,
    fullLineJson: line,
    spansWholeLine: line.trim() === text.slice(at, at + lit.length).trim() && lead.length + text.slice(at, at + lit.length).length === line.length,
  };
}

/**
 * 锚点清单：`lit` 是**内容特征串（不含行首缩进）**，`expect` 是本审计要求的命中数。
 * `role` 说明该锚点用于哪一处改动。
 */
const ANCHORS = [
  // ---------- B① 冷路径排序键 ----------
  { id: 'B1a-comparator-bare', expect: 2, role: '裸比较器（**撞车证据**：冷候选 + 收口各一次）',
    lit: '(a, b) => b.updatedAt - a.updatedAt' },
  { id: 'B1a-cold-candidates-stmt', expect: 1, role: 'B① 替换锚点（4 行整语句，含 coldSource 唯一上下文）',
    lit: 'const coldSubagentCandidates = coldSource' },
  { id: 'B1a-cold-filter-continuation', expect: 1, role: 'B① 替换锚点内层（用于核对未误伤）',
    lit: '.filter((meta) => meta.origin ===' },
  { id: 'B1a-collector-sort', expect: 1, role: '收口排序（**本次不改**，但必须证明 B1a 锚点不误伤它）',
    lit: 'items.sort((a, b) => b.updatedAt - a.updatedAt);' },

  // ---------- B② running 计数：childrenOf 来源 ----------
  { id: 'B2-signature', expect: 1, role: '聚合函数签名（已含 ctx 形参）',
    lit: 'function annotateRunningSubagentCounts(ctx, items) {' },
  { id: 'B2-call-site', expect: 1, role: '调用点（收口之后调用）',
    lit: 'return annotateRunningSubagentCounts(ctx, retained);' },
  { id: 'B2-childrenOf-from-items', expect: 1, role: 'B② 替换锚点（核心缺陷行）',
    lit: 'const childrenOf = new Map();' },
  { id: 'B2-edge-parent-from-item', expect: 1, role: 'B② 替换锚点内层（缺陷来源：由已截断行取 parentSessionId）',
    lit: 'const parentId = item.parentSessionId;' },
  { id: 'B2-live-status-loop', expect: 1, role: 'B② 替换锚点尾部（同一趟改由 live 表构建两边）',
    lit: 'for (const session of ctx.sessions.list()) liveStatus.set(session.id,' },
  { id: 'B2-doc-truncated-claim', expect: 1, role: 'B② 文档需同步（现称“在截断之后的行上计算”）',
    lit: '状态点不再依赖被截断的 subagent 行（消费方 C1）。' },
  { id: 'B2-doc-param-items', expect: 1, role: 'B② 文档需同步（@param items 说明）',
    lit: '@param items - listVisibleSessionSummaries 产出的行（已排序、已截断）。' },
  { id: 'B2-doc-cost-line', expect: 1, role: 'B② 文档需同步（成本描述）',
    lit: '成本：只遍历本次已产出的行 + live agent 表，无新增投影/读盘。' },

  // ---------- B② 可选：keep-set / 收口 running 豁免 ----------
  { id: 'B2b-keep-slice', expect: 1, role: '可选改动：attached keep-set（无 running 豁免）',
    lit: 'for (const session of attachedSubagents.slice(0, SUBAGENT_LIST_MAX)) keep.add(session.id);' },
  { id: 'B2b-overflow-slice', expect: 1, role: '可选改动：收口 overflow',
    lit: 'const overflow = subagentItems.slice(SUBAGENT_LIST_MAX);' },

  // ---------- 既有标记 ----------
  { id: 'MARK-SUBAGENT-MAX', expect: 1, role: 'verifyServerFilter 口径', lit: '/* dsh-lag-fix B1: subagent 会话下发上限 */' },
  { id: 'MARK-RUNNING-COUNT', expect: 2, role: 'verifyServerFilter 口径（定义处 + sessionListFields 返回体）', lit: '/* dsh-lag-fix B1: 聚合字段 runningSubagentCount */' },
  { id: 'MARK-FILTER', expect: 1, role: 'verifyServerFilter 口径', lit: '/* dsh-lag-fix B1: 顶层全发 + subagent 最近 N 条 */' },

  // ---------- 冷路径 meta 字段（B① 策略 A2 需要核实的字段是否存在） ----------
  { id: 'cold-meta-origin-filter', expect: 1, role: '冷候选 origin 过滤（证明冷 meta 带 origin）',
    lit: ".filter((meta) => meta.origin ===" },

  // ---------- 注释锚点（修订必须同步的文档行；遗留假陈述 = 代码说谎） ----------
  { id: 'CMT-cold-ish-recent', expect: 1, role: 'B① 必须改写的注释（现称"最近"，实为枚举序）',
    lit: '// 冷会话同源分流：顶层 id 一条不少；subagent 只保留「最近 SUBAGENT_LIST_MAX 条」作为候选，' },
  { id: 'CMT-cold-cut-reason', expect: 1, role: 'B① 注释块第二行（保留，作为改写锚点上下文）',
    lit: '// 其余在下面的 filter 中直接剔除，避免为它们做投影与冷读（本次削峰的主路径）。' },
];


const report = { generatedAt: new Date().toISOString(), targets: [], anchors: [], notes: [] };

for (const t of TARGETS) {
  const buf = readFileSync(t.path);
  const text = buf.toString('utf8');
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== t.pin) {
    console.error(`pin 不符：${t.path}\n  expected ${t.pin}\n  actual   ${sha}`);
    process.exit(1);
  }
  const lines = text.split('\n');
  report.targets.push({
    ...t, sha256: sha, pinOk: true, bytes: buf.length, lines: lines.length,
    crlf: text.includes('\r\n'), tabLeadLines: lines.filter((l) => /^\t/.test(l)).length,
    spaceLeadLines: lines.filter((l) => /^ /.test(l)).length,
    doubleQuoteCount: count(text, '"'), singleQuoteCount: count(text, "'"),
    void0Count: count(text, 'void 0'), undefinedCount: count(text, 'undefined'),
  });
}

for (const t of TARGETS) {
  const text = readFileSync(t.path, 'utf8');
  for (const a of ANCHORS) {
    const hits = [];
    for (let i = text.indexOf(a.lit); i !== -1; i = text.indexOf(a.lit, i + a.lit.length)) hits.push(describeHit(text, a.lit, i));
    report.anchors.push({
      id: a.id, role: a.role, file: t.key, expect: a.expect, actual: hits.length,
      ok: hits.length === a.expect, hitCount: hits.length, hits,
    });
  }
}

// 「插入块自由标识符」扫描：证明 2026-09-20 的 `ctx is not defined` 这类未声明标识符可被文本级校验捕获。
function freeRoots(block, declared) {
  const stripped = block
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
  const kw = new Set(['const', 'let', 'var', 'for', 'of', 'in', 'if', 'else', 'return', 'continue', 'break',
    'while', 'function', 'new', 'typeof', 'void', 'this', 'true', 'false', 'null', 'undefined', 'throw', 'try', 'catch', 'finally', 'do', 'switch', 'case', 'default', 'await', 'async', 'delete', 'instanceof', 'yield', 'class', 'extends', 'super']);
  const roots = new Set();
  const local = new Set(declared);
  // 收集本块内的声明名（const/let/var/形参）
  for (const m of stripped.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) local.add(m[1]);
  for (const m of stripped.matchAll(/function\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g)) for (const p of m[1].split(',')) local.add(p.trim());
  for (const m of stripped.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) local.add(m[1]);
  for (const m of stripped.matchAll(/\b([A-Za-z_$][\w$]*)\s*=>/g)) local.add(m[1]);
  for (const m of stripped.matchAll(/\(([^()]*)\)\s*=>/g)) for (const p of m[1].split(',')) local.add(p.trim());
  for (const m of stripped.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)/g)) {
    const name = m[1];
    if (kw.has(name) || local.has(name)) continue;
    roots.add(name);
  }
  return [...roots].sort();
}

for (const t of TARGETS) {
  const text = readFileSync(t.path, 'utf8');
  const start = text.indexOf('function annotateRunningSubagentCounts(');
  const end = text.indexOf('function sessionListFields(', start);
  const body = text.slice(start, end);
  const sig = body.slice(0, body.indexOf('{'));
  const params = sig.slice(sig.indexOf('(') + 1, sig.lastIndexOf(')')).split(',').map((s) => s.trim()).filter(Boolean);
  const roots = freeRoots(body, params);
  // 事故复现：把签名改成 (items) 后，ctx 是否变成「未声明标识符」
  const mutated = body.replace('function annotateRunningSubagentCounts(ctx, items)', 'function annotateRunningSubagentCounts(items)');
  const mutatedParams = ['items'];
  const mutatedRoots = freeRoots(mutated, mutatedParams);
  report.notes.push({
    file: t.key,
    annotateSignature: sig.trim(),
    params,
    bodyBytes: body.length,
    freeRootsWithCtx: roots,
    freeRootsAfterRemovingCtxParam: mutatedRoots,
    undeclaredAfterMutation: mutatedRoots.filter((r) => r === 'ctx'),
    mutatedIsCaught: mutatedRoots.includes('ctx'),
  });
}

writeFileSync(join(OUT, 'results-anchor-probe-v2.json'), JSON.stringify(report, null, 2));

const bad = report.anchors.filter((a) => !a.ok);
console.log('=== targets ===');
for (const t of report.targets) console.log(`${t.key}: ${t.sha256.slice(0, 16)}… ${t.bytes}B ${t.lines}行 tabLead=${t.tabLeadLines} spaceLead=${t.spaceLeadLines} void0=${t.void0Count} undefined=${t.undefinedCount} dq=${t.doubleQuoteCount} sq=${t.singleQuoteCount}`);
console.log('=== anchors ===');
for (const a of report.anchors) console.log(`${a.ok ? 'OK ' : 'BAD'} ${a.file} ${a.id} 期望${a.expect} 实得${a.actual}${a.actual === 1 ? ` @${a.hits[0].byteOffset} L${a.hits[0].line} lead="${a.hits[0].leadWhitespaceEscaped}"` : ''}`);
console.log('=== 未声明标识符防复发自证 ===');
for (const n of report.notes) console.log(`${n.file}: params=[${n.params}] 变异后含 ctx=${n.mutatedIsCaught} (捕获到未声明 ctx: ${JSON.stringify(n.undeclaredAfterMutation)})`);
console.log(`failures=${bad.length}`);
process.exit(bad.length === 0 ? 0 : 2);
