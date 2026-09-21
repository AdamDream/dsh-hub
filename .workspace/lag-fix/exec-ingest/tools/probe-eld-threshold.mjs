// Characterise `monitorEventLoopDelay` against block length, with the same
// settle + drain discipline used by the G1 test, so the G1 write-up can state
// exactly where the instrument stops reporting a synchronous block.
import { monitorEventLoopDelay } from "node:perf_hooks";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];
for (const blockMs of [1500, 5000, 15000, 40000]) {
  const h = monitorEventLoopDelay({ resolution: 10 });
  h.enable(); h.reset();
  await sleep(150); h.reset();
  let last = Date.now(), worst = 0;
  const iv = setInterval(() => { const n = Date.now(); worst = Math.max(worst, n - last - 10); last = n; }, 10);
  const t0 = Date.now(); const end = t0 + blockMs;
  while (Date.now() < end) { /* block the loop */ }
  const actualBlock = Date.now() - t0;
  const drainStart = Date.now();
  while (Date.now() - drainStart < 250) await sleep(10);
  out.push({ requestedBlockMs: blockMs, actualBlockMs: actualBlock, monitorMaxMs: Number((h.max / 1e6).toFixed(2)), heartbeatGapMs: worst, monitorRatio: Number((h.max / 1e6 / actualBlock).toFixed(4)) });
  h.disable(); clearInterval(iv);
  console.log(JSON.stringify(out.at(-1)));
}
