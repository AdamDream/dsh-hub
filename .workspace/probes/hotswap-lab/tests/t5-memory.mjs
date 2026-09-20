/**
 * T5 —— 测量点⑤：内存泄漏观察（200 次反复替换，分两段观测判断「一次性成本 vs 持续泄漏」）
 * 用法：node --expose-internals --expose-gc tests/t5-memory.mjs <internal|query>
 * 关键指标：
 *  - loadCache 条目数：internal 应恒定（每换一次删旧留新）；query 应线性累积（每个版本 URL 留下 job）
 *  - RSS/heapUsed 分段增量：第一段含一次性 warmup，第二段（100→200）若仍显著增长 = 持续泄漏
 */
import { LoadHost } from "../host/loadHost.js";
import { ensureFixtures, writeEsmPlugin, url } from "./fixtures.js";

ensureFixtures();

const TOTAL = 200;
const CHECKPOINT = 100;
const strategy = process.argv[2] ?? "internal";
if (!["internal", "query"].includes(strategy)) {
  console.error("usage: t5-memory.mjs <internal|query>");
  process.exit(2);
}
function gcNow() { if (globalThis.gc) globalThis.gc(); }

gcNow();
const host = new LoadHost({ strategy });
const fileTag = strategy === "query" ? "-t5q" : "-t5i";
const spec = url(writeEsmPlugin(1, fileTag));
await host.load("M", spec);
gcNow();
const rssBefore = process.memoryUsage().rss;
const heapBefore = process.memoryUsage().heapUsed;
const cacheBefore = host.countCacheEntries(`plugin-b${fileTag}.mjs`);

function snapshot(round) {
  gcNow();
  const { rss, heapUsed } = process.memoryUsage();
  const cache = host.countCacheEntries(`plugin-b${fileTag}.mjs`);
  return { round, rss, heapUsed, cache };
}

const t0 = performance.now();
const s1 = snapshot(0); // 刚装载 v1 后的基线
for (let v = 2; v <= CHECKPOINT + 1; v++) {
  const r = await host.hotSwap("M", url(writeEsmPlugin(v, fileTag)));
  if (!r.ok) { console.error("swap failed at", v, r.error); process.exit(1); }
}
const s100 = snapshot(CHECKPOINT);
for (let v = CHECKPOINT + 2; v <= TOTAL + 1; v++) {
  const r = await host.hotSwap("M", url(writeEsmPlugin(v, fileTag)));
  if (!r.ok) { console.error("swap failed at", v, r.error); process.exit(1); }
}
const s200 = snapshot(TOTAL);
const dt = performance.now() - t0;

const MB = 1048576;
const seg1Rss = (s100.rss - s1.rss) / MB;
const seg2Rss = (s200.rss - s100.rss) / MB;
const seg1Heap = (s100.heapUsed - s1.heapUsed) / MB;
const seg2Heap = (s200.heapUsed - s100.heapUsed) / MB;
console.log(`[${strategy}] RSS  seg1(0->100)=${seg1Rss.toFixed(2)}MB seg2(100->200)=${seg2Rss.toFixed(2)}MB`);
console.log(`[${strategy}] heap seg1(0->100)=${seg1Heap.toFixed(2)}MB seg2(100->200)=${seg2Heap.toFixed(2)}MB`);
console.log(`[${strategy}] loadCache entries: ${s1.cache} -> ${s100.cache} -> ${s200.cache} (net=${s200.cache - s1.cache}) | avg ${(dt / TOTAL).toFixed(3)}ms/swap`);
console.log(`T5_RESULT ${strategy} seg1Rss=${seg1Rss.toFixed(2)} seg2Rss=${seg2Rss.toFixed(2)} seg1Heap=${seg1Heap.toFixed(2)} seg2Heap=${seg2Heap.toFixed(2)} cacheNet=${s200.cache - s1.cache} avgMs=${(dt / TOTAL).toFixed(3)}`);

let ok = true;
if (strategy === "internal" && s200.cache - s1.cache > 1) { console.error("  ✗ FAIL: internal loadCache grew"); ok = false; }
if (strategy === "query" && s200.cache - s1.cache < 10) { console.error("  ✗ FAIL: query should accumulate loadCache entries"); ok = false; }
process.exitCode = ok ? 0 : 1;
