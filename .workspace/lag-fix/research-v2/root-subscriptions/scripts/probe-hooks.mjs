/*
 * Establish the SettingsRoot hook chain EMPIRICALLY (no index guessing), compare
 * two commits, and re-check hook identity change vs parent render for each
 * SettingsRoot render. Read-only: opens the settings panel (its default section)
 * and switches the nav tab; never clicks save/apply/delete/model-switch.
 */
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/root-subscriptions';
const OUT = path.join(DIR, 'raw');

const b = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const c = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await c.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
await p.addInitScript(() => {
  let uid = 0; const rs = new Map();
  const H = {
    supportsFiber: true, renderers: new Map(), calls: 0,
    inject(i) { const id = ++uid; this.renderers.set(id, i); this.injected = i; return id; },
    onCommitFiberRoot() { this.calls++; }, onPostCommitFiberRoot() { }, onCommitFiberUnmount() { },
    getFiberRoots(id) { return rs.get(id) || new Set(); }, checkDCE() { }, setStrictMode() { },
  };
  Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', { configurable: true, writable: true, value: H });
});
await p.goto('http://127.0.0.1:3080', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(12000);

await p.evaluate(() => {
  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  window.__HP__ = { samples: [], errs: [] };
  const safe = (fn, def) => { try { return fn(); } catch (e) { window.__HP__.errs.push(String(e && e.message || e)); return def; } };
  function nameOf(f) { return safe(() => { const t = f.type || f.elementType; if (typeof t === 'string') return 'host:' + t; if (typeof t === 'function') return t.displayName || t.name || 'anon'; return String(t); }, '?'); }
  function findSR(node, d, out) {
    if (!node || d > 200) return out;
    safe(() => { const t = node.type || node.elementType; if (typeof t !== 'string' && nameOf(node) === 'SettingsRoot') out.push(node); });
    safe(() => { let ch = node.child; while (ch) { findSR(ch, d + 1, out); ch = ch.sibling; } });
    return out;
  }
  const pw = (x) => safe(() => !!x && ((x.flags | 0) & 1) === 1, false);
  function hookCount(f) { return safe(() => { let n = 0, h = f.memoizedState; while (h && n < 64) { n++; h = h.next; } return n; }, -1); }
  function sig(f) {
    return safe(() => {
      const out = [];
      let h = f.memoizedState, i = 0;
      while (h && i < 24) {
        const v = h.memoizedState;
        const altV = h.alternate ? h.alternate.memoizedState : '__noalt__';
        out.push({
          i,
          kind: v === null ? 'null' : v === undefined ? 'undefined' : Array.isArray(v) ? 'array' : (v instanceof Set ? 'Set' : typeof v),
          len: Array.isArray(v) ? v.length : (v instanceof Set ? v.size : null),
          val: (typeof v === 'boolean' || typeof v === 'string' || typeof v === 'number') ? v : undefined,
          obKeys: safe(() => (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Set)) ? Object.keys(v).slice(0, 6) : null, null),
          altPresent: h.alternate !== null && h.alternate !== undefined,
          changedVsAlt: (h.alternate ? v !== altV : null),
          first: safe(() => Array.isArray(v) && v.length ? JSON.stringify(v[0]).slice(0, 90) : undefined, undefined),
        });
        h = h.next; i++;
      }
      return out;
    }, []);
  }
  hook.onCommitFiberRoot = function (id, root, pr, err) {
    try {
      const found = findSR(root.current, 0, []);
      if (found.length) {
        let f = found[0];
        for (const x of found) if (hookCount(x) > hookCount(f)) f = x;
        const parent = f.return;
        const sample = {
          t: Math.round(performance.now()),
          panel: document.querySelectorAll('div[role="dialog"][aria-modal="true"]').length,
          parentName: parent ? nameOf(parent) : null,
          parentPw: pw(parent),
          nFound: found.length,
          sig: sig(f),
        };
        if (window.__HP__.samples.length <= 2) sample.chain = safe(() => { const o = []; let x = f, i = 0; while (x && i < 6) { o.push({ i, name: nameOf(x), pw: pw(x), hooks: hookCount(x) }); x = x.return; i++; } return o; }, []);
        window.__HP__.samples.push(sample);
      }
    } catch (e) { window.__HP__.errs.push(String(e && e.message || e)); }
  };
  window.__HP__.ready = true;
});
await p.waitForTimeout(2000);

const cnt = () => p.evaluate(() => window.__HP__.samples.length);
const before = await cnt();
await p.locator('button[aria-haspopup="dialog"]').first().click({ timeout: 8000 });
await p.waitForTimeout(4000);
const afterOpen = await cnt();
const tabs = p.locator('div[role="dialog"][aria-modal="true"] nav button');
const n = await tabs.count();
const labels = [];
for (let i = 0; i < n; i++) labels.push((await tabs.nth(i).innerText()).trim());
for (let i = 0; i < n; i++) if (/模型|Models/i.test(labels[i])) { await tabs.nth(i).click({ timeout: 6000 }); break; }
await p.waitForTimeout(4000);
const afterModels = await cnt();
for (let i = 0; i < n; i++) if (/通用|General/i.test(labels[i])) { await tabs.nth(i).click({ timeout: 6000 }); break; }
await p.waitForTimeout(5000);
const afterBack = await cnt();

const out = await p.evaluate(() => window.__HP__);
out.phaseCounts = { before, afterOpen, afterModels, afterBack };
out.labels = labels;
out.hookCalls = await p.evaluate(() => window.__REACT_DEVTOOLS_GLOBAL_HOOK__.calls);
fs.writeFileSync(path.join(OUT, 'probe-hooks.json'), JSON.stringify(out, null, 1));

console.log('samples', out.samples.length, 'errs', out.errs.slice(0, 3), 'labels', labels);
console.log('phaseCounts', JSON.stringify(out.phaseCounts), 'hookCalls', out.hookCalls);
console.log('chain(early):', JSON.stringify(out.samples[0] && out.samples[0].chain));
const last = out.samples[out.samples.length - 1];
if (last) { console.log('hook shapes (last):'); for (const h of last.sig) console.log('  [' + h.i + ']', JSON.stringify(h)); }
await b.close();
