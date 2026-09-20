#!/usr/bin/env bash
# ============================================================================
# client-runtime-perf.sh — 单元 C1：官方客户端运行时三处性能补丁 重放脚本
# ============================================================================
# 规格：.workspace/settings-lag/DIAGNOSIS.md §2.2 / §3 第 3、4、6 项
#       .workspace/settings-lag/audit-client.md F1（引用 churn 路径）
#       .workspace/settings-lag/audit-rebuild.md（客户端 bundle 热替换生效机制）
#       本目录 patches/unit-C1-clientspec.mjs（锚点/替换文本唯一真相源）
#
# 目标：@deepseek-ai/dsh-client-runtime/lib/client.js（build-free 手写 bundle，10573 行）
#   官方包在 ~/.dsh/profiles/node_modules/@deepseek-ai/* 下是**符号链接**，
#   实际读取的是全局树 $ROOT/dsh-client-runtime/lib/client.js。
#
# 交付单元（用户已裁决；P3 已暂缓，不在本脚本内）：
#   P1  entryCache 清理 O(N^2) → O(N)               锚点 :8576
#   P4  applyMutation upsert 线性 find → O(1) 索引   锚点 :8593 起（调用点 :8250 / :8087）
#   P2  projectList → list.set 引用稳定化            锚点 :9267-9282
#
# 模式（默认 dry-run，绝不隐式写工作区外的文件）：
#   bash client-runtime-perf.sh                 dry-run：只读目标 → 在工作区副本上应用 → diff -u → 校验
#   bash client-runtime-perf.sh --dry-run       同上（显式）
#   bash client-runtime-perf.sh --apply         真实应用（先备份到工作区，再写目标，再校验）
#   bash client-runtime-perf.sh --apply --only P1,P2   只应用指定单元（可选：P1 / P4 / P2，逗号分隔）
#   bash client-runtime-perf.sh --rollback      用最新备份还原目标（还原后浏览器刷新即可）
#   bash client-runtime-perf.sh --help
#
# 幂等：目标已含全部 marker → 判定 already-applied，直接 SKIP（不写任何文件）。
#
# 生效方式（audit-rebuild.md §0/§2）：客户端 bundle **热替换，无需重启宿主**
#   - /plugins/<id>/client.js 每次 GET 从磁盘读、cache-control: no-cache；URL 的 rev 只是缓存破坏串
#   - dsh-client-hmr 每 500ms stat 轮询，mtime/size 变化 → 重算 rev → SSE 推 rebuilt 帧 → 浏览器热换
#   - 对本包（核心 runtime）建议浏览器整页刷新一次，确定性最强
#
# 命名空间（backup/ 与 sandbox/ 均被多档共用，本单元一律落自己的子目录）：
#   backup/C1/<stamp>/{client-runtime.client.js, client-runtime.client.js.sha1, META.txt}   ← 独占备份根
#   sandbox/C1/                                                                           ← 独占工作副本
#   patched/client-runtime.client.js                                                      ← 独占交付副本
# 回滚所有权校验（fail-closed，防误取他档快照覆盖 live）：只认 backup/C1/ 下的备份，且
#   META.unit == C1 且 META.pre_sha1 == 备份实际内容 sha1 且 == 本脚本记录的补丁前 live sha
#   （BASELINE_SHA1，运行时从 unit-C1-clientspec.mjs 现读，禁止手抄）。
#   任一条不满足 → [FAIL] + 非零退出，绝不写目标。
#
# 产物命名（与并行交付单元共存，禁止裸 client.js）：
#   patched/client-runtime.client.js              全量改后副本（本单元 C1 独占）
#   patched/client-runtime.client-only-<UNITS>.js --only 运行的子集副本
#   注意：patched/workspace-enhancement.client.js 属于单元 C2（dsh-workspace-enhancement），
#         patched/client.js.diff 亦属于 C2（其 diff 头指向 dsh-workspace-enhancement/lib/client.js）
# 落地方式：**原地替换 + 备份 + 回滚**（本部署无源码重建能力：只有 tsdown 产物、无 src/、无 bundler）
#
# 环境变量覆盖：
#   DSH_ROOT      全局树 @deepseek-ai 目录（默认 $HOME/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai）
#   C1_TARGET     直接指定 client.js 路径（覆盖 DSH_ROOT）
#   C1_DIR        本脚本所在目录（补丁/副本/备份根，默认脚本目录的上一级 = .workspace/lag-fix）
#   C1_SKIP_HTTP  设为 1 可跳过 §HTTP 复核那一次请求
#   C1_PATCHED_NAME  覆盖改后副本文件名（默认 client-runtime.client.js）
# 依赖：bash / node / diff / sha1sum / grep / cp / mkdir / date（可选 curl）
# ============================================================================
set -u

