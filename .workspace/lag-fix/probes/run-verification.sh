#!/usr/bin/env bash
# ============================================================================
# run-verification.sh — lag-fix 自复核一键闭环（dry-run → diff → 语法 → 等价性 → 冒烟 → 守卫）
# ============================================================================
# 全程只读真实文件 / 只读 usage.db：dry-run 与后续复核只写工作区临时目录。
# 用法：
#   ./run-verification.sh                 # 默认 --target source
#   ./run-verification.sh --target source
#   ./run-verification.sh --target deployed
# 说明：本插件存在两份互不相同的拷贝（工作区源码 / profile 部署拷贝）。两者的
#       **补丁目标区域逐字节相同**（见 patches/usage-plugin.sh --compare 的矩阵），
#       所以同一套复核对两个 target 都跑；`--target` 决定从哪一份取原件来验证。
# 步骤：
#   1) usage-plugin.sh --dry-run --target <t>   副本上应用，打印 diff -u + 锚点/语法结果
#   2) 记录 --dry-run 前后真实文件 sha256（证明真实文件未被触碰）
#   3) 在 tmp/mod/ 下重建副本（含 node_modules/@deepseek-ai/dsh-home-paths 软链）
#   4) 解出 tmp/mod/{orig,patched}-db.js 与 tmp/{orig,patched}/（原件快照）
#   5) verify-daily-equivalence.mjs             只读复核 daily 与 events 逐行一致 + 闸门 + 计划
#   6) smoke-client-bundle.mjs                  客户端 bundle 真实执行 + 源码抽取求值
#   7) float-trap-guard.py                      浮点日边界陷阱守卫
# 产物：reports/dry-run-<target>.txt、reports/verify-daily-equivalence-<target>.json、
#       reports/smoke-client-patched-<target>.json、tmp/orig/、tmp/patched/、tmp/mod/
# ============================================================================
set -u
TARGET="source"
while [ $# -gt 0 ]; do
  case "$1" in
    --target) shift; TARGET="${1:-}" ;;
    --target=*) TARGET="${1#--target=}" ;;
    *) echo "未知参数：$1（用法：$0 [--target source|deployed]）" >&2; exit 2 ;;
  esac
  shift
done
case "$TARGET" in
  source|deployed) ;;
  *) echo "未知 --target：$TARGET（可用：source / deployed）" >&2; exit 2 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$WORK/../.." && pwd)"
if [ "$TARGET" = "source" ]; then
  DEFAULT_PKG="$REPO_ROOT/dsh-usage"
else
  DEFAULT_PKG="$HOME/.dsh/profiles/node_modules/@local/dsh-usage"
fi
PKG="${USAGE_PKG_DIR:-$DEFAULT_PKG}"
LIB="$PKG/lib"
TMP="$WORK/tmp"
DB="${USAGE_DB:-$HOME/.dsh/storages/usage/usage.db}"
FAILED=0
say() { printf '%s\n' "$*"; }

PATCH_SH="$WORK/patches/usage-plugin.sh"
MOD="$TMP/mod"          # 模块根：Node 从它向上找 node_modules/@deepseek-ai/dsh-home-paths
mkdir -p "$TMP/orig" "$TMP/patched" "$MOD/node_modules/@deepseek-ai" "$WORK/reports"
printf '{"type":"module"}\n' > "$MOD/package.json"
cp -p "$LIB/db.js" "$TMP/orig/db.js"
cp -p "$LIB/client.js" "$TMP/orig/client.js"
cp -p "$LIB/db.js" "$MOD/orig-db.js"

say "target=$TARGET  PKG=$PKG"
say "── 1) dry-run（副本应用 + diff + 校验）──"
bash "$PATCH_SH" --dry-run --target "$TARGET" | tee "$WORK/reports/dry-run-$TARGET.txt" >/dev/null
DRY_RC="${PIPESTATUS[0]}"
say "   dry-run 退出码 = $DRY_RC（0 = 通过）"
[ "$DRY_RC" -eq 0 ] || FAILED=1

