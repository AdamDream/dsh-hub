#!/usr/bin/env node
/**
 * host-click-probe.mjs — 「页面点『设置』」这一瞬间的**宿主侧响应**测量（本档主工具）
 *
 * 四层同时录，全部对齐到**同一 epoch 轴**（见 lib-clock.mjs）：
 *   ① 宿主心跳（Node 外部进程）：串行、50ms 间隔、交替 `POST /api/host.describe` 与 `POST /usage/status`，
 *      逐拍记录 t0/t1/墙钟 ms/响应字节 —— 拍间空档(gap)也能暴露"拍与拍之间"的宿主停顿。
 *   ② 页内 RPC 时间线：初始化脚本在**任何页面脚本之前**劫持 WebSocket / fetch / XHR，
 *      记录页面实际发出的 RPC 信封（method / 发送时刻 / 响应时刻 / 字节数）。
 *   ③ 点击事件三时刻：`clickDispatched`（CDP 派发）/ `clickHandlerCommitted`（点击事件处理器跑完）/
 *      `settingsPanelVisible`（设置面板内容真的进入 DOM）——都在页内时钟上。
 *   ④ 页面卡顿面：PerformanceObserver(longtask) + rAF 帧间隔 + DOM 轮询间隔。
 *
 * 时钟换算：页内 `performance.timeOrigin + performance.now()` 与本进程同一 epoch 轴，
 * 残差由 calibrateClock() 实测（RTT 上下界），报告里给出误差界，不假装零误差。
 *
 * 用法：
 *   node host-click-probe.mjs --mode diag                    # 只找设置按钮锚点
 *   node host-click-probe.mjs --run 1 --out raw/click-run1.json
 * 退出码：0=测量完成；2=前置不足（锁未持有/页面未就绪/未找到按钮）；1=异常
 */
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';
import { existsSync } from 'node:fs';
import { rpc, BEATS, summarize, window as win, writeJson, makeJsonlSink, absNow, quantile } from './lib-clock.mjs';

const require = createRequire(import.meta.url);
const PW = '/home/CNS2026495165/playwright_scratch/node_modules/playwright';
const { chromium } = require(PW);

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes('--' + n);

const BASE = argOf('base', 'http://127.0.0.1:3080');
const MODE = argOf('mode', 'run');
const RUN = argOf('run', '0');
const INT = Number(argOf('interval-ms', 50));
const PRE_MS = Number(argOf('pre-ms', 3000));
const POST_MS = Number(argOf('post-ms', 3000));
const SETTLE_QUIET_MS = Number(argOf('settle-quiet-ms', 1500));
const SETTLE_MAX_MS = Number(argOf('settle-max-ms', 25000));
const BTN = argOf('selector', 'button:has-text("设置")');
const OUT = argOf('out', `raw/click-run${RUN}.json`);
const LOCK = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock';

