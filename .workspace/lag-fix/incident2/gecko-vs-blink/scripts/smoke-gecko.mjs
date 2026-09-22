#!/usr/bin/env node
/* Gecko smoke test: can we launch snap Firefox headless, drive it over BiDi,
 * load the minimal page from file://, and read page state back? */
import path from 'node:path';
import { launchFirefox, connectBidi, ffVersion, hostFacts, FF_BIN } from './lib/ff.mjs';

const PAGE = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/minimal-page/minimal.html';
const LOGDIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/gecko-vs-blink/logs';

const out = { binary: FF_BIN, version: await ffVersion(), host: hostFacts(), steps: [] };
const step = (name, ok, detail) => { out.steps.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`); };

let inst = null, bidi = null;
try {
  inst = await launchFirefox({ tag: 'smoke', port: 18831, logDir: LOGDIR, dpr: 1 });
  step('launch', true, { pid: inst.pid, wsUrl: inst.wsUrl, profile: inst.profileDir });
  bidi = await connectBidi(inst);
  step('bidi-connect', true, inst.wsUrl);
  const sess = await bidi.newSession({ alwaysMatch: {} });
  step('session.new', true, sess && sess.sessionId ? `sessionId=${sess.sessionId}` : `no sessionId (${bidi.lastError || 'ok'})`);

  const ctx = await bidi.createContext('tab');
  step('browsingContext.create', !!ctx, ctx);

  const url = 'file://' + PAGE + '?n=64&impl=dom&pos=transform&willchange=1&follower=1&tray=height&rate=1&hud=0&alwaysloop=1';
  const nav = await bidi.navigate(ctx, url);
  step('navigate', !!nav, nav && nav.navigation);

  const state = await bidi.evaluate(ctx, `JSON.stringify({
    dpr: window.devicePixelRatio,
    inner: [window.innerWidth, window.innerHeight],
    ready: !!(window.MMP && window.MMP.ready),
    cards: document.getElementsByTagName('*').length,
    hasMC: !!window.__MC,
    ua: navigator.userAgent
  })`);
  step('evaluate/page-state', true, JSON.parse(state));

  // setViewport devicePixelRatio support check (BiDi-level DPR switch)
  let vpOk = null;
  try {
    const ret = await bidi.setViewport(ctx, { width: 1280, height: 800, devicePixelRatio: 2 });
    const after = await bidi.evaluate(ctx, 'window.devicePixelRatio');
    vpOk = { returned: ret, dprAfter: after };
  } catch (e) { vpOk = { error: e.message, bidiError: e.bidiError }; }
  step('setViewport(devicePixelRatio=2)', vpOk.dprAfter === 2, vpOk);

  // short rAF sample to prove the frame clock ticks in headless Gecko
  const sample = await bidi.evaluate(ctx, `new Promise(function(res){
    if (window.MMP && window.MMP.reset) window.MMP.reset();
    var t0 = performance.now();
    setTimeout(function(){
      var f = (window.MMP && window.MMP.frames) || [];
      var iv = []; for (var i=1;i<f.length;i++) iv.push(f[i]-f[i-1]);
      iv.sort(function(a,b){return a-b});
      res(JSON.stringify({frames: f.length, windowMs: performance.now()-t0,
        p50: iv.length?+iv[Math.floor(iv.length*0.5)].toFixed(2):null,
        max: iv.length?+iv[iv.length-1].toFixed(2):null,
        longtaskSupported: !('longtaskUnsupported' in window.MMP ? true : false),
        longtasksSeen: (window.MMP&&window.MMP.longtasks||[]).length,
        loafSeen: (window.MMP&&window.MMP.loafs||[]).length}));
    }, 3000);
  })`, { timeoutMs: 30000 });
  step('raf-sample-3s', true, JSON.parse(sample));

  console.log('\n--- GFX lines ---');
  console.log(inst.gfxLines().join('\n'));
} catch (e) {
  step('EXCEPTION', false, e.message + (e.info ? '\n' + JSON.stringify(e.info, null, 1) : ''));
} finally {
  if (bidi) { try { await bidi.endSession(); } catch { } bidi.close(); }
  if (inst) { const ex = await inst.close(); console.log('firefox exit:', JSON.stringify(ex)); }
}
console.log('\nRESULT ' + JSON.stringify(out, null, 1));
process.exit(0);
