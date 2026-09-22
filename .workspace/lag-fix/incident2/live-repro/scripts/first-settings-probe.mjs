// First-open "click 设置" probe.
//
// Measures the user's real path: brand-new page -> wait for stable -> click 设置.
// Captures, with a single continuous in-page record sliced by window markers:
//   - per-frame interval series (rAF deltas), unbounded in time, sliced later
//   - LongTask entries (PerformanceObserver, buffered)
//   - long-animation-frame entries (LoF) with per-script attribution
//   - MutationObserver dialog-appearance marks (DOM add) + rAF-confirmed visibility
//   - ResizeObserver
//   - console / pageerror
//   - CDP Performance.getMetrics snapshots at window boundaries (delta per window)
//   - in-page proof that the fixed client bundles are what was executed
//   - exact /proc/<pid>/exe process census (main-process count, binary kind)
//
// Read-only: clicks ONLY the 设置 trigger (opens/closes the settings drawer).
// Never touches 保存 / 应用 / 删除.
//
// usage: node first-settings-probe.mjs --mode=headless|headed --run=1 [--clicks=3] [--idle=6000]

import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/live-repro'
const RAW = path.join(ROOT, 'raw')
const SHOTS = path.join(ROOT, 'shots')
fs.mkdirSync(RAW, { recursive: true })
fs.mkdirSync(SHOTS, { recursive: true })

const argv = process.argv.slice(2)
const argOf = (k, d) => { const p = argv.find((a) => a.startsWith(`--${k}=`)); return p ? p.slice(k.length + 3) : d }
const MODE = argOf('mode', 'headless')
const RUN = Number(argOf('run', 1))
const CLICKS = Number(argOf('clicks', 3))
const IDLE_MS = Number(argOf('idle', 6000))
const SETTLE_MS = Number(argOf('settle', 3000))
const POST_MS = Number(argOf('post', 3000))
const TAG = argOf('tag', `${MODE}-run${RUN}`)
const HOST_PID = Number(argOf('hostpid', 10806))
const LOCK = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock'
const HEADED = MODE === 'headed'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000)

