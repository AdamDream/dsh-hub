/**
 * probes/extract-C1.mjs — 从真实 bundle 里逐字节抽取用于验证的代码区域（只读）
 *
 * 设计原则：**不做任何字符串改写**。抽取出的片段就是文件里的原文，
 * 通过 `with (deps)` 注入它引用的模块级依赖后直接执行。
 * 这样「等价性单测」跑的就是即将交付的字节，而不是我复刻的近似实现。
 */
import { readFileSync } from "node:fs";

export const TARGET_DEFAULT =
  "/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js";

/** 找唯一命中的锚点位置；0 次或多次都抛错。 */
export function uniqueIndex(text, anchor, label) {
  const at = text.indexOf(anchor);
  if (at < 0) throw new Error(`[extract] ${label}: anchor not found`);
  if (text.indexOf(anchor, at + 1) >= 0) throw new Error(`[extract] ${label}: anchor not unique`);
  return at;
}

/** 从 `text[from]` 处的 `{`（或 `(`/`[`）起，找配对闭括号的索引；跳过字符串/模板/注释。 */
export function matchBracket(text, from, open = "{", close = "}") {
  let i = text.indexOf(open, from);
  if (i < 0) throw new Error(`[extract] opening ${open} not found from ${from}`);
  let depth = 1;
  let j = i + 1;
  let mode = "code";
  while (j < text.length && depth > 0) {
    const c = text[j];
    const n = text[j + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") mode = "line";
      else if (c === "/" && n === "*") {
        mode = "block";
        j += 1;
      } else if (c === '"' || c === "'" || c === "`") mode = c;
      else if (c === open) depth += 1;
      else if (c === close) depth -= 1;
    } else if (mode === "line") {
      if (c === "\n") mode = "code";
    } else if (mode === "block") {
      if (c === "*" && n === "/") {
        mode = "code";
        j += 1;
      }
    } else if (c === "\\") j += 1;
    else if (c === mode) mode = "code";
    j += 1;
  }
  if (depth !== 0) throw new Error("[extract] unbalanced brackets");
  return j - 1;
}

/** 抽取锚点所在的那一整行。 */
export function extractLine(text, anchor, label) {
  const at = uniqueIndex(text, anchor, label);
  const start = text.lastIndexOf("\n", at) + 1;
  const end = text.indexOf("\n", at);
  return text.slice(start, end < 0 ? text.length : end);
}

/** 抽取「锚点起始的一段完整语句块」，到配对闭括号（含）为止。 */
export function extractBlock(text, anchor, label, open = "{", close = "}") {
  const at = uniqueIndex(text, anchor, label);
  const end = matchBracket(text, at, open, close);
  return text.slice(at, end + 1);
}

/** 抽取从 `startAnchor` 到 `endAnchor` 之前的原文（endAnchor 不含）。 */
export function extractBetween(text, startAnchor, endAnchor, label) {
  const at = uniqueIndex(text, startAnchor, label);
  const endAt = text.indexOf(endAnchor, at + startAnchor.length);
  if (endAt < 0) throw new Error(`[extract] ${label}: end anchor not found`);
  return text.slice(at, endAt);
}

/** 抽取一个模块级 function 声明的完整文本。 */
export function extractFunction(text, decl, label) {
  const at = uniqueIndex(text, decl, label);
  const end = matchBracket(text, at, "{", "}");
  return text.slice(at, end + 1);
}

/** 用 `with (thisArg)` 注入依赖后编译一段原文（无改写）。 */
export function compileExpr(deps, bodySource, label) {
  const keys = Object.keys(deps);
  try {
    return new Function(...keys, bodySource)(...keys.map((k) => deps[k]));
  } catch (error) {
    throw new Error(`[extract] compile failed for ${label}: ${error.message}`);
  }
}

/** 把若干片段拼成一个返回值（片段为原文，拼接点由调用方显式给出）。 */
export function runWith(deps, prelude, body, label) {
  const fn = compileExpr(deps, `return (thisArg) => (function () { with (thisArg) { ${prelude} ${body} } })();`, label);
  return fn;
}

