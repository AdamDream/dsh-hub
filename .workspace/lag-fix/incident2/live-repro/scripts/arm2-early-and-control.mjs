// Arm 2: (A) instrument positive control  +  (B) early-click arm.
//
// Motivation (from the independent audit):
//   * F: the earlier control never injected the stall (Playwright evaluate arg bug), so
//     the LongTask/LoF channel was never validated -> "no freeze" was INCONCLUSIVE-by-instrument.
//   * I: the page needs ~12 s to become stable (8.26 MB of client bundles), so a user who
//     "just opens the page and clicks 设置" clicks DURING initialisation, a phase nothing measured.
//
// One browser instance, one lock acquisition, everything recorded:
//   phase CONTROL  : 3 s clean window, then inject a blocking busy-loop, verify the recorders fire.
//   phase EARLY    : fresh context -> click 设置 as early as the button is actionable (and at
//                    configurable extra delays) -> measure click->dialog + frames + LT/LoF + CDP.
//   phase STABLE   : same but after the page is fully settled, as the in-session reference.
//
// Read-only: only the 设置 trigger is clicked (opens the drawer). No save/apply/delete.

import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/live-repro'
const RAW = path.join(ROOT, 'raw')
const SHOTS = path.join(ROOT, 'shots')
const LOCK = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock'
const argv = process.argv.slice(2)
const argOf = (k, d) => { const p = argv.find((a) => a.startsWith(`--${k}=`)); return p ? p.slice(k.length + 3) : d }
const MODE = argOf('mode', 'headless')
const STALL = Number(argOf('stall', 180))
const EARLY = argOf('early', '0,1500').split(',').map(Number)
const TAG = argOf('tag', `arm2-early-control-${MODE}`)
const HOST_PID = Number(argOf('hostpid', 10806))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000)

// ---------------- lock ----------------
function lockOwnerPid() { try { const m = fs.readFileSync(path.join(LOCK, 'owner.txt'), 'utf8').match(/(?:^|\n)\s*(?:owner_)?pid\s*[=:]\s*(\d+)/); return m ? Number(m[1]) : null } catch { return null } }
const alive = (p) => { try { return fs.existsSync(`/proc/${p}`) } catch { return false } }
function lockIsMine() { try { return lockOwnerPid() === process.pid && /incident2-live-repro/.test(fs.readFileSync(path.join(LOCK, 'owner.txt'), 'utf8')) } catch { return false } }
async function acquire(maxMs = 600000) {
  const t0 = Date.now(); const hist = []
  for (;;) {
    try {
      fs.mkdirSync(LOCK)
      fs.writeFileSync(path.join(LOCK, 'owner.txt'), `pid=${process.pid}\nts=${new Date().toISOString()}\nowner=incident2-live-repro\nline=arm2 early-click + instrument positive control\ndir=${ROOT}\n`)
      return { acquired: true, waitedMs: Date.now() - t0, history: hist }
    } catch (e) {
      if (e.code !== 'EEXIST') return { acquired: false, err: e.code, history: hist }
      const h = lockOwnerPid()
      hist.push({ at: new Date().toISOString(), heldBy: h, alive: h == null ? null : alive(h) })
      if (h != null && !alive(h)) { try { fs.rmSync(path.join(LOCK, 'owner.txt'), { force: true }); fs.rmdirSync(LOCK); continue } catch { } }
      if (Date.now() - t0 > maxMs) return { acquired: false, lastResult: `HELD:${h}`, history: hist, waitedMs: Date.now() - t0 }
      await sleep(2500 + Math.random() * 2500)
    }
  }
}
function release() { try { if (!lockIsMine()) return false; fs.rmSync(path.join(LOCK, 'owner.txt'), { force: true }); fs.rmdirSync(LOCK); return true } catch { return false } }

