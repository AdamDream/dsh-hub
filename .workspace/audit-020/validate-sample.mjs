import { execFileSync } from 'node:child_process';
const N = process.env.DSH_PKGS;
const v1 = await import(N + '/dsh-session-format-v0-to-v1/lib/index.js');
const files = process.argv.slice(2);
const reasons = new Map();
let pass = 0, fail = 0;
for (const f of files) {
  let raw;
  try { raw = execFileSync('zstd', ['-dc', f], { maxBuffer: 1 << 30, timeout: 20000 }).toString('utf8'); }
  catch { reasons.set('decode-error', (reasons.get('decode-error')||0)+1); fail++; continue; }
  const lines = raw.split('\n').filter(Boolean);
  let hdr; try { hdr = JSON.parse(lines[0]); } catch { reasons.set('bad-header',(reasons.get('bad-header')||0)+1); fail++; continue; }
  if (hdr.version !== 0) { reasons.set('not-v0 (v'+hdr.version+')',(reasons.get('not-v0')||0)+1); continue; }
  let thrown = null;
  for (let i = 1; i < lines.length; i++) {
    let ev; try { ev = JSON.parse(lines[i]); } catch { continue; }
    if (ev.type === 'assistant/chunk') continue;
    try { v1.assertReleasedEventPayload(ev, 0); }
    catch (e) { thrown = e; break; }
  }
  if (!thrown) { pass++; continue; }
  fail++;
  let key = 'other';
  const m = String(thrown.message);
  if (/uses unsupported descriptor version/.test(m)) key = 'descriptor-version';
  else if (/unknown historical event type "([^"]+)"/.test(m)) key = 'unknown-type:' + m.match(/unknown historical event type "([^"]+)"/)[1];
  else if (/unknown historical key|must contain|required/.test(m)) key = 'payload-shape';
  reasons.set(key, (reasons.get(key)||0)+1);
}
console.log('sampled:', files.length, ' PASS:', pass, ' FAIL:', fail);
[...reasons.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log('  ', String(v).padStart(4), k));
