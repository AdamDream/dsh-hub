// Causal A/B v2. Attach by intercepting the CSSStyleDeclaration.setProperty call that
// ThemePresenter.apply itself makes: `this` inside that call is document.body.style, but
// the *caller* is the ThemePresenter instance, which we recover from the stack's top
// frame's receiver. We wrap document.body.style.setProperty with a function that walks
// `arguments.callee.caller` -> unavailable in strict mode, so instead we expose the
// receiver via a Proxy trap on the body style object's setProperty: the trap IS called
// with the ThemePresenter as `this` because apply invokes `body.style.setProperty(...)`.
// Hence: `this` in the trap is the style object; the receiver we need is obtained by
// hooking Function.prototype.apply is not viable -> we instead find the presenter by
// scanning for the object whose own property `appliedTokens` is an array and which also
// has a function property named `apply`. That object is reachable from the DOM? No.
//
// Final approach: throttle at the effect boundary by wrapping the CLASS obtained from
// the stack trace receiver using Error.captureStackTrace.
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = 'http://127.0.0.1:3080';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/cpu-profile/raw';

const HOOK = () => {
  window.__sp = { props: 0, handoff: null, attached: false, info: null };
  let styleObj = null;
  const patchProto = () => {
    const proto = Object.getPrototypeOf(document.body.style);
    if (proto.__patched) return true;
    const orig = proto.setProperty;
    proto.setProperty = function (n, v, p) {
      if (this === document.body.style) {
        window.__sp.props++;
        if (!window.__sp.attached) {
          // recover the presenter: the immediately-enclosing function is ThemePresenter.apply
          const prev = Error.prepareStackTrace;
          let receiver = null;
          try {
            Error.prepareStackTrace = (err, frames) => frames;
            const frames = new Error().stack;
            for (const f of frames) {
              const fn = f.getFunction();
              if (fn && /ThemePresenter/.test(fn.name || '') === false && fn.name === 'apply') {
                receiver = f.getThis();
                break;
              }
            }
          } catch (e) { window.__sp.info = 'stack fail: ' + String(e).slice(0, 80); }
          finally { Error.prepareStackTrace = prev; }
          if (receiver) {
            const rproto = Object.getPrototypeOf(receiver);
            const oApply = rproto.apply;
            window.__tp = { calls: 0, applied: 0, throttled: 0, ms: 0, sigs: [], mode: 'pass' };
            window.__sp.info = { ctor: rproto.constructor.name, hasTokens: Array.isArray(receiver.appliedTokens) };
            rproto.apply = function (snap) {
              const S = window.__tp; S.calls++;
              if (S.mode === 'throttle') {
                const now = performance.now();
                if (this.__lastAt !== undefined && now - this.__lastAt < 500) { S.throttled++; return; }
                this.__lastAt = now;
              }
              if (S.sigs.length < 5) { try { S.sigs.push(JSON.stringify(snap && snap.active ? snap.active : snap).slice(0, 160)); } catch { } }
              const t = performance.now(); const r = oApply.call(this, snap); S.ms += performance.now() - t; S.applied++;
              return r;
            };
            window.__sp.attached = true;
          }
        }
      }
      return orig.call(this, n, v, p);
    };
    proto.__patched = true;
    return true;
  };
  if (document.body) patchProto(); else { const iv = setInterval(() => { if (document.body && patchProto()) clearInterval(iv); }, 40); }
};

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(HOOK);
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(9000);
console.log('attach:', JSON.stringify(await page.evaluate(() => window.__sp)));

// open the long session
const projects = await page.evaluate(() => [...document.querySelectorAll('[class*=projectRow]')].map((r) => (r.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)));
for (const t of projects) { try { await page.locator('[class*=projectRow]', { hasText: t }).first().click({ timeout: 1200 }); await sleep(150); } catch { } }
try { const el = page.getByText('会话删除更新误删全部会话', { exact: false }).first(); if (await el.count()) await el.click({ timeout: 2500 }); } catch { }
await sleep(3000);

const run = async (label, mode, ms) => {
  await page.evaluate((m) => { if (window.__tp) { window.__tp.calls = 0; window.__tp.applied = 0; window.__tp.throttled = 0; window.__tp.ms = 0; window.__tp.sigs = []; window.__tp.mode = m; } window.__sp.props = 0; }, mode);
  const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
  await sleep(ms);
  const { profile } = await cdp.send('Profiler.stop');
  const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  const st = await page.evaluate(() => ({ tp: window.__tp ? { calls: window.__tp.calls, applied: window.__tp.applied, throttled: window.__tp.throttled, ms: Math.round(window.__tp.ms * 100) / 100, sigs: window.__tp.sigs } : null, props: window.__sp.props, info: window.__sp.info }));
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map(); for (const s of profile.samples || []) self.set(s, (self.get(s) || 0) + 1);
  const deltas = profile.timeDeltas || []; const sumUs = deltas.reduce((a, b) => a + b, 0);
  const msPerSample = (deltas.length ? sumUs / deltas.length : 1000) / 1000;
  const wallMs = (profile.endTime - profile.startTime) / 1000;
  const rows = [...self.entries()].map(([id, c]) => { const cf = byId.get(id)?.callFrame || {}; return { fn: cf.functionName || '(anonymous)', url: (cf.url || '').split('/').pop(), line: (cf.lineNumber ?? -1) + 1, ms: Math.round(c * msPerSample * 100) / 100, msPerS: Math.round(((c * msPerSample) / (wallMs / 1000)) * 100) / 100 }; }).sort((a, b) => b.ms - a.ms);
  const g = (k) => Math.round(((m1[k] - m0[k]) * 1000) * 100) / 100;
  const applyMs = rows.filter((r) => r.fn === 'apply' && r.url === 'client.js?rev=abdb7f55acba').reduce((a, r) => a + r.ms, 0);
  return { label, mode, wallSec: Math.round((wallMs / 1000) * 100) / 100, scriptMs: g('ScriptDuration'), taskMs: g('TaskDuration'), recalcMs: g('RecalcStyleDuration'), layoutMs: g('LayoutDuration'), applyProfileMs: Math.round(applyMs * 100) / 100, rows: rows.slice(0, 6), st };
};

const res = [];
for (const [l, m] of [['A1-pass', 'pass'], ['B1-throttle', 'throttle'], ['A2-pass', 'pass'], ['B2-throttle', 'throttle']]) res.push(await run(l, m, 12000));

fs.writeFileSync(`${OUT}/apply-ab2.json`, JSON.stringify({ results: res }, null, 2));
for (const r of res) console.log(`\n=== ${r.label} mode=${r.mode} wall=${r.wallSec}s script=${r.scriptMs}ms task=${r.taskMs}ms recalc=${r.recalcMs}ms layout=${r.layoutMs}ms applyProfileMs=${r.applyProfileMs}\n  tp=${JSON.stringify(r.st.tp)}\n  info=${JSON.stringify(r.st.info)} props=${r.st.props}\n  top=${JSON.stringify(r.rows.slice(0, 4))}`);
await browser.close();
