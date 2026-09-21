// Read-only: reliably open a long session from the sidebar, and prove we opened one.
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const URL = 'http://127.0.0.1:3080';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/cpu-profile/raw';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const frames = [];
page.on('websocket', (s) => {
  s.on('framereceived', (d) => { const t = typeof d === 'string' ? d : (d.payload ?? '').toString(); frames.push({ t: Date.now(), m: [...t.matchAll(/"method"\s*:\s*"([^"]{1,48})"/g)].map((x) => x[1]).slice(0, 2), len: t.length }); });
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(7000);

const dump = async (tag) => {
  const d = await page.evaluate(() => ({
    url: location.href, nodes: document.getElementsByTagName('*').length,
    sel: [...document.querySelectorAll('[role=treeitem][aria-selected=true]')].map((r) => (r.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60)),
    body: (document.body.innerText || '').slice(0, 200),
    msgs: document.querySelectorAll('[class*=message],[data-message-id],[class*=Message]').length,
    headerText: (document.querySelector('header')?.innerText || '').slice(0, 120),
  }));
  console.log(tag, JSON.stringify(d));
  return d;
};
await dump('home');

// expand project rows
const projects = await page.evaluate(() => [...document.querySelectorAll('[class*=projectRow]')].map((r) => (r.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)));
for (const title of projects) { try { await page.locator('[class*=projectRow]', { hasText: title }).first().click({ timeout: 1500 }); await sleep(250); } catch { } }
await sleep(2500);

// click session titles by exact-ish text
const targets = ['9 个子代理运行中 会话删除更新误删全部会话', '进行中 3 个子代理运行中 审计交接提示词并对齐需求'];
for (const title of targets) {
  const t = title.replace(/^\d+ 个子代理运行中 /, '').replace(/^进行中 \d+ 个子代理运行中 /, '');
  let ok = false;
  for (const probe of [title, t, title.slice(0, 10)]) {
    try {
      const el = page.getByText(probe, { exact: false }).first();
      if (await el.count()) { await el.click({ timeout: 3000 }); ok = true; break; }
    } catch { }
  }
  await sleep(3000);
  const d = await dump('after-click:' + t.slice(0, 14) + ' ok=' + ok);
}

// measure stream now
const a = frames.length; const sender = []; await sleep(10000); const b = frames.length;
const byM = {}; for (const f of frames.slice(a, b)) for (const m of f.m) byM[m] = (byM[m] || 0) + 1;
console.log('frames/10s=', b - a, JSON.stringify(byM));
await page.screenshot({ path: `${OUT}/open-session.png` });
fs.writeFileSync(`${OUT}/open-session-frames.json`, JSON.stringify(frames.slice(a, b), null, 2));
await browser.close();
