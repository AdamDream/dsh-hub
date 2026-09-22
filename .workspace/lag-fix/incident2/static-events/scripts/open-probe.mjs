#!/usr/bin/env node
/**
 * open-probe.mjs — 只读计数验证：「点击设置」后 2s 窗口内的成本源普查。
 *
 * 纪律：
 *  - 只读：只点击设置触发器（打开面板），不点保存/应用/删除/模型切换/tab；
 *  - 不改产品文件、不重启宿主、不 pkill；
 *  - 跨线独占锁 research-v2/.probe.lock：抢不到就等待，绝不强占；
 *  - 单浏览器实例，结束 browser.close()。
 *
 * 器械：scripts/lib-init-counters.js（document-start 注入，见该文件头注释）。
 */
import { chromium } from 'playwright';
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:3080';
const HERE = '/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/static-events';
const RAW = `${HERE}/raw`;
const LOCK = '/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock';
const INIT = `${HERE}/scripts/lib-init-counters.js`;
const AGENT = 'incident2-static-events';
const OUTFILE = process.env.OUTFILE || `${RAW}/open-probe-run1.json`;
const WINDOW_MS = Number(process.env.WINDOW_MS || 2000);
const WAIT_LOCK_S = Number(process.env.WAIT_LOCK_S || 300);

mkdirSync(RAW, { recursive: true });
const report = {
  at: new Date().toISOString(),
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  base: BASE,
  window_ms: WINDOW_MS,
  errors: [],
  lock: {},
  host: {},
  runs: [],
};

/* ---------- 宿主只读普查 ---------- */
try {
  const ps = execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' });
  report.host.webProcs = ps.split('\n').filter((l) => l.includes('dsh web')).map((l) => l.trim());
} catch (e) { report.host.psError = String(e).slice(0, 200); }
report.host.pid10806 = existsSync('/proc/10806') ? 'present' : 'absent';

/* ---------- 跨线独占锁 ---------- */
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
  const cur = existsSync(`${LOCK}/owner.txt`) ? readFileSync(`${LOCK}/owner.txt`, 'utf8').replace(/\n/g, ' ') : '(no owner.txt)';
  report.lock.lastSeen = cur;
  await new Promise((r) => setTimeout(r, 15000));
}
report.lock.acquired = got;
if (!got) {
  report.verdict = 'LOCK_TIMEOUT — 未取得独占锁，按纪律不进行浏览器测量';
  writeFileSync(OUTFILE, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ verdict: report.verdict, lock: report.lock }, null, 2));
  process.exit(2);
}
report.lock.owner = readFileSync(`${LOCK}/owner.txt`, 'utf8');

/* ---------- 浏览器 ---------- */
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => report.errors.push('pageerror: ' + String(e).slice(0, 300)));
await page.addInitScript({ path: INIT });
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(12000);   // 等 boot 与首批 RPC 落定

/* ---------- 自证：打桩真的在动 ---------- */
const selfTest = await page.evaluate(() => globalThis.__DSH_STRESS__.selfTest());
report.selfTest = selfTest;

const snap = () => page.evaluate(() => globalThis.__DSH_STRESS__.snapshot());
const diff = (a, b) => {
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const d = (b[k] || 0) - (a[k] || 0);
    if (d !== 0) out[k] = d;
  }
  return out;
};

/* ---------- 稳定态基线（2s，不点击） ---------- */
const quietBefore = await snap();
await page.waitForTimeout(WINDOW_MS);
const quietAfter = await snap();
report.quietWindow = { label: '面板关闭 · 2s 基线', delta: diff(quietBefore.c, quietAfter.c), frames: (quietAfter.c['raf.callback'] || 0) - (quietBefore.c['raf.callback'] || 0) };

/* ---------- 定位触发器（只读） ---------- */
const trigger = await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '设置');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, cls: String(b.className), expanded: b.getAttribute('aria-expanded'), dialogs: document.querySelectorAll('[role="dialog"]').length };
});
report.trigger = trigger;
if (!trigger) { report.verdict = 'NO_TRIGGER'; writeFileSync(OUTFILE, JSON.stringify(report, null, 2)); release(); await browser.close(); process.exit(3); }