// ---------------------------------------------------------------------------
// exact process census: /proc/<pid>/exe (no pgrep -f self-matching)
// ---------------------------------------------------------------------------
function procRows() {
  const rows = []
  let pids = []
  try { pids = fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x)) } catch { return rows }
  for (const pid of pids) {
    let exe = null
    try { exe = fs.readlinkSync(`/proc/${pid}/exe`) } catch { continue }
    if (!/(chrome|chromium|headless_shell)$/.test(exe)) continue
    // NOTE: chromium rewrites argv in memory; /proc/<pid>/cmdline is SPACE-separated
    // (only one trailing NUL), so never split on NUL - normalise instead.
    let raw = ''
    try { raw = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim() } catch { }
    let ppid = 0
    try {
      const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
      ppid = Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1])
    } catch { }
    const typeM = raw.match(/--type=(\S+)/)
    const isMain = /--remote-debugging-pipe/.test(raw) && !typeM && /--user-data-dir=/.test(raw)
    rows.push({
      pid: Number(pid), ppid, exe,
      binaryKind: exe.includes('headless_shell') ? 'headless_shell' : 'chrome',
      type: typeM ? typeM[1] : null,
      isMain,
      userDataDir: (raw.match(/--user-data-dir=(\S+)/) || [])[1] || null,
      headlessFlag: /--headless/.test(raw) ? (raw.match(/--headless(=\S+)?/) || [''])[0] : null,
      ozone: (raw.match(/--ozone-platform=(\S+)/) || [])[1] || null,
      useGl: (raw.match(/--use-gl=(\S+)/) || [])[1] || null,
      useAngle: (raw.match(/--use-angle=(\S+)/) || [])[1] || null,
      gpuDisabled: /--disable-gpu\b/.test(raw),
    })
  }
  return rows
}
function ancestry(pid, depth = 12) {
  const chain = []
  let cur = pid
  for (let i = 0; i < depth && cur > 1; i++) {
    let ppid = 0
    try {
      const st = fs.readFileSync(`/proc/${cur}/stat`, 'utf8')
      ppid = Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1])
    } catch { break }
    chain.push(ppid)
    cur = ppid
  }
  return chain
}
function census(myPid, myAnc) {
  const rows = procRows()
  const mains = rows.filter((r) => r.isMain)
  // "mine" = the browser main process is a DESCENDANT of this line's node process
  // (Playwright spawns it as a child), not the other way round.
  const isMine = (r) => {
    if (r.pid === myPid) return true
    let cur = r.pid
    for (let i = 0; i < 12 && cur > 1; i++) {
      let ppid = 0
      try {
        const st = fs.readFileSync(`/proc/${cur}/stat`, 'utf8')
        ppid = Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1])
      } catch { break }
      if (ppid === myPid || myAnc.includes(ppid)) return true
      cur = ppid
    }
    return false
  }
  const mine = mains.filter(isMine)
  const foreign = mains.filter((r) => !isMine(r))
  const kinds = {}
  for (const r of rows) kinds[r.binaryKind] = (kinds[r.binaryKind] || 0) + 1
  let lockOwner = null
  try { lockOwner = fs.readFileSync(path.join(LOCK, 'owner.txt'), 'utf8').trim().split('\n').slice(0, 3).join(' | ') } catch { lockOwner = null }
  return {
    at: new Date().toISOString(),
    mainInstancesTotal: mains.length,
    mainInstancesMine: mine.length,
    foreignMainInstances: foreign.length,
    foreign: foreign.map((r) => ({ pid: r.pid, exe: r.exe, userDataDir: r.userDataDir, type: r.type })),
    mine: mine.map((r) => ({ pid: r.pid, exe: r.exe, binaryKind: r.binaryKind, headlessFlag: r.headlessFlag, ozone: r.ozone, useGl: r.useGl, useAngle: r.useAngle, gpuDisabled: r.gpuDisabled, userDataDir: r.userDataDir })),
    helperProcs: rows.length - mains.length,
    binaryKinds: kinds,
    lockDirPresent: fs.existsSync(LOCK),
    lockOwner,
    lockHeldByThisLine: !!(lockOwner && /incident2-live-repro/.test(lockOwner)),
  }
}

