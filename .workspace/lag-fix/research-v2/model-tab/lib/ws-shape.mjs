/* Read-only probe: connect to the GUI's own event mux as a peer and record what
 * the 模型 tab actually receives — frame sizes and inner event subtypes.
 * Opens only a WebSocket to the already-running host; writes nothing. */
import fs from 'node:fs';
import path from 'node:path';

const RAW = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/model-tab/raw';
const SECS = Number(process.argv[2] || 25);
const url = 'ws://127.0.0.1:3080/api/events.mux';
const log = (...a) => process.stderr.write(a.join(' ') + '\n');

const ws = new WebSocket(url);
const frames = [];
const byType = {};
const inner = {};
const sizes = {};
const t0 = Date.now();
ws.addEventListener('open', () => log('open', url));
ws.addEventListener('error', (e) => log('error', String(e && e.message || e)));
ws.addEventListener('message', (ev) => {
  const d = ev.data;
  const len = typeof d === 'string' ? d.length : (d && d.byteLength) || 0;
  let t = 'non-json', innerT = '', sessionId = '';
  try {
    const o = JSON.parse(d);
    t = (o.payload && o.payload.type) || o.type || '?';
    const p = o.payload || {};
    innerT = (p.payload && (p.payload.type || p.payload.kind)) || (p.event && p.event.type) || Object.keys(p).filter((k) => k !== 'type' && k !== 'sessionId').slice(0, 3).join(',');
    sessionId = p.sessionId || (p.payload && p.payload.sessionId) || '';
  } catch (e) { }
  byType[t] = (byType[t] || 0) + 1;
  sizes[t] = sizes[t] || { n: 0, bytes: 0, min: 1e9, max: 0 };
  sizes[t].n++; sizes[t].bytes += len; sizes[t].min = Math.min(sizes[t].min, len); sizes[t].max = Math.max(sizes[t].max, len);
  if (innerT) inner[t + ' > ' + innerT] = (inner[t + ' > ' + innerT] || 0) + 1;
  if (frames.length < 400) frames.push({ t: Date.now() - t0, type: t, inner: innerT, sessionId: sessionId.slice(0, 26), len, head: typeof d === 'string' ? d.slice(0, 260) : '' });
});
setTimeout(() => {
  const out = {
    url, seconds: SECS, framesTotal: Object.values(byType).reduce((a, b) => a + b, 0),
    byType, innerTop: Object.entries(inner).sort((a, b) => b[1] - a[1]).slice(0, 25),
    sizes: Object.fromEntries(Object.entries(sizes).map(([k, v]) => [k, { n: v.n, avgBytes: Math.round(v.bytes / v.n), min: v.min, max: v.max, mbPerSec: Math.round(v.bytes / SECS / 1048576 * 1000) / 1000 }])),
    sample: frames.slice(0, 40),
  };
  fs.writeFileSync(path.join(RAW, 'ws-shape.json'), JSON.stringify(out, null, 1));
  log(JSON.stringify({ byType, sizes: out.sizes }, null, 1));
  try { ws.close(); } catch (e) { }
  process.exit(0);
}, SECS * 1000);
