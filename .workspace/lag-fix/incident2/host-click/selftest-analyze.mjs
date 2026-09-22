#!/usr/bin/env node
/**
 * selftest-analyze.mjs — 用**已知答案的合成 run** 校验 analyze.mjs 的窗口/配对/对齐/归因数学。
 *
 * 动机：如果 analyze.mjs 的解析或窗口边界有 bug，结论会**静默**错（最坏是把"没采到"读成"零停顿"）。
 * 这里构造一个每个数字都预先算好的合成 record，跑真 analyzer，断言其输出等于期望值。
 *
 * 用法：node selftest-analyze.mjs
 */
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const DIR = new URL('.', import.meta.url).pathname;
const RAW = DIR + 'raw-selftest';
const OUT = DIR + 'analysis-selftest.json';
if (existsSync(RAW)) rmSync(RAW, { recursive: true });
mkdirSync(RAW, { recursive: true });

const A = 1_000_000; // 合成锚点
const beatAt = (t, ms, ep) => ({ seq: Math.round(t), endpoint: ep, method: ep.includes('usage') ? 'status' : 'host.describe', t0: t, t1: t + ms, ms, schedSkew: t - Math.round(t), http: 200, respBytes: 300, ok: true, phase: t < A ? 'pre' : 'post' });

// 构造：pre 各 5ms；锚点后 +150ms 处注入一个 500ms 尖峰；其余 5ms
const beats = [];
for (let t = A - 3000; t < A + 3000; t += 50) {
  const ms = Math.abs(t - (A + 150)) < 25 ? 500 : 5;
  beats.push(beatAt(t, ms, t % 100 === 0 ? '/api/host.describe' : '/usage/status'));
}
const pageRec = [
  { dir: 'fetch-out', t: A + 10, url: '/api/settings.describe', method: 'POST', bytes: 120, body: '{"method":"settings.describe"}', rpcId: 'r1' },
  { dir: 'fetch-in', t: A + 90, url: '/api/settings.describe', status: 200, bytes: 4000, rpcId: 'r1' },
  { dir: 'fetch-out', t: A + 900, url: '/api/session.list', method: 'POST', bytes: 80, body: '{"method":"session.list"}', rpcId: 'r2' },
  { dir: 'fetch-in', t: A + 940, url: '/api/session.list', status: 200, bytes: 9000, rpcId: 'r2' },
];
const run = {
  kind: 'host-click-run', run: 'selftest', base: 'http://127.0.0.1:3080', mode: 'run', selector: 'x', intervalMs: 50, preMs: 3000, postMs: 3000,
  anchor: { clickAnchor: A, source: 'pointerdown-captured(页内捕获)', uncertaintyMs: 0, nodeBracket: { tSend: A - 2, tDone: A + 20, widthMs: 22 } },
  clock: { nodeTimeOrigin: 0, pageTimeOrigin: 0, deltaTimeOriginMs: 0, skewBoundMs: 1.5 },
  marks: {}, pageMarks: [],
  summary: { pre: {}, plusMinus500: {}, post: {}, all: {} },
  beats,
  page: {
    rpcTimeline: pageRec, longtasks: [{ t: A + 200, dur: 120 }, { t: A + 2500, dur: 30 }],
    framesSummary: { n: 100, p50: 16, p95: 33, max: 90, over50: 2 },
    vis: { visibleAt: A + 400, firstContentAt: A + 380, maxGap: 22, lastPoll: A + 5900 },
  },
  nodeSide: { requests: [], responses: [], consoleErrors: [] }, clickError: null,
};
writeFileSync(`${RAW}/click-runSELFTEST.json`, JSON.stringify(run, null, 2) + '\n');

