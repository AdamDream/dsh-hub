#!/usr/bin/env node
/**
 * incident2 / headed-vs-headless : controlled A/B/C comparison — HARNESS v2
 *
 * Fixes over v1 (all arms use this exact file, so the comparison stays valid):
 *   F1 readiness predicate was too strict (needed >200 chars of body text) and
 *      produced false "page-never-ready" flags; v2 declares ready when the
 *      settings entry itself is hittable, and records what it saw.
 *   F2 the click->visible frame mark never fired: the marker was installed at
 *      click time but the rAF loop was only registered on documents created
 *      after that (SPA nav keeps the document), so nothing ever polled it.
 *      v2 registers the panel-visible watcher up front on every document.
 *   F3 per-frame interaction latency is now captured closed-loop inside the
 *      page (click mark -> first frame at which the settings surface exists).
 *
 * Arms: A (headless default/swiftshader) | B (headed, real X) |
 *       C-nogpu (headless --disable-gpu) | C-gpu (headless, explicit angle+swiftshader)
 */
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/headed-vs-headless';
const URL = 'http://127.0.0.1:3080/';
const HOST_PID = 10806;

const argv = process.argv.slice(2);
function arg(name, def = null) {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = argv[i + 1];
  return (v === undefined || v.startsWith('--')) ? true : v;
}
const ARM = arg('arm', 'A');
const REP = Number(arg('rep', 1));
const OUT = arg('out', `raw/${ARM}-r${REP}.json`);
const DISPLAY_ARG = arg('display', null);
const SETTLE_MS = Number(arg('settle', 4000));
const READY_MS = Number(arg('ready-timeout', 90000));
const PANEL_MS = Number(arg('panel-timeout', 20000));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r3 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);

const BASE_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--enable-precise-memory-info'];
function armConfig(arm) {
  switch (arm) {
    case 'A': return { headless: true, args: [...BASE_ARGS], label: 'headless-default(swiftshader)' };
    case 'B': return { headless: false, args: [...BASE_ARGS], label: 'headed-realX' };
    case 'C-nogpu': return { headless: true, args: [...BASE_ARGS, '--disable-gpu'], label: 'headless-disable-gpu' };
    case 'C-gpu': return { headless: true, args: [...BASE_ARGS, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], label: 'headless-angle-swiftshader' };
    default: throw new Error('unknown arm ' + arm);
  }
}

function pct(sorted, p) {
  if (!sorted.length) return null;
  return r3(sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]);
}
function frameStats(intervals) {
  const x = intervals.filter((v) => v != null && v >= 0 && v < 60000).slice().sort((a, b) => a - b);
  if (x.length < 2) return { n: x.length, p50: null, p95: null, p99: null, max: null, over50: 0, over100: 0 };
  return {
    n: x.length, p50: pct(x, 0.5), p90: pct(x, 0.9), p95: pct(x, 0.95), p99: pct(x, 0.99),
    max: r3(x[x.length - 1]), mean: r3(x.reduce((a, b) => a + b, 0) / x.length),
    over50: x.filter((v) => v > 50).length, over100: x.filter((v) => v > 100).length,
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
function snapshotEnv(ownProcsHint) {
  const out = { at: new Date().toISOString() };
  try { out.loadavg = fs.readFileSync('/proc/loadavg', 'utf8').trim().split(' ').slice(0, 3).join(' '); } catch (e) {}
  const pg = (pat) => { try { return Number(execFileSync('bash', ['-lc', `pgrep -fc "${pat}" || true`], { encoding: 'utf8' }).trim()) || 0; } catch (e) { return null; } };
  out.headless_shell_procs = pg('headless_shell --disable-field-trial-config');
  out.chrome_family_procs = pg('chrome-linux/chrome|headless_shell');
  out.foreign_instances = out.headless_shell_procs == null ? null : Math.max(0, out.headless_shell_procs - (ownProcsHint || 0));
  try { out.dsh_host_alive = fs.existsSync(`/proc/${HOST_PID}`); } catch (e) {}
  try { const m = fs.readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+) kB/); out.mem_available_mb = m ? Math.round(Number(m[1]) / 1024) : null; } catch (e) {}
  return out;
}

