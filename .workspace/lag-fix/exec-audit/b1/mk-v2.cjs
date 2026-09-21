'use strict';
/**
 * mk-v2.cjs — 生成「B1-fix2」回放规格候选（B1-transform.v2-candidate.cjs）。
 *
 * 做法：读取现有 patches/B1-transform.cjs 的源文本，按**行区间**替换三处模板：
 *   (1) aggBody 数组：血缘边改由 ctx.sessions.list() 构建（与 running 状态同一趟）；
 *   (2) aggBody 的 jsdoc：去掉"在截断之后的行上计算"这一即将失效的表述；
 *   (3) coldStmtLines：注释改为实际排序键 + 比较器显式回落 createdAt + id tiebreak。
 * 最后重写 verifyServerFilter（追加本轮防复发断言）。
 *
 * 产物只写本审计目录；不改 patches/ 下任何文件。
 */
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const SRC = join(__dirname, '..', '..', 'patches', 'B1-transform.cjs');
const DST = join(__dirname, 'B1-transform.v2-candidate.cjs');

let s = readFileSync(SRC, 'utf8');
const before = s.length;

/** 用行区间替换：从 `from` 行（含）到 `to` 行（含）换成 replacement（字符串数组）。 */
function replaceRegion(text, fromLine, toLine, replacement, label) {
  const lines = text.split('\n');
  const a = lines.findIndex((l) => l === fromLine);
  if (a === -1) throw new Error(`[${label}] 起始行未找到：${fromLine}`);
  if (lines.indexOf(fromLine, a + 1) !== -1) throw new Error(`[${label}] 起始行非唯一`);
  const b = lines.findIndex((l, i) => i >= a && l === toLine);
  if (b === -1) throw new Error(`[${label}] 结束行未找到：${toLine}`);
  return [...lines.slice(0, a), ...replacement, ...lines.slice(b + 1)].join('\n');
}

// ---- (1)+(2) aggBody：整块重写（含 jsdoc） ----
const newAggBody = [
  '  const aggBody = [',
  '    MARK_RUNNING_COUNT,',
  "    '/**',",
  "    ' * 为**顶层**会话补 runningSubagentCount：沿「不间断 subagent 血缘链」统计其 running 后代，',",
  "    ' * 语义与客户端 indexSubagentDescendants(byId) 一致：血缘边与 running 状态**同源于 live 会话表**',",
  "    ' * （ctx.sessions.list() 的一趟遍历），因此行是否被截断都不影响计数（消费方 C1）。',",
  "    ' * 边界：中间层 subagent 行未下发时仍沿 live 血缘计入 —— 客户端 byId 兜底值可能更小，消费方必须优先采用本字段。',",
  "    ' * 成本：一次 live 会话表遍历（与 running 状态合并同一趟），无新增投影/读盘。',",
  "    ' * @param items - listVisibleSessionSummaries 产出的行（已排序、已截断）；仅用于**确定标注哪些顶层行**，不再参与建边。',",
  "    ' * @returns 同一数组（原对象上补字段）。',",
  "    ' */',",
  "    'function annotateRunningSubagentCounts(ctx, items) {',",
  "    `${u}const liveSessions = ctx.sessions.list();`,",
  "    `${u}const childrenOf = new Map();`,",
  "    `${u}const liveStatus = new Map();`,",
  "    `${u}for (const session of liveSessions) {`,",
  "    `${u}${u}liveStatus.set(session.id, ctx.agents.get(session.id)?.status === ${lit('running')});`,",
  "    `${u}${u}const parentId = session.header.parentSession;`,",
  "    `${u}${u}if (parentId === void 0) continue;`,",
  "    `${u}${u}const bucket = childrenOf.get(parentId);`,",
  "    `${u}${u}if (bucket === void 0) childrenOf.set(parentId, [session.id]);`,",
  "    `${u}${u}else bucket.push(session.id);`,",
  "    `${u}}`,",
  "    `${u}for (const item of items) {`,",
  "    `${u}${u}if (item.origin === ${lit('subagent')}) continue;`,",
  "    `${u}${u}let count = 0;`,",
  "    `${u}${u}const seen = new Set([item.sessionId]);`,",
  "    `${u}${u}const queue = [item.sessionId];`,",
  "    `${u}${u}while (queue.length > 0) {`,",
  "    `${u}${u}${u}const next = childrenOf.get(queue.shift());`,",
  "    `${u}${u}${u}if (next === void 0) continue;`,",
  "    `${u}${u}${u}for (const childId of next) {`,",
  "    `${u}${u}${u}${u}if (seen.has(childId)) continue;`,",
  "    `${u}${u}${u}${u}seen.add(childId);`,",
  "    `${u}${u}${u}${u}if (liveStatus.get(childId) === true) count += 1;`,",
  "    `${u}${u}${u}${u}queue.push(childId);`,",
  "    `${u}${u}${u}}`,",
  "    `${u}${u}}`,",
  "    `${u}${u}item.${COUNT_FIELD} = count;`,",
  "    `${u}}`,",
  "    `${u}return items;`,",
  "    '}',",
  "  ].join('\\n');",
];
s = replaceRegion(s, '  const aggBody = [', "  ].join('\\n');", newAggBody, 'aggBody');

