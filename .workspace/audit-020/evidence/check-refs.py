#!/usr/bin/env python3
"""对交接件做**更强的**引用路径核对。

为什么需要它：skill 的 `probe-reachability.sh` 其 PAT 只匹配
`.workspace/` / `docs/` / `research/` / `agent-skills/` / `~/` 前缀，
**看不到** `p0a/...`、`reports/...`、`p0c/...`、`p1/...` 这类相对 `.workspace/audit-020/` 的短式引用
（本件的引用大多是这个形状）⇒ 它的 PASS 是本件引用可达性的**弱信号**。

本脚本把两类形状都按实际语义还原后逐一核对存在性。
用法：python3 check-refs.py <交接件> [base_dir]
"""
import os
import re
import sys

doc = sys.argv[1]
base = sys.argv[2] if len(sys.argv) > 2 else ".workspace/audit-020"
root = os.getcwd()

text = open(doc, encoding="utf-8").read()

# 1) 先按行收集：任何形如 token 的路径片段（不含空格与反引号）
tok = re.compile(r"[A-Za-z0-9._-]*/[A-Za-z0-9._/-]+")
# 已知前缀，判定"这是一个路径引用"的锚点
ANCHORS = (".workspace/", "docs/", "research/", "agent-skills/", "~/")
SHORT = ("p0a/", "p0c/", "p1/", "reports/", "evidence/", "verify-volatile/",
         "verify-skills/", "n17-erratum/", "volatile-fix-backup/", "openinapp-fix-backup/",
         "peer-widen-backup/", "verify-http/")

checked = {}
for line in text.splitlines():
    for m in tok.finditer(line):
        p = m.group(0).strip()
        # 去掉行首可能带的列表/引用标记
        p = p.lstrip("`-* >|")
        if p.startswith(ANCHORS):
            if p.startswith("~/"):
                abs_p = os.path.join(os.path.expanduser("~"), p[2:])   # 注意：本工具 HOME 是伪装根
            else:
                abs_p = os.path.join(root, p)
        elif p.startswith(SHORT):
            abs_p = os.path.join(root, base, p)
        else:
            continue
        checked.setdefault(p, abs_p)

missing, present = [], []
for p, a in sorted(checked.items()):
    (present if os.path.exists(a) else missing).append((p, a))

print(f"doc            : {doc}")
print(f"candidates     : {len(checked)}")
print(f"reachable      : {len(present)}")
print(f"missing        : {len(missing)}")
for p, a in missing:
    print(f"  MISSING: {p}   (-> {a})")
print("---")
if missing:
    print("REFS: FAIL")
    sys.exit(1)
print("REFS: PASS")