// ---------------- census ----------------
function procRows() {
  const rows = []
  for (const pid of (() => { try { return fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x)) } catch { return [] } })()) {
    let exe = null
    try { exe = fs.readlinkSync(`/proc/${pid}/exe`) } catch { continue }
    if (!/(chrome|chromium|headless_shell)$/.test(exe)) continue
    let raw = ''
    try { raw = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim() } catch { }
    const typeM = raw.match(/--type=(\S+)/)
    rows.push({ pid: Number(pid), exe, binaryKind: exe.includes('headless_shell') ? 'headless_shell' : 'chrome', type: typeM ? typeM[1] : null, isMain: /--remote-debugging-pipe/.test(raw) && !typeM && /--user-data-dir=/.test(raw) })
  }
  return rows
}
function census(myPid) {
  const rows = procRows()
  const mains = rows.filter((r) => r.isMain)
  const isMine = (r) => { let cur = r.pid; for (let i = 0; i < 12 && cur > 1; i++) { let pp = 0; try { const st = fs.readFileSync(`/proc/${cur}/stat`, 'utf8'); pp = Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[1]) } catch { break } if (pp === myPid) return true; cur = pp } return r.pid === myPid }
  const mine = mains.filter(isMine), foreign = mains.filter((r) => !isMine(r))
  const kinds = {}; for (const r of rows) kinds[r.binaryKind] = (kinds[r.binaryKind] || 0) + 1
  let lockOwner = null
  try { lockOwner = fs.readFileSync(path.join(LOCK, 'owner.txt'), 'utf8').split('\n').slice(0, 3).join(' | ') } catch { }
  return { at: new Date().toISOString(), mainInstancesTotal: mains.length, mainInstancesMine: mine.length, foreignMainInstances: foreign.length, foreign: foreign.map((r) => ({ pid: r.pid, exe: r.exe })), mine: mine.map((r) => ({ pid: r.pid, binaryKind: r.binaryKind })), helperProcs: rows.length - mains.length, binaryKinds: kinds, lockOwner, lockHeldByThisLine: !!(lockOwner && /incident2-live-repro/.test(lockOwner)) }
}
function hostLoad() {
  let loadavg = null, pressure = null
  try { loadavg = fs.readFileSync('/proc/loadavg', 'utf8').trim() } catch { }
  try { pressure = fs.readFileSync('/proc/pressure/cpu', 'utf8').trim() } catch { }
  return { at: new Date().toISOString(), loadavg, pressure }
}

