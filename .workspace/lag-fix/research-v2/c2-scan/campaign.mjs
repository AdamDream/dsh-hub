/**
 * C2 scan-cost campaign (read-only).
 *
 * Measures the deployed dsh-workspace-enhancement row-badges layer on the real
 * GUI at 127.0.0.1:3080 under three stimuli:
 *   A  settings-panel DOM churn (open / switch tabs / close) — driver driven
 *   S  active session feed churn (the operator generates real agent activity)
 *   Q  quiet window (operator does nothing; only ambient timers/polls)
 *
 * Absolutely no product file is written; the page is only monkey-patched for
 * read-only counting. One browser, closed at the end.
 */
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs'
import fs from 'node:fs'
import path from 'node:path'

const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/c2-scan'
const SENT = path.join(OUT, 'sentinels')
const URL = 'http://127.0.0.1:3080/'
const REPS = Number(process.env.C2_REPS || 3)
const QUIET_MS = Number(process.env.C2_QUIET_MS || 20000)
const ACTIVE_MS = Number(process.env.C2_ACTIVE_MS || 20000)
const TARGET_MS = Number(process.env.C2_TARGET_MS || 1500) // per settings sub-step

const log = (...a) => { console.log(...a); }
fs.mkdirSync(SENT, { recursive: true })

const results = { meta: {}, phases: [], inPageFinal: null, calibration: null }
const T0 = Date.now()

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
page.on('pageerror', e => log('PAGEERROR', e.message))

