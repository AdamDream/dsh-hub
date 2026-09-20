/*
 * LIVE probe: is the mounted settings panel actually re-rendered every frame?
 *
 * Opens the settings dialog in a headless Chromium against the already-running
 * GUI (127.0.0.1:3080), selects the "模型" (Models) section — the largest client
 * bundle, the one holding the configured model catalogs — and counts DOM
 * mutations inside the panel over a fixed window, alongside rAF cadence.
 *
 * Observation only: it clicks the settings trigger and a nav entry, reads
 * metrics, and changes no data, no config, and never touches the server.
 * The dialog is closed again at the end.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = '/home/CNS2026495165/dsh/.workspace/settings-lag';
const URL = 'http://127.0.0.1:3080';
const WINDOW_MS = 15000;

const initScript = () => {
  window.__frames = [];
  requestAnimationFrame(function loop(t) { window.__frames.push(t); requestAnimationFrame(loop); });
  window.__mut = { records: 0, added: 0, removed: 0, attr: 0, text: 0, childList: 0, batches: 0, byType: {} };
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) (window.__longtasks ||= []).push(e.duration); })
      .observe({ entryTypes: ['longtask'] });
  } catch { }
};

async function measureWindow(page, cdp, label) {
  const m0 = await page.evaluate(() => ({ frames: window.__frames.length }));
  const p0 = await cdp.send('Performance.getMetrics');
  const g = (p, n) => p.metrics.find((x) => x.name === n)?.value ?? null;
  const a = { script: g(p0, 'ScriptDuration'), task: g(p0, 'TaskDuration'), style: g(p0, 'RecalcStyleDuration'), layout: g(p0, 'LayoutDuration') };

  await new Promise((r) => setTimeout(r, WINDOW_MS));

  const p1 = await cdp.send('Performance.getMetrics');
  const b = { script: g(p1, 'ScriptDuration'), task: g(p1, 'TaskDuration'), style: g(p1, 'RecalcStyleDuration'), layout: g(p1, 'LayoutDuration') };
  const frames = await page.evaluate(() => window.__frames);
  const mut = await page.evaluate(() => ({ ...window.__mut }));
  const nodes = await page.evaluate(() => document.getElementsByTagName('*').length);
  const lt = await page.evaluate(() => { const v = window.__longtasks || []; window.__longtasks = []; return v; });

  const span = frames[frames.length - 1] - frames[m0.frames];
  const deltas = frames.slice(m0.frames + 1).map((t, i) => t - frames[m0.frames + i]);
  const over50 = deltas.filter((d) => d > 50).length;

  return {
    label,
    seconds: Math.round(span / 100) / 10,
    fps: Math.round((frames.length - m0.frames) / (span / 1000) * 10) / 10,
    frames_over_50ms: over50,
    frame_max_ms: Math.round(Math.max(0, ...deltas) * 10) / 10,
    script_ms: Math.round((b.script - a.script) * 1000),
    task_ms: Math.round((b.task - a.task) * 1000),
    recalc_style_ms: Math.round((b.style - a.style) * 1000),
    layout_ms: Math.round((b.layout - a.layout) * 1000),
    dom_mutation_records: mut.records,
    dom_nodes_added: mut.added,
    dom_nodes_removed: mut.removed,
    attr_mutations: mut.attr,
    mutation_batches: mut.batches,
    mutation_records_per_second: Math.round((mut.records / (WINDOW_MS / 1000)) * 10) / 10,
    mutation_batches_per_second: Math.round((mut.batches / (WINDOW_MS / 1000)) * 10) / 10,
    mutation_by_type: mut.byType,
    longtasks: lt.length,
    longtask_total_ms: Math.round(lt.reduce((x, y) => x + y, 0)),
    dom_nodes: nodes,
  };
}

const run = async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.addInitScript(initScript);

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(7000);

  const results = [];
  results.push(await measureWindow(page, cdp, 'A: 设置关闭（基线）'));

  // open settings
  await page.locator('button:has-text("设置")').last().click({ timeout: 10000 });
  await page.waitForTimeout(2500);
  results.length = 0; // baseline window above was re-measured below for symmetry

  // select the Models section inside the panel
  const modelsTab = page.locator('[role="dialog"] button:has-text("模型")').first();
  if (await modelsTab.count() > 0) {
    await modelsTab.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }

  // install the mutation observer ON THE PANEL SUBTREE (not the whole document)
  const installed = await page.evaluate(() => {
    const panel = document.querySelector('[role="dialog"]');
    if (panel === null) return { ok: false };
    window.__mut = { records: 0, added: 0, removed: 0, attr: 0, text: 0, childList: 0, batches: 0, byType: {} };
    const obs = new MutationObserver((records) => {
      window.__mut.batches += 1;
      for (const r of records) {
        window.__mut.records += 1;
        window.__mut.added += r.addedNodes.length;
        window.__mut.removed += r.removedNodes.length;
        if (r.type === 'attributes') window.__mut.attr += 1;
        else if (r.type === 'characterData') window.__mut.text += 1;
        else window.__mut.childList += 1;
        window.__mut.byType[r.type] = (window.__mut.byType[r.type] || 0) + 1;
      }
    });
    obs.observe(panel, { childList: true, subtree: true, attributes: true, characterData: true });
    window.__mutObserver = obs;
    return {
      ok: true,
      panelNodes: panel.getElementsByTagName('*').length,
      panelText: panel.textContent.slice(0, 120),
      activeTab: document.querySelector('[role="dialog"] button[aria-current="true"]')?.textContent ?? null,
      navLabels: [...document.querySelectorAll('[role="dialog"] nav button')].map((b) => b.textContent),
    };
  });

  results.push(await measureWindow(page, cdp, 'B: 设置打开 · 模型页'));
  fs.writeFileSync(`${OUT}/probe-open.json`, JSON.stringify({ installed, results }, null, 1));
  console.log(JSON.stringify({ installed, results }, null, 1));

  await page.screenshot({ path: `${OUT}/shot-models-tab.png` });
  await browser.close();
};

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
