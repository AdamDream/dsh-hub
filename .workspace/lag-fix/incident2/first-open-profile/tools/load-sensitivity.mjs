// Is session.list's stall caused by *client* concurrency, or by *co-tenant* CPU load?
// Phase A: paced, one request at a time, 10 s gap  -> our own load ~0
// Phase B: 4-way concurrent burst of session.list  -> our own load significant
// Phase C: paced again                             -> did B leave it worse?
// Also: is `settings.describe` affected the same way? (same-phase control)
import fs from 'node:fs';
const RAW='/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/first-open-profile/raw/';
const stat=()=>{const p=fs.readFileSync('/proc/10806/stat','utf8').split(' ');return Number(p[13])+Number(p[14]);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function post(ep,method,id,timeoutMs=60000){
  const t0=Date.now(); const ac=new AbortController(); const tm=setTimeout(()=>ac.abort(),timeoutMs); const c0=stat();
  return fetch(`http://127.0.0.1:3080${ep}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:id,method,payload:{}}),signal:ac.signal})
    .then(async r=>({ms:Date.now()-t0,bytes:(await r.arrayBuffer()).byteLength,status:r.status,hostTicks:stat()-c0}))
    .catch(e=>({ms:Date.now()-t0,err:String(e.message),hostTicks:stat()-c0}))
    .finally(()=>clearTimeout(tm));
}
const out={startedAt:new Date().toISOString(),phases:{}};
const load=()=>fs.readFileSync('/proc/loadavg','utf8').trim();
async function phase(name,fn,rounds){
  const rows=[]; const c0=stat(); const t0=Date.now();
  for(let i=0;i<rounds;i++) rows.push(await fn(i));
  const c1=stat(); const wall=Date.now()-t0;
  const sl=rows.map(r=>(r.sl||{}).ms).filter(Boolean).sort((a,b)=>a-b);
  const sd=rows.map(r=>(r.sd||{}).ms).filter(Boolean).sort((a,b)=>a-b);
  const m=a=>a.length?a[Math.floor(a.length/2)]:null;
  const pr={name,wallMs:wall,hostTicks:c1-c0,hostPctOfOneCore:Math.round((c1-c0)/(wall/1000)),loadavg:load(),rows,
    sessionList:{n:sl.length,min:sl[0],median:m(sl),max:sl[sl.length-1]},settingsDescribe:{n:sd.length,min:sd[0],median:m(sd),max:sd[sd.length-1]}};
  out.phases[name]=pr;
  console.log(`\n## ${name}  wall=${wall}ms hostCPU=${Math.round((c1-c0)/(wall/1000))}% load=${pr.loadavg}`);
  console.log(`   session.list      n=${sl.length} min=${sl[0]} med=${m(sl)} max=${sl[sl.length-1]} ms`);
  console.log(`   settings.describe n=${sd.length} min=${sd[0]} med=${m(sd)} max=${sd[sd.length-1]} ms`);
  rows.forEach((r,i)=>console.log(`     r${i} sl=${r.sl?.ms??'ERR'} ${r.sl?.bytes??''}B hostTicks=${r.sl?.hostTicks} | sd=${r.sd?.ms??'ERR'}`));
  return pr;
}
const paced=async(i)=>{ const sl=await post('/api/session.list','session.list','a'+i); const sd=await post('/api/settings.describe','settings.describe','b'+i); await sleep(2000); return {sl,sd}; };
const burst=async(i)=>{ const ps=[]; for(let k=0;k<4;k++) ps.push(post('/api/session.list','session.list','c'+i+'_'+k)); const sds=await post('/api/settings.describe','settings.describe','e'+i);
  const sls=await Promise.all(ps); await sleep(2000);
  return {sl:{ms:Math.max(...sls.map(x=>x.ms)),bytes:sls[0].bytes,hostTicks:sls.reduce((a,x)=>a+x.hostTicks,0),concurrent:4,allMs:sls.map(x=>x.ms)},sd:sds}; };
await phase('A-paced-quiet',paced,5);
await phase('B-burst4-concurrent',burst,5);
await phase('C-paced-after-burst',paced,5);
const A=out.phases['A-paced-quiet'],B=out.phases['B-burst4-concurrent'],C=out.phases['C-paced-after-burst'];
out.verdict={medianPacedVsBurstRatio:B.sessionList.median/A.sessionList.median, pacedRecovery:C.sessionList.median/A.sessionList.median,
  settingsDescribeStableAcross:(A.settingsDescribe.median===C.settingsDescribe.median)};
fs.writeFileSync(RAW+'load-sensitivity.json',JSON.stringify(out,null,2));
console.log('\nVERDICT',JSON.stringify(out.verdict));
