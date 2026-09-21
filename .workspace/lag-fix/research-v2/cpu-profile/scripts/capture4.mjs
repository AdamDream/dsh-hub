// ============================================================================
// cpu-profile v4 (unit-corrected + reconciled): CDP profile timeDeltas are in
// MICROSECONDS, so ms/sample ≈ timeDelta/1000.  This harness (a) converts with
// the real mean timeDelta, (b) reconciles profile CPU time against
// Performance.getMetrics Script/Task/Recalc/Layout in the SAME window, and
// (c) counts ThemePresenter.apply invocations, because that function dominated
// the first pass and must be identified precisely.
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
const SETTLE = Number(argOf('settle', 1200));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

const INIT_HOOKS = () => {
  if (window.__cpu) return;
  const S = { raf: [], lt: [], et: [], lo: [], mu: [], muReady: false, muErr: null, view: 'v0', rafInside: 0, clicks: [], apply: null };
  window.__cpu = S;
  requestAnimationFrame(function rafLoop(t) { S.raf.push(t); S.rafInside++; requestAnimationFrame(rafLoop); });
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) S.lt.push({ s: e.startTime, d: e.duration, n: e.name }); }).observe({ entryTypes: ['longtask'] }); } catch { }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) S.lo.push({ s: e.startTime, d: e.duration, blocking: e.blockingDuration ?? null, render: e.renderStart ?? null, style: e.styleAndLayoutStart ?? null, scripts: (e.scripts || []).slice(0, 4).map((x) => ({ name: x.name, dur: x.duration, invoker: x.invoker, type: x.invokerType })) }); }).observe({ type: 'long-animation-frame', buffered: false }); } catch { }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (e.entryType === 'event' || e.entryType === 'first-input') S.et.push({ n: e.name, s: e.startTime, d: e.duration, p: e.processingStart }); } }).observe({ type: 'event', durationThreshold: 16, buffered: false }); } catch { }
  try {
    window.addEventListener('pointerdown', (e) => { S.clicks.push({ t: performance.now(), x: e.clientX, y: e.clientY, painted: null }); }, true);
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { for (const c of S.clicks) if (c.painted == null && e.startTime > c.t) { c.painted = e.startTime; break; } } }).observe({ type: 'paint', buffered: false });
  } catch { }
  const installMO = () => {
    if (S.muReady) return; const root = document.documentElement; if (!root) { S.muErr = 'no documentElement yet'; return; }
    try {
      new MutationObserver((recs) => {
        let added = 0, removed = 0, attrs = 0, chars = 0; const targets = {};
        for (const r of recs) {
          if (r.type === 'childList') { added += r.addedNodes.length; removed += r.removedNodes.length; }
          else if (r.type === 'attributes') { attrs++; const k = (r.target.nodeName || '?') + '@' + (r.attributeName || ''); targets[k] = (targets[k] || 0) + 1; }
          else if (r.type === 'characterData') chars++;
        }
        S.mu.push({ t: performance.now(), n: recs.length, added, removed, attrs, chars, targets });
      }).observe(root, { subtree: true, childList: true, attributes: true, characterData: true });
      S.muReady = true;
    } catch (e) { S.muErr = String(e); }
  };
  installMO(); document.addEventListener('readystatechange', installMO); window.addEventListener('DOMContentLoaded', installMO);
};
const RESET = () => {
  const S = window.__cpu; if (!S) return { ok: false, reason: 'no __cpu' };
  const out = { ok: true, muReady: S.muReady, muErr: S.muErr, prevView: S.view, applySeen: S.apply ? S.apply.calls : null };
  S.raf.length = 0; S.lt.length = 0; S.et.length = 0; S.lo.length = 0; S.mu.length = 0; S.clicks.length = 0; S.rafInside = 0;
  if (S.apply) { S.apply.calls = 0; S.apply.tokens = 0; S.apply.ms = 0; S.apply.perFrame = 0; }
  window.__viewSeq = (window.__viewSeq || 0) + 1; S.view = 'v' + window.__viewSeq;
  return out;
};
const COLLECT = () => {
  const r3v = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x);
  const S = window.__cpu || {};
  const t0 = (S.clicks && S.clicks.length) ? Math.min(...S.clicks.map((c) => c.t)) : null;
  const mu = (S.mu || []).reduce((a, m) => ({ n: a.n + m.n, added: a.added + m.added, removed: a.removed + m.removed, attrs: a.attrs + m.attrs, chars: a.chars + m.chars }), { n: 0, added: 0, removed: 0, attrs: 0, chars: 0 });
  const tgt = {};
  for (const m of (S.mu || [])) for (const [k, v] of Object.entries(m.targets || {})) tgt[k] = (tgt[k] || 0) + v;
  return {
    view: S.view, rafInside: S.rafInside, muReady: !!S.muReady, muErr: S.muErr || null,
    raf: (S.raf || []).slice(), lt: (S.lt || []).slice(), et: (S.et || []).slice(), lo: (S.lo || []).slice(),
    clicks: (S.clicks || []).map((c) => ({ t: r3v(c.t), painted: c.painted == null ? null : r3v(c.painted), clickToPaint: c.painted == null ? null : r3v(c.painted - c.t) })),
    muRecords: (S.mu || []).length, mu, muTargets: Object.entries(tgt).sort((a, b) => b[1] - a[1]).slice(0, 10),
    apply: S.apply ? { ...S.apply } : null,
    nodes: document.getElementsByTagName('*').length,
    selectedRow: (() => { const s = document.querySelector('[role=treeitem][aria-selected=true]'); return s ? (s.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80) : null; })(),
    sessionHeader: (document.querySelector('header')?.innerText || '').replace(/\s+/g, ' ').slice(0, 130),
    activeSettingsTab: [...document.querySelectorAll('[class*=navCell]')].filter((b) => /active/.test(b.className)).map((b) => (b.innerText || '').trim())[0] || null,
    bodyStyleProps: (() => { try { return document.body.style.length; } catch { return null; } })(),
    themeAttr: document.body.hasAttribute('data-ds-dark-theme'),
  };
};
// hook ThemePresenter.apply via prototype discovery: instrument the module instance
const HOOK_APPLY = () => {
  if (window.__applyHooked) return;
  window.__applyHooked = true;
  const tryHook = () => {
    const S = window.__cpu; if (!S) return false;
    // find a ThemePresenter-like object by walking module exports is not possible;
    // instead patch the prototype method by finding it through a live instance is
    // impossible too -> use a wrapper on document.body.style.setProperty as a proxy
    const proto = Object.getPrototypeOf(document.body.style);
    if (!proto.__patched) {
      const orig = proto.setProperty;
      proto.setProperty = function (...a) { if (window.__cpu?.apply) window.__cpu.apply.tokens++; return orig.apply(this, a); };
      proto.__patched = true;
    }
    return true;
  };
  tryHook();
};
const APPLY_INIT = () => { window.__cpu.apply = { calls: 0, tokens: 0, ms: 0, perFrame: 0, hooked: false }; };

