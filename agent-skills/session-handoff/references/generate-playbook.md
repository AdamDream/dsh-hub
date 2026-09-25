# 生成模式操作手册（`generate-playbook`）

本文件拥有**可执行命令与判据**；一切阈值数字（归档保留份数、行数预算）与格式规则一律以
`handoff-spec.md` 为准，本文件**不重复阈值**，只写「跑哪个命令、判据是什么」。

## 生成七步

### 步骤 1 前置检查

- 读 goal：调 `get_goal`。**返回 `{"goal":null}` 是正常分支**（该会话没有 goal），直接走步骤 2 的「本会话主线提炼」，不报错、不阻断。
- 发现同仓其他单元的交接件：用 `glob "*_NEXT_SESSION_PROMPT.md"`。**注意语义**：该 glob 匹配**全树任意深度**，不是「仓库根」；它用于填充索引表 `other_units[]`。**仓库根**是否存在同前缀文件，必须用显式 `ls` / `shasum` 判定，**不得**用 glob 的返回值代替。
- 工作树脏则**提醒**用户「建议先提交固定版本」（这是用户的历史习惯），但 **skill 自己不动 git、不自动提交**；用户不提交也要继续生成。
- 目录前置：`.dsh/handoffs/` 与仓库内 `agent-skills/session-handoff/` 都可能不存在，涉及落盘时**先 `mkdir -p`**（见步骤 5）。

### 步骤 1.5 判定聚焦模式

- **进入聚焦模式**的条件：用户指定了支线 / 前缀 / 范围（「只交接 X 这条线」），而不是整仓全部活跃单元。
- 判定结果直接决定索引表形状：进入聚焦模式后，被聚焦支线正常书写，**其余每条支线在 `other_units[]` 索引表里各列一行**，字段与强制形状见 `handoff-spec.md`「聚焦模式」。
- **未指定聚焦**时也要列全部同仓单元；差别只在于「其余支线是否展开正文」。
- 自检项（见「自检清单」）：进入聚焦模式时，索引表行数 = 其余活跃支线数。

### 步骤 2 前缀提名与确认

- 按 `handoff-spec.md`「前缀命名与归档规则」提名：goal 关键词 → 本会话主线提炼 → 仍不明确则问用户。
- **向用户展示 nominee 并允许修改**；绝不静默使用 `main` / `handoff` 这类无信息前缀。
- 确认后的前缀同时用于仓库根文件与归档文件名。

### 步骤 3 强制取证

只读取证，**不跑构建、不跑测试**。逐项实跑并把输出记进对应小节：

| 取证项 | 命令 | 记进哪一节 |
|---|---|---|
| 工作树状态 | `git status --short` | `§1` 摘要 + 附录全文 |
| 改动统计 | `git diff --stat` | `§1` / `§3` |
| 近期提交 | `git log --oneline -20` | `§1` / `§3` |
| 当前 HEAD | `git rev-parse HEAD` | `§1` + 头部 YAML `git_head` |
| 分支 | `git rev-parse --abbrev-ref HEAD` | 头部 YAML `git_branch` |
| 仓库根 | `git rev-parse --show-toplevel` | 头部 YAML `repo_root` |
| 路径存在性 | 「自检命令」里的 `probe-reachability.sh` | `§8` 索引表的每条路径 |
| 关键文件内容 | 阅读将被提及的文件 | `§4` / `§7` / `§8` |
| goal / todo | `get_goal` + 会话 todo | 头部 YAML `goal`、`§5` |

**禁止凭记忆写任何事实**；取不到证的标 `[仅记忆]`（标记法见 `handoff-spec.md`）。

### 步骤 4 确认未决项

- 取证完成后，向用户问 **2–3 个真实未决问题**（下一步优先级、是否有未声明的裁决、某条待办是否仍有效），**先问再落盘**。
- 不允许用「已按理解处理」替代提问；不允许把未决项静默写成已裁决。

### 步骤 5 落盘

1. **先建目录**：`mkdir -p .dsh/handoffs`（归档目录当前可能不存在）。
2. **同前缀既有文件分两分支处理**：
   - **有同前缀文件** → 记录其 `shasum -a 256`，与 `other_units[]` 里记录的上次哈希比对：
     - 一致 → 复制进 `.dsh/handoffs/<前缀>_<YYYYMMDD-HHMMSS>.md` 后再写新文件；
     - **不一致 → 报告用户、不静默覆盖**（并发写保护，见 `handoff-spec.md`「前缀命名与归档规则」）。
   - **无同前缀文件**（首次运行）→ **跳过归档复制**，直接写新文件。
