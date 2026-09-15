#!/usr/bin/env bash
# ============================================================================
# patch-official-slots.sh — 官方 dsh-client-ui-workspace 槽位路径 B 补丁 重放脚本
# ============================================================================
# 规格：.workspace/slot-mod-audit.md §7 落地单元 1/2/4（Path B：sidebar sidecar list 槽）
# 目标：全局树官方包 @deepseek-ai/dsh-client-ui-workspace 两文件：
#   lib/client.js                                  （sidebar.workspaces children 声明 + WorkspaceBrowser 渲染点）
#   lib/types/client/contract/slots.d.ts           （SlotMap 契约卫生）
# 模式（沿用 deploy.sh 三段式）：
#   bash patch-official-slots.sh            dry-run（默认：只打印计划 + 前置校验，不写任何文件）
#   bash patch-official-slots.sh --apply    真实应用（备份 -> patch -p1 -> 校验 -> 与 patched 副本字节比对）
#   bash patch-official-slots.sh --rollback 用最新备份还原（还原后需重启 DSH + 刷新浏览器）
# 幂等：锚点已命中（client.js remoteHosts ≥2 且 slots.d.ts ≥1）则 SKIP。
# 环境变量覆盖：
#   DSH_ROOT        全局树 @deepseek-ai 目录（默认 $HOME/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai）
#   SLOTS_DIR       本脚本所在目录（补丁/副本/备份根）
#   SLOTS_PATCH     补丁文件（默认 $SLOTS_DIR/patches/dsh-client-ui-workspace.remote-hosts-slot.patch）
# 依赖：bash / patch / node（--check）/ diff / grep / cp / mkdir / date
# 说明：本补丁修改的是动态服务的 client.js（E8：按 /plugins/<id>/client.js 从 node_modules 实时读取），
#       生效方式 = 重启 dsh web + 浏览器刷新，无需重建 shell bundle。回滚靠备份还原（全局官方修改）。
# ============================================================================
set -u

MODE="${1:-dry-run}"
case "$MODE" in
  --help|-h)
    sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    echo
    echo "Runbook（应用后）：重启 DSH（npx @deepseek-ai/dsh web），浏览器刷新。"
    echo "期望：不装 ssh-gui 时侧栏无任何变化（空 list 槽渲染空）；装 @local/dsh-ssh-gui 后"
    echo "侧栏出现「远程主机」树（各主机 -> 主机根 -> 逐级浏览 -> 打开为工作区）；"
    echo "底座 SSH 流 / 官方 picker（directoryFlow single 槽）行为不变。"
    exit 0
    ;;
  --apply) APPLY=1 ;;
  --rollback) ROLLBACK=1 ;;
  dry-run) APPLY=0 ;;
  *)
    echo "未知模式：$MODE（可用：dry-run / --apply / --rollback / --help）" >&2
    exit 2
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SLOTS_DIR="${SLOTS_DIR:-$SCRIPT_DIR}"
ROOT="${DSH_ROOT:-$HOME/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai}"
PKG_DIR="$ROOT/dsh-client-ui-workspace"
CLIENT_JS="$PKG_DIR/lib/client.js"
SLOTS_DTS="$PKG_DIR/lib/types/client/contract/slots.d.ts"
PATCH_FILE="${SLOTS_PATCH:-$SLOTS_DIR/patches/dsh-client-ui-workspace.remote-hosts-slot.patch}"
PATCHED_COPY="$SLOTS_DIR/patched/dsh-client-ui-workspace"
BACKUP_ROOT="$SLOTS_DIR"

FAILED=0

