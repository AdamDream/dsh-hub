#!/usr/bin/env bash
# =============================================================================
# deploy-side.sh —— 支线收尾：把 usage 与 session-board 部署包装上 web profile
#                  （0.1.1-rc.2 运行位）
#
# 部署位（由主代理在部署期运行本脚本应用）：
#   usage          -> ~/.dsh/profiles/node_modules/@local/dsh-usage/
#                      （与 dsh-btw / dsh-wallpaper 同级，真实目录）
#   session-board  -> ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-session-board/
#                      （与 dsh-vision-adam / dsh-taste 同级，真实目录）
#   cordis 挂载    -> ~/.dsh/profiles/web/cordis.patch.yml 末尾追加两条 insert（幂等）
#
# 硬性边界（本脚本绝不触碰）：
#   - ~/.dsh/profiles/web2/                  —— web2 只读；DEPRECATED-web2.md 由主代理单独放置
#   - ~/.dsh/profiles/node_modules/@local/dsh-btw/ 与 dsh-wallpaper/
#   - live 全局树 ~/.npm-global/...（卡顿修复区：dsh-agent-loop / dsh-host-apiproxy /
#     dsh-web-search-deepseek / dsh-client-ui-subagent 等补丁包）与 ~/.dsh/settings.yaml
#   - 本脚本不写任何 settings 键：两个插件的 settings 命名空间（usage -> "dsh-usage" 空 schema、
#     session-board -> "session-status-board" 带默认 Config）均由插件在运行时自注册，
#     与 web2 用法一致，无需 profile 级配置。
#
# 用法：
#   bash deploy-side.sh            # 正式部署：备份 -> 拷贝两包 -> 幂等追加 insert
#   bash deploy-side.sh --dry-run  # 演练：只打印将执行的动作与幂等判定，不写任何文件
#
# 前置：已按 REVIEW.md 裁决 usage 的 0.1.1 API 兼容问题（默认照原样部署；
#       若需适配，先手动应用 usage-compat-011.diff 到本目录 usage/lib/rpc.js）。
# 生效：重启 dsh web（运行位 0.1.1-rc.2）后新会话生效。
# =============================================================================
set -euo pipefail

# --- 常量 --------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILES="$HOME/.dsh/profiles"
WEB_PROFILE="$PROFILES/web"
FLAT="$PROFILES/node_modules"
PATCH="$WEB_PROFILE/cordis.patch.yml"
TS="$(date +%Y%m%d%H%M%S)"

SRC_USAGE="$SCRIPT_DIR/usage"
SRC_SB="$SCRIPT_DIR/session-board"
DST_USAGE="$FLAT/@local/dsh-usage"
DST_SB="$FLAT/@deepseek-ai/dsh-session-board"

DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

say() { printf '%s\n' "$*"; }
run() {
  if $DRY_RUN; then say "  [dry-run] $*"; else say "  [run]     $*"; "$@"; fi
}

# --- 前置校验 ----------------------------------------------------------------
err=0
[ -d "$SRC_USAGE" ]  || { say "ERROR: 源包缺失 $SRC_USAGE";  err=1; }
[ -d "$SRC_SB" ]     || { say "ERROR: 源包缺失 $SRC_SB";     err=1; }
[ -d "$WEB_PROFILE" ]|| { say "ERROR: web profile 缺失 $WEB_PROFILE"; err=1; }
[ -f "$PATCH" ]      || { say "ERROR: cordis.patch.yml 缺失 $PATCH"; err=1; }
[ -d "$FLAT/@local" ]      || { say "ERROR: 扁平层 @local 缺失 $FLAT/@local"; err=1; }
[ -d "$FLAT/@deepseek-ai" ]|| { say "ERROR: 扁平层 @deepseek-ai 缺失 $FLAT/@deepseek-ai"; err=1; }
if [ "$err" -ne 0 ]; then say "前置校验失败，中止。"; exit 1; fi

# 目标存在但为符号链接时拒绝覆盖（防误伤官方重链区；本两目标预期不存在或为真实目录）
for d in "$DST_USAGE" "$DST_SB"; do
  if [ -L "$d" ]; then
    say "ERROR: 目标 $d 是符号链接，拒绝覆盖。请先人工核查该路径。"
    exit 1
  fi
