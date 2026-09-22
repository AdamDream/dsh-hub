#!/usr/bin/env node
/**
 * Follow-cursor ("跟手") animation cost model probe — READ-ONLY measurement driver.
 *
 * Serves page/index.html from a local loopback HTTP server with COOP/COEP so the
 * page becomes crossOriginIsolated => performance.now() gets the high-resolution
 * (5us) clock instead of the default 100us clamp. Falls back to file:// if needed.
 *
 * Usage:
 *   node run.mjs --mode=headless --rounds=3 --count=3000
 *   node run.mjs --mode=headed   --rounds=3 --count=3000
 *
 * Writes one JSON per round into raw/. Touches no system setting.
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PW_PATH = '/home/CNS2026495165/playwright_scratch/node_modules/playwright';
const { chromium } = require(PW_PATH);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(__dirname, 'raw');
const PAGE = path.join(__dirname, 'index.html');

// ------------------------------------------------------------------ args
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] === undefined ? 'true' : m[2]] : [a, 'true'];
  })
);
const MODE = args.mode === 'headed' ? 'headed' : 'headless';
const ROUNDS = Number(args.rounds || 3);
const COUNT = Number(args.count || 3000);
const INTERVAL = Number(args.interval || 1);
const TAG = args.tag || MODE;
const DSF = args.dsf ? Number(args.dsf) : null;

// -------------------------------------------------------- local http server
const server = http.createServer(async (req, res) => {
  try {
    const body = await fsp.readFile(PAGE);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const URL = `http://127.0.0.1:${PORT}/index.html`;

// ------------------------------------------------------------------ output
await fsp.mkdir(RAW, { recursive: true });
const written = [];
async function save(name, obj) {
  const p = path.join(RAW, name);
  await fsp.writeFile(p, JSON.stringify(obj, null, 2));
  written.push(p);
  return p;
}

function median(a) {
  const s = a.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const r3 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

// ------------------------------------------------------------------ launch
const profileDir = path.join(__dirname, `.profile-${MODE}-${process.pid}`);
const launchArgs = [
  `--window-size=1280,800`,
  `--window-position=40,40`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
];
if (MODE === 'headless') launchArgs.push(`--force-device-scale-factor=${DSF || 1}`);

const browser = await chromium.launch({
  headless: MODE === 'headless',
  args: launchArgs,
  env: { ...process.env, DISPLAY: process.env.DISPLAY || ':1' },
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 760 },
});
const page = await context.newPage();

const consoleErrs = [];
page.on('pageerror', (e) => consoleErrs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text()); });

let loadAtStart = null;
try { loadAtStart = fs.readFileSync('/proc/loadavg', 'utf8').trim(); } catch {}

const out = {
  meta: {
    mode: MODE,
    tag: TAG,
    startedAt: new Date().toISOString(),
    url: URL,
    playwright: PW_PATH,
    node: process.version,
    platform: `${os.platform()} ${os.release()}`,
    cpus: os.cpus().length,
    loadavgAtStart: loadAtStart,
    rounds: ROUNDS,
    count: COUNT,
    intervalMs: INTERVAL,
    launchArgs,
    display: process.env.DISPLAY || null,
  },
  facts: null,
  gl: null,
  canvas2d: null,
  pageInfo: null,
  gpuPage: null,
  gpuPageError: null,
  runs: [],
  cdp: [],
  errors: consoleErrs,
};

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__P && window.__P.ready, null, { timeout: 15000 });

out.facts = await page.evaluate(() => window.__P.displayFacts());
out.gl = await page.evaluate(() => window.__P.glInfo());
out.canvas2d = await page.evaluate(() => window.__P.canvas2dInfo());
out.pageInfo = await page.evaluate(() => window.__P.pageInfo());

// ------------------------------------------------------------- chrome://gpu
async function grabGpuPage() {
  const p = await context.newPage();
  try {
    await p.goto('chrome://gpu', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await p.waitForTimeout(4000);
    const txt = await p.evaluate(() => document.body.innerText);
    const features = await p.evaluate(() => {
      const o = {};
      const feats = document.querySelectorAll('#feature-status-list li');
      feats.forEach((li) => {
        const sp = li.querySelector('span');
        const st = li.querySelector('span.feature-status, .feature-status');
        o[(sp ? sp.textContent : li.textContent).trim().slice(0, 80)] = st ? st.textContent.trim() : null;
      });
      return o;
    });
    const problems = await p.evaluate(() => {
      const el = document.querySelector('#problems-list');
      return el ? el.innerText.slice(0, 4000) : null;
    });
    return { text: txt, featureStatusList: features, problemsList: problems };
  } finally {
    await p.close().catch(() => {});
  }
}
try {
  out.gpuPage = await grabGpuPage();
} catch (e) {
  out.gpuPageError = String(e);
}

// --------------------------------------------------------------- run matrix
const IMPLS = ['null-handler', 'perEvent-noRaf', 'perEvent-raf', 'layout-thrash', 'canvas-2d'];

async function measure(impl, opts = {}) {
  return page.evaluate(
    ([i, o]) => window.__P.measureRun(Object.assign({ impl: i }, o)),
    [impl, opts]
  );
}

// B) paced (1 event/ms) runs — the headline table
for (const impl of IMPLS) {
  for (let r = 1; r <= ROUNDS; r++) {
    const res = await measure(impl, { count: COUNT, intervalMs: INTERVAL, pace: 'mc', boxMode: 'small' });
    res.round = r;
    out.runs.push(res);
    await save(`raw-${TAG}-paced-${impl}-r${r}.json`, res);
    process.stderr.write(`[paced] ${impl} r${r}  us/ev=${r3(res.usPerEvent)}  p95=${r3(res.frameIntervalMs.p95)}  drop>16.7=${r3(res.frameOver16_7Frac)}\n`);
  }
}

// B-baseline) unpaced burst: pure JS handler cost, rendering deliberately blocked
for (const impl of IMPLS) {
  for (let r = 1; r <= ROUNDS; r++) {
    const res = await measure(impl, { count: COUNT, pace: 'burst', boxMode: 'small' });
    res.round = r;
    out.runs.push(res);
    await save(`raw-${TAG}-burst-${impl}-r${r}.json`, res);
    process.stderr.write(`[burst] ${impl} r${r}  us/ev=${r3(res.usPerEvent)}\n`);
  }
}

// B-sweep) event-rate sweep: where does the per-frame budget run out?
const SWEEP_IMPLS = ['null-handler', 'perEvent-raf', 'layout-thrash', 'canvas-2d'];
const SWEEP_INTERVALS = [2, 1, 0.5, 0.25];
for (const impl of (args.nosweep === '1' ? [] : SWEEP_IMPLS)) {
  for (const iv of SWEEP_INTERVALS) {
    for (let r = 1; r <= ROUNDS; r++) {
      let res;
      try {
        res = await measure(impl, { count: 2000, intervalMs: iv, pace: 'mc', boxMode: 'small' });
      } catch (e) {
        process.stderr.write(`[sweep] ${impl}@${iv}ms r${r} FAILED: ${e}\n`);
        continue;
      }
      res.round = r; res.sweepIntervalMs = iv; res.sweepRequestedRate = 1000 / iv;
      out.runs.push(res);
      await save(`raw-${TAG}-sweep-${impl}-iv${iv}-r${r}.json`, res);
      process.stderr.write(`[sweep] ${impl}@${(1000 / iv).toFixed(0)}/s r${r}  us/ev=${r3(res.usPerEvent)}  achieved=${r3(res.achievedEventsPerSec)}  p95=${r3(res.frameIntervalMs.p95)}  drop>16.7=${r3(res.frameOver16_7Frac)}  lt=${r3(res.longtaskTotalMs)}\n`);
    }
  }
}

// D) draw-area test: perEvent-raf with a full-viewport element
for (let r = 1; r <= ROUNDS; r++) {
  const res = await measure('perEvent-raf', { count: COUNT, intervalMs: INTERVAL, pace: 'mc', boxMode: 'full' });
  res.round = r;
  out.runs.push(res);
  await save(`raw-${TAG}-paced-fullbox-perEvent-raf-r${r}.json`, res);
  process.stderr.write(`[fullbox] perEvent-raf r${r}  p95=${r3(res.frameIntervalMs.p95)}  drop>16.7=${r3(res.frameOver16_7Frac)}\n`);
}
// D-baseline) idle frame pacing with no events at all (small box and full box)
for (const bm of ['small', 'full']) {
  for (let r = 1; r <= ROUNDS; r++) {
    let res;
    try {
      res = await measure('null-handler', { count: 0, pace: 'mc', boxMode: bm, idleMs: 3000 });
    } catch (e) {
      process.stderr.write(`[idle-${bm}] r${r} FAILED: ${e}\n`);
      continue;
    }
    res.impl = `idle-${bm}`; res.pace = 'idle'; res.round = r;
    out.runs.push(res);
    await save(`raw-${TAG}-idle-${bm}box-r${r}.json`, res);
    process.stderr.write(`[idle-${bm}] r${r}  p50=${r3(res.frameIntervalMs.p50)}  p95=${r3(res.frameIntervalMs.p95)}  drop>16.7=${r3(res.frameOver16_7Frac)}  fps=${r3(res.effFpsFromFrames)}\n`);
  }
}

// C3) real CDP input injection through the browser input pipeline
for (const impl of ['null-handler', 'perEvent-raf']) {
  for (let r = 1; r <= ROUNDS; r++) {
    await page.evaluate((i) => {
      window.__P.reset(i, 'small');
      return window.__P.cdpWindowStart();
    }, impl);
    const t0 = Date.now();
    const N = 300;
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 6;
      const x = 500 + Math.round(180 * Math.cos(ang));
      const y = 350 + Math.round(120 * Math.sin(ang * 1.3));
      await page.mouse.move(x, y);
    }
    const wall = Date.now() - t0;
    const res = await page.evaluate((n) => window.__P.cdpWindowEnd(n), N);
    res.impl = impl; res.round = r; res.injectWallMs = wall;
    res.injectRatePerSec = (N * 1000) / wall;
    out.cdp.push(res);
    await save(`raw-${TAG}-cdp-${impl}-r${r}.json`, res);
    process.stderr.write(`[cdp] ${impl} r${r}  moves=${N} mouse=${res.mousemoveReceived} ptr=${res.pointermoveReceived} p95=${r3(res.frameIntervalMs.p95)}\n`);
  }
}

// E) headless-only viewport/or draw-area scaling (opt-in via --area=1)
if (args.area === '1') {
  const sizes = (DSF && DSF >= 2) ? [[1280, 760], [2560, 1440]] : [[1280, 760], [2560, 1440], [3840, 2160]];
  for (const [w, h] of sizes) {
    try { await page.setViewportSize({ width: w, height: h }); } catch (e) { process.stderr.write(`area setViewport ${w}x${h} failed: ${e}\n`); continue; }
    await page.waitForTimeout(600);
    for (let r = 1; r <= ROUNDS; r++) {
      for (const bm of ['small', 'full']) {
        let res;
        try {
          res = await measure('perEvent-raf', { count: 2000, intervalMs: INTERVAL, pace: 'mc', boxMode: bm });
        } catch (e) {
          process.stderr.write(`[area] ${w}x${h} ${bm} r${r} FAILED: ${e}\n`);
          continue;
        }
        res.round = r; res.areaW = w; res.areaH = h;
        out.runs.push(res);
        await save(`raw-${TAG}-area-${w}x${h}-${bm}-r${r}.json`, res);
        process.stderr.write(`[area] ${w}x${h} box=${bm} r${r}  us/ev=${r3(res.usPerEvent)}  p95=${r3(res.frameIntervalMs.p95)}  drop16=${r3(res.frameOver16_7Frac)}  lt=${r3(res.longtaskTotalMs)}\n`);
      }
    }
  }
}

// ------------------------------------------------------------------ summary
function summarize(keyFn, list) {
  const byKey = new Map();
  for (const r of list) {
    const k = keyFn(r);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  const rows = [];
  for (const [k, rs] of byKey) {
    const g = (f) => rs.map(f).filter((v) => typeof v === 'number' && Number.isFinite(v));
    const range = (f) => { const v = g(f); return v.length ? [Math.min(...v), Math.max(...v)].map(r3) : [null, null]; };
    rows.push({
      key: k,
      n: rs.length,
      usPerEvent_median: r3(median(g((r) => r.usPerEvent))),
      usPerEvent_range: range((r) => r.usPerEvent),
      msPer1000_median: r3(median(g((r) => r.msPer1000Events))),
      msPer1000_range: range((r) => r.msPer1000Events),
      achievedRate_median: r3(median(g((r) => r.achievedEventsPerSec))),
      frame_p50_median: r3(median(g((r) => r.frameIntervalMs.p50))),
      frame_p95_median: r3(median(g((r) => r.frameIntervalMs.p95))),
      frame_p95_range: range((r) => r.frameIntervalMs.p95),
      frame_p99_median: r3(median(g((r) => r.frameIntervalMs.p99))),
      frame_max_median: r3(median(g((r) => r.frameIntervalMs.max))),
      over16_7_median: r3(median(g((r) => r.frameOver16_7Frac))),
      over50_median: r3(median(g((r) => r.frameOver50Frac))),
      frames_median: r3(median(g((r) => r.frames))),
      effFps_median: r3(median(g((r) => r.effFpsFromFrames))),
      longtaskCount_median: r3(median(g((r) => r.longtaskCount))),
      longtaskTotal_median: r3(median(g((r) => r.longtaskTotalMs))),
      longtaskMax_median: r3(median(g((r) => r.longtaskMaxMs))),
      eventInterval_p50_median: r3(median(g((r) => r.eventIntervalMs && r.eventIntervalMs.p50))),
      eventInterval_p95_median: r3(median(g((r) => r.eventIntervalMs && r.eventIntervalMs.p95))),
    });
  }
  return rows;
}

out.summary = {
  paced: summarize((r) => r.impl, out.runs.filter((r) => r.pace === 'mc' && r.boxMode === 'small' && !r.sweepIntervalMs)),
  burst: summarize((r) => r.impl, out.runs.filter((r) => r.pace === 'burst')),
  sweep: summarize((r) => `${r.impl}@${r.sweepRequestedRate}/s`, out.runs.filter((r) => r.sweepIntervalMs)),
  fullbox: summarize((r) => r.impl, out.runs.filter((r) => r.pace === 'mc' && r.boxMode === 'full')),
  idle: summarize((r) => r.impl, out.runs.filter((r) => r.pace === 'idle')),
  area: summarize((r) => `${r.areaW}x${r.areaH}-${r.boxMode}`, out.runs.filter((r) => r.areaW)),
  cdp: summarize((r) => r.impl, out.cdp),
};

out.finishedAt = new Date().toISOString();
try { out.meta.loadavgAtEnd = fs.readFileSync('/proc/loadavg', 'utf8').trim(); } catch {}

const summaryPath = path.join(RAW, `SUMMARY-${TAG}.json`);
await fsp.writeFile(summaryPath, JSON.stringify(out, null, 2));
written.push(summaryPath);

await context.close().catch(() => {});
await browser.close().catch(() => {});
server.close();
await fsp.rm(profileDir, { recursive: true, force: true }).catch(() => {});

console.log(JSON.stringify({
  mode: MODE, tag: TAG, summaryPath,
  facts: {
    devicePixelRatio: out.facts.devicePixelRatio,
    screen: [out.facts.screenWidth, out.facts.screenHeight],
    inner: [out.facts.innerWidth, out.facts.innerHeight],
    res1dppx: out.facts.res1dppx, res2dppx: out.facts.res2dppx,
    crossOriginIsolated: out.facts.crossOriginIsolated,
    timerResolutionUs: out.facts.timerResolutionUs && out.facts.timerResolutionUs.minMs,
    hardwareConcurrency: out.facts.hardwareConcurrency,
  },
  gl: { unmaskedRenderer: out.gl.unmaskedRenderer, unmaskedVendor: out.gl.unmaskedVendor, renderer: out.gl.renderer },
  gpuPageErr: out.gpuPageError,
  paced: out.summary.paced,
  burst: out.summary.burst,
  fullbox: out.summary.fullbox,
  idle: out.summary.idle,
  cdp: out.summary.cdp,
  errors: consoleErrs.slice(0, 5),
}, null, 2));
process.exit(0);
