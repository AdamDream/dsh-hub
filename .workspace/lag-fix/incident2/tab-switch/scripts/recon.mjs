#!/usr/bin/env node
/** recon.mjs — 设置面板 DOM 侦察（为后续器械定选择器）。只点「设置」触发器。 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tryAcquire, release, census, censusVerdict } from '../lib/lock.mjs';

const BASE = 'http://127.0.0.1:3080';
const HERE = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/tab-switch';
const RAW = `${HERE}/raw`;
const AGENT = 'incident2-tab-switch';
mkdirSync(RAW, { recursive: true });

const out = { at: new Date().toISOString(), stage: 'start', errors: [] };
const lock = tryAcquire(AGENT, 'recon: settings panel DOM', 1500, (m) => console.log(m));
out.lock = lock;
if (!lock.acquired) { out.stage = 'LOCK_TIMEOUT'; writeFileSync(`${RAW}/recon.json`, JSON.stringify(out, null, 2)); process.exit(2); }

let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const installFail = [];
  page.on('pageerror', (e) => out.errors.push('pageerror: ' + String(e).slice(0, 300)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(12000);
  out.hostPid = process.env.HOST_PID || '301709';
  out.censusAtStart = census();

  // 打开设置（只点触发器）
  const trig = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '设置');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: b.textContent.trim() };
  });
  out.trigger = trig;
  if (!trig) throw new Error('no settings trigger');
  await page.mouse.click(trig.x, trig.y);
  await page.waitForTimeout(2500);

  out.dialog = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return { present: false };
    const info = (el) => ({
      tag: el.tagName, cls: String(el.className).slice(0, 160),
      id: el.id || null,
      text: (el.textContent || '').trim().slice(0, 60),
      role: el.getAttribute('role'), aria: {
        current: el.getAttribute('aria-current'), selected: el.getAttribute('aria-selected'),
        controls: el.getAttribute('aria-controls'), expanded: el.getAttribute('aria-expanded'),
        labelledby: el.getAttribute('aria-labelledby'), label: el.getAttribute('aria-label'),
      },
      slot: el.getAttribute('data-slot'), testid: el.getAttribute('data-testid'),
      disabled: el.disabled ?? null,
      box: (() => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; })(),
    });
    const nav = dlg.querySelector('nav') || dlg.querySelector('[role="tablist"]');
    return {
      present: true,
      dialogCls: String(dlg.className).slice(0, 200),
      dialogBox: (() => { const r = dlg.getBoundingClientRect(); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; })(),
      navTag: nav ? nav.tagName : null,
      navCls: nav ? String(nav.className).slice(0, 200) : null,
      navSlot: nav ? nav.getAttribute('data-slot') : null,
      buttons: Array.from(dlg.querySelectorAll('button')).slice(0, 40).map(info),
      tabs: Array.from(dlg.querySelectorAll('[role="tab"]')).slice(0, 40).map(info),
      slotNodes: Array.from(dlg.querySelectorAll('[data-slot]')).slice(0, 60).map((el) => ({ slot: el.getAttribute('data-slot'), tag: el.tagName, cls: String(el.className).slice(0, 90), text: (el.textContent || '').trim().slice(0, 40) })),
      scrollables: Array.from(dlg.querySelectorAll('*')).filter((el) => el.scrollHeight > el.clientHeight + 20 && el.clientHeight > 60).slice(0, 12).map((el) => ({
        tag: el.tagName, cls: String(el.className).slice(0, 120), slot: el.getAttribute('data-slot'),
        clientH: el.clientHeight, scrollH: el.scrollHeight, overflowY: getComputedStyle(el).overflowY,
      })),
      nodes: dlg.querySelectorAll('*').length,
      svg: dlg.querySelectorAll('svg').length,
    };
  });

  // 逐个“栏目”候选：找 nav 内可点击元素的可访问名
  out.navCandidates = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return [];
    const res = [];
    for (const el of dlg.querySelectorAll('button,[role="tab"],[role="radio"],a')) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      res.push({ tag: el.tagName, role: el.getAttribute('role'), text: (el.textContent || '').trim().slice(0, 40),
        slot: el.getAttribute('data-slot'), cls: String(el.className).slice(0, 90),
        x: +(r.x + r.width / 2).toFixed(1), y: +(r.y + r.height / 2).toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
        aria: { current: el.getAttribute('aria-current'), selected: el.getAttribute('aria-selected') } });
    }
    return res;
  });

  out.stage = 'done';
} catch (e) {
  out.stage = 'ERROR';
  out.fatal = String(e).slice(0, 600);
} finally {
  try { if (browser) await browser.close(); } catch {}
  out.release = release(AGENT);
  out.censusAtEnd = census();
  writeFileSync(`${RAW}/recon.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ stage: out.stage, lock: out.lock.acquired, nav: out.navCandidates?.length, err: out.errors.slice(0, 3), fatal: out.fatal }, null, 2));
}