export function readTarget(file = TARGET_DEFAULT) {
  return readFileSync(file, "utf8");
}

// ---------------------------------------------------------------------------
// 各交付单元的抽取函数（锚点即 spec 锚点；基线/改后各抽一次）
// ---------------------------------------------------------------------------
export const ANCHOR = {
  // P1：清理行（基线一行；改后是一个块）
  p1Baseline: "\t\t\t\tfor (const id of this.entryCache.keys()) if (!items.some((e) => e.sessionId === id)) this.entryCache.delete(id);",
  p1Patched: "\t\t\t/* dsh-perf-fix P1 v1 */ /* entryCache cleanup: build the live-id set once, then retire stale rows in O(N). */",
  // buildListSnapshot 整个方法体（用于两者一起跑）
  snapshot: "buildListSnapshot() {",
  // P4：applyMutation 整个函数
  applyMutationBaseline: "\t\tfunction applyMutation(summaries, mutation) {",
  applyMutationPatched: "\t\tfunction applyMutation(summaries, mutation, index) {",
  // P4 索引工厂（改后独有；整行唯一）
  indexSummaries: "\t\t/* dsh-perf-fix P4 v1 */ /** indexSummaries: build the sessionId index for one summaries array. */",
  // 各补丁插入的标记行（整行唯一，用于按行抽取基线/改后片段）
  p4aMarker: "\t\t\t\t\t/* dsh-perf-fix P4 v1 */ /* upsert lookup: O(1) via the caller index, else the original scan. */",
  p4bMarker: "\t\t\t\t\t/* dsh-perf-fix P4 v1 */ /* upsert materialization: return the mapped array (index stays caller-owned). */",
  // P2：projectList 末段
  p2TailBaseline: "\t\t\t\tconst persisted = this.selection.getSnapshot().sessionId;",
  p2TailPatched: "\t\t\t\t/* dsh-perf-fix P2 v1 */ /* projectList: reuse the previous projection object when content is unchanged. */",
  // P2 辅助函数（改后独有）
  sameIdList: "\t\t/* dsh-perf-fix P2 v1 */ /** reference-stabilization comparators (new declarations; no behavior change). */",
  // P2 辅助函数整段（由 spec 的 P2b.helperRegion 提供，见 equivalence-C1.mjs）
  displayTitleOf: "\t\tfunction displayTitleOf(title, cwd, id) {"
};

/** 抽取 buildListSnapshot 的整个方法体（含 `buildListSnapshot() {` 外壳）。 */
export function snapshotDecl(text) {
  const at = uniqueIndex(text, ANCHOR.snapshot, "snapshot");
  const end = matchBracket(text, at, "{", "}");
  return text.slice(at, end + 1);
}

/** 抽取 projectList「构建 byId」循环（ids/byId 由它产出）。 */
export function byIdLoop(text) {
  return extractBetween(
    text,
    "\t\t\t\tconst ids = [];",
    "\t\t\t\tif (current !== void 0 && currentAddress !== void 0) {",
    "projectList byId loop"
  );
}

/** 抽取 projectList 的「地址链 + 稳定化 + selection + list.set」全段（到 pruneScopes 之前）。 */
export function projectTail(text, patched) {
  const start = patched ? ANCHOR.p2TailPatched : ANCHOR.p2TailBaseline;
  const at = uniqueIndex(text, start, "projectTail");
  const endAt = text.indexOf("\t\t\t\tthis.pruneScopes();", at);
  if (endAt < 0) throw new Error("[extract] projectTail: pruneScopes not found");
  return text.slice(at, endAt);
}

/** 抽取 projectList 里「地址链」那一段（byId 循环之后、稳定化之前）。 */
export function addressChain(text) {
  return extractBetween(text, "\t\t\t\tif (current !== void 0 && currentAddress !== void 0) {", "\t\t\t\tconst persisted", "addressChain");
}
