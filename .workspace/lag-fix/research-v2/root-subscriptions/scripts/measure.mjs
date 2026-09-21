/*
 * root-subscriptions measurement harness.
 *
 * Question: which subscription of SettingsRoot makes it render while its parent
 * RootEntry does not, under an active session event stream?
 *
 * Design notes
 *  - ONE browser instance, one page, hook + instrumentation installed at document-start.
 *  - Every window >= 60s, closed with an explicit mark, ALL windows kept (valid or not).
 *  - Two panels states x a closed control x one offline control, plus the
 *    "open on General -> Models -> back to General" replay that the previous line
 *    could not explain.
 *  - Discipline: only local, reversible UI actions (open/close settings, switch
 *    settings nav tab, CDP network offline toggle). No save/apply/delete/model
 *    switch/usage refresh. Never touches product files.
 */
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const URL_ = 'http://127.0.0.1:3080';
const DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/root-subscriptions';
const OUT = path.join(DIR, 'raw');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argOf = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const WINDOW_MS = Number(argOf('--window', '60000'));
const TAG = argOf('--tag', 'main');
const STATES = (argOf('--states', 'general,models,back-general,models-again,closed,offline')).split(',');

// ------------------------------------------------------------------ host facts
function hostPid() {
  try {
    for (const p of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
      try {
        const cmd = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8');
        if (cmd.includes('dsh') && cmd.includes('web')) {
          const parts = cmd.split('\0').filter(Boolean);
          const st = fs.readFileSync(`/proc/${p}/stat`, 'utf8').split(' ');
          return { pid: Number(p), cmdline: parts.join(' '), starttimeTicks: Number(st[21]) };
        }
      } catch { }
    }
  } catch { }
  return null;
}
function browserCensus(selfPattern) {
  const out = { headlessShellProcs: 0, distinctUserDataDirs: [], otherHarnessProcs: [] };
  try {
    const dirs = new Set();
    for (const p of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
      let cmd;
      try { cmd = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8'); } catch { continue; }
      if (cmd.includes('headless_shell')) {
        out.headlessShellProcs++;
        const m = cmd.match(/--user-data-dir=(\S+)/);
        if (m) dirs.add(m[1]);
      } else if (/node\b/.test(cmd) && (/\.mjs/.test(cmd) || /measure/.test(cmd)) && !selfPattern.includes(path.basename(cmd.split('\0')[0]))) {
        const first = cmd.split('\0').filter(Boolean)[0] || '';
        if (!first.includes('dsh')) out.otherHarnessProcs.push({ pid: Number(p), cmd: cmd.split('\0').filter(Boolean).slice(0, 4).join(' ') });
      }
    }
    out.distinctUserDataDirs = [...dirs];
    out.distinctBrowserInstances = dirs.size;
  } catch { }
  return out;
}
function readLock() {
  try { return fs.readFileSync('/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock/owner.txt', 'utf8'); }
  catch { return null; }
}

async function sessionList() {
  const rpcId = crypto.randomUUID();
  const res = await fetch(`${URL_}/api/session.list`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method: 'session.list', payload: {} }),
  });
  const body = await res.json();
  if (!body?.result?.ok) return { ok: false, http: res.status };
  const items = body.result.value.items;
  return {
    ok: true, items: items.length,
    topLevel: items.filter((x) => !x.parentSessionId).length,
    subagents: items.filter((x) => x.parentSessionId).length,
    running: items.filter((x) => x.running).length,
  };
}

