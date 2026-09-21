/*
 * tab-profile: per-tab, layered, recomputable profile of the settings surface.
 *
 * READ-ONLY with respect to the product: it launches ONE headless browser,
 * points it at the already-running GUI (127.0.0.1:3080), clicks settings nav
 * entries and measures. It writes no product file, changes no config, and
 * restarts nothing. The host under measurement is untouched.
 *
 * Measurement discipline encoded here (see audit.md for the prose):
 *   - CDP Performance.getMetrics is CUMULATIVE -> raw snapshots are stored at
 *     every window boundary and every reported number is a computed delta.
 *   - A panel must self-prove it mounted (content nodes > 0) AND its text must
 *     change to a tab-specific signature; otherwise the run is invalid / NOT-FOUND.
 *   - A tab switch that cannot be performed is NOT-FOUND, never PASS.
 *   - Every run carries valid:boolean + invalidReasons[].
 *   - WS frames are classified by PAYLOAD discriminator (MuxFrame type, and one
 *     level deeper for session/event), never by envelope type.
 *   - /usage/* samples are only valid with a real HTTP response and a parsed
 *     envelope; a bare URL or an RPC-level 404 is recorded as invalid.
 *
 * Usage: node lib/tab-profile.mjs [--phase=map|profile|plugins|all] [--budget-min=N]
 */
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { acquireLock, releaseLock, lockStatus, LOCK_DIR } from './lock.mjs';

const URL_ = 'http://127.0.0.1:3080';
const ROOT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/tab-profile';
/* batch dir: locked re-collection writes beside (not over) the earlier unlocked batch */
const BATCH = process.env.TP_BATCH || 'unlocked';
const RAW = path.join(ROOT, 'raw', BATCH);
fs.mkdirSync(RAW, { recursive: true });

const STATE = { browser: null, lock: null, batch: BATCH, myUdd: null };
const HOST_PID = 1390375;

/* Count headless Chromium processes on this host straight from /proc.
 * `pgrep -c -f headless_shell` counts helper processes too (zygote / gpu /
 * renderer / utility), so both that figure and the browser-instance count are
 * recorded, and our own browser is excluded by its --user-data-dir marker. */
function procScanHeadless() {
  const res = { allProc: 0, browserInstances: 0, mineProc: 0, mineInstances: 0, others: [] };
  let pids;
  try { pids = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)); } catch { return res; }
  for (const pid of pids) {
    let cmd = '';
    try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch { continue; }
    if (!cmd.includes('headless_shell')) continue;
    const isInstance = cmd.includes('--no-startup-window');
    const mine = !!(STATE.myUdd && cmd.includes(STATE.myUdd));
    res.allProc++;
    if (isInstance) res.browserInstances++;
    if (mine) { res.mineProc++; if (isInstance) res.mineInstances++; }
    else if (isInstance) res.others.push({ pid: Number(pid), udd: (/--user-data-dir=([^\0\s]+)/.exec(cmd) || [])[1] ?? null });
  }
  return res;
}

/* Discover our own browser's user-data-dir by parentage (Playwright launches the
 * browser as a direct child of this node process). */
function discoverMyBrowser() {
  let pids;
  try { pids = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)); } catch { return null; }
  for (const pid of pids) {
    let st = '';
    try { st = fs.readFileSync(`/proc/${pid}/status`, 'utf8'); } catch { continue; }
    const m = /^PPid:\s*(\d+)/m.exec(st);
    if (!m || Number(m[1]) !== process.pid) continue;
    let cmd = '';
    try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch { continue; }
    if (!cmd.includes('headless_shell')) continue;
    const u = /--user-data-dir=([^\0\s]+)/.exec(cmd);
    if (u) return u[1];
  }
  return null;
}

const hostAlive = () => { try { process.kill(HOST_PID, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/* One concurrency sample, stamped at a window edge. */
const concurrencySample = () => {
  const sc = procScanHeadless();
  return {
    at: new Date().toISOString(),
    hostPid: HOST_PID, hostAlive: hostAlive(),
    headlessShellProcTotal: sc.allProc,          // == pgrep -c -f headless_shell
    myHeadlessShellProc: sc.mineProc,
    concurrentHeadlessShellProc: sc.allProc - sc.mineProc,
    browserInstanceTotal: sc.browserInstances,
    myBrowserInstances: sc.mineInstances,
    concurrentBrowserInstances: sc.browserInstances - sc.mineInstances,   // the number that matters
    otherBrowsers: sc.others,
  };
};

const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const PHASE = argv.phase || 'all';
const BUDGET_MS = Number(argv['budget-min'] || 22) * 60 * 1000;
/* measured from AFTER lock acquisition: queue time in the cross-line lock must
 * not eat the probe budget (a 25-minute wait would otherwise abort instantly). */
let START = Date.now();
const OVER_BUDGET = () => Date.now() - START > BUDGET_MS;

const TAB_FILTER = argv.tabs ? String(argv.tabs).split(',').map((s) => s.trim()) : null;
const REPEATS = Number(argv.repeats || 2);
const MAX_ATTEMPTS = Math.max(1, Number(argv['max-attempts'] || 1));
const REQUIRE_EXCLUSIVE = argv['require-exclusive'] === true || argv['require-exclusive'] === 'true';
const SHORT = !!argv.short;               // smoke only: 5s windows, never used for reported numbers

const W1_MS = SHORT ? 5_000 : 10_000;
const W2_MS = SHORT ? 5_000 : 20_000;
const PARK_MS = 1_500;
const POLL_WINDOW_MS = 60_000;

const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => { process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}\n`); };
/* Unbounded awaits are the enemy of a jank study: page.evaluate and mouse.click
 * carry NO default timeout in Playwright, so a blocked renderer main thread hangs
 * them forever. Every such call goes through this race. */
const T = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT ${label} after ${ms}ms`)), ms))]);
process.on('unhandledRejection', (e) => log('UNHANDLED_REJECTION', String(e).slice(0, 300)));
process.on('uncaughtException', (e) => { log('UNCAUGHT', String(e).slice(0, 400)); process.exitCode = 1; });

/* ------------------------------------------------------------------ tabs */

const TABS = [
  { id: 'general', label: '通用设置', match: '通用设置' },
  { id: 'models', label: '模型', match: '模型' },
  { id: 'plugins', label: '插件', match: '插件' },
  { id: 'agent-preset', label: 'Agent 预设', match: 'Agent 预设' },
  { id: 'remote-workspace', label: '远程工作区', match: '远程工作区' },
  { id: 'distributed', label: '分布式控制', match: '分布式控制' },
  { id: 'vision-adam', label: 'vision-adam', match: 'vision-adam' },
  { id: 'subagent-model', label: '子代理模型', match: '子代理模型' },
];

/* --------------------------------------------------- in-page instrumentation */

