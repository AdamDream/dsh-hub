// Probe: first-open vs steady-state cost decomposition of the DSH Web GUI settings panel.
// Single browser. Read-only actions only: click 设置 (open) / close / settings nav tabs.
// NOTE: only ONE branch of this file is ever used per run; --mode=recon just dumps structure.
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/first-open-profile';
const URL_ = 'http://127.0.0.1:3080';
const RAW = ROOT + '/raw/';
fs.mkdirSync(RAW, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r3 = x => (x == null || !isFinite(x)) ? null : Math.round(x * 1000) / 1000;

function loadavg() { const l = os.loadavg(); return { l1: r3(l[0]), l5: r3(l[1]), l15: r3(l[2]), cpus: os.cpus().length }; }

// ---------------------------------------------------------------- init script
// Installed before any page script: React DevTools hook + react-dom adoption proof
// + stack-trap instrumentation (only fires when .stack is actually accessed) + profiler helpers.
const INIT = () => {
  const r3 = x => (x == null || !isFinite(x)) ? null : Math.round(x * 1000) / 1000;
  const H = {
    installedAt: Date.now(),
    injectCalls: 0,
    injectRenderers: [],
    onCommitCalls: 0,
    onPostCommitCalls: 0,
    commitLog: [],          // {t, mounted, total, fresh, dialogPresent, rootType}
    fiberSets: new WeakMap(),
    roots: new Set(),
    hookAdoptedBy: [],      // proof of adoption, filled by a getter trap on renderers
    errors: [],
  };
  window.__H = H;

  // stack trap: Error.prepareStackTrace is only invoked when `.stack` is accessed.
  H.stackTrapArmed = false;
  H.prepareStackTraceCalls = 0;
  H.stackTrapSamples = [];
  const origPrepare = Error.prepareStackTrace;
  Error.prepareStackTrace = function (err, frames) {
    H.prepareStackTraceCalls++;
    const out = [];
    for (let i = 0; i < frames.length && i < 12; i++) {
      try {
        out.push({
          fn: frames[i].getFunctionName() || null,
          file: (frames[i].getFileName() || '').split('/').pop(),
          file0: frames[i].getFileName() || null,
          line: frames[i].getLineNumber(),
          col: frames[i].getColumnNumber(),
        });
      } catch (e) { }
    }
    if (H.stackTrapSamples.length < 40) H.stackTrapSamples.push({ at: Date.now(), frames: out });
    return origPrepare ? origPrepare(err, frames) : out.map(f => `    at ${f.fn}`).join('\n');
  };
  // harness self-proof that the trap really fires on .stack access
  H.stackTrapSelfTest = () => {
    H.stackTrapArmed = true;
    const before = H.prepareStackTraceCalls;
    void (new Error('stack-trap-self-test').stack);
    return { before, after: H.prepareStackTraceCalls, fired: H.prepareStackTraceCalls > before };
  };
  H.captureStack = function (label) { const e = new Error(label); void e.stack; };

  // ---- the devtools hook react-dom looks for
  const hook = {
    renderers: new Map(),
    supportsFiber: true,
    supportsFlight: true,
    // react-dom calls inject(internals) once per renderer; it RETURNS an id.
    inject(internals) {
      H.injectCalls++;
      const id = H.injectCalls;
      hook.renderers.set(id, internals);
      const v = internals && internals.version;
      const rb = internals && internals.rendererPackageName;
      H.injectRenderers.push({ id, version: v, rendererPackageName: rb, hasOnCommitFiberRoot: typeof internals?.onCommitFiberRoot === 'function' });
      H.hookAdoptedBy.push({ id, version: v, via: 'inject()' });
      return id;
    },
    onCommitFiberRoot(rendererID, root, priorityLevel, didError) {
      H.onCommitCalls++;
      try { recordCommit(rendererID, root, 'commit'); } catch (e) { H.errors.push('commit:' + e.message); }
    },
    onPostCommitFiberRoot(rendererID, root) {
      H.onPostCommitCalls++;
      try { recordCommit(rendererID, root, 'postCommit'); } catch (e) { H.errors.push('post:' + e.message); }
    },
    onCommitFiberUnmount() { },
    checkDCE() { },
    setStrictMode() { },
    getFiberRoots(rendererID) { return H.roots; },
  };
  if (window.__NO_HOOK !== true) window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;

  // ---- fiber walker
  const TAG = { 0: 'FunctionComponent', 1: 'ClassComponent', 3: 'HostRoot', 5: 'HostComponent', 6: 'HostText', 7: 'Fragment', 10: 'ContextConsumer', 14: 'MemoComponent', 15: 'SimpleMemoComponent', 16: 'LazyComponent', 11: 'ForwardRef' };
  function typeName(f) {
    const t = f.type || f.elementType;
    if (t == null) return f.tag === 6 ? '#text' : 'unknown';
    if (typeof t === 'string') return t;
    if (typeof t === 'function') return t.displayName || t.name || 'anon';
    if (typeof t === 'object') return t.displayName || (t.render && (t.render.displayName || t.render.name)) || t.$$typeof?.toString().replace('Symbol(react.', '').replace(')', '') || 'obj';
    return String(t);
  }
  function domOf(f) { const s = f.stateNode; return (s && s.nodeType === 1) ? s : null; }
  function pathOf(el) {
    const parts = []; let n = el, d = 0;
    while (n && n.nodeType === 1 && d++ < 8) {
      let s = n.tagName.toLowerCase();
      const r = n.getAttribute && n.getAttribute('role'); if (r) s += `[role=${r}]`;
      const am = n.getAttribute && n.getAttribute('aria-modal'); if (am) s += `[aria-modal=${am}]`;
      parts.unshift(s);
      if (n === document.body) break;
      n = n.parentElement;
    }
    return parts.join('>');
  }
  function walk(root) {
    const nodes = [];
    const stack = [root.current];
    while (stack.length) {
      const f = stack.pop();
      if (!f || typeof f !== 'object') continue;
      nodes.push(f);
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
      if (nodes.length > 120000) break;
    }
    return nodes;
  }
  const DIALOG_SEL = 'div[role=dialog][aria-modal=true]';
  function recordCommit(rendererID, root, kind) {
    if (kind !== 'commit') return; // only count real commits once
    const t = performance.now();
    const nodes = walk(root);
    let prev = H.fiberSets.get(root);
    let fresh = 0;
    if (prev) { for (const f of nodes) if (!prev.has(f)) fresh++; }
    else fresh = nodes.length;
    const set = new Set(nodes);
    H.fiberSets.set(root, set);
    const dialog = document.querySelector(DIALOG_SEL);
    let dialogFiber = null;
    if (dialog) {
      for (const key in dialog) if (key.startsWith('__reactFiber$')) { dialogFiber = dialog[key]; break; }
    }
    let dialogSubtree = null;
    if (dialogFiber) { dialogSubtree = walk({ current: dialogFiber }).length; }
    let fnCount = 0; for (const f of nodes) if (typeof f.type === 'function') fnCount++;
    const counts = {};
    for (const f of nodes) { if (typeof f.type === 'function') { const nm = typeName(f); counts[nm] = (counts[nm] || 0) + 1; } }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12);
    H.commitLog.push({
      t: r3(t), n: H.commitLog.length, rendererID,
      total: nodes.length, fresh, fnCount, dialog: !!dialog, dialogSubtree,
      topTypes: top,
      hasUsage: nodes.some(f => /Usage|Heatmap/i.test(typeName(f))),
    });
  }

  // ---- rAF frame timeline
  H.raf = []; H.rafOn = false;
  (function loop(t) { if (H.rafOn) H.raf.push(r3(t)); requestAnimationFrame(loop); })(0);

  // ---- long tasks
  H.longtasks = [];
  try { new PerformanceObserver(l => l.getEntries().forEach(e => H.longtasks.push({ start: r3(e.startTime), dur: r3(e.duration), name: e.name }))).observe({ entryTypes: ['longtask'] }); } catch (e) { }

  // ---- mutation timeline (for "settled" detection)
  H.muts = [];
  H.mutOn = false;
  try {
    new MutationObserver(recs => { if (!H.mutOn) return; for (const r of recs) H.muts.push({ t: r3(performance.now()), type: r.type, target: r.target.nodeName }); }).observe(document, { childList: true, subtree: true, attributes: true, characterData: true });
  } catch (e) { }

  // ---- element census helpers
  H.census = function () {
    const all = document.getElementsByTagName('*');
    return { nodes: all.length, svg: document.getElementsByTagName('svg').length, rect: document.getElementsByTagName('rect').length, path: document.getElementsByTagName('path').length, metaThemeColor: document.querySelectorAll('meta[name=theme-color]').length, dialogs: document.querySelectorAll(DIALOG_SEL).length };
  };
  H.dialogInfo = function () {
    const d = document.querySelector(DIALOG_SEL);
    if (!d) return null;
    const anc = []; let n = d, i = 0;
    while (n && n !== document.documentElement && i++ < 12) { anc.push({ path: pathOf(n), cls: (n.className || '').toString().slice(0, 60), fibers: null }); n = n.parentElement; }
    // fiber identity + subtree size for the dialog's ancestor chain (DOM -> fiber -> count)
    let fibers = [];
    let node = d;
    while (node && node.nodeType === 1) {
      for (const key in node) if (key.startsWith('__reactFiber$')) { fibers.push({ dom: pathOf(node), fiber: key, subtreeFn: countFn(node[key]), subtreeAll: walk({ current: node[key] }).length }); break; }
      if (node === document.body) break;
      node = node.parentElement;
    }
    return {
      rect: (r => ({ w: Math.round(r.width), h: Math.round(r.height) })((d.getBoundingClientRect()))),
      firstChildClasses: d.firstElementChild ? (d.firstElementChild.className || '').toString().slice(0, 100) : null,
      ancestors: anc, fibers,
      tabs: [...d.querySelectorAll('[role=tab],button')].map(b => (b.innerText || '').trim()).filter(Boolean).slice(0, 40),
      textLen: (d.innerText || '').length,
    };
  };
  function countFn(f) { let c = 0; const st = [f]; while (st.length) { const x = st.pop(); if (!x) continue; if (typeof x.type === 'function') c++; if (x.sibling) st.push(x.sibling); if (x.child) st.push(x.child); } return c; }
  H.findByName = function (re) {
    const out = [];
    const seen = new Set();
    for (const root of H.roots) {
      const nodes = walk(root);
      for (const f of nodes) {
        const nm = typeName(f);
        if (re.test(nm) && !seen.has(nm + '/' + f.key)) {
          seen.add(nm + '/' + f.key);
          const d = domOf(f);
          out.push({ name: nm, tag: TAG[f.tag] || String(f.tag), hasDom: !!d, domPath: d ? pathOf(d) : null, subtreeAll: walk({ current: f }).length, subtreeFn: countFn(f) });
          if (out.length > 60) return out;
        }
      }
    }
    return out;
  };
  H.usageProbe = function () {
    const keys = ['usage', 'Usage', 'heatmap', 'Heatmap', 'card', 'Card', '用量'];
    const dom = [...document.querySelectorAll('*')].filter(e => { const c = (e.className || '').toString(); return keys.some(k => c.includes(k)); }).slice(0, 25).map(e => ({ tag: e.tagName, cls: (e.className || '').toString().slice(0, 70), path: pathOf(e), rect: (r => ({ w: Math.round(r.width), h: Math.round(r.height) }))(e.getBoundingClientRect()), rects: e.getElementsByTagName('rect').length })).filter(x => x.rect.w > 0);
    const txt = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && /用量|Usage/i.test(e.innerText || '')).slice(0, 10).map(e => ({ tag: e.tagName, txt: (e.innerText || '').slice(0, 50), path: pathOf(e) }));
    return { dom, txt };
  };
};
// ---------------------------------------------------------------- end init script

