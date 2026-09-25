#!/usr/bin/env bash
# §编号齐全有序 + §0–§5+§9 预算实测（标题形如 "## §N ..."；§6–§8 可省略）
set -uo pipefail
DOC="${1:?usage: check-sections.sh <doc> [budget]}"; [ -f "$DOC" ] || { echo "FATAL: no doc: $DOC" >&2; exit 2; }
BUDGET="${2:-100}"
mapfile -t SEC < <(grep -oE '^#{2,3}[[:space:]]*§[0-9]+' "$DOC" | grep -oE '[0-9]+')
echo "sections found: ${SEC[*]:-<none>}"
ok=1; prev=-1
for n in "${SEC[@]}"; do
  if [ "$n" -le "$prev" ]; then echo "ORDER: FAIL (non-increasing $prev -> $n)"; ok=0; fi
  prev="$n"
done
for need in 0 1 2 3 4 5 9; do
  printf '%s\n' "${SEC[@]}" | grep -qx "$need" || { echo "MISSING SECTION: §$need"; ok=0; }
done
awk -v B="$BUDGET" '
  BEGIN { cur="skip"; c=0 }
  /^#{2,3}[[:space:]]*§[0-9]+/ { n=$0; sub(/^#{2,3}[[:space:]]*§/,"",n); sub(/[^0-9].*$/,"",n);
    cur=(n=="0"||n=="1"||n=="2"||n=="3"||n=="4"||n=="5"||n=="9") ? n : "skip"; next }
  # 任何非 §N 的标题都终止计数（含「不编号附录」），否则附录正文被算进 §9 → 假 FAIL
  /^#{1,6}[[:space:]]/ { cur="skip"; next }
  { if (cur!="skip") c++ }
  END { printf "budget(§0-§5+§9) counted=%d limit=%d %s\n", c, B, (c<=B?"PASS":"FAIL") }
' "$DOC"
[ "$ok" -eq 1 ] && echo "SECTIONS: PASS" || { echo "SECTIONS: FAIL"; exit 1; }
