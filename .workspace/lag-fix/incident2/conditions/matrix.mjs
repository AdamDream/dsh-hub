#!/usr/bin/env node
/*
 * conditions/matrix.mjs — 设置页卡顿「条件画像」对照矩阵
 * ---------------------------------------------------------------------------
 * 线：        incident2 / conditions（本目录独占）
 * 目标：      在**固定判据**下，测「在什么条件下点设置会卡 / 什么条件下不卡」。
 * 判据（预注册，见 PREREG）：click→面板可见耗时 + 点击前后各 3s 的 >50ms 帧数 + 最长任务。
 *
 * 纪律（照抄 research-v2/measure-hardening/docs/PROTOCOL.md 与 incident2/static-events/LOCK.md）：
 *   - 启动任何浏览器**之前**必须先 mkdir 原子取锁 research-v2/.probe.lock；
 *   - 抢占**仅当** owner 年龄 >25min **且** owner 进程已确认不存在；未知存活一律不抢占；
 *   - 每窗口**前/后**各做一次并发门禁：外来主浏览器实例数必须为 0，否则该窗口 invalid；
 *   - **绝不** pkill/killall/对非自己创建的进程投递信号（唯一例外 process.kill(pid,0) 存活探测）；
 *   - 只读：只点「设置」/「关闭」/设置页导航/侧栏会话标题；**不点**保存/应用/删除/移除壁纸/模型切换；
 *   - 每个 cell 每次 rep 都是**全新 context + 全新 page**（满足"全部新开页面"）。
 *
 * 用法：
 *   node matrix.mjs --reps 2                      # 全部 cell
 *   node matrix.mjs --cells BASE,D1-longsession   # 指定 cell
 *   node matrix.mjs --label run1
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { census, ownByAncestry } from './census.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

// ---------------------------------------------------------------- 常量
const DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/conditions';
const RAW = path.join(DIR, 'raw');
const LOGS = path.join(DIR, 'logs');
const LOCK_DIR = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock';
const URL_ = process.env.DSH_URL || 'http://127.0.0.1:3080';
const HOST_PID = 10806;
const BROWSER_PAT = 'headless_shell';
const FIELD_TRIAL_FLAG = '--disable-field-trial-config';
const AGENT = 'incident2-conditions';
const LINE = 'conditions-matrix';

// **预注册判据**（在测量前固定；不得事后放宽）
const PREREG = {
  jank_frames_gt50_post: 3,     // 点击后 3s 内 >50ms 帧 >=3 ⇒ 卡
  jank_longest_task_ms: 100,    // 点击后 3s 内最长任务 >100ms ⇒ 卡
  jank_click_to_panel_ms: 300,  // click→面板 DOM 出现 >300ms ⇒ 卡
  // 反事实（豁免）判据：全部满足 ⇒ 不卡
  smooth_frames_gt50_post: 1,
  smooth_longest_task_ms: 50,
  smooth_click_to_panel_ms: 200,
};
const MIN_DOM_NODES = 300;
const PRE_POST_MS = 3000;

// 侧栏"长会话"（session.list 实测最长且非 running：925 steps / 102 turns）
const LONG_SESSION_TITLE = '相机重映射，main版本';
const LONG_SESSION_GROUP = 'Dexterous_Hand_23Dof';
// 用量卡片所在"插件页"的候选标签（RECON/MECHANISM：本部署该卡只存在于 设置→插件，
// 侧栏并无此页；真实标题为 `Token 用量 · dsh-usage`）——尽力而为并如实记账
const USAGE_PAGE_CANDIDATES = ['Token 用量 · dsh-usage', '用量 · dsh-usage', '偏好库 (taste)'];

const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const REPS = Math.max(1, Number(argOf('--reps', '2')));
const LABEL = argOf('--label', 'conditions');
const ONLY = argOf('--cells', '') ? argOf('--cells', '').split(',').map((s) => s.trim()) : null;
const LOCK_WAIT_MS = Number(argOf('--lock-wait-ms', String(30 * 60 * 1000)));
/* ★ 偏离协议默认（20–40s）并记账：实测 589s 内 0 次胜出——兄弟线 incident2-regression
 *   连续批次"释放后立即重取"，守规的 20–40s 退避会被**永久饿死**。锁的取得仍是原子
 *   mkdir，收紧间隔**不降低安全性**，只提高公平性。0 = 用协议默认。 */
const RETRY_MIN_MS = Number(argOf('--lock-retry-min-ms', '0')) || 20000;
const RETRY_MAX_MS = Number(argOf('--lock-retry-max-ms', '0')) || 40000;

