// 决定性问题：离开"插件"标签后，usage 卡片是否仍挂载并每 30s 轮询（宿主持续停顿？）
import { chromium } from 'playwright';
import fs from 'node:fs';
const OUT = '/home/CNS2026495165/dsh/.workspace/settings-lag';
const URL = 'http://127.0.0.1:3080';
const r1 = (x) => Math.round(x * 10) / 10;

const probe = async (o) => {
  const rr = (x) => Math.round(x * 10) / 10;
  const out = [];
  for (let i = 0; i < o.n; i++) {
    const t0 = performance.now();
    try { await fetch(location.origin + '/api/host.describe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); } catch { }
    out.push(rr(performance.now() - t0));
    await new Promise((r) => setTimeout(r, o.gap ?? 300));
  }
  return out;
};

const run = async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const usage = [];
  page.on('requestfinished', async (r) => {
    const u = r.url().replace(URL, '');
    if (!u.startsWith('/usage')) return;
    let ms = null;
    try { const t = r.timing(); ms = r1(t.responseEnd - t.requestStart); } catch { }
    usage.push({ url: u, ms, at: r1((Date.now() - t0) / 1000) });
  });
  const t0 = Date.now();
  const report = {};

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.locator('button:has-text("设置")').first().click();
  await page.waitForTimeout(3000);
  report.open_default_tab_usage_calls = usage.length;      // 默认标签是否挂载 usage 卡片

  usage.length = 0;
  await page.locator('[role="dialog"] button:has-text("插件"), [role="dialog"] [role="tab"]:has-text("插件")').first().click().catch(() => { });
  await page.waitForTimeout(4000);
  report.plugins_tab_usage_calls = usage.length;
  report.plugins_tab_usage_ms = usage.map((u) => `${u.url}:${u.ms}ms`);

  // 离开插件标签 -> 通用设置，然后观测 75s（覆盖 2 个 30s 轮询周期）
  usage.length = 0;
  await page.locator('[role="dialog"] button:has-text("通用设置")').first().click().catch(() => { });
  const during = await page.evaluate(probe, { n: 250, gap: 300 });   // ≈75s
  const sorted = during.slice().sort((a, b) => a - b);
  report.after_leaving_plugins_tab_75s = {
    usage_calls: usage.length,
    usage_detail: usage.map((u) => `${u.at}s ${u.url}:${u.ms}ms`),
    host_latency: { n: during.length, median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * .95)],
                    max: Math.max(...during), stalls_over_100ms: during.filter((x) => x > 100) },
  };

  // 关闭设置后 40s
  usage.length = 0;
  await page.locator('[role="dialog"] button:has-text("关闭"), [role="dialog"] button[aria-label*="关闭"]').first().click().catch(() => { });
  const after = await page.evaluate(probe, { n: 130, gap: 300 });
  const s2 = after.slice().sort((a, b) => a - b);
  report.after_closing_settings_40s = {
    usage_calls: usage.length,
    host_latency: { median: s2[Math.floor(s2.length / 2)], max: Math.max(...after), stalls_over_100ms: after.filter((x) => x > 100) },
  };

  fs.writeFileSync(`${OUT}/measure8.json`, JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
};
run().catch((e) => { console.error('FATAL', e); process.exit(1); });
