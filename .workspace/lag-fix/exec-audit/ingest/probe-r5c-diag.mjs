import { pathToFileURL } from 'node:url';
const HOST = '/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai';
const { Context, Service } = await import(pathToFileURL(`${HOST}/cordis/lib/index.js`).href);
const TimerService = (await import(pathToFileURL(`${HOST}/cordis-plugin-timer/lib/index.js`).href)).default;
const app = new Context();
const log = [];
const t = (m) => log.push(`${Date.now() % 100000} ${m}`);

t('ctx created; has get=' + typeof app.get + ' plugin=' + typeof app.plugin + ' effect=' + typeof app.effect);
const f1 = app.plugin(TimerService);
t('timer plugin invoked; typeof f1=' + typeof f1 + ' then=' + typeof f1?.then + ' state=' + f1?.state);
await new Promise(r => setTimeout(r, 60));
t('after 60ms: app.timer=' + typeof app.timer + ' setInterval=' + typeof app.setInterval + ' get(timer)=' + (app.get('timer') ? 'ok':'undef'));

class Fake extends Service { constructor(ctx, name){ super(ctx, name); } }
const f2 = app.plugin(class { static name='fakes'; apply(ctx){ new Fake(ctx,'connection'); new Fake(ctx,'webServer'); t('fakes applied'); } });
await new Promise(r => setTimeout(r, 60));
t('after 60ms: get(connection)=' + (app.get('connection') ? 'ok':'undef') + ' get(webServer)=' + (app.get('webServer') ? 'ok':'undef'));
t('f2.state=' + f2?.state);

class Ctl { static name='ctl'; apply(ctx){ t('Ctl applied (no inject); ctx.setInterval=' + typeof ctx.setInterval); ctx.effect(()=>{ const id=setInterval(()=>t('CTL TICK'), 150); return ()=>clearInterval(id); }, 'ctl'); } }
app.plugin(Ctl);
await new Promise(r => setTimeout(r, 500));
t('after 500ms');

class Inj { static name='inj'; static inject=['connection','webServer']; apply(ctx){ t('Inj applied; ctx.setInterval=' + typeof ctx.setInterval); } }
const f4 = app.plugin(Inj);
await new Promise(r => setTimeout(r, 300));
t('Inj state=' + f4?.state + ' uid=' + f4?.uid);
console.log(log.join('\n'));
