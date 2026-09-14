#!/usr/bin/env bash
# dsh-usage → web2 profile 幂等安装/卸载脚本（AUDIT U12）。
# 用法：
#   bash scripts/install-web2.sh --dry-run    # 仅打印将执行的路径与 patch 变更
#   bash scripts/install-web2.sh              # 安装（拷贝 + patch insert + 打印重启提示）
#   bash scripts/install-web2.sh --uninstall  # 还原（移除 insert + 删除目录，保留库文件）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PROFILE_NM="${DSH_PROFILE_NM:-$HOME/.dsh/profiles/web2/node_modules/@local/dsh-usage}"
PATCH_FILE="${DSH_PATCH_FILE:-$HOME/.dsh/profiles/web2/cordis.patch.yml}"
FILES=(lib package.json cordis.patch.yml LICENSE README.md)
INSERT_BLOCK=$'- insert:\n    - id: usage\n      name: \'@local/dsh-usage\''

MODE="${1:-install}"
case "$MODE" in
  --dry-run) DRY=1;;
  --uninstall) DRY=0; UNINSTALL=1;;
  install) DRY=0; UNINSTALL=0;;
  *) echo "usage: $0 [--dry-run|--uninstall]"; exit 2;;
esac

echo "== dsh-usage install (src: $SRC_DIR)"
echo "== target: $PROFILE_NM"
echo "== patch : $PATCH_FILE"

if [ "${DRY:-0}" = "1" ]; then
  echo "-- dry-run: 将执行以下动作 --"
  echo "1) 拷贝到目标（如已存在先备份为 .bak.<ts>）："
  for f in "${FILES[@]}"; do echo "   $SRC_DIR/$f -> $PROFILE_NM/$f"; done
  if grep -q "name: '@local/dsh-usage'" "$PATCH_FILE" 2>/dev/null; then
    echo "2) patch：已包含 @local/dsh-usage 条目，无需修改（幂等）"
  else
    echo "2) patch：将在 $PATCH_FILE 末尾追加："
    echo "$INSERT_BLOCK" | sed 's/^/     /'
  fi
  echo "3) 重启 DSH（web2 profile）后生效"
  exit 0
fi

if [ "${UNINSTALL:-0}" = "1" ]; then
  echo "== 卸载 =="
  if [ -f "$PATCH_FILE" ]; then
    # 移除精确三行 insert 块（YAML 缩进按 install 写入的形态匹配）。
    awk '
      BEGIN { skip=0 }
      { line=$0 }
      line=="- insert:" { skip=1; buf=line; next }
      skip && line=="    - id: usage" { buf=buf "\n" line; next }
      skip && line=="      name: '\''@local/dsh-usage'\''" { skip=0; next }
      skip { print buf; skip=0 }
      { print }
    ' "$PATCH_FILE" > "$PATCH_FILE.tmp" && mv "$PATCH_FILE.tmp" "$PATCH_FILE"
    echo "  已从 $PATCH_FILE 移除 @local/dsh-usage insert 条目"
  fi
  if [ -d "$PROFILE_NM" ]; then
    rm -rf "$PROFILE_NM"
    echo "  已删除 $PROFILE_NM"
  fi
  echo "  数据库保留于 ~/.dsh/storages/usage/usage.db（如需彻底删除请手动处理）"
  echo "  请重启 DSH（web2 profile）使卸载生效"
  exit 0
fi

echo "== 安装 =="
mkdir -p "$(dirname "$PROFILE_NM")"
if [ -e "$PROFILE_NM" ]; then
  BAK="$PROFILE_NM.bak.$(date +%s)"
  mv "$PROFILE_NM" "$BAK"
  echo "  已备份现有目录 -> $BAK"
fi
mkdir -p "$PROFILE_NM"
for f in "${FILES[@]}"; do
  cp -r "$SRC_DIR/$f" "$PROFILE_NM/$f"
done
echo "  已拷贝 ${#FILES[@]} 项到 $PROFILE_NM"

if grep -q "name: '@local/dsh-usage'" "$PATCH_FILE" 2>/dev/null; then
  echo "  patch：已包含 @local/dsh-usage 条目（幂等，未重复追加）"
else
  printf '\n%s\n' "$INSERT_BLOCK" >> "$PATCH_FILE"
  echo "  已在 $PATCH_FILE 末尾追加："
  echo "$INSERT_BLOCK" | sed 's/^/    /'
fi

echo
echo "== 完成。请重启 DSH（web2 profile）=="
echo "  重启后验证：宿主日志出现 dsh-usage 初始化 + ingest 完成行；"
echo "  设置页 → 插件配置 Tab 出现 dsh-usage 卡片。"
