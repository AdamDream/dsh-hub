import os,re,json,collections
B='bundle'
files=[f for f in sorted(os.listdir(B)) if f.startswith('_')]
def blocks(txt, start):
    """brace-match the object literal starting at first '{' at/after start"""
    i=txt.find('{', start)
    if i<0: return None
    d=0
    for k in range(i,len(txt)):
        c=txt[k]
        if c=='{': d+=1
        elif c=='}':
            d-=1
            if d==0: return txt[i:k+1], k+1
    return None
res=collections.defaultdict(list)
for fn in files:
    txt=open(os.path.join(B,fn),encoding='utf-8',errors='replace').read()
    for m in re.finditer(r'slots\.register\(', txt):
        bl=blocks(txt,m.end())
        if not bl: continue
        blob,_=bl
        line=txt[:m.start()].count('\n')+1
        # which slot does this register belong to? look backwards for nearest slots.inject("<slot>")
        pre=txt[:m.start()]
        inj=list(re.finditer(r'slots\.inject\(\s*"([^"]+)"', pre))
        slot=inj[-1].group(1) if inj else '(no-inject)'
        # only report if the register is the first one after that inject (within 1200 chars)
        if inj and m.start()-inj[-1].end()>1500: slot='(detached)'
        ids=re.findall(r'\bid:\s*"([^"]+)"', blob)
        # label: capture balanced-ish
        lab=[]
        for lm in re.finditer(r'label:\s*', blob):
            seg=blob[lm.end():lm.end()+160]
            lab.append(seg.split('\n')[0].strip()[:110])
        res[slot].append(dict(file=fn,line=line,ids=ids,label=lab[:2]))
for slot in sorted(res):
    print('='*80); print('SLOT',slot,'->',len(res[slot]),'register() calls')
    for r in res[slot]:
        print(f"  {r['file']}:{r['line']}  id={r['ids']}  label={r['label']}")