const mode = process.argv[2] || 'full';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-precise-memory-info', '--disable-field-trial-config'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);

const net = [];
page.on('requestfinished', async r => { try { const t = r.timing(); net.push({ url: r.url().replace(URL_, '').split('?')[0], method: r.method(), ms: r3(t.responseEnd - t.requestStart), status: r.response()?.status() }); } catch { } });
page.on('requestfailed', r => net.push({ url: r.url().replace(URL_, ''), failed: r.failure()?.errorText }));
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => consoleErrors.push('PAGEERROR ' + String(e).slice(0, 200)));

await page.addInitScript(INIT);
if (process.env.NO_HOOK === '1') await page.addInitScript(() => { window.__NO_HOOK = true; });

const meta = { startedAt: new Date().toISOString(), url: URL_, viewport: '1440x900', headless: true, loadBefore: loadavg(), pid10806: true };

await cdp.send('Performance.enable');
await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });

// wait for the app to be interactive (settings button present)
await page.waitForSelector('button:has-text("设置")', { timeout: 60000 });
const tReady = Date.now();
// let the page reach a settled "steady state" for the click (this is the fresh-page precondition)
await sleep(6000);

const adoption = await page.evaluate(() => ({
  hookPresent: !!window.__REACT_DEVTOOLS_GLOBAL_HOOK__,
  injectCalls: window.__H.injectCalls,
  injectRenderers: window.__H.injectRenderers,
  adoptedBy: window.__H.hookAdoptedBy,
  onCommitCalls: window.__H.onCommitCalls,
  onPostCommitCalls: window.__H.onPostCommitCalls,
  stackTrapSelfTest: window.__H.stackTrapSelfTest(),
  rootsSeen: window.__H.roots.size,
  reactDomKeys: Object.keys(window).filter(k => /react/i.test(k)).slice(0, 10),
  bootRev: globalThis.__DSH_BOOT__?.rev,
}));

