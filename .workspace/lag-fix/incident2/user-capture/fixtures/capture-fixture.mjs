#!/usr/bin/env node
/**
 * capture-fixture.mjs — record a REAL Chrome DevTools Performance-format trace
 * of the already-running DSH GUI at http://127.0.0.1:3080 while it loads and
 * then clicks the Settings (设置) entry.
 *
 * READ-ONLY w.r.t. the product: it only launches its own headless Chromium and
 * navigates to the live GUI. It never touches the running dsh process
 * (PID 10806) and writes only inside its own output directory.
 *
 * Re-runnable / idempotent: outputs are overwritten each run.
 *
 * Run:  node capture-fixture.mjs
 */
import { createRequire } from 'module';
import { writeFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// --- resolve playwright 1.49.1 from its own scratch install (no NODE_PATH needed)
const require = createRequire('/home/CNS2026495165/playwright_scratch/');
const { chromium } = require('playwright');
const PW_VERSION = require('playwright/package.json').version;

const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const TRACE_PATH = join(OUT_DIR, 'real-settings-trace.json');
const META_PATH = join(OUT_DIR, '_capture-meta.json');

const URL = 'http://127.0.0.1:3080/';
const MARK_START = 'USER_CLICK_SETTINGS_START';
const MARK_END = 'USER_CLICK_SETTINGS_END';

// Categories exactly as specified for the trace-parser fixture.
const CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'devtools.timeline.frame',
  'blink.user_timing',
  'disabled-by-default-v8.cpu_profiler',
  'latencyInfo',
  'v8.execute',
  'disabled-by-default-devtools.screenshot',
].join(',');

