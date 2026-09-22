#!/usr/bin/env node
/**
 * host-drift.mjs — 后台"宿主静止基线"心跳：**不涉及浏览器**，直接把宿主自身的响应分布钉下来。
 *
 * 用途（本档的关键对照面）：
 *   若"点击设置"的窗口内出现秒级停顿，但**同一分钟、无任何页面活动时**宿主也出现同级停顿，
 *   那该停顿与点击无因果关系（属于宿主的既有周期性负载）；
 *   反之若静止基线干净、只有点击窗口出现尖峰，则因果成立。
 *
 * 纪律：只打两个只读端点（POST /api/host.describe、POST /usage/status），串行、无写操作。
 *
 * 用法：node host-drift.mjs --duration-s 600 --interval-ms 50 --out ../raw/host-drift-<tag>.json [--tag ambient]
 */
import { rpc, BEATS, summarize, writeJson, makeJsonlSink, absNow, sleep } from './lib-clock.mjs';

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const BASE = argOf('base', 'http://127.0.0.1:3080');
const DUR_S = Number(argOf('duration-s', 600));
const INT = Number(argOf('interval-ms', 50));
const TAG = argOf('tag', 'ambient');
const OUT = argOf('out', `../raw/host-drift-${TAG}.json`);

const t0 = absNow();
const deadline = t0 + DUR_S * 1000;
const jsonl = makeJsonlSink(OUT.replace(/\.json$/, '.jsonl'));
const beats = [];
let i = 0;
let nextDue = absNow();
console.log(`[host-drift] tag=${TAG} start=${new Date(t0).toISOString()} duration=${DUR_S}s interval=${INT}ms -> ${OUT}`);
process.on('SIGTERM', finish);
process.on('SIGINT', finish);

while (absNow() < deadline) {
  const spec = BEATS[i % BEATS.length];
  const due = nextDue;
  nextDue = due + INT;
  const b = await rpc(BASE, spec.url, spec.method, {});
  const beat = {
    seq: i, tag: TAG, endpoint: spec.url,
    t0: b.t0, t1: b.t1, ms: b.ms, schedSkew: b.t0 - due, http: b.http, respBytes: b.bytes, ok: b.ok, error: b.error,
  };
  beats.push(beat);
  jsonl(beat);
  if (b.ms >= 100) console.log(`[STALL] t=${beat.t0.toFixed(0)} ${spec.url} ${b.ms.toFixed(1)} ms (seq ${i})`);
  i++;
  const wait = nextDue - absNow();
  await sleep(wait > 0 ? wait : 0);
}
finish();

function finish() {
  const s = summarize(beats);
  const out = {
    kind: 'host-drift-baseline',
    tag: TAG,
    base: BASE,
    startedAt: t0, startedAtIso: new Date(t0).toISOString(),
    endedAt: absNow(), requestedDurationS: DUR_S, intervalMs: INT,
    nBeats: beats.length,
    summary: s,
    stalls: beats.filter((b) => b.ms >= 100).map((b) => ({ t0: b.t0, iso: new Date(b.t0).toISOString(), endpoint: b.endpoint, ms: b.ms })),
  };
  writeJson(OUT, out);
  console.log(`[host-drift] done n=${beats.length} p50=${s.p50?.toFixed(1)} p95=${s.p95?.toFixed(1)} max=${s.max?.toFixed(1)} stalls>=100ms=${out.stalls.length}`);
  process.exit(0);
}
