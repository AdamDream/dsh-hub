#!/usr/bin/env python3
"""Render inventory.md from mapping.json (READ-ONLY against the repo).

Sections:
  1. summary census
  2. root 27 .md -- current path / target / renamed? / category rationale
  3. .workspace 183 top-level entries -- grouped by target bucket, every entry listed
  4. backup-* merge grouping scheme
  5. anomalies / decisions that need the main agent's attention
"""
import json, os, subprocess

ROOT = "/home/CNS2026495165/dsh"
DR = os.path.join(ROOT, ".workspace/docs-reorg")
m = json.load(open(os.path.join(DR, "mapping.json"), encoding="utf-8"))
entries = m["entries"]

REASON = {
    "audit-btw.md": "btw 审计（已被交叉验证版取代，保留为历史）→ 证据层 audits/btw",
    "audit-btw-model.md": "btw 模型路由审计 → 证据层 audits/btw",
    "audit-btw-subagent.md": "btw 交叉验证版审计（执行阶段以此为准）→ 证据层 audits/btw",
    "audit-subagent-arch-A.md": "子代理 worker_threads 可行性审计（A 版）→ 证据层 audits/subagent",
    "audit-subagent-arch-B.md": "同上（B 版独立审计）→ 证据层 audits/subagent",
    "audit-wallpaper.md": "壁纸功能审计 v2 → 证据层 audits/wallpaper",
    "audit-upstream-upgrade.md": "上游 0.1.1→0.1.5 升级审计 → 证据层 audits/upstream",
    "audit-local-customizations.md": "本机本地定制全清点 + 升级爆炸半径 → 证据层 audits/machine",
    "execute-btw.md": "btw 修订执行（U0–U10）→ 证据层 execs/btw",
    "execution-btw-model.md": "btw 模型切换执行 → 证据层 execs/btw",
    "execute-wallpaper.md": "壁纸修订执行 → 证据层 execs/wallpaper",
    "review-btw.md": "btw 复核记录 → 与对应执行同目录 execs/btw（便于对照）",
    "review-wallpaper.md": "壁纸复核记录 → 与对应执行同目录 execs/wallpaper",
    "execution-2b.md": "②b 非流式落盘执行记录（多份报告引用其行号）→ 证据层 execs/subagent",
    "execution-subagent-tokps.md": "subagent tok/s 执行 → 证据层 execs/subagent",
    "btw-wallpaper-plan.md": "需求对齐契约基线（grill-me）→ 证据层 plans",
    "wiring-plan.md": "接线计划 → 证据层 plans",
    "local-api-surface.md": "本地部署 API 面 vs master 差异（fork 接线必读）→ 证据层 reference",
    "port-taste.md": "taste 移植记录 → port 家族集中放 reports/ports（避免与 docs/runbooks 混杂）",
    "port-tokps-web2.md": "tok/s web2 移植记录 → reports/ports",
    "port-vision-adam.md": "vision-adam 移植记录 → reports/ports",
    "port-wallpaper.md": "壁纸移植记录 → reports/ports",
    "switch-web2-runbook.md": "**操作手册类**（切 web2 实例验收步骤）→ docs/runbooks/（用户裁决）",
    "verify-runbook.md": "**操作手册类**（btw 8 步 + 壁纸 12 步合并验收）→ docs/runbooks/（用户裁决）",
    "README.md": "**根保留**（用户裁决）：人类入口/导航中枢，被 FEATURE-MAP/DOC-STYLE 与子项目引用",
    "FEATURE-MAP.md": "**根保留**（用户裁决）：Tier 2 能力地图，被 README/DOC-STYLE 引用",
    "DOC-STYLE.md": "**根保留**（用户裁决）：Tier 0 写作约定，被 README 引用",
}