MODE="${1:---dry-run}"
ONLY=""
if [ "${2:-}" = "--only" ]; then ONLY="${3:-}"; fi
if [ "${2:-}" != "" ] && [ "${2:-}" != "--only" ]; then
  echo "未知参数：${2}（可用：--only P1,P2）" >&2
  exit 2
fi
case "$MODE" in
  --help|-h)
    sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    echo
    echo "应用后确认浏览器已换成新代码（三选一）："
    echo "  1) sha1sum \"$TARGET\" | cut -c1-12      # 得到改后 rev 期望值（12 位）"
    echo "     curl -s http://127.0.0.1:3080/ | grep -o 'dsh-client-runtime/client.js?rev=[0-9a-f]*'"
    echo "     两串必须一致（服务端每次 GET 从磁盘读、no-cache；?rev= 只是 sha1-12 缓存破坏串）"
    echo "  2) 浏览器 console：performance.getEntriesByType('resource')"
    echo "     .filter(e=>e.name.includes('dsh-client-runtime')).map(e=>e.name)  期望 URL 里是新 rev"
    echo "  3) 直接刷新页面（推荐：本包是核心 runtime，整页刷新比 SSE 热换确定性更强）"
    exit 0
    ;;
  --dry-run) MODE="dry-run" ;;
  --apply) MODE="apply" ;;
  --rollback) MODE="rollback" ;;
  run) MODE="dry-run" ;;
  *)
    echo "未知模式：$MODE（可用：--dry-run / --apply / --rollback / --help）" >&2
    exit 2
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
C1_DIR="${C1_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
ROOT="${DSH_ROOT:-$HOME/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai}"
TARGET="${C1_TARGET:-$ROOT/dsh-client-runtime/lib/client.js}"
SPEC="$SCRIPT_DIR/unit-C1-clientspec.mjs"
FIXER="$SCRIPT_DIR/unit-C1-fixer.mjs"
# 单元独占命名空间：sandbox/ 与 backup/ 都被多档共用，C1 一律落在自己的子目录下
SANDBOX_DIR="$C1_DIR/sandbox/C1"
PATCHED_DIR="$C1_DIR/patched"
# 独占产物名：patched/ 下多个交付单元共存，禁止使用裸 client.js（C2 = workspace-enhancement.client.js）
PATCHED_NAME="${C1_PATCHED_NAME:-client-runtime.client.js}"
# 子集运行（--only）自动加后缀，避免覆盖全量副本
case "$PATCHED_NAME" in
  *".js") PATCHED_BASE="${PATCHED_NAME%.js}" ;;
  *) PATCHED_BASE="$PATCHED_NAME" ;;
esac
if [ -n "${ONLY:-}" ]; then
  PATCHED_NAME="${PATCHED_BASE}-only-$(printf '%s' "$ONLY" | tr ',' '-').js"
fi
# 独占备份根：禁止用 $C1_DIR/backup（A / B1 / C2 也写那里；B1 用 backup/B1，本单元用 backup/C1）
BACKUP_ROOT="$C1_DIR/backup/C1"
# 备份文件用带单元标记的名字（他档即使误扫到本目录，也拿不到"看起来通用"的文件名）
BACKUP_FILE="client-runtime.client.js"
# 本单元记录的「补丁前 live sha」常量——回滚所有权校验的判据，由规格文件现读（禁止手抄）
BASELINE_SHA1=""
STAMP="$(date +%Y%m%d-%H%M%S)"

