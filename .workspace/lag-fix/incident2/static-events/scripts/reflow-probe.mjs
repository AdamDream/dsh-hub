#!/usr/bin/env node
/**
 * reflow-probe.mjs — 第 2 次（本人预算内的最后一次）只读测量：
 *   (a) 点击设置后长帧的 script / style+layout 归因（LoAF）；
 *   (b) forced reflow（写→读相邻）逐条列证；
 *   (c) 打开是否新增 CSS 规则（级联重算范围）。
 *
 * 纪律同 open-probe.mjs：只点设置触发器；不点保存/应用/删除；持锁运行；单实例。
 */
import { chromium } from 'playwright';
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:3080';
const HERE = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/static-events';
const RAW = `${HERE}/raw`;
const LOCK = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock';
const INIT = `${HERE}/scripts/lib-init-counters2.js`;
const AGENT = 'incident2-static-events';
const OUTFILE = process.env.OUTFILE || `${RAW}/reflow-probe-run2.json`;
const WINDOW_MS = Number(process.env.WINDOW_MS || 3000);
const WAIT_LOCK_S = Number(process.env.WAIT_LOCK_S || 900);

mkdirSync(RAW, { recursive: true });
const report = { at: new Date().toISOString(), base: BASE, window_ms: WINDOW_MS, errors: [], lock: {}, runs: [] };
try {
  const ps = execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' });
  report.host = { webProcs: ps.split('\n').filter((l) => l.includes('dsh web')).map((l) => l.trim()) };
} catch (e) { report.host = { err: String(e).slice(0, 150) }; }

function tryAcquire() {
  try { mkdirSync(LOCK); } catch (e) { return false; }
  writeFileSync(`${LOCK}/owner.txt`, `pid=${process.pid}\nts=${new Date().toISOString()}\nowner=${AGENT}\nline=static-events-audit\n`);
  return true;
}
function release() {
  try {
    const owner = readFileSync(`${LOCK}/owner.txt`, 'utf8');
    if (!owner.includes(`owner=${AGENT}`)) { report.lock.releaseRefused = 'not my lock'; return; }
    rmSync(`${LOCK}/owner.txt`, { force: true });
    rmSync(LOCK, { recursive: false, force: true });
    report.lock.released = true;
  } catch (e) { report.lock.releaseError = String(e).slice(0, 200); }
}

const deadline = Date.now() + WAIT_LOCK_S * 1000;
let got = false;
while (Date.now() < deadline) {
  if (tryAcquire()) { got = true; break; }
  report.lock.lastSeen = existsSync(`${LOCK}/owner.txt`) ? readFileSync(`${LOCK}/owner.txt`, 'utf8').replace(/\n/g, ' ') : '(no owner.txt)';
  await new Promise((r) => setTimeout(r, 15000));
}
report.lock.acquired = got;
if (!got) {
  report.verdict = 'LOCK_TIMEOUT';
  writeFileSync(OUTFILE, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ verdict: report.verdict, lock: report.lock }, null, 2));
  process.exit(2);
}

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => report.errors.push('pageerror: ' + String(e).slice(0, 300)));
await page.addInitScript({ path: INIT });
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);

const snap = () => page.evaluate(() => globalThis.__DSH_STRESS2__.snapshot());
const diff = (a, b) => { const o = {}; for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = (b[k] || 0) - (a[k] || 0); if (d) o[k] = d; } return o; };

/* 关闭态对照：同样 3s，不点击 */
const q1 = await snap();
await page.waitForTimeout(WINDOW_MS);
const q2 = await snap();
report.closedControl = { delta: diff(q1.c, q2.c), loaf: q2.loaf.filter((l) => l.start > q1.css.sheets * 0 && true).length, css: q2.css };

const trigger = await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '设置');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, expanded: b.getAttribute('aria-expanded') };
});
report.trigger = trigger;
if (!trigger) { report.verdict = 'NO_TRIGGER'; writeFileSync(OUTFILE, JSON.stringify(report, null, 2)); release(); await browser.close(); process.exit(3); }

/* 清空 LoAF 缓冲基线：记录此刻长度 */
const loBefore = await snap();
const t0 = await page.evaluate(() => globalThis.__DSH_STRESS2__.arm());
await page.mouse.click(trigger.x, trigger.y);
await page.waitForTimeout(WINDOW_MS);
const loAfter = await snap();

/* 只保留本次窗口新增的 LoAF（按 start 时间过滤：>= armAt-2ms） */
const armAbs = await page.evaluate(() => globalThis.__DSH_STRESS2__.armAt * 1);
const newLoaf = loAfter.loaf.filter((l) => l.start >= (armAbs - 5));

report.open = {
  armAt: armAbs,
  delta: diff(loBefore.c, loAfter.c),
  cssBefore: loBefore.css, cssAfter: loAfter.css,
  loaf: newLoaf,
  frameGaps: loAfter.frameGaps,
  reflowEvents: loAfter.reflow,
  armedReads: loAfter.armedReads,
  loafReady: loAfter.loafReady, moReady: loAfter.moReady, readPatchMiss: loAfter.readPatchMiss, stylePatchError: loAfter.stylePatchError,
};
report.dialog = await page.evaluate(() => ({ present: Boolean(document.querySelector('[role="dialog"]')), nodes: document.querySelectorAll('*').length }));

/* 关闭 */
await page.keyboard.press('Escape');
await page.waitForTimeout(800);

writeFileSync(OUTFILE, JSON.stringify(report, null, 2));
await browser.close();
release();

const sum = (arr, k) => Math.round(arr.reduce((a, x) => a + (x[k] || 0), 0) * 10) / 10;
console.log(JSON.stringify({
  out: OUTFILE,
  loafReady: loAfter.loafReady,
  closedControl_loaf_count: report.closedControl.delta['loaf.count'] || 0,
  open_loaf_count: report.open.delta['loaf.count'] || 0,
  open_loaf: newLoaf.map((l) => ({ start: l.start, duration: l.duration, blocking: l.blockingDuration, beforeRender: l.derived.scriptAndTaskBeforeRender, renderPhase: l.derived.renderPhase, firstUIEvent: l.firstUIEventTimestamp, scripts: l.scripts.map((s) => `${s.invocationTarget || s.name || '?'}(${s.invokerType || '?'})=${s.duration}ms fsl=${s.forcedStyleAndLayoutDuration}`) })),
  reflow_count: report.open.delta['reflow.rect'] || 0 + (report.open.delta['reflow.offsetHeight'] || 0) + (report.open.delta['reflow.gcs'] || 0),
  reflow_breakdown: Object.fromEntries(Object.entries(report.open.delta).filter(([k]) => k.startsWith('reflow.'))),
  layoutReads: Object.fromEntries(Object.entries(report.open.delta).filter(([k]) => k.startsWith('layout.read.'))),
  cssBefore: report.open.cssBefore, cssAfter: report.open.cssAfter,
  frameGapsMs: loAfter.frameGaps.map((f) => f.gapMs),
  errors: report.errors, lock: report.lock.released ? 'released' : report.lock,
}, null, 2));
