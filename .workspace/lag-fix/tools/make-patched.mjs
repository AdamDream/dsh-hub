#!/usr/bin/env node
// make-patched.mjs — 从 live client.js 生成「C2 补丁后」交付副本（只在工作区写）
// 用法: node make-patched.mjs <in.js> <out.js>
import { readFileSync, writeFileSync } from "node:fs";

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) { console.error("usage: make-patched.mjs <in.js> <out.js>"); process.exit(2); }

// 单元 C2-1：remoteSessionIndex 内层 O(k²) 去重 → Set（保持首次出现顺序 + 判定语义）
const C1_FROM = "const unique = ids.filter((id, index) => ids.indexOf(id) === index);";
const C1_TO   = "const unique = Array.from(new Set(ids));";
const C1_FROM2 = "if (unique.length === 1 && unique[0] !== void 0) index.set(title, unique[0]);";
const C1_TO2   = "if (unique.length === 1) index.set(title, unique[0]);";
// scope：只在 remoteSessionIndex 内替换（全文件该 token 出现 2 次）
const SCOPE_START = "function remoteSessionIndex(sessions) {";
const SCOPE_END = "\n\t\t\treturn index;\n\t\t}\n";

// 单元 C2-2：sessions() 全量重建 → 按快照引用记忆化（返回值语义等价）
const C2_FROM = [
  "\t\t\t\tsessions: () => {",
  "\t\t\t\t\tconst state = sessionsFeed?.getSnapshot();",
  "\t\t\t\t\tif (state === void 0) return [];",
  "\t\t\t\t\treturn Object.values(state.byId).map((row) => ({",
  "\t\t\t\t\t\ttitle: row.displayTitle,",
  "\t\t\t\t\t\t...typeof row.cwd === \"string\" ? { cwd: row.cwd } : {}",
  "\t\t\t\t\t}));",
  "\t\t\t\t}"
].join("\n");
const C2_TO = [
  "\t\t\t\tsessions: (() => {",
  "\t\t\t\t\t/**",
  "\t\t\t\t\t* Memoized by snapshot identity: the feeds publish a new state object",
  "\t\t\t\t\t* per update, so an unchanged reference implies unchanged rows and the",
  "\t\t\t\t\t* last projection is reused verbatim (same array contents, same order).",
  "\t\t\t\t\t*/",
  "\t\t\t\t\tlet cachedState;",
  "\t\t\t\t\tlet cachedRows = [];",
  "\t\t\t\t\treturn () => {",
  "\t\t\t\t\t\tconst state = sessionsFeed?.getSnapshot();",
  "\t\t\t\t\t\tif (state === cachedState) return cachedRows;",
  "\t\t\t\t\t\tcachedState = state;",
  "\t\t\t\t\t\tcachedRows = state === void 0 ? [] : Object.values(state.byId).map((row) => ({",
  "\t\t\t\t\t\t\ttitle: row.displayTitle,",
  "\t\t\t\t\t\t\t...typeof row.cwd === \"string\" ? { cwd: row.cwd } : {}",
  "\t\t\t\t\t\t}));",
  "\t\t\t\t\t\treturn cachedRows;",
  "\t\t\t\t\t};",
  "\t\t\t\t})()"
].join("\n");

let src = readFileSync(inPath, "utf8");
const expect = (label, n) => {
  const got = src.split(label).length - 1;
  if (got !== n) { console.error(`FAIL: token 出现 ${got} 次（期望 ${n}）：${label}`); process.exit(1); }
};

// --- 单元 C2-1（scoped） ---
expect(SCOPE_START, 1);
const s = src.indexOf(SCOPE_START);
const e = src.indexOf(SCOPE_END, s);
if (e < 0) { console.error("FAIL: 找不到 remoteSessionIndex 结束标记"); process.exit(1); }
const body = src.slice(s, e);
if ((body.split(C1_FROM).length - 1) !== 1) { console.error("FAIL: C2-1 锚点在 remoteSessionIndex 内非唯一"); process.exit(1); }
if ((body.split(C1_FROM2).length - 1) !== 1) { console.error("FAIL: C2-1 判定锚点在 remoteSessionIndex 内非唯一"); process.exit(1); }
const newBody = body.replace(C1_FROM, C1_TO).replace(C1_FROM2, C1_TO2);
src = src.slice(0, s) + newBody + src.slice(e);

// --- 单元 C2-2 ---
expect(C2_FROM, 1);
src = src.replace(C2_FROM, C2_TO);

// --- 后置：新 token 各 1 次、旧 token 全局各剩 1 次（remoteWorkspaceIndex 保留旧实现） ---
expect(C1_TO, 1);
expect(C1_FROM, 1);
expect("if (unique.length === 1) index.set(title, unique[0]);", 1);
expect(C2_TO, 1);

writeFileSync(outPath, src);
console.log(`OK: patched copy written -> ${outPath} (${src.length} bytes)`);