say "── 2) 真实文件 sha256（应用前/后必须完全一致）──"
(cd "$LIB" && sha256sum db.js client.js) | tee "$TMP/live-after-dryrun.sha256"
(cd "$TMP/orig" && sha256sum -c "$TMP/live-after-dryrun.sha256" >/dev/null 2>&1) \
  && say "   [PASS] 真实文件与 dry-run 前快照逐字节一致（dry-run 未触碰真实路径）" \
  || { say "   [FAIL] 真实文件在 dry-run 期间发生变化"; FAILED=1; }

say "── 3) 取用 dry-run 产出的 pre/post 副本并核对 live ──"
# dry-run 已把「pre-patch 基线」（= 备份 pre-sha 内容或 live 本体）与「应用后副本」都留在了
# 工作区内，这里直接取用，避免在这里再跑一遍替换（同一份证据，且对 live 状态无假设）。
DRY_DIR="$(ls -d "$WORK"/tmp/dryrun-$TARGET-* 2>/dev/null | sort | tail -n 1)"
if [ -z "$DRY_DIR" ]; then
  say "   [FAIL] 找不到 dry-run 副本目录（$WORK/tmp/dryrun-$TARGET-*）"
  FAILED=1
else
  say "   使用副本：$DRY_DIR"
  cp -p "$DRY_DIR/db.js" "$MOD/patched-db.js"          # 应用后副本
  cp -p "$DRY_DIR/client.js" "$MOD/patched-client.js"
  cp -p "$DRY_DIR/db.js.pre" "$MOD/pre-db.js"          # pre-patch 基线
  cp -p "$DRY_DIR/client.js.pre" "$MOD/pre-client.js"
  cp -p "$DRY_DIR/SHA256SUMS.orig" "$MOD/pre.sha256"
  cp -p "$DRY_DIR/db.js" "$TMP/patched/db.js"
  cp -p "$DRY_DIR/client.js" "$TMP/patched/client.js"
  # 基线（pre）与补丁后（post）必须不同 —— 否则说明 dry-run 没真正改到东西
  # 注意：pre-* 是 pre-patch 基线，patched-* 是应用后副本，live 是真实文件
  PRE_DB="$(sha256sum "$MOD/pre-db.js" | cut -d' ' -f1)"
  POST_DB="$(sha256sum "$MOD/patched-db.js" | cut -d' ' -f1)"
  LIVE_DB="$(sha256sum "$LIB/db.js" | cut -d' ' -f1)"
  PRE_C="$(sha256sum "$MOD/pre-client.js" | cut -d' ' -f1)"
  POST_C="$(sha256sum "$MOD/patched-client.js" | cut -d' ' -f1)"
  LIVE_C="$(sha256sum "$LIB/client.js" | cut -d' ' -f1)"
  if [ -f "$MOD/pre.sha256" ]; then
    PRE_MANIFEST="$(awk '{print substr($1,1,12)}' "$MOD/pre.sha256" | tr '\n' ' ')"
    say "   基线清单(SHA256SUMS.orig)=$PRE_MANIFEST"
    (cd "$MOD" && sha256sum -c <(sed 's| db.js$| pre-db.js|; s| client.js$| pre-client.js|' "$MOD/pre.sha256") >/dev/null 2>&1) \
      && say "   [PASS] pre 快照与 SHA256SUMS.orig 一致（基线身份确认）" \
      || { say "   [FAIL] pre 快照与 SHA256SUMS.orig 不符"; FAILED=1; }
  fi
  say "   db.js     pre=${PRE_DB:0:12} post=${POST_DB:0:12} live=${LIVE_DB:0:12}"
  say "   client.js pre=${PRE_C:0:12} post=${POST_C:0:12} live=${LIVE_C:0:12}"
  [ "$PRE_DB" != "$POST_DB" ] && [ "$PRE_C" != "$POST_C" ] \
    && say "   [PASS] 副本确实被执行了替换（pre ≠ post）" \
    || { say "   [FAIL] pre == post（副本未发生替换）"; FAILED=1; }
  if [ "$POST_DB" = "$LIVE_DB" ] && [ "$POST_C" = "$LIVE_C" ]; then
    say "   [PASS] live 与「应用后副本」逐字节一致（live 已处于本单元改后状态）"
  elif [ "$PRE_DB" = "$LIVE_DB" ] && [ "$PRE_C" = "$LIVE_C" ]; then
    say "   [INFO] live 仍是 pre 状态（本单元尚未 --apply，符合预期）"
  else
    say "   [FAIL] live 既非本单元 pre 也非 post（live 被第三方改动？）"
    FAILED=1
  fi