// ── 页内初始化脚本：必须第一个跑，才能截住页面的 WebSocket / fetch / XHR ──────────────
const INIT_HOOKS = `(() => {
  if (window.__hc) return; // 重复注入保护
  const rec = [];
  const st = { rec, t0: performance.timeOrigin };
  window.__hc = st;
  const now = () => performance.timeOrigin + performance.now();
  const methodOf = (env) => (env && (env.method || (env.request && env.request.method))) || (env && env.type) || '?';
  st.now = now;

  // ① WebSocket：RPC 信封的真实通道
  try {
    const OW = window.WebSocket;
    const wrap = (ws) => {
      try {
        const os = ws.send.bind(ws);
        ws.send = function (data) {
          const rec0 = { dir: 'out', t: now(), bytes: (typeof data === 'string' ? data.length : (data && data.byteLength) || -1), method: '?', rpcId: null };
          try { const j = JSON.parse(data); rec0.method = methodOf(j); rec0.rpcId = j.rpcId || null; rec0.raw = String(data).slice(0, 1500); } catch { /* 二进制/非 JSON */ }
          rec.push(rec0);
          return os(data);
        };
        ws.addEventListener('message', (ev) => {
          const rec0 = { dir: 'in', t: now(), bytes: -1, method: '?', rpcId: null };
          try {
            const s = typeof ev.data === 'string' ? ev.data : '';
            rec0.bytes = s ? s.length : -1;
            const j = JSON.parse(s);
            rec0.rpcId = j.rpcId || null;
            rec0.method = methodOf(j) || '?';
            rec0.type = j.type || null;
            rec0.ok = j.result ? j.result.ok === true : undefined;
            rec0.raw = s.slice(0, 900);
          } catch { /* 二进制/非 JSON */ }
          rec.push(rec0);
        });
        ws.addEventListener('open', () => rec.push({ dir: 'open', t: now() }));
        ws.addEventListener('close', () => rec.push({ dir: 'close', t: now() }));
      } catch (e) { rec.push({ dir: 'hook-error', t: now(), err: String(e) }); }
    };
    function HC(opts) { const ws = arguments.length ? new OW(...arguments) : new OW(); try { wrap(ws); } catch {} return ws; }
    HC.prototype = OW.prototype;
    for (const k of ['CONNECTING','OPEN','CLOSING','CLOSED']) HC[k] = OW[k];
    window.WebSocket = HC;
  } catch (e) { rec.push({ dir: 'hook-error', t: now(), err: 'WS ' + String(e) }); }

  // ② fetch：**unary RPC 的真实载体**（实测客户端 unary 走 HTTP fetch；WebSocket 只承载事件流）
  try {
    const of = window.fetch;
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '?';
      const method = (init && init.method) || (input && input.method) || 'GET';
      const body = String((init && init.body) || '');
      const r0 = { dir: 'fetch-out', t: now(), url, method, bytes: body.length || -1, body: body.slice(0, 900), rpcMethod: null, rpcId: null };
      try { const j = JSON.parse(body); r0.rpcMethod = j.method || null; r0.rpcId = j.rpcId || null; } catch { /* 非 JSON body */ }
      rec.push(r0);
      return of.apply(this, arguments).then((res) => {
        const r1 = { dir: 'fetch-in', t: now(), url, status: res.status, bytes: -1, rpcId: r0.rpcId, rpcMethod: r0.rpcMethod };
        rec.push(r1);
        // 旁路读一份响应体只为量字节数：这里对原记录**同一对象**回填，
        // 不再靠"记录的字面副本"（副本回填不到），也不再依赖分析器事后配对 ⇒ 字节数精确到每次调用。
        try {
          res.clone().text().then((s) => {
            r1.bytes = s.length;
            if (r1.jsonlSink) r1.jsonlSink({ dir: 'fetch-in-late', t: r1.t, url, rpcMethod: r0.rpcMethod, rpcId: r0.rpcId, bytes: s.length });
          }).catch(() => {});
        } catch { /* clone 不可用（如 opaque） */ }
        return res;
      }, (err) => {
        rec.push({ dir: 'fetch-error', t: now(), url, rpcMethod: r0.rpcMethod, rpcId: r0.rpcId, err: String(err && err.message || err) });
        throw err;
      });
    };
  } catch (e) { rec.push({ dir: 'hook-error', t: now(), err: 'fetch ' + String(e) }); }

  // ③ XHR
  try {
    const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this.__hc = { m, u }; return oo.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function (b) {
      const info = this.__hc || {};
      rec.push({ dir: 'xhr-out', t: now(), method: info.m, url: info.u, body: String(b || '').slice(0, 800) });
      this.addEventListener('load', () => rec.push({ dir: 'xhr-in', t: now(), url: info.u, status: this.status }));
      return os.apply(this, arguments);
    };
  } catch (e) { rec.push({ dir: 'hook-error', t: now(), err: 'xhr ' + String(e) }); }

  // ④ 长任务（页面主线程停顿）
  try {
    st.longtasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) st.longtasks.push({ t: e.startTime + performance.timeOrigin, dur: e.duration, name: e.name });
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) { /* 无 longtask 支持 */ }

  // ⑤ 点击三时刻的记录点 + rAF 帧间隔
  st.marks = [];
  st.mark = (label, extra) => { const m = { label, t: now(), perf: performance.now(), ...(extra || {}) }; st.marks.push(m); return m; };
  st.frames = [];
  try {
    let last = performance.now();
    const tick = () => { const n = performance.now(); st.frames.push({ t: performance.timeOrigin + n, dt: n - last }); last = n; if (st.frames.length < 3000) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  } catch {}
})();`; // <<<HC-INIT-END>>>

// ── 页内轮询：以 20ms 抓「设置面板可见」与 DOM 停顿时刻（都在页内时钟上） ─────────────
const VIS_PROBE = `(() => {
  if (window.__hcVis) return;
  const st = { polls: [], visibleAt: null, firstContentAt: null, lastPoll: null, maxGap: 0, samples: [], mutations: [] };
  window.__hcVis = st;
  const now = () => performance.timeOrigin + performance.now();
  const KEY = /设置|Settings|偏好|Preferences|子代理模型|访问模式|主题|外观|用量/;
  // ① 突变观测：记录"新出现的节点"，事后由快照判定哪个突变才是面板本体（不预设面板形态）
  try {
    const mo = new MutationObserver((recs) => {
      for (const r of recs) {
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1) continue;
          const txt = (((n.innerText || n.textContent || '') + '')).replace(/\\s+/g, ' ').trim().slice(0, 160);
          st.mutations.push({ t: now(), tag: n.tagName, cls: (((n.className || '') + '')).slice(0, 80), role: n.getAttribute ? n.getAttribute('role') : null, txt, kids: n.children ? n.children.length : 0 });
          if (st.mutations.length > 3000) st.mutations.shift();
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) { st.moError = String(e); }

  const sig = () => {
    const dlg = document.querySelector('[role=dialog],[role=menu],dialog');
    const heads = Array.from(document.querySelectorAll('h1,h2,h3,[role=heading]')).map((e) => (e.textContent || '').trim()).filter(Boolean);
    const bodyLen = document.body ? document.body.innerText.length : 0;
    const keyHits = heads.filter((h) => KEY.test(h)).length;
    // 设置面板未必是 dialog：用"短文本叶子里含关键字的元素数"作为第二信号
    let keyEls = 0;
    for (const e of document.querySelectorAll('*')) {
      if (e.children.length) continue;
      const t = ((e.textContent || '') + '').trim();
      if (t.length && t.length < 30 && KEY.test(t)) keyEls++;
    }
    return { dlg: !!dlg, heads: heads.slice(0, 12), bodyLen, keyHits, keyEls };
  };
  const tick = () => {
    const t = now();
    if (st.lastPoll != null) { const g = t - st.lastPoll; if (g > st.maxGap) st.maxGap = g; }
    st.lastPoll = t;
    const s = sig();
    st.samples.push({ t, dlg: s.dlg, bodyLen: s.bodyLen, keyEls: s.keyEls, head: s.heads.join('|') });
    if (st.samples.length > 4000) st.samples.shift();
    if (st.firstContentAt == null && (s.keyHits > 0 || s.keyEls >= 2)) st.firstContentAt = t;
    if (st.visibleAt == null && s.dlg) st.visibleAt = t;
    setTimeout(tick, 20);
  };
  tick();
})();`; // <<<HC-VIS-END>>>

