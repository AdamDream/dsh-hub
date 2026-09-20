#!/usr/bin/env bash
# ============================================================================
# workspace-enhancement-perf.sh — 第三方插件 dsh-workspace-enhancement 热点修补 重放脚本
# ============================================================================
# 单元：C2（DIAGNOSIS.md §2.2 / §3 第 7 项：第三方插件在同热点路径上的开销）
#   C2-1 remoteSessionIndex 内层 O(k²) 去重 → Set（保持首次出现顺序与判定语义）
#   C2-2 sessions() 全量重建 → 按快照引用记忆化（返回值语义等价：内容与顺序一致）
# 目标文件（唯一）：/home/CNS2026495165/.dsh/profiles/node_modules/dsh-workspace-enhancement/lib/client.js
#   ※ 只改 client.js；同目录 client.js.map 不动（会失真，非本单元范围）
# 模式（沿用 deploy-lag / deploy-slots 三段式惯例）：
#   bash workspace-enhancement-perf.sh --dry-run   工作区临时副本上应用 + diff -u + 全部校验（不写 live）
#   bash workspace-enhancement-perf.sh --apply     备份 -> 应用 -> node --check + 锚点 + 字节校验
#   bash workspace-enhancement-perf.sh --rollback  用最新备份还原（还原后需刷新浏览器，无需重启宿主）
#   （无参数 = --dry-run）
# 幂等：live 已达补丁后状态（sha256 命中或新 token 命中）→ SKIP，不重复改写
# 前置：live sha256 必须等于补丁前基线（--rollback 不受此限）；漂移则 FAIL 且不写任何 live 文件
# 硬约束：不重启/不停/不发信号给宿主进程；不压测；备份与全部产物只落工作区
# 环境变量覆盖：
#   DSW_PLUGIN_DIR  插件目录（默认 $HOME/.dsh/profiles/node_modules/dsh-workspace-enhancement）
#   LAGFIX_DIR      本脚本所在目录（补丁副本 / 备份 / 报告根）
# 依赖：bash / node / diff / grep / sha256sum / cp / install / mkdir / date / mktemp
# ============================================================================
set -u

MODE="dry-run"
case "${1:---dry-run}" in
  --help|-h)
    sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  --dry-run) MODE="dry-run" ;;
  --apply)   MODE="apply" ;;
  --rollback) MODE="rollback" ;;
  *) echo "未知模式：$1（可用：--dry-run / --apply / --rollback / --help）" >&2; exit 2 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAGFIX_DIR="${LAGFIX_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
PLUGIN_DIR="${DSW_PLUGIN_DIR:-$HOME/.dsh/profiles/node_modules/dsh-workspace-enhancement}"
CLIENT_JS="$PLUGIN_DIR/lib/client.js"
PATCHER="$LAGFIX_DIR/tools/make-patched.mjs"
PATCHED_COPY="$LAGFIX_DIR/patched/workspace-enhancement.client.js"   # 独立命名：避免与 C1 的 client-runtime 产物同名互覆
BACKUP_ROOT="$LAGFIX_DIR/patches/backup/C2"   # 单元独占：backup/ 为多档共用，回滚 tail -1 会误取他档快照
BASELINE="$SCRIPT_DIR/baseline.sha256"   # 人类可读的基线记录（常量 L*_SHA 是权威）

# --- 补丁前/后基线（内容 hash，非行号：line 4121/5415 仅供人工对照） -------------------
LIVE_PRE_SHA="aef0a3e663af487abe91698135c7cc70b3138ad4716475fdd5a52e1293fed094"
PATCHED_SHA="7df7a655ee660eb29dd8ee87d4b20fa3f06a16faee80c52baf612d6e7ffef90d"
# 补丁后 token（各 1 次 = 已应用判据）
NEW_TOKEN_1='const unique = Array.from(new Set(ids));'
NEW_TOKEN_2='sessions: (() => {'
# 补丁前 token（C2-1 全局 2 次 → 补丁后 1 次；C2-2 全局 1 次 → 补丁后 0 次）
OLD_TOKEN_1='const unique = ids.filter((id, index) => ids.indexOf(id) === index);'
OLD_TOKEN_2='sessions: () => {'

