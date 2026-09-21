// Causal A/B: does the dominant cost come from ThemePresenter.apply being called on
// every theme snapshot regardless of content?  We patch the prototype IN THE PAGE
// (no product source touched) so that identical snapshots are skipped, and measure
// the delta in the same session on the same page.
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = 'http://127.0.0.1:3080';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/cpu-profile/raw';

const HOOK = () => {
  window.__sp = { props: 0, writes: 0, stacks: [] };
  const install = () => {
    if (window.__sp.installed) return true;
    const body = document.body; if (!body) return false;
    const proto = Object.getPrototypeOf(body.style);
    const oSet = proto.setProperty;
    proto.setProperty = function (n, v, p) { if (this === document.body.style) { window.__sp.props++; window.__sp.writes++; if (window.__sp.stacks.length < 3) window.__sp.stacks.push(new Error('x').stack.split('\n').slice(1, 5).join(' | ')); } return oSet.call(this, n, v, p); };
    window.__sp.installed = true; return true;
  };
  if (!install()) { const iv = setInterval(() => { if (install()) clearInterval(iv); }, 40); }
};

// Patch ThemePresenter to skip identical snapshots. We find the class by reading the
// layout plugin bundle through the module loader (mode/create are functions; the
// exports are reached via the already-instantiated presenter: we hook by scanning the
// React fiber tree is not needed -- instead we patch the *class* obtained from the
// prototype of an instance located through apply's own `this` binding).
const PATCH = () => {
  // Wrap CSSStyleDeclaration writes so we can capture `this` of the ThemePresenter by
  // monkey-patching Object.getPrototypeOf(document.body.style) is unrelated; instead we
  // install a one-shot trap on document.body.setAttribute('style') -> no.
  // Practical approach: capture the ThemePresenter instance from the call stack using
  // Error.prepareStackTrace on the first apply call.
  const S = (window.__tp = window.__tp || { calls: 0, skipped: 0, applied: 0, protoPatched: false, instance: null, tokensPerApply: [] });
  if (S.protoPatched) return { already: true };
  let captured = false;
  const origPrepare = Error.prepareStackTrace;
  const captureOnce = () => {
    // wrap the body style setter path to grab `this` of the caller frame
    const proto = Object.getPrototypeOf(document.body.style);
    const oSet = proto.setProperty;
    proto.setProperty = function (...a) {
      if (!captured) {
        let st; try { st = new Error().stack; } catch { }
        // find the frame for ThemePresenter.apply and its receiver via arguments.callee is not available;
        // instead rely on the fact that ThemePresenter.apply sets document.body.style props while
        // `this.appliedTokens` is an own array property on the receiver. We can find the receiver by
        // scanning the probe: patch the class instead.
        captured = true;
      }
      return oSet.apply(this, a);
    };
  };
  captureOnce();
  return { installed: true };
};

const bctxInit = { HOOK, PATCH };

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(HOOK);
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(9000);

// Locate ThemePresenter class through the plugin bundle itself: fetch the bundle text and
// evaluate its class in isolation is not possible. Instead use CDP Runtime to find the
// prototype: search all objects of the layout plugin via the React fiber of body.
const hookRes = await page.evaluate(() => {
  // Walk the React fiber tree from the root container to find a component whose
  // memoizedState/instance has an `apply` method plus `appliedTokens`.
  const roots = [...document.querySelectorAll('#root, #app, body > div')];
  const key = Object.keys(roots[0] || {}).find((k) => k.startsWith('__reactContainer') || k.startsWith('__reactFiber'));
  if (!key) return { ok: false, reason: 'no react root key', keys: Object.keys(roots[0] || {}).slice(0, 8) };
  let fiber = roots[0][key];
  const seen = new Set(); const stack = [fiber]; let found = null; let visited = 0;
  while (stack.length && visited < 200000) {
    const f = stack.pop(); if (!f || seen.has(f)) continue; seen.add(f); visited++;
    const cand = [f.stateNode, f.memoizedState, f.memoizedProps, f.pendingProps, f.dependencies, f.elementType];
    for (const c of cand) {
      if (c && typeof c === 'object') {
        const proto = Object.getPrototypeOf(c);
        if (proto && proto.constructor && /ThemePresenter/.test(proto.constructor.name || '')) { found = c; break; }
      }
    }
    if (found) break;
    for (const k of ['child', 'sibling', 'return', 'alternate']) if (f[k]) stack.push(f[k]);
    if (f.memoizedState && typeof f.memoizedState === 'object') stack.push(f.memoizedState);
  }
  if (!found) return { ok: false, reason: 'ThemePresenter instance not found via fiber', visited };
  const proto = Object.getPrototypeOf(found);
  const orig = proto.apply;
  window.__tp = { calls: 0, skipped: 0, applied: 0, ms: 0, tokensPerApply: [], mode: 'pass', ctor: proto.constructor.name };
  proto.apply = function (snapshot) {
    window.__tp.calls++;
    if (window.__tp.mode === 'dedupe') {
      const sig = snapshot && snapshot.active ? JSON.stringify(snapshot.active) : null;
      if (this.__lastSig === sig) { window.__tp.skipped++; return; }
      this.__lastSig = sig;
    }
    const t = performance.now();
    const r = orig.call(this, snapshot);
    window.__tp.ms += performance.now() - t;
    window.__tp.applied++;
    window.__tp.tokensPerApply.push(this.appliedTokens ? this.appliedTokens.length : -1);
    return r;
  };
  return { ok: true, visited, ctor: proto.constructor.name };
});
console.log('hook:', JSON.stringify(hookRes));

