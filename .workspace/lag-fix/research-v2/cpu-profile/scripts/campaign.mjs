// ============================================================================
// cpu-profile campaign: CDP Profiler (Profiler.enable/start/stop) top-down CPU
// attribution for the DSH Web settings page under a real long session + real
// live stream. Read-only on the app: no save/apply/delete/refresh clicks.
// Single browser instance, bounded windows, always closes the browser.
// ============================================================================
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const URL = 'http://127.0.0.1:3080';
const BASE = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/cpu-profile';
const RAW = path.join(BASE, 'raw');
const OUT = path.join(BASE, 'out');
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const SCEN = argOf('scenarios', 'all');
const WIN_MS = Number(argOf('win', 12000));
const REPS = Number(argOf('reps', 4));
const STAMP = argOf('stamp', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

// ---------------------------------------------------------------- instrumentation
const INIT_HOOKS = () => {
  window.__cpu = { raf: [], lt: [], et: [], mu: [] };
  requestAnimationFrame(function rafLoop(t) { window.__cpu.raf.push(t); requestAnimationFrame(rafLoop); });
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__cpu.lt.push({ s: e.startTime, d: e.duration, n: e.name }); }).observe({ entryTypes: ['longtask'] }); } catch { }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__cpu.et.push({ n: e.name, s: e.startTime, d: e.duration, p: e.processingStart }); }).observe({ entryTypes: ['event', 'first-input'], durationThreshold: 16 }); } catch { }
  try {
    const obs = new MutationObserver((recs) => {
      let added = 0, removed = 0, attrs = 0, chars = 0;
      for (const r of recs) {
        if (r.type === 'childList') { added += r.addedNodes.length; removed += r.removedNodes.length; }
        else if (r.type === 'attributes') attrs++;
        else if (r.type === 'characterData') chars++;
      }
      window.__cpu.mu.push({ t: performance.now(), n: recs.length, added, removed, attrs, chars, target: (recs[0]?.target && (recs[0].target.nodeName || '')) + '' });
    });
    obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  } catch { }
};

// ---------------------------------------------------------------- WS classifier
const JSON_FIELD = {
  type: /"type"\s*:\s*"([^"]{1,64})"/g,
  method: /"method"\s*:\s*"([^"]{1,64})"/g,
  root: /"root"\s*:\s*"([^"]{1,64})"/g,
  rpcId: /"rpcId"\s*:\s*"([^"]{1,64})"/g,
  kind: /"kind"\s*:\s*"([^"]{1,64})"/g,
};
function classifyFrame(str, dir) {
  const one = (re) => { re.lastIndex = 0; const m = re.exec(str); return m ? m[1] : null; };
  let obj = null;
  if (str.length < 400000) { try { obj = JSON.parse(str); } catch { } }
  const o = obj || {};
  const payloadType = o.payload && typeof o.payload === 'object' ? (o.payload.type ?? o.payload.kind ?? null) : null;
  return {
    dir,
    len: str.length,
    envelopeType: o.type ?? one(JSON_FIELD.type) ?? null,
    method: o.method ?? one(JSON_FIELD.method) ?? null,
    root: o.root ?? one(JSON_FIELD.root) ?? null,
    rpcId: o.rpcId ?? one(JSON_FIELD.rpcId) ?? null,
    eventType: o.event && typeof o.event === 'object' ? (o.event.type ?? null) : null,
    payloadType,
    payloadKeys: o.payload && typeof o.payload === 'object' ? Object.keys(o.payload).slice(0, 6) : null,
    preview: str.slice(0, 120),
  };
}
const frameKind = (f) => {
  if (f.method) return f.method;
  if (f.envelopeType === 'client-request' || f.rpcId) return 'rpc:' + (f.method || f.envelopeType);
  if (f.envelopeType === 'server-response') return 'response';
  if (f.root) return 'root:' + f.root;
  return 'other:' + (f.envelopeType || 'unknown');
};

