// 量化：客户端镜像的会话规模、列表重建调用频率、空闲/设置页帧表现
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = '/home/CNS2026495165/dsh/.workspace/settings-lag';
const URL = 'http://127.0.0.1:3080';
const r3 = (x) => Math.round(x * 1000) / 1000;

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

  const calls = [];
  let sessionListShape = null;
  page.on('response', async (res) => {
    const u = res.url().replace(URL, '');
    if (!u.startsWith('/api/')) return;
    const t = Date.now();
    calls.push({ url: u, at: t });
    if (u.includes('session.list') && !sessionListShape) {
      try {
        const j = await res.json();
        const walk = (v, d = 0) => {
          if (d > 3 || v === null || typeof v !== 'object') return null;
          if (Array.isArray(v)) return { arrayLen: v.length, sample: v[0] ? Object.keys(v[0]).slice(0, 14) : [] };
          const o = {};
          for (const k of Object.keys(v).slice(0, 10)) o[k] = walk(v[k], d + 1);
          return o;
        };
        sessionListShape = { bytes: JSON.stringify(j).length, shape: walk(j) };
      } catch { }
    }
  });
  const metrics = async () => {
    const p = await cdp.send('Performance.getMetrics');
    const g = (n) => p.metrics.find((x) => x.name === n)?.value ?? null;
    return { script: g('ScriptDuration'), task: g('TaskDuration'), style: g('RecalcStyleDuration'), nodes: g('Nodes') };
  };
  const frameStats = async () => {
    const f = await page.evaluate(() => { const a = window.__frames || []; window.__frames = []; return a; });
    const d = f.slice(1).map((t, i) => t - f[i]).sort((a, b) => a - b);
    const q = (p) => (d.length ? r3(d[Math.min(d.length - 1, Math.floor(d.length * p))]) : null);
    return { frames: d.length, p50: q(.5), p95: q(.95), p99: q(.99), over50: d.filter((x) => x > 50).length, max: d.length ? r3(d[d.length - 1]) : null };
  };

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);

  const report = {};
  // A) 主界面空闲 20s
  let m0 = await metrics(); await frameStats();
  await page.waitForTimeout(20000);
  let m1 = await metrics();
  report.idle_main_20s = { script_ms: r3((m1.script - m0.script) * 1000), task_ms: r3((m1.task - m0.task) * 1000),
                           style_ms: r3((m1.style - m0.style) * 1000), frames: await frameStats() };

  // B) 打开设置
  const c0 = calls.length; m0 = await metrics(); await frameStats();
  await page.locator('button:has-text("设置")').first().click();
  await page.waitForTimeout(20000);
  m1 = await metrics();
  report.open_settings_20s = { script_ms: r3((m1.script - m0.script) * 1000), task_ms: r3((m1.task - m0.task) * 1000),
                               style_ms: r3((m1.style - m0.style) * 1000), frames: await frameStats(),
                               api_calls: calls.length - c0 };

  // C) 设置页停留再 20s
  m0 = await metrics(); await frameStats();
  await page.waitForTimeout(20000);
  m1 = await metrics();
  report.hold_settings_20s = { script_ms: r3((m1.script - m0.script) * 1000), task_ms: r3((m1.task - m0.task) * 1000),
                               style_ms: r3((m1.style - m0.style) * 1000), frames: await frameStats() };

  report.session_list = sessionListShape;
  const byUrl = {};
  for (const c of calls) byUrl[c.url] = (byUrl[c.url] || 0) + 1;
  report.api_call_counts = Object.entries(byUrl).sort((a, b) => b[1] - a[1]);
  report.dom_nodes = await page.evaluate(() => document.getElementsByTagName('*').length);
  report.heap_mb = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576 * 100) / 100 : null);

  fs.writeFileSync(`${OUT}/measure3.json`, JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
};
run().catch((e) => { console.error('FATAL', e); process.exit(1); });
