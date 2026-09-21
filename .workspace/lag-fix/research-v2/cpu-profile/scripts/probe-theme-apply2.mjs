// Locate ThemePresenter via the module loader registry and count apply() calls +
// per-call token writes. Read-only: only replaces the prototype method with a
// counting wrapper in the live page (no product source is modified).
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = 'http://127.0.0.1:3080';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/cpu-profile/raw';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(9000);

// inspect the loader shape
const loaderShape = await page.evaluate(() => {
  const L = window.__ModuleLoader__;
  const props = Object.getOwnPropertyNames(L).map((k) => {
    let t; try { t = typeof L[k]; } catch { t = '?'; }
    let n = null; try { if (L[k] && typeof L[k] === 'object') n = Object.keys(L[k]).length; } catch { }
    return { k, t, n };
  });
  return { props, proto: Object.getOwnPropertyNames(Object.getPrototypeOf(L) || {}) };
});
console.log('loader shape:', JSON.stringify(loaderShape).slice(0, 1200));

const hooked = await page.evaluate(() => {
  const L = window.__ModuleLoader__;
  // find a registry map: object whose values are modules with an `exports`
  const candidates = [];
  for (const k of Object.getOwnPropertyNames(L)) {
    let v; try { v = L[k]; } catch { continue; }
    if (v && typeof v === 'object') {
      let keys; try { keys = Object.keys(v); } catch { continue; }
      const isRegistry = keys.length > 3 && keys.some((id) => /dsh-|deepseek/i.test(id));
      candidates.push({ k, len: keys.length, isRegistry, sample: keys.slice(0, 4) });
    }
  }
  const reg = candidates.find((c) => c.isRegistry) ? L[candidates.find((c) => c.isRegistry).k] : null;
  if (!reg) return { ok: false, candidates };
  const layoutMod = reg['@deepseek-ai/dsh-client-ui-layout'];
  if (!layoutMod) return { ok: false, candidates, ids: Object.keys(reg).filter((x) => /layout/.test(x)) };
  const ex = layoutMod.exports || layoutMod;
  const names = Object.keys(ex);
  // find the ThemePresenter class among exports/values
  let found = null, foundName = null;
  const scan = (obj, prefix, depth) => {
    if (!obj || typeof obj !== 'object' || depth > 3) return;
    for (const k of Object.getOwnPropertyNames(obj)) {
      let v; try { v = obj[k]; } catch { continue; }
      if (typeof v === 'function' && /ThemePresenter/.test(v.name || '')) { found = v; foundName = prefix + '.' + k; return; }
      if (v && typeof v === 'object') scan(v, prefix + '.' + k, depth + 1);
    }
  };
  scan(ex, 'exports', 0);
  if (!found) return { ok: false, names: names.slice(0, 20) };
  const orig = found.prototype.apply;
  window.__tp = { calls: 0, ms: 0, tokPerCall: [], hookedName: foundName };
  found.prototype.apply = function (...a) {
    const t = performance.now(); window.__tp.calls++;
    const r = orig.apply(this, a);
    window.__tp.ms += performance.now() - t;
    window.__tp.tokPerCall.push(this.appliedTokens ? this.appliedTokens.length : -1);
    return r;
  };
  return { ok: true, hookedName: foundName, exportNames: names.slice(0, 20) };
});
console.log('hooked:', JSON.stringify(hooked).slice(0, 1200));

const ws = [];
page.on('websocket', (s) => { s.on('framereceived', (d) => { try { const t = typeof d === 'string' ? d : (d.payload ?? '').toString(); ws.push({ t: Date.now(), m: [...t.matchAll(/"method"\s*:\s*"([^"]{1,48})"/g)].map((x) => x[1])[0] || null }); } catch { } }); });
await sleep(2000);
const a = await page.evaluate(() => ({ c: window.__tp?.calls || 0, t: performance.now() })); const w0 = ws.length;
await sleep(10000);
const b = await page.evaluate(() => ({ c: window.__tp?.calls || 0, t: performance.now() })); const w1 = ws.length;

const out = { loaderShape, hooked, window: { sec: (b.t - a.t) / 1000, applyCalls: b.c - a.c, applyPerS: (b.c - a.c) / ((b.t - a.t) / 1000), wsFrames: w1 - w0 }, tp: await page.evaluate(() => window.__tp ? { calls: window.__tp.calls, ms: window.__tp.ms, tok: window.__tp.tokPerCall.slice(-6), tokMax: Math.max(...window.__tp.tokPerCall), tokMin: Math.min(...window.__tp.tokPerCall), name: window.__tp.hookedName } : null) };
fs.writeFileSync(`${OUT}/theme-apply-probe2.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2).slice(0, 3000));
await browser.close();
