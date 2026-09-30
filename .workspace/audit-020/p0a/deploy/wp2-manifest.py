#!/usr/bin/env python3
import hashlib, json, os
from concurrent.futures import ThreadPoolExecutor
A="/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020/home"
D="/home/CNS2026495165/dsh/.workspace/audit-020/p0a/deploy"
def rels(b): return sorted(os.path.relpath(os.path.join(r,f),b) for r,d,fs in os.walk(b) for f in fs)
def sha(p):
    h=hashlib.sha256()
    with open(p,'rb') as fh:
        for c in iter(lambda: fh.read(1<<20), b''): h.update(c)
    return h.hexdigest()
rows=[]
for root,label in ((os.path.join(A,'sessions'),'home/sessions'),(os.path.join(A,'attachments'),'home/attachments')):
    rl=rels(root)
    with ThreadPoolExecutor(16) as ex:
        hs=list(ex.map(lambda r: sha(os.path.join(root,r)), rl))
    for r,h in zip(rl,hs):
        p=os.path.join(root,r)
        rows.append((label,r,os.path.getsize(p),h))
with open(os.path.join(D,'manifest.jsonl'),'w',encoding='utf-8') as fh:
    for label,r,n,h in rows:
        fh.write(json.dumps({"root":label,"rel":r,"bytes":n,"sha256":h},ensure_ascii=False)+"\n")
tot=sum(r[2] for r in rows)
import collections
c=collections.Counter(r[0] for r in rows)
print(json.dumps({"lines":len(rows),"bytes_total":tot,"by_root":dict(c)},ensure_ascii=False))
open(os.path.join(D,'manifest.stats.json'),'w').write(json.dumps(
  {"lines":len(rows),"bytes_total":tot,"by_root":dict(c)},ensure_ascii=False,indent=1))