// ---------------------------------------------------------------- instrumentation
await page.addInitScript(() => {
  const C = {
    t0: performance.now(), moCreated: 0, moObserved: [], moCbCount: 0, moRecordCount: 0,
    records: {}, selfRecords: 0, childListRecords: 0, attributeRecords: 0, charDataRecords: 0,
    scanStarts: [], scanDurs: [], inScan: false,
    mapsWork: 0, mapsSess: 0, mapsOther: 0,
    sessEmissions: 0, sessFirst: 0, sessMembership: 0, sessTitle: 0, sessOrderOnly: 0, sessIrrelevantOnly: 0,
    sessSigPrev: null, sessIdsPrev: null, sessIdCounts: [],
    badgeAdds: 0, badgeRemoves: 0, longTasks: 0, longTaskMs: 0,
    dialogRoot: null, dialogQueryCost: 0, err: [],
  }
  window.__c2 = C
  const now = () => performance.now() - C.t0
  const origDocQSA = Document.prototype.querySelectorAll
  const origElQSA = Element.prototype.querySelectorAll

  // region classifier (cached dialog root; never re-query per record)
  function regionOf(el) {
    if (!el) return 'unknown'
    if (el.nodeType !== 1) el = el.parentElement
    if (!el || !el.closest) return 'unknown'
    // three bounded ancestor walks; exact, no document-wide scan
    if (el.closest('[data-dsw-badge]') !== null) return 'badge'
    if (el.closest('[role="dialog"]') !== null) return 'settings'
    if (el.closest('[role="tree"]') !== null) return 'sidebarTree'
    return 'other'
  }
  window.__c2refreshRoots = () => {
    const t = performance.now()
    C.dialogRoot = document.querySelector('[role="dialog"]')
    C.dialogQueryCost += performance.now() - t
    return C.dialogRoot !== null
  }

  // MutationObserver wrapper: count callbacks + records by region
  const RealMO = window.MutationObserver
  window.MutationObserver = class extends RealMO {
    constructor(cb) {
      super((records, obs) => {
        C.moCbCount++
        C.moRecordCount += records.length
        for (const r of records) {
          const region = regionOf(r.target)
          C.records[region] = (C.records[region] || 0) + 1
          if (region === 'badge') C.selfRecords++
          if (r.type === 'childList') {
            C.childListRecords++
            for (const n of r.addedNodes) if (n.nodeType === 1 && n.hasAttribute && n.hasAttribute('data-dsw-badge')) C.badgeAdds++
            for (const n of r.removedNodes) if (n.nodeType === 1 && n.hasAttribute && n.hasAttribute('data-dsw-badge')) C.badgeRemoves++
          } else if (r.type === 'attributes') C.attributeRecords++
          else if (r.type === 'characterData') C.charDataRecords++
        }
        return cb(records, obs)
      })
      C.moCreated++
    }
    observe(target, opts) {
      C.moObserved.push({ target: target === document.body ? 'body' : (target.nodeName || '?'), opts: JSON.stringify(opts) })
      return super.observe(target, opts)
    }
  }

  // querySelectorAll counters (Document + Element)
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
  C.docQsa = {}; C.elQsa = {}

  // setTimeout wrapper: bracket the scan (flagged by the [role="tree"] QSA)
  const realST = window.setTimeout
  window.setTimeout = function (fn, delay, ...args) {
    if (typeof fn !== 'function') return realST(fn, delay, ...args)
    const wrapped = function (...a) {
      const t = now()
      C.inScan = false
      const r = fn.apply(this, a)
      if (C.inScan) C.scanDurs.push({ t, ms: now() - t })
      return r
    }
    return realST(wrapped, delay, ...args)
  }

  // projection counters: classify by the SOURCE row shape of Array.prototype.map
  const origMap = Array.prototype.map
  Array.prototype.map = function (cb, thisArg) {
    const n = this.length
    if (n > 0) {
      const f = this[0]
      if (f !== null && typeof f === 'object') {
        if ('path' in f && 'title' in f) { C.mapsWork++; C.lastWsSrc = this }
        else if ('displayTitle' in f) {
          C.mapsSess++
          C.lastSessSrc = this
          const titles = []
          const ids = []
          for (let i = 0; i < n; i++) {
            const r = this[i]
            titles.push((r.displayTitle === undefined ? '' : r.displayTitle) + '\u0001' + (typeof r.cwd === 'string' ? r.cwd : ''))
            ids.push(String(r.id))
          }
          const sortedTitles = titles.slice().sort().join('\u0002')
          const sortedIds = ids.slice().sort().join('\u0002')
          const orderedTitles = titles.join('\u0002')
          if (C.sessSigPrev === null) C.sessFirst++
          else if (sortedIds !== C.sessIdsPrev) C.sessMembership++
          else if (sortedTitles !== C.sessSigPrev) C.sessTitle++
          else if (orderedTitles !== C.sessOrdPrev) C.sessOrderOnly++
          else C.sessIrrelevantOnly++
          C.sessSigPrev = sortedTitles
          C.sessOrdPrev = orderedTitles
          C.sessIdsPrev = sortedIds
          C.sessEmissions++
          if (C.sessIdCounts.length < 600) C.sessIdCounts.push(n)
        }
      }
    }
    return origMap.call(this, cb, thisArg)
  }

  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) { C.longTasks++; C.longTaskMs += e.duration }
    }).observe({ entryTypes: ['longtask'] })
  } catch (e) { C.err.push('longtask:' + e.message) }

  window.__c2snap = () => JSON.parse(JSON.stringify({
    moCreated: C.moCreated, moObserved: C.moObserved, moCbCount: C.moCbCount, moRecordCount: C.moRecordCount,
    records: C.records, selfRecords: C.selfRecords, childListRecords: C.childListRecords,
    attributeRecords: C.attributeRecords, charDataRecords: C.charDataRecords,
    scanCount: C.scanStarts.length, scanDurs: C.scanDurs.slice(-4000),
    mapsWork: C.mapsWork, mapsSess: C.mapsSess,
    sessEmissions: C.sessEmissions, sessFirst: C.sessFirst, sessMembership: C.sessMembership,
    sessTitle: C.sessTitle, sessOrderOnly: C.sessOrderOnly, sessIrrelevantOnly: C.sessIrrelevantOnly,
    sessIdCounts: C.sessIdCounts.slice(-12),
    badgeAdds: C.badgeAdds, badgeRemoves: C.badgeRemoves,
    longTasks: C.longTasks, longTaskMs: C.longTaskMs,
    docQsa: C.docQsa, elQsa: C.elQsa,
    dialogs: document.querySelectorAll('[role="dialog"]').length,
    treeitems: document.querySelectorAll('[role="treeitem"]').length,
    trees: document.querySelectorAll('[role="tree"]').length,
    elements: document.getElementsByTagName('*').length,
    badges: document.querySelectorAll('[data-dsw-badge]').length,
    err: C.err,
  }))
  // calibration: wrapper overhead per call + a REPLICATION of the two projection
  // lambdas (deployed bundle lines 5414 / 5430) measured on live feed data.
  window.__c2calib = (n) => {
    const raw = () => origDocQSA.call(document, '[role="tree"]')
    const wrap = () => document.querySelectorAll('[role="tree"]')
    const bench = (fn, k) => { const t = performance.now(); for (let i = 0; i < k; i++) fn(); return +(((performance.now() - t) / k) * 1000).toFixed(3) }
    const out = { n, rawUs: bench(raw, n), wrappedUs: bench(wrap, n) }
    out.overheadUs = +(out.wrappedUs - out.rawUs).toFixed(3)
    out.elementsNow = document.getElementsByTagName('*').length
    // REPLICATION calibration (NOT the deployed code path — same expressions on
    // the live feed rows captured by the map counter). Used only to size the two
    // anonymous projection lambdas that the sampled profiler cannot name.
    const items = C.lastWsSrc
    const rows = C.lastSessSrc
    if (items !== null && items !== undefined) {
      out.workspaceCount = items.length
      out.projectWorkspacesUs = bench(() => items.map(item => ({ title: item.title, path: item.path })), 3000)
    }
    if (rows !== null && rows !== undefined) {
      out.sessionCount = rows.length
      out.projectSessionsUs = bench(() => rows.map(row => ({
        title: row.displayTitle, ...(typeof row.cwd === 'string' ? { cwd: row.cwd } : {}),
      })), 3000)
    }
    return out
  }
})