// ---------------------------------------------------------------------------
// shared cross-line lock (research-v2/.probe.lock): mkdir is atomic; stale holders
// (dead pid) may be reclaimed; retry 20-40s; max hold 30 min.
// ---------------------------------------------------------------------------
const LOCK_MAX_MS = 30 * 60 * 1000
function pidAlive(pid) { try { return fs.existsSync(`/proc/${pid}`) } catch { return false } }
function lockOwnerPid() {
  try {
    const txt = fs.readFileSync(path.join(LOCK, 'owner.txt'), 'utf8')
    // tolerate both conventions seen in this workspace: "pid=1234" and "pid: 1234"
    const m = txt.match(/(?:^|\n)\s*pid\s*[=:]\s*(\d+)/)
    return m ? Number(m[1]) : null
  } catch { return null }
}
function lockIsMine() {
  try {
    const txt = fs.readFileSync(path.join(LOCK, 'owner.txt'), 'utf8')
    return lockOwnerPid() === process.pid && /incident2-live-repro/.test(txt)
  } catch { return false }
}
function tryAcquireLock() {
  try {
    fs.mkdirSync(LOCK)
    fs.writeFileSync(path.join(LOCK, 'owner.txt'), [
      `pid=${process.pid}`,
      `ts=${new Date().toISOString()}`,
      'owner=incident2-live-repro',
      'line=full-new-page first-open 设置 click path (frame/LoF/CDP) headless vs headed',
      `dir=${ROOT}`,
      'scope: write only incident2/live-repro/ ; host read-only ; no restart/pkill/product edits',
      'browser: single instance, serialised',
      '',
    ].join('\n'))
    return 'ACQUIRED'
  } catch (e) {
    if (e.code !== 'EEXIST') return `ERROR:${e.code}`
    const holder = lockOwnerPid()
    const heldSince = (() => { try { const m = fs.readFileSync(path.join(LOCK, 'owner.txt'), 'utf8').match(/ts[=:]\s*(\S+)/); return m ? Date.parse(m[1]) : null } catch { return null } })()
    const mtime = (() => { try { return fs.statSync(path.join(LOCK, 'owner.txt')).mtimeMs } catch { try { return fs.statSync(LOCK).mtimeMs } catch { return null } } })()
    if (holder != null && !pidAlive(holder)) return `STALE:${holder}`
    const age = heldSince != null ? Date.now() - heldSince : (mtime != null ? Date.now() - mtime : null)
    if (age != null && age > LOCK_MAX_MS) return `EXPIRED:${holder}`
    return `HELD:${holder}`
  }
}
function reclaimLock() {
  try {
    const holder = lockOwnerPid()
    if (holder != null && pidAlive(holder)) return false
    fs.rmSync(path.join(LOCK, 'owner.txt'), { force: true })
    fs.rmdirSync(LOCK)
    return true
  } catch { return false }
}
async function acquireLockGated(maxWaitMs = 180000) {
  const t0 = Date.now()
  const history = []
  for (;;) {
    const r = tryAcquireLock()
    history.push({ at: new Date().toISOString(), result: r, waitedMs: Date.now() - t0 })
    if (r === 'ACQUIRED') return { acquired: true, history, waitedMs: Date.now() - t0 }
    if (/^(STALE|EXPIRED):/.test(r)) {
      if (reclaimLock()) continue
      await sleep(1000 + Math.floor(Math.random() * 2000))
      continue
    }
    if (Date.now() - t0 > maxWaitMs) return { acquired: false, history, waitedMs: Date.now() - t0, lastResult: r }
    await sleep(2000 + Math.floor(Math.random() * 3000))
  }
}
function releaseLock() {
  try {
    if (!lockIsMine()) return false
    fs.rmSync(path.join(LOCK, 'owner.txt'), { force: true })
    fs.rmdirSync(LOCK)
    return true
  } catch { return false }
}

