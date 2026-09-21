// Verify the in-page instrumentation actually counts mutations / rAF / longtask.
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';

const INIT_HOOKS = () => {
  if (window.__cpu) return;
  const S = { raf: [], lt: [], et: [], mu: [], view: 'v0', rafInside: 0 };
  window.__cpu = S;
  requestAnimationFrame(function rafLoop(t) { S.raf.push(t); S.rafInside++; requestAnimationFrame(rafLoop); });
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) S.lt.push({ s: e.startTime, d: e.duration, n: e.name }); }).observe({ entryTypes: ['longtask'] }); } catch { }
  try {
    const obs = new MutationObserver((recs) => {
      let added = 0, removed = 0, attrs = 0, chars = 0; const targets = {};
      for (const r of recs) {
        if (r.type === 'childList') { added += r.addedNodes.length; removed += r.removedNodes.length; }
        else if (r.type === 'attributes') { attrs++; const k = (r.target.nodeName || '?') + '.' + (r.attributeName || ''); targets[k] = (targets[k] || 0) + 1; }
        else if (r.type === 'characterData') chars++;
      }
      S.mu.push({ t: performance.now(), n: recs.length, added, removed, attrs, chars, targets });
    });
    obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  } catch { }
};

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(INIT_HOOKS);
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3080', { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise((r) => setTimeout(r, 8000));

// 1) baseline
const b0 = await page.evaluate(() => ({ mu: window.__cpu.mu.length, raf: window.__cpu.raf.length, rafInside: window.__cpu.rafInside, lt: window.__cpu.lt.length }));
// 2) synthesise DOM churn from OUTSIDE the app (proves observer works)
await page.evaluate(() => {
  const d = document.createElement('div');
  d.id = 'instrumentation-probe';
  document.body.appendChild(d);
  for (let i = 0; i < 50; i++) d.setAttribute('data-i', String(i));
  d.textContent = 'x'.repeat(5);
});
await new Promise((r) => setTimeout(r, 800));
const b1 = await page.evaluate(() => ({ mu: window.__cpu.mu.length, records: window.__cpu.mu.reduce((a, m) => a + m.n, 0), added: window.__cpu.mu.reduce((a, m) => a + m.added, 0), attrs: window.__cpu.mu.reduce((a, m) => a + m.attrs, 0), chars: window.__cpu.mu.reduce((a, m) => a + m.chars, 0), targets: window.__cpu.mu.slice(-3) }));
// 3) cleanup probe element (also observed)
await page.evaluate(() => document.getElementById('instrumentation-probe')?.remove());
await new Promise((r) => setTimeout(r, 500));
const b2 = await page.evaluate(() => ({ mu: window.__cpu.mu.length, removed: window.__cpu.mu.reduce((a, m) => a + m.removed, 0) }));
// 4) app-level churn: does opening settings produce mutations?
await page.evaluate(() => { window.__cpu.mu.length = 0; });
await page.locator('button:has-text("设置")').first().click({ timeout: 3000 }).catch(() => { });
await new Promise((r) => setTimeout(r, 2500));
const b3 = await page.evaluate(() => ({ mu: window.__cpu.mu.length, records: window.__cpu.mu.reduce((a, m) => a + m.n, 0), added: window.__cpu.mu.reduce((a, m) => a + m.added, 0), attrs: window.__cpu.mu.reduce((a, m) => a + m.attrs, 0) }));
// 5) 8s settled app window
await page.evaluate(() => { window.__cpu.mu.length = 0; window.__cpu.raf.length = 0; });
await new Promise((r) => setTimeout(r, 8000));
const b4 = await page.evaluate(() => ({ mu: window.__cpu.mu.length, records: window.__cpu.mu.reduce((a, m) => a + m.n, 0), attrs: window.__cpu.mu.reduce((a, m) => a + m.attrs, 0), added: window.__cpu.mu.reduce((a, m) => a + m.added, 0), top: [...window.__cpu.mu.slice(-5)] }));

console.log(JSON.stringify({ baseline: b0, afterSynthetic: b1, afterRemove: b2, settingsOpen: b3, settled8s: b4 }, null, 2).slice(0, 3500));
await browser.close();
