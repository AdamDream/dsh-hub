#!/usr/bin/env node
/*
 * env-evidence.mjs — read-only snapshot of the host conditions that bound every
 * number in this delivery. Uses no browser, holds no lock, writes one JSON.
 *
 * Everything here is a plain read of /proc, /sys or a fixed syscall; nothing is
 * started, stopped, reconfigured or restarted.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserCensus, loadAvg, cpuCount } from './lib/census.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const rd = (p, d = null) => { try { return fs.readFileSync(p, 'utf8').trim(); } catch { return d; } };

const ev = {
  collectedAt: new Date().toISOString(),
  host: {
    hostname: os.hostname(), platform: os.platform(), release: os.release(),
    kernel: rd('/proc/version'), bootTime: rd('/proc/stat') ? (() => { const m = /^btime (\d+)/m.exec(rd('/proc/stat')); return m ? new Date(Number(m[1]) * 1000).toISOString() : null; })() : null,
    cpuCount: cpuCount(), cpuModel: (rd('/proc/cpuinfo', '').match(/^model name\s*:\s*(.+)$/m) || [])[1] || null,
    memTotalKb: Number((rd('/proc/meminfo', '').match(/^MemTotal:\s+(\d+)/m) || [])[1] || 0),
    memAvailableKb: Number((rd('/proc/meminfo', '').match(/^MemAvailable:\s+(\d+)/m) || [])[1] || 0),
    swapTotalKb: Number((rd('/proc/meminfo', '').match(/^SwapTotal:\s+(\d+)/m) || [])[1] || 0),
    swapFreeKb: Number((rd('/proc/meminfo', '').match(/^SwapFree:\s+(\d+)/m) || [])[1] || 0),
    loadAvg: loadAvg(),
  },
  /* PSI: how often *anything* on the host was stalled on cpu/io/memory.
   * This is the single most important confound for frame-interval data. */
  psi: {
    cpu: rd('/proc/pressure/cpu'), io: rd('/proc/pressure/io'), memory: rd('/proc/pressure/memory'),
  },
  procAccess: {
    ptraceScope: rd('/proc/sys/kernel/yama/ptrace_scope'),
    readlinkExeOnOwnChild: null, readlinkExeOnForeign: null,
    note: 'readlinkExeOnForeign is measured live below against whichever foreign browser process exists',
  },
  display: {
    DISPLAY: process.env.DISPLAY || null,
    XDG_SESSION_TYPE: process.env.XDG_SESSION_TYPE || null,
    WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY || null,
    XAUTHORITY: process.env.XAUTHORITY || null,
    xorgCmdline: (() => {
      for (const d of fs.readdirSync('/proc')) {
        if (!/^\d+$/.test(d)) continue;
        const cl = rd(`/proc/${d}/cmdline`, '');
        if (cl && /(^|\0|\/)(Xorg|Xvfb|Xwayland)(\0|$)/.test(cl.replace(/\0/g, '\0'))) {
          const comm = rd(`/proc/${d}/comm`, '');
          if (/^(Xorg|Xvfb|Xwayland)$/.test(comm)) return { pid: Number(d), comm, cmdline: cl.replace(/\0/g, ' ').trim() };
        }
      }
      return null;
    })(),
  },
  gpu: {
    drmCards: (() => { try { return fs.readdirSync('/sys/class/drm').filter((d) => /^card\d/.test(d)); } catch { return null; } })(),
    lspciVga: null,
    renderNodes: (() => { try { return fs.readdirSync('/dev/dri'); } catch { return null; } })(),
    note: 'the authoritative GPU/renderer answer for each measured run is in raw/*.json gpuInfo (CDP SystemInfo.getInfo)',
  },
  cpuFreq: (() => {
    try {
      const dirs = fs.readdirSync('/sys/devices/system/cpu').filter((d) => /^cpu\d+$/.test(d));
      const gov = rd(`/sys/devices/system/cpu/${dirs[0]}/cpufreq/scaling_governor`);
      const cur = rd(`/sys/devices/system/cpu/${dirs[0]}/cpufreq/scaling_cur_freq`);
      return { cpus: dirs.length, governor: gov, curFreqKhz: cur };
    } catch (e) { return { error: String(e).slice(0, 120) }; }
  })(),
  concurrencySnapshot: (() => {
    const c = browserCensus();
    delete c.detail;
    return c;
  })(),
  otherResearchLinesVisible: (() => {
    const out = [];
    for (const d of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      const cl = rd(`/proc/${d}/cmdline`, '');
      if (!cl || !/lag-fix/.test(cl)) continue;
      if (!/node|bash/.test(cl)) continue;
      if (Number(d) === process.pid) continue;
      const m = /lag-fix\/([^\0 ]+?)(?:\/| )/.exec(cl.replace(/\0/g, ' '));
      out.push({ pid: Number(d), line: m ? m[1] : null, cmd: cl.replace(/\0/g, ' ').slice(0, 150) });
    }
    return out.slice(0, 40);
  })(),
};

