// Read-only reconnaissance of the live DSH Web GUI.
// Goal: find (a) sidebar session rows, (b) settings entry + tab labels, (c) DOM scale.
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const URL = 'http://127.0.0.1:3080';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/cpu-profile/raw';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(6000);

const snap = async (label) => {
  const r = await page.evaluate(() => {
    const txt = (e) => (e.innerText || e.getAttribute('aria-label') || e.title || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const all = [...document.querySelectorAll('button,[role=tab],[role=button],a,[data-testid]')];
    return {
      url: location.href,
      nodes: document.getElementsByTagName('*').length,
      bodyPrefix: (document.body.innerText || '').slice(0, 600),
      interactives: all.map((e) => ({
        tag: e.tagName.toLowerCase(),
        role: e.getAttribute('role') || '',
        text: txt(e),
        tid: e.getAttribute('data-testid') || '',
        aria: e.getAttribute('aria-label') || '',
        title: e.getAttribute('title') || '',
        href: e.getAttribute('href') || '',
        cls: (e.className || '').toString().slice(0, 80),
      })).filter((x) => x.text || x.aria || x.title || x.tid).slice(0, 220),
    };
  });
  return { label, ...r };
};

const home = await snap('home');

// Sidebar: find plausible session rows (list items with long text and/or data attributes).
const rows = await page.evaluate(() => {
  const sel = ['[data-session-id]', '[data-testid*="session"]', 'aside li', 'nav li', '[role=listitem]', 'aside [role=button]', 'aside a'];
  const out = [];
  for (const s of sel) {
    const els = [...document.querySelectorAll(s)];
    if (els.length) out.push({ sel: s, count: els.length, sample: els.slice(0, 8).map((e) => ({ text: (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 70), attrs: [...e.attributes].map((a) => a.name + '=' + String(a.value).slice(0, 50)).slice(0, 8) })) });
  }
  return { out, asideHtmlLen: (document.querySelector('aside')?.innerHTML || '').length };
});

// Try to open settings (read-only; never click save/apply/delete/refresh).
let settingsOpened = null;
const settingsSelectors = ['[aria-label*="设置"]', '[title*="设置"]', 'button:has-text("设置")', '[aria-label*="Settings" i]', '[title*="Settings" i]', 'button:has-text("Settings")'];
for (const s of settingsSelectors) {
  try {
    const loc = page.locator(s).first();
    if (await loc.count()) { await loc.click({ timeout: 3000 }); settingsOpened = s; break; }
  } catch { }
}
await sleep(2500);
const settings = settingsOpened ? await snap('settings') : null;

const report = { meta: { url: URL, at: new Date().toISOString(), settingsOpened }, home, rows, settings, errors };
fs.writeFileSync(`${OUT}/recon.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ settingsOpened, homeNodes: home.nodes, settingsNodes: settings?.nodes, rowSelectors: rows.out.map((x) => x.sel + ':' + x.count), homePrefix: home.bodyPrefix.slice(0, 400), settingsPrefix: settings?.bodyPrefix.slice(0, 400), errors: errors.slice(0, 5) }, null, 2));
await browser.close();
