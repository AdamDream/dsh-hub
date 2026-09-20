#!/usr/bin/env python3
"""Compute path-reference rewrites required by mapping.json.

Uses `git grep` (fast, honours .gitignore so the huge backup dirs are skipped).
READ-ONLY.
"""
import json, os, re, subprocess

ROOT = "/home/CNS2026495165/dsh"
DR = os.path.join(ROOT, ".workspace/docs-reorg")
mapping = json.load(open(os.path.join(DR, "mapping.json"), encoding="utf-8"))
moves = [e for e in mapping["entries"] if e["kind"] != "keep" and e["from"] != e["to"]]
moves.sort(key=lambda e: -len(e["from"]))

PATHS = [".", ":(exclude).workspace/docs-reorg"]
# `git grep` takes the -e patterns; build one alternation of all `from` paths
alts = "|".join(re.escape(e["from"]) for e in moves)
proc = subprocess.run(["git", "grep", "-n", "-I", "-E", "-e", alts, "--"] + PATHS,
                      cwd=ROOT, capture_output=True, text=True)
hits = []
for line in proc.stdout.splitlines():
    m = re.match(r"^([^:]+):(\d+):(.*)$", line)
    if not m:
        continue
    f, ln, text = m.group(1), int(m.group(2)), m.group(3)
    for e in moves:
        if e["from"] in text:
            hits.append({"file": f, "line": ln, "old": e["from"], "new": e["to"],
                         "kind": e["kind"], "renamed": e["renamed"],
                         "text": text.strip()[:200], "sameFile": f == e["from"]})
            break
seen, uniq = set(), []
for r in hits:
    k = (r["file"], r["line"], r["old"])
    if k in seen:
        continue
    seen.add(k)
    uniq.append(r)
by_file = {}
for r in uniq:
    by_file.setdefault(r["file"], []).append(r)
json.dump(uniq, open(os.path.join(DR, "tools", "refs_computed.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)

L = []
L.append("# 需要修改的路径引用清单（refs-to-fix）\n")
L.append("> 由 `.workspace/docs-reorg/tools/gen_refs.py` 依据 `mapping.json` 机械生成（`git grep` 只读扫描，"
         "自动跳过 `.gitignore` 排除的备份目录）。\n")
L.append(f"> 命中 **{len(uniq)}** 处，分布 **{len(by_file)}** 个文件。`自身档` 列 = 该行位于自身将被搬移的文件内。\n")
L.append("""
## 0. 处置原则

| 类别 | 判定 | 处置 |
| --- | --- | --- |
| **①实链（必须改）** | Markdown 链接 `](path)`、可执行路径 `cd path` / `bash path` / `./x.sh` | 不改则链接或命令失效 |
| **②证据引用（可保留）** | 正文里 `\\`file.md\\`` 式的历史证据指认 | DOC-STYLE 明示「历史证据报告按落盘时的档期格式保留」；**只改路径不改语义**，也可整体保留并注明路径已迁移 |
| **③自身档** | 位于将被搬移的文件内部、指向自己的旧路径 | 随文件搬走；若同时是对外指路则一并改 |

> 说明：`mapping.json` 里的 `renamed` 字段只用于目录归位（如 `.workspace/acceptance-probe/` → `.workspace/probes/acceptance/`），
> **没有对任何单个 `.md` 报告做改名**，因此②类引用的文件名一律不变，只有所在目录变了。
""")
L.append("\n---\n")

for f in sorted(by_file, key=lambda p: (p.split("/")[0], -len(by_file[p]), p)):
    rs = by_file[f]
    L.append(f"\n## `{f}` （{len(rs)} 处）\n")
    L.append("| 行 | 原文（截断） | 应改为 | 类别 | 自身档 |")
    L.append("| --- | --- | --- | --- | --- |")
    for r in sorted(rs, key=lambda x: x["line"]):
        if re.search(r"\]\(", r["text"]):
            cat = "**①实链**"
        elif re.search(r"(cd |bash |sh |\./)\S*" + re.escape(r["old"]), r["text"]) or r["text"].startswith("cd "):
            cat = "**①实链**"
        elif r["sameFile"]:
            cat = "③自身档"
        else:
            cat = "②证据"
        new_text = r["text"].replace(r["old"], r["new"])
        L.append(f"| {r['line']} | `{r['text'][:100]}` | `{new_text[:100]}` | {cat} | {'是' if r['sameFile'] else ''} |")

open(os.path.join(DR, "refs-to-fix.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")
print(f"wrote refs-to-fix.md: {len(uniq)} hits in {len(by_file)} files")
for n, k in sorted(((len(v), k) for k, v in by_file.items()), reverse=True)[:15]:
    print(f"  {n:4d}  {k}")
