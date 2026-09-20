// 门槛测量协议：固定条件 + 重复 N 次 + 区间统计 + 双口径 WS 计数 + 会话规模
// 用法: node probes/threshold-run.mjs [--reps 5] [--window 20] [--out reports/threshold-<phase>.json] [--tag pre-restart]
//
// 目的（针对独立审计的方法学批评）：
//  1. 单次点值不可作为门槛判定 → 本协议每相重复 reps 次，报告中位数与 [min,max]；
//  2. 会话规模 N 必须实测（旧探针缺 RPC 信封、恒 null）→ 复用修好的 RPC 抓取，分列 items/envelope/items_bytes；
//  3. WS 负载必须双口径记录，基线用的是「事件种类」而非信封类型 → 同时记 envelope_type 与 event_kind；
//  4. 逐帧归一化：给出 script_ms per 1000 frames，用于跨负载比较（负载不同则点值不可比）。
//
// ⚠️ 有效前提（实测教训）：门槛是在「活跃流式」条件下定义的，而探针**无法自己制造流式负载**。
//    必须在有真实流式输出正在进行时运行本协议（例如主 agent 正在生成、或并发派发长输出子代理），
//    并**先看 ws/s 列**：>= 50 帧/s 才与历史基线（73 帧/s）同量级、结果才可用于门槛判定；
//    若 ws/s ≈ 0，则本次只是「静默态」参考值，不可用于判定（脚本会打印显式告警）。
//    静默态实测参考（2026-09-20，重启前）：idle 0.3–0.4 ms/s、p99 16.8ms、>50ms 0 —— 这是「安静时的下限」，
//    不是补丁收益的度量。
import { chromium } from 'playwright';
import fs from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const REPS = Number(arg('--reps', '5'));
const WIN = Number(arg('--window', '20'));
const TAG = arg('--tag', 'unlabeled');
const OUT = arg('--out', `/tmp/threshold-${TAG}.json`);
const URL = 'http://127.0.0.1:3080';
const r1 = (x) => Math.round(x * 10) / 10;
const KINDS = ['session/event', 'session/status', 'session/jobs', 'session/projection', 'assistant/message', 'tool', 'subagent'];

const INSTALL = () => {
  window.__th = { frames: [], wsTotal: 0, env: {}, kind: {}, winStart: performance.now(), t0: performance.now() };
  let last = performance.now();
  const tick = (t) => { window.__th.frames.push(t - last); last = t; window.__th.raf = requestAnimationFrame(tick); };
  window.__th.raf = requestAnimationFrame(tick);
  const Orig = window.WebSocket;
  window.WebSocket = function (...a) {
    const ws = new Orig(...a);
    ws.addEventListener('message', (ev) => {
      window.__th.wsTotal += 1;
      const s = typeof ev.data === 'string' ? ev.data : '';
      let t = 'binary';
      try { t = JSON.parse(s)?.type ?? 'unparsed'; } catch { t = s ? 'unparsed' : 'binary'; }
      window.__th.env[t] = (window.__th.env[t] || 0) + 1;
      for (const k of ['session/event', 'session/status', 'session/jobs', 'session/projection', 'assistant/message', 'tool', 'subagent'])
        if (s.includes(k)) window.__th.kind[k] = (window.__th.kind[k] || 0) + 1;
    });
    return ws;
  };
  window.WebSocket.prototype = Orig.prototype;
};

