import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const URL_ = 'http://127.0.0.1:3080';
const DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/react-commit';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
  ],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR ' + String(e).slice(0, 300)));
await page.addInitScript({ path: path.join(DIR, 'lib-init.js') });

const pwSockets = [];
page.on('websocket', (s) => {
  const e = { url: s.url(), frames: 0, bytes: 0 };
  s.on('framereceived', (d) => { e.frames++; e.bytes += typeof d.payload === 'string' ? d.payload.length : 0; });
  pwSockets.push(e);
});

const t0 = Date.now();
await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);

const out = { when: new Date().toISOString(), steps: [] };
out.afterBoot = await page.evaluate(() => window.__RC__.probe());
out.bootEpochMs = Date.now() - t0;

// UI discovery: what is on screen
out.ui = await page.evaluate(() => ({
  title: document.title,
  url: location.href,
  bodyHead: (document.body.innerText || '').slice(0, 600),
  buttons: [...document.querySelectorAll('button,[role="tab"],[role="button"],a')]
    .map((x) => ({ tag: x.tagName, text: (x.innerText || '').trim().slice(0, 40), aria: x.getAttribute('aria-label'), title: x.getAttribute('title'), haspopup: x.getAttribute('aria-haspopup') }))
    .filter((x) => x.text || x.aria || x.title).slice(0, 60),
  dialogCount: document.querySelectorAll('div[role="dialog"]').length,
  settingsTriggerCount: document.querySelectorAll('button[aria-haspopup="dialog"]').length,
}));

await page.screenshot({ path: path.join(DIR, 'shots', 'recon-01-boot.png') });

// ---- open the settings panel
const trigger = page.locator('button[aria-haspopup="dialog"]').first();
let opened = false;
try {
  await trigger.click({ timeout: 5000 });
  await page.waitForTimeout(1200);
  opened = (await page.locator('div[role="dialog"][aria-modal="true"]').count()) > 0;
} catch (e) { out.openError = String(e).slice(0, 300); }
out.settingsOpened = opened;
await page.screenshot({ path: path.join(DIR, 'shots', 'recon-02-settings.png') });
out.afterOpen = await page.evaluate(() => window.__RC__.probe());

// baseline commit counter, then a positive control: click a settings nav tab
const before = await page.evaluate(() => JSON.parse(JSON.stringify(window.__RC__.hookCalls)));
let tabClicked = null;
try {
  const tabs = page.locator('div[role="dialog"][aria-modal="true"] nav button');
  const n = await tabs.count();
  out.navTabCount = n;
  out.navTabLabels = [];
  for (let i = 0; i < Math.min(n, 12); i++) out.navTabLabels.push((await tabs.nth(i).innerText()).trim().slice(0, 30));
  if (n > 1) { await tabs.nth(1).click({ timeout: 4000 }); tabClicked = out.navTabLabels[1]; }
  await page.waitForTimeout(1500);
} catch (e) { out.tabError = String(e).slice(0, 300); }
const after = await page.evaluate(() => JSON.parse(JSON.stringify(window.__RC__.hookCalls)));
out.tabClicked = tabClicked;
out.hookCallsBefore = before;
out.hookCallsAfter = after;
out.posControlCommitDelta = after.onCommitFiberRoot - before.onCommitFiberRoot;
await page.screenshot({ path: path.join(DIR, 'shots', 'recon-03-tab.png') });

// ---- 20s observation of the WS stream while settings stays open
await page.evaluate(() => window.__RC__.mark('recon-window-start'));
const secBefore = await page.evaluate(() => window.__RC__.secondKeys());
await page.waitForTimeout(20000);
out.windowSeconds = await page.evaluate((from) => {
  const all = window.__RC__.dumpSeconds();
  const acc = { commits: 0, ws: {}, wsEnv: {}, tgt: {}, sub: 0, panelOpenSec: 0, secs: 0 };
  for (const k of Object.keys(all)) {
    if (Number(k) < from) continue;
    const b = all[k];
    acc.secs++;
    acc.commits += b.c;
    acc.sub += b.sub;
    if (b.panel) acc.panelOpenSec++;
    for (const [t, n] of Object.entries(b.ws)) acc.ws[t] = (acc.ws[t] || 0) + n;
    for (const [t, n] of Object.entries(b.wsEnv)) acc.wsEnv[t] = (acc.wsEnv[t] || 0) + n;
    for (const [t, v] of Object.entries(b.tgt)) {
      acc.tgt[t] = acc.tgt[t] || { pw: 0, id: 0, any: 0 };
      acc.tgt[t].pw += v.pw; acc.tgt[t].id += v.id; acc.tgt[t].any += v.any;
    }
  }
  return acc;
}, secBefore.length ? Math.max(...secBefore) : 0);

out.wsRawSample = await page.evaluate(() => window.__RC__.dumpWsRaw().slice(0, 25));
out.commitLogSample = await page.evaluate(() => window.__RC__.dumpCommitLog().slice(-25));
out.pwSockets = pwSockets;
out.consoleErrors = consoleErrors.slice(0, 20);
out.totalMs = Date.now() - t0;

fs.writeFileSync(path.join(DIR, 'raw', 'recon.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  bootEpochMs: out.bootEpochMs,
  afterBoot: out.afterBoot,
  settingsOpened: out.settingsOpened,
  afterOpen: out.afterOpen,
  posControlCommitDelta: out.posControlCommitDelta,
  tabClicked: out.tabClicked,
  navTabLabels: out.navTabLabels,
  window: out.windowSeconds,
  wsRawSample: out.wsRawSample.slice(0, 10),
  pwSockets,
  consoleErrors: out.consoleErrors,
}, null, 2));

await browser.close();
