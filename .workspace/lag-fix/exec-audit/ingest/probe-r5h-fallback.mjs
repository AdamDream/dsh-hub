import { pathToFileURL } from 'node:url';
const HOST='/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai';
const { Context } = await import(pathToFileURL(`${HOST}/cordis/lib/index.js`).href);
const TimerService = (await import(pathToFileURL(`${HOST}/cordis-plugin-timer/lib/index.js`).href)).default;
const app = new Context();
await app.plugin(TimerService);
await app.plugin({ name:'svcs', apply(ctx){ ctx.provide('connection',{}); ctx.provide('webServer',{}); } });
const out = {};
// 复刻 deployed 的**真实表达式**行为，但不让异常逃出（用 try/catch 复刻 bootstrap 的 catch）
await app.plugin({
  name: 'usage-shape', inject: ['connection','webServer'],
  apply(ctx) {
    let calls = 0;
    const runIngest = async () => { calls += 1; };
    queueMicrotask(() => {
      void (async () => {
        await Promise.resolve();
        await runIngest();
        try {
          out.expressionThrew = null;
          // 完全照抄 deployed index.js:210-215 的形状
          const d = typeof ctx.setInterval === "function"
            ? ctx.setInterval(runIngest, 150)
            : ctx.effect(() => { const t = setInterval(() => void runIngest(), 150); return () => clearInterval(t); }, 'x');
          out.expressionThrew = 'NO';
          out.installed = typeof d;
        } catch (e) {
          out.expressionThrew = `${e.constructor.name}: ${e.message}`;
        }
      })().catch((e) => { out.bootstrapCatch = `${e.constructor.name}: ${e.message}`; });
    });
    ctx.effect(() => () => {}, 'lifecycle');
    globalThis.__calls = () => calls;
  },
});
await new Promise(r=>setTimeout(r,600));
out.calls = globalThis.__calls?.() ?? 0;
console.log(JSON.stringify(out,null,2));
