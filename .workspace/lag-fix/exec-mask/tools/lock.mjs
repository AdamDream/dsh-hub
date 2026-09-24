/*
 * lock.mjs — acquire/release the shared probe mutex for the whole campaign.
 *
 * Protocol (obeyed exactly; a previous incident on this project destroyed a live
 * sibling's lock, so nothing here passes owner.txt through a shell):
 *   acquire : fs.mkdirSync(LOCK_DIR)            -> on success write owner.txt with
 *             EXACTLY ONE LINE: "pid: <pid>"
 *             on EEXIST  -> parse owner.txt LINE BY LINE in Node, read the "pid:"
 *             field, test liveness with /proc/<pid> EXISTENCE; a live owner is
 *             NEVER removed or overwritten. A dir with no readable owner.txt is
 *             the mid-acquire window -> keep waiting, never take it.
 * NOTE: liveness is /proc/<pid> existence + /proc/<pid>/stat state (Z/X = dead),
 * i.e. reclaim requires POSITIVE PROOF OF DEATH and every doubt resolves to
 * ALIVE. It is deliberately NOT readlink('/proc/<pid>/exe'): that readlink
 * returns EACCES for essentially every process on this box, which makes every
 * live sibling look dead and is how a live lock gets destroyed.
 *   release : only if owner.txt's own "pid:" line is ours -> rm owner.txt && rmdir
 *
 * usage: node lock.mjs acquire <waitSeconds> [--owner-pid <pid>]
 *        node lock.mjs release [--owner-pid <pid>]
 *        node lock.mjs status
 * --owner-pid must name a process that stays ALIVE for as long as the lock is
 * held (the campaign wrapper passes its own $$): a lock whose pid is already
 * dead is reclaimable by design, so recording a short-lived helper's pid would
 * silently hand the mutex to the next sibling.
 */
import fs from 'node:fs';
import path from 'node:path';

// Single source of truth for liveness: the group-wide corrected implementation.
// See .workspace/lag-fix/lib/probe-lock.mjs (D1: the inherited exe-readlink predicate
// reported LIVE owners as dead and would have deleted a live sibling's lock).
import { state as sharedState, ALIVE as SHARED_ALIVE, UNKNOWN as SHARED_UNKNOWN } from '../../lib/probe-lock.mjs';

const LOCK_DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock';
const OWNER = path.join(LOCK_DIR, 'owner.txt');
const cmd = process.argv[2] || 'status';
const ownerArgIdx = process.argv.indexOf('--owner-pid');
const OWNER_PID = ownerArgIdx > 0 && process.argv[ownerArgIdx + 1] ? Number(process.argv[ownerArgIdx + 1]) : process.pid;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/*
 * POSITIVE PROOF OF DEATH ONLY. A pid is reclaimed as dead ONLY when
 *   (a) /proc/<pid> does not exist at all (the pid is gone: there is no state
 *       left to read), or
 *   (b) /proc/<pid>/stat exists and its state field is Z (zombie) or X (dead).
 * Anything else -- including EACCES on any file under /proc/<pid> -- means
 * ALIVE. `readlink('/proc/<pid>/exe')` is NOT used anywhere for liveness: it
 * returns EACCES for essentially every process in this environment (verified
 * for the user's Chrome, the snap Firefox, the dsh host, gnome-shell, systemd
 * --user and sibling-line processes), so an exe-based predicate reports a LIVE
 * owner as dead and the next `acquire` would delete that owner's lock. Evidence:
 * raw/instrument-findings.json, and the live counter-example there (pid 591877,
 * a sibling runner, state S, reported DEAD by the old predicate).
 */
function pidDeathProof(pid) {
  if (!pid) return 'no-pid-field';
  const s = sharedState(pid);
  if (s === SHARED_ALIVE || s === SHARED_UNKNOWN) return null; // never reclaim without positive proof
  // s === DEAD: re-derive the human-readable proof, for logs only.
  try { fs.statSync(`/proc/${pid}`); } catch { return 'proc-entry-absent'; }
  try {
    const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const state = st.slice(st.lastIndexOf(') ') + 2).split(' ')[0];
    return `stat-state-${state}`;
  } catch { return 'shared-lib-DEAD'; }
}
function pidAlive(pid) { return pidDeathProof(pid) === null; }