// ---------------------------------------------------------------- cell 定义
// 设计：BASE 为参照；每个 cell 只改**一个**因子（OFAT），因此可读成"条件→卡/不卡"矩阵。
// 选择器/杠杆依据 `RECON.md`（静态侦察线，"UNVERIFIED" 项在运行中以自证字段落盘）。
const ALL_CELLS = [
  { id: 'BASE', dim: '0-baseline', entry: 'home', order: 'first', load: 'wait10', vp: [1440, 900], scale: 'current', wallpaper: 'on', theme: 'current', cacheDisabled: false },
  { id: 'D1-longsession', dim: '1-entry', entry: 'longsession', order: 'first', load: 'wait10', vp: [1440, 900], scale: 'current', wallpaper: 'on', theme: 'current', cacheDisabled: false },
  { id: 'D1-pluginusage', dim: '1-entry', entry: 'pluginusage', order: 'first', load: 'wait10', vp: [1440, 900], scale: 'current', wallpaper: 'on', theme: 'current', cacheDisabled: false },
  { id: 'D2-reopen', dim: '2-order', entry: 'home', order: 'reopen', load: 'wait10', vp: [1440, 900], scale: 'current', wallpaper: 'on', theme: 'current', cacheDisabled: false },
  { id: 'D3-immediate', dim: '3-loadstate', entry: 'home', order: 'first', load: 'immediate', vp: [1440, 900], scale: 'current', wallpaper: 'on', theme: 'current', cacheDisabled: true },
  { id: 'D3-wait10', dim: '3-loadstate', entry: 'home', order: 'first', load: 'wait10', vp: [1440, 900], scale: 'current', wallpaper: 'on', theme: 'current', cacheDisabled: true },
  { id: 'D3-wait60', dim: '3-loadstate', entry: 'home', order: 'first', load: 'wait60', vp: [1440, 900], scale: 'current', wallpaper: 'on', theme: 'current', cacheDisabled: true },
  { id: 'D4-1920', dim: '4-viewport', entry: 'home', order: 'first', load: 'wait10', vp: [1920, 1080], scale: 'current', wallpaper: 'on', theme: 'current', cacheDisabled: false },
  // 900 宽 < 1024 ⇒ 侧栏收成 rail（无「设置」文字）⇒ 必须用 settingsArea 作用域选择器，否则本格无效
  { id: 'D4-narrow', dim: '4-viewport', entry: 'home', order: 'first', load: 'wait10', vp: [900, 800], scale: 'current', wallpaper: 'on', theme: 'current', cacheDisabled: false },
  // 规模杠杆：折叠已展开的工作区分组（RECON：折叠后该分组渲染 0 行会话）
  // 1100 宽 > 1024 断点 ⇒ 侧栏仍是完整树：用于**隔离宽度**（避免与"跨断点改版式"混淆）
  { id: 'D4-1100', dim: '4-viewport', entry: 'home', order: 'first', load: 'wait10', vp: [1100, 800], scale: 'current', wallpaper: 'on', theme: 'current', cacheDisabled: false },
  { id: 'D5-collapsed', dim: '5-scale', entry: 'home', order: 'first', load: 'wait10', vp: [1440, 900], scale: 'collapse', wallpaper: 'on', theme: 'current', cacheDisabled: false },
  // 真正的 O(N) 检验：把每个分组的「展开其余 N 个会话」全点开，把已渲染行数拉到最大
  { id: 'D5-expanded', dim: '5-scale', entry: 'home', order: 'first', load: 'wait10', vp: [1440, 900], scale: 'expandAll', wallpaper: 'on', theme: 'current', cacheDisabled: false },
  // 壁纸三杠杆（RECON：darkMask 元素**不存在**，霜化是 body 内联 token 覆盖；模态另有全视口 blur(2px)）
  { id: 'D6-frostoff', dim: '6-wallpaper', entry: 'home', order: 'first', load: 'wait10', vp: [1440, 900], scale: 'current', wallpaper: 'frost-off', theme: 'current', cacheDisabled: false },
  { id: 'D6-wallpaperoff', dim: '6-wallpaper', entry: 'home', order: 'first', load: 'wait10', vp: [1440, 900], scale: 'current', wallpaper: 'off', theme: 'current', cacheDisabled: false },
  { id: 'D6-noblur', dim: '6-wallpaper', entry: 'home', order: 'first', load: 'wait10', vp: [1440, 900], scale: 'current', wallpaper: 'noblur', theme: 'current', cacheDisabled: false },
  { id: 'D7-dark', dim: '7-theme', entry: 'home', order: 'first', load: 'wait10', vp: [1440, 900], scale: 'current', wallpaper: 'on', theme: 'dark', cacheDisabled: false },
];
const CELLS = ONLY ? ALL_CELLS.filter((c) => ONLY.includes(c.id)) : ALL_CELLS;

// ---------------------------------------------------------------- 工具
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function nowIso(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}+${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

const logLines = [];
function log(msg) {
  const line = `[${new Date().toTimeString().slice(0, 8)}] ${msg}`;
  console.log(line);
  logLines.push(line);
}

/* ---------- 浏览器实例普查（来自 census.mjs：已用 /proc/PID/exe 去伪） ---------- */
function loadavg() { try { return Number(fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0]); } catch { return null; } }
let OWN_PIDS = new Set();
function concurrencyProbe() {
  const c = census(OWN_PIDS);
  return { ...c, own_pids: [...OWN_PIDS] };
}

/* ---------------------------------------------------------------- 锁 */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function readOwner() {
  let raw = '';
  try { raw = fs.readFileSync(path.join(LOCK_DIR, 'owner.txt'), 'utf8'); } catch { }
  const o = {};
  for (const line of raw.split('\n')) {
    // 本机实测**两种** owner.txt 格式并存：
    //   (a) 协议/lock.mjs 派：`agent: X` / `owner_pid: N` / `started_epoch: E`
    //   (b) 兄弟线派：      `pid=15894 ts=2026-09-22T10:09:56+08:00 owner=incident2-live-repro line=...`
    // 只认冒号会把 (b) 读成 "unknown"（实测踩到）⇒ 两种都解析。
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*(.*)$/.exec(line.trim());
    if (m) o[m[1]] = m[2].trim();
  }
  return o;
}
function ownerProc(owner) {
  for (const k of ['owner_pid', 'agent_pid', 'pid', 'probe_pid']) {
    const n = Number(String(owner[k] || '').match(/\d+/)?.[0]);
    if (Number.isInteger(n) && n > 0) return { field: k, pid: n };
  }
  return { field: null, pid: null };
}
/** owner 开始时刻：兼容 started_epoch（秒）与 ts/started_at（ISO）。 */
function ownerAgeMin(owner) {
  const ep = Number(owner.started_epoch || 0);
  if (ep > 0) return (Date.now() / 1000 - ep) / 60;
  const iso = owner.ts || owner.started_at;
  if (iso) { const t = Date.parse(iso); if (!Number.isNaN(t)) return (Date.now() - t) / 60000; }
  return null;
}
const ownerName = (owner) => owner.agent || owner.owner || 'unknown';
let LOCK_TOKEN = null;
async function acquireLock() {
  const t0 = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(LOCK_DIR);
      LOCK_TOKEN = `${os.hostname()}-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
      fs.writeFileSync(path.join(LOCK_DIR, 'owner.txt'), [
        `agent: ${AGENT}`,
        `line: ${LINE}`,
        `purpose: 7-dimension conditions matrix; read-only settings open; ${CELLS.length} cells x ${REPS} reps`,
        `owner_pid: ${process.pid}   # the probe process; preemption checks THIS`,
        `host_pid: ${HOST_PID}   # monitored GUI host (node dsh web); not the owner`,
        `started_at: ${nowIso()}`,
        `started_epoch: ${Math.floor(Date.now() / 1000)}`,
        `token: ${LOCK_TOKEN}`,
      ].join('\n') + '\n');
      log(`LOCK acquired after ${Math.round((Date.now() - t0) / 1000)}s`);
      return { ok: true, waitedSec: Math.round((Date.now() - t0) / 1000), preempted: [] };
    } catch (e) { if (e.code !== 'EEXIST') throw e; }

    const owner = readOwner();
    const op = ownerProc(owner);
    const ageMin = ownerAgeMin(owner);
    const alive = op.pid ? pidAlive(op.pid) : null;
    if (ageMin != null && ageMin > 25 && op.pid && alive === false) {
      log(`LOCK PREEMPT: owner ${ownerName(owner)} age ${ageMin.toFixed(1)}min pid ${op.pid} gone`);
      try { fs.rmSync(LOCK_DIR, { recursive: true, force: true }); continue; } catch { }
    }
    if (Date.now() - t0 > LOCK_WAIT_MS) {
      log(`LOCK wait exceeded ${LOCK_WAIT_MS}ms; giving up (NOT taking the lock)`);
      return { ok: false, reason: 'wait-timeout' };
    }
    const w = RETRY_MIN_MS + Math.floor(Math.random() * Math.max(RETRY_MAX_MS - RETRY_MIN_MS, 1));
    log(`LOCK held by ${ownerName(owner)} (age ${ageMin == null ? '?' : ageMin.toFixed(1)}min, ownPid ${op.pid ?? 'unknown'}/${alive}); retry in ${Math.round(w / 1000)}s (elapsed ${Math.round((Date.now() - t0) / 1000)}s)`);
    await sleep(w);
  }
}
function releaseLock() {
  if (!LOCK_TOKEN) return;
  const owner = readOwner();
  if (owner.token && owner.token !== LOCK_TOKEN) { log('LOCK release REFUSED: token mismatch'); return; }
  try { fs.rmSync(LOCK_DIR, { recursive: true, force: true }); LOCK_TOKEN = null; log('LOCK released'); }
  catch (e) { log('LOCK release failed: ' + String(e).slice(0, 120)); }
}

