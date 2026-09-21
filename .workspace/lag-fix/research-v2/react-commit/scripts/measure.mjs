/*
 * React commit measurement: does the settings subtree re-render under an active
 * session event stream?
 *
 * Design
 *  - one browser instance, one page, hook installed at document-start
 *  - windows: {open|closed} x {active|quiet}, >= 3 x 60s, every window kept (valid or not)
 *  - active  = the page's own /api/events.mux stream is live (not induced by us)
 *  - quiet   = CDP Network.emulateNetworkConditions(offline) on the SAME page, which
 *              stops the session event stream without mutating any product state;
 *              restored afterwards. Flagged as an intervention in the raw JSON.
 *  - every window records: start/end epoch+monotonic, host PID, bundle revs,
 *    session.list N, WS frames by PAYLOAD type, panel node count, target commit counts
 *  - discipline: never clicks save/apply/delete/model-switch/usage-refresh.
 */
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

const URL_ = 'http://127.0.0.1:3080';
const DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/react-commit';
const OUT_RAW = path.join(DIR, 'raw');
fs.mkdirSync(OUT_RAW, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const WINDOW_MS = Number(argOf('--window', '60000'));
const TAG = argOf('--tag', 'run1');
const IDLE_BUDGET_MS = Number(argOf('--idle-budget', '90000'));
const PLAN = argOf('--plan', 'lock');
const HUNT = PLAN === 'hunt';

// ---------------------------------------------------------------- host facts
function hostPid() {
  try {
    const out = fs.readFileSync('/proc/net/tcp', 'utf8');
    void out;
  } catch (e) { }
  try {
    const pids = fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p));
    for (const p of pids) {
      try {
        const cmd = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8');
        if (cmd.includes('dsh') && cmd.includes('web') && cmd.includes('\0')) {
          const parts = cmd.split('\0').filter(Boolean);
          if (parts.some((x) => x.endsWith('/dsh')) || parts.join(' ').includes('dsh web')) {
            const st = fs.readFileSync(`/proc/${p}/stat`, 'utf8').split(' ');
            return { pid: Number(p), cmdline: parts.join(' '), starttimeTicks: Number(st[21]), state: st[2] };
          }
        }
      } catch (e) { }
    }
  } catch (e) { }
  return null;
}

async function sessionList() {
  const rpcId = crypto.randomUUID();
  const res = await fetch(`${URL_}/api/session.list`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method: 'session.list', payload: {} }),
  });
  const body = await res.json();
  if (!body || !body.result || !body.result.ok) return { ok: false, http: res.status, body: JSON.stringify(body).slice(0, 400) };
  const items = body.result.value.items;
  return {
    ok: true, http: res.status, rpcId,
    items: items.length,
    topLevel: items.filter((x) => !x.parentSessionId).length,
    subagents: items.filter((x) => x.parentSessionId).length,
    blank: items.filter((x) => x.blank).length,
    withProjections: items.filter((x) => x.projections).length,
    running: items.filter((x) => x.running).length,
    runningTopLevel: items.filter((x) => x.running && !x.parentSessionId).length,
    runningSubagent: items.filter((x) => x.running && x.parentSessionId).length,
  };
}

const browser = await chromium.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
    '--enable-precise-memory-info',
  ],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ t: Date.now(), text: m.text().slice(0, 300) }); });
page.on('pageerror', (e) => consoleErrors.push({ t: Date.now(), text: 'PAGEERROR ' + String(e).slice(0, 300) }));
await page.addInitScript({ path: path.join(DIR, 'lib-init.js') });

const pwSockets = [];
page.on('websocket', (s) => {
  const e = { url: s.url(), frames: 0, bytes: 0 };
  s.on('framereceived', (d) => { e.frames++; e.bytes += typeof d.payload === 'string' ? d.payload.length : 0; });
  pwSockets.push(e);
});

