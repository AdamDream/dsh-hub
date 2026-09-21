/*
 * A/B diagnostic for the harness-dependent General-section result.
 *
 * debug harness (no CDP Network calls): "just opened + 通用设置" => panel renders 0/commit
 * main harness (CDP Network.enable + emulateNetworkConditions): same state => panel renders 1/commit
 *
 * This script walks one page through both sequences and prints, per slice, the panel
 * render counts plus the ancestor-chain signature that says whether a re-render is
 * parent-driven (slot outlet above) or self-driven (SettingsRoot's own subscription).
 */
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const URL_ = 'http://127.0.0.1:3080';
const DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/react-commit';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const USE_CDP = process.argv.includes('--cdp-network');
const SLICE_MS = Number((process.argv.find((a) => a.startsWith('--slice=')) || '--slice=15000').split('=')[1]);

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
let cdp = null;
if (USE_CDP) {
  cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
}
await page.addInitScript({ path: path.join(DIR, 'lib-init.js') });
await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);

const results = [];
async function sliceMainStyle(label, ms, { cdpOfflineFalse }) {
  if (cdp && cdpOfflineFalse) {
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await sleep(1500);
  }
  await page.evaluate(() => window.__RC__.resetSeconds());
  await sleep(ms);
  const agg = await page.evaluate(() => {
    const all = window.__RC__.dumpSeconds();
    const o = { commits: 0, tgt: {}, chain: {}, sub: 0, subTotal: 0, wholePw: 0, ws: {}, altNull: 0, domReplaced: 0, setGrew: 0, secs: 0, active: 0, panelSecs: 0, subNames: {} };
    for (const k of Object.keys(all)) {
      const b = all[k];
      o.secs++; if (b.c > 0) o.active++; if (b.panel) o.panelSecs++;
      o.commits += b.c; o.sub += b.sub; o.subTotal = Math.max(o.subTotal, b.subTotal || 0);
      o.wholePw += b.wholePw || 0;
      o.altNull += b.altNull || 0; o.domReplaced += b.domReplaced || 0; o.setGrew += b.setGrew || 0;
      for (const [t, n] of Object.entries(b.ws)) o.ws[t] = (o.ws[t] || 0) + n;
      for (const [t, n] of Object.entries(b.chain)) o.chain[t] = (o.chain[t] || 0) + n;
      for (const [n2, c] of Object.entries(b.subNames || {})) o.subNames[n2] = (o.subNames[n2] || 0) + c;
      for (const [t, v] of Object.entries(b.tgt)) { if (!o.tgt[t]) o.tgt[t] = { pw: 0, id: 0, any: 0 }; const x = o.tgt[t]; x.pw += v.pw; x.id += v.id; x.any += v.any; }
    }
    return o;
  });
  const sec = await page.evaluate(() => {
    const cur = document.querySelector('div[role="dialog"][aria-modal="true"] nav button[aria-current="true"]');
    return cur ? cur.innerText.trim() : null;
  });
  const per = (x) => (agg.commits ? Math.round((x / agg.commits) * 1000) / 1000 : null);
  const row = {
    label, section: sec, cdpNetwork: USE_CDP, commits: agg.commits, secs: agg.secs, activeSeconds: agg.active, panelSecs: agg.panelSecs,
    panelRenders_id: agg.tgt.panel ? agg.tgt.panel.id : 0,
    panelRenders_pw: agg.tgt.panel ? agg.tgt.panel.pw : 0,
    panelPerCommit: per(agg.tgt.panel ? agg.tgt.panel.id : 0),
    settingsSubtreePerCommit: per(agg.sub), wholePerCommit: per(agg.wholePw),
    chainPerCommit: Object.fromEntries(Object.entries(agg.chain).map(([i, c]) => [i, per(c)])),
    ws: agg.ws, altNull: agg.altNull, domReplaced: agg.domReplaced, setGrew: agg.setGrew,
    subNamesTop: Object.entries(agg.subNames).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}=${v}`),
  };
  results.push(row);
  console.error(`[ab] ${label} sec=${sec} commits=${agg.commits} panelPerCommit=${row.panelPerCommit} chain=${JSON.stringify(row.chainPerCommit)} altNull=${agg.altNull} domReplaced=${agg.domReplaced} setGrew=${agg.setGrew}`);
  return row;
}

async function clickTrigger() { await page.locator('button[aria-haspopup="dialog"]').first().click({ timeout: 6000 }); await sleep(1500); }
async function clickNav(re) {
  const tabs = page.locator('div[role="dialog"][aria-modal="true"] nav button');
  const n = await tabs.count();
  for (let i = 0; i < n; i++) {
    const t = (await tabs.nth(i).innerText()).trim();
    if (re.test(t)) { await tabs.nth(i).click({ timeout: 5000 }); await sleep(1500); return t; }
  }
  return null;
}

// sequence mirrors the main harness: open by trigger, then click the already-active General cell
await clickTrigger();
await clickNav(/通用|General/i);
await sliceMainStyle('A1-opened-then-clicked-general', SLICE_MS, { cdpOfflineFalse: USE_CDP });

// and again after a full close/reopen cycle, which is what the main harness does between windows
await page.keyboard.press('Escape'); await sleep(1500);
await clickTrigger();
await clickNav(/通用|General/i);
await sliceMainStyle('A2-reopened-then-clicked-general', SLICE_MS, { cdpOfflineFalse: USE_CDP });

// switch away and back
await clickNav(/模型|Models/i);
await sliceMainStyle('A3-models', SLICE_MS, { cdpOfflineFalse: USE_CDP });
await clickNav(/通用|General/i);
await sliceMainStyle('A4-back-to-general', SLICE_MS, { cdpOfflineFalse: USE_CDP });

const out = {
  when: new Date().toISOString(),
  cdpNetwork: USE_CDP, sliceMs: SLICE_MS,
  probe: await page.evaluate(() => window.__RC__.probe()),
  ancNames: await page.evaluate(() => Object.assign({}, window.__RC__.ancNames)),
  targetSetNames: await page.evaluate(() => Object.fromEntries(Object.entries(window.__RC__.targetSets).map(([k, v]) => [k, v.map((f) => (f && f.type && (f.type.displayName || f.type.name)) || String(f && f.type))]))),
  results,
};
fs.writeFileSync(path.join(DIR, 'raw', `ab-${USE_CDP ? 'cdp' : 'nocdp'}.json`), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ cdpNetwork: USE_CDP, ancNames: out.ancNames, targetSetNames: out.targetSetNames, results }, null, 1));
await browser.close();
