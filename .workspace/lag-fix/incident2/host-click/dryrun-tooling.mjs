#!/usr/bin/env node
/**
 * dryrun-tooling.mjs — 探针工具链的**自证**（不占共享浏览器锁、不打真实页面）
 *
 * 为什么需要它：本档能否采到"点击→面板可见"完全取决于三个前提，缺一个结论就是假的空白：
 *   ① 页内 hook 是否真的装上了（fetch 才是 unary RPC 的载体，WS 只走事件流）；
 *   ② 点击锚点（页内 mousedown/click 捕获）是否真的拿到；
 *   ③ 可见性信号是否真的会从 false 翻到 true（否则会把 "没采到" 误读成 "零延迟"）。
 * 这里用本地 mirror 页（/tmp 下自造一个含"设置"按钮的页面）把三条全跑通，
 * 再把同一套断言搬到真实宿主页面上。
 *
 * 用法：node dryrun-tooling.mjs
 */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const DIR = new URL('.', import.meta.url).pathname;
const probeSrc = readFileSync(DIR + 'host-click-probe.mjs', 'utf8');
// 用 probe 里显式哨兵提取页内脚本（不再依赖"下一段注释长什么样"，避免 probe 一改干跑就断）
const grab = (startMark, endMark) => {
  const a = probeSrc.indexOf(startMark);
  const b = probeSrc.indexOf(endMark, a);
  if (a < 0 || b < 0) throw new Error(`dryrun: 提取锚点缺失 ${startMark} / ${endMark}`);
  return probeSrc.slice(a + startMark.length, b);
};
const INIT = grab('const INIT_HOOKS = `', '`; // <<<HC-INIT-END>>>');
const VIS = grab('const VIS_PROBE = `', '`; // <<<HC-VIS-END>>>');

