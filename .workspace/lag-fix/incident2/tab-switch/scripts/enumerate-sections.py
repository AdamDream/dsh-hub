import os,re,json,collections
B='bundle'
SLOTS=['settings.section','settings.plugins.tab','settings.plugin.item','settings.general.item',
       'settings.onboarding','settings.header','settings.trigger','sidebar.settings']
out=collections.defaultdict(list)
files=sorted(os.listdir(B))
for fn in files:
    txt=open(os.path.join(B,fn),encoding='utf-8',errors='replace').read()
    lines=txt.split('\n')
    # find every slots.inject("<slot>") occurrence and the following register block
    for m in re.finditer(r'slots\.inject\(\s*"([^"]+)"', txt):
        slot=m.group(1)
        if slot not in SLOTS: continue
        # take a window after the match
        win=txt[m.end():m.end()+2500]
        # find first id: "..." after register
        rm=re.search(r'slots\.register\(\s*\{([\s\S]{0,1500}?)\}\s*\)', win)
        blob = rm.group(1) if rm else win[:1200]
        ids=re.findall(r'\bid:\s*"([^"]+)"', blob)
        labels=re.findall(r'label:\s*([^,\n]+)', blob)
        labels2=re.findall(r'label:\s*\("([^"]*)"\)|label:\s*"([^"]*)"', blob)
        line=txt[:m.start()].count('\n')+1
        out[slot].append(dict(file=fn,line=line,ids=ids,labels=[l[:80] for l in labels[:4]]))
for slot in SLOTS:
    if not out[slot]: continue
    print('='*70)
    print('SLOT', slot, '  registrations:', len(out[slot]))
    for r in out[slot]:
        print(f"  {r['file']}:{r['line']}  ids={r['ids']}  label={r['labels']}")