// ---------- helpers that run in-page
const OPEN = async (label) => {
  const t0 = await page.evaluate(() => { const H = window.__H; H.rafOn = true; H.mutOn = true; H.muts = []; H.raf = []; H.longtasks = []; H.commitLog = []; H.onCommitCalls = 0; H.onPostCommitCalls = 0; H.mark = { click: null, firstDialog: null, quiet: null }; return performance.now(); });
  const before = await page.evaluate(() => ({ census: window.__H.census(), url: location.href }));
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); // 100us
  await cdp.send('Profiler.start');
  const tClickWall = Date.now();
  await page.evaluate(() => { window.__H.markClick = performance.now(); });
  await page.locator('button:has-text("设置")').first().click({ timeout: 5000 });

  // wait for the dialog, recording when it appears
  let appeared = false;
  try { await page.waitForSelector('div[role=dialog][aria-modal=true]', { timeout: 15000 }); appeared = true; } catch { }
  const tDialogWall = Date.now();
  const tDialogPerf = await page.evaluate(() => { window.__H.mark.firstDialog = performance.now(); return window.__H.mark.firstDialog; });

  // "settled": no DOM mutation for QUIET ms
  const QUIET = 500, MAXW = 12000;
  let settledAt = null;
  if (appeared) {
    settledAt = await page.evaluate(async ({ QUIET, MAXW }) => {
      const H = window.__H;
      const start = performance.now();
      let last = performance.now(), lastCount = H.muts.length;
      while (performance.now() - start < MAXW) {
        await new Promise(r => setTimeout(r, 100));
        if (H.muts.length !== lastCount) { lastCount = H.muts.length; last = performance.now(); }
        else if (performance.now() - last >= QUIET) break;
      }
      H.mark.quiet = performance.now();
      return H.mark.quiet;
    }, { QUIET, MAXW });
  }
  const tSettleWall = Date.now();
  const prof = await cdp.send('Profiler.stop');
  const after = await page.evaluate(() => {
    const r3 = x => (x == null || !isFinite(x)) ? null : Math.round(x * 1000) / 1000;
    const H = window.__H; H.rafOn = false; H.mutOn = false;
    const raf = H.raf.slice();
    const d = raf.slice(1).map((t, i) => r3(t - raf[i]));
    return {
      census: H.census(), url: location.href,
      commits: H.commitLog.slice(), onCommitCalls: H.onCommitCalls, onPostCommitCalls: H.onPostCommitCalls,
      marks: H.mark, setPerf: performance.now(),
      mutCount: H.muts.length, mutFirst: H.muts.slice(0, 5), mutLast: H.muts.slice(-5),
      rafN: raf.length, raf: d,
      longtasks: H.longtasks.slice(),
      dialog: H.dialogInfo(),
      byName: H.findByName(/^(Settings|SettingsDialog|SettingsPanel|ThemeProvider|ThemePresenter|Usage|UsageCard|Heatmap|Wallpaper|App|Shell|Layout|PluginInventory|SettingsGeneral|SettingsModels|SettingsPlugins)/),
      usage: H.usageProbe(),
      metaThemeColor: [...document.querySelectorAll('meta[name=theme-color]')].map(m => m.content),
      themeColorMetaNodes: document.querySelectorAll('meta[name=theme-color]').length,
      bodyTokens: document.body.style.length,
      stackTrap: { calls: H.prepareStackTraceCalls, samples: H.stackTrapSamples.slice(0, 12) },
      errors: H.errors.slice(0, 10),
    };
  });
  return { label, tPerfClick: t0, tDialogPerf, settledAt, before, after, prof, wall: { click: tClickWall, dialog: tDialogWall, settle: tSettleWall, toDialog: tDialogWall - tClickWall, toSettle: tSettleWall - tClickWall } };
};

