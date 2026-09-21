/*
 * model-tab verification pass 2 — with dialog-wide fiber attribution:
 *   P0 collapsed  |  P1 pi-ai provider (opencode-go, 8 model rows) expanded
 * Each state measured under delivered WS and under muted session events.
 * Read-only: Edit is a disclosure toggle; no Apply/Save/Delete is clicked.
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

const fp = () => { try { const b = fs.readFileSync(SETTINGS); return { sha: crypto.createHash('sha256').update(b).digest('hex').slice(0, 16), size: b.length }; } catch (e) { return { error: String(e).slice(0, 60) }; } };
const browsers = () => { let n = 0; try { for (const p of fs.readdirSync('/proc')) { if (!/^\d+$/.test(p)) continue; try { const c = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8').split('\0'); if (c[0] && c[0].endsWith('headless_shell') && c.includes('--no-startup-window')) n++; } catch (e) { } } } catch (e) { } return n; };

const before = fp();
const runs = [];
let browser = null;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  await page.addInitScript({ path: path.join(ROOT, 'lib', 'init.js') });
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => { const r = await T(cdp.send('Performance.getMetrics'), 30_000, 'm'); const o = {}; for (const m of r.metrics) o[m.name] = m.value; return o; };
  await T(page.waitForFunction(() => document.getElementsByTagName('*').length > 200, null, { timeout: 60_000 }), 65_000, 'shell');
  await T(page.locator('button, [role="button"], a').filter({ hasText: /^设置$/ }).first().click({ timeout: 20_000 }), 30_000, 'settings');
  await T(page.waitForFunction(() => !!document.querySelector('[role="dialog"] nav')), 30_000, 'dialog');
  await T(page.locator('[role="dialog"] nav button').filter({ hasText: '模型' }).first().click({ timeout: 20_000 }), 30_000, 'models');
  await sleep(1500);
  await page.evaluate(() => window.__MT.panelFind());
  await sleep(SETTLE_MS);

  const sig = () => page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return { dlgNodes: d ? d.getElementsByTagName('*').length : 0, rowCard: d ? d.querySelectorAll('[class*="rowCard"]').length : 0, modelEntry: d ? d.querySelectorAll('[class*="modelEntry"]').length : 0, modelRow: d ? d.querySelectorAll('[class*="modelRow"]').length : 0, input: d ? d.querySelectorAll('input').length : 0, button: d ? d.querySelectorAll('button').length : 0, svg: d ? d.querySelectorAll('svg').length : 0, textLen: d ? (d.textContent || '').length : 0 };
  });

  const win = async (state, muted) => {
    const s0 = await sig(); const m0 = await metrics(); const t0 = Date.now();
    await page.evaluate((mu) => window.__MT.windowStart(mu), muted);
    log(`win ${state} muted=[${muted}] browsers=${browsers()}`);
    await sleep(WINDOW_MS);
    const end = await T(page.evaluate(() => window.__MT.windowEnd()), 30_000, 'end');
    const m1 = await metrics(); const s1 = await sig(); const t1 = Date.now();
    const rec = (k) => Math.round((m1[k] - m0[k]) * 1000) / 1000;
    const secs = (t1 - t0) / 1000;
    const r = {
      state, muted, t0: new Date(t0).toISOString(), durationMs: end.durationMs, fps: Math.round(end.frames / secs * 10) / 10, frames: end.frames,
      frameGap: end.frameGap, over50Per100: end.frameGap.n ? Math.round(end.frameGap.over50 / end.frameGap.n * 100 * 100) / 100 : null,
      cdp: { scriptPerSec: Math.round(rec('ScriptDuration') / secs * 1000) / 1000, taskPerSec: Math.round(rec('TaskDuration') / secs * 1000) / 1000, recalcPerSec: Math.round(rec('RecalcStyleDuration') / secs * 1000) / 1000, layoutPerSec: Math.round(rec('LayoutDuration') / secs * 1000) / 1000 },
      longtasks: end.longtasks.n, longtaskMax: end.longtasks.max, ws: end.ws.byType,
      react: { commits: end.react.commitsInWindow, fibersAll: end.react.fibersAllInWindow, fibersPanel: end.react.fibersPanelInWindow, fibersDlg: end.react.fibersDlgInWindow, tagsPanel: end.react.tagsPanel, tagsDlg: end.react.tagsDlg, ownersPanel: end.react.ownersPanel, ownersDlg: end.react.ownersDlg, ownersAll: end.react.ownersAll, panelSetSize: end.react.panelSetSize, dlgSetSize: end.react.dlgSetSize, commitSample: (end.react.commitLog || []).slice(0, 40).map((c) => ({ dur: c.dur, panel: c.panel, dlg: c.dlg, all: c.all })) },
      sigBefore: s0, sigAfter: s1, mutations: end.mutations, errors: end.errors.length, browsers: browsers(),
    };
    runs.push(r);
    log(`win ${state} muted=${muted} fps=${r.fps} commits=${r.react.commits} fibAll=${r.react.fibersAll} fibDlg=${r.react.fibersDlg} fibPanel=${r.react.fibersPanel} dlgNodes=${s1.dlgNodes} modelEntry=${s1.modelEntry} input=${s1.input} script/s=${r.cdp.scriptPerSec}`);
    return r;
  };

  await win('P0-collapsed', []);
  await win('P0-collapsed', ['session/event', 'session/projection']);

  /* expand the SECOND provider row (opencode-go — the pi-ai one with a model list) */
  const editBtns = page.locator('[role="dialog"] button').filter({ hasText: /^编辑$/ });
  const nEdit = await editBtns.count();
  log('edit buttons:', nEdit);
  const beforeExpand = await sig();
  await T(editBtns.nth(1).click({ timeout: 20_000 }), 30_000, 'edit2');
  await sleep(3000);
  await page.evaluate(() => window.__MT.panelFind());
  const afterExpand = await sig();
  log('expand#2 delta dlgNodes', beforeExpand.dlgNodes, '->', afterExpand.dlgNodes, 'modelEntry', beforeExpand.modelEntry, '->', afterExpand.modelEntry, 'input', beforeExpand.input, '->', afterExpand.input, 'svg', beforeExpand.svg, '->', afterExpand.svg);

  await win('P1-piai-expanded', []);
  await win('P1-piai-expanded', ['session/event', 'session/projection']);

  /* also open the custom-provider declaration card (read-only form) */
  const addCustom = page.locator('[role="dialog"] button').filter({ hasText: /自定义/ });
  const nCustom = await addCustom.count();
  if (nCustom) {
    const b4 = await sig();
    await T(addCustom.last().click({ timeout: 20_000 }), 30_000, 'custom');
    await sleep(2500);
    await page.evaluate(() => window.__MT.panelFind());
    const af = await sig();
    log('custom-card delta dlgNodes', b4.dlgNodes, '->', af.dlgNodes, 'input', b4.input, '->', af.input);
    await win('P2-custom-card', []);
    /* close it again via the custom button toggle if possible */
  }

  const collapse = await sig();
  log('end state dlgNodes', collapse.dlgNodes, 'modelEntry', collapse.modelEntry);
  const after = fp();
  await ctx.close();
  fs.writeFileSync(path.join(RAW, 'verify2.json'), JSON.stringify({ runs, settingsBefore: before, settingsAfter: after, settingsUnchanged: before.sha === after.sha, beforeExpand, afterExpand }, null, 1));
  log('settings sha', before.sha, after.sha, 'unchanged=', before.sha === after.sha);
} catch (e) {
  log('THREW', String(e && e.stack || e).slice(0, 500));
  fs.writeFileSync(path.join(RAW, 'verify2.json'), JSON.stringify({ runs, error: String(e && e.stack || e).slice(0, 500), settingsBefore: before, settingsAfter: fp() }, null, 1));
} finally {
  try { if (browser) await browser.close(); } catch (e) { }
  log('done runs=', runs.length);
}
