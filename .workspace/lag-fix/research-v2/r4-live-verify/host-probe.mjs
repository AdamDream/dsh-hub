#!/usr/bin/env node
/**
 * host-probe.mjs — R4 只读宿主行为探针。
 *
 * 只调用**只读** RPC：status / summary / timeseries / heatmap / byModel / byProject /
 * byDay / sessions，外加回归哨兵 session.list。不调用 /usage/refresh、不改任何配置。
 *
 * 目的：
 *  - 每个方法记录 wall time 与 ok 位（逐个只读调用）；
 *  - 低频（intervalMs）连续观测，跨越至少一个自然 45s ingest tick；
 *  - 用 status.lastIngest 的变化识别 tick 边界，并给出 tick 前/后窗口的 p95/max。
 * 有界超时：单次 fetch 超时 abortMs，避免探针自己挂死。
 *
 * 用法：node host-probe.mjs --seconds 150 --interval 3000
 */
import { writeFileSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i === -1 ? d : Number(process.argv[i + 1]); };
const SECONDS = arg('--seconds', 150);
const INTERVAL = arg('--interval', 3000);
const ABORT_MS = arg('--abort', 20000);
const BASE = 'http://127.0.0.1:3080';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/r4-live-verify/raw/host-probe.json';

const now = Date.now();
const RANGE = { from: now - 7 * 86400000, to: now, dataSources: 'all' };

const CALLS = [
  ['status', 'status', {}],
  ['summary', 'summary', RANGE],
  ['timeseries', 'timeseries', { granularity: 'day', from: RANGE.from, to: RANGE.to, dataSources: 'all' }],
  ['timeseries', 'timeseries-hour', { granularity: 'hour', from: now - 24 * 3600000, to: now, dataSources: 'all' }],
  ['heatmap', 'heatmap', { year: new Date(now).getFullYear(), dataSources: 'all' }],
  ['byModel', 'byModel', RANGE],
  ['byProject', 'byProject', RANGE],
  ['byDay', 'byDay', RANGE],
  ['sessions', 'sessions', { from: RANGE.from, to: RANGE.to, dataSources: 'all', limit: 200 }],
];

const out = {
  at: new Date().toISOString(), base: BASE, seconds: SECONDS, intervalMs: INTERVAL,
  calls: [], ticks: [], samples: [], errors: [], summary: {}, sessionList: [], sentinels: {},
};

async function rpc(path, method, payload) {
  const body = { type: 'client-request', rpcId: `r4verify-${Math.random().toString(36).slice(2, 10)}`, method, payload };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ABORT_MS);
  const t0 = performance.now();
  try {
    const res = await fetch(BASE + path, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: ac.signal,
    });
    const text = await res.text();
    const wall = performance.now() - t0;
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return {
      wall: Number(wall.toFixed(1)), http: res.status, ok: json?.result?.ok ?? null,
      errorCode: json?.result?.error?.code ?? null, bytes: text.length,
      valueShape: json?.result?.value === undefined ? null
        : Array.isArray(json.result.value) ? `array[${json.result.value.length}]`
        : typeof json.result.value === 'object' && json.result.value !== null ? `object{${Object.keys(json.result.value).slice(0, 10).join(',')}}`
        : String(json.result.value).slice(0, 40),
      valueJson: json?.result?.value === undefined ? null : JSON.stringify(json.result.value).slice(0, 3000),
      raw: text.slice(0, 300),
    };
  } catch (e) {
    return { wall: Number((performance.now() - t0).toFixed(1)), http: null, ok: null, errorCode: 'PROBE_' + (e.name || 'ERR'), bytes: 0, valueShape: null, raw: String(e.message).slice(0, 200) };
  } finally { clearTimeout(timer); }
}

const pct = (arr, p) => {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return Number(s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)].toFixed(1));
};

const deadline = Date.now() + SECONDS * 1000;
let round = 0;
let lastIngestSeen = null;

