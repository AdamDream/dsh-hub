#!/usr/bin/env node
/**
 * probe-lock.mjs — 跨线探针锁的**修正实现**（2026-09-22）
 *
 * 背景（exec-mask 线实测的两处 HIGH 缺陷）：
 *  D1  **继承的存活判据不成立**：`readlink("/proc/<pid>/exe")` 在本环境对**几乎所有进程**返回 EACCES
 *      （已对 Chrome 494362 / snap Firefox 547226 / dsh 宿主 301709 / gnome-shell 4139 / 兄弟线进程逐一验证）。
 *      而旧判据是 `alive = try { readlinkSync(exe) } catch { false }` ⇒ **存活进程被判为死** ⇒ 走到回收分支
 *      `rm owner.txt && rmdir`，**会摧毁存活兄弟线的锁**。实测反例：锁被 PID 591877（tiebreak 线战役中，带存活 Chrome 子进程）
 *      持有时，旧判据 `alive:false`（错），新判据 `alive:true`。
 *  D2  **普查同样失明**：census 以 `readlinkSync(exe)` 判浏览器身份并 `catch { continue }` ⇒ 跳过一切进程。
 *      同一时刻实测：旧普查 **0** 个浏览器主进程，改用 cmdline 的普查 **32** 个。
 *      ⇒ 任何"quiet gate: foreign=0"若基于旧判据，其结论是**结构性保证的空洞**，不得作为"机器安静"的证据。
 *
 * 本实现的三条硬规则：
 *  1. **存活判据只认 `/proc/<pid>` 存在 + `stat` 状态 ∉ {Z,X} + `cmdline` 非空**；**任何读取失败（含 EACCES）一律假定"存活"**。
 *  2. **未经"确证死亡"绝不回收**；`reclaim` 还必须显式传 `{ force: true }` 且 owner 年龄超阈值。
 *  3. **owner.txt 用单行 `key=value`，以 `owner.txt.tmp` + `rename` 原子落盘**（避免"mkdir 后 owner 尚未写入"的窗口）。
 *
 * 用法：
 *   import { acquire, release, inspect, state, ALIVE } from './probe-lock.mjs';
 *   const lk = acquire({ owner: 'my-line', purpose: 'batch x' });   // 返回 {ok:true} 或 {ok:false, reason:'BUSY', owner}
 *   release(lk);                                                    // 只释放自己持有的锁
 */
