#!/usr/bin/env bash
# ============================================================================
# patch-official-015.sh — 0.1.5-rc.2 增量借码重放脚本（P0/P1/P2 全采纳）
# ============================================================================
# 规格：.workspace/upstream-015-diff.md §3（值得借鉴短清单）；.workspace/borrow-015-exec.md（本档执行报告）
# 目标：live 全局树 12 包（dsh-tool-web / dsh-atomic-write / dsh-goal-round-driver /
#       dsh-user-approval / dsh-mcp-client / dsh-tool-fs-search / dsh-tool-bash-persistent /
#       dsh-fs / dsh-fs-local / dsh-tool-str-replace-editor / dsh-launch-environment /
#       dsh-llm-deepseek）应用 0.1.5 最小移植补丁（patch -p1 于包目录）
# 与 replay-lag-fix.sh 的关系：**独立脚本**。理由见 borrow-015-exec.md §5：
#   ① 主题正交（lag-fix=卡顿修复；015=上游增量借码），前置依赖不同（本脚本不需要
#      PATCH_TGZ/settings.yaml/pyyaml，只需要 patch/diff/node/grep/cp）；
#   ② 12 个新单元与 lag-fix 的 5 补丁包零文件重叠，合并会稀释 lag-fix 的 sha256 锚点
#      语义且动已验收脚本引入回归风险；
#   ③ 单元化一致性：本脚本每一单元独立 backup/apply/verify/rollback/幂等锚点，
#      与 replay-lag-fix.sh 模式同构，可独立 dry-run/回滚。
# 模式：
#   ./patch-official-015.sh            默认执行（备份 -> 应用 -> 校验）
#   ./patch-official-015.sh --dry-run  只打印将执行的步骤 + 全部前置校验，不写任何文件
#   ./patch-official-015.sh --rollback 用最新备份还原（还原后需重启 DSH）
#   ./patch-official-015.sh --help     打印用法
# 幂等：每单元已应用（锚点 grep 命中且应用后 sha256 与 known-sha256-015.txt 全等）则跳过并提示 SKIP
# 环境变量覆盖：
#   DSH_ROOT        全局树 @deepseek-ai 目录（默认 $HOME/.npm-global/...）
#   P015_DIR        补丁与锚点根目录（默认 .workspace/deploy-015，相对脚本位置解析）
#   P015_BACKUP_DIR 备份根目录（默认本脚本所在目录）
# 依赖：bash / tar?（不需要）/ sha256sum / cmp / grep / cp / mv / patch / diff / node（--check）
# 注意：本脚本只负责 12 个借码包；5 个既有补丁包（agent-loop/host-apiproxy/subagent/
#       client-ui-subagent/web-search-deepseek）仍由 replay-lag-fix.sh 管理，勿混用。
# ============================================================================
set -u

MODE="${1:-run}"
case "$MODE" in
  --help|-h)
    sed -n '2,34p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    echo
    echo "Runbook（应用后）：重启 DSH（npx @deepseek-ai/dsh web）。"
    echo "各单元验证方式见 borrow-015-exec.md（锚点 + node --check + 冒烟）。"
    exit 0
    ;;
  --dry-run) DRY=1 ;;
  --rollback) ROLLBACK=1 ;;
  run) DRY=0 ;;
  *)
    echo "未知模式：$MODE（可用：run / --dry-run / --rollback / --help）" >&2
    exit 2
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${DSH_ROOT:-$HOME/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai}"
P015="${P015_DIR:-$SCRIPT_DIR/../deploy-015}"
BACKUP_ROOT="${P015_BACKUP_DIR:-$SCRIPT_DIR}"
KNOWN="$P015/known-sha256-015.txt"
PATCHES="$P015/patches"

FAILED=0

