// Why does `monitorEventLoopDelay` under-report a 30 s synchronous block?
// Hypothesis: calling `reset()` immediately before the block discards the
// block's sample (the first sample after a reset appears to be used for
// calibration). Compare the two disciplines directly.
import { monitorEventLoopDelay } from "node:perf_hooks";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function trial(label, { doubleReset, blockMs }) {
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable(); h.reset();
  let last = 0, worst = 0;
  await sleep(150);
  if (doubleReset) h.reset();
  last = Date.now(); worst = 0;
  const iv = setInterval(() => { const n = Date.now(); worst = Math.max(worst, n - last - 10); last = n; }, 10);
  const t0 = Date.now(); const end = t0 + blockMs;
  while (Date.now() < end) { /* block */ }
  const actualBlock = Date.now() - t0;
  const drainStart = Date.now();
  while (Date.now() - drainStart < 250) await sleep(10);
  h.disable(); clearInterval(iv);
  const result = { label, blockMs, actualBlockMs: actualBlock, monitorMaxMs: Number((h.max / 1e6).toFixed(2)), heartbeatGapMs: worst };
  console.log(JSON.stringify(result));
  return result;
}
await trial("enable→settle→RESET→block(3000ms)", { doubleReset: true, blockMs: 3000 });
await trial("enable→settle→block(3000ms)", { doubleReset: false, blockMs: 3000 });
await trial("enable→settle→RESET→block(20000ms)", { doubleReset: true, blockMs: 20000 });
await trial("enable→settle→block(20000ms)", { doubleReset: false, blockMs: 20000 });
