// 面5：补丁标记 + served rev vs 磁盘 一致性核对（只读）
import fs from 'node:fs';
import crypto from 'node:crypto';
import https from 'node:http';

const HOST='http://127.0.0.1:3080';
const get=(u)=>new Promise((res,rej)=>https.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res({status:r.statusCode,body:d}))}).on('error',rej));

const sha=(p)=>{const b=fs.readFileSync(p);return {sha1_12:crypto.createHash('sha1').update(b).digest('hex').slice(0,12), md5_12:crypto.createHash('md5').update(b).digest('hex').slice(0,12), size:b.length};};

// 四包（任务书四批修复的落点）
const PKGS={
 'U-TP/ui-layout':{ id:'@deepseek-ai/dsh-client-ui-layout',
   path:'/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js',
   markers:['/* tp-fix','dsh-perf-fix theme','shadedTokens','sameShadedTokens'] },
 'U-TP/wallpaper':{ id:'@local/dsh-wallpaper',
   path:'/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-wallpaper/lib/client.js',
   markers:['/* tp-fix','dsh-perf-fix theme'] },
 'U-P2AC/client-runtime':{ id:'@deepseek-ai/dsh-client-runtime',
   path:'/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js',
   markers:['/* p2ac-fix */'] },
 'U-R4/client (usage client)':{ id:'@local/dsh-usage-client',
   path:null, markers:[] },
};

const html=await get(HOST+'/');
// rev from inline script tags
const inlineRevs=[...html.body.matchAll(/\/plugins\/([^"?]+)\/client\.js\?rev=([0-9a-f]+)/g)].map(m=>({id:m[1],rev:m[2]}));
// rev from __DSH_BOOT__
let bootEntries=[];
const i=html.body.indexOf('globalThis["__DSH_BOOT__"] = ');
if(i>=0){const s=html.body.slice(i+29);let d=0,end=-1;for(let j=0;j<s.length;j++){if(s[j]==='{')d++;else if(s[j]==='}'){d--;if(d===0){end=j+1;break}}}
 try{bootEntries=JSON.parse(s.slice(0,end)).entries;}catch(e){console.error('boot parse fail',e.message)}}
const served={};
for(const e of [...inlineRevs,...bootEntries]) served[e.id]=e.rev;

const out={ts:new Date().toISOString(),html_bytes:html.body.length,boot_entries:bootEntries.length,packages:{}};
for(const [name,cfg] of Object.entries(PKGS)){
  const rec={pkg_id:cfg.id,served_rev:served[cfg.id]??null,path:cfg.path,exists:false};
  if(cfg.path){
    if(fs.existsSync(cfg.path)){
      rec.exists=true;
      Object.assign(rec,sha(cfg.path));
      const txt=fs.readFileSync(cfg.path,'utf8');
      rec.markers={};
      for(const m of cfg.markers){ const n=txt.split(m).length-1; rec.markers[m]={count:n}; }
      rec.lines=txt.split('\n').length;
      // rev match
      rec.served_matches_disk = (rec.served_rev===rec.sha1_12);
    } else {
      // search alternatives
      rec.searched_alternatives=[];
    }
  }
  out.packages[name]=rec;
}
// usage client package discovery
const cands=[
 '/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage-client/lib/client.js',
 '/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-usage/lib/client.js',
];
out.usage_client_candidates=cands.map(p=>({p,exists:fs.existsSync(p)}));
// served plugins matching usage
out.served_usage_like=Object.entries(served).filter(([k])=>/usage/.test(k));
// all served ids
out.all_served_ids=Object.keys(served).sort();
fs.writeFileSync('verify-revs.json',JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
