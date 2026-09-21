#!/usr/bin/env node
/** explore-gui.mjs — 只读探查设置页结构（标签名、子代理抽屉入口、用量卡片选择器）。 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:3080';
const out = { at: new Date().toISOString(), steps: [], errors: [] };
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
page.on('pageerror', (e) => out.errors.push('pageerror: ' + String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') out.errors.push('console: ' + m.text().slice(0, 200)); });

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(7000);

out.steps.push({ name: 'initial buttons', buttons: await page.evaluate(() => Array.from(document.querySelectorAll('button')).map((b) => (b.textContent || '').trim().slice(0, 24)).filter(Boolean).slice(0, 40)) });

// 打开设置
await page.locator('button:has-text("设置")').first().click().catch((e) => out.errors.push('settings click: ' + e.message));
await page.waitForTimeout(3000);

out.steps.push({ name: 'after settings', dialogs: await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"]')).map((d) => ({ cls: d.className?.slice?.(0, 80), tabs: Array.from(d.querySelectorAll('[role="tab"]')).map((t) => (t.textContent || '').trim().slice(0, 20)), buttons: Array.from(d.querySelectorAll('button')).map((b) => (b.textContent || '').trim().slice(0, 20)).filter(Boolean).slice(0, 30) }))) });

out.steps.push({ name: 'tabbables', tabbables: await page.evaluate(() => Array.from(document.querySelectorAll('[role="tab"],[role="tablist"] *')).map((t) => ({ role: t.getAttribute('role'), text: (t.textContent || '').trim().slice(0, 20), id: (t.id || '').slice(0, 30) })).slice(0, 30)) });

// 全部可见文本里找「插件」
out.steps.push({ name: 'plugin entry', matches: await page.evaluate(() => {
  const hits = [];
  for (const el of document.querySelectorAll('*')) {
    const t = (el.textContent || '').trim();
    if (t === '插件' && el.children.length === 0) hits.push({ tag: el.tagName, cls: el.className?.slice?.(0, 60), parentRole: el.parentElement?.getAttribute('role') });
  }
  return hits.slice(0, 10);
}) });

// 找子代理抽屉入口
out.steps.push({ name: 'drawer entries', drawer: await page.evaluate(() => {
  const kw = ['子代理', 'subagent', '抽屉', '任务'];
  const hits = [];
  for (const el of document.querySelectorAll('button,[role="button"],[aria-label]')) {
    const t = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')).trim();
    if (kw.some((k) => t.toLowerCase().includes(k.toLowerCase()))) hits.push({ tag: el.tagName, text: t.slice(0, 40), aria: el.getAttribute('aria-label'), cls: el.className?.slice?.(0, 50) });
  }
  return hits.slice(0, 15);
}) });

// 设置页标签列表（用对话框内的 tablist）
await page.locator('[role="dialog"]').first().waitFor({ timeout: 10000 }).catch(() => {});
out.steps.push({ name: 'dialog tabs (all)', tabs: await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  if (!d) return null;
  return Array.from(d.querySelectorAll('[role="tab"], nav button, [role="tablist"] button')).map((t) => (t.textContent || '').trim().slice(0, 24)).filter(Boolean);
}) });

writeFileSync('/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/r4-live-verify/raw/explore-gui.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2).slice(0, 4000));
await browser.close();