3. 按 `handoff-spec.md` 的结构写仓库根 `<前缀>_NEXT_SESSION_PROMPT.md`（头部 YAML → 勘误块 → `§0`–`§9` → 不编号附录）。

### 步骤 6 自检闸门（必须真跑）

- 逐条跑「自检命令」里的 4 条命令，**全绿方可继续**；任一条红 → 回到对应步骤修文档，不许「看起来没问题」就放行。
- **必须直接取命令退出码**（`bash x.sh doc; echo $?`）；**不要** `bash x.sh doc | tail` 后再看 `$?`（那会拿到 `tail` 的退出码，自检恒绿）。

### 步骤 7 归档裁剪 + 报告

- 归档**保留份数上限见 `handoff-spec.md`**；用「自检命令」第 4 条裁剪，并回填头部 YAML 的 `archive.retained`。
- 按「完成报告格式」报四件事。

## 通用路径可达性自检片段

**用途**：验证交接文档里引用的每条路径真实存在，**自定位仓库根、不硬编码本机路径**。
把下面脚本存成 `probe-reachability.sh` 后跑 `bash probe-reachability.sh <交接文档>`。

```bash
#!/usr/bin/env bash
# 通用路径可达性自检（v2）: 自定位仓库根，不硬编码本机路径。
# 用法: bash probe-reachability.sh <待检文档> [--strict]
set -uo pipefail
DOC="${1:?usage: probe-reachability.sh <doc>}"
[ -f "$DOC" ] || { echo "FATAL: no such doc: $DOC" >&2; exit 2; }
ROOT="$(git -C "$(dirname "$DOC")" rev-parse --show-toplevel 2>/dev/null)" \
  || { echo "FATAL: not inside a git repo: $DOC" >&2; exit 2; }
echo "repo_root=$ROOT"
# 纯 ERE：grep -E 不支持 (?:…)，请用分组替代；(GNU grep 下 \b 可用，但 BSD/macOS 不支持，别依赖)
PAT='\.workspace/[A-Za-z0-9._/-]+[*/]?|docs/[A-Za-z0-9._/-]+[*/]?|research/[A-Za-z0-9._/-]+[*/]?|agent-skills/[A-Za-z0-9._/-]+[*/]?|~/.dsh/[A-Za-z0-9._/-]+[*/]?'
miss=0; tot=0
while IFS= read -r p; do
  [ -z "$p" ] && continue
  # 逐字符剥掉尾部标点（保留 .md 之类）
  while :; do
    c="${p: -1}"
    case "$c" in '`'|')'|','|';'|':'|'"'|"'") p="${p%?}";; *) break;; esac
  done
  p="${p#\`}"; [ -z "$p" ] && continue
  case "$p" in *'*'*|*'<'*|*'>'*|*'$'*) continue;; esac
  p="${p%/}"
  case "$p" in '~/'*) abs="$HOME/${p#\~/}";; *) abs="$ROOT/$p";; esac
  tot=$((tot+1))
  [ -e "$abs" ] || { echo "MISSING: $p"; miss=$((miss+1)); }
done < <(grep -oE "$PAT" "$DOC" 2>/dev/null | sort -u)
echo "--- checked=$tot missing=$miss"
if [ "$miss" -eq 0 ]; then echo "REACHABILITY: PASS"; exit 0; else echo "REACHABILITY: FAIL"; exit 1; fi
```

**三条必须遵守的写法**（都是实测踩过的坑，别重蹈）：

1. **必须写纯 ERE**：`grep -E` **不支持** `(?:…)`（初版用 `(?:agent-skills|research)/` 导致只剩 1 条命中（`checked=1`），「路径全可达」**假绿**）。`\b` 在 GNU grep 下可用，但 BSD/macOS grep 不支持，跨平台会静默改变匹配，**一并避免**。
2. **尾部标点剥离不能包含 `.`**：初版用一次性的 `p="${p%%[\`),.:;]*}"` 剥尾部标点，会把结尾的 `.md` 一起吃掉，于是 `docs/program-notebook.md` 变成一条**并不存在**的路径 → **假 MISSING**。必须逐字符剥离 `` ` `` `)` `,` `;` `:`，**保留 `.md`**。
3. **`*` 通配会因断词造假 MISSING**：路径写成 `*` 结尾的目录通配（备份目录那种写法）时，PAT 会在 `*` 处断词，只留下通配符之前的前缀 → 假 MISSING。PAT 末尾加 `[*/]?`，并在命中 `*` 时 `continue` 跳过（本脚本已内置）。
4. 补充：**必须直接取退出码**（见「步骤 6」），否则用 `| tail` 会拿到错误退出码。

