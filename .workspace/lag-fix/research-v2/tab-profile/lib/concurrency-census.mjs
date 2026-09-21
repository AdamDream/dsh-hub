/*
 * Concurrency census — evidence that no batch on this host was exclusive.
 *
 * Two sources, clearly separated:
 *   (a) LIVE census: what is running right now (process list, browser instances,
 *       their user-data-dirs), plus the lock state.
 *   (b) RETROACTIVE census: for every headless_shell process still alive, its
 *       absolute start time reconstructed from /proc/<pid>/stat (btime + starttime/HZ).
 *       A process whose start precedes a batch's end was alive during that batch.
 *       This gives a LOWER BOUND on foreign concurrency: processes that already
 *       exited are invisible to it.
 *
 * Read-only. Starts no browser. Non-browser work, so it holds no lock.
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/tab-profile/raw';
const LOCK_DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock';
const HOST_PID = 1390375;

/* batch windows under audit (local time, UTC+8) */
const BATCHES = [
  {
    id: 'unlocked', dir: 'raw/unlocked', start: '2026-09-21T14:55:00+08:00', end: '2026-09-21T15:13:00+08:00',
    directObservation: 'During this batch `ps` was used live and recorded >=3 concurrent headless Chromium instances on this host; tab-profile also leaked its own crashed-run browser from 15:04 until 15:28. Both are recorded in audit.md section 3.',
    directObservationForeignAtLeast: 3,
  },
  {
    id: 'locked', dir: 'raw/locked', start: '2026-09-21T15:44:41+08:00', end: '2026-09-21T15:55:16+08:00',
    directObservation: 'The lock was HELD by tab-profile for 42/42 windows, yet >=1 foreign browser instance was alive for the whole window (proved by process start time below).',
    directObservationForeignAtLeast: 1,
  },
];

