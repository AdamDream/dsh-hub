#!/usr/bin/env node
/**
 * drawer-probe2.mjs — 定位并展开「N 个子代理运行中」子代理入口（只读）。
 *
 * 上一版失败原因（已记录）：GUI 默认侧栏在工作区「EAGET」上，而带子代理的会话在
 * 工作区「dsh」下，因此首屏没有任何「子代理」文本。本版先按侧栏条目逐个切换工作区，
 * 直到找到「个子代理运行中」状态点，再点开看是否真的展开出子代理列表。
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3080';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/r4-live-verify/raw/drawer2.json';
const out = { at: new Date().toISOString(), errors: [], found: null, attempts: [] };

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
page.on('pageerror', (e) => out.errors.push('pageerror: ' + String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') out.errors.push('console: ' + m.text().slice(0, 200)); });

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);

const findChip = () => page.evaluate(() => {
  const res = [];
  for (const el of document.querySelectorAll('*')) {
    const t = (el.textContent || '').trim();
    if (/个子代理运行中/.test(t) && el.children.length === 0) {
      res.push({ text: t.slice(0, 40), tag: el.tagName, cls: String(el.className).slice(0, 60), visible: el.offsetWidth > 0 });
    }
  }
  return res;
});

// 侧栏可切换的工作区/会话条目
const entries = await page.evaluate(() => Array.from(document.querySelectorAll('nav button, [class*="sidebar"] button, [class*="Sidebar"] button, [class*="nav"] button'))
  .map((b) => (b.textContent || '').trim()).filter((t) => t && t.length < 30).slice(0, 40));
out.sidebarEntries = [...new Set(entries)];

out.found = await findChip();

if (out.found.length === 0) {
  // 逐个点侧栏条目（优先可能含子代理的），每次点完找 chip
  const tryList = out.sidebarEntries.filter((t) => !['新会话', '设置', '偏好库 (taste)'].includes(t));
  for (const t of tryList) {
    const before = out.errors.length;
    const ok = await page.evaluate((needle) => {
      for (const el of document.querySelectorAll('button,a,[role="button"],[tabindex]')) {
        if ((el.textContent || '').trim() === needle) { el.click(); return true; }
      }
      return false;
    }, t).catch(() => false);
    await page.waitForTimeout(2500);
    const chip = await findChip();
    out.attempts.push({ entry: t, clicked: ok, newErrors: out.errors.length - before, chips: chip });
    if (chip.length > 0) { out.found = chip; out.foundVia = t; break; }
  }
}

// 找到后点开，观察是否展开子代理列表/抽屉
if (out.found && out.found.length > 0) {
  const beforeErr = out.errors.length;
  const beforeSnapshot = await page.evaluate(() => ({
    dialogs: document.querySelectorAll('[role="dialog"]').length,
    drawers: document.querySelectorAll('[class*="drawer"],[class*="Drawer"],[role="complementary"],aside').length,
    subagentRows: Array.from(document.querySelectorAll('*')).filter((e) => /subagent/.test(String(e.className))).length,
    bodyText: (document.body.innerText || '').length,
  }));
  const clicked = await page.evaluate(() => {
    for (const el of document.querySelectorAll('button,a,[role="button"],[tabindex],span,div')) {
      const t = (el.textContent || '').trim();
      if (/^[\d]+ 个子代理运行中$/.test(t)) {
        let p = el;
        for (let i = 0; i < 5 && p; i += 1) {
          if (p.tagName === 'BUTTON' || p.getAttribute('role') === 'button' || p.getAttribute('tabindex') !== null) { p.click(); return t; }
          p = p.parentElement;
        }
        el.click(); return t + '(leaf)';
      }
    }
    return null;
  }).catch(() => null);
  await page.waitForTimeout(2500);
  const afterSnapshot = await page.evaluate(() => ({
    dialogs: document.querySelectorAll('[role="dialog"]').length,
    drawers: document.querySelectorAll('[class*="drawer"],[class*="Drawer"],[role="complementary"],aside').length,
    subagentRows: Array.from(document.querySelectorAll('*')).filter((e) => /subagent/.test(String(e.className))).length,
    bodyText: (document.body.innerText || '').length,
    bodyTail: (document.body.innerText || '').slice(-600),
  }));
  await page.screenshot({ path: '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/r4-live-verify/raw/drawer-open.png' }).catch(() => {});
  out.clickResult = { clicked, newErrors: out.errors.length - beforeErr, beforeSnapshot, afterSnapshot };
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log('sidebarEntries:', JSON.stringify(out.sidebarEntries));
console.log('found chips:', JSON.stringify(out.found), 'via', out.foundVia ?? '(first screen)');
console.log('clickResult:', JSON.stringify(out.clickResult, null, 1)?.slice(0, 1200));
console.log('errors:', out.errors.length);
await browser.close();
