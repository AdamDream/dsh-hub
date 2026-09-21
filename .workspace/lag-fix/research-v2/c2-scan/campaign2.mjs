/**
 * C2 campaign 2 — read-only, single browser.
 *
 * 1. Classify every sessions-feed emission by whether the BADGE-RELEVANT fields
 *    (row id set, displayTitle, cwd) changed, or only the irrelevant ones
 *    (running / updatedAt / projectionValues ...). The sessions projection of
 *    the deployed layer is identified by its RESULT shape: plain objects with
 *    exactly {title} or {title, cwd} — the shape the sidebar's own view-model
 *    cannot have. A frequency table of observed session-map result shapes
 *    validates that identification.
 * 2. Measure the unit DOM costs the DORMANT (M=0) withdrawStale path would pay
 *    per marked row, on the live sidebar — a cost model, not a live measurement.
 */
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs'
import fs from 'node:fs'
import path from 'node:path'

const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/c2-scan'
const SENT = path.join(OUT, 'sentinels2')
fs.mkdirSync(SENT, { recursive: true })
const QUIET_MS = Number(process.env.C2_QUIET_MS || 20000)
const ACTIVE_MS = Number(process.env.C2_ACTIVE_MS || 30000)
const log = (...a) => console.log(...a)
const results = { phases: [], boot: null, shapes: null, unitCosts: null }
const T0 = Date.now()

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

