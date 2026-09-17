/**
 * fixtures.js — 生成并覆写「插件文件」（纯函数模块），模拟磁盘文件变更。
 * 每个测试用独立的 fixture 目录，避免跨测试干扰。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURES_DIR = join(ROOT, "fixtures");

export function ensureFixtures() {
  mkdirSync(FIXTURES_DIR, { recursive: true });
}

/** CJS 纯函数插件：compute 双倍/三倍随版本变化，模块级状态 count 模拟"旧状态引用" */
export function writeCjsPlugin(version) {
  const body = `
// CJS 纯函数插件 v${version}
let count = 0;
module.exports = {
  version: ${version},
  compute: (x) => x * ${version},       // v1: x*1, v2: x*2, ...
  bump: () => ++count,                  // 模块级状态：新实例应重新计数
  getCount: () => count,
  name: "pluginA",
};
`;
  const p = join(FIXTURES_DIR, "plugin-a.cjs");
  writeFileSync(p, body);
  return p;
}

/** ESM 纯函数插件（按策略分文件，避免同一进程内 query 与 internal 相互污染真实 loadCache） */
export function writeEsmPlugin(version, suffix = "") {
  const body = `
// ESM 纯函数插件 v${version}
let count = 0;
export const version = ${version};
export function compute(x) { return x * ${version}; }
export function bump() { return ++count; }
export function getCount() { return count; }
export default { version: ${version}, compute, bump, getCount, name: "pluginB" };
`;
  const p = join(FIXTURES_DIR, `plugin-b${suffix}.mjs`);
  writeFileSync(p, body);
  return p;
}

/** CJS 依赖（被 ESM 入口 import） */
export function writeCjsDep(version) {
  const body = `
// CJS dep v${version}
module.exports = { depVersion: ${version}, factor: ${version} };
`;
  const p = join(FIXTURES_DIR, "dep-cjs.cjs");
  writeFileSync(p, body);
  return p;
}

/** ESM 依赖（被 CJS 入口 require / 被 ESM 入口 import）；suffix 区分场景避免进程内 loadCache 串扰 */
export function writeEsmDep(version, suffix = "") {
  const body = `
// ESM dep v${version}
export const depVersion = ${version};
export const factor = ${version};
`;
  const p = join(FIXTURES_DIR, `dep-esm${suffix}.mjs`);
  writeFileSync(p, body);
  return p;
}

/** ESM 入口，import 一个 CJS dep：混合方向 1（ESM 依赖 CJS） */
export function writeEsmEntry(version) {
  const body = `
// ESM entry v${version} —— import CJS dep
import dep from "./dep-cjs.cjs";
export const entryVersion = ${version};
export function compute(x) { return x * dep.factor; }
export const factorFromDep = () => dep.factor;
export default { entryVersion: ${version}, compute, factorFromDep };
`;
  const p = join(FIXTURES_DIR, "entry-esm.mjs");
  writeFileSync(p, body);
  return p;
}

/** CJS 入口，require 一个 ESM dep：混合方向 2（CJS 依赖 ESM，Node 22.23.2 免 flag） */
export function writeCjsEntry(version, depSuffix = "") {
  const body = `
// CJS entry v${version} —— require ESM dep
async function loadDep() {
  const dep = await import("./dep-esm${depSuffix}.mjs");
  return dep;
}
module.exports = {
  entryVersion: ${version},
  compute: async (x) => x * (await loadDep()).factor,
};
`;
  const p = join(FIXTURES_DIR, `entry-cjs${depSuffix}.cjs`);
  writeFileSync(p, body);
  return p;
}

/** ESM 入口，import ESM dep：全 ESM 对照 */
export function writeEsmEntryEsmDep(version, depSuffix = "") {
  const body = `
// ESM entry v${version} —— import ESM dep
import { factor } from "./dep-esm${depSuffix}.mjs";
export const entryVersion = ${version};
export function compute(x) { return x * factor; }
export const factorFromDep = () => factor;
export default { entryVersion: ${version}, compute, factorFromDep };
`;
  const p = join(FIXTURES_DIR, `entry-esm-esmdep${depSuffix}.mjs`);
  writeFileSync(p, body);
  return p;
}

/** 抛错版本（用于失败回滚测试） */
export function writeEsmBroken() {
  const p = join(FIXTURES_DIR, "plugin-broken.mjs");
  writeFileSync(p, `
export const version = 99;
throw new Error("boom: new module failed to load");
`);
  return p;
}

/** 抛错版本 CJS */
export function writeCjsBroken() {
  const p = join(FIXTURES_DIR, "plugin-a-broken.cjs");
  writeFileSync(p, `
module.exports = { version: 99 };
throw new Error("boom-cjs: new module failed to load");
`);
  return p;
}

export function url(spec) {
  return pathToFileURL(spec).href;
}
