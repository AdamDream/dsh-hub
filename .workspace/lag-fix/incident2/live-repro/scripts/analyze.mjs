// Analyzer: slice the continuous in-page record by window marks and classify the lag shape.
//   node analyze.mjs [tag ...]      (default: all raw/*run*.json)
// Read-only over raw/*.json. Writes raw/analysis-<tag>.json and prints a table.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/live-repro'
const RAW = path.join(ROOT, 'raw')
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000)
const r1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10) / 10)

function pct(sorted, p) {
  if (!sorted.length) return null
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[i]
}
function stats(vals) {
  if (!vals.length) return { n: 0 }
  const s = [...vals].sort((a, b) => a - b)
  const over = (t) => vals.filter((v) => v >= t).length
  return {
    n: vals.length,
    mean: r3(vals.reduce((a, b) => a + b, 0) / vals.length),
    p50: r3(pct(s, 50)), p90: r3(pct(s, 90)), p95: r3(pct(s, 95)), p99: r3(pct(s, 99)),
    max: r3(s[s.length - 1]), min: r3(s[0]),
    over33: over(33.4), over50: over(50), over80: over(80), over100: over(100), over200: over(200),
    sum: r3(vals.reduce((a, b) => a + b, 0)),
  }
}

// frames: [[t, dt], ...] in page performance.now() ms
function sliceFrames(frames, t0, t1) {
  return frames.filter(([t]) => t >= t0 && t <= t1).map(([t, dt]) => ({ t, dt }))
}

function classify(w) {
  // w = { frames:[dt...], longtasks:[...], lof:[...], clickT, windowStart, windowEnd }
  const dt = w.frames.map((f) => f.dt)
  const maxFrame = dt.length ? Math.max(...dt) : null
  const frames30to80 = dt.filter((v) => v >= 30 && v < 100).length
  const frames80to100 = dt.filter((v) => v >= 80 && v < 100).length
  const framesOver100 = dt.filter((v) => v >= 100).length
  const lt = w.longtasks || []
  const ltMax = lt.length ? Math.max(...lt.map((x) => x.dur)) : null
  const ltOver100 = lt.filter((x) => x.dur >= 100).length
  const lofMaxDur = w.lof.length ? Math.max(...w.lof.map((x) => x.dur)) : null
  const lofOver100 = w.lof.filter((x) => x.dur >= 100).length
  const freeze = (maxFrame != null && maxFrame >= 100) || (ltMax != null && ltMax >= 100) || lofOver100 > 0
  const sustained = frames30to80 >= 3
  let shape = 'SMOOTH'
  if (freeze && sustained) shape = 'MIXED(freeze+sustained)'
  else if (freeze) shape = 'FREEZE(single >=100ms stall)'
  else if (sustained) shape = 'SUSTAINED(multiple 30-80ms frames)'
  else if (frames30to80 >= 1) shape = 'MINOR(1-2 frames 30-80ms)'
  return {
    shape, maxFrameMs: r3(maxFrame), frames30to80, frames80to100, framesOver100,
    longtaskMaxMs: r3(ltMax), longtaskOver100: ltOver100,
    lofMaxDurMs: r3(lofMaxDur), lofOver100Count: lofOver100,
    // worst frame and where it sits relative to the click
    worstFrameOffsetMs: (() => {
      if (!w.frames.length) return null
      let best = w.frames[0]
      for (const f of w.frames) if (f.dt > best.dt) best = f
      return w.clickT != null ? r3(best.t - w.clickT) : null
    })(),
  }
}

const tags = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(RAW).filter((f) => /run\d+\.json$/.test(f)).map((f) => f.replace(/\.json$/, ''))