// ---------------- page instrumentation ----------------
const INLINE = `
(() => {
  if (window.__P) return;
  const P = window.__P = { frames: [], longtasks: [], lof: [], evts: [], marks: {}, errors: [], console: [],
    dialogFirstDom: null, dialogFirstVisible: null, dialogDoubleRaf: null, armed: false, installErrors: [] };
  const now = () => performance.now();
  let last = now();
  const loop = () => { const t = now(); P.frames.push([Math.round(t*1000)/1000, Math.round((t-last)*1000)/1000]); last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.longtasks.push({ t: Math.round(e.startTime*1000)/1000, dur: Math.round(e.duration*1000)/1000, name: e.name }); }).observe({ type: 'longtask', buffered: true }) } catch (e) { P.installErrors.push('longtask:'+e.message) }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.lof.push({ t: Math.round(e.startTime*1000)/1000, dur: Math.round(e.duration*1000)/1000, blocking: e.blockingDuration, renderStart: e.renderStart!=null?Math.round(e.renderStart*1000)/1000:null, styleAndLayoutStart: e.styleAndLayoutStart!=null?Math.round(e.styleAndLayoutStart*1000)/1000:null, scripts: (e.scripts||[]).map(s=>({ name: s.name||null, fn: s.sourceFunctionName||null, invoker: s.invoker||null, invokerType: s.invokerType||null, dur: Math.round(s.duration*1000)/1000, forced: s.forcedStyleAndLayoutDuration!=null?Math.round(s.forcedStyleAndLayoutDuration*1000)/1000:null, src: s.sourceURL?String(s.sourceURL).slice(0,110):null })) }); }).observe({ type: 'long-animation-frame', buffered: true }) } catch (e) { P.installErrors.push('lof:'+e.message) }
  const wrap = (lvl) => { const o = console[lvl].bind(console); console[lvl] = (...a) => { try { P.console.push({ t: now(), lvl, msg: a.map(x=>{try{return typeof x==='string'?x:JSON.stringify(x)}catch{return String(x)}}).join(' ').slice(0,240) }) } catch {} return o(...a) } };
  ['log','info','warn','error','debug'].forEach(wrap);
  window.addEventListener('error', (e) => P.errors.push({ t: now(), kind:'error', msg: String(e.message).slice(0,240) }), true);
  window.addEventListener('unhandledrejection', (e) => P.errors.push({ t: now(), kind:'rejection', msg: String(e.reason&&e.reason.message||e.reason).slice(0,240) }), true);
  const isSettings = (el) => { try { return !!(el && el.closest && el.closest('button') && /^设置$/.test((el.closest('button').textContent||'').trim())) } catch { return false } };
  for (const phase of ['pointerdown','mousedown','click']) window.addEventListener(phase, (e) => {
    if (!isSettings(e.target)) return;
    P.evts.push({ t: now(), phase });
    if (phase === 'click') { P.armed = true; P.lastClickT = now(); P.dialogFirstDom = null; P.dialogFirstVisible = null; P.dialogDoubleRaf = null; }
  }, true);
  const check = () => {
    const d = document.querySelector('[role="dialog"]'); if (!d) return;
    if (P.dialogFirstDom != null) return;
    P.dialogFirstDom = now();
    requestAnimationFrame(() => { const r = d.getBoundingClientRect(); const cs = getComputedStyle(d); P.dialogFirstVisible = now(); P.dialogVisibleOk = r.width>0&&r.height>0&&cs.visibility!=='hidden'&&cs.display!=='none'&&Number(cs.opacity)>0.01;
      requestAnimationFrame(() => { const r2=d.getBoundingClientRect(); P.dialogDoubleRaf = now(); P.dialogPaintedRect={w:Math.round(r2.width),h:Math.round(r2.height)}; }); });
  };
  try { new MutationObserver(() => { if (P.armed) check(); }).observe(document, { childList: true, subtree: true }) } catch (e) { P.installErrors.push('mo:'+e.message) }
})();
`

const REVS = {
  '@deepseek-ai/dsh-client-ui-layout': { rev: '82cca1a6178a', markers: ['scheduleThemeColorRefresh', 'landingIntact'] },
  '@local/dsh-wallpaper': { rev: '826d9217a8fc', markers: ['sameShadedTokens'] },
  '@deepseek-ai/dsh-client-runtime': { rev: '5559de4ce28c', markers: ['p2ac-fix'] },
  '@local/dsh-usage': { rev: '4536b91ed282', markers: ['dsh-perf-fix R4 v1'] },
}

