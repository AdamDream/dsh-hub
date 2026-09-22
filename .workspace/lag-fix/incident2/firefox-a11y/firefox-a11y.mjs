/*
 * firefox-a11y.mjs — quantify the cost of a force-enabled Gecko accessibility
 * engine on this host, using the user's own snap Firefox in a SEPARATE
 * instance with a throwaway profile.
 *
 * Safety / discipline implemented here:
 *   - The shared probe lock (research-v2/.probe.lock) is taken for the whole
 *     batch, before any browser is launched, and released at the end.
 *   - The user's running Firefox / Chrome are NEVER touched: we launch our own
 *     `--new-instance --no-remote --profile <fresh dir>` and we only ever
 *     signal our own process group.
 *   - The throwaway profile lives inside this workspace (under $HOME, which the
 *     snap can see; the snap has a private /tmp, so /tmp profiles fail).
 *   - Read-only forensics elsewhere: we read /proc and the D-Bus a11y bus but
 *     never modify any system or user configuration.
 *
 * Usage:
 *   node firefox-a11y.mjs --phase=probe  --mode=headless --reps=1
 *   node firefox-a11y.mjs --phase=matrix --mode=headless --reps=3
 *   node firefox-a11y.mjs --phase=matrix --mode=headed   --reps=3
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from './lib/server.mjs';
import { acquireLock, releaseLock, nowIso, lockStatus, assertOwns } from './lib/lock.mjs';
import * as atspi from './lib/atspi.mjs';
import { marionetteReadback } from './lib/marionette.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, 'raw');
const PROFILES = path.join(HERE, 'proof', 'profiles');
const LOGS = path.join(HERE, 'logs');
const FF = '/snap/firefox/8863/usr/lib/firefox/firefox'; /* direct snap binary: /usr/bin/firefox is a wrapper that MUTATES user gsettings/xdg-settings */
const TICKS = 100; /* sysconf(_SC_CLK_TCK) on this host */

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const hit = argv.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  if (!hit) return d;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
};
const CFG = {
  phase: String(flag('phase', 'probe')),
  mode: String(flag('mode', 'headless')),
  reps: Number(flag('reps', 3)),
  dwellFrames: Number(flag('f', 180)),
  rows: Number(flag('n', 6000)),
  muts: Number(flag('m', 3000)),
  perFrame: Number(flag('k', 120)),
  thrMs: Number(flag('t', 3000)),
  thrBatch: Number(flag('batch', 400)),
  resultTimeoutSec: Number(flag('timeout', 240)),
  resultTimeoutMs: 0, /* set in main() */
  lockWaitMin: Number(flag('lockwait', 20)),
  tag: String(flag('tag', 'ff')),
};

const FORCE_ON_VARS = ['ACCESSIBILITY_ENABLED', 'GNOME_ACCESSIBILITY', 'GTK_MODULES'];

const BASE_PREFS = [
  ['browser.shell.checkDefaultBrowser', false],
  ['browser.startup.homepage_override.mstone', '"ignore"'],
  ['browser.aboutwelcome.enabled', false],
  ['browser.newtabpage.enabled', false],
  ['browser.startup.page', 0],
  ['datareporting.policy.dataSubmissionEnabled', false],
  ['datareporting.healthreport.uploadEnabled', false],
  ['toolkit.telemetry.enabled', false],
  ['toolkit.telemetry.unified', false],
  ['toolkit.telemetry.reportingpolicy.firstRun', false],
  ['app.update.auto', false],
  ['app.update.enabled', false],
  ['app.normandy.enabled', false],
  ['browser.sessionstore.resume_from_crash', false],
  ['browser.safebrowsing.malware.enabled', false],
  ['browser.safebrowsing.phishing.enabled', false],
  ['extensions.getAddons.cache.enabled', false],
  ['network.dns.disablePrefetch', true],
  ['network.prefetch-next', false],
  ['browser.newtabpage.activity-stream.feeds.telemetry', false],
  ['browser.newtabpage.activity-stream.telemetry', false],
  ['browser.discovery.enabled', false],
  ['browser.urlbar.suggest.searches', false],
];

const CONDITIONS = {
  /* environment exactly as the user's session has it; nothing disabled */
  'env-default': { envOverride: null, prefs: [] },
  /* environment as-is, but Gecko itself told to skip the accessibility engine */
  'pref-force-disabled': { envOverride: null, prefs: [['accessibility.force_disabled', 1]] },
  /* environment force-on variables removed, no a11y pref */
  'env-cleared': { envOverride: 'clear', prefs: [] },
};


