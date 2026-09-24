#!/usr/bin/env node
/*
 * panel-compare.mjs — "why are only these two expensive?" cross-panel comparison.
 *
 * Instrument: REAL Google Chrome (channel:'chrome'), same page, same viewport,
 * same window conditions. Each item >=3 reps; each rep is a brand-new browser
 * context (cold profile) -> fresh page -> open Settings -> walk every section.
 *
 * Four independent observation channels (so a "no difference" result is not
 * just "my channel is blind"):
 *   1. in-page: rAF frame series, LongTask, LoAF, mutation settle, DOM census,
 *      React commit/unmount/PerformedWork counts (addInitScript probe).
 *   2. CDP Performance.getMetrics deltas  (script / layout / recalc-style).
 *   3. CDP Network  -> authoritative RPC list + durations per phase.
 *   4. CDP Tracing  -> paint / raster / composite / layout attribution per
 *      phase, sliced by in-page console.timeStamp boundary markers.
 *
 * READ-ONLY discipline: the only interactions are the Settings trigger, the
 * settings nav cells, the plugin tabs, the Close button, and scrolling. No
 * save/apply/delete. Never signals another process.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

// ---------------------------------------------------------------------------
// exec-mask variant of incident2/why-these-two/tools/panel-compare.mjs.
// The instrument (probe, phase sequence, phase names, metric extraction, the
// four observation channels, the A-B-A in-page ablation) is UNCHANGED, so
// phase-to-phase comparison against audit.md §6.2 stays legitimate.
// Exactly two capabilities were added:
//   1. --bundlePatch <abs path to client.js>  : context.route() serves those
//      bytes for /plugins/@deepseek-ai/dsh-client-ui-settings-general/client.js
//   2. --arms normal,patch,normal2            : the arms run back-to-back inside
//      ONE browser launch / ONE lock hold; only same-rep arm-to-arm pairing is
//      used for judgement (never cross-batch absolute comparisons).
// ---------------------------------------------------------------------------
function argDir() {
  const i = process.argv.indexOf('--dir');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : '/home/CNS2026495165/dsh/.workspace/lag-fix/exec-mask';
}
const DIR = argDir();
const RAW = path.join(DIR, 'raw', 'harness');
const LOGS = path.join(DIR, 'logs');
const SHOTS = path.join(DIR, 'shots');
const PROBE = fs.readFileSync(path.join(DIR, 'tools', 'inpage-probe.js'), 'utf8');
const URL_ = process.env.DSH_URL || 'http://127.0.0.1:3080';

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const ORDER = argOf('--order', 'A');
const REPS = Math.max(1, Number(argOf('--reps', '3')));
const RUN = argOf('--run', 'r1');
const BROWSER = argOf('--browser', 'chrome-headless');
const VW = Number(argOf('--vw', '1440'));
const VH = Number(argOf('--vh', '900'));
const DSF = Number(argOf('--dsf', '2'));
const SETTLE_MS = Number(argOf('--settle', '3000'));
const SCROLL_MS = Number(argOf('--scroll-ms', '2500'));
const IDLE_MS = Number(argOf('--idle-ms', '4000'));
const CLICK_TIMEOUT = Number(argOf('--click-timeout', '10000'));
const SKIP_TRACE = argv.includes('--skip-trace');
const ABLATE = argOf('--ablate', 'none');   // none | mask | wallpaper | both

// ---- added for exec-mask: real bundle swap via request interception ---------
const BUNDLE_PATH = '/plugins/@deepseek-ai/dsh-client-ui-settings-general/client.js';
const BUNDLE_URL = URL_ + BUNDLE_PATH;
const BUNDLE_RE = /\/plugins\/@deepseek-ai\/dsh-client-ui-settings-general\/client\.js/;
const BUNDLE_PATCH = argOf('--bundlePatch', null);
const ARMS = argOf('--arms', BUNDLE_PATCH ? 'normal,patch,normal2' : 'normal').split(',').map((s) => s.trim()).filter(Boolean);
const SHOT_MODE = argv.includes('--shots');
const SHOT_REP = Number(argOf('--shot-rep', '1'));   // shoot only in this rep (keeps PNG volume bounded)
const PATCH_BYTES = BUNDLE_PATCH ? fs.readFileSync(BUNDLE_PATCH) : null;
const PATCH_SHA = PATCH_BYTES ? crypto.createHash('sha256').update(PATCH_BYTES).digest('hex') : null;
const PREIMAGE_SHA = (() => {
  for (const p of [path.join(DIR, 'preimage', 'client.js.pre'), path.join(DIR, 'preimage', 'client.js')]) {
    try { return { path: p, sha256: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') }; } catch { /* next */ }
  }
  return null;
})();

// Walk EVERY registered settings section: the user's two suspects (通用设置 /
// 插件) plus the other six sections, which form the natural control group for
// "why only these two are expensive".
const ORDER_MAP = { A: 'nav', B: 'nav' };
const SECTIONS_ARG = argOf('--sections', 'nav');
const NAV_ORDER_MAP = { A: 'nav', B: 'nav' };

const SEL = {
  trigger: 'div[class$="_settingsArea"] button[aria-haspopup="dialog"]',
  panel: 'div.VOzbGW_panel[role="dialog"][aria-modal="true"]',
  close: 'div.VOzbGW_panel button[class$="_close"]',
  navCells: 'div[class$="_navList"] button',
  tabs: 'button[class$="_tab"]',
};

