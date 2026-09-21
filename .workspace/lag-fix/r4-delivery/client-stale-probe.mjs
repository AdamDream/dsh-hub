#!/usr/bin/env node
/**
 * client-stale-probe.mjs — 用量卡片「旧响应覆盖新筛选」的真实浏览器端到端判定（只读）
 *
 * 机制：把两条批次的 summary 响应改写成不同哨兵值 ——
 *   批次 A（挂载时，rangeDays=7）：**延迟 6s** 才交付，哨兵 requests=111111
 *   批次 B（切换 rangeDays=30 触发）：立即交付，哨兵 requests=222222
 * 若卡片最终显示 111111，说明晚到的 A 覆盖了先到的 B（即 R4 要修的缺陷）。
 * 轮询记录整条时间线，避免只看终值。
 *
 * 用法：node client-stale-probe.mjs --label before|after
 * 纪律：除「切换范围下拉」（仅本地 UI 状态，不落库、不 ingest）外不点击任何写状态按钮；
 *       不调用 /usage/refresh；不修改配置。
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const label = (() => { const i = process.argv.indexOf('--label'); return i === -1 ? 'run' : process.argv[i + 1]; })();
const URL_BASE = 'http://127.0.0.1:3080';
const SENTINEL_A = 111111;
const SENTINEL_B = 222222;
const DELAY_A_MS = 6000;

const out = { label, at: new Date().toISOString(), timeline: [], summaryBatches: [], errors: [], verdict: 'PENDING' };

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on('pageerror', (e) => out.errors.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') out.errors.push(m.text().slice(0, 200)); });

let summaryCount = 0;
await page.route('**/usage/summary', async (route) => {
  summaryCount += 1;
  const index = summaryCount;
  const isBatchA = index === 1;
  const sentinel = isBatchA ? SENTINEL_A : SENTINEL_B;
  const payload = (() => { try { return JSON.parse(route.request().postData() || '{}').payload; } catch { return null; } })();
  out.summaryBatches.push({ index, sentinel, payload, at: Date.now() });
  if (isBatchA) await new Promise((r) => setTimeout(r, DELAY_A_MS));
  const response = await route.fetch();
  const json = await response.json();
  if (json?.result?.value) json.result.value.requests = sentinel;
  await route.fulfill({ json });
});

const readReqStat = () => page.evaluate(() => {
  const stats = Array.from(document.querySelectorAll('.du_root .du_stat'));
  for (const s of stats) {
    if ((s.querySelector('.du_statLabel')?.textContent ?? '').includes('请求数')) {
      return s.querySelector('.du_statValue')?.textContent ?? null;
    }
  }
  return null;
});

await page.goto(URL_BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);
await page.locator('button:has-text("设置")').first().click().catch(() => {});
await page.waitForTimeout(2500);
await page.locator('[role="dialog"] button:has-text("插件"), [role="dialog"] [role="tab"]:has-text("插件"), button:has-text("插件")').first().click().catch(() => {});
// 等卡片挂载（批次 A 的 summary 已被拦截并在延迟中）
await page.waitForSelector('.du_root', { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1200);

// 触发批次 B：切到「近 30 天」（仅本地 UI 状态）
const rangeSelect = page.locator('.du_root select.du_select').nth(1);
await rangeSelect.selectOption('30').catch((e) => out.errors.push('range switch failed: ' + e.message));

// 轮询整条时间线直到 A 落地
const start = Date.now();
while (Date.now() - start < 14000) {
  const value = await readReqStat();
  const t = Date.now() - start;
  const last = out.timeline[out.timeline.length - 1];
  if (!last || last.value !== value) out.timeline.push({ tMs: t, value });
  await page.waitForTimeout(300);
}

const values = out.timeline.map((x) => x.value);
const sawB = values.includes(String(SENTINEL_B));
const sawA = values.includes(String(SENTINEL_A));
const finalValue = values[values.length - 1];
out.summaryRequests = summaryCount;
out.sawSentinelA = sawA;
out.sawSentinelB = sawB;
out.finalValue = finalValue;
// PASS = 旧批次 A 从未覆盖新批次 B 的结果（A 的哨兵不得出现在终值上）
out.verdict = sawB && finalValue === String(SENTINEL_B) ? 'PASS' : (sawA || finalValue === String(SENTINEL_A)) ? 'FAIL_STALE_OVERWRITE' : 'INCONCLUSIVE';

writeFileSync(`/home/CNS2026495165/dsh/.workspace/lag-fix/r4-delivery/client-stale-${label}.json`, JSON.stringify(out, null, 2) + '\n');
console.log(`[${label}] summary 请求数=${summaryCount}  批次哨兵=${JSON.stringify(out.summaryBatches.map((b) => b.sentinel))}`);
console.log(`[${label}] 时间线=${JSON.stringify(out.timeline)}`);
console.log(`[${label}] 终值=${finalValue}  见到A=${sawA} 见到B=${sawB}`);
console.log(`[${label}] 裁决=${out.verdict}  errors=${out.errors.length}`);
await browser.close();
process.exit(out.verdict === 'PASS' ? 0 : out.verdict === 'INCONCLUSIVE' ? 2 : 1);
