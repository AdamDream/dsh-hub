#!/usr/bin/env bash
# 通用路径可达性自检（v2）: 自定位仓库根，不硬编码本机路径。
# 用法: bash probe-reachability.sh <待检文档> [--strict]
set -uo pipefail
DOC="${1:?usage: probe-reachability.sh <doc>}"
[ -f "$DOC" ] || { echo "FATAL: no such doc: $DOC" >&2; exit 2; }
ROOT="$(git -C "$(dirname "$DOC")" rev-parse --show-toplevel 2>/dev/null)" \
  || { echo "FATAL: not inside a git repo: $DOC" >&2; exit 2; }
echo "repo_root=$ROOT"
# 纯 ERE（grep -E 不支持 (?:) / \b）；仓库相对路径候选
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
