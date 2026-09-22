#!/usr/bin/env node
/** run5.mjs — 只做修复后的「插件」子标签 A/B（每次点击前重读坐标）+ dwell。短跑。 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { tryAcquire, release, census, censusVerdict } from '../lib/lock.mjs';

const BASE = 'http://127.0.0.1:3080';
const HERE = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/tab-switch';
const AGENT = 'incident2-tab-switch';
const OUT = `${HERE}/raw/${process.env.OUT || 'tabswitch-run5.json'}`;
const R = { at: new Date().toISOString(), windows: [], errors: [] };
const log = (...a) => console.log('[run5]', ...a);
const lock = tryAcquire(AGENT, 'plugins sub-tab A/B (fresh coords) + dwell', 1500, log);
R.lock = lock.acquired;
if (!lock.acquired) { writeFileSync(OUT, JSON.stringify(R, null, 2)); process.exit(2); }

let browser, ownDir;
try {
  const cenPre = census();
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.addInitScript({ path: `${HERE}/lib/init-probe.js` });
  page.on('pageerror', (e) => R.errors.push(String(e).slice(0, 200)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(12000);
  ownDir = (census().headless_shell.find((r) => !cenPre.headless_shell.some((q) => q.pid === r.pid)) || {}).userDataDir || null;
  const gate = () => { const v = censusVerdict(census(), ownDir); return { ok: v.foreign === 0 && v.own >= 1, foreign: v.foreign }; };
  const cdpM = async () => { const { metrics } = await cdp.send('Performance.getMetrics'); const keep = ['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'Nodes', 'JSEventListeners']; const o = {}; for (const m of metrics) if (keep.includes(m.name)) o[m.name] = m.value; return o; };
  const mdelta = (a, b) => { const o = {}; for (const k of Object.keys(b)) if (a[k] != null) o[k] = +(b[k] - a[k]).toFixed(4); return o; };
  await page.evaluate(() => {
    const S = globalThis.__TS__;
    S.armW = () => { S.armed = true; S.frames = []; S.frameTs = []; S.longtasks = []; S.loaf = []; S.rpc = []; S.churn = { added: 0, removed: 0, attributes: 0, characterData: 0, records: 0 }; S.layoutReads = {}; return performance.now(); };
    S.disW = () => { S.armed = false; return { fs: S.framesummary(), longtasks: S.longtasks, loaf: S.loaf, rpc: S.rpc, churn: S.churn, layoutReads: S.layoutReads,
      dialogNodes: (() => { const d = document.querySelector('[role="dialog"]'); return d ? d.querySelectorAll('*').length : 0; })(),
      dialogSvg: (() => { const d = document.querySelector('[role="dialog"]'); return d ? d.querySelectorAll('svg').length : 0; })(),
      contentNodes: (() => { const c = document.querySelector('[data-slot="settings.section"]'); return c ? c.querySelectorAll('*').length : 0; })() }; };
  });
  // 等「设置」触发器出现（系统负载高时 boot 会慢）
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some((x) => (x.textContent || '').trim() === '设置'), { timeout: 90000 });
  const trig = await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '设置'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(trig.x, trig.y);
  // 等面板与导航真正挂载（而不是盲等固定毫秒）
  await page.waitForSelector('[role="dialog"] nav button', { timeout: 30000 });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('[role="dialog"] nav button')).some((x) => (x.textContent || '').trim() === '插件'), { timeout: 30000 });
  const navP = await page.evaluate(() => { const b = Array.from(document.querySelector('[role="dialog"]').querySelectorAll('nav button')).find((x) => (x.textContent || '').trim() === '插件'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(navP.x, navP.y);
  await page.waitForSelector('[role="dialog"] [role="tab"]', { timeout: 30000 });
  await page.waitForTimeout(1500);

  const readTabs = () => page.evaluate(() => Array.from(document.querySelector('[role="dialog"]').querySelectorAll('[role="tab"]')).map((el) => { const r = el.getBoundingClientRect(); return { text: (el.textContent || '').trim(), selected: el.getAttribute('aria-selected') === 'true', x: +(r.x + r.width / 2).toFixed(1), y: +(r.y + r.height / 2).toFixed(1) }; }));
  R.tabsInitial = await readTabs();
  log('initial sub-tabs:', JSON.stringify(R.tabsInitial));

  for (let round = 1; round <= 3; round++) {
    for (const want of ['插件列表', '插件配置']) {
      const g0 = gate();
      const tabs = await readTabs();
      const t = tabs.find((x) => x.text === want);
      if (!t) { R.errors.push('subtab missing: ' + want); continue; }
      const alreadyActive = t.selected;
      const cd0 = await cdpM();
      const armAt = await page.evaluate(() => globalThis.__TS__.armW());
      await page.mouse.click(t.x, t.y);
      await page.waitForTimeout(1800);
      const d = await page.evaluate(() => globalThis.__TS__.disW());
      const cd1 = await cdpM();
      const g1 = gate();
      const inw = d.rpc.filter((x) => x.t0 >= armAt - 1 && !x.stream);
      const w = { round, want, wasAlreadyActive: alreadyActive, tabsBefore: tabs, gate_ok: g0.ok && g1.ok,
        frames: d.fs, longtasks: d.longtasks.length, lt_ms: +d.longtasks.reduce((a, b) => a + b.dur, 0).toFixed(2),
        dialogNodes: d.dialogNodes, dialogSvg: d.dialogSvg, contentNodes: d.contentNodes,
        rpc: inw.map((x) => ({ p: x.path, ms: x.ms })), churnAdded: d.churn.added, cdpDelta: mdelta(cd0, cd1) };
      R.windows.push(w);
      log(`r${round} → ${want}${alreadyActive ? ' (已是当前)' : ''}: nodes=${w.dialogNodes} content=${w.contentNodes} svg=${w.dialogSvg} rpc=${w.rpc.length} [${w.rpc.map((z) => z.p + ':' + z.ms).join(', ')}] f95=${w.frames.p95} max=${w.frames.max} LT=${w.longtasks} ΔL=${w.cdpDelta.LayoutCount} ΔS=${w.cdpDelta.RecalcStyleCount} ΔScD=${w.cdpDelta.ScriptDuration}`);
      await page.waitForTimeout(900);
    }
  }

  // dwell 12s：静置观察常驻定时器/RPC
  const g0 = gate(); const cd0 = await cdpM();
  await page.evaluate(() => globalThis.__TS__.armW());
  await page.waitForTimeout(12000);
  const d = await page.evaluate(() => globalThis.__TS__.disW());
  const cd1 = await cdpM(); const g1 = gate();
  R.dwell = { gate_ok: g0.ok && g1.ok, seconds: 12, frames: d.fs, longtasks: d.longtasks.length,
    lt_ms: +d.longtasks.reduce((a, b) => a + b.dur, 0).toFixed(2),
    rpc: d.rpc.filter((x) => !x.stream).map((x) => ({ p: x.path, ms: x.ms })), streams: d.rpc.filter((x) => x.stream).length,
    churn: d.churn, cdpDelta: mdelta(cd0, cd1), dialogNodes: d.dialogNodes, dialogSvg: d.dialogSvg };
  log('dwell:', JSON.stringify(R.dwell));

  await page.keyboard.press('Escape');
  R.stage = 'done';
} catch (e) { R.stage = 'ERROR'; R.fatal = String(e && e.stack || e).slice(0, 700); log('FATAL', R.fatal); }
finally {
  try { if (browser) await browser.close(); } catch {}
  R.release = release(AGENT);
  writeFileSync(OUT, JSON.stringify(R, null, 2));
  log('WROTE', OUT, 'windows', R.windows.length, 'stage', R.stage, 'release', JSON.stringify(R.release));
}
