#!/usr/bin/env node
/** spike-surface.mjs — 只读：探测页面可用器械面（DevTools hook / React 版本 / 触发器定位）。 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const BASE = 'http://127.0.0.1:3080';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/static-events/raw/spike-surface.json';
const out = { at: new Date().toISOString(), errors: [] };
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => out.errors.push('pageerror: ' + String(e).slice(0, 300)));
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);
out.surface = await page.evaluate(() => {
  const h = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const btns = Array.from(document.querySelectorAll('button'));
  const set = btns.filter((b) => (b.textContent || '').trim() === '设置');
  const shot = set[0];
  const rect = shot ? shot.getBoundingClientRect() : null;
  return {
    hasDevtoolsHook: Boolean(h),
    hookKeys: h ? Object.keys(h).slice(0, 40) : null,
    hookRenderers: h && h.renderers ? h.renderers.size : null,
    hookHasOnCommit: h ? typeof h.onCommitFiberRoot : null,
    reactVersions: h && h.renderers ? Array.from(h.renderers.entries()).map(([k, v]) => [k, v && v.version]) : null,
    bodyTextLen: (document.body.textContent || '').length,
    buttonCount: btns.length,
    settingsButtonCount: set.length,
    settingsButtonRect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null,
    settingsButtonAria: shot ? { haspopup: shot.getAttribute('aria-haspopup'), expanded: shot.getAttribute('aria-expanded'), cls: String(shot.className).slice(0, 80) } : null,
    domNodeCount: document.querySelectorAll('*').length,
    styleTagCount: document.querySelectorAll('style').length,
    dialogCount: document.querySelectorAll('[role="dialog"]').length,
  };
});
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
