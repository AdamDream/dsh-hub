/** Consolidate cross-line probe-lock evidence for audit.md. */
import fs from 'node:fs';
const DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/react-commit';
const read = (p) => JSON.parse(fs.readFileSync(`${DIR}/raw/${p}`, 'utf8'));

const locked = read('measure-locked.json');
const pre = read('measure-main.json');

const isBrowserProc = (cmd) => /headless_shell|chromium/.test(cmd) && !/--type=/.test(cmd);
function ownerScripts(foreign) {
  const set = new Map();
  for (const f of foreign || []) {
    for (const c of f.chain || []) {
      if (/node |bash -c/.test(c.cmd) && !/headless_shell/.test(c.cmd)) {
        const m = c.cmd.match(/([\w./-]+\.mjs)/);
        if (m) { set.set(m[1], (set.get(m[1]) || 0) + 1); break; }
      }
    }
  }
  return [...set.entries()].sort((a, b) => b[1] - a[1]);
}

const ACQUIRED_ISO = '2026-09-21T15:17:26+08:00';
const ACQUIRED_EPOCH = 1789975046;
const RELEASED_ISO = '2026-09-21T15:44:41+08:00';

const wins = locked.windows.map((w) => ({
  name: w.name,
  requested: w.requested,
  activeSection: w.activeSectionAtStart,
  lockHeldAtWindowStart: !!(w.lockAtWindowStart && w.lockAtWindowStart.present),
  foreignBrowsersAtStart: w.censusAtWindowStart && w.censusAtWindowStart.foreignCount,
  foreignBrowsersAtEnd: w.censusAtWindowEnd && w.censusAtWindowEnd.foreignCount,
  foreignOwnerScripts: ownerScripts(w.censusAtWindowStart && w.censusAtWindowStart.foreign),
  idleGateReached: !!(w.idleGateBeforeSampling && w.idleGateBeforeSampling.idle),
  idleGateWaitedMs: w.idleGateBeforeSampling && w.idleGateBeforeSampling.waitedMs,
  startIso: w.startIso, endIso: w.endIso,
  commits: w.agg.commits,
  sessionFrames: w.derived.sessionFrames,
  panelRootRenders: w.agg.tgt && w.agg.tgt.panel ? w.agg.tgt.panel.id : 0,
  panelRendersPerCommit: w.derived.panelCommitsPerCommit,
  settingsSubtreeRendersPerCommit: w.derived.subRenderedPerCommit,
  ancestorChainRenders: w.agg.chain,
  exclusive: (w.censusAtWindowStart && w.censusAtWindowStart.foreignCount === 0) && (w.censusAtWindowEnd && w.censusAtWindowEnd.foreignCount === 0),
}));

const allForeign = [];
for (const w of locked.windows) for (const f of (w.censusAtWindowStart && w.censusAtWindowStart.foreign) || []) allForeign.push(f);
const uniq = new Map();
for (const f of allForeign) {
  const owner = (f.chain || []).map((c) => (c.cmd.match(/([\w./-]+\.mjs)/) || [])[1]).find(Boolean) || 'unknown';
  if (!uniq.has(owner)) uniq.set(owner, { browserPid: f.browserPid, chain: (f.chain || []).map((c) => c.cmd) });
}

const out = {
  lock: {
    path: '.workspace/lag-fix/research-v2/.probe.lock',
    mechanism: 'atomic mkdir',
    acquiredIso: ACQUIRED_ISO,
    acquiredEpoch: ACQUIRED_EPOCH,
    releasedIso: RELEASED_ISO,
    heldSeconds: Math.round((Date.parse(RELEASED_ISO) - ACQUIRED_EPOCH * 1000) / 1000),
    acquiredOnFirstAttempt: true,
    preemptionPerformed: false,
    preemptionNote: 'no lock existed at 15:17:03, so a clean atomic mkdir succeeded; no stale-owner takeover was needed',
    releaseMechanism: 'rm owner.txt && rmdir (rmdir requires an empty directory; owner.txt must be removed first)',
    ownerTxtArchivedAt: 'raw/lock-owner.txt',
    ownerTxtContent: fs.readFileSync(`${DIR}/raw/lock-owner.txt`, 'utf8'),
    note_on_boot_read: 'meta.lockAtBoot in measure-locked.json reports a TDZ error ("Cannot access LOCK_DIR before initialization") because the reader was defined below its first use in the options object; per-window and end-of-run lock reads are unaffected and are the ones used for the verdict.',
  },
  predecessorWait: {
    observedBeforeMyBrowserStart: [
      { line: 'tab-profile', script: 'lib/tab-profile.mjs --phase=all --budget-min=20', browserPid: 1740805, startedAt: '2026-09-21T14:55:09+08:00', note: 'in-flight before my lock' },
      { line: 'measure-hardening', script: 'probes/harden-measure.mjs', startedAt: '2026-09-21T15:12:43+08:00', note: 'in-flight before my lock' },
    ],
    actionTaken: 'waited ~10 min for those two to end before starting my browser; they were immediately replaced by other lines (cpu-profile, probe.mjs, probe-threads, capture4, measure-slot, probe-theme-apply2/3, probe-hooks, /tmp/probe2.mjs)',
  },
  myBrowserSession: {
    startedAt: '2026-09-21T15:30:16Z (meta.startedAt of measure-locked.json)',
    endedAt: 'after L5, ~15:42 local',
    singleInstance: true,
    closedAfterRun: true,
  },
  violations: {
    lockHeldThroughoutMyBrowserSession: true,
    exclusiveWindowsAchieved: wins.filter((w) => w.exclusive).length,
    windowsAttempted: wins.length,
    distinctConcurrentLinesObserved: uniq.size,
    concurrentLines: [...uniq.values()].map((f) => ({ browserPid: f.browserPid, chain: f.chain.map((c) => c.cmd) })),
    notable: 'one concurrent line ran with an explicit --nolockwait flag (node measure-slot.mjs --tag main --window 60000 --nolockwait), i.e. deliberate lock bypass',
  },
  windows: wins,
  verdict: {
    preLockBatch: {
      tag: 'main', windows: pre.windows.length,
      lockHeld: false,
      verdict: 'INCONCLUSIVE',
      reason: 'collected before the cross-line probe lock existed/existed-and-was-held by me; concurrency not controlled',
    },
    lockedBatch: {
      tag: 'locked', windows: wins.length,
      lockHeld: true,
      exclusive: wins.filter((w) => w.exclusive).length > 0,
      verdict: 'INCONCLUSIVE',
      reason: 'lock was held for the whole browser session, but 18-31 foreign Playwright browser processes from >=6 other research lines were running during every window; the host was never exclusive, so the lock gave no protection',
    },
  },
};
fs.writeFileSync(`${DIR}/raw/lock-report.json`, JSON.stringify(out, null, 2));
console.log('lock held seconds:', out.lock.heldSeconds);
console.log('windows:', wins.length, 'exclusive:', out.violations.exclusiveWindowsAchieved);
console.log('distinct concurrent lines:', out.violations.distinctConcurrentLinesObserved);
for (const w of wins) console.log(' ', w.name.padEnd(24), 'lock=' + w.lockHeldAtWindowStart, 'foreign=' + w.foreignBrowsersAtStart + '/' + w.foreignBrowsersAtEnd, 'idleGate=' + w.idleGateReached, 'commits=' + w.commits, 'panel/commit=' + w.panelRendersPerCommit);
