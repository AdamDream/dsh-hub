/*
 * Gecko launcher — the ONLY Firefox this harness is allowed to touch.
 *
 * Constraints baked in (from the task discipline):
 *   - The user's own Firefox (snap, running) must never be disturbed:
 *     we always pass --no-remote --new-instance and an explicit private
 *     --profile under /tmp, so our instance cannot attach to theirs.
 *   - No pkill / no killall anywhere: teardown signals EXACTLY the child PID
 *     this module spawned (and its own process group), nothing else.
 *   - The DSH file sandbox is workspace-write, so $HOME itself is NOT writable.
 *     Firefox needs a writable HOME + profile, therefore HOME=/tmp/<ffhome>.
 *     (Verified: with the real $HOME, Firefox 155 aborts with
 *      "Could not find profile folder." because it cannot create ~/.mozilla.)
 *   - Snap confinement is bypassed by exec'ing the snap payload directly
 *     (/snap/firefox/<rev>/usr/lib/firefox/firefox); the snap's own home
 *     interface would hide dot-directories such as .workspace anyway.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { BidiClient } from './bidi.mjs';

export const FF_BIN = '/snap/firefox/8863/usr/lib/firefox/firefox';
export const FF_HOME = '/tmp/gvb-ffhome';
const PROFILE_ROOT = '/tmp/gvb-profiles';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** The DPR switch actually used for Gecko: a profile user.js pref. */
export function devicePixelRatioPrefs(dpr) {
  return [`user_pref("layout.css.devPixelsPerPx", "${dpr}");`];
}

export function writeProfile(tag, { dpr = null, extraPrefs = [] } = {}) {
  const dir = ensureDir(path.join(PROFILE_ROOT, tag));
  // fresh profile every run: no cross-run state, no user data
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { recursive: true, force: true });
  const prefs = [
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("browser.startup.homepage_override.mstone", "ignore");',
    'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
    'user_pref("datareporting.healthreport.uploadEnabled", false);',
    'user_pref("toolkit.telemetry.enabled", false);',
    'user_pref("toolkit.telemetry.unified", false);',
    'user_pref("app.update.enabled", false);',
    'user_pref("browser.aboutConfig.showWarning", false);',
    'user_pref("browser.sessionstore.resume_from_crash", false);',
  ];
  if (dpr != null) prefs.push(...devicePixelRatioPrefs(dpr));
  prefs.push(...extraPrefs);
  fs.writeFileSync(path.join(dir, 'user.js'), prefs.join('\n') + '\n');
  return dir;
}

export function ffVersion() {
  return new Promise((resolve) => {
    const p = spawn(FF_BIN, ['--version'], { env: { ...process.env, HOME: FF_HOME }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', () => resolve(out.trim()));
    p.on('error', (e) => resolve(`spawn error: ${e.message}`));
  });
}

/**
 * Launch one headless Firefox with its own profile and BiDi port.
 * Returns { proc, pid, port, wsUrl, profileDir, logPath, gfxLines, close() }.
 */
export async function launchFirefox({
  tag, port, dpr = null, width = 1280, height = 800, extraPrefs = [],
  logDir, waitMs = 45_000,
} = {}) {
  ensureDir(FF_HOME);
  const profileDir = writeProfile(tag, { dpr, extraPrefs });
  const logPath = path.join(logDir || '/tmp', `ff-${tag}.log`);
  const logFd = fs.openSync(logPath, 'w');

  const args = [
    '--headless',
    '--no-remote',
    '--new-instance',
    '--profile', profileDir,
    `--remote-debugging-port=${port}`,
    `--width=${width}`,
    `--height=${height}`,
    'about:blank',
  ];
  const proc = spawn(FF_BIN, args, {
    env: {
      ...process.env,
      HOME: FF_HOME,
      MOZ_HEADLESS: '1',
      // keep the run reproducible and quiet
      MOZ_CRASHREPORTER: '0',
      MOZ_CRASHREPORTER_DISABLE: '1',
      MOZ_DISABLE_AUTO_SAFE_MODE: '1',
      // dconf is unwritable in the sandbox; GSETTINGS backend off avoids noise
      GSETTINGS_BACKEND: 'memory',
      // do NOT inherit the user's session display: pure headless
      DISPLAY: '',
      WAYLAND_DISPLAY: '',
    },
    stdio: ['ignore', logFd, logFd],
    detached: true,
  });

  const startedAt = Date.now();
  let wsUrl = null;
  let exited = null;
  proc.on('exit', (code, sig) => { exited = { code, sig }; });

  while (Date.now() - startedAt < waitMs) {
    if (exited) break;
    let txt = '';
    try { txt = fs.readFileSync(logPath, 'utf8'); } catch { }
    const m = /WebDriver BiDi listening on (ws:\/\/[^\s]+)/.exec(txt);
    if (m) { wsUrl = m[1]; break; }
    await sleep(250);
  }

  const readLog = () => { try { return fs.readFileSync(logPath, 'utf8'); } catch { return ''; } };
  const gfxLines = () => readLog().split('\n').filter((l) => /GFX1|WebRender|compositor|WebDriver BiDi/i.test(l)).slice(0, 40);

  if (!wsUrl) {
    const txt = readLog();
    const info = {
      tag, pid: proc.pid, logPath, profileDir, exited,
      startupFailed: true,
      logTail: txt.split('\n').slice(-15).join('\n'),
    };
    try { process.kill(-proc.pid, 'SIGKILL'); } catch { }
    try { process.kill(proc.pid, 'SIGKILL'); } catch { }
    try { fs.closeSync(logFd); } catch { }
    const e = new Error(`Firefox did not expose BiDi within ${waitMs}ms (tag=${tag}): ${info.logTail}`);
    e.info = info;
    throw e;
  }

  return {
    proc, pid: proc.pid, port, wsUrl, profileDir, logPath,
    gfxLines,
    logText: readLog,
    async close() {
      // signal ONLY our own process group / pid
      try { process.kill(-proc.pid, 'SIGTERM'); } catch { }
      try { process.kill(proc.pid, 'SIGTERM'); } catch { }
      const t0 = Date.now();
      while (!exited && Date.now() - t0 < 4000) await sleep(100);
      if (!exited) {
        try { process.kill(-proc.pid, 'SIGKILL'); } catch { }
        try { process.kill(proc.pid, 'SIGKILL'); } catch { }
      }
      try { fs.closeSync(logFd); } catch { }
      return exited;
    },
  };
}

export async function connectBidi(inst, { retries = 20 } = {}) {
  let last = null;
  for (let i = 0; i < retries; i++) {
    try {
      const c = await BidiClient.connect(inst.wsUrl);
      return c;
    } catch (e) { last = e; await sleep(400); }
  }
  throw last || new Error('BiDi connect failed');
}

export function hostFacts() {
  return {
    cpus: os.cpus().length,
    totalMemGB: +(os.totalmem() / 1e9).toFixed(1),
    loadavg: os.loadavg(),
    platform: `${os.platform()} ${os.release()}`,
  };
}
