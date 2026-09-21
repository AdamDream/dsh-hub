// Minimal check: does the MutationObserver inside an addInitScript hook actually record?
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext();
await ctx.addInitScript(() => {
  window.__t = { mu: [], err: null };
  try {
    const obs = new MutationObserver((recs) => { window.__t.mu.push(recs.length); });
    obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    window.__t.installed = true;
  } catch (e) { window.__t.err = String(e); }
});
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3080', { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise((r) => setTimeout(r, 7000));
console.log('installed:', JSON.stringify(await page.evaluate(() => ({ installed: window.__t.installed, err: window.__t.err, root: !!document.documentElement }))));
await page.evaluate(() => { const d = document.createElement('div'); d.id = 'probe'; document.documentElement.appendChild(d); for (let i = 0; i < 30; i++) d.setAttribute('data-i', String(i)); });
await new Promise((r) => setTimeout(r, 1200));
console.log('after synthetic:', JSON.stringify(await page.evaluate(() => ({ batches: window.__t.mu.length, records: window.__t.mu.reduce((a, b) => a + b, 0) }))));
console.log('isolated-world probe:', JSON.stringify(await page.evaluate(() => typeof window.__t)));
await browser.close();
