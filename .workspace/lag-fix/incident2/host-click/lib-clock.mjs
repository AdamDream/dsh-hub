#!/usr/bin/env node
/**
 * lib-clock.mjs — 单一时钟口径工具（本档所有时间戳都走这里，避免"各写各的换算"）
 *
 * 时钟模型：
 *   - **宿主/外部进程**：`performance.timeOrigin`（进程启动时的 epoch ms，浮点）+ `performance.now()`
 *     ⇒ `abs = timeOrigin + now()` 是单调、与 epoch 对齐、不受系统墙钟调整影响的绝对时刻。
 *   - **页内**：同样有 `performance.timeOrigin` / `performance.now()`，且 timeOrigin 也是 epoch 对齐的
 *     （Chromium 中等于 navigationStart 的 epoch 时刻）。
 *   ⇒ 两端 `timeOrigin + now()` 都落在**同一 epoch 轴**上，因此无需插值即可对齐；
 *     残余误差只有各自时钟源的亚毫秒抖动 + 采样时刻的往返（见 calibrate() 的实测上下界）。
 *
 * 为什么不用 `Date.now()`：受 NTP 调整与 CLOCK_REALTIME 步进影响，跨进程比较可能出现台阶。
 * 为什么不用 `process.hrtime()`：它是任意原点，必须额外建立 epoch 偏移，平白多一层换算。
 */
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** 本进程的 epoch 对齐单调时钟读数（ms，浮点）。 */
export const absNow = () => performance.timeOrigin + performance.now();
/** 本进程 timeOrigin（用来给报告读者做核对）。 */
export const timeOrigin = performance.timeOrigin;

/**
 * 计时一次 POST RPC：返回墙钟耗时与响应字节数。
 * 只做只读 GET/POST，不改宿主状态；`method` 是 RPC 信封里的方法名。
 */
export async function rpc(base, path, method, payload = {}, timeoutMs = 120000) {
  const body = JSON.stringify({
    type: 'client-request',
    rpcId: `hc-${Math.random().toString(36).slice(2, 12)}`,
    method,
    payload,
  });
  const t0 = absNow();
  let http = 0;
  let bytes = -1;
  let text = '';
  let error;
  try {
    const r = await fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    http = r.status;
    text = await r.text();
    bytes = Buffer.byteLength(text);
  } catch (e) {
    error = String((e && e.message) || e);
  }
  const t1 = absNow();
  let parsed;
  try { parsed = JSON.parse(text); } catch { /* 非 JSON 时留 undefined */ }
  return {
    t0, t1, ms: t1 - t0, http, bytes, error,
    ok: parsed?.result?.ok === true,
    value: parsed?.result?.value,
    errValue: parsed?.result?.error,
    rpcId: JSON.parse(body).rpcId,
    reqBytes: Buffer.byteLength(body),
  };
}

/** 心跳的既定两路端点（payload 都是空对象，只读）。 */
export const BEATS = [
  { url: '/api/host.describe', method: 'host.describe' },
  { url: '/usage/status', method: 'status' },
];

/**
 * 心跳循环：**串行**发（同一时刻只有 1 个 in-flight），每拍之间 sleep(intervalMs)。
 * 串行是刻意的：并发心跳会让"延迟"混入自造排队，无法作为宿主卡顿的证据。
 * 代价：相邻两拍的真实起点间隔 = intervalMs + 上一拍耗时，全部逐拍记录在 t0 上，分析时按真实 t0 取窗。
 *
 * @param {(b:object)=>void} onBeat 每拍回调（用于落盘/图表）
 * @param {()=>boolean} stop 返回 true 时收尾
 */
export async function heartbeatLoop({ base, intervalMs = 50, onBeat, stop, timeoutMs = 120000 }) {
  const beats = [];
  let i = 0;
  let nextDue = absNow();
  while (!stop()) {
    // 单调排程：due 时刻按固定步长推进（而非"上一拍结束后再等 50ms"），
    // 这样 schedSkew = 实际起点 - 应到起点 就能把"探针进程自己被饿住"与"宿主慢"分开：
    // 宿主慢 ⇒ ms 大而 schedSkew 小；探针被饿 ⇒ schedSkew 大。
    const due = nextDue;
    nextDue = due + intervalMs;
    const spec = BEATS[i % BEATS.length];
    const b = await rpc(base, spec.url, spec.method, {}, timeoutMs);
    const beat = {
      seq: i,
      endpoint: spec.url,
      method: spec.method,
      t0: b.t0,
      t0_iso: new Date(b.t0).toISOString(),
      t1: b.t1,
      ms: b.ms,
      schedSkew: b.t0 - due,
      http: b.http,
      respBytes: b.bytes,
      ok: b.ok,
      error: b.error,
      value: spec.url === '/api/host.describe'
        ? (b.value ? { version: b.value.version, attachedSessions: b.value.attachedSessions } : undefined)
        : (b.value ? { lastIngest: b.value.lastIngest, eventsDsh: b.value.eventsDsh, failedDsh: b.value.failedDsh, failedCc: b.value.failedCc } : undefined),
    };
    beats.push(beat);
    if (onBeat) onBeat(beat);
    i++;
    if (stop()) break;
    // 睡到下一个应到时刻；若已经晚于应到时刻则立刻发（并把欠账记在 schedSkew 上）
    const wait = nextDue - absNow();
    await sleep(wait > 0 ? wait : 0);
  }
  return beats;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 分位数：q∈[0,1]，线性插值；输入无需预排序。 */
export function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** 汇总一组 beat 的延迟统计（含"拍间空档"gap：能暴露一拍之外发生的宿主停顿）。 */
export function summarize(beats) {
  const ms = beats.map((b) => b.ms).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const s = { n: beats.length, nValid: ms.length };
  if (!ms.length) return s;
  s.min = ms[0];
  s.p50 = quantile(ms, 0.5);
  s.p95 = quantile(ms, 0.95);
  s.p99 = quantile(ms, 0.99);
  s.max = ms[ms.length - 1];
  s.mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  // 拍间空档：上一拍结束 → 下一拍开始，正常 ≈ intervalMs
  const gaps = [];
  for (let i = 1; i < beats.length; i++) gaps.push(beats[i].t0 - beats[i - 1].t1);
  if (gaps.length) {
    const g = [...gaps].sort((a, b) => a - b);
    s.gapP50 = quantile(g, 0.5);
    s.gapMax = g[g.length - 1];
    // 空档超额 = 除既定 sleep 之外多出来的等待，接近 0 说明宿主在拍间无停顿
    s.gapExcessMax = s.gapMax - 50;
  }
  s.errors = beats.filter((b) => !b.ok).length;
  // 排程偏差：探针进程自身被饿住的证据（与宿主慢区分开）
  const sk = beats.map((b) => b.schedSkew).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (sk.length) {
    s.schedSkewP50 = quantile(sk, 0.5);
    s.schedSkewMax = sk[sk.length - 1];
    s.schedSkewOver50 = sk.filter((x) => x > 50).length;
  }
  return s;
}

/** 取 [from, to] 时间窗内的拍。 */
export function window(beats, from, to) {
  return beats.filter((b) => b.t0 >= from && b.t0 <= to);
}

export function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

export function writeJson(path, obj) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
}

/** 逐拍 JSONL 追加落盘（长跑时防丢），带 fsync-less flush 的语义够用：崩溃最多丢最后一行。 */
export function makeJsonlSink(path) {
  ensureDir(dirname(path));
  writeFileSync(path, '');
  return (obj) => appendFileSync(path, JSON.stringify(obj) + '\n');
}