function classifyFrame(str, dir) {
  let o = null; if (str.length < 500000) { try { o = JSON.parse(str); } catch { } }
  const j = o || {};
  const m = (re) => { re.lastIndex = 0; const x = re.exec(str); return x ? x[1] : null; };
  const payload = (j.payload && typeof j.payload === 'object') ? j.payload : null;
  return { dir, len: str.length, envelopeType: j.type ?? m(/"type"\s*:\s*"([^"]{1,64})"/g), method: j.method ?? (j.request && j.request.method) ?? m(/"method"\s*:\s*"([^"]{1,64})"/g), root: j.root ?? m(/"root"\s*:\s*"([^"]{1,64})"/g), payloadType: payload ? (payload.type ?? payload.kind ?? null) : null, payloadMethod: payload ? payload.method : null, preview: str.slice(0, 180) };
}
const frameKind = (f) => f.method || (f.payloadMethod ? 'p:' + f.payloadMethod : null) || (f.root ? 'root:' + f.root : null) || f.envelopeType || 'unknown';

function aggregate(profile) {
  const byId = new Map(); for (const n of profile.nodes) byId.set(n.id, n);
  const self = new Map(); let total = 0;
  for (const s of profile.samples || []) { self.set(s, (self.get(s) || 0) + 1); total++; }
  const deltas = profile.timeDeltas || [];
  const sumTdUs = deltas.reduce((a, b) => a + b, 0);
  const wallUs = (profile.endTime - profile.startTime);
  const msPerSample = (deltas.length ? sumTdUs / deltas.length : 1000) / 1000;   // <-- UNIT FIX
  const wallMs = wallUs / 1000;
  const rows = [];
  for (const [id, cnt] of self) {
    const n = byId.get(id); if (!n) continue; const cf = n.callFrame || {};
    rows.push({ fn: cf.functionName || '(anonymous)', url: cf.url || '', line: (cf.lineNumber ?? -1) + 1, col: (cf.columnNumber ?? -1) + 1, selfMs: r3(cnt * msPerSample), selfPct: r3((cnt / (total || 1)) * 100), samples: cnt });
  }
  rows.sort((a, b) => b.selfMs - a.selfMs);
  const V8I = /^\((?:idle|program|garbage collector|root|no name|unlinked)\)$/;
  const busy = rows.filter((r) => !V8I.test(r.fn));
  const buckets = new Map();
  for (const r of rows) {
    const u = r.url; let key;
    if (!u) key = '(no-url:native/vm)';
    else if (/dsh-client-runtime/.test(u)) key = 'dsh-client-runtime';
    else if (/dsh-workspace-enhancement/.test(u)) key = 'C2:dsh-workspace-enhancement';
    else if (/dsh-usage/.test(u)) key = 'dsh-usage';
    else if (/dsh-client-ui-([a-z-]+)/.test(u)) key = u.match(/dsh-client-ui-[a-z-]+/)[0];
    else if (/assets\/index-/.test(u)) key = 'shell:assets:index';
    else if (/dsh-[a-z-]+/.test(u)) key = u.match(/dsh-[a-z-]+/)[0];
    else key = 'ext:' + u.split('/').pop();
    const b = buckets.get(key) || { bundle: key, selfMs: 0, samples: 0, fns: 0, urls: new Set() };
    b.selfMs = r3(b.selfMs + r.selfMs); b.samples += r.samples; b.fns++; b.urls.add(u || '(none)'); buckets.set(key, b);
  }
  return {
    msPerSample: r3(msPerSample), wallMs: r3(wallMs), sumTimeDeltaMs: r3(sumTdUs / 1000), sampleCount: total, nodeCount: profile.nodes.length,
    busySamples: busy.reduce((a, b) => a + b.samples, 0), busyMs: r3(busy.reduce((a, b) => a + b.selfMs, 0)),
    idleMs: r3(rows.filter((r) => r.fn === '(idle)').reduce((a, b) => a + b.selfMs, 0)),
    top: rows, busyTop: busy, bundles: [...buckets.values()].map((b) => ({ ...b, urls: [...b.urls].slice(0, 3) })).sort((a, b) => b.selfMs - a.selfMs),
  };
}

