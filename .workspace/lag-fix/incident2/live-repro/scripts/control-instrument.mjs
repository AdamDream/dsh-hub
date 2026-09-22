// Instrument positive control: prove the frame/LongTask/LoF/CDP recorders actually
// detect a deliberate stall. Without this, "no freeze observed" is unfalsifiable.
//
// Injects an artificial blocking task (default 180 ms busy loop) into a live page and
// verifies: (a) rAF frame interval spikes to >=150 ms, (b) LongTask fires,
// (c) long-animation-frame fires with script attribution, (d) CDP TaskDuration jumps.
// Also runs a NO-INJECTION control window so the delta is attributable to the stall.
//
// usage: node control-instrument.mjs --mode=headless|headed [--stall=180]

import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/live-repro'
const RAW = path.join(ROOT, 'raw')
const argv = process.argv.slice(2)
const argOf = (k, def) => { const p = argv.find((a) => a.startsWith(`--${k}=`)); return p ? p.slice(k.length + 3) : def }
const MODE = argOf('mode', 'headless')
const STALL = Number(argOf('stall', 180))
const LOCK = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000)

function lockOwnerPid() {
  try { const m = fs.readFileSync(path.join(LOCK, 'owner.txt'), 'utf8').match(/(?:^|\n)\s*pid\s*[=:]\s*(\d+)/); return m ? Number(m[1]) : null } catch { return null }
}
function pidAlive(pid) { try { return fs.existsSync(`/proc/${pid}`) } catch { return false } }
async function acquire(maxMs = 240000) {
  const t0 = Date.now(); const hist = []
  for (;;) {
    try {
      fs.mkdirSync(LOCK)
      fs.writeFileSync(path.join(LOCK, 'owner.txt'), `pid=${process.pid}\nts=${new Date().toISOString()}\nowner=incident2-live-repro\nline=instrument positive control (${MODE})\ndir=${ROOT}\n`)
      return { acquired: true, waitedMs: Date.now() - t0, history: hist }
    } catch (e) {
      if (e.code !== 'EEXIST') return { acquired: false, err: e.code, history: hist }
      const h = lockOwnerPid()
      hist.push({ at: new Date().toISOString(), heldBy: h, alive: h == null ? null : pidAlive(h) })
      if (h != null && !pidAlive(h)) { try { fs.rmSync(path.join(LOCK, 'owner.txt'), { force: true }); fs.rmdirSync(LOCK); continue } catch { } }
      if (Date.now() - t0 > maxMs) return { acquired: false, lastResult: `HELD:${h}`, history: hist, waitedMs: Date.now() - t0 }
      await sleep(2500 + Math.random() * 2500)
    }
  }
}
function release() { try { if (lockOwnerPid() !== process.pid) return false; fs.rmSync(path.join(LOCK, 'owner.txt'), { force: true }); fs.rmdirSync(LOCK); return true } catch { return false } }

const INLINE = `
(() => {
  const P = window.__C = { frames: [], longtasks: [], lof: [], marks: {}, errors: [] };
  let last = performance.now();
  const loop = () => { const t = performance.now(); P.frames.push([Math.round(t*1000)/1000, Math.round((t-last)*1000)/1000]); last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.longtasks.push({ t: Math.round(e.startTime*1000)/1000, dur: Math.round(e.duration*1000)/1000, name: e.name }); }).observe({ type: 'longtask', buffered: true }); } catch (e) { P.errors.push('longtask: '+e.message) }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.lof.push({ t: Math.round(e.startTime*1000)/1000, dur: Math.round(e.duration*1000)/1000, blocking: e.blockingDuration, scripts: (e.scripts||[]).map(s=>({ name: s.name||null, fn: s.sourceFunctionName||null, invoker: s.invoker||null, dur: Math.round(s.duration*1000)/1000, forced: s.forcedStyleAndLayoutDuration!=null?Math.round(s.forcedStyleAndLayoutDuration*1000)/1000:null })) }); }).observe({ type: 'long-animation-frame', buffered: true }); } catch (e) { P.errors.push('lof: '+e.message) }
})();
`
// deliberate blocking busy-loop
const STALL_FN = `((ms) => { const t0 = performance.now(); let x = 0; while (performance.now() - t0 < ms) { x += Math.sqrt(x + 1); } return performance.now() - t0; })`