// ---------------------------------------------------------------- CDP profiler
const cdp = await context.newCDPSession(page)
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 100 })

const WATCH = ['scan', 'withdrawStale', 'rebuildRemote', 'remoteSessionIndex', 'remoteWorkspaceIndex',
  'onChange', 'scheduleScan', 'rowTitleOf', 'markRow', 'paintBadge', 'paintConn', 'installRowBadges', 'markRowStatus']
const INTEREST = ['scan', 'withdrawStale', 'rebuildRemote', 'remoteSessionIndex', 'remoteWorkspaceIndex', 'onChange', 'scheduleScan', 'rowTitleOf']

function aggregateSelf(profile) {
  const byId = new Map(profile.nodes.map(n => [n.id, n]))
  const self = new Map()
  const line = new Map()
  const samples = profile.samples || []
  const deltas = profile.timeDeltas || []
  for (let i = 0; i < samples.length; i++) {
    const node = byId.get(samples[i])
    if (!node) continue
    const name = node.callFrame.functionName || '(anon)'
    const d = (deltas[i] || 100) / 1000
    const cur = self.get(name) || { ms: 0, samples: 0 }
    cur.ms += d; cur.samples++
    self.set(name, cur)
    const url = node.callFrame.url || ''
    if (url.includes('dsh-workspace-enhancement')) {
      const key = (node.callFrame.lineNumber + 1) + ':' + name
      const lc = line.get(key) || { ms: 0, samples: 0 }
      lc.ms += d; lc.samples++
      line.set(key, lc)
    }
  }
  const all = [...self.entries()].map(([k, v]) => ({ name: k, ms: +v.ms.toFixed(3), samples: v.samples })).sort((a, b) => b.ms - a.ms)
  const byLine = [...line.entries()].map(([k, v]) => ({ where: k, ms: +v.ms.toFixed(3), samples: v.samples })).sort((a, b) => b.ms - a.ms).slice(0, 20)
  return { all: all.slice(0, 25), interest: all.filter(x => INTEREST.includes(x.name)), byLine, totalMs: +all.reduce((s, x) => s + x.ms, 0).toFixed(2) }
}
function callCounts(result) {
  const out = {}
  for (const s of result) for (const f of s.functions) {
    const name = f.functionName
    if (!name) continue
    const c = f.ranges && f.ranges[0] ? f.ranges[0].count : 0
    out[name] = (out[name] || 0) + c
  }
  const pick = {}
  for (const k of Object.keys(out)) if (WATCH.includes(k)) pick[k] = out[k]
  return pick
}

// ---------------------------------------------------------------- helpers
async function snap() { return page.evaluate(() => window.__c2snap()) }
async function refreshRoots() { return page.evaluate(() => window.__c2refreshRoots()) }
function diff(a, b) {
  const d = {}
  for (const k of Object.keys(b)) {
    if (typeof b[k] === 'number' && typeof a[k] === 'number') d[k] = +(b[k] - a[k]).toFixed(3)
  }
  const rec = {}
  for (const k of new Set([...Object.keys(a.records || {}), ...Object.keys(b.records || {})])) rec[k] = (b.records[k] || 0) - (a.records[k] || 0)
  d.records = rec
  d.docQsa = {}
  for (const k of new Set([...Object.keys(a.docQsa || {}), ...Object.keys(b.docQsa || {})])) d.docQsa[k] = (b.docQsa[k] || 0) - (a.docQsa[k] || 0)
  d.elQsa = {}
  for (const k of new Set([...Object.keys(a.elQsa || {}), ...Object.keys(b.elQsa || {})])) d.elQsa[k] = (b.elQsa[k] || 0) - (a.elQsa[k] || 0)
  d.scanDurs = (b.scanDurs || []).slice((a.scanDurs || []).length)
  d.sessIdCounts = b.sessIdCounts
  return d
}
const sentinel = (name) => path.join(SENT, name)
async function waitSentinel(name, timeoutMs = 120000) {
  const p = sentinel(name)
  const start = Date.now()
  while (!fs.existsSync(p)) {
    if (Date.now() - start > timeoutMs) return false
    await new Promise(r => setTimeout(r, 200))
  }
  fs.unlinkSync(p)
  return true
}