const runWindow = async (label, mode, ms) => {
  await page.evaluate((m) => { if (window.__tp) { window.__tp.calls = 0; window.__tp.skipped = 0; window.__tp.applied = 0; window.__tp.ms = 0; window.__tp.tokensPerApply = []; window.__tp.mode = m; } window.__sp.props = 0; }, mode);
  const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
  await sleep(ms);
  const { profile } = await cdp.send('Profiler.stop');
  const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  const tp = await page.evaluate(() => window.__tp ? { calls: window.__tp.calls, skipped: window.__tp.skipped, applied: window.__tp.applied, ms: window.__tp.ms, tok: window.__tp.tokensPerApply.slice(-3), props: window.__sp.props } : null);
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map(); for (const s of profile.samples || []) self.set(s, (self.get(s) || 0) + 1);
  const deltas = profile.timeDeltas || []; const sumUs = deltas.reduce((a, b) => a + b, 0);
  const msPerSample = (deltas.length ? sumUs / deltas.length : 1000) / 1000;
  const wallMs = (profile.endTime - profile.startTime) / 1000;
  const rows = [...self.entries()].map(([id, c]) => { const cf = byId.get(id)?.callFrame || {}; return { fn: cf.functionName || '(anonymous)', url: (cf.url || '').split('/').pop(), line: (cf.lineNumber ?? -1) + 1, ms: Math.round(c * msPerSample * 100) / 100, msPerS: Math.round(((c * msPerSample) / (wallMs / 1000)) * 100) / 100 }; }).sort((a, b) => b.ms - a.ms);
  const g = (k) => Math.round(((m1[k] - m0[k]) * 1000) * 1000) / 1000;
  const applySum = rows.filter((r) => r.fn === 'apply' && r.url === 'client.js?rev=abdb7f55acba').reduce((a, r) => a + r.ms, 0);
  return { label, mode, wallSec: Math.round((wallMs / 1000) * 100) / 100, scriptMs: g('ScriptDuration'), taskMs: g('TaskDuration'), recalcMs: g('RecalcStyleDuration'), layoutMs: g('LayoutDuration'), recalcCount: g('RecalcStyleCount'), applyProfileMs: Math.round(applySum * 100) / 100, applyRows: rows.filter((r) => r.fn === 'apply').slice(0, 4), top5: rows.slice(0, 5), tp };
};

// open long session first (heaviest realistic context)
const projects = await page.evaluate(() => [...document.querySelectorAll('[class*=projectRow]')].map((r) => (r.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)));
for (const t of projects) { try { await page.locator('[class*=projectRow]', { hasText: t }).first().click({ timeout: 1200 }); await sleep(150); } catch { } }
try { const el = page.getByText('会话删除更新误删全部会话', { exact: false }).first(); if (await el.count()) await el.click({ timeout: 2500 }); } catch { }
await sleep(3500);

const res = [];
res.push(await runWindow('long-A-pass', 'pass', 12000));
res.push(await runWindow('long-B-dedupe', 'dedupe', 12000));
res.push(await runWindow('long-A2-pass', 'pass', 12000));
res.push(await runWindow('long-B2-dedupe', 'dedupe', 12000));

// settings general
try { const l = page.locator('button:has-text("设置")').first(); if (await l.count()) await l.click({ timeout: 2500 }); } catch { }
await sleep(2500);
res.push(await runWindow('settings-A-pass', 'pass', 12000));
res.push(await runWindow('settings-B-dedupe', 'dedupe', 12000));

fs.writeFileSync(`${OUT}/apply-ab.json`, JSON.stringify({ hook: hookRes, results: res }, null, 2));
for (const r of res) console.log(`\n=== ${r.label} mode=${r.mode} wall=${r.wallSec}s\n  script=${r.scriptMs}ms task=${r.taskMs}ms recalc=${r.recalcMs}ms (n=${r.recalcCount}) layout=${r.layoutMs}ms\n  applyProfileMs=${r.applyProfileMs} rows=${JSON.stringify(r.applyRows)}\n  tp=${JSON.stringify(r.tp)}\n  top5=${JSON.stringify(r.top5)}`);
await browser.close();
