#!/usr/bin/env node
// 运行内 loadavg 采样：给 b2 批量战役的每个窗口标注 concurrentWith 与 loadavg。
// 用法：node tools/loadavg-window.mjs --from <iso> --to <iso>
import fs from 'node:fs';
const A = process.argv.slice(2);
const argOf = (n, d) => { const i = A.indexOf('--' + n); return i >= 0 ? A[i + 1] : d; };
const from = argOf('from'), to = argOf('to');
const raw = fs.readFileSync('raw/b2-all.json', 'utf8');
const all = JSON.parse(raw);
const wins = all.windows.map((w) => ({ label: w.label, cond: w.cond, ts: w.ts, gateWaitedMs: w.concurrency.batchGateWaitedMs, gate: w.concurrency.gateOutcome,
  foreignBefore: w.concurrency.censusBefore.foreignCount, foreignAfter: w.concurrency.censusAfter.foreignCount }));
const la = fs.readFileSync('/proc/loadavg', 'utf8');
const out = { generatedAt: new Date().toISOString(), lockHeld: all.gate, lockReleased: all.released, plan: all.plan,
  loadavgNow: la.trim(), batchSingleLockHoldMs: all.gate.waitedMs, windows: wins,
  note: '本批为「一次抢锁、窗口内 14 窗口」的批量战役；协调者已要求后续改为每 1–2 窗口释放重排。' };
fs.writeFileSync('raw/loadavg-window.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
