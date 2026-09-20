#!/usr/bin/env bash
# ============================================================================
# server-session-filter.sh — 单元 B1：session.list 不再全量下发前端不渲染的 subagent 会话
# ============================================================================
# 规格：.workspace/settings-lag/audit-subagent-filter.md §6 方案 B + §7 第 2 步（补聚合字段）
# 裁决：顶层会话（origin !== "subagent"）全量下发；subagent 只发最近 200 条（updatedAt 降序）；
#       追加聚合字段 runningSubagentCount（消费方 C1 侧边栏「N 个子代理运行中」状态点）。
#
# 目标（两份**同一逻辑源的两种排版**，都必须改）：
#   A. lib/index.js            ← **宿主实际加载的入口**（package.json main；
#                                 dsh-client-connection 以裸包名 import → 解析到它）。
#                                 内含 `//#region lib/types/api-proxy.js` 打包副本。
#                                 排版：TAB 缩进 / 去尾逗号 / 双引号 / `void 0`
#   B. lib/types/api-proxy.js  ← 任务书点名的模块文件（`./api/*` 子路径导出走它）。
#                                 排版：4 空格 / 尾逗号 / 单引号 / `undefined`
#   只改 B 不改 A = 完全不生效（宿主不加载 B）；只改 A 不改 B = 文档与子路径导出不一致。
#
# 模式：
#   bash server-session-filter.sh --dry-run   在**工作区副本**上应用 + 打印 diff -u（不写 live）
#   bash server-session-filter.sh --apply     备份 → 锚点校验 → 应用 → 校验
#   bash server-session-filter.sh --rollback  用本单元最新备份还原（还原后需重启 DSH）
# 幂等：命中标记 `dsh-lag-fix B1` 即 SKIP；锚点计数不符则拒绝应用（不改 live）。
# 依赖：bash / node / grep / cp / mkdir / date / diff
# 环境变量：
#   DSH_ROOT     @deepseek-ai 包根（默认 $HOME/.dsh/profiles/node_modules/@deepseek-ai）
#   B1_DIR       本脚本所在目录（默认脚本目录）
#   B1_MAX       subagent 下发上限（仅用于文档显示；实际生效值在源文件常量里，默认 200）
# 【生效方式 —— 冷面，必须是明确前置】
#   api-proxy 属**宿主侧冷面**：web 层配置为 `- id: <hmr> disabled: true`、兜底 HMR `root: []`，
#   即宿主不会热重载这两个文件。因此：
#     · `--apply` 后**必须重启 DSH（npx @deepseek-ai/dsh web）**才生效；
#     · **刷新浏览器无效**（浏览器刷新只会重新拉前端 bundle，与宿主模块无关）；
#     · 重启会中断当前会话连接，请在合适时机执行（该动作由主 agent/用户决定，本脚本不代为重启）。
# 注意：绝不触碰宿主进程；本脚本只读写文件，不重启、不发 HTTP。
# ============================================================================
set -u

MODE="${1:---dry-run}"
case "$MODE" in
  --help|-h)
    sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  --dry-run) MODE=dry ;;
  --apply)   MODE=apply ;;
  --rollback) MODE=rollback ;;
  *)
    echo "未知模式：$MODE（可用：--dry-run / --apply / --rollback / --help）" >&2
    exit 2
    ;;
esac

B1_DIR="${B1_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
TRANSFORM="$B1_DIR/patches/B1-transform.cjs"
DSH_ROOT="${DSH_ROOT:-$HOME/.dsh/profiles/node_modules/@deepseek-ai}"
PKG="$DSH_ROOT/dsh-host-apiproxy"
LIVE_INDEX="$PKG/lib/index.js"
LIVE_MODULE="$PKG/lib/types/api-proxy.js"
BACKUP_ROOT="$B1_DIR/backup/B1"   # 单元独占子目录：backup/ 是多档共用，B1 全部备份落这里
WORK_ROOT="$B1_DIR/tmp/B1"       # 单元独占子目录：避免与他档 dryrun-* 同名互覆
B1_MAX="${B1_MAX:-200}"