function lockInfo() {
  try {
    if (!existsSync(LOCK)) return { exists: false, owner: null, pid: null, mine: false };
    const p = LOCK + '/owner.txt';
    if (!existsSync(p)) return { exists: true, owner: null, pid: null, mine: false, empty: true };
    const txt = require('node:fs').readFileSync(p, 'utf8');
    // 兼容 `agent=X`（acquire-probe-lock.sh）与 `agent: X`（多数线自写）与裸 `owner=` 三种写法
    const pick = (k) => { const m = txt.match(new RegExp('^\\s*' + k + '[:=]\\s*(.*)$', 'mi')); return m ? m[1].trim() : null; };
    const owner = pick('agent') || pick('owner') || '?';
    return { exists: true, owner, pid: pick('pid'), line: pick('line'), mine: /host-click/i.test(owner) };
  } catch (e) { return { exists: false, owner: null, err: String(e) }; }
}

/**
 * 原子自取锁：mkdir 成功即持锁；已存在则看 owner——
 *   - owner 是本线 ⇒ 直接持锁；
 *   - owner PID 存活 ⇒ 让路等待；
 *   - owner PID 已死**且**已超 25 分钟 ⇒ 按共享协议抢占（会记账到日志）。
 * 任何情况下都不删别人还活着的锁。
 */
