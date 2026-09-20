import { chromium } from 'playwright';
const URL='http://127.0.0.1:3080';
const b=await chromium.launch({headless:true,args:['--no-sandbox']});
const p=await (await b.newContext()).newPage();
await p.goto(URL,{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForTimeout(6000);
const out=await p.evaluate(async()=>{
  const j=await (await fetch(location.origin+'/api/settings.describe',{method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method:'settings.describe',payload:{}})})).json();
  const s=JSON.stringify(j);
  return {len:s.length, hasNewDecl: s.includes('"input":["text","image"]')||s.includes('"input": [\n            "text"'), sample: s.slice(0,0)||'' , raw: s};
});
console.log('settings.describe 长度:', out.len);
// 在返回体里定位 adam/deepseek-v4-pro 附近的片段
const raw=out.raw; const i=raw.indexOf('deepseek-v4-pro');
console.log('\n=== 首个 deepseek-v4-pro 附近 600 字符 ===');
console.log(i<0?'(未出现)':raw.slice(Math.max(0,i-200), i+400));
const idxs=[]; let k=-1; while((k=raw.indexOf('deepseek-v4-pro',k+1))>=0) idxs.push(k);
console.log('\n出现次数:', idxs.length);
for(const j of idxs.slice(0,4)) console.log('  …',raw.slice(j,j+160).replace(/\s+/g,' '));
await b.close();
