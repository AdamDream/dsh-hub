#!/usr/bin/env node
/**
 * drawer-probe5.mjs — 精确验证子代理抽屉的展开/收起（只读）。
 * 触发器已定位：BUTTON.ZKlsPq_trigger，aria-label "N 个子代理，正在运行"，文本 "M 个子代理"。
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3080';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/r4-live-verify/raw/drawer5.json';
const out = { at: new Date().toISOString(), errors: [], states: [] };

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
page.on('pageerror', (e) => out.errors.push('pageerror: ' + String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') out.errors.push('console: ' + m.text().slice(0, 200)); });

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);
await page.locator('button[aria-label="搜索会话"]').first().click();
await page.waitForTimeout(1200);
await page.keyboard.type('审计交接', { delay: 60 });
await page.waitForTimeout(2500);
await page.locator('button.YDXeBa_searchResultRow').first().click();
await page.waitForTimeout(6000);

const state = () => page.evaluate(() => {
  const trig = document.querySelector('button.ZKlsPq_trigger');
  const tree = document.querySelector('[role="tree"]');
  const items = Array.from(document.querySelectorAll('[role="treeitem"]'));
  return {
    triggerFound: Boolean(trig),
    triggerAria: trig?.getAttribute('aria-label') ?? null,
    triggerAriaExpanded: trig?.getAttribute('aria-expanded') ?? null,
    triggerText: (trig?.textContent || '').trim().slice(0, 40),
    treeFound: Boolean(tree),
    treeVisible: tree ? tree.offsetHeight > 0 : false,
    treeHeight: tree?.offsetHeight ?? 0,
    treeItems: items.map((i) => (i.textContent || '').trim().slice(0, 60)),
    subagentMarkerTexts: Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && /个子代理/.test(e.textContent || '')).map((e) => (e.textContent || '').trim().slice(0, 40)),
  };
});

out.states.push({ name: 'initial', ...(await state()) });
await page.screenshot({ path: '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/r4-live-verify/raw/drawer5-initial.png' }).catch(() => {});

for (const [i, label] of [[1, 'click-1 (toggle)'], [2, 'click-2 (toggle back)']]) {
  const before = out.errors.length;
  await page.locator('button.ZKlsPq_trigger').first().click({ timeout: 8000 }).catch((e) => out.errors.push('clickfail: ' + e.message.slice(0, 100)));
  await page.waitForTimeout(2500);
  out.states.push({ name: label, newErrors: out.errors.length - before, ...(await state()) });
  await page.screenshot({ path: `/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/r4-live-verify/raw/drawer5-${i}.png` }).catch(() => {});
}

out.errors = out.errors;
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
for (const s of out.states) console.log(`${s.name}: trigger=${s.triggerFound} ariaExpanded=${s.triggerAriaExpanded} tree=${s.treeFound} visible=${s.treeVisible} h=${s.treeHeight} items=${JSON.stringify(s.treeItems)}`);
console.log('errors:', out.errors.length, JSON.stringify(out.errors.slice(0, 3)));
await browser.close();
