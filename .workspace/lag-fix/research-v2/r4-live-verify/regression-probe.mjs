#!/usr/bin/env node
/**
 * regression-probe.mjs — R4 回归哨兵（**不注入任何响应**，纯观察真实行为）。
 *
 * 三部分：
 *  A. 设置页 8 个标签逐个切换：每页记录渲染出的文本量、错误增量、是否留白；
 *  B. 用量卡片普通挂载（无 route 注入）：卡片指标是否齐全渲染、0 console error、
 *     筛选切换（range 7→30→90、dataSource all→dsh→cc）是否真的触发新请求并更新卡片；
 *  C. 子代理抽屉能否展开。
 *
 * 纪律：只点「只读/本地 UI」控件（标签、下拉）。不点任何写状态按钮（保存/应用/刷新/重扫）。
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3080';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/r4-live-verify/raw/regression.json';
const out = { at: new Date().toISOString(), errors: [], tabs: [], card: {}, filters: [], drawer: {}, summary: {} };

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push({ kind: 'pageerror', text: String(e).slice(0, 300) }));
page.on('console', (m) => { if (m.type() === 'error') errs.push({ kind: 'console', text: m.text().slice(0, 300) }); });
page.on('requestfailed', (r) => errs.push({ kind: 'requestfailed', text: `${r.method()} ${r.url().slice(0, 120)} ${r.failure()?.errorText}` }));

const summaryReqs = [];
page.on('request', (r) => {
  if (r.url().includes('/usage/')) {
    let payload = null;
    try { payload = JSON.parse(r.postData() || '{}').payload; } catch { /* ignore */ }
    summaryReqs.push({ url: r.url().replace(BASE, ''), method: JSON.parse(r.postData() || '{}').method, payload, at: Date.now() });
  }
});

const markErr = () => errs.length;
const readCard = () => page.evaluate(() => {
  const root = document.querySelector('.du_root');
  if (!root) return null;
  const txt = (el) => (el?.textContent ?? '').trim();
  return {
    statCount: root.querySelectorAll('.du_stat').length,
    stats: Array.from(root.querySelectorAll('.du_stat')).map((s) => ({
      label: txt(s.querySelector('.du_statLabel')), value: txt(s.querySelector('.du_statValue')),
    })),
    selects: Array.from(root.querySelectorAll('select.du_select')).map((s) => ({
      value: s.value, options: Array.from(s.options).map((o) => o.textContent), label: s.getAttribute('aria-label') || null,
    })),
    tabs: Array.from(root.querySelectorAll('.du_tab')).map((t) => ({ text: txt(t), active: t.className.includes('Active') })),
    panels: Array.from(root.querySelectorAll('.du_panelTitle')).map((t) => txt(t)),
    svgCount: root.querySelectorAll('svg').length,
    tableRows: root.querySelectorAll('.du_tableWrap tbody tr').length,
    noteTexts: Array.from(root.querySelectorAll('.du_note,.du_heatNote')).map((n) => txt(n).slice(0, 80)),
    errorBox: txt(root.querySelector('.du_error')) || null,
    nodeCount: root.querySelectorAll('*').length,
  };
});

// ══ 启动 ═══════════════════════════════════════════════════════════════════
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(7000);
out.bootErrors = errs.slice();

// ══ A. 设置页 8 个标签 ═════════════════════════════════════════════════════
await page.locator('button:has-text("设置")').first().click();
await page.waitForSelector('[role="dialog"]', { timeout: 20000 });
await page.waitForTimeout(1500);

const tabNames = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  return Array.from(d.querySelectorAll('nav button, [role="tablist"] button, button.VOzbGW_navCell'))
    .map((t) => (t.textContent || '').trim()).filter(Boolean);
});
out.tabNames = tabNames;

for (const name of tabNames) {
  const before = markErr();
  const t0 = Date.now();
  let clicked = true;
  try {
    await page.locator('[role="dialog"]').locator(`button:has-text(${JSON.stringify(name)})`).first().click({ timeout: 8000 });
  } catch (e) { clicked = false; errs.push({ kind: 'clickfail', text: `${name}: ${e.message.slice(0, 120)}` }); }
  await page.waitForTimeout(2200);
  const panel = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return null;
    // 主内容区 = 对话框内去掉左侧 nav 之后的最大可见文本块
    const main = d.querySelector('[class*="content"],[class*="panel"],[class*="body"]') || d;
    const text = (main.textContent || '').trim();
    return { textLen: text.length, head: text.slice(0, 120), controls: main.querySelectorAll('button,input,select,[role="switch"]').length, usageCard: Boolean(d.querySelector('.du_root')) };
  });
  out.tabs.push({ name, clicked, ms: Date.now() - t0, newErrors: errs.length - before, panel });
  await page.screenshot({ path: `/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/r4-live-verify/raw/tab-${tabNames.indexOf(name) + 1}.png` }).catch(() => {});
}

// ══ B. 用量卡片普通挂载（无注入）══════════════════════════════════════════
const beforeCard = markErr();
await page.locator('[role="dialog"]').locator('button:has-text("插件")').first().click();
await page.waitForSelector('.du_root', { timeout: 25000 });
await page.waitForTimeout(6000); // 让 6 个并发调用 + 卡片首帧全部落地

out.card = { mounted: true, errorsAtMount: errs.length - beforeCard, snapshot: await readCard() };