/* ---------- 点击 → 2s 窗口 ---------- */
const before = await snap();
const t0 = await page.evaluate(() => globalThis.__DSH_STRESS__.arm());
await page.mouse.click(trigger.x, trigger.y);
await page.waitForTimeout(WINDOW_MS);
const after = await snap();

const dialog = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  const trg = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '设置');
  return {
    dialogPresent: Boolean(d),
    dialogSections: d ? Array.from(d.querySelectorAll('button')).map((b) => (b.textContent || '').trim()).slice(0, 20) : [],
    activeSectionTitle: d ? (d.querySelector('[id]') ? (d.querySelector('[id]').textContent || '').trim().slice(0, 40) : null) : null,
    triggerExpanded: trg ? trg.getAttribute('aria-expanded') : null,
    domNodes: document.querySelectorAll('*').length,
    styleTags: document.querySelectorAll('style').length,
    optionsTextLen: d ? (d.querySelector('[class*="options"]') ? (d.querySelector('[class*="options"]').textContent || '').length : null) : null,
  };
});

const openDelta = diff(before.c, after.c);
report.openWindow = {
  label: `点击设置 → ${WINDOW_MS}ms 窗口`,
  armAt: t0,
  delta: openDelta,
  roster: after.roster,
  console: after.console,
  longtasks: after.longtasks,
  reflowEvents: after.ev.filter((e) => e.k === 'reflow').slice(0, 400),
  observeEvents: after.ev.filter((e) => e.k === 'observe').slice(0, 60),
  styleCreateEvents: after.ev.filter((e) => e.k === 'styleCreate').slice(0, 60),
  samples: after.samples.slice(-25),
  meta: after.meta,
  dialog,
  frameCount: openDelta['raf.callback'] || 0,
  quietFrameCount: report.quietWindow.frames,
};

/* ---------- 收尾：恢复关闭态（只按 Escape，等价于点遮罩关闭，不触碰任何保存路径） ---------- */
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
report.closeState = await page.evaluate(() => ({
  dialogCount: document.querySelectorAll('[role="dialog"]').length,
  triggerExpanded: (Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === '设置') || {}).getAttribute?.('aria-expanded') ?? null,
  domNodes: document.querySelectorAll('*').length,
}));

writeFileSync(OUTFILE, JSON.stringify(report, null, 2));
await browser.close();
release();

const pick = (d, keys) => Object.fromEntries(keys.filter((k) => k in d).map((k) => [k, d[k]]));
console.log(JSON.stringify({
  out: OUTFILE,
  selfTest_keys: selfTest ? selfTest.deltaKeys : null,
  quiet: report.quietWindow,
  open: pick(report.openWindow.delta, [
    'raf.callback', 'raf.selfChain', 'raf.request', 'longtask', 'mut.total', 'mut.childList', 'mut.attributes',
    'mut.addedNodes', 'styleCreate.style', 'style.append.style', 'style.set.height', 'style.setProperty', 'styleWrite.armed',
    'layout.read.rect', 'layout.read.offsetHeight', 'layout.read.clientHeight', 'layout.read.scrollHeight', 'layout.read.gcs',
    'layout.readAfterWrite.rect', 'layout.readAfterWrite.offsetHeight', 'layout.readAfterWrite.gcs', 'layout.readAfterWrite.clientHeight',
    'listener.add', 'timer.setTimeout', 'timer.setInterval', 'observer.mutation', 'observer.resize', 'observer.intersection',
    'ws.message', 'fetch.call', 'console.error', 'console.warn',
  ]),
  dialog: report.openWindow.dialog,
  listeners: report.openWindow.roster.listeners.length,
  timers: report.openWindow.roster.timers.length,
  observers: report.openWindow.roster.observers.length,
  intervals: report.openWindow.roster.intervals.length,
  longtasks: report.openWindow.longtasks,
  consoleMsgs: report.openWindow.console.slice(0, 8),
  errors: report.errors,
}, null, 2));