const HZ = 100;
const btime = Number(/^btime (\d+)/m.exec(fs.readFileSync('/proc/stat', 'utf8'))[1]);
const localIso = (epochSec) => {
  const d = new Date(epochSec * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

function census() {
  const rows = [];
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    let cmd = '';
    try { cmd = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8'); } catch { continue; }
    if (!cmd.includes('headless_shell')) continue;
    let st = '';
    try { st = fs.readFileSync(`/proc/${d}/stat`, 'utf8'); } catch { continue; }
    const rp = st.lastIndexOf(')');
    const f = st.slice(rp + 2).split(' ');
    const startEpoch = btime + Number(f[19]) / HZ;
    let ppid = null;
    try { ppid = Number(/^PPid:\s*(\d+)/m.exec(fs.readFileSync(`/proc/${d}/status`, 'utf8'))[1]); } catch { }
    rows.push({
      pid: Number(d),
      ppid,
      isBrowserInstance: cmd.includes('--no-startup-window'),
      userDataDir: (/--user-data-dir=([^\0\s]+)/.exec(cmd) || [])[1] ?? null,
      startedLocal: localIso(startEpoch),
      startEpoch: Math.round(startEpoch),
      ourOwn: ppid === process.pid,
    });
  }
  return rows;
}

const rows = census();
const instances = rows.filter((r) => r.isBrowserInstance);

const ourPids = new Set(rows.filter((r) => r.ourOwn).map((r) => r.pid));

const liveLock = (() => {
  if (!fs.existsSync(LOCK_DIR)) return { held: false };
  let raw = '';
  try { raw = fs.readFileSync(path.join(LOCK_DIR, 'owner.txt'), 'utf8'); } catch { }
  const o = {};
  for (const line of raw.split('\n')) { const m = /^([A-Za-z_]+):\s*(.*)$/.exec(line.trim()); if (m) o[m[1]] = m[2]; }
  return { held: true, ownerAgent: o.agent ?? null, ownerPid: o.owner_pid ?? o.pid ?? null, startedAt: o.started_at ?? null, startedEpoch: o.started_epoch ? Number(o.started_epoch) : null };
})();

const retro = {};
for (const b of BATCHES) {
  const bStart = Date.parse(b.start) / 1000, bEnd = Date.parse(b.end) / 1000;
  const foreign = instances.filter((r) => !ourPids.has(r.pid) && r.startEpoch <= bEnd && r.startEpoch >= bStart - 86400);
  const spanning = foreign.filter((r) => r.startEpoch <= bStart);          // alive from batch start
  const stillNow = foreign.filter((r) => true);
  retro[b.id] = {
    batchWindow: [b.start, b.end],
    foreignBrowserInstancesAliveAtSomePointDuringBatch_lowerBound: foreign.length,
    foreignBrowserInstancesAliveFromBatchStart_lowerBound: spanning.length,
    evidence: foreign.map((r) => ({
      pid: r.pid, startedLocal: r.startedLocal, userDataDir: r.userDataDir,
      aliveFromBatchStart: r.startEpoch <= bStart,
      note: r.startEpoch <= bStart
        ? 'started BEFORE the batch and is STILL alive -> it was alive for 100% of the batch'
        : 'started during the batch and is still alive -> it overlapped the tail of the batch',
    })),
    directObservationForeignAtLeast: b.directObservationForeignAtLeast ?? null,
    directObservation: b.directObservation ?? null,
    caveat: 'LOWER BOUND ONLY: processes that started and exited during the batch are invisible to /proc after the fact, so a lower bound of 0 does NOT prove exclusivity.',
    /* Never certify exclusivity from a lower bound: 0 foreign survivors is
     * perfectly compatible with heavy concurrency that has since exited. */
    exclusiveCertified: false,
    exclusiveRefuted: foreign.length > 0,
    status: foreign.length > 0
      ? 'NOT EXCLUSIVE (refuted): at least one foreign browser was alive during the batch'
      : ((b.directObservationForeignAtLeast ?? 0) > 0
        ? 'NOT EXCLUSIVE (refuted by direct observation during the batch; retrospectively invisible)'
        : 'EXCLUSIVITY UNKNOWN (retroactive lower bound is 0, which proves nothing)'),
  };
}

const report = {
  generatedAtLocal: localIso(Date.now() / 1000),
  hostPid: HOST_PID,
  hostAlive: (() => { try { process.kill(HOST_PID, 0); return true; } catch (e) { return e.code === 'EPERM'; } })(),
  method: {
    live: 'scan /proc/*/cmdline for headless_shell; browser instances identified by --no-startup-window; our own processes identified by PPid == this census process, so this file reports only OTHER lines.',
    retroactive: 'absolute process start = /proc/stat btime + /proc/<pid>/stat field 22 / 100 Hz; a process whose start precedes a batch end was alive during that batch.',
    limitation: 'lower bound: exited processes leave no trace; per-window counts for the historical batches were NOT recorded live and cannot be reconstructed.',
  },
  live: {
    lock: liveLock,
    headlessShellProcessTotal: rows.length,
    browserInstanceTotal: instances.length,
    ourOwnProcCount: ourPids.size,
    foreignBrowserInstances: instances.filter((r) => !ourPids.has(r.pid)).length,
    foreignInstances: instances.filter((r) => !ourPids.has(r.pid)).map((r) => ({ pid: r.pid, startedLocal: r.startedLocal, userDataDir: r.userDataDir })),
    lockViolatedNow: liveLock.held && instances.filter((r) => !ourPids.has(r.pid)).length > 0,
  },
  retroactive: retro,
  conclusion: {
    unlockedBatch: retro.unlocked.status,
    lockedBatch: retro.locked.status,
    exclusiveCertifiedAnyBatch: false,
    headline: 'No tab-profile batch was exclusive, including the one whose lock tab-profile actually held. Per the standing order no further browser was launched to retry: exclusivity was empirically unobtainable (the coordinator measured 0/5 exclusive windows and 18-31 foreign Playwright processes per window during another line\'s 1635s lock hold).',
  },
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'concurrency-census.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
