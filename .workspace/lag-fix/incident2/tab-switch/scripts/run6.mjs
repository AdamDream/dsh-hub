#!/usr/bin/env node
/**
 * run6.mjs — 定点裁决 `/api/pluginInventory/list` 的真实耗时（本线 run5 曾据"窗口内未 settle"推断 >1.8s，
 *            与 plugins-page 线 HTTP 实测 p50 9.09 ms 冲突）。
 * 手法：单独一个请求、等到 resolve 为止（上限 25s），并区分「本会话首次(冷)」与「二次(温)」。
 * 另：为 9 个 /usage/* 记录 click→发出 与 发出→resolve 两个阶段，交叉核对「click+6…8ms 并发发出」。
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { tryAcquire, release, census, censusVerdict } from '../lib/lock.mjs';

const BASE = 'http://127.0.0.1:3080';
const HERE = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/tab-switch';
const AGENT = 'incident2-tab-switch';
const OUT = `${HERE}/raw/${process.env.OUT || 'run6-inventory-rpc.json'}`;
const R = { at: new Date().toISOString(), errors: [] };
const log = (...a) => console.log('[run6]', ...a);
const lock = tryAcquire(AGENT, 'pluginInventory.list true latency (cold vs warm)', 1500, log);
R.lock = lock.acquired;
if (!lock.acquired) { writeFileSync(OUT, JSON.stringify(R, null, 2)); process.exit(2); }

let browser, ownDir;
try {
  const cenPre = census();
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const S = { rpc: [], clickT: null };
    globalThis.__R6__ = S;
    const of = globalThis.fetch;
    globalThis.fetch = function (input, init) {
      let url = ''; try { url = typeof input === 'string' ? input : (input && input.url) || String(input); } catch {}
      const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
      const isStream = /\/api\/events\./.test(path);
      const rec = { path, t0: performance.now(), stream: isStream, state: 'pending', bytes: null, note: null };
      S.rpc.push(rec);
      const p = of.apply(this, arguments);
      return p.then((res) => {
        rec.hdrAt = performance.now(); rec.status = res.status;
        if (!isStream) {
          try { const cl = res.headers.get('content-length'); rec.contentLength = cl ? Number(cl) : null; } catch {}
          // 读副本取真实字节数（只对本探针、且只读一次）
          try { res.clone().text().then((t) => { rec.bytes = t.length; rec.bodyAt = performance.now(); }).catch(() => {}); } catch {}
          rec.state = 'headers';
        }
        return res;
      }, (e) => { rec.state = 'error'; rec.err = String(e).slice(0, 80); throw e; });
    };
    document.addEventListener('click', () => { S.clickT = performance.now(); }, true);
  });
  page.on('pageerror', (e) => R.errors.push(String(e).slice(0, 200)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(12000);
  ownDir = (census().headless_shell.find((r) => !cenPre.headless_shell.some((q) => q.pid === r.pid)) || {}).userDataDir || null;
  const gate = () => { const v = censusVerdict(census(), ownDir); return { ok: v.foreign === 0 && v.own >= 1, foreign: v.foreign }; };
  R.gate_open = gate();
  R.loadavg = (await import('node:fs')).readFileSync('/proc/loadavg', 'utf8').trim();
  log('loadavg:', R.loadavg, 'gate', JSON.stringify(R.gate_open));

  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some((x) => (x.textContent || '').trim() === '设置'), { timeout: 90000 });
  const trig = await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '设置'); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(trig.x, trig.y);
  await page.waitForSelector('[role="dialog"] nav button', { timeout: 30000 });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('[role="dialog"] nav button')).some((x) => (x.textContent || '').trim() === '插件'), { timeout: 30000 });

  const navAt = (t) => page.evaluate((t) => { const b = Array.from(document.querySelector('[role="dialog"]').querySelectorAll('nav button')).find((x) => (x.textContent || '').trim() === t); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, t);
  const tabAt = (t) => page.evaluate((t) => { const el = Array.from(document.querySelector('[role="dialog"]').querySelectorAll('[role="tab"]')).find((x) => (x.textContent || '').trim() === t); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, t);

  // --- A) 点导航「插件」：期望 9 个 /usage/*，期望【没有】pluginInventory.list ---
  await page.evaluate(() => { globalThis.__R6__.rpc = []; globalThis.__R6__.clickT = null; });
  const p = await navAt('插件');
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(6000);
  const A = await page.evaluate(() => { const S = globalThis.__R6__; return { clickT: S.clickT, rpc: S.rpc.map((r) => ({ p: r.path, issuedAfterClickMs: S.clickT ? +(r.t0 - S.clickT).toFixed(1) : null, hdrMs: r.hdrAt ? +(r.hdrAt - r.t0).toFixed(1) : null, status: r.status, bytes: r.bytes, state: r.state })) }; });
  R.navPlugins = A;
  log('A) 点导航「插件」→', A.rpc.length, '个 RPC；含 pluginInventory.list ?', A.rpc.some((r) => r.p.includes('pluginInventory')));
  for (const r of A.rpc) log(`     ${r.p}  issued+${r.issuedAfterClickMs}ms  dur=${r.hdrMs}ms  bytes=${r.bytes}`);

  // --- B) 点「插件列表」子标签：等到 resolve（上限 25s），取真实耗时 ---
  await page.evaluate(() => { globalThis.__R6__.rpc = []; globalThis.__R6__.clickT = null; });
  const t0 = await tabAt('插件列表');
  R.tabFound = !!t0;
  if (t0) {
    await page.mouse.click(t0.x, t0.y);
    let rec = null, waited = 0;
    for (let i = 0; i < 50; i++) {           // 最多 ~25s
      await page.waitForTimeout(500); waited += 500;
      rec = await page.evaluate(() => { const r = globalThis.__R6__.rpc.find((x) => x.path.includes('pluginInventory')); return r ? { p: r.path, issuedAfterClickMs: globalThis.__R6__.clickT ? +(r.t0 - globalThis.__R6__.clickT).toFixed(1) : null, hdrMs: r.hdrAt ? +(r.hdrAt - r.t0).toFixed(1) : null, bodyMs: r.bodyAt ? +(r.bodyAt - r.t0).toFixed(1) : null, status: r.status, bytes: r.bytes, contentLength: r.contentLength, state: r.state } : null; });
      if (rec && rec.state !== 'pending') break;
    }
    R.subTabInventoryFirst = { waitedMs: waited, rec };
    log('B) 点「插件列表」→ pluginInventory.list:', JSON.stringify(rec), `( waited ${waited}ms )`);
  }

  // --- C) 第二次（温）：切走再切回，再点「插件列表」 ---
  await page.evaluate(() => { globalThis.__R6__.rpc = []; globalThis.__R6__.clickT = null; });
  const pm = await navAt('模型'); await page.mouse.click(pm.x, pm.y); await page.waitForTimeout(1500);
  const pp = await navAt('插件'); await page.mouse.click(pp.x, pp.y); await page.waitForTimeout(2500);
  const t1 = await tabAt('插件列表');
  if (t1) {
    await page.evaluate(() => { globalThis.__R6__.rpc = []; globalThis.__R6__.clickT = null; });
    await page.mouse.click(t1.x, t1.y);
    let rec2 = null, waited2 = 0;
    for (let i = 0; i < 50; i++) { await page.waitForTimeout(500); waited2 += 500; rec2 = await page.evaluate(() => { const r = globalThis.__R6__.rpc.find((x) => x.path.includes('pluginInventory')); return r ? { p: r.path, issuedAfterClickMs: globalThis.__R6__.clickT ? +(r.t0 - globalThis.__R6__.clickT).toFixed(1) : null, hdrMs: r.hdrAt ? +(r.hdrAt - r.t0).toFixed(1) : null, bodyMs: r.bodyAt ? +(r.bodyAt - r.t0).toFixed(1) : null, status: r.status, bytes: r.bytes, state: r.state } : null; }); if (rec2 && rec2.state !== 'pending') break; }
    R.subTabInventorySecond = { waitedMs: waited2, rec: rec2, candidateCount: await page.evaluate(() => globalThis.__R6__.rpc.filter((x) => x.path.includes('pluginInventory')).length) };
    log('C) 二次（温）点「插件列表」→', JSON.stringify(rec2), `( waited ${waited2}ms, 该窗内候选数=${R.subTabInventorySecond.candidateCount} )`);
  }

  await page.keyboard.press('Escape');
  R.stage = 'done';
} catch (e) { R.stage = 'ERROR'; R.fatal = String(e && e.stack || e).slice(0, 700); log('FATAL', R.fatal); }
finally {
  try { if (browser) await browser.close(); } catch {}
  R.release = release(AGENT);
  R.gate_close = censusVerdict(census(), ownDir || '');
  writeFileSync(OUT, JSON.stringify(R, null, 2));
  log('WROTE', OUT, 'stage', R.stage, 'release', JSON.stringify(R.release));
}