const report = {
  meta: {
    tag: TAG,
    startedAt: new Date().toISOString(),
    target: URL_,
    windowMs: WINDOW_MS,
    headless: true,
    viewport: '1440x900',
    hostPid: hostPid(),
    hostPidExpected: 1390375,
    ua: null,
    boot: null,
    nodeVersion: process.version,
    ownScript: 'scripts/measure.mjs',
    lockAtBoot: readLock(),
  },
  windows: [],
  notes: [],
};


// ---------------------------------------------------------------- lock + exclusivity evidence
const LOCK_DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock';
/** Coordinator-requested metric: literal `pgrep -c -f headless_shell` on the host. */
function pgrepHeadlessShell() {
  try {
    const out = execSync('pgrep -c -f headless_shell', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const n = Number(out);
    return Number.isFinite(n) ? n : 0;
  } catch (e) {
    return 0; // pgrep exits 1 when there is no match
  }
}
function hostPidNow() {
  try {
    const out = execSync("ps -eo pid,cmd --no-headers", { encoding: 'utf8' });
    const line = out.split('\n').find((l) => l.includes('/bin/dsh web') && !l.includes('npm exec'));
    if (!line) return null;
    return Number(line.trim().split(/\s+/)[0]);
  } catch (e) { return null; }
}
/** headless_shell processes that do NOT belong to this harness. */
function foreignHeadlessShellCount() {
  const c = browserCensus('scripts/measure.mjs');
  let n = 0;
  for (const b of c.browsers || []) if (!b.mine) n += 1;
  try {
    const all = pgrepHeadlessShell();
    const mineShells = (c.browsers || []).filter((b) => b.mine).length;
    return { total: all, foreignBrowserInstances: n, ownBrowserInstances: mineShells, foreignEstimate: Math.max(0, n) };
  } catch (e) { return { total: -1, foreignBrowserInstances: n, ownBrowserInstances: 0, foreignEstimate: Math.max(0, n) }; }
}
function readLock() {
  try {
    const owner = fs.readFileSync(`${LOCK_DIR}/owner.txt`, 'utf8');
    const st = fs.statSync(LOCK_DIR);
    return { present: true, owner, mtimeIso: st.mtime.toISOString(), mtimeMs: st.mtimeMs };
  } catch (e) { return { present: false, err: String(e && e.message || e) }; }
}
/**
 * Census of OTHER Playwright browser instances on this host. One entry per browser
 * process (headless_shell without --type=), with the node script that owns it.
 * Any entry whose owner chain does not contain our own script is a concurrency
 * violation of the cross-line probe lock and invalidates the window.
 */
function browserCensus(ownScript) {
  const out = [];
  let pids = [];
  try { pids = fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p)); } catch (e) { return { error: String(e) }; }
  for (const p of pids) {
    try {
      const cmd = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8');
      if (!cmd.includes('headless_shell') && !cmd.includes('chromium')) continue;
      const parts = cmd.split('\0').filter(Boolean);
      if (parts.some((x) => x.startsWith('--type='))) continue; // not the browser process
      const chain = [];
      let pp = Number(fs.readFileSync(`/proc/${p}/stat`, 'utf8').split(' ')[3]);
      for (let i = 0; i < 6 && pp > 1; i++) {
        const c = fs.readFileSync(`/proc/${pp}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ');
        chain.push({ pid: pp, cmd: c.slice(0, 150) });
        pp = Number(fs.readFileSync(`/proc/${pp}/stat`, 'utf8').split(' ')[3]);
      }
      const mine = chain.some((c) => c.cmd.includes(ownScript));
      out.push({ browserPid: Number(p), mine, chain: chain.slice(0, 3) });
    } catch (e) { }
  }
  const foreign = out.filter((x) => !x.mine);
  return { browsers: out, foreignCount: foreign.length, foreign };
}

/** Block until no other research line has a browser process running. */
async function waitForeignIdle(maxMs, tag, pollMs = 20000) {
  const t0 = Date.now();
  let last = null;
  for (;;) {
    const c = browserCensus('scripts/measure.mjs');
    last = c;
    if (c.foreignCount === 0) return { idle: true, waitedMs: Date.now() - t0, census: c, pgrepHeadlessShell: pgrepHeadlessShell() };
    if (Date.now() - t0 >= maxMs) return { idle: false, timedOut: true, waitedMs: Date.now() - t0, census: c, pgrepHeadlessShell: pgrepHeadlessShell() };
    console.error(`[idle] ${tag} waiting: foreign browser instances=${c.foreignCount} pgrep_headless_shell=${pgrepHeadlessShell()} owners=${(c.foreign || []).map((f) => ((f.chain[0] || {}).cmd || '').slice(0, 60)).join(' | ').slice(0, 180)}`);
    await sleep(pollMs);
  }
}

// ---------------------------------------------------------------- boot
await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);
report.meta.ua = await page.evaluate(() => navigator.userAgent);
report.meta.boot = await page.evaluate(() => {
  const b = globalThis.__DSH_BOOT__ || null;
  const want = [
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-workspace',
    '@deepseek-ai/dsh-client-ui-settings-general',
    '@deepseek-ai/dsh-client-ui-renderer',
    '@local/dsh-usage',
  ];
  const picked = {};
  if (b && Array.isArray(b.entries)) for (const e of b.entries) if (want.includes(e.id)) picked[e.id] = { rev: e.rev, url: e.url };
  return { bootRev: b && b.rev, entries: picked, entryCount: b && b.entries ? b.entries.length : null };
});
report.premise = await page.evaluate(() => window.__RC__.probe());

// ---------------------------------------------------------------- helpers
async function openSettings() {
  const count = await page.locator('div[role="dialog"][aria-modal="true"]').count();
  if (count > 0) return { alreadyOpen: true, panelNodes: count };
  await page.locator('button[aria-haspopup="dialog"]').first().click({ timeout: 6000 });
  await page.waitForTimeout(1500);
  return { alreadyOpen: false, panelNodes: await page.locator('div[role="dialog"][aria-modal="true"]').count() };
}
async function closeSettings() {
  const count = await page.locator('div[role="dialog"][aria-modal="true"]').count();
  if (count === 0) return { alreadyClosed: true };
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  return { alreadyClosed: false, panelNodes: await page.locator('div[role="dialog"][aria-modal="true"]').count() };
}
async function activeSection() {
  return await page.evaluate(() => {
    const cur = document.querySelector('div[role="dialog"][aria-modal="true"] nav button[aria-current="true"]');
    return cur ? (cur.innerText || '').trim().slice(0, 40) : null;
  });
}
/** Local UI state only: pick a settings nav cell. Never saves/applies anything. */
async function selectSection(kind) {
  if (kind === null || kind === undefined) return { skipped: true };
  const before = await activeSection();
  const want = kind === 'models' ? /模型|Models/i : /通用|General/i;
  const tabs = page.locator('div[role="dialog"][aria-modal="true"] nav button');
  const n = await tabs.count();
  for (let i = 0; i < n; i++) {
    const t = (await tabs.nth(i).innerText()).trim();
    if (want.test(t)) {
      await tabs.nth(i).click({ timeout: 5000 });
      await page.waitForTimeout(1500);
      return { clicked: t, before, after: await activeSection() };
    }
  }
  return { error: 'section not found', before, wanted: kind, available: n };
}
async function setOffline(on) {
  await cdp.send('Network.emulateNetworkConditions', {
    offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
  });
}

/**
 * Run one measurement window. `mode` decides the settings-panel state before sampling;
 * `net` decides whether the session stream is live.
 */
async function runWindow(name, { panel, net, section }) {
  const w = {
    name,
    requested: { panel, net, section },
    valid: null,
    invalidReasons: [],
  };
  try {
    w.idleGateBeforeSetup = await waitForeignIdle(0, name);
    if (panel === 'open') w.panelAction = await openSettings();
    else w.panelAction = await closeSettings();
    w.sectionAction = panel === 'open' ? await selectSection(section) : { skipped: true };
    w.targetNames = await page.evaluate(() => Object.assign({}, window.__RC__.targetNames));
    w.ancNames = await page.evaluate(() => Object.assign({}, window.__RC__.ancNames));

    if (net === 'quiet') { await setOffline(true); await sleep(2500); }
    else { await setOffline(false); await sleep(1500); }

    w.idleGateBeforeSampling = await waitForeignIdle(IDLE_BUDGET_MS, name + ':sampling', HUNT ? 5000 : 20000);
    w.panelNodesAtStart = await page.locator('div[role="dialog"][aria-modal="true"]').count();
    w.activeSectionAtStart = await activeSection();

    const secStart = await page.evaluate(() => {
      const ks = window.__RC__.secondKeys();
      return ks.length ? Math.max(...ks) + 1 : 0;
    });
    void secStart;
    w.startEpochMs = Date.now();
    w.startIso = new Date().toISOString();
    w.startMonoMs = await page.evaluate(() => Math.round(performance.now()));
    w.sessionListAtStart = await sessionList().catch((e) => ({ ok: false, err: String(e) }));
    w.lockAtWindowStart = readLock();
    w.censusAtWindowStart = browserCensus('scripts/measure.mjs');
    w.hostPidAtWindowStart = hostPidNow();
    w.pgrepHeadlessShellAtWindowStart = pgrepHeadlessShell();
    w.foreignHeadlessAtWindowStart = foreignHeadlessShellCount();

    await page.evaluate((s) => window.__RC__.mark('win-start-' + s), name);
    await sleep(WINDOW_MS);

    w.endEpochMs = Date.now();
    w.endIso = new Date().toISOString();
    w.endMonoMs = await page.evaluate(() => Math.round(performance.now()));
    w.elapsedMs = w.endEpochMs - w.startEpochMs;
    w.sessionListAtEnd = await sessionList().catch((e) => ({ ok: false, err: String(e) }));
    w.censusAtWindowEnd = browserCensus('scripts/measure.mjs');
    w.pgrepHeadlessShellAtWindowEnd = pgrepHeadlessShell();
    w.foreignHeadlessAtWindowEnd = foreignHeadlessShellCount();
    w.panelNodesAtEnd = await page.locator('div[role="dialog"][aria-modal="true"]').count();
    w.activeSectionAtEnd = await activeSection();

    const startMono = w.startMonoMs;
    const endMono = w.endMonoMs;
    const secFrom = Math.ceil(startMono / 1000);
    const secTo = Math.floor(endMono / 1000);
    w.secFrom = secFrom;
    w.secTo = secTo;

    // aggregate the per-second buckets spanning the window; seconds with no activity
    // are materialised as zero buckets so rates are per WALL-CLOCK second.
    w.agg = await page.evaluate(({ from, to }) => {
      const all = window.__RC__.dumpSeconds();
      const zero = () => ({ c: 0, cId: {}, tgt: {}, sub: 0, subId: 0, subTotal: 0, subMax: 0, subNames: {}, chain: {}, altNull: 0, domReplaced: 0, setGrew: 0, wholePw: 0, wholeId: 0, wholeTotal: 0, ws: {}, wsEnv: {}, panel: 0, panelNodes: 0 });
      const acc = {
        seconds: 0, activeSeconds: 0, commits: 0, commitsByRenderer: {}, sub: 0, subId: 0,
        subMax: 0, subTotalMax: 0, wholePw: 0, wholeId: 0, wholeTotalMax: 0,
        subNames: {}, ws: {}, wsEnv: {}, tgt: {}, chain: {}, panelSecs: 0, secDetail: [],
        altNull: 0, domReplaced: 0, setGrew: 0,
      };
      for (let s = from; s <= to; s++) {
        const b = all[s] || zero();
        acc.seconds++;
        if (b.c > 0) acc.activeSeconds++;
        acc.commits += b.c;
        for (const [r, n] of Object.entries(b.cId || {})) acc.commitsByRenderer[r] = (acc.commitsByRenderer[r] || 0) + n;
        acc.sub += b.sub || 0;
        acc.subId += b.subId || 0;
        acc.subMax = Math.max(acc.subMax, b.subMax || 0);
        acc.subTotalMax = Math.max(acc.subTotalMax, b.subTotal || 0);
        acc.wholePw += b.wholePw || 0;
        acc.wholeId += b.wholeId || 0;
        acc.wholeTotalMax = Math.max(acc.wholeTotalMax, b.wholeTotal || 0);
        if (b.panel) acc.panelSecs++;
        for (const [t, n] of Object.entries(b.ws || {})) acc.ws[t] = (acc.ws[t] || 0) + n;
        for (const [t, n] of Object.entries(b.wsEnv || {})) acc.wsEnv[t] = (acc.wsEnv[t] || 0) + n;
        for (const [t, v] of Object.entries(b.tgt || {})) {
          const o = acc.tgt[t] || (acc.tgt[t] = { pw: 0, id: 0, any: 0 });
          o.pw += v.pw; o.id += v.id; o.any += v.any;
        }
        for (const [n2, c] of Object.entries(b.subNames || {})) acc.subNames[n2] = (acc.subNames[n2] || 0) + c;
        for (const [i2, c] of Object.entries(b.chain || {})) acc.chain[i2] = (acc.chain[i2] || 0) + c;
        acc.altNull += b.altNull || 0;
        acc.domReplaced += b.domReplaced || 0;
        acc.setGrew += b.setGrew || 0;
        acc.secDetail.push({ s, commits: b.c, panel: b.panel, ws: b.ws, sub: b.sub, tgt: b.tgt, wholePw: b.wholePw });
      }
      return acc;
    }, { from: secFrom, to: secTo });

    // derived
    const sessionFrames = (w.agg.ws['session/event'] || 0) + (w.agg.ws['session/projection'] || 0);
    w.derived = {
      sessionFrames,
      sessionEventFrames: w.agg.ws['session/event'] || 0,
      sessionProjectionFrames: w.agg.ws['session/projection'] || 0,
      commitsPerSec: w.agg.seconds ? w.agg.commits / w.agg.seconds : 0,
      sessionFramesPerSec: w.agg.seconds ? sessionFrames / w.agg.seconds : 0,
      panelCommits: w.agg.tgt.panel ? w.agg.tgt.panel.any : 0,
      rootCommits: w.agg.tgt.root ? w.agg.tgt.root.any : 0,
      panelCommitsPerSessionFrame: sessionFrames ? (w.agg.tgt.panel ? w.agg.tgt.panel.any : 0) / sessionFrames : null,
      panelCommitsPerCommit: w.agg.commits ? (w.agg.tgt.panel ? w.agg.tgt.panel.any : 0) / w.agg.commits : null,
      wholeRenderedPerCommit: w.agg.commits ? w.agg.wholePw / w.agg.commits : null,
      subRenderedPerCommit: w.agg.commits ? w.agg.sub / w.agg.commits : null,
      panelSecsFraction: w.agg.seconds ? w.agg.panelSecs / w.agg.seconds : 0,
      panelSecsFractionOfActive: w.agg.activeSeconds ? w.agg.panelSecs / w.agg.activeSeconds : 0,
      altNull: w.agg.altNull,
      domReplaced: w.agg.domReplaced,
      setGrew: w.agg.setGrew,
    };

    // validity gates (recorded, never silently dropped)
    if (panel === 'open' && w.panelNodesAtStart < 1) w.invalidReasons.push('settings panel node count 0 at window start');
    if (panel === 'open' && w.agg.activeSeconds > 0 && w.agg.panelSecs < w.agg.activeSeconds * 0.9) w.invalidReasons.push('panel not mounted for >10% of commit-active seconds');
    if (panel === 'closed' && w.panelNodesAtStart !== 0) w.invalidReasons.push('settings panel still mounted in closed window');
    if (panel === 'open' && section === 'models' && !/模型|Models/i.test(w.activeSectionAtStart || '')) w.invalidReasons.push('requested models section not active at window start');
    if (panel === 'open' && section === 'general' && !/通用|General/i.test(w.activeSectionAtStart || '')) w.invalidReasons.push('requested general section not active at window start');
    if (w.requested.net === 'active' && sessionFrames === 0) w.invalidReasons.push('no session/* frames in an active-stream window');
    if (w.requested.net === 'quiet' && sessionFrames > 0) w.invalidReasons.push('session/* frames present in a quiet window');
    if (w.elapsedMs < WINDOW_MS * 0.9) w.invalidReasons.push('window shorter than requested');
    if (!w.lockAtWindowStart || w.lockAtWindowStart.present !== true) w.invalidReasons.push('probe lock not held at window start');
    if (w.idleGateBeforeSampling && w.idleGateBeforeSampling.idle !== true) w.invalidReasons.push('could not reach a foreign-browser-free moment before sampling');
    if (w.censusAtWindowStart && w.censusAtWindowStart.foreignCount > 0) w.invalidReasons.push(`foreign browser(s) present at window start: ${JSON.stringify((w.censusAtWindowStart.foreign || []).map((f) => f.chain[0] && f.chain[0].cmd))}`);
    if (w.censusAtWindowEnd && w.censusAtWindowEnd.foreignCount > 0) w.invalidReasons.push(`foreign browser(s) present at window end: ${JSON.stringify((w.censusAtWindowEnd.foreign || []).map((f) => f.chain[0] && f.chain[0].cmd))}`);
    if (w.agg.seconds < WINDOW_MS / 1000 - 3) w.invalidReasons.push('too few sampled seconds');
    w.valid = w.invalidReasons.length === 0;

    await page.screenshot({ path: path.join(DIR, 'shots', `${TAG}-${name}.png`) });
  } catch (e) {
    w.error = String(e && e.stack || e).slice(0, 800);
    w.valid = false;
    w.invalidReasons.push('exception: ' + String(e && e.message || e).slice(0, 200));
  } finally {
    try { await setOffline(false); } catch (e) { }
  }
  report.windows.push(w);
  console.error(`[win] ${name} valid=${w.valid} lock=${w.lockAtWindowStart && w.lockAtWindowStart.present} foreign=${w.censusAtWindowStart && w.censusAtWindowStart.foreignCount}/${w.censusAtWindowEnd && w.censusAtWindowEnd.foreignCount} sec=${w.activeSectionAtStart} reasons=${JSON.stringify(w.invalidReasons)} commits=${w.agg ? w.agg.commits : 'n/a'} panelCommits=${w.derived ? w.derived.panelCommits : 'n/a'} sessionFrames=${w.derived ? w.derived.sessionFrames : 'n/a'} wholePerCommit=${w.derived ? w.derived.wholeRenderedPerCommit : 'n/a'}`);
  return w;
}

// ---------------------------------------------------------------- window plan
// The recon/debug runs showed the settings subtree's behaviour is section-dependent,
// so both sections get their own active-stream window, plus the closed control.
// All windows are kept in the report whether or not they pass their validity gates.
if (PLAN === 'hunt') {
  // Best-effort exclusive windows for the key ratio (commits per event), fine-grained poll.
  await runWindow('H1-active-open-models', { panel: 'open', net: 'active', section: 'models' });
  await runWindow('H2-active-open-general', { panel: 'open', net: 'active', section: 'general' });
  await runWindow('H3-active-closed', { panel: 'closed', net: 'active', section: null });
  await runWindow('H4-active-open-models', { panel: 'open', net: 'active', section: 'models' });
} else if (PLAN === 'lock') {
  // essential set: >=3 x 60s, both settings sections, closed control, quiet group
  await runWindow('L1-active-open-general', { panel: 'open', net: 'active', section: 'general' });
  await runWindow('L2-active-open-models', { panel: 'open', net: 'active', section: 'models' });
  await runWindow('L3-active-closed', { panel: 'closed', net: 'active', section: null });
  await runWindow('L4-quiet-open-models', { panel: 'open', net: 'quiet', section: 'models' });
  await runWindow('L5-quiet-closed', { panel: 'closed', net: 'quiet', section: null });
} else {
  await runWindow('W1-active-open-general', { panel: 'open', net: 'active', section: 'general' });
  await runWindow('W2-active-open-models', { panel: 'open', net: 'active', section: 'models' });
  await runWindow('W3-active-closed', { panel: 'closed', net: 'active', section: null });
  await runWindow('W4-active-open-general', { panel: 'open', net: 'active', section: 'general' });
  await runWindow('W5-active-open-models', { panel: 'open', net: 'active', section: 'models' });
  await runWindow('W6-quiet-open-models', { panel: 'open', net: 'quiet', section: 'models' });
  await runWindow('W7-quiet-closed', { panel: 'closed', net: 'quiet', section: null });
  await runWindow('W8-active-open-models', { panel: 'open', net: 'active', section: 'models' });
}

report.finalProbe = await page.evaluate(() => window.__RC__.probe());
report.hookCallsFinal = await page.evaluate(() => JSON.parse(JSON.stringify(window.__RC__.hookCalls)));
report.wsSocketsFinal = pwSockets;
report.consoleErrors = consoleErrors.slice(0, 40);
report.lockAtEnd = readLock();
report.censusAtEnd = browserCensus('scripts/measure.mjs');
report.finishedAt = new Date().toISOString();

fs.writeFileSync(path.join(OUT_RAW, `measure-${TAG}.json`), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(OUT_RAW, `commitlog-${TAG}.json`), JSON.stringify(await page.evaluate(() => window.__RC__.dumpCommitLog()), null, 2));
fs.writeFileSync(path.join(OUT_RAW, `wsraw-${TAG}.json`), JSON.stringify(await page.evaluate(() => window.__RC__.dumpWsRaw()), null, 2));

console.log(JSON.stringify({
  meta: report.meta,
  premise: report.premise,
  windows: report.windows.map((w) => ({
    name: w.name, valid: w.valid, invalidReasons: w.invalidReasons,
    panelAction: w.panelAction, sectionAction: w.sectionAction,
    activeSection: [w.activeSectionAtStart, w.activeSectionAtEnd],
    targetNames: w.targetNames,
    panelNodesAtStart: w.panelNodesAtStart, panelNodesAtEnd: w.panelNodesAtEnd,
    elapsedMs: w.elapsedMs, seconds: w.agg && w.agg.seconds, activeSeconds: w.agg && w.agg.activeSeconds,
    sessionListStart: w.sessionListAtStart && { items: w.sessionListAtStart.items, topLevel: w.sessionListAtStart.topLevel, running: w.sessionListAtStart.running },
    ws: w.agg && w.agg.ws, tgt: w.agg && w.agg.tgt, derived: w.derived,
    ancNames: w.ancNames, chain: w.agg && w.agg.chain,
    wholeTotalMax: w.agg && w.agg.wholeTotalMax, subTotalMax: w.agg && w.agg.subTotalMax,
    subNamesTop: w.agg && Object.entries(w.agg.subNames).sort((a, b) => b[1] - a[1]).slice(0, 15),
  })),
  hookCallsFinal: report.hookCallsFinal,
  wsSocketsFinal: report.wsSocketsFinal,
  consoleErrors: report.consoleErrors,
}, null, 2));

await browser.close();
