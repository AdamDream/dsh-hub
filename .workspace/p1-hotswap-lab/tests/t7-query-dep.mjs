/**
 * T7 —— 测量点③补充：query 策略下入口的相对依赖是否会被刷新？
 * 预判：import("file:///x/entry.mjs?hr=2") 内部再 import "./dep.mjs" 时，
 * URL 解析会剥掉 query → 依赖仍命中旧缓存。即 query 策略只能刷新「叶子入口」，刷新不了依赖链。
 * 对照 internal 策略（真清 loadCache）可连依赖一起换。
 */
import { LoadHost } from "../host/loadHost.js";
import { ensureFixtures, writeEsmDep, writeEsmEntryEsmDep, url } from "./fixtures.js";
import { check, summary } from "./assert.js";

ensureFixtures();

// 独立文件名避免与 T3 串扰
async function run(strategy, tag) {
  const host = new LoadHost({ strategy });
  const entry = url(writeEsmEntryEsmDep(1, tag));
  const dep = url(writeEsmDep(5, tag));
  const f = await host.load("E" + tag, entry);
  const v1 = f.api.compute(10); // 10 * dep.factor(5) = 50
  // 改依赖 → 热换入口（依赖进 accepted 集合，query 策略会给依赖也加 query）
  writeEsmDep(9, tag);
  const r = await host.hotSwap("E" + tag, entry, undefined, [dep]);
  const v2 = r.fiber.api.compute(10);
  return { strategy, v1, v2, r };
}

console.log("== T7: query strategy vs internal strategy — dependency refresh ==");
const q = await run("query", "-q");
const i = await run("internal", "-i");
console.log(`  [query]    dep 5 -> 9 : entry compute 10*5=${q.v1} -> 10*9? => ${q.v2}`);
console.log(`  [internal] dep 5 -> 9 : entry compute 10*5=${i.v1} -> 10*9? => ${i.v2}`);

check(q.v2 === 50, "[query] dep NOT refreshed through query-busted entry (stale=50, proves query 策略剥 query 于相对依赖)", `v2=${q.v2}`);
check(i.v2 === 90, "[internal] dep refreshed via loadCache delete (fresh=90)", `v2=${i.v2}`);
const ok = summary("T7");
process.exitCode = ok ? 0 : 1;