say()  { printf '%s\n' "$*"; }
pass() { printf '[PASS] %s\n' "$*"; }
skip() { printf '[SKIP] %s\n' "$*"; }
dry()  { printf '[DRY-RUN] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*" >&2; }
fail() { printf '[FAIL] %s\n' "$*" >&2; FAILED=1; }

# ---------------------------------------------------------------------------
# 单元表：pkg|patch 文件|锚点 grep 表达式|锚点最小计数|适用平台注释
#   锚点计数在"应用后完整副本"上实测（node --check + grep -c）
# ---------------------------------------------------------------------------
UNITS=(
  "dsh-tool-web|dsh-tool-web.untrusted-notice.patch|EXTERNAL_WEB_CONTENT_NOTICE|3|全平台（提示注入防御）"
  "dsh-atomic-write|dsh-atomic-write.windows-rename-retry.patch|renameAtomicTemp|2|Windows 生效；Linux no-op（isTransientWindowsRenameError 先判平台）"
  "dsh-goal-round-driver|dsh-goal-round-driver.attempt-attribution.patch|attempt.goalId === goal.id && attempt.revision === goal.revision|1|全平台"
  "dsh-user-approval|dsh-user-approval.scopeTarget-routing.patch|scopeTarget(req.agent, req.agent)|1|全平台"
  "dsh-mcp-client|dsh-mcp-client.cursor-dedup.patch|seenCursors|3|全平台"
  "dsh-tool-fs-search|dsh-tool-fs-search.win32-rg-sidecar.patch|-rg.exe|1|Windows sidecar 修复；Linux 分支保持 execPath-rg 拼接"
  "dsh-tool-bash-persistent|dsh-tool-bash-persistent.status-report.patch|TIMEOUT_STATUS_MARKER|2|全平台"
  "dsh-fs|dsh-fs.byte-range-api.patch|processPathFromHostPath|1|全平台（纯 API 新增）"
  "dsh-fs-local|dsh-fs-local.byte-range-api.patch|readByteWindow|2|全平台（纯 API 新增）"
  "dsh-tool-str-replace-editor|dsh-tool-str-replace-editor.null-placeholder.patch|newStr === null|1|全平台"
  "dsh-launch-environment|dsh-launch-environment.launched-through-ssh.patch|launchedThroughSsh|2|全平台（0.1.1 无消费者，纯导出新增）"
  "dsh-llm-deepseek|dsh-llm-deepseek.image-tokens.patch|deepSeekImageTokens|2|全平台（纯函数定价模块，零新依赖）"
)

# ---------------------------------------------------------------------------
# 前置校验（只读）
# ---------------------------------------------------------------------------
precheck() {
  local tool missing=0
  for tool in sha256sum cmp grep cp mv patch diff node; do
    command -v "$tool" >/dev/null 2>&1 || { warn "缺少工具：$tool"; missing=1; }
  done
  [ -d "$ROOT/dsh-tool-web/lib" ] || { warn "全局树不存在：$ROOT（可用 DSH_ROOT 覆盖）"; missing=1; }
  [ -f "$KNOWN" ] || { warn "known-sha256-015.txt 不存在：$KNOWN（可用 P015_DIR 覆盖）"; missing=1; }
  [ -d "$PATCHES" ] || { warn "补丁目录不存在：$PATCHES（可用 P015_DIR 覆盖）"; missing=1; }
  local i entry pkg patchfile
  for i in "${UNITS[@]}"; do
    pkg="${i%%|*}"; patchfile="$(echo "$i" | cut -d'|' -f2)"
    [ -f "$PATCHES/$patchfile" ] || { warn "补丁缺失：$PATCHES/$patchfile"; missing=1; }
    [ -d "$ROOT/$pkg" ] || { warn "目标包缺失：$ROOT/$pkg"; missing=1; }
  done
  # known-sha256-015.txt 条目完整性（每单元至少 1 条锚点文件）
  local need
  need="dsh-tool-web/lib/index.js dsh-atomic-write/lib/index.js dsh-goal-round-driver/lib/index.js dsh-user-approval/lib/index.js dsh-mcp-client/lib/index.js dsh-tool-fs-search/lib/index.js dsh-tool-bash-persistent/lib/index.js dsh-fs/lib/index.js dsh-fs/lib/types/index.d.ts dsh-fs-local/lib/index.js dsh-fs-local/lib/types/index.d.ts dsh-fs-local/lib/types/fsio.d.ts dsh-tool-str-replace-editor/lib/index.js dsh-launch-environment/lib/index.js dsh-launch-environment/lib/types/index.d.ts dsh-llm-deepseek/lib/index.js dsh-llm-deepseek/lib/types/index.d.ts dsh-llm-deepseek/lib/types/image-tokens.d.ts"
  for e in $need; do
    awk -v e="$e" '$2==e{n++} END{exit n==0}' "$KNOWN" || { warn "known-sha256-015.txt 缺条目：$e"; missing=1; }
  done
  [ "$missing" -eq 0 ] || return 1
  return 0
}

# ---------------------------------------------------------------------------
# 单元状态判断（幂等锚点，只读）
#   已应用判定 = 锚点 grep 命中 + 应用后 sha256 与 known 全等（双保险）
# ---------------------------------------------------------------------------
unit_applied() {
  local pkg="$1" anchor="$2" mincount="$3"
  local js="$ROOT/$pkg/lib/index.js"
  [ -f "$js" ] || return 1
  local count
  count="$(grep -c -- "$anchor" "$js" 2>/dev/null || true)"
  [ "${count:-0}" -ge "$mincount" ] || return 1
  # sha256 校验：该单元所有 known 条目对应文件必须全等
  local rel got want ok=1
  for rel in $(awk -v p="$pkg/" '$2 ~ "^"p{print $2}' "$KNOWN"); do
    [ -f "$ROOT/$rel" ] || { ok=0; break; }
    got="$(sha256sum "$ROOT/$rel" | awk '{print $1}')"
    want="$(awk -v r="$rel" '$2==r{print $1}' "$KNOWN")"
    [ "$got" = "$want" ] || { ok=0; break; }
  done
  [ "$ok" -eq 1 ]
}

# ---------------------------------------------------------------------------
# 备份（真实执行时：任一单元需要应用即先全量快照 12 包）
# ---------------------------------------------------------------------------
backup_all() {
  local stamp pkg
  stamp="$(date +%Y%m%d-%H%M%S)"
  BACKUP_DIR="$BACKUP_ROOT/backup-015-$stamp"
  mkdir -p "$BACKUP_DIR"
  for pkg in dsh-tool-web dsh-atomic-write dsh-goal-round-driver dsh-user-approval dsh-mcp-client dsh-tool-fs-search dsh-tool-bash-persistent dsh-fs dsh-fs-local dsh-tool-str-replace-editor dsh-launch-environment dsh-llm-deepseek; do
    if [ -d "$ROOT/$pkg" ]; then
      cp -r "$ROOT/$pkg" "$BACKUP_DIR/$pkg"
    else
      warn "备份跳过缺失包：$pkg"
    fi
  done
  say "备份完成：$BACKUP_DIR"
}

# ---------------------------------------------------------------------------
# 单单元应用：patch -p1 于包目录（dry-run 预检 -> 应用 -> 幂等锚点判定）
# ---------------------------------------------------------------------------
apply_unit() {
  local pkg="$1" patchfile="$2" anchor="$3" mincount="$4" note="$5"
  if unit_applied "$pkg" "$anchor" "$mincount"; then
    skip "$pkg 已应用（锚点 $anchor ≥$mincount + sha256 全等）[$note]"
    return 0
  fi
  if [ "$DRY" -eq 1 ]; then
    dry "$pkg 将 patch -p1 应用 $PATCHES/$patchfile（于 $ROOT/$pkg，先 dry-run 预检）[$note]"
    return 0
  fi
  if ! (cd "$ROOT/$pkg" && patch --batch -p1 --dry-run < "$PATCHES/$patchfile" >/dev/null 2>&1); then
    fail "$pkg patch dry-run 未命中（live 文件可能已漂移，需重新锚定 deploy-015/patches），中止"
    return 1
  fi
  if ! (cd "$ROOT/$pkg" && patch --batch -p1 < "$PATCHES/$patchfile" >/dev/null 2>&1); then
    fail "$pkg patch 应用失败"
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# 校验（每单元，任一失败 -> FAIL + 退出非零，不回滚）
# ---------------------------------------------------------------------------
verify_unit() {
  local pkg="$1" anchor="$2" mincount="$3" note="$4"
  # node --check 该单元所有 .js（避免 import 副作用：--check 只解析不执行）
  local js
  for js in "$ROOT/$pkg"/lib/*.js; do
    [ -f "$js" ] || continue
    node --check "$js" >/dev/null 2>&1 || { fail "$pkg $(basename "$js") node --check 失败"; return 1; }
  done
  local count
  count="$(grep -c -- "$anchor" "$ROOT/$pkg/lib/index.js" 2>/dev/null || true)"
  [ "${count:-0}" -ge "$mincount" ] || { fail "$pkg 锚点 $anchor 计数 ${count:-0} < $mincount"; return 1; }
  # 应用后 sha256 与 known 全等（部署后字节锚点）
  local rel got want ok=1
  for rel in $(awk -v p="$pkg/" '$2 ~ "^"p{print $2}' "$KNOWN"); do
    got="$(sha256sum "$ROOT/$rel" | awk '{print $1}')"
    want="$(awk -v r="$rel" '$2==r{print $1}' "$KNOWN")"
    [ "$got" = "$want" ] || { fail "$pkg $rel sha256 与 known 不符（实得 $got）"; ok=0; }
  done
  [ "$ok" -eq 1 ] || return 1
  pass "$pkg 借码补丁（node --check + 锚点 $anchor ≥$mincount + sha256 全等）[$note]"
  return 0
}

# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
if [ "${ROLLBACK:-0}" -eq 1 ]; then
  latest="$(ls -d "$BACKUP_ROOT"/backup-015-* 2>/dev/null | sort | tail -n 1)"
  if [ -z "$latest" ]; then
    warn "未找到备份（$BACKUP_ROOT/backup-015-*），无法回滚"
    exit 1
  fi
  say "使用最新备份：$latest"
  for pkg in dsh-tool-web dsh-atomic-write dsh-goal-round-driver dsh-user-approval dsh-mcp-client dsh-tool-fs-search dsh-tool-bash-persistent dsh-fs dsh-fs-local dsh-tool-str-replace-editor dsh-launch-environment dsh-llm-deepseek; do
    if [ -d "$latest/$pkg" ]; then
      rm -rf "$ROOT/$pkg"
      mv "$latest/$pkg" "$ROOT/$pkg"
      say "已还原 $pkg"
    fi
  done
  say "回滚完成。请重启 DSH（npx @deepseek-ai/dsh web）使宿主侧改动生效。"
  exit 0
fi

say "===== patch-official-015：$( [ "$DRY" -eq 1 ] && echo 'DRY-RUN（不写任何文件）' || echo '执行' ) ====="
say "ROOT=$ROOT"
say "P015=$P015"
say "BACKUP_ROOT=$BACKUP_ROOT"

precheck || { fail "前置校验未通过"; exit 1; }
say "前置校验通过"

# 需要应用任何单元？决定是否备份
needs_apply=0
for i in "${UNITS[@]}"; do
  pkg="${i%%|*}"; anchor="$(echo "$i" | cut -d'|' -f3)"; mincount="$(echo "$i" | cut -d'|' -f4)"
  unit_applied "$pkg" "$anchor" "$mincount" || needs_apply=1
done

if [ "$needs_apply" -eq 0 ]; then
  say "全部单元均已应用，无操作。"
  exit 0
fi
if [ "$DRY" -eq 1 ]; then
  dry "将先全量备份 12 包到 $BACKUP_ROOT/backup-015-<时间戳>/"
else
  backup_all
fi

# --- 逐单元应用 + 校验 ---
for i in "${UNITS[@]}"; do
  pkg="${i%%|*}"; rest="${i#*|}"; patchfile="${rest%%|*}"; rest="${rest#*|}"; anchor="${rest%%|*}"; rest="${rest#*|}"; mincount="${rest%%|*}"; note="${rest#*|}"
  apply_unit "$pkg" "$patchfile" "$anchor" "$mincount" "$note" || exit 1
  if [ "$DRY" -eq 0 ]; then
    verify_unit "$pkg" "$anchor" "$mincount" "$note" || exit 1
  fi
done

if [ "$DRY" -eq 1 ]; then
  say "===== DRY-RUN 完成（未写任何文件）====="
  exit 0
fi

if [ "$FAILED" -eq 0 ]; then
  say "===== 全部单元 PASS ====="
  say "提示：宿主侧改动（12 包）需重启 DSH 生效；"
  say "      5 个既有补丁包仍由 replay-lag-fix.sh 管理，本脚本未触碰。"
else
  say "===== 存在 FAIL 单元（需人工介入或 --rollback）====="
fi
exit "$FAILED"
