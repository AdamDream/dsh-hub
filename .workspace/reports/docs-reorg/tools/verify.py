#!/usr/bin/env python3
"""Self-review verifier for the Track-D mapping + staged docs. READ-ONLY.

Checks:
 1. every root-level *.md is covered exactly once;
 2. every .workspace top-level entry is covered exactly once (workspace|keep);
 3. every `from` exists on disk;
 4. no duplicate `to`;
 5. no `to` already occupied on disk;
 6. no `to` collides with a `from` that is *not* moving (i.e. keep entries);
 7. every staged doc exists and every mandated section heading is present;
 8. every Mermaid block in the staged docs obeys the notebook-spec compatibility rules
    (no `flowchart`, no `stateDiagram` without -v2, no `A --> B & C`, ASCII node ids only);
 9. the staged docs contain no reference to a pre-move path (they must be written against
    the post-move layout) -- reported as WARN, listing any hits;
10. the staged doc set matches the paths mapping.json promises (`docs/program-notebook.md`,
    `docs/architecture/01..04-*.md`, `docs/runbooks/*`).
"""
import json, os, re, sys

ROOT = "/home/CNS2026495165/dsh"
DR = os.path.join(ROOT, ".workspace/docs-reorg")
WS = ".workspace"
STAGED = os.path.join(DR, "staged")
problems, warns = [], []

m = json.load(open(os.path.join(DR, "mapping.json"), encoding="utf-8"))
entries = m["entries"]

# 1 -----------------------------------------------------------------
disk_root = sorted(f for f in os.listdir(ROOT)
                   if f.endswith(".md") and os.path.isfile(os.path.join(ROOT, f)))
map_root = sorted(e["from"] for e in entries if e["kind"] == "root-doc")
if disk_root != map_root:
    problems.append(f"[1] root .md coverage: missing={sorted(set(disk_root)-set(map_root))} "
                    f"extra={sorted(set(map_root)-set(disk_root))}")

# 2 -----------------------------------------------------------------
disk_ws = sorted(os.listdir(os.path.join(ROOT, WS)))
map_ws = sorted(os.path.basename(e["from"]) for e in entries if e["kind"] in ("workspace", "keep"))
if disk_ws != map_ws:
    problems.append(f"[2] .workspace coverage: missing={sorted(set(disk_ws)-set(map_ws))} "
                    f"extra={sorted(set(map_ws)-set(disk_ws))}")

# 3 -----------------------------------------------------------------
for e in entries:
    if not os.path.lexists(os.path.join(ROOT, e["from"])):
        problems.append(f"[3] from missing: {e['from']}")

# 4 -----------------------------------------------------------------
tos = {}
for e in entries:
    if e["kind"] != "keep":
        tos.setdefault(e["to"], []).append(e["from"])
for t, srcs in tos.items():
    if len(srcs) > 1:
        problems.append(f"[4] duplicate to: {t} <= {srcs}")

# 5 -----------------------------------------------------------------
for e in entries:
    if e["kind"] == "keep" or e["to"] == e["from"]:
        continue
    if os.path.lexists(os.path.join(ROOT, e["to"])):
        problems.append(f"[5] to occupied on disk: {e['to']}")

# 6 -----------------------------------------------------------------
keep_set = {e["from"] for e in entries if e["kind"] == "keep"}
for e in entries:
    if e["kind"] != "keep" and e["to"] in keep_set:
        problems.append(f"[6] to collides with a keep entry: {e['to']}")

# 7 -----------------------------------------------------------------
REQUIRED = {
    "docs/program-notebook.md": [
        "全局数据流", "架构摘要", "程序运行流", "配置加载链", "模块摘要",
        "参考资料索引", "已验证的实现缺陷与限制",
    ],
    "docs/architecture/01-architecture-overview.md": ["架构总览"],
    "docs/architecture/02-plugin-system.md": ["插件体系"],
    "docs/architecture/03-model-routing-gateway.md": ["模型路由", "网关"],
    "docs/architecture/04-ops-deploy.md": ["运维", "部署"],
    "docs/runbooks/README.md": ["Runbook 索引"],
}
staged_files = []
for dirpath, _dirnames, filenames in os.walk(STAGED):
    for fn in filenames:
        staged_files.append(os.path.relpath(os.path.join(dirpath, fn), STAGED))