const results = { meta, adoption, phases: [], net: [], consoleErrors };
results.phases.push(await OPEN('first-open'));
// close, then reopen for steady-state comparison
try { await page.keyboard.press('Escape'); } catch { }
await sleep(1500);
let closed = !(await page.locator('div[role=dialog][aria-modal=true]').count());
if (!closed) {
  const l = page.locator('div[role=dialog][aria-modal=true] button[aria-label*="关闭"], div[role=dialog][aria-modal=true] button[aria-label*="Close"]').first();
  if (await l.count()) { try { await l.click({ timeout: 3000 }); } catch { } }
}
await sleep(2500);
results.reopenClosedBy = !(await page.locator('div[role=dialog][aria-modal=true]').count());
if (closed || results.reopenClosedBy) {
  results.phases.push(await OPEN('second-open'));
}
results.loadAfter = loadavg();
results.net = net;

const slim = (o) => {
  const p = o.prof.profile;
  const keep = ['nodes', 'startTime', 'endTime', 'samples', 'timeDeltas'];
  const out = { label: o.label, wall: o.wall, marks: o.after.marks, onCommitCalls: o.after.onCommitCalls, onPostCommitCalls: o.after.onPostCommitCalls, commitCount: o.after.commits.length, commits: o.after.commits, censusBefore: o.before.census, censusAfter: o.after.census, dialog: o.after.dialog, byName: o.after.byName, usage: o.after.usage, metaThemeColor: o.after.metaThemeColor, themeColorMetaNodes: o.after.themeColorMetaNodes, bodyTokens: o.after.bodyTokens, mutCount: o.after.mutCount, mutFirst: o.after.mutFirst, mutLast: o.after.mutLast, rafN: o.after.rafN, longtasks: o.after.longtasks, stackTrap: o.after.stackTrap, errors: o.after.errors, netInWindow: net.slice() };
  return out;
};
const out = { meta, adoption, reopenClosedBy: results.reopenClosedBy, loadAfter: results.loadAfter, phases: results.phases.map(slim), consoleErrors, rafSeries: results.phases.map(p => ({ label: p.label, raf: p.after.raf })) };
fs.writeFileSync(RAW + 'probe-summary.json', JSON.stringify(out, null, 2));
results.phases.forEach(p => fs.writeFileSync(RAW + `cpuprofile-${p.label}.json`, JSON.stringify(p.prof)));