const summary = []
for (const tag of tags) {
  const file = path.join(RAW, `${tag}.json`)
  if (!fs.existsSync(file)) { console.log(`[skip] ${tag}: no raw json`); continue }
  const d = JSON.parse(fs.readFileSync(file, 'utf8'))
  const out = {
    tag, mode: d.mode, run: d.run, gateOutcome: d.gateOutcome,
    censusEnd: d.censusEnd ? { mine: d.censusEnd.mainInstancesMine, foreign: d.censusEnd.foreignMainInstances } : null,
    browserVersion: d.browserVersion, gpu: d.gpu, page: d.page,
    markerProofOk: d.markerProof ? Object.entries(d.markerProof).filter(([k]) => !k.startsWith('__')).every(([, v]) => v.ok) : null,
    windows: [], clickDialogs: [],
  }
  if (d.mode === 'headed') out.censusMineDetail = d.censusAfterLaunch?.mine ?? null

  // global frame record: windows[] entries carry raw.frames reset per group.
  // clickN raw.frames starts at the reset point for N>1 and at idle-arm for N==1.
  const groups = d.windows || []
  for (const w of groups) {
    if (w.invalid) { out.windows.push({ name: w.name, invalid: true, reason: w.invalidReason }); continue }
    if (!w.raw) {
      // idle window: frames are inside click1's raw (which starts at t_arm)
      continue
    }
    const P = w.raw
    const marks = P.marks || {}
    const i = w.index
    const tPre = marks[`t_pre${i}`], tClick = w.raw ? P.evts?.find((e) => e.phase === 'click')?.t ?? null : null
    const tPost = marks[`t_post${i}`]
    const tArm = marks[`t_arm${i}`] ?? marks.t_arm
    const clickT = w.raw.evts?.filter((e) => e.phase === 'click').slice(-1)[0]?.t ?? null
    const frames = P.frames || []
    const preFrames = sliceFrames(frames, tPre, clickT ?? tPost)
    const postFrames = sliceFrames(frames, clickT ?? tPre, tPost)
    const ltIn = (P.longtasks || []).filter((x) => x.t >= (tPre ?? 0) && x.t <= (tPost ?? 1e9))
    const lofIn = (P.lof || []).filter((x) => x.t >= (tPre ?? 0) && x.t <= (tPost ?? 1e9))
    const rec = {
      name: w.name, index: i,
      clickToDialogDomMs: w.clickToDialogDomMs,
      clickToDialogVisibleMs: w.clickToDialogVisibleMs,
      clickToDialogPaintedMs: w.clickToDialogPaintedMs,
      playwrightDialogVisibleMs: w.playwrightDialogVisibleMs,
      nodesBefore: w.nodesNow, dialogPaintedRect: w.dialogPaintedRect,
      metricsDelta: w.metricsDelta,
      preWindow: { spanMs: r3((clickT ?? 0) - (tPre ?? 0)), frameStats: stats(preFrames.map((f) => f.dt)), classify: classify({ frames: preFrames, longtasks: [], lof: [], clickT }) },
      clickWindow: {
        spanMs: r3((tPost ?? 0) - (clickT ?? 0)),
        frameStats: stats(postFrames.map((f) => f.dt)),
        classify: classify({ frames: postFrames, longtasks: ltIn, lof: lofIn, clickT }),
        frameSeries: postFrames,
      },
      longtasks: ltIn, lof: lofIn.map((x) => ({ t: r3(x.t - (clickT ?? 0)), dur: x.dur, blocking: x.blockingDuration, renderStart: x.renderStart, styleAndLayoutStart: x.styleAndLayoutStart, scripts: x.scripts.slice(0, 6).map((s) => ({ name: s.name, invoker: s.invoker, dur: s.dur, forced: s.forcedStyleAndLayout, src: s.sourceURL, fn: s.sourceFunctionName })) })),
      consoleErrors: (P.console || []).filter((c) => c.lvl === 'error' || c.lvl === 'warn').slice(0, 20),
      pageErrors: P.errors || [],
      mutationsNearClick: (P.mutations || []).filter((m) => m.t >= (clickT ?? 0) - 200 && m.t <= (clickT ?? 0) + 1500).slice(0, 60),
      attrWritesNearClick: (P.mutations || []).filter((m) => m.kind === 'attr' && m.t >= (clickT ?? 0) - 200 && m.t <= (clickT ?? 0) + 1500).slice(0, 40),
    }
    out.windows.push(rec)
    out.clickDialogs.push({ i, dom: w.clickToDialogDomMs, vis: w.clickToDialogVisibleMs, paint: w.clickToDialogPaintedMs })
  }

  // idle window from click1 raw
  const c1 = (d.windows || []).find((w) => w.index === 1 && w.raw)
  if (c1) {
    const m = c1.raw.marks || {}
    const tArm = m.t_arm, tPre1 = m.t_pre1
    const idleFrames = sliceFrames(c1.raw.frames || [], tArm, tPre1)
    out.idle = { spanMs: r3(tPre1 - tArm), frameStats: stats(idleFrames.map((f) => f.dt)), frameSeries: idleFrames, longtasks: c1.raw.longtasks || [], lofCount: (c1.raw.lof || []).length }
    out.idle.classify = classify({ frames: idleFrames, longtasks: (c1.raw.longtasks || []).filter((x) => x.t >= tArm && x.t <= tPre1), lof: [], clickT: tArm })
    out.idleMetrics = d.windows.find((w) => w.name === 'idle')?.metricsDelta ?? null
  }

  // first-open vs re-open contrast
  const open = out.windows.filter((w) => w.clickWindow)
  out.contrast = {
    firstOpen: open[0] ? { vis: open[0].clickToDialogVisibleMs, classify: open[0].clickWindow.classify, task: open[0].metricsDelta?.TaskDuration, script: open[0].metricsDelta?.ScriptDuration } : null,
    reOpen: open.slice(1).map((w) => ({ name: w.name, vis: w.clickToDialogVisibleMs, classify: w.clickWindow.classify, task: w.metricsDelta?.TaskDuration, script: w.metricsDelta?.ScriptDuration })),
  }
  out.verdict = {
    firstOpenShape: open[0]?.clickWindow.classify.shape ?? null,
    firstOpenVisibleMs: open[0]?.clickToDialogVisibleMs ?? null,
    allWindowsExclusive: d.gateOutcome === 'EXCLUSIVE',
  }
  fs.writeFileSync(path.join(RAW, `analysis-${tag}.json`), JSON.stringify(out, null, 1))
  summary.push(out)

  console.log(`\n=== ${tag} (${d.mode}) gate=${d.gateOutcome} ver=${d.browserVersion} markers=${out.markerProofOk} ===`)
  const g = d.gpu && d.gpu.renderer ? String(d.gpu.renderer).slice(0, 70) : 'n/a'
  console.log(`    gpu: ${g}`)
  if (out.idle) console.log(`    IDLE   span=${out.idle.spanMs}ms p50=${out.idle.frameStats.p50} p99=${out.idle.frameStats.p99} max=${out.idle.frameStats.max} >33=${out.idle.frameStats.over33} >50=${out.idle.frameStats.over50} rAF/s=${r1(1000 / out.idle.frameStats.mean)} shape=${out.idle.classify.shape} [${out.idle.classify.shape === 'SMOOTH' ? 'OK' : ''}]`)
  for (const w of open) {
    if (w.invalid) { console.log(`    ${w.name}: INVALID ${w.reason}`); continue }
    console.log(`    ${w.name.padEnd(6)} click->dom=${w.clickToDialogDomMs} ->vis=${w.clickToDialogVisibleMs} ->paint=${w.clickToDialogPaintedMs} | win p50=${w.clickWindow.frameStats.p50} p99=${w.clickWindow.frameStats.p99} max=${w.clickWindow.frameStats.max} >33=${w.clickWindow.frameStats.over33} >50=${w.clickWindow.frameStats.over50} >100=${w.clickWindow.frameStats.over100} | shape=${w.clickWindow.classify.shape} | LTmax=${w.clickWindow.classify.longtaskMaxMs} LoFmax=${w.clickWindow.classify.lofMaxDurMs} | Task=${r1((w.metricsDelta.TaskDuration || 0) * 1000)}ms Script=${r1((w.metricsDelta.ScriptDuration || 0) * 1000)}ms RecalcN=${w.metricsDelta.RecalcStyleCount}`)
  }
}
fs.writeFileSync(path.join(RAW, 'analysis-summary.json'), JSON.stringify(summary, null, 1))
console.log(`\n[analyze] ${summary.length} tag(s) -> raw/analysis-summary.json`)
