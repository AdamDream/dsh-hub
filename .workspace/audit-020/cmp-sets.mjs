import fs from 'node:fs';
import path from 'node:path';
const A = process.argv[2], B = process.argv[3];
function scan(root){
  const out = new Map();
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let ents; try { ents = fs.readdirSync(dir, {withFileTypes:true}); } catch { return; }
    for (const e of ents){
      if (!e.isDirectory()) continue;
      const p = path.join(dir, e.name);
      if (e.name.startsWith('@')) { walk(p, depth); continue; }
      const pj = path.join(p, 'package.json');
      if (fs.existsSync(pj)) {
        try { const j = JSON.parse(fs.readFileSync(pj,'utf8'));
          if (j.name && j.version && !out.has(j.name)) out.set(j.name, j.version);
        } catch {}
      }
      if (e.name === 'node_modules') walk(p, depth+1);
    }
  };
  walk(root, 0);
  return out;
}
const a = scan(A), b = scan(B);
const added = [...b.keys()].filter(k=>!a.has(k));
const removed = [...a.keys()].filter(k=>!b.has(k));
const verChanged = [...a.keys()].filter(k=>b.has(k) && a.get(k)!==b.get(k));
console.log('A total:', a.size, ' B total:', b.size);
console.log('\n=== ADDED in B ('+added.length+') ===');
added.sort().forEach(k=>console.log('  +', k, b.get(k)));
console.log('\n=== REMOVED from A ('+removed.length+') ===');
removed.sort().forEach(k=>console.log('  -', k, a.get(k)));
console.log('\n=== VERSION CHANGED ('+verChanged.length+') ===');
verChanged.sort().forEach(k=>console.log('  ~', k, a.get(k), '->', b.get(k)));
