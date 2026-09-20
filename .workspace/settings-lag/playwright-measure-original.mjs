// 设置页卡顿实测：rAF 帧间隔 / 长任务 / 慢请求 / DOM 与堆规模
// 运行：cd ~/playwright_scratch && node /path/to/measure.mjs [--headful]
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = '/home/CNS2026495165/dsh/.workspace/settings-lag';
const URL = 'http://127.0.0.1:3080';
const HEADFUL = process.argv.includes('--headful');

const r3 = (x) => Math.round(x * 1000) / 1000;

async function snap(page, cdp, label) {
  // 帧间隔统计
  const frames = await page.evaluate(() => {
    const f = window.__frames || [];
    window.__frames = [];
    return f;
  });
  const deltas = frames.slice(1).map((t, i) => t - frames[i]).sort((a, b) => a - b);
  const pct = (p) => (deltas.length ? r3(deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * p))]) : null);
  const lt = await page.evaluate(() => {
    const l = window.__longtasks || [];
    window.__longtasks = [];
    return l;
  });
  const m = await cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify({
      nodes: document.getElementsByTagName('*').length,
      heap: performance.memory ? performance.memory.usedJSHeapSize : null,
      listeners: performance.memory ? null : null
    })`,
    returnByValue: true,
  });
  const info = JSON.parse(m.result.value);
  const perf = await cdp.send('Performance.getMetrics');
  const pick = (n) => perf.metrics.find((x) => x.name === n)?.value ?? null;
  return {
    label,
    frames: deltas.length,
    frame_p50: pct(0.5), frame_p95: pct(0.95), frame_max: deltas.length ? r3(deltas[deltas.length - 1]) : null,
    janky_frames_over_50ms: deltas.filter((d) => d > 50).length,
    longtasks: lt.length, longtask_total_ms: r3(lt.reduce((a, b) => a + b.duration, 0)),
    longtask_max_ms: lt.length ? r3(Math.max(...lt.map((b) => b.duration))) : 0,
    dom_nodes: info.nodes, js_heap_mb: info.heap ? r3(info.heap / 1048576) : null,
    cdp_TaskDuration: pick('TaskDuration'), cdp_ScriptDuration: pick('ScriptDuration'),
    cdp_LayoutDuration: pick('LayoutDuration'), cdp_RecalcStyleDuration: pick('RecalcStyleDuration'),
    cdp_JSEventListeners: pick('JSEventListeners'), cdp_Nodes: pick('Nodes'),
  };
}

const run = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    headless: !HEADFUL,
    args: ['--enable-precise-memory-info', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.addInitScript(() => {
    window.__frames = []; window.__longtasks = [];
    requestAnimationFrame(function loop(t) { window.__frames.push(t); requestAnimationFrame(loop); });
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longtasks.push({ duration: e.duration, start: e.startTime }); })
        .observe({ entryTypes: ['longtask'] });
    } catch { }
  });

  const reqs = [];
  page.on('requestfinished', async (r) => {
    try {
      const t = r.timing();
      const dur = t.responseEnd - t.requestStart;
      if (dur > 120) reqs.push({ url: r.url().replace('http://127.0.0.1:3080', ''), method: r.method(), ms: r3(dur) });
    } catch { }
  });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e).slice(0, 200)));

  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  const boot = { ms_to_dom: Date.now() - t0, title: await page.title() };
  const baseline = await snap(page, cdp, 'baseline(主界面)');
  await page.screenshot({ path: `${OUT}/shot-1-main.png` });

  // 寻找设置入口
  const cands = [
    '[aria-label*="设置"]', '[title*="设置"]', 'button:has-text("设置")', 'a:has-text("设置")',
    '[aria-label*="Settings" i]', '[title*="Settings" i]', 'button:has-text("Settings")',
    '[data-testid*="setting" i]', '[class*="settings" i]', 'a[href*="setting" i]',
  ];
  let clicked = null;
  for (const sel of cands) {
    const loc = page.locator(sel).first();
    const n = await page.locator(sel).count();
    if (n > 0) {
      try { await loc.click({ timeout: 3000 }); clicked = sel; break; } catch { }
    }
  }
  await page.waitForTimeout(12000);
  const after = await snap(page, cdp, 'after-open-settings');
  await page.screenshot({ path: `${OUT}/shot-2-settings.png`, fullPage: false });

  // 再等一段，观察是否持续卡顿（轮询/泄漏）
  await page.waitForTimeout(15000);
  const later = await snap(page, cdp, 'settings+27s');
  await page.screenshot({ path: `${OUT}/shot-3-settings-later.png` });

  const report = { boot, clicked_selector: clicked, baseline, after, later, slow_requests: reqs.sort((a, b) => b.ms - a.ms).slice(0, 25), console_errors: errs.slice(0, 15) };
  fs.writeFileSync(`${OUT}/measure.json`, JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
};

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
