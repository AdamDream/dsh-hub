// 用量卡片「可见性门控」的行为验证（A 线要求：保留轮询或加可见性门控）
// 背景：审计只确认了补丁标记存在，**门控行为本身从未被测过**。
// 实现依据（@local/dsh-usage/lib/client.js）：
//   - 卡片根节点 className="du_root"，ref=attachCardRef，交接给 IntersectionObserver({threshold:0})（无 root → 视口）
//   - 轮询 effect：if (!pollVisible || document.hidden) return;  → 出视口即不建定时器
//   - 首屏加载与手动刷新**不受门控**（只有定时器被门控）
//
// 用法: node probes/verify-usage-gating.mjs [--phase-sec 75] [--out reports/usage-gating.json]
// 判定: 可见相应至少有 1 次自动轮询（间隔≈refreshSec=60s）；出视口相应 **0 次**轮询。
//       不满足即 exit 1（并打印原始请求时间线）。
import { chromium } from 'playwright';
import fs from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const PHASE = Number(arg('--phase-sec', '75'));
const OUT = arg('--out', 'reports/usage-gating.json');
const URL = 'http://127.0.0.1:3080';

const b = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const reqs = [];
page.on('request', (r) => {
  const u = r.url();
  if (!u.includes('/usage/')) return;
  let payload = null;
  try { payload = JSON.parse(r.postData() || 'null'); } catch { }
  reqs.push({ t: Date.now(), url: u.replace(URL, ''), payload });
});
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(7000);

// 挂载卡片：设置 → 插件标签
await page.locator('button:has-text("设置")').first().click().catch(() => { });
await page.waitForTimeout(2500);
await page.locator('[role="dialog"] button:has-text("插件"), [role="dialog"] [role="tab"]:has-text("插件")').first().click().catch(() => { });
await page.waitForTimeout(6000);
const mounted = await page.evaluate(() => Boolean(document.querySelector('.du_root')));
const rect = await page.evaluate(() => {
  const el = document.querySelector('.du_root');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), inView: r.bottom > 0 && r.top < innerHeight };
});
if (!mounted) { console.log(JSON.stringify({ mounted: false, note: '未能挂载用量卡片（选择器变化？）' }, null, 1)); await b.close(); process.exit(2); }

// ── 相 A：可见，观察自动轮询 ────────────────────────────────────────────────
const A0 = Date.now();
await page.waitForTimeout(PHASE * 1000);
const A1 = Date.now();
const phaseA = reqs.filter((r) => r.t >= A0 && r.t <= A1);

// ── 相 B：把卡片滚出视口，观察是否停止轮询 ──────────────────────────────────
// 让卡片**几何上完全离开视口**：压扁视口 + 把滚动容器滚到**顶部**
// （卡片自身高约 1082px，滚到底仍会露出一截 → 相交判定仍为 true，那是测试设置错误而非门控缺陷）
await page.setViewportSize({ width: 1440, height: 200 });
await page.evaluate(() => {
  const el = document.querySelector('.du_root');
  let sc = el?.parentElement;
  while (sc && sc.scrollHeight <= sc.clientHeight) sc = sc.parentElement;
  if (sc) sc.scrollTop = 0; else window.scrollTo(0, 0);
});
await page.waitForTimeout(1500);
const rectAfter = await page.evaluate(() => {
  const el = document.querySelector('.du_root');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), inView: r.bottom > 0 && r.top < innerHeight };
});
// 先自证测试前提：卡片必须**完全**在视口之外（top >= innerHeight 或 bottom <= 0）
const setupOk = await page.evaluate(() => {
  const el = document.querySelector('.du_root');
  if (!el) return { ok: false, why: 'no .du_root' };
  const r = el.getBoundingClientRect();
  const fullyOut = r.top >= innerHeight || r.bottom <= 0;
  return { ok: fullyOut, rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), innerHeight }, why: fullyOut ? '' : '卡片仍有部分在视口内' };
});
console.log(`前提自证（卡片完全出视口）：${setupOk.ok ? 'OK' : '未成立 —— ' + setupOk.why} rect=${JSON.stringify(setupOk.rect)}`);
const B0 = Date.now();
await page.waitForTimeout(PHASE * 1000);
const B1 = Date.now();
const phaseB = reqs.filter((r) => r.t >= B0 && r.t <= B1);

// ── 窗口日对齐与请求口径（A 线的客户端半）──────────────────────────────────
const dayAligned = (p) => {
  const v = p?.payload ?? p?.result ?? p;
  const from = v?.payload?.from ?? v?.from, to = v?.payload?.to ?? v?.to;
  if (typeof from !== 'number' || typeof to !== 'number') return null;
  const d = new Date(from);
  return { from, to, fromIsMidnight: d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0, to };
};
const sample = [...phaseA, ...phaseB].map((r) => ({ url: r.url, day: dayAligned(r), year: (r.payload?.payload ?? r.payload)?.year ?? null }));

const intervals = [];
for (let i = 1; i < phaseA.length; i++) intervals.push(Math.round((phaseA[i].t - phaseA[i - 1].t) / 1000));

const verdict = {
  card_visible_rect: rect, card_after_rect: rectAfter,
  phase_a_seconds: Math.round((A1 - A0) / 1000), phase_a_requests: phaseA.length,
  phase_a_interval_seconds: intervals,
  phase_b_seconds: Math.round((B1 - B0) / 1000), phase_b_requests: phaseB.length,
  setup_precondition_ok: setupOk.ok,
  gating_works: setupOk.ok && phaseB.length === 0 && phaseA.length >= 1,
  inconclusive: !setupOk.ok,
  requests_timeline: reqs.map((r) => ({ sec: Math.round((r.t - A0) / 1000), url: r.url })),
  sample_payloads: sample.slice(0, 6),
  console_errors: errs.slice(0, 5),
};
fs.writeFileSync(OUT, JSON.stringify(verdict, null, 1));

console.log(`卡片挂载：${mounted}｜可见时 rect=${JSON.stringify(rect)}`);
console.log(`相A（可见 ${verdict.phase_a_seconds}s）：请求 ${phaseA.length} 次${intervals.length ? `，间隔 ${intervals.join('/')}s` : ''}`);
console.log(`滚出视口后 rect=${JSON.stringify(rectAfter)}`);
console.log(`相B（出视口 ${verdict.phase_b_seconds}s）：请求 ${phaseB.length} 次`);
console.log(`请求时间线（秒，相对相A起点）：${verdict.requests_timeline.map((x) => `${x.sec}s:${x.url.replace('/usage/', '')}`).join('  ')}`);
const da = sample.find((s) => s.day);
if (da) console.log(`窗口样本：from 是否日对齐=${da.day.fromIsMidnight}（from=${new Date(da.day.from).toISOString()}）`);
if (errs.length) console.log(`console 错误：${errs.slice(0, 3).join(' | ')}`);
console.log(`\n判定：${verdict.inconclusive ? 'INCONCLUSIVE —— 测试前提未成立（卡片未完全出视口），门控未被真正考验' : (verdict.gating_works ? 'PASS —— 可见时按 60s 轮询、出视口后完全停止' : 'FAIL —— 门控行为不符（见上）')}`);
await b.close();
process.exit(verdict.gating_works ? 0 : (verdict.inconclusive ? 2 : 1));