// ---------------------------------------------------------------------------
// page-side instrumentation (installed before any app code runs)
// ---------------------------------------------------------------------------
const INLINE = `
(() => {
  if (window.__P) return;
  const P = window.__P = {
    t0: performance.now(), wall: Date.now(),
    frames: [], longtasks: [], lof: [], console: [], errors: [],
    mutations: [], resizes: [], evts: [], vis: [],
    dialogFirstDom: null, dialogFirstVisible: null, dialogDoubleRaf: null,
    dialogSeen: 0, dialogVisibleArmed: false,
    marks: {}, installErrors: [],
  };
  const now = () => performance.now();
  try {
    // ---- per-frame interval series ----
    let last = now();
    const loop = () => {
      const t = now();
      P.frames.push([Math.round(t * 1000) / 1000, Math.round((t - last) * 1000) / 1000]);
      last = t;
      if (P.frames.length < 200000) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    // ---- LongTask ----
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.longtasks.push({ t: Math.round(e.startTime*1000)/1000, dur: Math.round(e.duration*1000)/1000, name: e.name, attr: e.attribution ? e.attribution.map(a=>a.name) : [] }); }).observe({ type: 'longtask', buffered: true }); } catch (e) { P.installErrors.push('longtask: '+e.message); }

    // ---- long-animation-frame (LoF) ----
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          P.lof.push({
            t: Math.round(e.startTime*1000)/1000, dur: Math.round(e.duration*1000)/1000,
            renderStart: e.renderStart != null ? Math.round(e.renderStart*1000)/1000 : null,
            styleAndLayoutStart: e.styleAndLayoutStart != null ? Math.round(e.styleAndLayoutStart*1000)/1000 : null,
            blockingDuration: e.blockingDuration != null ? Math.round(e.blockingDuration*1000)/1000 : null,
            firstUIEventTimestamp: e.firstUIEventTimestamp != null ? Math.round(e.firstUIEventTimestamp*1000)/1000 : null,
            scripts: (e.scripts||[]).map(s => ({
              name: s.name || null, entryType: s.entryType || null, invoker: s.invoker || null,
              invokerType: s.invokerType || null,
              dur: Math.round(s.duration*1000)/1000,
              forcedStyleAndLayout: s.forcedStyleAndLayoutDuration != null ? Math.round(s.forcedStyleAndLayoutDuration*1000)/1000 : null,
              pause: s.pauseDuration != null ? Math.round(s.pauseDuration*1000)/1000 : null,
              sourceURL: s.sourceURL ? String(s.sourceURL).slice(0, 120) : null,
              sourceFunctionName: s.sourceFunctionName || null,
            })),
          });
        }
      }).observe({ type: 'long-animation-frame', buffered: true });
    } catch (e) { P.installErrors.push('lof: '+e.message); }

    // ---- console / errors ----
    const wrap = (lvl) => { const o = console[lvl].bind(console); console[lvl] = (...a) => { try { P.console.push({ t: now(), lvl, msg: a.map(x => { try { return typeof x === 'string' ? x : JSON.stringify(x) } catch { return String(x) } }).join(' ').slice(0,300) }); } catch {} return o(...a); }; };
    ['log','info','warn','error','debug'].forEach(wrap);
    window.addEventListener('error', (e) => P.errors.push({ t: now(), kind: 'error', msg: String(e.message).slice(0,300), src: String(e.filename||'').slice(0,120), line: e.lineno }), true);
    window.addEventListener('unhandledrejection', (e) => P.errors.push({ t: now(), kind: 'rejection', msg: String(e.reason && e.reason.message || e.reason).slice(0,300) }), true);

    // ---- capture the real click instant (authoritative t_click) ----
    const isSettings = (el) => { try { return !!(el && el.closest && el.closest('button') && /^设置$/.test((el.closest('button').textContent||'').trim())); } catch { return false } };
    for (const phase of ['pointerdown','mousedown','click']) {
      window.addEventListener(phase, (e) => {
        if (!isSettings(e.target)) return;
        P.evts.push({ t: now(), phase, isSettings: true });
        if (phase === 'click') { P.dialogVisibleArmed = true; P.lastClickT = now(); P.dialogFirstDom = null; P.dialogFirstVisible = null; P.dialogDoubleRaf = null; }
      }, true);
    }

    // ---- dialog appearance: DOM insert (MutationObserver) + rAF-confirmed visible ----
    const checkDialog = (src) => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return;
      if (P.dialogFirstDom == null) {
        P.dialogFirstDom = now();
        P.dialogSeen++;
        P.dialogNode = { cls: String(d.className||'').slice(0,120), rect: (r=>({w:Math.round(r.width),h:Math.round(r.height)}))(d.getBoundingClientRect()) };
        // rAF-confirm visibility (paint proxy): nonzero box, not hidden
        requestAnimationFrame(() => {
          const r = d.getBoundingClientRect();
          const cs = getComputedStyle(d);
          const vis = r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.01;
          P.dialogFirstVisible = now();
          P.dialogVisibleOk = vis;
          requestAnimationFrame(() => {
            const r2 = d.getBoundingClientRect();
            P.dialogDoubleRaf = now();
            P.dialogPaintedRect = { w: Math.round(r2.width), h: Math.round(r2.height) };
          });
        });
      }
    };
    try {
      const mo = new MutationObserver((recs) => {
        let added = 0, removed = 0;
        for (const r of recs) { added += r.addedNodes.length; removed += r.removedNodes.length; }
        const t = now();
        P.mutations.push({ t: Math.round(t*1000)/1000, n: recs.length, added, removed, kind: 'childList' });
        if (P.dialogVisibleArmed) checkDialog('mo');
      });
      mo.observe(document, { childList: true, subtree: true });
    } catch (e) { P.installErrors.push('mo: '+e.message); }

    // ---- documentElement/body style+class writes (theme replay surface) ----
    try {
      const mo2 = new MutationObserver((recs) => {
        for (const r of recs) {
          if (r.type !== 'attributes') continue;
          P.mutations.push({ t: Math.round(now()*1000)/1000, kind: 'attr', target: r.target.tagName, attr: r.attributeName,
            val: r.attributeName === 'style' ? String(r.target.getAttribute('style')||'').slice(0,160) : null });
        }
      });
      if (document.documentElement) mo2.observe(document.documentElement, { attributes: true, attributeFilter: ['style','class','data-theme','data-color-scheme'] });
      const attachBody = () => { if (document.body) mo2.observe(document.body, { attributes: true, attributeFilter: ['style','class','data-theme'] }); else setTimeout(attachBody, 5); };
      attachBody();
    } catch (e) { P.installErrors.push('mo2: '+e.message); }

    // ---- ResizeObserver ----
    try {
      const ro = new ResizeObserver((ents) => {
        for (const en of ents) { const r = en.contentRect; P.resizes.push({ t: Math.round(now()*1000)/1000, w: Math.round(r.width), h: Math.round(r.height), target: en.target.tagName + '.' + String(en.target.className||'').slice(0,40) }); }
      });
      const attach = () => { if (document.documentElement) ro.observe(document.documentElement); if (document.body) ro.observe(document.body); else setTimeout(attach, 5); };
      attach();
    } catch (e) { P.installErrors.push('ro: '+e.message); }

    // ---- visibility ----
    document.addEventListener('visibilitychange', () => P.vis.push({ t: Math.round(now()*1000)/1000, state: document.visibilityState }));
  } catch (e) { P.installErrors.push('outer: ' + e.message); }
})();
`

