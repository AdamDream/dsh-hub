#!/usr/bin/env node
/**
 * run2.mjs — 补齐 run1 的三个缺口：
 *   A) 每窗口并发门禁（run1 只在首尾普查；本轮每窗前后各断言 foreign==0 → strict）
 *   B) 「插件」栏目内部子标签 all ↔ configurable（"设置栏目"最强候选）
 *   C) 滚动根因 A/B/C：原样 / 隐藏壁纸固定层 / 关掉 backdrop-filter + 同时长「不滚动」对照
 * 纪律同 run.mjs；额外：每窗门禁失败即标 invalid。
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tryAcquire, release, census, censusVerdict } from '../lib/lock.mjs';

const BASE = 'http://127.0.0.1:3080';
const HERE = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/tab-switch';
const RAW = `${HERE}/raw`;
const AGENT = 'incident2-tab-switch';
const INIT = `${HERE}/lib/init-probe.js`;
const OUTFILE = `${RAW}/${process.env.OUT || 'tabswitch-run2.json'}`;
const WINDOW_MS = Number(process.env.WINDOW_MS || 1600);
const SETTLE_MS = Number(process.env.SETTLE_MS || 900);
const BOOT_MS = Number(process.env.BOOT_MS || 12000);
const SUB_ROUNDS = Number(process.env.SUB_ROUNDS || 3);
const IDLE_MS = Number(process.env.IDLE_MS || 2200);
mkdirSync(RAW, { recursive: true });

const R = { at: new Date().toISOString(), env: { window_ms: WINDOW_MS, settle_ms: SETTLE_MS, sub_rounds: SUB_ROUNDS, idle_ms: IDLE_MS }, errors: [], windows: [] };
const log = (...a) => console.log('[run2]', ...a);

const lock = tryAcquire(AGENT, 'settings sub-tab switching + scroll root-cause A/B/C (strict per-window gate)', 1500, log);
R.lock = lock;
if (!lock.acquired) { R.verdict = 'LOCK_TIMEOUT'; writeFileSync(OUTFILE, JSON.stringify(R, null, 2)); process.exit(2); }

let browser, ownDir = null;
try {
  const cenPre = census();
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  page.on('pageerror', (e) => R.errors.push('pageerror: ' + String(e).slice(0, 200)));
  await page.addInitScript({ path: INIT });
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(BOOT_MS);
  const cenPost = census();
  const mine = cenPost.headless_shell.filter((r) => !cenPre.headless_shell.some((q) => q.pid === r.pid));
  ownDir = mine[0]?.userDataDir || null;
  R.own_browser = mine.map((r) => r.pid); R.own_user_data_dir = ownDir;
  R.fidelity = await page.evaluate(() => ({ dpr: devicePixelRatio, w: innerWidth, h: innerHeight, visibility: document.visibilityState, ua: navigator.userAgent }));

  const gate = () => { const v = censusVerdict(census(), ownDir); const ok = v.foreign === 0 && v.own >= 1; return { ok, foreign: v.foreign, own: v.own, foreign_list: v.foreign_list }; };
  const cdpMetrics = async () => { const { metrics } = await cdp.send('Performance.getMetrics'); const keep = ['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration', 'Nodes', 'JSEventListeners']; const o = {}; for (const m of metrics) if (keep.includes(m.name)) o[m.name] = m.value; return o; };
  const mdelta = (a, b) => { const o = {}; for (const k of Object.keys(b)) if (a[k] != null) o[k] = +(b[k] - a[k]).toFixed(4); return o; };

  await page.evaluate(() => {
    const S = globalThis.__TS__;
    S.sigOf2 = (sel) => { const el = document.querySelector(sel); if (!el) return null; const t = el.textContent || ''; let h = 0; for (let i = 0; i < Math.min(t.length, 400); i++) h = (h * 31 + t.charCodeAt(i)) | 0; return { len: t.length, hash: h }; };
    S.armW = () => { S.armed = true; S.frames = []; S.frameTs = []; S.longtasks = []; S.loaf = []; S.rpc = []; S.churn = { added: 0, removed: 0, attributes: 0, characterData: 0, records: 0 }; S.layoutReads = {}; S.markers = []; S.lastClick = null;
      const h = (ev) => { S.lastClick = { t: performance.now(), target: (ev.target && ev.target.tagName) || null }; };
      S._cl = h; document.addEventListener('click', h, true); return performance.now(); };
    S.disW = () => { S.armed = false; if (S._cl) document.removeEventListener('click', S._cl, true);
      return { fs: S.framesummary(), longtasks: S.longtasks, loaf: S.loaf, rpc: S.rpc, churn: S.churn, layoutReads: S.layoutReads, lastClick: S.lastClick, frameTs: S.frameTs,
        nodes: document.querySelectorAll('*').length,
        dialogNodes: (() => { const d = document.querySelector('[role="dialog"]'); return d ? d.querySelectorAll('*').length : 0; })(),
        dialogSvg: (() => { const d = document.querySelector('[role="dialog"]'); return d ? d.querySelectorAll('svg').length : 0; })() }; };
  });

  // 打开设置
  const trig = await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '设置'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  if (!trig) throw new Error('no trigger');
  await page.mouse.click(trig.x, trig.y);
  await page.waitForTimeout(2500);
  R.nav = await page.evaluate(() => { const nav = document.querySelector('[role="dialog"] nav'); return Array.from(nav.querySelectorAll('button')).map((b, i) => { const r = b.getBoundingClientRect(); return { i, text: (b.textContent || '').trim(), x: +(r.x + r.width / 2).toFixed(1), y: +(r.y + r.height / 2).toFixed(1) }; }); });
  const T = (n) => R.nav.find((t) => t.text === n);
  const clickNav = (n) => page.mouse.click(T(n).x, T(n).y);

  async function runWindow(label, action, opts = {}) {
    const g0 = gate();
    const cd0 = await cdpMetrics();
    const armAt = await page.evaluate(() => globalThis.__TS__.armW());
    const wall0 = Date.now();
    await action();
    const wall1 = Date.now();
    const wait = opts.waitMs ?? WINDOW_MS;
    const el = Date.now() - wall0;
    if (el < wait) await page.waitForTimeout(wait - el);
    const end = await page.evaluate(() => globalThis.__TS__.disW());
    const cd1 = await cdpMetrics();
    const g1 = gate();
    const lt = end.longtasks.filter((x) => x.t >= armAt - 1);
    const fts = end.frameTs || []; const lcT = end.lastClick ? end.lastClick.t : null;
    let firstFrameAfter = null;
    if (lcT != null) { const nx = fts.find((t) => t >= lcT); if (nx != null) firstFrameAfter = +(nx - lcT).toFixed(2); }
    const w = { label, gate_pre: g0, gate_post: g1, valid: g0.ok && g1.ok, wallMs: wall1 - wall0,
      firstFrameAfterClickMs: firstFrameAfter,
      frames: end.fs, longtasks: lt, longtask_total_ms: +lt.reduce((a, b) => a + b.dur, 0).toFixed(2),
      loaf: end.loaf.filter((x) => x.t >= armAt - 1),
      rpc: (() => { const inw = end.rpc.filter((r) => r.t0 >= armAt - 1); const g = {}; for (const r of inw) { const k = r.path + (r.stream ? ' [SSE]' : ''); g[k] = g[k] || { n: 0, ms: [] }; g[k].n++; if (r.ms != null && !r.stream) g[k].ms.push(r.ms); } return { total: inw.length, by: g }; })(),
      churn: end.churn, layoutReads: end.layoutReads,
      dom: { dialogNodes: end.dialogNodes, dialogSvg: end.dialogSvg, totalNodes: end.nodes },
      cdpDelta: mdelta(cd0, cd1) };
    R.windows.push(w);
    const st = w.valid ? '' : ' ***INVALID(并发污染)***';
    log(`${label}: ${w.frames.n}f p95=${w.frames.p95} max=${w.frames.max} >50=${w.frames.over50} LT=${lt.length}/${w.longtask_total_ms}ms rpc=${w.rpc.total} nodes=${w.dialogNodes} ΔL=${w.cdpDelta.LayoutCount} ΔS=${w.cdpDelta.RecalcStyleCount} read=${Object.values(w.layoutReads).reduce((a, b) => a + b, 0)}${st}`);
    await page.waitForTimeout(SETTLE_MS);
    return w;
  }

  /* ================= B) 插件栏目内部子标签 ================= */
  await clickNav('插件');
  await page.waitForTimeout(1500);
  R.pluginsSubTabDom = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const out = { slotNodes: [], candidates: [] };
    for (const el of dlg.querySelectorAll('[data-slot]')) out.slotNodes.push({ slot: el.getAttribute('data-slot'), tag: el.tagName, cls: String(el.className).slice(0, 70), text: (el.textContent || '').trim().slice(0, 50) });
    // 子标签候选：内容区里、y 在面板上部、宽度小、文本短的可点击元素
    for (const el of dlg.querySelectorAll('button,[role="tab"],[role="radiogroup"] *')) {
      const r = el.getBoundingClientRect();
      if (r.width < 20 || r.height < 14) continue;
      const nav = dlg.querySelector('nav').getBoundingClientRect();
      if (r.x < nav.right + 5) continue; // 排除左导航
      out.candidates.push({ tag: el.tagName, role: el.getAttribute('role'), text: (el.textContent || '').trim().slice(0, 30), slot: el.getAttribute('data-slot'), cls: String(el.className).slice(0, 60), x: +(r.x + r.width / 2).toFixed(1), y: +(r.y + r.height / 2).toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), selected: el.getAttribute('aria-selected') || el.getAttribute('aria-current') });
    }
    return out;
  });
  log('plugins sub-tab DOM:', JSON.stringify(R.pluginsSubTabDom.candidates.slice(0, 12)));

  const subTabs = R.pluginsSubTabDom.candidates.filter((c) => c.y < 200 && c.w < 260 && c.text && !/打开配置文件|关闭/.test(c.text));
  const pick = (kw) => subTabs.find((c) => c.text.includes(kw));
  const subA = pick('全部') || subTabs[0];
  const subB = pick('可配置') || subTabs[1];
  R.subTabs = { a: subA, b: subB, all: subTabs };
  if (subA && subB && subA.text !== subB.text) {
    for (let r = 1; r <= SUB_ROUNDS; r++) {
      await runWindow(`SUBTAB r${r} → ${subB.text}`, () => page.mouse.click(subB.x, subB.y));
      await runWindow(`SUBTAB r${r} → ${subA.text}`, () => page.mouse.click(subA.x, subA.y));
    }
  } else { R.subTabsError = 'sub-tab candidates not separable'; }

  /* ================= C) 滚动根因 A/B/C + 同时长对照 ================= */
  R.layers = await page.evaluate(() => {
    const fix = [], blur = [];
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' && cs.pointerEvents === 'none') fix.push({ cls: String(el.className).slice(0, 90), z: cs.zIndex, w: el.clientWidth, h: el.clientHeight, tag: el.tagName });
      if (cs.backdropFilter && cs.backdropFilter !== 'none') blur.push({ cls: String(el.className).slice(0, 90), bf: cs.backdropFilter, tag: el.tagName, w: el.clientWidth, h: el.clientHeight });
    }
    return { fixedPointerNone: fix, backdrop: blur };
  });
  log('layers:', JSON.stringify(R.layers));

  // 记录滚动容器的 range
  const scrollRange = async () => page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const c = Array.from(dlg.querySelectorAll('*')).filter((el) => el.scrollHeight > el.clientHeight + 4).sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
    return c ? { cls: String(c.className).slice(0, 60), range: c.scrollHeight - c.clientHeight } : null;
  });

  const doScroll = (dir, ms) => page.evaluate(async ({ dir, ms }) => {
    const dlg = document.querySelector('[role="dialog"]');
    const el = Array.from(dlg.querySelectorAll('*')).filter((x) => x.scrollHeight > x.clientHeight + 4).sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
    if (!el) return { ok: false };
    const range = el.scrollHeight - el.clientHeight; const steps = Math.max(4, Math.round(ms / 100));
    for (let k = 1; k <= steps; k++) { const f = k / steps; el.scrollTop = dir === 'bottom' ? range * f : range * (1 - f); await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 100))); }
    return { ok: true, range, endTop: el.scrollTop, writes: steps };
  }, { dir, ms });

  for (const tab of ['插件', '通用设置']) {
    await clickNav(tab); await page.waitForTimeout(900);
    R[`range_${tab}`] = await scrollRange();
    // C0 对照：同时长、不滚动
    await runWindow(`IDLE ${tab} (不滚动, ${IDLE_MS}ms)`, () => page.waitForTimeout(IDLE_MS), { waitMs: IDLE_MS + 100 });
    // C1 原样滚动
    for (const dir of ['bottom', 'top']) await runWindow(`SCROLL ${tab} A原样 →${dir}`, () => doScroll(dir, IDLE_MS), { waitMs: IDLE_MS + 150 });
    // C2 隐藏壁纸固定层（pointer-events:none 的 fixed 层）
    R.hiddenFix = await page.evaluate(() => { let n = 0; for (const el of document.querySelectorAll('body *')) { const cs = getComputedStyle(el); if (cs.position === 'fixed' && cs.pointerEvents === 'none') { el.style.display = 'none'; n++; } } return n; });
    for (const dir of ['bottom', 'top']) await runWindow(`SCROLL ${tab} B无壁纸固定层 →${dir}`, () => doScroll(dir, IDLE_MS), { waitMs: IDLE_MS + 150 });
    await page.evaluate(() => { for (const el of document.querySelectorAll('body *')) { const cs = getComputedStyle(el); if (cs.position === 'fixed' && cs.pointerEvents === 'none') el.style.display = ''; } });
    // C3 关掉 backdrop-filter
    R.blurOff = await page.evaluate(() => { let n = 0; for (const el of document.querySelectorAll('body *')) { const cs = getComputedStyle(el); if (cs.backdropFilter && cs.backdropFilter !== 'none') { el.style.backdropFilter = 'none'; el.style.webkitBackdropFilter = 'none'; n++; } } return n; });
    for (const dir of ['bottom', 'top']) await runWindow(`SCROLL ${tab} C无backdrop-filter →${dir}`, () => doScroll(dir, IDLE_MS), { waitMs: IDLE_MS + 150 });
  }

  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  R.closeState = await page.evaluate(() => ({ dialogCount: document.querySelectorAll('[role="dialog"]').length }));
  R.stage = 'done';
} catch (e) { R.stage = 'ERROR'; R.fatal = String(e && e.stack || e).slice(0, 900); log('FATAL', R.fatal); }
finally {
  try { if (browser) await browser.close(); } catch {}
  R.release = release(AGENT);
  R.concurrency_at_end = censusVerdict(census(), ownDir || '');
  writeFileSync(OUTFILE, JSON.stringify(R, null, 2));
  log('WROTE', OUTFILE, 'windows', R.windows.length, 'stage', R.stage, 'release', JSON.stringify(R.release));
}
