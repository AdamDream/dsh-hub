/*
 * Exact browser-instance census.
 *
 * Discipline: NEVER `pgrep -f` (it self-matches the census command line itself).
 * Every number below comes from reading /proc directly, and "mine" is decided by
 * walking the /proc/<pid>/status PPid chain up to this node process instead of by
 * name matching, so a foreign instance of the very same binary is still foreign.
 *
 * MEASURED ENVIRONMENT CONSTRAINT (evidence in audit.md):
 *   /proc/sys/kernel/yama/ptrace_scope = 1, therefore readlink("/proc/<pid>/exe")
 *   SUCCEEDS for this process's own descendants and FAILS WITH EACCES for every
 *   other process, including other same-UID research lines and pid 1.
 *   Verified: `readlink -v /proc/<pid>/exe` -> "权限不够" for a peer's
 *   headless_shell, while the same call on our own child returns /usr/bin/sleep.
 * So each row records HOW it was identified, and the census reports the method
 * mix, rather than silently pretending `exe` was always available:
 *   proc-exe      readlink(/proc/<pid>/exe) succeeded  (own descendants)
 *   cmdline-argv0 absolute argv[0] from /proc/<pid>/cmdline (readable for peers)
 *   comm          /proc/<pid>/comm only (15-char truncated name)
 * Classification uses whichever of these is available; cmdline-argv0 and comm are
 * exact reads of kernel-provided fields, not a pattern scan of an unrelated
 * process table, and our own pid tree is excluded structurally (never by name).
 *
 * Read-only, starts nothing, holds no lock.
 */
import fs from 'node:fs';

/* FIXED (review B8): the original basename/comm allowlist was exact-match, so a
 * foreign browser from another build (chrome-headless-shell as named by
 * Playwright >= 1.50, google-chrome-stable, chromium-browser, msedge, electron)
 * was invisible and the census would have reported "0 foreign instances" on a
 * busy host. Now: substring match on the executable basename or comm. */
const BROWSER_NAME_RE = /(chrome|chromium|headless[-_]?shell|msedge|electron)/i;
const CRASHPAD_RE = /crashpad/i;

function readlinkExe(pid) {
  try { return { path: fs.readlinkSync(`/proc/${pid}/exe`), err: null }; }
  catch (e) { return { path: null, err: e.code || String(e) }; }
}
function readCmdline(pid) {
  try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch { return null; }
}
/*
 * /proc/<pid>/cmdline is NUL-separated for processes we may ptrace, but for the
 * sandboxed (non-dumpable) Chromium processes on this host the kernel hands back
 * the SAME bytes with the separating NULs collapsed to spaces (measured: 875-byte
 * argv block with exactly one NUL, versus 14 NULs for a peer's node process).
 * Parse both shapes instead of trusting either one.
 */
export function parseArgv(raw) {
  if (raw == null) return null;
  const trimmed = raw.replace(/\0+$/, '');
  let args = trimmed.split('\0').filter(Boolean);
  let joined = false;
  if (args.length <= 1) { args = trimmed.split(/\s+/).filter(Boolean); joined = true; }
  return { args, joined, raw: trimmed, argv0: args[0] || null };
}
function readComm(pid) {
  try { return fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim(); } catch { return null; }
}
function readPpid(pid) {
  try {
    const m = /^PPid:\s*(\d+)/m.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8'));
    return m ? Number(m[1]) : null;
  } catch { return null; }
}
export function ptraceScope() {
  try { return Number(fs.readFileSync('/proc/sys/kernel/yama/ptrace_scope', 'utf8').trim()); } catch { return null; }
}
function btime() {
  try { return Number(/^btime (\d+)/m.exec(fs.readFileSync('/proc/stat', 'utf8'))[1]); } catch { return 0; }
}
const HZ = 100;
export function startTimeEpoch(pid) {
  try {
    const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rp = st.lastIndexOf(')');
    const f = st.slice(rp + 2).split(' ');
    return btime() + Number(f[19]) / HZ;
  } catch { return null; }
}

export function listPids() {
  try { return fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).map(Number); } catch { return []; }
}

/** true if `pid` is `rootPid` or any descendant of it (structural, not name-based) */
export function isMine(pid, rootPid = process.pid, memo = new Map()) {
  let cur = pid, hops = 0;
  const walked = [];
  while (cur && cur > 1 && hops++ < 64) {
    if (cur === rootPid) { for (const w of walked) memo.set(w, true); return true; }
    /* FIXED (review S10): the memo was read but never written, so every pid
     * re-walked its whole PPid chain on every census (≈700 processes × ~4 reads
     * per census, 4 censuses per 3 s dwell, inside the measured window). */
    if (memo.has(cur)) { const v = memo.get(cur); for (const w of walked) memo.set(w, v); return v; }
    walked.push(cur);
    cur = readPpid(cur);
  }
  for (const w of walked) memo.set(w, false);
  return false;
}

