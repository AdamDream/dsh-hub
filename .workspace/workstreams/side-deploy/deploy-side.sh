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

# ── 2026-09-22 安全加固（协调者）──────────────────────────────────────────────
# 原因：本脚本的 DST 指向**在产** deployed 位（$FLAT/@local/dsh-usage 与 @deepseek-ai/dsh-session-board），
# 而 SRC（$SCRIPT_DIR/usage）是**旧快照**——它连 ingest-worker.js / ingest-runner.js 都不存在。
# 旧默认 DRY_RUN=false ⇒ 一次误执行会把下列成果**静默整包回滚**：
#   U-IG1（worker 化 ingest）、U-IG3 五项（区间对齐/ON CONFLICT/busy_timeout/temp_store/invalidate 导出）、
#   U-CC1（CC 游标修复）、P0-b settings、hour 粒度、以及本轮 U-CB1/U-CB2。
# 现改为：**默认 dry-run**，必须显式 `--apply` 才真正写盘。
DRY_RUN=true
case "${1:-}" in
  --apply)   DRY_RUN=false ;;
  --dry-run|"") DRY_RUN=true ;;
  *) printf '[deploy-side] 未知参数 %s（用法：--dry-run 或 --apply）\n' "$1" >&2; exit 2 ;;
esac
if ! $DRY_RUN; then
  printf '\n\033[1;31m⚠  --apply：即将用旧快照整包覆盖在产 deployed（不可静默撤销，仅能从 .bak-<时间戳> 恢复）\033[0m\n'
  printf '   目标：%s\n         %s\n' "$DST_USAGE" "$DST_SB"
  printf '   来源：%s（旧快照）\n' "$SRC_USAGE"
  printf '   若只想预览：Ctrl-C 后改用 --dry-run\n\n'
  sleep 5
fi

# ── 2026-09-22 exec-cold-batch (U-CB3 ③): 前置闸门 + 覆盖后复核 ─────────────────
# 与协调者加固的**关系（增量，不覆盖）**：
#   协调者的改动解决"**会不会**误跑"：默认 dry-run、必须 --apply、5 秒红字、未知参数 exit 2。
#   本块解决剩下的一半——"跑起来时**会不会静默**"：
#     ① 用记录的旧快照指纹证明 SRC 确实是旧快照，并把将丢失的单元逐条打出来；
#     ② 证明 deployed 当前状态**确实已被备份**（备份缺失/为空 ⇒ 中止，避免"覆盖了但回不去"）；
#     ③ 覆盖后立即复核 deployed == SRC（证明整包回滚**真的发生了**），并打印红字恢复指引。
#   三处调用点：备份段之后 guard_deploy_preflight；两条 cp -r 之后 guard_deploy_postcopy。
GUARD_SNAPSHOT_DB_MD5="a9a8e785b8864a847ae3979c003e81b1"   # side-deploy/usage/lib/db.js 实测
GUARD_SNAPSHOT_INDEX_MD5="93fb667053ab0230437d7b2d518774a4" # side-deploy/usage/lib/index.js 实测
GUARD_IG_DB_MD5="d187d44932b35a583119f6af97cd82d6"          # U-IG3 完成后的 db.js
GUARD_CB_INDEX_MD5="eae532a7a7bd8c96ebd1abd9aff0f8c9"       # U-CB1+U-CB2 完成后的 index.js
GUARD_DEPLOYED_DB=""
GUARD_DEPLOYED_INDEX=""

guard_md5_of() { if [ -f "$1" ]; then md5sum "$1" | cut -d' ' -f1; else printf 'ABSENT'; fi; }

# 覆盖前状态的取样目录：**apply 模式下第 1 段已把 deployed mv 成 .bak-$TS**，所以
# 真正代表"覆盖前"的是备份目录；dry-run 下备份还不存在，取 deployed 本体。
guard_deployed_probe_dir() {
  if [ -d "$DST_USAGE.bak-$TS" ]; then printf '%s' "$DST_USAGE.bak-$TS"; else printf '%s' "$DST_USAGE"; fi
}