while (Date.now() < deadline) {
  round += 1;
  const roundAt = new Date().toISOString();
  for (const [method, label, payload] of CALLS) {
    const path = `/usage/${method}`;
    const r = await rpc(path, method, payload);
    out.calls.push({ round, at: roundAt, label, method, ...r });
    if (method === 'status' && r.valueJson) {
      try {
        const v = JSON.parse(r.valueJson);
        if (v && v.lastIngest !== undefined) {
          if (lastIngestSeen !== null && v.lastIngest !== lastIngestSeen) {
            out.ticks.push({ detectedAt: new Date().toISOString(), prevLastIngest: lastIngestSeen, newLastIngest: v.lastIngest, deltaMs: v.lastIngest - lastIngestSeen });
          }
          lastIngestSeen = v.lastIngest;
          out.samples.push({ at: roundAt, lastIngest: v.lastIngest, eventsDsh: v.eventsDsh, eventsCc: v.eventsCc, dbPath: v.dbPath, dbSource: v.dbSource });
        }
      } catch { /* shape drift */ }
    }
  }
  // 回归哨兵：session.list（独立路径，非 usage 插件）
  const sl = await rpc('/api/session.list', 'session.list', {});
  out.calls.push({ round, at: roundAt, label: 'session.list', method: 'session.list', ...sl });
  if (sl.ok && sl.valueJson) {
    try {
      const v = JSON.parse(sl.valueJson);
      out.sessionList.push({ round, at: roundAt, entries: Array.isArray(v) ? v.length : null, topLevel: Array.isArray(v) ? v.filter((e) => !e?.parentId && !e?.parentSessionId).length : null, keys: Array.isArray(v) && v[0] ? Object.keys(v[0]).slice(0, 20) : null });
    } catch { /* ignore */ }
  }
  await new Promise((r) => setTimeout(r, INTERVAL));
}

// ── 汇总 ──────────────────────────────────────────────────────────────────
const byLabel = {};
for (const c of out.calls) {
  (byLabel[c.label] ??= []).push(c);
}
const firstTick = out.ticks.length > 0 ? new Date(out.ticks[0].detectedAt).getTime() : null;
out.summary.byLabel = Object.fromEntries(Object.entries(byLabel).map(([k, arr]) => {
  const walls = arr.map((c) => c.wall);
  const okCount = arr.filter((c) => c.ok === true).length;
  const r1 = arr.filter((c) => c.round === 1).map((c) => c.wall);
  return [k, {
    n: arr.length, okTrue: okCount,
    okRate: `${okCount}/${arr.length}`,
    firstRoundWall: r1[0] ?? null,
    min: Math.min(...walls), p50: pct(walls, 50), p95: pct(walls, 95), max: Math.max(...walls),
    maxAt: arr.find((c) => c.wall === Math.max(...walls))?.at ?? null,
  }];
}));
out.summary.tickCount = out.ticks.length;
out.summary.ticks = out.ticks;
out.summary.sentinel = {
  sessionListRounds: out.sessionList.length,
  entryCounts: [...new Set(out.sessionList.map((s) => s.entries))],
  topLevelCounts: [...new Set(out.sessionList.map((s) => s.topLevel))],
  entryKeys: out.sessionList[0]?.keys ?? null,
  stable: new Set(out.sessionList.map((s) => `${s.entries}/${s.topLevel}`)).size <= 1,
};

writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`rounds=${round} calls=${out.calls.length} ticks=${out.ticks.length}`);
for (const [k, v] of Object.entries(out.summary.byLabel)) {
  console.log(`  ${k.padEnd(18)} ok=${v.okRate} min=${v.min} p50=${v.p50} p95=${v.p95} max=${v.max} (maxAt ${v.maxAt})`);
}
console.log('session.list sentinel:', JSON.stringify(out.summary.sentinel));
console.log('ticks:', JSON.stringify(out.ticks));