const run = async () => {
  const b = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.addInitScript(INSTALL);
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);

  // 会话规模（修好的 RPC 抓取）
  const scale = await page.evaluate(async () => {
    const body = JSON.stringify({ type: 'client-request', rpcId: (crypto.randomUUID ? crypto.randomUUID() : String(Math.random())), method: 'session.list', payload: {} });
    const res = await fetch('/api/session.list', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    const text = await res.text(); const out = { status: res.status, envelope_bytes: text.length };
    try {
      const list = JSON.parse(text)?.result?.value?.items ?? null;
      if (Array.isArray(list)) {
        out.items = list.length;
        out.items_bytes = JSON.stringify(list).length;
        out.top_level = list.filter((x) => x && x.origin !== 'subagent').length;
        out.subagent = list.filter((x) => x && x.origin === 'subagent').length;
      }
    } catch { }
    return out;
  });

  const sample = async (phase) => {
    await page.evaluate(() => { window.__th.frames = []; window.__th.wsTotal = 0; window.__th.env = {}; window.__th.kind = {}; window.__th.winStart = performance.now(); });
    const m0 = (await cdp.send('Performance.getMetrics')).metrics;
    const g = (ms, n) => ms.find((x) => x.name === n)?.value ?? 0;
    const s0 = g(m0, 'ScriptDuration');
    await page.waitForTimeout(WIN * 1000);
    const m1 = (await cdp.send('Performance.getMetrics')).metrics;
    const script = (g(m1, 'ScriptDuration') - s0) * 1000;
    const st = await page.evaluate(() => {
      const f = window.__th.frames.slice(1);
      const d = f.slice().sort((a, b) => a - b);
      const q = (p) => (d.length ? Number(d[Math.min(d.length - 1, Math.floor(d.length * p))].toFixed(2)) : null);
      return {
        frame_p50: q(0.5), frame_p95: q(0.95), frame_p99: q(0.99), frame_max: d.length ? Number(d[d.length - 1].toFixed(2)) : null,
        over_50ms: f.filter((x) => x > 50).length, frames: f.length,
        ws_total: window.__th.wsTotal, envelope_type: { ...window.__th.env }, event_kind: { ...window.__th.kind },
        dom_nodes: document.querySelectorAll('*').length,
      };
    });
    return {
      phase, window_sec: WIN, script_ms: r1(script), script_ms_per_s: r1(script / WIN),
      ...st,
      ws_per_s: r1(st.ws_total / WIN),
      // 逐帧归一化：每 1000 个 WS 帧消耗的主线程脚本毫秒（跨负载可比的代理指标）
      script_ms_per_1k_frames: st.ws_total > 0 ? r1((script / st.ws_total) * 1000) : null,
    };
  };

  const med = (arr) => { const s = arr.slice().sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : r1((s[s.length / 2 - 1] + s[s.length / 2]) / 2)) : null; };
  const agg = (rows, key) => {
    const v = rows.map((r) => r[key]).filter((x) => typeof x === 'number');
    return v.length ? { median: med(v), min: Math.min(...v), max: Math.max(...v) } : null;
  };

  const phases = {};
  const collect = async (name, prep) => {
    if (prep) await prep();
    await page.waitForTimeout(2500);
    const rows = [];
    for (let i = 0; i < REPS; i++) rows.push(await sample(`${name}#${i + 1}`));
    phases[name] = {
      reps: REPS,
      script_ms_per_s: agg(rows, 'script_ms_per_s'),
      frame_p99: agg(rows, 'frame_p99'),
      frame_max: agg(rows, 'frame_max'),
      over_50ms: agg(rows, 'over_50ms'),
      ws_per_s: agg(rows, 'ws_per_s'),
      script_ms_per_1k_frames: agg(rows, 'script_ms_per_1k_frames'),
      event_kind_total: rows.reduce((a, r) => { for (const k in r.event_kind) a[k] = (a[k] || 0) + r.event_kind[k]; return a; }, {}),
      envelope_type_total: rows.reduce((a, r) => { for (const k in r.envelope_type) a[k] = (a[k] || 0) + r.envelope_type[k]; return a; }, {}),
      dom_nodes: rows[rows.length - 1].dom_nodes,
      rows,
    };
  };

  await collect('idle');
  await collect('settings-open', async () => {
    await page.locator('button:has-text("设置")').first().click().catch(() => { });
    await page.waitForTimeout(2000);
  });

  const out = { tag: TAG, url: URL, reps: REPS, window_sec: WIN, ts: new Date().toISOString(), session_list: scale, phases, console_errors: errs.slice(0, 5) };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`\n===== 门槛测量（tag=${TAG}, reps=${REPS}×${WIN}s）=====`);
  console.log(`会话规模: items=${scale.items} 非sub=${scale.top_level} sub=${scale.subagent} items_bytes=${scale.items_bytes} 信封=${scale.envelope_bytes}`);
  console.log(`${'phase'.padEnd(14)} ${'script/s(中位)'.padStart(14)} ${'[min,max]'.padStart(16)} ${'p99(中位)'.padStart(10)} ${'>50ms(中位)'.padStart(12)} ${'ws/s(中位)'.padStart(11)} ${'ms/1k帧'.padStart(9)}`);
  const cell = (a, k = 'median') => a && typeof a[k] === 'number' ? String(a[k]) : '-';
  for (const [name, p] of Object.entries(phases)) {
    const range = p.script_ms_per_s ? `[${p.script_ms_per_s.min},${p.script_ms_per_s.max}]` : '[-, -]';
    console.log(`${name.padEnd(14)} ${cell(p.script_ms_per_s).padStart(14)} ${range.padStart(16)} `
      + `${cell(p.frame_p99).padStart(10)} ${cell(p.over_50ms).padStart(12)} ${cell(p.ws_per_s).padStart(11)} ${cell(p.script_ms_per_1k_frames).padStart(9)}`);
  }
  if (Object.values(phases).every((p) => !p.ws_per_s || p.ws_per_s.median === 0)) {
    console.log('\n⚠️ 本次测量期间 WS 事件流基本为空（系统空闲）——门槛是在「活跃流式」条件下定义的，');
    console.log('   此结果只代表静默态，不能用于门槛判定。请在负载发生器中运行时重跑（见 RUNBOOK §四）。');
  }
  console.log(`\n事件种类合计(idle): ${JSON.stringify(phases.idle.event_kind_total)}`);
  console.log(`信封类型合计(idle): ${JSON.stringify(phases.idle.envelope_type_total)}`);
  console.log(`\n已写出 ${OUT}`);
  await b.close();
};
run().catch((e) => { console.error('FATAL', e); process.exit(1); });
