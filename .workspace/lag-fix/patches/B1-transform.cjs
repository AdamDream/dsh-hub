'use strict';
/**
 * B1-transform.cjs — 单元 B1 服务端 session.list subagent 过滤（方案 B + 聚合字段）的纯文本变换。
 *
 * 为什么不用 `patch -p1` 上下文补丁：live 目标文件是**同一逻辑源的两种排版**——
 *   A. lib/index.js          打包入口（含 `//#region lib/types/api-proxy.js`），TAB 缩进、去尾逗号、
 *                            双引号、`void 0`；**宿主实际加载的是这一份**（见报告单元 B1-0）。
 *   B. lib/types/api-proxy.js 独立模块（main 不指向它），4 空格缩进、单引号、`undefined`。
 * 因此本补丁：每个锚点先做唯一性计数（`grep -c` 同口径），计数不符即拒绝应用；
 * 代码由源文件实测的缩进/引号风格生成，同一份变换对 A/B 均正确落地。
 *
 * 幂等：命中 MARK_* 即视作已应用（脚本层判定），applyServerFilter 自身也拒绝二次套用。
 */

const MARK_SUBAGENT_MAX = '/* dsh-lag-fix B1: subagent 会话下发上限 */';
const MARK_RUNNING_COUNT = '/* dsh-lag-fix B1: 聚合字段 runningSubagentCount */';
const MARK_FILTER = '/* dsh-lag-fix B1: 顶层全发 + subagent 最近 N 条 */';

/** 侧边栏「N 个子代理运行中」状态点消费的聚合字段名。 */
const COUNT_FIELD = 'runningSubagentCount';

/** 统计字面量出现次数（与 `grep -c` 同口径，但按出现次数而非行数）。 */
function countLiteral(text, literal) {
  let n = 0;
  let i = text.indexOf(literal);
  while (i !== -1) {
    n += 1;
    i = text.indexOf(literal, i + literal.length);
  }
  return n;
}

/** 锚点校验：期望命中数不符即抛出（调用方据此拒绝应用）。 */
function expectLiteral(text, literal, expected, label) {
  const actual = countLiteral(text, literal);
  if (actual !== expected) throw new Error(`锚点校验失败 [${label}]：期望命中 ${expected} 次，实得 ${actual} 次`);
  return actual;
}

/** 源文件的 `undefined` 书写风格（'undefined' 或 'void 0'，取出现更多者）。 */
function undefOf(text) {
  return countLiteral(text, 'void 0') > countLiteral(text, 'undefined') ? 'void 0' : 'undefined';
}

/** 源文件的字符串引号风格。 */
function quoteOf(text) {
  return countLiteral(text, '"running"') >= countLiteral(text, "'running'") ? '"' : "'";
}

/** 从源文件实测风格：缩进单位与字符串引号。 */
function styleOf(text) {
  const tab = (text.match(/^\t+/m) ?? [''])[0];
  const spaces = (text.match(/^ {2,}/m) ?? [''])[0];
  const unit = tab.length > 0 ? '\t' : spaces.length > 0 ? spaces : '    ';
  // live 有「源码排版（undefined/单引号/4 空格）」与「打包排版（void 0/双引号/TAB）」两种，
  // 所有锚点与生成代码都必须跟随源文件实测风格，否则会出现「同名锚点 0 命中」。
  return { unit, quote: quoteOf(text), hasTab: tab.length > 0, undef: undefOf(text) };
}

/**
 * 缩进生成器：入参是**模板块的字符缩进宽度**（本文件模板以 2 空格为一级）。
 * TAB 排版下换算为空白等价列宽（1 TAB ~ 2 列），因此 2 列 -> 1 TAB、4 列 -> 2 TAB。
 */
function indenter(style) {
  return (width) =>
    style.hasTab ? '\t'.repeat(Math.max(1, Math.round(width / 2))) : ' '.repeat(width);
}