const report = {
  tag: TAG, mode: MODE, stalledMs: STALL, earlyDelays: EARLY, startedAt: new Date().toISOString(), hostPid: HOST_PID,
  hostCmdline: (() => { try { return fs.readFileSync(`/proc/${HOST_PID}/cmdline`, 'utf8').replace(/\0/g, ' ').trim() } catch { return null } })(),
  hostLoadStart: hostLoad(), phases: {}, checks: {},
}
const myPid = process.pid
let browser = null, held = false
try {
  const lk = await acquire()
  report.lock = lk; held = lk.acquired
  if (!lk.acquired) { report.fatal = { msg: 'lock not acquired: ' + lk.lastResult } }
  else {
    report.censusBeforeLaunch = census(myPid)
    browser = await chromium.launch({ headless: MODE !== 'headed', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--window-size=1440,900'] })
    report.browserVersion = browser.version()
    report.censusAfterLaunch = census(myPid)
    const met = async (cdp) => { const { metrics } = await cdp.send('Performance.getMetrics'); const o = {}; for (const m of metrics) o[m.name] = m.value; return o }
    const delta = (a, b) => { const o = {}; for (const k of ['ScriptDuration','TaskDuration','LayoutDuration','RecalcStyleDuration','LayoutCount','RecalcStyleCount','Nodes']) o[k] = (a[k] != null && b[k] != null) ? Math.round((b[k] - a[k]) * 1e6) / 1e6 : null; return o }

    // ================= PHASE CONTROL =================
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      const page = await ctx.newPage()
      const cdp = await ctx.newCDPSession(page); await cdp.send('Performance.enable')
      await page.addInitScript(INLINE)
      await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 90000 })
      await page.waitForSelector('[role="treeitem"]', { timeout: 90000 })
      await page.waitForTimeout(3000)
      // clean window
      await page.evaluate(() => { const P = window.__P; P.frames.length = 0; P.longtasks.length = 0; P.lof.length = 0 })
      const c0 = await met(cdp); await sleep(3000); const c1 = await met(cdp)
      const clean = await page.evaluate(() => ({ frames: window.__P.frames.slice(), longtasks: window.__P.longtasks.slice(), lof: window.__P.lof.slice(), installErrors: window.__P.installErrors }))
      // injection window
      await page.evaluate(() => { const P = window.__P; P.frames.length = 0; P.longtasks.length = 0; P.lof.length = 0 })
      const i0 = await met(cdp)
      const busy = await page.evaluate((ms) => { const t0 = performance.now(); let x = 0; while (performance.now() - t0 < ms) x += Math.sqrt(x + 1); return performance.now() - t0 }, STALL)
      await sleep(3000)
      const i1 = await met(cdp)
      const inj = await page.evaluate(() => ({ frames: window.__P.frames.slice(), longtasks: window.__P.longtasks.slice(), lof: window.__P.lof.slice() }))
      const st = (fr) => { const d = fr.map((f) => f[1]).sort((a, b) => a - b); return d.length ? { n: d.length, p50: r3(d[Math.floor(d.length / 2)]), max: r3(d[d.length - 1]), over50: d.filter((v) => v >= 50).length, over100: d.filter((v) => v >= 100).length } : { n: 0 } }
      report.phases.control = {
        injectedBusyMs: r3(busy),
        clean: { frames: st(clean.frames), longtaskMax: clean.longtasks.length ? Math.max(...clean.longtasks.map((x) => x.dur)) : null, lofMax: clean.lof.length ? Math.max(...clean.lof.map((x) => x.dur)) : null, metricsDelta: delta(c0, c1), installErrors: clean.installErrors },
        injected: { frames: st(inj.frames), longtaskMax: inj.longtasks.length ? Math.max(...inj.longtasks.map((x) => x.dur)) : null, lofMax: inj.lof.length ? Math.max(...inj.lof.map((x) => x.dur)) : null, lofCount: inj.lof.length, longtaskCount: inj.longtasks.length, metricsDelta: delta(i0, i1), longest: inj.frames.slice().sort((a, b) => b[1] - a[1]).slice(0, 4) },
        sampleLof: inj.lof.slice(0, 2),
      }
      report.checks.frameSpikeDetected = (report.phases.control.injected.frames.max ?? 0) >= STALL * 0.7
      report.checks.longtaskFired = (report.phases.control.injected.longtaskMax ?? 0) >= 50
      report.checks.lofFired = (report.phases.control.injected.lofMax ?? 0) >= 50
      report.checks.cdpTaskJumped = (report.phases.control.injected.metricsDelta.TaskDuration ?? 0) >= STALL * 0.7
      report.checks.cleanWasQuiet = (report.phases.control.clean.frames.max ?? 0) < STALL * 0.5
      await ctx.close()
    }
    report.censusAfterControl = census(myPid)

    // ================= PHASE EARLY / STABLE =================
    report.phases.clicks = []
    for (const [idx, delay] of EARLY.entries()) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      const page = await ctx.newPage()
      const cdp = await ctx.newCDPSession(page); await cdp.send('Performance.enable')
      await page.addInitScript(INLINE)
      const tNav = Date.now()
      await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 90000 })
      const navMs = Date.now() - tNav
      // as early as the trigger exists; Playwright waits for actionability itself
      await page.waitForSelector('button:has-text("设置")', { timeout: 90000 })
      const tBtn = Date.now()
      const btnReadyMs = tBtn - tNav
      const pgTimeAtBtn = await page.evaluate(() => performance.now())
      if (delay > 0) await page.waitForTimeout(delay)
      const preClickPageTime = await page.evaluate(() => performance.now())
      const loadStateAtClick = await page.evaluate(() => document.readyState)
      const nodesAtClick = await page.evaluate(() => document.getElementsByTagName('*').length)
      const resourcesAtClick = await page.evaluate(() => ({ n: performance.getEntriesByType('resource').length, big: performance.getEntriesByType('resource').filter((e) => e.encodedBodySize > 300000).map((e) => ({ name: e.name.replace(location.origin, '').slice(0, 70), kb: Math.round(e.encodedBodySize / 1024), ms: Math.round(e.duration) })) }))
      const mPre = await met(cdp)
      await page.evaluate(() => { const P = window.__P; P.frames.length = 0; P.longtasks.length = 0; P.lof.length = 0; P.marks.t_pre = performance.now(); P.armed = false })
      const mPre2 = await met(cdp)
      const tClickWall = Date.now()
      let clickErr = null
      try { await page.locator('button', { hasText: /^设置$/ }).first().click({ timeout: 30000 }) } catch (e) { clickErr = String(e.message).slice(0, 200) }
      const clickCallMs = Date.now() - tClickWall
      let pwVis = null
      const pwT0 = Date.now()
      try { await page.waitForSelector('[role="dialog"]', { state: 'visible', timeout: 20000 }); pwVis = Date.now() - pwT0 } catch { }
      await sleep(3000)
      const mPost = await met(cdp)
      const pg = await page.evaluate(() => { const P = window.__P; return { frames: P.frames.slice(), longtasks: P.longtasks.slice(), lof: P.lof.slice(), marks: P.marks, evts: P.evts.slice(), dialogFirstDom: P.dialogFirstDom, dialogFirstVisible: P.dialogFirstVisible, dialogDoubleRaf: P.dialogDoubleRaf, dialogVisibleOk: P.dialogVisibleOk ?? null, dialogPaintedRect: P.dialogPaintedRect ?? null, errors: P.errors.slice(), console: P.console.filter((c) => c.lvl === 'error' || c.lvl === 'warn').slice(0, 15), installErrors: P.installErrors, nodesNow: document.getElementsByTagName('*').length, readyState: document.readyState } })
      const clickT = pg.evts.filter((e) => e.phase === 'click').slice(-1)[0]?.t ?? null
      const nodeCount = { atClick: nodesAtClick, after: pg.nodesNow }
      await page.screenshot({ path: path.join(SHOTS, `${TAG}-delay${delay}.png`) }).catch(() => { })
      report.phases.clicks.push({
        index: idx, delayMs: delay, navMs, btnActionableMs: btnReadyMs, pageTimeAtButtonMs: r3(pgTimeAtBtn),
        pageTimeAtClickMs: r3(preClickPageTime), readyStateAtClick: loadStateAtClick, nodesAtClick, resourcesAtClick,
        clickToDialogDomMs: (pg.dialogFirstDom != null && clickT != null) ? r3(pg.dialogFirstDom - clickT) : null,
        clickToDialogVisibleMs: (pg.dialogFirstVisible != null && clickT != null) ? r3(pg.dialogFirstVisible - clickT) : null,
        clickToDialogPaintedMs: (pg.dialogDoubleRaf != null && clickT != null) ? r3(pg.dialogDoubleRaf - clickT) : null,
        playwrightDialogVisibleMs: pwVis, clickCallMs, clickErr, dialogVisibleOk: pg.dialogVisibleOk, dialogPaintedRect: pg.dialogPaintedRect,
        metricsDelta: delta(mPre2, mPost), clickT: r3(clickT), spanAfterClickMs: r3((pg.marks.t_post ?? null) != null ? null : null),
        frames: pg.frames, longtasks: pg.longtasks, lof: pg.lof, errors: pg.errors, console: pg.console, installErrors: pg.installErrors, nodeCount,
      })
      // gate bracket taken immediately AFTER the window closes (cannot pollute the window)
      report[`censusAfterClick${idx}`] = census(myPid)
      report[`hostLoadAfterClick${idx}`] = hostLoad()
      await ctx.close()
    }
    // marker proof on a fresh page
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      const page = await ctx.newPage()
      await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 90000 })
      report.markerProof = await page.evaluate(async (revs) => {
        const out = {}
        for (const [pkg, spec] of Object.entries(revs)) {
          const url = `/plugins/${pkg}/client.js?rev=${spec.rev}`
          const r = { rev: spec.rev, ok: false, markers: {} }
          try {
            const t = await (await fetch(url, { cache: 'no-store' })).text()
            const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(t))
            r.sha1_12 = Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12)
            r.bytes = t.length
            for (const mk of spec.markers) r.markers[mk] = t.split(mk).length - 1
            r.ok = r.sha1_12 === spec.rev && Object.values(r.markers).every((n) => n > 0)
          } catch (e) { r.err = String(e.message) }
          out[pkg] = r
        }
        return out
      }, REVS)
      await ctx.close()
    }
    report.censusEnd = census(myPid)
  }
} catch (e) {
  report.fatal = { msg: String(e && e.message).slice(0, 1200) }
} finally {
  if (browser) await browser.close().catch(() => { })
  if (held) report.lockReleased = release()
}
report.finishedAt = new Date().toISOString()
report.hostLoadEnd = hostLoad()

