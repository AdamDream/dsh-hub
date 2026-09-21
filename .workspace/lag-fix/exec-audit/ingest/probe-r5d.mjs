import { pathToFileURL } from 'node:url';
const HOST = '/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai';
const { Context, Service } = await import(pathToFileURL(`${HOST}/cordis/lib/index.js`).href);
const TimerService = (await import(pathToFileURL(`${HOST}/cordis-plugin-timer/lib/index.js`).href)).default;
const app = new Context();
const log=[]; const t=(m)=>log.push(m);
app.plugin(TimerService);
await new Promise(r=>setTimeout(r,50));

// A) 根 ctx 的 setInterval（mixin 在根上是否真的存在）
let rootTicks=0;
const rootTimer = app.setInterval(()=>{rootTicks++;}, 120);
t('root setInterval type=' + typeof rootTimer + ' hasThen=' + typeof rootTimer?.then);

// B) 用 plain provide 造服务
let served=false;
app.plugin(class { static name='plain-provide'; apply(ctx){ ctx.provide('connection', {}); ctx.provide('webServer', {}); served=true; } });
await new Promise(r=>setTimeout(r,80));
t('plain provide applied=' + served + ' get(connection)=' + (app.get('connection')?'ok':'undef'));

// C) 带 inject 的插件（microtask 中走 ctx.effect 兜底）
let rec={};
class UsageLike {
  static name='usage-like';
  static inject=['connection','webServer'];
  apply(ctx){
    rec.applied=true;
    rec.ctxSetInterval = typeof ctx.setInterval;
    rec.timerSvc = typeof ctx.timer;
    let calls=0, disposeTimer=null, disposed=false, gen=0;
    const runIngest = async()=>{ if(disposed) return; calls++; const s=Date.now(); while(Date.now()-s<50){} };
    const g = ++gen;
    queueMicrotask(()=>{ void (async()=>{
      await Promise.resolve();
      if(disposed||g!==gen){rec.bailed=true;return;}
      await runIngest();
      try {
        rec.path = typeof ctx.setInterval==='function' ? 'ctx.setInterval' : 'ctx.effect-fallback';
        disposeTimer = typeof ctx.setInterval==='function'
          ? ctx.setInterval(runIngest,250)
          : ctx.effect(()=>{ const id=setInterval(()=>void runIngest(),250); return ()=>clearInterval(id); },'usage-like');
        rec.installed=true; rec.valueType=typeof disposeTimer; rec.hasThen=typeof disposeTimer?.then;
      } catch(e){ rec.err = e?.constructor?.name+': '+e?.message; rec.stack=String(e?.stack).split('\n').slice(0,3).join(' | '); }
      rec.calls=calls;
    })().catch(e=>{rec.bootstrapErr=e?.message;}); });
    ctx.effect(()=>()=>{disposed=true;gen+=1;try{disposeTimer?.()}catch{}},'usage-like-lifecycle');
  }
}
const f = app.plugin(UsageLike);
await new Promise(r=>setTimeout(r,1400));
t('usage-like fiber state=' + f?.state + ' uid=' + f?.uid);
t('usage-like rec=' + JSON.stringify(rec));
t('rootTicks='+rootTicks);
// D) 对照组：在同步 apply 中走 ctx.effect 兜底
let syncTicks=0;
app.plugin(class { static name='sync-fallback'; static inject=['connection','webServer']; apply(ctx){ try{ ctx.effect(()=>{ const id=setInterval(()=>{syncTicks++;},200); return ()=>clearInterval(id); },'sync-fallback'); t('sync-fallback installed'); }catch(e){ t('sync-fallback ERR '+e.message); } } });
// E) 对照：microtask 中（无 await）直接 ctx.effect
let mtTicks=0;
app.plugin(class { static name='mt-fallback'; static inject=['connection','webServer']; apply(ctx){ queueMicrotask(()=>{ try{ ctx.effect(()=>{ const id=setInterval(()=>{mtTicks++;},200); return ()=>clearInterval(id); },'mt-fallback'); t('mt-fallback installed'); }catch(e){ t('mt-fallback ERR '+e.message); } }); } });
await new Promise(r=>setTimeout(r,1200));
t('syncTicks='+syncTicks+' mtTicks='+mtTicks+' rootTicks='+rootTicks);
console.log(log.join('\n'));