fi

say "── 4) node --check（副本语法）──"
node --check "$TMP/patched/db.js" >/dev/null 2>&1 && say "   [PASS] node --check db.js（补丁后）" || { say "   [FAIL] node --check db.js"; FAILED=1; }
node --check "$TMP/patched/client.js" >/dev/null 2>&1 && say "   [PASS] node --check client.js（补丁后）" || { say "   [FAIL] node --check client.js"; FAILED=1; }
node --check "$TMP/orig/client.js" >/dev/null 2>&1 && say "   [PASS] node --check client.js（原件，对照）" || say "   [WARN] 原件 client.js node --check 不过（客户端 bundle 常含非严格语法，不阻塞）"
[ -e "$MOD/node_modules/@deepseek-ai/dsh-home-paths" ] && say "   [PASS] 复核用依赖解析就绪（node_modules 软链存在）" || { say "   [FAIL] 依赖软链缺失"; FAILED=1; }

say "── 5) 只读等价性复核（daily vs events 逐行一致 + 闸门 + EXPLAIN）──"
node "$SCRIPT_DIR/verify-daily-equivalence.mjs" \
  --live "$MOD/pre-db.js" --patched "$MOD/patched-db.js" --db "$DB" \
  --out "$WORK/reports/verify-daily-equivalence-$TARGET.json" | tee "$WORK/reports/verify-daily-equivalence-$TARGET.txt"
VER_RC="${PIPESTATUS[0]}"
say "   verifier 退出码 = $VER_RC（0 = 全 PASS）"
[ "$VER_RC" -eq 0 ] || FAILED=1

say "── 6) 客户端 bundle 冒烟 + 浮点陷阱守卫 ──"
node "$SCRIPT_DIR/smoke-client-bundle.mjs" --client "$TMP/patched/client.js" \
  --json "$WORK/reports/smoke-client-patched-$TARGET.json" | tee "$WORK/reports/smoke-client-patched-$TARGET.txt"
SMOKE_RC="${PIPESTATUS[0]}"
say "   smoke 退出码 = $SMOKE_RC（0 = 全 PASS）"
[ "$SMOKE_RC" -eq 0 ] || FAILED=1

say "── 7) 浮点陷阱守卫（禁止对非新建 Date 的 getTime() 做 ±1 取日边界）──"
GUARD_BAD=0
for f in "$TMP/patched/db.js" "$TMP/patched/client.js"; do
  BAD_LINES="$(python3 "$SCRIPT_DIR/float-trap-guard.py" "$f" 2>/dev/null)"
  if [ -n "$BAD_LINES" ]; then
    say "   [FAIL] $(basename "$f") 存在对非新建 Date 的 getTime() 做 ±1 的日边界写法："
    printf '%s\n' "$BAD_LINES" | sed 's/^/      /'
    GUARD_BAD=1
  fi
done
[ "$GUARD_BAD" -eq 0 ] && say "   [PASS] 无浮点日边界陷阱（±1 只作用在新建 Date 的整数毫秒上；实测踩坑 3 次）" || FAILED=1

say ""
if [ "$FAILED" -eq 0 ]; then
  say "===== 自复核全部通过（target=$TARGET，真实文件未被修改；应用请执行 --apply --target $TARGET）====="
else
  say "===== 自复核存在失败项，请勿 --apply ====="
fi
exit "$FAILED"
