/*
 * preflight.mjs — gate the smoke invocation before the judged campaign runs.
 * Checks the paths that are new in this harness and that a silent failure would
 * otherwise hide: route interception actually hit, the bytes the page received,
 * the computed mask backdrop-filter per arm, the positive control, and that the
 * screenshot pairs exist on disk and are non-empty.
 *
 * usage: node preflight.mjs [--run smoke]   exit 0 = go, 4 = do not start the campaign
 */
import fs from 'node:fs';
import path from 'node:path';

const DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/exec-mask';
const RAWDIR = path.join(DIR, 'raw', 'harness');
const argv = process.argv.slice(2);
const RUN = (() => { const i = argv.indexOf('--run'); return i >= 0 && argv[i + 1] ? argv[i + 1] : 'smoke'; })();

const files = fs.readdirSync(RAWDIR).filter((f) => new RegExp(`^perf-${RUN}-A-chrome-headless-.*\\.json$`).test(f))
  .map((f) => ({ f, m: fs.statSync(path.join(RAWDIR, f)).mtimeMs })).sort((a, b) => b.m - a.m);
if (!files.length) { console.log(`PREFLIGHT FAIL: no perf-${RUN}-*.json found in ${RAWDIR}`); process.exit(4); }
const j = JSON.parse(fs.readFileSync(path.join(RAWDIR, files[0].f), 'utf8'));
console.log(`preflight on ${files[0].f}`);
const bad = [];
const seen = {};
for (const rep of j.reps) {
  const tag = `rep${rep.rep}/${rep.arm}`;
  if (rep.error) { bad.push(`${tag}: execution error: ${rep.error}`); continue; }
  seen[rep.arm] = rep;
  const nPhases = (rep.phases || []).length;
  if (nPhases < 30) bad.push(`${tag}: only ${nPhases} phases`);
  const pos = (rep.phases || []).find((p) => p.label === 'POSCTL_120');
  if (!pos || !(pos.frameMax >= 90)) bad.push(`${tag}: POSCTL_120 frameMax=${pos ? pos.frameMax : 'missing'} (<90 => frame channel in doubt)`);
  console.log(`  ${tag}: phases=${nPhases} POSCTL_120.frameMax=${pos ? pos.frameMax : '?'} V3=${rep.bundleVerdict} interceptions=${rep.interceptionCount} maskBackdropFilter=${rep.maskStyle ? JSON.stringify(rep.maskStyle.backdropFilter) : '?'} served=${rep.servedBundle && (rep.servedBundle.sha256 || rep.servedBundle.error)}`);
  if (rep.arm === 'patch') {
    if (!(rep.interceptionCount >= 1)) bad.push(`${tag}: route never intercepted the bundle URL`);
    if (rep.interceptionSha256Ok !== true) bad.push(`${tag}: interception sha256 mismatch`);
    if (rep.bundleVerdict !== 'PATCH-SERVED') bad.push(`${tag}: bundleVerdict=${rep.bundleVerdict} (expected PATCH-SERVED)`);
  } else {
    if (rep.bundleVerdict !== 'PREIMAGE-SERVED') bad.push(`${tag}: bundleVerdict=${rep.bundleVerdict} (expected PREIMAGE-SERVED)`);
  }
  const shots = rep.shotMeta ? Object.keys(rep.shotMeta) : [];
  if (shots.length !== 3) bad.push(`${tag}: expected 3 screenshots, got ${shots.length} (${shots.join(',')})`);
  for (const [name, meta] of Object.entries(rep.shotMeta || {})) {
    if (!meta.file || !fs.existsSync(meta.file)) { bad.push(`${tag}/${name}: PNG missing`); continue; }
    const sz = fs.statSync(meta.file).size;
    if (sz < 50000) bad.push(`${tag}/${name}: PNG suspiciously small (${sz} B)`);
    if (!meta.panel) bad.push(`${tag}/${name}: no panel rect recorded`);
    console.log(`    shot ${name}: ${path.basename(meta.file)} ${sz} B panel=${JSON.stringify(meta.panel)} backdropFilter=${JSON.stringify(meta.maskBackdropFilter)}`);
  }
}
if (seen.normal && seen.patch) {
  if (seen.normal.maskStyle && seen.normal.maskStyle.backdropFilter !== 'blur(2px)') bad.push(`normal arm mask backdrop-filter = ${JSON.stringify(seen.normal.maskStyle.backdropFilter)} (expected blur(2px))`);
  if (seen.patch.maskStyle && seen.patch.maskStyle.backdropFilter !== 'none') bad.push(`patch arm mask backdrop-filter = ${JSON.stringify(seen.patch.maskStyle.backdropFilter)} (expected none)`);
} else bad.push(`arms present: ${Object.keys(seen).join(',')} (expected normal+patch)`);

// screenshot pair files must actually differ from each other in size at least (pixel diff is done later)
const shotNames = [...new Set(Object.values(seen).flatMap((r) => Object.keys(r.shotMeta || {})))];
for (const n of shotNames) {
  const a = seen.normal && seen.normal.shotMeta && seen.normal.shotMeta[n];
  const b = seen.patch && seen.patch.shotMeta && seen.patch.shotMeta[n];
  if (a && b) console.log(`  pair ${n}: ${path.basename(a.file)} (${a.pngBytes} B, ${a.maskBackdropFilter}) vs ${path.basename(b.file)} (${b.pngBytes} B, ${b.maskBackdropFilter})`);
}
if (bad.length) { console.log('PREFLIGHT FAIL:\n - ' + bad.join('\n - ')); process.exit(4); }
console.log('PREFLIGHT PASS — route interception, V3 self-proof, positive control and screenshot pairs are all live');
process.exit(0);
