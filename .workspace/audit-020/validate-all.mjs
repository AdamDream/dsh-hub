import { execFileSync } from 'node:child_process';
const N = process.env.DSH_PKGS;
const v1 = await import(N + '/dsh-session-format-v0-to-v1/lib/index.js');
const files = process.argv.slice(2);
let passNow = 0, passIfDescFixed = 0, failAfter = 0, notV0 = 0;
const after = new Map();
for (const f of files) {
  let raw;
  try { raw = execFileSync('zstd', ['-dc', f], { maxBuffer: 1 << 30, timeout: 25000 }).toString('utf8'); }
  catch { continue; }
  const lines = raw.split('\n').filter(Boolean);
  let hdr; try { hdr = JSON.parse(lines[0]); } catch { continue; }
  if (hdr.version !== 0) { notV0++; continue; }
  let firstNow = null, firstAfter = null;
  for (let i = 1; i < lines.length; i++) {
    let ev; try { ev = JSON.parse(lines[i]); } catch { continue; }
    if (ev.type === 'assistant/chunk') continue;
    // as-is
    if (!firstNow) { try { v1.assertReleasedEventPayload(ev, 0); } catch (e) { firstNow = e; } }
    // simulate descriptor 2 -> 3
    const ev2 = (ev.type === 'subagent/descriptor' && ev.data && ev.data.version === 2)
      ? { ...ev, data: { ...ev.data, version: 3 } } : ev;
    if (!firstAfter) { try { v1.assertReleasedEventPayload(ev2, 0); } catch (e) { firstAfter = e; } }
    if (firstNow && firstAfter) break;
  }
  if (!firstNow) passNow++;
  if (!firstAfter) passIfDescFixed++; else {
    failAfter++;
    const m = String(firstAfter.message);
    const k = /unknown historical event type "([^"]+)"/.test(m) ? 'unknown:' + m.match(/"([^"]+)"/)[1] : 'other';
    after.set(k, (after.get(k) || 0) + 1);
  }
}
console.log('v0 sessions:', passNow + failAfter + (0), '| non-v0 skipped:', notV0);
console.log('PASS as-is              :', passNow);
console.log('PASS if descriptor 2->3 :', passIfDescFixed);
console.log('STILL FAIL after fix    :', failAfter);
[...after.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log('   ', String(v).padStart(4), k));
