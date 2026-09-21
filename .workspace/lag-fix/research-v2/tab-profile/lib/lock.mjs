/*
 * Cross-line probe lock.
 *
 * Four sibling research lines share this host and each runs headless browser
 * probes; running them concurrently pollutes every line's frame/long-task data.
 * The lock is a directory (mkdir is atomic on this filesystem), so acquisition
 * needs no extra coordination primitive.
 *
 * Rules implemented here, verbatim from the measurement discipline:
 *   - acquire BEFORE launching any browser
 *   - while held by someone else: retry every 20-40s, give up after 30 minutes
 *   - write owner.txt (agent name, owner PID, start time)
 *   - preempt ONLY when the owner's start is >25 minutes old AND its process is gone
 *   - always rmdir on the way out, and only if we still own it
 *   - record every preemption so it can be reported
 *
 * Note on owner.txt schema: the sibling line's file records `host_pid` = the
 * monitored GUI host (1390375), which is alive by definition and is NOT the
 * owner's own process. Preemption therefore keys on an owner-process field
 * (`owner_pid` / `agent_pid` / `pid`) and treats a missing one as "unknown,
 * do not preempt" -- we never guess. Our own owner.txt writes BOTH.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const LOCK_DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock';
const OWNER_FILE = path.join(LOCK_DIR, 'owner.txt');
const MAX_WAIT_MS = 30 * 60 * 1000;
const RETRY_MIN_MS = 20_000;
const RETRY_MAX_MS = 40_000;
const PREEMPT_AGE_MIN = 25;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* local-time ISO-8601 with offset. (Earlier version stamped UTC digits with a
 * +08:00 suffix, which misread by 8h; started_epoch was always correct and
 * remains the authoritative field.) */
function nowIso(d = new Date()) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM' ? true : false; }
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

/* Which field is the owner's own process? host_pid is explicitly NOT it. */
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

export async function acquireLock({ agent, line, purpose, log = () => { }, note = '' }) {
  const t0 = Date.now();
  let attempts = 0;
  const preemptions = [];
  const waits = [];

  for (;;) {
    try {
      fs.mkdirSync(LOCK_DIR); // atomic: throws EEXIST if held
      const token = `${os.hostname()}-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
      fs.writeFileSync(OWNER_FILE, [
        `agent: ${agent}`,
        `line: ${line}`,
        `purpose: ${purpose}`,
        `owner_pid: ${process.pid}   # the probe process; preemption checks THIS`,
        `host_pid: 1390375   # monitored GUI host (node dsh web); never restarted, not the owner`,
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
    if (st.preemptable) {
      log(`LOCK stale: owner ${st.owner?.agent} age ${st.ageMin}min, pid ${st.ownerProcessPid} gone -> preempting`);
      try {
        fs.rmSync(LOCK_DIR, { recursive: true, force: true });
        preemptions.push({ at: nowIso(), staleOwner: st.owner, ageMin: st.ageMin, ownerPid: st.ownerProcessPid });
        continue;
      } catch (err) { log(`preempt failed: ${String(err).slice(0, 120)}`); }
    }

    if (Date.now() - t0 > MAX_WAIT_MS) {
      log(`LOCK wait exceeded 30min; giving up`);
      return { ok: false, reason: 'wait-timeout-30min', waitedMs: Date.now() - t0, attempts, preemptions, waits, lastOwner: st };
    }

    const w = RETRY_MIN_MS + Math.floor(Math.random() * (RETRY_MAX_MS - RETRY_MIN_MS));
    waits.push({ at: nowIso(), owner: st.owner?.agent ?? 'unknown', ownerAgeMin: st.ageMin, sleptMs: w });
    log(`LOCK held by ${st.owner?.agent ?? 'unknown'} (age ${st.ageMin ?? '?'}min, ownPid ${st.ownerProcessPid ?? 'unknown'}/${st.ownerProcessAlive}); retry in ${Math.round(w / 1000)}s [attempt ${attempts + 1}, elapsed ${Math.round((Date.now() - t0) / 1000)}s]`);
    await sleep(w);
    attempts++;
  }
}

export function releaseLock(token, log = () => { }) {
  if (!fs.existsSync(LOCK_DIR)) { log('LOCK release: not held (already gone)'); return { released: false, reason: 'absent' }; }
  const { owner } = readOwner();
  if (token && owner.token && owner.token !== token) {
    log(`LOCK release REFUSED: owner token mismatch (held by ${owner.agent})`);
    return { released: false, reason: 'not-owner', owner };
  }
  try {
    fs.rmSync(LOCK_DIR, { recursive: true, force: true });
    log('LOCK released');
    return { released: true, releasedAt: nowIso() };
  } catch (e) {
    log(`LOCK release failed: ${String(e).slice(0, 120)}`);
    return { released: false, reason: String(e) };
  }
}

/* used by an external watcher: prints lock state as JSON */
if (process.argv[1] && process.argv[1].endsWith('lock.mjs')) {
  console.log(JSON.stringify(lockStatus(), null, 1));
}