async function acquireLock(explicit) {
  const t0 = absNow();
  let n = 0;
  for (;;) {
    n++;
    try {
      require('node:fs').mkdirSync(LOCK); // 原子
      require('node:fs').writeFileSync(LOCK + '/owner.txt',
        `agent=incident2-host-click\npid=${process.pid}\nline=host-click\nstarted_at=${new Date(absNow()).toISOString()}\npurpose=host-side heartbeat during 设置 click; read-only endpoints + one allowed /usage/refresh (G1)\nhost=${require('node:os').hostname()}\n`);
      const inf = lockInfo();
      if (inf.mine) { console.log(`[lock] 原子取得（attempt ${n}, ${((absNow() - t0) / 1000).toFixed(0)}s）`); return true; }
      console.log(`[lock] mkdir 成功但 owner 已变成 ${inf.owner}（他人并发）⇒ 让路`);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const inf = lockInfo();
    if (inf.mine) { console.log(`[lock] 已由本线持有（${((absNow() - t0) / 1000).toFixed(0)}s）`); return true; }
    const alive = inf.pid ? (() => { try { process.kill(Number(inf.pid), 0); return true; } catch { return false; } })() : false;
    if (inf.exists && !inf.pid) {
      // 无 pid 记录的锁：只按目录 mtime 判老
      try {
        const st = require('node:fs').statSync(LOCK);
        const ageS = (Date.now() - st.mtimeMs) / 1000;
        if (ageS > 1500) { console.log(`[lock] 抢占用例：无 pid 且目录年龄 ${ageS.toFixed(0)}s>1500s`); require('node:fs').rmSync(LOCK, { recursive: true, force: true }); continue; }
        inf.ageS = ageS;
      } catch { /* ignore */ }
    } else if (inf.exists && inf.pid && !alive) {
      inf.ageS = inf.ageS ?? null;
      console.log(`[lock] owner pid ${inf.pid} 已不存在（owner=${inf.owner}）⇒ 等待其目录被清理或按协议超时抢占`);
    }
    if (n % 40 === 0 || n === 1) console.log(`[lock-wait] ${((absNow() - t0) / 1000).toFixed(0)}s attempts=${n} owner=${inf.owner} pid=${inf.pid} alive=${alive}`);
    if (absNow() - t0 > explicit) { console.error(`[abort] 等锁超时 ${(explicit / 1000).toFixed(0)}s（attempts=${n}）`); return false; }
    // 短轮询：实测多线易手只隔 <1s，2.5-5.5s 的退避等于**永远抢不到**（我 260s 内 0 次命中）。
    // 协议本身就靠 mkdir 的原子性保证互斥，所以紧密重试是安全且公平的。
    await sleep(150 + Math.random() * 250);
  }
}

/**
 * 并发/负载快照 —— 协调者裁决（2026-09-22，方案 c）规则 2 要求：
 * 取锁失败超 3 分钟即可并发运行，但**必须落盘 concurrentWith 与当时 loadavg**。
 * 这里用 /proc 直接枚举（不用 pgrep -f：本档已被它自匹配坑过两次）。
 */
function concurrencySnapshot(lockInfo0) {
  const out = { at: absNow(), atIso: new Date(absNow()).toISOString(), loadavg: null, pressure: {}, chromium: [], foreignChromiumCount: 0, nodeProbeCount: 0, lockOwner: lockInfo0?.owner ?? null, lockPid: lockInfo0?.pid ?? null, concurrentWith: [] };
  try { out.loadavg = require('node:fs').readFileSync('/proc/loadavg', 'utf8').trim(); } catch { /* ignore */ }
  for (const k of ['cpu', 'io', 'memory']) {
    try { out.pressure[k] = require('node:fs').readFileSync('/proc/pressure/' + k, 'utf8').trim(); } catch { /* 无 PSI */ }
  }
  let self = process.pid;
  let dirs = [];
  try { dirs = require('node:fs').readdirSync('/proc').filter((d) => /^\d+$/.test(d)); } catch { /* ignore */ }
  for (const d of dirs) {
    let cmd = '';
    try { cmd = require('node:fs').readFileSync('/proc/' + d + '/cmdline', 'utf8').split('\0').join(' ').trim(); } catch { continue; }
    if (!cmd) continue;
    if (/headless_shell|chrome-linux|ms-playwright/.test(cmd)) {
      const pid = Number(d);
      out.chromium.push({ pid, rssKb: procRss(pid), cmd: cmd.slice(0, 100) });
    }
    if (/host-click-probe\.mjs|host-drift\.mjs|measure\.mjs|matrix\.mjs|capture-fixture\.mjs|firstopen|theme-open/.test(cmd) && !cmd.includes(String(self))) out.nodeProbeCount++;
  }
  out.foreignChromiumCount = out.chromium.length;
  out.concurrentWith = out.chromium.map((c) => `chromium/PID ${c.pid} (rss ${c.rssKb}kB)`);
  if (!out.concurrentWith.length) out.concurrentWith = ['(无外来 chromium 进程)'];
  return out;
}
function procRss(pid) { try { const m = require('node:fs').readFileSync('/proc/' + pid + '/status', 'utf8').match(/^VmRSS:\s+(\d+)/m); return m ? Number(m[1]) : null; } catch { return null; } }

function releaseLock() {
  try {
    const inf = lockInfo();
    if (!inf.mine) { console.log(`[lock] 释放跳过：owner=${inf.owner}（不是本线，绝不清理他人记账）`); return; }
    const extra = require('node:fs').readdirSync(LOCK).filter((f) => f !== 'owner.txt');
    if (extra.length) { console.log(`[lock] 释放跳过：目录内有非本线文件 ${extra.join(',')}`); return; }
    require('node:fs').rmSync(LOCK + '/owner.txt');
    require('node:fs').rmdirSync(LOCK);
    console.log('[lock] 已释放');
  } catch (e) { console.log(`[lock] 释放异常 ${e && e.message}`); }
}

async function main() {
  const inf0 = lockInfo();
  console.log(`[lock] 初始 ${JSON.stringify(inf0)}`);
  let heldByUs = inf0.mine;
  let concurrentMode = false;
  const concurrentAfterS = Number(argOf('concurrent-after-s', 0)); // 0 = 不启用（沿用旧的纯排队行为）
  if (has('allow-no-lock')) {
    console.log('[lock] --allow-no-lock：**仅用于本地 mirror 干跑**，不用于真实页面测量');
  } else if (!heldByUs && concurrentAfterS > 0) {
    // 协调者裁决（2026-09-22，方案 c）规则 2：先原子取锁；取不到超过 N 秒即并发运行，但必须标注。
    heldByUs = await acquireLock(concurrentAfterS * 1000);
    if (!heldByUs) {
      concurrentMode = true;
      console.log(`[lock] 等待 ${concurrentAfterS}s 未取得锁 ⇒ 按裁决规则 2 **并发运行**（结果必须用运行内 pre 窗对照判读，并落盘 concurrentWith/loadavg）`);
    }
  } else if (!heldByUs) {
    heldByUs = await acquireLock(Number(argOf('lock-timeout-s', 1800)) * 1000);
    if (!heldByUs) process.exit(2);
  } else {
    console.log('[lock] 本线已持有，直接进入');
  }
  const conc = concurrencySnapshot(concurrentMode ? lockInfo() : { owner: '(本线持锁)', pid: String(process.pid) });
  conc.lockHeldByThisLine = heldByUs;
  conc.concurrentMode = concurrentMode;
  console.log(`[concurrency] ${concurrentMode ? 'CONCURRENT' : 'EXCLUSIVE'}  loadavg=${conc.loadavg}  外来 chromium=${conc.foreignChromiumCount}  ${conc.concurrentWith.join(' | ').slice(0, 160)}`);

  const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript({ content: INIT_HOOKS });

  const page = await ctx.newPage();
  const nodeSide = { requests: [], responses: [], consoleErrors: [], wsFrames: [], cdpRpc: [] };
  // 独立传输面复核：CDP Network 域的 WebSocket 帧（不依赖页内 hook 是否装上）
  try {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    const cdpReq = new Map();
    cdp.on('Network.requestWillBeSent', (e) => {
      const url = e.request?.url || '';
      if (!/\/api\/|\/usage\//.test(url)) return;
      cdpReq.set(e.requestId, { t: absNow(), method: e.request?.method, url, postData: (e.request?.postData || '').slice(0, 1200) });
    });
    cdp.on('Network.responseReceived', (e) => {
      const r0 = cdpReq.get(e.requestId);
      if (!r0) return;
      nodeSide.cdpRpc.push({ ...r0, respT: absNow(), status: e.response?.status, mimeType: e.response?.mimeType, respMs: absNow() - r0.t, encodedBytes: e.response?.encodedDataLength });
    });
    cdp.on('Network.loadingFinished', (e) => {
      const r0 = cdpReq.get(e.requestId);
      if (r0) { nodeSide.cdpRpc.push({ ...r0, doneT: absNow(), totalMs: absNow() - r0.t, note: 'loadingFinished(无 responseReceived 时兜底)' }); cdpReq.delete(e.requestId); }
    });
    cdp.on('Network.webSocketFrameSent', (e) => {
      const p = e.response?.payloadData || '';
      nodeSide.wsFrames.push({ dir: 'sent', t: absNow(), bytes: p.length, raw: p.slice(0, 700) });
    });
    cdp.on('Network.webSocketFrameReceived', (e) => {
      const p = e.response?.payloadData || '';
      nodeSide.wsFrames.push({ dir: 'recv', t: absNow(), bytes: p.length, raw: p.slice(0, 500) });
    });
    cdp.on('Network.webSocketCreated', (e) => nodeSide.wsFrames.push({ dir: 'created', t: absNow(), url: e.url }));
  } catch (e) { nodeSide.cdpError = String(e && e.message || e); }
  page.on('request', (r) => nodeSide.requests.push({ t: absNow(), method: r.method(), url: r.url(), postData: (r.postData() || '').slice(0, 1200), resourceType: r.resourceType() }));
  page.on('response', async (r) => {
    let bytes = -1;
    try { const buf = await r.body(); bytes = buf ? buf.length : -1; } catch { /* 响应体不可得 */ }
    nodeSide.responses.push({ t: absNow(), url: r.url(), status: r.status(), bytes });
  });
  page.on('pageerror', (e) => nodeSide.consoleErrors.push({ t: absNow(), kind: 'pageerror', text: String(e).slice(0, 400) }));
  page.on('console', (m) => { if (m.type() === 'error') nodeSide.consoleErrors.push({ t: absNow(), kind: 'console', text: m.text().slice(0, 400) }); });

  const navT0 = absNow();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  console.log(`[nav] domcontentloaded at +${(absNow() - navT0).toFixed(0)}ms`);

  // 静止判定：连续 SETTLE_QUIET_MS 内没有新的网络请求完成
  let lastReq = absNow();
  page.on('requestfinished', () => { lastReq = absNow(); });
  const settleStart = absNow();
  while (absNow() - lastReq < SETTLE_QUIET_MS && absNow() - settleStart < SETTLE_MAX_MS) await sleep(200);
  console.log(`[settle] quiet after ${(absNow() - settleStart).toFixed(0)}ms (nav->settle ${(absNow() - navT0).toFixed(0)}ms)`);

  // 时钟换算：页内 timeOrigin 与本进程 timeOrigin 在同一 epoch 轴；用 RTT 夹逼给出残差界
  const calib = await page.evaluate(() => ({ timeOrigin: performance.timeOrigin, now: performance.now(), dateNow: Date.now() }));
  const tA = absNow();
  const calib2 = await page.evaluate(() => ({ timeOrigin: performance.timeOrigin, now: performance.now(), dateNow: Date.now() }));
  const tB = absNow();
  // 墙钟一致度自证：页内 Date.now()（采样区间中点）与本进程 Date.now() 直接对差。
  // 这一项才是真正的"换算误差"证据；`deltaTimeOriginMs` 只是两个进程各自的启动/建页时刻差，
  // **不是时钟偏移**（run1 实测 73.3s，正好等于本进程启动→建页的等待时间），必须在报告里写清以免误读。
  const clockResidualMs = (calib.dateNow + (calib2.dateNow - calib.dateNow) / 2) - (tA + tB) / 2;
  const skewBound = (tB - tA) / 2;
  console.log(`[clock] page.timeOrigin=${calib.timeOrigin.toFixed(1)} node.timeOrigin=${performance.timeOrigin.toFixed(1)} Δ=${(calib.timeOrigin - performance.timeOrigin).toFixed(1)}ms  evalRTT=${(tB - tA).toFixed(1)}ms ⇒ 换算误差界 ±${skewBound.toFixed(1)}ms`);

  // 按钮存在性（前置闸门）
  const btn = page.locator(BTN).first();
  const btnCount = await page.locator(BTN).count();
  if (MODE === 'diag') {
    const cands = await page.evaluate(() => Array.from(document.querySelectorAll('button,[role=button],a[href]')).map((el) => ({ text: (el.innerText || el.textContent || '').trim().slice(0, 30), aria: el.getAttribute('aria-label') || '', cls: (el.className || '').toString().slice(0, 40) })).filter((x) => x.text || x.aria));
    writeJson(OUT, { mode: 'diag', selector: BTN, btnCount, candidates: cands, clock: { calib, skewBound } });
    console.log(`[diag] selector=${BTN} count=${btnCount} -> ${OUT}`);
    await browser.close();
    if (heldByUs && !has('allow-no-lock')) releaseLock();
    process.exit(0);
  }
  if (btnCount < 1) {
    console.error(`[abort] 未找到设置按钮 selector=${BTN}`);
    await browser.close();
    if (heldByUs && !has('allow-no-lock')) releaseLock();
    process.exit(2);
  }

  const jsonl = makeJsonlSink(OUT.replace(/\.json$/, '.jsonl'));
  const beats = [];
  const t0 = absNow();
  const marks = { preStart: t0, clickVerdictStart: null, clickDone: null, postEnd: null, clickDispatched: null };

  // 页内可见性轮询装好（在点击之前）
  await page.evaluate(VIS_PROBE);
  await page.evaluate(`window.__hc && window.__hc.rec.push({dir:'mark',t:window.__hc.now(),label:'vis-probe-installed'})`);

  // 心跳循环：串行、单调排程
  let stop = false;
  let i = 0;
  let lastT1 = null;
  // 排程基准在**这里**重置（所有前置等待之后、录制之前）。若沿用更早的基准，
  // 首拍会带巨大负 schedSkew，随后循环"追账"连发补拍，造出一串**自己制造的**
  // 100–330ms 假尖峰 —— preflight 实测踩到，12 连拍全假。
  let nextDue = absNow();
  const loop = (async () => {
    while (!stop) {
      const spec = BEATS[i % BEATS.length];
      const due = nextDue;
      nextDue = due + INT;
      const b = await rpc(BASE, spec.url, spec.method, {});
      const beat = {
        seq: i, endpoint: spec.url, method: spec.method,
        t0: b.t0, t1: b.t1, ms: b.ms,
        // idleExcess = 上一拍结束 → 本拍开始之间、超出既定间隔的部分。
        // 这是"探针进程自己被饿住"的干净指标（宿主慢 ⇒ ms 大而 idleExcess 小；
        // 探针被饿 ⇒ idleExcess 大）。它**不含**上一拍的耗时，故不会与 ms 混为一谈。
        idleExcess: lastT1 == null ? 0 : Math.max(0, (b.t0 - lastT1) - INT),
        http: b.http, respBytes: b.bytes, ok: b.ok, error: b.error,
        phase: "pending", // 点击后按锚点统一重标
      };
      lastT1 = b.t1;
      beats.push(beat); jsonl(beat);
      if (b.ms >= 100) console.log(`[STALL] seq=${i} ${spec.url} ${b.ms.toFixed(1)}ms (phase=${beat.phase})`);
      i++;
      if (stop) break;
      const wait = nextDue - absNow();   // 单调排程：按 due 推进，欠账时立刻发（欠账记在 idleExcess）
      await sleep(wait > 0 ? wait : 0);
    }
  })();

  await sleep(PRE_MS);
  console.log(`[pre] ${PRE_MS}ms 结束：累计拍数=${beats.length}（循环是否在跑=${!stop}）`);

  // ── 点击 ──────────────────────────────────────────────────────────────
  // 锚点策略（避免"卡在 click() 里就没法测"的死结）：
  //   A) 先让页内把「真实 mousedown 时刻」写进 __hc.marks —— 为此预热后立刻请求一次「点击后立即打点」的轻量求值，
  //      用 rAF 链在**收到点击后立刻**记录；该值在点击返回后才能取回，但**时间戳在页内时钟上**，不受宿主停顿影响。
  //   B) Node 侧另记 [tSend, tDone] 夹逼作为兜底界。
  const tSend = absNow();
  marks.clickVerdictStart = tSend;
  await page.evaluate(`(() => {
    const hc = window.__hc;
    hc.marks.push({ label: 'arm-click-watch', t: hc.now(), perf: performance.now() });
    // 捕获阶段监听：真实用户手势（mousedown/pointerdown）落下的那一刻打点，
    // 用 performance.timeOrigin + now 记录 ⇒ 与宿主心跳在同一 epoch 轴。
    const onDown = (ev) => {
      const el = ev.target && ev.target.closest ? ev.target.closest('button,[role=button],a[href]') : null;
      hc.marks.push({ label: 'pointerdown-captured', t: hc.now(), perf: performance.now(), btnText: el ? (el.innerText || '').trim().slice(0, 20) : null });
    };
    const onClick = () => { hc.marks.push({ label: 'click-captured', t: hc.now(), perf: performance.now() }); };
    document.addEventListener('pointerdown', onDown, { capture: true, once: true });
    document.addEventListener('mousedown', onDown, { capture: true, once: true });
    document.addEventListener('click', onClick, { capture: true, once: true });
  })()`);
  let clickErr = null;
  try {
    await btn.click({ timeout: 8000, noWaitAfter: true });
  } catch (e) { clickErr = String(e.message || e); }
  marks.clickDone = absNow();
  const pageMarksAfterClick = await page.evaluate(`(() => { window.__hc.marks.push({label:'click-dispatch-end',t:window.__hc.now(),perf:performance.now()}); return window.__hc.marks; })()`);
  // 锚点优先用页内捕获的真实手势时刻（同一 epoch 轴、不受宿主停顿影响）；
  // 若捕获缺失（例如合成事件没触发 pointerdown/mousedown 捕获），退回 Node 侧 [tSend, clickDone] 夹逼的中点。
  const pd = pageMarksAfterClick.find((m) => m.label === 'pointerdown-captured' || m.label === 'click-captured');
  const anchorSource = pd ? `${pd.label}(页内捕获)` : 'node-bracket-midpoint';
  marks.clickAnchor = pd ? pd.t : (tSend + marks.clickDone) / 2;
  marks.clickAnchorUncertaintyMs = pd ? 0 : (marks.clickDone - tSend) / 2;
  console.log(`[click] anchor=${marks.clickAnchor.toFixed(1)} 来源=${anchorSource} 不确定度=±${marks.clickAnchorUncertaintyMs.toFixed(1)}ms  夹逼宽=${(marks.clickDone - tSend).toFixed(1)}ms err=${clickErr || 'none'}`);

  // 按锚点重标 phase（不再依赖"循环跑到哪"）
  for (const b of beats) b.phase = b.t0 < marks.clickAnchor ? 'pre' : 'post';

  // ── 点击后 3 秒继续心跳 ────────────────────────────────────────────────
  await sleep(POST_MS);
  marks.postEnd = absNow();
  stop = true;
  await loop;

  // ── 收尾取证 ──────────────────────────────────────────────────────────
  const snapshot = await page.evaluate(`(() => {
    const hc = window.__hc, vis = window.__hcVis;
    return {
      pageTimeOrigin: performance.timeOrigin,
      marks: hc ? hc.marks : null,
      rec: hc ? hc.rec : null,
      longtasks: hc ? hc.longtasks : null,
      frames: hc ? hc.frames.slice(-1200) : null,
      vis: vis ? { visibleAt: vis.visibleAt, firstContentAt: vis.firstContentAt, maxGap: vis.maxGap, lastPoll: vis.lastPoll, tail: vis.samples.slice(-1600), mutations: (vis.mutations || []).slice(0, 400) } : null,
      title: document.title,
    };
  })()`);
  const tSnapA = absNow();
  const calibEnd = await page.evaluate(() => ({ timeOrigin: performance.timeOrigin, now: performance.now() }));
  const tSnapB = absNow();

  // 面板可见后再多等 2s，看设置响应的尾巴（可能超出心跳窗口）
  await sleep(2000);
  const tail = await page.evaluate(`(() => {
    const hc = window.__hc, vis = window.__hcVis;
    const samples = vis ? vis.samples : [];
    const KEY = /设置|Settings|偏好|Preferences|子代理模型|访问模式|主题|外观/;
    let lastKey = null, lastDlg = null;
    for (const s of samples) { if (KEY.test(s.head)) lastKey = s.t; if (s.dlg) lastDlg = s.t; }
    return { rec: hc ? hc.rec.slice(-160) : null, visVisibleAt: vis ? vis.visibleAt : null, visFirst: vis ? vis.firstContentAt : null, visLastKeyAt: lastKey, visLastDlgAt: lastDlg, nSamples: samples.length };
  })()`);

  const clickT = marks.clickAnchor;
  const w = {
    pre: win(beats, clickT - PRE_MS, clickT),
    plusMinus500: win(beats, clickT - 500, clickT + 500),
    post: win(beats, clickT, clickT + POST_MS),
    all: beats,
  };
  const result = {
    kind: 'host-click-run',
    run: RUN,
    base: BASE,
    mode: MODE,
    selector: BTN,
    intervalMs: INT,
    preMs: PRE_MS, postMs: POST_MS,
    anchor: { clickAnchor: clickT, source: anchorSource, uncertaintyMs: marks.clickAnchorUncertaintyMs, nodeBracket: { tSend, tDone: marks.clickDone, widthMs: marks.clickDone - tSend } },
    concurrency: conc,
    clock: {
      nodeTimeOrigin: performance.timeOrigin,
      pageTimeOrigin: snapshot.pageTimeOrigin,
      deltaTimeOriginMs: snapshot.pageTimeOrigin - performance.timeOrigin,
      calibStart: calib, calibEnd,
      evalRttStartMs: tB - tA, evalRttEndMs: tSnapB - tSnapA,
      skewBoundMs: Math.max((tB - tA) / 2, (tSnapB - tSnapA) / 2),
      clockResidualMs,
      note: '页内与 Node 都在 epoch 轴（timeOrigin+now），直接比较。clockResidualMs = 页内 Date.now() 与本进程 Date.now() 的实测差（真正的换算误差）；deltaTimeOriginMs 只是"本进程启动→建页"的等待时间差，不是时钟偏移',
    },
    marks: { ...marks, clickBracketMs: marks.clickDone - tSend },
    pageMarks: pageMarksAfterClick,
    summary: {
      pre: summarize(w.pre),
      plusMinus500: summarize(w.plusMinus500),
      post: summarize(w.post),
      all: summarize(w.all),
    },
    beats,
    page: {
      rpcTimeline: snapshot.rec,
      longtasks: snapshot.longtasks,
      framesSummary: frameSummary(snapshot.frames),
      vis: snapshot.vis ? { visibleAt: snapshot.vis.visibleAt, firstContentAt: snapshot.vis.firstContentAt, maxGap: snapshot.vis.maxGap, lastPoll: snapshot.vis.lastPoll } : null,
      visibleAt: snapshot.vis ? snapshot.vis.visibleAt : null,
      firstContentAt: snapshot.vis ? snapshot.vis.firstContentAt : null,
      maxPollGap: snapshot.vis ? snapshot.vis.maxGap : null,
      visTail: snapshot.vis ? snapshot.vis.tail : null,
    },
    tail,
    nodeSide,
    clickError: clickErr,
  };
  writeJson(OUT, result);

  const s = result.summary;
  // 采样完整性自检：三个窗口的拍数、位置与排程偏差必须自洽，否则"没采到"会被误读成"没停顿"
  console.log(`[diag] beats=${beats.length} 首拍 t0-anchor=${fmt(beats.length ? beats[0].t0 - clickT : NaN)} 末拍 t0-anchor=${fmt(beats.length ? beats[beats.length - 1].t0 - clickT : NaN)}`);
  const idle = beats.map((b) => b.idleExcess || 0).sort((a, b) => a - b);
  console.log(`[diag] 窗内拍数 pre=${w.pre.length} click±500=${w.plusMinus500.length} post=${w.post.length}；探针自我饿住 idleExcess p50=${fmt(quantile(idle, .5))} max=${fmt(idle[idle.length - 1])}`);
  // 注意：此处 `page` 是 Playwright 的 Page 对象（本作用域内被它占用了名字），
  // 快照数据在 result.page 里 —— 之前这里误读 page.vis 一直是 undefined（diag 打印"未采到"但 JSON 里其实有值）。
  const rp = result.page;
  const vis0 = rp.vis?.visibleAt ?? rp.vis?.firstContentAt;
  console.log(`[diag] 点击→设置面板可见 = ${vis0 != null ? fmt(vis0 - clickT) + ' ms（' + (rp.vis?.visibleAt != null ? 'dialog 信号' : '内容信号') + '）' : '未采到（INCONCLUSIVE）'}；页内可见性轮询最大间隔=${fmt(rp.vis?.maxGap)}ms；页内 rpcTimeline=${(rp.rpcTimeline || []).length} 条；墙钟残差=${fmt(result.clock.clockResidualMs, 2)}ms`);
  console.log(`[summary pre]           n=${s.pre.n} p50=${fmt(s.pre.p50)} p95=${fmt(s.pre.p95)} max=${fmt(s.pre.max)}`);
  console.log(`[summary click±500ms]   n=${s.plusMinus500.n} p50=${fmt(s.plusMinus500.p50)} p95=${fmt(s.plusMinus500.p95)} max=${fmt(s.plusMinus500.max)}`);
  console.log(`[summary post3s]        n=${s.post.n} p50=${fmt(s.post.p50)} p95=${fmt(s.post.p95)} max=${fmt(s.post.max)}`);
  console.log(`[stalls>=100ms in click window] ${w.plusMinus500.filter((b) => b.ms >= 100).length}`);
  console.log(`[out] ${OUT}`);
  await browser.close();
  if (heldByUs && !has('allow-no-lock')) releaseLock();
  process.exit(0);
}

function fmt(x) { return Number.isFinite(x) ? x.toFixed(1) : 'n/a'; }

function frameSummary(frames) {
  if (!frames || !frames.length) return null;
  const dt = frames.map((f) => f.dt).sort((a, b) => a - b);
  return { n: dt.length, p50: quantile(dt, 0.5), p95: quantile(dt, 0.95), max: dt[dt.length - 1], over50: dt.filter((x) => x > 50).length };
}

main().catch((e) => {
  console.error('[FATAL]', e && e.stack || e);
  // 异常路径也要尽量把锁交还，否则会把别的线堵死（本档实测锁竞争很紧）
  try { releaseLock(); } catch { /* ignore */ }
  process.exit(1);
});
