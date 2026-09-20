// 设置页卡顿归因：CDP CPU profile（按自身耗时排序）+ 逐标签页计时
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = '/home/CNS2026495165/dsh/.workspace/settings-lag';
const URL = 'http://127.0.0.1:3080';
const r3 = (x) => Math.round(x * 1000) / 1000;

const topFunctions = (profile, n = 25) => {
  const byId = new Map(profile.nodes.map((x) => [x.id, x]));
  const self = new Map();
  const dt = (profile.endTime - profile.startTime) / 1000; // us -> ms
  const total = profile.samples.length;
  const counts = new Map();
  for (const id of profile.samples) counts.set(id, (counts.get(id) || 0) + 1);
  for (const [id, c] of counts) {
    const node = byId.get(id); if (!node) continue;
    const cf = node.callFrame;
    const key = `${cf.functionName || '(anonymous)'} @ ${(cf.url || '').replace('http://127.0.0.1:3080', '').slice(-70)}:${cf.lineNumber}`;
    self.set(key, (self.get(key) || 0) + c * dt);
  }
  return [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k, v]) => ({ fn: k, sample_ms: r3(v), pct: r3((v / (total * dt)) * 100) }));
};

const metrics = async (cdp) => {
  const p = await cdp.send('Performance.getMetrics');
  const g = (n) => p.metrics.find((x) => x.name === n)?.value ?? null;
  return { script: g('ScriptDuration'), task: g('TaskDuration'), style: g('RecalcStyleDuration'), layout: g('LayoutDuration') };
};

const run = async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-precise-memory-info', '--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Profiler.enable');
  await page.addInitScript(() => {
    window.__frames = [];
    requestAnimationFrame(function loop(t) { window.__frames.push(t); requestAnimationFrame(loop); });
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);

  const frameStats = async () => {
    const f = await page.evaluate(() => { const a = window.__frames || []; window.__frames = []; return a; });
    const d = f.slice(1).map((t, i) => t - f[i]).sort((a, b) => a - b);
    return { frames: d.length, p50: d.length ? r3(d[Math.floor(d.length * .5)]) : null,
             p95: d.length ? r3(d[Math.floor(d.length * .95)]) : null,
             over50: d.filter((x) => x > 50).length,
             max: d.length ? r3(d[d.length - 1]) : null };
  };

  const report = { steps: [] };

  // 1) 打开设置 + CPU profile
  await cdp.send('Profiler.start');
  const m0 = await metrics(cdp);
  await page.locator('button:has-text("设置")').first().click();
  await page.waitForTimeout(9000);
  const m1 = await metrics(cdp);
  const { profile } = await cdp.send('Profiler.stop');
  const fr_open = await frameStats();
  report.open_settings = {
    script_ms: r3((m1.script - m0.script) * 1000), task_ms: r3((m1.task - m0.task) * 1000),
    style_ms: r3((m1.style - m0.style) * 1000), layout_ms: r3((m1.layout - m0.layout) * 1000),
    frames: fr_open, profile_ms: r3((profile.endTime - profile.startTime) / 1000),
    sample_interval_note: 'sample_ms = 采样数 × 采样周期',
    top_functions: topFunctions(profile, 25),
  };

  // 2) 枚举设置面板内的标签/导航项
  const tabs = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]') || document.body;
    const out = [];
    for (const el of dialog.querySelectorAll('button,[role="tab"],a,[role="menuitem"]')) {
      const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
      if (t && t.length <= 24) out.push(t);
    }
    return [...new Set(out)];
  });
  report.settings_tab_labels = tabs;

  // 3) 逐个标签页计时
  for (const t of tabs.slice(0, 14)) {
    try {
      const sel = `[role="dialog"] button:has-text(${JSON.stringify(t)}), [role="dialog"] [role="tab"]:has-text(${JSON.stringify(t)})`;
      const loc = page.locator(sel).first();
      if (await loc.count() === 0) { report.steps.push({ tab: t, skipped: 'not found' }); continue; }
      const a = await metrics(cdp); await frameStats();  // 清空帧窗口
      await loc.click({ timeout: 3000 });
      await page.waitForTimeout(4000);
      const b = await metrics(cdp);
      const fr = await frameStats();
      report.steps.push({ tab: t, script_ms: r3((b.script - a.script) * 1000), task_ms: r3((b.task - a.task) * 1000),
                          style_ms: r3((b.style - a.style) * 1000), frames: fr,
                          nodes: await page.evaluate(() => document.getElementsByTagName('*').length) });
    } catch (e) { report.steps.push({ tab: t, error: String(e).slice(0, 120) }); }
  }

  await page.screenshot({ path: `${OUT}/shot-4-tabs.png` });
  fs.writeFileSync(`${OUT}/measure2.json`, JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
};
run().catch((e) => { console.error('FATAL', e); process.exit(1); });
