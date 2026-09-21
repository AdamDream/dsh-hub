// Data-integrity validator for every CPU-profile campaign written by this line.
// Flags: browser/page exit, page errors, wall-clock shortfall vs requested, missing
// samples, connection interruptions (extra WS sockets / closed sockets), integrity
// failures, and gaps in the window sequence.
import fs from 'node:fs';
import path from 'node:path';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/cpu-profile/out';
const files = fs.readdirSync(OUT).filter((f) => /^campaign-.*\.json$/.test(f)).sort();
const report = {};
for (const f of files) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')); } catch (e) { report[f] = { unreadable: String(e) }; continue; }
  const wins = j.windows || [];
  const req = j.meta?.winMs ?? j.meta?.windowRequestedMs ?? null;
  const rows = wins.map((w) => {
    // normalise: older harness stored window length in SECONDS under profiledSec,
    // newer stores SECONDS under wallSec and MS under profiledSec.
    let wall = w.window?.wallSec ?? null;
    if (wall == null) {
      const ps = w.window?.profiledSec ?? null;
      wall = ps == null ? null : (ps > 1000 ? ps / 1000 : ps);
    }
    // both fields are SECONDS in every harness version; a value >1000 means ms
    if (wall != null && wall > 1000) wall = wall / 1000;
    const shortfall = req && wall ? Math.round(((req - wall) / req) * 1000) / 10 : null; // % short
    const samples = w.profile?.sampleCount ?? null;
    const sockets = w.ws?.sockets ?? null;
    const sc = w.ws?.socketsSeenTotal ?? null;
    return {
      label: w.label, scenario: w.scenario, wallSec: wall, requestedMs: req,
      shortfallPct: shortfall,
      scriptMs: w.cdp?.ScriptDuration ?? w.cdp?.ScriptMs ?? null,
      samples, nodes: w.state?.nodes ?? null,
      wsIn: w.ws?.dirs?.in ?? w.ws?.in ?? null,
      integrity: w.integrity ?? null,
      closedSockets: Array.isArray(sockets) ? sockets.filter((s) => s.closed).length : null,
      socketsTotal: sc ?? (Array.isArray(sockets) ? sockets.length : null),
      census: w.concurrency ? { gate: w.concurrency.gateOutcome, startF: w.concurrency.censusStart?.foreignCount, endF: w.concurrency.censusEnd?.foreignCount } : null,
    };
  });
  // window sequence gaps (label index continuity)
  const idx = rows.map((r) => Number((r.label.match(/w(\d+)$/) || r.label.match(/t(\d+)$/) || [])[1] || NaN));
  const gaps = [];
  for (let i = 1; i < idx.length; i++) if (Number.isFinite(idx[i]) && Number.isFinite(idx[i - 1]) && idx[i] !== idx[i - 1] + 1 && !/w1$/.test(rows[i].label)) gaps.push(rows[i].label);
  report[f] = {
    stamp: j.meta?.stamp ?? null, windowCount: rows.length, requestedMs: req, errors: j.errors ?? [],
    shortfallWindows: rows.filter((r) => r.shortfallPct != null && r.shortfallPct > 5).map((r) => ({ label: r.label, shortfallPct: r.shortfallPct, wallSec: r.wallSec })),
    zeroSampleWindows: rows.filter((r) => !r.samples).map((r) => r.label),
    censusCoverage: rows.filter((r) => r.census).length,
    integrityFailed: rows.filter((r) => r.integrity && Object.values(r.integrity).some((v) => v === false)).map((r) => ({ label: r.label, integrity: r.integrity })),
    closedSockets: rows.filter((r) => r.closedSockets).map((r) => ({ label: r.label, closedSockets: r.closedSockets, socketsTotal: r.socketsTotal })),
    multiSocketWindows: rows.filter((r) => r.socketsTotal != null && r.socketsTotal > 1).map((r) => ({ label: r.label, socketsTotal: r.socketsTotal })),
    sequenceGaps: gaps,
    rows,
  };
}
fs.writeFileSync('/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/cpu-profile/out/integrity-audit.json', JSON.stringify(report, null, 2));

for (const [f, r] of Object.entries(report)) {
  if (r.unreadable) { console.log(`\n## ${f}\n  UNREADABLE: ${r.unreadable}`); continue; }
  console.log(`\n## ${f}  stamp=${r.stamp} windows=${r.windowCount} reqMs=${r.requestedMs}`);
  console.log(`  pageErrors: ${JSON.stringify(r.errors)}`);
  console.log(`  shortfall>5%: ${JSON.stringify(r.shortfallWindows)}`);
  console.log(`  zeroSample: ${JSON.stringify(r.zeroSampleWindows)}`);
  console.log(`  integrityFailed: ${JSON.stringify(r.integrityFailed)}`);
  console.log(`  closedSockets: ${JSON.stringify(r.closedSockets)}  multiSocket: ${JSON.stringify(r.multiSocketWindows)}`);
  console.log(`  sequenceGaps: ${JSON.stringify(r.sequenceGaps)}`);
  if (r.windowCount && r.windowCount <= 16) for (const x of r.rows) console.log(`    ${String(x.label).padEnd(24)} wall=${x.wallSec}s short=${x.shortfallPct}% script=${x.scriptMs} samples=${x.samples} sockets=${x.socketsTotal} closed=${x.closedSockets} ${x.census ? JSON.stringify(x.census) : ''}`);
}
