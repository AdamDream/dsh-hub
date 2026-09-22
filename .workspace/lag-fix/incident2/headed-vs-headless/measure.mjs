#!/usr/bin/env node
/**
 * incident2 / headed-vs-headless : A/B/C controlled comparison
 *
 * One browser instance per invocation (serial). One fresh page (fresh browser
 * context) -> click settings -> measure. Same script, same judging criteria for
 * every arm.
 *
 * Arms:
 *   A          headless (playwright default chromium = headless_shell, swiftshader)
 *   B          headed  (headless:false on a real X display)
 *   C-nogpu    headless + --disable-gpu
 *   C-headless-gpu  headless, try to keep GPU enabled (--use-gl=angle --use-angle=...)
 *
 * Usage: node measure.mjs --arm A --rep 1 --out raw/A1.json [--display :1] [--slowmo 0]
 */
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/headed-vs-headless';
const URL = 'http://127.0.0.1:3080/';
const HOST_PID = 10806;

// ---------- args ----------
const argv = process.argv.slice(2);
function arg(name, def = null) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : (i >= 0 ? true : def);
}
const ARM = arg('arm', 'A');
const REP = Number(arg('rep', 1));
const OUT = arg('out', `raw/${ARM}-${REP}.json`);
const DISPLAY_ARG = arg('display', null);
const SETTLE_MS = Number(arg('settle', 4000));   // watch window after panel visible
const READY_MS = Number(arg('ready-timeout', 60000));
const PANEL_MS = Number(arg('panel-timeout', 20000));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r3 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);

