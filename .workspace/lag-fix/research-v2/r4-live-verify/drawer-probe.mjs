#!/usr/bin/env node
/**
 * drawer-probe.mjs — 子代理抽屉/子代理状态点能否展开（只读）。
 *
 * 线索：宿主 B1 补丁给**非 subagent** 行补 `runningSubagentCount`，客户端
 * dsh-client-ui-workspace `client.js:561` 据此渲染「N 个子代理运行中」状态点。
 * 本探针先在真实 GUI 里找到该状态点（或任何「子代理」入口），点开看是否真的展开出列表。
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3080';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/r4-live-verify/raw/drawer.json';
const out = { at: new Date().toISOString(), errors: [], steps: [] };

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
page.on('pageerror', (e) => out.errors.push('pageerror: ' + String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') out.errors.push('console: ' + m.text().slice(0, 200)); });

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);

const snap = () => page.evaluate(() => {
  const visible = (el) => el.offsetWidth > 0 || el.offsetHeight > 0;
  const hits = [];
  for (const el of document.querySelectorAll('*')) {
    if (el.children.length > 0) continue;
    const t = (el.textContent || '').trim();
    if (t.includes('子代理')) {
      // 向上找可点祖先
      let p = el, clickable = null;
      for (let i = 0; i < 6 && p; i += 1) {
        if (p.tagName === 'BUTTON' || p.getAttribute('role') === 'button' || p.onclick || p.getAttribute('tabindex') !== null) { clickable = p; break; }
        p = p.parentElement;
      }
      hits.push({ text: t.slice(0, 60), tag: el.tagName, cls: String(el.className).slice(0, 60), visible: visible(el), clickableTag: clickable?.tagName ?? null, clickableCls: String(clickable?.className ?? '').slice(0, 60) });
    }
  }
  return {
    subagentTextHits: hits.slice(0, 20),
    panelCount: document.querySelectorAll('[role="dialog"],[role="complementary"],aside,[class*="drawer"],[class*="Drawer"]').length,
    bodyTextLen: (document.body.textContent || '').trim().length,
    sidebarSample: Array.from(document.querySelectorAll('nav a,nav button,[class*="sidebar"] button,[class*="Sidebar"] button')).slice(0, 12).map((b) => (b.textContent || '').trim().slice(0, 40)),
  };
});

out.steps.push({ name: 'initial', ...(await snap()) });

// 依次尝试点击每个含「子代理」文本的可点祖先
for (let i = 0; i < out.steps[0].subagentTextHits.length; i += 1) {
  const target = out.steps[0].subagentTextHits[i];
  if (!target.clickableTag) continue;
  const clicked = await page.evaluate((needle) => {
    for (const el of document.querySelectorAll('button,[role="button"],a,[tabindex]')) {
      if ((el.textContent || '').includes(needle)) { el.click(); return (el.textContent || '').trim().slice(0, 40); }
    }
    return null;
  }, target.text).catch(() => null);
  await page.waitForTimeout(2200);
  const after = await snap();
  out.steps.push({ name: `click#${i}`, clicked, after });
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(600);
}

// 也尝试：打开设置→插件外，看会话侧栏是否含子代理抽屉入口（aria）
out.ariaSurvey = await page.evaluate(() => Array.from(document.querySelectorAll('[aria-label],[title]'))
  .map((e) => (e.getAttribute('aria-label') || e.getAttribute('title') || '').trim())
  .filter((s) => s && /子代理|subagent|抽屉|drawer|展开|expand/i.test(s)).slice(0, 20));

out.errors = out.errors;
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log('subagent text hits:', out.steps[0].subagentTextHits.length);
for (const h of out.steps[0].subagentTextHits) console.log('  -', JSON.stringify(h));
console.log('aria survey:', JSON.stringify(out.ariaSurvey));
for (const s of out.steps.slice(1)) console.log(`  ${s.name}: clicked=${s.clicked} panels ${s.after.panelCount} bodyText ${s.after.bodyTextLen}`);
console.log('errors:', out.errors.length);
await browser.close();
