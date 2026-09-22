#!/usr/bin/env node
/**
 * analyze.mjs — reads raw/SUMMARY-<tag>.json produced by run.mjs and prints
 * markdown tables + the derived per-frame budget model.
 *
 * Usage: node analyze.mjs [tag ...]      (default: headless, headless-area)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(__dirname, 'raw');
const tags = process.argv.slice(2).length ? process.argv.slice(2) : ['headless', 'headless-area'];

const f = (x, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? 'n/a' : Number(x).toFixed(d));
const pct = (x) => (x === null || x === undefined || !Number.isFinite(x) ? 'n/a' : (x * 100).toFixed(1) + '%');

for (const tag of tags) {
  const p = path.join(RAW, `SUMMARY-${tag}.json`);
  if (!fs.existsSync(p)) { console.log(`(missing ${p})`); continue; }
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));

  console.log(`\n\n########## TAG ${tag} (${d.meta.mode}) ##########`);
  console.log(`facts: dpr=${d.facts.devicePixelRatio} screen=${d.facts.screenWidth}x${d.facts.screenHeight} inner=${d.facts.innerWidth}x${d.facts.innerHeight} res1dppx=${d.facts.res1dppx} res2dppx=${d.facts.res2dppx} coi=${d.facts.crossOriginIsolated} timerRes=${f(d.facts.timerResolutionUs?.minMs, 4)}ms cores=${d.facts.hardwareConcurrency}`);
  console.log(`gl: ${d.gl.unmaskedRenderer}`);
  console.log(`gpuPageErr: ${d.gpuPageError}`);
  console.log(`loadavg: start=${d.meta.loadavgAtStart} end=${d.meta.loadavgAtEnd}`);

  const paced = d.summary.paced;
  const base = paced.find((r) => r.key === 'null-handler');
  const baseUs = base ? base.usPerEvent_median : 0;

  console.log(`\n--- B) paced 1000 events/s, 3000 events/round, small box (median of ${d.meta.rounds}) ---`);
  console.log('| impl | us/ev | ms/1000ev | net us/ev | net ms/1000ev | iv p50 | iv p95 | iv p99 | iv max | >16.7ms | >50ms | LT count | LT total ms | ev/frame (median) |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of paced) {
    const runs = d.runs.filter((x) => x.impl === r.key && x.pace === 'mc' && x.boxMode === 'small' && !x.sweepIntervalMs);
    const epf = runs.map((x) => {
      const h = x.evPerFrameHist || {};
      const nz = Object.entries(h).filter(([k]) => Number(k) > 0);
      const tot = nz.reduce((a, [k, v]) => a + Number(k) * v, 0);
      const cnt = nz.reduce((a, [, v]) => a + v, 0);
      return cnt ? tot / cnt : null;
    }).filter((x) => x !== null).sort((a, b) => a - b);
    const epfMed = epf.length ? epf[Math.floor(epf.length / 2)] : null;
    console.log(`| ${r.key} | ${f(r.usPerEvent_median)} | ${f(r.msPer1000_median)} | ${f(r.usPerEvent_median - baseUs)} | ${f(r.msPer1000_median - (base ? base.msPer1000_median : 0))} | ${f(r.frame_p50_median)} | ${f(r.frame_p95_median)} | ${f(r.frame_p99_median)} | ${f(r.frame_max_median)} | ${pct(r.over16_7_median)} | ${pct(r.over50_median)} | ${f(r.longtaskCount_median, 0)} | ${f(r.longtaskTotal_median)} | ${epfMed === null ? 'n/a' : f(epfMed, 1)} |`);
  }

  console.log(`\n--- B-baseline) unpaced burst (pure JS handler cost, rendering deliberately blocked) ---`);
  console.log('| impl | us/ev | ms/1000ev | range us/ev |');
  console.log('|---|---|---|---|');
  for (const r of d.summary.burst) console.log(`| ${r.key} | ${f(r.usPerEvent_median)} | ${f(r.msPer1000_median)} | ${f(r.usPerEvent_range[0])}-${f(r.usPerEvent_range[1])} |`);

  console.log(`\n--- B-sweep) event-rate sweep (2000 events/round) ---`);
  console.log('| impl@rate | us/ev | achieved ev/s | frame p95 | >16.7ms | LT total ms |');
  console.log('|---|---|---|---|---|---|');
  for (const r of d.summary.sweep) console.log(`| ${r.key} | ${f(r.usPerEvent_median)} | ${f(r.achievedRate_median, 0)} | ${f(r.frame_p95_median)} | ${pct(r.over16_7_median)} | ${f(r.longtaskTotal_median)} |`);

  if (d.summary.fullbox.length) {
    console.log(`\n--- D) full-viewport element vs small box (perEvent-raf, paced 1000/s) ---`);
    for (const r of d.summary.fullbox) console.log(`fullbox: ${r.key} us/ev=${f(r.usPerEvent_median)} iv p50=${f(r.frame_p50_median)} p95=${f(r.frame_p95_median)} drop16=${pct(r.over16_7_median)} frames=${f(r.frames_median, 0)}`);
  }
  if (d.summary.area && d.summary.area.length) {
    console.log(`\n--- D2) draw-area scaling (perEvent-raf) ---`);
    console.log('| viewport/box | us/ev | iv p50 | iv p95 | iv p99 | iv max | >16.7ms | frames | LT total ms |');
    console.log('|---|---|---|---|---|---|---|---|---|');
    for (const r of d.summary.area) console.log(`| ${r.key} | ${f(r.usPerEvent_median)} | ${f(r.frame_p50_median)} | ${f(r.frame_p95_median)} | ${f(r.frame_p99_median)} | ${f(r.frame_max_median)} | ${pct(r.over16_7_median)} | ${f(r.frames_median, 0)} | ${f(r.longtaskTotal_median)} |`);
  }
  if (d.summary.idle && d.summary.idle.length) {
    console.log(`\n--- idle baseline (no events) ---`);
    for (const r of d.summary.idle) console.log(`idle ${r.key}: iv p50=${f(r.frame_p50_median, 3)} p95=${f(r.frame_p95_median, 3)} p99=${f(r.frame_p99_median, 3)} fps=${f(r.effFps_median, 2)} frames=${f(r.frames_median, 0)} drop16=${pct(r.over16_7_median)}`);
  }
  if (d.summary.cdp && d.summary.cdp.length) {
    console.log(`\n--- C3) real CDP input injection (300 moves) ---`);
    console.log('| impl | injected | mousemove recv | pointermove recv | iv p50 | iv p95 | iv p99 | >16.7ms | LT count |');
    console.log('|---|---|---|---|---|---|---|---|---|');
    for (const r of d.summary.cdp) {
      const runs = d.cdp.filter((x) => x.impl === r.key);
      const m = runs[0] || {};
      console.log(`| ${r.key} | ${m.cdpMovesInjected} | ${m.mousemoveReceived} | ${m.pointermoveReceived} | ${f(r.frame_p50_median)} | ${f(r.frame_p95_median)} | ${f(r.frame_p99_median)} | ${pct(r.over16_7_median)} | ${f(r.longtaskCount_median, 0)} |`);
    }
    const hist = {};
    for (const x of d.cdp) for (const [k, v] of Object.entries(x.coalescedHist || {})) hist[k] = (hist[k] || 0) + v;
    console.log(`coalesced-event histogram (getCoalescedEvents().length -> count): ${JSON.stringify(hist)}`);
  }

  // ------- derived per-frame budget model -------
  console.log(`\n--- derived: main-thread JS budget per 60 Hz frame at 1000 events/s ---`);
  console.log('(16.67 events per frame at 1000 ev/s and 60 fps; budget per frame = 16.667 ms)');
  console.log('| impl | ms/frame from event handlers | ms/frame from rAF write | total ms/frame | % of 16.667 ms |');
  console.log('|---|---|---|---|---|');
  for (const r of paced) {
    const runs = d.runs.filter((x) => x.impl === r.key && x.pace === 'mc' && x.boxMode === 'small' && !x.sweepIntervalMs);
    const w = runs.map((x) => x.rafWriteUsPerCall).filter((x) => typeof x === 'number' && Number.isFinite(x));
    const wMed = w.sort((a, b) => a - b)[Math.floor(w.length / 2)];
    const perFrameEv = (r.usPerEvent_median - baseUs) * (1000 / 60) / 1000;
    const perFrameW = (wMed || 0) / 1000;
    const tot = perFrameEv + perFrameW;
    console.log(`| ${r.key} | ${f(perFrameEv, 3)} | ${f(perFrameW, 3)} | ${f(tot, 3)} | ${f(tot / 16.667 * 100, 2)}% |`);
  }
}