// ---- (3) coldStmtLines：注释 + 比较器 ----
const newColdStmt = [
  '  const coldStmtLines = (indentStr) =>',
  '    [',
  '      `  // 冷会话同源分流：顶层 id 一条不少；subagent 只保留「createdAt 最近 SUBAGENT_LIST_MAX 条」作为候选，`,',
  '      `  // 冷 header 没有 updatedAt：比较器显式回落 createdAt（并以 id 升序 tiebreak），避免 NaN 让排序退化为目录枚举序；`,',
  '      `  // 其余在下面的 filter 中直接剔除，避免为它们做投影与冷读（本次削峰的主路径）。`,',
  '      `  const coldSource = (await persistence.list(signal));`,',
  '      `  const coldSubagentCandidates = coldSource`,',
  "      `    .filter((meta) => meta.origin === ${lit('subagent')})`,",
  '      `    .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt) || (a.id < b.id ? -1 : 1))`,',
  '      `    .slice(0, SUBAGENT_LIST_MAX);`,',
  '      `  const coldSubagentIds = new Set(coldSubagentCandidates.map((meta) => meta.id));`,',
  '      `  let coldSubagentSeen = 0;`,',
  '      `  const cold = coldSource.filter((meta) => {`,',
  '      `    if (attached.has(meta.id) || meta.cwd === void 0) return false;`,',
  "      `    if (meta.origin !== ${lit('subagent')}) return true;`,",
  '      `    if (!coldSubagentIds.has(meta.id)) return false;`,',
  '      `    coldSubagentSeen += 1;`,',
  '      `    return coldSubagentSeen <= SUBAGENT_LIST_MAX;`,',
  '      `  });`,',
  '    ]',
  '      .map((line) => indentStr + line.slice(2))',
  "      .join('\\n');",
];
{
  const lines = s.split('\n');
  const a = lines.findIndex((l) => l.trim().startsWith('const coldStmtLines = '));
  if (a === -1) throw new Error('coldStmtLines 未找到');
  const b = lines.findIndex((l, i) => i > a && l.includes(".join('\\n');"));
  if (b === -1) throw new Error('coldStmtLines 结束未找到');
  s = [...lines.slice(0, a), ...newColdStmt, ...lines.slice(b + 1)].join('\n');
}