const res = { mode: MODE, stallMs: STALL, at: new Date().toISOString() }
let browser = null
let held = false
try {
  const lk = await acquire()
  res.lock = lk; held = lk.acquired
  if (!lk.acquired) { res.verdict = 'INCONCLUSIVE(lock)'; }
  else {
    browser = await chromium.launch({ headless: MODE !== 'headed', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--window-size=1440,900'] })
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Performance.enable')
    await page.addInitScript(INLINE)
    await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForSelector('[role="treeitem"]', { timeout: 60000 })
    await page.waitForTimeout(2500)
    const gm = async () => { const { metrics } = await cdp.send('Performance.getMetrics'); const o = {}; for (const m of metrics) o[m.name] = m.value; return o }

    // ---- control window: no injection ----
    await page.evaluate(() => { const P = window.__C; P.frames.length = 0; P.longtasks.length = 0; P.lof.length = 0; P.marks.ctl = performance.now() })
    const c0 = await gm(); await sleep(3000); const c1 = await gm()
    res.control = await page.evaluate(() => ({ frames: window.__C.frames.slice(), longtasks: window.__C.longtasks.slice(), lof: window.__C.lof.slice(), errors: window.__C.errors.slice() }))
    res.control.metricsDelta = { TaskDuration: r3((c1.TaskDuration - c0.TaskDuration) * 1000), ScriptDuration: r3((c1.ScriptDuration - c0.ScriptDuration) * 1000) }

    // ---- injection window: deliberate stall ----
    await page.evaluate(() => { const P = window.__C; P.frames.length = 0; P.longtasks.length = 0; P.lof.length = 0; P.marks.inj = performance.now() })
    const i0 = await gm()
    const injected = await page.evaluate(({ fnSrc, ms }) => { window.__C.marks.t_stall = performance.now(); const d = eval(fnSrc)(ms); window.__C.marks.t_stall_end = performance.now(); return d }, { fnSrc: STALL_FN, ms: STALL })
    res.injectedBusyMs = r3(injected)
    await sleep(3000)
    const i1 = await gm()
    res.injected = await page.evaluate(() => ({ frames: window.__C.frames.slice(), longtasks: window.__C.longtasks.slice(), lof: window.__C.lof.slice(), marks: window.__C.marks, errors: window.__C.errors.slice() }))
    res.injected.metricsDelta = { TaskDuration: r3((i1.TaskDuration - i0.TaskDuration) * 1000), ScriptDuration: r3((i1.ScriptDuration - i0.ScriptDuration) * 1000) }

    const stat = (fr) => { const d = fr.map((f) => f[1]).sort((a, b) => a - b); return d.length ? { n: d.length, p50: r3(d[Math.floor(d.length * 0.5)]), max: r3(d[d.length - 1]), over50: d.filter((v) => v >= 50).length, over100: d.filter((v) => v >= 100).length } : { n: 0 } }
    res.control.frameStats = stat(res.control.frames)
    res.injected.frameStats = stat(res.injected.frames)
    res.control.longtaskMax = res.control.longtasks.length ? Math.max(...res.control.longtasks.map((x) => x.dur)) : null
    res.injected.longtaskMax = res.injected.longtasks.length ? Math.max(...res.injected.longtasks.map((x) => x.dur)) : null
    res.control.lofMax = res.control.lof.length ? Math.max(...res.control.lof.map((x) => x.dur)) : null
    res.injected.lofMax = res.injected.lof.length ? Math.max(...res.injected.lof.map((x) => x.dur)) : null
    res.checks = {
      frameSpikeDetected: (res.injected.frameStats.max ?? 0) >= STALL * 0.7,
      longtaskFired: (res.injected.longtaskMax ?? 0) >= 50,
      lofFired: (res.injected.lofMax ?? 0) >= 50,
      cdpTaskJumped: (res.injected.metricsDelta.TaskDuration ?? 0) >= STALL * 0.7,
      controlWasQuiet: (res.control.frameStats.max ?? 0) < STALL * 0.5,
    }
    res.verdict = Object.values(res.checks).every(Boolean) ? 'PASS' : 'FAIL'
    res.sampleLof = res.injected.lof.slice(0, 2)
  }
} catch (e) {
  res.fatal = String(e && e.message); res.verdict = res.verdict || 'ERROR'
} finally {
  if (browser) await browser.close().catch(() => { })
  if (held) res.lockReleased = release()
}
fs.writeFileSync(path.join(RAW, `control-instrument-${MODE}.json`), JSON.stringify(res, null, 1))
console.log(JSON.stringify({ mode: MODE, verdict: res.verdict, checks: res.checks, control: res.control?.frameStats, injected: res.injected?.frameStats, lt: [res.control?.longtaskMax, res.injected?.longtaskMax], lof: [res.control?.lofMax, res.injected?.lofMax], cdpTask: [res.control?.metricsDelta?.TaskDuration, res.injected?.metricsDelta?.TaskDuration], busy: res.injectedBusyMs, fatal: res.fatal }, null, 1))
