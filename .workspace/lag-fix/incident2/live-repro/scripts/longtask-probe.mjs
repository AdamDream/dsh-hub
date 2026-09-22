// Characterise the Long Tasks API in this environment.
// The arm2 positive control proved a 180 ms blocking task yields rAF 194.6 ms and LoF 188 ms
// but ZERO 'longtask' entries. Before concluding anything from "no longtask observed", find out
// whether the channel works at all here, and under which invocation it reports.
//
// windows, all on one loaded page:
//   W0 baseline      (no stall)
//   W1 evaluate-loop (busy loop inside page.evaluate  - the arm2 control path)
//   W2 timeout-loop  (busy loop inside a setTimeout callback scheduled in-page)
//   W3 raf-loop      (busy loop inside a requestAnimationFrame callback)
// usage: node longtask-probe.mjs [--mode=headless]

import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/live-repro'
const RAW = path.join(ROOT, 'raw')
const LOCK = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock'
const argv = process.argv.slice(2)
const argOf = (k, d) => { const p = argv.find((a) => a.startsWith(`--${k}=`)); return p ? p.slice(k.length + 3) : d }
const MODE = argOf('mode', 'headless')
const STALL = Number(argOf('stall', 180))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000)

function lockOwnerPid() { try { const m = fs.readFileSync(path.join(LOCK, 'owner.txt'), 'utf8').match(/(?:^|\n)\s*(?:owner_)?pid\s*[=:]\s*(\d+)/); return m ? Number(m[1]) : null } catch { return null } }
const alive = (p) => { try { return fs.existsSync(`/proc/${p}`) } catch { return false } }
async function acquire(maxMs = 600000) {
  const t0 = Date.now()
  for (;;) {
    try {
      fs.mkdirSync(LOCK)
      fs.writeFileSync(path.join(LOCK, 'owner.txt'), `pid=${process.pid}\nts=${new Date().toISOString()}\nowner=incident2-live-repro\nline=longtask channel characterisation\ndir=${ROOT}\n`)
      return true
    } catch (e) {
      if (e.code !== 'EEXIST') return false
      const h = lockOwnerPid()
      if (h != null && !alive(h)) { try { fs.rmSync(path.join(LOCK, 'owner.txt'), { force: true }); fs.rmdirSync(LOCK); continue } catch { } }
      if (Date.now() - t0 > maxMs) return false
      await sleep(2500 + Math.random() * 2500)
    }
  }
}
function release() { try { if (lockOwnerPid() !== process.pid) return false; fs.rmSync(path.join(LOCK, 'owner.txt'), { force: true }); fs.rmdirSync(LOCK); return true } catch { return false } }

const INLINE = `
(() => {
  if (window.__L) return;
  const L = window.__L = { lt: [], lof: [], frames: [], err: [], installed: {} };
  let last = performance.now();
  const loop = () => { const t = performance.now(); L.frames.push([Math.round(t*1000)/1000, Math.round((t-last)*1000)/1000]); last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  try { new PerformanceObserver((l) => { L.installed.longtask = true; for (const e of l.getEntries()) L.lt.push({ t: Math.round(e.startTime*1000)/1000, dur: Math.round(e.duration*1000)/1000, name: e.name, attribution: (e.attribution||[]).map(a=>({name:a.name,type:a.entryType,containerType:a.containerType})) }); }).observe({ type: 'longtask', buffered: true }); } catch (e) { L.err.push('longtask observe failed: ' + e.message) }
  try { new PerformanceObserver((l) => { L.installed.lof = true; for (const e of l.getEntries()) L.lof.push({ t: Math.round(e.startTime*1000)/1000, dur: Math.round(e.duration*1000)/1000, scripts: (e.scripts||[]).length }); }).observe({ type: 'long-animation-frame', buffered: true }); } catch (e) { L.err.push('lof observe failed: ' + e.message) }
  // supported entry types, for the record
  try { L.supported = PerformanceObserver.supportedEntryTypes ? PerformanceObserver.supportedEntryTypes.filter(x => /long|frame|event|element/.test(x)) : null } catch { L.supported = null }
})();
`

