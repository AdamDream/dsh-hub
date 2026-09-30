import { execFileSync } from 'node:child_process';
const N = process.env.DSH_PKGS;
const v1 = await import(N + '/dsh-session-format-v0-to-v1/lib/index.js');
const files = process.argv.slice(2);
let v0 = 0, decodeFail = 0, passNow = 0, passFixed = 0, failNow = 0, failFixed = 0;
const reasonsNow = new Map(), reasonsFixed = new Map();
const classify = (m) => /uses unsupported descriptor version/.test(m) ? 'descriptor-version'
  : /unknown historical event type "([^"]+)"/.test(m) ? 'unknown:' + m.match(/unknown historical event type "([^"]+)"/)[1]
  : /unknown historical key|must contain|is required|payload/.test(m) ? 'payload-shape' : 'other';
for (const f of files) {
  let raw; try { raw = execFileSync('zstd', ['-dc', f], { maxBuffer: 1 << 30, timeout: 25000 }).toString('utf8'); }
  catch { decodeFail++; continue; }
  const lines = raw.split('\n').filter(Boolean);
  let hdr; try { hdr = JSON.parse(lines[0]); } catch { decodeFail++; continue; }
  if (hdr.version !== 0) continue;
  v0++;
  let nowErr = null, fixedErr = null;
  for (let i = 1; i < lines.length; i++) {
    let ev; try { ev = JSON.parse(lines[i]); } catch { continue; }
    if (ev.type === 'assistant/chunk') continue;
    if (!nowErr) { try { v1.assertReleasedEventPayload(ev, 0); } catch (e) { nowErr = e; } }
    if (!fixedErr) {
      const ev2 = (ev.type === 'subagent/descriptor' && ev.data && ev.data.version === 2)
        ? { ...ev, data: { ...ev.data, version: 3 } } : ev;
      try { v1.assertReleasedEventPayload(ev2, 0); } catch (e) { fixedErr = e; }
    }
    if (nowErr && fixedErr) break;
  }
  if (nowErr) { failNow++; const k = classify(String(nowErr.message)); reasonsNow.set(k,(reasonsNow.get(k)||0)+1); } else passNow++;
  if (fixedErr) { failFixed++; const k = classify(String(fixedErr.message)); reasonsFixed.set(k,(reasonsFixed.get(k)||0)+1); } else passFixed++;
}
const pct = (a,b) => b ? (100*a/b).toFixed(1)+'%' : 'n/a';
console.log('total sampled      :', files.length);
console.log('  decode/header err:', decodeFail);
console.log('  v0 sessions      :', v0);
console.log('  PASS as-is       :', passNow, '(' + pct(passNow,v0) + ')');
console.log('  FAIL as-is       :', failNow, '(' + pct(failNow,v0) + ')');
console.log('  --- 若只把 descriptor 2->3 ---');
console.log('  PASS             :', passFixed, '(' + pct(passFixed,v0) + ')');
console.log('  STILL FAIL       :', failFixed, '(' + pct(failFixed,v0) + ')');
console.log('  现状拒因:'); [...reasonsNow.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log('     ',String(v).padStart(4),k));
console.log('  修后剩余拒因:'); [...reasonsFixed.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log('     ',String(v).padStart(4),k));
