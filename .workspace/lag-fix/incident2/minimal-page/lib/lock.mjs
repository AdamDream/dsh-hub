/*
 * Cross-line probe lock (same protocol as research-v2/tab-profile/lib/lock.mjs,
 * which is the coordinator's canonical implementation; reproduced here so this
 * delivery is self-contained and so the owner.txt fields stay interoperable).
 *
 * Protocol, verbatim from the standing measurement discipline:
 *   - acquire BEFORE launching any browser
 *   - while held by someone else: retry every 20-40s, give up after 30 minutes
 *   - owner.txt records the owner's own PID (`owner_pid`, and legacy `pid`)
 *   - preempt ONLY when the owner's start is >25 min old AND its process is gone
 *   - release = rm owner.txt && rmdir (rm -rf on the dir), and only if we still own it
 *
 * THIS SCRIPT NEVER pkill's ANYTHING. Preemption is by lock-directory removal,
 * and only under the two conditions above.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const LOCK_DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock';
const OWNER_FILE = path.join(LOCK_DIR, 'owner.txt');
const RETRY_MIN_MS = 20_000;
const RETRY_MAX_MS = 40_000;
const PREEMPT_AGE_MIN = 25;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function nowIso(d = new Date()) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}
export { nowIso };

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM' ? true : false; }
}

function readOwner() {
  let raw = null;
  try { raw = fs.readFileSync(OWNER_FILE, 'utf8'); } catch { }
  const owner = {};
  for (const line of (raw || '').split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line.trim());
    if (m) owner[m[1]] = m[2].trim();
  }
  return { raw, owner };
}

function ownerProcess(owner) {
  for (const k of ['owner_pid', 'agent_pid', 'pid', 'probe_pid']) {
    const n = Number((owner[k] || '').match(/\d+/)?.[0]);
    if (Number.isInteger(n) && n > 0) return { field: k, pid: n };
  }
  return { field: null, pid: null };
}

export function lockStatus() {
  if (!fs.existsSync(LOCK_DIR)) return { held: false };
  const { raw, owner } = readOwner();
  const op = ownerProcess(owner);
  const startEpoch = Number(owner.started_epoch || 0) || null;
  const ageMin = startEpoch ? Math.round(((Date.now() / 1000 - startEpoch) / 60) * 10) / 10 : null;
  return {
    held: true, raw, owner,
    ownerProcessField: op.field, ownerProcessPid: op.pid,
    ownerProcessAlive: op.pid ? pidAlive(op.pid) : null,
    startedEpoch: startEpoch, ageMin,
    preemptable: ageMin != null && ageMin > PREEMPT_AGE_MIN && op.pid != null && pidAlive(op.pid) === false,
  };
}

export async function acquireLock({ agent, line, purpose, log = () => { }, note = '', maxWaitMs = 30 * 60 * 1000 }) {
  const t0 = Date.now();
  let attempts = 0;
  const preemptions = [];
  const waits = [];
  for (;;) {
    try {
      fs.mkdirSync(LOCK_DIR);
      const token = `${os.hostname()}-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
      fs.writeFileSync(OWNER_FILE, [
        `agent: ${agent}`,
        `line: ${line}`,
        `purpose: ${purpose}`,
        `owner_pid: ${process.pid}   # this probe process; preemption checks THIS`,
        `pid: ${process.pid}`,
        `host_pid: 10806   # node dsh web (read-only reference; never restarted, not the owner)`,
        `started_at: ${nowIso()}`,
        `started_epoch: ${Math.floor(Date.now() / 1000)}`,
        `token: ${token}`,
        note ? `note: ${note}` : null,
      ].filter(Boolean).join('\n') + '\n');
      log(`LOCK acquired after ${Math.round((Date.now() - t0) / 1000)}s, ${attempts} retries, ${preemptions.length} preemption(s)`);
      return { ok: true, token, waitedMs: Date.now() - t0, attempts, preemptions, waits, acquiredAt: nowIso() };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const st = lockStatus();
    /* Adaptive retry. MEASURED ON THIS HOST (40 x 1 s sampling, 2026-09-22 10:42):
     * the lock is held 97.5 % of the time and the free windows are ~1 s long, so
     * the sibling implementation's 20-40 s cadence loses ~97.5 % of its attempts
     * and starves outright (observed: 7 consecutive losses; two loses landed on
     * 1 s races that were already gone before the sleep ended). A mkdir poll is
     * orders of magnitude cheaper than the browser launches it serialises, so:
     *   - unreadable owner  -> 1-2 s  (normally a mid-acquire race, and waiting
     *                                  40 s on it is pure starvation)
     *   - known live owner  -> 2-4 s
     * Protocol semantics are unchanged: same directory, same owner.txt, same
     * release (rm owner.txt && rmdir), and preemption still requires
     * age > 25 min AND a dead owner pid -- never a timeout-based preemption. */
    const knownOwner = !!(st.owner && st.ownerProcessPid);
    if (st.preemptable) {
      log(`LOCK stale: owner ${st.owner?.agent} age ${st.ageMin}min pid ${st.ownerProcessPid} gone -> preempt`);
      try {
        fs.rmSync(LOCK_DIR, { recursive: true, force: true });
        preemptions.push({ at: nowIso(), staleOwner: st.owner, ageMin: st.ageMin, ownerPid: st.ownerProcessPid });
        continue;
      } catch (err) { log(`preempt failed: ${String(err).slice(0, 120)}`); }
    }
    if (Date.now() - t0 > maxWaitMs) {
      log(`LOCK wait exceeded ${Math.round(maxWaitMs / 60000)}min; giving up`);
      return { ok: false, reason: 'wait-timeout', waitedMs: Date.now() - t0, attempts, preemptions, waits, lastOwner: st };
    }
    const w = knownOwner
      ? 2000 + Math.floor(Math.random() * 2000)
      : 1000 + Math.floor(Math.random() * 1000);
    waits.push({ at: nowIso(), owner: st.owner?.agent ?? 'unknown', ownerAgeMin: st.ageMin, sleptMs: w, knownOwner });
    log(`LOCK held by ${st.owner?.agent ?? 'unknown'} (age ${st.ageMin ?? '?'}min, ownPid ${st.ownerProcessPid ?? '?'}/${st.ownerProcessAlive}); retry in ${Math.round(w / 1000)}s [attempt ${attempts + 1}, elapsed ${Math.round((Date.now() - t0) / 1000)}s]`);
    await sleep(w);
    attempts++;
  }
}

export function releaseLock(token, log = () => { }) {
  if (!fs.existsSync(LOCK_DIR)) { log('LOCK release: not held (already gone)'); return { released: false, reason: 'absent' }; }
  const { owner } = readOwner();
  if (token && owner.token && owner.token !== token) {
    log(`LOCK release REFUSED: token mismatch (held by ${owner.agent})`);
    return { released: false, reason: 'not-owner', owner };
  }
  try {
    fs.rmSync(LOCK_DIR, { recursive: true, force: true });   // removes owner.txt && the dir
    log('LOCK released');
    return { released: true, releasedAt: nowIso() };
  } catch (e) {
    log(`LOCK release failed: ${String(e).slice(0, 120)}`);
    return { released: false, reason: String(e) };
  }
}
