/*
 * LIVE probe 2: where does the 100 ms/s of script time actually go while the
 * settings panel is open?
 *
 * Counts (a) WebSocket frames arriving from the host, and (b) DOM mutations in
 * the whole document split by region — the settings dialog subtree versus
 * everything behind it — plus the sidebar/workspace list size.
 *
 * Observation only.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = '/home/CNS2026495165/dsh/.workspace/settings-lag';
const URL = 'http://127.0.0.1:3080';
const WINDOW_MS = 15000;

const script = () => {
  window.__frames = [];
  requestAnimationFrame(function loop(t) { window.__frames.push(t); requestAnimationFrame(loop); });
  window.__longtasks = [];

  // (a) WebSocket frame accounting
  window.__ws = { frames: 0, bytes: 0, byType: {}, sockets: 0 };
  const NativeWS = window.WebSocket;
  window.WebSocket = function (...args) {
    const s = new NativeWS(...args);
    window.__ws.sockets += 1;
    s.addEventListener('message', (ev) => {
      window.__ws.frames += 1;
      const d = ev.data;
      if (typeof d === 'string') {
        window.__ws.bytes += d.length;
        try {
          const j = JSON.parse(d);
          const t = j?.payload?.type ?? j?.type ?? 'unknown';
          window.__ws.byType[t] = (window.__ws.byType[t] || 0) + 1;
        } catch { window.__ws.byType['unparsed'] = (window.__ws.byType['unparsed'] || 0) + 1; }
      }
    });
    return s;
  };
  window.WebSocket.prototype = NativeWS.prototype;
  Object.assign(window.WebSocket, NativeWS);

  // (b) mutation accounting split by region
  window.__mut = { panel: { records: 0, added: 0, removed: 0, batches: 0 }, outside: { records: 0, added: 0, removed: 0, batches: 0 }, outsideRoots: {} };

  const regionOf = (node) => {
    const panel = document.querySelector('[role="dialog"]');
    if (panel && panel.contains(node)) return 'panel';
    return 'outside';
  };
  window.__install = () => {
    window.__obs = new MutationObserver((records) => {
      const seenBatches = new Set();
      for (const r of records) {
        const region = regionOf(r.target);
        const bucket = window.__mut[region];
        bucket.records += 1;
        bucket.added += r.addedNodes.length;
        bucket.removed += r.removedNodes.length;
        seenBatches.add(region);
        if (region === 'outside') {
          let el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
          const name = el ? `${el.tagName.toLowerCase()}${el.getAttribute?.('data-slot') ? `[data-slot=${el.getAttribute('data-slot')}]` : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''}` : '?';
          window.__mut.outsideRoots[name] = (window.__mut.outsideRoots[name] || 0) + 1;
        }
      }
      for (const rg of seenBatches) window.__mut[rg].batches += 1;
    });
    window.__obs.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  };
};

const run = async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.addInitScript(script);

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);

  await page.locator('button:has-text("设置")').last().click({ timeout: 10000 });
  await page.waitForTimeout(2500);
  await page.locator('[role="dialog"] button:has-text("模型")').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(2500);

  await page.evaluate(() => { window.__install(); window.__ws = { frames: 0, bytes: 0, byType: {}, sockets: window.__ws.sockets }; });
  const m0 = await page.evaluate(() => ({ f: window.__frames.length }));
  const p0 = await cdp.send('Performance.getMetrics');
  const g = (p, n) => p.metrics.find((x) => x.name === n)?.value ?? null;

  await new Promise((r) => setTimeout(r, WINDOW_MS));

  const p1 = await cdp.send('Performance.getMetrics');
  const out = await page.evaluate(() => ({
    ws: window.__ws,
    mut: window.__mut,
    nodes: document.getElementsByTagName('*').length,
    panelNodes: document.querySelector('[role="dialog"]')?.getElementsByTagName('*').length ?? null,
    sidebarNodes: document.querySelector('[data-slot="sidebar"]')?.getElementsByTagName('*').length ?? null,
    frames: window.__frames.length,
    longtasks: window.__longtasks.length,
    longtaskTotal: Math.round(window.__longtasks.reduce((a, b) => a + b, 0)),
  }));

  const report = {
    seconds: WINDOW_MS / 1000,
    script_ms: Math.round((g(p1, 'ScriptDuration') - g(p0, 'ScriptDuration')) * 1000),
    task_ms: Math.round((g(p1, 'TaskDuration') - g(p0, 'TaskDuration')) * 1000),
    recalc_style_ms: Math.round((g(p1, 'RecalcStyleDuration') - g(p0, 'RecalcStyleDuration')) * 1000),
    layout_ms: Math.round((g(p1, 'LayoutDuration') - g(p0, 'LayoutDuration')) * 1000),
    raf_frames: out.frames - m0.f,
    ws_frames: out.ws.frames,
    ws_frames_per_second: Math.round((out.ws.frames / (WINDOW_MS / 1000)) * 10) / 10,
    ws_by_type: out.ws.byType,
    ws_sockets: out.ws.sockets,
    mutations_panel: out.mut.panel,
    mutations_outside: { records: out.mut.outside.records, added: out.mut.outside.added, removed: out.mut.outside.removed, batches: out.mut.outside.batches },
    mutation_hotspots_outside: Object.fromEntries(Object.entries(out.mut.outsideRoots).sort((a, b) => b[1] - a[1]).slice(0, 15)),
    dom_nodes_total: out.nodes,
    dom_nodes_panel: out.panelNodes,
    dom_nodes_sidebar: out.sidebarNodes,
    longtasks: out.longtasks,
    longtask_total_ms: out.longtaskTotal,
  };
  fs.writeFileSync(`${OUT}/probe-hotspots.json`, JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
};

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
