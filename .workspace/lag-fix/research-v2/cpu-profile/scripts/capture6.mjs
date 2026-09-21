// Corrected counters (per-window deltas) + clean limited run.
// Fixes the cumulative-counter bug in capture5: RESET now snapshots the style-write
// counter so each window reports its own writes. Adds a raw-WS-tap for true
// session-scoped event rates, and reads MutationObserver body@style records as an
// independent cross-check of body style writes.
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const URL = 'http://127.0.0.1:3080';
const BASE = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/cpu-profile';
const RAW = path.join(BASE, 'raw'); const OUT = path.join(BASE, 'out');
const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const SCEN = argOf('scenarios', 'all');
const WIN_MS = Number(argOf('win', 12000));
const REPS = Number(argOf('reps', 3));
const STAMP = argOf('stamp', 'cpu5');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

const INIT_HOOKS = () => {
  if (window.__cpu) return;
  const S = { raf: [], lt: [], lo: [], mu: [], muReady: false, view: 'v0', rafInside: 0, writes: 0, writeMark: 0 };
  window.__cpu = S;
  requestAnimationFrame(function f(t) { S.raf.push(t); S.rafInside++; requestAnimationFrame(f); });
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) S.lt.push({ s: e.startTime, d: e.duration }); }).observe({ entryTypes: ['longtask'] }); } catch { }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) S.lo.push({ s: e.startTime, d: e.duration, blocking: e.blockingDuration ?? null, scripts: (e.scripts || []).slice(0, 3).map((x) => ({ name: x.name, dur: Math.round(x.duration), type: x.invokerType })) }); }).observe({ type: 'long-animation-frame', buffered: false }); } catch { }
  const installMO = () => {
    if (S.muReady) return; const root = document.documentElement; if (!root) return;
    try { new MutationObserver((recs) => {
      let bodyStyle = 0, added = 0, removed = 0, attrs = 0, chars = 0;
      for (const r of recs) {
        if (r.type === 'childList') { added += r.addedNodes.length; removed += r.removedNodes.length; }
        else if (r.type === 'attributes') { attrs++; if (r.target === document.body && r.attributeName === 'style') bodyStyle++; }
        else chars++;
      }
      S.mu.push({ t: performance.now(), n: recs.length, added, removed, attrs, chars, bodyStyle });
    }).observe(root, { subtree: true, childList: true, attributes: true, characterData: true }); S.muReady = true; } catch { }
  };
  installMO(); document.addEventListener('readystatechange', installMO); window.addEventListener('DOMContentLoaded', installMO);
  const patchStyle = () => {
    if (!document.body || window.__stylePatched) return !!window.__stylePatched;
    const proto = Object.getPrototypeOf(document.body.style);
    if (!proto.__dshPatched) {
      const oSet = proto.setProperty, oRem = proto.removeProperty;
      proto.setProperty = function (n, v, p) { if (this === document.body.style) window.__cpu.writes++; return oSet.call(this, n, v, p); };
      proto.removeProperty = function (n) { if (this === document.body.style) window.__cpu.writes++; return oRem.call(this, n); };
      proto.__dshPatched = true;
    }
    window.__stylePatched = true; return true;
  };
  if (!patchStyle()) { const iv = setInterval(() => { if (patchStyle()) clearInterval(iv); }, 40); }
};
const RESET = () => {
  const S = window.__cpu; if (!S) return { ok: false };
  S.raf.length = 0; S.lt.length = 0; S.lo.length = 0; S.mu.length = 0; S.rafInside = 0;
  S.writeMark = S.writes;                          // <-- per-window delta fix
  window.__viewSeq = (window.__viewSeq || 0) + 1; S.view = 'v' + window.__viewSeq;
  return { ok: true, muReady: S.muReady, writeMark: S.writeMark };
};
const COLLECT = () => {
  const r3v = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x);
  const S = window.__cpu || {};
  const mu = (S.mu || []).reduce((a, m) => ({ n: a.n + m.n, added: a.added + m.added, removed: a.removed + m.removed, attrs: a.attrs + m.attrs, chars: a.chars + m.chars, bodyStyle: a.bodyStyle + m.bodyStyle }), { n: 0, added: 0, removed: 0, attrs: 0, chars: 0, bodyStyle: 0 });
  return { view: S.view, rafInside: S.rafInside, raf: (S.raf || []).slice(), lt: (S.lt || []).slice(), lo: (S.lo || []).slice(), muRecords: (S.mu || []).length, mu, writesDelta: (S.writes || 0) - (S.writeMark || 0), writesTotal: S.writes, nodes: document.getElementsByTagName('*').length, selectedRow: (() => { const s = document.querySelector('[role=treeitem][aria-selected=true]'); return s ? (s.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 70) : null; })(), sessionHeader: (document.querySelector('header')?.innerText || '').replace(/\s+/g, ' ').slice(0, 110), activeSettingsTab: [...document.querySelectorAll('[class*=navCell]')].filter((b) => /active/.test(b.className)).map((b) => (b.innerText || '').trim())[0] || null };
};
function classify(str, dir) { let o = null; if (str.length < 600000) { try { o = JSON.parse(str); } catch { } } const j = o || {}; const m = (re) => { re.lastIndex = 0; const x = re.exec(str); return x ? x[1] : null; }; const pl = (j.payload && typeof j.payload === 'object') ? j.payload : null; return { dir, len: str.length, envelopeType: j.type ?? m(/"type"\s*:\s*"([^"]{1,64})"/g), method: j.method ?? (j.request && j.request.method) ?? m(/"method"\s*:\s*"([^"]{1,64})"/g), root: j.root ?? m(/"root"\s*:\s*"([^"]{1,64})"/g), payloadType: pl ? (pl.type ?? pl.kind ?? null) : null, payloadMethod: pl ? pl.method : null, text: str }; }
const kind = (f) => f.method || (f.payloadMethod ? 'p:' + f.payloadMethod : null) || (f.root ? 'root:' + f.root : null) || f.envelopeType || 'unknown';
function aggregate(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map(); for (const s of profile.samples || []) self.set(s, (self.get(s) || 0) + 1);
  const deltas = profile.timeDeltas || []; const sumUs = deltas.reduce((a, b) => a + b, 0);
  const msPerSample = (deltas.length ? sumUs / deltas.length : 1000) / 1000;
  const wallMs = (profile.endTime - profile.startTime) / 1000;
  const rows = [...self.entries()].map(([id, c]) => { const cf = byId.get(id)?.callFrame || {}; return { fn: cf.functionName || '(anonymous)', url: cf.url || '', line: (cf.lineNumber ?? -1) + 1, selfMs: r3(c * msPerSample), selfPct: r3((c / ((profile.samples || []).length || 1)) * 100), samples: c }; }).sort((a, b) => b.selfMs - a.selfMs);
  const V8I = /^\((?:idle|program|garbage collector|root|no name|unlinked)\)$/;
  const busy = rows.filter((r) => !V8I.test(r.fn));
  const buckets = new Map();
  for (const r of rows) { const u = r.url; let k; if (!u) k = '(no-url:native/vm)'; else if (/dsh-client-runtime/.test(u)) k = 'dsh-client-runtime'; else if (/dsh-workspace-enhancement/.test(u)) k = 'C2:dsh-workspace-enhancement'; else if (/dsh-usage/.test(u)) k = 'dsh-usage'; else if (/dsh-client-ui-layout/.test(u)) k = 'dsh-client-ui-layout'; else if (/dsh-client-ui-([a-z-]+)/.test(u)) k = u.match(/dsh-client-ui-[a-z-]+/)[0]; else if (/assets\/index-/.test(u)) k = 'shell:assets:index'; else if (/dsh-[a-z-]+/.test(u)) k = u.match(/dsh-[a-z-]+/)[0]; else k = 'ext:' + u.split('/').pop(); const b = buckets.get(k) || { bundle: k, selfMs: 0, fns: 0, urls: new Set() }; b.selfMs = r3(b.selfMs + r.selfMs); b.fns++; b.urls.add(u || '(none)'); buckets.set(k, b); }
  return { msPerSample: r3(msPerSample), wallMs: r3(wallMs), sampleCount: (profile.samples || []).length, nodeCount: profile.nodes.length, busyMs: r3(busy.reduce((a, b) => a + b.selfMs, 0)), top: rows, busyTop: busy, bundles: [...buckets.values()].map((b) => ({ ...b, urls: [...b.urls].slice(0, 3) })).sort((a, b) => b.selfMs - a.selfMs) };
}

// ---------------- ownership / concurrency census -------------------------------
import { execSync } from 'node:child_process';
// A browser INSTANCE = the main browser process (has --remote-debugging-pipe and a
// --user-data-dir); child processes carry --type= and are excluded.
function browserInstances() {
  const out = [];
  let lines = [];
  try { lines = execSync('ps -eo pid,ppid,etime,cmd --no-headers', { maxBuffer: 32 * 1024 * 1024 }).toString().split('\n'); } catch { return out; }
  for (const l of lines) {
    if (!/--remote-debugging-pipe/.test(l)) continue;
    if (/--type=/.test(l)) continue;
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    let ppid = Number(m[2]);
    const chain = [];
    for (let i = 0; i < 6 && ppid > 1; i++) { chain.push(ppid); try { const st = fs.readFileSync(`/proc/${ppid}/stat`, 'utf8'); const rp = st.slice(st.lastIndexOf(')') + 2).split(' ')[1]; ppid = Number(rp); } catch { break; } }
    out.push({ pid, ppid: Number(m[2]), etime: m[3], ancestors: chain, cmdHead: m[4].replace(/\s+/g, ' ').slice(0, 130) });
  }
  return out;
}
function censusNow(myPids) {
  const instances = browserInstances();
  const mine = instances.filter((b) => b.ancestors.includes(process.pid) || myPids.has(b.pid) || myPids.has(b.ppid));
  const foreign = instances.filter((b) => !mine.includes(b));
  let lockOwner = null;
  try { lockOwner = fs.readFileSync('/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock/owner.txt', 'utf8').split('\n').slice(0, 2).join(' '); } catch { lockOwner = null; }
  let hostPid = null;
  try { hostPid = Number(execSync("pgrep -f 'bin/dsh web' | head -1", { shell: '/bin/bash' }).toString().trim()) || null; } catch { }
  let load = null; try { load = fs.readFileSync('/proc/loadavg', 'utf8').trim(); } catch { }
  return {
    at: new Date().toISOString(), instances: instances.length,
    mineCount: mine.length, mine: mine.map((b) => ({ pid: b.pid, etime: b.etime })),
    foreignCount: foreign.length, foreign: foreign.map((b) => ({ pid: b.pid, etime: b.etime, cmdHead: b.cmdHead })),
    lockOwner, lockHeldByMe: !!(lockOwner && /cpu-profile/.test(lockOwner)), hostPid, load,
  };
}
function myBrowserPids() { return new Set([process.pid]); }

async function expandSidebar(page) { const projects = await page.evaluate(() => [...document.querySelectorAll('[class*=projectRow]')].map((r) => (r.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40))); for (const t of projects) { try { await page.locator('[class*=projectRow]', { hasText: t }).first().click({ timeout: 1200 }); await sleep(150); } catch { } } await sleep(800); }
async function openSession(page, title) { for (const p of [title, title.replace(/^\d+\s*个子代理运行中\s*/, ''), title.slice(0, 12)]) { try { const el = page.getByText(p, { exact: false }).first(); if (await el.count()) { await el.click({ timeout: 2500 }); await sleep(2000); return p; } } catch { } } return null; }

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'] });
  const bctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await bctx.addInitScript(INIT_HOOKS);
  const page = await bctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  const wsLog = { f: [] };
  page.on('websocket', (s) => { s.on('framereceived', (d) => { try { wsLog.f.push({ ...classify(typeof d === 'string' ? d : (d.payload ?? '').toString(), 'in'), t: Date.now() }); } catch { } }); s.on('framesent', (d) => { try { wsLog.f.push({ ...classify(typeof d === 'string' ? d : (d.payload ?? '').toString(), 'out'), t: Date.now() }); } catch { } }); });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(10000);

  const windows = [];
  const capture = async (label, meta, ms, preAction) => {
    // ---- EXCLUSIVITY GATE: wait until only my own browser instances exist
    const gateStart = Date.now();
    let gate = null, foreignSeen = [];
    const GATE_MAX_MS = Number(argOf('gatemax', 120000));
    while (Date.now() - gateStart < GATE_MAX_MS) {
      const c = censusNow(myBrowserPids());
      if (c.foreignCount === 0 && c.lockHeldByMe) { gate = c; break; }
      if (c.foreignCount > 0) for (const f of c.foreign) if (!foreignSeen.some((x) => x.pid === f.pid)) foreignSeen.push(f);
      await sleep(4000);
    }
    const gateOutcome = gate ? 'EXCLUSIVE' : 'CONTENDED';
    const cdp = await bctx.newCDPSession(page);
    try {
      await cdp.send('Performance.enable');
      await page.evaluate(`(${RESET.toString()})()`);
      const st0 = await page.evaluate(() => ({ muReady: window.__cpu.muReady, writeMark: window.__cpu.writeMark }));
      await page.evaluate(() => { const el = document.createElement('div'); document.documentElement.appendChild(el); return new Promise((res) => setTimeout(() => { const n = window.__cpu.mu.reduce((a, m) => a + m.n, 0); el.remove(); setTimeout(() => res(n), 25); }, 110)); });
      await page.evaluate(() => { window.__cpu.mu.length = 0; window.__cpu.lo.length = 0; window.__cpu.writeMark = window.__cpu.writes; });
      const i0 = wsLog.f.length; const t0 = Date.now();
      const censusStart = censusNow(myBrowserPids());
      const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
      await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
      await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
      const tPs = Date.now();
      let action = null; if (preAction) action = await preAction();
      await sleep(ms);
      const tPe = Date.now();
      const { profile } = await cdp.send('Profiler.stop');
      const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
      const data = await page.evaluate(`(${COLLECT.toString()})()`);
      const censusEnd = censusNow(myBrowserPids());
      const censusSamples = [];
      const frames = wsLog.f.slice(i0);
      const wallS = (tPe - tPs) / 1000; const agg = aggregate(profile); const profS = agg.wallMs / 1000;
      const g = (k) => r3(((m1[k] ?? 0) - (m0[k] ?? 0)) * 1000); const per = (k) => r3(g(k) / wallS);
      const raf = data.raf; const iv = raf.slice(1).map((t, i) => t - raf[i]);
      const stat = (a) => { if (!a.length) return { n: 0, p50: null, p95: null, p99: null, max: null, over50: 0, over100: 0 }; const x = [...a].sort((p, q) => p - q); const q = (v) => r3(x[Math.min(x.length - 1, Math.floor((x.length - 1) * v))]); return { n: x.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: r3(x[x.length - 1]), over50: a.filter((v) => v > 50).length, over100: a.filter((v) => v > 100).length }; };
      const byKind = {}, byPayloadType = {}, sessionIds = {}, dirs = { in: 0, out: 0 };
      for (const f of frames) { dirs[f.dir] = (dirs[f.dir] || 0) + 1; const k = kind(f); byKind[k] = (byKind[k] || 0) + 1; if (f.payloadType) byPayloadType[f.payloadType] = (byPayloadType[f.payloadType] || 0) + 1; if (f.dir === 'in') { const mm = /"sessionId"\s*:\s*"([^"]{1,40})"/g; let x; while ((x = mm.exec(f.text))) sessionIds[x[1].slice(0, 8)] = (sessionIds[x[1].slice(0, 8)] || 0) + 1; } }
      const rec = {
        label, scenario: meta.scenario, meta,
        window: { startEpochMs: t0, startISO: new Date(t0).toISOString(), wallSec: r3(wallS), profileWallSec: r3(profS), action },
        instrumentation: { muReady: st0.muReady },
        state: { nodes: data.nodes, selectedRow: data.selectedRow, sessionHeader: data.sessionHeader, activeSettingsTab: data.activeSettingsTab },
        ws: { in: dirs.in, out: dirs.out, inboundPerS: r3(dirs.in / wallS), byKind, byPayloadType, topSessionIds: Object.entries(sessionIds).sort((a, b) => b[1] - a[1]).slice(0, 5) },
        cdp: { ScriptDuration: g('ScriptDuration'), ScriptMsPerS: per('ScriptDuration'), TaskDuration: g('TaskDuration'), TaskMsPerS: per('TaskDuration'), RecalcStyleDuration: g('RecalcStyleDuration'), RecalcMsPerS: per('RecalcStyleDuration'), LayoutDuration: g('LayoutDuration'), LayoutMsPerS: per('LayoutDuration'), RecalcStyleCount: g('RecalcStyleCount'), LayoutCount: g('LayoutCount'), Nodes: m1.Nodes, JSEventListeners: m1.JSEventListeners },
        profile: { msPerSample: agg.msPerSample, sampleCount: agg.sampleCount, busyMs: agg.busyMs, busyMsPerS: r3(agg.busyMs / profS), top: agg.top, busyTop: agg.busyTop, bundles: agg.bundles },
        reconcile: { ratio: r3(agg.busyMs / Math.max(0.0001, g('ScriptDuration') + g('RecalcStyleDuration'))) },
        raf: { count: raf.length, perS: r3(raf.length / wallS), intervals: stat(iv) },
        longtasks: { n: data.lt.length, totalMs: r3(data.lt.reduce((a, b) => a + b.d, 0)), maxMs: data.lt.length ? r3(Math.max(...data.lt.map((x) => x.d))) : null },
        laf: { n: data.lo.length, maxBlocking: data.lo.length ? r3(Math.max(...data.lo.map((x) => x.blocking || 0))) : null },
        mutations: { records: data.muRecords, ...data.mu },
        bodyStyleWrites: data.writesDelta, bodyStyleWritesPerS: r3(data.writesDelta / wallS), bodyStyleMutationRecords: data.mu.bodyStyle,
        concurrency: {
          gateOutcome, gateWaitedMs: Date.now() - gateStart,
          censusStart: censusStart,
          censusEnd: censusEnd,
          foreignSeenDuringGate: foreignSeen,
          exclusiveThroughout: gateOutcome === 'EXCLUSIVE' && censusStart.foreignCount === 0 && censusEnd.foreignCount === 0,
        },
        integrity: { rafOk: raf.length > 0 && data.rafInside >= raf.length - 2, rafRateSane: (raf.length / wallS) < 80, muOk: true, unitOk: agg.msPerSample > 0.5 && agg.msPerSample < 3 },
      };
      fs.writeFileSync(path.join(RAW, `profile-${STAMP}-${label}.json`), JSON.stringify({ meta: rec.window, scenario: meta.scenario, msPerSample: agg.msPerSample, sampleCount: agg.sampleCount, busyMs: agg.busyMs, selfTop: agg.top.slice(0, 120), bundles: agg.bundles }));
      return rec;
    } finally { try { await cdp.detach(); } catch { } }
  };
  const push = (r) => { windows.push(r); console.log(`[win] ${r.label.padEnd(24)} wall=${r.window.wallSec}s script=${r.cdp.ScriptDuration}ms(${r.cdp.ScriptMsPerS}/s) task=${r.cdp.TaskDuration}ms(${r.cdp.TaskMsPerS}/s) recalc=${r.cdp.RecalcStyleDuration}ms(${r.cdp.RecalcMsPerS}/s) layout=${r.cdp.LayoutDuration}ms(${r.cdp.LayoutMsPerS}/s) busy=${r.profile.busyMs}ms(${r.profile.busyMsPerS}/s) ratio=${r.reconcile.ratio} wsIn=${r.ws.in}(${r.ws.inboundPerS}/s) raf=${r.raf.perS}/s(p50=${r.raf.intervals.p50} >50=${r.raf.intervals.over50}) lt=${r.longtasks.n} bodyWrites=${r.bodyStyleWrites}(${r.bodyStyleWritesPerS}/s) bodyStyleMut=${r.bodyStyleMutationRecords} mut=${r.mutations.records} nodes=${r.state.nodes} tab=${r.state.activeSettingsTab} top=${r.profile.busyTop[0] ? r.profile.busyTop[0].fn + '@' + (r.profile.busyTop[0].url || '').split('/').pop() + ':' + r.profile.busyTop[0].line + '=' + r.profile.busyTop[0].selfMs + 'ms' : '-'} integ=${r.integrity.rafOk && r.integrity.rafRateSane && r.integrity.unitOk ? 'OK' : 'CHECK'} conc=${r.concurrency.gateOutcome}(start foreign=${r.concurrency.censusStart.foreignCount} mine=${r.concurrency.censusStart.mineCount} lock=${r.concurrency.censusStart.lockHeldByMe ? 'MINE' : 'NOTMINE'} | end foreign=${r.concurrency.censusEnd.foreignCount})`); };
  const S = (s) => SCEN === 'all' || SCEN.split(',').includes(s);

  if (S('home-idle')) for (let i = 1; i <= REPS; i++) push(await capture(`home-idle-w${i}`, { scenario: 'home-idle', page: 'home' }, WIN_MS));
  await expandSidebar(page);
  const openProbe = await openSession(page, '会话删除更新误删全部会话');
  await sleep(2500);
  const st = await page.evaluate(`(${COLLECT.toString()})()`);
  console.log('[setup] long session probe=', JSON.stringify(openProbe), 'nodes=', st.nodes, 'selected=', st.selectedRow);
  const metaL = { page: 'long-session', session: '会话删除更新误删全部会话', sessionHeader: st.sessionHeader };
  if (S('long-session-idle')) for (let i = 1; i <= REPS; i++) push(await capture(`long-idle-w${i}`, { scenario: 'long-session-idle', ...metaL }, WIN_MS));
  if (S('long-session-active')) {
    await page.bringToFront();
    const cands = ['会话删除更新误删全部会话', '审计交接提示词并对齐需求', 'DeepSeek模型渠道不存在报错排查'];
    let best = { title: null, rate: -1 };
    for (const c of cands) { await expandSidebar(page); const ok = await openSession(page, c); await sleep(1500); const i0 = wsLog.f.length; await sleep(6000); const got = wsLog.f.slice(i0).filter((x) => x.dir === 'in').length; console.log(`[setup] stream probe ${JSON.stringify(c)} openProbe=${JSON.stringify(ok)} inbound6s=${got}`); if (got > best.rate) best = { title: c, rate: got }; }
    console.log('[setup] active stream source =', JSON.stringify(best));
    await expandSidebar(page); await openSession(page, best.title); await sleep(2500);
    const s2 = await page.evaluate(`(${COLLECT.toString()})()`);
    const metaA = { scenario: 'long-session-active', page: 'long-session', session: best.title, sessionHeader: s2.sessionHeader, streamProbeInbound6s: best.rate };
    for (let i = 1; i <= REPS; i++) push(await capture(`long-active-w${i}`, metaA, WIN_MS));
  }
  const clickSettings = async () => { try { const l = page.locator('button:has-text("设置")').first(); if (await l.count()) { await l.click({ timeout: 2500 }); return true; } } catch { } return false; };
  const clickTab = async (t) => { try { const l = page.locator(`[class*=navCell]:has-text("${t}")`).first(); if (await l.count()) { await l.click({ timeout: 2500 }); return true; } } catch { } return false; };
  const bs = { page: 'settings', session: '会话删除更新误删全部会话' };
  if (S('settings-general-open')) for (let i = 1; i <= REPS; i++) push(await capture(`settings-open-t${i}`, { scenario: 'settings-general-open', ...bs, tab: '通用设置', note: 'window contains the settings-open click' }, 10000, async () => { const ok = await clickSettings(); await sleep(1200); return { action: 'open-settings', ok }; }));
  const stSet = await page.evaluate(`(${COLLECT.toString()})()`);
  console.log('[setup] settings active=', stSet.activeSettingsTab, 'nodes=', stSet.nodes);
  for (const [scen, tab] of [['settings-models-tab', '模型'], ['settings-plugins-tab', '插件']]) {
    if (!S(scen)) continue;
    for (let i = 1; i <= REPS; i++) push(await capture(`${scen}-t${i}`, { scenario: scen, ...bs, tab, note: 'window contains the tab-switch click' }, 10000, async () => { const ok = await clickTab(tab); await sleep(1200); return { action: 'switch-tab:' + tab, ok }; }));
  }
  if (S('settings-dwell')) { const cur = (await page.evaluate(`(${COLLECT.toString()})()`)).activeSettingsTab; await sleep(2500); for (let i = 1; i <= REPS; i++) push(await capture(`settings-dwell-w${i}`, { scenario: 'settings-dwell', ...bs, tab: cur, note: 'zero interaction' }, WIN_MS)); }
  await browser.close();

  const byScenario = {};
  for (const w of windows) {
    const s = w.scenario; if (!byScenario[s]) byScenario[s] = { scenario: s, n: 0, ok: 0, script: [], task: [], recalc: [], layout: [], busy: [], raf: [], rafOver50: 0, ltN: 0, lafN: 0, wsIn: [], nodes: [], mut: 0, writes: [], bodyStyleMut: 0, scriptShare: [], fnMs: {}, bundleMs: {} };
    const a = byScenario[s]; a.n++;
    a.script.push(w.cdp.ScriptMsPerS); a.task.push(w.cdp.TaskMsPerS); a.recalc.push(w.cdp.RecalcMsPerS); a.layout.push(w.cdp.LayoutMsPerS);
    a.busy.push(w.profile.busyMsPerS); a.raf.push(w.raf.perS); a.rafOver50 += w.raf.intervals.over50; a.ltN += w.longtasks.n; a.lafN += w.laf.n;
    a.wsIn.push(w.ws.inboundPerS); a.nodes.push(w.state.nodes); a.mut += w.mutations.records; a.writes.push(w.bodyStyleWritesPerS); a.bodyStyleMut += w.bodyStyleMutationRecords;
    a.scriptShare.push(r3(w.cdp.ScriptDuration / Math.max(0.001, w.cdp.TaskDuration)));
    if (w.integrity.rafOk && w.integrity.rafRateSane && w.integrity.unitOk) a.ok++;
    for (const f of w.profile.busyTop.slice(0, 40)) { const k = `${f.fn} @${(f.url || '').split('/').pop()}:${f.line}`; a.fnMs[k] = r3((a.fnMs[k] || 0) + f.selfMs / w.window.profileWallSec); }
    for (const b of w.profile.bundles) a.bundleMs[b.bundle] = r3((a.bundleMs[b.bundle] || 0) + b.selfMs / w.window.profileWallSec);
  }
  const avg = (x) => (x.length ? r3(x.reduce((p, q) => p + q, 0) / x.length) : null);
  for (const a of Object.values(byScenario)) { a.scriptMsPerS = avg(a.script); a.taskMsPerS = avg(a.task); a.recalcMsPerS = avg(a.recalc); a.layoutMsPerS = avg(a.layout); a.busyMsPerS = avg(a.busy); a.rafPerS = avg(a.raf); a.wsInPerS = avg(a.wsIn); a.nodesAvg = avg(a.nodes); a.writesPerS = avg(a.writes); a.scriptShareOfTask = avg(a.scriptShare); a.topFns = Object.entries(a.fnMs).sort((x, y) => y[1] - x[1]).slice(0, 12); a.bundles = Object.entries(a.bundleMs).sort((x, y) => y[1] - x[1]).slice(0, 8); delete a.fnMs; delete a.bundleMs; }
  const report = { meta: { generatedAt: new Date().toISOString(), stamp: STAMP, exclusivityGate: 'per-window: foreignCount==0 && lockHeldByMe required to start a window', url: URL, winMs: WIN_MS, reps: REPE, scenarios: SCEN, longSessionOpenProbe: openProbe, fix: 'per-window style-write delta (writeMark) + body@style mutation cross-check', unitNote: 'CDP profile timeDeltas are microseconds', discipline: 'read-only; single browser; single page; closed at end', caveat: 'measured with concurrent browser instances and a live host agent; use ratios' }, byScenario, windows, errors };
  fs.writeFileSync(path.join(OUT, `campaign-${STAMP}.json`), JSON.stringify(report, null, 2));
  console.log('\n=== BY SCENARIO ===');
  for (const a of Object.values(byScenario)) { console.log(`${a.scenario.padEnd(22)} n=${a.n}/${a.ok}ok script=${a.scriptMsPerS}ms/s(${r3((a.scriptShareOfTask || 0) * 100)}% of task) task=${a.taskMsPerS}ms/s recalc=${a.recalcMsPerS}ms/s layout=${a.layoutMsPerS}ms/s busy=${a.busyMsPerS}ms/s wsIn=${a.wsInPerS}/s raf=${a.rafPerS}/s raf>50=${a.rafOver50} lt=${a.ltN} laf=${a.lafN} bodyWrites=${a.writesPerS}/s(obs ${a.bodyStyleMut}) mut=${a.mut} nodes=${a.nodesAvg}`); console.log('   top:', JSON.stringify(a.topFns.slice(0, 6))); }
  console.log('errors:', JSON.stringify(errors.slice(0, 4)));
}
const REPE = Number(argOf('reps', 3));
main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
