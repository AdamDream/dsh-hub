#!/usr/bin/env bash
# ============================================================================
# workspace-ui-runsubagent-count.sh — 单元 B1/C1：侧边栏「N 个子代理运行中」消费方最小改动
# ============================================================================
# 规格：audit-subagent-filter.md §2.2 C1（消费方）+ §7「有条件安全（补聚合字段后）」
# 前置：服务端已加 `runningSubagentCount` 聚合字段（见 patches/server-session-filter.sh）。
# 本脚本**只做一件事**：让 C1 优先使用宿主聚合字段，字段缺失时回落到原有就地聚合，
# 因此「服务端未重启/未打补丁」时行为与今天完全一致（零回归）。
#
# 目标（2 文件 3 处，全部是单行表达式改写）：
#   1. dsh-client-ui-workspace/lib/client.js
#        · sessionNode() 的 runningSubagentCount（侧边栏分组行）
#        · deriveSearchResults() 的 runningSubagentCount（搜索结果行）
#   2. dsh-client-runtime/lib/client.js
#        · buildListSnapshot() 的 entryCache 新鲜度判据末尾追加 runningSubagentCount
#          —— 否则「计数变了但其他判据字段没变」时会复用旧条目对象，状态点不刷新。
#
# 【生效方式 —— 热面，与服务端脚本不同】
#   本文件（dsh-client-ui-workspace/lib/client.js）与 dsh-client-runtime/lib/client.js 属**客户端热面**：
#     · 宿主按 `/plugins/<id>/client.js` **每次 GET 从磁盘读取**（`no-cache`），`?rev=` 只是 sha1-12 缓存破坏串；
#     · `dsh-client-hmr` 以 500ms 轮询推送 `rebuilt`。
#   → 改完**只需刷新浏览器**（http://127.0.0.1:3080）即生效，**无需重启 DSH**。
#   → 注意：它依赖的**服务端聚合字段**是冷面，需服务端补丁 + 重启后才出现；
#     字段缺失时本补丁自动回落原「就地聚合」行为，因此**零回归**、可先行应用。
# 模式：
#   bash workspace-ui-runsubagent-count.sh --dry-run   在工作区副本上应用 + diff -u（不写 live）
#   bash workspace-ui-runsubagent-count.sh --apply     备份 → 锚点校验 → 应用 → 校验
#   bash workspace-ui-runsubagent-count.sh --rollback  用最新备份还原（还原后刷新浏览器）
# 幂等：命中 `dsh-lag-fix B1/C1` 即 SKIP；锚点计数不符即拒绝。
# 环境变量：DSH_ROOT（默认 $HOME/.dsh/profiles/node_modules/@deepseek-ai）、B1_DIR（默认脚本上级目录）
# 依赖：bash / node / grep / cp / mkdir / date / diff / mktemp
# ============================================================================
set -u

MODE="${1:---dry-run}"
case "$MODE" in
  --help|-h) sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
  --dry-run) MODE=dry ;;
  --apply)   MODE=apply ;;
  --rollback) MODE=rollback ;;
  *) echo "未知模式：$MODE（可用：--dry-run / --apply / --rollback / --help）" >&2; exit 2 ;;
esac

B1_DIR="${B1_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
TRANSFORM="$B1_DIR/patches/B1-transform-client.cjs"
DSH_ROOT="${DSH_ROOT:-$HOME/.dsh/profiles/node_modules/@deepseek-ai}"
UI_REL="dsh-client-ui-workspace/lib/client.js"
RT_REL="dsh-client-runtime/lib/client.js"
UI="$DSH_ROOT/$UI_REL"
RT="$DSH_ROOT/$RT_REL"
BACKUP_ROOT="$B1_DIR/backup/B1"   # 单元独占子目录：backup/ 是多档共用，B1 全部备份落这里
WORK_ROOT="$B1_DIR/tmp/B1"       # 单元独占子目录：避免与他档 dryrun-* 同名互覆

