#!/usr/bin/env node
/**
 * probe-r5i-fix-shape.mjs — 验证 §1.5 的**修法形状**（ctx.inject(['timer'], …) 内安装 interval）
 * 真的可用，并且能扛住长同步占用（模拟冷 fold）之后仍然存活。
 * 只读 + 离线。
 */
import { pathToFileURL } from 'node:url';
const HOST='/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai';
const { Context } = await import(pathToFileURL(`${HOST}/cordis/lib/index.js`).href);
const TimerService = (await import(pathToFileURL(`${HOST}/cordis-plugin-timer/lib/index.js`).href)).default;
const app = new Context();
await app.plugin(TimerService);
await app.plugin({ name:'svcs', apply(ctx){ ctx.provide('connection',{}); ctx.provide('webServer',{}); } });

const out = {};
let calls = 0;
await app.plugin({
  name:'usage-fixed-shape', inject:['connection','webServer'],
  apply(ctx) {
    let disposed = false; let gen = 0; let disposeTimer = null;
    const SPIN = Number(process.env.SPIN_MS ?? 3000);
    const runIngest = async () => { if (disposed) return; calls += 1; };
    const g = ++gen;
    queueMicrotask(() => { void (async () => {
      await Promise.resolve();
      // 模拟冷 fold 的长同步占用（期间事件循环被占满）
      const t0 = Date.now(); while (Date.now() - t0 < SPIN) { /* spin */ }
      if (disposed || g !== gen) { out.bailed = true; return; }
      // ← 这就是 §1.5 的修法形状：把安装动作放进注入回调
      ctx.inject(['timer'], (timerCtx) => {
        if (disposed || g !== gen) { out.bailedInInject = true; return; }
        out.path = 'ctx.inject([timer])';
        out.hasSetIntervalInInject = typeof timerCtx.setInterval;
        disposeTimer = timerCtx.setInterval(runIngest, 250);
        out.installed = true;
        out.valueType = typeof disposeTimer;
        out.hasThen = typeof disposeTimer?.then;
        ctx.effect(() => () => { try { disposeTimer?.(); } catch {} }, 'usage-fixed: ingest interval');
      });
      out.afterInjectSync = 'no-throw';
    })().catch(e => { out.bootstrapErr = `${e?.constructor?.name}: ${e?.message}`; }); });
    ctx.effect(() => () => { disposed = true; gen += 1; try { disposeTimer?.(); } catch {} }, 'usage-fixed: lifecycle');
  },
});
await new Promise(r=>setTimeout(r, 2500));
out.callsAfterSpinPlus2500ms = calls;
out.intervalFired = calls > 1;
console.log(JSON.stringify(out, null, 2));
