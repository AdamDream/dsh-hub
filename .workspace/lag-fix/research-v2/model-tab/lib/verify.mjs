/*
 * model-tab verification pass: does the 模型 panel re-render AT ALL under churn,
 * and what does the expanded/editing state cost?
 *
 * States: P0 collapsed | P1 provider-editor expanded (read-only: Edit is a
 * disclosure toggle; no Apply/Save/Delete is ever clicked in this harness)
 * Each state is measured twice: WS natural, then WS session-event muted.
 * Settings file mtime+hash is captured before and after to prove nothing was written.
 */
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const URL_ = 'http://127.0.0.1:3080';
const ROOT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/model-tab';
const RAW = path.join(ROOT, 'raw');
const SETTINGS = '/home/CNS2026495165/.dsh/settings.yaml';
const argv = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const WINDOW_MS = Number(argv.window || 30_000);
const SETTLE_MS = Number(argv.settle || 8_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}\n`);
const T = (p, ms, l) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT ' + l)), ms))]);

function settingsFingerprint() {
  try { const b = fs.readFileSync(SETTINGS); return { size: b.length, sha: crypto.createHash('sha256').update(b).digest('hex').slice(0, 16), mtime: fs.statSync(SETTINGS).mtimeMs }; }
  catch (e) { return { error: String(e).slice(0, 80) }; }
}
function browserCount() {
  let n = 0;
  try { for (const p of fs.readdirSync('/proc')) { if (!/^\d+$/.test(p)) continue; try { const c = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8'); const parts = c.split('\0').filter(Boolean); if (parts[0] && parts[0].endsWith('headless_shell') && parts.includes('--no-startup-window')) n++; } catch (e) { } } } catch (e) { }
  return n;
}

const fpBefore = settingsFingerprint();
const runs = [];
let browser = null;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('PAGEERROR', String(e.message).slice(0, 160)));
  await page.addInitScript({ path: path.join(ROOT, 'lib', 'init.js') });
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => { const r = await T(cdp.send('Performance.getMetrics'), 30_000, 'metrics'); const o = {}; for (const m of r.metrics) o[m.name] = m.value; return o; };
  await T(page.waitForFunction(() => document.getElementsByTagName('*').length > 200, null, { timeout: 60_000 }), 65_000, 'shell');

  await T(page.locator('button, [role="button"], a').filter({ hasText: /^设置$/ }).first().click({ timeout: 20_000 }), 30_000, 'settings');
  await T(page.waitForFunction(() => !!document.querySelector('[role="dialog"] nav')), 30_000, 'dialog');
  await T(page.locator('[role="dialog"] nav button').filter({ hasText: '模型' }).first().click({ timeout: 20_000 }), 30_000, 'models');
  await sleep(1500);
  await page.evaluate(() => window.__MT.panelFind());
  await sleep(SETTLE_MS);

  const sig = () => page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]'); const nav = dlg && dlg.querySelector('nav');
    const c = nav ? nav.nextElementSibling : null;
    return {
      dlgNodes: dlg ? dlg.getElementsByTagName('*').length : 0,
      contentNodes: c ? c.getElementsByTagName('*').length : 0,
      rowCard: dlg ? dlg.querySelectorAll('[class*="rowCard"]').length : 0,
      modelEntry: dlg ? dlg.querySelectorAll('[class*="modelEntry"]').length : 0,
      modelRow: dlg ? dlg.querySelectorAll('[class*="modelRow"]').length : 0,
      input: dlg ? dlg.querySelectorAll('input').length : 0,
      button: dlg ? dlg.querySelectorAll('button').length : 0,
      svg: dlg ? dlg.querySelectorAll('svg').length : 0,
      details: dlg ? dlg.querySelectorAll('details').length : 0,
      labels: dlg ? [...dlg.querySelectorAll('button')].map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 24)).slice(0, 40) : [],
      textLen: dlg ? (dlg.textContent || '').length : 0,
    };
  });

  const win = async (state, muted) => {
    const s0 = await sig(); const m0 = await metrics(); const t0 = Date.now();
    await page.evaluate((mu) => window.__MT.windowStart(mu), muted);
    log(`win ${state} muted=[${muted}] start browsers=${browserCount()}`);
    await sleep(WINDOW_MS);
    const end = await T(page.evaluate(() => window.__MT.windowEnd()), 30_000, 'end');
    const m1 = await metrics(); const t1 = Date.now(); const s1 = await sig();
    const rec = (k) => Math.round((m1[k] - m0[k]) * 1000) / 1000;
    const secs = (t1 - t0) / 1000;
    const run = {
      state, muted, t0: new Date(t0).toISOString(), durationMs: end.durationMs,
      fps: Math.round(end.frames / secs * 10) / 10, frames: end.frames, frameGap: end.frameGap,
      over50Per100: end.frameGap.n ? Math.round(end.frameGap.over50 / end.frameGap.n * 100 * 100) / 100 : null,
      cdp: { script: rec('ScriptDuration'), scriptPerSec: Math.round(rec('ScriptDuration') / secs * 1000) / 1000, taskPerSec: Math.round(rec('TaskDuration') / secs * 1000) / 1000, recalcPerSec: Math.round(rec('RecalcStyleDuration') / secs * 1000) / 1000, layoutPerSec: Math.round(rec('LayoutDuration') / secs * 1000) / 1000 },
      longtasks: end.longtasks.n, longtaskMax: end.longtasks.max,
      ws: end.ws.byType, wsDelivered: end.ws.delivered, wsDropped: end.ws.dropped,
      http: end.http.total, xhr: end.xhr.total,
      react: {
        commits: end.react.commitsInWindow, commitsInPanel: end.react.commitsInPanelInWindow,
        fibersAll: end.react.fibersAllInWindow, fibersPanel: end.react.fibersPanelInWindow,
        ownersPanel: end.react.ownersPanel, tagsPanel: end.react.tagsPanel, ownersAll: end.react.ownersAll,
        panelSetSize: end.react.panelSetSize, setterCalls: end.react.setterCallsInWindow, walkMs: end.react.walkMsInWindow,
      },
      dom: end.dom, sigBefore: s0, sigAfter: s1, mutations: end.mutations, errors: end.errors.length,
      browsers: browserCount(),
    };
    runs.push(run);
    log(`win ${state} muted=${muted} fps=${run.fps} commits=${run.react.commits} cPanel=${run.react.commitsInPanel} fibPanel=${run.react.fibersPanel} fibAll=${run.react.fibersAll} dlgNodes=${end.dom.dlgNodes} modelEntry=${s1.modelEntry} script/s=${run.cdp.scriptPerSec}`);
    return run;
  };

  /* P0 collapsed */
  await win('P0-collapsed', []);
  await win('P0-collapsed', ['session/event', 'session/projection']);

  /* expand the first provider row (read-only disclosure) */
  const beforeExpand = await sig();
  const editBtns = page.locator('[role="dialog"] button').filter({ hasText: /^编辑$/ });
  const nEdit = await editBtns.count();
  log('edit buttons:', nEdit);
  await T(editBtns.first().click({ timeout: 20_000 }), 30_000, 'edit');
  await sleep(2500);
  await page.evaluate(() => window.__MT.panelFind());
  const afterExpand = await sig();
  log('expand delta dlgNodes', beforeExpand.dlgNodes, '->', afterExpand.dlgNodes, 'modelEntry', beforeExpand.modelEntry, '->', afterExpand.modelEntry, 'textLen', beforeExpand.textLen, '->', afterExpand.textLen);

  /* P1 expanded */
  await win('P1-expanded', []);
  await win('P1-expanded', ['session/event', 'session/projection']);

  /* collapse again (disclosure toggle, no write) */
  await page.locator('[role="dialog"] button').filter({ hasText: /^编辑$/ }).first().click({ timeout: 20_000 });
  await sleep(2000);
  const afterCollapse = await sig();
  log('collapse delta dlgNodes', afterCollapse.dlgNodes, 'modelEntry', afterCollapse.modelEntry);

  const fpAfter = settingsFingerprint();
  await ctx.close();
  fs.writeFileSync(path.join(RAW, 'verify.json'), JSON.stringify({ runs, fpBefore, fpAfter, settingsUnchanged: fpBefore.sha === fpAfter.sha, beforeExpand, afterExpand, afterCollapse }, null, 1));
  log('settings sha before/after', fpBefore.sha, fpAfter.sha, 'unchanged=', fpBefore.sha === fpAfter.sha);
} catch (e) {
  log('THREW', String(e && e.stack || e).slice(0, 600));
  fs.writeFileSync(path.join(RAW, 'verify.json'), JSON.stringify({ runs, fpBefore, fpAfter: settingsFingerprint(), error: String(e && e.stack || e).slice(0, 600) }, null, 1));
} finally {
  try { if (browser) await browser.close(); } catch (e) { }
  log('done, runs=', runs.length);
}
