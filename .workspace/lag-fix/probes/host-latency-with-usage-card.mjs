// 宿主侧门槛的匹配探针：挂载用量卡片（触发同步 SQLite 查询）并同时探测宿主延迟
// 用法: node probes/host-latency-with-usage-card.mjs --out <json> [--seconds 40] [--no-card]
// 判读: 停机次数（>100ms）与中位数；mounted=true 时才与"用量卡片触发"相关
import { chromium } from 'playwright';
import fs from 'node:fs';
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const OUT = arg('--out', '/tmp/host-latency-card.json');
const SECONDS = Number(arg('--seconds', '40'));
const MOUNT_CARD = !process.argv.includes('--no-card');
const URL = 'http://127.0.0.1:3080';
const rr = (x) => Math.round(x * 10) / 10;

const probe = async (o) => {
  const out = [];
  const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < o.seconds) {
    const a = performance.now();
    try { await fetch(location.origin + '/api/host.describe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); } catch { }
    out.push(Math.round((performance.now() - a) * 10) / 10);
    await new Promise((r) => setTimeout(r, 250));
  }
  return out;
};

const b = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const usage = [];
p.on('requestfinished', async (r) => {
  const u = r.url().replace(URL, '');
  if (!u.startsWith('/usage')) return;
  let ms = null; try { const t = r.timing(); ms = rr(t.responseEnd - t.requestStart); } catch { }
  usage.push(`${u}:${ms}ms`);
});
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await p.waitForTimeout(7000);

let mounted = false;
if (MOUNT_CARD) {
  await p.locator('button:has-text("设置")').first().click().catch(() => { });
  await p.waitForTimeout(2500);
  await p.locator('[role="dialog"] button:has-text("插件"), [role="dialog"] [role="tab"]:has-text("插件")').first().click().catch(() => { });
  await p.waitForTimeout(4000);
  mounted = await p.evaluate(() => document.body.innerText.includes('用量') || document.body.innerText.includes('Usage'));
}

const before = usage.length;
const samples = await p.evaluate(probe, { seconds: SECONDS });
const sorted = samples.slice().sort((a, b) => a - b);
const q = (x) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * x))];
const res = {
  mounted_usage_card: mounted,
  seconds: SECONDS,
  n: samples.length,
  median_ms: q(0.5), p95_ms: q(0.95), p99_ms: q(0.99), max_ms: sorted[sorted.length - 1],
  stalls_over_100ms: samples.filter((s) => s > 100).length,
  stalls_over_300ms: samples.filter((s) => s > 300).length,
  stalls_sample: samples.filter((s) => s > 100).slice(0, 10),
  usage_rpc_during_window: usage.slice(before),
  usage_rpc_total: usage.length,
};
fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
await b.close();