CAT_ORDER = [
    ("reports/audits", "审计证据"),
    ("reports/execs", "执行/复核证据"),
    ("reports/plans", "计划与契约"),
    ("reports/reference", "参考档"),
    ("reports/research", "调研"),
    ("reports/diagnostics", "诊断"),
    ("reports/incidents", "事故"),
    ("reports/runbooks", "主题 Runbook（证据层）"),
    ("reports/ports", "移植记录"),
    ("reports/handoff", "交接"),
    ("reports/push-logs", "推送日志"),
    ("probes", "探针/一次性产物"),
    ("backups", "备份"),
    ("workstreams", "主题工作目录"),
    ("keep", "原地保留"),
]

L = []
A = L.append

A("# Track D 整理清点（inventory）\n")
A("> 生成工具：`.workspace/docs-reorg/tools/gen_mapping.py` + `tools/gen_inventory.py`（只读清点）。")
A("> 机读映射表：[`mapping.json`](mapping.json)；引用修改清单：[`refs-to-fix.md`](refs-to-fix.md)。")
A("> **本阶段不搬动任何既有文件**——本页只是计划。\n")

# ------------------------------------------------------------------ census
A("## 0. 清点汇总\n")
root_md = [e for e in entries if e["kind"] == "root-doc"]
ws = [e for e in entries if e["kind"] == "workspace"]
keep = [e for e in entries if e["kind"] == "keep"]
n_dirs = sum(1 for e in ws if os.path.isdir(os.path.join(ROOT, e["from"])))
A("| 项 | 数量 |")
A("| --- | --- |")
A(f"| 仓库根 `*.md` | **{len(root_md)}**（全部被 git 跟踪；`git ls-files '*.md' \\| grep -v /` 实测 27） |")
A(f"| `.workspace/` 顶层条目 | **{len(ws) + len(keep)}**（`ls -1A` 实测；目录 {n_dirs} 个） |")
A(f"| 其中目录 | {n_dirs} |")
A(f"| 其中文件 | {len(ws) + len(keep) - n_dirs} |")
A(f"| 原地保留 | {len(keep)}（`settings-lag/`、`lag-fix/`、`docs-reorg/`——均为活动目录） |")
A(f"| 需 `git mv`（有跟踪文件） | {sum(1 for e in entries if e['moveCmd'] == 'git mv')} |")
A(f"| 需普通 `mv`（无跟踪文件，多为已 gitignore） | {sum(1 for e in entries if e['moveCmd'] == 'mv')} |")

A("\n### 0.1 与任务书数字的差异（如实报告）\n")
A("| 任务书 | 实测 | 说明 |")
A("| --- | --- | --- |")
A("| 根目录 27 个跟踪 .md | **27** ✅ 一致 | `git ls-files '*.md' \\| grep -v /` |")
A("| `.workspace/` 175 个顶层条目 | **183** | 清点时点较任务书晚；差额来自清点期间由其它执行线新建的目录（`vision-test/` 15:12 出现、`lag-fix/`、`settings-lag/`、`twin-probe/`），另有 `docs-reorg/` 为本任务自建。**全部已纳入映射表** |")
A("| `backup-*` 目录 20+ 个 | **14 个** | 顶层 `backup-*` 实测 14 个；若把 `deploy-lag/` 内的 3 个与 `deploy-slots/` 内的 1 个算上共 18 个 |")
A("| 根目录 `*.sh` | **0 个** ✅ 一致 | 脚本类硬引用风险为零；`.workspace/` 下有 18 个 `.sh` |")

# ------------------------------------------------------------------ root docs
A("\n---\n")
A("## 1. 根目录 27 个 `.md`：逐个清点\n")
A("| 当前路径 | 建议目标路径 | 重命名 | 归类理由 |")
A("| --- | --- | --- | --- |")
for e in sorted(root_md, key=lambda x: x["to"]):
    reason = REASON.get(e["from"], "")
    A(f"| `{e['from']}` | `{e['to']}` | {'是' if e['renamed'] else '否'} | {reason} |")
A("\n> **未对任何根目录 `.md` 改名**（全部 `重命名=否`）：DOC-STYLE 明示「约定不覆盖历史文档」"
  "（`audit-*` / `*.exec.md` 按落盘时的档期格式保留），改名会同时污染引用与历史可追溯性。")
A("> 根目录最终只留 3 个文件：`README.md`、`FEATURE-MAP.md`、`DOC-STYLE.md`。")

