#!/usr/bin/env node
/*
 * verify-method.mjs — one targeted run to settle two methodological corrections
 * raised by the sibling line incident2/plugins-page:
 *
 *   ① positive control: in-page TIMER injection (setTimeout / rAF busy loop)
 *      vs CDP Runtime.evaluate injection -- which one does the LongTask API see?
 *   ② comparison-set convention: a settings NAV item vs a plugins TAB are not
 *      the same thing. Capture ALL network traffic (no /api/ filter) while
 *      (a) opening settings, (b) clicking the 插件 nav item, (c) clicking the
 *      插件列表 tab -- so the per-step RPC set is measured, not assumed.
 *
 * Read-only. Only clicks: settings trigger / settings nav / plugin tabs / close.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/why-these-two';
const PROBE = fs.readFileSync(path.join(DIR, 'tools', 'inpage-probe.js'), 'utf8');
const LOCK_DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock';
const URL_ = 'http://127.0.0.1:3080';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = path.join(DIR, 'raw', 'panel-verify-method.json');
const logs = [];
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); logs.push(l); };

function readOwner() {
  try {
    const f = {};
    for (const line of fs.readFileSync(path.join(LOCK_DIR, 'owner.txt'), 'utf8').split('\n')) {
      const i = line.indexOf(':'); if (i > 0) { const k = line.slice(0, i).trim(); if (!(k in f)) f[k] = line.slice(i + 1).trim(); }
    }
    const pid = Number(f.owner_pid || f.pid || 0) || null;
    let alive = false; if (pid) { try { fs.readlinkSync(`/proc/${pid}/exe`); alive = true; } catch {} }
    return { fields: f, pid, alive };
  } catch { return null; }
}
async function acquire() {
  for (let i = 0; i < 40; i++) {
    try { fs.mkdirSync(LOCK_DIR); } catch { await sleep(10000); continue; }
    fs.writeFileSync(path.join(LOCK_DIR, 'owner.txt'), [
      `agent: incident2-why-these-two (VERIFY-METHOD: positive-control injection channel + nav-vs-tab RPC set)`,
      `owner_pid: ${process.pid}`, `pid: ${process.pid}`,
      `started_at: ${new Date().toISOString()}`, `concurrentWith: none`,
      `note: single browser at a time; release = rm owner.txt && rmdir`,
    ].join('\n') + '\n');
    return 'exclusive';
  }
  return 'gave-up';
}
function release() {
  try { const t = fs.readFileSync(path.join(LOCK_DIR, 'owner.txt'), 'utf8');
    if (t.includes(`owner_pid: ${process.pid}`)) { fs.rmSync(path.join(LOCK_DIR, 'owner.txt'), { force: true }); try { fs.rmdirSync(LOCK_DIR); } catch {} if (!logs.includes('lock released')) log('lock released'); } } catch {}
}

const READY = `() => { if (document.querySelector('[data-dsh-boot]')) return false; if (!window.__DSH_BOOT__) return false;
  if (!window.__ModuleLoader__ || window.__ModuleLoader__.mode !== 'live') return false;
  var t = document.querySelector('div[class$="_settingsArea"] button[aria-haspopup="dialog"]');
  var tree = document.querySelector('div[role="tree"]'); return !!(t && tree && tree.querySelector('[role="treeitem"][aria-expanded]')); }`;

async function main() {
  const mode = await acquire();
  log(`lock: ${mode}`); if (mode !== 'exclusive') { log('could not get lock; aborting rather than contaminating'); return 2; }
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-renderer-accessibility'] });
  log(`launched chrome ${b.version()}`);
  const ctx = await b.newContext({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 2, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
  const page = await ctx.newPage();
  await page.addInitScript({ content: PROBE });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  const all = [];
  cdp.on('Network.requestWillBeSent', (e) => {
    let m = null; try { m = JSON.parse(e.request.postData || '{}').method || null; } catch {}
    all.push({ url: e.request.url, httpMethod: e.request.method, rpcMethod: m, ts: e.timestamp, postLen: (e.request.postData || '').length });
  });
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(READY, null, { timeout: 120000 });
  await sleep(3000);   // let boot residue settle; nothing is measured across this

  const res = { launchedAt: new Date().toISOString(), browser: b.version(), viewport: '2560x1440@2', positiveControl: [], rpcByStep: [] };

  const phase = async (label, fn, ms = 1800) => {
    const base = await page.evaluate(() => window.__phase());
    await fn();
    await sleep(ms);
    const d = await page.evaluate((x) => window.__sincePhase(x), base);
    const rec = { label, longtaskCount: d.longtaskCount, longtaskMax: d.longtaskMax, longtasks: d.longtasks,
                  loafCount: d.loafCount, loafMax: d.loafMax, frameMax: d.frameMax, framesGt50: d.framesGt50 };
    log(`  ${label.padEnd(34)} LT=${rec.longtaskCount}/${rec.longtaskMax}  LoAF=${rec.loafCount}/${rec.loafMax}  fmax=${rec.frameMax}  >50=${rec.framesGt50}`);
    return rec;
  };

  // ================= ② nav item vs tab: full RPC set per step
  log('--- ② nav item vs plugins tab: full network set (NO /api/ filter) ---');
  const step = async (label, fn) => {
    const from = all.length;
    await fn();
    await sleep(2200);
    const reqs = all.slice(from);
    const rec = { label, requests: reqs.map((r) => ({ url: r.url.replace(URL_, ''), httpMethod: r.httpMethod, rpcMethod: r.rpcMethod, postLen: r.postLen })),
                  nRequests: reqs.length, rpcMethods: [...new Set(reqs.map((r) => r.rpcMethod || r.url.replace(URL_, ''))) ] };
    res.rpcByStep.push(rec);
    log(`  ${label.padEnd(34)} n=${rec.nRequests} :: ${rec.rpcMethods.slice(0, 12).join(', ')}`);
    return rec;
  };
  const click = async (selOrLoc) => {
    const l = (typeof selOrLoc === 'string') ? page.locator(selOrLoc).first() : selOrLoc;
    await l.waitFor({ state: 'visible', timeout: 20000 }); await l.click({ timeout: 20000 });
  };
  const diag = await page.evaluate(() => ({
    boot: !!document.querySelector('[data-dsh-boot]'), hasBootJson: !!window.__DSH_BOOT__,
    loaderMode: window.__ModuleLoader__ ? window.__ModuleLoader__.mode : null,
    settingsArea: document.querySelectorAll('div[class$="_settingsArea"]').length,
    triggers: document.querySelectorAll('button[aria-haspopup="dialog"]').length,
    trees: document.querySelectorAll('div[role="tree"]').length,
    url: location.href, bodyChildren: document.body.children.length,
  }));
  log('  diag: ' + JSON.stringify(diag));
  await step('1_open_settings', () => click('div[class$="_settingsArea"] button[aria-haspopup="dialog"]'));
  await step('2_nav_plugins', () => click(page.locator('div[class$="_navList"] button').filter({ hasText: '插件' }).first()));
  const activeTab = await page.evaluate(() => { const t = document.querySelector('button[class$="_tab"][data-active="true"]'); return t ? t.textContent.trim() : null; });
  log(`  (after nav 插件 the active tab is: ${activeTab})`);
  res.activeTabAfterNavPlugins = activeTab;
  await step('3_tab_插件列表', () => click(page.locator('button[class$="_tab"]:visible').filter({ hasText: '插件列表' }).first()));
  await step('4_tab_back_插件配置', () => click(page.locator('button[class$="_tab"]:visible').filter({ hasText: '插件配置' }).first()));
  await step('5_close', () => click('div.VOzbGW_panel button[class$="_close"]'));

  // ================= ① positive control: injection channel comparison
  log('--- ① positive control: which injection channel does LongTask see? ---');
  res.positiveControl.push(await phase('A_cdp_runtime_evaluate', () => page.evaluate(() => window.__block(120))));
  res.positiveControl.push(await phase('B_inpage_setTimeout', () => page.evaluate(() => { setTimeout(() => window.__block(120), 0); })));
  res.positiveControl.push(await phase('C_inpage_rAF', () => page.evaluate(() => { requestAnimationFrame(() => { setTimeout(() => window.__block(120), 0); }); })));
  res.positiveControl.push(await phase('D_inpage_promise_microtask_check', () => page.evaluate(() => Promise.resolve().then(() => window.__block(120)))));
  res.positiveControl.push(await phase('E_idle_control', () => {}, 1500));

  res.channels = await page.evaluate(() => window.__PROBE.channels);
  fs.writeFileSync(OUT, JSON.stringify({ ...res, logs }, null, 2));
  log(`wrote ${OUT}`);
  await b.close(); release();
  return 0;
}
main().then((c) => { release(); process.exit(c); }).catch((e) => { console.error(e); release(); process.exit(1); });