// analyzer 读 raw/，所以给一个临时工作目录：复制 analyzer 期望的目录结构
const WORK = DIR + 'selftest-work';
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK + '/raw', { recursive: true });
writeFileSync(`${WORK}/raw/click-runSELFTEST.json`, JSON.stringify(run, null, 2) + '\n');
// analyzer 以自身所在目录为基准找 raw/ ⇒ 每次运行都从**当前** analyze.mjs 重新复制，
// 否则会对着上一次的陈旧副本判定（本档自证脚本第一版就踩了这个坑：改了源码却验证的是旧副本）。
writeFileSync(`${WORK}/analyze.mjs`, readFileSync(`${DIR}analyze.mjs`, 'utf8'));
writeFileSync(`${WORK}/raw/click-runSELFTEST.json`, JSON.stringify(run, null, 2) + '\n');

let analysis;
try {
  execFileSync(process.execPath, [`${WORK}/analyze.mjs`], { stdio: 'pipe' });
} catch (e) {
  console.log('--- analyzer stdout ---'); console.log(String(e.stdout || ''));
  console.log('--- analyzer stderr ---'); console.log(String(e.stderr || ''));
  console.log('--- analyzer exit ---', e.status);
}
const anaPath = `${WORK}/analysis.json`;
if (!existsSync(anaPath)) { console.log('FAIL: analyzer 未产出 analysis.json'); process.exit(2); }
analysis = JSON.parse(readFileSync(anaPath, 'utf8'));

const p = analysis.perRun[0];
const q = (arr, x) => arr.filter((v) => v === x).length;
const near = (a, b, tol = 0.001) => Math.abs(a - b) <= tol;
const checks = {
  '窗口：±500ms 内应正好 21 拍（-500..+500 步长 50）': p.windows.plusMinus500.n === 21,
  '窗口：±500ms max 应 = 500（尖峰落在 +150）': near(p.windows.plusMinus500.max, 500),
  '窗口：±500ms 尖峰计数应 = 1': p.windows.plusMinus500.stalls100 === 1,
  '窗口：pre 窗 max 应为 5（尖峰不在 pre）': near(p.windows.pre.max, 5),
  '窗口：post 窗 max 应为 500': near(p.windows.post.max, 500),
  'RPC 配对：settings.describe 的 respMs 应 = 80': p.rpcInWindow.find((x) => x.method === 'settings.describe')?.respMs === 80,
  'RPC 归因：settings.describe → click-direct': /click-direct/.test(p.rpcInWindow.find((x) => x.method === 'settings.describe')?.attribution || ''),
  'RPC 归因：session.list → incidental': /incidental/.test(p.rpcInWindow.find((x) => x.method === 'session.list')?.attribution || ''),
  '对齐：点击→面板可见 应 = 400ms': near(p.align.msClickToPanelVisible, 400),
  '对齐：点击→内容 应 = 380ms': near(p.align.msClickToContent, 380),
  '对齐：尖峰落在点击窗内 → true': p.align.verdictHostStallInsideClickWindow === true,
  '尖峰记录：dtFromClickMs≈+150 且 inPlusMinus500=true': (() => { const s = p.stalls[0]; return s && Math.abs(s.dtFromClickMs - 150) <= 25 && s.inPlusMinus500; })(),
  '长任务：1s 窗内应采到 1 条（另一条在 +2500 仍在 3s 帧内 ⇒ 2 条）': p.longtasksNearClick.length === 2,
  '重复性：nRuns=1 ⇒ repeatability 判 INCONCLUSIVE': /INCONCLUSIVE/.test(analysis.verdict.T4_repeatability),
};
console.log('=== analyze.mjs 自证（合成 run，答案已知） ===');
let ok = true;
for (const [k, v] of Object.entries(checks)) { console.log(`  ${v ? 'PASS' : 'FAIL'}  ${k}`); if (!v) ok = false; }
if (!ok) {
  console.log('\n--- 实际 perRun 关键值 ---');
  console.log(JSON.stringify({ windows: p.windows, rpc: p.rpcInWindow, align: p.align, lt: p.longtasksNearClick.length, verdict: analysis.verdict }, null, 1).slice(0, 2500));
}
console.log(`\n[selftest-analyze] ${ok ? 'ALL PASS' : 'FAIL'}`);
rmSync(RAW, { recursive: true, force: true });
rmSync(OUT, { force: true });
process.exit(ok ? 0 : 2);