await page.addInitScript(() => {
  const C = {
    t0: performance.now(),
    emit: { total: 0, badgeProj: 0, first: 0, idsChanged: 0, titleChanged: 0, irrelevantOnly: 0, reorderOnly: 0 },
    shapes: {},
    prev: null,
    scanStarts: [], scanDurs: [], inScan: false,
    docQsa: {}, elQsa: {},
  }
  window.__c2 = C
  const now = () => performance.now() - C.t0
  const origDocQSA = Document.prototype.querySelectorAll
  const origElQSA = Element.prototype.querySelectorAll
  const origMap = Array.prototype.map

  Document.prototype.querySelectorAll = function (sel) {
    if (typeof sel === 'string') {
      C.docQsa[sel] = (C.docQsa[sel] || 0) + 1
      if (sel === '[role="tree"]') { C.scanStarts.push(now()); C.inScan = true }
    }
    return origDocQSA.call(this, sel)
  }
  Element.prototype.querySelectorAll = function (sel) {
    if (typeof sel === 'string') C.elQsa[sel] = (C.elQsa[sel] || 0) + 1
    return origElQSA.call(this, sel)
  }
  const realST = window.setTimeout
  window.setTimeout = function (fn, delay, ...args) {
    if (typeof fn !== 'function') return realST(fn, delay, ...args)
    const wrapped = function (...a) {
      const t = now(); C.inScan = false
      const r = fn.apply(this, a)
      if (C.inScan) C.scanDurs.push({ t, ms: now() - t })
      return r
    }
    return realST(wrapped, delay, ...args)
  }

  const isPlainObj = v => v !== null && typeof v === 'object' && !Array.isArray(v) && !('$$typeof' in v)
  const keysOf = v => Object.keys(v).sort().join('+')
  Array.prototype.map = function (cb, thisArg) {
    const n = this.length
    let badgeProj = false
    if (n > 0) {
      const f = this[0]
      if (isPlainObj(f) && 'displayTitle' in f) {
        const res = origMap.call(this, cb, thisArg)
        const r0 = res[0]
        // shape census for every session-source map in the page
        const k = isPlainObj(r0) ? keysOf(r0) : (r0 === undefined ? 'undefined' : typeof r0)
        C.shapes[k] = (C.shapes[k] || 0) + 1
        // the deployed badge projection: exactly {title} or {title, cwd}
        if (isPlainObj(r0) && 'title' in r0 && !('id' in r0)) {
          const kk = Object.keys(r0)
          if (kk.every(x => x === 'title' || x === 'cwd')) {
            badgeProj = true
            C.emit.badgeProj++
            const ids = [], titles = []
            for (let i = 0; i < res.length; i++) {
              const row = res[i]
              titles.push(String(row.title) + '\u0001' + (typeof row.cwd === 'string' ? row.cwd : ''))
            }
            for (let i = 0; i < this.length; i++) ids.push(String(this[i].id))
            const sIds = ids.slice().sort().join('\u0002')
            const sTit = titles.slice().sort().join('\u0002')
            const oTit = titles.join('\u0002')
            if (C.prev === null) C.emit.first++
            else if (sIds !== C.prev.ids) C.emit.idsChanged++
            else if (sTit !== C.prev.tit) C.emit.titleChanged++
            else if (oTit !== C.prev.otit) C.emit.reorderOnly++
            else C.emit.irrelevantOnly++
            C.prev = { ids: sIds, tit: sTit, otit: oTit }
          }
        }
        return res
      }
    }
    return origMap.call(this, cb, thisArg)
  }
  window.__c2 = C

  window.__c2snap = () => JSON.parse(JSON.stringify({
    emit: C.emit, shapes: C.shapes,
    scanCount: C.scanStarts.length, scanDurs: C.scanDurs.slice(-4000),
    docQsa: C.docQsa, elQsa: C.elQsa,
    badges: document.querySelectorAll('[data-dsw-badge]').length,
    treeitems: document.querySelectorAll('[role="treeitem"]').length,
    elements: document.getElementsByTagName('*').length,
  }))

  // unit-cost model for the DORMANT withdrawStale path (M marked rows), measured
  // on the live DOM with the same primitives the deployed code uses.
  window.__c2unit = (k) => {
    const docQ = origDocQSA.bind(document)
    const elQ = (el, s) => origElQSA.call(el, s)
    const tree = docQ('[role="tree"]')[0]
    const groupRows = tree ? Array.from(elQ(tree, '[role="treeitem"][aria-expanded]')) : []
    const bench = (fn, n) => { const t = performance.now(); for (let i = 0; i < n; i++) fn(); return +(((performance.now() - t) / n) * 1000).toFixed(3) }
    const row = groupRows[0]
    const out = { elements: document.getElementsByTagName('*').length, trees: docQ('[role="tree"]').length, groupRows: groupRows.length }
    out.docTreeQsaUs = bench(() => docQ('[role="tree"]'), k)
    out.docTreeitemQsaUs = bench(() => docQ('[role="treeitem"]'), k)          // flat branch, dormant
    out.treeGroupQsaUs = bench(() => elQ(tree, '[role="treeitem"][aria-expanded]'), k)
    if (row) {
      out.rowClosestTreeUs = bench(() => row.closest('[role="tree"]'), k)
      out.rowSpanQsaUs = bench(() => elQ(row, 'span'), k)
      const spans = Array.from(elQ(row, 'span'))
      out.rowTitleOfUs = bench(() => {
        let best = ''
        for (const s of spans) {
          if (s.querySelector('svg') !== null) continue
          if (s.closest('[data-dsw-badge]') !== null) continue
          const t = s.textContent === null ? '' : s.textContent.trim()
          if (t.length > best.length) best = t
        }
        return best
      }, k)
      out.spansPerRow = spans.length
    } else { out.note = 'no group rows present' }
    return out
  }
})