# ------------------------------------------------------------------ workspace
A("\n---\n")
A(f"## 2. `.workspace/` {len(ws) + len(keep)} 个顶层条目：逐个目标位置\n")
A("按目标桶分组；每一行都是一个顶层条目（无遗漏，可机读校验见 §6）。\n")

buckets = {}
for e in entries:
    to = e["to"]
    if e["kind"] == "keep":
        key = "keep"
    else:
        rest = to[len(".workspace/"):]
        head = "/".join(rest.split("/")[:2]) if rest.startswith(("reports/",)) else rest.split("/")[0]
        if rest.startswith("reports/"):
            key = "/".join(rest.split("/")[:2])
        else:
            key = rest.split("/")[0]
    buckets.setdefault(key, []).append(e)

order = [k for k, _ in CAT_ORDER] + sorted(k for k in buckets if k not in dict(CAT_ORDER))
labels = dict(CAT_ORDER)

for key in order:
    if key not in buckets:
        continue
    label = labels.get(key, key)
    A(f"\n### 2.{order.index(key)+1} `{key}` —— {label}（{len(buckets[key])} 项）\n")
    A("| 当前路径 | 目标路径 | 重命名 | 类型 | 跟踪文件数 |")
    A("| --- | --- | --- | --- | --- |")
    for e in sorted(buckets[key], key=lambda x: x["from"]):
        kind = "目录" if os.path.isdir(os.path.join(ROOT, e["from"])) else "文件"
        A(f"| `{e['from']}` | `{e['to']}` | {'是' if e['renamed'] else '否'} | {kind} | {e['trackedFiles']} |")
    if key == "keep":
        A("\n> 这三个目录是**活动工作目录**，本阶段不动：`settings-lag/`（同批审计产物的只读参考）、"
          "`lag-fix/`（另一条执行线在用）、`docs-reorg/`（本任务自身产物，主 agent 搬移完成后应删除）。")

# ------------------------------------------------------------------ backups
A("\n---\n")
A("## 3. `backup-*` 合并分组方案（14 个顶层 + 4 个嵌套）\n")
A("分组规则：**先按主题、再按时间戳**。目录名统一为 `<主题>/<YYYYMMDD-HHMMSS>[-<后缀>]`，")
A("使同一主题的历史备份在列目录时天然按时间排序。\n")
A("| 原路径 | 新路径 | 分组依据 |")
A("| --- | --- | --- |")
for e in sorted([x for x in entries if os.path.basename(x["from"]).startswith("backup-")], key=lambda x: x["to"]):
    name = os.path.basename(e["from"])
    if "btw" in name:
        why = "btw 插件备份"
    elif "methodology" in name:
        why = "方法论/文档稿备份"
    elif "batch" in name:
        why = "批量插件备份（batch / batch2）"
    elif "subagent-model" in name:
        why = "subagent 模型设置页备份"
    elif "usage-heatmap" in name:
        why = "usage 热力图备份"
    elif "config" in name:
        why = "settings 配置备份"
    elif "patched" in name:
        why = "官方包补丁前备份"
    elif "plugins" in name:
        why = "插件目录备份"
    elif name == "backup-ws-20260914-145449":
        why = "工作区快照备份"
    else:
        why = "未分类（保守归入 backups 根）"
    A(f"| `{e['from']}` | `{e['to']}` | {why} |")
A("\n**嵌套备份保持原位**（不搬入 `backups/`）：`.workspace/workstreams/deploy/deploy-lag/backup-*`（3 个，")
A("补丁脚本按 `$BACKUP_ROOT`/`SCRIPT_DIR` 就地解析，搬走会断链）与")
A("`.workspace/workstreams/deploy/deploy-slots/backup-*`（1 个，同理）。")
A("它们随各自 deploy 批次整体移动，相对关系不变。\n")
A("> ⚠️ **`.gitignore` 依赖已上报**：现有规则 `.workspace/backup-*/`（`.gitignore:22`）")
A("> **不匹配**新目录名 `backups/`，因此搬移后这 14 个（当前未被跟踪的）备份会变成可跟踪状态。")
A("> 主 agent 必须在搬移提交里同步补一条 `.workspace/backups/` 规则——本阶段按硬约束**未改** `.gitignore`。")

