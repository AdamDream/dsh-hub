// 通过运行中宿主的 RPC 查 adam 各模型的 input 能力声明（判断 settings 改动是否热载）
import { chromium } from 'playwright';
const URL='http://127.0.0.1:3080';
const b=await chromium.launch({headless:true,args:['--no-sandbox']});
const p=await (await b.newContext()).newPage();
await p.goto(URL,{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForTimeout(6000);
const out=await p.evaluate(async()=>{
  const call=async(method,payload={})=>{
    const r=await fetch(location.origin+'/api/'+method,{method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method:method,payload})});
    return await r.json();
  };
  const res={};
  try{ res.providers=await call('llm.providers'); }catch(e){ res.providersErr=String(e); }
  return res;
});
const dump=(o)=>JSON.stringify(o).length>4000?JSON.stringify(o).slice(0,4000)+'…':JSON.stringify(o);
console.log('=== llm.providers raw (截断) ===');
console.log(dump(out));
// 提取 adam 的 deepseek 系列
const find=(o)=>{
  const seen=new Set(); const hits=[];
  (function walk(v){ if(!v||typeof v!=='object'||seen.has(v))return; seen.add(v);
    if(Array.isArray(v)) return v.forEach(walk);
    const id=v.id||v.model||v.modelId;
    if(typeof id==='string'&&id.startsWith('deepseek')) hits.push({id, input:v.input, provider:v.provider||v.providerId, name:v.name});
    Object.values(v).forEach(walk);
  })(o); return hits;
};
console.log('\n=== 发现的 deepseek 条目 ===');
for(const h of find(out.providers)) console.log(' ', JSON.stringify(h));
await b.close();