FAILED=0
say()  { printf '%s\n' "$*"; }
pass() { printf '[PASS] %s\n' "$*"; }
skip() { printf '[SKIP] %s\n' "$*"; }
dry()  { printf '[DRY-RUN] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*" >&2; }
fail() { printf '[FAIL] %s\n' "$*" >&2; FAILED=1; }
# 计数：grep -c 无命中时会打印 "0" 并以 1 退出（会与 || 兜底叠加成两行），故改为逐行计数
cnt()  { grep -F -c -- "$2" "$1" 2>/dev/null | head -n 1 || true; }
sha()  { sha256sum "$1" 2>/dev/null | awk '{print $1}'; }

# live 文件权限（用于 install -m 保持；stat 不可用时回落 644）
file_mode() { stat -c '%a' "$1" 2>/dev/null || printf '644'; }

TMPDIRS=()
cleanup() { local d; for d in "${TMPDIRS[@]:-}"; do [ -n "$d" ] && rm -rf "$d"; done; }
trap cleanup EXIT

# ---------------------------------------------------------------------------
# 前置校验（只读）
# ---------------------------------------------------------------------------
precheck() {
  local tool missing=0
  for tool in node diff grep sha256sum cp install mkdir date mktemp; do
    command -v "$tool" >/dev/null 2>&1 || { warn "缺少工具：$tool"; missing=1; }
  done
  [ -d "$PLUGIN_DIR" ] || { warn "插件目录不存在：$PLUGIN_DIR（可用 DSW_PLUGIN_DIR 覆盖）"; missing=1; }
  [ -f "$CLIENT_JS" ] || { warn "目标文件不存在：$CLIENT_JS"; missing=1; }
  [ -f "$PATCHER" ] || { warn "patcher 不存在：$PATCHER"; missing=1; }
  [ -f "$PATCHED_COPY" ] || { warn "交付副本不存在：$PATCHED_COPY"; missing=1; }
  [ "$missing" -eq 0 ] || return 1

  # 交付副本自身完整性（防交付物被改：必须是补丁后状态、语法正确、hash 命中基线）
  local pc_sha
  pc_sha="$(sha "$PATCHED_COPY")"
  if [ "$pc_sha" != "$PATCHED_SHA" ]; then
    warn "交付副本 sha256 与基线不符（实得 $pc_sha，期望 $PATCHED_SHA）"; missing=1
  fi
  if ! node --check "$PATCHED_COPY" >/dev/null 2>&1; then
    warn "交付副本 node --check 失败"; missing=1
  fi
  if [ "$(cnt "$PATCHED_COPY" "$NEW_TOKEN_1")" != "1" ] || [ "$(cnt "$PATCHED_COPY" "$NEW_TOKEN_2")" != "1" ]; then
    warn "交付副本未包含补丁后 token（NEW_TOKEN_1=$(cnt "$PATCHED_COPY" "$NEW_TOKEN_1") NEW_TOKEN_2=$(cnt "$PATCHED_COPY" "$NEW_TOKEN_2")，各应为 1）"
    missing=1
  fi
  # patcher 幂等性预检：对交付副本再跑一次必须非零退出（因为补丁前锚点已消失）
  if node "$PATCHER" "$PATCHED_COPY" "$PATCHED_COPY.tmp-probe" >/dev/null 2>&1; then
    warn "patcher 对已补丁文件竟然成功（幂等性预检失败）"; rm -f "$PATCHED_COPY.tmp-probe"; missing=1
  fi
  rm -f "$PATCHED_COPY.tmp-probe"
  [ "$missing" -eq 0 ] || return 1
  return 0
}

# ---------------------------------------------------------------------------
# live 状态判定（只读）
# ---------------------------------------------------------------------------
state_of() {
  local lsh n1 n2 o1 o2
  lsh="$(sha "$CLIENT_JS")"
  if [ "$lsh" = "$PATCHED_SHA" ]; then printf 'applied\n'; return; fi
  n1="$(cnt "$CLIENT_JS" "$NEW_TOKEN_1")"; n2="$(cnt "$CLIENT_JS" "$NEW_TOKEN_2")"
  if [ "$n1" = "1" ] && [ "$n2" = "1" ]; then printf 'applied-token\n'; return; fi
  if [ "$lsh" = "$LIVE_PRE_SHA" ]; then printf 'pristine\n'; return; fi
  o1="$(cnt "$CLIENT_JS" "$OLD_TOKEN_1")"; o2="$(cnt "$CLIENT_JS" "$OLD_TOKEN_2")"
  if [ "$n1" = "0" ] && [ "$n2" = "0" ] && [ "$o1" = "2" ] && [ "$o2" = "1" ]; then
    printf 'pristine-drift\n'; return
  fi
  printf 'unknown(sha=%s n1=%s n2=%s o1=%s o2=%s)\n' "$lsh" "$n1" "$n2" "$o1" "$o2"
}

# 锚点唯一命中校验（补丁前必须成立，否则拒绝改写）
anchors_ok() {
  local f="$1" ok=0
  [ "$(cnt "$f" "$OLD_TOKEN_1")" = "2" ] || { fail "锚点 C2-1 计数 $(cnt "$f" "$OLD_TOKEN_1")（期望 2：含 remoteWorkspaceIndex 的同形实现）"; ok=1; }
  [ "$(cnt "$f" "$OLD_TOKEN_2")" = "1" ] || { fail "锚点 C2-2 计数 $(cnt "$f" "$OLD_TOKEN_2")（期望 1）"; ok=1; }
  grep -qF 'function remoteSessionIndex(sessions) {' "$f" || { fail "未找到 remoteSessionIndex（C2-1 作用域标记）"; ok=1; }
  grep -qF 'sessionsFeed?.getSnapshot()' "$f" || { fail "未找到 sessionsFeed（C2-2 作用域标记）"; ok=1; }
  [ "$(cnt "$f" "$NEW_TOKEN_1")" = "0" ] || { fail "新 token C2-1 已存在（$(cnt "$f" "$NEW_TOKEN_1")）—— 非补丁前状态"; ok=1; }
  [ "$(cnt "$f" "$NEW_TOKEN_2")" = "0" ] || { fail "新 token C2-2 已存在（$(cnt "$f" "$NEW_TOKEN_2")）—— 非补丁前状态"; ok=1; }
  return "$ok"
}

# 补丁后校验
verify_patched() {
  local f="$1" ok=0
  node --check "$f" >/dev/null 2>&1 || { fail "node --check 失败：$f"; ok=1; }
  [ "$(cnt "$f" "$NEW_TOKEN_1")" = "1" ] || { fail "新 token C2-1 计数 $(cnt "$f" "$NEW_TOKEN_1")（期望 1）"; ok=1; }
  [ "$(cnt "$f" "$NEW_TOKEN_2")" = "1" ] || { fail "新 token C2-2 计数 $(cnt "$f" "$NEW_TOKEN_2")（期望 1）"; ok=1; }
  [ "$(cnt "$f" "$OLD_TOKEN_1")" = "1" ] || { fail "旧 token C2-1 残留 $(cnt "$f" "$OLD_TOKEN_1")（期望 1：remoteWorkspaceIndex 未动）"; ok=1; }
  [ "$(cnt "$f" "$OLD_TOKEN_2")" = "0" ] || { fail "旧 token C2-2 残留 $(cnt "$f" "$OLD_TOKEN_2")（期望 0）"; ok=1; }
  [ "$(sha "$f")" = "$PATCHED_SHA" ] || { fail "补丁后 sha256 与基线不符（实得 $(sha "$f")，期望 $PATCHED_SHA）"; ok=1; }
  return "$ok"
}

# ---------------------------------------------------------------------------
# --rollback
# ---------------------------------------------------------------------------
if [ "$MODE" = "rollback" ]; then
  say "===== workspace-enhancement-perf.sh --rollback ====="
  latest="$(ls -d "$BACKUP_ROOT"/backup-* 2>/dev/null | sort | tail -n 1)"
  if [ -z "${latest:-}" ]; then
    warn "未找到备份（$BACKUP_ROOT/backup-*），无法回滚"; exit 1
  fi
  say "使用最新备份：$latest"
  if [ ! -f "$latest/client.js" ]; then warn "备份内缺 client.js：$latest"; exit 1; fi
  pre_sha="$(cat "$latest/pre.sha256" 2>/dev/null || printf '')"
  [ -n "$pre_sha" ] || { warn "备份缺少 pre.sha256，无法做还原后 hash 断言"; FAILED=1; }
  # 所有权校验：备份的 pre.sha256 必须等于本单元基线，否则拒绝回滚（防误取他档快照覆盖 live）
  if [ -n "$pre_sha" ] && [ "$pre_sha" != "$LIVE_PRE_SHA" ]; then
    fail "备份不属于本单元（pre.sha256=$pre_sha ≠ 本单元基线 $LIVE_PRE_SHA）——拒绝回滚以免误覆 live"
    exit 1
  fi
  install -m "$(file_mode "$CLIENT_JS")" "$latest/client.js" "$CLIENT_JS"
  say "已还原 $CLIENT_JS"
  if [ "$(cnt "$CLIENT_JS" "$NEW_TOKEN_1")" = "0" ] && [ "$(cnt "$CLIENT_JS" "$NEW_TOKEN_2")" = "0" ]; then
    pass "回滚后新 token 均已消失"
  else
    fail "回滚后新 token 仍命中（NEW_TOKEN_1=$(cnt "$CLIENT_JS" "$NEW_TOKEN_1") NEW_TOKEN_2=$(cnt "$CLIENT_JS" "$NEW_TOKEN_2")）"
  fi
  if [ -n "$pre_sha" ]; then
    if [ "$(sha "$CLIENT_JS")" = "$pre_sha" ]; then pass "回滚后 sha256 = 还原前基线（$pre_sha）"
    else fail "回滚后 sha256 $(sha "$CLIENT_JS") != 备份记录 $pre_sha"; fi
  fi
  node --check "$CLIENT_JS" >/dev/null 2>&1 && pass "回滚后 node --check 通过" || fail "回滚后 node --check 失败"
  say "生效方式：刷新浏览器（客户端 bundle 按请求读盘 + client-hmr 500ms 重哈希）；不需重启宿主。"
  exit "$FAILED"
fi

say "===== workspace-enhancement-perf.sh [$MODE] ====="
say "PLUGIN_DIR = $PLUGIN_DIR"
say "CLIENT_JS  = $CLIENT_JS"
say "交付副本   = $PATCHED_COPY"

precheck || { fail "前置校验未通过（未写任何文件）"; exit 1; }
say "前置校验通过（工具 / 目标 / 交付副本 + 幂等性预检）"

STATE="$(state_of)"
say "live 状态：$STATE"

case "$STATE" in
  applied)
    skip "live sha256 已等于补丁后基线（$PATCHED_SHA），已应用，无操作。"
    verify_patched "$CLIENT_JS" && say "补丁后校验通过"
    exit "$FAILED"
    ;;
  applied-token)
    skip "live 新 token 已各命中 1 次（人工应用过，或 hash 有微小差异），已应用，无操作。"
    verify_patched "$CLIENT_JS" && say "补丁后校验通过"
    exit "$FAILED"
    ;;
  pristine)
    pass "live sha256 命中补丁前基线（$LIVE_PRE_SHA），可安全应用"
    ;;
  pristine-drift)
    warn "live sha256 与补丁前基线 $LIVE_PRE_SHA 不符，但 token 计数完全符合补丁前形态（live 已被他人改动过）"
    fail "为安全起见拒绝自动改写：请人工核对，或显式更新脚本内 LIVE_PRE_SHA 后重跑（未写任何 live 文件）"
    exit 1
    ;;
  *)
    fail "live 状态不可识别（$STATE）——拒绝改写（人工核对后再决定；未写任何 live 文件）"
    exit 1
    ;;
