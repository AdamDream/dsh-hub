/**
 * T2 —— 测量点②：ESM 纯函数模块替换（清 import 缓存的可行手段对比）
 *  2a. query cache-busting：import(url + ?hr=N) —— 不碰 internal loadCache
 *  2b. internal loadCache 真清：Map.prototype.delete.call —— cordis 官方做法
 *  2c. 代价/泄漏观测：query 策略下 Node loadCache 是否会累积每个 query URL 的条目（
 *      这是「query 绕过」的隐性成本：Node 内部为每个唯一 URL 保留 ModuleJob）
 * 注意：同一进程内两种策略共享真实 loadCache，故各自用独立 fixture 文件，
 *      并通过「换 N 次后 loadCache 条目数净增长」对比两种策略的内存特征。
 */
import { LoadHost } from "../host/loadHost.js";
import { ensureFixtures, writeEsmPlugin, url } from "./fixtures.js";
import { check, summary } from "./assert.js";

ensureFixtures();

async function strategyQuery() {
  const host = new LoadHost({ strategy: "query" });
  const p = writeEsmPlugin(1, "-query");
  const spec = url(p);
  const f1 = await host.load("B", spec);
  check(f1.api.compute(10) === 10, "[query] v1 loaded");
  writeEsmPlugin(2, "-query");
  const r = await host.hotSwap("B", spec);
  check(r.ok && r.fiber.api.compute(10) === 20, "[query] v2 takes effect via cache-busting URL");
  check(r.old.api.compute(10) === 10, "[query] old fiber isolated");
  return host;
}

async function strategyInternal() {
  const host = new LoadHost({ strategy: "internal" });
  const p = writeEsmPlugin(1, "-internal");
  const spec = url(p);
  const f1 = await host.load("B", spec);
  check(f1.api.compute(10) === 10, "[internal] v1 loaded");
  writeEsmPlugin(2, "-internal");
  const r = await host.hotSwap("B", spec);
  check(r.ok && r.fiber.api.compute(10) === 20, "[internal] v2 takes effect via loadCache delete");
  check(r.old.api.compute(10) === 10, "[internal] old fiber isolated");
  return host;
}

async function measureLeak(host, label, file) {
  const before = host.countCacheEntries(file);
  // 多换几次（每次先改磁盘文件）
  for (let v = 3; v <= 6; v++) {
    writeEsmPlugin(v, file.endsWith("-query.mjs") ? "-query" : "-internal");
    await host.hotSwap(label === "query" ? "BQ" : "BI", url(writeEsmPlugin(v, file.endsWith("-query.mjs") ? "-query" : "-internal")));
  }
  const after = host.countCacheEntries(file);
  console.log(`  [${label}] real loadCache entries for ${file}: before=${before} after=${after} (net growth=${after - before})`);
  return { label, before, after };
}

console.log("== T2: ESM pure-function hot swap (strategy comparison) ==");
const hQ = await strategyQuery();
const hI = await strategyInternal();
// 换纤维目标名不同，避免 registry 冲突
hQ.registry.set("BQ", hQ.registry.get("B"));
hI.registry.set("BI", hI.registry.get("B"));
const mQ = await measureLeak(hQ, "query", "plugin-b-query.mjs");
const mI = await measureLeak(hI, "internal", "plugin-b-internal.mjs");
// query 策略每个版本 = 新 URL → loadCache 条目净增（Node 为每个 query URL 保留 job）
check(mQ.after > mQ.before, "[leak] query strategy accumulates loadCache entries (per-version URL)", `before=${mQ.before} after=${mQ.after}`);
// internal 策略真清 → 条目数基本稳定（净增 <= 1，噪声）
check(mI.after - mI.before <= 1, "[leak] internal delete keeps loadCache entry count stable", `before=${mI.before} after=${mI.after}`);
const ok = summary("T2");
process.exitCode = ok ? 0 : 1;
