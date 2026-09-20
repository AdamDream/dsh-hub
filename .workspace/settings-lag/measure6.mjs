// 验证宿主侧假设：设置页"插件"标签挂载 usage 卡片 → 8 个同步 SQLite RPC 阻塞宿主主线程
// 观测量：/usage/* 各请求耗时、客户端最大帧间隔（冻结时长）、并发侧其它 API 的延迟（宿主事件循环阻塞证据）
import { chromium } from 'playwright';
import fs from 'node:fs';
const OUT = '/home/CNS2026495165/dsh/.workspace/settings-lag';
const URL = 'http://127.0.0.1:3080';
const r1 = (x) => Math.round(x * 10) / 10;

const probeHostLatency = async (o) => {
  const { label, n } = o;
  const rr = (x) => Math.round(x * 10) / 10;
  const out = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    try {
      await fetch(location.origin + '/api/host.describe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    } catch { }
    out.push(rr(performance.now() - t0));
    if (n > 1) await new Promise((r) => setTimeout(r, 120));
  }
  return { label, ms: out, max: Math.max(...out), median: out.slice().sort((a, b) => a - b)[Math.floor(out.length / 2)] };
};

const run = async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.addInitScript(() => {
    window.__frames = [];
    requestAnimationFrame(function loop(t) { window.__frames.push(t); requestAnimationFrame(loop); });
  });

  const usage = [], allApi = [];
  page.on('requestfinished', async (r) => {
    const u = r.url().replace(URL, '');
    if (!u.startsWith('/api/')) return;
    let ms = null;
    try { const t = r.timing(); ms = r1(t.responseEnd - t.requestStart); } catch { }
    allApi.push({ url: u, ms });
    if (u.includes('/usage')) usage.push({ url: u, ms });
  });

  const script = async () => { const p = await cdp.send('Performance.getMetrics'); return (p.metrics.find((x) => x.name === 'ScriptDuration')?.value ?? 0) * 1000; };
  const gaps = async () => {
    const f = await page.evaluate(() => { const a = window.__frames || []; window.__frames = []; return a; });
    const d = f.slice(1).map((t, i) => t - f[i]);
    const s = d.slice().sort((a, b) => a - b);
    const q = (p) => (s.length ? r1(s[Math.min(s.length - 1, Math.floor(s.length * p))]) : null);
    return { frames: d.length, p50: q(.5), p99: q(.99), over50: d.filter((x) => x > 50).length, over200: d.filter((x) => x > 200).length, max: s.length ? r1(s[s.length - 1]) : null };
  };

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);
  const report = {};

  // 基线：宿主延迟（无设置页）
  report.host_latency_baseline = await page.evaluate(probeHostLatency, { label: 'baseline', n: 6 });

  // 打开设置（默认标签）
  usage.length = 0; allApi.length = 0;
  let s0 = await script(); await gaps();
  await page.locator('button:has-text("设置")').first().click();
  await page.waitForTimeout(8000);
  report.open_default_tab = { script_ms: r1((await script()) - s0), gaps: await gaps(), usage_calls: usage.length, api_calls: allApi.length };

  // 点"插件"标签
  usage.length = 0; allApi.length = 0;
  const hostDuring = [];
  s0 = await script(); await gaps();
  const t0 = Date.now();
  await page.locator('[role="dialog"] button:has-text("插件"), [role="dialog"] [role="tab"]:has-text("插件")').first().click().catch(() => { });
  // 并发探测宿主延迟（在 usage 风暴期间）
  for (let i = 0; i < 8; i++) { hostDuring.push(await page.evaluate(probeHostLatency, { label: 'during', n: 1 })); await page.waitForTimeout(150); }
  await page.waitForTimeout(6000);
  report.plugins_tab = {
    elapsed_s: r1((Date.now() - t0) / 1000), script_ms: r1((await script()) - s0), gaps: await gaps(),
    usage_calls: usage.slice(), api_calls: allApi.length,
    host_latency_during: { ms: hostDuring.map((h) => h.ms[0]), max: Math.max(...hostDuring.map((h) => h.ms[0])) },
  };

  // 再点回"通用设置"，看 usage 是否仍在轮询
  usage.length = 0; allApi.length = 0;
  await page.locator('[role="dialog"] button:has-text("通用设置")').first().click().catch(() => { });
  await page.waitForTimeout(35000);   // 覆盖 30s 轮询周期
  report.after_leave_plugins_35s = { usage_calls: usage.slice(), api_calls: allApi.length };

  fs.writeFileSync(`${OUT}/measure6.json`, JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
};
run().catch((e) => { console.error('FATAL', e); process.exit(1); });