const markerCheck = async (page, revs) => page.evaluate(async (revsIn) => {
  const out = {}
  for (const [pkg, spec] of Object.entries(revsIn)) {
    const url = `/plugins/${pkg}/client.js?rev=${spec.rev}`
    const r = { url, rev: spec.rev, ok: false }
    try {
      const res = await fetch(url, { cache: 'no-store' })
      const text = await res.text()
      r.status = res.status
      r.bytes = text.length
      const enc = new TextEncoder().encode(text)
      const dig = await crypto.subtle.digest('SHA-1', enc)
      r.sha1_12 = Array.from(new Uint8Array(dig)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12)
      r.markers = {}
      for (const m of spec.markers) {
        const n = text.split(m).length - 1
        r.markers[m] = n
      }
      r.ok = r.sha1_12 === spec.rev && Object.values(r.markers).some((n) => n > 0)
    } catch (e) { r.err = String(e.message) }
    out[pkg] = r
  }
  // also: what the document actually loaded
  out.__loadedResources = performance.getEntriesByType('resource')
    .filter((e) => /client\.js\?rev=/.test(e.name))
    .map((e) => ({ url: e.name.replace(location.origin, ''), initiatorType: e.initiatorType, encodedBodySize: e.encodedBodySize, decodedBodySize: e.decodedBodySize, transferSize: e.transferSize, startTime: Math.round(e.startTime), duration: Math.round(e.duration) }))
  return out
}, revs)

