// ============================================================================
// cpu-profile v3: fixes MutationObserver install timing (DOM-root must exist),
// adds interaction-transition scenarios (settings open / tab switch), which is
// where user-perceived jank actually lands. Read-only on the app.
// ============================================================================
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const URL = 'http://127.0.0.1:3080';
const BASE = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/cpu-profile';
const RAW = path.join(BASE, 'raw'); const OUT = path.join(BASE, 'out');
fs.mkdirSync(RAW, { recursive: true }); fs.mkdirSync(OUT, { recursive: true });
const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const SCEN = argOf('scenarios', 'all');
const WIN_MS = Number(argOf('win', 12000));
const REPS = Number(argOf('reps', 4));
const STAMP = argOf('stamp', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
const SETTLE = Number(argOf('settle', 1500));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

const INIT_HOOKS = () => {
  if (window.__cpu) return;
  const S = { raf: [], lt: [], et: [], mu: [], muReady: false, muErr: null, view: 'v0', rafInside: 0, clicks: [] };
  window.__cpu = S;
  requestAnimationFrame(function rafLoop(t) { S.raf.push(t); S.rafInside++; requestAnimationFrame(rafLoop); });
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) S.lt.push({ s: e.startTime, d: e.duration, n: e.name }); }).observe({ entryTypes: ['longtask'] }); } catch { }
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (e.entryType === 'event' || e.entryType === 'first-input') S.et.push({ n: e.name, s: e.startTime, d: e.duration, p: e.processingStart }); } })
      .observe({ type: 'event', durationThreshold: 16, buffered: false });
  } catch { }
  // click->next-paint proxy: record click time and the first paint after it
  try {
    window.addEventListener('pointerdown', (e) => { S.clicks.push({ t: performance.now(), x: e.clientX, y: e.clientY, painted: null }); }, true);
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { const c = S.clicks[S.clicks.length - 1]; if (c && c.painted == null && e.startTime > c.t) c.painted = e.startTime; } }).observe({ entryTypes: ['paint'] }); } catch { }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { const c = S.clicks[S.clicks.length - 1]; if (c && c.painted == null && e.startTime > c.t) c.painted = e.startTime; } }).observe({ type: 'paint', buffered: false }); } catch { }
  const installMO = () => {
    if (S.muReady) return;
    const root = document.documentElement;
    if (!root) { S.muErr = 'no documentElement yet'; return; }
    try {
      const obs = new MutationObserver((recs) => {
        let added = 0, removed = 0, attrs = 0, chars = 0; const targets = {};
        for (const r of recs) {
          if (r.type === 'childList') { added += r.addedNodes.length; removed += r.removedNodes.length; }
          else if (r.type === 'attributes') { attrs++; const k = (r.target.nodeName || '?') + '@' + (r.attributeName || ''); targets[k] = (targets[k] || 0) + 1; }
          else if (r.type === 'characterData') chars++;
        }
        S.mu.push({ t: performance.now(), n: recs.length, added, removed, attrs, chars, targets });
      });
      obs.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
      S.muReady = true;
    } catch (e) { S.muErr = String(e); }
  };
  installMO();
  document.addEventListener('readystatechange', installMO);
  window.addEventListener('DOMContentLoaded', installMO);
};
const RESET = () => {
  const S = window.__cpu; if (!S) return { ok: false, reason: 'no __cpu' };
  const out = { ok: true, muReady: S.muReady, muErr: S.muErr, rafBefore: S.raf.length, ltBefore: S.lt.length, etBefore: S.et.length, muBefore: S.mu.length, prevView: S.view };
  S.raf.length = 0; S.lt.length = 0; S.et.length = 0; S.mu.length = 0; S.clicks.length = 0; S.rafInside = 0;
  window.__viewSeq = (window.__viewSeq || 0) + 1; S.view = 'v' + window.__viewSeq;
  return out;
};
const COLLECT = () => {
  const r3v = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x);
  const S = window.__cpu || { raf: [], lt: [], et: [], mu: [], view: null, rafInside: 0, clicks: [], muReady: false, muErr: null };
  const t0 = S.clicks.length ? Math.min(...S.clicks.map((c) => c.t)) : null;
  return {
    view: S.view, rafInside: S.rafInside, muReady: S.muReady, muErr: S.muErr,
    raf: S.raf.slice(), lt: S.lt.slice(), et: S.et.slice(),
    clicks: S.clicks.map((c) => ({ relMs: t0 == null ? null : r3v(c.t - t0), t: r3v(c.t), painted: c.painted == null ? null : r3v(c.painted), clickToPaint: c.painted == null ? null : r3v(c.painted - c.t) })),
    muCount: S.mu.length,
    mu: S.mu.reduce((a, m) => ({ n: a.n + m.n, added: a.added + m.added, removed: a.removed + m.removed, attrs: a.attrs + m.attrs, chars: a.chars + m.chars }), { n: 0, added: 0, removed: 0, attrs: 0, chars: 0 }),
    muTargets: (() => { const t = {}; for (const m of S.mu) for (const [k, v] of Object.entries(m.targets || {})) t[k] = (t[k] || 0) + v; return Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 10); })(),
    href: location.href, nodes: document.getElementsByTagName('*').length,
    selectedRow: (() => { const s = document.querySelector('[role=treeitem][aria-selected=true]'); return s ? (s.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80) : null; })(),
    sessionHeader: (document.querySelector('header')?.innerText || '').replace(/\s+/g, ' ').slice(0, 130),
    activeSettingsTab: [...document.querySelectorAll('[class*=navCell]')].filter((b) => /active/.test(b.className)).map((b) => (b.innerText || '').trim())[0] || null,
  };
};