const report = {
  meta: {
    tag: TAG, startedAt: new Date().toISOString(), windowMs: WINDOW_MS, states: STATES,
    target: URL_, hostPid: hostPid(), hostPidExpected: 1390375,
    lockAtStart: readLock(), censusAtStart: browserCensus('measure.mjs'),
    node: process.version, ua: null,
    initScriptSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(DIR, 'scripts/lib-init-slots.js'))).digest('hex'),
  },
  boot: null, premise: null, windows: [], consoleErrors: [], wsSockets: [], notes: [],
};

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion', '--enable-precise-memory-info'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push({ t: Date.now(), text: m.text().slice(0, 300) }); });
page.on('pageerror', (e) => report.consoleErrors.push({ t: Date.now(), text: 'PAGEERROR ' + String(e).slice(0, 300) }));
const socks = [];
page.on('websocket', (s) => {
  const e = { url: s.url(), frames: 0, byType: {} };
  s.on('framereceived', (d) => {
    e.frames++;
    try {
      const j = JSON.parse(typeof d.payload === 'string' ? d.payload : '');
      const t = j?.payload?.type ?? j?.type ?? 'unknown';
      e.byType[t] = (e.byType[t] || 0) + 1;
    } catch { e.byType.unparsed = (e.byType.unparsed || 0) + 1; }
  });
  socks.push(e);
});
await page.addInitScript({ path: path.join(DIR, 'scripts/lib-init-slots.js') });

await page.goto(URL_, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000);
report.boot = await page.evaluate(() => {
  const b = window.__DSH_BOOT__;
  const want = ['@deepseek-ai/dsh-client-ui-settings-general', '@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-sidebar', '@deepseek-ai/dsh-client-locale'];
  const picked = {};
  if (b?.entries) for (const e of b.entries) if (want.includes(e.id)) picked[e.id] = e.rev;
  return { rev: b?.rev, entryCount: b?.entries?.length, entries: picked };
});
report.premise = await page.evaluate(() => window.__SR__.probe());
report.meta.ua = report.premise.ua;