// ---------------------------------------------------------------- 页面仪表
const INIT_SCRIPT = () => {
  const M = (window.__M = { raf: [], lt: [], clickAt: null, panelAt: null, panelPaintAt: null, arm: false, errors: [], wpWrites: 0, wpSameValueWrites: 0, wpWatchArmed: false });
  const tick = (t) => { M.raf.push(Math.round(t * 100) / 100); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) M.lt.push({ start: Math.round(e.startTime * 100) / 100, dur: Math.round(e.duration * 100) / 100 }); })
      .observe({ entryTypes: ['longtask'] });
  } catch { }
  const check = () => {
    if (M.panelAt !== null) return;
    try {
      if (document.querySelectorAll('[role="dialog"] *').length > 0) {
        M.panelAt = Math.round(performance.now() * 100) / 100;
        requestAnimationFrame((t) => { M.panelPaintAt = Math.round(t * 100) / 100; });
      }
    } catch { }
  };
  const start = () => {
    try { new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true }); } catch { }
    check();
    // ★ MECHANISM 提出的最关键 UNVERIFIED：dsh-wallpaper 每次发布都把**同一个**
    //   backgroundImage/filter 字符串写回全屏 layer（dsh-wallpaper:255-257）。若 Blink
    //   不对"同值 inline style 赋值"早退，则每次 list/theme 发布会重绘一层全屏解码图，
    //   成本落在 Paint（JS 自时间看不见）——与"残余 65–100 ms/s 未归因"吻合。
    //   本仪表只读计数：wallpaper layer 的 style 属性写入次数 + 其中"值未变"的次数。
    const armWpWatch = () => {
      const w = [...document.querySelectorAll('body > div')].find((e) => (e.getAttribute('style') || '').includes('background-size: cover'));
      if (!w || M.wpWatchArmed) return;
      M.wpWatchArmed = true;
      let last = w.getAttribute('style');
      new MutationObserver((recs) => {
        for (const r of recs) {
          if (r.attributeName !== 'style') continue;
          const now = w.getAttribute('style');
          M.wpWrites += 1;
          if (now === last) M.wpSameValueWrites += 1;
          last = now;
        }
      }).observe(w, { attributes: true, attributeFilter: ['style'] });
    };
    let tries = 0;
    const t = setInterval(() => { armWpWatch(); if (M.wpWatchArmed || ++tries > 60) clearInterval(t); }, 250);
  };
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
  window.addEventListener('error', (e) => M.errors.push('ERR ' + String(e.message).slice(0, 160)));
};

const FACTS_FN = () => {
  const all = [...document.querySelectorAll('*')];
  const cs = getComputedStyle(document.body);
  const he = document.documentElement;
  const norm = (s) => (s || '').replace(/\s+/g, ' ').slice(0, 110);
  // 混淆控制（MECHANISM 警告 #3）：HOME 上可能本来就有 onboarding 全屏 blur 层，
  // 会污染所有 "无设置" 基线。逐格数出**全视口且 backdrop-filter≠none** 的元素。
  const bfLayers = [];
  for (const e of all) {
    const s = getComputedStyle(e);
    if (!s.backdropFilter || s.backdropFilter === 'none') continue;
    const r = e.getBoundingClientRect();
    bfLayers.push({ tag: e.tagName, cls: norm(typeof e.className === 'string' ? e.className : ''), bf: s.backdropFilter, z: s.zIndex, w: Math.round(r.width), h: Math.round(r.height), fullViewport: r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9, opacity: s.opacity, display: s.display });
    if (bfLayers.length >= 15) break;
  }
  const wpLayer = [...document.querySelectorAll('body > div')].find((e) => (e.getAttribute('style') || '').includes('background-size: cover')) || null;
  const layers = [];
  for (const e of all) {
    const s = getComputedStyle(e);
    if (s.position !== 'fixed' && s.position !== 'absolute') continue;
    const r = e.getBoundingClientRect();
    if (r.width < innerWidth * 0.9 || r.height < innerHeight * 0.9) continue;
    const alpha = /rgba\(([^)]+)\)/.exec(s.backgroundColor);
    const translucent = alpha && Number(alpha[1].split(',')[3]) > 0.01;
    const hasBf = s.backdropFilter && s.backdropFilter !== 'none';
    const hasBgi = s.backgroundImage && s.backgroundImage !== 'none';
    if (!hasBf && !hasBgi && !translucent) continue;
    layers.push({ tag: e.tagName, id: e.id || null, cls: norm(typeof e.className === 'string' ? e.className : ''), z: s.zIndex, bg: s.backgroundColor, bf: s.backdropFilter, bgi: (s.backgroundImage || '').slice(0, 70), pointerEvents: s.pointerEvents });
    if (layers.length >= 12) break;
  }
  return {
    domNodes: all.length,
    dialogCount: document.querySelectorAll('[role="dialog"]').length,
    panelNodes: document.querySelectorAll('[role="dialog"] *').length,
    workspaceGroups: document.querySelectorAll('div[role="tree"] [role="treeitem"][aria-expanded]').length,
    sessionRows: document.querySelectorAll('div[role="tree"] [role="treeitem"][aria-selected]').length,
    activeTab: (() => { const d = document.querySelector('[role="tab"][aria-selected="true"]'); return d ? (d.innerText || '').trim().slice(0, 30) : null; })(),
    bodyBg: cs.backgroundColor,
    bodyBgImage: (cs.backgroundImage || '').slice(0, 90),
    bodyInlineBgBase: document.body.style.getPropertyValue('--dsw-alias-bg-base') || null,
    bodyDarkAttr: document.body.hasAttribute('data-ds-dark-theme'),
    htmlColorScheme: document.documentElement.style.colorScheme || null,
    url: location.href,
    // 混淆控制字段
    backdropFilterLayers: bfLayers,
    fullViewportBlurCount: bfLayers.filter((l) => l.fullViewport).length,
    // 壁纸层与其 style 写入计数（MECHANISM 最关键 UNVERIFIED）
    wallpaper: wpLayer ? { found: true, inline: norm(wpLayer.getAttribute('style')), bgImageLen: (getComputedStyle(wpLayer).backgroundImage || '').length, filter: getComputedStyle(wpLayer).filter, writes: window.__M?.wpWrites ?? null, sameValueWrites: window.__M?.wpSameValueWrites ?? null } : { found: false },
    layers,
  };
};

