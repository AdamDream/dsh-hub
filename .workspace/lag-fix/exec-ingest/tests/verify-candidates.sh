#!/usr/bin/env bash
# Provenance check: `candidates/{db,index,rpc}.js` must be EXACTLY what
# apply-Ingest-v1.mjs produces from a pristine copy of the DEPLOYED lib, and the
# two new files must be byte-identical to their candidates. Otherwise the
# candidates could have drifted from the patch script.
set -u
cd "$(dirname "$0")/.."
D="$HOME/.dsh/profiles/node_modules/@local/dsh-usage/lib"
W=scratch/verify-cand
rm -rf "$W" && mkdir -p "$W" && cp "$D"/*.js "$W"/
if ! node apply-Ingest-v1.mjs --root "$W" --pre-image scratch/verify-cand-pre --apply > out/verify-candidates.apply.txt 2>&1; then
  echo "FAILED: the apply script did not validate against a pristine copy"; exit 1
fi
rc=0
for f in db.js index.js rpc.js ingest-worker.js ingest-runner.js; do
  if cmp -s "$W/$f" "candidates/$f"; then echo "SAME  $f  ($(md5sum < "candidates/$f" | cut -c1-12))"; else echo "DIFF  $f"; rc=1; fi
done
[ "$rc" -eq 0 ] && echo "candidates are provably the script's output" || echo "candidates have DRIFTED from the script"
exit "$rc"
