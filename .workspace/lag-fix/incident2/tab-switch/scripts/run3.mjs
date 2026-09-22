#!/usr/bin/env node
/**
 * run3.mjs — 机制裁决的决定性实验：「整面板重挂载」还是「仅内容替换」。
 * 手法：给面板外壳各关键 DOM 对象打 JS 身份标签（不可序列化，只能同页比对），
 *       然后逐栏目切换，每次检查：
 *         - 外壳对象身份是否不变（===比较）
 *         - 内容容器内被替换的子树规模（切换前后 dialogNodes 差值）
 *         - 旧栏目是否真的 unmount（其内部节点被移除）
 * 另含：12s 静置（dwell）观察是否有常驻定时器/RPC 在栏目内自行触发。
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { tryAcquire, release, census, censusVerdict } from '../lib/lock.mjs';

const BASE = 'http://127.0.0.1:3080';
const HERE = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/tab-switch';
const AGENT = 'incident2-tab-switch';
const OUT = `${HERE}/raw/${process.env.OUT || 'run3-identity.json'}`;
const R = { at: new Date().toISOString(), errors: [], stages: [] };
const log = (...a) => console.log('[run3]', ...a);
const lock = tryAcquire(AGENT, 'panel remount identity test + dwell', 1500, log);
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
  const cenPost = census();
  ownDir = (cenPost.headless_shell.find((r) => !cenPre.headless_shell.some((q) => q.pid === r.pid)) || {}).userDataDir || null;
  R.own_browser = ownDir;
  const gate = () => { const v = censusVerdict(census(), ownDir); return { ok: v.foreign === 0, foreign: v.foreign }; };

  const trig = await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '设置'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(trig.x, trig.y);
  await page.waitForTimeout(2500);

  // 打身份标签：面板外壳 / 导航 / 头部 / 关闭按钮 / 内容区
  R.tagResult = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const nav = dlg.querySelector('nav');
    const header = dlg.querySelector('[class*="header"]') || dlg.firstElementChild;
    const closeBtn = Array.from(dlg.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '关闭');
    const content = dlg.querySelector('[data-slot="settings.section"]');
    const tags = { dlg, nav, header, closeBtn, content };
    globalThis.__ID__ = tags;
    const n = (el) => (el ? el.querySelectorAll('*').length : null);
    return {
      found: Object.fromEntries(Object.entries(tags).map(([k, v]) => [k, !!v])),
      headerCls: header ? String(header.className).slice(0, 60) : null,
      headerTextLen: header ? (header.textContent || '').trim().length : null,
      contentNodes: n(content), dlgNodes: n(dlg),
      navButtons: nav ? Array.from(nav.querySelectorAll('button')).map((b) => (b.textContent || '').trim()) : [],
    };
  });
  log('tags:', JSON.stringify(R.tagResult.found), 'headerCls', R.tagResult.headerCls);

  const tabs = R.tagResult.navButtons;
  for (let i = 0; i < tabs.length; i++) {
    const g0 = gate();
    const before = await page.evaluate(() => {
      const T = globalThis.__ID__;
      const n = (el) => (el && el.isConnected ? el.querySelectorAll('*').length : null);
      const dlg = document.querySelector('[role="dialog"]');
      return { dlgNodes: dlg ? dlg.querySelectorAll('*').length : 0,
        contentNodes: n(T.content),
        contentIsSameObj: document.querySelector('[data-slot="settings.section"]') === T.content,
        contentStillConnected: T.content ? T.content.isConnected : null,
        prevContentHtmlLen: T.content ? (T.content.textContent || '').length : null };
    });
    const r = await page.evaluate((i) => { const b = Array.from(document.querySelector('[role="dialog"]').querySelectorAll('nav button'))[i]; const bb = b.getBoundingClientRect(); return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }; }, i);
    await page.mouse.click(r.x, r.y);
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => {
      const T = globalThis.__ID__;
      const dlg = document.querySelector('[role="dialog"]');
      const nav = dlg ? dlg.querySelector('nav') : null;
      const header = dlg ? (dlg.querySelector('[class*="header"]') || dlg.firstElementChild) : null;
      const closeBtn = dlg ? Array.from(dlg.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '关闭') : null;
      const content = dlg ? dlg.querySelector('[data-slot="settings.section"]') : null;
      return {
        dlgNodes: dlg ? dlg.querySelectorAll('*').length : 0,
        contentNodes: content ? content.querySelectorAll('*').length : 0,
        id_dlg_same: dlg === T.dlg, id_nav_same: nav === T.nav, id_header_same: header === T.header,
        id_close_same: closeBtn === T.closeBtn, id_content_same: content === T.content,
        closeText: closeBtn ? (closeBtn.textContent || '').trim() : null,
        headerTextLen: header ? (header.textContent || '').trim().length : null,
        navButtonCount: nav ? nav.querySelectorAll('button').length : 0,
        contentTextLen: content ? (content.textContent || '').length : 0,
      };
    });
    const g1 = gate();
    R.stages.push({ tabIndex: i, tab: tabs[i], gate_pre: g0, gate_post: g1, valid: g0.ok && g1.ok, before, after,
      contentSubtreeReplaced: before.contentIsSameObj === false || before.contentStillConnected === false,
      nodeDeltaDialog: after.dlgNodes - before.dlgNodes, contentNodeDelta: after.contentNodes - (before.contentNodes || 0) });
    log(`tab#${i} ${tabs[i]}: id_dlg=${after.id_dlg_same} id_nav=${after.id_nav_same} id_header=${after.id_header_same} id_close=${after.id_close_same} id_content=${after.id_content_same} dlgNodes ${before.dlgNodes}→${after.dlgNodes} contentNodes ${before.contentNodes}→${after.contentNodes}`);
    await page.waitForTimeout(500);
  }

  /* ===== 补充：修复后的插件子标签 A/B（每次点击前重读坐标，避免 stale coords） ===== */
  {
    const navPlugins = await page.evaluate(() => { const b = Array.from(document.querySelector('[role="dialog"]').querySelectorAll('nav button')).find((x) => (x.textContent || '').trim() === '插件'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.click(navPlugins.x, navPlugins.y);
    await page.waitForTimeout(1500);
    const readTabs = () => page.evaluate(() => Array.from(document.querySelector('[role="dialog"]').querySelectorAll('[role="tab"]')).map((el) => { const r = el.getBoundingClientRect(); return { text: (el.textContent || '').trim(), selected: el.getAttribute('aria-selected') === 'true', x: +(r.x + r.width / 2).toFixed(1), y: +(r.y + r.height / 2).toFixed(1) }; }));
    R.subtabFixed = [];
    for (let r = 1; r <= 3; r++) {
      for (const want of ['插件列表', '插件配置']) {
        const g0 = gate();
        const tabs = await readTabs();
        const t = tabs.find((x) => x.text === want) || tabs.find((x) => !x.selected);
        const cd0 = await cdpMetrics();
        const armAt = await page.evaluate(() => globalThis.__TS__.armW());
        await page.mouse.click(t.x, t.y);
        await page.waitForTimeout(1800);
        const d = await page.evaluate(() => globalThis.__TS__.disW());
        const cd1 = await cdpMetrics();
        const g1 = gate();
        const inw = d.rpc.filter((x) => x.t0 >= armAt - 1 && !x.stream);
        R.subtabFixed.push({ round: r, want, clickedAt: t, tabsBefore: tabs,
          valid: g0.ok && g1.ok, frames: d.fs, longtasks: d.longtasks.length, lt_ms: +d.longtasks.reduce((a, b) => a + b.dur, 0).toFixed(2),
          dialogNodes: d.dialogNodes, dialogSvg: d.dialogSvg,
          rpc: inw.map((x) => ({ p: x.path, ms: x.ms })), churnAdded: d.churn.added,
          cdpDelta: (() => { const o = {}; for (const k of Object.keys(cd1)) if (cd0[k] != null) o[k] = +(cd1[k] - cd0[k]).toFixed(4); return o; })() });
        const last = R.subtabFixed[R.subtabFixed.length - 1];
        log(`SUBTABFIX r${r} → ${want} @(${t.x},${t.y}) sel=${t.selected}: nodes=${last.dialogNodes} svg=${last.dialogSvg} rpc=${last.rpc.length} [${last.rpc.map((z) => z.p + ':' + z.ms).join(', ')}] f95=${last.frames.p95} LT=${last.longtasks} ΔS=${last.cdpDelta.RecalcStyleCount}`);
        await page.waitForTimeout(700);
      }
    }
  }

  // dwell：静置 12s 观察有无常驻定时器/RPC 自行触发（当前栏目=子代理模型）
  await page.evaluate(() => globalThis.__TS__.armW());
  const g0 = gate();
  await page.waitForTimeout(12000);
  const d = await page.evaluate(() => globalThis.__TS__.disW());
  const g1 = gate();
  R.dwell = { gate_pre: g0, gate_post: g1, valid: g0.ok && g1.ok, seconds: 12,
    frames: d.fs, longtasks: d.longtasks, longtask_total_ms: +d.longtasks.reduce((a, b) => a + b.dur, 0).toFixed(2),
    rpc: d.rpc.filter((r) => !r.stream).map((r) => ({ p: r.path, ms: r.ms })), rpc_streams: d.rpc.filter((r) => r.stream).length,
    churn: d.churn, layoutReads: d.layoutReads, cdpDelta: (async () => null) };
  log('dwell:', JSON.stringify({ lt: d.longtasks.length, rpc: R.dwell.rpc, churn: d.churn }));

  await page.keyboard.press('Escape');
  R.stage = 'done';
} catch (e) { R.stage = 'ERROR'; R.fatal = String(e && e.stack || e).slice(0, 800); log('FATAL', R.fatal); }
finally {
  try { if (browser) await browser.close(); } catch {}
  R.release = release(AGENT);
  writeFileSync(OUT, JSON.stringify(R, null, 2));
  log('WROTE', OUT, 'tabs', R.stages.length);
}