/* FIXED (review B7): state was never read, so a zombie (state Z) whose
 * /proc/<pid>/cmdline is empty fell through to the comm fallback and was
 * counted as a LIVE foreign browser instance. Verified on this host: the
 * comm-identified pid 27904 was state=Z. */
export function procState(pid) {
  try {
    const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rp = st.lastIndexOf(')');
    return st.slice(rp + 2).split(' ')[0] || null;
  } catch { return null; }
}

/**
 * Census of browser processes alive right now.
 * A process is a "browser instance" (one launched browser) when its command line
 * carries no `--type=` switch; every renderer/gpu/utility/zygote child has one.
 */
export function browserCensus({ rootPid = process.pid, extraMinePids = [], includeDetail = true } = {}) {
  const memo = new Map();
  const mineRoots = [rootPid, ...extraMinePids];
  const all = [];
  const methodMix = { 'proc-exe': 0, 'cmdline-argv0': 0, comm: 0 };
  let exeEacces = 0, exeOtherErr = 0;
  const skippedZombies = [];
  for (const pid of listPids()) {
    const state = procState(pid);
    if (state === 'Z' || state === 'X') { skippedZombies.push({ pid, state }); continue; }
    const { path: exePath, err } = readlinkExe(pid);
    const parsed = parseArgv(readCmdline(pid));
    const comm = readComm(pid);
    const argv0 = parsed ? parsed.argv0 : null;
    const rawCmd = parsed ? parsed.raw : '';
    let method = null, ident = null, headlessPath = null;
    if (exePath) { method = 'proc-exe'; ident = exePath; headlessPath = exePath; }
    else {
      if (err === 'EACCES') exeEacces++; else if (err) exeOtherErr++;
      if (argv0 && argv0.startsWith('/')) { method = 'cmdline-argv0'; ident = argv0; }
      else if (comm) { method = 'comm'; ident = comm; }
    }
    if (!ident) continue;
    const base = String(ident).split(/\//).pop();
    const isCrashpad = CRASHPAD_RE.test(base) || CRASHPAD_RE.test(comm || '');
    const isBrowser = BROWSER_NAME_RE.test(base) || BROWSER_NAME_RE.test(comm || '');
    if (!isBrowser) continue;
    methodMix[method] = (methodMix[method] || 0) + 1;
    const typeM = /(?:^|\s)--type=([\w.-]+)/.exec(rawCmd);
    const hasType = !!typeM;
    const udd = (/--user-data-dir=(\S+)/.exec(rawCmd) || [])[1] || null;
    const mine = mineRoots.some((r) => isMine(pid, r, memo));
    all.push({
      pid, ident, exe: exePath, comm, method, exeReadable: !!exePath, exeErr: exePath ? null : err,
      cmdlineJoinedBySpaces: parsed ? parsed.joined : null,
      isInstance: !hasType && !isCrashpad, isCrashpad, userDataDir: udd, mine,
      startedEpoch: startTimeEpoch(pid),
      headless: /(?:^|\s)--headless(?:=|\s|$)/.test(rawCmd) || (!!headlessPath && /headless_shell/.test(headlessPath)),
      display: (/--display=(\S+)/.exec(rawCmd) || [])[1] || null,
      type: typeM ? typeM[1] : null,
      noStartupWindow: /(?:^|\s)--no-startup-window(?:\s|$)/.test(rawCmd),
    });
  }
  const instances = all.filter((r) => r.isInstance);
  const foreignInstances = instances.filter((r) => !r.mine);
  const foreignProcs = all.filter((r) => !r.mine);
  const out = {
    at: Date.now(),
    ptraceScope: ptraceScope(),
    exeReadEaccesCount: exeEacces, exeReadOtherErrCount: exeOtherErr,
    zombiesSkipped: skippedZombies.length,
    identifyMethodMix: methodMix,
    nameAllowlist: String(BROWSER_NAME_RE),
    browserProcTotal: all.length,
    instanceTotal: instances.length,
    mineInstanceTotal: instances.filter((r) => r.mine).length,
    mineProcTotal: all.filter((r) => r.mine).length,
    foreignInstanceTotal: foreignInstances.length,
    foreignProcTotal: foreignProcs.length,
    foreignInstances: foreignInstances.map((r) => ({
      pid: r.pid, ident: r.ident, method: r.method, headless: r.headless, userDataDir: r.userDataDir,
      startedEpoch: r.startedEpoch,
    })),
    mineInstances: instances.filter((r) => r.mine).map((r) => ({ pid: r.pid, ident: r.ident, method: r.method, headless: r.headless })),
  };
  if (includeDetail) out.detail = all;
  return out;
}

export function loadAvg() {
  try {
    const [a, b, c] = fs.readFileSync('/proc/loadavg', 'utf8').trim().split(/\s+/);
    return { l1: Number(a), l5: Number(b), l15: Number(c) };
  } catch { return null; }
}
export function cpuCount() {
  try {
    const st = fs.readFileSync('/proc/stat', 'utf8');
    return (st.match(/^cpu\d+/gm) || []).length || null;
  } catch { return null; }
}