async function measure(label, ms, action) {
  await refreshRoots()
  const before = await snap()
  await cdp.send('Profiler.startPreciseCoverage', { callCount: true, detailed: false })
  await cdp.send('Profiler.start')
  const tWall = Date.now()
  if (action) await action()
  const remain = ms - (Date.now() - tWall)
  if (remain > 0) await page.waitForTimeout(remain)
  const profile = (await cdp.send('Profiler.stop')).profile
  const cov = await cdp.send('Profiler.takePreciseCoverage')
  await cdp.send('Profiler.stopPreciseCoverage')
  const after = await snap()
  const durMs = Date.now() - tWall
  const d = diff(before, after)
  const scanDurs = d.scanDurs ? d.scanDurs.map(x => x.ms) : []
  const sum = scanDurs.reduce((s, x) => s + x, 0)
  const agg = aggregateSelf(profile)
  const counts = callCounts(cov.result)
  const rec = {
    label, wallMs: durMs,
    scans: d.scanCount || 0,
    scansPerSec: +(((d.scanCount || 0) / durMs) * 1000).toFixed(3),
    calls: counts,
    rebuilds: counts.rebuildRemote || 0,
    rebuildsPerSec: +(((counts.rebuildRemote || 0) / durMs) * 1000).toFixed(3),
    onChangeCalls: counts.onChange || 0,
    scheduleScanCalls: counts.scheduleScan || 0,
    scanSelfMs: (agg.interest.find(x => x.name === 'scan') || { ms: 0 }).ms,
    rebuildSelfMs: (agg.interest.find(x => x.name === 'rebuildRemote') || { ms: 0 }).ms,
    wsIndexSelfMs: (agg.interest.find(x => x.name === 'remoteWorkspaceIndex') || { ms: 0 }).ms,
    sessIndexSelfMs: (agg.interest.find(x => x.name === 'remoteSessionIndex') || { ms: 0 }).ms,
    rowTitleSelfMs: (agg.interest.find(x => x.name === 'rowTitleOf') || { ms: 0 }).ms,
    withdrawSelfMs: (agg.interest.find(x => x.name === 'withdrawStale') || { ms: 0 }).ms,
    onChangeSelfMs: (agg.interest.find(x => x.name === 'onChange') || { ms: 0 }).ms,
    scheduleScanSelfMs: (agg.interest.find(x => x.name === 'scheduleScan') || { ms: 0 }).ms,
    pageTotalSelfMs: agg.totalMs,
    interest: agg.interest,
    byLine: agg.byLine,
    top: agg.all.slice(0, 12),
    scanDur: { n: scanDurs.length, sumMs: +sum.toFixed(3), avgMs: scanDurs.length ? +(sum / scanDurs.length).toFixed(3) : 0, maxMs: scanDurs.length ? +Math.max(...scanDurs).toFixed(3) : 0 },
    records: d.records,
    mapsWork: d.mapsWork, mapsSess: d.mapsSess,
    sessEmissions: d.sessEmissions, sessMembership: d.sessMembership, sessTitle: d.sessTitle,
    sessOrderOnly: d.sessOrderOnly, sessIrrelevantOnly: d.sessIrrelevantOnly,
    sessIdCounts: d.sessIdCounts,
    badgeAdds: d.badgeAdds, badgeRemoves: d.badgeRemoves,
    longTasks: d.longTasks, longTaskMs: d.longTaskMs,
    docQsa: d.docQsa, elQsa: d.elQsa,
    dom: { trees: after.trees, treeitems: after.treeitems, elements: after.elements, badges: after.badges, dialogs: after.dialogs },
  }
  // fold the badge-layer cost into ms/s
  const layerMs = rec.scanSelfMs + rec.rebuildSelfMs + rec.rowTitleSelfMs + rec.sessIndexSelfMs + rec.wsIndexSelfMs + rec.withdrawSelfMs
  rec.layerSelfMs = +layerMs.toFixed(3)
  rec.layerMsPerSec = +((layerMs / durMs) * 1000).toFixed(4)
  // the throttled half (scan) vs the un-throttled half (rebuild) in ms/s
  rec.scanMsPerSec = +(((rec.scanSelfMs + rec.rowTitleSelfMs + rec.withdrawSelfMs) / durMs) * 1000).toFixed(4)
  rec.rebuildMsPerSec = +(((rec.rebuildSelfMs + rec.sessIndexSelfMs + rec.wsIndexSelfMs) / durMs) * 1000).toFixed(4)
  results.phases.push(rec)
  log(`PHASE ${label}: wall=${durMs} scans=${rec.scans}(${rec.scansPerSec}/s,avg${rec.scanDur.avgMs}ms) rebuilds=${rec.rebuilds}(${rec.rebuildsPerSec}/s) ` +
      `scanMs/s=${rec.scanMsPerSec} rebuildMs/s=${rec.rebuildMsPerSec} layerMs/s=${rec.layerMsPerSec} ` +
      `sessEm=${rec.sessEmissions}[mem=${rec.sessMembership} title=${rec.sessTitle} orderOnly=${rec.sessOrderOnly} irrel=${rec.sessIrrelevantOnly}] ` +
      `rec=${JSON.stringify(rec.records)} dom=${JSON.stringify(rec.dom)}`)
  return rec
}

