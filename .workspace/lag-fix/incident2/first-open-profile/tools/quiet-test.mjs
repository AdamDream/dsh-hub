// Discriminating experiment: is the session.list stall caused by OUR probe load or by the app itself?
// 1) record what is loading the machine (per-PID CPU) at start
// 2) send NOTHING for 15 s and measure the host's own CPU rate on an idle-of-us interval
// 3) run a small number of session.list calls (n=6) as the ONLY load we add, interleaved with the fast control
// 4) sample host main-thread CPU during each call; compare stall vs CPU
import fs from 'node:fs';
const RAW='/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/first-open-profile/raw/';
const stat=()=>{const p=fs.readFileSync('/proc/10806/stat','utf8').split(' ');return Number(p[13])+Number(p[14]);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(ep,method,id,timeoutMs=40000){
  const t0=Date.now(); const ac=new AbortController(); const tm=setTimeout(()=>ac.abort(),timeoutMs);
  const c0=stat();
  try{ const res=await fetch(`http://127.0.0.1:3080${ep}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:id,method,payload:{}}),signal:ac.signal});
    const buf=Buffer.from(await res.arrayBuffer()); const c1=stat();
    return {ep,status:res.status,ms:Date.now()-t0,bytes:buf.length,hostTicksDuring:c1-c0};
  }catch(e){ const c1=stat(); return {ep,ms:Date.now()-t0,ok:false,err:String(e.message),hostTicksDuring:c1-c0}; }
  finally{ clearTimeout(tm); }
}
function topProcs(){
  const out=[];
  for(const d of fs.readdirSync('/proc')){
    if(!/^\d+$/.test(d)) continue;
    try{ const s=fs.readFileSync(`/proc/${d}/stat`,'utf8'); const cl=s.lastIndexOf(')'); const name=s.slice(s.indexOf('(')+1,cl);
      const f=s.slice(cl+2).split(' '); const ut=Number(f[11]),st=Number(f[12]);
      if(ut+st>0) out.push({pid:d,name,ticks:ut+st});
    }catch(e){}
  }
  return out;
}
const before=topProcs();
const out={startedAt:new Date().toISOString(),note:'idle-of-us interval then 6 session.list+control rounds'};
// --- 1) 15 s of us adding ZERO load
const cA=stat(); await sleep(15000); const cB=stat();
out.idleOfUs={seconds:15,hostMainThreadTicks:cB-cA,pctOfOneCore:Math.round((cB-cA)/15)};
console.log(`[idle-of-us 15s] host main-thread ${cB-cA} ticks = ${Math.round((cB-cA)/15)}% of one core (we sent nothing)`);
// --- 2) 6 rounds
out.rows=[];
for(let i=0;i<6;i++){
  const a=await post('/api/session.list','session.list','ql'+i);
  const b=await post('/api/settings.describe','settings.describe','qd'+i);
  out.rows.push({i,sessionList:a,settingsDescribe:b});
  console.log(`round${i}  session.list ${String(a.ms).padStart(7)}ms ${String(a.bytes||0).padStart(7)}B (host ${a.hostTicksDuring} ticks=${Math.round(a.hostTicksDuring/(a.ms/1000)||0)}% during)  |  settings.describe ${String(b.ms).padStart(5)}ms`);
  await sleep(300);
}
const after=topProcs();
const m={}; for(const p of before) m[p.pid]=p.ticks;
out.loadSourcesDelta=after.filter(p=>!(p.pid in m)||p.ticks-m[p.pid]>0).map(p=>({pid:p.pid,name:p.name,ticksDelta:p.ticks-(m[p.pid]||0)})).sort((a,b)=>b.ticksDelta-a.ticksDelta).slice(0,10);
out.host=out.loadSourcesDelta.find(x=>x.pid==='10806');
out.others=out.loadSourcesDelta.filter(x=>x.pid!=='10806');
const sl=out.rows.map(r=>r.sessionList.ms).sort((a,b)=>a-b);
out.summary={sessionListMs:{min:sl[0],median:sl[3],max:sl[5]},settingsDescribeMs:out.rows.map(r=>r.settingsDescribe.ms),hostMainThreadTicksDuringOurRounds:out.host?out.host.ticksDelta:null,hostOursPct:(out.host?out.host.ticksDelta:0)/((out.rows.reduce((a,r)=>a+r.sessionList.ms+r.settingsDescribe.ms,0))/1000)};
fs.writeFileSync(RAW+'quiet-test.json',JSON.stringify(out,null,2));
console.log('\nSUMMARY',JSON.stringify(out.summary));
console.log('top CPU consumers during the 6 rounds:',JSON.stringify(out.loadSourcesDelta));