const timeline = [];
const t = (phase, extra = {}) => {
  timeline.push({ phase, at: new Date().toISOString(), wall: Date.now(), ...extra });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Candidate locators for the Settings entry, tried in order.
const CANDIDATES = [
  ['getByRole(button, 设置, exact)', (p) => p.getByRole('button', { name: '设置', exact: true })],
  ['getByRole(button, 设置)', (p) => p.getByRole('button', { name: '设置' })],
  ['getByText(设置, exact)', (p) => p.getByText('设置', { exact: true })],
  ['button:has-text("设置")', (p) => p.locator('button:has-text("设置")')],
  ['[aria-label*="设置"]', (p) => p.locator('[aria-label*="设置"]')],
  ['[title*="设置"]', (p) => p.locator('[title*="设置"]')],
  ['text=设置', (p) => p.locator('text=设置')],
  ['button.VOzbGW_trigger', (p) => p.locator('button[class*="trigger"]:has-text("设置")')],
  ['getByRole(button, Settings)', (p) => p.getByRole('button', { name: 'Settings' })],
  ['[aria-label*="Settings"]', (p) => p.locator('[aria-label*="Settings"]')],
  ['[title*="Settings"]', (p) => p.locator('[title*="Settings"]')],
];

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const meta = {
  playwrightVersion: PW_VERSION,
  chromiumExecutable: chromium.executablePath(),
  chromiumVersion: browser.version(),
  url: URL,
  categories: CATEGORIES,
  cdpParams: {},
  cdpRejections: [],
  selectorTried: [],
  selectorUsed: null,
  marksPresent: {},
  authenticated: null,
};

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  // Fallback accumulator in case ReturnAsStream is unavailable.
  const collected = [];
  let complete = null;
  let resolveComplete;
  const completePromise = new Promise((r) => { resolveComplete = r; });
  cdp.on('Tracing.dataCollected', (e) => { if (Array.isArray(e.value)) collected.push(...e.value); });
  // NOTE: with transferMode=ReturnAsStream the stream handle is delivered in the
  // Tracing.tracingComplete *event* (Tracing.end itself returns {}).
  cdp.on('Tracing.tracingComplete', (e) => { complete = e; resolveComplete(e); });

  // --- start tracing; degrade gracefully if optional params are rejected
  const baseParams = {
    categories: CATEGORIES,
    transferMode: 'ReturnAsStream',
    streamFormat: 'json',
    streamCompression: 'none',
  };
  let startParams = { ...baseParams, options: 'sampling-frequency=10000' };
  t('Tracing.start requested', { params: startParams });
  try {
    await cdp.send('Tracing.start', startParams);
  } catch (e) {
    meta.cdpRejections.push({ call: 'Tracing.start', params: 'options=sampling-frequency=10000', error: String(e.message || e) });
    startParams = { ...baseParams };
    try {
      await cdp.send('Tracing.start', startParams);
    } catch (e2) {
      meta.cdpRejections.push({ call: 'Tracing.start', params: 'transferMode=ReturnAsStream', error: String(e2.message || e2) });
      startParams = { categories: CATEGORIES };
      await cdp.send('Tracing.start', startParams);
    }
  }
  meta.cdpParams.tracingStart = startParams;
  t('Tracing.start accepted', { params: startParams });

  // --- navigate to the live GUI
  t('goto start');
  const resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const httpStatus = resp ? resp.status() : null;
  await page.waitForLoadState('load', { timeout: 60000 }).catch(() => {});
  t('goto done (domcontentloaded + load)', { httpStatus });

  // auth check: is this a login screen or the real app shell?
  const bodyText = (await page.evaluate(() => document.body.innerText || '')).slice(0, 4000);
  meta.authenticated = !/登录|sign in|log in|password|密码/i.test(bodyText);
  meta.bodyTextHead = bodyText.slice(0, 400);

  // --- let the app shell hydrate so the Settings button exists
  t('hydration wait start', { ms: 6000 });
  await page.waitForTimeout(6000);
  t('hydration wait done');

  // --- MARK: click anchor start (before clicking)
  await page.evaluate((m) => { performance.mark(m); }, MARK_START);
  t('performance.mark ' + MARK_START);

  // --- robust selector loop
  let clickedWith = null;
  for (const [label, make] of CANDIDATES) {
    let loc;
    try {
      loc = make(page);
      const n = await loc.count();
      if (n === 0) { meta.selectorTried.push({ selector: label, count: 0, visible: false }); continue; }
      const first = loc.first();
      const visible = await first.isVisible().catch(() => false);
      meta.selectorTried.push({ selector: label, count: n, visible });
      if (!visible) continue;
      await first.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
      await first.click({ timeout: 10000 });
      clickedWith = label;
      break;
    } catch (e) {
      meta.selectorTried.push({ selector: label, error: String(e.message || e).split('\n')[0] });
    }
  }

  if (clickedWith) {
    meta.selectorUsed = clickedWith;
    t('settings click via ' + clickedWith);
  } else {
    t('NO settings selector matched');
  }

  // --- MARK: click anchor end (after click + ~2s)
  await page.waitForTimeout(2000);
  await page.evaluate((m) => { performance.mark(m); }, MARK_END);
  t('performance.mark ' + MARK_END);
  await page.waitForTimeout(600);

  // --- stop tracing and read the stream
  t('Tracing.end');
  let stream = null;
  try {
    const end = await cdp.send('Tracing.end');
    // Some protocol versions DO return the handle here; prefer it, else wait for the event.
    if (end && end.stream) stream = end.stream;
    else await Promise.race([completePromise, sleep(20000)]);
    if (!stream && complete && complete.stream) stream = complete.stream;
  } catch (e) {
    meta.cdpRejections.push({ call: 'Tracing.end', error: String(e.message || e) });
  }
  t('Tracing.end settled', { hasStream: !!stream, streamFormat: complete && complete.traceFormat });

  let outBuf = null;
  if (stream) {
    // Read the stream WITHOUT any UTF-8 decoding. IO.read returns {data, base64Encoded, eof};
    // Chromium reports base64Encoded:false, so `data` is a raw byte-string that must be preserved
    // byte-for-byte as latin1. Decoding it as UTF-8 (or as base64) destroys the payload by turning
    // every invalid byte into U+FFFD — the exact failure this guard exists to prevent.
    const parts = [];
    for (let i = 0; i < 200000; i++) {
      const r = await cdp.send('IO.read', { handle: stream, size: 1 << 20 });
      const d = r.data || '';
      parts.push(Buffer.from(d, r.base64Encoded ? 'base64' : 'latin1'));
      if (r.eof) break;
    }
    try { await cdp.send('IO.close', { handle: stream }); } catch { /* non-fatal */ }
    outBuf = Buffer.concat(parts);
    meta.streamCompressionReported = complete ? complete.streamCompression : undefined;
    meta.readPath = 'IO.read stream (binary-safe latin1/base64 byte chunks)';
  } else {
    // wait for tracingComplete, then fall back to event accumulation
    for (let i = 0; i < 100 && !complete; i++) await sleep(100);
    if (complete && complete.filePath) {
      outBuf = readFileSync(complete.filePath); // Buffer — never decode here
      meta.readPath = 'tracingComplete.filePath (binary read)';
    } else if (collected.length) {
      outBuf = Buffer.from(
        JSON.stringify({ traceEvents: collected, metadata: { source: 'Tracing.dataCollected fallback' } }),
        'utf8'
      );
      meta.readPath = 'Tracing.dataCollected fallback';
    }
  }
  if (!outBuf || outBuf.length === 0) throw new Error('no trace data obtained from any CDP path');

  // --- normalize: gunzip if the stream is compressed
  if (outBuf.length > 2 && outBuf[0] === 0x1f && outBuf[1] === 0x8b) {
    const { gunzipSync } = await import('zlib');
    outBuf = gunzipSync(outBuf);
    meta.streamDecompressed = true;
  }
  t('trace bytes read', { bytes: outBuf.length });

  // --- GATE A: validate BEFORE writing, so a broken capture can never land on disk
  const head = outBuf.slice(0, 200).toString('utf8');
  if (!head.includes('traceEvents')) {
    throw new Error('GATE FAILED: payload is not a DevTools trace; head=' + JSON.stringify(head.slice(0, 120)));
  }
  let parsed;
  try {
    parsed = JSON.parse(outBuf.toString('utf8'));
  } catch (e) {
    throw new Error('GATE FAILED: trace is not valid JSON: ' + e.message);
  }
  if (!parsed || !Array.isArray(parsed.traceEvents) || parsed.traceEvents.length === 0) {
    throw new Error('GATE FAILED: traceEvents missing or empty');
  }

  // --- write the Buffer verbatim (never a string), idempotent overwrite
  writeFileSync(TRACE_PATH, outBuf);
  t('trace written', { path: TRACE_PATH, bytes: outBuf.length });

  // --- GATE B: re-read from disk and re-validate, proving the artifact itself (not just memory)
  const onDisk = readFileSync(TRACE_PATH);
  const reparsed = JSON.parse(onDisk.toString('utf8'));
  const names = new Set(reparsed.traceEvents.map((e) => e.name));
  meta.marksPresent[MARK_START] = names.has(MARK_START);
  meta.marksPresent[MARK_END] = names.has(MARK_END);
  meta.traceEventsCount = reparsed.traceEvents.length;
  meta.traceByteSize = onDisk.length;
  meta.gate = {
    gunzipped: !!meta.streamDecompressed,
    headCheck: true,
    jsonParse: true,
    eventsFromDisk: reparsed.traceEvents.length,
  };
  const reqd = ['RunTask', 'UpdateLayoutTree', 'Layout', 'Paint', 'ProfileChunk', MARK_START, MARK_END];
  meta.grepCounts = Object.fromEntries(
    reqd.map((n) => [n, reparsed.traceEvents.filter((e) => e.name === n).length])
  );
  const missing = reqd.filter((n) => meta.grepCounts[n] === 0);
  if (missing.length) throw new Error('GATE FAILED: required events absent from artifact: ' + missing.join(', '));
  meta.topEventNames = Object.entries(
    reparsed.traceEvents.reduce((a, e) => { a[e.name] = (a[e.name] || 0) + 1; return a; }, {})
  ).sort((a, b) => b[1] - a[1]).slice(0, 30);
  t('verified from disk', { traceEvents: meta.traceEventsCount, counts: meta.grepCounts });

  meta.timeline = timeline;
  writeFileSync(META_PATH, JSON.stringify(meta, null, 2), 'utf8');

  console.log(JSON.stringify({
    tracePath: TRACE_PATH,
    bytes: meta.traceByteSize,
    traceEvents: meta.traceEventsCount,
    gate: meta.gate,
    grepCounts: meta.grepCounts,
    selectorUsed: meta.selectorUsed,
    cdpRejections: meta.cdpRejections,
    readPath: meta.readPath,
    marksPresent: meta.marksPresent,
  }, null, 2));
} catch (err) {
  meta.fatalError = String(err && err.stack ? err.stack : err);
  meta.timeline = timeline;
  try { writeFileSync(META_PATH, JSON.stringify(meta, null, 2), 'utf8'); } catch { /* ignore */ }
  console.error('CAPTURE FAILED:', meta.fatalError);
  process.exitCode = 1;
} finally {
  // kill only the browser this script launched
  await browser.close().catch(() => {});
}