function classifyFrame(str, dir) {
  let o = null; if (str.length < 500000) { try { o = JSON.parse(str); } catch { } }
  const j = o || {};
  const m = (re) => { re.lastIndex = 0; const x = re.exec(str); return x ? x[1] : null; };
  const T = /"type"\s*:\s*"([^"]{1,64})"/g, M = /"method"\s*:\s*"([^"]{1,64})"/g, R = /"root"\s*:\s*"([^"]{1,64})"/g;
  const payload = (j.payload && typeof j.payload === 'object') ? j.payload : null;
  return { dir, len: str.length, envelopeType: j.type ?? m(T), method: j.method ?? (j.request && j.request.method) ?? m(M), root: j.root ?? m(R), payloadType: payload ? (payload.type ?? payload.kind ?? null) : null, payloadMethod: payload ? payload.method : null, keys: Object.keys(j).slice(0, 8), preview: str.slice(0, 160) };
}
const frameKind = (f) => f.method || (f.payloadMethod ? 'p:' + f.payloadMethod : null) || (f.root ? 'root:' + f.root : null) || f.envelopeType || 'unknown';

function aggregate(profile) {
  const byId = new Map(); for (const n of profile.nodes) byId.set(n.id, n);
  const self = new Map(); let total = 0;
  for (const s of profile.samples || []) { self.set(s, (self.get(s) || 0) + 1); total++; }
  const deltas = profile.timeDeltas || []; let interval = 1000;
  if (deltas.length >= 20) { const so = [...deltas].sort((a, b) => a - b); interval = so[Math.floor(so.length / 2)] || 1000; }
  const msPerSample = interval / 1000;
  const rows = [];
  for (const [id, cnt] of self) {
    const n = byId.get(id); if (!n) continue; const cf = n.callFrame || {};
    rows.push({ fn: cf.functionName || '(anonymous)', url: cf.url || '', line: (cf.lineNumber ?? -1) + 1, col: (cf.columnNumber ?? -1) + 1, selfMs: r3(cnt * msPerSample), selfPct: r3((cnt / (total || 1)) * 100), samples: cnt });
  }
  rows.sort((a, b) => b.selfMs - a.selfMs);
  const buckets = new Map();
  for (const r of rows) {
    const u = r.url; let key;
    if (!u) key = '(no-url:native/vm)';
    else if (/dsh-client-runtime/.test(u)) key = 'dsh-client-runtime';
    else if (/dsh-workspace-enhancement/.test(u)) key = 'C2:dsh-workspace-enhancement';
    else if (/dsh-usage/.test(u)) key = 'dsh-usage';
    else if (/dsh-client-ui-([a-z-]+)/.test(u)) key = 'ui:' + u.match(/dsh-client-ui-[a-z-]+/)[0];
    else if (/assets\/index-/.test(u)) key = 'shell:ext:index';
    else if (/dsh-[a-z-]+/.test(u)) key = u.match(/dsh-[a-z-]+/)[0];
    else key = 'ext:' + u.split('/').pop();
    const b = buckets.get(key) || { bundle: key, selfMs: 0, samples: 0, fns: 0, urls: new Set() };
    b.selfMs = r3(b.selfMs + r.selfMs); b.samples += r.samples; b.fns++; b.urls.add(u || '(none)'); buckets.set(key, b);
  }
  return { intervalUs: interval, msPerSample, sampleCount: total, nodeCount: profile.nodes.length, top: rows, bundles: [...buckets.values()].map((b) => ({ ...b, urls: [...b.urls].slice(0, 4) })).sort((a, b) => b.selfMs - a.selfMs) };
}

