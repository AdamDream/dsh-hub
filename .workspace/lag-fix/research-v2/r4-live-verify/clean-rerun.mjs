#!/usr/bin/env node
/**
 * clean-rerun.mjs — 在**独占锁**下重跑三项，用于（a）复现头条浏览器结论、(b) 补上"趋势曲线像素级确认"
 * 的缺口、(c) 重试子代理抽屉的收起。
 *
 * 与前几版探针的区别：本次全程持 `.probe.lock`；并且对趋势面板做**元素级截图**（把面板滚入视野后
 * 截元素本身），使曲线本体落在像素证据里。
 */
import { chromium } from 'playwright';
import { writeFileSync, readFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3080';
const ROOT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/r4-live-verify';
const OUT = `${ROOT}/raw/clean-rerun.json`;

const lockHeld = (() => {
  try { return readFileSync(`${ROOT}/raw/.lock-token`, 'utf8').trim(); } catch { return '(token missing)'; }
})();

const out = { at: new Date().toISOString(), lockToken: lockHeld, errors: [], parts: {} };

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push({ kind: 'pageerror', text: String(e).slice(0, 300) }));
page.on('console', (m) => { if (m.type() === 'error') errs.push({ kind: 'console', text: m.text().slice(0, 300) }); });
page.on('requestfailed', (r) => errs.push({ kind: 'requestfailed', text: `${r.method()} ${r.url().slice(0, 120)} ${r.failure()?.errorText}` }));

const usageReqs = [];
page.on('request', (r) => { if (r.url().includes('/usage/')) { let m = null; try { m = JSON.parse(r.postData() || '{}').method; } catch { /* ignore */ } usageReqs.push(m); } });

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);

// ── A. 普通挂载 + 趋势面板元素级截图（闭合"曲线未像素确认"缺口）──────────
await page.locator('button:has-text("设置")').first().click();
await page.waitForSelector('[role="dialog"]', { timeout: 20000 });
await page.waitForTimeout(1500);
await page.locator('[role="dialog"]').locator('button:has-text("插件")').first().click();
await page.waitForSelector('.du_root', { timeout: 25000 });
await page.waitForTimeout(7000);

out.parts.cardStats = await page.evaluate(() => Array.from(document.querySelectorAll('.du_root .du_stat')).map((s) => ({
  label: (s.querySelector('.du_statLabel')?.textContent ?? '').trim(),
  value: (s.querySelector('.du_statValue')?.textContent ?? '').trim(),
})));

// 找到含「趋势」的面板并做元素级截图
const trendPanel = page.locator('.du_root .du_panel', { has: page.locator('.du_panelTitle', { hasText: '趋势' }) }).first();
let panelInfo = { found: false };
try {
  await trendPanel.scrollIntoViewIfNeeded({ timeout: 10000 });
  await page.waitForTimeout(1800); // 让 B2 可见性轮询/重绘落地
  panelInfo = await trendPanel.evaluate((el) => ({
    found: true,
    title: (el.querySelector('.du_panelTitle')?.textContent ?? '').trim(),
    height: el.offsetHeight,
    svg: el.querySelectorAll('svg').length,
    svgHeight: el.querySelector('svg')?.getAttribute('height') ?? null,
    pathCount: el.querySelectorAll('svg path').length,
    areaPathFillNonEmpty: Array.from(el.querySelectorAll('svg path')).filter((p) => (p.getAttribute('d') || '').length > 40).length,
    rectCount: el.querySelectorAll('svg rect').length,
    textNodes: el.querySelectorAll('svg text').length,
    controls: Array.from(el.querySelectorAll('select')).map((s) => ({ value: s.value, options: Array.from(s.options).map((o) => o.textContent) })),
  }));
  await trendPanel.screenshot({ path: `${ROOT}/raw/clean-trend-panel.png` });
  await page.locator('.du_root').first().screenshot({ path: `${ROOT}/raw/clean-usage-card.png` });
} catch (e) { panelInfo = { found: false, error: String(e.message).slice(0, 200) }; }
out.parts.trendPanel = panelInfo;
out.parts.cardNotes = await page.evaluate(() => Array.from(document.querySelectorAll('.du_root .du_note,.du_root .du_heatNote')).map((n) => (n.textContent || '').trim()));
out.parts.errorsAfterMount = errs.length;

