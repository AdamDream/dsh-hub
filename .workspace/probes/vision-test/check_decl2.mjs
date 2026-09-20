import { chromium } from 'playwright';
const URL='http://127.0.0.1:3080';
const b=await chromium.launch({headless:true,args:['--no-sandbox']});
const p=await (await b.newContext()).newPage();
await p.goto(URL,{waitUntil:'domcontentloaded',timeout:60000});
await p.waitForTimeout(6000);
const out=await p.evaluate(async()=>{
  const call=async(method,payload={})=>{
    const r=await fetch(location.origin+'/api/'+method,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method,payload})});
    return (await r.json()).result;
  };
  const res={};
  const prov=await call('llm.providers');
  const list=prov?.value?.providers||prov?.providers||[];
  const adam=list.find(x=>x.provider==='adam');
  res.adam=adam;
  // 尝试取模型清单的几种可能 RPC
  for(const m of ['llm.models','llm.listModels','llm.modelList']){
    try{ const r=await call(m,{provider:'adam'}); res[m]=r?.ok? r.value : r; }catch(e){ res[m]='ERR '+String(e).slice(0,80); }
  }
  return res;
});
console.log('=== adam provider 条目 ===');
console.log(JSON.stringify(out.adam,null,1));
for(const k of Object.keys(out)) if(k!=='adam'){
  console.log('\n=== '+k+' ===');
  const v=out[k];
  if(v && typeof v==='object' && Array.isArray(v.models)){
    console.log(' models 数量:',v.models.length);
    for(const mm of v.models.filter(x=>String(x.id||x.model||'').includes('deepseek')))
      console.log('  ',JSON.stringify(mm));
  } else console.log(' ',JSON.stringify(v).slice(0,600));
}
await b.close();