// ---------------------------------------------------------------- profile aggregation
function aggregate(profile) {
  const byId = new Map();
  for (const n of profile.nodes) byId.set(n.id, n);
  const self = new Map();          // nodeId -> sample count
  let total = 0;
  for (const s of profile.samples || []) { self.set(s, (self.get(s) || 0) + 1); total++; }
  const deltas = profile.timeDeltas || [];
  let interval = 1000;
  if (deltas.length >= 20) {
    const sorted = [...deltas].sort((a, b) => a - b);
    interval = sorted[Math.floor(sorted.length / 2)] || 1000;
  } else if (deltas.length) {
    interval = Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length) || 1000;
  }
  const msPerSample = interval / 1000;
  const rows = [];
  for (const [id, cnt] of self) {
    const n = byId.get(id);
    if (!n) continue;
    const cf = n.callFrame || {};
    rows.push({
      fn: cf.functionName || '(anonymous)',
      url: cf.url || '',
      line: (cf.lineNumber ?? -1) + 1,
      col: (cf.columnNumber ?? -1) + 1,
      selfMs: r3(cnt * msPerSample),
      selfPct: r3((cnt / total) * 100),
      samples: cnt,
      hitCount: n.hitCount ?? null,
    });
  }
  rows.sort((a, b) => b.selfMs - a.selfMs);
  // bundle attribution
  const bundles = new Map();
  for (const r of rows) {
    let key;
    const u = r.url;
    if (!u) key = '(no-url: native/vm)';
    else if (/dsh-client-runtime/.test(u)) key = 'dsh-client-runtime';
    else if (/dsh-workspace-enhancement/.test(u)) key = 'dsh-workspace-enhancement(C2)';
    else if (/dsh-usage/.test(u)) key = 'dsh-usage';
    else if (/dsh-client-ui-settings/.test(u)) key = 'dsh-client-ui-settings';
    else if (/dsh-client-ui-/.test(u)) key = 'ui:' + (u.match(/dsh-client-ui-[a-z-]+/) || [''])[0];
    else if (/dsh-/.test(u)) key = (u.match(/dsh-[a-z-]+/) || ['dsh-other'])[0];
    else if (/react|scheduler/i.test(u)) key = 'react';
    else key = 'ext:' + u.split('/').slice(-2).join('/');
    const b = bundles.get(key) || { bundle: key, selfMs: 0, samples: 0, fns: 0, urls: new Set() };
    b.selfMs = r3(b.selfMs + r.selfMs); b.samples += r.samples; b.fns++; b.urls.add(u || '(none)');
    bundles.set(key, b);
  }
  const bundleRows = [...bundles.values()].map((b) => ({ ...b, urls: [...b.urls].slice(0, 3) })).sort((a, b) => b.selfMs - a.selfMs);
  return { intervalUs: interval, msPerSample, sampleCount: total, nodes: profile.nodes.length, top: rows, bundles: bundleRows };
}
const SELF_TOP = 30;

