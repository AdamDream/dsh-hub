import * as fs from "node:fs";
import * as zlib from "node:zlib";
const path = process.argv[2];
const buf = fs.readFileSync(path);
function scanFrames(buf){const frames=[];let off=0;const rd=(i,n)=>{let v=0;for(let k=n-1;k>=0;k--)v=v*256+buf[i+k];return v;};
 while(off<buf.length){if(buf.length-off<4||rd(off,4)!==0xfd2fb528)break;const start=off;off+=4;if(off>=buf.length)break;const desc=buf[off++];
 const fcsFlag=desc>>6,single=(desc>>5)&1,checksum=(desc>>2)&1,dictFlag=desc&3;const fcsSize=fcsFlag===0?(single?1:0):[2,4,8][fcsFlag-1];
 if(!single){if(off>=buf.length)break;off+=1;}if(off+[0,1,2,4][dictFlag]+fcsSize>buf.length)break;off+=[0,1,2,4][dictFlag]+fcsSize;
 let ok=false;while(off+3<=buf.length){const bh=buf[off]|(buf[off+1]<<8)|(buf[off+2]<<16);off+=3;const last=bh&1,size=bh>>>3;if(((bh>>1)&3)===3||off+size>buf.length)break;off+=size;if(last){ok=true;break;}}
 if(!ok)break;if(checksum){if(off+4>buf.length)break;off+=4;}frames.push({start,end:off});}return frames;}
const parts=[];for(const fr of scanFrames(buf))parts.push(zlib.zstdDecompressSync(buf.subarray(fr.start,fr.end)));
const lines=Buffer.concat(parts).toString("utf8").split("\n").filter(l=>l.length);
const rows=lines.slice(1).map(l=>JSON.parse(l));
for(const r of rows){
  if(r.type!=="agent/inbox/spliced") continue;
  console.log("seq",r.seq,"data keys",Object.keys(r.data));
  const ins=r.data.inserted;
  console.log("  inserted length", Array.isArray(ins)?ins.length:typeof ins);
  if(Array.isArray(ins)) ins.forEach((it,i)=>{
    console.log(`  [${i}] keys=${JSON.stringify(Object.keys(it))}`);
    console.log(`      role=${it.role} id=${it.id} contentLen=${Array.isArray(it.content)?it.content.length:"n/a"}`);
    if(it.source!==undefined) console.log("      source:", JSON.stringify(it.source).slice(0,300));
    if(it.message!==undefined){console.log("      message keys:", JSON.stringify(Object.keys(it.message))); console.log("      message.source:", JSON.stringify(it.message.source).slice(0,300)); }
  });
}
