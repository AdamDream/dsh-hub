#!/usr/bin/env node
/**
 * explore-transport.mjs — 只读探查：用量卡片挂载时，RPC 走什么传输、URL/载荷形状如何。
 * 目的：决定「延迟旧批次 + 注入哨兵响应」这一类端到端测试能否在 Playwright 层做。
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const URL_BASE = 'http://127.0.0.1:3080';
const out = { at: new Date().toISOString(), requests: [], ws: [], card: null, stats: [], errors: [] };

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on('pageerror', (e) => out.errors.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') out.errors.push(m.text().slice(0, 200)); });
page.on('request', (r) => {
  const u = r.url();
  if (!/usage|rpc/i.test(u)) return;
  out.requests.push({ method: r.method(), url: u.replace(URL_BASE, ''), post: (r.postData() || '').slice(0, 200) });
});
page.on('websocket', (ws) => {
  out.ws.push({ url: ws.url().replace(URL_BASE, '') });
  ws.on('framesent', (f) => { const p = String(f.payload ?? ''); if (p.includes('usage')) out.ws.push({ sent: p.slice(0, 200) }); });
  ws.on('framereceived', (f) => { const p = String(f.payload ?? ''); if (p.includes('usage')) out.ws.push({ recv: p.slice(0, 200) }); });
});

await page.goto(URL_BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);
await page.locator('button:has-text("设置")').first().click().catch(() => {});
await page.waitForTimeout(2500);
await page.locator('[role="dialog"] button:has-text("插件"), [role="dialog"] [role="tab"]:has-text("插件"), button:has-text("插件")').first().click().catch(() => {});
await page.waitForTimeout(8000);

out.card = await page.evaluate(() => {
  const root = document.querySelector('.du_root');
  if (!root) return null;
  const stats = Array.from(root.querySelectorAll('.du_stat')).map((s) => ({
    label: s.querySelector('.du_statLabel')?.textContent ?? '',
    value: s.querySelector('.du_statValue')?.textContent ?? '',
  }));
  const selects = Array.from(root.querySelectorAll('select.du_select')).map((s) => ({
    value: s.value,
    options: Array.from(s.options).map((o) => o.textContent),
  }));
  return { statCount: stats.length, stats, selects, nodes: root.querySelectorAll('*').length };
});
out.stats = out.card?.stats ?? [];
writeFileSync('/home/CNS2026495165/dsh/.workspace/lag-fix/r4-delivery/explore-transport.json', JSON.stringify(out, null, 2) + '\n');
console.log('card mounted:', Boolean(out.card));
console.log('usage-ish requests:', out.requests.length, JSON.stringify(out.requests.slice(0, 6)));
console.log('ws frames with usage:', out.ws.filter((w) => w.sent || w.recv).length);
console.log('stats:', JSON.stringify(out.stats));
console.log('selects:', JSON.stringify(out.card?.selects?.slice(0, 3)));
console.log('errors:', out.errors.slice(0, 3));
await browser.close();
