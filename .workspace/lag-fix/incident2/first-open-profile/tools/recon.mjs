import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const URL = 'http://127.0.0.1:3080';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/first-open-profile/raw/';
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 200)));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(6000);

// Snapshot the home view
const home = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button,[role=button],[role=tab],a')]
    .map(e => ({ txt: (e.innerText || e.getAttribute('aria-label') || e.getAttribute('title') || '').trim().slice(0, 40), aria: e.getAttribute('aria-label'), title: e.getAttribute('title'), tag: e.tagName }))
    .filter(x => x.txt);
  return { title: document.title, url: location.href, nodes: document.getElementsByTagName('*').length, btns: btns.slice(0, 80), bodyPrefix: (document.body.innerText || '').slice(0, 1200) };
});

// find settings trigger candidates
const cands = await page.evaluate(() => {
  const out = [];
  for (const e of document.querySelectorAll('*')) {
    const s = ((e.getAttribute && (e.getAttribute('aria-label') || e.getAttribute('title') || '')) || '').trim();
    if (/设置|Settings/i.test(s) && e.children.length < 4) out.push({ tag: e.tagName, aria: e.getAttribute('aria-label'), title: e.getAttribute('title'), cls: (e.className || '').toString().slice(0, 60) });
  }
  return out.slice(0, 20);
});

// click it
let clicked = null;
for (const sel of ['[aria-label="设置"]', 'button[aria-label*="设置"]', '[title*="设置"]']) {
  const l = page.locator(sel).first();
  if (await l.count()) { try { await l.click({ timeout: 3000 }); clicked = sel; break; } catch (e) { } }
}
await sleep(4000);

const after = await page.evaluate(() => {
  const dialogs = [...document.querySelectorAll('div[role=dialog][aria-modal=true]')].map(d => ({
    cls: (d.className || '').toString().slice(0, 80),
    rect: (r => ({ w: Math.round(r.width), h: Math.round(r.height) }))(d.getBoundingClientRect()),
    textPrefix: (d.innerText || '').slice(0, 1500),
    tabs: [...d.querySelectorAll('[role=tab],[role=tablist] button,button')].map(b => (b.innerText || '').trim()).filter(Boolean).slice(0, 40),
    ancestors: (() => { const a = []; let n = d; while (n && n !== document.documentElement) { a.push({ tag: n.tagName, cls: (n.className || '').toString().slice(0, 50), role: n.getAttribute && n.getAttribute('role') }); n = n.parentElement; } return a.slice(0, 12); })(),
  }));
  const anyDialog = [...document.querySelectorAll('[role=dialog]')].map(d => ({ modal: d.getAttribute('aria-modal'), cls: (d.className || '').toString().slice(0, 60) }));
  const usage = [...document.querySelectorAll('*')].filter(e => /用量|Usage|heatmap|热力/i.test(e.className ? e.className.toString() : '')).slice(0, 10).map(e => ({ tag: e.tagName, cls: e.className.toString().slice(0, 80) }));
  return { url: location.href, nodes: document.getElementsByTagName('*').length, dialogs, anyDialog, usage, metaThemeColor: [...document.querySelectorAll('meta[name=theme-color]')].map(m => ({ content: m.content, connected: m.isConnected })), bootRev: globalThis.__DSH_BOOT__ ? globalThis.__DSH_BOOT__.rev : null };
});

const out = { home, cands, clicked, after, errs };
fs.writeFileSync(OUT + 'recon.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2).slice(0, 12000));
await browser.close();