say()  { printf '%s\n' "$*"; }
pass() { printf '[PASS] %s\n' "$*"; }
skip() { printf '[SKIP] %s\n' "$*"; }
dry()  { printf '[DRY-RUN] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*" >&2; }
fail() { printf '[FAIL] %s\n' "$*" >&2; FAILED=1; }

# ---------------------------------------------------------------------------
# 前置校验（只读）
# ---------------------------------------------------------------------------
precheck() {
  local missing=0
  for tool in patch node diff grep cp mkdir date; do
    command -v "$tool" >/dev/null 2>&1 || { warn "缺少工具：$tool"; missing=1; }
  done
  [ -d "$PKG_DIR" ] || { warn "目标包不存在：$PKG_DIR（可用 DSH_ROOT 覆盖）"; missing=1; }
  [ -f "$CLIENT_JS" ] || { warn "目标 client.js 不存在：$CLIENT_JS"; missing=1; }
  [ -f "$SLOTS_DTS" ] || { warn "目标 slots.d.ts 不存在：$SLOTS_DTS"; missing=1; }
  [ -f "$PATCH_FILE" ] || { warn "补丁文件不存在：$PATCH_FILE（可用 SLOTS_PATCH 覆盖）"; missing=1; }
  [ -f "$PATCHED_COPY/lib/client.js" ] || { warn "交付副本缺失：$PATCHED_COPY/lib/client.js"; missing=1; }
  [ -f "$PATCHED_COPY/lib/types/client/contract/slots.d.ts" ] || { warn "交付副本缺失：$PATCHED_COPY/lib/types/client/contract/slots.d.ts"; missing=1; }
  [ "$missing" -eq 0 ] || return 1
  return 0
}

# ---------------------------------------------------------------------------
# 幂等锚点（只读）
# ---------------------------------------------------------------------------
slots_applied() {
  [ "$(grep -c 'sidebar.workspaces.remoteHosts' "$CLIENT_JS" 2>/dev/null)" -ge 2 ] \
    && [ "$(grep -c 'sidebar.workspaces.remoteHosts' "$SLOTS_DTS" 2>/dev/null)" -ge 1 ]
}

# ---------------------------------------------------------------------------
# 备份（真实应用前：两文件全量副本，保留相对结构）
# ---------------------------------------------------------------------------
backup_all() {
  local stamp
  stamp="$(date +%Y%m%d-%H%M%S)"
  BACKUP_DIR="$BACKUP_ROOT/backup-$stamp"
  mkdir -p "$BACKUP_DIR/dsh-client-ui-workspace/lib/types/client/contract"
  cp "$CLIENT_JS" "$BACKUP_DIR/dsh-client-ui-workspace/lib/client.js"
  cp "$SLOTS_DTS" "$BACKUP_DIR/dsh-client-ui-workspace/lib/types/client/contract/slots.d.ts"
  say "备份完成：$BACKUP_DIR"
}

# ---------------------------------------------------------------------------
# 校验（node --check + 锚点 + 与交付副本字节比对）
# ---------------------------------------------------------------------------
verify_slots() {
  node --check "$CLIENT_JS" >/dev/null 2>&1 || { fail "client.js node --check 失败"; return 1; }
  local cj dts
  cj="$(grep -c 'sidebar.workspaces.remoteHosts' "$CLIENT_JS")"
  dts="$(grep -c 'sidebar.workspaces.remoteHosts' "$SLOTS_DTS")"
  [ "$cj" -ge 2 ] || { fail "锚点 client.js remoteHosts <2（实得 $cj）"; return 1; }
  [ "$dts" -ge 1 ] || { fail "锚点 slots.d.ts remoteHosts <1（实得 $dts）"; return 1; }
  if diff -q "$PATCHED_COPY/lib/client.js" "$CLIENT_JS" >/dev/null 2>&1 \
     && diff -q "$PATCHED_COPY/lib/types/client/contract/slots.d.ts" "$SLOTS_DTS" >/dev/null 2>&1; then
    pass "live 与交付副本字节一致"
  else
    warn "live 与交付副本不一致（应用后内容可正常但非本交付物原样，请人工核对）"
  fi
  pass "槽位路径 B 补丁（node --check + remoteHosts×$cj / dts×$dts）"
  return 0
}

# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
if [ "${ROLLBACK:-0}" -eq 1 ]; then
  latest="$(ls -d "$BACKUP_ROOT"/backup-* 2>/dev/null | sort | tail -n 1)"
  if [ -z "$latest" ]; then
    warn "未找到备份（$BACKUP_ROOT/backup-*），无法回滚"
    exit 1
  fi
  say "使用最新备份：$latest"
  if [ -f "$latest/dsh-client-ui-workspace/lib/client.js" ]; then
    cp "$latest/dsh-client-ui-workspace/lib/client.js" "$CLIENT_JS"
    say "已还原 client.js"
  fi
  if [ -f "$latest/dsh-client-ui-workspace/lib/types/client/contract/slots.d.ts" ]; then
    cp "$latest/dsh-client-ui-workspace/lib/types/client/contract/slots.d.ts" "$SLOTS_DTS"
    say "已还原 slots.d.ts"
  fi
  if slots_applied; then
    warn "回滚后锚点仍命中（remoteHosts 仍存在）——请人工检查备份时间戳与 live 文件"
  else
    pass "回滚完成：锚点已消失"
  fi
  say "请重启 DSH（npx @deepseek-ai/dsh web）并刷新浏览器使客户端改动生效。"
  exit "$FAILED"
fi

say "===== patch-official-slots：$( [ "${APPLY:-0}" -eq 1 ] && echo 'APPLY（将修改全局官方包）' || echo 'DRY-RUN（不写任何文件）' ) ====="
say "PKG_DIR=$PKG_DIR"

precheck || { fail "前置校验未通过"; exit 1; }
say "前置校验通过"

if slots_applied; then
  say "锚点已命中（client.js remoteHosts≥2 且 slots.d.ts≥1），已应用，无操作。"
  verify_slots
  exit "$FAILED"
fi

if [ "${APPLY:-0}" -eq 0 ]; then
  dry "将备份两文件到 $BACKUP_ROOT/backup-<时间戳>/"
  dry "将 patch -p1 应用 $PATCH_FILE（于 $PKG_DIR，先 --dry-run 预检）"
  dry "校验：node --check + 锚点 remoteHosts≥2/≥1 + 与交付副本字节比对"
  say "===== DRY-RUN 完成（未写任何文件）====="
  exit 0
fi

# 真实应用：备份 -> patch 预检 -> patch 应用 -> 校验
backup_all
if ! (cd "$PKG_DIR" && patch --batch -p1 --dry-run < "$PATCH_FILE" >/dev/null 2>&1); then
  fail "patch dry-run 未命中（live 官方文件可能已漂移，需重新锚定 .workspace/deploy-slots/patches），中止（未写任何文件）"
  exit 1
fi
if ! (cd "$PKG_DIR" && patch --batch -p1 < "$PATCH_FILE" >/dev/null 2>&1); then
  fail "patch 应用失败"
  exit 1
fi
if ! verify_slots; then
  say "===== 校验失败（已备份，可用 --rollback 还原）====="
  exit 1
fi
say "===== 槽位路径 B 官方补丁应用完成 ====="
say "提示：这是全局官方修改（workspace 包被所有 profile 共用）。生效需重启 DSH + 刷新浏览器；"
say "      回滚：bash patch-official-slots.sh --rollback（还原最新备份）或从 $BACKUP_DIR 手工还原。"
exit "$FAILED"
