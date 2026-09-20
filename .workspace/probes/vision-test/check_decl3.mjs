import { chromium } from 'playwright';
const URL='http://127.0.0.1:3080';
const b=await chromium.launch({headless:true,args:['--no-sandbox']});
const p=await (await b.newContext()).newPage();
await p.goto(URL,{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForTimeout(6000);
const out=await p.evaluate(async()=>{
  const r=await fetch(location.origin+'/api/llm.models',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method:'llm.models',payload:{}})});
  const j=await r.json();
  const groups=j?.result?.value?.groups||j?.result?.groups||[];
  const adam=groups.find(g=>g.id==='adam');
  return {groupIds:groups.map(g=>g.id), adam};
});
console.log('groups:', out.groupIds.join(', '));
if(!out.adam){ console.log('未找到 adam 组'); }
else {
  console.log('adam 组模型数:', out.adam.models.length);
  for(const m of out.adam.models){
    if(!String(m.id).includes('deepseek')) continue;
    console.log('  ', JSON.stringify(m));
  }
  console.log('\n--- 该组是否暴露 input/capability 字段：', JSON.stringify(Object.keys(out.adam.models[0])));
}
await b.close();
