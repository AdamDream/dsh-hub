#!/usr/bin/env node
/**
 * g1-live.mjs — G1 活体判定：**一次完整 ingest pass 期间，宿主是否仍可响应**（心跳代理口径）
 *
 * 为什么用心跳代理而不是 `perf_hooks.monitorEventLoopDelay`：
 *   ① 该 API 只在**宿主进程内**可用，探针在外部进程，测不到宿主的事件循环；
 *   ② 更重要：实测它**会丢弃 `reset()` 后的第一个样本**（3 s / 20 s 阻塞只报 10 ms，见 ingest 档 `out/eld-reset-trap.txt`），
 *      任何在阻塞前 `reset()` 的用法都会把秒级阻塞测成毫秒级。
 * 因此这里改成"外部可观测的因果代理"：**refresh 期间持续对轻量端点打心跳，记录其墙钟延迟**。
 *   - worker 化生效 ⇒ 心跳延迟应保持在**数十毫秒**量级（判据 <100 ms）
 *   - 若仍同步阻塞主线程 ⇒ 心跳会出现**秒级**尖峰（与已知的 2.68 s / 36.1 s 同量级）
 *
 * 用法：node tools/g1-live.mjs [--heartbeat-ms 50] [--timeout-s 180]
 * 退出码：0 = G1 PASS（max < 100 ms）；2 = FAIL；3 = 前置不足（refresh 未真正跑起来）
 */
import { setTimeout as sleep } from 'node:timers/promises';

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const HB = Number(argOf('heartbeat-ms', 50));
const TIMEOUT_S = Number(argOf('timeout-s', 180));
const BASE = 'http://127.0.0.1:3080';

const rpc = async (path, method, payload = {}) => {
  const t0 = performance.now();
  try {
    const r = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: `g1-${Math.random().toString(36).slice(2)}`, method, payload }),
      signal: AbortSignal.timeout(120000),
    });
    const j = await r.json();
    return { ms: performance.now() - t0, ok: j?.result?.ok === true, value: j?.result?.value };
  } catch (e) {
    return { ms: performance.now() - t0, ok: false, error: String(e.message || e) };
  }
};

// 基线：静默期心跳
const baseline = [];
for (let i = 0; i < 20; i++) { const r = await rpc('/api/host.describe', 'host.describe'); baseline.push(r.ms); await sleep(HB); }
baseline.sort((a, b) => a - b);
const p = (a, q) => a[Math.min(a.length - 1, Math.floor(a.length * q))];
console.log(`[baseline] n=${baseline.length} min=${baseline[0].toFixed(1)} p50=${p(baseline, .5).toFixed(1)} max=${baseline[baseline.length - 1].toFixed(1)} ms`);

const pre = await rpc('/usage/status', 'status');
console.log(`[pre] lastIngest=${pre.value?.lastIngest} eventsDsh=${pre.value?.eventsDsh}`);

// 触发一次完整 ingest（refresh 直接调 runIngest），期间持续心跳
const refreshPromise = rpc('/usage/refresh', 'refresh');
const beats = [];
let done = false;
refreshPromise.then(() => { done = true; });
const t0 = performance.now();
while (!done && performance.now() - t0 < TIMEOUT_S * 1000) {
  const b = await rpc('/api/host.describe', 'host.describe');
  beats.push(b.ms);
  await sleep(HB);
}
const refresh = await refreshPromise;
const post = await rpc('/usage/status', 'status');
console.log(`[refresh] wall=${refresh.ms.toFixed(0)} ms ok=${refresh.ok}`);
console.log(`[post] lastIngest=${post.value?.lastIngest} eventsDsh=${post.value?.eventsDsh} scanned=${post.value?.scannedDsh} failed=${post.value?.failedDsh}/${post.value?.failedCc}`);

beats.sort((a, b) => a - b);
const max = beats.length ? beats[beats.length - 1] : 0;
console.log(`[heartbeat during pass] n=${beats.length} p50=${(beats.length ? p(beats, .5) : 0).toFixed(1)} p95=${(beats.length ? p(beats, .95) : 0).toFixed(1)} max=${max.toFixed(1)} ms`);

const advanced = (post.value?.lastIngest ?? 0) > (pre.value?.lastIngest ?? 0);
if (!refresh.ok) { console.log('[verdict] PRECONDITION-FAILED（refresh 未成功，G1 不可判）'); process.exit(3); }
console.log(`[verdict] lastIngest 推进=${advanced}  G1(心跳 max < 100ms)=${max < 100 ? 'PASS' : 'FAIL'}`);
process.exit(max < 100 ? 0 : 2);
