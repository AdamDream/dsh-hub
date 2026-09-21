// Read-only: click project rows themselves to expand, then enumerate all session rows.
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

const before = await page.evaluate(() => [...document.querySelectorAll('[role=treeitem]')].map((r) => ({ t: (r.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60), cls: String(r.className).slice(0, 30), exp: r.getAttribute('aria-expanded') })));
// click each project row (skip the selected session row)
const projects = await page.evaluate(() => [...document.querySelectorAll('[class*=projectRow]')].map((r) => (r.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)));
for (const title of projects) {
  try {
    const row = page.locator('[class*=projectRow]', { hasText: title }).first();
    if (await row.count()) { await row.click({ timeout: 2000, position: { x: 5, y: 5 } }); await sleep(400); }
  } catch (e) { }
}
await sleep(4000);
const after = await page.evaluate(() => [...document.querySelectorAll('[role=treeitem]')].map((r) => ({ t: (r.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 90), cls: String(r.className).slice(0, 30), exp: r.getAttribute('aria-expanded') })));
fs.writeFileSync(`${OUT}/sidebar-after-click.json`, JSON.stringify({ before, projects, after }, null, 2));
console.log(JSON.stringify({ projects, afterCount: after.length, after }, null, 2).slice(0, 6000));
await browser.close();