async function expandSidebar(page) {
  const projects = await page.evaluate(() => [...document.querySelectorAll('[class*=projectRow]')].map((r) => (r.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)));
  for (const t of projects) { try { await page.locator('[class*=projectRow]', { hasText: t }).first().click({ timeout: 1200 }); await sleep(150); } catch { } }
  await sleep(800);
}
async function openSession(page, title) {
  const probes = [title, title.replace(/^\d+\s*个子代理运行中\s*/, ''), title.replace(/^进行中\s*\d*\s*个子代理运行中\s*/, ''), title.slice(0, 12)];
  for (const p of probes) { try { const el = page.getByText(p, { exact: false }).first(); if (await el.count()) { await el.click({ timeout: 2500 }); await sleep(2000); return p; } } catch { } }
  return null;
}
const clickSettings = async (page) => { try { const l = page.locator('button:has-text("设置")').first(); if (await l.count()) { await l.click({ timeout: 2500 }); return true; } } catch { } return false; };
const clickTab = async (page, name) => { try { const l = page.locator(`[class*=navCell]:has-text("${name}")`).first(); if (await l.count()) { await l.click({ timeout: 2500 }); return true; } } catch { } return false; };

async function capture(bctx, page, wsLog, label, meta, ms, preAction) {
  const cdp = await bctx.newCDPSession(page);
  try {
    await cdp.send('Performance.enable');
    await page.evaluate(`(${RESET.toString()})()`);
    const moSelfTest = await page.evaluate(() => {
      const d = document.createElement('div'); document.documentElement.appendChild(d);
      return new Promise((res) => setTimeout(() => { const n = window.__cpu.mu.reduce((a, m) => a + m.n, 0); d.remove(); setTimeout(() => res({ observedRecords: n, muReady: window.__cpu.muReady, muErr: window.__cpu.muErr }), 25); }, 110));
    });
    await page.evaluate(() => { window.__cpu.mu.length = 0; });
    const wsIdx = wsLog.frames.length;
    const t0 = Date.now();
    const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.start');
    const tPs = Date.now();
    let actionInfo = null; if (preAction) actionInfo = await preAction();
    await sleep(ms);
    const tPe = Date.now();
    const { profile } = await cdp.send('Profiler.stop');
    const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    const t1 = Date.now();
    const data = await page.evaluate(`(${COLLECT.toString()})()`);
    const frames = wsLog.frames.slice(wsIdx);
    const wallS = (tPe - tPs) / 1000;
    const agg = aggregate(profile);
    const profS = agg.wallMs / 1000;
    const d = (k) => r3(((m1[k] ?? 0) - (m0[k] ?? 0)) * 1000);         // metrics are SECONDS
    const per = (k) => r3(d(k) / wallS);
    const raf = data.raf; const iv = raf.slice(1).map((t, i) => t - raf[i]);
    const stat = (a) => { if (!a.length) return { n: 0, p50: null, p95: null, p99: null, max: null, over50: 0, over100: 0 }; const x = [...a].sort((p, q) => p - q); const q = (v) => r3(x[Math.min(x.length - 1, Math.floor((x.length - 1) * v))]); return { n: x.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: r3(x[x.length - 1]), over50: a.filter((v) => v > 50).length, over100: a.filter((v) => v > 100).length }; };
    const byKind = {}, byRoot = {}, byPayloadType = {}, dirs = { in: 0, out: 0 };
    for (const f of frames) { dirs[f.dir] = (dirs[f.dir] || 0) + 1; const k = frameKind(f); byKind[k] = (byKind[k] || 0) + 1; if (f.root) byRoot[f.root] = (byRoot[f.root] || 0) + 1; if (f.payloadType) byPayloadType[f.payloadType] = (byPayloadType[f.payloadType] || 0) + 1; }
    const lt = data.lt, lo = data.lo;
    const rec = {
      label, scenario: meta.scenario, meta,
      window: { startEpochMs: t0, profStartEpochMs: tPs, profStopEpochMs: tPe, endEpochMs: t1, startISO: new Date(t0).toISOString(), endISO: new Date(t1).toISOString(), requestMs: ms, wallSec: r3(wallS), profileWallSec: r3(profS), action: actionInfo },
      instrumentation: { muReady: moSelfTest.muReady, muErr: moSelfTest.muErr, observerSelfTestRecords: moSelfTest.observedRecords, observerAlive: moSelfTest.observedRecords > 0 },
      state: { nodes: data.nodes, selectedRow: data.selectedRow, sessionHeader: data.sessionHeader, activeSettingsTab: data.activeSettingsTab, bodyStyleProps: data.bodyStyleProps, themeAttr: data.themeAttr },
      ws: { frames: frames.length, dirs, framesPerS: r3(frames.length / wallS), inboundPerS: r3(dirs.in / wallS), byKind, byRoot, byPayloadType, previews: frames.filter((f) => f.dir === 'in').slice(0, 5) },
      cdp: {
        ScriptDuration: d('ScriptDuration'), TaskDuration: d('TaskDuration'), RecalcStyleDuration: d('RecalcStyleDuration'), LayoutDuration: d('LayoutDuration'),
        ScriptMsPerS: per('ScriptDuration'), TaskMsPerS: per('TaskDuration'), RecalcMsPerS: per('RecalcStyleDuration'), LayoutMsPerS: per('LayoutDuration'),
        LayoutCount: d('LayoutCount'), RecalcStyleCount: d('RecalcStyleCount'), Nodes: m1.Nodes ?? null, JSEventListeners: m1.JSEventListeners ?? null,
      },
      reconcile: {
        profileBusyMs: agg.busyMs, profileBusyMsPerS: r3(agg.busyMs / profS), profileIdleMs: agg.idleMs,
        cdpScriptPlusRecalcMs: r3(d('ScriptDuration') + d('RecalcStyleDuration')),
        ratio_profileBusy_over_scriptPlusRecalc: r3(agg.busyMs / Math.max(0.0001, d('ScriptDuration') + d('RecalcStyleDuration'))),
      },
      raf: { count: raf.length, perS: r3(raf.length / wallS), intervals: stat(iv) },
      longtasks: { n: lt.length, perS: r3(lt.length / wallS), totalMs: r3(lt.reduce((a, b) => a + b.d, 0)), maxMs: lt.length ? r3(Math.max(...lt.map((x) => x.d))) : null, top: lt.map((x) => ({ d: r3(x.d), s: r3(x.s) })).sort((a, b) => b.d - a.d).slice(0, 8) },
      longAnimationFrames: { n: lo.length, top: lo.map((x) => ({ d: r3(x.d), blocking: r3(x.blocking), render: x.render == null ? null : r3(x.render), style: x.style == null ? null : r3(x.style), s: r3(x.s), scripts: x.scripts })).sort((a, b) => b.d - a.d).slice(0, 8) },
      eventTiming: data.et.filter((e) => e.d >= 16).map((e) => ({ n: e.n, d: r3(e.d), s: r3(e.s) })).sort((a, b) => b.d - a.d).slice(0, 10),
      clickToPaint: { n: data.clicks.filter((c) => c.clickToPaint != null).length, values: data.clicks.map((c) => c.clickToPaint).filter((x) => x != null), stats: stat(data.clicks.map((c) => c.clickToPaint).filter((x) => x != null)) },
      mutations: { records: data.muRecords, ...data.mu, topTargets: data.muTargets },
      applyProbe: data.apply,
      profile: { msPerSample: agg.msPerSample, sampleCount: agg.sampleCount, nodeCount: agg.nodeCount, busySamples: agg.busySamples, busyMs: agg.busyMs, top: agg.top, busyTop: agg.busyTop, bundles: agg.bundles },
      integrity: { rafExpected: raf.length > 0 && data.rafInside >= raf.length - 2, rafRateSane: (raf.length / wallS) < 80, muReady: moSelfTest.muReady === true, observerAlive: moSelfTest.observedRecords > 0, unitCheck: agg.wallMs > 0 && agg.msPerSample > 0.5 && agg.msPerSample < 3 },
    };
    fs.writeFileSync(path.join(RAW, `profile-${STAMP}-${label}.json`), JSON.stringify({ meta: rec.window, scenario: meta.scenario, msPerSample: agg.msPerSample, sampleCount: agg.sampleCount, busyMs: agg.busyMs, selfTop: agg.top.slice(0, 200), bundles: agg.bundles }));
    return rec;
  } finally { try { await cdp.detach(); } catch { } }
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] });
  const bctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await bctx.addInitScript(INIT_HOOKS);
  await bctx.addInitScript(APPLY_INIT);
  await bctx.addInitScript(HOOK_APPLY);
  const page = await bctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)));
  page.on('crash', () => errors.push('PAGE CRASH'));
  const wsLog = { frames: [] };
  page.on('websocket', (sock) => {
    sock.on('framereceived', (d) => { try { const s = typeof d === 'string' ? d : (d.payload ?? '').toString(); wsLog.frames.push({ ...classifyFrame(s, 'in'), t: Date.now() }); } catch { } });
    sock.on('framesent', (d) => { try { const s = typeof d === 'string' ? d : (d.payload ?? '').toString(); wsLog.frames.push({ ...classifyFrame(s, 'out'), t: Date.now() }); } catch { } });
  });
  const windows = [];
  const push = (rec) => {
    windows.push(rec); const i = rec.integrity;
    console.log(`[win] ${rec.label.padEnd(24)} wall=${rec.window.wallSec}s msPerSample=${rec.profile.msPerSample} script=${rec.cdp.ScriptDuration}ms(${rec.cdp.ScriptMsPerS}/s) task=${rec.cdp.TaskDuration}ms(${rec.cdp.TaskMsPerS}/s) recalc=${rec.cdp.RecalcStyleDuration}ms(${rec.cdp.RecalcMsPerS}/s) layout=${rec.cdp.LayoutDuration}ms profileBusy=${rec.profile.busyMs}ms(${rec.reconcile.profileBusyMsPerS}/s) ratio=${rec.reconcile.ratio_profileBusy_over_scriptPlusRecalc} wsIn=${rec.ws.dirs.in}(${rec.ws.inboundPerS}/s) raf=${rec.raf.count}(${rec.raf.perS}/s p50=${rec.raf.intervals.p50} >50=${rec.raf.intervals.over50}) lt=${rec.longtasks.n}(max ${rec.longtasks.maxMs}) laf=${rec.longAnimationFrames.n} mut=${rec.mutations.records} setProp=${rec.applyProbe ? rec.applyProbe.tokens : '-'} nodes=${rec.state.nodes} tab=${rec.state.activeSettingsTab} integ=${i.rafExpected && i.rafRateSane && i.muReady && i.observerAlive && i.unitCheck ? 'OK' : 'CHECK'}`);
  };
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(10000);
  const S = (s) => SCEN === 'all' || SCEN.split(',').includes(s);
  const applyCalls = async () => await page.evaluate(() => window.__cpu.apply);

  if (S('home-idle')) for (let i = 1; i <= REPS; i++) { await sleep(SETTLE); push(await capture(bctx, page, wsLog, `home-idle-w${i}`, { scenario: 'home-idle', page: 'home', session: null, activeStream: false }, WIN_MS)); }

  const LONG_SESSION = argOf('session', '会话删除更新误删全部会话');
  await expandSidebar(page);
  const openProbe = await openSession(page, LONG_SESSION);
  await sleep(3000);
  const st = await page.evaluate(`(${COLLECT.toString()})()`);
  console.log('[setup] long session openProbe=', JSON.stringify(openProbe), 'nodes=', st.nodes, 'selected=', st.selectedRow, 'applyProbe=', JSON.stringify(st.apply));
  const metaL = { page: 'long-session', session: LONG_SESSION, sessionHeader: st.sessionHeader, activeStream: false, note: 'existing 27-subagent session opened read-only' };

  if (S('long-session-idle')) for (let i = 1; i <= REPS; i++) { await sleep(SETTLE); push(await capture(bctx, page, wsLog, `long-idle-w${i}`, { scenario: 'long-session-idle', ...metaL }, WIN_MS)); }

  let streamMeta = {};
  if (S('long-session-active')) {
    await page.bringToFront();
    const cands = ['审计交接提示词并对齐需求', 'DeepSeek模型渠道不存在报错排查', '检查工作区相关内容'];
    let best = { title: null, rate: -1 };
    for (const c of cands) {
      await expandSidebar(page); const ok = await openSession(page, c); await sleep(1800);
      const i0 = wsLog.frames.length; await sleep(5000);
      const got = wsLog.frames.slice(i0).filter((f) => f.dir === 'in').length;
      console.log(`[setup] stream probe ${c} openProbe=${JSON.stringify(ok)} inbound5s=${got}`);
      if (got > best.rate) best = { title: c, rate: got };
    }
    console.log('[setup] active-stream source =', JSON.stringify(best));
    await expandSidebar(page); await openSession(page, best.title); await sleep(3000);
    const s2 = await page.evaluate(`(${COLLECT.toString()})()`);
    streamMeta = { ...metaL, session: best.title, sessionHeader: s2.sessionHeader, activeStream: 'observed', streamProbeInbound5s: best.rate };
    for (let i = 1; i <= REPS; i++) push(await capture(bctx, page, wsLog, `long-active-w${i}`, { scenario: 'long-session-active', ...streamMeta }, WIN_MS));
  }

  if (S('settings-general-open')) for (let i = 1; i <= REPS; i++) push(await capture(bctx, page, wsLog, `settings-open-t${i}`, { scenario: 'settings-general-open', tab: '通用设置', ...streamMeta, note: 'window contains the settings-open click' }, 9000, async () => { const ok = await clickSettings(page); await sleep(1000); return { action: 'open-settings', ok }; }));

  const stSet = await page.evaluate(`(${COLLECT.toString()})()`);
  console.log('[setup] settings open, active=', stSet.activeSettingsTab, 'nodes=', stSet.nodes, 'bodyStyleProps=', stSet.bodyStyleProps, 'themeAttr=', stSet.themeAttr);

  for (const [scen, tab] of [['settings-models-open', '模型'], ['settings-plugins-open', '插件']]) {
    if (!S(scen)) continue;
    for (let i = 1; i <= REPS; i++) push(await capture(bctx, page, wsLog, `${scen}-t${i}`, { scenario: scen, tab, ...streamMeta, note: 'window contains the tab-switch click' }, 9000, async () => { const ok = await clickTab(page, tab); await sleep(1000); return { action: 'switch-tab:' + tab, ok }; }));
  }
  if (S('settings-general-tab')) for (let i = 1; i <= REPS; i++) push(await capture(bctx, page, wsLog, `settings-general-tab-t${i}`, { scenario: 'settings-general-tab', tab: '通用设置', ...streamMeta, note: 'window contains the tab-switch click back to 通用设置' }, 9000, async () => { const ok = await clickTab(page, '通用设置'); await sleep(1000); return { action: 'switch-tab:通用设置', ok }; }));

  if (S('settings-dwell')) {
    const cur = (await page.evaluate(`(${COLLECT.toString()})()`)).activeSettingsTab; await sleep(2500);
    for (let i = 1; i <= REPS; i++) { await sleep(SETTLE); push(await capture(bctx, page, wsLog, `settings-dwell-w${i}`, { scenario: 'settings-dwell', tab: cur, ...streamMeta, note: 'zero interaction during capture' }, WIN_MS)); }
  }

  const finalApply = await applyCalls();
  await browser.close();

  // aggregate
  const byScenario = {};
  for (const w of windows) {
    const s = w.scenario;
    if (!byScenario[s]) byScenario[s] = { scenario: s, n: 0, wall: [], script: [], scriptMs: [], task: [], recalc: [], layout: [], profileBusy: [], rafPerS: [], rafOver50: 0, rafOver100: 0, rafMax: [], ltN: 0, ltMax: [], lafN: 0, wsInPerS: [], wsInTotal: 0, nodes: [], mutRec: 0, setProps: 0, integOk: 0, fnMs: {}, bundleMs: {}, ratio: [] };
    const a = byScenario[s]; a.n++;
    a.wall.push(w.window.wallSec); a.script.push(w.cdp.ScriptMsPerS); a.scriptMs.push(w.cdp.ScriptDuration); a.task.push(w.cdp.TaskMsPerS);
    a.recalc.push(w.cdp.RecalcMsPerS); a.layout.push(w.cdp.LayoutMsPerS); a.profileBusy.push(w.reconcile.profileBusyMsPerS);
    a.ratio.push(w.reconcile.ratio_profileBusy_over_scriptPlusRecalc);
    a.rafPerS.push(w.raf.perS); a.rafOver50 += w.raf.intervals.over50; a.rafOver100 += w.raf.intervals.over100;
    if (w.raf.intervals.max != null) a.rafMax.push(w.raf.intervals.max);
    a.ltN += w.longtasks.n; if (w.longtasks.maxMs != null) a.ltMax.push(w.longtasks.maxMs); a.lafN += w.longAnimationFrames.n;
    a.wsInPerS.push(w.ws.inboundPerS); a.wsInTotal += w.ws.dirs.in; a.nodes.push(w.state.nodes); a.mutRec += w.mutations.records;
    if (w.applyProbe) a.setProps += w.applyProbe.tokens;
    if (w.integrity.rafExpected && w.integrity.rafRateSane && w.integrity.muReady && w.integrity.observerAlive && w.integrity.unitCheck) a.integOk++;
    for (const f of w.profile.busyTop.slice(0, 40)) { const k = `${f.fn} @${(f.url || '').split('/').pop()}:${f.line}`; a.fnMs[k] = r3((a.fnMs[k] || 0) + f.selfMs / w.window.profileWallSec); }
    for (const b of w.profile.bundles) a.bundleMs[b.bundle] = r3((a.bundleMs[b.bundle] || 0) + b.selfMs / w.window.profileWallSec);
  }
  const avg = (x) => (x.length ? r3(x.reduce((p, q) => p + q, 0) / x.length) : null);
  for (const a of Object.values(byScenario)) {
    a.wallSec = avg(a.wall); a.scriptMsPerS = avg(a.script); a.scriptMsAvg = avg(a.scriptMs); a.taskMsPerS = avg(a.task);
    a.recalcMsPerS = avg(a.recalc); a.layoutMsPerS = avg(a.layout); a.profileBusyMsPerS = avg(a.profileBusy); a.ratioAvg = avg(a.ratio);
    a.rafPerS = avg(a.rafPerS); a.rafMaxSeen = a.rafMax.length ? r3(Math.max(...a.rafMax)) : null;
    a.ltMaxSeen = a.ltMax.length ? r3(Math.max(...a.ltMax)) : null; a.wsInPerS = avg(a.wsInPerS); a.nodesAvg = avg(a.nodes);
    a.topFns = Object.entries(a.fnMs).sort((x, y) => y[1] - x[1]).slice(0, 15);
    a.bundles = Object.entries(a.bundleMs).sort((x, y) => y[1] - x[1]).slice(0, 10);
    delete a.fnMs; delete a.bundleMs;
  }
  const report = { meta: { generatedAt: new Date().toISOString(), stamp: STAMP, url: URL, winMs: WIN_MS, reps: REPS, scenarios: SCEN, longSession: LONG_SESSION, streamSource: streamMeta.session || null, finalApplyProbe: finalApply, unitNote: 'CDP profile timeDeltas are microseconds: msPerSample = mean(timeDeltas)/1000', discipline: 'read-only; single browser; single page; browser closed at end' }, windows, byScenario, errors };
  fs.writeFileSync(path.join(OUT, `campaign-${STAMP}.json`), JSON.stringify(report, null, 2));
  console.log('\n=== BY SCENARIO (unit-corrected) ===');
  for (const a of Object.values(byScenario)) {
    console.log(`${a.scenario.padEnd(22)} n=${a.n}/${a.integOk}ok wall=${a.wallSec}s script=${a.scriptMsPerS}ms/s (${a.scriptMsAvg}ms/window) task=${a.taskMsPerS}ms/s recalc=${a.recalcMsPerS}ms/s layout=${a.layoutMsPerS}ms/s profileBusy=${a.profileBusyMsPerS}ms/s ratio=${a.ratioAvg} wsIn=${a.wsInPerS}/s raf=${a.rafPerS}/s raf>50=${a.rafOver50} lt=${a.ltN} laf=${a.lafN} ltMax=${a.ltMaxSeen} mut=${a.mutRec} setProp=${a.setProps} nodes=${a.nodesAvg}`);
    console.log('   topMs/s:', JSON.stringify(a.topFns.slice(0, 8)));
  }
  console.log('\nerrors:', JSON.stringify(errors.slice(0, 5)));
}
main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
