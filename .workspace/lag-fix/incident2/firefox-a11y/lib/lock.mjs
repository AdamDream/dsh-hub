/*
 * Shared cross-line probe lock — this file reproduces the *documented*
 * protocol used by the coordinator (research-v2) so this delivery is
 * self-contained and interoperable.  It is NOT a new lock.
 *
 * Protocol (from the standing measurement discipline, verbatim):
 *   - acquire BEFORE launching any browser
 *   - while held by someone else: retry (graceful poll), give up after the wait budget
 *   - owner.txt records the owner's own PID in `owner_pid` (and legacy `pid`)
 *   - preempt ONLY when the owner's start is > 25 min old AND its process is gone
 *   - release = rm owner.txt && rmdir, and only if we still own it
 *
 * This module NEVER kills anything.  Preemption is by lock-directory removal and
 * only under the two conditions above.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const LOCK_DIR =
  '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock';
const OWNER_FILE = path.join(LOCK_DIR, 'owner.txt');
const PREEMPT_AGE_MIN = 25;
/* Guard for a lock orphaned by a writer that does not follow the canonical
   owner.txt schema.  Lower than PREEMPT_AGE_MIN because the owner pid is
   *provably dead* (checked in the kernel's process table), so nothing live can
   be disturbed; the remaining risk is only that a third party wrote a child's
   pid, which the caller's live-browser census covers. */
const ORPHAN_TAKEOVER_MIN = 10;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function nowIso(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const off = -d.getTimezoneOffset();
  const s = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${s}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function readOwner() {
  let raw = null;
  let mtimeMs = null;
  try {
    raw = fs.readFileSync(OWNER_FILE, 'utf8');
    mtimeMs = fs.statSync(OWNER_FILE).mtimeMs;
  } catch { /* absent */ }
  const owner = {};
  for (const line of (raw || '').split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line.trim());
    if (m) owner[m[1]] = m[2].trim();
  }
  /* Observed on this host 2026-09-22 11:00: a SECOND, non-canonical writer took
     the same lock directory and wrote a bare pid (owner.txt == "310374").  The
     canonical parser cannot read that, so the orphaned lock becomes invisible
     and deadlocks every well-behaved line.  Recognise the variant explicitly
     instead of silently ignoring it. */
  if (!owner.owner_pid && raw && /^\s*\d+\s*$/.test(raw)) {
    owner.owner_pid = raw.trim();
    owner.__format = 'bare-pid';
  }
  return { raw, owner, mtimeMs };
}

export function lockStatus() {
  if (!fs.existsSync(LOCK_DIR)) return { held: false };
  const { raw, owner, mtimeMs } = readOwner();
  let pid = null;
  for (const k of ['owner_pid', 'agent_pid', 'pid', 'probe_pid']) {
    const n = Number((owner[k] || '').match(/\d+/)?.[0]);
    if (Number.isInteger(n) && n > 0) { pid = n; break; }
  }
  const startEpoch = Number(owner.started_epoch || 0) || null;
  const ageMin = startEpoch ? Math.round(((Date.now() / 1000 - startEpoch) / 60) * 10) / 10 : null;
  const alive = pid ? pidAlive(pid) : null;
  const mtimeAgeMin = mtimeMs ? Math.round(((Date.now() - mtimeMs) / 60000) * 10) / 10 : null;
  /* Canonical owner (owner.txt carries started_epoch): letter of the protocol,
     age > 25 min AND owner process gone. */
  const canonicalPreemptable = ageMin != null && ageMin > PREEMPT_AGE_MIN && pid != null && alive === false;
  /* Orphaned non-canonical writer (bare pid or unparseable owner.txt) with a
     provably dead pid: there is no live owner left to protect, so the lock's
     own mtime is the only age signal available.  Documented deviation with a
     SHORTER guard (ORPHAN_TAKEOVER_MIN) plus a mandatory live-browser census in
     the caller; reported in evidence either way. */
  const orphan = !!raw && (!owner.owner_pid || owner.__format === 'bare-pid');
  const orphanTakeover = orphan && alive === false && mtimeAgeMin != null && mtimeAgeMin > ORPHAN_TAKEOVER_MIN;
  return {
    held: true, raw, owner, ownerPid: pid, ownerFormat: owner.__format || 'canonical',
    ownerProcessAlive: alive, startedEpoch: startEpoch, ageMin,
    mtimeAgeMin, orphan,
    preemptable: canonicalPreemptable,
    orphanTakeover,
  };
}

export async function acquireLock({ agent, line, purpose, note = '', maxWaitMs = 30 * 60 * 1000, log = console.log } = {}) {
  const t0 = Date.now();
  const preemptions = [];
  let attempts = 0;
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
        `started_at: ${nowIso()}`,
        `started_epoch: ${Math.floor(Date.now() / 1000)}`,
        `token: ${token}`,
        note ? `note: ${note}` : null,
      ].filter(Boolean).join('\n') + '\n');
      log(`LOCK acquired after ${Math.round((Date.now() - t0) / 1000)}s, ${attempts} retries, ${preemptions.length} preemption(s)`);
      return { ok: true, token, waitedMs: Date.now() - t0, attempts, preemptions };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    attempts++;
    const st = lockStatus();
    if (st.preemptable || st.orphanTakeover) {
      log(`LOCK stale (${st.preemptable ? 'canonical protocol' : 'ORPHAN TAKEOVER, documented deviation'}): owner=${st.owner?.agent || st.ownerFormat} age=${st.ageMin}min mtimeAge=${st.mtimeAgeMin}min pid=${st.ownerPid} gone -> preempt`);
      try {
        fs.rmSync(LOCK_DIR, { recursive: true, force: true });
        preemptions.push({ at: nowIso(), staleOwner: st.owner, staleRaw: st.raw, ageMin: st.ageMin, mtimeAgeMin: st.mtimeAgeMin, ownerPid: st.ownerPid, kind: st.preemptable ? 'canonical' : 'orphan-takeover' });
        continue;
      } catch { /* lost the race */ }
    }
    if (Date.now() - t0 > maxWaitMs) {
      return { ok: false, reason: 'timeout', waitedMs: Date.now() - t0, attempts, preemptions, lastStatus: st };
    }
    if (attempts === 1 || attempts % 10 === 0) {
      log(`LOCK busy (${attempts} tries, ${Math.round((Date.now() - t0) / 1000)}s): owner=${st.owner?.agent} pid=${st.ownerPid} alive=${st.ownerProcessAlive} age=${st.ageMin}min`);
    }
    await sleep(2000 + Math.floor(Math.random() * 2000));
  }
}

export function releaseLock(token, log = console.log) {
  try {
    const { owner } = readOwner();
    if (owner.token !== token) { log(`LOCK release skipped: we no longer own it (owner token ${owner.token})`); return false; }
    fs.rmSync(OWNER_FILE, { force: true });
    fs.rmdirSync(LOCK_DIR);
    log('LOCK released (rm owner.txt && rmdir)');
    return true;
  } catch (e) {
    log('LOCK release error: ' + e.message);
    return false;
  }
}


/** True while owner.txt still carries our token (single-hold interlock). */
export function assertOwns(token) {
  const { owner } = readOwner();
  return owner.token === token;
}