const REVS = {
  '@deepseek-ai/dsh-client-ui-layout': { rev: '82cca1a6178a', markers: ['scheduleThemeColorRefresh', 'lastSignature', 'themeColorRefreshQueue'] },
  '@local/dsh-wallpaper': { rev: '826d9217a8fc', markers: ['shadedTokens', 'sameShadedTokens', 'lastTokens'] },
  '@deepseek-ai/dsh-client-runtime': { rev: '5559de4ce28c', markers: ['p2ac-fix'] },
  '@local/dsh-usage': { rev: '4536b91ed282', markers: ['dsh-perf-fix'] },
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------
const myPid = process.pid
const myAnc = ancestry(myPid)
const report = {
  tag: TAG, mode: MODE, run: RUN, headed: HEADED, clicks: CLICKS,
  startedAt: new Date().toISOString(), hostPid: HOST_PID,
  hostAlive: (() => { try { return fs.readFileSync(`/proc/${HOST_PID}/cmdline`, 'utf8').replace(/\0/g, ' ').trim() } catch { return null } })(),
  lockPath: LOCK,
  censusStart: census(myPid, myAnc),
  windows: [], marks: {}, analysis: {}, verdict: null,
}
const cdpMetrics = async (cdp) => {
  const { metrics } = await cdp.send('Performance.getMetrics')
  const o = {}
  for (const m of metrics) o[m.name] = m.value
  return o
}
const delta = (a, b) => {
  const keys = ['ScriptDuration','TaskDuration','LayoutDuration','RecalcStyleDuration','LayoutCount','RecalcStyleCount','JSHeapUsedSize','Nodes','Documents','Timestamp']
  const o = {}
  for (const k of keys) o[k] = (a[k] != null && b[k] != null) ? Math.round((b[k] - a[k]) * 1e6) / 1e6 : null
  return o
}

let browser = null
let lockHeld = false
try {
  // ---- gate: hold the shared cross-line lock and require zero foreign browser mains ----
  const lockRes = await acquireLockGated(Number(argOf('lockwait', 180000)))
  report.lock = lockRes
  lockHeld = lockRes.acquired
  if (!lockRes.acquired) {
    report.gateOutcome = 'CONTENDED'
    report.fatal = { msg: `could not acquire shared probe lock within budget: ${lockRes.lastResult}` }
  } else {
    const pre = census(myPid, myAnc)
    report.censusBeforeLaunch = pre
    if (pre.foreignMainInstances > 0) {
      report.gateOutcome = 'CONTENDED'
      report.fatal = { msg: `foreign browser main instances present before launch: ${JSON.stringify(pre.foreign)}` }
    }
  }

  if (!report.fatal) {
  const launchArgs = [
    '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--window-size=1440,900',
  ]
  const t_launch = Date.now()
  browser = await chromium.launch({ headless: !HEADED, args: launchArgs })
  report.launchMs = Date.now() - t_launch
  report.browserVersion = browser.version()
  report.censusAfterLaunch = census(myPid, myAnc)

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Performance.enable')
  await page.addInitScript(INLINE)

  const t_nav = Date.now()
  await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('[role="treeitem"]', { timeout: 60000 })
  report.navMs = Date.now() - t_nav
  await page.waitForLoadState('load').catch(() => { })
  // wait for stable
  await page.waitForTimeout(2000)
  const t_stable = Date.now()
  const treeitems = await page.locator('[role="treeitem"]').count()
  const nodes0 = await page.evaluate(() => document.getElementsByTagName('*').length)
  const visInfo = await page.evaluate(() => ({ state: document.visibilityState, focused: document.hasFocus(), rafGapNow: null }))
  report.page = { treeitems, nodesAtStable: nodes0, visibilityState: visInfo.state, hasFocus: visInfo.focused }
  report.gpu = await page.evaluate(() => {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl')
    if (!gl) return { webgl: false }
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    return {
      webgl: true,
      vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      version: gl.getParameter(gl.VERSION),
    }
  }).catch(() => ({ webgl: 'err' }))

  // ---- marker self-proof (do this BEFORE the click so it cannot pollute the click window) ----
  report.markerProof = await markerCheck(page, REVS)

  // ---- arm: reset recorders, define idle window ----
  await page.evaluate(() => { const P = window.__P; P.frames.length = 0; P.longtasks.length = 0; P.lof.length = 0; P.console.length = 0; P.errors.length = 0; P.mutations.length = 0; P.resizes.length = 0; P.vis.length = 0; P.marks.t_arm = performance.now(); })
  const mIdle0 = await cdpMetrics(cdp)
  const t_idleA = Date.now()
  await sleep(IDLE_MS)
  const mIdle1 = await cdpMetrics(cdp)
  const t_idleB = Date.now()
  report.windows.push({ name: 'idle', wallMs: t_idleB - t_idleA, metricsDelta: delta(mIdle0, mIdle1) })

  const btn = page.locator('button', { hasText: /^设置$/ }).first()
  let dialogOpen = false
  report.censusAtIdleEnd = census(myPid, myAnc)
  for (let i = 1; i <= CLICKS; i++) {
    // settle before this click
    if (i > 1) {
      // close the drawer by clicking the trigger again (toggle), then settle
      await page.locator('button', { hasText: /^设置$/ }).first().click({ timeout: 15000 }).catch(() => { })
      await page.waitForTimeout(400)
      const stillOpen = await page.locator('[role="dialog"]').count()
      if (stillOpen > 0) await page.keyboard.press('Escape').catch(() => { })
      await page.waitForTimeout(600)
      const openNow = await page.locator('[role="dialog"]').count()
      report[`closedBeforeClick${i}`] = openNow === 0
      if (openNow > 0) {
        // could not close the drawer -> a "re-open" measurement here would be meaningless
        report.windows.push({ name: `click${i}`, index: i, invalid: true, invalidReason: 'drawer still open before this click; repeat-open measurement not possible', preDialogCount: openNow })
        continue
      }
      await page.evaluate((i) => { const P = window.__P; P.frames.length = 0; P.longtasks.length = 0; P.lof.length = 0; P.mutations.length = 0; P.dialogFirstDom = null; P.dialogFirstVisible = null; P.dialogDoubleRaf = null; P.dialogVisibleArmed = false; P.evts.length = 0; P.marks['t_arm' + i] = performance.now(); }, i)
      await sleep(SETTLE_MS)
    } else {
      await page.evaluate(() => { const P = window.__P; P.marks.t_arm1 = performance.now(); })
    }
    const mPre = await cdpMetrics(cdp)
    const tPreWall = Date.now()
    // mark pre-window boundaries in page time
    await page.evaluate((i) => { window.__P.marks['t_pre' + i] = performance.now() }, i)

    const tClickWall = Date.now()
    await btn.click({ timeout: 15000 })
    const tClickReturnWall = Date.now() - tClickWall
    // dialog visibility via Playwright (cross-check)
    let pwDialogMs = null
    const pwT0 = Date.now()
    try {
      await page.waitForSelector('[role="dialog"]', { state: 'visible', timeout: 15000 })
      pwDialogMs = Date.now() - pwT0
    } catch { pwDialogMs = null }
    await page.evaluate((i) => { window.__P.marks['t_dialogpw' + i] = performance.now() }, i)
    await sleep(POST_MS)
    const mPost = await cdpMetrics(cdp)
    const tPostWall = Date.now()
    await page.evaluate((i) => { window.__P.marks['t_post' + i] = performance.now() }, i)

    const pg = await page.evaluate((i) => {
      const P = window.__P
      return {
        t_click: P.lastClickT ?? null, marks: P.marks,
        dialogFirstDom: P.dialogFirstDom, dialogFirstVisible: P.dialogFirstVisible,
        dialogDoubleRaf: P.dialogDoubleRaf, dialogVisibleOk: P.dialogVisibleOk ?? null,
        dialogPaintedRect: P.dialogPaintedRect ?? null, dialogNode: P.dialogNode ?? null,
        evts: P.evts.slice(-5), installErrors: P.installErrors,
        nodesNow: document.getElementsByTagName('*').length,
        visibilityState: document.visibilityState,
        frames: P.frames.slice(), longtasks: P.longtasks.slice(), lof: P.lof.slice(),
        mutations: P.mutations.slice(), resizes: P.resizes.slice(), console: P.console.slice(), errors: P.errors.slice(), vis: P.vis.slice(),
      }
    }, i)
    await page.screenshot({ path: path.join(SHOTS, `${TAG}-click${i}.png`) }).catch(() => { })
    report.windows.push({
      name: `click${i}`, index: i, wallPreMs: tClickWall - tPreWall, clickCallMs: tClickReturnWall,
      wallPostMs: tPostWall - tClickWall, playwrightDialogVisibleMs: pwDialogMs,
      pageNowAtRead: pg.marks['t_post' + i],
      clickToDialogDomMs: (pg.dialogFirstDom != null && pg.t_click != null) ? r3(pg.dialogFirstDom - pg.t_click) : null,
      clickToDialogVisibleMs: (pg.dialogFirstVisible != null && pg.t_click != null) ? r3(pg.dialogFirstVisible - pg.t_click) : null,
      clickToDialogPaintedMs: (pg.dialogDoubleRaf != null && pg.t_click != null) ? r3(pg.dialogDoubleRaf - pg.t_click) : null,
      dialogVisibleOk: pg.dialogVisibleOk, dialogPaintedRect: pg.dialogPaintedRect, dialogNode: pg.dialogNode,
      nodesNow: pg.nodesNow, visibilityState: pg.visibilityState,
      metricsDelta: delta(mPre, mPost),
      raw: { marks: pg.marks, evts: pg.evts, frames: pg.frames, longtasks: pg.longtasks, lof: pg.lof, mutations: pg.mutations, resizes: pg.resizes, console: pg.console, errors: pg.errors, vis: pg.vis, installErrors: pg.installErrors },
    })
    dialogOpen = true
    // census taken AFTER the measured window closes, so it cannot pollute the click window
    report[`censusAfterClick${i}`] = census(myPid, myAnc)
    if (i === 1 && pg.dialogVisibleOk === false) report.warn_dialogVisibleFalse = true
  }

  report.marks = await page.evaluate(() => window.__P.marks)
  report.censusEnd = census(myPid, myAnc)
  report.gateOutcome = (report.censusEnd.foreignMainInstances === 0 && report.censusEnd.mainInstancesMine === 1 && lockHeld)
    ? 'EXCLUSIVE'
    : 'CONTENDED'
  }
} catch (e) {
  report.fatal = { msg: String(e && e.message), stack: String(e && e.stack).slice(0, 1500) }
  report.gateOutcome = report.gateOutcome || 'ERROR'
  try { report.censusEnd = census(process.pid, ancestry(process.pid)) } catch { }
} finally {
  if (browser) await browser.close().catch(() => { })
  if (lockHeld) report.lockReleased = releaseLock()
}

report.finishedAt = new Date().toISOString()
const outFile = path.join(RAW, `${TAG}.json`)
fs.writeFileSync(outFile, JSON.stringify(report, null, 1))
console.log(`[probe] wrote ${outFile}`)
if (report.fatal) console.log(`[probe] FATAL ${report.fatal.msg}`)
for (const w of report.windows) {
  console.log(`[win] ${w.name.padEnd(8)} dur=${w.wallMs ?? (w.wallPreMs + w.wallPostMs)}ms click->dom=${w.clickToDialogDomMs} click->vis=${w.clickToDialogVisibleMs} click->paint=${w.clickToDialogPaintedMs} pwVis=${w.playwrightDialogVisibleMs} nodes=${w.nodesNow ?? ''} ${w.metricsDelta ? `Task=${r3(w.metricsDelta.TaskDuration * 1000)}ms Script=${r3(w.metricsDelta.ScriptDuration * 1000)}ms Recalc=${r3(w.metricsDelta.RecalcStyleDuration * 1000)}ms RecalcN=${w.metricsDelta.RecalcStyleCount} LayoutN=${w.metricsDelta.LayoutCount}` : ''}`)
}
console.log(`[gate] outcome=${report.gateOutcome} beforeLaunch=${report.censusBeforeLaunch ? report.censusBeforeLaunch.mainInstancesTotal : 'n/a'} afterLaunchMine=${report.censusAfterLaunch ? report.censusAfterLaunch.mainInstancesMine : 'n/a'} endForeign=${report.censusEnd ? report.censusEnd.foreignMainInstances : 'n/a'} kinds=${JSON.stringify(report.censusAfterLaunch ? report.censusAfterLaunch.binaryKinds : {})} lockReleased=${report.lockReleased}`)
if (report.gateOutcome !== 'EXCLUSIVE' || report.fatal) process.exitCode = 3