/* ---------------------------------------------------------------- 锁内的度量 */
async function waitReady(page) {
  // RECON 的装载判据：boot 占位消失 + 模块加载器进入 live + 侧栏出现工作区树项 + 设置触发按钮存在
  await page.waitForFunction((min) => {
    if (document.querySelectorAll('*').length < min) return false;
    if (document.querySelector('[data-dsh-boot]')) return false;
    const loaderReady = !window.__ModuleLoader__ || window.__ModuleLoader__.mode === 'live';
    const trigger = document.querySelector('div[class$="_settingsArea"] button[aria-haspopup="dialog"]');
    const tree = document.querySelector('div[role="tree"] [role="treeitem"][aria-expanded]');
    // rail 模式（<1024px）下侧栏收成图标条：树可能不存在 ⇒ 两者取其一即可
    return !!loaderReady && (!!trigger || !!tree);
  }, MIN_DOM_NODES, { timeout: 60000 });
  // 稳定：两个 rAF + 400ms（RECON 建议）
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await sleep(400);
}

/** 只点「设置」入口。RECON：触发按钮**没有任何 aria-label/title/testid**，其可访问名只在
 *  宽侧栏（≥1024px）由文字「设置」提供；900px 宽时侧栏收成 rail ⇒ 必须用 settingsArea
 *  作用域选择器，否则窄视口格会假失败。逐级退回并记录命中策略。 */
const SETTINGS_STRATEGIES = [
  { name: 'settingsArea>button[aria-haspopup=dialog]', make: (p) => p.locator('div[class$="_settingsArea"] button[aria-haspopup="dialog"]').first() },
  { name: 'getByRole(button,name=设置,exact)', make: (p) => p.getByRole('button', { name: '设置', exact: true }).first() },
  { name: 'button:has-text(/^设置$/)', make: (p) => p.locator('button', { hasText: /^设置$/ }).first() },
  { name: '[aria-label="设置"]', make: (p) => p.locator('[aria-label="设置"]').first() },
];
async function resolveSettingsLocator(page) {
  for (const s of SETTINGS_STRATEGIES) {
    try { const l = s.make(page); if (await l.count() > 0) return { locator: l, strategy: s.name }; } catch { }
  }
  return { locator: null, strategy: null };
}
function settingsLocator(page) {
  return page.locator('div[class$="_settingsArea"] button[aria-haspopup="dialog"]').first();
}

async function armClick(page) {
  await page.evaluate(() => {
    const M = window.__M;
    M.clickAt = null; M.panelAt = null; M.panelPaintAt = null; M.arm = true;
    const h = () => { if (M.arm) { M.clickAt = Math.round(performance.now() * 100) / 100; M.arm = false; document.removeEventListener('pointerdown', h, true); } };
    document.addEventListener('pointerdown', h, true);
  });
}

/** 关闭设置（只点关闭/Esc；RECON：关闭按钮 class .VOzbGW_close，无开合动画）。 */
async function closeSettings(page) {
  const byClass = page.locator('button[class*="_close"]').first();
  if (await byClass.count() > 0) {
    await byClass.click({ timeout: 5000 }).catch(() => { });
  } else {
    const btn = page.getByRole('button', { name: '关闭', exact: true }).first();
    if (await btn.count() > 0) await btn.click({ timeout: 5000 }).catch(() => { });
    else await page.keyboard.press('Escape').catch(() => { });
  }
  const gone = await page.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 0, undefined, { timeout: 8000 })
    .then(() => true).catch(() => false);
  return { closed: gone };
}

/** 一次完整的「点设置 → 面板可见」测量（返回固定判据的原始量）。 */
async function openAndMeasure(page) {
  const armAt = await page.evaluate(() => Math.round(performance.now() * 100) / 100);
  const resolved = await resolveSettingsLocator(page);
  await armClick(page);
  let clickErr = null;
  if (!resolved.locator) clickErr = 'settings-entry-not-resolvable';
  else { try { await resolved.locator.click({ timeout: 8000 }); } catch (e) { clickErr = String(e?.message || e).slice(0, 160); } }
  // 等面板出现（页面内 observer 打点）
  await page.waitForFunction(() => window.__M.panelAt !== null, undefined, { timeout: 15000 }).catch(() => { });
  await sleep(PRE_POST_MS + 400); // 让点击后 3s 窗口真正走完
  const m = await page.evaluate(({ armAt }) => {
    const M = window.__M;
    const frames = (t0, t1) => {
      const ts = M.raf.filter((t) => t >= t0 && t <= t1);
      let over = 0, max = 0;
      for (let i = 1; i < ts.length; i++) { const d = ts[i] - ts[i - 1]; if (d > max) max = d; if (d > 50) over++; }
      return { frames: ts.length, over50: over, maxIntervalMs: Math.round(max * 100) / 100, spanMs: ts.length ? Math.round((ts[ts.length - 1] - ts[0]) * 100) / 100 : 0 };
    };
    const lts = (t0, t1) => {
      const l = M.lt.filter((e) => e.start >= t0 && e.start <= t1);
      return { n: l.length, maxMs: l.length ? Math.max(...l.map((e) => e.dur)) : 0, totalMs: Math.round(l.reduce((a, b) => a + b.dur, 0) * 100) / 100 };
    };
    const c = M.clickAt;
    const out = { clickAt: c, panelAt: M.panelAt, panelPaintAt: M.panelPaintAt, errors: M.errors.slice(0, 6) };
    if (c == null) return { ...out, ok: false, reason: 'click-not-stamped' };
    out.clickToPanelMs = M.panelAt != null ? Math.round((M.panelAt - c) * 100) / 100 : null;
    out.clickToPaintMs = M.panelPaintAt != null ? Math.round((M.panelPaintAt - c) * 100) / 100 : null;
    out.pre = frames(c - 3000, c);
    out.post = frames(c, c + 3000);
    out.ltPre = lts(c - 3000, c);
    out.ltPost = lts(c, c + 3000);
    out.panelNodes = document.querySelectorAll('[role="dialog"] *').length;
    out.dialogCount = document.querySelectorAll('[role="dialog"]').length;
    out.activeTab = (() => { const d = document.querySelector('[role="tab"][aria-selected="true"]'); return d ? (d.innerText || '').trim().slice(0, 30) : null; })();
    return out;
  }, { armAt });
  return { ...m, clickErr, strategy: resolved.strategy };
}

