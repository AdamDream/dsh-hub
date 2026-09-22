// Attribute a V8 CPU profile to (bundle, line) and compute self-time top-N.
// V8 profile nodes carry a callFrame with functionName/lineNumber; the served plugin bundles are plain
// (non-minified, non-sourcemapped) files whose bytes are byte-identical to the on-disk
// ~/.dsh/profiles/node_modules/... files (verified by sha1 == the ?rev= in the boot payload), so the
// profile's URL + 1-based lineNumber IS the path:line of the source. That identity is also asserted
// independently: the function name reported by the profiler must match the name declared at that line.
import fs from 'node:fs';
import path from 'node:path';

const RAW = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/first-open-profile/raw';
const PROFILES_ROOT = '/home/CNS2026495165/.dsh/profiles/node_modules';

const args = process.argv.slice(2);
const file = args[0];
const label = args[1] || path.basename(file);
const topN = Number(args[2] || 30);

const prof = JSON.parse(fs.readFileSync(file, 'utf8'));
const nodes = new Map(prof.nodes.map(n => [n.id, n]));

// ---- self time per node (timeDeltas are MICROSECONDS)
const selfUs = new Map();
const totalUs = prof.timeDeltas.reduce((a, b) => a + b, 0);
for (let i = 0; i < prof.samples.length; i++) {
  const id = prof.samples[i];
  const d = prof.timeDeltas[i] || 0;
  selfUs.set(id, (selfUs.get(id) || 0) + d);
}
const windowMs = (prof.endTime - prof.startTime) / 1000;

// ---- resolve a callFrame url to a local file + verify the name at that line
const fileCache = new Map();
function resolveFile(url) {
  if (!url) return null;
  if (fileCache.has(url)) return fileCache.get(url);
  let local = null;
  const m = url.match(/^https?:\/\/127\.0\.0\.1:3080\/plugins\/(.+?)\/client\.js(?:\?.*)?$/);
  if (m) {
    const p = path.join(PROFILES_ROOT, m[1], 'lib/client.js');
    if (fs.existsSync(p)) local = p;
    else {
      // some plugins ship multiple files; try every js under lib/
      const dir = path.join(PROFILES_ROOT, m[1], 'lib');
      if (fs.existsSync(dir)) { const f = fs.readdirSync(dir).filter(x => x.endsWith('.js')); if (f.length) local = path.join(dir, f[0]); }
    }
  } else {
    const m2 = url.match(/^https?:\/\/127\.0\.0\.1:3080\/assets\/(.+?)(?:\?.*)?$/);
    if (m2) {
      for (const cand of ['/home/CNS2026495165/.dsh/profiles/node_modules', '/home/CNS2026495165/dsh/node_modules']) {
        const p = path.join(cand, 'assets', m2[1]);
        if (fs.existsSync(p)) { local = p; break; }
      }
    }
  }
  const out = { local, lines: null };
  if (local) { try { out.lines = fs.readFileSync(local, 'utf8').split('\n'); } catch (e) { } }
  fileCache.set(url, out);
  return out;
}
function bundleName(url) {
  if (!url) return '(no-url)';
  const m = url.match(/\/plugins\/([^/]+)\//); if (m) return m[1];
  const m2 = url.match(/\/assets\/([^/?]+)/); if (m2) return 'assets/' + m2[1];
  if (url.startsWith('http://127.0.0.1:3080')) return url.replace('http://127.0.0.1:3080', '');
  return url.replace(/^https?:\/\//, '');
}
function nameAt(url, line) {
  const r = resolveFile(url);
  if (!r || !r.lines || !line) return { matches: null, text: null };
  const text = (r.lines[line - 1] || '').trim().slice(0, 120);
  return { matches: true, text };
}
function isMinified(url) { return /\/assets\//.test(url || ''); }

// ---- aggregate self time by (bundle, function, line)
const byFn = new Map();
const byBundle = new Map();
const byFile = new Map();
for (const [id, us] of selfUs) {
  const n = nodes.get(id); if (!n) continue;
  const cf = n.callFrame;
  const url = cf.url || '';
  const key = `${bundleName(url)}|${cf.functionName || '(anonymous)'}|${cf.lineNumber}`;
  const cur = byFn.get(key) || { bundle: bundleName(url), fn: cf.functionName || '(anonymous)', line: cf.lineNumber, col: cf.columnNumber, url, us: 0, nodes: 0, minified: isMinified(url) };
  cur.us += us; cur.nodes++; byFn.set(key, cur);
  const b = byBundle.get(cur.bundle) || { bundle: cur.bundle, us: 0, fns: new Set() };
  b.us += us; b.fns.add(cf.functionName); byBundle.set(cur.bundle, b);
  const f = byFile.get(url || '(no-url)') || { url: url || '(no-url)', us: 0 };
  f.us += us; byFile.set(url || '(no-url)', f);
}
const rows = [...byFn.values()].map(r => {
  const nm = nameAt(r.url, r.line);
  return { ...r, ms: r.us / 1000, pct: r.us / totalUs * 100, srcLine: nm.text, nameMatchesLine: nm.text ? new RegExp('\\b' + r.fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(nm.text) : null };
}).sort((a, b) => b.us - a.us);
const bundles = [...byBundle.values()].map(b => ({ bundle: b.bundle, ms: b.us / 1000, pct: b.us / totalUs * 100, distinctFns: b.fns.size })).sort((a, b) => b.us - a.us);
const files = [...byFile.values()].map(f => ({ url: f.url, ms: f.us / 1000, pct: f.us / totalUs * 100, minified: isMinified(f.url) })).sort((a, b) => b.us - a.us);

const payload = {
  label, source: file, windowMs: Math.round(windowMs * 1000) / 1000, sampledUs: totalUs, sampledMs: totalUs / 1000,
  samples: prof.samples.length, coveragePct: Math.round(totalUs / (windowMs * 1000) * 1000) / 10,
  top: rows.slice(0, topN), bundles: bundles.slice(0, 40), files: files.slice(0, 40),
  identityCheck: { checked: rows.slice(0, topN).filter(r => r.nameMatchesLine !== null).length, matched: rows.slice(0, topN).filter(r => r.nameMatchesLine === true).length },
};
fs.writeFileSync(`${RAW}/profile-top-${label}.json`, JSON.stringify(payload, null, 2));

console.log(`### ${label}  window=${payload.windowMs}ms sampled=${payload.sampledMs.toFixed(1)}ms windowCoverage=${payload.coveragePct}%  samples=${payload.samples}`);
console.log(`identity: name-matches-source-line ${payload.identityCheck.matched}/${payload.identityCheck.checked} of top ${topN}`);
console.log('--- TOP SELF-TIME ---');
console.log('ms      %     bundle                                        fn                                              line  src');
for (const r of payload.top) {
  console.log(`${r.ms.toFixed(2).padStart(7)} ${r.pct.toFixed(2).padStart(5)}%  ${r.bundle.slice(0, 44).padEnd(44)}  ${(r.fn || '').slice(0, 42).padEnd(42)} ${String(r.line).padStart(5)}  ${(r.srcLine || '').slice(0, 60)}`);
}
console.log('--- BY BUNDLE ---');
for (const b of payload.bundles.slice(0, 20)) console.log(`${b.ms.toFixed(2).padStart(7)}ms ${b.pct.toFixed(2).padStart(5)}%  ${b.bundle}`);
