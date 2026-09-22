#!/usr/bin/env node
// Self-contained CDP driver: launches its OWN headless_shell with its OWN
// --user-data-dir, so it never touches other agents' chromium processes.
// Shutdown is cooperative (Browser.close over CDP) -- no signals, no kills.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HS   = process.argv[2];
const URL_ = process.argv[3];
const W    = process.argv[4];
const H    = process.argv[5];
const PORT = process.argv[6];
const OUT  = process.argv[7];
const PROF = process.argv[8];

if (!HS || !URL_ || !W || !H || !PORT || !OUT || !PROF) {
  console.error('usage: driver.mjs <headless_shell> <url> <W> <H> <port> <out.json> <userdatadir>');
  process.exit(2);
}

fs.rmSync(OUT, { force: true });
fs.mkdirSync(PROF, { recursive: true });

let report_flags = process.env.EXTRA_FLAGS || '';
const args = [
  '--headless',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-setuid-sandbox',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--autoplay-policy=no-user-gesture-required',
  '--enable-logging=stderr',
  '--v=0',
  `--user-data-dir=${PROF}`,
  `--window-size=${W},${H}`,
  `--remote-debugging-port=${PORT}`,
  ...(process.env.EXTRA_FLAGS ? process.env.EXTRA_FLAGS.split(/\s+/).filter(Boolean) : []),
  URL_
];

// own child, cooperative shutdown
const child = spawn(HS, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: false });

let stderrTail = '';
child.stderr.on('data', (b) => {
  stderrTail += b.toString();
  if (stderrTail.length > 40000) stderrTail = stderrTail.slice(-40000);
});
child.stdout.on('data', () => {});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools(timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('devtools endpoint did not come up');
}

function makeClient(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      }
    });
    ws.addEventListener('error', (e) => reject(new Error('ws error: ' + e.message)));
    ws.addEventListener('open', () => {
      resolve({
        send(method, params) {
          const mid = ++id;
          return new Promise((res, rej) => {
            pending.set(mid, { res, rej });
            ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
            setTimeout(() => {
              if (pending.has(mid)) { pending.delete(mid); rej(new Error('cdp timeout: ' + method)); }
            }, 120000);
          });
        },
        close() { try { ws.close(); } catch {} }
      });
    });
  });
}

async function evaluate(client, expr, awaitPromise) {
  const r = await client.send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: !!awaitPromise,
    returnByValue: true,
    allowUnsafeEvalBlockedByCSP: true
  });
  if (r.exceptionDetails) {
    throw new Error('page exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 600));
  }
  return r.result.value;
}

const VARIANTS = [
  ['baseline',           {}],
  ['ripple-r50',         {}],
  ['ripple-r100',        {}],
  ['ripple-r200',        {}],
  ['ripple-r400',        {}],
  ['ripple-r800',        {}],
  ['ripple-r1600',       {}],
  ['ripple-fullclear',   {}],
  ['tray-layout',        {}],
  ['tray-layout-forced', {}],
  ['tray-transform',     {}],
  ['tray-backdrop',      {}],
  ['tray-backdrop-40',   {}],
  ['tray-frost',         {}],
  ['tray-backdrop-layout',   {}],
  ['tray-backdrop-animbg',   {}],
  ['tray-frost-layout',      {}],
  ['ripple-smallcanvas-r400',{}],
  ['ripple-smallcanvas-r800',{}],
  ['ripple-dom-r400',        {}],
  ['ripple-dom-r800',        {}]
];
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
const SELECTED = ONLY ? VARIANTS.filter(v => ONLY.includes(v[0])) : VARIANTS;

const report = {
  ok: false,
  windowSize: `${W}x${H}`,
  headlessShell: HS,
  extraFlags: report_flags,
  startedAt: new Date().toISOString(),
  variants: [],
  error: null,
  stderrTail: ''
};

let client = null;
try {
  const wsUrl = await waitForDevtools(30000);
  client = await makeClient(wsUrl);
  await client.send('Runtime.enable');
  await client.send('Page.enable');

  // give the page a moment to settle after navigation
  await sleep(1200);

  report.gl = await evaluate(client, 'JSON.stringify(window.__glInfo ? window.__glInfo() : {ok:false,reason:"no api"})');
  report.gl = JSON.parse(report.gl);
  report.env = await evaluate(client, 'JSON.stringify(window.__env())');
  report.env = JSON.parse(report.env);

  const hasBench = await evaluate(client, 'typeof window.__bench');
  if (hasBench !== 'function') throw new Error('window.__bench not present; page did not load');
  report.ok = true;

  for (const [name, opts] of SELECTED) {
    const expr = `window.__bench(${JSON.stringify(name)}, ${JSON.stringify(opts)})`;
    try {
      const v = await evaluate(client, expr, true);
      report.variants.push(v);
      console.log(`[${W}x${H}] ${name.padEnd(20)} ` +
        `p50=${String(v.delta_p50).padStart(8)} p95=${String(v.delta_p95).padStart(8)} ` +
        `max=${String(v.delta_max).padStart(9)} fps=${String(v.fps_effective).padStart(7)} ` +
        `frames=${v.frames} dropped=${v.dropped}`);
    } catch (e) {
      report.variants.push({ variant: name, error: String(e.message).slice(0, 400) });
      console.log(`[${W}x${H}] ${name.padEnd(20)} ERROR ${String(e.message).slice(0, 200)}`);
    }
  }
} catch (e) {
  report.error = String(e && e.stack ? e.stack : e).slice(0, 2000);
  console.error('DRIVER ERROR:', report.error);
} finally {
  report.stderrTail = stderrTail.slice(-8000);
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('wrote ' + OUT);
  // cooperative shutdown -- no signals
  if (client) {
    try { await client.send('Browser.close'); } catch {}
    client.close();
  }
  await sleep(1500);
  process.exit(0);
}
