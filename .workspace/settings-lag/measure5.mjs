// 事件速率：统计 20s 内客户端收到的实时消息条数（WS 帧 + RPC），用于把"重建成本 × 事件速率"对上实测主线程占用
import { chromium } from 'playwright';
import fs from 'node:fs';
const OUT = '/home/CNS2026495165/dsh/.workspace/settings-lag';
const URL = 'http://127.0.0.1:3080';

const run = async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');

  const ws = [];
  page.on('websocket', (sock) => {
    const rec = { url: sock.url(), frames: 0, byType: {}, bytes: 0 };
    ws.push(rec);
    sock.on('framereceived', (f) => {
      rec.frames++; rec.bytes += (f.payload?.length || 0);
      const p = typeof f.payload === 'string' ? f.payload : '';
      for (const k of ['session/event', 'session/status', 'session/jobs', 'session/projection', 'assistant/message', 'host/session-status', 'subagent', 'tool']) {
        if (p.includes(k)) rec.byType[k] = (rec.byType[k] || 0) + 1;
      }
    });
  });
  const httpCalls = [];
  page.on('response', (r) => { const u = r.url().replace(URL, ''); if (u.startsWith('/api/')) httpCalls.push(u); });

  const metrics = async () => {
    const p = await cdp.send('Performance.getMetrics');
    const g = (n) => p.metrics.find((x) => x.name === n)?.value ?? null;
    return { script: g('ScriptDuration'), task: g('TaskDuration') };
  };

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);
  const m0 = await metrics(); const f0 = JSON.parse(JSON.stringify(ws.map((w) => ({ ...w, byType: {} }))));
  await page.waitForTimeout(20000);
  const m1 = await metrics();
  const dt = 20;
  const out = {
    seconds: dt,
    script_ms_per_s: Math.round(((m1.script - m0.script) * 1000) / dt),
    task_ms_per_s: Math.round(((m1.task - m0.task) * 1000) / dt),
    http_calls_during_window: httpCalls.length,
    sockets: ws.map((w) => w.url.replace(URL, '')),
    ws_frames_total: ws.reduce((a, w) => a + w.frames, 0),
    ws_frames_per_s: Math.round(ws.reduce((a, w) => a + w.frames, 0) / dt),
    ws_bytes_per_s: Math.round(ws.reduce((a, w) => a + w.bytes, 0) / dt),
    ws_by_keyword: ws.map((w) => w.byType),
  };
  fs.writeFileSync(`${OUT}/measure5.json`, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
};
run().catch((e) => { console.error('FATAL', e); process.exit(1); });
