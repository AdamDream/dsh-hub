#!/bin/bash
# fetch every live client bundle listed in __DSH_BOOT__
cd /home/CNS2026495165/dsh/.workspace/lag-fix/incident2/tab-switch
python3 - <<'PY' > raw/fetchlist.txt
import json
b=json.load(open('raw/boot.json'))
for e in b['entries']:
    print(e['id'], e['url'])
PY
while read -r id url; do
  safe=$(echo "$id" | tr '/@' '__')
  [ -s "bundle/$safe.js" ] || curl -s --max-time 30 "http://127.0.0.1:3080$url" -o "bundle/$safe.js"
done < raw/fetchlist.txt
ls bundle | wc -l