/* ---------------------------------------------------------------- 侧栏只读动作 */
/** 找到目标会话标题并点击（绝不点"操作"菜单）。
 *  RECON：只有"当前会话所在分组"默认展开，其余分组是折叠的 ⇒ 若标题不可见，
 *  先点该工作区分组头展开，再点「展开其余 N 个会话」，最后才判失败。 */
async function openSessionByTitle(page, title, groupName) {
  const tryClick = async () => {
    const t = page.getByText(title, { exact: true }).first();
    if (await t.count() === 0) return null;
    const before = page.url();
    await t.click({ timeout: 6000 }).catch(() => { });
    await sleep(2500);
    const menu = await page.locator('[role="menu"]').count();
    if (menu > 0) { await page.keyboard.press('Escape'); return { ok: false, reason: 'opened-context-menu' }; }
    return { ok: true, urlChanged: page.url() !== before, url: page.url() };
  };
  let r = await tryClick();
  if (r) return r;
  // 展开目标工作区分组
  const head = page.getByText(groupName, { exact: true }).first();
  if (await head.count() > 0) { await head.click({ timeout: 5000 }).catch(() => { }); await sleep(1500); r = await tryClick(); if (r) return r; }
  for (let i = 0; i < 8; i++) {
    const exp = page.getByText(/^展开其余 \d+ 个会话$/).first();
    if (await exp.count() === 0) break;
    await exp.click({ timeout: 4000 }).catch(() => { });
    await sleep(800);
    r = await tryClick();
    if (r) return r;
  }
  return { ok: false, reason: 'session-title-not-found-after-expanding', groupName };
}

/** 入口 C：尝试打开"用量卡片所在插件页"。
 *  ⚠ RECON + MECHANISM 一致指出：**本部署里用量卡不是侧栏页面**，它只注册在
 *  `settings.plugin.item`（即"设置→插件"里），侧栏没有该入口；且侧栏标签实测为
 *  `Token 用量 · dsh-usage`。因此本格按"尽力而为 + 如实记账"实现：
 *  命中就点并记录 URL；未命中就把 entry.ok=false 落盘，该格**不得**当作"无差异"证据。 */
async function openPluginPage(page, candidates) {
  const tried = [];
  for (const label of candidates) {
    const t = page.getByText(label, { exact: true }).first();
    if (await t.count() > 0) {
      const before = page.url();
      await t.click({ timeout: 6000 }).catch((e) => tried.push(`${label}:click-err`));
      await sleep(2500);
      const menu = await page.locator('[role="menu"]').count();
      if (menu > 0) { await page.keyboard.press('Escape'); return { ok: false, tried, reason: 'opened-context-menu' }; }
      return { ok: true, label, urlChanged: page.url() !== before, url: page.url(), tried };
    }
    tried.push(`${label}:not-found`);
  }
  return { ok: false, tried, reason: 'no-sidebar-plugin-entry-matched', note: '用量卡在本部署只存在于 设置→插件，不是侧栏页面' };
}

/** 会话规模因子：改变**已渲染**的侧栏会话行数（纯页内只读开关）。
 *  RECON：分组头 = `div[role="tree"] div[role="treeitem"][aria-expanded]`，
 *  折叠后该组渲染 **0** 行；默认每组最多 5 行 + 「展开其余 N 个会话」。
 *  ⇒ 为了真正检验 O(N)，本函数支持两种方向：
 *     expandAll : 逐组点「展开其余 N 个会话」把渲染行数拉到最大（真正的 O(N) 检验）
 *     collapse  : 点分组头把各组折叠，渲染行数压到最小
 *  两者都返回前后可证的渲染行数，"杠杆是否生效"因此可判定。 */
async function changeRenderedSessions(page, mode) {
  const rowsNow = () => page.evaluate(() => ({
    sessionRows: document.querySelectorAll('div[role="tree"] [role="treeitem"][aria-selected]').length,
    groups: document.querySelectorAll('div[role="tree"] [role="treeitem"][aria-expanded]').length,
    expanders: [...document.querySelectorAll('button,div[role="button"],span')].filter((e) => /^展开其余 \d+ 个会话$/.test((e.innerText || '').trim())).length,
  }));
  const before = await rowsNow();
  const out = { mode, before, after: null, effective: false, actions: [] };
  if (mode === 'expandAll') {
    for (let i = 0; i < 40; i++) {
      const exp = page.getByText(/^展开其余 \d+ 个会话$/).first();
      if (await exp.count() === 0) break;
      await exp.click({ timeout: 4000 }).catch(() => { });
      out.actions.push('expander-click');
      await sleep(600);
    }
  } else {
    // 折叠：点分组头（不是"操作"按钮）切换 aria-expanded
    const heads = page.locator('div[role="tree"] [role="treeitem"][aria-expanded="true"]');
    const n = Math.min(await heads.count(), 20);
    for (let i = 0; i < n; i++) {
      await heads.nth(i).click({ timeout: 4000 }).catch(() => { });
      out.actions.push('group-collapse');
      await sleep(500);
    }
  }
  out.after = await rowsNow();
  out.effective = mode === 'expandAll' ? out.after.sessionRows > out.before.sessionRows : out.after.sessionRows < out.before.sessionRows;
  return out;
}

/** 壁纸因子（三个定向杠杆；RECON：darkMask 元素**不存在**，霜化是 body 内联 token 覆盖，
 *  壁纸层是 `body > div[style*="background-size: cover"]`，模态另有全视口 blur(2px)）。
 *  全部是纯页内 DOM/CSS 操作：不落盘、不改产品文件、不点应用。 */
