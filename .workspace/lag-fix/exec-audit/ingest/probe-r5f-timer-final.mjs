#!/usr/bin/env node
/**
 * probe-r5f-timer-final.mjs — U-IG2 判定（终版，cordis 正确生命周期）。
 * 判定项：
 *   T1 本 profile 组合下 `ctx.setInterval` 在 usage 形状的插件 ctx 上是否存在
 *   T2 microtask 中（await 之后）走 `ctx.effect` 兜底路径是否真能装上 interval 并持续触发
 *   T3 「纤维 epoch 变化回收一次性 effect」是否能让一次性 effect 被丢（对照实验）
 *   T4 长同步占用（模拟 36s fold）之后 timer 是否仍然被保留
 * 只读 + 离线。不触碰产品文件、不重启、不写 ~/.dsh。
 */
import { pathToFileURL } from 'node:url';

const HOST = '/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai';
const { Context } = await import(pathToFileURL(`${HOST}/cordis/lib/index.js`).href);
const TimerService = (await import(pathToFileURL(`${HOST}/cordis-plugin-timer/lib/index.js`).href)).default;

const out = { env: { node: process.version } };
const app = new Context();
await app.plugin(TimerService);
out.T0_root = { hasTimer: typeof app.timer === 'object', hasSetInterval: typeof app.setInterval };

// 服务：connection / webServer（等价于 dsh-usage 的 inject 列表）
await app.plugin({ name: 'fake-services', apply(ctx) { ctx.provide('connection', {}); ctx.provide('webServer', {}); } });
out.T0_services = { connection: app.get('connection') !== undefined, webServer: app.get('webServer') !== undefined };

// —— 被测：复刻 dsh-usage 的 bootstrap 形状 ——
const rec = {};
let usageFiber;
const usagePlugin = {
  name: 'usage-like',
  inject: ['connection', 'webServer'],
  apply(ctx) {
    rec.applied = true;
    rec.T1_ctxSetInterval = typeof ctx.setInterval;
    rec.T1_ctxInterval = typeof ctx.interval;
    rec.T1_ctxTimer = typeof ctx.timer;
    rec.T1_ctxEffect = typeof ctx.effect;
    let disposed = false;
    let gen = 0;
    let disposeTimer = null;
    let calls = 0;
    const SPIN_MS = Number(process.env.SPIN_MS ?? 60);
    const runIngest = async () => {
      if (disposed) return;
      calls += 1;
      const t0 = Date.now();
      while (Date.now() - t0 < SPIN_MS) { /* 模拟同步 fold 占用宿主线程 */ }
    };
    const bootstrapGeneration = ++gen;
    queueMicrotask(() => {
      void (async () => {
        await Promise.resolve();
        if (disposed || bootstrapGeneration !== gen) { rec.bailedPre = true; return; }
        await runIngest();                    // ← 真实是 2.68s / 36.1s 同步
        if (disposed || bootstrapGeneration !== gen) { rec.bailedPost = true; return; }
        try {
          rec.T2_path = typeof ctx.setInterval === 'function' ? 'ctx.setInterval' : 'ctx.effect-fallback';
          disposeTimer = typeof ctx.setInterval === 'function'
            ? ctx.setInterval(runIngest, 250)
            : ctx.effect(() => {
                const id = setInterval(() => void runIngest(), 250);
                return () => clearInterval(id);
              }, 'usage-like: ingest interval');
          rec.T2_installed = true;
          rec.T2_valueType = typeof disposeTimer;
          rec.T2_hasThen = typeof disposeTimer?.then;
        } catch (e) {
          rec.T2_threw = `${e?.constructor?.name}: ${e?.message}`;
          rec.T2_stack = String(e?.stack ?? '').split('\n').slice(1, 3).join(' | ');
        }
      })().catch((e) => { rec.bootstrapErr = `${e?.constructor?.name}: ${e?.message}`; });
    });
    ctx.effect(() => () => { disposed = true; gen += 1; try { disposeTimer?.(); } catch { /* */ } }, 'usage-like: lifecycle');
  },
};
usageFiber = app.plugin(usagePlugin);
await usageFiber;
out.usageFiberState = usageFiber.state;

await new Promise((r) => setTimeout(r, 1400));
out.T2_result = { ...rec, callsAfter1400ms: rec.calls ?? 0, intervalFired: (rec.calls ?? 0) > 1 };

// —— T3 对照：同步 ctx.effect 兜底 ——
let syncCalls = 0;
await app.plugin({
  name: 'sync-fallback', inject: ['connection', 'webServer'],
  apply(ctx) {
    try {
      ctx.effect(() => { const id = setInterval(() => { syncCalls += 1; }, 200); return () => clearInterval(id); }, 'sync-fallback');
      out.T3_syncInstall = 'ok';
    } catch (e) { out.T3_syncInstall = `${e?.constructor?.name}: ${e?.message}`; }
  },
});
// —— T3b 对照：microtask 中（无 await）直接 ctx.effect ——
let mtCalls = 0;
await app.plugin({
  name: 'mt-fallback', inject: ['connection', 'webServer'],
  apply(ctx) {
    queueMicrotask(() => {
      try {
        ctx.effect(() => { const id = setInterval(() => { mtCalls += 1; }, 200); return () => clearInterval(id); }, 'mt-fallback');
        out.T3b_microtaskInstall = 'ok';
      } catch (e) { out.T3b_microtaskInstall = `${e?.constructor?.name}: ${e?.message}`; }
    });
  },
});
await new Promise((r) => setTimeout(r, 900));
out.T3_result = { syncCalls, mtCalls, syncFired: syncCalls > 1, mtFired: mtCalls > 1 };

// —— T4：在 microtask 中 runIngest 长时间同步占用（模拟 36s 冷摄入）之后装 timer ——
const rec2 = {};
await app.plugin({
  name: 'usage-like-longspin', inject: ['connection', 'webServer'],
  apply(ctx) {
    let disposed = false; let gen = 0; let calls = 0;
    const g = ++gen;
    queueMicrotask(() => {
      void (async () => {
        await Promise.resolve();
        const t0 = Date.now();
        while (Date.now() - t0 < 4000) { /* 4s 长同步占用，模拟冷 fold */ }
        calls += 1;
        if (disposed || g !== gen) { rec2.bailed = true; return; }
        try {
          rec2.value = typeof ctx.setInterval;
          rec2.path = typeof ctx.setInterval === 'function' ? 'ctx.setInterval' : 'ctx.effect-fallback';
          const d = typeof ctx.setInterval === 'function'
            ? ctx.setInterval(() => { calls += 1; }, 250)
            : ctx.effect(() => { const id = setInterval(() => { calls += 1; }, 250); return () => clearInterval(id); }, 'longspin');
          rec2.installed = true; rec2.hasThen = typeof d?.then;
        } catch (e) { rec2.threw = `${e?.constructor?.name}: ${e?.message}`; }
      })();
    });
    ctx.effect(() => () => { disposed = true; gen += 1; }, 'longspin-lifecycle');
    globalThis.__longCalls = () => calls;
  },
});
await new Promise((r) => setTimeout(r, 5500));
out.T4_longSpin = { ...rec2, callsAfter: globalThis.__longCalls?.() ?? 0, fired: (globalThis.__longCalls?.() ?? 0) > 1 };

console.log(JSON.stringify(out, null, 2));
