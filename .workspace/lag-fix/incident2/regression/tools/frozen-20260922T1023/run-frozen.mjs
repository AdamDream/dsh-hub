#!/usr/bin/env node
/**
 * 冻结器械包装器（面2 专用）
 *
 * 为什么需要它：firstopen-ab.mjs 用 `dirname(import.meta.url).replace(/\/tools$/, "")` 求 HERE；
 * 当我们把副本放进 tools/frozen-<stamp>/ 时，该正则不匹配 ⇒ HERE 少剥一层 ⇒ 找不到 tools/stubs.js。
 * 本包装器**不改工具逻辑**，只把副本路径 /tools/frozen-<stamp> 映射成 /tools 后 import，
 * 使 HERE 解析结果与在 tools/ 下运行时完全一致（raw/ 与 tools/stubs.js 都落在正确位置）。
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const self = path.dirname(new URL(import.meta.url).pathname);
const src = path.join(self, "firstopen-ab.mjs");
const b = path.basename(self);

const shimDir = path.join(self, "shim", "tools");
fs.mkdirSync(shimDir, { recursive: true });
fs.writeFileSync(path.join(shimDir, "firstopen-ab.mjs"), fs.readFileSync(src));
fs.writeFileSync(path.join(shimDir, "stubs.js"), fs.readFileSync(path.join(self, "stubs.js")));

process.argv[1] = path.join(shimDir, "firstopen-ab.mjs");
await import(pathToFileURL(path.join(shimDir, "firstopen-ab.mjs")).href);
