// Read-only: measure per-session live WS frame rates to pick a real active-stream source.
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const URL = 'http://127.0.0.1:3080';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/cpu-profile/raw';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const classify = (s) => {
  const roots = [...s.matchAll(/"root"\s*:\s*"([^"]{1,64})"/g)].map((m) => m[1]);
  const methods = [...s.matchAll(/"method"\s*:\s*"([^"]{1,64})"/g)].map((m) => m[1]);
  const types = [...s.matchAll(/"type"\s*:\s*"([^"]{1,48})"/g)].map((m) => m[1]);
  const rpc = [...s.matchAll(/"rpcId"\s*:\s*"([^"]{1,40})"/g)].map((m) => m[1]);
  return { len: s.length, roots: roots.slice(0, 3), methods: methods.slice(0, 3), types: types.slice(0, 4), rpc: rpc.slice(0, 2) };
};

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const frames = [];
page.on('websocket', (sock) => {
  sock.on('framereceived', (d) => {
    const s = typeof d === 'string' ? d : (d.payload ?? '').toString();
    frames.push({ t: Date.now(), dir: 'in', ...classify(s) });
  });
  sock.on('framesent', (d) => {
    const s = typeof d === 'string' ? d : (d.payload ?? '').toString();
    frames.push({ t: Date.now(), dir: 'out', ...classify(s) });
  });
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(8000);
const home0 = frames.length;
await sleep(10000);
const homeIdle = frames.length - home0;

// open each candidate session and measure its own stream
const candidates = ['9 个子代理运行中 会话删除更新误删全部会话', 'DeepSeek模型渠道不存在报错排查', '进行中 3 个子代理运行中 审计交接提示词并对齐需求', '/grill-me 交接提示词 v5 —'];
const res = [];
for (const title of candidates) {
  const key = title.slice(0, 12);
  // session rows are treeitems; click by text prefix
  let opened = false;
  try {
    const row = page.locator('[role=treeitem]', { hasText: key }).first();
    if (await row.count()) { await row.click({ timeout: 3000, position: { x: 60, y: 8 } }); opened = true; }
  } catch { }
  if (!opened) {
    // parent group may be collapsed; expand then retry
    try {
      const proj = page.locator('[class*=projectRow]').first(); await proj.click({ timeout: 2000 }).catch(() => { });
      const row = page.locator('[role=treeitem]', { hasText: key }).first();
      if (await row.count()) { await row.click({ timeout: 3000, position: { x: 60, y: 8 } }); opened = true; }
    } catch { }
  }
  await sleep(2500);
  const a = frames.length; const nodes = await page.evaluate(() => document.getElementsByTagName('*').length);
  await sleep(10000);
  const b = frames.length;
  const sub = frames.slice(a, b);
  const byRoot = {}; const byMethod = {};
  for (const f of sub) { for (const r of f.roots) byRoot[r] = (byRoot[r] || 0) + 1; for (const m of f.methods) byMethod[m] = (byMethod[m] || 0) + 1; }
  res.push({ title, opened, url: page.url(), nodes, frames10s: b - a, byRoot, byMethod });
  console.log('  ->', key, 'frames/10s=', b - a, 'nodes=', nodes);
}
fs.writeFileSync(`${OUT}/stream-probe.json`, JSON.stringify({ homeIdle, res, sampleFrames: frames.slice(-25) }, null, 2));
console.log(JSON.stringify({ homeIdleFrames10s: homeIdle, res }, null, 2).slice(0, 4000));
await browser.close();