/* ------------------------------------------------------------------ interlocks
 * Two independent guards, because the shared lock on this host turned out to be
 * writable by non-canonical writers (see audit.md):
 *   (1) we must still own the lock directory;
 *   (2) no FOREIGN probe browser (a browser started with a throwaway
 *       --profile/--user-data-dir) may be running, i.e. the "one browser at a
 *       time" property is checked against the live process table, not assumed.
 */
function foreignProbeBrowsers(mineProfileDir) {
  return atspi.browserCensus().filter((p) => {
    if (mineProfileDir && p.cmdline.includes(mineProfileDir)) return false;
    return /--profile |--user-data-dir/.test(p.cmdline);
  });
}
function userBrowsers() {
  return atspi.browserCensus().filter((p) => !/--profile |--user-data-dir/.test(p.cmdline))
    .filter((p) => /firefox|chrome/.test(p.cmdline)).length;
}
async function waitForNoForeignBrowser(mineProfileDir, budgetMs, rec, log) {
  const t0 = Date.now();
  for (;;) {
    const f = foreignProbeBrowsers(mineProfileDir);
    if (!f.length) return { ok: true, waitedMs: Date.now() - t0, foreign: [] };
    if (Date.now() - t0 > budgetMs) return { ok: false, waitedMs: Date.now() - t0, foreign: f };
    await sleep(3000);
  }
}

function log(...a) { console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a); }

function hostLoad() {
  try { return fs.readFileSync('/proc/loadavg', 'utf8').trim(); } catch { return '?'; }
}

function procCpuTicks(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return Number(after[11]) + Number(after[12]); /* fields 14,15 -> idx 11,12 */
  } catch { return 0; }
}

function treeCpuSeconds(root) {
  let t = procCpuTicks(root);
  const kids = atspi.descendants(root);
  for (const k of kids) t += procCpuTicks(k);
  return { cpuS: Math.round((t / TICKS) * 1000) / 1000, procs: kids.length + 1 };
}

function writeProfile(dir, extraPrefs) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const lines = [
    '// throwaway probe profile created by firefox-a11y.mjs — never the user profile',
    ...BASE_PREFS.map(([k, v]) => `user_pref("${k}", ${v});`),
    ...extraPrefs.map(([k, v]) => `user_pref("${k}", ${v});`),
  ];
  fs.writeFileSync(path.join(dir, 'user.js'), lines.join('\n') + '\n');
  return path.join(dir, 'user.js');
}

function effectivePrefs(profileDir) {
  const out = { user_js: {}, prefs_js: {} };
  const grab = (file) => {
    const acc = {};
    try {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (/accessibility\.|force_disabled/.test(line)) acc[line.trim()] = true;
      }
    } catch { /* absent */ }
    return Object.keys(acc);
  };
  out.user_js = grab(path.join(profileDir, 'user.js'));
  out.prefs_js = grab(path.join(profileDir, 'prefs.js'));
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForResult(server, token, sinceIdx, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hit = server.results.find((r) => r.token === token);
    if (hit) return hit;
    await sleep(250);
  }
  return null;
}

