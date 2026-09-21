#!/usr/bin/env node
/**
 * drawer-probe3.mjs — 展开「N 个子代理运行中」子代理入口（只读）。
 *
 * 已知事实（来自 session.list 真实数据）：
 *   session-6ea8d570「审计交接提示词并对齐需求」cwd=Dexterous_Hand_23Dof running=true  runningSubagentCount=2
 *   session-d565c2bf「会话删除更新误删全部会话」cwd=dsh                  running=false runningSubagentCount=9
 * 策略：A) 用侧栏搜索框搜标题；B) 点对应工作区分组。找到 chip 后点开看是否展开列表。
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3080';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/r4-live-verify/raw/drawer3.json';
const out = { at: new Date().toISOString(), errors: [], steps: [], chipClicks: [] };

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
page.on('pageerror', (e) => out.errors.push('pageerror: ' + String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') out.errors.push('console: ' + m.text().slice(0, 200)); });

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);

const chips = () => page.evaluate(() => {
  const res = [];
  for (const el of document.querySelectorAll('*')) {
    const t = (el.textContent || '').trim();
    if (/^\d+ 个子代理运行中$/.test(t) && el.children.length === 0) {
      res.push({ text: t, tag: el.tagName, cls: String(el.className).slice(0, 60), visible: el.offsetWidth > 0 });
    }
  }
  return res;
});

// 策略 A：搜索
const searchBtn = page.locator('button[aria-label="搜索会话"]').first();
if (await searchBtn.count()) {
  await searchBtn.click().catch(() => {});
  await page.waitForTimeout(1200);
  await page.keyboard.type('审计交接', { delay: 60 }).catch(() => {});
  await page.waitForTimeout(2500);
  out.steps.push({ name: 'search-by-title', chips: await chips(), bodyTail: (await page.evaluate(() => (document.body.innerText || '').slice(0, 600))) });
}

// 策略 B：点工作区分组
if (out.steps.at(-1)?.chips.length === 0) {
  for (const group of ['Dexterous_Hand_23Dof', 'dsh']) {
    const clicked = await page.evaluate((g) => {
      for (const el of document.querySelectorAll('*')) {
        if ((el.textContent || '').trim() === g && el.children.length === 0) {
          let p = el;
          for (let i = 0; i < 5 && p; i += 1) {
            if (p.tagName === 'BUTTON' || p.getAttribute('role') === 'button' || p.getAttribute('tabindex') !== null) { p.click(); return 'ancestor:' + p.tagName; }
            p = p.parentElement;
          }
          el.click(); return 'leaf';
        }
      }
      return null;
    }, group).catch(() => null);
    await page.waitForTimeout(3000);
    out.steps.push({ name: `group-${group}`, clicked, chips: await chips() });
    if (out.steps.at(-1).chips.length > 0) break;
  }
}

// 点开 chip
const found = out.steps.flatMap((s) => s.chips);
if (found.length > 0) {
  const target = found[0].text;
  const before = await page.evaluate(() => ({
    dialogCount: document.querySelectorAll('[role="dialog"]').length,
    bodyTextLen: (document.body.innerText || '').length,
    subagentClassNodes: document.querySelectorAll('[class*="subagent"],[class*="Subagent"]').length,
  }));
  const clicked = await page.evaluate((needle) => {
    for (const el of document.querySelectorAll('*')) {
      if ((el.textContent || '').trim() === needle && el.children.length === 0) {
        let p = el;
        for (let i = 0; i < 6 && p; i += 1) {
          if (p.tagName === 'BUTTON' || p.getAttribute('role') === 'button' || p.getAttribute('tabindex') !== null) { p.click(); return `ancestor ${p.tagName}.${String(p.className).slice(0, 40)}`; }
          p = p.parentElement;
        }
        el.click(); return 'leaf-click';
      }
    }
    return null;
  }, target).catch(() => null);
  await page.waitForTimeout(3000);
  const after = await page.evaluate(() => ({
    dialogCount: document.querySelectorAll('[role="dialog"]').length,
    bodyTextLen: (document.body.innerText || '').length,
    subagentClassNodes: document.querySelectorAll('[class*="subagent"],[class*="Subagent"]').length,
    bodyTail: (document.body.innerText || '').slice(-800),
  }));
  await page.screenshot({ path: '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/r4-live-verify/raw/drawer3-open.png' }).catch(() => {});
  out.chipClicks.push({ target, clicked, before, after });
}

out.errors = out.errors;
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
for (const s of out.steps) console.log(`${s.name}: chips=${JSON.stringify(s.chips)}${s.clicked ? ' clicked=' + s.clicked : ''}`);
console.log('chipClicks:', JSON.stringify(out.chipClicks, null, 1)?.slice(0, 1800));
console.log('errors:', out.errors.length);
await browser.close();
