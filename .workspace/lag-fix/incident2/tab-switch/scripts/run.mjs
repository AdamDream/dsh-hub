#!/usr/bin/env node
/**
 * run.mjs — 设置页栏目切换 / 滚动 逐标签测量
 *
 * 纪律（见 ../LOCK.md）：单浏览器串行；只点「设置」触发器 / 栏目标签 / 关闭（Escape）；
 * 不点保存/应用/删除；不 pkill；不强占共享锁；未持锁不启动浏览器。
 *
 * 阶段：
 *   POS   阳性对照：页内注入 60/120/200ms 同步阻塞，验证 LongTask 通道真的能报出阻塞
 *   NULL  同窗基线：在设置面板内点击惰性区域（不切栏目），同窗长度同器械
 *   SWEEP 3 轮 × 8 栏目（每轮全量走一遍 ⇒ 每栏目 ≥3 次，且天然含来回切换）
 *   REPEAT 连点当前栏目 3 次（“再次点击同一标签”）
 *   PING  「通用设置」↔「插件」来回 3 轮（6 窗）
 *   SCROLL 面板滚动容器 顶↔底 往返 ≥3 次、每次 ≥2s
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tryAcquire, release, census, censusVerdict } from '../lib/lock.mjs';

const BASE = 'http://127.0.0.1:3080';
const HERE = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/tab-switch';
const RAW = `${HERE}/raw`;
const AGENT = 'incident2-tab-switch';
const INIT = `${HERE}/lib/init-probe.js`;
const OUTFILE = `${RAW}/${process.env.OUT || 'tabswitch-run1.json'}`;
const WINDOW_MS = Number(process.env.WINDOW_MS || 1600);
const SETTLE_MS = Number(process.env.SETTLE_MS || 900);
const BOOT_MS = Number(process.env.BOOT_MS || 12000);
const SCROLL_ROUNDS = Number(process.env.SCROLL_ROUNDS || 3);
const SCROLL_SEG_MS = Number(process.env.SCROLL_SEG_MS || 2200);
const SWEEP_ROUNDS = Number(process.env.SWEEP_ROUNDS || 3);
const PING_ROUNDS = Number(process.env.PING_ROUNDS || 3);
const REPEAT_N = Number(process.env.REPEAT_N || 3);
const NULL_N = Number(process.env.NULL_N || 3);
mkdirSync(RAW, { recursive: true });

const R = { at: new Date().toISOString(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  git: {}, lock: {}, env: { window_ms: WINDOW_MS, settle_ms: SETTLE_MS, boot_ms: BOOT_MS, scroll_rounds: SCROLL_ROUNDS, scroll_seg_ms: SCROLL_SEG_MS, sweep_rounds: SWEEP_ROUNDS, ping_rounds: PING_ROUNDS },
  errors: [], windows: [], meta: {} };
const log = (...a) => console.log('[run]', ...a);

/* ---------------- 宿主只读指纹 ---------------- */
try {
  const { execFileSync } = await import('node:child_process');
  R.host = { webProcs: execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' }).split('\n').filter((l) => l.includes('dsh web')).map((l) => l.trim()) };
  R.host.loadavg = execFileSync('cat', ['/proc/loadavg'], { encoding: 'utf8' }).trim();
} catch (e) { R.errors.push('host fingerprint: ' + String(e).slice(0, 200)); }

/* ---------------- 锁 ---------------- */
const cen0 = census();
R.census_before_lock = cen0;
const lock = tryAcquire(AGENT, 'settings tab-switch + scroll per-section profiling (chromium headless_shell)', 1500, log);
R.lock = lock;
if (!lock.acquired) {
  R.verdict = 'LOCK_TIMEOUT — 未取得独占锁，按纪律不启动浏览器';
  writeFileSync(OUTFILE, JSON.stringify(R, null, 2)); console.log(R.verdict); process.exit(2);
}

let browser;
try {
  const cenPreLaunch = census();
  R.census_pre_launch = cenPreLaunch;

  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  page.on('pageerror', (e) => R.errors.push('pageerror: ' + String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') R.errors.push('console.error: ' + m.text().slice(0, 200)); });

  await page.addInitScript({ path: INIT });
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(BOOT_MS);

  /* ---- 自身浏览器进程识别（供并发门禁） ---- */
  const cenPost = census();
  R.census_post_launch = cenPost;
  const mine = cenPost.headless_shell.filter((r) => !cenPreLaunch.headless_shell.some((q) => q.pid === r.pid));
  R.own_browser = mine.map((r) => ({ pid: r.pid, userDataDir: r.userDataDir }));
  R.own_user_data_dir = mine[0]?.userDataDir || null;
  const gate0 = censusVerdict(census(), R.own_user_data_dir);
  R.concurrency_at_start = gate0;
  log('concurrency at start:', JSON.stringify(gate0));

  /* ---- 器械自检 ---- */
  R.instrument = await page.evaluate(() => {
    const s = globalThis.__TS__;
    return { ready: !!s && !!s.ready, loafSupported: s?.loafSupported, loafError: s?.loafError || null, errors: (s?.errors || []).slice(0, 5) };
  });
  log('instrument:', JSON.stringify(R.instrument));

  /* ---- 打开设置（唯一一次点触发器） ---- */
  const trig = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '设置');
    if (!b) return null; const r = b.getBoundingClientRect();
    return { x: +(r.x + r.width / 2).toFixed(1), y: +(r.y + r.height / 2).toFixed(1) };
  });
  R.trigger = trig;
  if (!trig) throw new Error('settings trigger not found');
  await page.mouse.click(trig.x, trig.y);
  await page.waitForTimeout(2500);

  /* ---- 栏目清单（以 live DOM 为准） ---- */
  const navCache = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]'); if (!dlg) return null;
    const nav = dlg.querySelector('nav'); if (!nav) return null;
    const tabs = Array.from(nav.querySelectorAll('button')).map((b, i) => {
      const r = b.getBoundingClientRect();
      return { i, text: (b.textContent || '').trim(), x: +(r.x + r.width / 2).toFixed(1), y: +(r.y + r.height / 2).toFixed(1),
        w: +r.width.toFixed(1), h: +r.height.toFixed(1), active: b.getAttribute('aria-current') === 'true' };
    });
    const opts = dlg.querySelector('div[class*="options"]');
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };
    return { navCls: String(nav.className), navBox: box(nav), tabs,
      contentSel: '[data-slot="settings.section"]',
      optionsCls: opts ? String(opts.className) : null, optionsBox: opts ? box(opts) : null,
      dialogBox: box(dlg) };
  });
  R.nav = navCache;
  if (!navCache || !navCache.tabs.length) throw new Error('no settings nav tabs');
  log('tabs:', navCache.tabs.map((t) => t.text).join(' | '));

  /* ---- 惰性点（同窗基线用）：dialog 内不含可交互祖先的点 ---- */
  R.nullPoint = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const interactive = (el) => { let n = el; while (n && n !== dlg) { const t = n.tagName; if (t === 'BUTTON' || t === 'A' || t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA' || n.getAttribute('role') === 'button' || n.getAttribute('role') === 'tab') return true; n = n.parentElement; } return false; };
    const r = dlg.getBoundingClientRect();
    for (const cand of [[r.x + 30, r.y + 12], [r.x + r.width - 30, r.y + 12], [r.x + r.width / 2, r.y + 16], [r.x + 20, r.y + r.height - 12]]) {
      const el = document.elementFromPoint(cand[0], cand[1]);
      if (el && dlg.contains(el) && !interactive(el)) return { x: +cand[0].toFixed(1), y: +cand[1].toFixed(1), tag: el.tagName, cls: String(el.className).slice(0, 60) };
    }
    return null;
  });
  log('null point:', JSON.stringify(R.nullPoint));

  /* ---------------- 页内：单窗测量原语 ---------------- */
  await page.evaluate(() => {
    const S = globalThis.__TS__;
    S.sigOf = () => {
      const el = document.querySelector('[data-slot="settings.section"]');
      if (!el) return null;
      const t = el.textContent || '';
      let h = 0; const n = Math.min(t.length, 400);
      for (let i = 0; i < n; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
      return { len: t.length, hash: h, nodes: el.querySelectorAll('*').length, svg: el.querySelectorAll('svg').length };
    };
    S.armWindow = () => {
      S.armed = true; S.frames = []; S.frameTs = []; S.longtasks = []; S.loaf = []; S.rpc = [];
      S.churn = { added: 0, removed: 0, attributes: 0, characterData: 0, records: 0 }; S.layoutReads = {}; S.markers = [];
      S.lastClick = null; S.sigBefore = S.sigOf();
      const h = (ev) => { S.lastClick = { t: performance.now(), wall: Date.now(), target: (ev.target && ev.target.tagName) || null }; };
      S._cl = h; document.addEventListener('click', h, true);
      return { at: performance.now(), wall: Date.now(), sig: S.sigBefore };
    };
    S.sigWatch = (timeoutMs) => new Promise((res) => {
      const t0 = performance.now();
      const before = S.sigBefore;
      let changedAt = null, stableAt = null, prev = null, stableCount = 0;
      const tick = () => {
        const s = S.sigOf();
        const changed = !!before && !!s && (s.hash !== before.hash || s.len !== before.len);
        if (changed && changedAt == null) changedAt = performance.now();
        if (changed) {
          const key = s ? s.hash + ':' + s.len : 'null';
          if (key === prev) stableCount++; else { stableCount = 0; prev = key; }
          if (stableCount >= 1 && stableAt == null) stableAt = performance.now();
        }
        if ((changedAt != null && stableAt != null) || performance.now() - t0 > timeoutMs) {
          res({ t0, changedAt, stableAt, sigAfter: S.sigOf(), timedOut: performance.now() - t0 > timeoutMs, waitedMs: +(performance.now() - t0).toFixed(2) });
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    S.disarmWindow = () => {
      S.armed = false;
      if (S._cl) document.removeEventListener('click', S._cl, true);
      return { fs: S.framesummary(), sig: S.sigOf(), nodes: document.querySelectorAll('*').length,
        dialogNodes: (() => { const d = document.querySelector('[role="dialog"]'); return d ? d.querySelectorAll('*').length : 0; })(),
        dialogSvg: (() => { const d = document.querySelector('[role="dialog"]'); return d ? d.querySelectorAll('svg').length : 0; })(),
        ctx: { longtasks: S.longtasks, loaf: S.loaf, rpc: S.rpc, churn: S.churn, layoutReads: S.layoutReads, markers: S.markers, lastClick: S.lastClick, armAt: S.armWall, frameTs: S.frameTs } };
    };
  });

  const cdpMetrics = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const keep = ['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration', 'JSHeapUsedSize', 'Nodes', 'JSEventListeners', 'Documents', 'Frames', 'DevToolsCommandDuration'];
    const o = {}; for (const m of metrics) if (keep.includes(m.name)) o[m.name] = m.value; return o;
  };
  const mdelta = (a, b) => { const o = {}; for (const k of Object.keys(b)) if (a[k] != null) o[k] = +(b[k] - a[k]).toFixed(4); return o; };
  const groupRpc = (rpc, armAt) => {
    const inw = rpc.filter((r) => r.t0 >= armAt - 1);
    const g = {};
    for (const r of inw) {
      const k = r.path + (r.stream ? ' [SSE]' : '');
      g[k] = g[k] || { n: 0, ms: [], status: r.status ?? null };
      g[k].n++; if (r.ms != null && !r.stream) g[k].ms.push(r.ms);
    }
    return { total_calls: inw.length, by_method: g, raw_recent: inw.slice(0, 30).map((r) => ({ p: r.path, ms: r.ms ?? null, st: r.status ?? null, stream: !!r.stream })) };
  };

  /** 执行一个「窗口」：arm → 动作 → 等内容 → 收尾 */
  async function runWindow(label, action, opts = {}) {
    const cd0 = await cdpMetrics();
    const arm = await page.evaluate(() => globalThis.__TS__.armWindow());
    const wallClick0 = Date.now();
    await action();
    const wallClick1 = Date.now();
    const waitMs = opts.waitMs ?? WINDOW_MS;
    let watched = null;
    if (opts.watch !== false) {
      watched = await page.evaluate((t) => globalThis.__TS__.sigWatch(t), Math.max(200, waitMs - 50));
    }
    const elapsed = Date.now() - wallClick0;
    if (elapsed < waitMs) await page.waitForTimeout(waitMs - elapsed);
    const end = await page.evaluate(() => globalThis.__TS__.disarmWindow());
    const cd1 = await cdpMetrics();
    const lc = end.ctx.lastClick;
    const lt = end.ctx.longtasks.filter((x) => x.t >= arm.at - 1);
    const loaf = end.ctx.loaf.filter((x) => x.t >= arm.at - 1);
    const lastClickT = lc ? lc.t : null;
    // 点击后第一帧（下一次呈现机会）与随后的帧间隔
    const fts = end.ctx.frameTs || [];
    let firstFrameAfter = null, gapAfterClick = null;
    if (lastClickT != null) {
      const nx = fts.find((t) => t >= lastClickT);
      if (nx != null) firstFrameAfter = +(nx - lastClickT).toFixed(2);
      const idx0 = fts.findIndex((t) => t >= lastClickT);
      if (idx0 >= 0 && fts[idx0 + 1] != null) gapAfterClick = +(fts[idx0 + 1] - fts[idx0]).toFixed(2);
    }
    const w = {
      label,
      firstFrameAfterClickMs: firstFrameAfter,
      firstGapAfterClickMs: gapAfterClick,
      arm: { perf: +arm.at.toFixed(2), wall: arm.wall, sigBefore: arm.sig },
      wallClickMs: +(wallClick1 - wallClick0).toFixed(2),
      lastClickT: lastClickT != null ? +lastClickT.toFixed(2) : null,
      clickToContentMs: (watched && watched.changedAt != null && lastClickT != null) ? +(watched.changedAt - lastClickT).toFixed(2) : null,
      clickToStableMs: (watched && watched.stableAt != null && lastClickT != null) ? +(watched.stableAt - lastClickT).toFixed(2) : null,
      contentChanged: watched ? watched.changedAt != null : null,
      watchTimedOut: watched ? watched.timedOut : null,
      sigBefore: arm.sig, sigAfter: end.sig,
      frames: end.fs,
      longtasks: lt, longtask_total_ms: +lt.reduce((a, b) => a + b.dur, 0).toFixed(2),
      loaf,
      rpc: groupRpc(end.ctx.rpc, arm.at),
      churn: end.ctx.churn,
      layoutReads: end.ctx.layoutReads,
      dom: { totalNodes: end.nodes, dialogNodes: end.dialogNodes, dialogSvg: end.dialogSvg },
      cdpDelta: mdelta(cd0, cd1),
      cdpBefore: cd0, cdpAfter: cd1,
    };
    R.windows.push(w);
    log(`${label}: content=${w.clickToContentMs}ms changed=${w.contentChanged} f=(${w.frames.n||0}) p95=${w.frames.p95??'-'} max=${w.frames.max??'-'} >50ms=${w.frames.over50??0} LT=${lt.length}/${w.longtask_total_ms}ms rpc=${w.rpc.total_calls} dlgNodes=${end.dialogNodes} layoutΔ=${JSON.stringify(w.cdpDelta.LayoutCount!=null?{L:w.cdpDelta.LayoutCount,S:w.cdpDelta.RecalcStyleCount,LD:+w.cdpDelta.LayoutDuration.toFixed(3),RSD:+w.cdpDelta.RecalcStyleDuration.toFixed(3),ScD:+w.cdpDelta.ScriptDuration.toFixed(3)}:{})}`);
    await page.waitForTimeout(SETTLE_MS);
    return w;
  }

  const clickTab = (i) => page.mouse.click(navCache.tabs[i].x, navCache.tabs[i].y);

  /* ============ POS：阳性对照（必须先做） ============
   * 三个臂，覆盖「注入方式 × 通道」矩阵：
   *   PC-D  DevTools 任务（page.evaluate 同步忙等）
   *   PC-P  页面任务（页内 setTimeout 回调里忙等）
   *   PC-C  **点击驱动**（一次性 click 捕获钩子忙等，经 page.mouse.click 真实投递）
   *     ↑ PC-C 与后续测验完全同路径，是本报告可信度的核心闸门
   */
  R.positiveControl = [];
  const posArm = async (kind, ms) => {
    const cd0 = await cdpMetrics();
    const arm = await page.evaluate(() => globalThis.__TS__.armWindow());
    let actual;
    if (kind === 'devtools') {
      actual = await page.evaluate((m) => globalThis.__TS__.block(m), ms);
    } else if (kind === 'pageTask') {
      actual = await page.evaluate((m) => globalThis.__TS__.spinTask(m), ms);
    } else {
      await page.evaluate((m) => globalThis.__TS__.installClickSpin(m), ms);
      const pt = R.nullPoint || { x: 380, y: 87 };
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(250);
      const br = await page.evaluate(() => globalThis.__TS__.blockRuns.slice(-1)[0] || null);
      actual = br ? br.actual : null;
    }
    await page.waitForTimeout(900);
    const end = await page.evaluate(() => globalThis.__TS__.disarmWindow());
    const cd1 = await cdpMetrics();
    const lt = end.ctx.longtasks.filter((x) => x.t >= arm.at - 1);
    const loafAll = end.ctx.loaf.filter((x) => x.t >= arm.at - 1);
    const pc = { kind, requested_ms: ms, actual_block_ms: actual,
      longtasks: lt, longtask_total_ms: +lt.reduce((a, b) => a + b.dur, 0).toFixed(2), longtask_max_ms: lt.length ? Math.max(...lt.map((x) => x.dur)) : null,
      loaf: loafAll, loaf_max_ms: loafAll.length ? Math.max(...loafAll.map((x) => x.dur)) : null,
      frames: end.fs, frames_over50: end.fs.over50 ?? 0,
      cdpDelta: mdelta(cd0, cd1), detected: lt.length > 0 };
    R.positiveControl.push(pc);
    log(`POS[${kind}] block(${ms})ms -> actual=${actual} longtask_max=${pc.longtask_max_ms} loaf_max=${pc.loaf_max_ms} frameMax=${end.fs.max} frames>50ms=${pc.frames_over50}`);
    await page.waitForTimeout(500);
  };
  for (const kind of ['devtools', 'pageTask', 'click']) for (const ms of [60, 120, 200]) await posArm(kind, ms);

  const pcBy = (k, m) => R.positiveControl.find((p) => p.kind === k && p.requested_ms === m);
  const within = (p, lo, hi) => !!(p && p.longtask_max_ms != null && p.longtask_max_ms >= lo && p.longtask_max_ms <= hi);
  R.positiveControlVerdict = {
    'PC-C click-driven 120ms (决定性闸门)': within(pcBy('click', 120), 100, 260)
      ? 'PASS — 点击驱动通道能报出注入的 120ms 阻塞' : 'FAIL — 点击路径的长任务通道未按预期工作，后续「未测到长任务」不可采信',
    'PC-P page-task 120ms': within(pcBy('pageTask', 120), 100, 260) ? 'PASS' : 'FAIL',
    'PC-D devtools-task 120ms (器械边界；预期盲)': within(pcBy('devtools', 120), 100, 260) ? 'PASS(意外)' : 'AS-EXPECTED-BLIND — longtask 通道对 DevTools 下发的任务不产出条目',
    'rAF 帧间隔通道灵敏度': ((pcBy('click', 120)?.frames_over50 || 0) + (pcBy('pageTask', 120)?.frames_over50 || 0)) > 0
      ? '有灵敏度' : '无灵敏度 — 120ms 阻塞未产生任何 >50ms 帧间隔 ⇒ 本环境 rAF 帧间隔不可当失速探测器',
    'LoAF 通道灵敏度': (Math.max(pcBy('click', 120)?.loaf_max_ms || 0, pcBy('pageTask', 120)?.loaf_max_ms || 0)) >= 100 ? '有灵敏度' : '无灵敏度',
  };
  log('POS verdicts: ' + JSON.stringify(R.positiveControlVerdict, null, 1));

  /* ============ NULL：同窗基线 ============ */
  if (R.nullPoint) {
    for (let k = 1; k <= NULL_N; k++) await runWindow(`NULL#${k}(惰性点击)`, () => page.mouse.click(R.nullPoint.x, R.nullPoint.y), { watch: false });
  }

  /* ============ SWEEP：3 轮 × 8 栏目 ============ */
  const tabTexts = navCache.tabs.map((t) => t.text);
  for (let round = 1; round <= SWEEP_ROUNDS; round++) {
    for (let i = 0; i < navCache.tabs.length; i++) {
      await runWindow(`SWEEP r${round} → ${tabTexts[i]}`, () => clickTab(i));
    }
  }

  /* ============ REPEAT：连点当前栏目 3 次 ============ */
  const activeIdx = await page.evaluate(() => {
    const nav = document.querySelector('[role="dialog"] nav');
    const bs = Array.from(nav.querySelectorAll('button'));
    return bs.findIndex((b) => b.getAttribute('aria-current') === 'true');
  });
  R.activeIdxBeforeRepeat = activeIdx;
  for (let k = 1; k <= REPEAT_N; k++) {
    const idx = await page.evaluate(() => {
      const nav = document.querySelector('[role="dialog"] nav');
      const bs = Array.from(nav.querySelectorAll('button'));
      return bs.findIndex((b) => b.getAttribute('aria-current') === 'true');
    });
    await runWindow(`REPEAT#${k} → ${tabTexts[idx] ?? '?'} (同标签)`, () => clickTab(idx < 0 ? 0 : idx), { watch: false });
  }

  /* ============ PING：general ↔ plugins 来回 3 轮 ============ */
  const gi = tabTexts.indexOf('通用设置'); const pi = tabTexts.indexOf('插件');
  R.pingIdx = { general: gi, plugins: pi };
  if (gi >= 0 && pi >= 0) {
    for (let round = 1; round <= PING_ROUNDS; round++) {
      await runWindow(`PING r${round} → 插件`, () => clickTab(pi));
      await runWindow(`PING r${round} → 通用设置`, () => clickTab(gi));
    }
  }

  /* ============ SCROLL ============ */
  R.scrollRanges = {};
  for (const idx of [pi, gi].filter((x) => x >= 0)) {
    const name = tabTexts[idx];
    await clickTab(idx);
    await page.waitForTimeout(900);
    R.scrollRanges[name] = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const cands = Array.from(dlg.querySelectorAll('*')).filter((el) => el.scrollHeight > el.clientHeight + 4);
      cands.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
      const el = cands[0];
      return { found: !!el, cls: el ? String(el.className).slice(0, 80) : null, clientH: el?.clientHeight ?? null, scrollH: el?.scrollHeight ?? null, range: el ? el.scrollHeight - el.clientHeight : null };
    });
  }
  log('scroll ranges:', JSON.stringify(R.scrollRanges));

  for (const idx of [pi, gi].filter((x) => x >= 0)) {
    const name = tabTexts[idx];
    await clickTab(idx);
    await page.waitForTimeout(900);
    for (let round = 1; round <= SCROLL_ROUNDS; round++) {
      for (const dir of ['bottom', 'top']) {
        const cd0 = await cdpMetrics();
        const arm = await page.evaluate(() => globalThis.__TS__.armWindow());
        const segs = Math.ceil(SCROLL_SEG_MS / 100); // 每 100ms 推进一次 scrollTop
        const info = await page.evaluate(async ({ dir, segs }) => {
          const dlg = document.querySelector('[role="dialog"]');
          const cands = Array.from(dlg.querySelectorAll('*')).filter((el) => el.scrollHeight > el.clientHeight + 4);
          cands.sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
          const el = cands[0]; if (!el) return { ok: false };
          // 用「平滑推进」而不是一次性赋值：更接近真实滚动，且每段之间有帧
          const from = dir === 'bottom' ? 0 : el.scrollHeight - el.clientHeight;
          const range = el.scrollHeight - el.clientHeight;
          const steps = segs;
          for (let k = 1; k <= steps; k++) {
            const frac = k / steps;
            el.scrollTop = dir === 'bottom' ? range * frac : range * (1 - frac);
            await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 100)));
          }
          return { ok: true, cls: String(el.className).slice(0, 60), range, endTop: el.scrollTop, writes: steps };
        }, { dir, segs });
        const end = await page.evaluate(() => globalThis.__TS__.disarmWindow());
        const cd1 = await cdpMetrics();
        const lt = end.ctx.longtasks.filter((x) => x.t >= arm.at - 1);
        const w = { label: `SCROLL ${name} r${round} →${dir}`, seg: info,
          frames: end.fs, longtasks: lt, longtask_total_ms: +lt.reduce((a, b) => a + b.dur, 0).toFixed(2),
          loaf: end.ctx.loaf.filter((x) => x.t >= arm.at - 1), churn: end.ctx.churn, layoutReads: end.ctx.layoutReads,
          cdpDelta: mdelta(cd0, cd1), sigAfter: end.sig, dom: { dialogNodes: end.dialogNodes, dialogSvg: end.dialogSvg } };
        R.windows.push(w);
        log(`${w.label}: range=${info.range} f=(${end.fs.n}) p95=${end.fs.p95} max=${end.fs.max} >50=${end.fs.over50} LT=${lt.length}/${w.longtask_total_ms}ms L=${w.cdpDelta.LayoutCount} LD=${w.cdpDelta.LayoutDuration?.toFixed(3)} RS=${w.cdpDelta.RecalcStyleCount}`);
        await page.waitForTimeout(400);
      }
    }
  }

  /* ---- 收尾：Escape 关闭（不触碰任何保存路径） ---- */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  R.closeState = await page.evaluate(() => ({ dialogCount: document.querySelectorAll('[role="dialog"]').length, nodes: document.querySelectorAll('*').length }));
  R.stage = 'done';
} catch (e) {
  R.stage = 'ERROR';
  R.fatal = String(e && e.stack || e).slice(0, 1200);
  log('FATAL', R.fatal);
} finally {
  try { if (browser) await browser.close(); } catch {}
  R.release = release(AGENT);
  R.concurrency_at_end = censusVerdict(census(), R.own_user_data_dir || '');
  writeFileSync(OUTFILE, JSON.stringify(R, null, 2));
  log('WROTE', OUTFILE, 'windows=', R.windows.length, 'stage=', R.stage);
}
