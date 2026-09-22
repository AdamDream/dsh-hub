// lib/lock.mjs — 跨线独占锁（research-v2/.probe.lock）+ 并发普查（/proc 精确统计）
// 纪律：不强占、不 pkill；未取到锁就不启动浏览器。
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, rmdirSync, readdirSync, readlinkSync } from 'node:fs';

export const LOCK = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock';

export function tryAcquire(agent, purpose, waitSec = 1500, log = () => {}) {
  const deadline = Date.now() + waitSec * 1000;
  const events = [];
  for (;;) {
    try {
      mkdirSync(LOCK);
      writeFileSync(`${LOCK}/owner.txt`,
        `agent=${agent}\npid=${process.pid}\nstarted_at=${new Date().toISOString()}\nstarted_epoch=${Math.floor(Date.now() / 1000)}\npurpose=${purpose}\n`);
      events.push({ at: new Date().toISOString(), event: 'acquired' });
      return { acquired: true, events, ownerText: readFileSync(`${LOCK}/owner.txt`, 'utf8') };
    } catch {
      let cur = '(no owner.txt)';
      try { cur = existsSync(`${LOCK}/owner.txt`) ? readFileSync(`${LOCK}/owner.txt`, 'utf8').replace(/\n/g, ' ') : '(no owner.txt)'; } catch {}
      log(`[lock] busy — waiting: ${cur}`);
      events.push({ at: new Date().toISOString(), event: 'waiting', seen: cur });
      if (Date.now() > deadline) {
        events.push({ at: new Date().toISOString(), event: 'timeout' });
        return { acquired: false, events };
      }
      // 同步 sleep（保持“浏览器未启动”这一不变量；不用忙等，避免污染 CPU）
      sleepSync(18000);
    }
  }
}

// 真正同步睡眠：SharedArrayBuffer + Atomics.wait
export function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(sab), 0, 0, ms);
}

export function release(agent) {
  try {
    const owner = readFileSync(`${LOCK}/owner.txt`, 'utf8');
    if (!owner.includes(`agent=${agent}`)) return { released: false, refused: 'not my lock', owner };
    rmSync(`${LOCK}/owner.txt`, { force: true });
    // 必须用 rmdir 语义：rmSync(dir,{recursive:false}) 会抛 ERR_FS_EISDIR 并把空目录留在原地，
    // 从而把后来者挡死（实测事故：2026-09-22 11:26 本线 run2）。
    rmdirSync(LOCK);
    return { released: true };
  } catch (e) {
    // 兜底：若 owner.txt 已被删而目录仍空，尝试补删，避免留下 stale 锁
    try { if (!existsSync(`${LOCK}/owner.txt`)) rmdirSync(LOCK); } catch {}
    return { released: false, error: String(e).slice(0, 200) };
  }
}

// 用 /proc/*/exe 精确统计浏览器主进程（禁用会自匹配的 pgrep -f）
export function census() {
  const out = { headless_shell: [], chromium: [], foreign: 0, own: [], host_pid: null, total: 0 };
  let pids = [];
  try { pids = readdirSync('/proc').filter((d) => /^\d+$/.test(d)); } catch { return out; }
  for (const pid of pids) {
    let exe = null;
    try { exe = readlinkSync(`/proc/${pid}/exe`); } catch { continue; }
    if (!exe) continue;
    const base = exe.split('/').pop();
    if (!/^(headless_shell|chrome|chromium|chromium-browser)$/.test(base)) continue;
    let cmd = '';
    try { cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim(); } catch {}
    // 只认主进程：命令行含 --user-data-dir 且不含 --type=（渲染/GPU/zygote 子进程都带 --type=）
    if (cmd.includes('--type=')) continue;
    const m = cmd.match(/--user-data-dir=(\S+)/);
    const rec = { pid: Number(pid), exe: base, userDataDir: m ? m[1] : null, args: cmd.slice(0, 220) };
    out.total++;
    if (base === 'headless_shell') out.headless_shell.push(rec); else out.chromium.push(rec);
  }
  try {
    const ps = readFileSync('/proc/self/status', 'utf8');
    out.self_pid = Number((ps.match(/^Pid:\s*(\d+)/m) || [])[1]);
  } catch {}
  return out;
}

export function censusVerdict(cen, ownUserDataDir) {
  const all = [...cen.headless_shell, ...cen.chromium];
  const own = all.filter((r) => ownUserDataDir && r.userDataDir && r.userDataDir.includes(ownUserDataDir));
  const foreign = all.filter((r) => !own.includes(r));
  // 自身 node 进程也占一个 user-data-dir；own 只看 userDataDir 命中
  return { total: all.length, own: own.length, foreign: foreign.length, foreign_list: foreign.map((r) => `${r.pid}:${r.exe}:${r.userDataDir}`), own_list: own.map((r) => `${r.pid}:${r.exe}`) };
}