esac

# --- pristine：锚点唯一命中校验 ---
say "--- 锚点唯一命中校验（补丁前）---"
anchors_ok "$CLIENT_JS" || { fail "锚点校验未通过，中止（未写任何 live 文件）"; exit 1; }
pass "C2-1 锚点 C2-1×2 / C2-2×1 唯一命中，作用域标记齐备"
say "     C2-1 作用域：remoteSessionIndex @ $(grep -nF 'function remoteSessionIndex(sessions) {' "$CLIENT_JS" | cut -d: -f1)（同形实现 remoteWorkspaceIndex 保留不动）"
say "     C2-2 作用域：installSidebarRowBadges 的 sources.sessions @ $(grep -nF 'sessionsFeed?.getSnapshot()' "$CLIENT_JS" | cut -d: -f1)"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/lagfix-c2.XXXXXX")"; TMPDIRS+=("$TMP")
RESULT="$TMP/client.candidate.js"

# --- 应用（dry-run 落临时副本；apply 落临时副本后校验再原子替换 live） ---
say "--- 应用（patcher：精确双锚点替换，带 5 条前置断言 + 4 条后置断言）---"
if ! node "$PATCHER" "$CLIENT_JS" "$RESULT"; then
  fail "patcher 失败（锚点漂移或断言未通过），中止"; exit 1