// ---- (4) verifyServerFilter：追加本轮防复发断言 ----
const newVerify = [
  "/** 大括号配平切片（跳过字符串/模板/注释），用于对聚合函数体做「自由标识符」扫描。 */",
  "function sliceBody(text, signatureAt) {",
  "  const braceAt = text.indexOf('{', signatureAt);",
  "  let depth = 0;",
  "  for (let i = braceAt; i < text.length; i += 1) {",
  "    const c = text[i];",
  "    if (c === '\"' || c === \"'\" || c === '`') {",
  "      const q = c;",
  "      i += 1;",
  "      while (i < text.length) {",
  "        if (text[i] === '\\\\') { i += 2; continue; }",
  "        if (text[i] === q) break;",
  "        i += 1;",
  "      }",
  "      continue;",
  "    }",
  "    if (c === '/' && text[i + 1] === '/') { i = text.indexOf('\\n', i); if (i < 0) break; continue; }",
  "    if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2); if (i < 0) break; i += 1; continue; }",
  "    if (c === '{') depth += 1;",
  "    else if (c === '}') { depth -= 1; if (depth === 0) return text.slice(signatureAt, i + 1); }",
  "  }",
  "  throw new Error('聚合函数体未配平');",
  "}",
  "/** 语言内建/宿主全局白名单：出现这些名字不视为「未声明标识符」。 */",
  "const GLOBAL_ROOTS = new Set(['Map', 'Set', 'Number', 'Math', 'Object', 'Array', 'String', 'Boolean', 'JSON',",
  "  'globalThis', 'Date', 'Reflect', 'Symbol', 'Promise', 'Error', 'TypeError', 'RangeError', 'ReferenceError',",
  "  'WeakMap', 'WeakSet', 'RegExp', 'Intl', 'BigInt', 'NaN', 'Infinity', 'undefined', 'isFinite', 'parseInt', 'queueMicrotask', 'structuredClone']);",
  "/**",
  " * 扫出块内「自由标识符根」：`a.b` 只算 a、跳过属性名；关键字/字面量/本块声明（含形参）不计。",
  " * 目的：捕获 2026-09-20 的 `ctx is not defined` 一类**未声明标识符** —— `node --check` 只验语法，查不出它。",
  " */",
  "function freeIdentifierRoots(body, declared) {",
  "  const stripped = body",
  "    .replace(/\\/\\*[\\s\\S]*?\\*\\//g, ' ')",
  "    .replace(/\\/\\/[^\\n]*/g, ' ')",
  "    .replace(/'(?:[^'\\\\]|\\\\.)*'/g, \"''\")",
  "    .replace(/\"(?:[^\"\\\\]|\\\\.)*\"/g, '\"\"');",
  "  const local = new Set(declared);",
  "  const KW = new Set(['const', 'let', 'var', 'for', 'of', 'in', 'if', 'else', 'return', 'continue', 'break',",
  "    'while', 'new', 'true', 'false', 'null', 'void', 'function', 'typeof', 'this', 'do', 'switch', 'case', 'default', 'await', 'async', 'delete', 'instanceof', 'yield', 'throw', 'try', 'catch', 'finally']);",
  "  for (const m of stripped.matchAll(/\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)/g)) local.add(m[1]);",
  "  for (const m of stripped.matchAll(/\\bfor\\s*\\(\\s*(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)/g)) local.add(m[1]);",
  "  const roots = new Set();",
  "  for (const m of stripped.matchAll(/(?:^|[^.\\w$])([A-Za-z_$][\\w$]*)/g)) {",
  "    const name = m[1];",
  "    if (KW.has(name) || local.has(name)) continue;",
  "    roots.add(name);",
  "  }",
  "  return [...roots].sort();",
  "}",
  "/** 变更后自校验（语法由 `node --check` 负责，这里查语义标记、旧锚点残留与本轮防复发不变量）。 */",
  "function verifyServerFilter(text) {",
  "  const failures = [];",
  "  for (const [literal, expected] of [",
  "    [MARK_SUBAGENT_MAX, 1],",
  "    [MARK_RUNNING_COUNT, 2],",
  "    [MARK_FILTER, 1],",
  "    ['function annotateRunningSubagentCounts(ctx, items) {', 1],",
  "    ['return annotateRunningSubagentCounts(ctx, retained);', 1],",
  "    ['const coldSubagentIds = new Set(cold', 1],",
  "    // ---- B1-fix2 新增：血缘边必须与 running 状态同源 ----",
  "    ['const liveSessions = ctx.sessions.list();', 1],",
  "    ['const parentId = session.header.parentSession;', 1],",
  "    ['const parentId = item.parentSessionId;', 0],",
  "    // ---- B1-fix2 新增：冷候选比较器必须显式回落，裸比较器只允许出现在收口排序 ----",
  "    ['(b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)', 1],",
  "    ['(a.id < b.id ? -1 : 1)', 1],",
  "    ['b.updatedAt - a.updatedAt', 1],",
  "  ]) {",
  "    const actual = countLiteral(text, literal);",
  "    if (actual !== expected) failures.push(`${literal}: 期望 ${expected} 实得 ${actual}`);",
  "  }",
  "  // 防复发（2026-09-20 生产事故）：该聚合函数是**模块级**函数，`ctx` 只存在于 createApiProxy 形参里。",
  "  // 任何「函数体引用 ctx、签名却没声明 ctx」的写法都会在运行时抛 ReferenceError 让 session.list 返 500。",
  "  if (/function annotateRunningSubagentCounts\\(items\\)/.test(text)) failures.push('聚合函数签名未声明 ctx（会抛 ReferenceError）');",
  "  if (/return annotateRunningSubagentCounts\\(retained\\)/.test(text)) failures.push('聚合函数调用点未传 ctx（会抛 ReferenceError）');",
  "  if (text.includes('ctx.sessions.list()') && !text.includes('annotateRunningSubagentCounts(ctx, items)')) {",
  "    failures.push('聚合函数体引用 ctx 但签名未接收 ctx');",
  "  }",
  "  // 防复发（通用口径）：「引入标识符必须在本文件内有声明」——覆盖 `ctx is not defined` 这类 node --check 查不出的错。",
  "  {",
  "    const at = text.indexOf('function annotateRunningSubagentCounts(');",
  "    if (at === -1) failures.push('聚合函数缺失');",
  "    else {",
  "      let body;",
  "      try { body = sliceBody(text, at); } catch (error) { failures.push(`聚合函数体切片失败：${error.message}`); }",
  "      if (body !== undefined) {",
  "        const sigEnd = body.indexOf('{');",
  "        const params = body.slice(body.indexOf('(') + 1, body.lastIndexOf(')', sigEnd)).split(',').map((p) => p.trim()).filter(Boolean);",
  "        if (params[0] !== 'ctx') failures.push(`聚合函数首形参不是 ctx（实得 ${params[0] ?? '无'}）`);",
  "        const fnName = body.slice('function '.length, body.indexOf('(')).trim();",
  "        const undeclared = freeIdentifierRoots(body, [...params, fnName]).filter((name) => !GLOBAL_ROOTS.has(name));",
  "        if (undeclared.length > 0) failures.push(`聚合函数体内出现**本文件未声明**的标识符：${undeclared.join(', ')}`);",
  "        // 调用点实参个数必须与形参个数一致，且首实参是 ctx",
  "        const call = text.match(/annotateRunningSubagentCounts\\(([^)]*)\\)(?=[^;]*;)/g) ?? [];",
  "        for (const c of call) {",
  "          const args = c.slice(c.indexOf('(') + 1, -1).split(',').map((a) => a.trim()).filter(Boolean);",
  "          if (args.length !== params.length || args[0] !== 'ctx') failures.push(`聚合函数调用点实参不匹配：${c}`);",
  "        }",
  "      }",
  "    }",
  "  }",
  "  if (text.includes('const items = ctx.sessions.list().map(summarizeAttached);')) failures.push('旧内存分支仍在（过滤未生效）');",
  "  if (!text.includes('coldSubagentIds.has(meta.id)') || !text.includes('coldSubagentSeen <= SUBAGENT_LIST_MAX')) {",
  "    failures.push('冷会话分支未按 coldSubagentIds 截断');",
  "  }",
  "  // 结构性自检交给脚本层的 `node --check`（ESM 上下文，权威）；此处只做旧锚点残留检查。",
  "  return failures;",
  "}",
];
{
  const lines = s.split('\n');
  const a = lines.findIndex((l) => l.startsWith('function verifyServerFilter(text) {'));
  if (a === -1) throw new Error('verifyServerFilter 未找到');
  // 逐行计数大括号，但**先清空字符串字面量**：本函数体内含 `'... {'` 这类字符串，
  // 直接数括号会永远回不到深度 0（本次实跑踩到的坑）。
  const bare = (line) => line.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/`(?:[^`\\]|\\.)*`/g, '``');
  let depth = 0; let b = -1;
  for (let i = a; i < lines.length; i += 1) {
    for (const ch of bare(lines[i])) { if (ch === '{') depth += 1; else if (ch === '}') depth -= 1; }
    if (depth === 0 && i > a) { b = i; break; }
  }
  if (b === -1) throw new Error('verifyServerFilter 结束未找到');
  s = [...lines.slice(0, a), ...newVerify, ...lines.slice(b + 1)].join('\n');
}

writeFileSync(DST, s);
console.log(`v2 候选已生成：${DST}\n  ${before} -> ${s.length} 字节`);

