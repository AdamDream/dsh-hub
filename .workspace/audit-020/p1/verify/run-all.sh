#!/usr/bin/env bash
# WP6 §E：不启动任何 web 服务的静态验证入口。
# 全部动作 = 语法检查 + 读文件断言 + 桩调用。不联网、不起服务、不写既有文件。
# 用法：bash p1/verify/run-all.sh
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2   # → .workspace/audit-020
OUT=p1/verify/out
mkdir -p "$OUT"
fail=0

echo "== E1: 语法检查（node --check，ESM） =="
for f in p1/draft/dsh-remote-hosts/lib/client.js p1/draft/dsh-remote-hosts/lib/index.js \
         p1/verify/check-contract.mjs p1/verify/stub-harness.mjs; do
	if node --check "$f"; then
		echo "PASS  node --check $f"
	else
		echo "FAIL  node --check $f"
		fail=1
	fi
done

echo
echo "== E2: 官方契约 / 历史存亡 / 通道对齐 / RCA 源码断言 =="
if node p1/verify/check-contract.mjs | tee "$OUT/contract-check.txt"; then :; else fail=1; fi

echo
echo "== E3: 草案插件的桩调用 harness =="
if node p1/verify/stub-harness.mjs | tee "$OUT/stub-harness.txt"; then :; else fail=1; fi

echo
if [ "$fail" -eq 0 ]; then
	echo "ALL VERIFICATIONS PASSED (no web service started)"
else
	echo "VERIFICATION FAILURES PRESENT"
fi
exit "$fail"
