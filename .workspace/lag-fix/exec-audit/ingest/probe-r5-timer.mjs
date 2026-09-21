#!/usr/bin/env node
/**
 * probe-r5-timer.mjs — U-IG2 前提：判定本 profile 里 `ctx.setInterval` 是否存在、
 * 以及在 microtask 中走 `ctx.effect(...)` 兜底路径会怎样。
 *
 * 只读 + 离线：用**宿主真实的** cordis / cordis-plugin-timer 模块组一个最小组合，
 * 复刻 dsh-usage apply() 的调用形状（bootstrap 在 queueMicrotask 内 await 后再装 timer）。
 * 不触碰产品文件、不重启、不写 ~/.dsh。
 */
import { pathToFileURL } from 'node:url';

const HOST = '/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai';
const cordis = await import(pathToFileURL(`${HOST}/cordis/lib/index.js`).href);
const timerMod = await import(pathToFileURL(`${HOST}/cordis-plugin-timer/lib/index.js`).href);

const out = {};
out.versions = {
  cordis: (await import(pathToFileURL(`${HOST}/cordis/package.json`).href, { with: { type: 'json' } })).default.version,
  timer: (await import(pathToFileURL(`${HOST}/cordis-plugin-timer/package.json`).href, { with: { type: 'json' } })).default.version,
};
out.cordisExports = Object.keys(cordis);

const { Context } = cordis;
const app = new Context();
const events = [];

// 1) 挂 timer 服务（等价于 dsh-base bundle 的 `- id: timer` 那一行）
app.plugin(timerMod.default);
await new Promise((r) => setTimeout(r, 50));
out.timerServiceMounted = typeof app.timer === 'object' && app.timer !== null;
out.rootHasSetInterval = typeof app.setInterval;

// 2) 被测插件：完全复刻 dsh-usage 的形状
const NAME = 'probe-usage-like';
const inject = ['connection', 'webServer'];

const probePlugin = {
  name: NAME,
  inject,
  apply(ctx) {
    const rec = { ctxHasSetInterval: typeof ctx.setInterval, ctxHasInterval: typeof ctx.interval, ctxHasEffect: typeof ctx.effect, ctxTimer: typeof ctx.timer };
    let disposed = false;
    let activationGeneration = 0;
    let disposeTimer = null;
    let ingestCalls = 0;

    const runIngest = async () => {
      if (disposed) return;
      ingestCalls += 1;
      // 模拟同步 fold 的宿主线程占用（真实是 2.68s 增量 / 36.1s 冷）
      const t0 = Date.now();
      while (Date.now() - t0 < 60) { /* spin */ }
      rec.ingestCalls = ingestCalls;
    };

    const bootstrapGeneration = ++activationGeneration;
    queueMicrotask(() => {
      void (async () => {
        await Promise.resolve();               // 模拟 await openUsageDb()
        if (disposed || bootstrapGeneration !== activationGeneration) return;
        await runIngest();                     // ← 真实：同步 fold 2.68s / 36.1s
        if (disposed || bootstrapGeneration !== activationGeneration) return;
        try {
          disposeTimer =
            typeof ctx.setInterval === 'function'
              ? ctx.setInterval(runIngest, 300)
              : ctx.effect(() => {
                  const t = setInterval(() => void runIngest(), 300);
                  return () => clearInterval(t);
                }, 'probe: ingest interval');
          rec.timerPath = typeof ctx.setInterval === 'function' ? 'ctx.setInterval' : 'ctx.effect-fallback';
          rec.timerValueType = typeof disposeTimer;
          rec.timerInstalled = true;
        } catch (e) {
          rec.timerPath = 'threw';
          rec.timerError = `${e.constructor?.name}: ${e.message}`;
        }
      })().catch((e) => { rec.bootstrapError = `${e.constructor?.name}: ${e.message}`; });
    });

    ctx.effect(() => () => {
      disposed = true;
      activationGeneration += 1;
      try { disposeTimer?.(); } catch { /* */ }
      rec.disposedOnce = (rec.disposedOnce ?? 0) + 1;
    }, 'probe: lifecycle');

    out.probe = rec;
  },
};

// 3) 先提供 connection / webServer 两个服务（否则 inject 不满足，fiber 不激活）
class FakeService {
  constructor(ctx, name) { ctx.provide(name, this); }
}
app.plugin({
  name: 'fake-services',
  apply(ctx) {
    new FakeService(ctx, 'connection');
    new FakeService(ctx, 'webServer');
  },
});
await new Promise((r) => setTimeout(r, 30));

app.plugin(probePlugin);
await new Promise((r) => setTimeout(r, 1200));

out.afterWait = {
  ...out.probe,
  ingestCallsAfter1200ms: out.probe?.ingestCalls ?? 0,
  intervalFired: (out.probe?.ingestCalls ?? 0) > 1,
};
out.effectsOnRoot = app.getEffects?.().map((m) => ({ label: m?.label, children: m?.children?.length })) ?? 'n/a';

// 4) 对照：在**同步**上下文中走同一兜底路径（证明 ctx.effect 本身没问题）
let syncInstall = null;
app.plugin({
  name: 'sync-fallback-control',
  apply(ctx2) {
    let n = 0;
    try {
      const d = ctx2.effect(() => {
        const t = setInterval(() => { n += 1; }, 200);
        return () => clearInterval(t);
      }, 'control: sync interval');
      syncInstall = { ok: true, type: typeof d, hasThen: typeof d?.then };
    } catch (e) { syncInstall = { ok: false, error: `${e.constructor?.name}: ${e.message}` }; }
    globalThis.__syncN = () => n;
  },
});
await new Promise((r) => setTimeout(r, 700));
out.syncControl = { install: syncInstall, fires: globalThis.__syncN?.() ?? 0 };

// 5) 对照：microtask 中无 await 直接 ctx.effect
let mtInstall = null;
app.plugin({
  name: 'microtask-fallback-control',
  apply(ctx3) {
    let n = 0;
    queueMicrotask(() => {
      try {
        const d = ctx3.effect(() => {
          const t = setInterval(() => { n += 1; }, 200);
          return () => clearInterval(t);
        }, 'control: microtask interval');
        mtInstall = { ok: true, type: typeof d, hasThen: typeof d?.then };
      } catch (e) { mtInstall = { ok: false, error: `${e.constructor?.name}: ${e.message}` }; }
    });
    globalThis.__mtN = () => n;
  },
});
await new Promise((r) => setTimeout(r, 700));
out.microtaskControl = { install: mtInstall, fires: globalThis.__mtN?.() ?? 0 };

console.log(JSON.stringify(out, null, 2));
