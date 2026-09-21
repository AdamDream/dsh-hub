import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const RAW = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/model-tab/raw';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => process.stderr.write(a.join(' ') + '\n');
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  await page.addInitScript({ path: '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/model-tab/lib/init3.js' });
  await page.goto('http://127.0.0.1:3080', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.getElementsByTagName('*').length > 200, null, { timeout: 60000 });
  await page.locator('button, [role="button"], a').filter({ hasText: /^设置$/ }).first().click({ timeout: 20000 });
  await page.waitForFunction(() => !!document.querySelector('[role="dialog"] nav'), null, { timeout: 30000 });
  await page.locator('[role="dialog"] nav button').filter({ hasText: '模型' }).first().click({ timeout: 20000 });
  await sleep(6000);
  const diag = await page.evaluate(() => window.__MT3.diagNow());
  const commits = await page.evaluate(() => ({ total: window.__MT3.commitsTotal, hooks: window.__MT3.hookInstalled, list: window.__MT3.commits.slice(0, 10) }));
  fs.writeFileSync(RAW + '/fiber-diag.json', JSON.stringify({ diag, commits }, null, 1));
  log('DIAG', JSON.stringify(diag, null, 1));
  log('COMMITS', JSON.stringify(commits, null, 1));
  await ctx.close();
} catch (e) { log('THREW', String(e && e.stack || e).slice(0, 400)); }
finally { try { if (browser) await browser.close(); } catch (e) { } }
