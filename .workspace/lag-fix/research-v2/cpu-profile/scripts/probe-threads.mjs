// One-shot: capture a CDP profile and dump the RAW structure (threads, timestamps,
// timeDeltas) so we can settle which thread the hot function runs on and how to
// convert samples to ms correctly.
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:3080', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(9000);

const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
await cdp.send('Profiler.enable');
await cdp.send('Profiler.start');
await sleep(10000);
const { profile } = await cdp.send('Profiler.stop');
const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));

// roots: nodes not referenced as any child
const childIds = new Set();
for (const n of profile.nodes) for (const c of n.children || []) childIds.add(c);
const roots = profile.nodes.filter((n) => !childIds.has(n.id));
const parentOf = new Map();
for (const n of profile.nodes) for (const c of n.children || []) parentOf.set(c, n.id);
const nodeById = new Map(profile.nodes.map((n) => [n.id, n]));
const threadOf = (id) => { let cur = id, hops = 0; while (parentOf.has(cur) && hops < 200) { cur = parentOf.get(cur); hops++; } return nodeById.get(cur); };
const threadLabel = (rootNode) => {
  const cf = rootNode?.callFrame || {};
  return { id: rootNode?.id, fn: cf.functionName, url: cf.url, line: (cf.lineNumber ?? -1) + 1 };
};

const td = profile.timeDeltas || [];
td.sort((a, b) => a - b);
const sumTd = td.reduce((a, b) => a + b, 0);
const pct = (p) => td[Math.min(td.length - 1, Math.floor((td.length - 1) * p))];
const total = (profile.endTime - profile.startTime);
const msPerSample = total / (profile.samples || []).length;

// per-thread sample counts
const byThread = new Map();
for (const s of profile.samples || []) {
  const root = threadOf(s); const k = root ? root.id : 'none';
  byThread.set(k, (byThread.get(k) || 0) + 1);
}
// per-thread top self functions
const selfByThread = new Map();
for (const s of profile.samples || []) {
  const root = threadOf(s); const k = root ? root.id : 'none';
  const n = nodeById.get(s); if (!n) continue;
  const cf = n.callFrame || {};
  const key = `${cf.functionName || '(anonymous)'} @${(cf.url || '').split('/').pop()}:${(cf.lineNumber ?? -1) + 1}`;
  if (!selfByThread.has(k)) selfByThread.set(k, new Map());
  const m = selfByThread.get(k); m.set(key, (m.get(key) || 0) + 1);
}

const out = {
  profiled: { requestedSec: 10, wallMs: profile.endTime - profile.startTime, samples: (profile.samples || []).length, nodes: profile.nodes.length },
  timeDeltas: { n: td.length, sumUs: sumTd, sumMs: sumTd / 1000, p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), max: td[td.length - 1], min: td[0] },
  derived: {
    totalMs: total / 1000, msPerSample_avg: msPerSample,
    cpuMsPerSec_of_capture: (total / 1000) / 10,
    samplesAsMs_at_avg: ((profile.samples || []).length * msPerSample) / 1000,
  },
  performanceMetrics: {
    ScriptDuration: (m1.ScriptDuration - m0.ScriptDuration) * 1000,
    TaskDuration: (m1.TaskDuration - m0.TaskDuration) * 1000,
    RecalcStyleDuration: (m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000,
    LayoutDuration: (m1.LayoutDuration - m0.LayoutDuration) * 1000,
    ThreadTime: (m1.ThreadTime - m0.ThreadTime) * 1000,
    Nodes: m1.Nodes,
  },
  roots: roots.map((r) => ({ id: r.id, fn: (r.callFrame || {}).functionName, url: (r.callFrame || {}).url, samples: byThread.get(r.id) || 0, hitCount: r.hitCount })),
  threads: [...byThread.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => {
    const root = nodeById.get(Number(k));
    return { threadRootId: k, root: threadLabel(root), samples: n, ms: (n * msPerSample), msPerS: (n * msPerSample) / 10, top5: [...(selfByThread.get(k) || new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([fn, c]) => ({ fn, samples: c, ms: c * msPerSample, msPerS: (c * msPerSample) / 10 })) };
  }),
};
fs.writeFileSync('/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/cpu-profile/raw/thread-structure.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2).slice(0, 6000));
await browser.close();