const res = { mode: MODE, stallMs: STALL, at: new Date().toISOString(), windows: [] }
let browser = null, held = false
try {
  held = await acquire()
  if (!held) res.verdict = 'INCONCLUSIVE(lock)'
  else {
    browser = await chromium.launch({ headless: MODE !== 'headed', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'] })
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    await page.addInitScript(INLINE)
    await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 90000 })
    await page.waitForSelector('[role="treeitem"]', { timeout: 90000 })
    await page.waitForTimeout(3000)
    res.installed = await page.evaluate(() => ({ installed: window.__L.installed, err: window.__L.err, supported: window.__L.supported, visibility: document.visibilityState }))
    const clear = () => page.evaluate(() => { const L = window.__L; L.lt.length = 0; L.lof.length = 0; L.frames.length = 0 })
    const read = () => page.evaluate(() => ({ lt: window.__L.lt.slice(), lof: window.__L.lof.slice(), frames: window.__L.frames.slice() }))
    const summarise = (label, w, note) => {
      const d = w.frames.map((f) => f[1]).sort((a, b) => a - b)
      res.windows.push({ label, note, frames: d.length ? { n: d.length, p50: r3(d[Math.floor(d.length / 2)]), max: r3(d[d.length - 1]), over50: d.filter((v) => v >= 50).length } : { n: 0 }, longtaskCount: w.lt.length, longtaskMax: w.lt.length ? Math.max(...w.lt.map((x) => x.dur)) : null, longtaskEntries: w.lt.slice(0, 3), lofCount: w.lof.length, lofMax: w.lof.length ? Math.max(...w.lof.map((x) => x.dur)) : null })
    }
    // W0 baseline
    await clear(); await sleep(3000); summarise('W0-baseline', await read(), 'no stall injected')
    // W1 evaluate busy loop (the arm2 control path)
    await clear()
    const b1 = await page.evaluate((ms) => { const t0 = performance.now(); let x = 0; while (performance.now() - t0 < ms) x += Math.sqrt(x + 1); return performance.now() - t0 }, STALL)
    await sleep(3000); summarise('W1-evaluate-loop', await read(), `busy ${r3(b1)}ms inside page.evaluate`)
    // W2 setTimeout busy loop
    await clear()
    await page.evaluate((ms) => { window.__L.markA = performance.now(); setTimeout(() => { const t0 = performance.now(); let x = 0; while (performance.now() - t0 < ms) x += Math.sqrt(x + 1); window.__L.gotA = performance.now() - t0 }, 50) }, STALL)
    await sleep(3000); summarise('W2-setTimeout-loop', await read(), `busy ${STALL}ms inside a page setTimeout callback`)
    // W3 rAF busy loop
    await clear()
    await page.evaluate((ms) => { requestAnimationFrame(() => { const t0 = performance.now(); let x = 0; while (performance.now() - t0 < ms) x += Math.sqrt(x + 1); window.__L.gotB = performance.now() - t0 }) }, STALL)
    await sleep(3000); summarise('W3-rAF-loop', await read(), `busy ${STALL}ms inside a page requestAnimationFrame callback`)
    res.pageStallDurations = await page.evaluate(() => ({ gotA: window.__L.gotA ?? null, gotB: window.__L.gotB ?? null }))
    const ltFired = res.windows.some((w) => w.longtaskCount > 0)
    const lofFired = res.windows.some((w) => w.lofCount > 0)
    res.verdict = ltFired ? 'LONGTASK-CHANNEL-WORKS' : (lofFired ? 'LONGTASK-CHANNEL-SILENT-BUT-LOF-WORKS' : 'BOTH-SILENT')
  }
} catch (e) { res.fatal = String(e && e.message).slice(0, 800); res.verdict = res.verdict || 'ERROR' }
finally { if (browser) await browser.close().catch(() => { }); if (held) res.lockReleased = release() }
fs.writeFileSync(path.join(RAW, `longtask-probe-${MODE}.json`), JSON.stringify(res, null, 1))
console.log(JSON.stringify({ verdict: res.verdict, installed: res.installed, pageStallDurations: res.pageStallDurations, windows: (res.windows || []).map((w) => ({ label: w.label, frames: w.frames, LT: w.longtaskCount, LTmax: w.longtaskMax, LoF: w.lofCount, LoFmax: w.lofMax })), fatal: res.fatal }, null, 1))
