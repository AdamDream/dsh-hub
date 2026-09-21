import { monitorEventLoopDelay } from "node:perf_hooks";
const h = monitorEventLoopDelay({ resolution: 10 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function trial(label, { drain }) {
  h.enable(); h.reset();
  let last = Date.now(), worst = 0;
  const iv = setInterval(() => { const n = Date.now(); worst = Math.max(worst, n - last - 10); last = n; }, 10);
  await sleep(50);                       // let the monitor settle
  const t0 = Date.now();
  const end = Date.now() + 1500;
  while (Date.now() < end) { /* block the loop */ }
  const blockMs = Date.now() - t0;
  if (drain) { for (let i = 0; i < 12; i++) await sleep(10); }
  const maxNs = h.max;
  h.disable(); clearInterval(iv);
  return { label, blockMs, monitorMaxMs: Number((maxNs / 1e6).toFixed(2)), heartbeatWorstGapMs: worst };
}
const out = [];
out.push(await trial("no-drain", { drain: false }));
out.push(await trial("drain-120ms", { drain: true }));
console.log(JSON.stringify(out, null, 1));
