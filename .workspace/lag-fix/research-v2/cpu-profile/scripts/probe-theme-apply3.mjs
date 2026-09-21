// Count document.body[style] mutation batches = ThemePresenter.apply invocations
// (apply is the only writer of body inline style tokens). Also correlate with WS rate.
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = 'http://127.0.0.1:3080';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/cpu-profile/raw';

const HOOK = () => {
  const S = { batches: [], props: 0, raf: 0 };
  window.__bp = S;
  const install = () => {
    if (!document.body || S.installed) return !!S.installed;
    new MutationObserver((recs) => {
      let setN = 0, remN = 0;
      for (const r of recs) {
        if (r.type !== 'attributes' || r.attributeName !== 'style') continue;
        const oldV = r.oldValue || ''; const newV = r.target.getAttribute('style') || '';
        const oc = (oldV.match(/[^;:]+:/g) || []).length; const nc = (newV.match(/[^;:]+:/g) || []).length;
        setN += Math.max(0, nc - oc); remN += Math.max(0, oc - nc);
      }
      S.props += setN;
      S.batches.push({ t: performance.now(), records: recs.length, setN, remN, total: (recs[0]?.target?.getAttribute('style') || '').length });
    }).observe(document.body, { attributes: true, attributeFilter: ['style'], attributeOldValue: true });
    S.installed = true;
    return true;
  };
  install();
  if (!S.installed) { document.addEventListener('readystatechange', install); const iv = setInterval(() => { if (install()) clearInterval(iv); }, 50); }
  requestAnimationFrame(function f(t) { S.raf++; requestAnimationFrame(f); });
};

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(HOOK);
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(9000);
const ws = [];
page.on('websocket', (s) => { s.on('framereceived', (d) => { try { const t = typeof d === 'string' ? d : (d.payload ?? '').toString(); ws.push({ t: Date.now(), m: [...t.matchAll(/"method"\s*:\s*"([^"]{1,48})"/g)].map((x) => x[1])[0] || null }); } catch { } }); });

const sample = async (label, ms) => {
  const a = await page.evaluate(() => ({ b: window.__bp.batches.length, p: window.__bp.props, r: window.__bp.raf, t: performance.now() }));
  const w0 = ws.length;
  await sleep(ms);
  const b = await page.evaluate(() => ({ b: window.__bp.batches.length, p: window.__bp.props, r: window.__bp.raf, t: performance.now(), installed: window.__bp.installed, len: window.__bp.batches.slice(-3).map((x) => x.total) }));
  const w1 = ws.length;
  const sec = (b.t - a.t) / 1000;
  const inW = ws.slice(w0, w1);
  const byM = {}; for (const f of inW) byM[f.m || 'none'] = (byM[f.m || 'none'] || 0) + 1;
  return { label, sec: Math.round(sec * 100) / 100, bodyStyleBatches: b.b - a.b, batchesPerS: Math.round(((b.b - a.b) / sec) * 100) / 100, stylePropsWritten: b.p - a.p, propsPerBatch: (b.b - a.b) ? Math.round(((b.p - a.p) / (b.b - a.b)) * 10) / 10 : null, rafFrames: b.r - a.r, rafPerS: Math.round(((b.r - a.r) / sec) * 100) / 100, wsFrames: w1 - w0, wsPerS: Math.round(((w1 - w0) / sec) * 100) / 100, wsByMethod: byM, installed: b.installed, styleAttrLen: b.len };
};

const res = [];
res.push(await sample('home', 12000));

// open long session
const projects = await page.evaluate(() => [...document.querySelectorAll('[class*=projectRow]')].map((r) => (r.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)));
for (const t of projects) { try { await page.locator('[class*=projectRow]', { hasText: t }).first().click({ timeout: 1200 }); await sleep(150); } catch { } }
try { const el = page.getByText('会话删除更新误删全部会话', { exact: false }).first(); if (await el.count()) await el.click({ timeout: 2500 }); } catch { }
await sleep(3500);
res.push(await sample('long-session', 12000));
res.push(await sample('long-session-2', 12000));

// open settings
try { const l = page.locator('button:has-text("设置")').first(); if (await l.count()) await l.click({ timeout: 2500 }); } catch { }
await sleep(2500);
res.push(await sample('settings-general', 12000));
try { const l = page.locator('[class*=navCell]:has-text("插件")').first(); if (await l.count()) await l.click({ timeout: 2500 }); } catch { }
await sleep(2000);
res.push(await sample('settings-plugins', 12000));

const out = { probe: 'body[style] mutation batches as ThemePresenter.apply proxy', results: res, finalBodyStyleLen: await page.evaluate(() => (document.body.getAttribute('style') || '').length), finalBodyProps: await page.evaluate(() => { const s = document.body.getAttribute('style') || ''; return (s.match(/[^;:]+:/g) || []).length; }) };
fs.writeFileSync(`${OUT}/theme-apply-probe3.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2).slice(0, 4000));
await browser.close();