// ---------- arm -> launch config ----------
const BASE_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--enable-precise-memory-info'];
function armConfig(arm) {
  switch (arm) {
    case 'A':
      return { headless: true, channel: undefined, executablePath: undefined, args: [...BASE_ARGS], label: 'headless-default(swiftshader)' };
    case 'B':
      return { headless: false, args: [...BASE_ARGS], label: 'headed-realX' };
    case 'C-nogpu':
      return { headless: true, args: [...BASE_ARGS, '--disable-gpu'], label: 'headless-disable-gpu' };
    case 'C-gpu':
      return {
        headless: true,
        args: [...BASE_ARGS, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        label: 'headless-angle-swiftshader',
      };
    default:
      throw new Error('unknown arm ' + arm);
  }
}

// ---------- stats ----------
function pct(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return r3(sorted[i]);
}
function frameStats(intervals) {
  const x = intervals.filter((v) => v != null && v >= 0 && v < 10000).slice().sort((a, b) => a - b);
  if (x.length < 3) return { n: x.length, p50: null, p95: null, p99: null, max: null, over50: 0, over100: 0, mean: null };
  return {
    n: x.length,
    p50: pct(x, 0.5),
    p90: pct(x, 0.9),
    p95: pct(x, 0.95),
    p99: pct(x, 0.99),
    max: r3(x[x.length - 1]),
    mean: r3(x.reduce((a, b) => a + b, 0) / x.length),
    over50: x.filter((v) => v > 50).length,
    over100: x.filter((v) => v > 100).length,
    over16_7: x.filter((v) => v > 16.7).length,
  };
}
function bins(intervals) {
  const edges = [0, 16.7, 33.3, 50, 100, 200, 500, 1e9];
  const out = {};
  for (const v of intervals) {
    if (v == null) continue;
    for (let i = 1; i < edges.length; i++) {
      if (v <= edges[i]) { const k = `${edges[i - 1]}-${edges[i] === 1e9 ? 'inf' : edges[i]}`; out[k] = (out[k] || 0) + 1; break; }
    }
  }
  return out;
}

// ---------- main ----------
async function main() {
  const cfg = armConfig(ARM);
  const env = { ...process.env };
  if (cfg.headless === false) {
    if (!DISPLAY_ARG) throw new Error('headed arm requires --display');
    env.DISPLAY = DISPLAY_ARG;
  }
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const browser = await chromium.launch({ headless: cfg.headless, args: cfg.args, env, slowMo: 0 });
  const rec = {
    meta: {
      arm: ARM, rep: REP, arm_label: cfg.label, started_at: startedAt,
      url: URL, host_pid: HOST_PID, host_pid_alive: fs.existsSync(`/proc/${HOST_PID}`),
      display: cfg.headless ? null : DISPLAY_ARG,
      launch_args: cfg.args, headless: cfg.headless,
      playwright_version: JSON.parse(fs.readFileSync('/home/CNS2026495165/playwright_scratch/node_modules/playwright-core/package.json', 'utf8')).version,
      browser_version: browser.version(),
      protocol: 'research-v2/measure-hardening/docs/PROTOCOL.md v1 (endpoints: frame p95/p99, frames_over_50ms ratio<=0.02, longtask ms/s<=100)',
      note: 'Same script/criteria for all arms. Fresh browser context = fresh page. Read-only: only the settings entry is clicked.',
    },
    invalid_reasons: [],
    environment: {},
  };

  let ctx, page, cdp;
  try {
    rec.environment.at_start = snapshotEnv();
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: undefined });
    page = await ctx.newPage();
    cdp = await ctx.newCDPSession(page);

    // ---- instrumentation, installed on every document (survives SPA-nav & reload) ----
    await page.addInitScript(() => {
      window.__probe = { raf: [], longtasks: [], lof: [], errors: [] };
      const t0p = performance.now();
      // long tasks
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) window.__probe.longtasks.push({ s: e.startTime - t0p, d: e.duration, n: e.name });
        }).observe({ entryTypes: ['longtask'] });
      } catch (e) { window.__probe.errors.push('longtask-observer:' + String(e)); }
      // layout shifts
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) if (!e.hadRecentInput) window.__probe.lof.push({ s: e.startTime - t0p, v: e.value });
        }).observe({ entryTypes: ['layout-shift'] });
      } catch (e) { window.__probe.errors.push('lof-observer:' + String(e)); }
      // rAF tick stream + per-frame panel-visible mark (true click->paint observable)
      window.__probe.frameOfVisible = null;
      window.__probe.frameCount = 0;
      window.__probe.mutations = 0;
      try {
        new MutationObserver((recs) => { window.__probe.mutations += recs.length; }).observe(document, { childList: true, subtree: true, attributes: true });
      } catch (e) { window.__probe.errors.push('mutation-observer:' + String(e)); }
      requestAnimationFrame(function f(t) {
        const now = t - t0p;
        window.__probe.raf.push(now);
        window.__probe.frameCount++;
        if (window.__probe.frameOfVisible === null && window.__probe.clickAt != null) {
          try {
            const st = window.__probe.panelProbe();
            if (st && st.hits >= 3) window.__probe.frameOfVisible = now;
          } catch (e) {}
        }
        requestAnimationFrame(f);
      });
      // mark click time in-page (both nav and SPA cases)
      window.__probe.markClick = () => { window.__probe.clickAt = performance.now() - t0p; };
      // panel visibility detection
      window.__probe.panelProbe = () => {
        const txt = document.body ? document.body.innerText || '' : '';
        const sig = ['通用', '插件', '模型', '远程', '子代理', '外观', '主题', 'General', 'Plugins', 'Models'];
        const hits = sig.filter((s) => txt.includes(s));
        const dlg = document.querySelectorAll('[role="dialog"],[role="tablist"],[role="tab"]').length;
        // count nodes of the settings surface (largest subtree that contains the tabs)
        return { hits: hits.length, hitNames: hits, dlg, url: location.href, domNodes: document.getElementsByTagName('*').length, title: document.title };
      };
    });

    // ---- console / error collection ----
    const consoleErrors = [], pageErrors = [], failedRequests = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
    page.on('requestfailed', (r) => failedRequests.push({ url: r.url(), err: r.failure()?.errorText }));

    await cdp.send('Performance.enable');
    await cdp.send('Log.enable').catch(() => {});

    // ---- system info (GPU / display / refresh rate) ----
    rec.cdp_systeminfo = await cdp.send('SystemInfo.getInfo').catch((e) => ({ error: String(e) }));
    // screen metrics via in-page API (DPR, visible viewport, screen refreshRate)
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: READY_MS });

    const screenMetrics = async () => page.evaluate(() => ({
      devicePixelRatio: window.devicePixelRatio,
      innerWidth: window.innerWidth, innerHeight: window.innerHeight,
      outerWidth: window.outerWidth, outerHeight: window.outerHeight,
      screenWidth: screen.width, screenHeight: screen.height,
      screenAvailWidth: screen.availWidth, screenAvailHeight: screen.availHeight,
      colorDepth: screen.colorDepth, pixelDepth: screen.pixelDepth,
      refreshRate: (screen.refreshRate !== undefined ? screen.refreshRate : null),
      screenOrientation: screen.orientation ? screen.orientation.type : null,
      isSecureContext: window.isSecureContext, hardwareConcurrency: navigator.hardwareConcurrency,
      userAgent: navigator.userAgent, visualViewport: window.visualViewport ? { w: window.visualViewport.width, h: window.visualViewport.height, scale: window.visualViewport.scale } : null,
    }));
    rec.screen_initial = await screenMetrics();

    // ---- wait for app ready ----
    const ready = { ok: false, waited_ms: 0 };
    const rtStart = Date.now();
    try {
      await page.waitForFunction(() => {
        const b = document.body;
        if (!b) return false;
        const t = b.innerText || '';
        return t.length > 200 && document.getElementsByTagName('*').length > 500;
      }, { timeout: READY_MS, polling: 250 });
      ready.ok = true;
    } catch (e) { rec.invalid_reasons.push('page-never-ready'); }
    ready.waited_ms = Date.now() - rtStart;
    // extra quiescence
    await sleep(2500);

    // ---- locate settings entry (read-only) ----
    const SEL = ['[aria-label*="设置"]', '[title*="设置"]', '[aria-label*="Settings" i]', '[title*="Settings" i]',
      'button:has-text("设置")', 'a:has-text("设置")', 'button:has-text("Settings")', 'a:has-text("Settings")',
      '[href*="setting" i]', '[data-testid*="setting" i]'];
    let selUsed = null, box = null;
    for (const s of SEL) {
      const loc = page.locator(s);
      const n = await loc.count().catch(() => 0);
      if (n > 0) {
        const first = loc.first();
        const bb = await first.boundingBox().catch(() => null);
        if (bb) { selUsed = s; box = bb; break; }
      }
    }
    rec.settings_entry = { selector: selUsed, box, found: !!selUsed };

    // ---- baseline snapshot BEFORE click ----
    const cdpMetrics = async () => {
      const m = await cdp.send('Performance.getMetrics');
      const o = {}; for (const { name, value } of m.metrics) o[name] = value; return o;
    };
    const base = await cdpMetrics();
    const preState = await page.evaluate(() => ({
      probe: { raf: window.__probe.raf.splice(0), longtasks: window.__probe.longtasks.splice(0), lof: window.__probe.lof.splice(0) },
      dom: document.getElementsByTagName('*').length, url: location.href,
    }));
    rec.pre_click = { cdp: base, page_state: preState };

    // ---- CLICK ----
    let clickInfo = { ok: false };
    const wallClick = Date.now();
    if (selUsed) {
      try {
        const loc = page.locator(selUsed).first();
        await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        // mark click time in page (if same document survives)
        await page.evaluate(() => { try { window.__probe && window.__probe.markClick(); } catch (e) {} }).catch(() => {});
        await loc.click({ timeout: 5000, noWaitAfter: true });
        clickInfo = { ok: true, wall_click_epoch_ms: wallClick };
      } catch (e) {
        clickInfo = { ok: false, error: String(e).slice(0, 200) };
        rec.invalid_reasons.push('click-failed');
      }
    } else {
      rec.invalid_reasons.push('settings-entry-not-found');
    }

    // ---- panel visibility detection: poll fast, in-page closed-loop ----
    // We poll from Node (survives navigation) + in-page rAF loop records the first frame
    // where the panel is visible with its performance.now().
    let panelVisible = false, tVisibleMs = null, panelState = null;
    const tPanelStart = Date.now();
    while (Date.now() - tPanelStart < PANEL_MS) {
      try {
        const st = await page.evaluate(() => window.__probe ? window.__probe.panelProbe() : null);
        if (st && st.hits >= 3) {
          panelVisible = true;
          tVisibleMs = Date.now() - tPanelStart;
          panelState = st;
          break;
        }
      } catch (e) { /* navigating */ }
      await sleep(50);
    }
    if (!panelVisible) {
      rec.invalid_reasons.push('panel-not-visible');
      rec.panel_never_visible = { waited_ms: PANEL_MS, url: page.url() };
    }
    rec.panel = { visible: panelVisible, t_visible_ms_from_poll: tVisibleMs, state: panelState, wall_visible_epoch_ms: panelVisible ? Date.now() : null, url_now: page.url() };

    // ---- SETTLE window: collect frames/longtasks on the settings surface ----
    await sleep(SETTLE_MS);
    const post = await cdpMetrics();
    const postState = await page.evaluate(() => ({
      probe: { raf: window.__probe.raf.splice(0), longtasks: window.__probe.longtasks.splice(0), lof: window.__probe.lof.splice(0), clickAt: window.__probe.clickAt, errors: window.__probe.errors },
      dom: document.getElementsByTagName('*').length, url: location.href,
    }));
    rec.screen_settings = await screenMetrics();
    rec.post = { cdp: post, page_state: postState };

    // ---- CDP deltas (cumulative counters) ----
    const DELTA_KEYS = ['ScriptDuration', 'TaskDuration', 'RecalcStyleDuration', 'LayoutDuration', 'LayoutCount', 'RecalcStyleCount', 'Timestamp', 'Nodes', 'JSEventListeners', 'Documents', 'Frames', 'DevToolsCommandDuration'];
    const delta = {};
    for (const k of DELTA_KEYS) {
      const a = base[k], b = post[k];
      delta[k] = (typeof a === 'number' && typeof b === 'number') ? r3(b - a) : null;
    }
    rec.cdp_delta = delta;
    rec.cdp_delta_interpreted = {
      ScriptDuration_ms: delta.ScriptDuration != null ? r3(delta.ScriptDuration * 1000) : null,
      TaskDuration_ms: delta.TaskDuration != null ? r3(delta.TaskDuration * 1000) : null,
      RecalcStyleDuration_ms: delta.RecalcStyleDuration != null ? r3(delta.RecalcStyleDuration * 1000) : null,
      LayoutDuration_ms: delta.LayoutDuration != null ? r3(delta.LayoutDuration * 1000) : null,
      note: 'CDP durations are SECONDS in the protocol; *1000 -> ms. LayoutCount/RecalcStyleCount are counts.',
    };
    rec.cdp_paint_presence = {
      Paint_present: Object.prototype.hasOwnProperty.call(post, 'Paint'),
      Paint_value: post.Paint ?? null,
      CompositeLayers_present: Object.prototype.hasOwnProperty.call(post, 'CompositeLayers'),
      CompositeLayers_value: post.CompositeLayers ?? null,
      all_metric_names: Object.keys(post).sort(),
    };

    // ---- frames ----
    const postRaf = postState.probe.raf || [];
    const preRafCount = (preState.probe.raf || []).length;
    const intervalsAll = postRaf.slice(1).map((t, i) => t - postRaf[i]);
    // interval that contains the click: find frame index nearest the click timestamp
    const clickAt = postState.probe.clickAt;
    let clickFrame = null, clickToNextFrame = null, intervalsAfterClick = [];
    if (postRaf.length && clickAt != null) {
      let idx = postRaf.findIndex((t) => t >= clickAt);
      if (idx < 0) idx = postRaf.length - 1;
      clickFrame = { idx, click_at_ms: r3(clickAt), frame_before: r3(postRaf[idx - 1] ?? null), frame_at: r3(postRaf[idx]), delta_from_click: r3(postRaf[idx] - clickAt) };
      clickToNextFrame = r3(postRaf[idx] - clickAt);
      intervalsAfterClick = postRaf.slice(idx + 1).map((t, i) => t - postRaf[idx + i]);
    }
    const frameOfVisible = postState.probe.frameOfVisible;
    rec.frames = {
      raf_count_total_document: postRaf.length,
      raf_count_pre_click: preRafCount,
      click_frame: clickFrame,
      click_to_next_frame_ms: clickToNextFrame,
      click_to_panel_visible_frame_ms: (frameOfVisible != null && clickAt != null) ? r3(frameOfVisible - clickAt) : null,
      click_to_panel_frame_note: 'first rAF tick at which the settings surface signature was already in the DOM, measured from the in-page click mark (same document only; SPA nav keeps the document, full reload resets it)',
      dom_mutations_total: postState.probe.mutations ?? null,
      all_intervals: frameStats(intervalsAll),
      intervals_after_click: frameStats(intervalsAfterClick),
      interval_histogram_after_click: bins(intervalsAfterClick),
      interval_series_after_click: intervalsAfterClick.slice(0, 400).map(r3),
      frames_over_50ms_ratio_after_click: intervalsAfterClick.length ? r3(intervalsAfterClick.filter((v) => v > 50).length / intervalsAfterClick.length) : null,
    };

    // ---- long tasks / LoF ----
    const lt = postState.probe.longtasks || [];
    const lof = postState.probe.lof || [];
    const windowMs = (Date.now() - wallClick);
    rec.longtasks = {
      n: lt.length, entries: lt.slice(0, 40).map((e) => ({ start_ms: r3(e.s), dur_ms: r3(e.d), name: e.n })),
      total_ms: r3(lt.reduce((a, b) => a + b.d, 0)),
      max_ms: lt.length ? r3(Math.max(...lt.map((e) => e.d))) : 0,
      per_s: windowMs > 0 ? r3(lt.reduce((a, b) => a + b.d, 0) / (windowMs / 1000)) : null,
    };
    rec.layout_shifts = { n: lof.length, total: lof.length ? r3(lof.reduce((a, b) => a + b.v, 0)) : 0, entries: lof.slice(0, 20).map((e) => ({ start_ms: r3(e.s), v: r3(e.v) })) };
    rec.errors = { console: consoleErrors.slice(0, 20), page: pageErrors.slice(0, 20), failed_requests: failedRequests.slice(0, 20), probe_internal: postState.probe.errors || [] };

    // ---- GPU / raster / compositor probe (chrome://gpu equivalent, no privileged page needed) ----
    rec.gpu = await page.evaluate(() => {
      const out = { webgl: {}, webgl2: {}, canvas2d: {}, notes: [] };
      const tryCtx = (kind, attrs) => {
        try {
          const c = document.createElement('canvas');
          c.width = 64; c.height = 64;
          const gl = kind === 'webgl2' ? c.getContext('webgl2', attrs) : (kind === 'webgl' ? c.getContext('webgl', attrs) : c.getContext('2d', attrs));
          if (!gl) return { ok: false, reason: 'null-context' };
          if (kind === '2d') {
            return { ok: true, attrs: { willReadFrequently: !!(attrs && attrs.willReadFrequently) } };
          }
          const dbg = gl.getExtension('WEBGL_debug_renderer_info');
          return {
            ok: true,
            vendor: gl.getParameter(gl.VENDOR),
            renderer: gl.getParameter(gl.RENDERER),
            version: gl.getParameter(gl.VERSION),
            shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
            unmaskedVendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
            unmaskedRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
            maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
            extensions: gl.getSupportedExtensions() ? gl.getSupportedExtensions().length : 0,
          };
        } catch (e) { return { ok: false, reason: String(e).slice(0, 160) }; }
      };
      out.webgl = tryCtx('webgl');
      out.webgl2 = tryCtx('webgl2');
      out.canvas2d = tryCtx('2d');
      // OffscreenCanvas + rAF tick sanity (indicates whether the renderer is vsync-throttled)
      try {
        out.offscreenCanvas = typeof OffscreenCanvas !== 'undefined';
        out.requestIdleCallback = typeof requestIdleCallback !== 'undefined';
        out.visibilityState = document.visibilityState;
        out.hidden = document.hidden;
      } catch (e) { out.notes.push(String(e)); }
      return out;
    }).catch((e) => ({ error: String(e).slice(0, 300) }));
    try {
      const shot = path.join(ROOT, 'shots', `${ARM}-r${REP}-settings.png`);
      await page.screenshot({ path: shot, timeout: 15000 });
      const st = fs.statSync(shot);
      rec.screenshot = { path: shot, bytes: st.size };
      // also a small centered clip to test whether offscreen headed windows still paint
      const clipShot = path.join(ROOT, 'shots', `${ARM}-r${REP}-clip.png`);
      await page.screenshot({ path: clipShot, clip: { x: 0, y: 0, width: 400, height: 300 }, timeout: 15000 });
      rec.screenshot_clip = { path: clipShot, bytes: fs.statSync(clipShot).size };
    } catch (e) { rec.screenshot = { error: String(e).slice(0, 200) }; }

    // ---- paint-only delta over a short isolated window (isolates paint accounting) ----
    try {
      const m1 = await cdpMetrics();
      await sleep(1500);
      const m2 = await cdpMetrics();
      rec.paint_idle_window = {
        Paint_delta: (typeof m1.Paint === 'number' && typeof m2.Paint === 'number') ? r3(m2.Paint - m1.Paint) : (Object.prototype.hasOwnProperty.call(m2, 'Paint') ? 'present-but-nonnumeric' : 'absent'),
        CompositeLayers_delta: (typeof m1.CompositeLayers === 'number' && typeof m2.CompositeLayers === 'number') ? r3(m2.CompositeLayers - m1.CompositeLayers) : (Object.prototype.hasOwnProperty.call(m2, 'CompositeLayers') ? 'present-but-nonnumeric' : 'absent'),
        TaskDuration_delta_ms: (typeof m1.TaskDuration === 'number') ? r3((m2.TaskDuration - m1.TaskDuration) * 1000) : null,
        ScriptDuration_delta_ms: (typeof m1.ScriptDuration === 'number') ? r3((m2.ScriptDuration - m1.ScriptDuration) * 1000) : null,
        window_ms: 1500,
      };
    } catch (e) { rec.paint_idle_window = { error: String(e).slice(0, 200) }; }

    rec.environment.at_end = snapshotEnv();
    rec.meta.finished_at = new Date().toISOString();
    rec.meta.total_ms = Date.now() - t0;
    rec.verdict_inputs = {
      frames_over_50ms_ratio: rec.frames.frames_over_50ms_ratio_after_click,
      frames_over_50ms_ratio_limit: 0.02,
      frame_p95_ms: rec.frames.intervals_after_click.p95,
      frame_p99_ms: rec.frames.intervals_after_click.p99,
      long_task_total_ms_per_s: rec.longtasks.per_s,
      long_task_limit_ms_per_s: 100,
      click_to_panel_visible_ms: rec.panel.t_visible_ms_from_poll,
      click_to_next_frame_ms: rec.frames.click_to_next_frame_ms,
    };
  } catch (e) {
    rec.invalid_reasons.push('FATAL:' + String(e).slice(0, 300));
    rec.fatal = String(e && e.stack ? e.stack : e).slice(0, 2000);
  } finally {
    try { await browser.close(); } catch (e) { rec.invalid_reasons.push('close-error:' + String(e).slice(0, 120)); }
  }

  const outPath = path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(rec, null, 2));
  const summary = {
    arm: ARM, rep: REP, out: outPath,
    invalid: rec.invalid_reasons,
    click_to_panel_ms: rec.panel?.t_visible_ms_from_poll ?? null,
    frames_after_click: rec.frames?.intervals_after_click ?? null,
    over50_ratio: rec.frames?.frames_over_50ms_ratio_after_click ?? null,
    longtask_per_s: rec.longtasks?.per_s ?? null,
    Paint: rec.cdp_paint_presence?.Paint_value ?? null,
    CompositeLayers: rec.cdp_paint_presence?.CompositeLayers_value ?? null,
  };
  console.log(JSON.stringify(summary));
}

function snapshotEnv() {
  const out = { at: new Date().toISOString() };
  try { out.loadavg = fs.readFileSync('/proc/loadavg', 'utf8').trim(); } catch (e) {}
  try {
    out.headless_shell_procs = Number(execFileSync('bash', ['-lc', 'pgrep -fc "headless_shell --disable-field-trial-config" || true'], { encoding: 'utf8' }).trim()) || 0;
  } catch (e) { out.headless_shell_procs = null; }
  try {
    out.chrome_family_procs = Number(execFileSync('bash', ['-lc', 'pgrep -fc "chrome-linux/chrome|headless_shell" || true'], { encoding: 'utf8' }).trim()) || 0;
  } catch (e) { out.chrome_family_procs = null; }
  try { out.dsh_host_alive = fs.existsSync(`/proc/${HOST_PID}`); } catch (e) {}
  try {
    const m = fs.readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+) kB/);
    out.mem_available_mb = m ? Math.round(Number(m[1]) / 1024) : null;
  } catch (e) {}
  return out;
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