const TRACE_KEEP = new Set([
  'Paint', 'RasterTask', 'CompositeLayers', 'UpdateLayerTree', 'Layout', 'RecalculateStyles',
  'ImageDecodeTask', 'GPUTask', 'FunctionCall', 'EventDispatch', 'ParseHTML', 'Commit',
  'ActivateLayerTree', 'DrawFrame', 'BeginFrame', 'DecodeImage', 'ResourceSendRequest',
  'UpdateLayoutTree', 'HitTest', 'ScrollLayer', 'TimeStamp', 'RunTask', 'RunMicrotasks',
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r3 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const logLines = [];
function log(m) { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); logLines.push(l); }

// ------------------------------------------------------------------ lock / census
const LOCK_DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock';
const AGENT = 'incident2-why-these-two (panel cost attribution: why only General+Plugins)';

// ---------------------------------------------------------------- liveness
// FIX (exec-mask): the inherited code tested liveness with
// fs.readlinkSync('/proc/<pid>/exe'). On this box that call fails with EACCES
// for EVERY foreign process (even same-UID ones), so live owners were reported
// DEAD -- which is exactly how a live sibling's lock gets force-reclaimed. Per
// the lock protocol, liveness is tested by /proc/<pid> EXISTENCE, with /proc
// stat state (Z = zombie) and an empty cmdline as extra "really gone" signals.
function pidDeathProof(pid) {
  // POSITIVE PROOF OF DEATH ONLY (see harness-notes.md 5(b) and
  // raw/instrument-findings.json): /proc/<pid> absent, or /proc/<pid>/stat state
  // Z/X. Every other outcome — including EACCES on anything under /proc/<pid> —
  // means ALIVE, so a live owner's lock is never removed. readlink('/proc/<pid>/exe')
  // is never used for liveness: it is EACCES for essentially every process here.
  if (!pid) return 'no-pid-field';
  try { fs.statSync(`/proc/${pid}`); } catch { return 'proc-entry-absent'; }
  try {
    const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const state = st.slice(st.lastIndexOf(') ') + 2).split(' ')[0];
    if (state === 'Z' || state === 'X') return `stat-state-${state}`;
  } catch { return null; }
  return null;
}
function pidAlive(pid) { return pidDeathProof(pid) === null; }

function ancestry() {
  const anc = new Set([process.pid]);
  let p = process.pid;
  for (let i = 0; i < 32; i++) {
    try {
      const st = fs.readFileSync(`/proc/${p}/stat`, 'utf8');
      const ppid = Number(st.slice(st.lastIndexOf(') ') + 2).split(' ')[1]);
      if (!ppid || ppid <= 1) break;
      anc.add(ppid); p = ppid;
    } catch { break; }
  }
  return anc;
}
function census() {
  const out = { total: 0, own: 0, foreign: 0, entries: [] };
  const anc = ancestry();
  let pids = [];
  try { pids = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)); } catch { return out; }
  for (const pid of pids) {
    // FIX (exec-mask): identify processes by /proc/<pid>/cmdline (readable) with
    // the exe link only as an extra hint. The inherited code keyed on exe alone,
    // and because that readlink is EACCES here its census ALWAYS returned
    // total=0 own=0 foreign=0 -- so the audit's "quiet gate: quiet=true" was
    // vacuous (it could not see the real user Chrome or the snap Firefox).
    let cmd = '';
    try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim(); } catch { continue; }
    if (!cmd) continue;
    let exe = '';
    try { exe = fs.readlinkSync(`/proc/${pid}/exe`); } catch { exe = ''; }
    const ident = exe || cmd;
    if (!/chrome|chromium|headless_shell|firefox|Gecko|msedge/i.test(ident)) continue;
    if (/--type=/.test(cmd)) continue;
    let ppid = 0;
    try { const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); ppid = Number(st.slice(st.lastIndexOf(') ') + 2).split(' ')[1]); } catch {}
    out.total++;
    if (anc.has(ppid) || anc.has(Number(pid))) out.own++;
    else { out.foreign++; out.entries.push({ pid, exe: exe || '(exe EACCES)', ppid, cmd: cmd.slice(0, 140) }); }
  }
  return out;
}
/* owner.txt holds EXACTLY ONE line, "pid: <pid>": still parse it line by line
 * (never word-split it, never shell-interpolate it) and never remove or
 * overwrite it while its owner is alive. */
function readOwner() {
  try {
    const f = {};
    for (const line of fs.readFileSync(path.join(LOCK_DIR, 'owner.txt'), 'utf8').split('\n')) {
      const i = line.indexOf(':');
      if (i > 0) { const k = line.slice(0, i).trim(); if (!(k in f)) f[k] = line.slice(i + 1).trim(); }
    }
    const pid = Number(f.owner_pid || f.pid || 0) || null;
    return { fields: f, pid, alive: pidAlive(pid), age: (Date.now() - fs.statSync(path.join(LOCK_DIR, 'owner.txt')).mtimeMs) / 1000 };
  } catch { return null; }
}
function writeOwner(concurrentWith) {
  fs.writeFileSync(path.join(LOCK_DIR, 'owner.txt'), [
    `agent: ${AGENT}`,
    `line: same-page cross-panel comparison (general vs models vs plugins + tabs)`,
    `purpose: attribute the "only these two spots are expensive" difference to one testable mechanism (H1..H6)`,
    `owner_pid: ${process.pid}`,
    `pid: ${process.pid}`,
    `host_pid: 301709   # node dsh web (read-only reference; never restarted)`,
    `started_at: ${new Date().toISOString()}`,
    `started_epoch: ${Math.floor(Date.now() / 1000)}`,
    `concurrentWith: ${concurrentWith || 'none'}`,
    `loadavg_at_acquire: ${fs.readFileSync('/proc/loadavg', 'utf8').trim()}`,
    `token: CNS202649516533-${process.pid}-wtt`,
    `note: single browser at a time; release = rm owner.txt && rmdir`,
  ].join('\n') + '\n');
}
async function acquireLock(waitMs, pollMs) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try { fs.mkdirSync(LOCK_DIR); writeOwner('none'); return { mode: 'exclusive', owner: null }; } catch { /* busy */ }
    const last = readOwner();
    if (!last) {
      // The directory exists but has no readable owner.txt. This is the window
      // between another line's mkdir() and its writeOwner(), so it must NOT be
      // taken over: treat it as BUSY and keep waiting. (This branch previously
      // force-took the lock, which is how another line's owner.txt got replaced.)
      if (Date.now() >= deadline) return { mode: 'concurrent-annotated', owner: { desc: 'dir present, owner.txt not yet written (mid-acquire)' } };
      await sleep(pollMs);
      continue;
    }
    if (!last.alive) {
      try { fs.rmSync(path.join(LOCK_DIR, 'owner.txt'), { force: true }); fs.rmdirSync(LOCK_DIR); } catch {}
      continue;
    }
    if (Date.now() >= deadline) {
      const desc = `${last.fields.agent || '?'} pid=${last.pid} age=${Math.round(last.age)}s`;
      // never clobber a live owner's owner.txt (their release() greps their own pid)
      return { mode: 'concurrent-annotated', owner: { ...last, desc } };
    }
    await sleep(pollMs);
  }
}
function releaseLock() {
  try {
    const txt = fs.readFileSync(path.join(LOCK_DIR, 'owner.txt'), 'utf8');
    if (txt.includes(`owner_pid: ${process.pid}`)) {
      fs.rmSync(path.join(LOCK_DIR, 'owner.txt'), { force: true });
      try { fs.rmdirSync(LOCK_DIR); } catch {}
      return true;
    }
  } catch {}
  return false;
}
async function waitQuiet(maxMs, pollMs) {
  const t0 = Date.now();
  for (;;) {
    const c = census();
    if (c.foreign === 0) return { quiet: true, waitedMs: Date.now() - t0, census: c };
    if (Date.now() - t0 >= maxMs) return { quiet: false, waitedMs: Date.now() - t0, census: c };
    await sleep(pollMs);
  }
}

