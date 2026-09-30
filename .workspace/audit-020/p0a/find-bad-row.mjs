import * as fs from "node:fs";
import * as zlib from "node:zlib";
import { pathToFileURL } from "node:url";
const NM = "/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020/prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai";
const { historicalSessionFormatCatalog } = await import(pathToFileURL(NM + "/dsh-session-format-catalog/lib/index.js").href);

function scanFrames(buf){const frames=[];let off=0;const rd=(i,n)=>{let v=0;for(let k=n-1;k>=0;k--)v=v*256+buf[i+k];return v;};
 while(off<buf.length){if(buf.length-off<4||rd(off,4)!==0xfd2fb528)break;const start=off;off+=4;if(off>=buf.length)break;const desc=buf[off++];
 const fcsFlag=desc>>6,single=(desc>>5)&1,checksum=(desc>>2)&1,dictFlag=desc&3;const fcsSize=fcsFlag===0?(single?1:0):[2,4,8][fcsFlag-1];
 if(!single){if(off>=buf.length)break;off+=1;}if(off+[0,1,2,4][dictFlag]+fcsSize>buf.length)break;off+=[0,1,2,4][dictFlag]+fcsSize;
 let ok=false;while(off+3<=buf.length){const bh=buf[off]|(buf[off+1]<<8)|(buf[off+2]<<16);off+=3;const last=bh&1,size=bh>>>3;if(((bh>>1)&3)===3||off+size>buf.length)break;off+=size;if(last){ok=true;break;}}
 if(!ok)break;if(checksum){if(off+4>buf.length)break;off+=4;}frames.push({start,end:off});}return frames;}

const path = process.argv[2];
const buf = fs.readFileSync(path);
const parts=[];for(const fr of scanFrames(buf))parts.push(zlib.zstdDecompressSync(buf.subarray(fr.start,fr.end)));
const lines = Buffer.concat(parts).toString("utf8").split("\n").filter((l) => l.length);
const header = JSON.parse(lines[0]);
const rows = lines.slice(1).map((l) => JSON.parse(l));
const restore = historicalSessionFormatCatalog.createRestore(header, { recovery: "recoverable", validation: "current" });
for (let i = 0; i < rows.length; i++) {
  try { restore.decodeRow(rows[i]); } catch (e) {
    console.log("FAILED at row", i, "type", rows[i].type, "seq", rows[i].seq);
    console.log("message:", String(e.message));
    console.log("row json:", JSON.stringify(rows[i]).slice(0, 2500));
    process.exit(0);
  }
}
try { restore.finish(); console.log("no row-level failure"); } catch (e) { console.log("finish failed:", String(e.message)); }