async function applyWallpaperLever(page, mode) {
  return await page.evaluate((mode) => {
    const cs = (e) => getComputedStyle(e);
    const norm = (s) => (s || '').replace(/\s+/g, ' ').slice(0, 120);
    const findWallpaper = () => [...document.querySelectorAll('body > div')].find((e) => (e.getAttribute('style') || '').includes('background-size: cover')) || null;
    const before = {
      bodyInlineBgBase: document.body.style.getPropertyValue('--dsw-alias-bg-base') || null,
      bodyComputedBg: cs(document.body).backgroundColor,
      wallpaperFound: !!findWallpaper(),
      wallpaperInline: findWallpaper() ? norm(findWallpaper().getAttribute('style')) : null,
    };
    if (mode === 'frost-off') {
      // 霜化 = body 内联 token 覆盖（透明度/遮罩产生的就是它）
      document.body.style.removeProperty('--dsw-alias-bg-base');
      return { mode, did: 'removeProperty(--dsw-alias-bg-base on body)', before, after: { bodyInlineBgBase: document.body.style.getPropertyValue('--dsw-alias-bg-base') || null, bodyComputedBg: cs(document.body).backgroundColor }, effective: before.bodyInlineBgBase !== null, persistent: false };
    }
    if (mode === 'off') {
      const w = findWallpaper();
      if (!w) return { mode, did: 'no-wallpaper-layer-found', before, effective: false, persistent: false };
      w.remove();
      return { mode, did: 'removed wallpaper layer', before, after: { wallpaperFound: !!findWallpaper() }, effective: true, persistent: false };
    }
    if (mode === 'noblur') {
      // 直接关掉**全视口 backdrop-filter**（含设置模态的 blur(2px) 遮罩）——本批最关键的机制杠杆
      const st = document.createElement('style');
      st.id = '__cond_noblur';
      st.textContent = '*{backdrop-filter:none !important;-webkit-backdrop-filter:none !important;}';
      document.head.appendChild(st);
      const n = [...document.querySelectorAll('*')].filter((e) => cs(e).backdropFilter && cs(e).backdropFilter !== 'none').length;
      return { mode, did: 'injected * {backdrop-filter:none !important}', before, after: { remainingBackdropFiltered: n }, effective: n === 0, persistent: false };
    }
    return { mode, did: 'noop', before, effective: false };
  }, mode);
}

/** 主题因子：RECON/MECHANISM 证实 `html[data-theme]`/`class="dark"`/`emulateMedia` 在本部署**全部无效**
 *  （真值 = `body[data-ds-dark-theme]` + `documentElement.style.colorScheme`，且 media 监听在
 *  preference!=='system' 时早退；部署为 light）。改用 DOM 真值杠杆，并**自证是否真的变暗**。 */
async function forceDarkTheme(page) {
  const attempt = await page.evaluate(() => {
    const b = document.body, he = document.documentElement;
    const before = { bg: getComputedStyle(b).backgroundColor, darkAttr: b.hasAttribute('data-ds-dark-theme'), colorScheme: he.style.colorScheme || null, token: b.style.getPropertyValue('--dsw-alias-bg-base') || null };
    he.style.colorScheme = 'dark';
    b.setAttribute('data-ds-dark-theme', '');
    // 内联浅色 token 否则会赢：显式覆盖为暗色基色（页内、非持久）
    b.style.setProperty('--dsw-alias-bg-base', 'rgba(15,17,21,0.88)');
    return { before };
  });
  await sleep(600);
  const proof = await page.evaluate(() => {
    const b = document.body, he = document.documentElement;
    const lum = (c) => { const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(c); return m ? Math.round(0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) : null; };
    const bg = getComputedStyle(b).backgroundColor;
    return { bg, bgLum: lum(bg), darkAttr: b.hasAttribute('data-ds-dark-theme'), colorScheme: he.style.colorScheme || null, token: b.style.getPropertyValue('--dsw-alias-bg-base') || null };
  });
  const beforeLum = (() => { const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(attempt.before.bg); return m ? Math.round(0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) : null; })();
  return {
    attempted: attempt.before, proof, beforeLum,
    renderedDark: proof.darkAttr === true && proof.bgLum != null && beforeLum != null && proof.bgLum < beforeLum,
    persistent: false,
    caveat: '页内非持久；任何 theme publish / 重载都会恢复（RECON）',
  };
}

/* ---------------------------------------------------------------- 主流程 */
let BROWSER = null;
const ARTIFACT = {
  meta: {
    line: LINE, agent: AGENT, label: LABEL, url: URL_, startedAt: nowIso(),
    hostPid: HOST_PID, hostPidAlive: null, prereg: PREREG,
    design: 'OFAT：BASE 为参照，每个 cell 只改一个因子；每 cell 每次 rep 为全新 context+page',
    criteria: 'click→面板可见耗时 + 点击前后各 3s 的 >50ms 帧数与最长任务',
    discipline: '只点 设置/关闭/设置页导航/侧栏会话标题；不点 保存/应用/删除/移除壁纸/模型切换；不 pkill',
    cells: CELLS.map((c) => ({ id: c.id, dim: c.dim, factors: { entry: c.entry, order: c.order, load: c.load, vp: c.vp.join('x'), scale: c.scale, wallpaper: c.wallpaper, theme: c.theme, cacheDisabled: c.cacheDisabled } })),
    reps: REPS,
  },
  lock: null,
  environment: { atStart: null, atEnd: null },
  reps: [],
  summary: null,
  terminated: null,
};

/* 并发门禁（本线口径，理由见 audit.md §方法）：
 *   - primary = **gate_tenants**：外来「他线探针浏览器」数必须为 0（真正的竞争者）；
 *   - 同时记录 gate_strict（任何外来实例为 0）与 host_derived 数，供事后复核；
 *   - 若仪器看不到自身实例（detectionWorks=false），整轮 FATAL，不产出结论。 */

function verdictOf(open) {
  if (!open || open.clickToPanelMs == null) return 'INVALID';
  const frames = open.post?.over50 ?? null;
  const ltMax = open.ltPost?.maxMs ?? null;
  const ctp = open.clickToPanelMs;
  const janky = (frames != null && frames >= PREREG.jank_frames_gt50_post) || (ltMax != null && ltMax > PREREG.jank_longest_task_ms) || ctp > PREREG.jank_click_to_panel_ms;
  const smooth = frames != null && frames <= PREREG.smooth_frames_gt50_post && (ltMax ?? 0) <= PREREG.smooth_longest_task_ms && ctp <= PREREG.smooth_click_to_panel_ms;
  return janky ? 'JANKY' : (smooth ? 'SMOOTH' : 'MILD');
}