async function main() {
  const cfg = armConfig(ARM);
  const env = { ...process.env };
  if (cfg.headless === false) {
    if (!DISPLAY_ARG) throw new Error('headed arm requires --display');
    env.DISPLAY = DISPLAY_ARG;
  }
  const t0 = Date.now();
  const rec = {
    meta: {
      harness: 'measure-v2', arm: ARM, rep: REP, arm_label: cfg.label,
      started_at: new Date().toISOString(), url: URL, host_pid: HOST_PID,
      host_pid_alive: fs.existsSync(`/proc/${HOST_PID}`),
      display: cfg.headless ? null : DISPLAY_ARG, launch_args: cfg.args, headless: cfg.headless,
      playwright_version: JSON.parse(fs.readFileSync('/home/CNS2026495165/playwright_scratch/node_modules/playwright-core/package.json', 'utf8')).version,
      browser_version: null,
      note: 'Same script and same judging criteria for every arm. Read-only: only the settings entry is clicked. No save/apply/delete.',
    },
    invalid_reasons: [],
  };
  // Launch is itself a measured step: a headed launch failure is a RESULT on this
  // host, not a harness error, so it must land in the artifact like anything else.
  let browser = null;
  try {
    rec.environment = { at_start: snapshotEnv(1) };
    browser = await chromium.launch({ headless: cfg.headless, args: cfg.args, env, slowMo: 0 });
    rec.meta.browser_version = browser.version();
    rec.launch = { ok: true, wall_epoch_ms: Date.now() };
  } catch (e) {
    rec.launch = { ok: false, error: String(e).slice(0, 4000), wall_epoch_ms: Date.now() };
    rec.invalid_reasons.push('launch-failed');
    rec.meta.finished_at = new Date().toISOString();
    rec.meta.total_ms = Date.now() - t0;
    rec.environment = rec.environment || {};
    rec.environment.at_end = snapshotEnv(1);
    const outPath0 = path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT);
    fs.mkdirSync(path.dirname(outPath0), { recursive: true });
    fs.writeFileSync(outPath0, JSON.stringify(rec, null, 2));
    console.log(JSON.stringify({ arm: ARM, rep: REP, launch_ok: false, invalid: rec.invalid_reasons, out: outPath0 }));
    return;
  }
  let ctx, page, cdp;
  try {
    ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await ctx.newPage();
    cdp = await ctx.newCDPSession(page);

    // ---------- instrumentation (F2: watcher registered up front on every document) ----------
    await page.addInitScript(() => {
      const T0 = performance.now();
      window.__p = { raf: [], longtasks: [], lof: [], mutations: 0, clickAt: null, visibleFrame: null, visibleCount: 0, errs: [] };
      const probe = () => {
        const b = document.body;
        if (!b) return { hits: 0, names: [], dlg: 0, nodes: 0 };
        const txt = b.innerText || '';
        const sig = ['通用', '插件', '模型', '远程', '子代理', '外观', '主题', 'General', 'Plugins'];
        const names = sig.filter((s) => txt.includes(s));
        return { hits: names.length, names, dlg: document.querySelectorAll('[role="dialog"],[role="tablist"],[role="tab"]').length, nodes: document.getElementsByTagName('*').length };
      };
      window.__p.probe = probe;
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__p.longtasks.push({ s: e.startTime - T0, d: e.duration, n: e.name }); }).observe({ entryTypes: ['longtask'] }); }
      catch (e) { window.__p.errs.push('lt:' + e); }
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__p.lof.push({ s: e.startTime - T0, v: e.value }); }).observe({ entryTypes: ['layout-shift'] }); }
      catch (e) { window.__p.errs.push('lof:' + e); }
      try { new MutationObserver((rs) => { window.__p.mutations += rs.length; }).observe(document, { childList: true, subtree: true, attributes: true, characterData: true }); }
      catch (e) { window.__p.errs.push('mo:' + e); }
      const tick = (t) => {
        const now = t - T0;
        window.__p.raf.push(now);
        if (window.__p.clickAt != null && window.__p.visibleFrame == null) {
          try {
            const st = probe();
            if (st.hits >= 3 && st.dlg >= 1) { window.__p.visibleFrame = now; window.__p.visibleState = st; }
            else window.__p.visibleCount++;
          } catch (e) { window.__p.errs.push('vf:' + e); }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      window.__p.markClick = () => { window.__p.clickAt = performance.now() - T0; };
      window.__p.snapshot = () => ({ raf: window.__p.raf, longtasks: window.__p.longtasks, lof: window.__p.lof, mutations: window.__p.mutations, clickAt: window.__p.clickAt, visibleFrame: window.__p.visibleFrame, visibleState: window.__p.visibleState || null, errs: window.__p.errs });
    });

    const consoleErrors = [], pageErrors = [], failedRequests = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
    page.on('requestfailed', (r) => failedRequests.push({ url: r.url(), err: r.failure()?.errorText }));

    await cdp.send('Performance.enable');
    // SystemInfo.getInfo returns an empty gpu object until the GPU process is
    // actually up, so retry once after forcing GPU initialisation from the page.
    const gpuInfo = async (tag) => cdp.send('SystemInfo.getInfo').catch((e) => ({ error: String(e).slice(0, 200), tag }));
    rec.cdp_systeminfo_attempt1 = await gpuInfo('pre-webgl');
    const gpuEmpty = (s) => !s || !s.gpu || (!s.gpu.devices && !(s.gpu.featureStatus && Object.keys(s.gpu.featureStatus).length) && !s.gpu.auxAttributes);
    if (gpuEmpty(rec.cdp_systeminfo_attempt1)) {
      await page.evaluate(() => { try { const c = document.createElement('canvas'); c.getContext('webgl'); c.getContext('webgl2'); } catch (e) {} }).catch(() => {});
      await sleep(800);
      rec.cdp_systeminfo_attempt2 = await gpuInfo('post-webgl');
    }
    rec.cdp_systeminfo = (!gpuEmpty(rec.cdp_systeminfo_attempt2) ? rec.cdp_systeminfo_attempt2 : rec.cdp_systeminfo_attempt1);

    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: READY_MS });

    const screenMetrics = () => page.evaluate(() => ({
      devicePixelRatio: window.devicePixelRatio,
      innerWidth: window.innerWidth, innerHeight: window.innerHeight,
      outerWidth: window.outerWidth, outerHeight: window.outerHeight,
      screenWidth: screen.width, screenHeight: screen.height,
      availWidth: screen.availWidth, availHeight: screen.availHeight,
      colorDepth: screen.colorDepth,
      refreshRate: (typeof screen.refreshRate === 'number' ? screen.refreshRate : null),
      orientation: screen.orientation ? screen.orientation.type : null,
      visualViewport: window.visualViewport ? { w: window.visualViewport.width, h: window.visualViewport.height, scale: window.visualViewport.scale } : null,
      hardwareConcurrency: navigator.hardwareConcurrency, userAgent: navigator.userAgent,
    }));
    rec.screen_initial = await screenMetrics();

    // ---------- F1: readiness = settings entry hittable ----------
    const SEL = ['[aria-label*="设置"]', '[title*="设置"]', '[aria-label*="Settings" i]', '[title*="Settings" i]',
      'button:has-text("设置")', 'a:has-text("设置")', 'button:has-text("Settings")', 'a:has-text("Settings")',
      '[href*="setting" i]', '[data-testid*="setting" i]'];
    const tReady = Date.now();
    let selUsed = null, box = null;
    while (Date.now() - tReady < READY_MS) {
      for (const s of SEL) {
        const loc = page.locator(s);
        const n = await loc.count().catch(() => 0);
        if (n > 0) {
          const bb = await loc.first().boundingBox().catch(() => null);
          if (bb && bb.width > 0) { selUsed = s; box = bb; break; }
        }
      }
      if (selUsed) break;
      await sleep(200);
    }
    rec.readiness = { ready: !!selUsed, waited_ms: Date.now() - tReady, selector: selUsed, box, dom_nodes_at_ready: await page.evaluate(() => document.getElementsByTagName('*').length).catch(() => null) };
    if (!selUsed) rec.invalid_reasons.push('settings-entry-not-found');
    await sleep(2500); // quiescence before baseline

    const cdpMetrics = async () => { const m = await cdp.send('Performance.getMetrics'); const o = {}; for (const { name, value } of m.metrics) o[name] = value; return o; };
    const base = await cdpMetrics();
    const preState = await page.evaluate(() => window.__p.snapshot());
    rec.pre_click = { cdp: base, page_state: preState };

    // ---------- CLICK (read-only) ----------
    let clickOk = false;
    if (selUsed) {
      try {
        const loc = page.locator(selUsed).first();
        await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
        await page.evaluate(() => window.__p.markClick());
        await loc.click({ timeout: 5000, noWaitAfter: true });
        clickOk = true;
        rec.click = { ok: true, wall_epoch_ms: Date.now() };
      } catch (e) { rec.click = { ok: false, error: String(e).slice(0, 200) }; rec.invalid_reasons.push('click-failed'); }
    }

    // ---------- panel visible (node-side poll; also records whether in-page watcher saw it) ----------
    const tPoll = Date.now();
    let panelVisible = false, tVisibleMs = null, panelState = null;
    while (Date.now() - tPoll < PANEL_MS) {
      try {
        const st = await page.evaluate(() => window.__p.probe());
        if (st && st.hits >= 3) { panelVisible = true; tVisibleMs = Date.now() - tPoll; panelState = st; break; }
      } catch (e) {}
      await sleep(50);
    }
    if (!panelVisible) rec.invalid_reasons.push('panel-not-visible');
    rec.panel = { visible: panelVisible, t_visible_ms_from_poll: tVisibleMs, poll_resolution_ms: 50, state: panelState, url_now: page.url() };

    await sleep(SETTLE_MS);
    const post = await cdpMetrics();
    const postState = await page.evaluate(() => window.__p.snapshot());
    rec.screen_settings = await screenMetrics();
    rec.post = { cdp: post, page_state: postState };

    // ---------- CDP deltas ----------
    const KEYS = ['ScriptDuration', 'TaskDuration', 'RecalcStyleDuration', 'LayoutDuration', 'LayoutCount', 'RecalcStyleCount', 'Nodes', 'JSEventListeners', 'Documents', 'Timestamp', 'V8CompileDuration', 'ThreadTime'];
    const delta = {};
    for (const k of KEYS) delta[k] = (typeof base[k] === 'number' && typeof post[k] === 'number') ? r3(post[k] - base[k]) : null;
    rec.cdp_delta = delta;
    rec.cdp_delta_interpreted = {
      window_ms: (delta.Timestamp != null ? r3(delta.Timestamp * 1000) : null),
      ScriptDuration_ms: delta.ScriptDuration != null ? r3(delta.ScriptDuration * 1000) : null,
      TaskDuration_ms: delta.TaskDuration != null ? r3(delta.TaskDuration * 1000) : null,
      RecalcStyleDuration_ms: delta.RecalcStyleDuration != null ? r3(delta.RecalcStyleDuration * 1000) : null,
      LayoutDuration_ms: delta.LayoutDuration != null ? r3(delta.LayoutDuration * 1000) : null,
      note: 'CDP durations are seconds -> *1000 = ms. Counts (LayoutCount/RecalcStyleCount) are integers.',
    };
    rec.cdp_paint_presence = {
      Paint_present: Object.prototype.hasOwnProperty.call(post, 'Paint'),
      Paint_value: post.Paint ?? null,
      CompositeLayers_present: Object.prototype.hasOwnProperty.call(post, 'CompositeLayers'),
      CompositeLayers_value: post.CompositeLayers ?? null,
      metric_names: Object.keys(post).sort(),
    };

    // ---------- frames ----------
    const raf = postState.raf || [];
    const intervalsAll = raf.slice(1).map((t, i) => t - raf[i]);
    const clickAt = postState.clickAt;
    let clickFrame = null, clickToNextFrame = null, afterClick = [];
    if (raf.length && clickAt != null) {
      let idx = raf.findIndex((t) => t >= clickAt);
      if (idx < 0) idx = raf.length - 1;
      clickFrame = { idx, click_at_ms: r3(clickAt), frame_at: r3(raf[idx]), delta_from_click: r3(raf[idx] - clickAt) };
      clickToNextFrame = r3(raf[idx] - clickAt);
      afterClick = raf.slice(idx + 1).map((t, i) => t - raf[idx + i]);
    }
    const vf = postState.visibleFrame;
    rec.frames = {
      raf_frames_this_document: raf.length,
      raf_frames_before_click: (postState.raf || []).filter((t) => clickAt != null && t < clickAt).length,
      click_frame: clickFrame,
      click_to_next_frame_ms: clickToNextFrame,
      click_to_panel_visible_frame_ms: (vf != null && clickAt != null) ? r3(vf - clickAt) : null,
      panel_visible_frame_state: postState.visibleState,
      frames_between_click_and_visible: (vf != null && clickAt != null) ? raf.filter((t) => t > clickAt && t < vf).length : null,
      interval_after_click: frameStats(afterClick),
      interval_all_this_document: frameStats(intervalsAll),
      histogram_after_click: bins(afterClick),
      interval_series_after_click: afterClick.slice(0, 500).map(r3),
      frames_over_50ms_ratio_after_click: afterClick.length ? r3(afterClick.filter((v) => v > 50).length / afterClick.length) : null,
      dom_mutations_total: postState.mutations ?? null,
      dom_mutations_pre_click: preState.mutations ?? null,
      dom_mutations_after_click: (postState.mutations != null && preState.mutations != null) ? postState.mutations - preState.mutations : null,
    };

    const lt = postState.longtasks || [];
    const lof = postState.lof || [];
    const windowMs = Date.now() - tPoll;
    rec.longtasks = {
      n: lt.length, total_ms: r3(lt.reduce((a, b) => a + b.d, 0)),
      max_ms: lt.length ? r3(Math.max(...lt.map((e) => e.d))) : 0,
      per_s: windowMs > 0 ? r3(lt.reduce((a, b) => a + b.d, 0) / (windowMs / 1000)) : null,
      entries: lt.slice(0, 40).map((e) => ({ start_ms: r3(e.s), dur_ms: r3(e.d) })),
    };
    rec.layout_shifts = { n: lof.length, total: lof.length ? r3(lof.reduce((a, b) => a + b.v, 0)) : 0, entries: lof.slice(0, 20) };
    rec.errors = { console: consoleErrors.slice(0, 20), page: pageErrors.slice(0, 20), failed_requests: failedRequests.slice(0, 20), probe_internal: postState.errs || [] };

    // ---------- GPU / raster probe ----------
    rec.gpu = await page.evaluate(() => {
      const out = {};
      const t = (kind) => {
        try {
          const c = document.createElement('canvas'); c.width = 64; c.height = 64;
          const gl = kind === 'webgl2' ? c.getContext('webgl2') : c.getContext('webgl');
          if (!gl) return { ok: false, reason: 'null-context' };
          const dbg = gl.getExtension('WEBGL_debug_renderer_info');
          return { ok: true, vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER), version: gl.getParameter(gl.VERSION),
            unmaskedVendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
            unmaskedRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
            maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
        } catch (e) { return { ok: false, reason: String(e).slice(0, 140) }; }
      };
      out.webgl = t('webgl'); out.webgl2 = t('webgl2');
      out.documentVisibility = document.visibilityState;
      return out;
    }).catch((e) => ({ error: String(e).slice(0, 200) }));

    // ---------- screenshot ----------
    try {
      const shot = path.join(ROOT, 'shots', `${ARM}-r${REP}-settings.png`);
      await page.screenshot({ path: shot, timeout: 20000 });
      rec.screenshot = { path: shot, bytes: fs.statSync(shot).size };
    } catch (e) { rec.screenshot = { error: String(e).slice(0, 200) }; }

    rec.environment.at_end = snapshotEnv(1);
    rec.meta.finished_at = new Date().toISOString();
    rec.meta.total_ms = Date.now() - t0;
    rec.verdict_inputs = {
      click_to_panel_visible_frame_ms: rec.frames.click_to_panel_visible_frame_ms,
      frame_p95_ms_after_click: rec.frames.interval_after_click.p95,
      frame_p99_ms_after_click: rec.frames.interval_after_click.p99,
      frame_max_ms_after_click: rec.frames.interval_after_click.max,
      frames_over_50ms_ratio_after_click: rec.frames.frames_over_50ms_ratio_after_click,
      frames_over_50ms_ratio_limit: 0.02,
      long_task_total_ms_per_s: rec.longtasks.per_s,
      long_task_limit_ms_per_s: 100,
      Paint_present: rec.cdp_paint_presence.Paint_present,
      CompositeLayers_present: rec.cdp_paint_presence.CompositeLayers_present,
    };
  } catch (e) {
    rec.invalid_reasons.push('FATAL:' + String(e).slice(0, 200));
    rec.fatal = String(e && e.stack ? e.stack : e).slice(0, 2000);
  } finally {
    try { await browser.close(); } catch (e) { rec.invalid_reasons.push('close-error'); }
  }

  const outPath = path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(rec, null, 2));
  console.log(JSON.stringify({
    arm: ARM, rep: REP, invalid: rec.invalid_reasons,
    c2vf: rec.frames?.click_to_panel_visible_frame_ms ?? null,
    p95: rec.frames?.interval_after_click?.p95 ?? null,
    p99: rec.frames?.interval_after_click?.p99 ?? null,
    over50: rec.frames?.frames_over_50ms_ratio_after_click ?? null,
    ltps: rec.longtasks?.per_s ?? null,
    Paint: rec.cdp_paint_presence?.Paint_present ?? null,
  }));
}

main().catch((e) => { console.error('FATAL', e); process.exitCode = 1; });