const snap = () => page.evaluate(() => window.__c2snap())
function diff(a, b) {
  const d = {}
  for (const k of ['scanCount']) d[k] = b[k] - a[k]
  d.scanDurs = b.scanDurs.slice(a.scanDurs.length)
  d.emit = {}; for (const k of Object.keys(b.emit)) d.emit[k] = b.emit[k] - a.emit[k]
  d.shapes = b.shapes
  d.docQsa = {}; for (const k of new Set([...Object.keys(a.docQsa), ...Object.keys(b.docQsa)])) d.docQsa[k] = (b.docQsa[k] || 0) - (a.docQsa[k] || 0)
  d.elQsa = {}; for (const k of new Set([...Object.keys(a.elQsa), ...Object.keys(b.elQsa)])) d.elQsa[k] = (b.elQsa[k] || 0) - (a.elQsa[k] || 0)
  d.elements = b.elements; d.badges = b.badges; d.treeitems = b.treeitems
  return d
}
function waitSentinel(name, timeoutMs = 120000) {
  const p = path.join(SENT, name); const start = Date.now()
  while (!fs.existsSync(p)) { if (Date.now() - start > timeoutMs) return false; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200) }
  fs.unlinkSync(p); return true
}
async function measure(label, ms, action) {
  const before = await snap()
  const tW = Date.now()
  if (action) await action()
  const rem = ms - (Date.now() - tW)
  if (rem > 0) await page.waitForTimeout(rem)
  const after = await snap()
  const d = diff(before, after)
  const dur = Date.now() - tW
  const durs = d.scanDurs.map(x => x.ms)
  const rec = {
    label, wallMs: dur, scans: d.scanCount, scansPerSec: +((d.scanCount / dur) * 1000).toFixed(3),
    scanAvgMs: durs.length ? +(durs.reduce((s, x) => s + x, 0) / durs.length).toFixed(3) : 0,
    scanWallMsPerSec: +((durs.reduce((s, x) => s + x, 0) / dur) * 1000).toFixed(3),
    emit: d.emit, emitPerSec: +((d.emit.badgeProj / dur) * 1000).toFixed(2),
    shapes: d.shapes, docQsa: d.docQsa, elQsa: d.elQsa, elements: d.elements, badges: d.badges, treeitems: d.treeitems,
  }
  results.phases.push(rec)
  log(`PHASE ${label}: wall=${dur} scans=${rec.scans}(${rec.scansPerSec}/s avg${rec.scanAvgMs}ms) scanWallMs/s=${rec.scanWallMsPerSec} ` +
      `badgeProj=${d.emit.badgeProj}(${rec.emitPerSec}/s) ids=${d.emit.idsChanged} title=${d.emit.titleChanged} reorder=${d.emit.reorderOnly} IRRELEVANT=${d.emit.irrelevantOnly} ` +
      `docTreeQsa=${d.docQsa['[role="tree"]']} elSpanQsa=${d.elQsa['span']}`)
  return rec
}

try {
  await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('[role="treeitem"]', { timeout: 30000 })
  await page.waitForTimeout(4000)
  results.boot = await snap()
  log('BOOT elements=' + results.boot.elements + ' treeitems=' + results.boot.treeitems + ' badges=' + results.boot.badges)

  await measure('warm', 2500)
  // A: settings panel DOM churn
  await measure('A1-open', 1800, async () => { await page.locator('button', { hasText: /^设置$/ }).first().click({ timeout: 8000 }).catch(e => log('open failed', e.message)) })
  for (const [i, tab] of ['通用设置', '模型', '插件', 'Agent 预设', '远程工作区'].entries()) {
    await measure(`A2-tab${i + 1}`, 1500, async () => {
      await page.locator('[role="dialog"] button', { hasText: new RegExp('^' + tab + '$') }).first().click({ timeout: 8000 }).catch(e => log('tab failed', e.message))
    })
  }
  await measure('A3-close', 1500, async () => { await page.locator('[role="dialog"] button', { hasText: /^关闭$/ }).first().click({ timeout: 8000 }).catch(e => log('close failed', e.message)) })
  // unit costs (settings closed)
  results.unitCostsClosed = await page.evaluate(() => window.__c2unit(2000))
  log('UNIT(closed) ' + JSON.stringify(results.unitCostsClosed))
  // Q quiet
  log('WAITING sentinel q.go')
  const okQ = await waitSentinel('q.go')
  await measure('Q-quiet', QUIET_MS)
  if (!okQ) log('WARN q sentinel timeout')
  // S active
  log('WAITING sentinel s.go')
  const okS = await waitSentinel('s.go')
  await measure('S-active', ACTIVE_MS)
  if (!okS) log('WARN s sentinel timeout')
  results.unitCostsAfter = await page.evaluate(() => window.__c2unit(2000))
  results.shapesFinal = await page.evaluate(() => window.__c2.shapes)
} catch (e) {
  log('ERR ' + e.message); results.error = e.message
} finally {
  try { await browser.close() } catch {}
  results.wallClockMs = Date.now() - T0
  fs.writeFileSync(path.join(OUT, 'campaign2.json'), JSON.stringify(results, null, 1))
  log('WROTE campaign2.json')
}