// ------------------------------------------------------------------- helpers
const panelCount = () => page.locator('div[role="dialog"][aria-modal="true"]').count();
async function openSettings() {
  if (await panelCount() > 0) return { alreadyOpen: true };
  await page.locator('button[aria-haspopup="dialog"]').first().click({ timeout: 8000 });
  await page.waitForTimeout(2000);
  return { alreadyOpen: false, panelNodes: await panelCount() };
}
async function closeSettings() {
  if (await panelCount() === 0) return { alreadyClosed: true };
  await page.keyboard.press('Escape');
  await page.waitForTimeout(2000);
  return { alreadyClosed: false, panelNodes: await panelCount() };
}
async function activeSection() {
  return page.evaluate(() => {
    const cur = document.querySelector('div[role="dialog"][aria-modal="true"] nav button[aria-current="true"]');
    return cur ? (cur.innerText || '').trim().slice(0, 40) : null;
  });
}
async function selectSection(kind) {
  const before = await activeSection();
  const want = kind === 'models' ? /模型|Models/i : /通用|General/i;
  const tabs = page.locator('div[role="dialog"][aria-modal="true"] nav button');
  const n = await tabs.count();
  for (let i = 0; i < n; i++) {
    const t = (await tabs.nth(i).innerText()).trim();
    if (want.test(t)) {
      await tabs.nth(i).click({ timeout: 6000 });
      await page.waitForTimeout(2000);
      return { clicked: t, before, after: await activeSection() };
    }
  }
  return { error: 'section not found', before, available: n };
}
const setOffline = (on) => cdp.send('Network.emulateNetworkConditions', { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

async function slice(fromCommit, toCommit) {
  return page.evaluate(({ f, t }) => window.__SR__.range({ fromCommit: f, toCommit: t }), { f: fromCommit, t: toCommit });
}

function summarize(name, w, sl) {
  const commits = sl.commits;
  const withTarget = commits.filter((c) => c.target);
  const tgtId = withTarget.filter((c) => c.target.id);
  const tgtPw = withTarget.filter((c) => c.target.pw);
  const panelOpen = withTarget.filter((c) => c.target.hook0 === true);
  const selfDriven = withTarget.filter((c) => c.target.id && c.chain && c.chain[1] && c.chain[1].pw === false);
  const parentDriven = withTarget.filter((c) => c.target.id && c.chain && c.chain[1] && c.chain[1].pw === true);

  // selector records: one per useSelector call site per render
  const sel = sl.selCalls;
  const selByStore = {};
  for (const s of sel) {
    const b = selByStore[s.store] ||= { n: 0, rawChanged: 0, rawSame: 0, selChanged: 0, selSame: 0, eqUndefined: 0, eqProvided: 0, lenHist: {} };
    b.n++;
    if (s.rawChanged === true) b.rawChanged++;
    if (s.rawChanged === false) b.rawSame++;
    if (s.selChanged === true) b.selChanged++;
    if (s.selChanged === false) b.selSame++;
    if (s.isEqualArg === 'undefined(Object.is)') b.eqUndefined++; else b.eqProvided++;
    if (s.outLen !== null && s.outLen !== undefined) b.lenHist[s.outLen] = (b.lenHist[s.outLen] || 0) + 1;
  }
  const notifyByStore = {};
  for (const n of sl.notify) notifyByStore[n.store] = (notifyByStore[n.store] || 0) + 1;
  const snapByStore = {};
  for (const s of sl.snapshot) {
    const b = snapByStore[s.store] ||= { calls: 0, changed: 0, lenHist: {} };
    b.calls++;
    if (s.changed) b.changed++;
    if (s.len !== null) b.lenHist[s.len] = (b.lenHist[s.len] || 0) + 1;
  }
  const localeRev = {};
  for (const l of sl.localeSnapshots) localeRev[l.revision] = (localeRev[l.revision] || 0) + 1;
  const slotChg = {};
  for (const c of sl.slotChanges) slotChg[c.key] = (slotChg[c.key] || 0) + 1;

  // slot version counters read by the two store getSnapshots
  const ver = {};
  const vlog = sl.slotVersionLog || [];
  for (const v of vlog) {
    const b = ver[v.key] ||= { reads: 0, bumps: 0, first: null, last: null, bumpsAtCommits: [] };
    b.reads++;
    if (v.kind === 'bump') { b.bumps++; b.bumpsAtCommits.push(v.commit); }
    if (b.first === null) b.first = v.to;
    b.last = v.to;
  }
  // did a version bump happen in the same commit as a self render?
  const selfCommits = new Set(selfDriven.map((c) => c.i));
  const bumpNearSelf = {};
  for (const v of vlog) {
    if (v.kind !== 'bump') continue;
    const near = [v.commit - 1, v.commit, v.commit + 1].some((x) => selfCommits.has(x));
    const b = bumpNearSelf[v.key] ||= { bumps: 0, bumpsAdjacentToSelfRender: 0 };
    b.bumps++;
    if (near) b.bumpsAdjacentToSelfRender++;
  }
  const panelChurnValues = {};
  for (const c of withTarget) {
    const s = c.target.sel || {};
    for (const k of Object.keys(s)) {
      const key = k + ':' + (s[k] ? String(s[k].changedVsAlt) : 'na');
      panelChurnValues[key] = (panelChurnValues[key] || 0) + 1;
    }
  }

  /*
   * Cause classification for each SettingsRoot SELF render (its parent RootEntry did
   * not execute in that commit). Evidence is read straight off the fiber:
   *   target.sel.sections.changedVsAlt / .onboardingSteps.changedVsAlt / .sessions...
   * is React's own identity comparison between this committed render and the
   * previous committed render of the same fiber.
   */
  const cause = { real: 0, identity: 0, other: 0, noAlt: 0 };
  const causeDetail = [];
  for (const c of selfDriven) {
    const selHooks = (c.target && c.target.sel) || {};
    const ch = {};
    for (const k of Object.keys(selHooks)) ch[k] = selHooks[k] ? selHooks[k].changedVsAlt : 'none';
    const anyChanged = Object.values(ch).some((v) => v === true);
    const altMissing = Object.values(ch).some((v) => v === null);
    let cls;
    if (altMissing) { cls = 'noAlt'; cause.noAlt++; }
    else if (anyChanged) { cls = 'real'; cause.real++; }
    else { cls = 'other'; cause.other++; }
    causeDetail.push({ i: c.i, cls, ch, hook0: c.target.hook0, notifiedSince: c.notifiedSince || null });
  }
  // selector records (only recorded when the shim patch resolves; kept as corroboration)
  const causeSel = { real: 0, identity: 0, other: 0 };
  for (const s of sel) {
    if (s.selChanged === true) causeSel.real++;
    else if (s.rawChanged === true && s.selChanged === false) causeSel.identity++;
    else causeSel.other++;
  }

  return {
    name,
    seconds: w.elapsedMs / 1000,
    panelNodesStart: w.panelNodesAtStart, panelNodesEnd: w.panelNodesAtEnd,
    sectionStart: w.activeSectionAtStart, sectionEnd: w.activeSectionAtEnd,
    commits: commits.length,
    commitsWithTarget: withTarget.length,
    targetRendered_pw: tgtPw.length,
    targetRendered_id: tgtId.length,
    panelOpenCommits: panelOpen.length,
    selfDrivenRenders: selfDriven.length,
    parentDrivenRenders: parentDriven.length,
    panelOpenSelfDriven: selfDriven.filter((c) => c.target.hook0 === true).length,
    panelOpenParentDriven: parentDriven.filter((c) => c.target.hook0 === true).length,
    selByStore, notifyByStore, snapByStore, localeRevHist: localeRev, slotChangeByKey: slotChg,
    slotVersions: ver, slotVersionBumpsNearSelfRender: bumpNearSelf, hookIdentityCounts: panelChurnValues,
    selfRenderCause: cause,
    selfRenderCauseSel: causeSel,
    // first 25 self renders with their per-store identity verdict, for the record
    selfRenderSample: causeDetail.slice(0, 25),
    selfRenderCauseDetail: causeDetail,
    perSecRate: {
      commitPerSec: commits.length / (w.elapsedMs / 1000),
      selfRenderPerSec: selfDriven.length / (w.elapsedMs / 1000),
    },
  };
}

async function runWindow(name, { panel, section, net }) {
  const w = { name, requested: { panel, section, net }, valid: null, invalidReasons: [] };
  w.panelAction = panel === 'open' ? await openSettings() : await closeSettings();
  w.sectionAction = (panel === 'open' && section) ? await selectSection(section) : { skipped: true };
  if (net === 'quiet') { await setOffline(true); await sleep(2500); } else { await setOffline(false); await sleep(1500); }

  w.panelNodesAtStart = await panelCount();
  w.activeSectionAtStart = await activeSection();
  w.startEpochMs = Date.now(); w.startIso = new Date().toISOString();
  w.sessionListAtStart = await sessionList().catch(() => ({ ok: false }));
  w.censusAtStart = browserCensus('measure.mjs');
  const c0 = await page.evaluate((s) => { window.__SR__.mark('win-start-' + s); return window.__SR__.commitIndex(); }, name);
  w.commitIndexStart = c0;

  await sleep(WINDOW_MS);

  w.endEpochMs = Date.now(); w.endIso = new Date().toISOString();
  w.elapsedMs = w.endEpochMs - w.startEpochMs;
  w.panelNodesAtEnd = await panelCount();
  w.activeSectionAtEnd = await activeSection();
  w.sessionListAtEnd = await sessionList().catch(() => ({ ok: false }));
  w.censusAtEnd = browserCensus('measure.mjs');
  const c1 = await page.evaluate((s) => { window.__SR__.mark('win-end-' + s); return window.__SR__.commitIndex(); }, name);
  w.commitIndexEnd = c1;

  // validity: any window is invalid if the panel state drifted, or the request could not be honoured
  if (panel === 'open') {
    if (!(w.panelNodesAtStart > 0 && w.panelNodesAtEnd > 0)) w.invalidReasons.push('panel not mounted at both ends');
    if (w.activeSectionAtStart !== w.activeSectionAtEnd) w.invalidReasons.push('active section drifted');
  } else {
    if (w.panelNodesAtStart !== 0 || w.panelNodesAtEnd !== 0) w.invalidReasons.push('panel not closed');
  }
  if (net === 'quiet' && w.panelNodesAtStart > 0 && w.elapsedMs < WINDOW_MS * 0.98) w.invalidReasons.push('short window');
  // instrumentation gate: without the store wrap the attribution would be meaningless
  const gates = await page.evaluate(() => {
    const p = window.__SR__.probe();
    return {
      wrappedStores: !!p.flags.wrappedStores,
      shimTrapFired: !!p.flags.shimTrapFired,
      shimTrapActive: !!p.flags.shimTrapActive,
      storeNames: p.storeNames.slice(),
    };
  });
  w.instrumentation = gates;
  if (!gates.wrappedStores) w.invalidReasons.push('sections/onboarding sources were NOT wrapped');
  if (gates.shimTrapActive) w.invalidReasons.push('Object.prototype shim trap still installed during the window');
  w.valid = w.invalidReasons.length === 0;

  const sl = await slice(c0, c1);
  w.slice = await page.evaluate(({ f, t }) => {
    const r = window.__SR__.range({ fromCommit: f, toCommit: t });
    return { nCommits: r.commits.length, nNotify: r.notify.length, nSel: r.selCalls.length, nSnap: r.snapshot.length, nSlotChange: r.slotChanges.length };
  }, { f: c0, t: c1 });
  w.summary = summarize(name, w, sl);
  return w;
}

// ------------------------------------------------------------------ campaign
for (const st of STATES) {
  let opts;
  if (st === 'general') opts = { panel: 'open', section: 'general', net: 'active' };
  else if (st === 'models') opts = { panel: 'open', section: 'models', net: 'active' };
  else if (st === 'back-general') opts = { panel: 'open', section: 'general', net: 'active' };
  else if (st === 'models-again') opts = { panel: 'open', section: 'models', net: 'active' };
  else if (st === 'closed') opts = { panel: 'closed', net: 'active' };
  else if (st === 'offline') opts = { panel: 'open', section: 'general', net: 'quiet' };
  else { report.notes.push('unknown state ' + st); continue; }
  const w = await runWindow(st, opts);
  report.windows.push(w);
  fs.writeFileSync(path.join(OUT, `progress-${TAG}.json`), JSON.stringify(report, null, 1));
}

report.final = await page.evaluate(() => ({ probe: window.__SR__.probe() }));
report.wsSockets = socks;
report.meta.endedAt = new Date().toISOString();
report.meta.hostPidAtEnd = hostPid();
report.meta.censusAtEnd = browserCensus('measure.mjs');
report.meta.lockAtEnd = readLock();

const dump = await page.evaluate(() => window.__SR__.dump());
fs.writeFileSync(path.join(OUT, `dump-${TAG}.json`), JSON.stringify(dump));
fs.writeFileSync(path.join(OUT, `report-${TAG}.json`), JSON.stringify(report, null, 1));

await page.screenshot({ path: path.join(DIR, 'shots', `final-${TAG}.png`) }).catch(() => { });
await browser.close();
console.log('DONE', TAG, JSON.stringify(report.windows.map((w) => ({
  n: w.name, valid: w.valid, invalid: w.invalidReasons, sec: [w.activeSectionAtStart, w.activeSectionAtEnd],
  commits: w.summary.commits, tgtId: w.summary.targetRendered_id, self: w.summary.selfDrivenRenders,
  parent: w.summary.parentDrivenRenders, cause: w.summary.selfRenderCause,
}))));