# ------------------------------------------------------------------ references
A("\n---\n")
A("## 4. 被引用位置清单（哪些文件引用了将被移动的路径）\n")
A("完整逐行清单（778 处 / 153 个文件）见 [`refs-to-fix.md`](refs-to-fix.md)。这里给出**必须先处理的结构性引用**：\n")
A("| 引用方 | 行 | 被引对象 | 类型 | 处置 |")
A("| --- | --- | --- | --- | --- |")
A("| `FEATURE-MAP.md` | 35 | `port-taste.md`、`port-wallpaper.md` | **Markdown 实链** `](port-taste.md)` | **必改**为 `.workspace/reports/ports/port-taste.md`（留在根的 FEATURE-MAP 指向会断） |")
A("| `README.md` | 53/54/57/70/107/117/123/124/135-144/149-153 | `.workspace/deploy-lag/*`、`.workspace/deploy-*/` | **实链 + 可执行命令块** | **必改**为 `.workspace/workstreams/deploy/...`；README 的 Runbook 索引与补丁重放示例块都要改 |")
A("| `README.md` | 43/60/117-124 | `.workspace/backup-*`、`.workspace/master-runbook.md` 等 | 实链/正文 | 备份族改 `.workspace/backups/`；总 Runbook 改 `.workspace/reports/runbooks/` |")
A("| `FEATURE-MAP.md` | 29-46 | `.workspace/deploy-*`、`.workspace/acceptance-exec.md`、`.workspace/*-exec.md` | 实链 | 全部改新路径 |")
A("| `docs/runbooks/switch-web2-runbook.md`（原根级） | 19 | `port-*.md` | 正文指路 | 改为 `../reports/ports/...` 或保留裸文件名（同批档） |")
A("| `docs/runbooks/verify-runbook.md`（原根级） | 4 | `execute-btw.md`、`execute-wallpaper.md` | 正文指路 | 改为 `.workspace/reports/execs/...` |")
A("| 根级历史审计/执行档之间 | 多行 | 同批文件 | 正文证据指认（非链接） | 按 DOC-STYLE「历史档按落盘格式保留」**可保留**；改则只改路径不改语义 |")
A("| `.workspace/workstreams/deploy/deploy-lag/replay-lag-fix.sh` | 258 / 455 | `.workspace/deploy/patches` | 脚本内**提示文本**（非实际路径解析） | 改为 `.workspace/workstreams/deploy/deploy/patches`（文案一致性）；**实际资源解析用 `SCRIPT_DIR/../deploy/`，批次整体移动后仍成立** |")
A("| `.workspace/workstreams/deploy/deploy-lag/patch-official-015.sh` | 25 | `.workspace/deploy-015` | 脚本内注释 | 同上，改注释即可（实际用 `P015_DIR:-$SCRIPT_DIR/../deploy-015`） |")
A("| `.workspace/workstreams/deploy/deploy-workerspace/base/*.mjs` | 多处 | `.workspace/deploy-workerspace/base` | **硬编码绝对路径** | **必改**为新绝对路径，否则脚本自定位失效 |")
A("| `.workspace/probes/twin/verify_twin.sh`、`probes/*/probe-*.sh` | — | 自身目录 | 相对自身 | 随目录搬走即可 |")
A("| `settings-lag/audit-notebook-skill.md` 等只读参考档 | — | 旧路径 | 历史审计叙述 | **不改**（只读参考，且为历史档） |")
A("| `.gitignore` | 22 / 23 | `.workspace/backup-*/`、`.workspace/deploy-lag/backup-*/` | 忽略规则 | **本阶段禁改**；主 agent 需补 `.workspace/backups/` 与 `.workspace/workstreams/deploy/deploy-lag/backup-*/` |")

