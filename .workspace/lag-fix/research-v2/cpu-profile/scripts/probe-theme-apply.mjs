// Focused: identify the dominant CPU function from the profile (apply @layout:366),
// then observe its call site, frequency and trigger without editing product source.
// Read-only: only patches the in-page ThemePresenter prototype method's counters.
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = 'http://127.0.0.1:3080';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/cpu-profile/raw';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');

// 1) find ThemePresenter via heap snapshot-free approach: use the prototype chain of a known
//    instance is impossible; instead use CDP HeapProfiler to locate objects by constructor name.
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(9000);

// Use the V8 sampling heap profiler to find allocation site + confirming name
await cdp.send('HeapProfiler.enable');
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 8192 });
await sleep(8000);
const { profile: heap } = await cdp.send('HeapProfiler.stopSampling');
const flat = [];
const walk = (node, depth) => {
  const cf = node.callFrame || {};
  flat.push({ name: cf.functionName, url: cf.url, line: (cf.lineNumber ?? -1) + 1, size: node.selfSize, depth });
  for (const c of node.children || []) walk(c, depth + 1);
};
walk(heap.head, 0);
const allocByFn = new Map();
for (const f of flat) { const k = `${f.name} @${(f.url || '').split('/').pop()}:${f.line}`; allocByFn.set(k, (allocByFn.get(k) || 0) + f.size); }
const allocTop = [...allocByFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => ({ site: k, bytes: v }));

// 2) locate the ThemePresenter instance by walking the plugin module registry in memory:
//    we can read the loaded module via window.__ModuleLoader__ if exposed.
const loaderProbe = await page.evaluate(() => {
  const keys = Object.keys(window).filter((k) => /module|loader|dsh|cordis/i.test(k));
  return { keys, hasLoader: typeof window.__ModuleLoader__ };
});

// 3) patch by prototype discovery: scan object graph from the layout plugin's module exports
const patchResult = await page.evaluate(() => {
  // find any object whose constructor source contains 'ThemePresenter' or whose class name matches
  const seen = new Set(); const queue = [window]; let found = null; let scanned = 0;
  const limit = 60000;
  while (queue.length && scanned < limit) {
    const o = queue.shift(); scanned++;
    if (o === null || typeof o !== 'object' || seen.has(o)) continue;
    seen.add(o);
    let proto; try { proto = Object.getPrototypeOf(o); } catch { continue; }
    if (proto && proto.constructor && /ThemePresenter/.test(proto.constructor.name || '')) { found = o; break; }
    // only walk shallow plugin-ish objects to stay bounded
    let keys; try { keys = Object.getOwnPropertyNames(o); } catch { continue; }
    if (keys.length > 40) continue;
    for (const k of keys) {
      try { const v = o[k]; if (v && typeof v === 'object' && !seen.has(v)) queue.push(v); } catch { }
    }
  }
  if (!found) return { ok: false, scanned, seen };
  const proto = Object.getPrototypeOf(found);
  if (!proto.__wrapped) {
    const orig = proto.apply;
    proto.apply = function (...a) { const S = (window.__tp = window.__tp || { calls: 0, tokens: 0, ms: 0, tokPerCall: [] }); const t = performance.now(); S.calls++; const r = orig.apply(this, a); S.ms += performance.now() - t; S.tokPerCall.push(this.appliedTokens ? this.appliedTokens.length : -1); return r; };
    proto.__wrapped = true;
  }
  window.__tp = window.__tp || { calls: 0, tokens: 0, ms: 0, tokPerCall: [] };
  return { ok: true, scanned, seen: seen.size, ctor: Object.getPrototypeOf(found).constructor.name };
});

await sleep(8000);
const s1 = await page.evaluate(() => ({ calls: window.__tp?.calls, ms: window.__tp?.ms, tok: window.__tp?.tokPerCall?.slice(-5), len: window.__tp?.tokPerCall?.length }));

// 4) causal test: does apply frequency track session events? sample WS frames vs apply calls
const ws = [];
page.on('websocket', (s) => { s.on('framereceived', (d) => { try { const t = typeof d === 'string' ? d : (d.payload ?? '').toString(); ws.push({ t: Date.now(), m: [...t.matchAll(/"method"\s*:\s*"([^"]{1,48})"/g)].map((x) => x[1])[0] || null, len: t.length }); } catch { } }); });
const a = await page.evaluate(() => ({ calls: window.__tp?.calls || 0, t: performance.now() }));
const w0 = ws.length; await sleep(10000); const w1 = ws.length;
const b = await page.evaluate(() => ({ calls: window.__tp?.calls || 0, t: performance.now() }));
const byMethod = {}; for (const f of ws.slice(w0, w1)) byMethod[f.m || 'none'] = (byMethod[f.m || 'none'] || 0) + 1;

// 5) rAF count in the same window for a 60Hz comparison
const rafN = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 5000) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); }));

const out = {
  allocTop, loaderProbe, patch: patchResult,
  window1: { sec: (b.t - a.t) / 1000, applyCalls: b.calls - a.calls, applyCallsPerS: (b.calls - a.calls) / ((b.t - a.t) / 1000), wsFrames: w1 - w0, wsPerS: (w1 - w0) / ((b.t - a.t) / 1000), byMethod, rafIn5s: rafN },
  early: s1,
};
fs.writeFileSync(`${OUT}/theme-apply-probe.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2).slice(0, 5000));
await browser.close();
