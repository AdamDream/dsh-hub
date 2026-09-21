#!/usr/bin/env node
/**
 * drawer-probe4.mjs — 子代理抽屉（dsh-client-ui-subagent 的 switcher）展开验证（只读）。
 *
 * 已定位：抽屉实现是 `dsh-client-ui-subagent/lib/client.js`，带
 *   「切换子代理：{title}」/「{count} 个子代理」/「展开|收起 {label} 的下级子代理」
 *   以及 SubagentSwitcherIcon / SubagentCatalogOpen 等组件。
 * 路径：搜索父会话标题 → 点结果行进入该会话 → 找 switcher / branch.expand 触发器 → 点开。
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3080';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/r4-live-verify/raw/drawer4.json';
const out = { at: new Date().toISOString(), errors: [], survey: {}, attempts: [] };

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
page.on('pageerror', (e) => out.errors.push('pageerror: ' + String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') out.errors.push('console: ' + m.text().slice(0, 200)); });

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(9000);

// 进入带 2 个运行中子代理的父会话
await page.locator('button[aria-label="搜索会话"]').first().click();
await page.waitForTimeout(1200);
await page.keyboard.type('审计交接', { delay: 60 });
await page.waitForTimeout(2500);
await page.locator('button.YDXeBa_searchResultRow').first().click();
await page.waitForTimeout(6000);

out.survey = await page.evaluate(() => {
  const els = [];
  for (const el of document.querySelectorAll('button,[role="button"],[aria-label],[title],[class*="Switcher"],[class*="switcher"],[class*="Subagent"],[class*="subagent"]')) {
    const cls = String(el.className || '');
    const aria = el.getAttribute('aria-label') || '';
    const title = el.getAttribute('title') || '';
    if (/Switcher|switcher|Subagent|subagent/i.test(cls) || /子代理|切换/.test(aria + title)) {
      els.push({ tag: el.tagName, cls: cls.slice(0, 70), aria: aria.slice(0, 60), title: title.slice(0, 40), text: (el.textContent || '').trim().slice(0, 50), visible: el.offsetWidth > 0 });
    }
  }
  return {
    candidates: els.slice(0, 25),
    hasSubagentText: /个子代理/.test(document.body.innerText || ''),
    bodyTextLen: (document.body.innerText || '').length,
  };
});

// 逐个尝试点开
for (const c of out.survey.candidates.slice(0, 8)) {
  const before = await page.evaluate(() => ({
    bodyLen: (document.body.innerText || '').length,
    trees: document.querySelectorAll('[role="tree"],[role="treeitem"]').length,
    panelsOverlay: Array.from(document.querySelectorAll('[class*="panel"],[class*="Panel"],[role="dialog"],[class*="overlay"],[class*="Overlay"]')).filter((e) => e.offsetHeight > 80).length,
    markers: (document.body.innerText || '').match(/\d+ 个子代理/g) || [],
  }));
  const beforeErr = out.errors.length;
  const clicked = await page.evaluate((needle) => {
    for (const el of document.querySelectorAll('button,[role="button"],[aria-label],[title]')) {
      const key = `${el.getAttribute('aria-label') || ''}|${el.getAttribute('title') || ''}|${String(el.className || '')}`;
      if (key === needle) { el.click(); return `${el.tagName}.${String(el.className).slice(0, 40)}`; }
    }
    return null;
  }, `${c.aria}|${c.title}|${c.cls}`).catch(() => null);
  if (!clicked) continue;
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => ({
    bodyLen: (document.body.innerText || '').length,
    trees: document.querySelectorAll('[role="tree"],[role="treeitem"]').length,
    panelsOverlay: Array.from(document.querySelectorAll('[class*="panel"],[class*="Panel"],[role="dialog"],[class*="overlay"],[class*="Overlay"]')).filter((e) => e.offsetHeight > 80).length,
    markers: (document.body.innerText || '').match(/\d+ 个子代理/g) || [],
    textTail: (document.body.innerText || '').slice(-400),
  }));
  await page.screenshot({ path: `/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/r4-live-verify/raw/drawer4-attempt${out.attempts.length + 1}.png` }).catch(() => {});
  out.attempts.push({ cand: c, clicked, newErrors: out.errors.length - beforeErr, before, after, expanded: after.bodyLen !== before.bodyLen || after.trees !== before.trees || after.panelsOverlay !== before.panelsOverlay });
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(800);
}

out.errors = out.errors;
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log('survey candidates:', out.survey.candidates.length, 'hasSubagentText=', out.survey.hasSubagentText, 'bodyLen=', out.survey.bodyTextLen);
for (const c of out.survey.candidates) console.log('  -', JSON.stringify(c));
for (const a of out.attempts) console.log(`  attempt: ${a.clicked} expanded=${a.expanded} trees ${a.before.trees}->${a.after.trees} overlays ${a.before.panelsOverlay}->${a.after.panelsOverlay} markers ${JSON.stringify(a.after.markers)}`);
console.log('errors:', out.errors.length);
await browser.close();
