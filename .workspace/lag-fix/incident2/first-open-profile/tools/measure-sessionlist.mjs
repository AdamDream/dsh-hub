// Quantify the live session.list stall: N reps, always with the fast control interleaved so the
// comparison is made inside the same machine window (relative within-window comparison).
import fs from 'node:fs';
const RAW='/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/first-open-profile/raw/';
const r3=x=>Math.round(x*10)/10;
const reps=Number(process.argv[2]||12);
async function post(ep,method,id,timeoutMs=60000){
  const t0=Date.now(); const ac=new AbortController(); const tm=setTimeout(()=>ac.abort(),timeoutMs);
  try{
    const res=await fetch(`http://127.0.0.1:3080${ep}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:id,method,payload:{}}),signal:ac.signal});
    const buf=Buffer.from(await res.arrayBuffer());
    return {ep,method,status:res.status,ms:Date.now()-t0,bytes:buf.length,ok:true};
  }catch(e){ return {ep,method,ms:Date.now()-t0,ok:false,err:String(e.message)}; }
  finally{ clearTimeout(tm); }
}
const out={startedAt:new Date().toISOString(),reps,rows:[]};
for(let i=0;i<reps;i++){
  const a=await post('/api/session.list','session.list','s'+i);
  const b=await post('/api/settings.describe','settings.describe','d'+i);
  const c=await post('/usage/status','status','u'+i,10000).catch(e=>({err:String(e)}));
  out.rows.push({i,a,b,c});
  // host main-thread CPU over the same window
  const t1=Number(fs.readFileSync('/proc/10806/stat','utf8').split(' ').slice(13,15).reduce((x,y)=>x+Number(y),0));
  await new Promise(r=>setTimeout(r,500));
  const t2=Number(fs.readFileSync('/proc/10806/stat','utf8').split(' ').slice(13,15).reduce((x,y)=>x+Number(y),0));
  out.rows[out.rows.length-1].hostCpuTicksPer500ms=t2-t1;
  console.log(`rep${String(i).padStart(2)}  session.list ${String(a.ms).padStart(7)}ms ${String(a.bytes||0).padStart(7)}B  |  settings.describe ${String(b.ms).padStart(6)}ms  |  usage/status ${String(out.rows[i].c.ms??'ERR').padStart(6)}ms  |  host main-thread ${String(t2-t1).padStart(3)} ticks/500ms (=${((t2-t1)/5).toFixed(0)}%)`);
}
const sl=out.rows.map(r=>r.a.ms).filter(x=>x).sort((x,y)=>x-y);
const sd=out.rows.map(r=>r.b.ms).filter(x=>x).sort((x,y)=>x-y);
const s=m=>m[Math.floor(m.length/2)];
out.summary={sessionList:{min:sl[0],median:s(sl),max:sl[sl.length-1],n:sl.length,bytes:out.rows[0].a.bytes},settingsDescribe:{min:sd[0],median:s(sd),max:sd[sd.length-1],n:sd.length},ratioMedian:r3(s(sl)/s(sd)),loadavg:fs.readFileSync('/proc/loadavg','utf8').trim()};
fs.writeFileSync(RAW+'sessionlist-stall.json',JSON.stringify(out,null,2));
console.log('\nSUMMARY',JSON.stringify(out.summary));