/** 把带 2 空格基准缩进的模板块重排为目标缩进。 */
function dedent(block, pad) {
  return block
    .replace(/^\n/, '')
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : pad + line.slice(2)))
    .join('\n');
}

/** 跳过字符串字面量与行/块注释，返回 `{ body }` 供括号配平使用。 */
function blankOutLiterals(text) {
  const out = Array.from(text);
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (let k = i; k < stop; k++) out[k] = ' ';
      i = stop;
      continue;
    }
    if (ch === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      for (let k = i; k < stop; k++) out[k] = ' ';
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      let k = i + 1;
      while (k < text.length) {
        if (text[k] === '\\') {
          k += 2;
          continue;
        }
        if (text[k] === ch) break;
        k += 1;
      }
      for (let m = i; m < Math.min(k + 1, text.length); m++) out[m] = ' ';
      i = k + 1;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

/** 找到从 `from` 起第一个 `{` 的配平 `}` 位置（不含注释/字符串干扰）。 */
function matchingBrace(text, from) {
  const blanked = blankOutLiterals(text);
  const open = blanked.indexOf('{', from);
  if (open === -1) throw new Error('未找到 `{`');
  let depth = 0;
  for (let i = open; i < blanked.length; i++) {
    const ch = blanked[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error('括号未配平');
}

/** 生成全部片段（按实测风格）。 */
function snippets(text) {
  const style = styleOf(text);
  const pad = indenter(style);
  const n = (width) => pad(width);
  const lit = (s) => style.quote + s + style.quote;

  // ---- 1) 上限常量 ----
  const constBlock =
    `${MARK_SUBAGENT_MAX}\n` +
    `const SUBAGENT_LIST_MAX = Number.isFinite(globalThis.__DSH_SUBAGENT_LIST_MAX)\n` +
    `  ? Math.max(0, Math.trunc(globalThis.__DSH_SUBAGENT_LIST_MAX))\n` +
    `  : 200;`;

  // ---- 2) sessionListFields：extra 形参 + 返回字段 ----
  // 形参：只锚函数头（两排版的函数体/注释缩进不同），新代码由函数头自动补形参。
  const signatureOld = `function sessionListFields(header, events = []) {`;
  const signatureNew = `function sessionListFields(header, events = [], extra = void 0) {`;
  // 返回字段：`...agentPreset === void 0 ? {} : { agentPreset }` 后可能带尾逗号（源码排版），
  //        替换时按实测决定是否吞掉尾逗号，保证两种排版都不产生 `,,` 或缺失分隔。
  const returnOld = `...agentPreset === ${style.undef} ? {} : { agentPreset }`;
  /** 返回体「补在 agentPreset 行之后」的文本（原行首保留，尾逗号按实测吞掉）。 */
  // 注意：`,` 必须留在同一行（尾随 agentPreset 行），否则会生成只有逗号的一行。
  const returnNew = `\n${n(4)}${MARK_RUNNING_COUNT}\n${n(4)}...extra === void 0 ? {} : extra`;
  /** 定位返回体行并给出「是否吞尾逗号」的判定。 */
  const returnTail = (source) => {
    const at = source.indexOf(returnOld);
    if (at === -1) throw new Error('锚点缺失 [sessionListFields 返回体 agentPreset 行]');
    if (source.indexOf(returnOld, at + returnOld.length) !== -1) throw new Error('锚点非唯一 [sessionListFields 返回体 agentPreset 行]');
    const takeComma = source.charAt(at + returnOld.length) === ',';
    return { at, takeComma, end: at + returnOld.length + (takeComma ? 1 : 0) };
  };

  // ---- 3) 聚合函数（逐行组装，避免模板 dedent 与缩进换算互相干扰） ----
  const u = style.hasTab ? '\t' : '    ';
  const aggBody = [
    MARK_RUNNING_COUNT,
    '/**',
    ' * 为**顶层**会话补 runningSubagentCount：沿「不间断 subagent 血缘链」统计其 running 后代，',
    ' * 语义与客户端 indexSubagentDescendants(byId) 一致，但由宿主在**截断之后**的行上计算，',
    ' * 因此侧边栏「N 个子代理运行中」状态点不再依赖被截断的 subagent 行（消费方 C1）。',
    ' * 成本：只遍历本次已产出的行 + live agent 表，无新增投影/读盘。',
    ' * @param items - listVisibleSessionSummaries 产出的行（已排序、已截断）。',
    ' * @returns 同一数组（原对象上补字段）。',
    ' */',
    'function annotateRunningSubagentCounts(ctx, items) {',
    `${u}const childrenOf = new Map();`,
    `${u}for (const item of items) {`,
    `${u}${u}const parentId = item.parentSessionId;`,
    `${u}${u}if (parentId === void 0) continue;`,
    `${u}${u}const bucket = childrenOf.get(parentId);`,
    `${u}${u}if (bucket === void 0) childrenOf.set(parentId, [item.sessionId]);`,
    `${u}${u}else bucket.push(item.sessionId);`,
    `${u}}`,
    `${u}const liveStatus = new Map();`,
    `${u}for (const session of ctx.sessions.list()) liveStatus.set(session.id, ctx.agents.get(session.id)?.status === ${lit('running')});`,
    `${u}for (const item of items) {`,
    `${u}${u}if (item.origin === ${lit('subagent')}) continue;`,
    `${u}${u}let count = 0;`,
    `${u}${u}const seen = new Set([item.sessionId]);`,
    `${u}${u}const queue = [item.sessionId];`,
    `${u}${u}while (queue.length > 0) {`,
    `${u}${u}${u}const next = childrenOf.get(queue.shift());`,
    `${u}${u}${u}if (next === void 0) continue;`,
    `${u}${u}${u}for (const childId of next) {`,
    `${u}${u}${u}${u}if (seen.has(childId)) continue;`,
    `${u}${u}${u}${u}seen.add(childId);`,
    `${u}${u}${u}${u}if (liveStatus.get(childId) === true) count += 1;`,
    `${u}${u}${u}${u}queue.push(childId);`,
    `${u}${u}${u}}`,
    `${u}${u}}`,
    `${u}${u}item.${COUNT_FIELD} = count;`,
    `${u}}`,
    `${u}return items;`,
    '}',
  ].join('\n');
  const aggFn = aggBody;
  const aggMarker = `function annotateRunningSubagentCounts(ctx, items) {`;

  // ---- 4) 内存（已 attach）分支：顶层全发 + subagent 最近 N 条 ----
  const itemsOld = `const items = ctx.sessions.list().map(summarizeAttached);`;
  const itemsNew = dedent(
    `
  ${MARK_FILTER}
  const attachedSessions = ctx.sessions.list();
  const attachedSubagents = attachedSessions.filter((session) => session.header.origin === ${lit('subagent')});
  attachedSubagents.sort((a, b) => sessionListUpdatedAt(b.header, sessionListMetadata(b.events)) - sessionListUpdatedAt(a.header, sessionListMetadata(a.events)));
  const keep = new Set();
  for (const session of attachedSessions) if (session.header.origin !== ${lit('subagent')}) keep.add(session.id);
  for (const session of attachedSubagents.slice(0, SUBAGENT_LIST_MAX)) keep.add(session.id);
  const items = attachedSessions.filter((session) => keep.has(session.id)).map(summarizeAttached);`,
    n(2)
  );

  // ---- 5) 冷会话分支：结构锚点（缩进无关） ----
  // 锚 A：`const cold = (await persistence.list(signal))` → 在之后补「冷 subagent 候选（按 updatedAt 降序）」
  const coldAwaitLine = `const cold = (await persistence.list(signal))`;
  /**
   * 冷会话分支的完整替换语句。
   * @param indentStr 目标缩进**字符串**（原样取自被替换语句所在行，不做列数换算）
   */
  const coldStmtLines = (indentStr) =>
    [
      `  // 冷会话同源分流：顶层 id 一条不少；subagent 只保留「最近 SUBAGENT_LIST_MAX 条」作为候选，`,
      `  // 其余在下面的 filter 中直接剔除，避免为它们做投影与冷读（本次削峰的主路径）。`,
      `  const coldSource = (await persistence.list(signal));`,
      `  const coldSubagentCandidates = coldSource`,
      `    .filter((meta) => meta.origin === ${lit('subagent')})`,
      `    .sort((a, b) => b.updatedAt - a.updatedAt)`,
      `    .slice(0, SUBAGENT_LIST_MAX);`,
      `  const coldSubagentIds = new Set(coldSubagentCandidates.map((meta) => meta.id));`,
      `  let coldSubagentSeen = 0;`,
      `  const cold = coldSource.filter((meta) => {`,
      `    if (attached.has(meta.id) || meta.cwd === void 0) return false;`,
      `    if (meta.origin !== ${lit('subagent')}) return true;`,
      `    if (!coldSubagentIds.has(meta.id)) return false;`,
      `    coldSubagentSeen += 1;`,
      `    return coldSubagentSeen <= SUBAGENT_LIST_MAX;`,
      `  });`,
    ]
      .map((line) => indentStr + line.slice(2))
      .join('\n');

  // 锚 B：既有 `.filter(meta => ...)` 行（两种排版仅差 `undefined` / `void 0`，保留原样），
  //       在其条件之后追加 `&& (meta.origin !== 'subagent' || coldSubagentIds.has(meta.id))`
  const coldFilterMatch = (source) => {
    const m = source.match(/\.filter\(\(?meta\)? => !attached\.has\(meta\.id\) && meta\.cwd !== (undefined|void 0)\)/);
    if (m === null) throw new Error('锚点缺失 [冷会话 filter]');
    return m;
  };
  const coldFilterNew = (m, tail) =>
    `${m[0].replace(/\)$/, '')} && (meta.origin !== ${lit('subagent')} || coldSubagentIds.has(meta.id)))${tail}`;

  // ---- 6) 排序 + 收口 + 返回 ----
  // 排序 + 返回：锚点用「换行+缩进不敏感」正则，两种排版的 TAB/空格都命中，再按实测缩进重建。
  const coreRe = /items\.sort\(\(a, b\) => b\.updatedAt - a\.updatedAt\);\n([ \t]+)return items;?/;
  const coreNew = (indent) =>
    `
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  // 收口：合并排序后按 updatedAt 只留「最近的 SUBAGENT_LIST_MAX 条 subagent」；顶层一条不丢。
  const subagentItems = items.filter((item) => item.origin === ${lit('subagent')});
  const overflow = subagentItems.slice(SUBAGENT_LIST_MAX);
  const retained = overflow.length === 0 ? items : items.filter((item) => !overflow.some((drop) => drop.sessionId === item.sessionId));
  return annotateRunningSubagentCounts(ctx, retained);`
      .replace(/^\n/, '')
      .split('\n')
      .map((line) => (line.trim() === '' ? line : indent + line.slice(2)))
      .join('\n');

  return {
    style,
    constBlock,
    signatureOld,
    signatureNew,
    returnOld,
    returnNew,
    returnTail,
    aggFn,
    aggMarker,
    itemsOld,
    itemsNew,
    coldAwaitLine,
    coldStmtLines,
    coldFilterMatch,
    coldFilterNew,
    coreRe,
    coreNew,
  };
}

/** 正则转义（锚点含 `(`, `)`, `.`, `?` 等字符）。 */
function escapeRe(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 块插入用：去掉块首行多出的缩进（该行标签沿用原行前缀）。 */
function clipHead(block) {
  const nl = block.indexOf('\n');
  if (nl === -1) return block;
  const head = block.slice(0, nl);
  const body = block.slice(nl + 1);
  const indent = (body.match(/^[ \t]*/) ?? [''])[0];
  return (head.startsWith(indent) ? head.slice(indent.length) : head.replace(/^[ \t]+/, '')) + '\n' + body;
}

/** 单次替换（唯一命中校验）。 */
function replaceOnce(text, from, to, label) {
  const at = text.indexOf(from);
  if (at === -1) throw new Error(`锚点缺失 [${label}]`);
  if (text.indexOf(from, at + from.length) !== -1) throw new Error(`锚点非唯一 [${label}]`);
  return text.slice(0, at) + to + text.slice(at + from.length);
}

/** 定位 `if (persistence !== undefined) {` 块的配平收尾位置（返回该 `}` 的下标）。 */
function coldBlockEnd(text, searchFrom) {
  const blanked = blankOutLiterals(text);
  const marker = `if (persistence !== ${undefOf(text)}) {`;
  const at = blanked.indexOf(marker, searchFrom);
  if (at === -1) throw new Error('锚点缺失 [if (persistence !== undefined)]');
  if (blanked.indexOf(marker, at + 1) !== -1) throw new Error('锚点非唯一 [if (persistence !== undefined)]');
  return matchingBrace(text, at);
}

/**
 * 应用服务端过滤补丁（纯函数：全文进、全文出，不落盘）。
 * @param text 目标文件全文
 * @returns 变更后的全文
 */
function applyServerFilter(text) {
  const s = snippets(text);

  for (const [marker, label] of [
    [MARK_SUBAGENT_MAX, 'SUBAGENT_LIST_MAX 常量'],
    [MARK_FILTER, '过滤区'],
    [s.aggMarker, '聚合函数'],
  ]) {
    if (text.includes(marker)) throw new Error(`已应用（命中 ${label}）——无需重复套用`);
  }

  // ---------- 锚点唯一性校验（全部前置，任一不符即抛） ----------
  expectLiteral(text, s.signatureOld, 1, 'function sessionListFields(header, events = [])');
  s.returnTail(text);
  expectLiteral(text, s.itemsOld, 1, '内存分支 const items = ctx.sessions.list().map(summarizeAttached');
  expectLiteral(text, s.coldAwaitLine, 1, '冷会话 const cold = (await persistence.list(signal))');
  {
    const hits = text.match(new RegExp(s.coreRe.source, 'g')) ?? [];
    if (hits.length !== 1) throw new Error(`锚点校验失败 [排序 + return items]: 期望命中 1 次，实得 ${hits.length} 次`);
  }
  {
    const ms = text.match(/\.filter\(\(?meta\)? => !attached\.has\(meta\.id\) && meta\.cwd !== (?:undefined|void 0)\)/g) ?? [];
    if (ms.length !== 1) throw new Error(`锚点校验失败 [冷会话 filter]：期望命中 1 次，实得 ${ms.length} 次`);
  }
  coldBlockEnd(text, text.indexOf(s.itemsOld)); // 前置校验：冷分支结构可配平定位

  // ---------- 位置式替换（顺序：文件内从后往前，避免位移干扰） ----------
  // (1) 排序 + return 收口
  {
    const m = text.match(s.coreRe);
    const indent = m[1];
    const at = text.indexOf(m[0]);
    text = text.slice(0, at) + s.coreNew(indent) + text.slice(at + m[0].length);
  }
  // (2) 冷会话分支：整条 `const cold = ...;` 语句替换为「分流 + 状态式 filter」。
  //     必须在 `const cold` 之前声明 coldSubagentIds，否则 filter 内引用会撞 TDZ。
  {
    const at = text.indexOf(s.coldAwaitLine);
    const lineStart = text.lastIndexOf('\n', at) + 1;
    const indent = text.slice(lineStart, at).match(/^[ \t]*/)[0];
    const m = s.coldFilterMatch(text);
    const end = text.indexOf(';', at + m[0].length - 1);
    // 注意 dedent 的 pad 是**字符**宽度：这里以原始缩进字符数为准（TAB 场景下不做列换算），
    // 同时用 clipHead 去掉块首行多余缩进（首行沿用原行前缀）。
    text = text.slice(0, at) + clipHead(s.coldStmtLines(indent)) + text.slice(end + 1);
  }
  // (3) 内存分支（块首行已在原行位置，需去掉块首多余缩进）
  text = replaceOnce(text, s.itemsOld, clipHead(s.itemsNew), '内存分支过滤');
  // (6) sessionListFields 返回字段 + 形参
  {
    const tail = s.returnTail(text);
    const comma = tail.takeComma ? '' : ',';
    text = text.slice(0, tail.end) + comma + s.returnNew + text.slice(tail.end);
  }
  text = replaceOnce(text, s.signatureOld, s.signatureNew, 'sessionListFields extra 形参');
  // (7) 常量 + 聚合函数：插在 sessionListFields 定义之前（整块落在行首，避免继承上一行缩进）
  {
    const at = text.indexOf(s.signatureNew);
    const lineStart = text.lastIndexOf('\n', at) + 1;
    const block = `${s.constBlock}\n${s.aggFn}\n`;
    text = text.slice(0, lineStart) + block + text.slice(lineStart);
  }

  return text;
}

/** 变更后自校验（语法由 `node --check` 负责，这里查语义标记与旧锚点残留）。 */
function verifyServerFilter(text) {
  const failures = [];
  for (const [literal, expected] of [
    [MARK_SUBAGENT_MAX, 1],
    [MARK_RUNNING_COUNT, 2],
    [MARK_FILTER, 1],
    ['function annotateRunningSubagentCounts(ctx, items) {', 1],
    ['return annotateRunningSubagentCounts(ctx, retained);', 1],
    ['const coldSubagentIds = new Set(cold', 1],
  ]) {
    const actual = countLiteral(text, literal);
    if (actual !== expected) failures.push(`${literal}: 期望 ${expected} 实得 ${actual}`);
  }
  // 防复发（2026-09-20 生产事故）：该聚合函数是**模块级**函数，`ctx` 只存在于 createApiProxy 形参里。
  // 任何「函数体引用 ctx、签名却没声明 ctx」的写法都会在运行时抛 ReferenceError 让 session.list 返 500。
  if (/function annotateRunningSubagentCounts\(items\)/.test(text)) failures.push('聚合函数签名未声明 ctx（会抛 ReferenceError）');
  if (/return annotateRunningSubagentCounts\(retained\)/.test(text)) failures.push('聚合函数调用点未传 ctx（会抛 ReferenceError）');
  if (text.includes('ctx.sessions.list()') && !text.includes('annotateRunningSubagentCounts(ctx, items)')) {
    failures.push('聚合函数体引用 ctx 但签名未接收 ctx');
  }
  if (text.includes('const items = ctx.sessions.list().map(summarizeAttached);')) failures.push('旧内存分支仍在（过滤未生效）');
  if (!text.includes('coldSubagentIds.has(meta.id)') || !text.includes('coldSubagentSeen <= SUBAGENT_LIST_MAX')) {
    failures.push('冷会话分支未按 coldSubagentIds 截断');
  }
  // 结构性自检交给脚本层的 `node --check`（ESM 上下文，权威）；此处只做旧锚点残留检查。
  return failures;
}

module.exports = {
  MARK_SUBAGENT_MAX,
  MARK_RUNNING_COUNT,
  MARK_FILTER,
  COUNT_FIELD,
  applyServerFilter,
  verifyServerFilter,
  countLiteral,
  expectLiteral,
  matchingBrace,
};
