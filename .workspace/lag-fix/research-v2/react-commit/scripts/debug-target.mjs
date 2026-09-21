/*
 * Focused diagnostic: with the settings panel open under the live stream, record
 * exactly what the target resolver sees on each commit. Needed because the smoke
 * run showed subRenderedPerCommit=43 while panelCommits=0 — those two cannot both
 * describe the same fiber, so one of the two readings has to be wrong.
 */
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const URL_ = 'http://127.0.0.1:3080';
const DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/react-commit';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODE = process.argv.includes('--click-tab') ? 'click-tab' : 'plain';

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.addInitScript({ path: path.join(DIR, 'lib-init.js') });
await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);

await page.locator('button[aria-haspopup="dialog"]').first().click({ timeout: 6000 });
await page.waitForTimeout(1500);
if (MODE === 'click-tab') {
  const tabs = page.locator('div[role="dialog"][aria-modal="true"] nav button');
  await tabs.nth(1).click({ timeout: 4000 });
  await page.waitForTimeout(1200);
}

const probeBefore = await page.evaluate(() => window.__RC__.probe());

// three measurement slices: before any interaction, after a nav-tab click, then again
const slices = [];
async function clickTab(i) {
  try {
    const tabs = page.locator('div[role="dialog"][aria-modal="true"] nav button');
    const n = await tabs.count();
    if (n > i) {
      const label = (await tabs.nth(i).innerText()).trim().slice(0, 30);
      await tabs.nth(i).click({ timeout: 4000 });
      await sleep(800);
      return label;
    }
  } catch (e) { }
  return null;
}
async function slice(label, ms) {
  await page.evaluate(() => { window.__RC__.resetDebug(); window.__RC__.setDebug(true); });
  const from = await page.evaluate(() => { const k = window.__RC__.secondKeys(); return k.length ? Math.max(...k) : 0; });
  await sleep(ms);
  const d = await page.evaluate(() => window.__RC__.dumpDebug());
  const agg = await page.evaluate((f) => {
    const all = window.__RC__.dumpSeconds();
    const o = { commits: 0, tgt: {}, sub: 0, subId: 0, subTotal: 0, ws: {}, wholePw: 0, wholeId: 0, wholeTotal: 0, secs: 0 };
    for (const k of Object.keys(all)) {
      if (Number(k) < f) continue;
      const b = all[k];
      o.secs++;
      o.commits += b.c; o.sub += b.sub; o.subId += b.subId;
      o.subTotal = Math.max(o.subTotal, b.subTotal || 0);
      o.wholePw += b.wholePw || 0; o.wholeId += b.wholeId || 0;
      o.wholeTotal = Math.max(o.wholeTotal, b.wholeTotal || 0);
      for (const [t, n] of Object.entries(b.ws)) o.ws[t] = (o.ws[t] || 0) + n;
      for (const [t, v] of Object.entries(b.tgt)) { const x = o.tgt[t] || (o.tgt[t] = { pw: 0, id: 0, any: 0 }); x.pw += v.pw; x.id += v.id; x.any += v.any; }
    }
    return o;
  }, from);
  slices.push({ label, mode: MODE, debug: d, agg });
  console.error(`[slice] ${label} commits=${agg.commits} tgt=${JSON.stringify(agg.tgt)} sub=${agg.sub} wholePw=${agg.wholePw} ws=${JSON.stringify(agg.ws)} debugN=${d.length}`);
}

await slice('s1-default-section', 12000);
const tabA = await clickTab(1);
await slice('s2-tab1-' + tabA, 12000);
const tabB = await clickTab(0);
await slice('s3-tab0-' + tabB, 12000);
const tabC = await clickTab(1);
await slice('s4-tab1-again-' + tabC, 12000);

const out = {
  when: new Date().toISOString(),
  mode: MODE,
  probeBefore,
  probeAfter: await page.evaluate(() => window.__RC__.probe()),
  targetSetNames: await page.evaluate(() => Object.fromEntries(Object.entries(window.__RC__.targetSets).map(([k, v]) => [k, v.map((f) => (f && f.type && (f.type.displayName || f.type.name)) || String(f && f.type))]))),
  slices,
};
fs.writeFileSync(path.join(DIR, 'raw', `debug-${MODE}.json`), JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  mode: MODE,
  targetSetNames: out.targetSetNames,
  slices: slices.map((s) => ({ label: s.label, agg: s.agg, debugFirst: s.debug.slice(0, 6), debugN: s.debug.length })),
}, null, 2));
await browser.close();
