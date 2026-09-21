// Read-only: expand workspace groups in sidebar and enumerate session rows to pick a long session.
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const URL = 'http://127.0.0.1:3080';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/cpu-profile/raw';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(7000);

// What is the group header element? inspect one group's inner HTML skeleton
const skel = await page.evaluate(() => {
  const g = document.querySelector('[class*=groupSection]');
  if (!g) return null;
  const walk = (el, d = 0) => {
    if (d > 3) return [];
    return [...el.children].map((c) => ({
      tag: c.tagName.toLowerCase(), cls: String(c.className).slice(0, 70), role: c.getAttribute('role') || '',
      aria: c.getAttribute('aria-label') || '', text: (c.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 50),
      kids: walk(c, d + 1),
    }));
  };
  return walk(g);
});
fs.writeFileSync(`${OUT}/group-skeleton.json`, JSON.stringify(skel, null, 2));

// Expand every group by clicking its action/expand control.
const labels = await page.evaluate(() => [...document.querySelectorAll('button[aria-label]')].map((b) => b.getAttribute('aria-label')).filter((a) => /工作区“/.test(a)));
let clicked = 0;
for (const lab of labels) {
  for (const t of ['展开', '折叠']) {
    try {
      const b = page.locator(`button[aria-label="${lab.replace(/"/g, '')}"]`).first();
      if (await b.count()) { await b.click({ timeout: 2000 }); clicked++; await sleep(250); }
    } catch { }
    break;
  }
}
// Also try generic expand toggles inside groups
const toggles = await page.evaluate(() => [...document.querySelectorAll('[class*=groupSection] button, [class*=groupSection] [role=button]')].map((b) => ({ aria: b.getAttribute('aria-label') || '', text: (b.innerText || '').trim().slice(0, 30), cls: String(b.className).slice(0, 60) })));
await sleep(3000);

const rows = await page.evaluate(() => [...document.querySelectorAll('[role=treeitem]')].map((r) => ({
  text: (r.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 140),
  cls: String(r.className).slice(0, 60), sel: r.getAttribute('aria-selected'), attrs: [...r.attributes].map((a) => a.name).join(','),
})));
fs.writeFileSync(`${OUT}/sidebar-expanded.json`, JSON.stringify({ skeleton: skel, labels, toggles, rows }, null, 2));
console.log(JSON.stringify({ groupActionLabels: labels.length, togglesFound: toggles.length, rowCount: rows.length, rows: rows.slice(0, 60) }, null, 2));
await browser.close();