// 筛选 1：range 7 → 30 → 90（仅本地 UI 状态）
const rangeIdx = 1; // 与既有探针一致：第 2 个 select 是范围
for (const value of ['30', '90', '7']) {
  const before = markErr(); const t0 = Date.now();
  const reqBefore = summaryReqs.length;
  await page.locator('.du_root select.du_select').nth(rangeIdx).selectOption(value).catch((e) => errs.push({ kind: 'rangefail', text: e.message.slice(0, 120) }));
  await page.waitForTimeout(3500);
  out.filters.push({
    kind: 'range', set: value, ms: Date.now() - t0, newUsageReqs: summaryReqs.slice(reqBefore).map((r) => ({ method: r.method, payload: r.payload })),
    newErrors: errs.length - before, card: await readCard(),
  });
}

// 筛选 2：dataSource all → dsh → cc
const srcSel = page.locator('.du_root select.du_select').nth(0);
const opts = await srcSel.evaluate((s) => Array.from(s.options).map((o) => o.value)).catch(() => []);
out.dataSourceOptions = opts;
for (const value of opts.filter((v) => v !== 'all').concat('all')) {
  const before = markErr(); const reqBefore = summaryReqs.length;
  await srcSel.selectOption(value).catch((e) => errs.push({ kind: 'srcfail', text: e.message.slice(0, 120) }));
  await page.waitForTimeout(3500);
  out.filters.push({
    kind: 'dataSource', set: value, newUsageReqs: summaryReqs.slice(reqBefore).map((r) => ({ method: r.method, payload: r.payload })),
    newErrors: errs.length - before, card: await readCard(),
  });
}

// 卡片内 tab（若存在）
const cardTabs = await page.locator('.du_root .du_tab').allTextContents().catch(() => []);
out.card.internalTabs = cardTabs;
for (const t of cardTabs.slice(0, 4)) {
  const before = markErr();
  await page.locator('.du_root .du_tab').filter({ hasText: t }).first().click().catch(() => {});
  await page.waitForTimeout(1200);
  out.filters.push({ kind: 'cardTab', set: t, newErrors: errs.length - before, tableRows: (await readCard())?.tableRows ?? null });
}

// 关闭设置，回到主界面
await page.keyboard.press('Escape').catch(() => {});
await page.waitForTimeout(1200);
await page.locator('[role="dialog"] button[aria-label*="关闭"], [role="dialog"] button:has-text("关闭")').first().click().catch(() => {});
await page.waitForTimeout(1500);

// ══ C. 子代理抽屉 ═════════════════════════════════════════════════════════
out.drawer = await page.evaluate(() => {
  const kw = ['子代理', 'subagent', 'Subagent', '代理', '任务队列', 'running'];
  const cands = [];
  for (const el of document.querySelectorAll('button,[role="button"],[aria-label],[title]')) {
    const t = `${el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.trim();
    if (kw.some((k) => t.includes(k))) cands.push({ tag: el.tagName, text: t.slice(0, 60), cls: String(el.className).slice(0, 60) });
  }
  return { candidates: cands.slice(0, 12), dialogsBefore: document.querySelectorAll('[role="dialog"],[role="complementary"],aside').length };
});
// 尝试点击第一个候选，看是否展开出面板/抽屉
const clickedDrawer = [];
for (const c of out.drawer.candidates.slice(0, 4)) {
  const before = markErr();
  const ok = await page.evaluate((needle) => {
    for (const el of document.querySelectorAll('button,[role="button"],[aria-label]')) {
      const t = `${el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.trim();
      if (t.startsWith(needle)) { el.click(); return true; }
    }
    return false;
  }, c.text).catch(() => false);
  await page.waitForTimeout(1800);
  const after = await page.evaluate(() => ({
    dialogs: document.querySelectorAll('[role="dialog"],[role="complementary"],aside').length,
    drawerish: Array.from(document.querySelectorAll('[class*="drawer"],[class*="Drawer"],[class*="panel"],[class*="Panel"]')).filter((e) => e.offsetHeight > 100).length,
    text: (document.body.textContent || '').length,
  }));
  clickedDrawer.push({ candidate: c.text, clicked: ok, newErrors: errs.length - before, after });
}
out.drawer.attempts = clickedDrawer;

out.errors = errs;
out.summary = {
  tabCount: out.tabs.length,
  tabsAllClicked: out.tabs.every((t) => t.clicked),
  tabsWithErrors: out.tabs.filter((t) => t.newErrors > 0).map((t) => t.name),
  tabsBlank: out.tabs.filter((t) => !t.panel || t.panel.textLen < 40).map((t) => t.name),
  totalErrors: errs.length,
  cardMounted: Boolean(out.card.snapshot),
  cardStatCount: out.card.snapshot?.statCount ?? null,
  cardHasErrorBox: Boolean(out.card.snapshot?.errorBox),
  usageReqCount: summaryReqs.length,
  distinctUsageMethods: [...new Set(summaryReqs.map((r) => r.method))],
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

console.log(`tabs=${out.summary.tabCount} allClicked=${out.summary.tabsAllClicked} errorsOnTabs=${JSON.stringify(out.summary.tabsWithErrors)} blank=${JSON.stringify(out.summary.tabsBlank)}`);
console.log(`card mounted=${out.summary.cardMounted} stats=${out.summary.cardStatCount} errorBox=${out.summary.cardHasErrorBox}`);
console.log(`usage methods seen: ${JSON.stringify(out.summary.distinctUsageMethods)} (${out.summary.usageReqCount} reqs)`);
console.log(`TOTAL errors=${out.summary.totalErrors}`);
if (errs.length) console.log('first errors:', JSON.stringify(errs.slice(0, 5), null, 1));
await browser.close();