FAILED=0
say()  { printf '%s\n' "$*"; }
pass() { printf '[PASS] %s\n' "$*"; }
skip() { printf '[SKIP] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*" >&2; }
fail() { printf '[FAIL] %s\n' "$*" >&2; FAILED=1; }
count() { grep -cF -- "$2" "$1" 2>/dev/null | head -n 1; }

unit_state() {
  local a b
  a="$(count "$UI" 'dsh-lag-fix B1/C1')"
  b="$(count "$RT" 'runningSubagentCount === entry.runningSubagentCount')"
  if [ "${a:-0}" -ge 2 ] && [ "${b:-0}" -eq 1 ]; then echo done
  elif [ "${a:-0}" -gt 0 ] || [ "${b:-0}" -gt 0 ]; then echo partial
  else echo none
  fi
}

anchor_precheck() {
  local bad=0 n
  for f in "$UI" "$RT"; do
    [ -f "$f" ] || { fail "目标文件不存在：$f"; bad=1; }
  done
  [ "$bad" -eq 0 ] || return 1
  n="$(count "$UI" 'runningSubagentCount: descendants.get(s.id)?.runningCount ?? 0,')"
  [ "${n:-0}" -eq 1 ] || { fail "锚点计数不符 [$UI_REL] sessionNode(s) 行 期望 1 实得 ${n:-0}"; bad=1; }
  n="$(count "$UI" 'runningSubagentCount: descendants.get(summary.id)?.runningCount ?? 0,')"
  [ "${n:-0}" -eq 1 ] || { fail "锚点计数不符 [$UI_REL] 搜索结果行 期望 1 实得 ${n:-0}"; bad=1; }
  # 只读对照：该文件当前恰好 2 处 descendants.get(（正是本次要改的 2 处）。
  # 多于 2 说明上游新增了消费方，需要人工确认；少于 2 说明文件已漂移。
  n="$(count "$UI" 'descendants.get(')"
  [ "${n:-0}" -eq 2 ] || { warn "注意 [$UI_REL] descendants.get( 命中 ${n:-0}（本补丁锚定 2 处；多于 2 请人工确认上游是否新增消费方）"; }
  n="$(count "$RT" 'prev.completed === entry.completed')"
  [ "${n:-0}" -eq 1 ] || { fail "锚点计数不符 [$RT_REL] entryCache 判据尾 期望 1 实得 ${n:-0}"; bad=1; }
  [ "$bad" -eq 0 ]
}

syntax_check() {
  local target="$1" tag="$2" dir
  dir="$(mktemp -d "${TMPDIR:-/tmp}/b1c.XXXXXX")"
  printf '{"type":"module"}\n' > "$dir/package.json"
  cp "$target" "$dir/probe.js"
  if node --check "$dir/probe.js" >/dev/null 2>&1; then rm -rf "$dir"; return 0; fi
  warn "[$tag] node --check 失败："
  node --check "$dir/probe.js" 2>&1 | head -8 >&2
  rm -rf "$dir"
  return 1
}

apply_transform() {
  local rel="$1" src="$2" dst="$3" tag="$4"
  node - "$TRANSFORM" "$rel" "$src" "$dst" <<'NODEEOF'
const fs = require('node:fs');
const [, , transformPath, rel, srcPath, dstPath] = process.argv;
const C = require(transformPath);
const src = fs.readFileSync(srcPath, 'utf8');
let out;
try {
  out = C.applyClientPatch(rel, src);
} catch (err) {
  console.error(`TRANSFORM_FAIL ${err.message}`);
  process.exit(1);
}
const fails = C.verifyClientPatch(rel, out);
if (fails.length > 0) {
  console.error(`VERIFY_FAIL ${fails.join(' | ')}`);
  process.exit(1);
}
fs.writeFileSync(dstPath, out);
console.log(`TRANSFORM_OK ${src.length} -> ${out.length}`);
NODEEOF
  [ "$?" -eq 0 ] || { fail "[$tag] 变换失败（见上）"; return 1; }
  syntax_check "$dst" "$tag" || { fail "[$tag] 变换产物语法校验失败"; return 1; }
  return 0
}

precheck() {
  local missing=0 tool
  for tool in node grep cp mkdir date diff mktemp; do
    command -v "$tool" >/dev/null 2>&1 || { warn "缺少工具：$tool"; missing=1; }
  done
  [ -f "$TRANSFORM" ] || { warn "变换模块不存在：$TRANSFORM"; missing=1; }
  [ -d "$DSH_ROOT" ] || { warn "包根不存在：$DSH_ROOT（可用 DSH_ROOT 覆盖）"; missing=1; }
  [ -w "$UI" ] || warn "live ui-workspace client.js 不可写：--apply 会失败（沙箱需在工作区外执行）"
  [ -w "$RT" ] || warn "live client-runtime client.js 不可写：--apply 会失败（沙箱需在工作区外执行）"
  [ "$missing" -eq 0 ] || return 1
  return 0
}

say "===== workspace-ui-runsubagent-count（单元 B1/C1）模式：$MODE ====="
say "UI=$UI"
say "RT=$RT"
precheck || { fail "前置校验未通过"; exit 1; }

if [ "$MODE" = rollback ]; then
  # 只认 B1 独占备份目录（backup/B1/），且必须同时含本单元两个目标文件，避免误覆他档产物。
  latest="$(ls -d "$BACKUP_ROOT"/*/ 2>/dev/null | sort | tail -n 1)"
  [ -n "$latest" ] || { warn "未找到本单元备份（$BACKUP_ROOT/*/），无法回滚"; exit 1; }
  if [ ! -f "$latest/$UI_REL" ] || [ ! -f "$latest/$RT_REL" ]; then
    warn "$latest 不是本单元（B1）的完整备份（缺少 $UI_REL 或 $RT_REL），拒绝回滚以免误覆 live"
    exit 1
  fi
  say "使用本单元最新备份：$latest"
  cp "$latest/$UI_REL" "$UI" && say "已还原 $UI_REL"
  cp "$latest/$RT_REL" "$RT" && say "已还原 $RT_REL"
  [ "$(unit_state)" = none ] && pass "回滚完成：标记已消失" || warn "回滚后标记仍存在——请人工核对"
  say "【生效方式】客户端 bundle 属热面：/plugins/<id>/client.js 每次 GET 从磁盘读 + no-cache，"
  say "            **刷新浏览器即生效**（无需重启宿主；dsh-client-hmr 500ms 轮询推 rebuilt）。"
  exit "$FAILED"
fi

STATE="$(unit_state)"
if [ "$STATE" = done ]; then skip "已应用（两个文件均命中），无操作。"; exit 0; fi
if [ "$STATE" = partial ]; then warn "检测到半应用状态（只有其中一个文件带标记）——请先 --rollback 再重跑。"; exit 1; fi

anchor_precheck || { fail "锚点校验未通过：拒绝应用（未写任何文件）"; exit 1; }
pass "锚点校验通过（3 处单行锚点各 1 次唯一命中）"

if [ "$MODE" = dry ]; then
  stamp="$(date +%Y%m%d-%H%M%S)"
  WORK="$WORK_ROOT/dryrun-client-$stamp"
  mkdir -p "$WORK/$(dirname "$UI_REL")" "$WORK/$(dirname "$RT_REL")"
  cp "$UI" "$WORK/$UI_REL"
  cp "$RT" "$WORK/$RT_REL"
  say "工作区副本：$WORK"
  apply_transform "$UI_REL" "$WORK/$UI_REL" "$WORK/b1-ui-workspace.patched.js" "ui-workspace" || exit 1
  apply_transform "$RT_REL" "$WORK/$RT_REL" "$WORK/b1-client-runtime.patched.js" "client-runtime" || exit 1
  pass "两份副本均变换成功且通过 ESM 语法校验"
  say ""
  say "================ diff -u  $UI_REL ================"
  diff -u "$WORK/$UI_REL" "$WORK/b1-ui-workspace.patched.js" || true
  say ""
  say "================ diff -u  $RT_REL ================"
  diff -u "$WORK/$RT_REL" "$WORK/b1-client-runtime.patched.js" || true
  say ""
  say "== 客户端取值语义自测（宿主字段优先 / 回落 / 非 number 防御 / entryCache 新鲜度）=="
  if B1_UI_PATCHED="$WORK/b1-ui-workspace.patched.js" B1_RUNTIME_PATCHED="$WORK/b1-client-runtime.patched.js" \
     node "$B1_DIR/patches/B1-client-semantic-test.cjs"; then
    pass "客户端语义自测全部通过"
  else
    fail "客户端语义自测失败（见上）"
  fi
  say ""
  say "===== DRY-RUN 完成（live 文件未改动）====="
  exit "$FAILED"
fi

stamp="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$stamp"
mkdir -p "$BACKUP_DIR/$(dirname "$UI_REL")" "$BACKUP_DIR/$(dirname "$RT_REL")"
cp "$UI" "$BACKUP_DIR/$UI_REL"
cp "$RT" "$BACKUP_DIR/$RT_REL"
say "备份完成：$BACKUP_DIR"

apply_transform "$UI_REL" "$UI" "$BACKUP_DIR/b1-ui-workspace.patched.js" "ui-workspace" || { fail "ui-workspace 变换失败（live 未改动）"; exit 1; }
apply_transform "$RT_REL" "$RT" "$BACKUP_DIR/b1-client-runtime.patched.js" "client-runtime" || { fail "client-runtime 变换失败（live 未改动）"; exit 1; }

cp "$BACKUP_DIR/b1-ui-workspace.patched.js" "$UI" || { fail "写入 $UI 失败"; exit 1; }
if ! cp "$BACKUP_DIR/b1-client-runtime.patched.js" "$RT"; then
  fail "写入 $RT 失败——立即回滚 ui-workspace"
  cp "$BACKUP_DIR/$UI_REL" "$UI"
  exit 1
fi

syntax_check "$UI" "live/ui-workspace" || fail "live ui-workspace 语法校验失败（请 --rollback）"
syntax_check "$RT" "live/client-runtime" || fail "live client-runtime 语法校验失败（请 --rollback）"
[ "$(unit_state)" = done ] && pass "标记命中：两个文件均已应用" || fail "标记缺失：应用未生效"

if [ "$FAILED" -eq 0 ]; then
  say "===== 应用完成（客户端热面）====="
  say "【生效方式】**刷新浏览器即生效**（/plugins/<id>/client.js 每次 GET 从磁盘读 + no-cache；"
  say "  ?rev= 只是 sha1-12 缓存破坏串；dsh-client-hmr 500ms 轮询推 rebuilt）——**无需重启宿主**。"
  say "【注意】本补丁依赖的 runningSubagentCount 属服务端冷面：服务端补丁未 apply/未重启时，"
  say "  状态点走回落分支（与今天完全一致），不是故障。"
  say "验收：刷新后用一个正在跑子代理的会话观察侧边栏行状态点文案（服务端字段生效后才有数字）。"
  say "回滚：bash workspace-ui-runsubagent-count.sh --rollback（回滚后仍需刷新浏览器）"
else
  say "===== 存在 FAIL（可用 --rollback 还原）====="
fi
exit "$FAILED"
