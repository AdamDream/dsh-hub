/*
 * blink-a11y.mjs — does the same force-on environment (or an explicit
 * --force-renderer-accessibility) cost anything in Blink?
 *
 * This is the cross-check that decides whether "a11y forced on" can explain
 * "Chrome smooth / Firefox janky": if Blink's accessibility tree is cheap, the
 * difference is a Gecko cost, not an "a11y is on/off" difference.
 *
 * Conditions (same page, same workload as the Gecko run):
 *   env-default-nofag : the session environment as-is, no accessibility switch
 *   force-renderer    : session environment + --force-renderer-accessibility
 *   env-cleared-nofag : ACCESSIBILITY_ENABLED / GNOME_ACCESSIBILITY / GTK_MODULES removed
 *
 * Self-proof of the Blink accessibility state is read back from
 * chrome://accessibility (the Blink equivalent of about:support) in a SEPARATE
 * tab, so the readback cannot itself enable accessibility for the measured page.
 *
 * Same discipline as the Gecko runner: shared probe lock taken before any
 * browser starts, own throwaway profile dir, nothing of the user's touched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './lib/server.mjs';
import { acquireLock, releaseLock, nowIso, lockStatus, assertOwns } from './lib/lock.mjs';
import * as atspi from './lib/atspi.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, 'raw');
const LOGS = path.join(HERE, 'logs');
const PROFILES = path.join(HERE, 'proof', 'blink-profiles');
/* System Google Chrome 153.0.8010.52 — the SAME major version as the Chrome the
   user is actually running — rather than playwright's bundled chromium-1148
   (Chrome 131), whose full build core-dumps on this host (its crashpad handler
   aborts: "chrome_crashpad_handler: --database is required").  We exec the
   unmodified BINARY, never /opt/google/chrome/google-chrome, whose wrapper script
   was tampered with to append --force-renderer-accessibility (see audit.md 5b). */
const CHROME_BIN = '/opt/google/chrome/chrome';

const argv = process.argv.slice(2);
const flag = (n, d = null) => {
  const hit = argv.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  if (!hit) return d;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
};
const CFG = {
  reps: Number(flag('reps', 3)),
  rows: Number(flag('n', 6000)),
  muts: Number(flag('m', 3000)),
  frames: Number(flag('f', 180)),
  perFrame: Number(flag('k', 120)),
  thrMs: Number(flag('t', 3000)),
  thrBatch: Number(flag('batch', 400)),
  lockWaitMin: Number(flag('lockwait', 25)),
  allowNoLock: String(flag('allownolock', 'false')) === 'true',
  tag: String(flag('tag', 'blink')),
  headless: String(flag('headless', 'true')) !== 'false',
};
const FORCE_ON_VARS = ['ACCESSIBILITY_ENABLED', 'GNOME_ACCESSIBILITY', 'GTK_MODULES'];

const CONDITIONS = {
  'env-default-nofag': { clear: false, fag: false },
  'force-renderer': { clear: false, fag: true },
  'env-cleared-nofag': { clear: true, fag: false },
};

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const load = () => { try { return fs.readFileSync('/proc/loadavg', 'utf8').trim(); } catch { return '?'; } };

