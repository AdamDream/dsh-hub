// Decisive probe: count body.style.setProperty calls directly (tokens written) AND
// run the CDP profiler in the same window, printing the reconciled numbers, plus a
// trimmed call stack for the dominant apply() call site.
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = 'http://127.0.0.1:3080';
const OUT = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/cpu-profile/raw';

// patch CSSStyleDeclaration.prototype once the body exists, counting only body writes
const HOOK = () => {
  window.__sp = { props: 0, removes: 0, stacks: [], installed: false, bodyRef: null };
  const install = () => {
    if (window.__sp.installed) return true;
    const body = document.body; if (!body) return false;
    const proto = Object.getPrototypeOf(body.style);
    const oSet = proto.setProperty, oRem = proto.removeProperty;
    proto.setProperty = function (name, value, prio) {
      if (this === document.body.style) {
        window.__sp.props++;
        if (window.__sp.stacks.length < 4) window.__sp.stacks.push(new Error('setProperty ' + name).stack.split('\n').slice(1, 7).join(' | ').slice(0, 400));
      }
      return oSet.call(this, name, value, prio);
    };
    proto.removeProperty = function (name) { if (this === document.body.style) window.__sp.removes++; return oRem.call(this, name); };
    window.__sp.installed = true; window.__sp.bodyRef = !!body;
    return true;
  };
  if (!install()) { const iv = setInterval(() => { if (install()) clearInterval(iv); }, 40); }
};

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(HOOK);
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send('Performance.enable');
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(9000);

const runWindow = async (label, ms) => {
  await page.evaluate(() => { window.__sp.props = 0; window.__sp.removes = 0; });
  const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.start');
  const t0 = Date.now();
  await sleep(ms);
  const t1 = Date.now();
  const { profile } = await cdp.send('Profiler.stop');
  const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
  const sp = await page.evaluate(() => ({ props: window.__sp.props, removes: window.__sp.removes, installed: window.__sp.installed, stacks: window.__sp.stacks, styleLen: (document.body.getAttribute('style') || '').length }));

  // aggregate profile (units: timeDeltas are microseconds)
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map(); for (const s of profile.samples || []) self.set(s, (self.get(s) || 0) + 1);
  const deltas = profile.timeDeltas || []; const sumUs = deltas.reduce((a, b) => a + b, 0);
  const msPerSample = (deltas.length ? sumUs / deltas.length : 1000) / 1000;
  const wallMs = (profile.endTime - profile.startTime) / 1000;
  const rows = [...self.entries()].map(([id, c]) => { const cf = byId.get(id)?.callFrame || {}; return { fn: cf.functionName || '(anonymous)', url: (cf.url || '').split('/').pop(), line: (cf.lineNumber ?? -1) + 1, ms: c * msPerSample, samples: c, msPerS: (c * msPerSample) / (wallMs / 1000) }; }).sort((a, b) => b.ms - a.ms);
  const totalMs = rows.reduce((a, r) => a + r.ms, 0);
  const g = (k) => Math.round(((m1[k] - m0[k]) * 1000) * 1000) / 1000;
  return {
    label, wallSec: Math.round((wallMs / 1000) * 1000) / 1000, msPerSample: Math.round(msPerSample * 1000) / 1000,
    samples: (profile.samples || []).length, profileTotalMs: Math.round(totalMs), profileMsPerS: Math.round((totalMs / (wallMs / 1000)) * 10) / 10,
    cdp: { ScriptMs: g('ScriptDuration'), TaskMs: g('TaskDuration'), RecalcMs: g('RecalcStyleDuration'), LayoutMs: g('LayoutDuration'), RecalcCount: g('RecalcStyleCount') },
    bodyStyleWrites: sp.props, bodyStyleRemoves: sp.removes, hookInstalled: sp.installed, styleLen: sp.styleLen,
    applyRows: rows.filter((r) => r.fn === 'apply').slice(0, 6),
    top10: rows.slice(0, 10),
    stacks: sp.stacks,
  };
};

const res = [];
res.push(await runWindow('home', 12000));

// open long session
const projects = await page.evaluate(() => [...document.querySelectorAll('[class*=projectRow]')].map((r) => (r.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)));
for (const t of projects) { try { await page.locator('[class*=projectRow]', { hasText: t }).first().click({ timeout: 1200 }); await sleep(150); } catch { } }
try { const el = page.getByText('会话删除更新误删全部会话', { exact: false }).first(); if (await el.count()) await el.click({ timeout: 2500 }); } catch { }
await sleep(3500);
res.push(await runWindow('long-session', 12000));
try { const l = page.locator('button:has-text("设置")').first(); if (await l.count()) await l.click({ timeout: 2500 }); } catch { }
await sleep(2500);
res.push(await runWindow('settings-general', 12000));

fs.writeFileSync(`${OUT}/apply-decisive.json`, JSON.stringify({ results: res }, null, 2));
for (const r of res) {
  console.log(`\n=== ${r.label} wall=${r.wallSec}s msPerSample=${r.msPerSample}`);
  console.log(`  profile total=${r.profileTotalMs}ms (${r.profileMsPerS}ms/s) samples=${r.samples}`);
  console.log(`  cdp script=${r.cdp.ScriptMs}ms task=${r.cdp.TaskMs}ms recalc=${r.cdp.RecalcMs}ms (n=${r.cdp.RecalcCount}) layout=${r.cdp.LayoutMs}ms`);
  console.log(`  body.style.setProperty calls=${r.bodyStyleWrites} removes=${r.bodyStyleRemoves} installed=${r.hookInstalled} styleLen=${r.styleLen}`);
  console.log(`  apply rows: ${JSON.stringify(r.applyRows)}`);
  console.log(`  top10: ${JSON.stringify(r.top10.slice(0, 6))}`);
  console.log(`  stack sample: ${JSON.stringify(r.stacks[0] || null)}`);
}
await browser.close();