async function expandSidebar(page) {
  const projects = await page.evaluate(() => [...document.querySelectorAll('[class*=projectRow]')].map((r) => (r.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)));
  for (const t of projects) { try { await page.locator('[class*=projectRow]', { hasText: t }).first().click({ timeout: 1200 }); await sleep(180); } catch { } }
  await sleep(900);
}
async function openSession(page, title) {
  const probes = [title, title.replace(/^\d+\s*个子代理运行中\s*/, ''), title.replace(/^进行中\s*\d*\s*个子代理运行中\s*/, ''), title.slice(0, 12)];
  for (const p of probes) { try { const el = page.getByText(p, { exact: false }).first(); if (await el.count()) { await el.click({ timeout: 2500 }); await sleep(2200); return p; } } catch { } }
  return null;
}
const clickSettings = async (page) => { try { const l = page.locator('button:has-text("设置")').first(); if (await l.count()) { await l.click({ timeout: 2500 }); return true; } } catch { } return false; };
const clickTab = async (page, name) => { try { const l = page.locator(`[class*=navCell]:has-text("${name}")`).first(); if (await l.count()) { await l.click({ timeout: 2500 }); return true; } } catch { } return false; };

let SEQ = 0;
async function capture(bctx, page, wsLog, label, meta, ms, preAction) {
  const cdp = await bctx.newCDPSession(page);
  try {
    await cdp.send('Performance.enable');
    await page.evaluate(`(${RESET.toString()})()`);
    // prove the observer is alive: mutate a detached-free attribute, then read back
    const moSelfTest = await page.evaluate(() => {
      const d = document.createElement('div'); d.id = '__cpu_selftest';
      document.documentElement.appendChild(d);
      return new Promise((res) => setTimeout(() => {
        const recs = window.__cpu.mu.reduce((a, m) => a + m.n, 0);
        d.remove();
        setTimeout(() => res({ observedRecords: recs, muReady: window.__cpu.muReady, muErr: window.__cpu.muErr }), 30);
      }, 120));
    });
    await page.evaluate(() => { window.__cpu.mu.length = 0; });
    const wsIdx = wsLog.frames.length;
    const t0 = Date.now();
    const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.start');
    const tPs = Date.now();
    let actionInfo = null;
    if (preAction) { actionInfo = await preAction(); }
    await sleep(ms);
    const tPe = Date.now();
    const { profile } = await cdp.send('Profiler.stop');
    const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    const t1 = Date.now();
    const data = await page.evaluate(`(${COLLECT.toString()})()`);
    const frames = wsLog.frames.slice(wsIdx);
    const durS = (tPe - tPs) / 1000;
    const d = (k) => r3((m1[k] ?? 0) - (m0[k] ?? 0)); const per = (k) => r3(d(k) / durS);
    const raf = data.raf; const iv = raf.slice(1).map((t, i) => t - raf[i]);
    const stat = (a) => { if (!a.length) return { n: 0, p50: null, p95: null, p99: null, max: null, over50: 0, over100: 0 }; const x = [...a].sort((p, q) => p - q); const q = (v) => r3(x[Math.min(x.length - 1, Math.floor((x.length - 1) * v))]); return { n: x.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: r3(x[x.length - 1]), over50: a.filter((v) => v > 50).length, over100: a.filter((v) => v > 100).length }; };
    const byKind = {}, byRoot = {}, byPayloadType = {}, byEnvelope = {}, dirs = { in: 0, out: 0 }; let bytesIn = 0;
    for (const f of frames) { dirs[f.dir] = (dirs[f.dir] || 0) + 1; if (f.dir === 'in') bytesIn += f.len; const k = frameKind(f); byKind[k] = (byKind[k] || 0) + 1; if (f.root) byRoot[f.root] = (byRoot[f.root] || 0) + 1; if (f.payloadType) byPayloadType[f.payloadType] = (byPayloadType[f.payloadType] || 0) + 1; if (f.envelopeType) byEnvelope[f.envelopeType] = (byEnvelope[f.envelopeType] || 0) + 1; }
    const agg = aggregate(profile); const lt = data.lt;
    const clickToPaint = data.clicks.filter((c) => c.clickToPaint != null).map((c) => c.clickToPaint);
    const rec = {
      label, scenario: meta.scenario, meta, seq: ++SEQ,
      window: { startEpochMs: t0, profStartEpochMs: tPs, profStopEpochMs: tPe, endEpochMs: t1, startISO: new Date(t0).toISOString(), endISO: new Date(t1).toISOString(), requestMs: ms, profiledSec: r3(durS), action: actionInfo },
      instrumentation: { muReady: moSelfTest.muReady, muErr: moSelfTest.muErr, observerSelfTestRecords: moSelfTest.observedRecords, observerAlive: moSelfTest.observedRecords > 0 },
      state: { href: data.href, nodes: data.nodes, selectedRow: data.selectedRow, sessionHeader: data.sessionHeader, activeSettingsTab: data.activeSettingsTab },
      ws: { frames: frames.length, dirs, bytesIn, framesPerS: r3(frames.length / durS), inboundPerS: r3(dirs.in / durS), byKind, byRoot, byPayloadType, byEnvelope, previews: frames.filter((f) => f.dir === 'in').slice(0, 5) },
      cdp: { ScriptDuration: d('ScriptDuration'), TaskDuration: d('TaskDuration'), RecalcStyleDuration: d('RecalcStyleDuration'), LayoutDuration: d('LayoutDuration'), ScriptMsPerS: per('ScriptDuration'), TaskMsPerS: per('TaskDuration'), RecalcMsPerS: per('RecalcStyleDuration'), LayoutMsPerS: per('LayoutDuration'), LayoutCount: d('LayoutCount'), RecalcStyleCount: d('RecalcStyleCount'), Nodes: m1.Nodes ?? null, NodesDelta: r3((m1.Nodes ?? 0) - (m0.Nodes ?? 0)), JSEventListeners: m1.JSEventListeners ?? null, JSEventListenersDelta: r3((m1.JSEventListeners ?? 0) - (m0.JSEventListeners ?? 0)) },
      raf: { count: raf.length, rafInside: data.rafInside, perS: r3(raf.length / durS), intervals: stat(iv), intervalsArr: iv.map((x) => r3(x)) },
      longtasks: { n: lt.length, perS: r3(lt.length / durS), totalMs: r3(lt.reduce((a, b) => a + b.d, 0)), maxMs: lt.length ? r3(Math.max(...lt.map((x) => x.d))) : null, top: lt.map((x) => ({ d: r3(x.d), s: r3(x.s) })).sort((a, b) => b.d - a.d).slice(0, 10) },
      eventTiming: data.et.filter((e) => e.d >= 16).map((e) => ({ n: e.n, d: r3(e.d), s: r3(e.s) })).sort((a, b) => b.d - a.d).slice(0, 10),
      clickToPaint: { n: clickToPaint.length, values: clickToPaint, stats: stat(clickToPaint), clicks: data.clicks },
      mutations: { records: data.muCount, ...data.mu, topTargets: data.muTargets },
      profile: { intervalUs: agg.intervalUs, msPerSample: agg.msPerSample, sampleCount: agg.sampleCount, nodeCount: agg.nodeCount, selfTop: agg.top, bundles: agg.bundles },
      integrity: { rafExpected: raf.length > 0 && data.rafInside >= raf.length - 2, rafRateSane: (raf.length / durS) < 80, muReady: moSelfTest.muReady === true, observerAlive: moSelfTest.observedRecords > 0, sampleCount: agg.sampleCount },
    };
    fs.writeFileSync(path.join(RAW, `profile-${STAMP}-${label}.json`), JSON.stringify({ meta: rec.window, scenario: meta.scenario, intervalUs: agg.intervalUs, sampleCount: agg.sampleCount, nodeCount: agg.nodeCount, selfTop: agg.top.slice(0, 200), bundles: agg.bundles }));
    return rec;
  } finally { try { await cdp.detach(); } catch { } }
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] });
  const bctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await bctx.addInitScript(INIT_HOOKS);
  const page = await bctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)));
  page.on('crash', () => errors.push('PAGE CRASH'));
  const wsLog = { frames: [] };
  page.on('websocket', (sock) => {
    sock.on('framereceived', (d) => { try { const s = typeof d === 'string' ? d : (d.payload ?? '').toString(); const f = classifyFrame(s, 'in'); f.t = Date.now(); wsLog.frames.push(f); } catch { } });
    sock.on('framesent', (d) => { try { const s = typeof d === 'string' ? d : (d.payload ?? '').toString(); const f = classifyFrame(s, 'out'); f.t = Date.now(); wsLog.frames.push(f); } catch { } });
  });
  const windows = [];
  const push = (rec) => {
    windows.push(rec); const i = rec.integrity;
    console.log(`[win] ${rec.label.padEnd(26)} prof=${rec.window.profiledSec}s script=${rec.cdp.ScriptDuration}ms(${rec.cdp.ScriptMsPerS}/s) task=${rec.cdp.TaskDuration}ms recalc=${rec.cdp.RecalcStyleDuration} layout=${rec.cdp.LayoutDuration} wsIn=${rec.ws.dirs.in}(${rec.ws.inboundPerS}/s) raf=${rec.raf.count}(${rec.raf.perS}/s p50=${rec.raf.intervals.p50} >50=${rec.raf.intervals.over50}) lt=${rec.longtasks.n}(max ${rec.longtasks.maxMs}) mut=${rec.mutations.records} c2p=${rec.clickToPaint.stats.p95}/${rec.clickToPaint.stats.max} nodes=${rec.state.nodes} tab=${rec.state.activeSettingsTab} act=${rec.window.action ? 'Y' : '-'} integ=${i.rafExpected && i.rafRateSane && i.muReady && i.observerAlive ? 'OK' : 'CHECK'}`);
  };
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(10000);
  const S = (s) => SCEN === 'all' || SCEN.split(',').includes(s);

  if (S('home-idle')) for (let i = 1; i <= REPS; i++) { await sleep(SETTLE); push(await capture(bctx, page, wsLog, `home-idle-w${i}`, { scenario: 'home-idle', page: 'home', session: null, activeStream: false }, WIN_MS)); }

  const LONG_SESSION = argOf('session', '会话删除更新误删全部会话');
  await expandSidebar(page);
  const openProbe = await openSession(page, LONG_SESSION);
  await sleep(3500);
  const st = await page.evaluate(`(${COLLECT.toString()})()`);
  console.log('[setup] long session probe=', JSON.stringify(openProbe), 'nodes=', st.nodes, 'selected=', st.selectedRow);
  const metaL = { page: 'long-session', session: LONG_SESSION, sessionHeader: st.sessionHeader, activeStream: false, note: 'existing long session (27 subagents) opened read-only from the sidebar' };

  if (S('long-session-idle')) for (let i = 1; i <= REPS; i++) { await sleep(SETTLE); push(await capture(bctx, page, wsLog, `long-idle-w${i}`, { scenario: 'long-session-idle', ...metaL }, WIN_MS)); }

  let streamMeta = {};
  if (S('long-session-active')) {
    await page.bringToFront();
    const cands = ['审计交接提示词并对齐需求', 'DeepSeek模型渠道不存在报错排查', '检查工作区相关内容'];
    let best = { title: null, rate: -1 };
    for (const c of cands) {
      await expandSidebar(page); const ok = await openSession(page, c); await sleep(2000);
      const i0 = wsLog.frames.length; await sleep(5000);
      const got = wsLog.frames.slice(i0).filter((f) => f.dir === 'in').length;
      console.log(`[setup] stream probe ${c} openProbe=${JSON.stringify(ok)} inbound5s=${got}`);
      if (got > best.rate) best = { title: c, rate: got };
    }
    console.log('[setup] active-stream source =', JSON.stringify(best));
    await expandSidebar(page); await openSession(page, best.title); await sleep(3500);
    const s2 = await page.evaluate(`(${COLLECT.toString()})()`);
    streamMeta = { ...metaL, session: best.title, sessionHeader: s2.sessionHeader, activeStream: 'observed', streamProbeInbound5s: best.rate, note: 'highest observed inbound WS rate; host agent session streams concurrently' };
    for (let i = 1; i <= REPS; i++) push(await capture(bctx, page, wsLog, `long-active-w${i}`, { scenario: 'long-session-active', ...streamMeta }, WIN_MS));
  }

  // transition scenarios: measure the interaction itself
  if (S('settings-general-open')) {
    for (let i = 1; i <= REPS; i++) {
      const rec = await capture(bctx, page, wsLog, `settings-open-t${i}`, { scenario: 'settings-general-open', tab: '通用设置', ...streamMeta, note: 'window contains the settings-open click' }, 9000, async () => { const ok = await clickSettings(page); await sleep(1200); return { action: 'open-settings', ok }; });
      push(rec);
    }
  }

  const settingsOpenState = await page.evaluate(`(${COLLECT.toString()})()`);
  console.log('[setup] settings open, active=', settingsOpenState.activeSettingsTab, 'nodes=', settingsOpenState.nodes);

  for (const [scen, tab] of [['settings-models-open', '模型'], ['settings-plugins-open', '插件'], ['settings-general-tab', '通用设置']]) {
    if (!S(scen)) continue;
    for (let i = 1; i <= REPS; i++) {
      const rec = await capture(bctx, page, wsLog, `${scen}-t${i}`, { scenario: scen, tab, ...streamMeta, note: 'window contains the tab-switch click' }, 9000, async () => { const ok = await clickTab(page, tab); await sleep(1200); return { action: 'switch-tab:' + tab, ok }; });
      push(rec);
    }
  }

  if (S('settings-dwell')) {
    const cur = (await page.evaluate(`(${COLLECT.toString()})()`)).activeSettingsTab;
    await sleep(3000);
    for (let i = 1; i <= REPS; i++) { await sleep(SETTLE); push(await capture(bctx, page, wsLog, `settings-dwell-w${i}`, { scenario: 'settings-dwell', tab: cur, ...streamMeta, note: 'zero interaction during capture' }, WIN_MS)); }
  }

  await browser.close();

  const byScenario = {};
  for (const w of windows) {
    const s = w.scenario;
    if (!byScenario[s]) byScenario[s] = { scenario: s, windows: 0, script: [], task: [], recalc: [], layout: [], rafPerS: [], rafOver50: 0, ltN: 0, ltPerS: [], ltMax: 0, wsInPerS: [], nodes: [], mutRecords: 0, c2p: [], fnPerS: {}, bundlePerS: {}, integOk: 0 };
    const a = byScenario[s]; a.windows++;
    a.script.push(w.cdp.ScriptMsPerS); a.task.push(w.cdp.TaskMsPerS); a.recalc.push(w.cdp.RecalcMsPerS); a.layout.push(w.cdp.LayoutMsPerS);
    a.rafPerS.push(w.raf.perS); a.rafOver50 += w.raf.intervals.over50;
    a.ltN += w.longtasks.n; a.ltPerS.push(w.longtasks.perS); a.ltMax = Math.max(a.ltMax, w.longtasks.maxMs || 0);
    a.wsInPerS.push(w.ws.inboundPerS); a.nodes.push(w.state.nodes); a.mutRecords += w.mutations.records;
    if (w.clickToPaint.stats.n) a.c2p.push(...w.clickToPaint.values);
    if (w.integrity.rafExpected && w.integrity.rafRateSane && w.integrity.muReady && w.integrity.observerAlive) a.integOk++;
    for (const f of w.profile.selfTop.slice(0, 40)) { const k = `${f.fn} @${(f.url || '').split('/').pop()}:${f.line}`; a.fnPerS[k] = r3((a.fnPerS[k] || 0) + f.selfMs / w.window.profiledSec); }
    for (const b of w.profile.bundles) a.bundlePerS[b.bundle] = r3((a.bundlePerS[b.bundle] || 0) + b.selfMs / w.window.profiledSec);
  }
  const avg = (a) => (a.length ? r3(a.reduce((x, y) => x + y, 0) / a.length) : null);
  for (const s of Object.keys(byScenario)) {
    const a = byScenario[s];
    a.scriptMsPerS = avg(a.script); a.taskMsPerS = avg(a.task); a.recalcMsPerS = avg(a.recalc); a.layoutMsPerS = avg(a.layout);
    a.rafPerS_avg = avg(a.rafPerS); a.ltPerS_avg = avg(a.ltPerS); a.wsInPerS_avg = avg(a.wsInPerS); a.nodes_avg = avg(a.nodes);
    a.c2pP95 = a.c2p.length ? r3([...a.c2p].sort((x, y) => x - y)[Math.floor((a.c2p.length - 1) * 0.95)]) : null;
    a.c2pMax = a.c2p.length ? r3(Math.max(...a.c2p)) : null;
    a.topFns = Object.entries(a.fnPerS).sort((x, y) => y[1] - x[1]).slice(0, 20);
    a.bundles = Object.entries(a.bundlePerS).sort((x, y) => y[1] - x[1]).slice(0, 12);
    delete a.fnPerS; delete a.bundlePerS;
  }
  const CHAINS = ['buildListSnapshot', 'projectList', 'flattenLineage', 'rebuildRemote', 'querySelectorAll', 'markDirty', 'ensureFresh', 'getListSnapshot', 'applyMutation', 'recordMutation', 'syncCompletedNotifications', 'list.set', 'projectionValues', 'apply('];
  const chains = {};
  for (const w of windows) for (const f of w.profile.selfTop) for (const c of CHAINS) {
    if (!(f.fn || '').includes(c)) continue;
    const key = `${c} :: ${f.fn} @${(f.url || '').split('/').pop()}:${f.line}`;
    if (!chains[key]) chains[key] = { chain: c, fn: f.fn, url: f.url, line: f.line, windows: 0, selfMs: 0, perS: 0, scenarios: {} };
    const t = chains[key]; t.windows++; t.selfMs = r3(t.selfMs + f.selfMs); t.perS = r3(t.perS + f.selfMs / w.window.profiledSec);
    t.scenarios[w.scenario] = r3((t.scenarios[w.scenario] || 0) + f.selfMs / w.window.profiledSec);
  }
  const report = {
    meta: { generatedAt: new Date().toISOString(), stamp: STAMP, url: URL, viewport: '1440x900', headless: true, winMs: WIN_MS, reps: REPS, scenarios: SCEN, longSession: LONG_SESSION, longSessionOpenProbe: openProbe, streamSourceSession: streamMeta.session || null, profiler: 'CDP Profiler.enable + setSamplingInterval(1000us) + start/stop; fresh CDPSession per window', discipline: 'read-only; single browser; single page; no save/apply/delete/refresh; browser closed at end', notes: ['MutationObserver installed after DOM root exists (v3 fix).', 'active stream = host agent session streaming concurrently in the same host process.'] },
    runOrder: windows.map((w) => ({ label: w.label, scenario: w.scenario, startISO: w.window.startISO, endISO: w.window.endISO, profiledSec: w.window.profiledSec, action: w.window.action, session: w.meta.session, tab: w.state.activeSettingsTab, nodes: w.state.nodes, wsIn: w.ws.dirs.in, wsInPerS: w.ws.inboundPerS, byKind: w.ws.byKind, scriptMsPerS: w.cdp.ScriptMsPerS, taskMsPerS: w.cdp.TaskMsPerS, recalcMsPerS: w.cdp.RecalcMsPerS, layoutMsPerS: w.cdp.LayoutMsPerS, rafPerS: w.raf.perS, rafOver50: w.raf.intervals.over50, rafP99: w.raf.intervals.p99, rafMax: w.raf.intervals.max, ltN: w.longtasks.n, ltMaxMs: w.longtasks.maxMs, mutRecords: w.mutations.records, c2pMax: w.clickToPaint.stats.max, integrity: w.integrity })),
    byScenario, chains: Object.values(chains).sort((a, b) => b.perS - a.perS), windows, errors,
  };
  fs.writeFileSync(path.join(OUT, `campaign-${STAMP}.json`), JSON.stringify(report, null, 2));
  console.log('\n=== BY SCENARIO ===');
  for (const [s, a] of Object.entries(byScenario)) {
    console.log(`${s}: n=${a.windows}/${a.integOk}ok script=${a.scriptMsPerS}ms/s task=${a.taskMsPerS} recalc=${a.recalcMsPerS} layout=${a.layoutMsPerS} wsIn/s=${a.wsInPerS_avg} raf/s=${a.rafPerS_avg} raf>50=${a.rafOver50} lt=${a.ltN} lt/s=${a.ltPerS_avg} ltMax=${a.ltMax} mut=${a.mutRecords} c2pP95=${a.c2pP95} c2pMax=${a.c2pMax} nodes=${a.nodes_avg}`);
    console.log('   fns/s:', JSON.stringify(a.topFns.slice(0, 8)));
    console.log('   bundle/s:', JSON.stringify(a.bundles.slice(0, 6)));
  }
  console.log('\n=== CHAINS ===');
  for (const c of report.chains.slice(0, 30)) console.log(`  ${c.chain} | ${c.fn}:${c.line} | w=${c.windows} selfMs=${c.selfMs} perS=${c.perS} | ${JSON.stringify(c.scenarios)}`);
  console.log('\nerrors:', JSON.stringify(errors.slice(0, 5)));
}
main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
