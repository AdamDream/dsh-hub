import { pathToFileURL } from 'node:url';
const HOST='/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai';
const { Context } = await import(pathToFileURL(`${HOST}/cordis/lib/index.js`).href);
const app = new Context();
const log=[]; const t=(m)=>log.push(m);

// 1) 普通对象插件（{ name, apply }）
const f1 = app.plugin({ name:'obj', apply(ctx){ t('OBJ applied; effects=' + typeof ctx.effect); } });
t('f1 type=' + typeof f1 + ' state=' + f1?.state);
try { await f1; t('f1 awaited ok; state=' + f1.state); } catch(e){ t('f1 await ERR ' + e?.message); }

// 2) 内联 class 插件
class Cls { static name='cls'; apply(ctx){ t('CLS applied'); } }
const f2 = app.plugin(Cls);
try { await f2; t('f2 awaited ok; state=' + f2.state); } catch(e){ t('f2 await ERR ' + e?.message); }

// 3) 内联 class 表达式
const f3 = app.plugin(class { static name='anon'; apply(ctx){ t('ANON applied'); } });
try { await f3; t('f3 awaited ok; state=' + f3.state); } catch(e){ t('f3 await ERR ' + e?.message); }

// 4) inject 版本
class Injy { static name='injy'; static inject=['svc']; apply(ctx){ t('INJY applied; svc=' + typeof ctx.svc); } }
const f4 = app.plugin(Injy);
await new Promise(r=>setTimeout(r,50));
t('f4 state=' + f4.state);
app.plugin({ name:'prov', apply(ctx){ ctx.provide('svc', {hi:1}); t('PROV applied'); } });
await new Promise(r=>setTimeout(r,80));
t('f4 state after provide=' + f4.state);
t('get(svc)=' + (app.get('svc')?'ok':'undef'));

console.log(log.join('\n'));
