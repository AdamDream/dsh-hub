import { pathToFileURL } from 'node:url';
const HOST='/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai';
const { Context } = await import(pathToFileURL(`${HOST}/cordis/lib/index.js`).href);
const TimerService = (await import(pathToFileURL(`${HOST}/cordis-plugin-timer/lib/index.js`).href)).default;
const app = new Context();
await app.plugin(TimerService);
await app.plugin({ name:'svcs', apply(ctx){ ctx.provide('connection',{}); ctx.provide('webServer',{}); } });
const log=[];
const probe = (label, inject) => ({
  name: label, inject,
  apply(ctx){
    const r = { label, inject: inject ?? [] };
    for (const p of ['timer','setInterval','interval','setTimeout','timeout','throttle','debounce']) {
      try { r[p] = typeof ctx[p]; } catch (e) { r[p] = 'THROW: ' + e.message; }
    }
    log.push(r);
  }
});
// 1) dsh-usage 现状：inject = ['connection','webServer']，未声明 timer
await app.plugin(probe('usage-as-deployed', ['connection','webServer']));
// 2) 若把 timer 加进 inject
await app.plugin(probe('with-timer-injected', ['connection','webServer','timer']));
// 3) 对照：根 ctx（非插件 fiber）
const root = {};
for (const p of ['timer','setInterval','interval']) { try { root[p]=typeof app[p]; } catch(e){ root[p]='THROW: '+e.message; } }
console.log(JSON.stringify({ probes: log, rootCtx: root }, null, 2));
