#!/usr/bin/env node
/*
 * calibrate.mjs — positive controls, so a "no difference" result is interpretable.
 *
 *   node scripts/calibrate.mjs --engine=chromium|firefox [--port=18850]
 *
 * Control 1 (JANK DETECTABILITY): deliberately inject ~35 ms of busy-work per
 *   16 ms tick for 50 ticks. If the frame-interval metric cannot show frames
 *   >50 ms here, the whole comparison would be blind and any "smooth" reading
 *   would be meaningless.
 * Control 2 (LONG TASK / LoAF SUPPORT): run three 200 ms synchronous blocks and
 *   count LongTask / LoAF entries. Gecko accepting observe() without ever
 *   emitting an entry is NOT support — this control distinguishes the two.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { launchFirefox, connectBidi, ffVersion } from './lib/ff.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const MINIMAL = path.resolve(HERE, '../../minimal-page/minimal.html');
const PLAYWRIGHT_ROOT = '/home/CNS2026495165/playwright_scratch';
const INSTRUMENT = fs.readFileSync(path.join(HERE, 'lib', 'instrument.js'), 'utf8');
const asFn = (c) => `() => {\n${c}\n}`;
const asInit = (c) => `(${asFn(c)})();`;

const arg = (n, d = null) => { const h = process.argv.find((a) => a === `--${n}` || a.startsWith(`--${n}=`)); return !h ? d : (h.includes('=') ? h.slice(h.indexOf('=') + 1) : true); };
const ENGINE = String(arg('engine', 'chromium'));
const PORT = Number(arg('port', 18850));
const URL = 'file://' + MINIMAL + '?n=0&impl=dom&follower=0&alwaysloop=1&hud=0';

const REPORT = { schema: 'gvb.calibration/1', engine: ENGINE, at: new Date().toISOString(), loadavg: fs.readFileSync('/proc/loadavg', 'utf8').trim() };

const EXPR_JANK = `(function(){
  window.__CALBUSY = function(ms){ var t0=performance.now(); var x=0; while(performance.now()-t0<ms){ x+=Math.sqrt(x+1); } return x; };
  window.__MC.reset();
  return new Promise(function(res){
    var n=0, ticks=0, t0=performance.now();
    var iv=setInterval(function(){
      ticks++;
      window.__CALBUSY(35);            /* 35ms of main-thread work per 16ms tick */
      if(++n>=50){ clearInterval(iv);
        var f=window.__MC.frames||[], ivs=[];
        for(var i=1;i<f.length;i++) ivs.push(f[i]-f[i-1]);
        ivs.sort(function(a,b){return a-b});
        res(JSON.stringify({ ticks:ticks, elapsedMs:+(performance.now()-t0).toFixed(1),
          frameN:ivs.length, p50:ivs.length?+ivs[Math.floor(ivs.length*0.5)].toFixed(2):null,
          max:ivs.length?+ivs[ivs.length-1].toFixed(2):null,
          over50:ivs.filter(function(v){return v>50}).length }));
      }
    }, 16);
  });
})()`;

const EXPR_LONGTASK = `(function(){
  window.__MC.reset();
  return new Promise(function(res){
    var n=0;
    function block(){ window.__CALBUSY(200); }   /* 3 x 200ms synchronous blocks */
    block();
    setTimeout(function(){ block();
      setTimeout(function(){ block();
        setTimeout(function(){ res(JSON.stringify({
          longtaskSupported: !!window.__MC.support.longtask, longtaskErr: window.__MC.support.longtaskErr||null,
          longtaskCount: (window.__MC.longtasks||[]).length,
          longtaskDurs: (window.__MC.longtasks||[]).map(function(e){return +e.dur.toFixed(1)}),
          loafSupported: !!window.__MC.support.loaf, loafErr: window.__MC.support.loafErr||null,
          loafCount: (window.__MC.loafs||[]).length,
          loafDurs: (window.__MC.loafs||[]).map(function(e){return +e.dur.toFixed(1)}),
          hasPO: !!window.__MC.support.hasPO })); }, 400);
      }, 400);
    }, 400);
  });
})()`;

async function main() {
  if (ENGINE === 'firefox') {
    const inst = await launchFirefox({ tag: 'calib', port: PORT, dpr: 1, logDir: path.join(ROOT, 'logs') });
    REPORT.binary = (await ffVersion()).split('\n')[0];
    REPORT.pid = inst.pid;
    const bidi = await connectBidi(inst);
    await bidi.newSession({ alwaysMatch: {} });
    const ctx = await bidi.createContext('tab');
    await bidi.addPreloadScript(asFn(INSTRUMENT), [ctx]);
    await bidi.navigate(ctx, URL);
    for (let i = 0; i < 40; i++) { if (await bidi.evaluate(ctx, '!!window.__MC').catch(() => false)) break; await new Promise(r => setTimeout(r, 250)); }
    await new Promise(r => setTimeout(r, 1200));
    REPORT.jankControl = JSON.parse(await bidi.evaluate(ctx, EXPR_JANK, { timeoutMs: 90000 }));
    REPORT.supportControl = JSON.parse(await bidi.evaluate(ctx, EXPR_LONGTASK, { timeoutMs: 90000 }));
    await bidi.endSession().catch(() => { }); bidi.close();
    REPORT.exit = await inst.close();
  } else {
    const require = createRequire(path.join(PLAYWRIGHT_ROOT, 'package.json'));
    const { chromium } = require('playwright');
    const profile = '/tmp/gvb-chrome-calib';
    fs.rmSync(profile, { recursive: true, force: true }); fs.mkdirSync(profile, { recursive: true });
    const ctx = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, args: ['--no-first-run'] });
    await ctx.addInitScript({ content: asInit(INSTRUMENT) });
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForFunction('!!window.__MC', null, { timeout: 15000 }).catch(() => { });
    await new Promise(r => setTimeout(r, 1200));
    REPORT.browserVersion = await page.evaluate('navigator.userAgent');
    try {
      const cdp = await ctx.newCDPSession(page);
      REPORT.cdpBrowserVersion = (await cdp.send('Browser.getVersion')).product;
    } catch (e) { REPORT.cdpBrowserVersion = 'err: ' + e.message; }
    REPORT.jankControl = await page.evaluate(EXPR_JANK);
    REPORT.supportControl = await page.evaluate(EXPR_LONGTASK);
    await ctx.close();
  }
  REPORT.host = { cpus: os.cpus().length, loadavgAfter: fs.readFileSync('/proc/loadavg', 'utf8').trim() };
  const out = path.join(ROOT, 'raw', `calibration-${ENGINE}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(REPORT, null, 1));
  console.log(JSON.stringify(REPORT, null, 1));
  console.log('-> ' + out);
}

main().then(() => process.exit(0)).catch((e) => { console.error('FAIL ' + e.message); process.exit(1); });