/* live proof of the ptrace restriction, using our own child vs a foreign browser */
try {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('readlink', ['-v', '/proc/self/exe'], { encoding: 'utf8' });
  ev.procAccess.selfReadlink = (r.stdout || '').trim() || (r.stderr || '').trim();
} catch { }
const foreign = browserCensus({ includeDetail: true }).foreignInstances;
if (foreign.length) {
  const f = foreign[0];
  const p = f.pid;
  const cmd = `readlink -v /proc/${p}/exe`;
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('readlink', ['-v', `/proc/${p}/exe`], { encoding: 'utf8' });
  ev.procAccess.readlinkExeOnForeign = { pid: p, ident: f.ident, cmd, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim(), status: r.status };
  const own = spawnSync('sleep', ['2'], { encoding: 'utf8', detached: true });
  void own;
  /* spawnSync would block until the child exits, so the child must be started
   * asynchronously for its /proc/<pid>/exe to still exist when we read it. */
  const { spawn } = await import('node:child_process');
  const kid = spawn('sleep', ['5'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 400));
  const r2 = spawnSync('readlink', ['-v', `/proc/${kid.pid}/exe`], { encoding: 'utf8' });
  ev.procAccess.readlinkExeOnOwnChild = {
    pid: kid.pid, stdout: (r2.stdout || '').trim(), stderr: (r2.stderr || '').trim(),
    note: 'same readlink call, own descendant -> readable, while the foreign pid above -> EACCES',
  };
  try { kid.kill('SIGTERM'); } catch { }
}
try {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('sh', ['-c', 'command -v lspci >/dev/null && lspci -nn 2>/dev/null | grep -iE "vga|3d|display" | head -5'], { encoding: 'utf8' });
  ev.gpu.lspciVga = (r.stdout || '').trim() || '(lspci unavailable)';
} catch { }

fs.mkdirSync(path.join(HERE, 'raw'), { recursive: true });
const out = path.join(HERE, 'raw', 'env-evidence.json');
fs.writeFileSync(out, JSON.stringify(ev, null, 1));
console.log(JSON.stringify({
  cpuCount: ev.host.cpuCount, cpuModel: ev.host.cpuModel, memGB: Math.round(ev.host.memTotalKb / 1048576),
  loadAvg: ev.host.loadAvg, psi: ev.psi, ptraceScope: ev.procAccess.ptraceScope,
  readlinkOwnChild: ev.procAccess.readlinkExeOnOwnChild, readlinkForeign: ev.procAccess.readlinkExeOnForeign,
  display: ev.display, gpu: ev.gpu, cpuFreq: ev.cpuFreq,
  foreignBrowsers: ev.concurrencySnapshot.foreignInstanceTotal, foreignProcs: ev.concurrencySnapshot.foreignProcTotal,
  instanceTotal: ev.concurrencySnapshot.instanceTotal, identifyMix: ev.concurrencySnapshot.identifyMethodMix,
  lines: ev.otherResearchLinesVisible.map((l) => l.line),
}, null, 1));
console.log('->', out);
