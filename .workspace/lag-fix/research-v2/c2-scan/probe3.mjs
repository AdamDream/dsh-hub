/**
 * C2 probe 3 — read-only. Single browser.
 * (1) raw scan-duration distribution (is the mean driven by a few outliers?)
 * (2) reconcile the observed per-scan wall cost with a REPLICATED scan body run
 *     over all real rows (the tight-loop unit bench in campaign2 reused ONE row,
 *     which is cache-friendly and therefore optimistic).
 */
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs'
import fs from 'node:fs'

const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/c2-scan'
const COLLECT_MS = Number(process.env.C2_COLLECT_MS || 60000)
const log = (...a) => console.log(...a)
const res = {}

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

await page.addInitScript(() => {
  const C = { t0: performance.now(), scanDurs: [], inScan: false, docQsa: {}, longTasks: 0, longTaskMs: 0, gc: 0 }
  window.__c2 = C
  const now = () => performance.now() - C.t0
  const origDocQSA = Document.prototype.querySelectorAll
  Document.prototype.querySelectorAll = function (sel) {
    if (typeof sel === 'string') { C.docQsa[sel] = (C.docQsa[sel] || 0) + 1; if (sel === '[role="tree"]') { C.scanDurs.length || 0; C.inScan = true } }
    return origDocQSA.call(this, sel)
  }
  const realST = window.setTimeout
  window.setTimeout = function (fn, delay, ...args) {
    if (typeof fn !== 'function') return realST(fn, delay, ...args)
    const wrapped = function (...a) {
      const t = now(); C.inScan = false
      const r = fn.apply(this, a)
      if (C.inScan) C.scanDurs.push(+(now() - t).toFixed(3))
      return r
    }
    return realST(wrapped, delay, ...args)
  }
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) { C.longTasks++; C.longTaskMs += e.duration } }).observe({ entryTypes: ['longtask'] }) } catch {}
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.name === 'gc') C.gc++ }).observe({ entryTypes: ['gc'] }) } catch {}

  // REPLICATED scan body over ALL real rows (same primitives, same row set as scan())
  window.__c2body = (k) => {
    const docQ = origDocQSA.bind(document)
    const titleOf = row => {
      let best = ''
      for (const span of Array.from(row.querySelectorAll('span'))) {
        if (span.querySelector('svg') !== null) continue
        if (span.closest('[data-dsw-badge]') !== null) continue
        const t = span.textContent === null ? '' : span.textContent.trim()
        if (t.length > best.length) best = t
      }
      return best.length > 0 ? best : null
    }
    const one = (includeFlat) => {
      const trees = Array.from(docQ('[role="tree"]'))
      let rows = 0
      for (const tree of trees) {
        const groupRows = Array.from(tree.querySelectorAll('[role="treeitem"][aria-expanded]'))
        if (groupRows.length > 0) { for (const row of groupRows) { titleOf(row); rows++ } }
        // the flat branch is DORMANT here (remoteSessionTitles is empty) — measured
        // only as an upper bound for a deployment that does have remote sessions
        else if (includeFlat) { for (const row of Array.from(tree.querySelectorAll('[role="treeitem"]'))) { titleOf(row); rows++ } }
      }
      return rows
    }
    const rowsSeen = one(true)
    const t = performance.now()
    for (let i = 0; i < k; i++) one(false)
    const perLoopUs = ((performance.now() - t) / k) * 1000
    return { rowsSeen, tightLoopUs: +perLoopUs.toFixed(3) }
  }
  window.__c2paced = (k, gapMs, includeFlat) => new Promise(done => {
    const out = []
    let i = 0
    const step = () => {
      const t = performance.now()
      window.__c2body(0, includeFlat)
      out.push(+(performance.now() - t).toFixed(3))
      if (++i >= k) return done(out)
      realST(step, gapMs)
    }
    realST(step, gapMs)
  })
  window.__c2snapshot = () => ({ scanDurs: C.scanDurs.slice(), docQsa: C.docQsa, longTasks: C.longTasks, longTaskMs: C.longTaskMs, gc: C.gc })
})

try {
  await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('[role="treeitem"]', { timeout: 30000 })
  await page.waitForTimeout(3000)
  log('collecting raw scan durations for ' + (COLLECT_MS / 1000) + 's ...')
  await page.waitForTimeout(COLLECT_MS)
  const s = await page.evaluate(() => window.__c2snapshot())
  res.scanDurs = s.scanDurs
  res.docQsa = s.docQsa
  res.longTasks = s.longTasks; res.longTaskMs = s.longTaskMs; res.gc = s.gc
  const d = [...s.scanDurs].sort((a, b) => a - b)
  const q = p => d.length ? d[Math.min(d.length - 1, Math.floor(p * d.length))] : 0
  res.scanDist = {
    n: d.length, min: d[0], p25: q(0.25), median: q(0.5), p75: q(0.75), p90: q(0.9), p99: q(0.99),
    max: d[d.length - 1], mean: +(d.reduce((x, y) => x + y, 0) / d.length).toFixed(3),
    over1ms: d.filter(x => x > 1).length, over5ms: d.filter(x => x > 5).length, over20ms: d.filter(x => x > 20).length,
    sumMs: +d.reduce((x, y) => x + y, 0).toFixed(2),
  }
  log('SCAN DIST ' + JSON.stringify(res.scanDist))
  log('docQsa [role=tree]=' + (s.docQsa['[role="tree"]'] || 0) + ' longTasks=' + s.longTasks + ' gc=' + s.gc)
  res.body = await page.evaluate(() => window.__c2body(200))
  log('REPLICATED BODY (tight loop over all real rows): ' + JSON.stringify(res.body))
  res.paced = await page.evaluate(() => window.__c2paced(20, 300))
  const pd = [...res.paced].sort((a, b) => a - b)
  res.pacedSummary = { n: pd.length, median: pd[Math.floor(pd.length / 2)], mean: +(pd.reduce((x, y) => x + y, 0) / pd.length).toFixed(3), max: pd[pd.length - 1] }
  log('REPLICATED BODY (paced 300ms): ' + JSON.stringify(res.pacedSummary))
} catch (e) {
  log('ERR ' + e.message); res.error = e.message
} finally {
  try { await browser.close() } catch {}
  fs.writeFileSync(OUT + '/probe3.json', JSON.stringify(res, null, 1))
  log('WROTE probe3.json')
}