// ------------------------------------------------------------------- readiness
const READY_FN = `() => {
  if (document.querySelector('[data-dsh-boot]')) return false;
  if (!window.__DSH_BOOT__) return false;
  if (!window.__ModuleLoader__ || window.__ModuleLoader__.mode !== 'live') return false;
  var t = document.querySelector('div[class$="_settingsArea"] button[aria-haspopup="dialog"]');
  var tree = document.querySelector('div[role="tree"]');
  if (!t || !tree) return false;
  if (!tree.querySelector('[role="treeitem"][aria-expanded]')) return false;
  return true;
}`;

// ===================================================================== main
async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  fs.mkdirSync(LOGS, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const stamp = new Date().toISOString();
  const stampC = stamp.replace(/[-:]/g, '').replace(/\..+/, 'Z');
  log(`run=${RUN} order=${ORDER} reps=${REPS} browser=${BROWSER} vp=${VW}x${VH}@${DSF} sections=${SECTIONS_ARG} trace=${!SKIP_TRACE} ablate=${ABLATE} arms=${ARMS.join('>')} shots=${SHOT_MODE}`);
  log(`CMD: ${process.argv.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
  log(`bundlePatch=${BUNDLE_PATCH || 'none'}` + (PATCH_SHA ? ` sha256=${PATCH_SHA} bytes=${PATCH_BYTES.length}` : '') + ` preimage=${PREIMAGE_SHA ? PREIMAGE_SHA.sha256 : 'not-found'} bundleUrl=${BUNDLE_URL}`);
  log(`loadavg=${fs.readFileSync('/proc/loadavg', 'utf8').trim()}`);
  const pre = census();
  log(`pre-census: total=${pre.total} own=${pre.own} foreign=${pre.foreign}` + (pre.foreign ? ' FOREIGN=' + JSON.stringify(pre.entries) : ''));

  // The lock is a live shared mutex. When tools/campaign.sh runs the whole
  // campaign under one acquisition it exports PANEL_LOCK_PRECLAIMED=1 so the
  // runner neither re-acquires nor releases a lock it does not own.
  const PRECLAIMED = process.env.PANEL_LOCK_PRECLAIMED === '1';
  const lock = PRECLAIMED
    ? { mode: 'preclaimed-by-wrapper', owner: null }
    : await acquireLock(Number(argOf('--lock-wait-ms', String(3 * 60 * 1000))), Number(argOf('--lock-poll-ms', '15000')));
  log(`lock: ${lock.mode}` + (lock.owner ? `  concurrentWith=${lock.owner.desc}` : ''));
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (PRECLAIMED) { log('lock preclaimed by wrapper — not released here'); return; }
    if (releaseLock()) log('lock released');
  };
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => { log(`signal ${s}`); release(); process.exit(130); });
  process.on('exit', release);

  const quiet = await waitQuiet(Number(argOf('--quiet-wait-ms', '120000')), 10000);
  log(`quiet gate: quiet=${quiet.quiet} waited=${quiet.waitedMs}ms foreign=${quiet.census.foreign}`);

  const launchOpts = { headless: !BROWSER.endsWith('headed'), args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-renderer-accessibility'] };
  if (BROWSER.startsWith('chrome')) launchOpts.channel = 'chrome';
  let browser;
  try { browser = await chromium.launch(launchOpts); }
  catch (e) {
    log(`LAUNCH FAILED (${BROWSER}): ${String(e).split('\n')[0]}`);
    fs.writeFileSync(path.join(RAW, `perf-${RUN}-${ORDER}-${BROWSER}-${stampC}.json`),
      JSON.stringify({ run: RUN, order: ORDER, browser: BROWSER, launchError: String(e), startedAt: stamp, reps: [] }, null, 2));
    release(); return 1;
  }
  log(`launched ${BROWSER} version=${browser.version()}`);

  const allReps = [];
  for (let rep = 1; rep <= REPS; rep++) {
   const repLoadavg = fs.readFileSync('/proc/loadavg', 'utf8').trim();
   const repCensus = census();
   log(`rep${rep} START loadavg=${repLoadavg} foreign=${repCensus.foreign} arms=${ARMS.join('>')}`);
   for (const armName of ARMS) {
    const AR = { rep, arm: armName, phases: [], censuses: {}, tStart: new Date().toISOString() };
    AR.censusAtRepStart = repCensus;
    AR.loadavgAtRepStart = repLoadavg;
    const interceptions = [];
    AR.interceptions = interceptions;
    AR.interceptionSha256Ok = null;
    let context, page, cdp;
    try {
      context = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DSF, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
      // ---- the ONE added capability: serve the candidate bytes for the real
      // settings bundle URL, in this arm's context only, before any navigation.
      if (PATCH_BYTES && armName === 'patch') {
        await context.route(BUNDLE_RE, async (route) => {
          const req = route.request();
          interceptions.push({ url: req.url(), method: req.method(), resourceType: req.resourceType(), bytes: PATCH_BYTES.length, sha256: PATCH_SHA, at: new Date().toISOString() });
          log(`  [intercept] ${req.method()} ${req.resourceType()} ${req.url()} -> ${PATCH_BYTES.length} bytes sha256=${PATCH_SHA.slice(0, 12)}…`);
          await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: PATCH_BYTES });
        });
      }
      page = await context.newPage();
      await page.addInitScript({ content: PROBE });
      cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      await cdp.send('Network.enable');

      // ---- channel 3: authoritative RPC capture (independent of page patching)
      const netReqs = [];
      const netById = new Map();
      cdp.on('Network.requestWillBeSent', (e) => {
        if (!/\/api\//.test(e.request.url)) return;
        let method = null;
        try { method = JSON.parse(e.request.postData || '{}').method || null; } catch {}
        const r = { id: e.requestId, url: e.request.url, httpMethod: e.request.method, rpcMethod: method, reqTs: e.timestamp, postLen: (e.request.postData || '').length, status: null, endTs: null, durMs: null };
        netReqs.push(r); netById.set(e.requestId, r);
      });
      cdp.on('Network.responseReceived', (e) => { const r = netById.get(e.requestId); if (r) { r.status = e.response.status; r.respTs = e.timestamp; } });
      cdp.on('Network.loadingFinished', (e) => { const r = netById.get(e.requestId); if (r) { r.endTs = e.timestamp; r.durMs = Math.round((e.timestamp - r.reqTs) * 100000) / 100; } });
      // page clock <-> CDP clock offset, so phases can be sliced on network events
      const clockAt = async () => {
        const t = await page.evaluate(() => ({ p: performance.now(), w: Date.now() }));
        return t;
      };

      // ---- channel 4: tracing, sliced by in-page console.timeStamp markers
      const traceEvents = [];
      let traceOn = false;
      if (!SKIP_TRACE) {
        cdp.on('Tracing.dataCollected', ({ value }) => {
          for (const e of value) if (TRACE_KEEP.has(e.name)) traceEvents.push(e);
        });
        try {
          await cdp.send('Tracing.start', {
            categories: 'devtools.timeline,blink.user_timing,cc,benchmark,disabled-by-default-devtools.timeline.frame',
            transferMode: 'ReportEvents',
          });
          traceOn = true;
        } catch (e) { log(`rep${rep} tracing unavailable: ${String(e).split('\n')[0]}`); }
      }

      const tNav = Date.now();
      await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(READY_FN, null, { timeout: 90000 });
      await sleep(400);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      AR.navToReadyMs = Date.now() - tNav;

      const initState = await page.evaluate(() => ({ probe: !!window.__PROBE, initError: window.__PROBE_INIT_ERROR || null, channels: window.__PROBE ? window.__PROBE.channels : null }));
      if (initState.initError || !initState.probe) throw new Error(`in-page probe failed: ${initState.initError || 'no __PROBE'}`);
      AR.env = { channels: initState.channels, dpr: await page.evaluate(() => devicePixelRatio), version: browser.version(), ua: await page.evaluate(() => navigator.userAgent) };
      log(`rep${rep} ready ${AR.navToReadyMs}ms channels=${JSON.stringify(initState.channels)}`);

      // ---------- phase machinery
      const phaseClock = [];
      const pendingTrace = [];
      const mark = async (label, edge) => {
        if (!traceOn) return;
        const p = await page.evaluate((l) => { const t = performance.now(); console.timeStamp(`PROBE|${l}`); return t; }, `${edge}|${label}`);
        phaseClock.push({ label, edge, pageNow: p });
      };

      const cdpMetrics = async () => { const m = await cdp.send('Performance.getMetrics'); const o = {}; for (const e of m.metrics) o[e.name] = e.value; return o; };
      const lastCdp = { v: null };

      const snapshot = async (label, note) => {
        const base = await page.evaluate(() => window.__phase());
        const netFrom = netReqs.length;
        const traceFrom = traceEvents.length;
        return { label, note, base, netFrom, traceFrom };
      };

      const finish = async (snap, extra) => {
        const d = await page.evaluate((b) => window.__sincePhase(b), snap.base);
        const m = await cdpMetrics();
        const cd = {};
        if (lastCdp.v) for (const k of ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount', 'JSHeapUsedSize', 'Nodes', 'JSEventListeners', 'Documents']) cd[k] = r3((m[k] ?? 0) - (lastCdp.v[k] ?? 0));
        lastCdp.v = m;

        // Trace slicing happens AFTER Tracing.end (dataCollected is async, so it
        // is not safe to slice a phase window while the run is still going).
        const rec = {
          label: snap.label, note: snap.note || null,
          trace: null,
          clickToFirstChangeMs: extra?.arm ? r3(extra.arm.clickToFirstChangeMs) : null,
          clickToSettledMs: extra?.arm ? r3(extra.arm.clickToSettledMs) : null,
          tInputIsInput: extra?.arm ? extra.arm.tInputIsInput : null,
          frameP50: r3(d.frameP50), frameP95: r3(d.frameP95), frameP99: r3(d.frameP99), frameMax: r3(d.frameMax),
          nFrames: d.nFrames, framesGt50: d.framesGt50, framesGt33: d.framesGt33,
          longtaskCount: d.longtaskCount, longtaskTotal: r3(d.longtaskTotal), longtaskMax: r3(d.longtaskMax),
          longtasks: d.longtasks.map((x) => ({ start: r3(x.start), dur: r3(x.dur) })).slice(0, 30),
          loafCount: d.loafCount, loafMax: r3(d.loafMax), loafBlockingMax: r3(d.loafBlockingMax),
          loafScripts: d.loafScripts.map((s) => ({ dur: r3(s.dur), fn: s.fn })).slice(0, 6),
          commits: d.commits, unmounts: d.unmounts, muts: d.muts,
          performedWork: extra?.performedWork ?? null,
          cdpDelta: Object.keys(cd).length ? cd : null,
          netRpcs: netReqs.slice(snap.netFrom).map((r) => ({ rpcMethod: r.rpcMethod, httpMethod: r.httpMethod, status: r.status, durMs: r.durMs, postLen: r.postLen })),
          frameSeries: d.frameSeries.map(r3),
        };
        if (extra?.scrollInfo) rec.scrollInfo = extra.scrollInfo;
        return rec;
      };

      // performed-work counter (channel 1b): how many components actually re-rendered
      const pwStart = async () => page.evaluate(() => { window.__pwBase = window.__PROBE.commits.reduce((a, c) => a + (c.performed || 0), 0); return window.__pwBase; });
      const pwEnd = async () => page.evaluate(() => window.__PROBE.commits.reduce((a, c) => a + (c.performed || 0), 0) - window.__pwBase);

      const runPhase = async (label, ms, note, action, opts = {}) => {
        let idx = null;
        if (opts.arm) idx = await page.evaluate((l) => window.__PROBE.arm(l), label);
        await mark(label, 'in');
        const snap = await snapshot(label, note);
        await pwStart();
        if (action) await action();
        await sleep(ms);
        const arm = idx != null ? await page.evaluate((i) => window.__PROBE.armResult(i), idx) : null;
        const performedWork = await pwEnd();
        await mark(label, 'out');
        const rec = await finish(snap, { arm, performedWork, scrollInfo: opts.scrollInfo });
        AR.phases.push(rec);
        pendingTrace.push(rec);
        log(`  ${label.padEnd(22)} c2f=${rec.clickToFirstChangeMs} max=${rec.frameMax} >50=${rec.framesGt50} LT=${rec.longtaskCount}/${rec.longtaskMax} rpc=${rec.netRpcs.map((r) => r.rpcMethod).join(',') || '-'} pw=${performedWork}`);
        return rec;
      };

      // ---------- DOM census
      const censusNow = async (tag) => { AR.censuses[tag] = await page.evaluate(() => window.__census(null)); return AR.censuses[tag]; };

      // ---------- interactions
      const clickSel = async (sel) => { const l = page.locator(sel).first(); await l.waitFor({ state: 'visible', timeout: CLICK_TIMEOUT }); await l.click({ timeout: CLICK_TIMEOUT }); };
      const clickNav = async (label) => {
        const l = page.locator(SEL.navCells).filter({ hasText: label }).first();
        await l.waitFor({ state: 'visible', timeout: CLICK_TIMEOUT }); await l.click({ timeout: CLICK_TIMEOUT });
      };
      const visibleTabLabels = () => page.evaluate(() => [...document.querySelectorAll('button[class$="_tab"]')]
        .filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== 'hidden'; })
        .map((b) => (b.textContent || '').trim()));
      const clickTab = async (label) => {
        const l = page.locator(`button[class$="_tab"]:visible`).filter({ hasText: label }).first();
        await l.waitFor({ state: 'visible', timeout: CLICK_TIMEOUT }); await l.click({ timeout: CLICK_TIMEOUT });
      };
      const tabState = (label) => page.evaluate((l) => {
        const bs = [...document.querySelectorAll('button[class$="_tab"]')].filter((b) => (b.textContent || '').trim() === l);
        return { count: bs.length,
                 visible: bs.some((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(b).visibility !== 'hidden'; }),
                 active: bs.some((b) => b.getAttribute('data-active') === 'true') };
      }, label);
      // Tab sets are not static: clicking some tabs unmounts others (e.g. the
      // usage card's own tabs die when you leave its host tab). Sweep twice,
      // re-checking visibility before every click, and never let a stale label
      // abort the rep.
      const runTabsFor = async (secKey, sec) => {
        const labels = await visibleTabLabels();
        AR.tabLabels[sec] = labels;
        if (!labels.length) return;
        log(`  ${sec} tabs: ${JSON.stringify(labels)}`);
        const done = new Set();
        const home = await page.evaluate(() => { const b = [...document.querySelectorAll('button[class$="_tab"]')].find((x) => x.getAttribute('data-active') === 'true'); return b ? (b.textContent || '').trim() : null; });
        for (const tl of labels) {
          if (done.has(tl)) continue;
          let st = null;
          try { st = await tabState(tl); } catch { /* gone */ }
          if (!st || !st.visible) { AR.tabSkipped = (AR.tabSkipped || []).concat([{ sec, tl, reason: 'hidden' }]); continue; }
          done.add(tl);
          const tag = `${secKey}::tab:${tl}`;
          if (st.active) {
            await runPhase(`TAB_${tag}_active`, SETTLE_MS, `${sec} tab ${tl} (already active)`, null, { arm: false });
          } else {
            await runPhase(`TAB_${tag}`, SETTLE_MS, `${sec} tab click -> ${tl}`, () => clickTab(tl), { arm: true });
            // restore the host tab so sibling tabs keep existing for the rest of the set
            if (home && home !== tl) {
              try { const hs = await tabState(home); if (hs.visible && !hs.active) { await clickTab(home); await sleep(400); } } catch { /* ignore */ }
            }
          }
          await censusNow(`tab_${tag}`);
          const tsi = await findScrollable();
          AR[`scrollable_tab_${tag}`] = tsi;
          if (tsi && tsi.hasScrollable) await runPhase(`SCROLL_tab_${tag}`, SCROLL_MS, `wheel scroll inside ${sec} tab ${tl}`, scrollAction(tsi), { scrollInfo: tsi });
          // ---- shot pair (c): 插件列表 genuinely scrolled. doScroll() ends back
          // near the top, so a fresh deterministic scroll is applied here (after
          // the phase window, identical in every arm).
          if (sec === '插件' && tl === '插件列表') {
            const sname = `${String(secKey).split('_')[0].toLowerCase()}-pluginslist-scrolled`;
            let si2 = null;
            try {
              si2 = await findScrollable();
              if (si2 && si2.hasScrollable) {
                await page.mouse.move(si2.x, si2.y);
                for (let k = 0; k < 6; k++) { await page.mouse.wheel(0, 300); await sleep(80); }
                await sleep(900);
              }
            } catch (e) { log(`  [shot] prescroll failed: ${String(e).split('\n')[0]}`); }
            await shot(sname, { phase: `SCROLL_tab_${tag}`, navLabel: sec, tabLabel: tl, scrollInfo: si2 });
          }
          await resetScroll();
        }
        AR.tabMeasured = (AR.tabMeasured || []).concat([...done].map((t) => `${sec}::${t}`));
      };

      // find the deepest scrollable container inside the panel, then wheel-scroll it
      const findScrollable = () => page.evaluate(() => {
        const panel = document.querySelector('div.VOzbGW_panel');
        if (!panel) return null;
        const all = panel.getElementsByTagName('*');
        let best = null;
        for (let i = 0; i < all.length; i++) {
          const e = all[i];
          if (e.scrollHeight > e.clientHeight + 24 && e.clientHeight > 60) { if (!best || e.clientHeight > best.clientH) best = { el: e }; }
        }
        const t = best ? best.el : panel;
        const r = t.getBoundingClientRect();
        return { hasScrollable: !!best, cls: best ? String(best.el.className).slice(0, 50) : null,
                 scrollH: t.scrollHeight, clientH: t.clientHeight,
                 maxScroll: Math.max(0, t.scrollHeight - t.clientHeight),
                 sel: best ? (best.el.getAttribute('class') || '').split(' ').map((c) => '.' + c).join('') : null,
                 x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(r.height / 2, 120)) };
      });
      const doScroll = async (info) => {
        if (!info || !info.hasScrollable) return info;
        await page.mouse.move(info.x, info.y);
        const samples = [];
        const read = () => page.evaluate((s) => { const e = s ? document.querySelector(s) : null; return e ? e.scrollTop : null; }, info.sel);
        for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 260); await sleep(60); samples.push(await read()); }
        for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -260); await sleep(60); samples.push(await read()); }
        info.scrollSamples = samples;
        info.scrollTopAfter = samples.length ? samples[samples.length - 1] : null;
        info.scrollTopMax = Math.max(...samples.filter((v) => v != null), 0);
        info.moved = info.scrollTopMax > 0;
        return info;
      };
      // The wheel must happen INSIDE the measured window (otherwise the phase
      // measures an idle window and silently proves nothing).
      const scrollAction = (si) => (async () => { await doScroll(si); });

      const resetScroll = () => page.evaluate(() => { const p = document.querySelector('div.VOzbGW_panel'); if (!p) return; const all = p.getElementsByTagName('*'); for (const e of all) if (e.scrollHeight > e.clientHeight + 24 && e.clientHeight > 60) e.scrollTop = 0; });

      // ---- added for exec-mask (appearance-equivalence evidence): a screenshot
      // plus the geometry/styles that are needed to say WHERE pixels differ.
      // Called at the identical point of the sequence in every arm, in the same
      // settled state and at the same scroll position.
      const shot = async (name, extra) => {
        if (!SHOT_MODE || rep !== SHOT_REP) return null;
        // NOTE (post-campaign fix): the invocation stamp MUST be part of the
        // name. Without it, three invocations that each run `--reps 1` overwrite
        // each other's PNGs and the pixel evidence silently collapses to one
        // pair repeated. The campaign's files predate this fix; pixdiff.mjs
        // de-duplicates them and RESULTS.md discloses it.
        const file = path.join(SHOTS, `${RUN}-r${rep}-${armName}-${VW}-${name}-${stampC}.png`);
        const meta = await page.evaluate(() => {
          const q = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
          const mask = document.querySelector('div[class$="_mask"]');
          const cs = mask ? getComputedStyle(mask) : null;
          const panel = document.querySelector('div.VOzbGW_panel');
          const scrollTops = [];
          if (panel) for (const e of panel.getElementsByTagName('*')) if (e.scrollHeight > e.clientHeight + 24 && e.clientHeight > 60) scrollTops.push({ cls: String(e.className).slice(0, 44), top: e.scrollTop, sh: e.scrollHeight, ch: e.clientHeight });
          const bodyBg = getComputedStyle(document.body).backgroundImage;
          const wl = [...document.body.children].find((e) => /background-size:\s*cover/.test(e.getAttribute('style') || ''));
          return {
            panel: q('div.VOzbGW_panel'), mask: q('div[class$="_mask"]'), options: q('div[class$="_options"]'),
            maskBackdropFilter: cs ? cs.backdropFilter : null,
            maskBackground: cs ? cs.background : null,
            maskBackgroundColor: cs ? cs.backgroundColor : null,
            viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
            bodyBgImage: bodyBg && bodyBg !== 'none' ? String(bodyBg).slice(0, 120) : 'none',
            wallpaperLayer: wl ? { found: true, filter: wl.style.filter, bg: String(wl.style.backgroundImage).slice(0, 80) } : { found: false },
            activeNav: (() => { const b = document.querySelector('button[aria-current="true"] span[class$="_navLabel"]'); return b ? b.textContent : null; })(),
            activeTab: (() => { const b = document.querySelector('button[class$="_tab"][data-active="true"]'); return b ? b.textContent : null; })(),
            scrollTops,
          };
        }).catch((e) => ({ error: String(e).split('\n')[0] }));
        let bytes = null;
        try { await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' }); bytes = fs.statSync(file).size; }
        catch (e) { AR.shots = (AR.shots || []).concat([{ name, error: String(e).split('\n')[0] }]); log(`  [shot] ${name} FAILED ${String(e).split('\n')[0]}`); return null; }
        AR.shotMeta = AR.shotMeta || {};
        AR.shotMeta[name] = Object.assign({ file, arm: armName, dsf: DSF, pngBytes: bytes }, meta, extra || {});
        log(`  [shot] ${file} (${bytes} bytes) maskBackdropFilter=${meta.maskBackdropFilter} panel=${JSON.stringify(meta.panel)}`);
        return file;
      };

      // ================================================ P0 idle (negative control)
      await runPhase('IDLE_BASE', IDLE_MS, 'page idle, settings closed');
      await censusNow('idleBase');

      // ================================================ P1 open
      await runPhase('OPEN', SETTLE_MS, 'click Settings trigger -> first open (general is default section)', () => clickSel(SEL.trigger), { arm: true });
      await censusNow('afterOpen');

      // nav is only observable once the panel exists
      const allNav = await page.evaluate(() => [...document.querySelectorAll('div[class$="_navList"] button')].map((b) => (b.textContent || '').trim()));
      AR.navLabels = allNav;
      const activeAtOpen = await page.evaluate(() => { const b = document.querySelector('button[aria-current="true"] span[class$="_navLabel"]'); return b ? b.textContent.trim() : null; });
      AR.activeAtOpen = activeAtOpen;
      log(`rep${rep} nav has ${allNav.length} sections: ${JSON.stringify(allNav)} (active at open: ${activeAtOpen})`);
      const walk = SECTIONS_ARG === 'nav' ? allNav.filter((l) => l !== activeAtOpen) : SECTIONS_ARG.split(',').map((s) => s.trim());
      AR.walk = walk;

      // ================================================ general as first-visible
      await censusNow('sec_1_first');
      await runPhase('SEC_1_first_view', SETTLE_MS, `first section visible (${activeAtOpen}), no interaction`);
      // ---- shot pair (a): first section (通用设置) at scroll 0
      await shot('s1-general-scroll0', { phase: 'SEC_1_first_view', navLabel: activeAtOpen });
      {
        const si = await findScrollable();
        AR.scrollable_first = si;
        await runPhase('SCROLL_first', SCROLL_MS, `wheel scroll inside ${activeAtOpen}`, scrollAction(si), { scrollInfo: si });
        await resetScroll();
      }

      // ================================================ every other section, in nav order
      AR.tabLabels = {};
      for (let i = 0; i < walk.length; i++) {
        const sec = walk[i];
        const key = `S${i + 2}_${sec}`;
        await runPhase(`SEC_${key}`, SETTLE_MS, `nav click -> ${sec} (position ${i + 2} of ${walk.length + 1})`, () => clickNav(sec), { arm: true });
        await censusNow(`sec_${key}`);
        // ---- shot pair (b): 插件 at scroll 0 (identical point in every arm)
        if (sec === '插件') await shot(`${String(key).split('_')[0].toLowerCase()}-plugins-scroll0`, { phase: `SEC_${key}`, navLabel: sec });
        const si = await findScrollable();
        AR[`scrollable_${key}`] = si;
        await runPhase(`SCROLL_${key}`, SCROLL_MS, `wheel scroll inside ${sec}`, scrollAction(si), { scrollInfo: si });
        await resetScroll();
        const tls = await visibleTabLabels();
        if (tls.length) await runTabsFor(key, sec);
      }

      // ================================================ switch back / revisit (H2)
      await runPhase('SEC_back_first', SETTLE_MS, `nav click -> ${activeAtOpen} (switch BACK / revisit)`, () => clickNav(activeAtOpen), { arm: true });
      await censusNow('sec_back_first');
      if (walk.includes('插件')) {
        await runPhase('SEC_plugins_REVISIT', SETTLE_MS, 'nav click -> 插件 (REVISIT: second mount in this page)', () => clickNav('插件'), { arm: true });
        await censusNow('sec_plugins_REVISIT');
        await runPhase('TAB_plugins_REVISIT_list', SETTLE_MS, 'plugins tab 插件列表 (REVISIT)', async () => {
          const tls = await visibleTabLabels();
          if (tls.includes('插件列表')) await clickTab('插件列表');
        }, { arm: true });
      }

      // ================================================ close
      await runPhase('CLOSE', SETTLE_MS, 'click Close button', () => clickSel(SEL.close), { arm: true });
      await censusNow('afterClose');

      // ================================================ H6 manipulation check
      // Transient, in-page, restored afterwards: NO persistence, no product file
      // touched. Two identical focused sequences (panel open -> 插件 -> its
      // 插件列表 tab -> scroll -> 通用设置 -> scroll -> close) are run back to
      // back in the same rep: NORMAL then ABLATED (full-viewport backdrop-filter
      // mask and/or the wallpaper layer neutralised). A within-rep paired delta
      // is the cleanest available test of the "full-viewport mask/keyOverlay
      // repaint" mechanism.
      const applyAblation = (kind) => page.evaluate((k) => {
        const out = {};
        const mask = document.querySelector('div[class$="_mask"]');
        if (mask && (k === 'mask' || k === 'both')) {
          out.maskBefore = getComputedStyle(mask).backdropFilter;
          mask.style.backdropFilter = 'none';
          mask.style.background = 'transparent';
          out.maskAfter = getComputedStyle(mask).backdropFilter;
        }
        if (k === 'wallpaper' || k === 'both') {
          const el = [...document.body.children].find((e) => /background-size:\s*cover/.test(e.getAttribute('style') || ''));
          if (el) { out.wallpaperBefore = String(el.style.backgroundImage).slice(0, 40); el.style.backgroundImage = 'none'; out.wallpaperAfter = el.style.backgroundImage || 'none'; }
          const had = document.body.style.getPropertyValue('--dsw-alias-bg-base');
          document.body.style.removeProperty('--dsw-alias-bg-base');
          out.tokenBefore = had || null;
        }
        return out;
      }, kind);
      const focusSeq = async (tag, afterOpen) => {
        await runPhase(`FOCUS_${tag}_open`, SETTLE_MS, `[${tag}] click Settings (re-open)`, () => clickSel(SEL.trigger), { arm: true });
        if (afterOpen) { AR[`ablation_${tag}`] = await afterOpen(); }
        await runPhase(`FOCUS_${tag}_navPlugins`, SETTLE_MS, `[${tag}] nav -> 插件`, () => clickNav('插件'), { arm: true });
        let st = null; try { st = await tabState('插件列表'); } catch {}
        if (st && st.visible) {
          if (!st.active) await runPhase(`FOCUS_${tag}_tabList`, SETTLE_MS, `[${tag}] tab -> 插件列表`, () => clickTab('插件列表'), { arm: true });
          const si = await findScrollable();
          if (si && si.hasScrollable) await runPhase(`FOCUS_${tag}_scrollList`, SCROLL_MS, `[${tag}] scroll 插件列表 (longest list)`, scrollAction(si), { scrollInfo: si });
          await resetScroll();
        }
        await runPhase(`FOCUS_${tag}_navGeneral`, SETTLE_MS, `[${tag}] nav -> 通用设置`, () => clickNav('通用设置'), { arm: true });
        const gi = await findScrollable();
        await runPhase(`FOCUS_${tag}_scrollGeneral`, SCROLL_MS, `[${tag}] scroll 通用设置`, scrollAction(gi), { scrollInfo: gi });
        await resetScroll();
        await runPhase(`FOCUS_${tag}_close`, SETTLE_MS, `[${tag}] close`, () => clickSel(SEL.close), { arm: true });
      };
      if (ABLATE === 'aba') {
        // A-B-A order control: if the mask is the cause, jank must RETURN in the
        // third sequence. A plain NORMAL->ABLATED pair cannot distinguish the
        // mask from "second pass is warmer".
        log(`rep${rep} ablation ABA: NORMAL -> ABLATED(mask) -> NORMAL2`);
        await focusSeq('NORMAL', async () => ({ hook: 'none' }));
        await focusSeq('ABLATED', () => applyAblation('mask'));
        await focusSeq('NORMAL2', async () => ({ hook: 'restored-by-remount' }));
      } else if (ABLATE !== 'none') {
        log(`rep${rep} ablation arm: running focused sequence NORMAL then ABLATED(${ABLATE})`);
        await focusSeq('NORMAL', async () => ({ hook: 'none' }));
        await focusSeq('ABLATED', () => applyAblation(ABLATE));
        await page.evaluate(() => {   // restore (defensive; a fresh context per rep anyway)
          const mask = document.querySelector('div[class$="_mask"]');
          if (mask) { mask.style.backdropFilter = ''; mask.style.background = ''; }
          const el = [...document.body.children].find((e) => /background-size:\s*cover/.test(e.getAttribute('style') || ''));
          if (el) el.style.backgroundImage = '';
        }).catch(() => {});
      }

      // ================================================ positive control: 120 ms block
      await runPhase('POSCTL_pre', 1500, 'idle immediately before the injected block (late, boot-settled idle)');
      await runPhase('POSCTL_120', 1600, 'injected synchronous 120ms main-thread block INSIDE this window — validates the LongTask/frame channel',
        async () => { const ms = await page.evaluate(() => window.__block(120)); AR.posctlBlockMs = ms; });
      // second positive control with the panel OPEN, to prove the channel is live
      // during the very interactions being judged
      await clickSel(SEL.trigger).catch(() => {});
      await sleep(700);
      await runPhase('POSCTL_120_inpanel', 1600, 'injected 120ms block with the Settings panel open',
        async () => { const ms = await page.evaluate(() => window.__block(120)); AR.posctlBlockMsInPanel = ms; });

      if (traceOn) {
        try { await cdp.send('Tracing.end'); await new Promise((res) => { cdp.once('Tracing.tracingComplete', res); setTimeout(res, 6000); }); } catch {}
        // ---- now slice the trace per phase using the in-page timeStamp markers
        const stamps = traceEvents.filter((e) => e.name === 'TimeStamp');
        const at = (edge, label) => { const m = stamps.filter((e) => e.args && e.args.data && e.args.data.message === `PROBE|${edge}|${label}`); return m.length ? m[m.length - 1] : null; };
        let sliced = 0;
        for (const rec of pendingTrace) {
          const a = at('in', rec.label), b = at('out', rec.label);
          if (!a || !b || !(b.ts > a.ts)) { rec.trace = { unavailable: 'no marker pair', hasIn: !!a, hasOut: !!b }; continue; }
          const sel = traceEvents.filter((e) => e.ts >= a.ts && e.ts <= b.ts && e.dur);
          const byName = {};
          for (const e of sel) byName[e.name] = Math.round(((byName[e.name] || 0) + e.dur / 1000) * 100) / 100;
          const pick = (n) => byName[n] || 0;
          rec.trace = {
            windowMs: Math.round((b.ts - a.ts) / 1000), eventCount: sel.length, byName,
            mainThreadMs: pick('RunTask'), paintMs: pick('Paint'), rasterMs: pick('RasterTask'),
            compositeMs: pick('CompositeLayers'), updateLayerTreeMs: pick('UpdateLayerTree'),
            layoutMs: pick('Layout') + pick('UpdateLayoutTree'), recalcStyleMs: pick('RecalculateStyles'),
            decodeMs: pick('ImageDecodeTask') + pick('DecodeImage'), gpuMs: pick('GPUTask'),
            functionCallMs: pick('FunctionCall'), eventDispatchMs: pick('EventDispatch'),
            frameFireMs: pick('FireAnimationFrame'), hitTestMs: pick('HitTest'),
            rasterishMs: Math.round((pick('RasterTask') + pick('ImageDecodeTask') + pick('DecodeImage') + pick('GPUTask')) * 100) / 100,
          };
          sliced++;
        }
        log(`rep${rep} trace sliced ${sliced}/${pendingTrace.length} phases; stamps=${stamps.length} keptEvents=${traceEvents.length}`);
        AR.traceSliced = sliced;
      }
      AR.traceKeepCount = traceEvents.length;
      AR.channelHealth = await page.evaluate(() => ({ channels: window.__PROBE.channels, frames: window.__PROBE.frames.length, longtasks: window.__PROBE.longtasks.length, loaf: window.__PROBE.loaf.length, rpcs: window.__PROBE.rpcs.length, errors: window.__PROBE.errors.slice(0, 5), obsError: window.__PROBE.obsError || null, moError: window.__PROBE.moError || null }));
      AR.netReqsTotal = netReqs.length;
      AR.phaseClock = phaseClock;

      // ============================ V3 self-proof (added for exec-mask) ======
      // (a) the patch's own fingerprint in the live DOM: the declaration that was
      //     deleted is the one that sets this computed value.
      AR.maskStyle = await page.evaluate(() => {
        const m = document.querySelector('div[class$="_mask"]');
        if (!m) return { found: false };
        const cs = getComputedStyle(m);
        return { found: true, cls: String(m.className), backdropFilter: cs.backdropFilter,
                 webkitBackdropFilter: cs.webkitBackdropFilter || null,
                 background: cs.background, backgroundColor: cs.backgroundColor,
                 filter: cs.filter, willChange: cs.willChange };
      }).catch((e) => ({ found: false, error: String(e).split('\n')[0] }));
      // (b) re-fetch the bundle URL from inside the page (post-measurement) and
      //     hash the bytes the page ACTUALLY receives. In the patch arm this goes
      //     through the same route, so a silently-missed interception shows up as
      //     the pre-image hash instead of passing as "no effect".
      AR.servedBundle = await page.evaluate(async (u) => {
        try {
          const r = await fetch(u, { cache: 'no-store' });
          const b = await r.arrayBuffer();
          const d = await crypto.subtle.digest('SHA-256', b);
          const hex = [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
          return { status: r.status, bytes: b.byteLength, sha256: hex, contentType: r.headers.get('content-type') };
        } catch (e) { return { error: String(e) }; }
      }, BUNDLE_URL).catch((e) => ({ error: String(e) }));
      AR.interceptionCount = interceptions.length;
      AR.interceptionSha256Ok = interceptions.length > 0 && interceptions.every((x) => x.sha256 === PATCH_SHA);
      AR.servedBundleIsPatch = !!(PATCH_SHA && AR.servedBundle && AR.servedBundle.sha256 === PATCH_SHA);
      AR.servedBundleIsPreimage = !!(PREIMAGE_SHA && AR.servedBundle && AR.servedBundle.sha256 === PREIMAGE_SHA.sha256);
      AR.bundleVerdict = armName === 'patch'
        ? (AR.servedBundleIsPatch ? 'PATCH-SERVED' : 'PATCH-NOT-SERVED')
        : (AR.servedBundleIsPreimage ? 'PREIMAGE-SERVED' : 'UNEXPECTED-BUNDLE');
      log(`rep${rep}/${armName} V3: interceptions=${interceptions.length} shaOk=${AR.interceptionSha256Ok} served=${AR.servedBundle && (AR.servedBundle.sha256 || AR.servedBundle.error || '').slice(0, 12)} → ${AR.bundleVerdict}; mask.backdropFilter=${JSON.stringify(AR.maskStyle && AR.maskStyle.backdropFilter)}`);
      log(`rep${rep}/${armName} done: phases=${AR.phases.length} traceEvents=${traceEvents.length} net=${netReqs.length} frames=${AR.channelHealth.frames} longtasks=${AR.channelHealth.longtasks}`);
    } catch (e) {
      AR.error = String(e).split('\n').slice(0, 4).join(' | ');
      log(`rep${rep}/${armName} ERROR: ${AR.error}`);
      try { await page?.screenshot({ path: path.join(LOGS, `${RUN}-${ORDER}-rep${rep}-${armName}-error.png`) }); } catch {}
      try { if (AR.phaseClock) AR.censuses._failureDump = await page.evaluate(() => window.__census(null)); } catch {}
    } finally {
      allReps.push(AR);
      try { await context?.close(); } catch {}
    }
   }
  }

  const post = census();
  const out = {
    run: RUN, order: ORDER, browser: BROWSER, viewport: [VW, VH], dsf: DSF,
    startedAt: stamp, finishedAt: new Date().toISOString(),
    arms: ARMS, bundlePatch: BUNDLE_PATCH ? { path: BUNDLE_PATCH, sha256: PATCH_SHA, bytes: PATCH_BYTES.length } : null,
    preimage: PREIMAGE_SHA, bundleUrl: BUNDLE_URL,
    shotsMode: SHOT_MODE,
    loadavg: fs.readFileSync('/proc/loadavg', 'utf8').trim(),
    lock: { mode: lock.mode, concurrentWith: lock.owner ? lock.owner.desc : 'none' },
    quietGate: { quiet: quiet.quiet, waitedMs: quiet.waitedMs, foreignAtGate: quiet.census.foreign, entries: quiet.census.entries },
    ablate: ABLATE,
    censusPre: pre, censusPost: post, sections: SECTIONS_ARG, reps: allReps,
  };
  const f = path.join(RAW, `perf-${RUN}-${ORDER}-${BROWSER}-${stampC}.json`);
  fs.writeFileSync(f, JSON.stringify(out, null, 2));
  // per-arm split files: perf-<run>-<arm>-<timestamp>.json
  for (const armName of ARMS) {
    const sub = Object.assign({}, out, { arm: armName, reps: allReps.filter((r) => r.arm === armName) });
    fs.writeFileSync(path.join(RAW, `perf-${RUN}-${armName}-${stampC}.json`), JSON.stringify(sub, null, 2));
  }
  fs.writeFileSync(path.join(LOGS, `panel-${RUN}-${ORDER}-${BROWSER}-${stampC}.log`), logLines.join('\n') + '\n');
  log(`wrote ${f}`);
  await browser.close();
  release();
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