// ---------------------------------------------------------------- run
try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForSelector('[role="treeitem"]', { timeout: 30000 })
  await page.waitForTimeout(4000)
  const boot = await snap()
  results.meta = {
    url: URL, reps: REPS, quietMs: QUIET_MS, activeMs: ACTIVE_MS,
    moObserved: boot.moObserved, badgeInstalled: boot.badges >= 0,
    elements: boot.elements, trees: boot.trees, treeitems: boot.treeitems, badges: boot.badges,
    longTaskApi: boot.err,
  }
  log('BOOT moObserved=' + JSON.stringify(boot.moObserved) + ' trees=' + boot.trees + ' treeitems=' + boot.treeitems + ' elements=' + boot.elements)

  await measure('warm', 2000)

  for (let rep = 1; rep <= REPS; rep++) {
    // ---- A: settings panel DOM churn (driver controlled; action inside the window)
    await measure(`r${rep}-A0-preopen`, 800)
    await measure(`r${rep}-A1-open`, 1800, async () => {
      await page.locator('button', { hasText: /^设置$/ }).first().click({ timeout: 8000 }).catch(e => log('click settings failed', e.message))
    })
    for (const [i, tab] of ['通用设置', '模型', '插件', 'Agent 预设', '远程工作区'].entries()) {
      await measure(`r${rep}-A2-tab${i + 1}-${tab}`, TARGET_MS, async () => {
        await page.locator('[role="dialog"] button', { hasText: new RegExp('^' + tab + '$') }).first().click({ timeout: 8000 }).catch(e => log('tab ' + tab + ' failed', e.message))
      })
    }
    await measure(`r${rep}-A3-close`, 1500, async () => {
      await page.locator('[role="dialog"] button', { hasText: /^关闭$/ }).first().click({ timeout: 8000 }).catch(e => log('close failed', e.message))
    })

    // ---- Q: quiet window (operator must be idle; sentinel synchronized)
    log(`WAITING sentinel q-${rep}.go  (operator: touch sentinels/q-${rep}.go then stay idle)`)
    const okQ = await waitSentinel(`q-${rep}.go`)
    await measure(`r${rep}-Q-quiet`, QUIET_MS, okQ ? null : async () => { await page.waitForTimeout(QUIET_MS) })
    if (!okQ) log(`WARN q-${rep} sentinel timeout (phase still measured as quiet)`)

    // ---- S: active session churn (operator drives real agent activity)
    log(`WAITING sentinel s-${rep}.go  (operator: touch sentinels/s-${rep}.go then generate activity)`)
    const okS = await waitSentinel(`s-${rep}.go`)
    await measure(`r${rep}-S-active`, ACTIVE_MS, okS ? null : async () => { await page.waitForTimeout(ACTIVE_MS) })
    if (!okS) log(`WARN s-${rep} sentinel timeout`)
  }

  results.calibration = await page.evaluate(() => window.__c2calib(3000))
  log('CALIB ' + JSON.stringify(results.calibration))
  results.inPageFinal = await snap()
} catch (err) {
  log('CAMPAIGN ERROR: ' + err.message + '\n' + err.stack)
  results.error = err.message
  try { results.inPageFinal = await snap() } catch {}
} finally {
  try { await browser.close() } catch {}
  results.wallClockMs = Date.now() - T0
  fs.writeFileSync(path.join(OUT, 'campaign.json'), JSON.stringify(results, null, 1))
  log('WROTE campaign.json  wallClock=' + results.wallClockMs + 'ms')
}