FAILED=0
say()  { printf '%s\n' "$*"; }
pass() { printf '[PASS] %s\n' "$*"; }
skip() { printf '[SKIP] %s\n' "$*"; }
dry()  { printf '[DRY-RUN] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*" >&2; }
fail() { printf '[FAIL] %s\n' "$*" >&2; FAILED=1; }
hr()   { printf '%s\n' "--------------------------------------------------------------------"; }

# ---------------------------------------------------------------------------
# 前置校验（只读）
# ---------------------------------------------------------------------------
precheck() {
  local missing=0
  for tool in node diff sha1sum grep cp mkdir date; do
    command -v "$tool" >/dev/null 2>&1 || { warn "缺少工具：$tool"; missing=1; }
  done
  [ -f "$SPEC" ] || { warn "补丁规格缺失：$SPEC"; missing=1; }
  [ -f "$FIXER" ] || { warn "补丁执行体缺失：$FIXER"; missing=1; }
  [ -f "$TARGET" ] || { warn "目标文件不存在：$TARGET（可用 C1_TARGET 覆盖）"; missing=1; }
  [ "$missing" -eq 0 ] || return 1
  # 从规格里取「补丁前 live sha」常量（唯一真相源，避免手抄漂移）
  BASELINE_SHA1="$(node -e '
    import(process.argv[1]).then((m) => process.stdout.write(m.BASELINE_SHA1)).catch(() => process.exit(3));
  ' "file://$SPEC" 2>/dev/null || true)"
  if [ -z "$BASELINE_SHA1" ]; then
    warn "无法从规格读取 BASELINE_SHA1：$SPEC（回滚所有权校验将不可用）"
    missing=1
  fi
  [ "$missing" -eq 0 ] || return 1
  return 0
}

sha1_of() { sha1sum "$1" 2>/dev/null | cut -d' ' -f1; }

# ---------------------------------------------------------------------------
# 目标状态判定（只读）：baseline / applied / unknown
# 探针脚本写在**工作区**里（沙箱内），绝不写 /tmp 或 DSH 目录。
# ---------------------------------------------------------------------------
PROBE_JS="$SANDBOX_DIR/.c1-state.mjs"
write_probe() {
  mkdir -p "$SANDBOX_DIR" || return 1
  cat > "$PROBE_JS" <<'PROBE'
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const [, , specPath, file, only] = process.argv;
const { BASELINE_SHA1, markerOf } = await import(`file://${specPath}`);
const fixerPath = `${specPath.replace(/[^/]+$/, "")}unit-C1-fixer.mjs`;
const { selectPatches } = await import(`file://${fixerPath}`);
const PATCHES = selectPatches(only ?? "");
const text = readFileSync(file, "utf8");
const sha = createHash("sha1").update(text, "utf8").digest("hex");
const missing = PATCHES.filter((p) => text.split(markerOf(p)).length - 1 === 0).map((p) => p.id);
if (missing.length === 0) console.log("applied");
else if (missing.length === PATCHES.length && sha === BASELINE_SHA1) console.log("baseline");
else console.log(`unknown:missing=${missing.join(",")}:sha=${sha.slice(0, 12)}`);
PROBE
}
state_of() { node "$PROBE_JS" "$SPEC" "$1" "${ONLY:-}" 2>/dev/null || echo "unknown:probe-failed"; }

# ---------------------------------------------------------------------------
# 备份（仅 --apply / --rollback 之前需要）
# ---------------------------------------------------------------------------
make_backup() {
  local dest="$BACKUP_ROOT/$STAMP"
  local pre
  pre="$(sha1_of "$TARGET")"
  mkdir -p "$dest" || { fail "无法创建备份目录：$dest"; return 1; }
  cp -p "$TARGET" "$dest/$BACKUP_FILE" || { fail "备份失败：$TARGET → $dest"; return 1; }
  sha1_of "$dest/$BACKUP_FILE" > "$dest/$BACKUP_FILE.sha1"
  cat > "$dest/META.txt" <<META
unit=C1
module=dsh-client-runtime
target=$TARGET
mode=$MODE
stamp=$STAMP
backup_file=$BACKUP_FILE
pre_sha1=$pre
baseline_sha1=$BASELINE_SHA1
META
  if [ "$pre" != "$BASELINE_SHA1" ]; then
    warn "备份的 pre_sha1（$pre）与规格记录的基线（$BASELINE_SHA1）不同——目标不是干净基线，回滚所有权校验会拒绝。"
  fi
  pass "已备份目标 → $dest/$BACKUP_FILE（sha1 $pre）"
  return 0
}

# ---------------------------------------------------------------------------
# 回滚所有权校验（fail-closed）
# ---------------------------------------------------------------------------
# 必须同时满足，否则打印 [FAIL] 并以非零码退出、绝不落盘：
#   ① 备份目录里有本单元标记文件 $BACKUP_FILE；
#   ② META.txt 存在且 unit=C1；
#   ③ META.txt 的 pre_sha1 == 备份文件**实际内容** sha1（备份未被篡改/替换）；
#   ④ pre_sha1 == 本脚本记录的补丁前 live sha（BASELINE_SHA1，取自规格文件）——
#      这是防"误取他档快照覆盖 live"的关键：别的单元的快照其 pre-sha 必然不等于本单元的基线值。
rollback_owner_ok() {
  local dest="$1"
  if [ ! -f "$dest/$BACKUP_FILE" ]; then
    fail "备份不属于本单元（缺少 C1 标记文件 $BACKUP_FILE）：$dest ——拒绝回滚以免误覆 live。"
    return 1
  fi
  if [ ! -f "$dest/META.txt" ]; then
    fail "备份缺少 META.txt，无法做所有权校验：$dest ——拒绝回滚以免误覆 live。"
    return 1
  fi
  local unit pre actual
  unit="$(sed -n 's/^unit=//p' "$dest/META.txt" | head -1)"
  pre="$(sed -n 's/^pre_sha1=//p' "$dest/META.txt" | head -1)"
  actual="$(sha1_of "$dest/$BACKUP_FILE")"
  if [ "$unit" != "C1" ]; then
    fail "备份 META 声明 unit='$unit'（应为 C1）：$dest ——拒绝回滚以免误覆 live。"
    return 1
  fi
  if [ "$pre" != "$actual" ]; then
    fail "备份自校验失败：META pre_sha1=$pre，备份文件实际 sha1=$actual ——拒绝回滚。"
    return 1
  fi
  if [ "$pre" != "$BASELINE_SHA1" ]; then
    fail "备份不属于本单元：其 pre_sha1=$pre，本单元记录的补丁前 live sha=$BASELINE_SHA1 ——拒绝回滚以免误覆 live。"
    return 1
  fi
  pass "回滚所有权校验通过：unit=C1 / pre_sha1=$pre == 本单元记录的补丁前 live sha"
  return 0
}

latest_backup() {
  [ -d "$BACKUP_ROOT" ] || return 0
  ls -1d "$BACKUP_ROOT"/*/ 2>/dev/null | sort | tail -1
}

# ---------------------------------------------------------------------------
# dry-run：在工作区副本上应用 + diff -u + 校验（绝不触碰目标）
# ---------------------------------------------------------------------------
do_dry_run() {
  hr
  say "模式：dry-run（只在工作区副本上操作，不写 $TARGET）"
  mkdir -p "$SANDBOX_DIR" "$PATCHED_DIR" || { fail "无法创建工作区目录"; return 1; }
  local sandbox="$SANDBOX_DIR/client.baseline-$STAMP.js"
  cp "$TARGET" "$sandbox" || { fail "复制目标到工作区失败"; return 1; }
  pass "基线副本 → $sandbox（sha1 $(sha1_of "$sandbox"))"

  local out="$PATCHED_DIR/$PATCHED_NAME"
  mkdir -p "$C1_DIR/reports" || { fail "无法创建 $C1_DIR/reports"; return 1; }
  local fixlog="$C1_DIR/reports/C1.fixer-dryrun.json"
  node "$FIXER" --file "$sandbox" --out "$out" ${ONLY:+--only "$ONLY"} --print-summary > "$fixlog" 2>&1
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    fail "补丁器返回 $rc；输出如下："
    sed -n '1,60p' "$fixlog"
    return 1
  fi
  pass "补丁器：ok（锚点逐个唯一命中，详见 reports/C1.fixer-dryrun.json）"
  grep -o '"id": "[A-Za-z0-9]*"' "$fixlog" | sed 's/.*: //' | tr -d '"' | paste -sd, - | sed 's/^/  已应用补丁：/'

  # node --check（改后副本）
  if node --check "$out" 2>"$SANDBOX_DIR/.check.err"; then
    pass "node --check 改后副本：PASS"
  else
    fail "node --check 改后副本：FAIL"; sed -n '1,20p' "$SANDBOX_DIR/.check.err"
  fi

  # diff -u（完整）
  local diffout="$C1_DIR/evidence/unit-C1.diff"
  if [ -n "$ONLY" ]; then diffout="$C1_DIR/evidence/unit-C1-only-$(printf '%s' "$ONLY" | tr ',' '-').diff"; fi
  mkdir -p "$C1_DIR/evidence"
  diff -u "$sandbox" "$out" > "$diffout"
  local dlines; dlines="$(wc -l < "$diffout")"
  pass "diff -u → $diffout（$dlines 行；新增 $(grep -c '^+' "$diffout") / 删除 $(grep -c '^-' "$diffout")）"
  say ""
  say "diff 摘要（每个 hunk 的头一行）："
  grep -n '^@@' "$diffout" | sed 's/^/  /'

  # 逐单元锚点/标记复核（参数走环境变量：`node -e` 会把首个额外参数当脚本路径，不能传位置参数）
  say ""
  C1_SPEC="$SPEC" C1_BASE="$sandbox" C1_PATCHED="$out" C1_ONLY="$ONLY" node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const { UNITS, markerOf } = await import(`file://${process.env.C1_SPEC}`);
    const fixerPath = process.env.C1_SPEC.replace(/[^/]+$/, "") + "unit-C1-fixer.mjs";
    const { selectPatches } = await import(`file://${fixerPath}`);
    const PATCHES = selectPatches(process.env.C1_ONLY ?? "");
    const b = readFileSync(process.env.C1_BASE, "utf8");
    const p = readFileSync(process.env.C1_PATCHED, "utf8");
    let allOk = true;
    for (const u of UNITS.filter((x) => x.patches.every((id) => PATCHES.some((p) => p.id === id)))) {
      const beforeOk = u.patches.every((id) => b.split(PATCHES.find((x) => x.id === id).anchor).length - 1 === 1);
      const afterOk = u.patches.every((id) => p.split(markerOf(PATCHES.find((x) => x.id === id))).length - 1 >= 1);
      if (!(beforeOk && afterOk)) allOk = false;
      console.log(`  [${beforeOk && afterOk ? "OK " : "!! "}] ${u.id}  基线唯一命中=${beforeOk}  改后含标记=${afterOk}`);
    }
    const leftover = PATCHES.filter((x) => p.split(x.anchor).length - 1 > 0).map((x) => x.id);
    console.log(`  残留锚点：${leftover.length === 0 ? "无" : leftover.join(",")}`);
    process.exit(allOk ? 0 : 1);
  ' || fail "逐单元复核失败"

  # 幂等复核：对改后副本再跑一次补丁器，必须判定 already-applied
  local out2="$SANDBOX_DIR/client.replay-check-$STAMP.js"
  node "$FIXER" --file "$out" --out "$out2" ${ONLY:+--only "$ONLY"} --print-summary > "$SANDBOX_DIR/.replay.json" 2>&1
  if grep -q '"status": "already-applied"' "$SANDBOX_DIR/.replay.json"; then
    pass "幂等复核：对改后副本重跑补丁器 → already-applied（且未改动字节）"
    cmp -s "$out" "$out2" && pass "幂等复核：改后副本字节两次一致" || fail "幂等复核：两次输出字节不一致（不应发生）"
  else
    fail "幂等复核：改后副本未被判定为已应用"; sed -n '1,20p' "$SANDBOX_DIR/.replay.json"
  fi

  say ""
  say "dry-run 完成：目标文件未被触碰（sha1 仍为 $(sha1_of "$TARGET"))"
  say "要真实应用：bash $0 --apply"
}

# ---------------------------------------------------------------------------
# apply：备份 → 写目标 → 校验
# ---------------------------------------------------------------------------
do_apply() {
  hr
  say "模式：apply（真实写入 $TARGET）"
  local st; st="$(state_of "$TARGET")"
  case "$st" in
    applied)
      skip "目标已含全部补丁标记（already-applied），无需重复应用。"
      say "当前 sha1：$(sha1_of "$TARGET")"
      return 0
      ;;
    baseline) pass "目标状态：baseline（sha1 $(sha1_of "$TARGET") 与 specs 记录一致）" ;;
    *) fail "目标状态未知（$st）——拒绝应用。请先 --rollback 还原到基线。"; return 1 ;;
  esac

  mkdir -p "$PATCHED_DIR" || { fail "无法创建 $PATCHED_DIR"; return 1; }
  make_backup || return 1

  local out="$PATCHED_DIR/$PATCHED_NAME"
  mkdir -p "$C1_DIR/reports" || { fail "无法创建 $C1_DIR/reports"; return 1; }
  local fixlog="$C1_DIR/reports/C1.fixer-apply.json"
  node "$FIXER" --file "$TARGET" --out "$out" ${ONLY:+--only "$ONLY"} --print-summary > "$fixlog" 2>&1
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    fail "补丁器返回 $rc，未写目标；输出如下："; sed -n '1,60p' "$fixlog"; return 1
  fi
  pass "改后文本已生成 → $out（sha1 $(sha1_of "$out"))"

  node --check "$out" || { fail "node --check 改后副本失败，未写目标"; return 1; }
  pass "node --check 改后副本：PASS"

  cp "$out" "$TARGET" || { fail "写入目标失败"; return 1; }
  local after; after="$(sha1_of "$TARGET")"
  if [ "$after" = "$(sha1_of "$out")" ]; then
    pass "写入校验：目标 sha1 == 改后副本 sha1（$after）"
  else
    fail "写入校验失败：目标 $after != 期望 $(sha1_of "$out")"
  fi

  hr
  say "客户端 bundle 生效路径（无需重启宿主 PID）："
  say "  1) 浏览器整页刷新一次（推荐；本包是核心 runtime）"
  say "  2) 或等 SSE 热换：dsh-client-hmr 每 500ms stat 轮询 → 重算 rev → 推 rebuilt 帧 → 浏览器自动换"
  if [ "${C1_SKIP_HTTP:-0}" != "1" ] && command -v curl >/dev/null 2>&1; then
    say ""
    say "HTTP 复核（单次请求）："
    local rev; rev="$(sha1_of "$TARGET" | cut -c1-12)"
    local head; head="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3080/plugins/@deepseek-ai/dsh-client-runtime/client.js?rev=$rev" 2>/dev/null || echo "curl-failed")"
    say "  GET /plugins/@deepseek-ai/dsh-client-runtime/client.js?rev=$rev → $head"
    say "  期望 200；且下一次页面加载的 __DSH_BOOT__ 里该包 rev 应为 $rev"
    say "  复核命令：curl -s http://127.0.0.1:3080/ | grep -o 'dsh-client-runtime/client.js?rev=[0-9a-f]*'"
  else
    say "（已跳过 HTTP 复核；rev 期望前缀 = $(sha1_of "$TARGET" | cut -c1-12)）"
  fi
  say ""
  say "回滚：bash $0 --rollback（备份根 $BACKUP_ROOT，含所有权校验）"
}

# ---------------------------------------------------------------------------
# rollback：用最新备份还原
# ---------------------------------------------------------------------------
do_rollback() {
  hr
  say "模式：rollback（本单元独占备份根：$BACKUP_ROOT）"
  say "本单元记录的补丁前 live sha（BASELINE_SHA1）= $BASELINE_SHA1"
  local dest; dest="$(latest_backup)"
  if [ -z "$dest" ]; then
    fail "找不到本单元备份（$BACKUP_ROOT/*/）——拒绝回滚。"
    return 1
  fi
  say "候选备份（最新）：$dest"
  rollback_owner_ok "$dest" || return 1
  local want; want="$(sed -n 's/^pre_sha1=//p' "$dest/META.txt" | head -1)"
  cp -p "$dest/$BACKUP_FILE" "$TARGET" || { fail "还原失败"; return 1; }
  local after; after="$(sha1_of "$TARGET")"
  if [ -n "$want" ] && [ "$after" = "$want" ]; then
    pass "已还原目标，sha1=$after（与备份记录一致）"
  else
    fail "还原校验失败：目标 $after，备份记录 ${want:-未知}"
  fi
  local st; st="$(state_of "$TARGET")"
  say "还原后状态判定：$st（期望 baseline）"
  if [ "$after" != "$BASELINE_SHA1" ]; then
    fail "还原后 sha1=$after != 记录的补丁前 live sha=$BASELINE_SHA1 —— 请人工核对。"
  fi
  say "浏览器刷新一次即可回到打补丁前的代码（同样无需重启宿主）。"
}

# ---------------------------------------------------------------------------
hr
say "单元 C1 补丁脚本 · 目标：$TARGET"
say "工作区根：$C1_DIR"
hr
precheck || { fail "前置校验未通过，终止。"; exit 1; }
write_probe || { fail "无法写入状态探针（$PROBE_JS）"; exit 1; }

case "$MODE" in
  dry-run) do_dry_run ;;
  apply)   do_apply ;;
  rollback) do_rollback ;;
esac

hr
if [ "$FAILED" -eq 0 ]; then
  pass "结论：通过（$MODE）"
else
  fail "结论：存在问题，请见上方 [FAIL] 行"
fi
exit "$FAILED"
