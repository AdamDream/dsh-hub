import re,json,sys
h=open('/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/tab-switch/raw/index.html',encoding='utf-8').read()
i=h.find('__DSH_BOOT__')
j=h.find('{',i)
depth=0
for k in range(j,len(h)):
    c=h[k]
    if c=='{':depth+=1
    elif c=='}':
        depth-=1
        if depth==0:
            end=k+1;break
b=json.loads(h[j:end])
print(json.dumps(b,ensure_ascii=False,indent=1))
