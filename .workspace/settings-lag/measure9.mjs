// 裁定「45s 同步 ingest 阻塞 924ms」是否在运行中的宿主上真实发生
// 观测：150s 内（≈3 个 45s 周期）宿主延迟分布，设置页全程关闭
import { chromium } from 'playwright';
import fs from 'node:fs';
const URL='http://127.0.0.1:3080';
const probe = async (o) => {
  const rr=(x)=>Math.round(x*10)/10; const out=[];
  for (let i=0;i<o.n;i++){
    const t0=performance.now();
    try{ await fetch(location.origin+'/api/host.describe',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}); }catch{}
    out.push({t:rr((Date.now()-o.t0)/1000), ms:rr(performance.now()-t0)});
    await new Promise(r=>setTimeout(r,o.gap??250));
  }
  return out;
};
const run=async()=>{
  const b=await chromium.launch({headless:true,args:['--no-sandbox']});
  const p=await (await b.newContext({viewport:{width:1280,height:800}})).newPage();
  const usage=[];
  p.on('requestfinished',async r=>{const u=r.url().replace(URL,''); if(!u.startsWith('/usage'))return;
    let ms=null; try{const t=r.timing(); ms=Math.round((t.responseEnd-t.requestStart)*10)/10;}catch{}
    usage.push(`${u}:${ms}ms`);});
  await p.goto(URL,{waitUntil:'domcontentloaded',timeout:60000});
  await p.waitForTimeout(6000);
  const t0=Date.now();
  const samples=await p.evaluate(probe,{n:600,gap:250,t0});   // ≈150s
  const ms=samples.map(s=>s.ms).sort((a,b)=>a-b);
  const stalls=samples.filter(s=>s.ms>100);
  const out={ window_s:150, n:samples.length, median:ms[Math.floor(ms.length/2)], p95:ms[Math.floor(ms.length*.95)], p99:ms[Math.floor(ms.length*.99)],
    max:samples.reduce((a,b)=>a.ms>b.ms?a:b), stalls_over_100ms:stalls.map(s=>`${s.t}s:${s.ms}ms`),
    stalls_over_500ms:stalls.filter(s=>s.ms>500).map(s=>`${s.t}s:${s.ms}ms`),
    usage_rpc_calls:samples.length?usage:[] , settings_opened:false };
  fs.writeFileSync('measure9.json',JSON.stringify(out,null,1)); console.log(JSON.stringify(out,null,1));
  await b.close();
};
run().catch(e=>{console.error('FATAL',e);process.exit(1);});
