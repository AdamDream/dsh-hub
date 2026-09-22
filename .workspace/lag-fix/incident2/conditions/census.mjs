#!/usr/bin/env node
/*
 * census.mjs — 浏览器实例普查（正确口径）
 * ---------------------------------------------------------------------------
 * 为什么要单独写：朴素做法「扫每个进程的 cmdline 里有没有 headless_shell 字符串」
 * 会把**任何命令行文本里含该字符串的进程**误算成浏览器——实测把本线自己的
 * bash+python heredoc 进程数成了浏览器实例（其 cmdline 含整段脚本文本，
 * 脚本里恰好有 headless_shell 与 --disable-field-trial-config 两个字面量，
 * ppid 又恰好是宿主 10806），于是伪造出「宿主自己派生了一个浏览器 ⇒ 永远无法独占」
 * 这个看起来很像真的错误结论。**先证伪，再下结论。**
 *
 * 正确口径（本文件）：
 *   1) 进程真实可执行文件（读 /proc/PID/exe 的链接目标）必须指向 chromium headless shell；
 *   2) 主浏览器实例 = cmdline 含 --disable-field-trial-config（不含 renderer/gpu/zygote）；
 *   3) 归属：ppid == 宿主 pid ⇒ host-derived；否则看 --user-data-dir 是否 /tmp/playwright_*。
 * 只读 /proc，不投递任何信号（不 kill）。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const HOST_PID = 10806;
const HZ = 100;

const btime = Number(/^btime (\d+)/m.exec(fs.readFileSync('/proc/stat', 'utf8'))[1]);
const localIso = (sec) => {
  const d = new Date(sec * 1000); const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
function exeOf(pid) { try { return fs.readlinkSync(`/proc/${pid}/exe`); } catch { return null; } }

/** 主浏览器实例（已用 /proc/<pid>/exe 去伪） */
export function census(ownPids = new Set()) {
  const rows = [];
  for (const d of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    const pid = Number(d);
    const exe = exeOf(d);
    if (!exe || !/headless_shell|chromium/.test(exe)) continue;   // 真可执行文件校验
    let cmd = '';
    try { cmd = fs.readFileSync(`/proc/${d}/cmdline`, 'utf8'); } catch { continue; }
    if (!cmd.includes('--disable-field-trial-config')) continue;   // 主浏览器进程口径
    let startEpoch = null, ppid = null;
    try {
      const st = fs.readFileSync(`/proc/${d}/stat`, 'utf8');
      const f = st.slice(st.lastIndexOf(')') + 2).split(' ');
      startEpoch = btime + Number(f[19]) / HZ;
    } catch { }
    try {
      for (const l of fs.readFileSync(`/proc/${d}/status`, 'utf8').split('\n')) {
        if (l.startsWith('PPid:')) { ppid = Number(l.split(/\s+/)[1]); break; }
      }
    } catch { }
    const udd = (/--user-data-dir=([^\s\0]+)/.exec(cmd) || [])[1] || null;
    rows.push({
      pid, ppid, exe: path.basename(exe),
      startedAt: startEpoch ? localIso(startEpoch) : null,
      userDataDir: udd,
      own: ownPids.has(pid),
      hostDerived: ppid === HOST_PID,
    });
  }
  const own = rows.filter((r) => r.own);
  const foreign = rows.filter((r) => !r.own);
  const tenants = foreign.filter((r) => !r.hostDerived);
  return {
    total: rows.length,
    pids: rows.map((r) => r.pid),
    own: own.length,
    foreign: foreign.length,
    foreign_tenants: tenants.length,       // 真正的竞争者：他线探针浏览器
    host_derived: foreign.filter((r) => r.hostDerived).length,
    foreign_pids: foreign.map((r) => r.pid),
    tenant_detail: tenants.map((r) => ({ pid: r.pid, ppid: r.ppid, startedAt: r.startedAt, udd: r.userDataDir })),
    host_derived_detail: foreign.filter((r) => r.hostDerived).map((r) => ({ pid: r.pid, startedAt: r.startedAt, udd: r.userDataDir })),
    // 两个口径都给出，避免自欺：
    gate_strict_passed: foreign.length === 0,
    gate_tenants_passed: tenants.length === 0,
    loadavg: (() => { try { return Number(fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0]); } catch { return null; } })(),
  };
}

/** 自身实例识别（方法二，用于与"差集法"互相印证）：Playwright 的浏览器主进程
 *  由本进程 spawn，故 ppid === 本进程 pid。两法若不一致，以**祖先链**为准并记账。 */
export function ownByAncestry(myPid) {
  const c = census(new Set());
  const rows = c.pids.map((pid) => ({ pid }));
  // 需要 ppid：重新扫一遍（量小，代价可忽略）
  const out = [];
  for (const { pid } of rows) {
    let ppid = null;
    try {
      for (const l of fs.readFileSync(`/proc/${pid}/status`, 'utf8').split('\n')) {
        if (l.startsWith('PPid:')) { ppid = Number(l.split(/\s+/)[1]); break; }
      }
    } catch { }
    if (ppid === myPid) out.push(pid);
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('census.mjs')) {
  const n = Number(process.argv[2] || 1);
  for (let i = 0; i < n; i++) {
    console.log(JSON.stringify(census()));
    if (i < n - 1) { const t = Date.now(); while (Date.now() - t < 4000); }
  }
}