console.log('=== ADOPTION ===');
console.log(JSON.stringify(adoption, null, 2));
console.log('=== WALL (ms) ===');
for (const p of out.phases) console.log(p.label, JSON.stringify(p.wall), 'toDialog', p.wall.toDialog, 'toSettle', p.wall.toSettle);
console.log('=== COMMITS ===');
for (const p of out.phases) console.log(p.label, 'commits', p.commitCount, 'onCommit', p.onCommitCalls, 'onPost', p.onPostCommitCalls, 'mut', p.mutCount, 'raf', p.rafN, 'longtasks', p.longtasks.length);
console.log('=== DIALOG ===');
for (const p of out.phases) console.log(p.label, JSON.stringify(p.dialog).slice(0, 2000));
console.log('=== BY NAME ===');
for (const p of out.phases) console.log(p.label, JSON.stringify(p.byName).slice(0, 2500));
console.log('=== USAGE ===');
for (const p of out.phases) console.log(p.label, JSON.stringify(p.usage).slice(0, 1200));
console.log('=== STACKTRAP ===');
for (const p of out.phases) console.log(p.label, JSON.stringify(p.stackTrap).slice(0, 1200));
console.log('=== CONSENT/ERR ===');
console.log(JSON.stringify(out.consoleErrors).slice(0, 800));

await browser.close();