import { mkdirSync, writeFileSync, renameSync, readFileSync, unlinkSync, rmdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

export const LOCK_DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock';
const OWNER = path.join(LOCK_DIR, 'owner.txt');
const TMP = path.join(LOCK_DIR, 'owner.txt.tmp');

export const ALIVE = 'ALIVE', DEAD = 'DEAD', UNKNOWN = 'UNKNOWN';

/** 存活判定：失败一律 ALIVE（绝不以读取失败为死亡证据）。 */
export function state(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return DEAD;
  const dir = `/proc/${n}`;
  if (!existsSync(dir)) return DEAD;                       // 目录不存在 = 确证死亡
  try {
    const stat = readFileSync(`${dir}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    const st = close >= 0 ? stat.slice(close + 2).trim()[0] : '';
    if (st === 'Z' || st === 'X') return DEAD;             // 僵尸/死亡
  } catch { return ALIVE; }                                // 读不到 ⇒ 保守假定存活
  try {
    const cmd = readFileSync(`${dir}/cmdline`, 'utf8');
    if (cmd.replace(/\0/g, '').trim() === '') return UNKNOWN; // 内核线程等：不据以回收
  } catch { return ALIVE; }
  return ALIVE;
}

/**
 * 单行 key=value 解析（兼容历史的 `pid: N` 与 `pid=N` 两种写法，只取第一行）。
 *
 * 2026-09-22 修正（D3）：旧实现按空白切段后再逐段匹配 ⇒ **值里含空格就会被截断**
 * （实测 `purpose=K1 keep-alive A/B` ⇒ 只得到 `K1`），且一旦 `pid` 因任何格式差异解析为 null，
 * `inspect()` 就恒返回 UNKNOWN ⇒ 取锁方**永久**拿到失败。现改为**整行全局匹配**：
 * 值一直吃到"下一个 `key=`/`key:` 之前"，因此空格、斜杠、冒号都不会破坏解析。
 */
export function parseOwner(text) {
  if (!text) return null;
  const first = String(text).split('\n')[0].trim();
  if (!first) return null;
  const out = {};
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(.*?)(?=\s+[A-Za-z_][A-Za-z0-9_]*\s*[:=]|$)/g;
  let m;
  while ((m = re.exec(first)) !== null) out[m[1]] = m[2].trim();
  const rawPid = out.owner_pid ?? out.pid;
  const num = rawPid == null ? NaN : Number(String(rawPid).trim());
  return {
    raw: first,
    agent: out.agent || null,
    pid: Number.isInteger(num) && num > 0 ? num : null,
    purpose: out.purpose || null,
    startedAt: out.started_at || out.startedAt || null,
  };
}

/**
 * 读锁现状。`ageMs` 现在是**真值**（旧实现恒为 0，导致 `minAgeMs` 成为死代码）：
 * 优先取 owner 行里的 `started_at`，缺失则回落到 owner.txt 的 mtime。
 */
export function inspect() {
  if (!existsSync(LOCK_DIR)) return { held: false };
  let owner = null;
  try { owner = parseOwner(readFileSync(OWNER, 'utf8')); } catch { /* owner 可能尚未落盘 */ }
  let mtimeMs = 0;
  try { mtimeMs = statSync(OWNER).mtimeMs; } catch { /* ignore */ }
  const started = owner?.startedAt ? Date.parse(owner.startedAt) : NaN;
  const base = Number.isFinite(started) ? started : (mtimeMs || Date.now());
  const liveness = owner?.pid ? state(owner.pid) : UNKNOWN;
  return { held: true, owner, liveness, ageMs: Math.max(0, Date.now() - base), ownerFileMtimeMs: mtimeMs || null };
}

/**
 * 取锁。owner 写单行；先写 tmp 再 rename，避免"目录已建但 owner 未写"的窗口。
 *
 * 2026-09-22 修正（D4，本轮实测的**全线死锁**根因）：
 *   旧签名 `reclaimIfDead = false`（默认关）⇒ 属主**已被确证死亡**时也不回收，而是返回
 *   `BUSY_UNKNOWN_LIVENESS`（**错误名：liveness 明明是 DEAD**）⇒ 一条线崩溃后留下的死锁
 *   **会把所有兄弟线永久挡住**，除非每条线都记得显式传 `reclaimIfDead: true`。
 *   实测代价：`exec-a11y` 因此白等 900 s。
 *
 *   现改为**默认按"确证死亡即回收"**（这正是本库第 2 条硬规则的原意：只认确证死亡，不认超时猜测），
 *   并保留 `minAgeMs` 作为**抗竞态**护栏（此刻它是**真**判据，因为 `inspect().ageMs` 已是真值）：
 *   `DEAD` 且 `ageMs >= minAgeMs` 才回收；`ALIVE` / `UNKNOWN` / 年龄不足 一律不回收。
 *   三条拒绝理由彼此可区分，便于调用方按需重试或上报。
 */
export function acquire({ owner = 'unknown', purpose = '', reclaimIfDead = true, minAgeMs = 5_000 } = {}) {
  let reclaimed = null;
  try {
    mkdirSync(LOCK_DIR);
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const cur = inspect();
    if (!cur.held) {
      /* 目录存在但 owner 尚未落盘：不抢，交调用方重试（rename 是原子的） */
      return { ok: false, reason: 'BUSY_NO_OWNER_YET', liveness: UNKNOWN, ageMs: cur.ageMs ?? null };
    }
    if (cur.liveness === ALIVE) {
      return { ok: false, reason: 'BUSY', owner: cur.owner, liveness: ALIVE, ageMs: cur.ageMs };
    }
    if (cur.liveness === UNKNOWN) {
      /* 真·无法判定（例如 owner.pid 解析不出、或 cmdline 为空的内核线程）⇒ 绝不回收 */
      return { ok: false, reason: 'BUSY_UNKNOWN_LIVENESS', owner: cur.owner, liveness: UNKNOWN, ageMs: cur.ageMs };
    }
    /* liveness === DEAD：确证死亡 */
    if (!reclaimIfDead) {
      return { ok: false, reason: 'BUSY_DEAD_OWNER_NOT_RECLAIMED', owner: cur.owner, liveness: DEAD, ageMs: cur.ageMs };
    }
    if (cur.ageMs < minAgeMs) {
      return { ok: false, reason: 'BUSY_DEAD_OWNER_TOO_YOUNG', owner: cur.owner, liveness: DEAD, ageMs: cur.ageMs };
    }
    try { unlinkSync(OWNER); } catch { /* ignore */ }
    try { rmdirSync(LOCK_DIR); } catch { return { ok: false, reason: 'BUSY_NONEMPTY', owner: cur.owner, liveness: DEAD, ageMs: cur.ageMs }; }
    try { mkdirSync(LOCK_DIR); } catch (e2) { return { ok: false, reason: 'BUSY_RACE', detail: String(e2?.code || e2) }; }
    reclaimed = { owner: cur.owner, liveness: DEAD, ageMs: cur.ageMs };
  }
  const line = `agent=${owner} pid=${process.pid} owner_pid=${process.pid} started_at=${new Date().toISOString()} purpose=${purpose}\n`;
  writeFileSync(TMP, line);
  renameSync(TMP, OWNER);          // 原子落盘
  return { ok: true, pid: process.pid, dir: LOCK_DIR, ...(reclaimed ? { reclaimed } : {}) };
}

/** 只释放自己持有的锁（pid 必须等于本进程）。 */
export function release() {
  const cur = inspect();
  if (!cur.held) return { released: false, reason: 'NOT_HELD' };
  if (cur.owner?.pid !== process.pid) return { released: false, reason: 'NOT_MINE', owner: cur.owner };
  try { unlinkSync(OWNER); } catch { /* ignore */ }
  try { rmdirSync(LOCK_DIR); } catch { /* ignore */ }
  return { released: true };
}