async function runCell(cell, rep) {
  const rec = { cell: cell.id, dim: cell.dim, rep, factors: { ...cell, vp: cell.vp.join('x') }, startedAt: nowIso(), phases: [], opens: [], validity: {}, levers: {}, facts: null, concurrency: {} };
  const concStart = concurrencyProbe();
  rec.concurrency.atStart = concStart;
  let context = null;
  try {
    context = await BROWSER.newContext({ viewport: { width: cell.vp[0], height: cell.vp[1] }, deviceScaleFactor: 1, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    if (cell.cacheDisabled) { await cdp.send('Network.enable').catch(() => { }); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => { }); }
    await page.addInitScript(INIT_SCRIPT);

    const t0 = Date.now();
    await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitReady(page);
    const readyMs = Date.now() - t0;
    rec.phases.push({ phase: 'ready', ms: readyMs });

    // 载入状态因子
    if (cell.load === 'wait10') await sleep(10000);
    else if (cell.load === 'wait60') await sleep(60000);
    else if (cell.load === 'immediate') { /* 不额外等待：ready 即点 */ }
    rec.phases.push({ phase: 'after-load-wait', mode: cell.load, atMs: Date.now() - t0 });

    // 入口因子（在点设置**之前**先做出该入口状态）
    if (cell.entry === 'longsession') rec.levers.entry = await openSessionByTitle(page, LONG_SESSION_TITLE, LONG_SESSION_GROUP);
    else if (cell.entry === 'pluginusage') rec.levers.entry = await openPluginPage(page, USAGE_PAGE_CANDIDATES);
    else rec.levers.entry = { ok: true, note: 'home (no pre-navigation)' };
    if (cell.entry !== 'home') await sleep(3000);   // 让入口页稳定，保证有 3s 前置窗口

    // 会话规模因子
    if (cell.scale === 'collapse' || cell.scale === 'expandAll') rec.levers.scale = await changeRenderedSessions(page, cell.scale);

    // 壁纸因子（三个定向杠杆）
    if (['frost-off', 'off', 'noblur'].includes(cell.wallpaper)) { rec.levers.wallpaper = await applyWallpaperLever(page, cell.wallpaper); await sleep(1200); }

    // 主题因子
    if (cell.theme === 'dark') { rec.levers.theme = await forceDarkTheme(page); }

    rec.facts = await page.evaluate(FACTS_FN);
    rec.validity.domNodesOk = rec.facts.domNodes >= MIN_DOM_NODES;
    // 因子自证：杠杆没生效的格不得当作"无差异"证据
    if (cell.scale === 'collapse' || cell.scale === 'expandAll') rec.validity.scaleLeverEffective = !!rec.levers.scale?.effective;
    if (['frost-off', 'off', 'noblur'].includes(cell.wallpaper)) rec.validity.wallpaperLeverEffective = !!rec.levers.wallpaper?.effective;
    if (cell.theme === 'dark') rec.validity.themeLeverEffective = !!rec.levers.theme?.renderedDark;
    if (cell.entry === 'longsession') rec.validity.entryLeverOk = !!rec.levers.entry?.ok;
    if (cell.entry === 'pluginusage') rec.validity.entryLeverOk = !!rec.levers.entry?.ok;

    // 次序因子：first = 1 次；reopen = 连开 3 次（第 1 次是首开，第 2/3 次是复开）
    const nOpens = cell.order === 'reopen' ? 3 : 1;
    for (let k = 0; k < nOpens; k++) {
      const o = await openAndMeasure(page);
      o.openIndex = k + 1;
      o.isFirstEverInPage = k === 0;
      o.verdict = verdictOf(o);
      rec.opens.push(o);
      if (k < nOpens - 1) { rec.opens[k].close = await closeSettings(page); await sleep(1800); }
    }
    // 面板敞开态的事实（用于取出设置模态的全视口 blur 遮罩等"点设置才出现"的元素）
    try { rec.factsPanelOpen = await page.evaluate(FACTS_FN); } catch { }
  } catch (e) {
    rec.error = String(e?.message || e).slice(0, 400);
  } finally {
    try { if (context) await context.close(); } catch { }
  }
  const concEnd = concurrencyProbe();
  rec.concurrency.atEnd = concEnd;
  // primary 门禁 = 他线探针浏览器为 0；同时保留 strict 口径与 host-derived 计数
  rec.concurrency.gate_tenants_passed = concStart.gate_tenants_passed && concEnd.gate_tenants_passed;
  rec.concurrency.gate_strict_passed = concStart.gate_strict_passed && concEnd.gate_strict_passed;
  rec.concurrency.gate_passed = rec.concurrency.gate_tenants_passed;
  rec.concurrency.foreign_tenants_max = Math.max(concStart.foreign_tenants ?? 0, concEnd.foreign_tenants ?? 0);
  rec.concurrency.foreign_max = Math.max(concStart.foreign ?? 0, concEnd.foreign ?? 0);
  rec.concurrency.host_derived_max = Math.max(concStart.host_derived ?? 0, concEnd.host_derived ?? 0);
  rec.validity.gate_passed = rec.concurrency.gate_passed;
  rec.validity.gate_strict_passed = rec.concurrency.gate_strict_passed;
  rec.validity.anyPanelOpened = rec.opens.some((o) => o.clickToPanelMs != null);
  for (const o of rec.opens) {
    if (!rec.concurrency.gate_passed) o.verdict = 'INVALID';
    if (o.clickToPanelMs == null) o.verdict = 'INVALID';
  }
  rec.verdict = rec.opens.length ? rec.opens[rec.opens.length - 1].verdict : 'INVALID';
  rec.primary = rec.opens.map((o) => ({ openIndex: o.openIndex, clickToPanelMs: o.clickToPanelMs, framesGt50Post: o.post?.over50 ?? null, longestTaskPostMs: o.ltPost?.maxMs ?? null, verdict: o.verdict }));
  fs.writeFileSync(path.join(RAW, `${LABEL}-${cell.id}-r${rep}.json`), JSON.stringify(rec, null, 2));
  log(`  ${cell.id} r${rep}: ${rec.primary.map((p) => `#${p.openIndex} ctp=${p.clickToPanelMs} f>50=${p.framesGt50Post} lt=${p.longestTaskPostMs} ${p.verdict}`).join(' | ')} | tenants-gate=${rec.concurrency.gate_tenants_passed} tenants=${rec.concurrency.foreign_tenants_max} hostDerived=${rec.concurrency.host_derived_max} strict=${rec.concurrency.gate_strict_passed}`);
  return rec;
}

function summarize() {
  const byCell = {};
  for (const r of ARTIFACT.reps) {
    const c = (byCell[r.cell] ||= { cell: r.cell, dim: r.dim, reps: [], opens: [] });
    c.reps.push(r);
    for (const o of r.opens) c.opens.push({ rep: r.rep, ...o, gate: r.concurrency.gate_passed });
  }
  const num = (a) => a.filter((x) => typeof x === 'number' && Number.isFinite(x));
  const med = (a) => { const v = num(a).sort((x, y) => x - y); return v.length ? v[Math.floor((v.length - 1) / 2)] : null; };
  const summary = {};
  for (const [id, c] of Object.entries(byCell)) {
    const firstOpens = c.opens.filter((o) => o.isFirstEverInPage);
    const reopens = c.opens.filter((o) => !o.isFirstEverInPage);
    const pick = (arr) => ({
      n: arr.length,
      clickToPanelMs: { median: r3(med(arr.map((o) => o.clickToPanelMs))), all: arr.map((o) => o.clickToPanelMs) },
      framesGt50Post: { median: r3(med(arr.map((o) => o.post?.over50))), all: arr.map((o) => o.post?.over50 ?? null) },
      framesGt50Pre: { median: r3(med(arr.map((o) => o.pre?.over50))), all: arr.map((o) => o.pre?.over50 ?? null) },
      longestTaskPostMs: { median: r3(med(arr.map((o) => o.ltPost?.maxMs))), all: arr.map((o) => o.ltPost?.maxMs ?? null) },
      longestTaskPreMs: { median: r3(med(arr.map((o) => o.ltPre?.maxMs))), all: arr.map((o) => o.ltPre?.maxMs ?? null) },
      verdicts: arr.map((o) => o.verdict),
    });
    const valid = c.opens.filter((o) => o.gate === true && o.clickToPanelMs != null);
    const vCount = (v) => valid.filter((o) => o.verdict === v).length;
    summary[id] = {
      dim: c.dim,
      reps: c.reps.length,
      windowsValid: valid.length,
      windowsTotal: c.opens.length,
      gateAllPassed: c.reps.every((r) => r.concurrency.gate_passed),
      firstOpen: pick(firstOpens),
      reopen: reopens.length ? pick(reopens) : null,
      cellVerdict: valid.length >= 2 ? (vCount('JANKY') >= valid.length / 2 ? 'JANKY' : (vCount('SMOOTH') === valid.length ? 'SMOOTH' : 'MILD')) : 'INCONCLUSIVE',
    };
  }
  const base = summary['BASE'];
  for (const [id, s] of Object.entries(summary)) {
    if (!base || id === 'BASE') { s.relativeToBase = null; continue; }
    const bF = base.firstOpen.framesGt50Post.median, bC = base.firstOpen.clickToPanelMs.median;
    const cF = s.firstOpen.framesGt50Post.median, cC = s.firstOpen.clickToPanelMs.median;
    s.relativeToBase = {
      framesGt50Post_ratio: bF ? r3(cF / bF) : null,
      clickToPanelMs_ratio: bC ? r3(cC / bC) : null,
      note: '相对 BASE（同门禁）；绝对 ms 在并发负载下不可当基线（PROTOCOL §0）',
    };
  }
  ARTIFACT.summary = summary;
  return summary;
}

async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  fs.mkdirSync(LOGS, { recursive: true });
  const pre = census(new Set());
  log(`pre-launch real browser instances: ${pre.total}`);
  ARTIFACT.meta.hostPidAlive = (() => { try { process.kill(HOST_PID, 0); return true; } catch (e) { return e.code === 'EPERM'; } })();

  const lock = await acquireLock();
  ARTIFACT.lock = { ...lock, acquired: !!lock.ok };
  if (!lock.ok) { log('LOCK NOT ACQUIRED → 不启动浏览器（纪律）'); store(); return; }

  log('launching chromium (headless)');
  BROWSER = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  // 自身实例识别：两种方法互相印证（差集法 + 祖先链法），不一致就记账
  const post = census(new Set());
  const byDelta = new Set(post.pids.filter((p) => !pre.pids.includes(p)));
  const byAncestry = new Set(ownByAncestry(process.pid));
  OWN_PIDS = byAncestry.size ? byAncestry : byDelta;
  ARTIFACT.instrumentSelfCheck = {
    ownByDelta: [...byDelta], ownByAncestry: [...byAncestry], used: [...OWN_PIDS],
    agree: byDelta.size === byAncestry.size && [...byDelta].every((p) => byAncestry.has(p)),
    // 仪器自证：若看不到自己开的浏览器，说明普查口径坏了 ⇒ 任何"foreign==0"都不可信
    detectionWorks: OWN_PIDS.size >= 1,
  };
  log(`own browser instances = ${OWN_PIDS.size} (delta=${byDelta.size} ancestry=${byAncestry.size} agree=${ARTIFACT.instrumentSelfCheck.agree})`);
  if (!ARTIFACT.instrumentSelfCheck.detectionWorks) {
    log('INSTRUMENT FATAL: 普查看不到自身浏览器实例 ⇒ 并发门禁不可信，本轮不产出结论');
    ARTIFACT.terminated = { reason: 'instrument-cannot-see-own-browser' };
    try { await BROWSER.close(); } catch { }
    releaseLock(); store(); process.exitCode = 1; return;
  }
  ARTIFACT.environment.atStart = concurrencyProbe();

  for (const cell of CELLS) {
    for (let rep = 1; rep <= REPS; rep++) {
      log(`cell ${cell.id} rep ${rep}/${REPS}`);
      ARTIFACT.reps.push(await runCell(cell, rep));
    }
    summarize();
    store();
  }
  ARTIFACT.environment.atEnd = concurrencyProbe();
  store();
  log('done');
}

function store() {
  const target = path.join(DIR, `matrix-${LABEL}.json`);
  ARTIFACT.finishedAt = nowIso();
  ARTIFACT.log = logLines.slice(-400);
  fs.writeFileSync(target, JSON.stringify(ARTIFACT, null, 2));
  fs.writeFileSync(path.join(LOGS, `matrix-${LABEL}.log`), logLines.join('\n') + '\n');
  return target;
}

/* 信号：先关浏览器 → 再释放锁 → 落盘（Node 的 SIGTERM 默认不触发 exit 事件，必须显式接管） */
let SHUTTING = false;
async function shutdown(sig) {
  if (SHUTTING) return; SHUTTING = true;
  log(`signal ${sig}: closing browser → releasing lock → flushing artifact`);
  ARTIFACT.terminated = { signal: sig, at: nowIso() };
  try { if (BROWSER) await Promise.race([BROWSER.close(), sleep(9000)]); } catch { }
  try { summarize(); } catch { }
  store();
  releaseLock();
  process.exit(0);
}
for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => { shutdown(s); });

main()
  .then(async () => { try { if (BROWSER) await BROWSER.close(); } catch { } releaseLock(); store(); process.exit(0); })
  .catch(async (e) => {
    log('FATAL ' + String(e?.stack || e).slice(0, 600));
    ARTIFACT.error = String(e?.message || e).slice(0, 400);
    try { if (BROWSER) await BROWSER.close(); } catch { }
    store(); releaseLock(); process.exit(1);
  });
