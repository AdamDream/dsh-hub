import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const A = process.argv[2];
const B = process.argv[3];

function hashTree(root) {
  const m = new Map();
  function walk(dir) {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isDirectory()) {
        if (e.name === 'node_modules') continue;
        walk(path.join(dir, e.name));
      } else if (e.isFile()) {
        const p = path.join(dir, e.name);
        let h = '';
        try { h = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch { h = 'ERR'; }
        m.set(path.relative(root, p), h);
      }
    }
  }
  walk(root);
  return m;
}

const rows = [];
for (const n of fs.readdirSync(B).sort()) {
  const a = path.join(A, n), b = path.join(B, n);
  if (!fs.existsSync(a)) { rows.push({ n, status: 'NEW' }); continue; }
  if (!fs.statSync(a).isDirectory() || !fs.statSync(b).isDirectory()) continue;
  const fa = hashTree(a), fb = hashTree(b);
  let add = 0, del = 0, mod = 0;
  for (const k of fb.keys()) if (!fa.has(k)) add++;
  for (const k of fa.keys()) if (!fb.has(k)) del++;
  for (const k of fa.keys()) if (fb.has(k) && fa.get(k) !== fb.get(k)) mod++;
  const tot = Math.max(fa.size, fb.size, 1);
  rows.push({ n, status: 'CMP', tot, add, del, mod, churn: (add + del + mod) / tot });
}

rows.sort((x, y) => (y.churn ?? -1) - (x.churn ?? -1));
console.log('PKG\ttotal\tsame\tadded\tdeleted\tmodified\tchurn%');
let ident = 0, cmp = 0;
for (const r of rows) {
  if (r.status === 'NEW') { console.log(r.n + '\tNEW PACKAGE'); continue; }
  cmp++;
  if (r.add + r.del + r.mod === 0) ident++;
  console.log([r.n, r.tot, r.tot - r.add - r.del - r.mod, r.add, r.del, r.mod, (r.churn * 100).toFixed(1) + '%'].join('\t'));
}
console.log('\nIDENTICAL packages: ' + ident + ' / ' + cmp + ' compared; NEW: ' + (rows.length - cmp));
