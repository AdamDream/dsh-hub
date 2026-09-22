#!/usr/bin/env node
/**
 * run4.mjs — 两个补测：
 *  (1) 「插件」栏目内部子标签「插件配置 configurable ↔ 插件列表 all」切换（run2 因 y 阈值过紧未跑成）
 *  (2) 滚动 A/B/C 的**逆序复现**（C 先 / B 次 / A 末）——用于排除 run2 的「顺序/预热」伪像
 * 每窗前后并发门禁（strict）。
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { tryAcquire, release, census, censusVerdict } from '../lib/lock.mjs';

const BASE = 'http://127.0.0.1:3080';
const HERE = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/tab-switch';
const AGENT = 'incident2-tab-switch';
const OUT = `${HERE}/raw/${process.env.OUT || 'tabswitch-run4.json'}`;
const WINDOW_MS = Number(process.env.WINDOW_MS || 1600);
const SETTLE_MS = Number(process.env.SETTLE_MS || 900);
const SEG_MS = Number(process.env.SEG_MS || 2200);
const SUB_ROUNDS = Number(process.env.SUB_ROUNDS || 3);
const R = { at: new Date().toISOString(), env: { WINDOW_MS, SETTLE_MS, SEG_MS, SUB_ROUNDS }, errors: [], windows: [] };
const log = (...a) => console.log('[run4]', ...a);
const lock = tryAcquire(AGENT, 'plugins sub-tab switching + reversed-order scroll A/B/C replication', 1500, log);
R.lock = lock.acquired;
if (!lock.acquired) { writeFileSync(OUT, JSON.stringify(R, null, 2)); process.exit(2); }

let browser, ownDir;
try {
  const cenPre = census();
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.addInitScript({ path: `${HERE}/lib/init-probe.js` });
  page.on('pageerror', (e) => R.errors.push(String(e).slice(0, 200)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(12000);
  ownDir = (census().headless_shell.find((r) => !cenPre.headless_shell.some((q) => q.pid === r.pid)) || {}).userDataDir || null;
  R.own_user_data_dir = ownDir;
  const gate = () => { const v = censusVerdict(census(), ownDir); return { ok: v.foreign === 0 && v.own >= 1, foreign: v.foreign }; };
  const cdpMetrics = async () => { const { metrics } = await cdp.send('Performance.getMetrics'); const keep = ['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'Nodes']; const o = {}; for (const m of metrics) if (keep.includes(m.name)) o[m.name] = m.value; return o; };
  const mdelta = (a, b) => { const o = {}; for (const k of Object.keys(b)) if (a[k] != null) o[k] = +(b[k] - a[k]).toFixed(4); return o; };

  await page.evaluate(() => {
    const S = globalThis.__TS__;
    S.armW = () => { S.armed = true; S.frames = []; S.frameTs = []; S.longtasks = []; S.loaf = []; S.rpc = []; S.churn = { added: 0, removed: 0, attributes: 0, characterData: 0, records: 0 }; S.layoutReads = {}; S.lastClick = null;
      const h = (ev) => { S.lastClick = { t: performance.now() }; }; S._cl = h; document.addEventListener('click', h, true); return performance.now(); };
    S.disW = () => { S.armed = false; if (S._cl) document.removeEventListener('click', S._cl, true);
      return { fs: S.framesummary(), longtasks: S.longtasks, loaf: S.loaf, rpc: S.rpc, churn: S.churn, layoutReads: S.layoutReads, lastClick: S.lastClick, frameTs: S.frameTs,
        dialogNodes: (() => { const d = document.querySelector('[role="dialog"]'); return d ? d.querySelectorAll('*').length : 0; })(),
        dialogSvg: (() => { const d = document.querySelector('[role="dialog"]'); return d ? d.querySelectorAll('svg').length : 0; })() }; };
  });

  const trig = await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '设置'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(trig.x, trig.y);
  await page.waitForTimeout(2500);

  async function runWindow(label, action, opts = {}) {
    const g0 = gate(); const cd0 = await cdpMetrics();
    const armAt = await page.evaluate(() => globalThis.__TS__.armW());
    const w0 = Date.now(); await action(); const w1 = Date.now();
    const wait = opts.waitMs ?? WINDOW_MS; const el = Date.now() - w0; if (el < wait) await page.waitForTimeout(wait - el);
    const end = await page.evaluate(() => globalThis.__TS__.disW());
    const cd1 = await cdpMetrics(); const g1 = gate();
    const lt = end.longtasks.filter((x) => x.t >= armAt - 1);
    const fts = end.frameTs || []; const lcT = end.lastClick ? end.lastClick.t : null;
    let ffa = null; if (lcT != null) { const nx = fts.find((t) => t >= lcT); if (nx != null) ffa = +(nx - lcT).toFixed(2); }
    const w = { label, gate_pre: g0, gate_post: g1, valid: g0.ok && g1.ok, firstFrameAfterClickMs: ffa, frames: end.fs,
      longtasks: lt, longtask_total_ms: +lt.reduce((a, b) => a + b.dur, 0).toFixed(2),
      loaf: end.loaf.filter((x) => x.t >= armAt - 1),
      rpc: (() => { const inw = end.rpc.filter((r) => r.t0 >= armAt - 1); const g = {}; for (const r of inw) { const k = r.path + (r.stream ? ' [SSE]' : ''); g[k] = g[k] || { n: 0, ms: [] }; g[k].n++; if (r.ms != null && !r.stream) g[k].ms.push(r.ms); } return { total: inw.length, by: g }; })(),
      churn: end.churn, layoutReads: end.layoutReads, dom: { dialogNodes: end.dialogNodes, dialogSvg: end.dialogSvg }, cdpDelta: mdelta(cd0, cd1) };
    R.windows.push(w);
    log(`${label}${w.valid ? '' : ' ***INVALID***'}: ${w.frames.n}f p95=${w.frames.p95} p99=${w.frames.p99} max=${w.frames.max} >50=${w.frames.over50} LT=${lt.length}/${w.longtask_total_ms}ms rpc=${w.rpc.total} nodes=${w.dom.dialogNodes} svg=${w.dom.dialogSvg} ΔL=${w.cdpDelta.LayoutCount} ΔS=${w.cdpDelta.RecalcStyleCount} ΔScD=${w.cdpDelta.ScriptDuration} churn+=${w.churn.added}`);
    // 记录每窗 RPC 方法名（供报告）
    if (w.rpc.total) log('   rpc: ' + Object.entries(w.rpc.by).map(([k, v]) => `${k}×${v.n}`).join('; '));
    await page.waitForTimeout(SETTLE_MS);
    return w;
  }

  /* ---------- (1) 插件子标签 ---------- */
  const navBtn = async (text) => page.evaluate((t) => { const b = Array.from(document.querySelector('[role="dialog"]').querySelectorAll('nav button')).find((x) => (x.textContent || '').trim() === t); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, text);
  const p = await navBtn('插件');
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(1600);
  R.subTabDom = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    return Array.from(dlg.querySelectorAll('[role="tab"]')).map((el, i) => { const r = el.getBoundingClientRect(); return { i, text: (el.textContent || '').trim(), selected: el.getAttribute('aria-selected'), x: +(r.x + r.width / 2).toFixed(1), y: +(r.y + r.height / 2).toFixed(1) }; });
  });
  log('sub-tabs:', JSON.stringify(R.subTabDom));
  if (R.subTabDom.length >= 2) {
    const cfg = R.subTabDom.find((t) => t.selected === 'true') || R.subTabDom[0];
    const other = R.subTabDom.find((t) => t.text !== cfg.text);
    R.subTabPair = { active: cfg, other };
    R.nodeCountsPerSubTab = {};
    for (let r = 1; r <= SUB_ROUNDS; r++) {
      const w1 = await runWindow(`SUBTAB r${r} → ${other.text}`, () => page.mouse.click(other.x, other.y));
      R.nodeCountsPerSubTab[other.text] = w1.dom.dialogNodes;
      const w2 = await runWindow(`SUBTAB r${r} → ${cfg.text}`, () => page.mouse.click(cfg.x, cfg.y));
      R.nodeCountsPerSubTab[cfg.text] = w2.dom.dialogNodes;
    }
  }

  /* ---------- (2) 滚动 A/B/C 逆序复现（在「插件」栏目） ---------- */
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(1200);
  await page.waitForTimeout(600);
  const doScroll = (dir, ms) => page.evaluate(async ({ dir, ms }) => {
    const dlg = document.querySelector('[role="dialog"]');
    const el = Array.from(dlg.querySelectorAll('*')).filter((x) => x.scrollHeight > x.clientHeight + 4).sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
    if (!el) return { ok: false };
    const range = el.scrollHeight - el.clientHeight; const steps = Math.max(4, Math.round(ms / 100));
    for (let k = 1; k <= steps; k++) { const f = k / steps; el.scrollTop = dir === 'bottom' ? range * f : range * (1 - f); await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 100))); }
    return { ok: true, range, endTop: el.scrollTop, writes: steps };
  }, { dir, ms });
  const setBlur = (off) => page.evaluate((off) => { let n = 0; for (const el of document.querySelectorAll('body *')) { const cs = getComputedStyle(el); if (cs.backdropFilter && cs.backdropFilter !== 'none') { el.style.backdropFilter = off ? 'none' : ''; el.style.webkitBackdropFilter = off ? 'none' : ''; n++; } } return n; }, off);
  const setFix = (hide) => page.evaluate((hide) => { let n = 0; for (const el of document.querySelectorAll('body *')) { const cs = getComputedStyle(el); if (cs.position === 'fixed' && cs.pointerEvents === 'none') { el.style.display = hide ? 'none' : ''; n++; } } return n; }, hide);

  R.scrollOrder = ['C(no-blur)', 'B(no-wallpaper-layer)', 'A(as-is)'];
  // C 先
  R.blurElements = await setBlur(true);
  for (const dir of ['bottom', 'top']) await runWindow(`REV C无backdrop-filter →${dir}`, () => doScroll(dir, SEG_MS), { waitMs: SEG_MS + 150 });
  await setBlur(false);
  log('blur restored');
  // B
  R.fixedLayerElements = await setFix(true);
  for (const dir of ['bottom', 'top']) await runWindow(`REV B无壁纸固定层 →${dir}`, () => doScroll(dir, SEG_MS), { waitMs: SEG_MS + 150 });
  await setFix(false);
  log('fixed layer restored');
  // A 末
  for (const dir of ['bottom', 'top']) await runWindow(`REV A原样 →${dir}`, () => doScroll(dir, SEG_MS), { waitMs: SEG_MS + 150 });
  // 对照：同时长不滚动
  await runWindow(`REV IDLE (不滚动, ${SEG_MS}ms)`, () => page.waitForTimeout(SEG_MS), { waitMs: SEG_MS + 150 });

  await page.keyboard.press('Escape');
  R.stage = 'done';
} catch (e) { R.stage = 'ERROR'; R.fatal = String(e && e.stack || e).slice(0, 900); log('FATAL', R.fatal); }
finally {
  try { if (browser) await browser.close(); } catch {}
  R.release = release(AGENT);
  R.concurrency_at_end = censusVerdict(census(), ownDir || '');
  writeFileSync(OUT, JSON.stringify(R, null, 2));
  log('WROTE', OUT, 'windows', R.windows.length, 'stage', R.stage, 'release', JSON.stringify(R.release));
}