guard_deploy_preflight() {
  say "-- 前置闸门（U-CB3）--"
  local src_db src_index
  src_db="$(guard_md5_of "$SRC_USAGE/lib/db.js")"
  src_index="$(guard_md5_of "$SRC_USAGE/lib/index.js")"
  if [ "$src_db" = "$GUARD_SNAPSHOT_DB_MD5" ] && [ "$src_index" = "$GUARD_SNAPSHOT_INDEX_MD5" ]; then
    say "   快照指纹匹配（db.js=$src_db index.js=$src_index）⇒ SRC 确认为旧快照。"
  else
    say "   WARN 快照指纹不匹配（db.js=$src_db index.js=$src_index）；期望 db.js=$GUARD_SNAPSHOT_DB_MD5 index.js=$GUARD_SNAPSHOT_INDEX_MD5"
    say "        ⇒ SRC 已被改动，本次覆盖的后果需重新评估。"
  fi
  if [ ! -f "$SRC_USAGE/lib/ingest-worker.js" ] && [ ! -f "$SRC_USAGE/lib/ingest-runner.js" ]; then
    say "   已确认 SRC 缺少 ingest-worker.js / ingest-runner.js ⇒ 本次覆盖将整包回滚下列成果："
    say "     U-IG1(worker 化 ingest) / U-IG3(区间对齐·ON CONFLICT·busy_timeout·temp_store·invalidate 导出)"
    say "     U-CC1(CC 游标) / P0-b settings / hour 粒度 / U-CB1(lastIngest 回写) / U-CB2(45s timer)"
  else
    say "   WARN SRC 含 worker 文件，可能不是旧快照 —— 人工复核后再继续。"
  fi
  local probe; probe="$(guard_deployed_probe_dir)"
  GUARD_DEPLOYED_DB="$(guard_md5_of "$probe/lib/db.js")"
  GUARD_DEPLOYED_INDEX="$(guard_md5_of "$probe/lib/index.js")"
  say "   覆盖前 deployed（取样自 $probe）: db.js=$GUARD_DEPLOYED_DB index.js=$GUARD_DEPLOYED_INDEX"
  if [ "$GUARD_DEPLOYED_DB" = "$GUARD_IG_DB_MD5" ]; then
    say "   ⚠ 该 db.js 是 U-IG3 已修版本 ⇒ 覆盖后必须重新落地 U-IG3（否则静默回滚）。"
  fi
  if [ "$GUARD_DEPLOYED_INDEX" = "$GUARD_CB_INDEX_MD5" ]; then
    say "   ⚠ 该 index.js 是 U-CB1+U-CB2 已落地版本 ⇒ 覆盖后必须重跑 apply-CB1-v1 / apply-CB2-v1。"
  fi
  # 备份存在性校验只在真正写盘的模式下有意义：dry-run 时第 1 段（mv）不会执行，
  # 此处必须跳过，否则 dry-run 也会被误判为"无法回滚"而中止。
  if $DRY_RUN; then
    say "   （dry-run：未写盘，跳过备份存在性校验）"
    return 0
  fi
  if [ ! -e "$DST_USAGE.bak-$TS" ]; then
    say "   ERROR 备份 $DST_USAGE.bak-$TS 不存在 —— 覆盖后无法回滚，中止。"
    exit 3
  fi
  if [ ! -s "$DST_USAGE.bak-$TS/lib/index.js" ] || [ ! -s "$DST_USAGE.bak-$TS/lib/db.js" ]; then
    say "   ERROR 备份 $DST_USAGE.bak-$TS 的 lib/index.js 或 lib/db.js 缺失/为空 —— 备份不可用，中止。"
    exit 3
  fi
  say "   备份校验通过：$DST_USAGE.bak-$TS（lib/index.js 与 lib/db.js 均存在且非空）"
}

guard_deploy_postcopy() {
  if $DRY_RUN; then
    say "-- 覆盖后复核（U-CB3）：dry-run 未写盘，跳过 --"
    return 0
  fi
  say "-- 覆盖后复核（U-CB3）--"
  local now_db now_index src_db src_index
  now_db="$(guard_md5_of "$DST_USAGE/lib/db.js")"
  now_index="$(guard_md5_of "$DST_USAGE/lib/index.js")"
  src_db="$(guard_md5_of "$SRC_USAGE/lib/db.js")"
  src_index="$(guard_md5_of "$SRC_USAGE/lib/index.js")"
  say "   覆盖后 deployed: db.js=$now_db index.js=$now_index"
  if [ "$now_db" = "$src_db" ] && [ "$now_index" = "$src_index" ]; then
    say "   已确认 deployed == SRC ⇒ 整包回滚**确实发生**（不是静默部分覆盖）。"
  else
    say "   ERROR 覆盖后 deployed != SRC（$now_db/$now_index vs $src_db/$src_index）—— 状态未知，请人工核查。"
    exit 4
  fi
  printf '\033[1;31m⚠ 恢复路径：备份在 %s.bak-%s；重新落地请重跑 apply-CB1-v1 / apply-CB2-v1（index.js）并重新落地 U-IG3（db.js）\033[0m\n' "$DST_USAGE" "$TS"
  printf '\033[1;31m⚠ 本脚本无"已通过哈希校验"豁免：任何一次 --apply 都会整包覆盖在产 deployed。\033[0m\n'
}

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
guard_deploy_preflight
say "-- 2. 拷贝 --"
run cp -r "$SRC_USAGE" "$DST_USAGE"
run cp -r "$SRC_SB" "$DST_SB"
guard_deploy_postcopy
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