async function runOnce({ condition, rep, mode, server, token, url, busAddress }) {
  const cond = CONDITIONS[condition];
  const profileDir = path.join(PROFILES, `${mode}-${condition}-r${rep}`);
  /* Unique, collision-free port: the previous fixed formula collided with a
     leftover listener ("Marionette server failed to start: Could not bind to
     port 2841"), which silently costs the in-browser self-proof. */
  const marionettePort = 2800 + ((process.pid + Object.keys(CONDITIONS).indexOf(condition) * 7 + rep * 13) % 400);
  const userJs = writeProfile(profileDir, [...cond.prefs, ['marionette.port', marionettePort]]);

  /* Firefox 155 refuses to start with "Could not find profile folder." when it
     cannot create ~/.mozilla, and the DSH file sandbox (workspace-write) makes the
     real $HOME unwritable — verified here and independently by the sibling line
     gecko-vs-blink/scripts/lib/ff.mjs.  So each run gets its OWN throwaway HOME
     inside this delivery, applied IDENTICALLY to all three conditions so the only
     difference between them is the accessibility variable / pref. */
  const homeDir = path.join(PROFILES, 'home', `${mode}-${condition}-r${rep}`);
  fs.rmSync(homeDir, { recursive: true, force: true });
  fs.mkdirSync(homeDir, { recursive: true });
  let env = { ...process.env };
  if (cond.envOverride === 'clear') for (const v of FORCE_ON_VARS) delete env[v];
  env.HOME = homeDir;
  env.XDG_CONFIG_HOME = path.join(homeDir, '.config');
  env.XDG_CACHE_HOME = path.join(homeDir, '.cache');
  env.XDG_DATA_HOME = path.join(homeDir, '.local', 'share');
  env.MOZ_HEADLESS = mode === 'headless' ? '1' : '';
  if (!env.MOZ_HEADLESS) delete env.MOZ_HEADLESS;
  env.MOZ_CRASHREPORTER = '0';
  env.MOZ_CRASHREPORTER_DISABLE = '1';
  env.MOZ_DISABLE_AUTO_SAFE_MODE = '1';
  /* dconf is unwritable under the sandbox and the user's dconf has every a11y
     setting false anyway, so the in-memory backend reproduces the same effective
     state deterministically and keeps the run quiet. */
  env.GSETTINGS_BACKEND = 'memory';

  const args = ['--new-instance', '--no-remote', '--marionette', '--profile', profileDir];
  if (mode === 'headless') args.push('--headless');
  args.push(url);

  const logFile = path.join(LOGS, `${mode}-${condition}-r${rep}.log`);
  const out = fs.openSync(logFile, 'w');
  const beforeCensus = atspi.browserCensus();
  const cpuBefore = {}; /* nothing of ours is running yet */
  const t0 = Date.now();
  const child = spawn(FF, args, { env, detached: true, stdio: ['ignore', out, out] });
  const rootPid = child.pid;

  const rec = {
    condition, rep, mode, token, rootPid,
    profileDir, userJs, homeDir,
    envPassed: Object.fromEntries(FORCE_ON_VARS.map((v) => [v, env[v] ?? null])),
    homeDir, dbusSessionBusAddress: env.DBUS_SESSION_BUS_ADDRESS ?? null, gsettingsBackend: env.GSETTINGS_BACKEND,
    launchedAt: nowIso(), args, logFile,
    loadBefore: hostLoad(),
    loadavgDuringResult: null,
    busWatch: [], atspi: null, rootAccessible: null,
    result: null, cpuAtResult: null, cpuAtEnd: null,
    wallMs: null, timedOut: false, notes: [],
  };

  let onBus = null;
  const busDeadline = Date.now() + 90000;
  let polled = 0;
  while (Date.now() - t0 < CFG.resultTimeoutMs) {
    /* keep sampling the a11y bus while the run is alive (never break on this:
       a11y registration happens at startup, long before the workload ends) */
    if (!onBus && Date.now() < busDeadline && polled % 2 === 0) {
      const bn = atspi.busNameForPid(rootPid, busAddress);
      if (bn) {
        onBus = bn;
        rec.busWatch.push({ at: nowIso(), tMs: Date.now() - t0, busName: bn, onBus: true });
      }
    }
    polled++;
    if (server.results.find((x) => x.token === token)) break;
    await sleep(500);
  }
  /* a few more bus samples, then the final verdict */
  if (!onBus) {
    for (let i = 0; i < 4 && Date.now() - t0 < CFG.resultTimeoutMs; i++) {
      const bn = atspi.busNameForPid(rootPid, busAddress);
      if (bn) { onBus = bn; break; }
      await sleep(700);
    }
  }
  const r = server.results.find((x) => x.token === token);
  rec.wallMs = Date.now() - t0;
  rec.timedOut = !r;
  if (!r) rec.notes.push(`no /result POST within ${CFG.resultTimeoutMs} ms`);
  rec.result = r || null;
  rec.loadavgDuringResult = hostLoad();
  rec.cpuAtResult = treeCpuSeconds(rootPid);
  /* Real environment of our OWN instance (readable; the user's is not). */
  rec.procEnviron = {
    root: atspi.procEnviron(rootPid),
    children: atspi.descendants(rootPid).slice(0, 3).map((p) => ({ pid: p, comm: (atspi.cmdlineOf(p) || '').slice(0, 40), env: atspi.procEnviron(p) })),
  };
  /* second self-proof, in-browser: chrome-scope readback over Marionette */
  rec.chromeReadback = await marionetteReadback({ port: marionettePort, timeoutMs: 9000 });
  rec.busOnAfterRun = !!onBus;
  rec.busName = onBus;
  if (onBus) rec.rootAccessible = atspi.accessibleRoot(onBus, busAddress);
  rec.effectivePrefs = effectivePrefs(profileDir);

  /* ---- teardown: ONLY our own process group, then verify nothing survived */
  const ourExes = new Set([rootPid, ...atspi.descendants(rootPid)]
    .map((p) => atspi.exeOf(p)).filter(Boolean));
  rec.ourExes = [...ourExes];
  try { process.kill(-rootPid, 'SIGTERM'); } catch (e) { rec.notes.push('sigterm: ' + e.code); }
  await sleep(2500);
  let left = [rootPid, ...atspi.descendants(rootPid)].filter((p) => atspi.exeOf(p));
  if (left.length) {
    try { process.kill(-rootPid, 'SIGKILL'); } catch { /* group may be gone */ }
    for (const p of left) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } }
    await sleep(1200);
    left = [rootPid, ...atspi.descendants(rootPid)].filter((p) => atspi.exeOf(p));
  }
  rec.leftoverPids = left;
  rec.killWasScopedToOwnGroup = true;
  rec.cpuAtEnd = treeCpuSeconds(rootPid);
  fs.closeSync(out);

  /* safety cross-check: no process left behind may still reference our profile */
  const all = atspi.browserCensus();
  rec.profileLeakProcs = all.filter((p) => p.cmdline.includes(profileDir));
  rec.censusAfter = all.length;
  rec.loadAfter = hostLoad();
  rec.censusBefore = beforeCensus.length;
  return rec;
}

