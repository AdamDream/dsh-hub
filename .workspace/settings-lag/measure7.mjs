// 聚焦验证 M1：usage RPC 逐个耗时 + 宿主事件循环停顿频率（含 30s 轮询）
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
  const reqs = [];
  page.on('requestfinished', async (r) => {
    const u = r.url().replace(URL, '');
    if (u.startsWith('/api/host.describe')) return;
    let ms = null;
    try { const t = r.timing(); ms = r1(t.responseEnd - t.requestStart); } catch { }
    reqs.push({ url: u, method: r.method(), ms });
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);
  const report = {};
  report.baseline_probe = await page.evaluate(probe, { n: 10, gap: 300 });

  reqs.length = 0;
  await page.locator('button:has-text("设置")').first().click();
  await page.waitForTimeout(6000);
  report.after_open_settings_reqs = reqs.slice();

  reqs.length = 0;
  await page.locator('[role="dialog"] button:has-text("插件"), [role="dialog"] [role="tab"]:has-text("插件")').first().click().catch(() => { });
  // 覆盖 30s 轮询周期：边点开边持续探测宿主延迟
  const during = await page.evaluate(probe, { n: 150, gap: 300 });  // ≈45s
  report.plugins_tab = {
    reqs: reqs.slice(),
    host_latency_during_45s: {
      n: during.length,
      median: during.slice().sort((a, b) => a - b)[Math.floor(during.length / 2)],
      p95: during.slice().sort((a, b) => a - b)[Math.floor(during.length * 0.95)],
      max: Math.max(...during),
      stalls_over_100ms: during.filter((x) => x > 100),
      stalls_over_300ms: during.filter((x) => x > 300),
    },
  };

  fs.writeFileSync(`${OUT}/measure7.json`, JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
};
run().catch((e) => { console.error('FATAL', e); process.exit(1); });
