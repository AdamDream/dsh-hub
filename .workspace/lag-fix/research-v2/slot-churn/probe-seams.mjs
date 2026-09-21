/*
 * slot-churn/probe-seams.mjs — short diagnostic: why do the module-loader seams not fire?
 * Launches one page, waits 10 s, dumps facade shape / load-call capture / host resolve.
 * No measurement windows; no product state touched.
 */
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/slot-churn';
const URL_ = 'http://127.0.0.1:3080';

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.error('[page-err]', m.text().slice(0, 200)); });
await page.addInitScript({ path: path.join(DIR, 'lib-init-slot.js') });
await page.addInitScript(() => {
  const IS = { facadeBoot: null, loads: [], loadsAfterHook: 0, exCount: 0, exSample: [], fnexCount: 0, dpCount: 0 };
  window.__SEAM__ = IS;
  const ML = window.__ModuleLoader__;
  if (ML) {
    IS.facadeBoot = { keys: Object.keys(ML), mode: ML.mode, hasLoad: typeof ML.load, hasCreate: typeof ML.create, pendingQueueLen: ML.pendingQueue ? ML.pendingQueue.length : null };
    try {
      const prev = ML.load;
      ML.load = function (reg) {
        IS.loadsAfterHook++;
        try { IS.loads.push({ id: reg && reg.id, hasFactory: typeof (reg && reg.factory) }); } catch (e) { }
        return prev.call(ML, reg);
      };
    } catch (e) { IS.hookErr = String(e && e.message || e); }
  } else IS.facadeBoot = 'missing';
  // count raw ESM export objects and module functions created during boot
  const od = Object.defineProperty;
  Object.defineProperty = function (o, k, d) {
    try {
      if (k === '__esModule' && d && d.value === true) { IS.exCount++; if (IS.exSample.length < 5) IS.exSample.push(o && Object.keys(o).slice(0, 8).join(',')); }
      if (k === 'exports' && o && typeof o === 'object' && d) IS.dpCount++;
    } catch (e) { }
    return od.apply(this, arguments);
  };
  window.addEventListener('DOMContentLoaded', () => { IS.domReadyAt = Date.now(); });
});
await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);

const out = await page.evaluate(() => ({
  seam: window.__SEAM__,
  facadeNow: (() => { const M = window.__ModuleLoader__; return M ? { keys: Object.keys(M), mode: M.mode, loadType: typeof M.load, hasLoadCache: !!M.loadCache, hasFactories: !!M.factories, hasRequire: !!M.require } : null; })(),
  sc: (() => { const c = window.__SC__.probe(); return { hostResolve: c.hostResolve, hostCapture: c.hostCapture, coreHook: c.coreHook, slotsLoaderHook: c.slotsLoaderHook, slotsBundleId: c.slotsBundleId, slotCoreClassSeen: c.slotCoreClassSeen, createHook: c.createHook, moduleSystemSeen: c.moduleSystemSeen, coreCandidatesSeen: c.coreCandidatesSeen, facadeSeen: window.__SC__.facadeSeen, facadeInterceptErr: window.__SC__.facadeInterceptErr, pollGiveUp: window.__SC__.pollGiveUp, inject: c.inject, commits: c.commits, micro: c.micro }; })(),
  boot: (() => { const b = globalThis.__DSH_BOOT__; return b ? { rev: b.rev, entries: (b.entries || []).length, slotsEntry: (b.entries || []).filter((e) => String(e.id).includes('slots')) } : null; })(),
}));
// shorten for output
out.seam.loads = (out.seam.loads || []).slice(0, 12);
out.seam.loadsAfterHook = out.seam.loadsAfterHook;
fs.writeFileSync(path.join(DIR, 'raw', 'probe-seams.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1).slice(0, 5000));
await browser.close();
