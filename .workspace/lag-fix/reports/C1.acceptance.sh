#!/usr/bin/env bash
# 单元 C1 交付前验收清单（可重复执行；live 全程只读）

set -u
FAIL=0
cd /home/CNS2026495165/dsh/.workspace/lag-fix
say(){ printf '%-58s %s\n' "$1" "$2"; }

bash -n patches/client-runtime-perf.sh && say "bash -n 补丁脚本" "PASS" || { say "bash -n" "FAIL"; FAIL=1; }
for f in patches/unit-C1-clientspec.mjs patches/unit-C1-fixer.mjs probes/equivalence-C1.mjs probes/bench-projectlist-C1.mjs probes/measure-after-C1.mjs probes/extract-C1.mjs patched/client-runtime.client.js patched/client-runtime.client-only-P1-P2.js; do
  node --check "$f" >/dev/null 2>&1 && say "node --check $(basename $f)" "PASS" || { say "node --check $(basename $f)" "FAIL"; FAIL=1; }
done

C1_TARGET=$PWD/sandbox/C1/client.baseline-pristine.js bash patches/client-runtime-perf.sh --dry-run >/dev/null 2>&1 && say "dry-run（干净基线）exit 0" "PASS" || { say "dry-run（干净基线）" "FAIL"; FAIL=1; }
C1_TARGET=$PWD/sandbox/C1/client.baseline-pristine.js bash patches/client-runtime-perf.sh --dry-run --only P1,P2 >/dev/null 2>&1 && say "dry-run --only P1,P2 exit 0" "PASS" || { say "dry-run --only P1,P2" "FAIL"; FAIL=1; }

node probes/equivalence-C1.mjs --baseline sandbox/C1/client.baseline-pristine.js 2>&1 | grep -q "10 通过 / 0 跳过 / 0 失败" && say "等价性单测（全量）10/0/0" "PASS" || { say "等价性单测（全量）" "FAIL"; FAIL=1; }
node probes/equivalence-C1.mjs --baseline sandbox/C1/client.baseline-pristine.js --patched patched/client-runtime.client-only-P1-P2.js 2>&1 | grep -q "7 通过 / 3 跳过 / 0 失败" && say "等价性单测（子集）7/3/0" "PASS" || { say "等价性单测（子集）" "FAIL"; FAIL=1; }

LIVE=/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js
[ "$(sha1sum patched/client-runtime.client.js | cut -c1-12)" = "f7a0d8ab55b3" ] && say "全量副本 sha1 f7a0d8ab55b3" "PASS" || { say "全量副本 sha1" "FAIL"; FAIL=1; }
[ "$(sha1sum $LIVE | cut -c1-12)" = "a0fb4bb225d3" ] && say "live = P1+P2 应用态 a0fb4bb225d3" "PASS" || say "live 现状" "NOTE"
# 真实"写入引用"判定：行里出现 patched/client.js（不是 .diff、不是他档的 tmp/patched/client.js、不是审计说明行）
RESID=$(grep -rnE "(^|[^a-zA-Z0-9/._-])patched/client\.js([^a-zA-Z0-9._-]|$)" patches/client-runtime-perf.sh patches/unit-C1-*.mjs probes/*-C1.mjs UNIT-C1-README.md reports/unit-C1.md reports/*C1*.json reports/C1.*.txt 2>/dev/null | grep -v "client\.js\.diff" | grep -v "tmp/patched/client\.js" | grep -v "不构成写入冲突")
if [ -n "$RESID" ]; then say "旧名残留" "FAIL"; echo "$RESID"; FAIL=1; else say "旧名残留（写入引用）" "0 命中 PASS"; fi
[ -f backup/C1/20260920-153800/client-runtime.client.js ] && say "独占备份根 backup/C1/ 就绪" "PASS" || { say "独占备份根" "FAIL"; FAIL=1; }
[ -f patched/workspace-enhancement.client.js ] && say "C2 产物仍在（未触碰）" "PASS" || say "C2 产物" "NOTE"
[ -f patched/client.js.diff ] && say "C2 的 client.js.diff 仍在（未触碰）" "PASS" || say "C2 diff" "NOTE"
printf '\n结论：%s\n' "$([ $FAIL -eq 0 ] && echo '全部通过' || echo '存在失败项')"
exit $FAIL
