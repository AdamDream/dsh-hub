#!/usr/bin/env bash
# ============================================================================
# check-executable-refs.sh —— 可执行文件（Runbook/脚本/交接文档）的路径引用体检
#
# 背景：2026-09-20 的文档整理把 `.workspace/deploy-lag/` 搬到
# `.workspace/workstreams/deploy/deploy-lag/`，而当时**没有**同步修正 lag-fix 自己的
# Runbook 与脚本里的重启命令 → 用户照 Runbook 跑会直接失败（被本轮的 --check 抓出）。
# 本脚本把这类"可执行引用失效"变成可自动检测，避免复现。
#
# 用法：bash .workspace/lag-fix/probes/check-executable-refs.sh
# 退出码：0 = 全部可达；1 = 有不可达引用（逐条列出）
#
# 注意：**历史证据类**文档（reports/audits、reports/execs 等）按 DOC-STYLE 不该改写，
#       其引用的旧路径属"当时事实"，本脚本默认不检查它们（可用 --include-history 打开）。
# ============================================================================
set -u
ROOT="/home/CNS2026495165/dsh"
cd "$ROOT" || exit 1
INCLUDE_HISTORY=0
[ "${1:-}" = "--include-history" ] && INCLUDE_HISTORY=1

# 可执行集合：Runbook、交接提示词、活动工作区脚本与探针
mapfile -t FILES < <(
  { # 脚本/探针：一律检查（它们是可执行的）
    find .workspace/lag-fix -type f \( -name '*.sh' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.py' \) -not -path '*/backup/*' -not -path '*/node_modules/*'
    # 文档：只检查「要照着跑」的那些（根级 .md、docs/、runbooks/、handoff/、lag-fix 根级 .md/.txt）
    printf '%s\n' README.md FEATURE-MAP.md DOC-STYLE.md
    find docs -type f -name '*.md'
    find .workspace/reports/runbooks .workspace/reports/handoff -type f -name '*.md' -o -path '.workspace/reports/handoff/*' -type f -name '*.txt'
    find .workspace/lag-fix -maxdepth 1 -type f \( -name '*.md' -o -name '*.txt' \)
  } 2>/dev/null | sort -u
)
[ "$INCLUDE_HISTORY" = 1 ] && mapfile -t FILES < <({ printf '%s\n' "${FILES[@]}"
  find .workspace/reports/audits .workspace/reports/execs -type f -name '*.md'; } | sort -u)

# 提取形如 `路径` 或以 .sh/.md/.mjs 结尾的候选引用（含反引号与正文明文两种写法）
PATTERN='(\.workspace/[A-Za-z0-9_./-]+|/home/CNS2026495165/[A-Za-z0-9_./-]+|docs/[A-Za-z0-9_./-]+)'
bad=0
scanned=0
for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue
  scanned=$((scanned + 1))
  while IFS= read -r ref; do
    # 去掉尾随标点；只检查像文件/目录路径的引用（含 `/` 或明确扩展名）
    r="${ref%%[).,;:\`\"\']*}"
    # 只有「带已知扩展名」或「以 / 结尾」的才算路径引用；正文里的裸目录提及不算
    case "$r" in
      *.sh|*.md|*.mjs|*.cjs|*.json|*.py|*.yaml|*.yml|*.txt|*.log|*.png|*.db|*.gz|*.tar|*/) ;;
      *) continue ;;
    esac
    # 归一化：绝对路径原样测；$ROOT/ 前缀转成相对 ROOT 测
    case "$r" in
      "$ROOT"/*) p="${r#"$ROOT"/}"; [ -n "$p" ] || p="." ;;   # 形如 /root/ 的「根目录本身」
      "$ROOT")   p="." ;;
      /*)        p="$r" ;;
      *)         p="$r" ;;
    esac
    [ -e "$p" ] || { printf '  不可达: %-52s ← %s\n' "$r" "$f"; bad=$((bad + 1)); }
  done < <(grep -ohE "$PATTERN" "$f" 2>/dev/null | sort -u)
done

echo "扫描文件 $scanned 个；不可达引用 $bad 处"
if [ "$bad" -gt 0 ]; then
  echo "提示：若该引用属「历史证据文档」（audits/execs），按 DOC-STYLE 不改写，可用默认模式忽略；"
  echo "      若属可执行文档/脚本，请修正为当前真实路径。"
  exit 1
fi
echo "全部可达 ✓"
exit 0
