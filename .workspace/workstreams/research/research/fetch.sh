#!/bin/bash
pkgs="$@"
for p in $pkgs; do
  enc=$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$p")
  out="pkg-$(echo $p | tr '/@' '__').json"
  code=$(timeout 40 curl -sS -o "$out" -w "%{http_code}" "https://registry.npmjs.org/$enc" 2>/dev/null)
  echo "$p -> http=$code size=$(stat -c%s "$out" 2>/dev/null)"
done