done

say "== deploy-side.sh @ $TS (dry-run=$DRY_RUN) =="
say "   源: $SRC_USAGE / $SRC_SB"
say "   目标: $DST_USAGE / $DST_SB"
say "   patch: $PATCH"

# --- 1. 备份（沿用 cordis.patch.yml.bak-* 的就地 .bak-<TS> 惯例） --------------
say "-- 1. 备份 --"
for spec in "dsh-usage:$DST_USAGE" "dsh-session-board:$DST_SB"; do
  name="${spec%%:*}"; dst="${spec#*:}"
  if [ -e "$dst" ]; then
    run mv "$dst" "$dst.bak-$TS"
    $DRY_RUN || say "   已备份 $name -> $dst.bak-$TS"
  else
    say "   $name 目标不存在，跳过备份"
  fi
done
run cp -p "$PATCH" "$PATCH.bak-$TS"
$DRY_RUN || say "   已备份 $PATCH -> $PATCH.bak-$TS"

# --- 2. 拷贝两包到部署位 ------------------------------------------------------
say "-- 2. 拷贝 --"
run cp -r "$SRC_USAGE" "$DST_USAGE"
run cp -r "$SRC_SB" "$DST_SB"
say "   已拷贝 usage 完整包（package.json/lib/cordis.patch.yml/LICENSE/README.md）"
say "   已拷贝 session-board 完整包（package.json/lib/test/README.md/CONTRACT.md/install.sh）"

# --- 3. cordis.patch.yml 追加 insert（精确锚点：文件末尾；幂等：id 已存在则跳过）
#        片段与 web2 cordis.patch.yml 的 usage 条目逐字对齐；session-board 用
#        install.sh/README 指定的挂载 id "session-status-board"。 ---------------
say "-- 3. cordis.patch.yml insert --"
append_insert() {
  local id="$1" name="$2" comment="$3"
  if grep -qE "^[[:space:]]*- id: ${id}\b" "$PATCH"; then
    say "   insert id=${id} 已存在于 $PATCH，跳过（幂等）"
  else
    say "   追加 insert: id=${id} name=${name}"
    if ! $DRY_RUN; then
      cat >> "$PATCH" <<EOF

# ${comment}
- insert:
    - id: ${id}
      name: '${name}'
EOF
    fi
  fi
}

append_insert "usage" "@local/dsh-usage" \
  "usage 插件（token 用量统计，web2 同款 @local/dsh-usage v0.1.0）；settings 命名空间 dsh-usage 由插件自注册（空 schema），无需 profile 配置"
append_insert "session-status-board" "@deepseek-ai/dsh-session-board" \
  "session-board 插件（会话状态看板 v0.1.0）；settings 命名空间 session-status-board 由插件自注册（默认 enabled=true / maxBoardTokens=500），无需 profile 配置"

# --- 4. 收尾校验（尽力而为，不阻断） ------------------------------------------
YAML_PKG="$FLAT/yaml"
if [ -f "$YAML_PKG/package.json" ] && ! $DRY_RUN; then
  if node -e 'const fs=require("fs");const y=require(process.argv[1]);const d=y.parse(fs.readFileSync(process.argv[2],"utf8"));if(!Array.isArray(d))throw new Error("顶层不是数组");console.log("   YAML 校验通过：顶层条目数 =",d.length)' "$YAML_PKG" "$PATCH" 2>/dev/null; then
    :
  else
    say "   WARN: YAML 校验不可用或失败（不影响已落盘内容，请按 REVIEW.md 手工复核）"
  fi
fi

say "-- 完成 --"
if $DRY_RUN; then
  say "（dry-run 结束，未写任何文件。正式部署请运行: bash deploy-side.sh）"
else
  say "已部署: $DST_USAGE / $DST_SB；patch 已更新: $PATCH"
  say "settings 键：无（两插件自注册命名空间）。"
  say "提醒：DEPRECATED-web2.md 需主代理单独放入 ~/.dsh/profiles/web2/（本脚本不碰 web2）。"
  say "生效：重启 dsh web 后新会话生效。"
fi