# ------------------------------------------------------------------ anomalies
A("\n---\n")
A("## 5. 需要主 agent 特别留意的偏差与决策点\n")
A("| # | 事项 | 说明 | 建议 |")
A("| --- | --- | --- | --- |")
A("| A1 | **`.gitignore` 依赖** | 搬 `backup-*` → `backups/` 后原规则失配（见 §3 警告） | 在搬移提交里同步补 `.workspace/backups/`；这是本阶段被硬约束禁止、必须由主 agent 完成的一步 |")
A("| A2 | **`docs/` 目录是新建** | 目前 `docs/`、`docs/architecture/`、`docs/runbooks/` **都不存在**（实测 ENOENT） | `git mv` 会自动创建目标父目录；`staged/docs/` 的 6 篇新文档也由主 agent 一并落到 `docs/` |")
A("| A3 | **部署批次必须整体移动** | 3 个重放脚本用 `SCRIPT_DIR/../deploy-p0`、`../deploy/patches`、`../deploy-015` 引用同级批次 | 11 个 `deploy*` 目录**保持同级**一并移入 `workstreams/deploy/`，相对关系不变 |")
A("| A4 | **`.workspace/deploy-015/pkgs/` 被 gitignore** | 该目录不在跟踪内，但它由 batch 内部相对引用 | 与 A3 同一提交移动，避免出现半移动状态 |")
A('| A5 | **`deploy-workerspace/base/*.mjs` 硬编码绝对路径** | 3 处 `const root = "/home/.../.workspace/deploy-workerspace/base/..."` | 主 agent 搬移后必须同步改这 3 处字面量 |')
A("| A6 | **`.review-tmp/` 是测试残骸** | 被跟踪 17 个文件，内容是 fake root/fakebackup 测试夹具 | 已映射到 `.workspace/probes/legacy/review-tmp/`（改名前缀去掉前导点，避免再被当隐藏目录忽略） |")
A("| A7 | **`.tmp-*` 隐藏文件** | `.tmp-boot3080.html` / `.tmp-cordis.js` / `.tmp-inventory.js` 等为一次性调试产物但**被跟踪** | 映射到 `.workspace/probes/legacy/`（去前导点改名），`git mv` 保历史 |")
A("| A8 | **清点期间新增目录** | `vision-test/`（15:12 出现，另一条线的视觉能力探针）、`lag-fix/`、`settings-lag/`、`twin-probe/` | 已全部纳入映射；`lag-fix/`、`settings-lag/` 标为 keep（活动目录），`twin-probe/`、`vision-test/` 归入 probes |")
A("| A9 | **`reports/*` 无迁移前的同名冲突** | `mapping.json` 逐项校验 `to` 无重复、无占用 | 见 §6 校验输出 |")
A("| A10 | **`refs-to-fix.md` 的 778 处引用** | 其中大量是历史证据档的正文指认（非链接） | 建议只改 **①实链** 与 **脚本硬编码**；②证据引用按 DOC-STYLE 保留 |")

# ------------------------------------------------------------------ verification
A("\n---\n")
A("## 6. 覆盖性与冲突校验（实测输出）\n")
A("```")
A("$ python3 .workspace/docs-reorg/tools/gen_mapping.py")
r = subprocess.run(["python3", os.path.join(DR, "tools/gen_mapping.py")], cwd=ROOT,
                   capture_output=True, text=True)
A(r.stdout.strip())
A("")
A("$ python3 .workspace/docs-reorg/tools/verify.py")
r2 = subprocess.run(["python3", os.path.join(DR, "tools/verify.py")], cwd=ROOT,
                    capture_output=True, text=True)
A(r2.stdout.strip())
A("```")
A("\n校验项：① 根 `.md` 全覆盖且无重复；② `.workspace` 顶层全覆盖且无重复；③ 每个 `from` 在磁盘存在；")
A("④ `to` 无重复（同一目标出现两次即冲突）；⑤ `to` 未被现有文件占用；⑥ `to` 不撞保留项；")
A("⑦ staged 文档存在且必备章节齐全；⑧ Mermaid 兼容性；⑨ 文档中不出现搬移前路径。")

open(os.path.join(DR, "inventory.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")
print("wrote inventory.md")
