#!/usr/bin/env node
/**
 * host-cpu-sampler.mjs — 只读判定宿主 45s ingest tick 是否真的在跑。
 *
 * 依据：deployed runIngest 的 fold 是**同步**的（DatabaseSync + readFileSync + 逐行 JSON.parse），
 * 一次真实 ingest 会在宿主进程上留下可观测的 CPU/IO 突发（既有基准 478–846ms/次）。
 * 因此每 2s 采一次 /proc/<pid>/stat 的 utime+stime 与 /proc/<pid>/io 的 read_bytes，
 * 看在 45s 周期上是否出现突发。
 *
 * 只读：只打开 /proc/<pid>/{stat,io} 累加计数器。不发信号、不写宿主任一文件。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const pid = Number(process.argv[process.argv.indexOf('--pid') + 1] || 1390375);
const seconds = Number(process.argv[process.argv.indexOf('--seconds') + 1] || 150);
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/r4-live-verify/raw/host-cpu.json';

const HZ = 100; // Linux USER_HZ
const readStat = () => {
  const f = readFileSync(`/proc/${pid}/stat`, 'utf8');
  // 字段 14/15 = utime/stime（1-based，comm 可能含空格与括号 → 从最后一个 ')' 之后切）
  const tail = f.slice(f.lastIndexOf(')') + 2).split(' ');
  return { utime: Number(tail[11]), stime: Number(tail[12]), threads: Number(tail[17]) };
};
const readIo = () => {
  try {
    const t = readFileSync(`/proc/${pid}/io`, 'utf8');
    const g = (k) => Number((t.match(new RegExp(`^${k}: (\\d+)$`, 'm')) || [])[1] ?? NaN);
    return { read_bytes: g('read_bytes'), rchar: g('rchar') };
  } catch { return { read_bytes: NaN, rchar: NaN }; }
};

const samples = [];
const t0 = Date.now();
let prevCpu = readStat(), prevIo = readIo();
while (Date.now() - t0 < seconds * 1000) {
  await new Promise((r) => setTimeout(r, 2000));
  const cpu = readStat(), io = readIo();
  const dcpu = (cpu.utime + cpu.stime) - (prevCpu.utime + prevCpu.stime);
  samples.push({
    at: new Date().toISOString(), tMs: Date.now() - t0,
    cpuMs: Number(((dcpu / HZ) * 1000).toFixed(1)),
    readKB: Number((((io.read_bytes - prevIo.read_bytes) || 0) / 1024).toFixed(1)),
    rcharKB: Number((((io.rchar - prevIo.rchar) || 0) / 1024).toFixed(1)),
    threads: cpu.threads,
  });
  prevCpu = cpu; prevIo = io;
}

const cpuSeries = samples.map((s) => s.cpuMs);
const sorted = [...cpuSeries].sort((a, b) => a - b);
const p = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
const out = {
  at: new Date().toISOString(), pid, seconds, hz: HZ, samples,
  summary: {
    n: samples.length,
    cpuMsTotal: Number(cpuSeries.reduce((a, b) => a + b, 0).toFixed(1)),
    cpuMsMin: Math.min(...cpuSeries), cpuMsP50: p(0.5), cpuMsP95: p(0.95), cpuMsMax: Math.max(...cpuSeries),
    cpuMsMaxAt: samples.find((s) => s.cpuMs === Math.max(...cpuSeries))?.at ?? null,
    readKBTotal: Number(samples.reduce((a, b) => a + b.readKB, 0).toFixed(1)),
    readKBMax: Math.max(...samples.map((s) => s.readKB)),
    readKBMaxAt: samples.find((s) => s.readKB === Math.max(...samples.map((x) => x.readKB)))?.at ?? null,
    // 一次真实 fold 的既有基准 478–846ms CPU/次
    burstsOver300msCPU: cpuSeries.filter((x) => x > 300).length,
    steadyStateCpuMsPerSec: Number((cpuSeries.reduce((a, b) => a + b, 0) / samples.length / 2).toFixed(2)),
  },
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`samples=${out.summary.n}  cpu total=${out.summary.cpuMsTotal}ms  p50=${out.summary.cpuMsP50} p95=${out.summary.cpuMsP95} max=${out.summary.cpuMsMax} (at ${out.summary.cpuMsMaxAt})`);
console.log(`read_bytes total=${out.summary.readKBTotal}KB max=${out.summary.readKBMax}KB (at ${out.summary.readKBMaxAt})  突发>300ms 计数=${out.summary.burstsOver300msCPU}`);