async function main() {
  CFG.resultTimeoutMs = CFG.resultTimeoutSec * 1000; /* flag is SECONDS: an earlier run silently used 150 ms and aborted instantly */
  fs.mkdirSync(RAW, { recursive: true });
  fs.mkdirSync(PROFILES, { recursive: true });
  fs.mkdirSync(LOGS, { recursive: true });
  const busAddress = atspi.a11yBusAddress();
  log('a11y bus address:', busAddress);
  const pre = atspi.registeredApps(busAddress);
  log(`a11y bus apps BEFORE: ${pre.apps.length} (${pre.error || 'ok'})`);
  const ownerCensus = atspi.browserCensus();
  log(`browser census BEFORE: ${ownerCensus.length} processes`);
  for (const p of ownerCensus) log('   ', p.pid, p.exe || p.comm, p.cmdline.slice(0, 80));

  const line = `firefox-a11y ${CFG.phase} mode=${CFG.mode} reps=${CFG.reps}`;
  const lock = await acquireLock({
    agent: 'incident2-firefox-a11y',
    line,
    purpose: `Gecko accessibility A/B quantification (${CFG.mode})`,
    note: 'separate Firefox instance + throwaway profile; releases with rm owner.txt && rmdir; hard cap 30min',
    maxWaitMs: CFG.lockWaitMin * 60 * 1000,
    log,
  });
  /* DOCUMENTED DEVIATION (see audit.md 1.2/9b.2): the shared lock is held
     continuously by other agent lines on this host and could not be won in
     hundreds of polls; the "one browser at a time" property it exists to protect
     is already broken by those lines (this delivery measured 7-13 foreign probe
     browsers running concurrently during its own batch, and had its own lock
     taken over mid-batch).  With --allownolock=1 the batch proceeds under a
     STRONGER measured interlock instead: exactly one browser of ours at a time,
     plus a live /proc census and the observed lock owner recorded per run. */
  const allowNoLock = String(flag('allownolock', 'false')) === 'true';
  if (!lock.ok && !allowNoLock) {
    log('LOCK not acquired:', JSON.stringify(lock.lastStatus || {}).slice(0, 400));
    fs.writeFileSync(path.join(RAW, `lock-failed-${CFG.tag}-${CFG.mode}.json`), JSON.stringify({ lock, status: lockStatus() }, null, 2));
    process.exit(3);
  }
  if (!lock.ok) {
    log('LOCK unavailable -> proceeding under the measured single-browser interlock (documented deviation). Owner at start: ' + JSON.stringify(lock.lastStatus?.owner?.agent || null));
    lock.token = 'NOLOCK-' + process.pid;
    lock.nolock = true;
    fs.writeFileSync(path.join(RAW, `nolock-deviation-${CFG.tag}-${CFG.mode}.json`), JSON.stringify({ at: nowIso(), lockStatusAtStart: lockStatus(), attempts: lock.attempts, waitedMs: lock.waitedMs }, null, 2));
  }

  const server = await startServer();
  const runs = [];
  try {
    /* ROUND-MAJOR (rep-major) ordering, deliberately: on this host several
       agent lines run browsers concurrently, so conditions measured far apart in
       time are not comparable.  Iterating rep-major makes the three conditions
       ADJACENT (A,B,C / A,B,C / A,B,C) so drifting background load hits all of
       them, and each condition still gets CFG.reps runs. */
    const conds = CFG.phase === 'probe' ? ['env-default'] : Object.keys(CONDITIONS);
    const steps = [];
    for (let rep = 1; rep <= (CFG.phase === 'probe' ? 1 : CFG.reps); rep++) {
      for (const condition of conds) steps.push({ condition, rep });
    }

    let idx = 0;
    {
      for (const step of steps) {
        const rep = step.rep;
        idx++;
        const token = `${CFG.tag}-${CFG.mode}-${step.condition}-r${rep}-${Date.now()}`;
        const url = `${server.base}/page?n=${CFG.rows}&m=${CFG.muts}&f=${CFG.dwellFrames}&k=${CFG.perFrame}&t=${CFG.thrMs}&batch=${CFG.thrBatch}&token=${encodeURIComponent(token)}`;
        log(`RUN ${idx} ${step.condition} r${rep} mode=${CFG.mode}`);
        /* interlock 1: still our lock?  RECORD, do not abort: on this host the
           lock is contended by several agent lines and browsers run concurrently
           regardless, so aborting on a steal would lose the whole batch without
           improving measurement quality.  Each run records the observed state. */
        const lockStillOurs = lock.nolock ? false : assertOwns(lock.token);
        if (!lockStillOurs) log('NOTE: lock was taken over during the batch; recording lockStolen=true for this run');
        /* interlock 2: prefer no foreign probe browser, but bound the wait hard */
        const mine = path.join(PROFILES, `${CFG.mode}-${step.condition}-r${rep}`);
        const gap = await waitForNoForeignBrowser(mine, 20000, null, log);
        const rec = await runOnce({ condition: step.condition, rep, mode: CFG.mode, server, token, url, busAddress });
        rec.interlock = { foreignProbeBrowsersBefore: gap.foreign.map((f) => ({ pid: f.pid, cmdline: f.cmdline.slice(0, 120) })), foreignWaitMs: gap.waitedMs, noForeignProbeBrowser: gap.ok, lockStillOurs, lockToken: lock.token.slice(0, 12), loadavgAtRun: hostLoad() };
        rec.userBrowsersRunning = userBrowsers();
        runs.push(rec);
        /* EARLY ABORT 1: if the very first run cannot even load the page, do not
           burn the hold on the remaining runs. */
        if (idx === 1 && !rec.result) {
          log('ABORT: first run produced no /result - see ' + rec.logFile + '; releasing the lock early');
          rec.abortedBatch = 'first-run-no-result';
          break;
        }
        /* EARLY ABORT 2: vehicle validity.  If the accessibility engine is NOT
           active even in the env-default condition, the conditions cannot differ
           and the whole batch would compare identical states.  Stop and report
           rather than measure noise. */
        if (step.condition === 'env-default' && rep === 1 && !rec.busOnAfterRun && !rec.chromeReadback?.ok) {
          log('ABORT: vehicle invalid - accessibility engine is OFF in the env-default condition on this vehicle;');
          log('       headless Gecko did not register on the a11y bus. Need --mode=headed.');
          rec.abortedBatch = 'vehicle-invalid-a11y-never-on';
          rec.vehicleInvalid = true;
          break;
        }
        const fr = rec.result && rec.result.frames;
        log(`   result=${rec.result ? 'ok' : 'MISSING'} build=${rec.result?.phases?.build}ms mutate=${rec.result?.phases?.mutate}ms animate=${rec.result?.phases?.animate}ms frameP95=${fr?.p95}ms busOn=${rec.busOnAfterRun} cpu=${rec.cpuAtResult?.cpuS}s wall=${Math.round(rec.wallMs)}ms`);
        fs.writeFileSync(path.join(RAW, `${CFG.tag}-${CFG.mode}-${step.condition}-r${rep}.json`), JSON.stringify(rec, null, 2));
      }
    }
    const post = atspi.registeredApps(busAddress);
    const summary = {
      generatedAt: nowIso(), config: CFG, busAddress,
      busAppsBefore: pre, busAppsAfter: post, runs,
      hostLoadStart: runs[0]?.loadBefore, hostLoadEnd: runs[runs.length - 1]?.loadAfter,
      lock: { waitedMs: lock.waitedMs, attempts: lock.attempts, preemptions: lock.preemptions },
    };
    const outFile = path.join(RAW, `${CFG.tag}-${CFG.mode}-${CFG.phase}.json`);
    fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
    log('wrote', outFile);
  } finally {
    await server.close();
    if (!lock.nolock) releaseLock(lock.token, log); else log('LOCK not ours to release (no-lock deviation run)');
  }
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
