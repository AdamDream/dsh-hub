'use strict';
/**
 * B1-transform-client.cjs — 单元 B1 消费方 C1 的最小客户端改动（纯文本变换）。
 *
 * 背景（见 audit-subagent-filter.md §2.2 C1）：
 *   侧边栏「N 个子代理运行中」状态点由 `indexSubagentDescendants(list.byId)` 就地聚合得到，
 *   即它**依赖 subagent 行存在**。服务端截断到最近 200 条后，老 subagent 的 running 计数会从
 *   客户端聚合里消失；而宿主侧新增的 `runningSubagentCount`（见 B1-transform.cjs）是权威值。
 *
 * 改动（2 个文件、3 处，全部是「宿主聚合字段优先，回落到原就地聚合」）：
 *   1. dsh-client-ui-workspace/lib/client.js
 *        · sessionNode()      —— 侧边栏分组行
 *        · deriveSearchResults() —— 搜索结果行
 *   2. dsh-client-runtime/lib/client.js
 *        · buildListSnapshot() 的 entryCache 新鲜度判据 —— 否则 runningSubagentCount 变化时
 *          会复用旧条目对象（状态点在「计数变化但其他字段不变」时不刷新）。
 *
 * 幂等：命中 MARK 即已应用。锚点计数不符即抛（调用方拒绝应用）。
 */

const MARK_CLIENT = '/* dsh-lag-fix B1/C1 */';

const UI_WORKSPACE = 'dsh-client-ui-workspace/lib/client.js';
const RUNTIME = 'dsh-client-runtime/lib/client.js';

const countLiteral = (text, literal) => {
  let n = 0;
  let i = text.indexOf(literal);
  while (i !== -1) {
    n += 1;
    i = text.indexOf(literal, i + literal.length);
  }
  return n;
};

function expectCount(text, literal, expected, label) {
  const actual = countLiteral(text, literal);
  if (actual !== expected) throw new Error(`锚点校验失败 [${label}]：期望命中 ${expected} 次，实得 ${actual} 次`);
}

/**
 * 把 `X: descendants.get(VAR)?.runningCount ?? 0,` 换成「宿主聚合字段优先，回落到就地聚合」。
 * 行锚点用正则（缩进数量无关），且要求全文件唯一命中。
 */
function patchSessionNodeLine(text, variable) {
  const re = new RegExp(
    `([ \\t]*)runningSubagentCount: descendants\\.get\\(${variable}\\.id\\)\\?\\.runningCount \\?\\? 0,`,
    'g'
  );
  const hits = text.match(re) ?? [];
  if (hits.length !== 1) {
    throw new Error(`锚点校验失败 [sessionNode(${variable}) 行]：期望命中 1 次，实得 ${hits.length} 次`);
  }
  // 注意：`??` 的优先级低于 `?:`，直接写 `cond ? a : b ?? 0` 会被解析成
  // `cond ? a : (b ?? 0)`（三元分支里的 `??` 归约到整体）——那会让「a 为 undefined 时」
  // 退回 0 而不是回落分支。故显式加括号并补一层 `?? 0` 兜底。
  return text.replace(re, (_match, indent) =>
    `${indent}runningSubagentCount: typeof ${variable}.runningSubagentCount === "number"` +
    ` ? ${variable}.runningSubagentCount` +
    ` : (descendants.get(${variable}.id)?.runningCount ?? 0), ${MARK_CLIENT}`
  );
}

/** entryCache 新鲜度判据追加 runningSubagentCount（否则计数变化时复用旧条目）。 */
function patchEntryCacheChain(text) {
  const anchor = 'prev.completed === entry.completed';
  expectCount(text, anchor, 1, 'entryCache 新鲜度链尾（prev.completed === entry.completed）');
  const next = `${anchor} && prev.runningSubagentCount === entry.runningSubagentCount`;
  return text.replace(anchor, next);
}

/**
 * 按包路径应用对应变换。
 * @param relPath 包内相对路径
 * @param text 目标文件全文
 * @returns 变更后的全文
 */
function applyClientPatch(relPath, text) {
  if (text.includes(MARK_CLIENT)) throw new Error(`已应用（命中 ${MARK_CLIENT}）——无需重复套用`);

  if (relPath === UI_WORKSPACE) {
    let out = patchSessionNodeLine(text, 's');
    out = patchSessionNodeLine(out, 'summary');
    return out;
  }
  if (relPath === RUNTIME) {
    return patchEntryCacheChain(text);
  }
  throw new Error(`未知目标文件：${relPath}`);
}

/** 变更后语义标记自检。 */
function verifyClientPatch(relPath, text) {
  const failures = [];
  if (relPath === UI_WORKSPACE) {
    if (countLiteral(text, MARK_CLIENT) !== 2) failures.push(`${MARK_CLIENT} 期望 2 处，实得 ${countLiteral(text, MARK_CLIENT)}`);
    if (!text.includes('typeof s.runningSubagentCount === "number"')) failures.push('缺 sessionNode(s) 的宿主字段优先');
    if (!text.includes('typeof summary.runningSubagentCount === "number"')) failures.push('缺搜索结果行的宿主字段优先');
    if (countLiteral(text, 'descendants.get(s.id)?.runningCount ?? 0') !== 1) failures.push('sessionNode(s) 回落分支异常');
    if (countLiteral(text, 'descendants.get(summary.id)?.runningCount ?? 0') !== 1) failures.push('搜索结果回落分支异常');
  } else if (relPath === RUNTIME) {
    if (countLiteral(text, 'prev.runningSubagentCount === entry.runningSubagentCount') !== 1) failures.push('entryCache 判据未追加');
    if (!text.includes('prev.completed === entry.completed && prev.runningSubagentCount === entry.runningSubagentCount')) {
      failures.push('entryCache 判据拼接结果不符');
    }
  } else {
    failures.push(`未知目标文件：${relPath}`);
  }
  return failures;
}

module.exports = {
  MARK_CLIENT,
  UI_WORKSPACE,
  RUNTIME,
  applyClientPatch,
  verifyClientPatch,
  countLiteral,
};
