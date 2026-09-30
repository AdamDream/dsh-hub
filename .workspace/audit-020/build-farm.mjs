import fs from 'node:fs';
import path from 'node:path';

// Build a flat symlink farm at <out>/node_modules mirroring all resolvable packages
// from a list of source node_modules roots (earlier roots win).
const out = process.argv[2];
const roots = process.argv.slice(3);
const nm = path.join(out, 'node_modules');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(nm, { recursive: true });

const seen = new Set();
let scoped = 0, plain = 0;

function consider(srcDir, name) {
  if (seen.has(name)) return false;
  seen.add(name);
  fs.symlinkSync(path.join(srcDir, name), path.join(nm, name), 'dir');
  return true;
}

for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    if (e.name.startsWith('@')) {
      const scopeDir = path.join(root, e.name);
      let subs = [];
      try { subs = fs.readdirSync(scopeDir); } catch { continue; }
      const scopeOut = path.join(nm, e.name);
      fs.mkdirSync(scopeOut, { recursive: true });
      for (const s of subs) {
        const key = e.name + '/' + s;
        if (seen.has(key)) continue;
        seen.add(key);
        try { fs.symlinkSync(path.join(scopeDir, s), path.join(scopeOut, s), 'dir'); scoped++; } catch {}
      }
    } else if (e.name !== '.bin' && e.name !== '.package-lock.json') {
      if (consider(root, e.name)) plain++;
    }
  }
}
console.log('farm built at ' + nm);
console.log('plain packages: ' + plain + ', scoped packages: ' + scoped + ', total keys: ' + seen.size);