fi
pass "patcher 成功：$RESULT"

say "--- diff -u（live vs 候选）---"
diff -u "$CLIENT_JS" "$RESULT" > "$TMP/c2.diff" || true
sed -n '1,200p' "$TMP/c2.diff"
say "--- diff 统计 ---"
say "  变更行数：$(grep -c '^-[^-]' "$TMP/c2.diff" || true) 删除 / $(grep -c '^+[^+]' "$TMP/c2.diff" || true) 新增；hunk 数：$(grep -c '^@@' "$TMP/c2.diff" || true)"

say "--- 补丁后校验（node --check + token 计数 + sha256）---"
verify_patched "$RESULT" || { fail "补丁后校验未通过，中止"; exit 1; }
pass "node --check 通过；NEW×1/NEW×1；OLD 残留 1/0（remoteWorkspaceIndex 未动）；sha256 命中基线"

# 与交付副本字节比对（最强的"就是这份补丁"证明）
if cmp -s "$RESULT" "$PATCHED_COPY"; then
  pass "候选与交付副本 patched/workspace-enhancement.client.js 字节一致"
else
  fail "候选与交付副本字节不一致（patched/workspace-enhancement.client.js 可能已被改动）"
  diff -u "$PATCHED_COPY" "$RESULT" | sed -n '1,40p'
