// Read-only: enumerate sidebar session rows (structure + titles) to choose a long session.
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

const info = await page.evaluate(() => {
  const aside = document.querySelector('aside') || document.body;
  // find elements whose aria-label starts with 会话“ (session row action buttons)
  const actionBtns = [...document.querySelectorAll('button[aria-label]')].filter((b) => /^会话“/.test(b.getAttribute('aria-label') || ''));
  const rows = actionBtns.map((b) => {
    // walk up to a plausible row container
    let el = b, depth = 0, row = null;
    while (el && depth < 6) { el = el.parentElement; depth++; if (!el) break; const t = (el.innerText || '').trim(); if (t && t.length > 3) { row = el; break; } }
    return {
      label: b.getAttribute('aria-label'),
      rowText: row ? (row.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 120) : null,
      rowAttrs: row ? [...row.attributes].map((a) => a.name + '=' + String(a.value).slice(0, 60)) : null,
      rowTag: row ? row.tagName.toLowerCase() : null,
      rowClass: row ? String(row.className).slice(0, 100) : null,
    };
  });
  // group containers
  const groups = [...aside.querySelectorAll('[class]')].filter((e) => /group|Group|section|Section/.test(String(e.className))).slice(0, 20).map((e) => ({ cls: String(e.className).slice(0, 80), text: (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80) }));
  return { rowCount: rows.length, rows, groups, asideText: (aside.innerText || '').slice(0, 1500) };
});
fs.writeFileSync(`${OUT}/sidebar.json`, JSON.stringify(info, null, 2));
console.log(JSON.stringify(info, null, 2).slice(0, 4000));
await browser.close();
