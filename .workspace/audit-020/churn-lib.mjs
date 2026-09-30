import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const A = process.argv[2];
const B = process.argv[3];
const SUB = process.argv[4] || 'lib';

function hashDir(root) {
  const m = new Map();
  function walk(dir) {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules') continue;
        walk(p);
      } else if (e.isFile()) {
        let h;
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
  const a = path.join(A, n, SUB), b = path.join(B, n, SUB);
  const aHas = fs.existsSync(a), bHas = fs.existsSync(b);
  if (!aHas && bHas) { rows.push({ n, status: 'NEW-PKG' }); continue; }
  if (aHas && !bHas) { rows.push({ n, status: 'NO-LIB-B' }); continue; }
  if (!aHas && !bHas) { rows.push({ n, status: 'NO-LIB-BOTH' }); continue; }
  const fa = hashDir(a), fb = hashDir(b);
  let add = 0, del = 0, mod = 0;
  for (const k of fb.keys()) if (!fa.has(k)) add++;
  for (const k of fa.keys()) if (!fb.has(k)) del++;
  for (const k of fa.keys()) if (fb.has(k) && fa.get(k) !== fb.get(k)) mod++;
  const tot = Math.max(fa.size, fb.size, 1);
  rows.push({ n, status: 'CMP', tot, add, del, mod, churn: (add + del + mod) / tot });
}

rows.sort((x, y) => (y.churn ?? -1) - (x.churn ?? -1));
console.log('PKG\ttotFiles\tsame\tadded\tdeleted\tmodified\tchurn%');
let ident = 0, cmp = 0;
const anomalous = [];
for (const r of rows) {
  if (r.status !== 'CMP') { anomalous.push(r.n + ' [' + r.status + ']'); continue; }
  cmp++;
  if (r.add + r.del + r.mod === 0) { ident++; continue; }
  console.log([r.n, r.tot, r.tot - r.add - r.del - r.mod, r.add, r.del, r.mod, (r.churn * 100).toFixed(1) + '%'].join('\t'));
}
console.log('\nCODE-IDENTICAL packages (' + SUB + '/): ' + ident + ' / ' + cmp);
console.log('CHANGED: ' + (cmp - ident));
if (anomalous.length) console.log('ANOMALOUS: ' + anomalous.join(', '));
