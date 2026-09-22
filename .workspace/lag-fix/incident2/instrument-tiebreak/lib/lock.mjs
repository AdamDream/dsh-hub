/*
 * Cross-line probe lock — single-line protocol (per the standing discipline
 * recorded for this batch after two lock incidents):
 *
 *   owner.txt  = ONE line:  `pid: <n>`
 *   release    = `rm .probe.lock/owner.txt && rmdir .probe.lock`
 *
 * Hard rules implemented here:
 *   1. NEVER delete / overwrite a lock whose owner pid is ALIVE (including when
 *      the file is malformed — a malformed file owned by a live pid is left alone).
 *   2. Release ONLY when owner.txt parses to OUR pid.
 *   3. Release NEVER uses recursive delete; it is unlink(file) then rmdir(dir).
 *      A stray file in the dir therefore cannot turn into an empty-lock dir that
 *      blocks the team (the `rmSync(dir)` -> EISDIR failure mode).
 *   4. No pkill, ever. No signals to any process.
 */
import fs from 'node:fs';
import path from 'node:path';

export const LOCK_DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock';
const OWNER_FILE = path.join(LOCK_DIR, 'owner.txt');
const MY_PID = process.pid;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

function readOwnerPid() {
  let raw = null;
  try { raw = fs.readFileSync(OWNER_FILE, 'utf8'); } catch { return { raw: null, pid: null }; }
  // single-line protocol first; fall back to a key:value scan for foreign writers.
  const m0 = /(?:^|\n)\s*pid\s*:\s*(\d+)/.exec(raw);
  if (m0) return { raw, pid: Number(m0[1]) };
  const m1 = /(?:owner_pid|agent_pid|probe_pid)\s*:\s*(\d+)/.exec(raw);
  if (m1) return { raw, pid: Number(m1[1]) };
  return { raw, pid: null };
}

export function lockStatus() {
  if (!fs.existsSync(LOCK_DIR)) return { held: false };
  const { raw, pid } = readOwnerPid();
  return { held: true, raw, pid, alive: pid ? pidAlive(pid) : null, malformed: pid === null };
}

export async function acquireLock({ line, purpose, log = () => {}, maxWaitMs = 25 * 60 * 1000 }) {
  const t0 = Date.now();
  for (let attempt = 0; ; attempt++) {
    if (!fs.existsSync(LOCK_DIR)) {
      try {
        fs.mkdirSync(LOCK_DIR);
        fs.writeFileSync(OWNER_FILE, `pid: ${MY_PID}\n`, { flag: 'wx' });
        log(`LOCK acquired (fresh): ${LOCK_DIR} pid=${MY_PID}`);
        return { ok: true, mode: 'fresh', pid: MY_PID };
      } catch (e) {
        // Someone raced us; fall through to the wait path.
        log(`LOCK race on create (${e.code}); retrying`);
        await sleep(2000);
        continue;
      }
    }

    const st = lockStatus();
    if (st.pid === MY_PID) { log('LOCK already ours'); return { ok: true, mode: 'already-ours', pid: MY_PID }; }

    if (st.malformed) {
      // Malformed + unparsable: treat as UNKNOWN owner. We do NOT delete it.
      log(`LOCK malformed owner.txt, refusing to touch it. raw=${JSON.stringify(st.raw)}`);
      throw new Error('LOCK held with malformed owner.txt — refusing to preempt (team discipline). Manual inspection required: ' + LOCK_DIR);
    }

    if (st.alive) {
      log(`LOCK held by LIVE pid=${st.pid}; waiting (${Math.round((Date.now() - t0) / 1000)}s elapsed)`);
      if (Date.now() - t0 > maxWaitMs) throw new Error(`LOCK wait timeout; live owner pid=${st.pid}`);
      await sleep(20000 + Math.floor(Math.random() * 20000));
      continue;
    }

    // Dead owner. Reclaim by the exact protocol: unlink owner.txt THEN rmdir.
    log(`LOCK owner pid=${st.pid} is DEAD; reclaiming via unlink+rmdir (no recursive delete)`);
    try { fs.unlinkSync(OWNER_FILE); } catch (e) { log(`unlink owner.txt: ${e.code}`); }
    try { fs.rmdirSync(LOCK_DIR); } catch (e) { log(`rmdir lock dir: ${e.code}`); }
    await sleep(1000);
  }
}

export function releaseLock(log = () => {}) {
  if (!fs.existsSync(LOCK_DIR)) { log('LOCK release: dir absent, nothing to do'); return { ok: true, mode: 'absent' }; }
  const st = lockStatus();
  if (st.pid !== MY_PID) {
    log(`LOCK release REFUSED: owner pid=${st.pid} is not ours (${MY_PID}). Nothing deleted.`);
    return { ok: false, mode: 'not-owner', ownerPid: st.pid };
  }
  try { fs.unlinkSync(OWNER_FILE); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  try { fs.rmdirSync(LOCK_DIR); } catch (e) {
    // Non-fatal: dir not empty (someone else's stray file). Report, do not rm -rf.
    log(`LOCK release: rmdir refused (${e.code}); dir left in place, owner.txt removed.`);
    return { ok: true, mode: 'partial', warn: e.code };
  }
  log('LOCK released (unlink owner.txt + rmdir)');
  return { ok: true, mode: 'clean' };
}
