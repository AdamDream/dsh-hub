import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const b=await chromium.launch({headless:true,args:['--no-sandbox']});
const p=await (await b.newContext()).newPage();
await p.addInitScript(()=>{
  const raf=window.requestAnimationFrame;
  window.__rafPatch = 'try';
  try{ Object.defineProperty(window,'requestAnimationFrame',{configurable:true,writable:true,value:function(cb){return raf.call(this,cb)},native:true}); window.__rafPatch='native-true'; }
  catch(e){ window.__rafPatch='FAIL '+e.message; try{ window.requestAnimationFrame=function(cb){return raf.call(this,cb)}; window.__rafPatch='assign'; }catch(e2){window.__rafPatch='none';} }
  window.__arr=[];
});
await p.goto('http://127.0.0.1:3080',{waitUntil:'domcontentloaded'});
await p.waitForSelector('button:has-text("设置")',{timeout:60000}); await sleep(3000);
console.log('patch', await p.evaluate(()=>window.__rafPatch));
for (const variant of ['plain-sleep','raf-await','raf-await-array','raf-await-timer']) {
  try {
    const r = await p.evaluate(async (v)=>{
      const t0=performance.now(); let n=0; const out=[];
      while(performance.now()-t0 < 600){
        if(v==='plain-sleep') await new Promise(r=>setTimeout(r,16));
        else if(v==='raf-await') await new Promise(r=>requestAnimationFrame(r));
        else if(v==='raf-await-array'){ await new Promise(r=>requestAnimationFrame(r)); out.push(performance.now()-t0); }
        else { await new Promise(r=>requestAnimationFrame(r)); await new Promise(r=>setTimeout(r,0)); out.push(performance.now()-t0); }
        n++;
      }
      return {n, outLen: out.length};
    }, variant);
    console.log(variant, 'OK', JSON.stringify(r));
  } catch(e){ console.log(variant, 'FAIL', e.message.split('\n')[0]); }
}
// also test removing setTimeout-based poll inside evaluate
try { const r = await p.evaluate(async ()=>{ let s=0; for(let i=0;i<10;i++){ await new Promise(r=>setTimeout(r,100)); s++; } return s; }); console.log('setTimeout-only OK', r); } catch(e){ console.log('setTimeout-only FAIL', e.message.split('\n')[0]); }
await b.close();