const initScript = () => {
  const S = {
    frames: [], longtasks: [], pageErrors: [],
    clickT0: null, firstMut: null, firstMutClean: null, firstText: null,
    baselineText: null, armed: false, content: null, dialog: null, obs: null,
    navClassBefore: null,
  };
  window.__tp = S;

  requestAnimationFrame(function loop(t) {
    S.frames.push(t);
    if (S.armed && S.clickT0 != null && S.firstText == null && S.content) {
      try { if (S.content.textContent !== S.baselineText) S.firstText = performance.now(); } catch { }
    }
    requestAnimationFrame(loop);
  });

  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) S.longtasks.push({ start: e.startTime, duration: e.duration, name: e.name });
    }).observe({ entryTypes: ['longtask'] });
  } catch { }

  const isNavButton = (n) => !!(n && n.closest && n.closest('nav button'));
  document.addEventListener('pointerdown', (ev) => { if (isNavButton(ev.target)) S.clickT0 = performance.now(); }, true);
  document.addEventListener('mousedown', (ev) => { if (isNavButton(ev.target) && S.clickT0 == null) S.clickT0 = performance.now(); }, true);
  document.addEventListener('click', (ev) => { if (isNavButton(ev.target) && S.clickT0 == null) S.clickT0 = performance.now(); }, true);

  S.locate = () => {
    const dlg = document.querySelector('[role="dialog"]');
    const nav = dlg ? dlg.querySelector('nav') : null;
    const content = nav ? nav.nextElementSibling : null;
    return { dlg, nav, content, navButtons: nav ? [...nav.querySelectorAll('button')] : [] };
  };

  /* The settings nav exposes NO active-tab semantics: no role="tab", no
   * aria-selected, no data-state. The only active marker is a hashed CSS-module
   * class added to one button. Infer it as "the button whose class string
   * differs from the modal (most common) class string", with a fallback to a
   * class token carried by exactly one button. */
  S.activeMarker = () => {
    const { navButtons } = S.locate();
    if (!navButtons.length) return { token: null, index: null, label: null, method: 'no-buttons' };
    const cls = navButtons.map((b) => (b.className || '').toString().trim());
    const label = (i) => (navButtons[i].textContent || '').trim().replace(/\s+/g, ' ');
    const freq = new Map();
    for (const c of cls) freq.set(c, (freq.get(c) || 0) + 1);
    let modal = null, best = -1;
    for (const [c, n] of freq) if (n > best) { best = n; modal = c; }
    const odd = cls.map((c, i) => ({ c, i })).filter((x) => x.c !== modal);
    if (odd.length === 1) return { token: odd[0].c, index: odd[0].i, label: label(odd[0].i), method: 'modal-class-differs' };
    const counts = new Map();
    for (const c of cls) for (const t of new Set(c.split(/\s+/).filter(Boolean))) counts.set(t, (counts.get(t) || 0) + 1);
    const uniq = [...counts.entries()].filter(([, n]) => n === 1).map(([t]) => t);
    for (let i = 0; i < cls.length; i++) {
      const hit = uniq.find((t) => new Set(cls[i].split(/\s+/)).has(t));
      if (hit) return { token: hit, index: i, label: label(i), method: 'unique-token' };
    }
    return { token: null, index: null, label: null, method: 'no-marker', distinctClassStrings: [...new Set(cls)].length };
  };

  S.arm = () => {
    const { dlg, nav, content } = S.locate();
    S.dialog = dlg; S.content = content;
    S.clickT0 = null; S.firstMut = null; S.firstMutClean = null; S.firstText = null;
    S.navClassBefore = nav ? [...nav.querySelectorAll('button')].map((b) => (b.className || '').toString()) : null;
    S.baselineText = content ? content.textContent : null;
    if (S.obs) { S.obs.disconnect(); S.obs = null; }
    if (content) {
      S.obs = new MutationObserver((recs) => {
        const now = performance.now();
        if (S.clickT0 == null) return;
        if (S.firstMut == null) S.firstMut = now;
        if (S.firstMutClean != null) return;
        let clean = false;
        for (const r of recs) {
          if (r.type === 'characterData') { clean = true; break; }
          const nodes = [...(r.addedNodes || []), ...(r.removedNodes || [])];
          for (const n of nodes) {
            if (!(n instanceof Element)) { clean = true; continue; }
            const inUsage = !!n.closest('[class*="du_"]') || !!n.querySelector?.('[class*="du_"]');
            if (!inUsage) { clean = true; break; }
          }
          if (clean) break;
        }
        if (clean) S.firstMutClean = now;
      });
      S.obs.observe(content, { childList: true, subtree: true, characterData: true });
    }
    S.armed = true;
    return {
      hasDialog: !!dlg, hasNav: !!nav, hasContent: !!content,
      contentNodes: content ? content.getElementsByTagName('*').length : 0,
      textLen: S.baselineText == null ? null : S.baselineText.length,
    };
  };

  S.settle = () => { S.armed = false; if (S.obs) { S.obs.disconnect(); S.obs = null; } };
  S.mark = () => ({ frameIdx: S.frames.length, ltIdx: S.longtasks.length, t: performance.now() });
  S.take = (m) => {
    const ft = S.frames.slice(m.frameIdx);
    const d = [];
    for (let i = 1; i < ft.length; i++) d.push(ft[i] - ft[i - 1]);
    const lt = S.longtasks.slice(m.ltIdx);
    return { rawFrames: ft, deltas: d, longtasks: lt, spanMs: ft.length ? ft[ft.length - 1] - ft[0] : 0 };
  };
  S.clearErr = () => { S.pageErrors.length = 0; };
};

/* ------------------------------------------------------------------- stats */

function frameStats(deltas) {
  const x = deltas.slice().sort((a, b) => a - b);
  const q = (p) => (x.length ? r3(x[Math.min(x.length - 1, Math.floor((x.length - 1) * p))]) : null);
  return {
    n: x.length,
    p50: q(0.5), p95: q(0.95), p99: q(0.99),
    max: x.length ? r3(x[x.length - 1]) : null,
    mean: x.length ? r3(x.reduce((a, b) => a + b, 0) / x.length) : null,
    over50: x.filter((v) => v > 50).length,
    over16_7: x.filter((v) => v > 16.7).length,
  };
}

const METRIC_NAMES = ['ScriptDuration', 'TaskDuration', 'RecalcStyleDuration', 'LayoutDuration',
  'Nodes', 'JSEventListeners', 'JSHeapUsedSize', 'Documents', 'Frames'];

/* ------------------------------------------ WS payload classification (3 levels) */

const ENVELOPES = new Set(['client-request', 'client-response', 'server-request', 'server-response']);

function classifyFrame(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return { envelope: 'unparseable', payloadType: 'unparseable', subType: null }; }
  const envelope = ENVELOPES.has(msg.type) ? msg.type : `other:${String(msg.type).slice(0, 30)}`;
  let payloadType = null, subType = null;
  const pl = msg.payload;
  if (msg.type === 'client-request') payloadType = `method:${msg.method ?? '?'}`;
  else if (pl && typeof pl === 'object' && typeof pl.type === 'string') {
    payloadType = pl.type;
    if (pl.type === 'session/event' && pl.event && typeof pl.event.type === 'string') subType = `event:${pl.event.type}`;
    else if (pl.type === 'host/remote-event' && typeof pl.event === 'string') subType = `remote:${pl.event}`;
  } else payloadType = 'no-discriminator';
  return { envelope, payloadType, subType };
}

const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
const rateOf = (o, sec) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => [k, { n: v, perSec: r3(v / sec) }]));

/* ------------------------------------------------------------------ usage ****/

function usageSampleOf(reqUrl, body) {
  let m = null;
  try { m = JSON.parse(body || '{}'); } catch { }
  const pathName = new URL(reqUrl).pathname; // /usage/<method>
  const parts = pathName.split('/').filter(Boolean);
  return {
    path: pathName,
    channel: parts[0] || null,           // "usage"
    method: parts[1] || m?.method || null,
    rpcId: m?.rpcId ?? null,
    payloadKeys: m?.payload && typeof m.payload === 'object' ? Object.keys(m.payload) : null,
    granularity: m?.payload?.granularity ?? null,
    isUsageHttp: parts[0] === 'usage',
  };
}

/* ================================================================== runner */