// ---------------------------------------------------------------- page helpers
async function snapshotState(page) {
  return await page.evaluate(() => {
    const sel = document.querySelector('[role=treeitem][aria-selected=true]');
    return {
      url: location.href,
      nodes: document.getElementsByTagName('*').length,
      selectedRow: sel ? (sel.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80) : null,
      sessionHeader: (document.querySelector('header')?.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
      settingsOpen: !![...document.querySelectorAll('button')].find((b) => b.className.includes('VOzbGW_navCell')),
      activeSettingsTab: [...document.querySelectorAll('[class*=navCell]')].filter((b) => /active/.test(b.className)).map((b) => (b.innerText || '').trim())[0] || null,
      settingsTabs: [...document.querySelectorAll('[class*=navCell]')].map((b) => (b.innerText || '').trim()).filter(Boolean),
      bodyLen: (document.body.innerText || '').length,
    };
  });
}

async function expandSidebar(page) {
  const projects = await page.evaluate(() => [...document.querySelectorAll('[class*=projectRow]')].map((r) => (r.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)));
  for (const title of projects) { try { await page.locator('[class*=projectRow]', { hasText: title }).first().click({ timeout: 1500 }); await sleep(220); } catch { } }
  await sleep(1200);
}

async function openSession(page, title) {
  const probes = [title, title.replace(/^\d+ 个子代理运行中 /, ''), title.replace(/^进行中 \d+ 个子代理运行中 /, ''), title.slice(0, 14)];
  for (const p of probes) {
    try { const el = page.getByText(p, { exact: false }).first(); if (await el.count()) { await el.click({ timeout: 3000 }); await sleep(2500); return p; } } catch { }
  }
  return null;
}

async function clickSettings(page) {
  for (const s of ['button:has-text("设置")', '[aria-label*="设置"]', '[title*="设置"]']) {
    try { const l = page.locator(s).first(); if (await l.count()) { await l.click({ timeout: 3000 }); await sleep(1500); return s; } } catch { }
  }
  return null;
}
async function clickTab(page, name) {
  try { const l = page.locator(`[class*=navCell]:has-text("${name}")`).first(); if (await l.count()) { await l.click({ timeout: 3000 }); await sleep(1500); return true; } } catch { }
  try { const l = page.getByText(name, { exact: true }).first(); if (await l.count()) { await l.click({ timeout: 3000 }); await sleep(1500); return true; } } catch { }
  return false;
}

// ---------------------------------------------------------------- capture window
async function capture(page, cdp, label, meta, ms, wsLog) {
  const t0w = Date.now();
  const i0 = wsLog.frames.length;
  const socksBefore = wsLog.socks.length;
  const before = await cdp.send('Performance.getMetrics');
  const m0 = Object.fromEntries(before.metrics.map((x) => [x.name, x.value]));

  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.start');
  const tProfStart = Date.now();
  await sleep(ms);
  const tProfStop = Date.now();
  const { profile } = await cdp.send('Profiler.stop');
  const after = await cdp.send('Performance.getMetrics');
  const m1 = Object.fromEntries(after.metrics.map((x) => [x.name, x.value]));
  const t1w = Date.now();
  const frames = wsLog.frames.slice(i0);
  const sockets = wsLog.socks.map((s) => ({ url: s.url, in: s.in - (s.__mark?.in ?? 0), out: s.out - (s.__mark?.out ?? 0), bytesIn: s.bytesIn - (s.__mark?.bytesIn ?? 0), totalIn: s.in }));
  for (const s of wsLog.socks) s.__mark = { in: s.in, out: s.out, bytesIn: s.bytesIn };

  const pageData = await page.evaluate(() => {
    const c = window.__cpu || { raf: [], lt: [], et: [], mu: [] };
    return { raf: c.raf.slice(), lt: c.lt.slice(), et: c.et.slice(), mu: c.mu.slice() };
  });
  const state = await snapshotState(page);

  // rAF intervals
  const raf = pageData.raf;
  const intervals = raf.slice(1).map((t, i) => t - raf[i]);
  const st = (a) => { if (!a.length) return { n: 0, p50: null, p95: null, p99: null, max: null, over50: 0, over100: 0 }; const x = [...a].sort((p, q) => p - q); const q = (v) => r3(x[Math.min(x.length - 1, Math.floor((x.length - 1) * v))]); return { n: x.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: r3(x[x.length - 1]), over50: a.filter((v) => v > 50).length, over100: a.filter((v) => v > 100).length }; };

  // WS aggregation
  const byKind = {}; const byRoot = {}; const byPayloadType = {}; const byEnvelope = {}; const dirs = { in: 0, out: 0 };
  let bytesIn = 0;
  for (const f of frames) {
    dirs[f.dir] = (dirs[f.dir] || 0) + 1;
    if (f.dir === 'in') bytesIn += f.len;
    const k = frameKind(f); byKind[k] = (byKind[k] || 0) + 1;
    if (f.root) byRoot[f.root] = (byRoot[f.root] || 0) + 1;
    if (f.payloadType) byPayloadType[f.payloadType] = (byPayloadType[f.payloadType] || 0) + 1;
    if (f.envelopeType) byEnvelope[f.envelopeType] = (byEnvelope[f.envelopeType] || 0) + 1;
  }
  const durS = (tProfStop - tProfStart) / 1000;
  const agg = aggregate(profile);

  const d = (k) => r3((m1[k] ?? 0) - (m0[k] ?? 0));
  const per = (k) => r3(d(k) / durS);
  const cdpMetrics = {
    ScriptDuration: d('ScriptDuration'), TaskDuration: d('TaskDuration'),
    RecalcStyleDuration: d('RecalcStyleDuration'), LayoutDuration: d('LayoutDuration'),
    ScriptMsPerS: per('ScriptDuration'), TaskMsPerS: per('TaskDuration'),
    RecalcMsPerS: per('RecalcStyleDuration'), LayoutMsPerS: per('LayoutDuration'),
    Nodes: m1.Nodes ?? null, NodesDelta: r3((m1.Nodes ?? 0) - (m0.Nodes ?? 0)),
    JSEventListeners: m1.JSEventListeners ?? null, JSEventListenersDelta: r3((m1.JSEventListeners ?? 0) - (m0.JSEventListeners ?? 0)),
    Documents: m1.Documents ?? null, Frames: m1.Frames ?? null, LayoutCount: d('LayoutCount'), RecalcStyleCount: d('RecalcStyleCount'),
  };
  const mutations = { total: pageData.mu.length, added: pageData.mu.reduce((a, b) => a + b.added, 0), removed: pageData.mu.reduce((a, b) => a + b.removed, 0), attrs: pageData.mu.reduce((a, b) => a + b.attrs, 0), chars: pageData.mu.reduce((a, b) => a + b.chars, 0) };

  const rec = {
    label, scenario: meta.scenario, meta,
    window: { startEpochMs: t0w, profStartEpochMs: tProfStart, profStopEpochMs: tProfStop, endEpochMs: t1w, startISO: new Date(t0w).toISOString(), endISO: new Date(t1w).toISOString(), requestMs: ms, profiledSec: r3(durS) },
    state,
    ws: { frames: frames.length, dirs, bytesIn, framesPerS: r3(frames.length / durS), inboundPerS: r3(dirs.in / durS), byKind, byRoot, byPayloadType, byEnvelope, sockets: (sockets && sockets.length ? sockets : wsLog.socks.map((s) => ({ url: s.url, totalIn: s.in }))), socketsSeenTotal: wsLog.socks.length },
    cdp: cdpMetrics,
    raf: { count: raf.length, perS: r3(raf.length / durS), intervals: st(intervals) },
    longtasks: { n: pageData.lt.length, totalMs: r3(pageData.lt.reduce((a, b) => a + b.d, 0)), maxMs: pageData.lt.length ? r3(Math.max(...pageData.lt.map((x) => x.d))) : null, entries: pageData.lt.map((x) => ({ d: r3(x.d), s: r3(x.s) })).sort((a, b) => b.d - a.d).slice(0, 12) },
    eventTiming: pageData.et.filter((e) => e.d >= 16).map((e) => ({ n: e.n, d: r3(e.d), s: r3(e.s) })).sort((a, b) => b.d - a.d).slice(0, 10),
    mutations,
    profile: { intervalUs: agg.intervalUs, msPerSample: agg.msPerSample, sampleCount: agg.sampleCount, nodes: agg.nodes, selfTop: agg.top.slice(0, SELF_TOP), bundles: agg.bundles },
  };
  // keep full profile on disk (trimmed); full node table may be huge -> keep trimmed nodes
  fs.writeFileSync(path.join(RAW, `profile-${STAMP}-${label}.json`), JSON.stringify({ meta: rec.window, scenario: meta.scenario, intervalUs: agg.intervalUs, sampleCount: agg.sampleCount, nodes: agg.nodes, selfTop: agg.top.slice(0, 300), bundles: agg.bundles, nodeCountRaw: profile.nodes.length }));
  return rec;
}

// ---------------------------------------------------------------- symbols probe
const TARGET_SYMBOLS = ['buildListSnapshot', 'projectList', 'list.set', 'rebuildRemote', 'querySelectorAll', 'markDirty', 'ensureFresh', 'getListSnapshot', 'applyMutation', 'recordMutation', 'syncCompletedNotifications', 'flattenLineage', 'render', 'commit', 'beginWork', 'apply', 'sessions', 'notify', 'scan'];
function symbolHits(rec) {
  const hits = {};
  for (const r of rec.profile.selfTop) {
    for (const s of TARGET_SYMBOLS) if ((r.fn || '').includes(s)) { hits[s] = hits[s] || []; hits[s].push({ fn: r.fn, ms: r.selfMs, url: r.url }); }
  }
  return hits;
}

// ============================================================================
// ---------------------------------------------------------------- robust window runner
const RT = { page: null, cdp: null, newPage: null };
async function runWindow(label, meta, ms) {
  const attempts = [
    () => capture(RT.page, RT.cdp, label, meta, ms, RT.wsLog),
    async () => {           // one bounded recovery: reopen the tab and re-establish CDP
      console.log('[recover] reopening page for', label);
      try { await RT.page.close(); } catch { }
      RT.page = await RT.ctx.newPage();
      RT.cdp = await RT.ctx.newCDPSession(RT.page);
      await RT.cdp.send('Performance.enable');
      await RT.reopen(RT.page);
      return await capture(RT.page, RT.cdp, label, meta, ms, RT.wsLog);
    },
  ];
  let lastErr = null;
  for (let i = 0; i < attempts.length; i++) {
    try { return await attempts[i](); } catch (e) { lastErr = e; console.log('[warn] window', label, 'attempt', i, 'failed:', String(e).slice(0, 140)); }
  }
  throw lastErr;
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(INIT_HOOKS);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('crash', () => errors.push('PAGE CRASH'));
  page.on('close', () => errors.push('PAGE CLOSED'));
  // persistent WS accumulator (registered once, never removed)
  const wsLog = { frames: [], socks: [] };
  page.on('websocket', (sock) => {
    const rec = { url: sock.url(), in: 0, out: 0, bytesIn: 0, openedAt: Date.now() };
    wsLog.socks.push(rec);
    sock.on('framereceived', (d) => {
      try { const s = typeof d === 'string' ? d : (d.payload ?? '').toString(); rec.in++; rec.bytesIn += s.length; const f = classifyFrame(s, 'in'); f.t = Date.now(); f.sock = wsLog.socks.length - 1; wsLog.frames.push(f); } catch { }
    });
    sock.on('framesent', (d) => {
      try { const s = typeof d === 'string' ? d : (d.payload ?? '').toString(); rec.out++; const f = classifyFrame(s, 'out'); f.t = Date.now(); f.sock = wsLog.socks.length - 1; wsLog.frames.push(f); } catch { }
    });
    sock.on('close', () => { rec.closedAt = Date.now(); });
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  for (const s of wsLog.socks) s.__mark = { in: s.in, out: s.out, bytesIn: s.bytesIn };
  RT.page = page; RT.cdp = cdp; RT.ctx = ctx; RT.wsLog = wsLog;
  RT.reopen = async (p) => {
    await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(8000);
    if (RT.restore) await RT.restore(p);
  };

  const windows = [];
  const push = async (rec) => { windows.push(rec); console.log(`[win] ${rec.label} prof=${rec.window.profiledSec}s script=${rec.cdp.ScriptDuration}ms (${rec.cdp.ScriptMsPerS}ms/s) task=${rec.cdp.TaskDuration}ms wsIn=${rec.ws.dirs.in} lt=${rec.longtasks.n} raf/s=${rec.raf.perS} nodes=${rec.state.nodes} selTab=${rec.state.activeSettingsTab}`); };

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(9000);

  const wantScenario = (s) => SCEN === 'all' || SCEN.split(',').includes(s);
  const meta0 = { page: 'home', session: null, activeStream: false, note: 'fresh load, new session selected' };

  // ---- S1 home-idle
  if (wantScenario('home-idle')) {
    for (let i = 1; i <= REPS; i++) await push(await runWindow( `home-idle-w${i}`, { scenario: 'home-idle', ...meta0 }, WIN_MS));
  }

  // ---- open the long session
  const LONG_SESSION = argOf('session', '会话删除更新误删全部会话');
  let opened = null;
  if (SCEN !== 'home-idle' && SCEN !== 'settings-home') {
    await expandSidebar(page);
    opened = await openSession(page, LONG_SESSION);
    await sleep(4000);
    const st = await snapshotState(page);
    console.log('[setup] opened long session probe=', opened, 'nodes=', st.nodes, 'header=', st.sessionHeader);
    RT.restore = async (p) => { await expandSidebar(p); await openSession(p, LONG_SESSION); await sleep(3000); };
  }
  const metaL = { page: 'long-session', session: LONG_SESSION, sessionHeader: (await snapshotState(page)).sessionHeader, activeStream: false, note: 'existing 27-subagent session opened from sidebar (read-only)' };

  // ---- S2 long-session-idle
  if (wantScenario('long-session-idle')) {
    for (let i = 1; i <= REPS; i++) await push(await runWindow( `long-idle-w${i}`, { scenario: 'long-session-idle', ...metaL }, WIN_MS));
  }

  // ---- S3 long-session-active-stream: pick the session that is genuinely streaming now
  if (wantScenario('long-session-active')) {
    await page.bringToFront();
    const candidates = [
      '会话删除更新误删全部会话',
      '审计交接提示词并对齐需求',
      '检查工作区相关内容',
      'DeepSeek模型渠道不存在报错排查',
    ];
    let best = { title: null, rate: -1 };
    for (const cand of candidates) {
      await expandSidebar(page);
      const okProbe = await openSession(page, cand);
      await sleep(2500);
      const i0 = wsLog.frames.length;
      await sleep(5000);
      const got = wsLog.frames.slice(i0).filter((f) => f.dir === 'in').length;
      console.log(`[setup] stream probe ${cand} opened=${!!okProbe} inbound5s=${got}`);
      if (got > best.rate) best = { title: cand, rate: got };
    }
    console.log('[setup] active-stream source chosen:', JSON.stringify(best));
    if (best.title && best.title !== LONG_SESSION) { await openSession(page, best.title); await sleep(3000); }
    RT.restore = async (p) => { await expandSidebar(p); await openSession(p, best.title || LONG_SESSION); await sleep(3000); };
    metaL.streamSourceSession = best.title;
    metaL.streamProbeInbound5s = best.rate;
    for (let i = 1; i <= REPS; i++) {
      const rec = await runWindow( `long-active-w${i}`, { scenario: 'long-session-active', ...metaL, activeStream: 'observed-not-forced', note: 'session with the highest observed inbound WS rate; host session streams concurrently' }, WIN_MS);
      rec.meta.activeStreamDetected = rec.ws.dirs.in > 20;
      rec.meta.activeStreamObservedIn = r3(rec.ws.inboundPerS);
      await push(rec);
    }
  }

  // ---- settings scenarios
  const settingsSel = await clickSettings(page);
  console.log('[setup] settings clicked via', settingsSel);
  await sleep(2000);
  const stSet = await snapshotState(page);
  console.log('[setup] settings tabs=', JSON.stringify(stSet.settingsTabs), 'active=', stSet.activeSettingsTab, 'nodes=', stSet.nodes);
  const metaS = (tab) => ({ page: 'settings', settingsTab: tab, session: LONG_SESSION, sessionHeader: metaL.sessionHeader, activeStream: 'concurrent-host-session', note: 'settings panel open over the long session' });

  for (const [scen, tab] of [['settings-general', '通用设置'], ['settings-models', '模型'], ['settings-plugins', '插件']]) {
    if (!wantScenario(scen)) continue;
    const ok = await clickTab(page, tab);
    RT.restore = async (p) => { await expandSidebar(p); await openSession(p, LONG_SESSION); await sleep(2500); await clickSettings(p); await clickTab(p, tab); await sleep(1500); };
    console.log('[setup] tab', tab, 'clicked=', ok);
    await sleep(1500);
    for (let i = 1; i <= REPS; i++) {
      const rec = await runWindow( `${scen}-w${i}`, { scenario: scen, tab, ...metaS(tab) }, WIN_MS);
      rec.meta.activeStreamDetected = rec.ws.dirs.in > 20;
      await push(rec);
    }
  }

  // ---- S7 settings-dwell (stay on current tab, no interaction)
  if (wantScenario('settings-dwell')) {
    const cur = (await snapshotState(page)).activeSettingsTab;
    for (let i = 1; i <= REPS; i++) {
      const rec = await runWindow( `settings-dwell-w${i}`, { scenario: 'settings-dwell', tab: cur, ...metaS(cur), note: 'panel stay window, no interaction during capture' }, WIN_MS);
      rec.meta.activeStreamDetected = rec.ws.dirs.in > 20;
      await push(rec);
    }
  }

  await browser.close();

  // ---------------- aggregate report ----------------
  const byScenario = {};
  for (const w of windows) {
    const s = w.scenario;
    byScenario[s] = byScenario[s] || { scenario: s, windows: 0, scriptMsPerS: [], taskMsPerS: [], recalcMsPerS: [], layoutMsPerS: [], rafPerS: [], rafOver50: 0, rafOver100: 0, ltN: 0, ltMax: 0, wsInPerS: [], nodes: [], peakFns: {}, peakBundles: {} };
    const a = byScenario[s];
    a.windows++;
    a.scriptMsPerS.push(w.cdp.ScriptMsPerS); a.taskMsPerS.push(w.cdp.TaskMsPerS);
    a.recalcMsPerS.push(w.cdp.RecalcMsPerS); a.layoutMsPerS.push(w.cdp.LayoutMsPerS);
    a.rafPerS.push(w.raf.perS); a.rafOver50 += w.raf.intervals.over50; a.rafOver100 += w.raf.intervals.over100;
    a.ltN += w.longtasks.n; a.ltMax = Math.max(a.ltMax, w.longtasks.maxMs || 0);
    a.wsInPerS.push(w.ws.inboundPerS); a.nodes.push(w.state.nodes);
    for (const f of w.profile.selfTop.slice(0, 15)) {
      const k = `${f.fn} @${(f.url || '').split('/').slice(-1)[0]}:${f.line}`;
      a.peakFns[k] = r3((a.peakFns[k] || 0) + f.selfMs / w.window.profiledSec);
    }
    for (const b of w.profile.bundles) a.peakBundles[b.bundle] = r3((a.peakBundles[b.bundle] || 0) + b.selfMs / w.window.profiledSec);
  }
  for (const s of Object.keys(byScenario)) {
    const a = byScenario[s];
    const avg = (arr) => r3(arr.reduce((x, y) => x + y, 0) / arr.length);
    a.scriptMsPerS_avg = avg(a.scriptMsPerS); a.taskMsPerS_avg = avg(a.taskMsPerS);
    a.recalcMsPerS_avg = avg(a.recalcMsPerS); a.layoutMsPerS_avg = avg(a.layoutMsPerS);
    a.rafPerS_avg = avg(a.rafPerS); a.wsInPerS_avg = avg(a.wsInPerS); a.nodes_avg = avg(a.nodes);
    a.topFnsPerS = Object.entries(a.peakFns).sort((x, y) => y[1] - x[1]).slice(0, 12);
    a.bundlesPerS = Object.entries(a.peakBundles).sort((x, y) => y[1] - x[1]).slice(0, 12);
    delete a.peakFns; delete a.peakBundles;
  }

  // total self-time per function across all windows (and per scenario), for the named chains
  const chainNames = ['buildListSnapshot', 'projectList', 'rebuildRemote', 'querySelectorAll', 'markDirty', 'ensureFresh', 'getListSnapshot', 'applyMutation', 'recordMutation', 'syncCompletedNotifications', 'flattenLineage', 'list.set', 'set('];
  const chainTotals = {};
  for (const w of windows) {
    for (const f of w.profile.selfTop) {
      for (const c of chainNames) {
        if (!(f.fn || '').includes(c)) continue;
        const key = `${c} :: ${f.fn}`;
        chainTotals[key] = chainTotals[key] || { chain: c, fn: f.fn, url: f.url, line: f.line, windows: 0, selfMs: 0, perS: 0, scenarios: {} };
        const t = chainTotals[key];
        t.windows++; t.selfMs = r3(t.selfMs + f.selfMs); t.perS = r3(t.perS + f.selfMs / w.window.profiledSec);
        t.scenarios[w.scenario] = r3((t.scenarios[w.scenario] || 0) + f.selfMs / w.window.profiledSec);
      }
    }
  }

  const report = {
    meta: {
      generatedAt: new Date().toISOString(), stamp: STAMP, url: URL, viewport: '1440x900', headless: true,
      windowRequestedMs: WIN_MS, reps: REPS, scenariosRequested: SCEN,
      longSession: LONG_SESSION, openedProbe: opened,
      profiler: 'CDP Profiler.enable/setSamplingInterval(1000us)/start/stop via Playwright CDPSession',
      discipline: 'read-only: no save/apply/delete/refresh clicks; single browser instance; browser closed at end',
      caveat: 'rAF/rAF-interval only measurable while the profiled page is the frontmost tab; active-stream windows are concurrent host-session activity, labelled with observed inbound frames/s.',
    },
    runOrder: windows.map((w) => ({ label: w.label, scenario: w.scenario, startISO: w.window.startISO, endISO: w.window.endISO, profiledSec: w.window.profiledSec, state: w.state.selectedRow, tab: w.state.activeSettingsTab, nodes: w.state.nodes, wsIn: w.ws.dirs.in, wsInPerS: w.ws.inboundPerS, wsOut: w.ws.dirs.out, byRoot: w.ws.byRoot, scriptMsPerS: w.cdp.ScriptMsPerS, taskMsPerS: w.cdp.TaskMsPerS, recalcMsPerS: w.cdp.RecalcMsPerS, layoutMsPerS: w.cdp.LayoutMsPerS, rafPerS: w.raf.perS, rafOver50: w.raf.intervals.over50, ltN: w.longtasks.n, ltMaxMs: w.longtasks.maxMs })),
    byScenario,
    chainTotals: Object.values(chainTotals).sort((a, b) => b.perS - a.perS),
    windows,
    errors,
  };
  fs.writeFileSync(path.join(OUT, `campaign-${STAMP}.json`), JSON.stringify(report, null, 2));
  console.log('\n=== BY SCENARIO (avg per window) ===');
  for (const [s, a] of Object.entries(byScenario)) {
    console.log(`${s}: n=${a.windows} script=${a.scriptMsPerS_avg}ms/s task=${a.taskMsPerS_avg}ms/s recalc=${a.recalcMsPerS_avg} layout=${a.layoutMsPerS_avg} wsIn/s=${a.wsInPerS_avg} raf/s=${a.rafPerS_avg} raf>50=${a.rafOver50} lt=${a.ltN} ltMax=${a.ltMax} nodes=${a.nodes_avg}`);
    console.log('   topFns/s:', JSON.stringify(a.topFnsPerS.slice(0, 6)));
    console.log('   bundles/s:', JSON.stringify(a.bundlesPerS.slice(0, 6)));
  }
  console.log('\n=== NAMED CHAIN TOTALS (self ms summed / ms-per-s summed) ===');
  for (const c of report.chainTotals.slice(0, 25)) console.log(`  ${c.chain} | ${c.fn} | windows=${c.windows} selfMs=${c.selfMs} perS=${c.perS} | ${JSON.stringify(c.scenarios)}`);
  console.log('\nerrors:', JSON.stringify(errors.slice(0, 5)));
}

main().catch(async (e) => { console.error('FATAL', e); process.exitCode = 1; });