## 自检命令（逐条实测）

### (b) §编号齐全有序 + 预算

```bash
#!/usr/bin/env bash
# 标题形如 "## §N ..."；§6-§8 可省略且不计入预算
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
  # 任何**非 §N** 的标题都结束当前计数（含「不编号附录」这类标题）——
  # 否则附录正文会被算进 §9，造成假 FAIL（本机实测：126 → 修后 93）。
  /^#{1,6}[[:space:]]/ { cur="skip"; next }
  { if (cur!="skip") c++ }
  END { printf "budget(§0-§5+§9) counted=%d limit=%d %s\n", c, B, (c<=B?"PASS":"FAIL") }
' "$DOC"
[ "$ok" -eq 1 ] && echo "SECTIONS: PASS" || { echo "SECTIONS: FAIL"; exit 1; }
```

判据：输出 `SECTIONS: PASS` 且 `budget(...) PASS`；命令退出码 0。`§6`–`§8` 省略不算错（预算脚本会 `skip`）。

### (a) 路径可达性

```bash
# 见上节「通用路径可达性自检片段」脚本全文；此处只给调用与判据
bash probe-reachability.sh "<交接文档>"; echo "exit=$?"
```

判据：`REACHABILITY: PASS`、`missing=0`、退出码 0。出现 `MISSING: <path>` → 要么改路径，要么在文档里标为「尚未创建」并写明由谁创建。

### (c) 无空壳小节

```bash
# 任一 "## §N ..." 标题之后、下一个标题之前至少要有 1 行非空正文
awk '/^#{2,3}[[:space:]]*§[0-9]+/ { if (h!="" && c==0) print "EMPTY SECTION: " h; h=$0; c=0; next }
     { if (h!="" && $0 ~ /[^[:space:]]/) c++ }
     END { if (h!="" && c==0) print "EMPTY SECTION: " h; print "EMPTY-CHECK DONE" }' "$DOC"
```

判据：输出里**没有** `EMPTY SECTION:` 行，且以 `EMPTY-CHECK DONE` 收尾。

### (d) 归档裁剪

```bash
RETAIN=20; DIR=.dsh/handoffs   # 保留份数以 handoff-spec.md 为准，改这里要同步改 spec
ls -1t "$DIR" | tail -n +$((RETAIN+1)) | while read -r f; do rm -f "$DIR/$f"; done
echo "retained=$(ls -1 "$DIR" | wc -l)"
```

判据：`retained=` 的值不超过 `handoff-spec.md` 规定的上限；输出值回填头部 YAML `archive.retained`。

## 自检清单

| # | 检查项 | 命令 | 判据 |
|---|---|---|---|
| 1 | §编号齐全且有序 | `check-sections.sh` | `SECTIONS: PASS` |
| 2 | `§0`–`§5`+`§9` 在预算内 | `check-sections.sh` | `budget(...) PASS` |
| 3 | 引用路径 0 不可达 | `probe-reachability.sh` | `REACHABILITY: PASS` |
| 4 | 无空壳小节 | 空壳检查 awk | 无 `EMPTY SECTION:` |
| 5 | 每条关键断言带标记 | 人工核对 `[已核实]`/`[仅记忆]` | 关键断言无标记数 = 0 |
| 6 | 聚焦模式索引表行数 | 人工核对 `other_units[]` | 行数 = 其余活跃支线数 |
| 7 | 归档份数在上限内 | 裁剪片段 | `retained=` ≤ spec 上限 |
| 8 | 自生成文件已在 `§1` 标注 | 人工核对 `§1` | 出现「本次自生成，非待处理改动」字样 |

阈值（预算行数、归档份数）以 `handoff-spec.md` 为准，本清单不复述数字。

## 完成报告格式

收尾必须报四项：

1. **产物路径**：仓库根 `<前缀>_NEXT_SESSION_PROMPT.md` + 归档件路径；
2. **自检结果**：上表 8 项的**真实命令输出摘要**（不是「已通过」三个字）；
3. **未核实项**：清单，逐条写明「取不到什么证、需要谁来核实」；
4. **归档体积**：`.dsh/handoffs/` 现存份数（`retained=` 实测值）。