function parseOwner() {
  let txt;
  try { txt = fs.readFileSync(OWNER, 'utf8'); } catch { return null; }
  // parse LINE BY LINE — never word-split, never shell-interpolate
  // single-line key=value, tolerant of BOTH `pid: N` (legacy, written by earlier revisions)
  // and `agent=... pid=N owner_pid=N ...` (the shared probe-lock.mjs format). Only the first
  // line is considered, and it is never word-split by a shell.
  let pid = null;
  const first = txt.split('\n')[0] || '';
  for (const seg of first.trim().split(/\s+/)) {
    const m = /^([A-Za-z_]+)\s*[:=]\s*(.+)$/.exec(seg);
    if (!m) continue;
    if ((m[1] === 'owner_pid' || m[1] === 'pid') && pid === null) pid = Number(m[2]) || null;
  }
  const proof = pidDeathProof(pid);
  const alive = proof === null;
  const state = (() => { try { const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); return st.slice(st.lastIndexOf(') ') + 2).split(' ')[0]; } catch { return null; } })();
  let age = null;
  try { age = Math.round((Date.now() - fs.statSync(OWNER).mtimeMs) / 1000); } catch {}
  return { txt: JSON.stringify(txt), pid, alive, statState: state, deathProof: proof, age };
}

if (cmd === 'status') {
  console.log(JSON.stringify({ lockDirExists: fs.existsSync(LOCK_DIR), owner: parseOwner() }, null, 1));
  process.exit(0);
}

if (cmd === 'acquire') {
  const waitMs = Math.max(0, Number(process.argv[3] ?? 180)) * 1000;
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      fs.mkdirSync(LOCK_DIR);
      // EXACTLY one line, in the shared probe-lock.mjs key=value form, written via
      // tmp+rename so there is no "dir created but owner not yet written" window.
      fs.writeFileSync(OWNER + '.tmp', `agent=exec-mask pid=${OWNER_PID} owner_pid=${OWNER_PID} started_at=${new Date().toISOString()} purpose=F1-mask-measurement\n`);
      fs.renameSync(OWNER + '.tmp', OWNER);
      console.log(`ACQUIRED owner pid=${OWNER_PID} (by ${process.pid}) at ${new Date().toISOString()}`);
      process.exit(0);
    } catch (e) {
      if (e.code !== 'EEXIST') { console.error(`acquire failed: ${e.code} ${e.message}`); process.exit(1); }
    }
    const o = parseOwner();
    if (!o) {
      console.log(`busy: dir exists, owner.txt unreadable/absent (mid-acquire window) — NOT taking it`);
    } else if (!o.alive) {
      console.log(`busy: owner pid=${o.pid} is PROVABLY DEAD (${o.deathProof}, age ${o.age}s) -> reclaiming`);
      try { fs.rmSync(OWNER, { force: true }); fs.rmdirSync(LOCK_DIR); } catch (e) { console.log(`reclaim failed: ${e.message}`); }
      continue;
    } else {
      console.log(`busy: LIVE owner pid=${o.pid} state=${o.statState} age=${o.age}s owner.txt=${o.txt} (never reclaimed; waiting)`);
    }
    if (Date.now() >= deadline) { console.log('BUSY-TIMEOUT'); process.exit(3); }
    await sleep(15000);
  }
}

if (cmd === 'release') {
  let txt = null;
  try { txt = fs.readFileSync(OWNER, 'utf8'); } catch { console.log('nothing to release (no owner.txt)'); process.exit(1); }
  let pid = null;
  for (const seg of (txt.split('\n')[0] || '').trim().split(/\s+/)) {
    const m = /^([A-Za-z_]+)\s*[:=]\s*(.+)$/.exec(seg);
    if (m && (m[1] === 'owner_pid' || m[1] === 'pid') && pid === null) pid = Number(m[2]) || null;
  }
  if (pid !== OWNER_PID) { console.log(`REFUSE: owner.txt pid=${pid} is not ours (${OWNER_PID}) — leaving it alone`); process.exit(1); }
  fs.rmSync(OWNER, { force: true });
  try { fs.rmdirSync(LOCK_DIR); } catch (e) { console.log(`rmdir failed: ${e.message}`); process.exit(1); }
  console.log(`RELEASED owner pid=${OWNER_PID}`);
  process.exit(0);
}

console.error(`unknown command ${cmd}`);
process.exit(2);