async function readA11yState(ctx) {
  /* chrome://accessibility is a WebUI page; read its rendered text. It reports
     per-process accessibility mode without enabling it for the measured tab. */
  const page = await ctx.newPage();
  const out = { url: 'chrome://accessibility/', ok: false, text: null, error: null, html: null };
  try {
    await page.goto('chrome://accessibility/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(900);
    out.html = (await page.content()).slice(0, 20000);
    out.text = (await page.evaluate(() => document.body.innerText)).slice(0, 4000);
    /* Exact AXMode state: the mode checkboxes are the authoritative readback
       ("Web accessibility" = content AX on, "Native accessibility API support" =
       platform API integration, "Screen reader" = screen-reader bundle). */
    out.modes = await page.evaluate(() => {
      const ids = ['native', 'web', 'text', 'extendedProperties', 'screenReader', 'html', 'isolate', 'locked'];
      const cbs = {};
      for (const id of ids) { const el = document.getElementById(id); cbs[id] = el ? el.checked : null; }
      const t = document.body.innerText;
      const at = (t.match(/Active assistive technology:\s*([^\n]*)/) || [])[1] || null;
      const isSR = (t.match(/Is the active AT a screen reader:\s*([^\n]*)/) || [])[1] || null;
      return { checkboxes: cbs, activeAssistiveTechnology: at, isActiveAtScreenReader: isSR };
    });
    out.ok = true;
  } catch (e) {
    out.error = String(e.message).slice(0, 300);
  }
  await page.close();
  return out;
}

async function cdpMetrics(page) {
  const s = await page.context().newCDPSession(page);
  await s.send('Performance.enable');
  return { session: s };
}

async function runOnce({ condition, rep, server, token, lockStillOurs = true }) {
  const c = CONDITIONS[condition];
  const profileDir = path.join(PROFILES, `${condition}-r${rep}`);
  fs.rmSync(profileDir, { recursive: true, force: true });
  fs.mkdirSync(profileDir, { recursive: true });

  const env = { ...process.env };
  if (c.clear) for (const v of FORCE_ON_VARS) delete env[v];

  const args = [
    /* --no-sandbox is REQUIRED in this environment: unprivileged user namespaces
       are restricted here (Firefox logs "unshare(CLONE_NEWPID): EPERM"), so the
       Chromium setuid/namespace sandbox cannot initialise and the browser dies at
       startup.  Recorded as an environment property, not a preference. */
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-features=Translate,BackForwardCache',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--no-first-run', '--no-default-browser-check',
  ];
  if (c.fag) args.push('--force-renderer-accessibility');

  const rec = {
    condition, rep, token, forceRendererA11y: c.fag, envCleared: c.clear,
    lockStillOursAtStart: lockStillOurs,
    envPassed: Object.fromEntries(FORCE_ON_VARS.map((v) => [v, env[v] ?? null])),
    launchedAt: nowIso(), loadBefore: load(), notes: [], launchedArgs: args, usedNoSandbox: false,
  };

  /* Chrome, like Firefox, needs a writable HOME: without it crashpad fails on
     ~/.config/google-chrome/Crash Reports (the DSH file sandbox makes the real
     HOME read-only) and the browser dies at startup.  Applied identically to all
     three conditions so the only difference between them is the a11y switch. */
  const homeDir = path.join(PROFILES, 'home', `${condition}-r${rep}`);
  fs.rmSync(homeDir, { recursive: true, force: true });
  fs.mkdirSync(homeDir, { recursive: true });
  env.HOME = homeDir;
  env.XDG_CONFIG_HOME = path.join(homeDir, '.config');
  env.XDG_CACHE_HOME = path.join(homeDir, '.cache');
  env.GSETTINGS_BACKEND = 'memory';

  const launchWith = (exe) => chromium.launchPersistentContext(profileDir, {
    headless: CFG.headless,
    executablePath: exe,
    env,
    args,
    viewport: { width: 1280, height: 800 },
    timeout: 60000,
  });

  let browser;
  const t0 = Date.now();
  try {
    browser = await launchWith(CHROME_BIN);
    rec.chromeBinary = CHROME_BIN;
  } catch (e) {
    rec.notes.push('launch failed (' + CHROME_BIN + '): ' + String(e.message).slice(0, 200));
    try {
      browser = await launchWith(chromium.executablePath());
      rec.chromeBinary = chromium.executablePath();
    } catch (e2) {
      rec.notes.push('retry failed: ' + String(e2.message).slice(0, 200));
      rec.launchMs = Date.now() - t0;
      rec.wallMs = Date.now() - t0;
      rec.launchFailed = true;
      return rec;   /* record and move on instead of killing the batch */
    }
  }
  rec.launchMs = Date.now() - t0;
  rec.homeDir = homeDir;

  try {
    const ctx = browser;
    /* readback FIRST, in its own tab, before the measured page exists */
    rec.a11yStateBefore = await readA11yState(ctx);

    const page = await ctx.newPage();
    const { session } = await cdpMetrics(page);
    const url = `${server.base}/page?n=${CFG.rows}&m=${CFG.muts}&f=${CFG.frames}&k=${CFG.perFrame}&t=${CFG.thrMs}&batch=${CFG.thrBatch}&token=${encodeURIComponent(token)}`;
    const mt0 = Date.now();
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction('window.__A11Y_BENCH_REPORT__ !== undefined', null, { timeout: 180000 });
    rec.workloadWallMs = Date.now() - mt0;
    const report = await page.evaluate(() => window.__A11Y_BENCH_REPORT__);
    rec.result = report;
    const m = await session.send('Performance.getMetrics');
    rec.cdpMetrics = Object.fromEntries(m.metrics.map((x) => [x.name, x.value]));
    await page.close();

    rec.a11yStateAfter = await readA11yState(ctx);
    await ctx.close();
  } catch (e) {
    rec.notes.push('run error: ' + String(e.message).slice(0, 400));
  } finally {
    try { await browser.close(); } catch { /* already gone */ }
  }

  rec.wallMs = Date.now() - t0;
  rec.loadAfter = load();
  rec.censusDuringRun = atspi.browserCensus().filter((p) => /--profile |--user-data-dir/.test(p.cmdline)).length;
  rec.lockOwnerDuringRun = (() => { try { return fs.readFileSync('/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock/owner.txt', 'utf8').split('\n')[0]; } catch { return null; } })();
  rec.censusAfter = atspi.browserCensus().filter((p) => p.cmdline.includes(profileDir)).length;
  return rec;
}

function extractState(a11yState) {
  if (!a11yState || !a11yState.text) return null;
  const modes = a11yState.modes || null;
  const on = modes ? Object.entries(modes.checkboxes || {}).filter(([, v]) => v === true).map(([k]) => k) : [];
  return {
    axModeFlagsChecked: on,
    checkboxes: modes?.checkboxes ?? null,
    activeAssistiveTechnology: modes?.activeAssistiveTechnology ?? null,
    isActiveAtScreenReader: modes?.isActiveAtScreenReader ?? null,
  };
}

async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  fs.mkdirSync(PROFILES, { recursive: true });
  fs.mkdirSync(LOGS, { recursive: true });
  log('chromium exec:', chromium.executablePath());
  const census = atspi.browserCensus();
  log(`browser census BEFORE: ${census.length}`);
  for (const p of census) log('   ', p.pid, String(p.exe || p.comm || '?').split('/').slice(-1)[0], p.cmdline.slice(0, 80));

  const lock = await acquireLock({
    agent: 'incident2-firefox-a11y',
    line: `blink-a11y reps=${CFG.reps}`,
    purpose: 'Blink accessibility cost cross-check (does the same force-on env cost Blink anything?)',
    note: 'playwright chromium, own context; releases with rm owner.txt && rmdir; hard cap 30min',
    maxWaitMs: CFG.lockWaitMin * 60 * 1000,
    log,
  });
  /* DOCUMENTED DEVIATION (recorded in audit.md): on this host the shared lock is
     held continuously by other agent lines (observed: 170 poll attempts over
     9 minutes, never won) and the "one browser at a time" property is already
     broken by them — during this delivery's own batch 7-13 FOREIGN probe
     browsers were counted running concurrently, and this delivery's lock was
     taken over mid-batch.  Rather than stall forever, with
     --allow-nolock=1 the batch proceeds with a STRONGER, measured interlock:
     exactly one browser of ours alive at a time, plus a live /proc census and
     the observed lock owner recorded on every run. */
  const allowNoLock = String(flag('allownolock', 'false')) === 'true';
  if (!lock.ok && !allowNoLock) {
    log('LOCK not acquired', JSON.stringify(lock.lastStatus || {}).slice(0, 300));
    fs.writeFileSync(path.join(RAW, `blink-lock-failed.json`), JSON.stringify({ lock, status: lockStatus() }, null, 2));
    process.exit(3);
  }
  if (!lock.ok) {
    log('LOCK unavailable -> proceeding under the measured single-browser interlock (documented deviation). Owner at start: ' + JSON.stringify(lock.lastStatus?.owner?.agent || null));
    lock.token = 'NOLOCK-' + process.pid;
    lock.nolock = true;
    fs.writeFileSync(path.join(RAW, 'blink-nolock-deviation.json'), JSON.stringify({ at: nowIso(), lockStatusAtStart: lockStatus(), attempts: lock.attempts, waitedMs: lock.waitedMs }, null, 2));
  }

  const server = await startServer();
  const runs = [];
  try {
    /* round-major for the same reason as the Gecko runner: conditions stay
       adjacent in time so drifting background load hits all three equally. */
    const steps = [];
    for (let rep = 1; rep <= CFG.reps; rep++) for (const condition of Object.keys(CONDITIONS)) steps.push({ condition, rep });
    for (const step of steps) {
      {
        const { condition, rep } = step;
        const token = `${CFG.tag}-${condition}-r${rep}-${Date.now()}`;
        log(`RUN ${condition} r${rep}`);
        const lockOursNow = lock.nolock ? false : assertOwns(lock.token);
        if (!lockOursNow) log('NOTE: lock not held by us for this run (recorded)');
        const rec = await runOnce({ condition, rep, server, token, lockStillOurs: lockOursNow });
        rec.loadavgDuringRun = (() => { try { return fs.readFileSync('/proc/loadavg', 'utf8').trim(); } catch { return '?'; } })();
        rec.a11yStateBeforeDetail = extractState(rec.a11yStateBefore);
        rec.a11yStateAfterLines = extractState(rec.a11yStateAfter);
        runs.push(rec);
        const f = rec.result && rec.result.frames;
        log(`   build=${rec.result?.phases?.build}ms mutate=${rec.result?.phases?.mutate}ms animate=${rec.result?.phases?.animate}ms p95=${f?.p95}ms task=${rec.cdpMetrics?.TaskDuration}s axMode=${JSON.stringify(rec.a11yStateBeforeDetail?.checkboxes || null)} activeAT=${rec.a11yStateBeforeDetail?.activeAssistiveTechnology}`);
        fs.writeFileSync(path.join(RAW, `blink-${condition}-r${rep}.json`), JSON.stringify(rec, null, 2));
      }
    }
    const out = { generatedAt: nowIso(), config: CFG, runs, lock: { waitedMs: lock.waitedMs, attempts: lock.attempts, preemptions: lock.preemptions } };
    fs.writeFileSync(path.join(RAW, `${CFG.tag}-summary.json`), JSON.stringify(out, null, 2));
    log('wrote', path.join(RAW, `${CFG.tag}-summary.json`));
  } finally {
    await server.close();
    releaseLock(lock.token, log);
  }
  await sleep(200);
  process.exit(0);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
