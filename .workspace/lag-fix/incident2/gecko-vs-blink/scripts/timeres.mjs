#!/usr/bin/env node
/*
 * timeres.mjs — measure each engine's performance.now() resolution.
 * Necessary because Gecko clamps content timers to 1 ms by default while Blink
 * reports 0.1 ms: a naive cross-engine "JS self-time" ratio can then be pure
 * quantisation artefact rather than engine cost.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { launchFirefox, connectBidi } from './lib/ff.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const PLAYWRIGHT_ROOT = '/home/CNS2026495165/playwright_scratch';
const arg = (n, d = null) => { const h = process.argv.find((a) => a === `--${n}` || a.startsWith(`--${n}=`)); return !h ? d : (h.includes('=') ? h.slice(h.indexOf('=') + 1) : true); };
const ENGINE = String(arg('engine', 'chromium'));
const PORT = Number(arg('port', 18960));
const FINE = String(arg('fineclock', '0')) === '1';

const EXPR = `(function(){
  var reads = [], busy = [];
  for (var j = 0; j < 3000; j++) { var a = performance.now(), b = performance.now(); if (b > a) reads.push(+(b - a).toFixed(6)); }
  for (var i = 0; i < 300; i++) { var t0 = performance.now(), n = 0; while (performance.now() - t0 < 0.35) { n++; } busy.push(+(performance.now() - t0).toFixed(6)); }
  busy.sort(function(x,y){return x-y});
  var uniq = Array.from(new Set(reads)).sort(function(x,y){return x-y});
  return JSON.stringify({
    readSamples: reads.length,
    distinctReadDeltas: uniq.slice(0, 12),
    minNonZeroReadDelta: uniq.length ? uniq[0] : null,
    busySorted: busy.slice(0, 10),
    busyMin: busy[0], busyMedian: busy[Math.floor(busy.length/2)],
    target: 0.35
  });
})()`;

const out = { schema: 'gvb.timeres/1', engine: ENGINE, fineclock: FINE, at: new Date().toISOString() };
if (ENGINE === 'firefox') {
  const extraPrefs = FINE ? ['user_pref("privacy.reduceTimerPrecision", false);'] : [];
  const inst = await launchFirefox({ tag: `timeres${FINE ? '-fine' : ''}`, port: PORT, dpr: 1, logDir: path.join(ROOT, 'logs'), extraPrefs });
  const bidi = await connectBidi(inst);
  await bidi.newSession({ alwaysMatch: {} });
  const ctx = await bidi.createContext('tab');
  await bidi.navigate(ctx, 'data:text/html,<title>t</title>');
  await new Promise((r) => setTimeout(r, 1200));
  out.result = JSON.parse(await bidi.evaluate(ctx, EXPR, { timeoutMs: 90000 }));
  out.userJs = fs.readFileSync(path.join(inst.profileDir, 'user.js'), 'utf8');
  await bidi.endSession().catch(() => { }); bidi.close();
  out.exit = await inst.close();
} else {
  const require = createRequire(path.join(PLAYWRIGHT_ROOT, 'package.json'));
  const { chromium } = require('playwright');
  const profile = '/tmp/gvb-chrome-timeres';
  fs.rmSync(profile, { recursive: true, force: true }); fs.mkdirSync(profile, { recursive: true });
  const ctx = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto('data:text/html,<title>t</title>');
  out.result = await page.evaluate(EXPR);
  await ctx.close();
}
const of = path.join(ROOT, 'raw', `timeres-${ENGINE}${FINE ? '-fineclock' : ''}.json`);
if (typeof out.result === 'string') out.result = JSON.parse(out.result);
fs.writeFileSync(of, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
console.log('-> ' + of);
process.exit(0);