// ── B. 复现筛选切换（干净窗口）─────────────────────────────────────────────
const switches = [];
for (const [idx, value] of [[1, '30'], [1, '90'], [1, '7'], [0, 'dsh'], [0, 'cc'], [0, 'all']]) {
  const before = errs.length; const reqBefore = usageReqs.length;
  await page.locator('.du_root select.du_select').nth(idx).selectOption(value).catch((e) => errs.push({ kind: 'sel', text: e.message.slice(0, 120) }));
  await page.waitForTimeout(3200);
  const req = await page.evaluate(() => {
    for (const s of document.querySelectorAll('.du_root .du_stat')) {
      if ((s.querySelector('.du_statLabel')?.textContent ?? '').includes('请求数')) return (s.querySelector('.du_statValue')?.textContent ?? '').trim();
    }
    return null;
  });
  switches.push({ idx, value, newReqs: usageReqs.length - reqBefore, newErrors: errs.length - before, requests: req });
}
out.parts.switches = switches;

await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(1200);
await page.locator('[role="dialog"] button[aria-label*="关闭"]').first().click().catch(() => {});
await page.waitForTimeout(1500);

// ── C. 子代理抽屉展开 + 收起重试 ───────────────────────────────────────────
const drawer = [];
await page.locator('button[aria-label="搜索会话"]').first().click();
await page.waitForTimeout(1200);
await page.keyboard.type('审计交接', { delay: 60 });
await page.waitForTimeout(2500);
await page.locator('button.YDXeBa_searchResultRow').first().click();
await page.waitForTimeout(6000);

const dstate = () => page.evaluate(() => {
  const trig = document.querySelector('button.ZKlsPq_trigger');
  return {
    ariaExpanded: trig?.getAttribute('aria-expanded') ?? null,
    ariaLabel: trig?.getAttribute('aria-label') ?? null,
    treeItems: document.querySelectorAll('[role="treeitem"]').length,
    runningRows: Array.from(document.querySelectorAll('[role="treeitem"]')).filter((i) => /正在运行/.test(i.textContent || '')).length,
  };
});
drawer.push({ step: 'initial', ...(await dstate()) });
await page.locator('button.ZKlsPq_trigger').first().click({ timeout: 8000 }).catch((e) => errs.push({ kind: 'drawer', text: e.message.slice(0, 120) }));
await page.waitForTimeout(2500);
drawer.push({ step: 'expand', ...(await dstate()) });
// 收起重试：再点一次 + 若无效则试 Escape / 点外部
await page.locator('button.ZKlsPq_trigger').first().click({ timeout: 8000 }).catch(() => {});
await page.waitForTimeout(2500);
drawer.push({ step: 'collapse-click2', ...(await dstate()) });
if ((await dstate()).treeItems > 1) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2000);
  drawer.push({ step: 'collapse-escape', ...(await dstate()) });
}
if ((await dstate()).treeItems > 1) {
  await page.mouse.click(1300, 700);
  await page.waitForTimeout(2000);
  drawer.push({ step: 'collapse-outside-click', ...(await dstate()) });
}
out.parts.drawer = drawer;
out.parts.usageMethodSet = [...new Set(usageReqs)];
out.errors = errs;
out.totalErrors = errs.length;

writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log('lockToken =', lockHeld);
console.log('card stats:', out.parts.cardStats.map((s) => `${s.label}=${s.value}`).join(' | '));
console.log('trend panel:', JSON.stringify(out.parts.trendPanel));
console.log('notes:', JSON.stringify(out.parts.cardNotes));
console.log('switches:', JSON.stringify(out.parts.switches));
console.log('drawer:', JSON.stringify(drawer));
console.log('usage methods:', JSON.stringify(out.parts.usageMethodSet));
console.log('TOTAL errors =', out.totalErrors);
await browser.close();