const PAGE = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>mirror-dryrun</title>
<script>${INIT.replace(/\\`/g, '`').replace(/\\\$/g, '$')}<\/script>
</head><body>
<div id="root">
  <button id="set" class="VOzbGW_trigger">设置</button>
  <button id="other">其他</button>
  <div id="host">
    <h2>会话</h2><p style="height:2000px">占位</p>
  </div>
</div>
<script>
// 模拟真实客户端：点击"设置"后先发 unary fetch 请求，再延迟 120ms 渲染设置面板
document.getElementById('set').addEventListener('click', async () => {
  try { await fetch('/api/settings.describe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'dry-1', method: 'settings.describe', payload: {} }) }); } catch (e) {}
  setTimeout(() => {
    const d = document.createElement('div');
    d.setAttribute('role', 'dialog');
    d.innerHTML = '<h2>设置</h2><div>子代理模型</div><div>访问模式</div>';
    document.getElementById('root').appendChild(d);
  }, 120);
});
<\/script></body></html>`;

// 静态服务：/api/settings.describe 返回一个合法 RPC 信封（延迟 40ms，模拟宿主处理）
const srv = createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE); return;
  }
  if (req.url.startsWith('/api/')) {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'server-response', rpcId: 'dry-1', result: { ok: true, value: { namespaces: 3 } } }));
    }, 40);
    return;
  }
  res.writeHead(404); res.end('nope');
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;
const BASE = `http://127.0.0.1:${PORT}`;
console.log(`[dryrun] mirror server on ${BASE}`);

const { chromium } = require('/home/CNS2026495165/playwright_scratch/node_modules/playwright');
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
await ctx.addInitScript({ content: INIT.replace(/\\`/g, '`').replace(/\\\$/g, '$') });
const page = await ctx.newPage();
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.evaluate(VIS.replace(/\\`/g, '`').replace(/\\\$/g, '$'));
await new Promise((r) => setTimeout(r, 300));

const btn = page.locator('button:has-text("设置")').first();
console.log(`[dryrun] 按钮数=${await page.locator('button:has-text("设置")').count()}`);

// 模拟探针的锚点臂：捕获阶段监听 pointerdown/click
await page.evaluate(`(() => {
  const hc = window.__hc;
  hc.marks.push({ label: 'arm-click-watch', t: hc.now(), perf: performance.now() });
  const onDown = (ev) => { const el = ev.target.closest ? ev.target.closest('button,[role=button],a[href]') : null; hc.marks.push({ label: 'pointerdown-captured', t: hc.now(), perf: performance.now(), btnText: el ? (el.innerText || '').trim().slice(0, 20) : null }); };
  const onClick = () => hc.marks.push({ label: 'click-captured', t: hc.now(), perf: performance.now() });
  document.addEventListener('pointerdown', onDown, { capture: true, once: true });
  document.addEventListener('mousedown', onDown, { capture: true, once: true });
  document.addEventListener('click', onClick, { capture: true, once: true });
})()`);
const tSend = performance.timeOrigin + performance.now();
await btn.click({ timeout: 5000, noWaitAfter: true });
const tDone = performance.timeOrigin + performance.now();
await new Promise((r) => setTimeout(r, 1200));

const snap = await page.evaluate(`(() => {
  const hc = window.__hc, vis = window.__hcVis;
  return { marks: hc.marks, rec: hc.rec, longtasks: hc.longtasks, frames: hc.frames.length,
           visVisibleAt: vis.visibleAt, visFirstContent: vis.firstContentAt, visMaxGap: vis.maxGap,
           mutations: vis.mutations.map(m => ({ t: m.t, tag: m.tag, role: m.role, txt: (m.txt||'').slice(0,60) })).slice(0, 12) };
})()`);

const anchor = snap.marks.find((m) => m.label === 'pointerdown-captured') || snap.marks.find((m) => m.label === 'click-captured');
const fetchOut = snap.rec.filter((e) => e.dir === 'fetch-out');
const fetchIn = snap.rec.filter((e) => e.dir === 'fetch-in');
const checks = {
  '① 页内 hook 装上（fetch-out/in 都有记录）': fetchOut.length > 0 && fetchIn.length > 0,
  '① hook 含 RPC 方法与请求体': fetchOut.some((e) => /settings\.describe/.test(e.body || '')),
  '② 点击锚点采到（pointerdown/click 捕获）': !!anchor,
  '③ 可见性信号从 false 翻到 true': snap.visVisibleAt != null,
  '③ 内容信号（关键字）也采到': snap.visFirstContent != null,
  '④ 突变观测记录到面板加入': snap.mutations.some((m) => m.role === 'dialog'),
  '⑤ 点击锚点落在 Node 夹逼窗内': anchor && anchor.t >= tSend - 60 && anchor.t <= tDone + 60,
};
console.log('\n=== dryrun 断言 ===');
let ok = true;
for (const [k, v] of Object.entries(checks)) { console.log(`  ${v ? 'PASS' : 'FAIL'}  ${k}`); if (!v) ok = false; }
console.log(`\n[锚点] pointerdown@${anchor ? anchor.t.toFixed(1) : 'n/a'}  Node夹逼 [${tSend.toFixed(1)}, ${tDone.toFixed(1)}] 宽=${(tDone - tSend).toFixed(1)}ms`);
console.log(`[点击→面板可见] ${snap.visVisibleAt != null && anchor ? (snap.visVisibleAt - anchor.t).toFixed(1) : 'n/a'} ms（合成 120ms 延迟，用于验证信号会翻）`);
console.log(`[fetch] out=${fetchOut.length} in=${fetchIn.length}；[longtask]=${(snap.longtasks || []).length}；[frames]=${snap.frames}；[visMaxPollGap]=${snap.visMaxGap?.toFixed(1)}`);
mkdirSync(DIR + 'raw', { recursive: true });
writeFileSync(DIR + 'raw/dryrun-tooling.json', JSON.stringify({ checks, ok, anchor, tSend, tDone, snap }, null, 2) + '\n');
console.log(`\n[dryrun] ${ok ? 'ALL PASS' : 'SOME FAIL'} -> raw/dryrun-tooling.json`);
await browser.close();
srv.close();
process.exit(ok ? 0 : 2);
