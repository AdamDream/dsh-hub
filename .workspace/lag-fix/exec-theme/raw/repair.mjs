import fs from 'node:fs';
const p = 'lib/patches.mjs';
const T = String.fromCharCode(9), Q = String.fromCharCode(34), NL = String.fromCharCode(10);
const BS = String.fromCharCode(92);
let s = fs.readFileSync(p, 'utf8');
const bad = T + T + 'find: ' + Q + T + T + Q + ' + F + ' + Q + BS + 'n' + T + T + Q + ' + P + ' + Q + BS + 'n' + "'" + ',';
const good = T + T + 'find: ' + Q + T + T + Q + ' + F + ' + Q + BS + 'n' + T + T + Q + ' + P + ' + Q + BS + 'n' + Q + ',';
if (s.split(bad).length - 1 !== 1) { console.error('MISS', JSON.stringify(bad)); process.exit(1); }
fs.writeFileSync(p, s.replace(bad, good));
console.log('repaired instancesOnlyCleanup find');
