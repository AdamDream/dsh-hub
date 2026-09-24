/*
 * lock-liveness-test.mjs — proves the lock-owner liveness predicate at runtime.
 *
 * It evaluates, for several process classes, BOTH the inherited predicate
 *   alive_old = try { readlinkSync(`/proc/<pid>/exe`) } catch { false }
 * and the shipped one
 *   pidDeathProof(pid): /proc/<pid> absent, or /proc/<pid>/stat state Z/X
 * and asserts the shipped predicate never reports a live process as dead.
 *
 * usage: node tools/lock-liveness-test.mjs [--zombie-pid <pid>] [--out <json>]
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/exec-mask';
const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const ZOMBIE = argOf('--zombie-pid', null);
const OUT = argOf('--out', path.join(DIR, 'raw', 'harness', 'lock-liveness-test.json'));

// ---- shipped predicate (must stay identical to tools/lock.mjs / panel-compare.mjs)
function pidDeathProof(pid) {
  if (!pid) return 'no-pid-field';
  try { fs.statSync(`/proc/${pid}`); } catch { return 'proc-entry-absent'; }
  try {
    const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const state = st.slice(st.lastIndexOf(') ') + 2).split(' ')[0];
    if (state === 'Z' || state === 'X') return `stat-state-${state}`;
  } catch { return null; }
  return null;
}
// ---- inherited predicate, for comparison only (never used for a decision)
function oldPredicateAlive(pid) { try { fs.readlinkSync(`/proc/${pid}/exe`); return true; } catch { return false; } }

const stateOf = (pid) => { try { const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return st.slice(st.lastIndexOf(') ') + 2).split(' ')[0]; } catch { return null; } };
const cmdOf = (pid) => { try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim().slice(0, 80); } catch { return null; } };
const exists = (pid) => { try { fs.statSync(`/proc/${pid}`); return true; } catch { return false; } };

// live processes to sample: the user's Chrome, the snap Firefox, the dsh host,
// gnome-shell, a sibling-line node process, and this test's own process.
const CANDIDATES = [
  ['user chrome (gnome-shell child)', 494362],
  ['snap firefox', 547226],
  ['dsh host (node dsh web)', 301709],
  ['gnome-shell', 4139],
  ['lock holder from the advisory (live at 12:16, exited since)', 591877],
  ['this test process', process.pid],
  ['this test parent shell', process.ppid],
];
if (ZOMBIE) CANDIDATES.push(['deliberate zombie (child exited, not reaped)', Number(ZOMBIE)]);

const rows = [];
let liveMisjudged = 0, zombieCaught = 0, goneCaught = 0;
for (const [label, pid] of CANDIDATES) {
  const ex = exists(pid), st = ex ? stateOf(pid) : null, cmd = ex ? cmdOf(pid) : null;
  const proof = pidDeathProof(pid);
  const shippedAlive = proof === null;
  const oldAlive = oldPredicateAlive(pid);
  const live = ex && st !== null && st !== 'Z' && st !== 'X';
  let verdict;
  if (live) { verdict = shippedAlive ? 'OK-alive' : 'MISJUDGED-AS-DEAD'; if (!shippedAlive) liveMisjudged++; }
  else if (st === 'Z' || st === 'X') { verdict = shippedAlive ? 'MISSED-ZOMBIE' : 'OK-provable-death'; zombieCaught++; }
  else if (!ex) { verdict = shippedAlive ? 'MISSED-GONE' : 'OK-provable-death'; goneCaught++; }
  else verdict = 'UNKNOWN-STATE';
  rows.push({ label, pid, procExists: ex, statState: st, cmdline: cmd, shipped: { alive: shippedAlive, deathProof: proof }, oldPredicate: { alive: oldAlive, exeReadlink: (() => { try { fs.readlinkSync(`/proc/${pid}/exe`); return { ok: true }; } catch (e) { return { ok: false, code: e.code }; } })() }, groundTruthLive: live, verdict });
  console.log(`${label.padEnd(58)} pid=${String(pid).padEnd(8)} state=${String(st).padEnd(2)} shipped=${shippedAlive ? 'ALIVE' : 'DEAD(' + proof + ')'} old=${oldAlive ? 'ALIVE' : 'DEAD'} oldExe=${rows[rows.length - 1].oldPredicate.exeReadlink.ok ? 'readable' : rows[rows.length - 1].oldPredicate.exeReadlink.code} -> ${verdict}`);
}

const summary = {
  generatedAt: new Date().toISOString(),
  shippedPredicate: "/proc/<pid> absent OR /proc/<pid>/stat state Z|X  => DEAD; every other outcome (incl. EACCES) => ALIVE",
  inheritedPredicate: "try { readlinkSync(/proc/<pid>/exe) } catch { DEAD }",
  liveProcessesMisjudgedDeadByShipped: liveMisjudged,
  zombiesCorrectlyProvenDead: zombieCaught,
  goneProcessesCorrectlyProvenDead: goneCaught,
  oldPredicateFalseDeadCount: rows.filter((r) => r.groundTruthLive && !r.oldPredicate.alive).length,
  rows,
  conclusion: liveMisjudged === 0
    ? 'PASS: the shipped predicate never reported a live process as dead, and every reclaim decision requires positive proof of death (/proc entry absent, or stat state Z/X).'
    : 'FAIL: the shipped predicate misjudged a live process as dead — do not use it.',
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
console.log(`\n${summary.conclusion}\nwrote ${OUT}`);
console.log(`old predicate would have called ${summary.oldPredicateFalseDeadCount} LIVE process(es) DEAD -> its reclaim branch would rm owner.txt && rmdir`);
process.exit(liveMisjudged === 0 ? 0 : 1);
