#!/usr/bin/env node
/**
 * probe-r5b-timer.mjs — U-IG2 前提判定（第二版，用 cordis 规范化插件形状）。
 * 判定：本 profile 组合下 `ctx.setInterval` 是否存在；microtask 里的 `ctx.effect`
 *       兜底路径是否真的能装上 interval、是否会被回收。
 * 只读 + 离线；不触碰产品文件、不重启、不写 ~/.dsh。
 */
import { pathToFileURL } from 'node:url';

const HOST = '/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai';
const { Context, Service } = await import(pathToFileURL(`${HOST}/cordis/lib/index.js`).href);
const TimerService = (await import(pathToFileURL(`${HOST}/cordis-plugin-timer/lib/index.js`).href)).default;

const out = { env: { node: process.version } };
const app = new Context();
app.plugin(TimerService);
await new Promise((r) => setTimeout(r, 40));
out.root = { hasTimer: typeof app.timer === 'object', hasSetInterval: typeof app.setInterval, hasInterval: typeof app.interval, hasEffect: typeof app.effect };

// 两个假服务，满足 usage 的 inject
class Fake extends Service {
  constructor(ctx, name) { super(ctx, name); }
}
app.plugin(class { static name = 'fake-connection'; apply(ctx) { new Fake(ctx, 'connection'); new Fake(ctx, 'webServer'); } });
await new Promise((r) => setTimeout(r, 40));
out.fakesReady = { connection: app.get('connection') !== undefined, webServer: app.get('webServer') !== undefined };

const results = {};

// 被测：复刻 dsh-usage 的 bootstrap 形状（microtask → await → ingest → 装 timer）
class UsageLike {
  static name = 'usage-like';
  static inject = ['connection', 'webServer'];
  apply(ctx) {
    const rec = { applied: true, ctxSetInterval: typeof ctx.setInterval, ctxInterval: typeof ctx.interval, ctxEffect: typeof ctx.effect, ctxTimer: typeof ctx.timer };
    let disposed = false;
    let gen = 0;
    let disposeTimer = null;
    let calls = 0;
    const runIngest = async () => {
      if (disposed) return;
      calls += 1;
      const t0 = Date.now();
      while (Date.now() - t0 < 50) { /* spin: 模拟同步 fold 占用宿主线程 */ }
    };
    const bootstrapGeneration = ++gen;
    queueMicrotask(() => {
      void (async () => {
        await Promise.resolve();            // 模拟 await openUsageDb()
        await Promise.resolve();
        if (disposed || bootstrapGeneration !== gen) { rec.bailedBeforeIngest = true; return; }
        await runIngest();
        if (disposed || bootstrapGeneration !== gen) { rec.bailedAfterIngest = true; return; }
        try {
          rec.timerPath = typeof ctx.setInterval === 'function' ? 'ctx.setInterval' : 'ctx.effect-fallback';
          disposeTimer = typeof ctx.setInterval === 'function'
            ? ctx.setInterval(runIngest, 250)
            : ctx.effect(() => { const t = setInterval(() => void runIngest(), 250); return () => clearInterval(t); }, 'usage-like: ingest interval');
          rec.timerValueType = typeof disposeTimer;
          rec.timerHasThen = typeof disposeTimer?.then;
          rec.timerInstalled = true;
          rec.effectsAfterInstall = ctx.fiber.getEffects?.().map((m) => m?.label) ?? 'n/a';
        } catch (e) {
          rec.timerPath = 'threw';
          rec.timerError = `${e?.constructor?.name}: ${e?.message}`;
        }
        results.usageLike = rec;
      })().catch((e) => { results.usageLike = { ...rec, bootstrapError: `${e?.constructor?.name}: ${e?.message}` }; });
    });
    ctx.effect(() => () => { disposed = true; gen += 1; try { disposeTimer?.(); } catch { /* */ } }, 'usage-like: lifecycle');
    results.usageLike = rec;
  }
}
app.plugin(UsageLike);
await new Promise((r) => setTimeout(r, 1500));
out.usageLikeFinal = { ...results.usageLike, callsAfter1500ms: results.usageLike?.calls ?? 'n/a' };

// 对照 1：microtask 中（无 await）直接 ctx.effect 兜底
let mt = { fires: 0 };
app.plugin(class {
  static name = 'microtask-control';
  static inject = ['connection', 'webServer'];
  apply(ctx) {
    queueMicrotask(() => {
      try {
        ctx.effect(() => { const t = setInterval(() => { mt.fires += 1; }, 200); return () => clearInterval(t); }, 'microtask-control');
        mt.install = 'ok';
      } catch (e) { mt.install = `${e?.constructor?.name}: ${e?.message}`; }
    });
  }
});
// 对照 2：同步直接 ctx.effect
let sync = { fires: 0 };
app.plugin(class {
  static name = 'sync-control';
  static inject = ['connection', 'webServer'];
  apply(ctx) {
    try {
      ctx.effect(() => { const t = setInterval(() => { sync.fires += 1; }, 200); return () => clearInterval(t); }, 'sync-control');
      sync.install = 'ok';
    } catch (e) { sync.install = `${e?.constructor?.name}: ${e?.message}`; }
  }
});
// 对照 3：显式注入 timer 后 ctx.setInterval 是否可用
let inj = {};
app.plugin(class {
  static name = 'timer-injected';
  static inject = ['timer'];
  apply(ctx) { inj.hasSetInterval = typeof ctx.setInterval; inj.hasInterval = typeof ctx.interval; inj.timerName = ctx.timer?.name; }
});
// 对照 4：**不**声明 timer 注入时，ctx.setInterval 是否仍然存在（mixin 是否全局生效）
let noinj = {};
app.plugin(class {
  static name = 'timer-not-injected';
  static inject = ['connection', 'webServer'];
  apply(ctx) { noinj.hasSetInterval = typeof ctx.setInterval; noinj.hasInterval = typeof ctx.interval; }
});
await new Promise((r) => setTimeout(r, 1200));
out.controls = {
  microtaskEffect: mt,
  syncEffect: sync,
  timerInjectedCtx: inj,
  timerNotInjectedCtx: noinj,
};
console.log(JSON.stringify(out, null, 2));
