// Tab-open cost probe: 通用(fast) vs 插件(all plugin cards) vs 模型, measured in a single page session
// so every number is comparable inside one machine state. Profiling wraps each tab click.
import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const RAW='/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/first-open-profile/raw/';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const r3=x=>(x==null||!isFinite(x))?null:Math.round(x*1000)/1000;
const INIT=()=>{
  const H={raf:[],rafOn:false,longtasks:[],fn:{},rpc:{started:0,pending:0,items:[]},rpcPending:false,marks:{}};
  window.__H=H;
  const r3=x=>(x==null||!isFinite(x))?null:Math.round(x*1000)/1000;
  H.census=()=>{const d=document.querySelector('div[role=dialog][aria-modal=true]');return{nodes:document.getElementsByTagName('*').length,svg:document.getElementsByTagName('svg').length,rect:document.getElementsByTagName('rect').length,dialogNodes:d?d.getElementsByTagName('*').length:0,dialogSvg:d?d.getElementsByTagName('svg').length:0,dialogTextLen:d?(d.innerText||'').length:0,metaThemeColor:document.querySelectorAll('meta[name=theme-color]').length};};
  (function loop(t){if(H.rafOn)H.raf.push(r3(t));requestAnimationFrame(loop)})(0);
  try{new PerformanceObserver(l=>l.getEntries().forEach(e=>H.longtasks.push({dur:r3(e.duration),name:e.name}))).observe({entryTypes:['longtask']})}catch(e){}
  const f0=window.fetch;
  Object.defineProperty(window,'fetch',{configurable:true,writable:true,enumerable:true,native:true,value:function(){
    const u=String(arguments[0]&&arguments[0].url?arguments[0].url:arguments[0]);
    const isRpc=/\/api\/|client-request|\/usage\//.test(u);
    if(isRpc){H.rpc.started++;H.rpc.pending++;H.rpcPending=true;if(H.rpc.items.length<80)H.rpc.items.push({url:u.replace('http://127.0.0.1:3080',''),phase:'start',t:r3(performance.now())});}
    const t=performance.now();const pr=f0.apply(this,arguments);
    if(isRpc&&pr&&pr.then){const it=H.rpc.items.filter(x=>x.phase==='start'&&x.url===u.replace('http://127.0.0.1:3080','')).pop();
      return pr.then(v=>{H.rpc.pending--;H.rpcPending=H.rpc.pending>0;if(it){it.phase='done';it.ms=r3(performance.now()-t);it.status=v&&v.status}return v},
        e=>{H.rpc.pending--;H.rpcPending=H.rpc.pending>0;if(it){it.phase='error';it.ms=r3(performance.now()-t)}throw e});}
    return pr;}});
};
const b=await chromium.launch({headless:true,args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:1440,height:900}});const p=await ctx.newPage();const cdp=await ctx.newCDPSession(p);
await p.addInitScript(INIT);
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval',{interval:100});
await p.goto('http://127.0.0.1:3080',{waitUntil:'domcontentloaded'}); await p.waitForSelector('button:has-text("设置")',{timeout:90000});
await sleep(5000);
await p.locator('button:has-text("设置")').first().click();
await p.waitForSelector('div[role=dialog][aria-modal=true]',{timeout:15000}); await sleep(2500);
const out={tabs:[],tabNames:null};
const names=await p.evaluate(()=>{const d=document.querySelector('div[role=dialog][aria-modal=true]');return [...d.querySelectorAll('button')].map(b=>(b.innerText||'').trim()).filter(Boolean).slice(0,30)});
out.tabNames=names;
async function win(label,clickFn){
  await p.evaluate(()=>{const H=window.__H;H.rafOn=true;H.raf=[];H.longtasks=[];H.rpc={started:0,pending:0,items:[]};H.marks={};for(const k of Object.keys(H.fn)){H.fn[k].n0=H.fn[k].n;H.fn[k].ms0=H.fn[k].ms}});
  const c0=await p.evaluate(()=>window.__H.census());
  await cdp.send('Profiler.start');
  const t0=Date.now();
  await clickFn();
  const settle=await p.evaluate(async()=>{const H=window.__H;const t0=performance.now();const MAXW=8000,QUIET=600;let last=performance.now();
    let txt=(()=>{const d=document.querySelector('div[role=dialog][aria-modal=true]');return d?(d.innerText||'').length:-1})();let lastTxt=performance.now();
    while(performance.now()-t0<MAXW){await new Promise(r=>requestAnimationFrame(r));const d=document.querySelector('div[role=dialog][aria-modal=true]');const ct=d?(d.innerText||'').length:-1;
      if(ct!==txt){txt=ct;lastTxt=performance.now();}
      if(performance.now()-lastTxt>=QUIET)break;}
    return {elapsed:performance.now()-t0,textLen:txt,rpcPending:!!H.rpcPending};});
  const tQ=Date.now();
  const c1=await p.evaluate(()=>window.__H.census());
  const stat=await p.evaluate(()=>{const r3=x=>(x==null||!isFinite(x))?null:Math.round(x*1000)/1000;const H=window.__H;H.rafOn=false;
    const raf=H.raf.slice();const d=raf.slice(1).map((t,i)=>r3(t-raf[i]));const s=d.slice().sort((a,b)=>a-b);
    const q=p=>s.length?r3(s[Math.min(s.length-1,Math.floor((s.length-1)*p))]):null;
    const fnD={};for(const k of Object.keys(H.fn)){const x=H.fn[k];fnD[k]={n:x.n-(x.n0||0),ms:r3(x.ms-(x.ms0||0))}}
    return {rafN:raf.length,rafP50:q(.5),rafP95:q(.95),rafMax:s.length?r3(s[s.length-1]):null,rafOver50:d.filter(x=>x>50).length,longtasks:H.longtasks.slice(0,20),fn:fnD,rpc:H.rpc};});
  const prof=await cdp.send('Profiler.stop');
  out.tabs.push({label,censusBefore:c0,censusAfter:c1,wall:{clickToSettleMs:tQ-t0,profMs:r3((prof.profile.endTime-prof.profile.startTime)/1000)},settle,stat});
  fs.writeFileSync(RAW+`probe5-tab-${label}.profile.json`,JSON.stringify({label,nodes:prof.profile.nodes,startTime:prof.profile.startTime,endTime:prof.profile.endTime,samples:prof.profile.samples,timeDeltas:prof.profile.timeDeltas}));
  console.log(`### ${label} wall=${tQ-t0}ms prof=${r3((prof.profile.endTime-prof.profile.startTime)/1000)}ms settle=${JSON.stringify(settle)}`);
  console.log('   census',JSON.stringify(c0),'->',JSON.stringify(c1));
  console.log('   raf',JSON.stringify({n:stat.rafN,p50:stat.rafP50,p95:stat.rafP95,max:stat.rafMax,over50:stat.rafOver50}),'lt',stat.longtasks.length);
  console.log('   rpc',JSON.stringify(stat.rpc.items).slice(0,700));
}
await win('noop-stay',async()=>{await sleep(100)});
for(const nm of ['插件','模型','Agent 预设']){
  const loc=p.locator(`div[role=dialog][aria-modal=true] button:has-text("${nm}")`).first();
  if(await loc.count()) await win('tab-'+nm,async()=>{await loc.click({timeout:5000})});
  else console.log('### tab-'+nm+' NOT FOUND');
}

fs.writeFileSync(RAW+'probe5-tabs-summary.json',JSON.stringify(out,null,2));
await b.close();