FAILED=0
say()  { printf '%s\n' "$*"; }
pass() { printf '[PASS] %s\n' "$*"; }
skip() { printf '[SKIP] %s\n' "$*"; }
dry()  { printf '[DRY-RUN] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*" >&2; }
fail() { printf '[FAIL] %s\n' "$*" >&2; FAILED=1; }

# ---------------------------------------------------------------------------
# 幂等判定：done = 「已应用」，none = 「未应用」，partial = 「只应用了一半」
# ---------------------------------------------------------------------------
unit_state() {
  local idx mod
  idx="$(grep -cF 'dsh-lag-fix B1' "$LIVE_INDEX" 2>/dev/null | head -n 1)"
  mod="$(grep -cF 'dsh-lag-fix B1' "$LIVE_MODULE" 2>/dev/null | head -n 1)"
  if [ "$idx" -gt 0 ] && [ "$mod" -gt 0 ]; then echo done
  elif [ "$idx" -gt 0 ] || [ "$mod" -gt 0 ]; then echo partial
  else echo none
  fi
}

# ---------------------------------------------------------------------------
# 锚点校验（每处先计数，不符即拒绝）—— 与 B1-transform.cjs 内的校验互为冗余
# ---------------------------------------------------------------------------
anchor_count() { grep -cF -- "$2" "$1" 2>/dev/null | head -n 1; }

anchor_precheck() {
  local f bad=0 n
  for f in "$LIVE_INDEX" "$LIVE_MODULE"; do
    if [ ! -f "$f" ]; then fail "目标文件不存在：$f"; bad=1; continue; fi
    n="$(anchor_count "$f" 'function sessionListFields(header, events = []) {')"
    [ "${n:-0}" -eq 1 ] || { fail "锚点计数不符 [$f] sessionListFields 定义 期望 1 实得 ${n:-0}"; bad=1; }
    n="$(anchor_count "$f" 'const items = ctx.sessions.list().map(summarizeAttached);')"
    [ "${n:-0}" -eq 1 ] || { fail "锚点计数不符 [$f] 内存分支锚点 期望 1 实得 ${n:-0}"; bad=1; }
    n="$(anchor_count "$f" 'const cold = (await persistence.list(signal))')"
    [ "${n:-0}" -eq 1 ] || { fail "锚点计数不符 [$f] 冷会话锚点 期望 1 实得 ${n:-0}"; bad=1; }
    n="$(anchor_count "$f" '!attached.has(meta.id) && meta.cwd !==')"
    [ "${n:-0}" -eq 1 ] || { fail "锚点计数不符 [$f] 冷会话 filter 条件 期望 1 实得 ${n:-0}"; bad=1; }
    n="$(anchor_count "$f" 'items.sort((a, b) => b.updatedAt - a.updatedAt);')"
    [ "${n:-0}" -eq 1 ] || { fail "锚点计数不符 [$f] 排序收口锚点 期望 1 实得 ${n:-0}"; bad=1; }
    n="$(anchor_count "$f" '...agentPreset')"
    [ "${n:-0}" -eq 1 ] || { fail "锚点计数不符 [$f] 聚合字段插入点 期望 1 实得 ${n:-0}"; bad=1; }
  done
  [ "$bad" -eq 0 ]
}

# ---------------------------------------------------------------------------
# ESM 语法校验：目标文件是 `type: module` 的 .js，node --check 需要 ESM 上下文
# （在临时目录放一个 {"type":"module"} 的 package.json 再 --check）
# ---------------------------------------------------------------------------
syntax_check() {
  local target="$1" tag="$2" dir
  dir="$(mktemp -d "${TMPDIR:-/tmp}/b1check.XXXXXX")"
  printf '{"type":"module"}\n' > "$dir/package.json"
  cp "$target" "$dir/probe.js"
  if node --check "$dir/probe.js" >/dev/null 2>&1; then
    rm -rf "$dir"; return 0
  fi
  warn "[$tag] node --check 失败："
  node --check "$dir/probe.js" 2>&1 | head -8 >&2
  rm -rf "$dir"
  return 1
}

# ---------------------------------------------------------------------------
# 应用（在给定副本上）：node 变换 + 语义校验
# ---------------------------------------------------------------------------
apply_transform() {
  local src="$1" dst="$2" tag="$3"
  node - "$TRANSFORM" "$src" "$dst" <<'NODEEOF'
const fs = require('node:fs');
const [, , transformPath, srcPath, dstPath] = process.argv;
const T = require(transformPath);
const src = fs.readFileSync(srcPath, 'utf8');
let out;
try {
  out = T.applyServerFilter(src);
} catch (err) {
  console.error(`TRANSFORM_FAIL ${err.message}`);
  process.exit(1);
}
const fails = T.verifyServerFilter(out);
if (fails.length > 0) {
  console.error(`VERIFY_FAIL ${fails.join(' | ')}`);
  process.exit(1);
}
fs.writeFileSync(dstPath, out);
console.log(`TRANSFORM_OK ${src.length} -> ${out.length}`);
NODEEOF
  local rc=$?
  [ "$rc" -eq 0 ] || { fail "[$tag] 变换失败（见上）"; return 1; }
  syntax_check "$dst" "$tag" || { fail "[$tag] 变换产物语法校验失败"; return 1; }
  return 0
}

# ---------------------------------------------------------------------------
# 前置校验
# ---------------------------------------------------------------------------
precheck() {
  local missing=0 tool
  for tool in node grep cp mkdir date diff mktemp; do
    command -v "$tool" >/dev/null 2>&1 || { warn "缺少工具：$tool"; missing=1; }
  done
  [ -f "$TRANSFORM" ] || { warn "变换模块不存在：$TRANSFORM"; missing=1; }
  [ -d "$PKG" ] || { warn "目标包不存在：$PKG（可用 DSH_ROOT 覆盖）"; missing=1; }
  [ -f "$LIVE_INDEX" ] || { warn "缺少 $LIVE_INDEX"; missing=1; }
  [ -f "$LIVE_MODULE" ] || { warn "缺少 $LIVE_MODULE"; missing=1; }
  # 可写性预判（只 test，不写）
  [ -w "$LIVE_INDEX" ] || { warn "live index.js 不可写（沙箱/权限）：--apply 会失败，请让主 agent 在工作区外执行"; }
  [ "$missing" -eq 0 ] || return 1
  return 0
}

say "===== server-session-filter（单元 B1）模式：$MODE ====="
say "PKG=$PKG"
say "subagent 下发上限：$B1_MAX（常量在源文件内，可用 globalThis.__DSH_SUBAGENT_LIST_MAX 覆盖）"

precheck || { fail "前置校验未通过"; exit 1; }

# ---------------------------------------------------------------------------
# 回滚
# ---------------------------------------------------------------------------
if [ "$MODE" = rollback ]; then
  # 只认 B1 独占备份目录（backup/B1/），且必须同时含本单元两个目标文件，否则拒绝执行，
  # 避免误用他档（A/C1/C2 共用 backup/）的快照覆盖 live 文件。
  latest="$(ls -d "$BACKUP_ROOT"/*/ 2>/dev/null | sort | tail -n 1)"
  if [ -z "$latest" ]; then
    warn "未找到本单元备份（$BACKUP_ROOT/*/），无法回滚"
    exit 1
  fi
  if [ ! -f "$latest/lib/index.js" ] || [ ! -f "$latest/lib/types/api-proxy.js" ]; then
    warn "$latest 不是本单元（B1）的完整备份（缺少 lib/index.js 或 lib/types/api-proxy.js），拒绝回滚以免误覆 live"
    exit 1
  fi
  say "使用本单元最新备份：$latest"
  cp "$latest/lib/index.js" "$LIVE_INDEX" && say "已还原 lib/index.js"
  cp "$latest/lib/types/api-proxy.js" "$LIVE_MODULE" && say "已还原 lib/types/api-proxy.js"
  if [ "$(unit_state)" = none ]; then pass "回滚完成：标记已消失"
  else warn "回滚后标记仍存在——请人工核对备份时间戳与 live 文件"; fi
  say "【生效方式】宿主侧改动：必须**重启 DSH**（npx @deepseek-ai/dsh web）才退出/生效；刷新浏览器无效。"
  exit "$FAILED"
fi

# ---------------------------------------------------------------------------
# 幂等
# ---------------------------------------------------------------------------
STATE="$(unit_state)"
if [ "$STATE" = done ]; then
  skip "已应用（两个文件均命中 'dsh-lag-fix B1'），无操作。"
  exit 0
fi
if [ "$STATE" = partial ]; then
  warn "检测到**半应用**状态（只有其中一个文件带标记）——请先 --rollback 再重跑，本脚本拒绝在偏移状态上继续。"
  exit 1
fi

anchor_precheck || { fail "锚点校验未通过：拒绝应用（未写任何文件）"; exit 1; }
pass "锚点校验通过（sessionListFields / 内存分支 / 冷会话分支，两个文件各 1 次唯一命中）"

# ---------------------------------------------------------------------------
# dry-run：在**工作区副本**上应用 + diff -u
# ---------------------------------------------------------------------------
if [ "$MODE" = dry ]; then
  stamp="$(date +%Y%m%d-%H%M%S)"
  WORK="$WORK_ROOT/dryrun-$stamp"
  mkdir -p "$WORK/lib/types"
  cp "$LIVE_INDEX" "$WORK/lib/index.js"
  cp "$LIVE_MODULE" "$WORK/lib/types/api-proxy.js"
  say "工作区副本：$WORK"
  ok=1
  apply_transform "$WORK/lib/index.js" "$WORK/b1-index.patched.js" "index.js" || ok=0
  apply_transform "$WORK/lib/types/api-proxy.js" "$WORK/b1-api-proxy.patched.js" "api-proxy.js" || ok=0
  [ "$ok" -eq 1 ] || { fail "dry-run 变换失败"; exit 1; }
  pass "两份副本均变换成功且通过 ESM 语法校验（node --check）"
  say ""
  say "================ diff -u  lib/index.js（宿主实际加载的入口）================"
  diff -u "$WORK/lib/index.js" "$WORK/b1-index.patched.js" || true
  say ""
  say "================ diff -u  lib/types/api-proxy.js ================"
  diff -u "$WORK/lib/types/api-proxy.js" "$WORK/b1-api-proxy.patched.js" || true
  say ""
  say "== 语义自测（真实 payload：顶层 ID 逐条相等 / subagent ≤200 / 聚合计数与客户端一致）=="
  if B1_PATCHED="$WORK/b1-index.patched.js" node "$B1_DIR/patches/B1-semantic-test.cjs"; then
    pass "语义自测全部通过"
  else
    fail "语义自测失败（见上）"
  fi
  say ""
  say "===== DRY-RUN 完成（live 文件未改动）====="
  exit "$FAILED"
fi

# ---------------------------------------------------------------------------
# apply：备份 → 变换 → 校验
# ---------------------------------------------------------------------------
stamp="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$BACKUP_ROOT/$stamp"
mkdir -p "$BACKUP_DIR/lib/types"
cp "$LIVE_INDEX" "$BACKUP_DIR/lib/index.js"
cp "$LIVE_MODULE" "$BACKUP_DIR/lib/types/api-proxy.js"
say "备份完成：$BACKUP_DIR"

tmp_index="$BACKUP_DIR/b1-index.patched.js"
tmp_module="$BACKUP_DIR/b1-api-proxy.patched.js"
apply_transform "$LIVE_INDEX" "$tmp_index" "index.js" || { fail "index.js 变换失败（live 未改动）"; exit 1; }
apply_transform "$LIVE_MODULE" "$tmp_module" "api-proxy.js" || { fail "api-proxy.js 变换失败（live 未改动）"; exit 1; }

if ! cp "$tmp_index" "$LIVE_INDEX"; then fail "写入 $LIVE_INDEX 失败"; exit 1; fi
if ! cp "$tmp_module" "$LIVE_MODULE"; then
  fail "写入 $LIVE_MODULE 失败——立即回滚 index.js"
  cp "$BACKUP_DIR/lib/index.js" "$LIVE_INDEX"
  exit 1
fi

# 就地复核
syntax_check "$LIVE_INDEX" "live/index.js" || fail "live index.js 语法校验失败（请 --rollback）"
syntax_check "$LIVE_MODULE" "live/api-proxy.js" || fail "live api-proxy.js 语法校验失败（请 --rollback）"
if [ "$(unit_state)" = done ]; then pass "标记命中：两个文件均已应用"; else fail "标记缺失：应用未生效"; fi

if [ "$FAILED" -eq 0 ]; then
  say "===== 应用完成（文件已落盘，但**尚未生效**）====="
  say "【前置条件 · 冷面】这两份都是宿主侧代码，api-proxy 所在 web 层为 `hmr disabled: true` + 兜底 HMR `root: []`，"
  say "  → **必须重启 DSH（npx @deepseek-ai/dsh web）才生效**；**刷新浏览器无效**。"
  say "  → 重启会中断当前会话连接，请由主 agent/用户在合适时机执行（本脚本不代为重启）。"
  say "重启后验收：node $B1_DIR/probes/session-list-shape.mjs（期望条目 ≤ 顶层+200、字节 ≤500KB、"
  say "            顶层会话 ID 逐条不少、每行出现 runningSubagentCount 字段）。"
  say "回滚：bash server-session-filter.sh --rollback（用本单元最新备份还原，仍需重启才退出效果）"
else
  say "===== 存在 FAIL（可用 --rollback 还原）====="
fi
exit "$FAILED"
