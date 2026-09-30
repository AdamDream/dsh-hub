#!/bin/bash
zstd -d -c --no-progress "$1" | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const rows=s.split("\n").filter(Boolean).slice(1).map(JSON.parse);
  const check=(src)=>{if(src&&src.kind==="plugin"&&src.form==="snapshot"&&!Array.isArray(src.sections))return src.plugin;return null;};
  const hits=[];
  for(const r of rows){
    if(r.type==="user/message"){const p=check(r.data?.source);if(p)hits.push("user/message seq"+r.seq+" plugin="+p);}
    if(r.type==="agent/inbox/spliced"&&Array.isArray(r.data?.inserted))for(const e of r.data.inserted){const p=check(e?.source);if(p)hits.push("spliced seq"+r.seq+" plugin="+p);}
  }
  console.log(JSON.stringify(hits));
});'