fi

# 等价性/记忆化契约测试（只读，需交付副本在场）
say "--- 等价性 + 记忆化契约测试（tools/equiv-c2.mjs）---"
if node "$LAGFIX_DIR/tools/equiv-c2.mjs" > "$TMP/equiv.log" 2>&1; then
  pass "equiv-c2.mjs 全部 PASS（$(grep -c '^\[PASS\]' "$TMP/equiv.log") 项）"
else
  fail "equiv-c2.mjs 存在 FAIL"
  sed -n '1,80p' "$TMP/equiv.log"
fi

if [ "$MODE" = "dry-run" ]; then
  say "===== DRY-RUN 完成（live 未做任何写入）====="
  dry "将备份 live 到 $BACKUP_ROOT/backup-<时间戳>/（client.js + pre.sha256 + meta.txt）"
  dry "将以 install -m $(file_mode "$CLIENT_JS") 覆盖 $CLIENT_JS（内容 = 候选 = 交付副本）"
  dry "生效方式：刷新浏览器（不需重启宿主；client-hmr 约 500ms 内亦会推 rebuilt 自动热换）"
  dry "回滚：bash $0 --rollback"
  exit "$FAILED"
fi

# --- apply ---
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/backup-$STAMP"
mkdir -p "$BACKUP_DIR"
cp "$CLIENT_JS" "$BACKUP_DIR/client.js"
printf '%s\n' "$(sha "$CLIENT_JS")" > "$BACKUP_DIR/pre.sha256"
{
  printf 'unit=C2\nsource=%s\nmode=apply\nstamp=%s\npre_sha256=%s\npatched_sha256=%s\n' \
    "$CLIENT_JS" "$STAMP" "$(sha "$CLIENT_JS")" "$PATCHED_SHA"
  printf 'diff_hunks=%s\nclient_js_lines=%s\n' "$(grep -c '^@@' "$TMP/c2.diff" || true)" "$(wc -l < "$CLIENT_JS")"
} > "$BACKUP_DIR/meta.txt"
say "备份完成：$BACKUP_DIR（client.js + pre.sha256 + meta.txt）"

install -m "$(file_mode "$CLIENT_JS")" "$RESULT" "$CLIENT_JS"
say "已写入 $CLIENT_JS"

if ! verify_patched "$CLIENT_JS"; then
  say "===== 校验失败：已备份，请立即 bash $0 --rollback 还原 ====="
  exit 1
fi
pass "live 补丁后校验通过（node --check + token + sha256）"

# 附：把本次 diff 作为交付证据留档（仅工作区写入）
cp "$TMP/c2.diff" "$BACKUP_DIR/c2.diff"
say "===== 单元 C2 应用完成 ====="
say "生效方式：刷新浏览器（Ctrl/Cmd+R）即拿到新代码；不需重启宿主进程。"
say "          机制依据：.workspace/settings-lag/audit-rebuild.md §2（按请求读盘 + rev=sha1 + SSE 热换）。"
say "回滚：bash $0 --rollback（还原最新备份），或 install -m 644 $BACKUP_DIR/client.js $CLIENT_JS"
exit "$FAILED"
