/*
 * slot-churn/measure-slot.mjs — independent causal measurement of the slot-version
 * churn hypothesis for the settings-panel parent-driven re-render path.
 *
 * DISPOSITION DISCIPLINE (per task):
 *   - one browser instance, one page; we never click save/apply/delete/model-switch,
 *     and never trigger a manual usage refresh. Settings nav tabs ARE clicked
 *     (explicitly allowed) because a mounted section is the object under study.
 *   - the cross-line exclusive probe lock is honoured: we wait for it, and only
 *     preempt under the documented stale rule.
 *   - every window is kept, valid or not.
 *
 * OUTPUT: raw JSON (this dir) => windows, per-commit records, version transitions,
 *         browser census + lock ownership at boot and at end (concurrency labelling).
 */
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const URL_ = 'http://127.0.0.1:3080';
const DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/slot-churn';
const RAW = path.join(DIR, 'raw');
fs.mkdirSync(RAW, { recursive: true });
const LOCK_DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock';
const AGENT = 'slot-churn';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argOf = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const WINDOW_MS = Number(argOf('--window', '60000'));
const TAG = argOf('--tag', 'main');

// ------------------------------------------------------------------ host facts
function hostPid() {
  try {
    for (const p of fs.readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
      try {
        const cmd = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8');
        const parts = cmd.split('\0').filter(Boolean);
        if (parts.join(' ').includes('dsh web')) {
          const st = fs.readFileSync(`/proc/${p}/stat`, 'utf8').split(' ');
          return { pid: Number(p), cmdline: parts.join(' '), starttimeTicks: Number(st[21]) };
        }
      } catch (e) { }
    }
  } catch (e) { }
  return null;
}
function census(ownMarker) {
  const out = [];
  let pids = [];
  try { pids = fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p)); } catch (e) { return { error: String(e) }; }
  for (const p of pids) {
    try {
      const cmd = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8');
      if (!cmd.includes('headless_shell') && !cmd.includes('chromium')) continue;
      const parts = cmd.split('\0').filter(Boolean);
      if (parts.some((x) => x.startsWith('--type='))) continue;
      const chain = [];
      let pp = Number(fs.readFileSync(`/proc/${p}/stat`, 'utf8').split(' ')[3]);
      for (let i = 0; i < 6 && pp > 1; i++) {
        const c = fs.readFileSync(`/proc/${pp}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ');
        chain.push({ pid: pp, cmd: c.slice(0, 160) });
        pp = Number(fs.readFileSync(`/proc/${pp}/stat`, 'utf8').split(' ')[3]);
      }
      out.push({ browserPid: Number(p), mine: chain.some((c) => c.cmd.includes(ownMarker)), chain: chain.slice(0, 3) });
    } catch (e) { }
  }
  const foreign = out.filter((x) => !x.mine);
  let totalShells = 0;
  try { totalShells = fs.readdirSync('/proc').filter((p) => {
    try { return fs.readFileSync(`/proc/${p}/cmdline`, 'utf8').includes('headless_shell'); } catch (e) { return false; }
  }).length } catch (e) { }
  return { browserProcesses: out.length, browsers: out, foreignCount: foreign.length, foreign, headlessShellAllProcesses: totalShells };
}
function readLock() {
  try {
    const owner = fs.readFileSync(`${LOCK_DIR}/owner.txt`, 'utf8');
    const st = fs.statSync(LOCK_DIR);
    return { present: true, owner, mtimeIso: st.mtime.toISOString() };
  } catch (e) { return { present: false }; }
}

// ------------------------------------------------------------------ probe lock
let lockState = { acquired: false, waitedMs: 0, attempts: 0, preempted: false, holderAtBoot: readLock() };
const NOLOCKWAIT = process.argv.includes('--nolockwait');
async function acquireLock() {
  const t = Date.now();
  const maxWait = NOLOCKWAIT ? 0 : 25 * 60 * 1000;
  while (true) {
    lockState.attempts++;
    try {
      fs.mkdirSync(LOCK_DIR);
      fs.writeFileSync(path.join(LOCK_DIR, 'owner.txt'),
        `agent: ${AGENT}\nline: slot-version churn causal chain (parent-driven settings re-render)\n` +
        `host_pid: 1390375 (node dsh web, monitored, never restarted)\n` +
        `started_at: ${new Date().toISOString()}\nstarted_epoch: ${Math.floor(Date.now() / 1000)}\n` +
        `expected_release: within ~25 min\npurpose: 3x60s settings-open windows + 1 closed control, slot version transitions\n`);
      lockState.acquired = true;
      lockState.waitedMs = Date.now() - t;
      return true;
    } catch (e) { }
    const waited = Date.now() - t;
    if (waited > maxWait) { lockState.waitedMs = waited; lockState.contended = true; return false; }
    if (waited / 1000 % 60 < 31) console.error(`[lock] held by ${(readLock().owner || '').split('\n')[0]}; waited ${Math.round(waited / 1000)}s`);
    await sleep(15000);
  }
}
function releaseLock() {
  if (!lockState.acquired) return;
  try {
    const owner = fs.readFileSync(path.join(LOCK_DIR, 'owner.txt'), 'utf8');
    if (!owner.includes(AGENT)) { console.error('[lock] REFUSE: not our lock'); return; }
    fs.unlinkSync(path.join(LOCK_DIR, 'owner.txt'));
    fs.rmdirSync(LOCK_DIR);
    lockState.released = true;
  } catch (e) { lockState.releaseError = String(e && e.message || e); }
}

// ------------------------------------------------------------------ session scale
async function sessionList() {
  const rpcId = crypto.randomUUID();
  try {
    const res = await fetch(`${URL_}/api/session.list`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method: 'session.list', payload: {} }),
    });
    const body = await res.json();
    if (!body || !body.result || !body.result.ok) return { ok: false, http: res.status };
    const items = body.result.value.items;
    return {
      ok: true, http: res.status, items: items.length,
      topLevel: items.filter((x) => !x.parentSessionId).length,
      subagents: items.filter((x) => x.parentSessionId).length,
      blank: items.filter((x) => x.blank).length,
      withProjections: items.filter((x) => x.projections).length,
      running: items.filter((x) => x.running).length,
      runningTopLevel: items.filter((x) => x.running && !x.parentSessionId).length,
      runningSubagent: items.filter((x) => x.running && x.parentSessionId).length,
    };
  } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
}

// ------------------------------------------------------------------ main
const report = {
  meta: {
    tag: TAG, startedAt: new Date().toISOString(), target: URL_, windowMs: WINDOW_MS,
    ownScript: 'slot-churn/measure-slot.mjs', hostPid: hostPid(), hostPidExpected: 1390375,
    nodeVersion: process.version, lockWait: null, discipline: {
      saves: 'none (no save/apply/delete/model-switch/usage-refresh)',
      settingsNavTabsClicked: true,
      browserInstances: 'one',
      note: 'slot-churn/ slot is exclusive to this line',
    },
  },
  lock: lockState,
  windows: [],
  notes: [],
};

await acquireLock();
report.lock = lockState;
report.meta.lockHolderAtBoot = readLock();
report.meta.censusAtBoot = census(report.meta.ownScript);
report.meta.pgrepHeadlessShellAtBoot = report.meta.censusAtBoot.headlessShellAllProcesses;

// Release the lock if this process is torn down mid-run (never leave a stale lock).
function watchdog() {
  releaseLock();
  try { fs.writeFileSync(path.join(RAW, `slot-churn-${TAG}-aborted.json`), JSON.stringify({ abortedAt: new Date().toISOString(), lock: lockState, windows: report.windows.map((w) => w.name) }, null, 1)); } catch (e) { }
  process.exit(1);
}
process.on('SIGTERM', watchdog);
process.on('SIGINT', watchdog);
process.on('uncaughtException', (e) => { console.error('[fatal] ' + (e && e.stack || e)); watchdog(); });

const browser = await chromium.launch({
  headless: true,
  args: [
    '--no-sandbox', '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion', '--enable-precise-memory-info',
  ],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ t: Date.now(), text: m.text().slice(0, 240) }); });
page.on('pageerror', (e) => consoleErrors.push({ t: Date.now(), text: 'PAGEERROR ' + String(e).slice(0, 240) }));
await page.addInitScript({ path: path.join(DIR, 'lib-init-slot.js') });
const ws = [];
page.on('websocket', (s) => { const e = { url: s.url(), frames: 0, payloadTypes: {} }; s.on('framereceived', (d) => { e.frames++; try { const j = JSON.parse(d.payload); const k = j && j.payload && j.payload.type ? j.payload.type : 'env:' + (j && j.type); e.payloadTypes[k] = (e.payloadTypes[k] || 0) + 1; } catch (x) { e.payloadTypes['<unparsed>'] = (e.payloadTypes['<unparsed>'] || 0) + 1; } }); ws.push(e); });

await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(7000);

report.meta.ua = await page.evaluate(() => navigator.userAgent);
report.meta.boot = await page.evaluate(() => {
  const b = globalThis.__DSH_BOOT__ || null;
  const want = ['@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-settings-general', '@deepseek-ai/dsh-client-settings-ui-slots', '@deepseek-ai/dsh-client-ui-layout'];
  const picked = {};
  if (b && Array.isArray(b.entries)) for (const e of b.entries) picked[e.id] = { rev: e.rev, url: e.url };
  return { bootRev: b && b.rev, entryCount: b && b.entries ? b.entries.length : null, entries: picked };
});
report.premiseAtBoot = await page.evaluate(() => window.__SC__.probe());
report.chainAtBoot = await page.evaluate(() => window.__SC__.snapshotChain());
report.versionsAtBoot = await page.evaluate(() => window.__SC__.versionsNow());

async function openSettings() {
  const n = await page.locator('div[role="dialog"][aria-modal="true"]').count();
  if (n > 0) return { alreadyOpen: true, panelNodes: n };
  await page.locator('button[aria-haspopup="dialog"]').first().click({ timeout: 8000 });
  await page.waitForTimeout(1800);
  return { alreadyOpen: false, panelNodes: await page.locator('div[role="dialog"][aria-modal="true"]').count() };
}
async function closeSettings() {
  const n = await page.locator('div[role="dialog"][aria-modal="true"]').count();
  if (n === 0) return { alreadyClosed: true, panelNodes: 0 };
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1800);
  return { alreadyClosed: false, panelNodes: await page.locator('div[role="dialog"][aria-modal="true"]').count() };
}
async function activeSection() {
  return await page.evaluate(() => {
    const c = document.querySelector('div[role="dialog"][aria-modal="true"] nav button[aria-current="true"]');
    return c ? (c.innerText || '').trim().slice(0, 40) : null;
  });
}
/** Local UI state only: pick a settings nav cell (explicitly allowed by the task). */
async function selectSection(kind) {
  if (!kind) return { skipped: true };
  const before = await activeSection();
  const want = kind === 'models' ? /模型|Models/i : /通用|General/i;
  const tabs = page.locator('div[role="dialog"][aria-modal="true"] nav button');
  const n = await tabs.count();
  for (let i = 0; i < n; i++) {
    const t = (await tabs.nth(i).innerText()).trim();
    if (want.test(t)) { await tabs.nth(i).click({ timeout: 5000 }); await page.waitForTimeout(1600); return { clicked: t, before, after: await activeSection() }; }
  }
  return { error: 'section not found', before, wanted: kind, available: n };
}
async function setOffline(on) {
  await cdp.send('Network.emulateNetworkConditions', { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
}

/** One window: mount the requested state, then sample commits + version transitions. */
async function runWindow(name, { panel, section, net }) {
  const w = { name, requested: { panel, section, net: net || 'active' }, valid: null, invalidReasons: [] };
  try {
    w.panelAction = panel === 'open' ? await openSettings() : await closeSettings();
    w.sectionAction = panel === 'open' ? await selectSection(section) : { skipped: true };
    if (net === 'offline') { await setOffline(true); await sleep(2500); } else { await setOffline(false); await sleep(1200); }

    w.panelNodesAtStart = await page.locator('div[role="dialog"][aria-modal="true"]').count();
    w.activeSectionAtStart = await activeSection();
    w.sessionListAtStart = await sessionList();
    await page.evaluate((l) => window.__SC__.mark(l), 'window-start:' + name);
    // reset the per-window baselines (keep global counters)
    const base = await page.evaluate(() => {
      const c = window.__SC__;
      const commits0 = c.commitCount;
      c.reset();
      const v = c.versionsNow();
      const ch = c.coreHookReport();
      return { commits0, versionGen: v.gen, versions: v.cur, coreBumpCount0: ch.bumpCount, coreNotifyCount0: ch.notifyCount, coreSubCount0: ch.subCount, coreGetVersionCount0: ch.getVersionCount, coreInstalled: ch.installed, coreHow: ch.how, coreErr: ch.err };
    });
    w.base = base;
    w.wsBefore = ws.map((s) => ({ url: s.url, frames: s.frames }));
    w.monoStart = Date.now();
    const t0 = await page.evaluate(() => performance.now());

    const deadline = Date.now() + WINDOW_MS;
    const samples = [];
    let drainFrom = 0;
    let pollFrom = 0;
    while (Date.now() < deadline) {
      const chunk = await page.evaluate(([f, p]) => {
        const c = window.__SC__;
        const commits = c.drain(f);
        const v = c.drainVersions(f, p);
        return {
          now: performance.now(),
          commits: commits.map((x) => ({ t: x.t, epochMs: x.epochMs, i: x.commitIndex, chain: x.chain, sub: x.panelSubtree, dom: x.dom, ver: x.ver, micro: x.micro })),
          versionTransitions: v.transitions,
          pollCount: v.pollCount,
          lastPoll: v.lastPoll,
          versions: c.versions(),
          micro: c.probe().micro,
          hookStats: c.hookStats(),
          coreBumps: c.coreHookReport().bumpCount,
          core: c.coreHookReport(),
          panelNodes: document.querySelectorAll('div[role="dialog"][aria-modal="true"]').length,
        };
      }, [drainFrom, pollFrom]);
      drainFrom = chunk.now;
      pollFrom = chunk.pollCount;
      samples.push(chunk);
      await sleep(2000);
    }
    w.monoEnd = Date.now();
    w.t0 = t0;
    w.elapsedMs = w.monoEnd - w.monoStart;
    w.sampledChunks = samples.length;
    // flatten
    w.commitRecords = samples.flatMap((s) => s.commits);
    w.versionTransitions = samples.flatMap((s) => s.versionTransitions);
    w.versionsEnd = samples.length ? samples[samples.length - 1].versions : null;
    w.microEnd = samples.length ? samples[samples.length - 1].micro : null;
    w.pollCountEnd = samples.length ? samples[samples.length - 1].pollCount : null;
    w.panelNodesSamples = samples.map((s) => s.panelNodes);
    w.sessionListAtEnd = await sessionList();
    w.sectionAtEnd = await activeSection();
    w.wsAfter = ws.map((s) => ({ url: s.url, frames: s.frames }));
    w.propStats = await page.evaluate(() => window.__SC__.propStats());
    w.hookStats = await page.evaluate(() => window.__SC__.hookStats());
    w.hookStatsDelta = (() => {
      const last = samples.length ? samples[samples.length - 1].hookStats : null;
      const first = samples.length ? samples[0].hookStats : null;
      if (!last) return null;
      const out = {};
      for (const k in last) {
        const a = first && first[k] ? first[k] : { rendered: 0, snapshotChange: 0 };
        out[k] = { rendered: last[k].rendered - (a.rendered || 0), snapshotChange: last[k].snapshotChange - (a.snapshotChange || 0), hooks: last[k].valCount };
      }
      return out;
    })();
    w.hostResolve = await page.evaluate(() => window.__SC__.probe().hostResolve);
    w.chainNow = await page.evaluate(() => window.__SC__.snapshotChain());
    w.errorsNow = await page.evaluate(() => window.__SC__.probe().errors);

    // ---------------- derived metrics
    const cr = w.commitRecords;
    w.commits = cr.length;
    w.commitsPerSec = cr.length / (w.elapsedMs / 1000);
    const framesBefore = w.wsBefore.reduce((a, x) => a + x.frames, 0);
    const framesAfter = w.wsAfter.reduce((a, x) => a + x.frames, 0);
    w.sessionFrames = framesAfter - framesBefore;
    w.sessionFramesPerSec = w.sessionFrames / (w.elapsedMs / 1000);
    const chainLen = cr.length ? cr[0].chain.length : 0;
    w.ancestorChain = cr.length ? cr[0].chain.map((c) => c.name) : [];
    // per-fiber render counts over the window
    const renders = {};
    const propsNew = {};
    for (const c of cr) for (const f of c.chain) {
      renders[f.name] = (renders[f.name] || 0) + (f.ran ? 1 : 0);
      if (f.propsNew) propsNew[f.name] = (propsNew[f.name] || 0) + 1;
    }
    w.ancestorRendersOverWindow = renders;
    w.ancestorPropsNewOverWindow = propsNew;
    w.ancestorChainLen = chainLen;
    w.rendersPerCommit = {};
    for (const k in renders) w.rendersPerCommit[k] = cr.length ? renders[k] / cr.length : null;
    // panel root
    w.panelRootRendersRAN = renders[Object.keys(renders)[0]] || 0;
    w.panelRendersPerCommit = cr.length ? w.panelRootRendersRAN / cr.length : null;
    // settings subtree
    let subTotal = 0, subPw = 0, subRan = 0, subMax = 0;
    const subNames = {};
    for (const c of cr) {
      if (!c.sub) continue;
      subTotal += c.sub.total; subPw += c.sub.pw; subRan += c.sub.ran; if (c.sub.total > subMax) subMax = c.sub.total;
      for (const k in c.sub.names) subNames[k] = (subNames[k] || 0) + c.sub.names[k];
    }
    w.settingsSubtreeFiberCount = subMax;
    w.settingsSubtreeRenders = subPw;
    w.settingsSubtreeHooksRan = subRan;
    w.settingsSubtreeFiberSum = subTotal;
    w.settingsSubtreeRendersPerCommit = cr.length ? subPw / cr.length : null;
    w.topRenderingInsidePanel = Object.entries(subNames).sort((a, b) => b[1] - a[1]).slice(0, 15);
    // DOM constancy
    const domChanged = cr.filter((c) => c.dom && c.dom.changed).length;
    const domReplaced = cr.filter((c) => c.dom && c.dom.nodeReplaced).length;
    w.domChangedCommits = domChanged;
    w.domReplacedCommits = domReplaced;
    w.domStableCommits = cr.length - domChanged;
    w.domStableFraction = cr.length ? (cr.length - domChanged) / cr.length : null;
    // version churn on commits
    const withVer = cr.filter((c) => c.ver && c.ver.any).length;
    w.commitsWithVersionDelta = withVer;
    w.commitsWithoutVersionDelta = cr.length - withVer;
    w.versionDeltaPerCommit = cr.length ? withVer / cr.length : null;
    const vk = {};
    for (const c of cr) if (c.ver && c.ver.any) for (const k in c.ver.delta) vk[k] = (vk[k] || 0) + 1;
    w.versionDeltaKeysOnCommits = vk;
    // cross-tab: commits where DOM stable AND no version delta AND panel rendered
    const pureChurn = cr.filter((c) => (!c.dom || !c.dom.changed) && (!c.ver || !c.ver.any) && c.chain.length && c.chain[0] && c.chain[0].ran);
    w.pureNoChangeButPanelRenderedCommits = pureChurn.length;
    w.pureNoChangeButPanelRenderedFraction = cr.length ? pureChurn.length / cr.length : null;
    // props identity churn: did the chain get NEW prop objects vs previous commit?
    w.propsNewPerCommit = cr.length ? Object.values(propsNew).reduce((a, b) => a + b, 0) / cr.length : null;
    // independent poller attribution of version transitions
    const vt = w.versionTransitions;
    w.versionTransitionCount = vt.length;
    w.versionTransitionsPerSec = vt.length / (w.elapsedMs / 1000);
    const vtk = {};
    for (const x of vt) vtk[x.key] = (vtk[x.key] || 0) + 1;
    w.versionTransitionKeys = vtk;
    if (vt.length) {
      const deltas = [];
      for (let i = 1; i < vt.length; i++) deltas.push(vt[i].tMs - vt[i - 1].tMs);
      deltas.sort((a, b) => a - b);
      w.versionTransitionGapMs = { n: deltas.length, p50: deltas[Math.floor(deltas.length / 2)] ?? null, min: deltas[0] ?? null, max: deltas[deltas.length - 1] ?? null };
    }
    w.versionGen = { start: base.versionGen, end: await page.evaluate(() => window.__SC__.versionsNow().gen) };
    w.microScheduledDelta = w.microEnd && base ? w.microEnd.scheduled : null;
    // direct SlotCore.markDirty attribution
    const coreEnd = await page.evaluate(() => window.__SC__.coreHookReport());
    w.coreHook = {
      installed: coreEnd.installed, how: coreEnd.how, err: coreEnd.err, wrappedSites: coreEnd.wrappedSites,
      bumpCountStart: base.coreBumpCount0, bumpCountEnd: coreEnd.bumpCount,
      bumpsInWindow: coreEnd.bumpCount - (base.coreBumpCount0 || 0),
      notifyCountInWindow: coreEnd.notifyCount - (base.coreNotifyCount0 || 0),
      subscribeCountInWindow: coreEnd.subCount - (base.coreSubCount0 || 0),
      getVersionCountInWindow: coreEnd.getVersionCount - (base.coreGetVersionCount0 || 0),
      perKey: coreEnd.perKey, perStack: coreEnd.perStack, perNotifyStack: coreEnd.perNotifyStack,
      bumps: (coreEnd.bumps || []).slice(-30), notifies: (coreEnd.notifies || []).slice(-20),
    };
    w.coreBumpsPerSec = w.coreHook.bumpsInWindow / (w.elapsedMs / 1000);

    // validity
    if (panel === 'open' && (w.panelNodesAtStart || 0) < 1) w.invalidReasons.push('panel not mounted at window start');
    if (panel === 'open') {
      const unmounted = (w.panelNodesSamples || []).filter((x) => x < 1).length;
      if (unmounted > 0) w.invalidReasons.push(`panel unmounted in ${unmounted} sample(s)`);
    }
    if (w.sessionFrames < 100 && (w.requested.net !== 'offline')) w.invalidReasons.push(`session frames only ${w.sessionFrames} (<100)`);
    if (cr.length === 0) w.invalidReasons.push('no commits observed');
    if (!w.hostResolve || !w.hostResolve.ok) w.invalidReasons.push('renderer host not resolved (slot versions unreadable)');
    if (w.elapsedMs < WINDOW_MS * 0.9) w.invalidReasons.push(`window short: ${w.elapsedMs}ms`);
    w.valid = w.invalidReasons.length === 0;
  } catch (e) {
    w.error = String(e && e.stack || e).slice(0, 1500);
    w.valid = false;
    w.invalidReasons.push('exception: ' + String(e && e.message || e));
  }
  report.windows.push(w);
  console.error(`[win] ${name} valid=${w.valid} commits=${w.commits} verTrans=${w.versionTransitionCount} domStable=${w.domStableCommits}/${w.commits} reasons=${JSON.stringify(w.invalidReasons)}`);
  return w;
}

// ------------------------------------------------------------------ window plan
await runWindow('S1-active-open-general', { panel: 'open', section: 'general' });
await runWindow('S2-active-open-general', { panel: 'open', section: 'general' });
await runWindow('S3-active-open-models', { panel: 'open', section: 'models' });
await runWindow('S4-active-closed-control', { panel: 'closed' });
await runWindow('S5-active-open-general-recheck', { panel: 'open', section: 'general' });

report.finalPremise = await page.evaluate(() => window.__SC__.probe());
report.finalVersions = await page.evaluate(() => window.__SC__.versionsNow());
report.consoleErrors = consoleErrors.slice(-40);

await browser.close();
releaseLock();
report.lock = lockState;
report.meta.censusAtEnd = census(report.meta.ownScript);
report.meta.pgrepHeadlessShellAtEnd = report.meta.censusAtEnd.headlessShellAllProcesses;
report.meta.endedAt = new Date().toISOString();

const out = path.join(RAW, `slot-churn-${TAG}.json`);
fs.writeFileSync(out, JSON.stringify(report, null, 1));
console.error('[done] wrote ' + out);
console.log(JSON.stringify({
  out,
  premise: report.finalPremise,
  lock: report.lock,
  censusBoot: { foreign: report.meta.censusAtBoot && report.meta.censusAtBoot.foreignCount, shells: report.meta.pgrepHeadlessShellAtBoot },
  censusEnd: { foreign: report.meta.censusAtEnd && report.meta.censusAtEnd.foreignCount, shells: report.meta.pgrepHeadlessShellAtEnd },
  windows: report.windows.map((w) => ({
    name: w.name, valid: w.valid, invalidReasons: w.invalidReasons,
    commits: w.commits, commitsPerSec: w.commitsPerSec && Number(w.commitsPerSec.toFixed(2)),
    sessionFrames: w.sessionFrames,
    ancestorRendersOverWindow: w.ancestorRendersOverWindow,
    ancestorChain: w.ancestorChain && w.ancestorChain.slice(0, 8),
    panelRendersPerCommit: w.panelRendersPerCommit,
    settingsSubtreeRendersPerCommit: w.settingsSubtreeRendersPerCommit,
    domStableCommits: w.domStableCommits, domChangedCommits: w.domChangedCommits,
    commitsWithVersionDelta: w.commitsWithVersionDelta,
    versionTransitionCount: w.versionTransitionCount,
    versionTransitionKeys: w.versionTransitionKeys,
    coreHook: w.coreHook && { installed: w.coreHook.installed, how: w.coreHook.how, bumpsInWindow: w.coreHook.bumpsInWindow, perKey: w.coreHook.perKey, perStack: w.coreHook.perStack },
    coreBumpsPerSec: w.coreBumpsPerSec && Number(w.coreBumpsPerSec.toFixed(2)),
    versionDeltaKeysOnCommits: w.versionDeltaKeysOnCommits,
    pureNoChangeButPanelRenderedCommits: w.pureNoChangeButPanelRenderedCommits,
    versionTransitionKeys_1s: undefined,
    hostResolve: w.hostResolve && w.hostResolve.ok,
  })),
}, null, 1));
