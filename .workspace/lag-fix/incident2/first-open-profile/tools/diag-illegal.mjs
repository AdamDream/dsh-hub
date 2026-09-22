import { chromium } from '/home/CNS2026495165/playwright_scratch/node_modules/playwright/index.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const INIT = () => {
  const H={}; window.__H=H; H.log=[];
  const L=(k,x)=>{H.log.push(k+':'+String(x).slice(0,80))};
  try{ L('entries', Object.entries({a:1}).length);}catch(e){L('entries-FAIL',e.message)}
  try{ L('keys', Object.keys({a:1}).length);}catch(e){L('keys-FAIL',e.message)}
  const gcs=window.getComputedStyle;
  function gcsWrapper(){ return gcs.apply(this, arguments); }
  try{ Object.defineProperty(window,'getComputedStyle',{configurable:true,writable:true,enumerable:true,value:gcsWrapper,native:true}); L('gcs-patch','native-true'); }
  catch(e){ L('gcs-def-FAIL',e.message); }
  try{ L('gcs-on-element', window.getComputedStyle(document.body).backgroundColor);}catch(e){L('gcs-call-FAIL',e.message)}
  try{ L('gcs-on-el-noarg-ok', 1);}catch(e){}
  const raf=window.requestAnimationFrame;
  try{ Object.defineProperty(window,'requestAnimationFrame',{configurable:true,writable:true,value:function(cb){return raf.call(this,cb)},native:true}); L('raf-patch','ok'); }catch(e){L('raf-FAIL',e.message)}
  const f=window.fetch;
  try{ Object.defineProperty(window,'fetch',{configurable:true,writable:true,value:function(){return f.apply(this,arguments)},native:true}); L('fetch-patch','ok'); }catch(e){L('fetch-FAIL',e.message)}
  const qsa=Document.prototype.querySelectorAll;
  try{ Object.defineProperty(Document.prototype,'querySelectorAll',{configurable:true,writable:true,value:function(){return qsa.apply(this,arguments)}}); }catch(e){L('qsa-FAIL',e.message)}
  const gbt=Element.prototype.getBoundingClientRect;
  try{ Object.defineProperty(Element.prototype,'getBoundingClientRect',{configurable:true,writable:true,value:function(){return gbt.apply(this,arguments)}}); }catch(e){L('gbt-FAIL',e.message)}
  const sa=Element.prototype.setAttribute;
  try{ Object.defineProperty(Element.prototype,'setAttribute',{configurable:true,writable:true,value:function(){return sa.apply(this,arguments)}}); }catch(e){L('setAttribute-FAIL',e.message)}
  try{ document.createElement('div').setAttribute('x','1'); L('setAttr-call','ok'); }catch(e){L('setAttr-call-FAIL',e.message)}
  try{ L('gbt-call', JSON.stringify(document.body.getBoundingClientRect().width>=0)); }catch(e){L('gbt-call-FAIL',e.message)}
  try{ L('qsa-call', document.querySelectorAll('div').length>=0); }catch(e){L('qsa-call-FAIL',e.message)}
  try{ L('styleSheets', document.styleSheets.length); }catch(e){L('sheets-FAIL',e.message)}
  try{ L('metaContent', (document.querySelector('meta[name=theme-color]')||{}).content ?? 'none'); }catch(e){L('meta-FAIL',e.message)}
  const jp=JSON.parse, js=JSON.stringify;
  try{ Object.defineProperty(JSON,'parse',{configurable:true,writable:true,value:function(){return jp.apply(JSON,arguments)}});
       Object.defineProperty(JSON,'stringify',{configurable:true,writable:true,value:function(){return js.apply(JSON,arguments)}}); }catch(e){L('JSON-FAIL',e.message)}
  try{ L('json-roundtrip', JSON.parse(JSON.stringify({a:1})).a); }catch(e){L('json-roundtrip-FAIL',e.message)}
  H.state=null;
  H.snap=()=>({log:H.log, url:location.href, nodes:document.getElementsByTagName('*').length, state:H.state});
  H.set=()=>{ H.state={a:1}; return 1; };
};
const b=await chromium.launch({headless:true,args:['--no-sandbox']});
const p=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
await p.addInitScript(INIT);
await p.goto('http://127.0.0.1:3080',{waitUntil:'domcontentloaded'});
await p.waitForSelector('button:has-text("设置")',{timeout:60000}); await sleep(6000);
const s=await p.evaluate(()=>window.__H.snap());
console.log('SNAP', JSON.stringify(s,null,1));
try{
  const r=await p.evaluate(async()=>{ const H=window.__H; const out=[]; const t0=performance.now();
    let last=performance.now(), lastN=H.state?1:0;
    while(performance.now()-t0<1200){ await new Promise(r=>requestAnimationFrame(r)); out.push(performance.now()-t0); }
    return out.length; });
  console.log('RAF LOOP OK', r);
}catch(e){ console.log('RAF LOOP FAIL', e.message); }
try{
  const r=await p.evaluate(()=>{ const H=window.__H; const c=document.querySelector('div[role=dialog][aria-modal=true]'); return {has:!!c, sheets:document.styleSheets.length, theme:document.querySelector('meta[name=theme-color]')?.content}; });
  console.log('POST-RAF', JSON.stringify(r));
}catch(e){ console.log('POST-RAF FAIL', e.message); }
await b.close();