// honest gate: EXCLUSIVE only if we held the lock at every bracketing census AND no foreign main
const brackets = Object.entries(report).filter(([k]) => /^census/.test(k)).map(([, v]) => v).filter(Boolean)
report.gateOutcome = (!report.fatal && held && brackets.length && brackets.every((b) => b.foreignMainInstances === 0 && b.mainInstancesMine === 1)) ? 'EXCLUSIVE(brackets)' : (report.fatal ? 'ERROR' : 'CONTENDED-OR-UNVERIFIED')
report.gateBrackets = brackets.map((b) => ({ at: b.at, mine: b.mainInstancesMine, foreign: b.foreignMainInstances, lockMine: b.lockHeldByThisLine }))
report.gateNote = 'lock ownership is sampled only at bracket instants; continuous ownership during the click windows is NOT proven'
fs.writeFileSync(path.join(RAW, `${TAG}.json`), JSON.stringify(report, null, 1))
console.log(`[arm2] wrote raw/${TAG}.json  gate=${report.gateOutcome} fatal=${report.fatal ? report.fatal.msg.slice(0, 80) : 'none'}`)
if (report.checks && Object.keys(report.checks).length) console.log('[arm2] control checks:', JSON.stringify(report.checks))
if (report.phases.control) console.log('[arm2] control injected busy=%sms frames.max=%s lt.max=%s lof.max=%s | clean frames.max=%s lt=%s lof=%s', report.phases.control.injectedBusyMs, report.phases.control.injected.frames.max, report.phases.control.injected.longtaskMax, report.phases.control.injected.lofMax, report.phases.control.clean.frames.max, report.phases.control.clean.longtaskMax, report.phases.control.clean.lofMax)
for (const c of report.phases.clicks || []) console.log(`[arm2] delay=${c.delayMs}ms btnReady=${c.btnActionableMs}ms pageT=${c.pageTimeAtClickMs} nodes=${c.nodesAtClick} click->dom=${c.clickToDialogDomMs} ->vis=${c.clickToDialogVisibleMs} ->paint=${c.clickToDialogPaintedMs} Task=${r1(c.metricsDelta.TaskDuration * 1000)}ms Script=${r1(c.metricsDelta.ScriptDuration * 1000)}ms LT=${c.longtasks.length} LoF=${c.lof.length} err=${c.clickErr || 'none'}`)
if (report.fatal || report.gateOutcome !== 'EXCLUSIVE(brackets)') process.exitCode = 3
function r1(x) { return x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10 }