async function main() {
  log(`=== batch=${BATCH} phase=${PHASE} ===`);
  STATE.lock = await acquireLock({
    agent: 'tab-profile',
    line: 'per-tab settings jank profile (.workspace/lag-fix/research-v2/tab-profile)',
    purpose: `--phase=${PHASE} browser probe batch`,
    log,
  });
  if (!STATE.lock.ok) {
    fs.writeFileSync(path.join(RAW, 'LOCK-TIMEOUT.json'), JSON.stringify({ ...STATE.lock, at: new Date().toISOString() }, null, 1));
    log('LOCK unavailable after 30min -> refusing to start any browser');
    process.exit(3);
  }

  START = Date.now();
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--enable-precise-memory-info',
      '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'],
  });
  STATE.browser = browser;
  STATE.myUdd = discoverMyBrowser();
  log(`browser launched; my user-data-dir = ${STATE.myUdd ?? 'UNKNOWN'}; concurrency now: ${JSON.stringify((({ concurrentBrowserInstances, concurrentHeadlessShellProc }) => ({ concurrentBrowserInstances, concurrentHeadlessShellProc }))(concurrencySample()))}`);

  const result = {
    meta: {
      url: URL_, at: new Date().toISOString(), phase: PHASE,
      headless: true, viewport: '1440x900',
      windows: { openLatency: 'in-page pointerdown -> first content textContent change', stay1_s: W1_MS / 1000, stay2_s: W2_MS / 1000, park_ms: PARK_MS, pollWindow_s: POLL_WINDOW_MS / 1000 },
      cdpNote: 'Performance.getMetrics returns cumulative counters; raw snapshots are recorded per window and all deltas are computed by this script.',
      wsNote: 'WS frames classified by payload discriminator (MuxFrame/HostFrame type) and one level deeper for session/event - never by envelope type.',
      usageNote: '/usage/<method> is a real HTTP POST surface on the host origin (verified by recon), not an /api RPC path.',
      confounderNote: 'The host is shared with a concurrently running agent session; ambient session/event traffic is measured as the closed-settings baseline and cannot be paused by this read-only probe.',
    },
    tabMap: null, baseline: [], runs: [], plugins: {}, aborted: false,
    lock: {
      batch: BATCH,
      acquiredAt: STATE.lock.acquiredAt,
      waitedMs: STATE.lock.waitedMs,
      retriesBeforeAcquire: STATE.lock.attempts,
      preemptions: STATE.lock.preemptions,
      waitsWhileContended: STATE.lock.waits,
      heldAcrossWholeRun: null,
      released: null,
    },
  };

  const flush = () => fs.writeFileSync(path.join(RAW, 'run.json'), JSON.stringify(result, null, 1));

  const newPage = async (label) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(initScript);
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('Network.enable', { maxTotalBufferSize: 200 * 1024 * 1024, maxResourceBufferSize: 100 * 1024 * 1024 });

    const ws = { sockets: [], frames: [] };
    cdp.on('Network.webSocketCreated', (e) => ws.sockets.push({ requestId: e.requestId, url: e.url }));
    const onFrame = (dir) => (e) => {
      const raw = e.response?.payloadData ?? '';
      const c = classifyFrame(raw);
      const sock = ws.sockets.find((s) => s.requestId === e.requestId);
      ws.frames.push({ dir, url: sock?.url ?? null, bytes: raw.length, at: Date.now(), opcode: e.response?.opcode, ...c });
    };
    cdp.on('Network.webSocketFrameReceived', onFrame('recv'));
    cdp.on('Network.webSocketFrameSent', onFrame('sent'));

    /* CDP-level /usage timings. Playwright's request.timing() returned -1 for these
     * (wallMs came back null), so wall time is measured from the network stack:
     * requestWillBeSent -> responseReceived (time to headers) and -> loadingFinished
     * (time to last body byte). Pairing is by rpcId parsed out of the request body,
     * which is the only way to disambiguate the two /usage/timeseries calls. */
    const usageCdp = new Map();     // cdp requestId -> {path, rpcId, t}
    const usageTiming = new Map();  // rpcId -> {wallToHeadersMs, wallToBodyMs}
    cdp.on('Network.requestWillBeSent', (e) => {
      const u = e.request?.url || '';
      if (!u.includes('/usage/')) return;
      let rpcId = null;
      try { rpcId = JSON.parse(e.request.postData || '{}').rpcId ?? null; } catch { }
      usageCdp.set(e.requestId, { url: u, path: new URL(u).pathname, rpcId, t: e.timestamp, wallClock: Date.now() });
    });
    cdp.on('Network.responseReceived', (e) => {
      const r = usageCdp.get(e.requestId);
      if (!r) return;
      const key = r.rpcId || `${r.path}#${e.requestId}`;
      const prev = usageTiming.get(key) || {};
      usageTiming.set(key, { ...prev, path: r.path, wallToHeadersMs: r3((e.timestamp - r.t) * 1000), requestTs: r.t, headersTs: e.timestamp, requestWallClock: r.wallClock });
    });
    cdp.on('Network.loadingFinished', (e) => {
      const r = usageCdp.get(e.requestId);
      if (!r) return;
      const key = r.rpcId || `${r.path}#${e.requestId}`;
      const prev = usageTiming.get(key) || { path: r.path, wallToHeadersMs: null };
      usageTiming.set(key, { ...prev, wallToBodyMs: r3((e.timestamp - r.t) * 1000), bodyTs: e.timestamp });
      usageCdp.delete(e.requestId);
    });
    cdp.on('Network.loadingFailed', (e) => {
      const r = usageCdp.get(e.requestId);
      if (!r) return;
      const key = r.rpcId || `${r.path}#${e.requestId}`;
      usageTiming.set(key, { path: r.path, wallToHeadersMs: null, wallToBodyMs: null, failed: e.errorText || 'failed' });
      usageCdp.delete(e.requestId);
    });

    const http = [];
    page.on('request', (r) => {
      if (!r.url().startsWith(URL_)) return;
      const u = r.url();
      const post = r.postData() || '';
      http.push({
        kind: 'request', url: u, path: new URL(u).pathname, method: r.method(),
        at: Date.now(), resourceType: r.resourceType(),
        usage: u.includes('/usage/') ? usageSampleOf(u, post) : null,
        postData: post.slice(0, 600),
      });
    });
    page.on('response', (r) => {
      const u = r.url();
      if (!u.startsWith(URL_)) return;
      const t = r.request().timing();
      const rec = {
        kind: 'response', url: u, path: new URL(u).pathname, status: r.status(), at: Date.now(),
        contentLengthHeader: r.headers()['content-length'] ?? null,
        contentType: r.headers()['content-type'] ?? null,
        timing: { requestStart: r3(t.requestStart), responseStart: r3(t.responseStart), responseEnd: r3(t.responseEnd) },
        wallMs: (t.requestStart >= 0 && t.responseEnd >= 0) ? r3(t.responseEnd - t.requestStart) : null,
        wallMsFallback: null,
      };
      if (u.includes('/usage/')) {
        rec.usage = usageSampleOf(u, r.request().postData() || '');
        rec.bodyBytes = null; rec.bodyOk = null; rec.envelopeOk = null; rec.bodyErr = null;
        /* CDP network-stack timing, paired by rpcId */
        const ct = usageTiming.get(rec.usage.rpcId);
        rec.usageWallToHeadersMs = ct?.wallToHeadersMs ?? null;
        rec.usageWallToBodyMs = ct?.wallToBodyMs ?? null;
        /* Date.now() fallback pairing: nearest preceding unpaired request with the same rpcId */
        const reqRec = [...http].reverse().find((h) => h.kind === 'request' && h.usage?.rpcId && h.usage.rpcId === rec.usage.rpcId && !h._paired);
        if (reqRec) { reqRec._paired = true; rec.wallMsFallback = rec.at - reqRec.at; }
        rec.bodySettled = false;
        rec.bodyPromise = r.body().then((b) => {
          rec.bodyBytes = b.length;
          try {
            const j = JSON.parse(b.toString('utf8'));
            rec.envelopeOk = j?.type === 'server-response' ? true : `unexpected-envelope:${j?.type}`;
            rec.bodyResultOk = j?.result?.ok ?? null;
            rec.bodyErrorCode = j?.result?.error?.code ?? null;
          } catch (e) { rec.bodyErr = String(e).slice(0, 120); }
          rec.bodySettled = true;
        }).catch((e) => { rec.bodyErr = String(e).slice(0, 120); rec.bodySettled = true; });
      }
      http.push(rec);
    });
    page.on('requestfailed', (r) => {
      if (!r.url().startsWith(URL_)) return;
      http.push({ kind: 'failed', url: r.url(), path: new URL(r.url()).pathname, at: Date.now(), error: r.failure()?.errorText || 'failed', usage: r.url().includes('/usage/') ? usageSampleOf(r.url(), r.postData() || '') : null });
    });
    page.on('pageerror', (e) => page.evaluate((s) => window.__tp.pageErrors.push(s), String(e).slice(0, 300)).catch(() => { }));
    page._http = http; page._ws = ws; page._cdp = cdp; page._ctx = ctx; page._usageTiming = usageTiming;

    /* bound every unbounded Playwright primitive by shadowing it on this instance */
    page.setDefaultTimeout(8000);
    page.setDefaultNavigationTimeout(45000);
    const _eval = page.evaluate.bind(page);
    page.evaluate = (fn, arg) => T(_eval(fn, arg), 20000, `evaluate:${typeof fn === 'function' ? (fn.name || 'fn') : 'expr'}`);
    const _mouseClick = page.mouse.click.bind(page.mouse);
    page.mouse.click = (x, y, opts) => T(_mouseClick(x, y, opts), 10000, 'mouse.click');
    const _goto = page.goto.bind(page);
    page.goto = (u, o) => T(_goto(u, o), 60000, 'page.goto');
    return page;
  };

  const metricsSnap = async (cdp) => {
    const p = await cdp.send('Performance.getMetrics');
    const out = { at: Date.now() };
    for (const n of METRIC_NAMES) out[n] = p.metrics.find((x) => x.name === n)?.value ?? null;
    return out;
  };
  const metricDelta = (a, b) => {
    const out = {}; const reasons = [];
    for (const n of ['ScriptDuration', 'TaskDuration', 'RecalcStyleDuration', 'LayoutDuration']) {
      if (a[n] == null || b[n] == null) { out[n] = null; reasons.push(`metric-missing:${n}`); continue; }
      const d = (b[n] - a[n]) * 1000;
      if (d < 0) { reasons.push(`metric-negative-delta:${n}`); out[n] = null; }
      else out[n] = r3(d);
    }
    out.Nodes = b.Nodes; out.NodesDelta = (a.Nodes != null && b.Nodes != null) ? b.Nodes - a.Nodes : null;
    out.JSEventListeners = b.JSEventListeners;
    out.JSHeapUsedSize = b.JSHeapUsedSize;
    out.Documents = b.Documents; out.Frames = b.Frames;
    return { delta: out, reasons };
  };

  const openSettings = async (page) => {
    const before = await page.evaluate(() => document.getElementsByTagName('*').length);
    let how = null;
    for (const [name, sel] of [
      ['button:has-text("设置")', 'button:has-text("设置")'],
      ['[title*="设置"]', '[title*="设置"]'],
      ['[aria-label*="设置"]', '[aria-label*="设置"]'],
    ]) {
      try {
        const l = page.locator(sel).first();
        if (await l.count()) { await l.click({ timeout: 5000 }); how = name; break; }
      } catch { }
    }
    let appeared = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      const ok = await page.evaluate(() => !!document.querySelector('[role="dialog"]')).catch(() => false);
      if (ok) { appeared = true; break; }
      await sleep(100);
    }
    return { how, appeared, dialogAppearedMs: Date.now() - t0, bodyNodesBefore: before, bodyNodesAfter: await page.evaluate(() => document.getElementsByTagName('*').length) };
  };

  const findNav = (page, match) => page.evaluate((m) => {
    const dlg = document.querySelector('[role="dialog"]');
    const nav = dlg ? dlg.querySelector('nav') : null;
    if (!nav) return { status: 'NOT-FOUND', reason: 'no nav element inside [role=dialog]' };
    const btns = [...nav.querySelectorAll('button')];
    const norm = (s) => (s || '').trim().replace(/\s+/g, ' ');
    const all = btns.map((b, i) => ({ i, t: norm(b.textContent) }));
    // exact match first: substring matching is ambiguous (e.g. "模型" is a substring of "子代理模型")
    const exact = all.filter((x) => x.t === m);
    if (exact.length === 1) return { status: 'FOUND', index: exact[0].i, text: exact[0].t, total: btns.length, strategy: 'exact' };
    if (exact.length > 1) return { status: 'NOT-FOUND', reason: `ambiguous: ${exact.length} nav buttons match exactly`, all: all.map((x) => x.t) };
    const inc = all.filter((x) => x.t.includes(m));
    if (inc.length === 1) return { status: 'FOUND', index: inc[0].i, text: inc[0].t, total: btns.length, strategy: 'unique-substring' };
    return {
      status: 'NOT-FOUND',
      reason: inc.length === 0 ? 'no nav button matches text (exact or substring)' : `ambiguous: ${inc.length} nav buttons contain the text`,
      candidates: inc.map((x) => x.t), all: all.map((x) => x.t),
    };
  }, match);

  const clickNav = async (page, index) => {
    const box = await page.evaluate((i) => {
      const dlg = document.querySelector('[role="dialog"]');
      const b = dlg.querySelectorAll('nav button')[i];
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
    }, index).catch(() => null);
    if (!box || box.w < 2) return { ok: false, reason: 'nav button not laid out (zero size) or missing' };
    await page.mouse.click(box.x, box.y);
    return { ok: true, box };
  };

  /* Prove the lock was held for the WHOLE window, not just at launch: re-check
   * ownership at both edges and require our own token to be present at the end. */
  const lockOwnership = () => {
    const st = lockStatus();
    const mine = !!(STATE.lock?.token && st.held && st.owner?.token === STATE.lock.token);
    return { held: st.held, mine, owner: st.owner?.agent ?? null, ownerTokenMatches: mine };
  };

  const collectWindow = async (page, cdp, pageHttp, pageWs, m, tStart, tEnd, label) => {
    const snap = await metricsSnap(cdp);
    const taken = await page.evaluate((mm) => window.__tp.take(mm), m);
    const domNodes = await page.evaluate(() => document.getElementsByTagName('*').length);
    const hidden = await page.evaluate(() => document.hidden);
    const fs_ = frameStats(taken.deltas);
    const sec = Math.max(0.001, (tEnd - tStart) / 1000);

    const wWs = pageWs.frames.filter((f) => f.at >= tStart && f.at <= tEnd);
    const env = {}, pay = {}, sub = {}, payDir = {};
    for (const f of wWs) {
      if (f.dir !== 'recv') continue;
      bump(env, f.envelope); bump(pay, f.payloadType); if (f.subType) bump(sub, f.subType);
      bump(payDir, `${f.url?.includes('events.host') ? 'host' : 'mux'}:${f.payloadType}`);
    }
    const wHttp = pageHttp.filter((h) => h.at >= tStart && h.at <= tEnd);
    // response bodies are read asynchronously; give them a bounded chance to settle
    const pending = wHttp.filter((h) => h.bodyPromise && !h.bodySettled);
    if (pending.length) await Promise.race([Promise.all(pending.map((h) => h.bodyPromise)), sleep(1500)]);
    const usage = wHttp.filter((h) => h.kind === 'response' && h.usage?.isUsageHttp);

    const expectedFrames = Math.floor((tEnd - tStart) / 16.7);
    const reasons = [];
    if (hidden) reasons.push('document.hidden during window (rAF may be throttled)');
    if (fs_.n < expectedFrames * 0.5) reasons.push(`frame-count-low:${fs_.n}<${Math.floor(expectedFrames * 0.5)} (possible throttling)`);
    if (wWs.length === 0) reasons.push('no-ws-frames-in-window');

    const concEnd = concurrencySample();
    const lockEnd = lockOwnership();
    if (m.lockStart) { m.lockStart.ok = m.lockStart && m.lockStart.mine; }
    const lockOk = !!(m.lockStart?.mine && lockEnd.mine);
    if (!lockOk) reasons.push(`lock-not-held-for-whole-window:start=${JSON.stringify(m.lockStart)} end=${JSON.stringify(lockEnd)}`);

    /* Concurrency gate: any OTHER browser alive at either edge means this
     * window's jank numbers are polluted and must not be used for a verdict. */
    const concStart = m.concStart ?? null;
    const worst = Math.max(concStart?.concurrentBrowserInstances ?? 0, concEnd.concurrentBrowserInstances);
    const exclusive = worst === 0;
    if (!exclusive) reasons.push(`concurrent-browsers-during-window:max=${worst} (lock was ${STATE.lock?.token ? 'HELD by us' : 'not held'} -> lock violated by another line)`);

    return {
      label, windowMs: tEnd - tStart, seconds: r3(sec),
      lock: { heldForWholeWindow: lockOk, atStart: m.lockStart ?? null, atEnd: lockEnd },
      concurrency: { exclusiveForWholeWindow: exclusive, maxConcurrentBrowserInstances: worst, atStart: concStart, atEnd: concEnd },
      cdpRawStart: m.snap, cdpRawEnd: snap,
      frames: fs_, domNodes, documentHidden: hidden,
      longtasks: {
        n: taken.longtasks.length,
        totalMs: r3(taken.longtasks.reduce((a, b) => a + b.duration, 0)),
        maxMs: taken.longtasks.length ? r3(Math.max(...taken.longtasks.map((x) => x.duration))) : 0,
        entries: taken.longtasks.slice(0, 40).map((x) => ({ start: r3(x.start), duration: r3(x.duration) })),
      },
      ws: {
        totalFramesRecv: wWs.filter((f) => f.dir === 'recv').length,
        totalFramesSent: wWs.filter((f) => f.dir === 'sent').length,
        recvBytes: wWs.filter((f) => f.dir === 'recv').reduce((a, b) => a + b.bytes, 0),
        byEnvelopePerSec: rateOf(env, sec),
        byPayloadTypePerSec: rateOf(pay, sec),
        byPayloadSubTypePerSec: rateOf(sub, sec),
        bySocketAndPayloadPerSec: rateOf(payDir, sec),
      },
      http: {
        total: wHttp.length,
        usageSamples: usage.map((u) => {
          const ct = page._usageTiming?.get(u.usage.rpcId) || {};
          return { path: u.path, method: u.usage.method, rpcId: u.usage.rpcId, granularity: u.usage.granularity, status: u.status,
            wallMs: u.wallMs, wallMsFallback: u.wallMsFallback ?? null,
            wallToHeadersMs: ct.wallToHeadersMs ?? null, wallToBodyMs: ct.wallToBodyMs ?? null,
            bodyBytes: u.bodyBytes, envelopeOk: u.envelopeOk ?? null, bodyResultOk: u.bodyResultOk ?? null };
        }),
      },
      _rawTaken: taken.deltas.length,
      reasons,
    };
  };

  /* ------------------------------------------------------- PHASE: tab map */

  if (PHASE === 'all' || PHASE === 'map' || PHASE === 'profile') {
    const page = await newPage('map');
    await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(5000);
    const closedBaselineStart = Date.now();
    const mClosed = await page.evaluate(() => window.__tp.mark());
    mClosed.snap = await metricsSnap(page._cdp); mClosed.lockStart = lockOwnership(); mClosed.concStart = concurrencySample();
    await sleep(5000);
    const closedSnap = await collectWindow(page, page._cdp, page._http, page._ws, mClosed, closedBaselineStart, Date.now(), 'home-settings-closed');
    {
      const cd = metricDelta(mClosed.snap, closedSnap.cdpRawEnd);
      closedSnap.cdpDeltaMs = cd.delta;
      closedSnap.reasons.push(...cd.reasons);
      closedSnap.valid = cd.reasons.length === 0;
      closedSnap.status = closedSnap.valid ? 'PASS' : 'INVALID';
    }
    result.baseline.push(closedSnap);

    const opened = await openSettings(page);
    await sleep(1200);
    result.tabMap = {
      opened,
      navStructure: await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        const nav = dlg ? dlg.querySelector('nav') : null;
        const content = nav ? nav.nextElementSibling : null;
        return {
          dialogPresent: !!dlg, dialogRole: dlg?.getAttribute('role') ?? null,
          navTag: nav?.tagName ?? null, navChildButtons: nav ? nav.querySelectorAll('button').length : 0,
          navButtonsHaveRoleTab: nav ? [...nav.querySelectorAll('button')].filter((b) => b.getAttribute('role') === 'tab').length : 0,
          navButtonAriaSelected: nav ? [...nav.querySelectorAll('button')].filter((b) => b.hasAttribute('aria-selected')).length : 0,
          navButtonDataState: nav ? [...nav.querySelectorAll('button')].filter((b) => b.hasAttribute('data-state')).length : 0,
          firstButtonClass: nav ? [...nav.querySelectorAll('button')].map((b) => (b.className || '').toString()) : [],
          contentTag: content?.tagName ?? null,
          contentNodes: content ? content.getElementsByTagName('*').length : 0,
          contentTextHead: content ? content.textContent.trim().replace(/\s+/g, ' ').slice(0, 200) : null,
          activeMarker: window.__tp.activeMarker(),
          labels: nav ? [...nav.querySelectorAll('button')].map((b) => (b.textContent || '').trim().replace(/\s+/g, ' ')) : [],
        };
      }),
      perTab: [],
    };
    // visit each tab once, record signature + whether switching works at all
    for (const t of TABS) {
      const nav = await findNav(page, t.match);
      if (nav.status !== 'FOUND') { result.tabMap.perTab.push({ id: t.id, label: t.label, nav, status: 'NOT-FOUND' }); continue; }
      const before = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        const nav = dlg.querySelector('nav'); const c = nav.nextElementSibling;
        return { text: c.textContent, nodes: c.getElementsByTagName('*').length, active: window.__tp.activeMarker() };
      });
      const armRes = await page.evaluate(() => window.__tp.arm());
      const clicked = await clickNav(page, nav.index);
      await sleep(1200);
      const after = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        const nav = dlg.querySelector('nav'); const c = nav.nextElementSibling;
        return { text: c.textContent, nodes: c.getElementsByTagName('*').length, active: window.__tp.activeMarker(), contentTextHead: c.textContent.trim().replace(/\s+/g, ' ').slice(0, 220) };
      });
      const probe = await page.evaluate(() => ({ firstMut: window.__tp.firstMut, firstMutClean: window.__tp.firstMutClean, firstText: window.__tp.firstText, clickT0: window.__tp.clickT0 }));
      const openMs = (probe.clickT0 != null && probe.firstText != null) ? r3(probe.firstText - probe.clickT0) : null;
      const openMsClean = (probe.clickT0 != null && probe.firstMutClean != null) ? r3(probe.firstMutClean - probe.clickT0) : null;
      await page.evaluate(() => window.__tp.settle());
      const changed = before.text !== after.text;
      const activeMoved = before.active.index !== after.active.index;
      result.tabMap.perTab.push({
        id: t.id, label: t.label, nav, clicked, armRes, status: (changed && after.nodes > 0) ? 'SWITCHED' : 'NOT-FOUND',
        openMs, openMsClean, textChanged: changed, activeMoved,
        beforeNodes: before.nodes, afterNodes: after.nodes, afterActiveLabel: after.active.label,
        contentTextHead: after.contentTextHead,
      });
      flush();
      if (OVER_BUDGET()) { result.aborted = true; break; }
    }
    await page._ctx.close();
    flush();
  }

  /* --------------------------------------------------- PHASE: per-tab runs */

  if ((PHASE === 'all' || PHASE === 'profile') && !result.aborted) {
    const page = await newPage('profile');
    await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(5000);

    // same-page closed-settings baseline: the ambient noise floor this host is under
    {
      const t = Date.now();
      const mm = await page.evaluate(() => window.__tp.mark());
      mm.snap = await metricsSnap(page._cdp); mm.lockStart = lockOwnership(); mm.concStart = concurrencySample();
      await sleep(W1_MS);
      const b = await collectWindow(page, page._cdp, page._http, page._ws, mm, t, Date.now(), 'profile-page-home-settings-closed-w1_10s');
      const cd = metricDelta(mm.snap, b.cdpRawEnd);
      b.cdpDeltaMs = cd.delta; b.reasons.push(...cd.reasons);
      b.valid = cd.reasons.length === 0; b.status = b.valid ? 'PASS' : 'INVALID';
      result.baseline.push(b);
      flush();
    }

    await openSettings(page);
    await sleep(1500);

    // park tab = the tab we always switch away from. 通用设置 is the surface's
    // default tab, so parking ON it while measuring it would be a no-op switch.
    const generalIdx = (await findNav(page, '通用设置')).index;
    const modelsIdx = (await findNav(page, '模型')).index;
    const parkIdx = generalIdx;
    const altParkIdx = modelsIdx;
    const run = async (tab, repeat, mode) => {
      const nav = await findNav(page, tab.match);
      const rec = {
        id: tab.id, label: tab.label, repeat, mode, startedAt: new Date().toISOString(),
        nav, valid: true, invalidReasons: [], openMs: null, openMsClean: null,
        panels: {}, windows: [], http: {}, errors: [],
      };
      if (nav.status !== 'FOUND') {
        rec.valid = false; rec.status = 'NOT-FOUND';
        rec.invalidReasons.push(`nav lookup failed: ${nav.reason}`);
        return rec;
      }
      // park elsewhere first (unless measuring first mount of this tab)
      if (mode !== 'first-mount') {
        const target = nav.index === parkIdx ? altParkIdx : parkIdx;
        const cur = await page.evaluate(() => window.__tp.activeMarker());
        rec.parkedAt = { index: target, label: (await findNav(page, target === parkIdx ? '通用设置' : '模型')).text ?? null };
        if (cur.index === nav.index || cur.index !== target) { await clickNav(page, target); await sleep(PARK_MS); }
        else await sleep(300);
      }

      const pre = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        const nav = dlg.querySelector('nav'); const c = nav.nextElementSibling;
        return { text: c.textContent, nodes: c.getElementsByTagName('*').length, active: window.__tp.activeMarker() };
      });
      rec.panels.before = { nodes: pre.nodes, activeLabel: pre.active.label, textHead: pre.text.trim().replace(/\s+/g, ' ').slice(0, 160) };
      if (pre.nodes === 0) { rec.valid = false; rec.invalidReasons.push('panel-before: content container has 0 nodes (settings surface not mounted)'); }

      const armRes = await page.evaluate(() => window.__tp.arm());
      rec.panels.arm = armRes;
      const httpMark = page._http.length;
      const wsMark = page._ws.frames.length;
      log('  arm', tab.id, 'r' + repeat, JSON.stringify(armRes));

      const clicked = await clickNav(page, nav.index);
      if (!clicked.ok) { rec.valid = false; rec.invalidReasons.push(`click failed: ${clicked.reason}`); return rec; }
      log('  clicked', tab.id, 'r' + repeat);

      // wait for the panel signature (bounded)
      const t0 = Date.now();
      let probe = null;
      while (Date.now() - t0 < 4000) {
        probe = await page.evaluate(() => ({ firstMut: window.__tp.firstMut, firstMutClean: window.__tp.firstMutClean, firstText: window.__tp.firstText, clickT0: window.__tp.clickT0 }));
        if (probe.firstText != null) break;
        await sleep(100);
      }
      rec.openMs = (probe?.clickT0 != null && probe?.firstText != null) ? r3(probe.firstText - probe.clickT0) : null;
      rec.openMsClean = (probe?.clickT0 != null && probe?.firstMutClean != null) ? r3(probe.firstMutClean - probe.clickT0) : null;
      rec.openProbe = probe;
      if (rec.openMs == null) { rec.valid = false; rec.invalidReasons.push('open-latency-unmeasured: content text never changed within 4s after click'); }
      await page.evaluate(() => window.__tp.settle());

      const post = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"]');
        const nav = dlg.querySelector('nav'); const c = nav.nextElementSibling;
        return {
          nodes: c.getElementsByTagName('*').length, active: window.__tp.activeMarker(),
          textHead: c.textContent.trim().replace(/\s+/g, ' ').slice(0, 220),
          dialogNodes: dlg.getElementsByTagName('*').length,
        };
      });
      rec.panels.after = { nodes: post.nodes, activeLabel: post.active.label, textHead: post.textHead, dialogNodes: post.dialogNodes };
      if (post.nodes === 0) { rec.valid = false; rec.invalidReasons.push('panel-after: content container has 0 nodes (panel did not self-prove mounted)'); }
      if (post.active.index !== nav.index) { rec.valid = false; rec.invalidReasons.push(`active-marker-did-not-move: expected nav index ${nav.index}, observed ${post.active.index} (${post.active.label})`); }
      rec.status = rec.invalidReasons.length ? 'INVALID' : 'PASS';
      log('  panel', tab.id, 'r' + repeat, 'nodes', post.nodes, 'active', post.active.index, 'openMs', rec.openMs);

      // window 1 (10s) then window 2 (20s)
      let mStart = await page.evaluate(() => window.__tp.mark());
      let snapStart = await metricsSnap(page._cdp);
      mStart.snap = snapStart; mStart.lockStart = lockOwnership(); mStart.concStart = concurrencySample();
      let tStart = Date.now();
      await sleep(W1_MS);
      const w1 = await collectWindow(page, page._cdp, page._http, page._ws, mStart, tStart, Date.now(), `${tab.id}-r${repeat}-w1_${W1_MS / 1000}s`);
      const md1 = metricDelta(snapStart, w1.cdpRawEnd);
      w1.cdpDeltaMs = md1.delta; w1.reasons.push(...md1.reasons);
      if (md1.reasons.length) rec.valid = false;
      rec.invalidReasons.push(...md1.reasons);
      rec.windows.push(w1);
      flush();  // survive a hang: window 1 is already durable

      mStart = await page.evaluate(() => window.__tp.mark());
      snapStart = await metricsSnap(page._cdp);
      mStart.snap = snapStart; mStart.lockStart = lockOwnership(); mStart.concStart = concurrencySample();
      tStart = Date.now();
      await sleep(W2_MS);
      const w2 = await collectWindow(page, page._cdp, page._http, page._ws, mStart, tStart, Date.now(), `${tab.id}-r${repeat}-w2_${W2_MS / 1000}s`);
      const md2 = metricDelta(snapStart, w2.cdpRawEnd);
      w2.cdpDeltaMs = md2.delta; w2.reasons.push(...md2.reasons);
      if (md2.reasons.length) rec.valid = false;
      rec.invalidReasons.push(...md2.reasons);
      rec.windows.push(w2);
      flush();

      rec.http = {
        requests: page._http.slice(httpMark).map((h) => ({ kind: h.kind, path: h.path, method: h.method, status: h.status, wallMs: h.wallMs, bodyBytes: h.bodyBytes, envelopeOk: h.envelopeOk, bodyResultOk: h.bodyResultOk })),
        usageSamples: page._http.slice(httpMark).filter((h) => h.kind === 'response' && h.usage?.isUsageHttp).map((h) => ({ path: h.path, rpcMethod: h.usage.method, rpcId: h.usage.rpcId, status: h.status, wallMs: h.wallMs, bodyBytes: h.bodyBytes, envelopeOk: h.envelopeOk, bodyResultOk: h.bodyResultOk, payloadKeys: h.usage.payloadKeys, granularity: h.usage.granularity })),
      };
      rec.wsSockets = [...new Set(page._ws.frames.slice(wsMark).map((f) => f.url))];
      rec.errors = await page.evaluate(() => { const e = window.__tp.pageErrors.slice(0, 20); window.__tp.clearErr(); return e; });
      rec.invalidReasons = [...new Set(rec.invalidReasons)];
      if (rec.invalidReasons.length) rec.valid = false;
      rec.status = rec.valid ? 'PASS' : 'INVALID';
      return rec;
    };

    const PROFILE_TABS = TAB_FILTER ? TABS.filter((t) => TAB_FILTER.includes(t.id)) : TABS;
    for (const tab of PROFILE_TABS) {
      if (OVER_BUDGET()) { result.aborted = true; log('BUDGET EXHAUSTED before', tab.id); break; }
      for (let r = 1; r <= REPEATS; r++) {
        if (OVER_BUDGET()) { result.aborted = true; log('BUDGET EXHAUSTED before', tab.id, 'r' + r); break; }
        log('RUN start', tab.id, 'r' + r);
        /* Attempt loop: when --require-exclusive is on, a window that saw any
         * OTHER browser is discarded and the whole switch+dwell is redone. Every
         * attempt is retained in retryAttempts so a discarded one is auditable. */
        const attempts = [];
        let rec = null;
        for (let a = 1; a <= MAX_ATTEMPTS; a++) {
          let cur;
          try {
            cur = await run(tab, r, 'repeat');
          } catch (e) {
            cur = {
              id: tab.id, label: tab.label, repeat: r, mode: 'repeat', attempt: a, startedAt: new Date().toISOString(),
              valid: false, status: 'ERROR', windows: [], invalidReasons: [`harness-error: ${String(e).slice(0, 200)}`], openMs: null, openMsClean: null,
            };
            log('RUN error', tab.id, 'r' + r, String(e).slice(0, 160));
          }
          cur.attempt = a;
          attempts.push(cur);
          const dirty = (cur.windows || []).some((w) => w.concurrency && !w.concurrency.exclusiveForWholeWindow);
          const maxConc = Math.max(0, ...(cur.windows || []).map((w) => w.concurrency?.maxConcurrentBrowserInstances ?? 0));
          log(`  attempt ${a}/${MAX_ATTEMPTS} ${tab.id} r${r}: status=${cur.status} maxConcurrentBrowsers=${maxConc} exclusive=${!dirty}`);
          if (!REQUIRE_EXCLUSIVE || !dirty || a === MAX_ATTEMPTS) { rec = cur; break; }
          log(`  -> polluted by ${maxConc} other browser(s); re-measuring this tab`);
          await sleep(2500);
        }
        rec.retryAttempts = attempts.map((x) => ({
          attempt: x.attempt, status: x.status, openMs: x.openMs, openMsClean: x.openMsClean,
          maxConcurrentBrowserInstances: Math.max(0, ...(x.windows || []).map((w) => w.concurrency?.maxConcurrentBrowserInstances ?? 0)),
          exclusiveForWholeRun: (x.windows || []).every((w) => w.concurrency?.exclusiveForWholeWindow === true),
          invalidReasons: x.invalidReasons,
        }));
        if (REQUIRE_EXCLUSIVE && attempts.length === MAX_ATTEMPTS) {
          const last = attempts[attempts.length - 1];
          if ((last.windows || []).some((w) => w.concurrency && !w.concurrency.exclusiveForWholeWindow)) {
            rec.valid = false;
            rec.status = 'INVALID';
            rec.invalidReasons = [...new Set([...(rec.invalidReasons || []), `exclusive-retry-exhausted:${MAX_ATTEMPTS} attempts all saw other browsers alive`])];
          }
        }
        result.runs.push(rec);
        flush();
        log('RUN done', tab.id, 'r' + r, rec.status, 'openMs=' + rec.openMs, 'clean=' + rec.openMsClean,
          'w1=' + JSON.stringify(rec.windows?.[0]?.cdpDeltaMs ? { s: rec.windows[0].cdpDeltaMs.ScriptDuration, r: rec.windows[0].cdpDeltaMs.RecalcStyleDuration, o50: rec.windows[0].frames.over50, lt: rec.windows[0].longtasks.n } : null));
        // per-tab raw file
        const per = path.join(RAW, `tab-${String(TABS.indexOf(tab) + 1).padStart(2, '0')}-${tab.id}.json`);
        const prev = fs.existsSync(per) ? JSON.parse(fs.readFileSync(per, 'utf8')) : { id: tab.id, label: tab.label, runs: [] };
        prev.runs = prev.runs.filter((x) => x.repeat !== r).concat([rec]).sort((a, b) => a.repeat - b.repeat);
        fs.writeFileSync(per, JSON.stringify(prev, null, 1));
      }
      // park back to general between tabs to keep the switch cost comparable
      await clickNav(page, parkIdx).catch(() => { });
      await sleep(800);
    }
    await page._ctx.close();
    flush();
  }

  /* ------------------------------------------------------- PHASE: plugins */

  if ((PHASE === 'all' || PHASE === 'plugins') && !result.aborted) {
    const page = await newPage('plugins');
    await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(5000);
    await openSettings(page);
    await sleep(1200);

    const pluginsNav = await findNav(page, '插件');
    // make sure no other tab has been visited, then first-mount 插件
    const httpMark = page._http.length;
    const armRes = await page.evaluate(() => window.__tp.arm());
    const clicked = pluginsNav.status === 'FOUND' ? await clickNav(page, pluginsNav.index) : { ok: false, reason: pluginsNav.reason };
    const t0 = Date.now();
    let probe = null, firstMountMs = null;
    while (Date.now() - t0 < 6000) {
      probe = await page.evaluate(() => ({ firstMut: window.__tp.firstMut, firstMutClean: window.__tp.firstMutClean, firstText: window.__tp.firstText, clickT0: window.__tp.clickT0 }));
      if (probe.firstText != null) break;
      await sleep(100);
    }
    firstMountMs = (probe?.clickT0 != null && probe?.firstText != null) ? r3(probe.firstText - probe.clickT0) : null;
    await page.evaluate(() => window.__tp.settle());

    // W1: the first-mount window (covers the initial 9 /usage/* calls)
    let mStart = await page.evaluate(() => window.__tp.mark());
    let snapStart = await metricsSnap(page._cdp);
    mStart.snap = snapStart; mStart.lockStart = lockOwnership(); mStart.concStart = concurrencySample();
    let tStart = Date.now();
    await sleep(W1_MS);
    const fm = await collectWindow(page, page._cdp, page._http, page._ws, mStart, tStart, Date.now(), 'plugins-firstmount-w1_10s');
    let md = metricDelta(snapStart, fm.cdpRawEnd);
    fm.cdpDeltaMs = md.delta; fm.reasons.push(...md.reasons);

    const fmHttp = page._http.slice(httpMark);
    const fmUsage = fmHttp.filter((h) => h.kind === 'response' && h.usage?.isUsageHttp);
    const fmUsageFailed = fmHttp.filter((h) => (h.kind === 'failed') && h.usage?.isUsageHttp);
    const usageValidity = (u) => {
      const r = [];
      if (u.status == null) r.push('no-response (bare URL sample)');
      if (u.status >= 400) r.push(`http-status-${u.status}`);
      if (u.envelopeOk !== true) r.push(`bad-envelope:${u.envelopeOk}`);
      if (u.bodyResultOk === false) r.push(`rpc-error-body:${u.bodyErrorCode ?? 'unknown'}`);
      return r;
    };
    const firstMountUsage = fmUsage.map((u) => {
      const ct = page._usageTiming?.get(u.usage.rpcId) || {};
      return {
        path: u.path, rpcMethod: u.usage.method, rpcId: u.usage.rpcId, granularity: u.usage.granularity,
        status: u.status, wallMs: u.wallMs, wallMsFallback: u.wallMsFallback ?? null,
        wallToHeadersMs: ct.wallToHeadersMs ?? null, wallToBodyMs: ct.wallToBodyMs ?? null,
        bodyBytes: u.bodyBytes, contentLengthHeader: u.contentLengthHeader,
        envelopeOk: u.envelopeOk, bodyResultOk: u.bodyResultOk,
        invalidReasons: usageValidity(u), valid: usageValidity(u).length === 0,
      };
    });

    result.plugins.firstMount = {
      at: new Date().toISOString(), nav: pluginsNav, clicked, armRes, firstMountMs, openProbe: probe,
      window: fm,
      usageHttpRequests: fmHttp.map((h) => ({ kind: h.kind, path: h.path, method: h.method, status: h.status, wallMs: h.wallMs, bodyBytes: h.bodyBytes, usage: h.usage?.method ?? null })),
      usageSamples: firstMountUsage,
      usageValidCount: firstMountUsage.filter((u) => u.valid).length,
      usageInvalidCount: firstMountUsage.filter((u) => !u.valid).length,
      usageFailedRequests: fmUsageFailed.map((h) => ({ path: h.path, error: h.error })),
      invalidReasons: [...new Set([...(firstMountMs == null ? ['open-latency-unmeasured'] : []), ...md.reasons, ...fm.reasons])],
    };
    flush();

    // 60s polling window: expect a second loadAll burst at ~60s (refreshSec default 60)
    const pollMarkHttp = page._http.length;
    mStart = await page.evaluate(() => window.__tp.mark());
    snapStart = await metricsSnap(page._cdp);
    mStart.snap = snapStart; mStart.lockStart = lockOwnership(); mStart.concStart = concurrencySample();
    tStart = Date.now();
    const subWindows = [];
    for (let i = 0; i < 6; i++) {
      const ws0 = Date.now();
      const mm = await page.evaluate(() => window.__tp.mark());
      const ss = await metricsSnap(page._cdp);
      mm.snap = ss; mm.lockStart = lockOwnership(); mm.concStart = concurrencySample();   // collectWindow reads m.snap as cdpRawStart
      await sleep(10_000);
      const sub = await collectWindow(page, page._cdp, page._http, page._ws, mm, ws0, Date.now(), `plugins-poll-10s-${i + 1}`);
      const sd = metricDelta(ss, sub.cdpRawEnd);
      sub.cdpDeltaMs = sd.delta; sub.reasons.push(...sd.reasons);
      subWindows.push(sub);
    }
    const pollHttp = page._http.slice(pollMarkHttp);
    const pollUsage = pollHttp.filter((h) => h.kind === 'response' && h.usage?.isUsageHttp);
    const pollStart = tStart;
    result.plugins.poll60 = {
      at: new Date().toISOString(), windowMs: Date.now() - pollStart,
      subWindows,
      usageSamples: pollUsage.map((u) => {
        const inv = usageValidity(u);
        const ct = page._usageTiming?.get(u.usage.rpcId) || {};
        return { path: u.path, rpcMethod: u.usage.method, rpcId: u.usage.rpcId, granularity: u.usage.granularity, atOffsetMs: u.at - pollStart, status: u.status, wallMs: u.wallMs, wallMsFallback: u.wallMsFallback ?? null, wallToHeadersMs: ct.wallToHeadersMs ?? null, wallToBodyMs: ct.wallToBodyMs ?? null, bodyBytes: u.bodyBytes, envelopeOk: u.envelopeOk, bodyResultOk: u.bodyResultOk, invalidReasons: inv, valid: inv.length === 0 };
      }),
      usageValidCount: pollUsage.filter((u) => usageValidity(u).length === 0).length,
      usageInvalidCount: pollUsage.filter((u) => usageValidity(u).length !== 0).length,
      windowCdpDeltaMs: (() => { const a = subWindows[0]?.cdpRawStart, b = subWindows[subWindows.length - 1]?.cdpRawEnd; if (!a || !b) return null; const d = {}; for (const n of ['ScriptDuration', 'TaskDuration', 'RecalcStyleDuration', 'LayoutDuration']) d[n] = r3((b[n] - a[n]) * 1000); return d; })(),
    };
    flush();

    // switch away and come back: does it re-fetch all 9 usage RPCs?
    const away = (await findNav(page, '通用设置')).index;
    const backMarkHttp = page._http.length;
    await clickNav(page, away);
    await sleep(4000);
    const duringAway = page._http.slice(backMarkHttp).filter((h) => h.kind === 'response' && h.usage?.isUsageHttp);
    const armRes2 = await page.evaluate(() => window.__tp.arm());
    const clicked2 = await clickNav(page, pluginsNav.index);
    const t1 = Date.now();
    let probe2 = null;
    while (Date.now() - t1 < 6000) {
      probe2 = await page.evaluate(() => ({ firstMut: window.__tp.firstMut, firstMutClean: window.__tp.firstMutClean, firstText: window.__tp.firstText, clickT0: window.__tp.clickT0 }));
      if (probe2.firstText != null) break;
      await sleep(100);
    }
    const returnMs = (probe2?.clickT0 != null && probe2?.firstText != null) ? r3(probe2.firstText - probe2.clickT0) : null;
    await page.evaluate(() => window.__tp.settle());
    let mStart2 = await page.evaluate(() => window.__tp.mark());
    let snapStart2 = await metricsSnap(page._cdp);
    mStart2.snap = snapStart2; mStart2.lockStart = lockOwnership(); mStart2.concStart = concurrencySample();
    const rt0 = Date.now();
    await sleep(W1_MS);
    const retWin = await collectWindow(page, page._cdp, page._http, page._ws, mStart2, rt0, Date.now(), 'plugins-return-w1_10s');
    const rd = metricDelta(snapStart2, retWin.cdpRawEnd);
    retWin.cdpDeltaMs = rd.delta; retWin.reasons.push(...rd.reasons);
    const returnHttp = page._http.slice(backMarkHttp);

    result.plugins.return = {
      at: new Date().toISOString(), armRes: armRes2, clicked: clicked2, returnMs, openProbe: probe2,
      window: retWin,
      usageWhileAway: duringAway.map((u) => ({ path: u.path, rpcMethod: u.usage.method, status: u.status, wallMs: u.wallMs, bodyBytes: u.bodyBytes })),
      usageOnReturn: returnHttp.filter((h) => h.kind === 'response' && h.usage?.isUsageHttp).map((u) => {
        const inv = usageValidity(u);
        const ct = page._usageTiming?.get(u.usage.rpcId) || {};
        return { path: u.path, rpcMethod: u.usage.method, rpcId: u.usage.rpcId, granularity: u.usage.granularity, status: u.status, wallMs: u.wallMs, wallToHeadersMs: ct.wallToHeadersMs ?? null, wallToBodyMs: ct.wallToBodyMs ?? null, bodyBytes: u.bodyBytes, envelopeOk: u.envelopeOk, invalidReasons: inv, valid: inv.length === 0 };
      }),
      remountRefetched: returnHttp.filter((h) => h.kind === 'response' && h.usage?.isUsageHttp).length > 0,
      invalidReasons: [...new Set([...(returnMs == null ? ['open-latency-unmeasured'] : []), ...rd.reasons, ...retWin.reasons])],
    };
    flush();
    await page._ctx.close();
  }

  result.lock.heldAcrossWholeRun = lockOwnership().mine;
  result.lock.released = releaseLock(STATE.lock.token, log);
  await browser.close();
  STATE.browser = null;
  result.meta.elapsedMs = Date.now() - START;
  result.meta.lock = result.lock;   // single source, mirrored for convenience
  flush();
  console.log(JSON.stringify({
    batch: BATCH,
    lock: result.lock,
    elapsedMs: result.meta.elapsedMs, aborted: result.aborted,
    tabMapStatuses: result.tabMap?.perTab?.map((t) => ({ t: t.label, s: t.status, openMs: t.openMs, nodes: t.afterNodes })),
    runs: result.runs.map((r) => ({ t: r.label, rep: r.repeat, s: r.status, openMs: r.openMs, w1: r.windows[0]?.frames, w2: r.windows[1]?.frames, reasons: r.invalidReasons })),
    plugins: result.plugins.firstMount ? {
      firstMountMs: result.plugins.firstMount.firstMountMs,
      usage: result.plugins.firstMount.usageSamples.map((u) => `${u.rpcMethod} ${u.status} ${u.wallMs}ms ${u.bodyBytes}B valid=${u.valid}`),
      pollUsage: result.plugins.poll60.usageSamples.length,
      returnMs: result.plugins.return.returnMs,
      remountRefetched: result.plugins.return.remountRefetched,
    } : null,
  }, null, 1));
}

main().catch(async (e) => {
  console.error('FATAL', e);
  try { if (STATE.browser) await STATE.browser.close(); } catch { }
  try { if (STATE.lock?.token) releaseLock(STATE.lock.token, log); } catch { }
  process.exit(1);            // never leave a browser + lock behind on a crash
});