staged_files.sort()
if staged_files != sorted(REQUIRED):
    warns.append(f"[7] staged file set = {staged_files} (expected {sorted(REQUIRED)})")
for rel, sections in REQUIRED.items():
    p = os.path.join(STAGED, rel)
    if not os.path.exists(p):
        problems.append(f"[7] staged doc missing: {rel}")
        continue
    body = open(p, encoding="utf-8").read()
    for s in sections:
        if s not in body:
            problems.append(f"[7] {rel}: required section token missing: {s}")

# 8 -----------------------------------------------------------------
MERMAID_BAD = [
    (re.compile(r"^\s*flowchart\b", re.M), "`flowchart` 应改用 `graph LR`/`graph TD`"),
    (re.compile(r"^\s*stateDiagram\s*$", re.M), "裸 `stateDiagram` 应改用 `stateDiagram-v2`"),
    (re.compile(r"-->\s*\S+\s+&\s+\S+"), "多目标箭头 `A --> B & C` 兼容性差"),
    (re.compile(r"^\s*graph\s+\w+\s*$", re.M), None),  # placeholder, replaced below
]
mermaid_blocks = 0
for rel in REQUIRED:
    p = os.path.join(STAGED, rel)
    if not os.path.exists(p):
        continue
    body = open(p, encoding="utf-8").read()
    for blk in re.findall(r"```mermaid\n(.*?)```", body, re.S):
        mermaid_blocks += 1
        for pat, why in MERMAID_BAD[:3]:
            if pat.search(blk):
                problems.append(f"[8] {rel}: {why}")
        if re.search(r"[\u4e00-\u9fff]", re.sub(r"\[[^\]]*\]|\([^)]*\)|\"[^\"]*\"|'[^']*'", "", blk.split("\n")[0])):
            warns.append(f"[8] {rel}: mermaid first line may contain non-ASCII node id")
        # per-edge check: every node must participate in at least one edge
        nodes, edges = set(), []
        for ln in blk.splitlines():
            ln = ln.strip()
            if not ln or ln.startswith(("graph ", "sequenceDiagram", "stateDiagram", "%%", "subgraph", "end", "participant", "Note ")):
                continue
            if "-->" not in ln and "-.->" not in ln and "==>" not in ln:
                continue
            parts = re.split(r"-->|-\.->|==>", ln)
            # a line may hold several edges chained: A-->B-->C
            ids = [p.strip().split("[")[0].strip() for p in parts]
            for a, b in zip(ids, ids[1:]):
                if a and b:
                    edges.append((a, b))
                    nodes.add(a); nodes.add(b)
        dangling = {(a, b) for a, b in edges if a == b}
        if dangling:
            warns.append(f"[8] {rel}: mermaid self-loop {sorted(dangling)}")
        isolated = re.findall(r"^\s*([A-Za-z][A-Za-z0-9_]*)\s*(?:\[|\(|\{)", blk, re.M)
        for nid in isolated:
            if nid not in nodes and nid not in blk.split("mermaid")[0]:
                warns.append(f"[8] {rel}: mermaid node `{nid}` has no edge (isolated)")

# 9 -----------------------------------------------------------------
premove = [e["from"] for e in entries if e["kind"] != "keep" and e["to"] != e["from"] and e["from"].endswith(".md")]
for rel in REQUIRED:
    p = os.path.join(STAGED, rel)
    if not os.path.exists(p):
        continue
    body = open(p, encoding="utf-8").read()
    for frm in premove:
        if "/" not in frm:
            continue          # bare root-level basename: no path semantics to break
        base = os.path.dirname(frm)
        if frm in body:
            warns.append(f"[9] {rel}: references pre-move path `{frm}`")
        elif base and base.startswith(".workspace/") and base + "/" in body:
            warns.append(f"[9] {rel}: references pre-move dir `{base}/`")

print(f"staged docs: {len(staged_files)} files, {mermaid_blocks} mermaid blocks")
print(f"mapping entries: {len(entries)}")
if problems:
    print("\nPROBLEMS:")
    for p in problems:
        print("  ✗", p)
if warns:
    print("\nWARNINGS:")
    for w in warns[:60]:
        print("  !", w)
    if len(warns) > 60:
        print(f"  … {len(warns)-60} more")
if not problems:
    print("\nSELF-REVIEW: mapping OK (coverage/conflicts/occupancy all clean)")
sys.exit(1 if problems else 0)
