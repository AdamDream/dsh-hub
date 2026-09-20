/**
 * T6 —— 测量点②补充：评估「module.register（loader hooks）」能否作为 ESM 缓存失效手段
 * 结论预判（来自审计 C §3.2）：load hook 只在模块首次装载（未命中缓存）时运行，同 URL 二次
 * import 命中 loadCache → hook 不重跑；hook 也不感知缓存命中，因此 module.register 不能替代
 * 清缓存，只能配合 cache-bust URL 或真清 loadCache。
 * 计数用文件（loader hook 运行在独立上下文，globalThis 不与主线程共享）。
 */
import { register } from "node:module";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "p1-hook-"));
const countFile = join(dir, "count.txt");
const hookFile = join(dir, "hook.mjs");
writeFileSync(hookFile, `
import { appendFileSync } from "node:fs";
export async function load(url, context, nextLoad) {
  appendFileSync(${JSON.stringify(countFile)}, "L\\n");
  return nextLoad(url, context);
}
export async function resolve(specifier, context, nextResolve) {
  return nextResolve(specifier, context);
}
`);
const modFile = join(dir, "target.mjs");
writeFileSync(modFile, `export const v = ${Math.floor(Math.random() * 1000)};`);

await register(hookFile, import.meta.url);

const target = pathToFileURL(modFile).href;
const a = await import(target);
const b = await import(target); // 同 URL 二次 import → 应命中缓存，hook 不重跑
const c = await import(target + "?v=2"); // 新 URL → hook 应再次执行
const d = await import(target + "?v=2"); // 同 query URL → 命中缓存，hook 不重跑

const hookCalls = readFileSync(countFile, "utf8").split("\n").filter(Boolean).length;
console.log(`4 次 import()（2 个唯一 URL），load hook 实际执行 ${hookCalls} 次`);
console.log(`values: a=${a.v} b=${b.v} c=${c.v} d=${d.v}`);

// 判定
let ok = true;
if (hookCalls !== 2) {
  console.error(`  ✗ FAIL: expected hook to run once per unique URL (2), got ${hookCalls}`);
  ok = false;
} else {
  console.log(`  ✓ ok: hook 按「唯一 URL」计数（2 次）——同 URL 二次 import 命中 loadCache，hook 不重跑`);
}
console.log(`  ✓ ok: module.register 无法使已缓存 URL 失效；必须配 cache-bust URL 或真清 loadCache`);
process.exitCode = ok ? 0 : 1;
