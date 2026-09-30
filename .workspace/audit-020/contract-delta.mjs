import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const A = process.argv[2];
const B = process.argv[3];
const PKGS = process.argv.slice(4);

function listFiles(root) {
  const out = [];
  (function walk(d) {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); }
      else if (e.isFile()) out.push(path.relative(root, p));
    }
  })(root);
  return out.sort();
}
const sha = p => { try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch { return null; } };

// Extract "registration-ish" string literals: identifiers, quoted names, dotted paths
function identifiers(file) {
  let s = ''; try { s = fs.readFileSync(file, 'utf8'); } catch { return new Set(); }
  const set = new Set();
  // quoted strings that look like names/paths/ids
  for (const m of s.matchAll(/["'`]([A-Za-z@][A-Za-z0-9_@/.:-]{2,60})["'`]/g)) set.add(m[1]);
  // ctx.serviceName style and register('name')
  for (const m of s.matchAll(/\bctx\.([a-zA-Z][a-zA-Z0-9_]{2,30})/g)) set.add('ctx.' + m[1]);
  return set;
}

for (const pkg of PKGS) {
  const a = path.join(A, pkg, 'lib'), b = path.join(B, pkg, 'lib');
  if (!fs.existsSync(a) || !fs.existsSync(b)) { console.log('### ' + pkg + ': LIB MISSING'); continue; }
  const fa = listFiles(a), fb = listFiles(b);
  const changed = [], added = [], removed = [];
  for (const f of fb) { const ha = sha(path.join(a, f)), hb = sha(path.join(b, f)); if (ha === null) added.push(f); else if (ha !== hb) changed.push(f); }
  for (const f of fa) if (!fb.includes(f)) removed.push(f);

  console.log('\n### ' + pkg);
  console.log('  changed: ' + (changed.length ? changed.join(', ') : '(none)'));
  if (added.length) console.log('  added:   ' + added.join(', '));
  if (removed.length) console.log('  removed: ' + removed.join(', '));

  // identifier-level delta across the whole lib dir
  const ia = new Set(), ib = new Set();
  for (const f of fa) for (const x of identifiers(path.join(a, f))) ia.add(x);
  for (const f of fb) for (const x of identifiers(path.join(b, f))) ib.add(x);
  const onlyB = [...ib].filter(x => !ia.has(x)).sort();
  const onlyA = [...ia].filter(x => !ib.has(x)).sort();
  if (onlyA.length) console.log('  IDENT-ONLY-0.1.7 (' + onlyA.length + '): ' + onlyA.slice(0, 40).join(' | '));
  if (onlyB.length) console.log('  IDENT-ONLY-0.2.0 (' + onlyB.length + '): ' + onlyB.slice(0, 40).join(' | '));
}
