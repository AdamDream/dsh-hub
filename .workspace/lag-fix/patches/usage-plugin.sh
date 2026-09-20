#!/usr/bin/env bash
# ============================================================================
# usage-plugin.sh — @local/dsh-usage 宿主主线程冻结修复补丁（单元 A：A0 + A1 + A2 + B2）
# ============================================================================
# 规格：.workspace/settings-lag/audit-usage-fix.md §5（A0/A1/A2/B2）与用户裁决四项：
#   1) 日粒度查询走预聚合表 usage_daily，并同时处理「窗口不日对齐」的正确性坑
#      → 客户端窗口日对齐（A0）+ 宿主侧显式闸门（A1：daily 只服务「日对齐窗口 且
#        day <= MAX(day)」的已聚合段，其余段回落 sargable events）
#   2) lib/db.js rebuildDailyForDays 顺带 sargable 化（ts 范围）
#   3) 轮询：IntersectionObserver 可见性门控 + 默认周期 30s → 60s；保留 refreshSec=0「不轮询」
#   4) 不动 lib/charts.js（死文件）
#
# ⚠️ 本插件在工作区里存在**两份互不相同的拷贝**（实测 inode 不同，是拷贝不是链接）：
#   source   : <repo>/dsh-usage/                                     ← git 跟踪、可写、无需审批
#   deployed : ~/.dsh/profiles/node_modules/@local/dsh-usage/         ← 宿主实际加载、在工作区外
# 两侧已经漂移（部署侧是更新的超集：hourly 粒度 / 趋势 gear / settingsScope / peakRing …）。
# 因此**必须显式选择目标**，不要用某一侧覆盖另一侧（--compare 会给出漂移清单）。
#
# 目标文件（仅 2 个，两侧同名）：<PKG>/lib/db.js、<PKG>/lib/client.js
#   db.js      —— A1（queryHeatmap 走 usage_daily + 闸门 + sargable 回落）
#                 A2（rebuildDailyForDays 的日级谓词换 ts 半开区间）
#   client.js  —— A0（rangeDays 窗口按本地自然日对齐）
#                 B2（默认 60s + 可见性门控；refreshSec=0 语义不变）
#
# ★ 生效路径：**两个半面的机制完全不同，不要混为一谈** ★
#   · client 半（lib/client.js）—— **热面**：`/plugins/<id>/client.js` 每次 GET 都从磁盘
#     readFile + `cache-control: no-cache`，URL 上的 `?rev=` 只是 sha1-12 缓存破坏串；
#     `dsh-client-hmr` 以 500ms 轮询 stat 比对 mtime/size，变化即重算 rev 并经 SSE
#     推 `rebuilt` → 浏览器原地热替换。**保存文件 ≤500ms 生效，无需重启、无需手动刷新。**
#   · host 半（lib/db.js）—— **宿主面**：web 层 HMR `disabled: true`、兜底 HMR `root: []`，
#     且运行中进程的模块缓存不会失效 → **必须重启宿主进程才生效**（本脚本不重启）。
#
# 硬约束（本脚本遵守）：不建索引、不 VACUUM/ANALYZE、不写 usage.db；不触碰宿主进程；
#   备份一律落在工作区且**本单元独占命名空间**：<LAGFIX_DIR>/backup-usage/<target>/backup-<时间戳>/；
#   dry-run 只动工作区内副本。回滚前强制做**备份所有权校验**（详见 --rollback 段与报告 §9）。
#
# 模式：
#   ./usage-plugin.sh --dry-run   [--target source|deployed]
#        把该侧两个目标文件复制到**工作区内** tmp/dryrun-<target>-<时间戳>/，在副本上应用
#        全部替换 → 打印 diff -u + 锚点/语法/索引集合校验。绝不碰真实文件。
#   ./usage-plugin.sh --apply     --target source|deployed
#        对该侧真实路径应用（备份 → 锚点唯一命中校验 → 应用 → 校验）。
#        source   : 工作区内，可自行执行并用 git diff 校验
#        deployed : 工作区外，**必须由主 agent 带审批执行**
#   ./usage-plugin.sh --rollback  --target source|deployed
#        用该侧最新备份还原两个文件。**回滚前强制作废性校验**：备份自洽（SHA256SUMS 全 OK）、
#        MANIFEST 的 unit/target 与本单元一致、且 live 的 sha 必须 ∈ {pre-sha, post-sha}
#        并至少一个文件等于 post-sha；任一不符即 [FAIL] 拒绝回滚，绝不覆盖 live。
#        还原后生效路径同上：client.js 刷新即生效（热面）；db.js 需重启宿主（宿主面）。
#   ./usage-plugin.sh --compare
#        只读比对两侧全部文件（sha256/字节数/行数/inode）+ 逐替换点锚点命中矩阵，
#        输出漂移清单与「补丁是否两侧同时适用」结论；不写任何真实文件。
# 幂等：每个替换点先用命中数校验唯一性；已全部应用的单元打印 [SKIP] 并跳过；
#       部分应用（新版已存在但旧版不唯一）→ 报错拒绝，要求先 --rollback。
# 环境变量覆盖：
#   USAGE_SRC_DIR   工作区源码目录（默认 <repo>/dsh-usage，repo = LAGFIX_DIR 的上两级）
#   USAGE_DEP_DIR   部署拷贝目录（默认 $HOME/.dsh/profiles/node_modules/@local/dsh-usage）
#   USAGE_PKG_DIR   直接指定目标目录（覆盖 --target 的解析结果，测试用）
#   LAGFIX_DIR      本套件工作区根（默认脚本上一级目录 = .workspace/lag-fix）
#   BACKUP_DIR      备份根（默认 $LAGFIX_DIR/backup-usage/<target>，本单元独占命名空间）
# 依赖：bash / grep / diff / cp / mv / mkdir / sha256sum / node（--check）/ python3
# ============================================================================
set -u

MODE=""
TARGET=""
ROLLBACK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h) MODE="help" ;;
    --dry-run) MODE="dry" ;;
    --apply) MODE="apply" ;;
    --rollback) MODE="rollback"; ROLLBACK=1 ;;
    --compare) MODE="compare" ;;
    --target)
      shift
      TARGET="${1:-}"
      ;;
    --target=*) TARGET="${1#--target=}" ;;
    *)
      echo "未知参数：$1" >&2
      echo "用法：$0 --dry-run|--apply|--rollback [--target source|deployed] | --compare | --help" >&2
      exit 2
      ;;
  esac
  shift
done

if [ -z "$MODE" ]; then
  echo "用法：$0 --dry-run|--apply|--rollback [--target source|deployed] | --compare | --help" >&2
  exit 2
fi
if [ "$MODE" = "help" ]; then
  sed -n '2,60p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
fi
DRY=0
[ "$MODE" = "dry" ] && DRY=1

# --target 默认：source（工作区内、可自行执行）；deployed 需主 agent 带审批执行
[ -z "$TARGET" ] && TARGET="source"
case "$TARGET" in
  source|deployed) ;;
  *) echo "未知 --target：$TARGET（可用：source / deployed）" >&2; exit 2 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${LAGFIX_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
REPO_ROOT="$(cd "$WORK/../.." && pwd)"
USAGE_SRC_DIR="${USAGE_SRC_DIR:-$REPO_ROOT/dsh-usage}"
USAGE_DEP_DIR="${USAGE_DEP_DIR:-$HOME/.dsh/profiles/node_modules/@local/dsh-usage}"
if [ -n "${USAGE_PKG_DIR:-}" ]; then
  PKG="$USAGE_PKG_DIR"
elif [ "$TARGET" = "source" ]; then
  PKG="$USAGE_SRC_DIR"
else
  PKG="$USAGE_DEP_DIR"
fi
BACKUP_ROOT="${BACKUP_DIR:-$WORK/backup-usage/$TARGET}"
STATE_FILE="$WORK/patches/usage-plugin.state.$TARGET"
DB="$PKG/lib/db.js"
CLIENT="$PKG/lib/client.js"

FAILED=0
say()  { printf '%s\n' "$*"; }
pass() { printf '[PASS] %s\n' "$*"; }
skip() { printf '[SKIP] %s\n' "$*"; }
dry()  { printf '[DRY-RUN] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*" >&2; }
fail() { printf '[FAIL] %s\n' "$*" >&2; FAILED=1; }


# ---------------------------------------------------------------------------
# 锚点（每个都必须 grep -c 唯一命中；命中数不符即拒绝应用）
# ---------------------------------------------------------------------------
A_DB_ROUTE='export function queryHeatmap(db, filters = {}) {'            # A1 起点（1 次）
A_DB_REBUILD='export function rebuildDailyForDays(db, days) {'           # A2 起点（1 次）
A_CLIENT_RANGE='if (rangeDays > 0) return { from: now - rangeDays * 86400000, to: now };'  # A0（1 次）
A_CLIENT_POLL='if (refreshSec <= 0) return;'                             # B2 旧轮询 effect（1 次）
A_CLIENT_OPT30='react.createElement("option", { value: "30" }, "30s 刷新"),'  # B2 下拉项（1 次）

# 已应用哨兵（改动里新引入、旧文件绝不含有的字符串）
S_DB_ROUTE='const maxDayNextExclusive'
S_DB_REBUILD='const tailHasRows'
S_CLIENT_RANGE='localDayEnd'
S_CLIENT_POLL='pollVisible'

anchor_count() { grep -cF -- "$1" "$2" 2>/dev/null || true; }

# ---------------------------------------------------------------------------
# python3 替换脚本（读锚点/替换块 → 校验唯一命中 → 替换 → 写回）
# ---------------------------------------------------------------------------
apply_file() { # $1=目标文件(可写) $2=python 任务名
  local target="$1" job="$2"
  python3 - "$target" "$job" "$SCRIPT_DIR" <<'PYEOF'
import sys, os
target, job, here = sys.argv[1], sys.argv[2], sys.argv[3]
spec = open(os.path.join(here, "usage-plugin.replacements.txt"), encoding="utf-8").read()
blocks = {}
cur = None
cur_pair = None
for raw in spec.split("\n"):
    line = raw.rstrip("\r")
    if line.startswith("@@JOB "):
        name = line[len("@@JOB "):].strip()
        cur = {"name": name, "pairs": []}
        blocks[name] = cur
        cur_pair = None
    elif line.startswith("@@OLD") and cur is not None:
        cur_pair = {"anchor": None, "old": [], "new": [], "sect": "old"}
        cur["pairs"].append(cur_pair)
    elif line.startswith("@@ANCHOR ") and cur_pair is not None:
        cur_pair["anchor"] = line[len("@@ANCHOR "):].rstrip("\r")
    elif line.startswith("@@NEW") and cur_pair is not None:
        cur_pair["sect"] = "new"
    elif cur_pair is not None and cur_pair["sect"] in ("old", "new"):
        cur_pair[cur_pair["sect"]].append(line)

if job not in blocks:
    print(f"内部错误：未知任务 {job}", file=sys.stderr); sys.exit(3)
def j(s):
    return "\n".join(s) + "\n"
pairs = []
for blk in blocks[job]["pairs"]:
    if blk["old"] == blk["new"]:
        print(f"内部错误：{job} 的替换块 old == new（占位未填充）", file=sys.stderr); sys.exit(3)
    pairs.append((j(blk["old"]), j(blk["new"])))
src = open(target, encoding="utf-8").read()
for old, new in pairs:
    if new in src and old not in src:
        print(f"SKIP {job}：新版块已存在"); sys.exit(10)
    n = src.count(old)
    if n != 1:
        print(f"锚点校验失败：{job} 的旧版块在 {target} 命中 {n} 次（要求恰好 1 次）— 拒绝应用", file=sys.stderr)
        sys.exit(4)
    if new in src:
        print(f"锚点校验失败：{job} 新版块已存在但旧版块不唯一 — 请先 --rollback", file=sys.stderr); sys.exit(4)
for old, new in pairs:
    src = src.replace(old, new, 1)
open(target, "w", encoding="utf-8").write(src)
print(f"APPLIED {job}（{len(pairs)} 处替换）")
PYEOF
}

# 判断各单元是否已应用
u_a1_applied() { grep -qF "$S_DB_ROUTE" "$1" 2>/dev/null; }
u_a2_applied() { grep -qF "$S_DB_REBUILD" "$1" 2>/dev/null; }
u_a0_applied() { grep -qF "$S_CLIENT_RANGE" "$1" 2>/dev/null; }
u_b2_applied() { grep -qF "$S_CLIENT_POLL" "$1" 2>/dev/null; }

# ---------------------------------------------------------------------------
# 锚点预检（只读）：每个待应用单元的锚点必须唯一命中
# ---------------------------------------------------------------------------
precheck_anchors() { # $1=db文件 $2=client文件（已应用的单元其锚点必然不再命中，此处只校验未应用单元）
  local dbf="$1" clf="$2" n bad=0 name pat file
  for name in A1 A2 A0 B2-poll B2-option; do
    case "$name" in
      A1)        pat="$A_DB_ROUTE";     file="$dbf" ;;
      A2)        pat="$A_DB_REBUILD";   file="$dbf" ;;
      A0)        pat="$A_CLIENT_RANGE"; file="$clf" ;;
      B2-poll)   pat="$A_CLIENT_POLL";  file="$clf" ;;
      B2-option) pat="$A_CLIENT_OPT30"; file="$clf" ;;
    esac
    n="$(anchor_count "$pat" "$file")"
    if [ "$n" = "1" ]; then
      pass "$name 锚点唯一命中（$(basename "$file")）：${pat:0:52}…"
    elif [ "$n" = "0" ]; then
      skip "$name 锚点 0 次（视为已应用或目标漂移，由后续逐单元替换判定）"
    else
      fail "$name 锚点命中 $n 次（要求恰好 1）：$pat  ← $file"
      bad=1
    fi
  done
  [ "$bad" -eq 0 ]
}

nodecheck() { # $1=文件
  if node --check "$1" >/dev/null 2>&1; then pass "node --check 通过：$(basename "$1")"
  else fail "node --check 失败：$1"; node --check "$1" >&2 || true; return 1; fi
}

# ---------------------------------------------------------------------------
# 回滚（含**备份所有权校验**：任一不符即拒绝，绝不覆盖 live）
# ---------------------------------------------------------------------------
# 背景（跨单元真实隐患）：多档补丁脚本共用备份根 + `ls | sort | tail -1` 选最新备份，
# 一旦备份根被别的单元写入，就可能拿**别的单元的快照**覆盖 live。本单元三重护栏：
#   (a) 备份自洽：SHA256SUMS 全部 OK，且文件恰好是 db.js + client.js 两个
#   (b) 清单内容：MANIFEST 的 unit 必须是 usage-plugin，target 必须与本次一致，
#                 且 MANIFEST 记的 pre-sha 必须与备份文件的实际 sha 相同
#   (c) live 归属：live 的 sha 必须 ∈ {pre-sha, post-sha}，且**至少一个文件 == post-sha**
#                 （证明该 target 确实被本单元改过）——否则拒绝回滚
rollback_verify() { # $1=备份目录；返回 0=通过
  local B="$1" bad=0 f live pre post
  # (a) 备份自洽
  if [ -f "$B/SHA256SUMS" ]; then
    (cd "$B" && sha256sum -c SHA256SUMS >/dev/null 2>&1) \
      && pass "备份自洽：SHA256SUMS 全部校验通过" \
      || { fail "备份内容与其 SHA256SUMS 不符（备份被改动或本身损坏）"; bad=1; }
  else
    fail "备份缺 SHA256SUMS（无法证明备份完整性）"; bad=1
  fi
  if [ ! -f "$B/MANIFEST" ]; then
    fail "备份缺 MANIFEST（无法证明该备份属于本单元）"; bad=1
  else
    local mf_unit mf_target mf_db mf_client
    mf_unit="$(awk -F= '$1=="unit"{print $2}' "$B/MANIFEST")"
    mf_target="$(awk -F= '$1=="target"{print $2}' "$B/MANIFEST")"
    mf_db="$(awk -F= '$1=="db_pre"{print $2}' "$B/MANIFEST")"
    mf_client="$(awk -F= '$1=="client_pre"{print $2}' "$B/MANIFEST")"
    if [ "$mf_unit" != "usage-plugin/A0+A1+A2+B2" ]; then
      fail "备份不属于本单元（MANIFEST unit=$mf_unit，期望 usage-plugin/A0+A1+A2+B2）"; bad=1
    fi
    if [ "$mf_target" != "$TARGET" ]; then
      fail "备份 target 不符（MANIFEST target=$mf_target，本次 --target $TARGET）"; bad=1
    fi
    [ "$mf_db" = "$(sha256sum "$B/db.js" 2>/dev/null | cut -d' ' -f1)" ] \
      || { fail "MANIFEST 记的 db.js pre-sha 与备份文件不符"; bad=1; }
    [ "$mf_client" = "$(sha256sum "$B/client.js" 2>/dev/null | cut -d' ' -f1)" ] \
      || { fail "MANIFEST 记的 client.js pre-sha 与备份文件不符"; bad=1; }
  fi
  # (c) live 归属：必须 ∈ {pre, post}，且至少一个 == post
  local any_post=0
  for f in db.js client.js; do
    live="$(sha256sum "$PKG/lib/$f" 2>/dev/null | cut -d' ' -f1)"
    pre="$(sha256sum "$B/$f" 2>/dev/null | cut -d' ' -f1)"
    post="$(awk -v n="$f" '$2==n{print $1}' "$B/POST_SHA256SUMS" 2>/dev/null)"
    if [ -z "$post" ]; then
      warn "备份缺 POST_SHA256SUMS 条目（$f）——无法确认 live 归属，拒绝回滚"
      bad=1; continue
    fi
    if [ "$live" = "$post" ]; then
      any_post=1
    elif [ "$live" != "$pre" ]; then
      fail "live $f 既非本单元的改前也非改后状态（live=${live:0:12} pre=${pre:0:12} post=${post:0:12}）"
      bad=1
    fi
  done
  [ "$any_post" -eq 1 ] || { fail "live 未处于本单元的改后状态（该 target 可能未打过本补丁）——拒绝回滚以免误覆"; bad=1; }
  return "$bad"
}

if [ "${ROLLBACK:-0}" -eq 1 ]; then
  latest="$(ls -d "$BACKUP_ROOT"/backup-* 2>/dev/null | sort | tail -n 1)"
  if [ -z "$latest" ]; then warn "未找到备份（$BACKUP_ROOT/backup-*），无法回滚"; exit 1; fi
  say "备份根（本单元独占命名空间）：$BACKUP_ROOT"
  say "使用最新备份：$latest"
  say ""
  say "── 备份所有权校验 ──"
  if ! rollback_verify "$latest"; then
    fail "备份不属于本单元或 live 归属不明 —— 拒绝回滚以免误覆 live（live 未被改动）"
    exit 1
  fi
  pass "所有权校验通过：该备份确为本单元（usage-plugin / target=$TARGET）所建"
  say ""
  # 先全部落到工作区暂存，校验通过后再落 live（避免半还原）
  STAGE="$(mktemp -d "${TMPDIR:-/tmp}/lagfix-rb.XXXXXX")" || exit 1
  cp -f "$latest/db.js" "$STAGE/db.js" && cp -f "$latest/client.js" "$STAGE/client.js" \
    || { fail "备份文件无法复制到暂存区"; rm -rf "$STAGE"; exit 1; }
  node --check "$STAGE/db.js" >/dev/null 2>&1 || { fail "暂存的 db.js 语法检查失败，拒绝还原"; rm -rf "$STAGE"; exit 1; }
  if [ "$TARGET" = "deployed" ]; then
    node --check "$STAGE/client.js" >/dev/null 2>&1 || { fail "暂存的 client.js 语法检查失败，拒绝还原"; rm -rf "$STAGE"; exit 1; }
  fi
  for f in db.js client.js; do
    cp -f "$STAGE/$f" "$PKG/lib/$f" || { fail "还原 $f 失败"; rm -rf "$STAGE"; exit 1; }
    say "已还原 $f"
  done
  rm -rf "$STAGE"
  (cd "$PKG/lib" && sha256sum -c "$latest/SHA256SUMS") \
    || { fail "还原后与备份 pre-sha 不一致"; exit 1; }
  pass "回滚完成（还原内容与备份 pre-sha 逐字节一致）"
  say "生效路径（两类不同）："
  say "  · lib/client.js（热面）：/plugins/<id>/client.js 每次 GET 从磁盘读 + no-cache，"
  say "    ?rev= 只是 sha1-12 缓存破坏串，HMR 500ms 轮询推 rebuilt → 刷新页面即生效，无需重启。"
  say "  · lib/db.js（宿主面）：web 层 HMR disabled、兜底 HMR root: [] → 必须重启宿主进程才真正退回旧行为。"
  exit 0
fi

# ---------------------------------------------------------------------------
# 前置校验
# ---------------------------------------------------------------------------
[ -f "$DB" ] || { warn "目标文件不存在：$DB（可用 USAGE_PKG_DIR 覆盖）"; exit 1; }
[ -f "$CLIENT" ] || { warn "目标文件不存在：$CLIENT"; exit 1; }
[ -f "$SCRIPT_DIR/usage-plugin.replacements.txt" ] || { warn "缺少替换块文件：$SCRIPT_DIR/usage-plugin.replacements.txt"; exit 1; }
command -v python3 >/dev/null 2>&1 || { warn "缺少 python3"; exit 1; }
command -v node >/dev/null 2>&1 || { warn "缺少 node"; exit 1; }

if [ "$MODE" != "compare" ]; then
  say "===== usage-plugin.sh：$( [ "$DRY" -eq 1 ] && echo 'DRY-RUN（只动工作区内副本）' || echo 'APPLY（对真实路径应用）' ) / target=$TARGET ====="
  say "PKG=$PKG"
  say "WORK=$WORK"
  say "REPO_ROOT=$REPO_ROOT"
fi

# ---------------------------------------------------------------------------
# DRY-RUN：工作区内副本上应用 + diff + 校验，绝不碰真实文件
# ---------------------------------------------------------------------------
if [ "$DRY" -eq 1 ]; then
  STAMP_DRY="$(date +%Y%m%d-%H%M%S)"
  TMP="$WORK/tmp/dryrun-$TARGET-$STAMP_DRY"
  mkdir -p "$TMP" || exit 1
  # 基线选择：live 未被本单元改过 → 直接用 live 当基线（原语义）；
  # live 已处于「本单元改后」状态 → 从最近一次本单元备份的 pre-sha 内容恢复基线，
  # 这样 diff 仍展示「补丁引入的改动」，而不是空 diff（干跑幂等）。
  LIVE_PATCHED=0
  if u_a1_applied "$DB" || u_a0_applied "$CLIENT" || u_b2_applied "$CLIENT"; then LIVE_PATCHED=1; fi
  if [ "$LIVE_PATCHED" -eq 1 ]; then
    RBASE="$(ls -d "$BACKUP_ROOT"/backup-* 2>/dev/null | sort | tail -n 1)"
    if [ -n "$RBASE" ] && [ -f "$RBASE/db.js" ] && [ -f "$RBASE/client.js" ]; then
      cp -p "$RBASE/db.js" "$TMP/db.js"; cp -p "$RBASE/client.js" "$TMP/client.js"
      say "ℹ️ live 已处于本单元「改后」状态 → 基线取自最近备份的 pre-sha 内容：$RBASE"
    else
      warn "live 已打过补丁但找不到可用备份（$BACKUP_ROOT/backup-*）→ 无法重建 pre-patch 基线"
      cp -p "$DB" "$TMP/db.js"; cp -p "$CLIENT" "$TMP/client.js"
    fi
  else
    cp -p "$DB" "$TMP/db.js"; cp -p "$CLIENT" "$TMP/client.js"
    say "ℹ️ live 未被本单元改过 → 基线 = live 本体"
  fi
  (cd "$TMP" && sha256sum db.js client.js > SHA256SUMS.orig)
  # 保留 pre-patch 基线快照：副本目录里的 db.js/client.js 会在下面被替换成「应用后」内容，
  # 若不留一份 pre 快照，后续复核就无法证明「pre ≠ post」与「live 归属」。
  cp -p "$TMP/db.js" "$TMP/db.js.pre"; cp -p "$TMP/client.js" "$TMP/client.js.pre"
  say "副本目录（工作区内，保留供核对）：$TMP"
  say "  · db.js / client.js          = 应用后副本"
  say "  · db.js.pre / client.js.pre  = pre-patch 基线（SHA256SUMS.orig 对应之内容）"
  precheck_anchors "$DB" "$CLIENT" || { fail "锚点预检未通过（真实文件未被触碰）"; exit 1; }
  for job in db-route db-rebuild client-range client-poll; do
    case "$job" in
      db-route|db-rebuild) jobfile="$TMP/db.js" ;;
      *) jobfile="$TMP/client.js" ;;
    esac
    if apply_file "$jobfile" "$job"; then
      pass "副本应用成功：$job"
    else
      rc=$?
      if [ "$rc" = "10" ]; then skip "$job 已是新版（幂等）"
      else fail "$job 在副本上应用失败（rc=$rc）"; fi
    fi
  done
  say ""
  say "──────── diff -u（左=pre-patch 基线，右=应用后副本）────────"
  # 左端一律取 pre 快照（不是 live）：live 可能已经是「改后」状态，
  # 那样与「应用后副本」比会得到空 diff，看不到补丁到底改了什么。
  diff -u --label "a/lib/db.js (pre-patch)" --label "b/lib/db.js (patched)" "$TMP/db.js.pre" "$TMP/db.js" || true
  diff -u --label "a/lib/client.js (pre-patch)" --label "b/lib/client.js (patched)" "$TMP/client.js.pre" "$TMP/client.js" || true
  say "──────── diff 结束 ────────"
  nodecheck "$TMP/db.js"
  nodecheck "$TMP/client.js"
  say ""
  say "真实目标（未被触碰）：$PKG/lib/{db.js,client.js}"
  (cd "$PKG/lib" && sha256sum db.js client.js) | sed 's/^/  live: /'
  if [ "$FAILED" -eq 0 ]; then
    say "===== DRY-RUN 通过：真实文件未被修改（可安全 --apply --target $TARGET）====="
  else
    say "===== DRY-RUN 存在 FAIL，请勿 --apply ====="
  fi
  exit "$FAILED"
fi

# ---------------------------------------------------------------------------
# COMPARE：只读比对两侧拷贝（漂移清单 + 锚点命中矩阵 + 结论）
# ---------------------------------------------------------------------------
if [ "$MODE" = "compare" ]; then
  say "===== usage-plugin.sh --compare：两侧拷贝只读比对 ====="
  say "source   = $USAGE_SRC_DIR"
  say "deployed = $USAGE_DEP_DIR"
  say ""
  python3 "$SCRIPT_DIR/usage-plugin-compare.py" \
    --source "$USAGE_SRC_DIR" --deployed "$USAGE_DEP_DIR" \
    --replacements "$SCRIPT_DIR/usage-plugin.replacements.txt" \
    --out "$WORK/reports/copy-drift.md" || exit 1
  exit 0
fi

# ---------------------------------------------------------------------------
# APPLY：备份 → 锚点预检 → 应用 → 校验（真实路径）
# ---------------------------------------------------------------------------
if [ "$TARGET" = "deployed" ]; then
  case "$PKG" in
    "$WORK"/*) ;; # 测试用覆盖路径留在工作区内，允许
    *) say "target=deployed → 将写入工作区外的路径：$PKG（需主 agent 带审批执行）" ;;
  esac
fi
say "目标（真实路径）：$PKG/lib/{db.js,client.js}"
say ""

if u_a1_applied "$DB" && u_a2_applied "$DB" && u_a0_applied "$CLIENT" && u_b2_applied "$CLIENT"; then
  skip "四个单元（A1/A2/A0/B2）均已应用，无操作"
  exit 0
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
B="$BACKUP_ROOT/backup-$STAMP"
mkdir -p "$B" || { fail "无法创建备份目录：$B"; exit 1; }
cp -p "$DB" "$B/db.js" && cp -p "$CLIENT" "$B/client.js" || { fail "备份失败"; exit 1; }
(cd "$B" && sha256sum db.js client.js > SHA256SUMS)
# ── 备份所有权元数据（--rollback 会强制校验；缺任一即拒绝回滚）──────────────
#   MANIFEST        : 单元/target/pkg/原文件 sha 前缀，用于确认「这备份是本单元的」
#   POST_SHA256SUMS : 应用后应有的内容 sha，用于确认「live 确实是本单元改过的」
# 设计要点（跨单元防误覆）：回滚前必须同时满足
#   (a) SHA256SUMS（pre-sha）与备份文件自洽   → 备份本身没被改
#   (b) live sha ∈ {pre-sha, post-sha}        → live 处于本单元的改前或改后状态
#   (c) live 至少一个文件 == post-sha         → 该 target 确实被本单元改过（防「未打过补丁」时误回滚）
#   任一不满足 → [FAIL] 拒绝回滚，绝不覆盖 live。
{
  printf 'unit=%s\n' "usage-plugin/A0+A1+A2+B2"
  printf 'target=%s\n' "$TARGET"
  printf 'pkg=%s\n' "$PKG"
  printf 'stamp=%s\n' "$STAMP"
  printf 'db_pre=%s\n' "$(sha256sum "$B/db.js" | cut -d" " -f1)"
  printf 'client_pre=%s\n' "$(sha256sum "$B/client.js" | cut -d" " -f1)"
} > "$B/MANIFEST"
B_PRE_DB="$(sha256sum "$B/db.js" | cut -d" " -f1)"
B_PRE_CLIENT="$(sha256sum "$B/client.js" | cut -d" " -f1)"
say "备份完成：$B"
say "  pre-sha  db.js=${B_PRE_DB:0:12} client.js=${B_PRE_CLIENT:0:12}"

precheck_anchors "$DB" "$CLIENT" || { fail "锚点预检未通过，未做任何修改（备份 $B 可留作基线）"; exit 1; }

apply_file "$DB" db-route 2>&1 | sed 's/^/  /'
apply_file "$DB" db-rebuild 2>&1 | sed 's/^/  /'
apply_file "$CLIENT" client-range 2>&1 | sed 's/^/  /'
apply_file "$CLIENT" client-poll 2>&1 | sed 's/^/  /'

say ""
say "──────── 应用后校验 ────────"
nodecheck "$DB" || exit 1
nodecheck "$CLIENT" || exit 1
u_a1_applied "$DB" && pass "A1 哨兵命中（queryHeatmap 走 usage_daily 闸门）" || fail "A1 哨兵缺失"
u_a2_applied "$DB" && pass "A2 哨兵命中（rebuildDailyForDays ts 范围）" || fail "A2 哨兵缺失"
u_a0_applied "$CLIENT" && pass "A0 哨兵命中（本地自然日对齐）" || fail "A0 哨兵缺失"
u_b2_applied "$CLIENT" && pass "B2 哨兵命中（可见性门控 + 60s 默认）" || fail "B2 哨兵缺失"
[ "$(grep -cF 'usage_daily' "$DB")" -ge 1 ] && pass "usage_daily 出现在 db.js" || fail "usage_daily 未出现在 db.js"
[ "$(grep -cF 'IntersectionObserver' "$CLIENT")" -ge 1 ] && pass "IntersectionObserver 出现在 client.js" || fail "IntersectionObserver 未出现在 client.js"
# 索引集合必须与备份（= 原件）完全相同：只比较 CREATE INDEX 语句里的列清单
idx_of() { grep -oE 'CREATE (UNIQUE )?INDEX[^(]*\(([^)]*)\)' "$1" 2>/dev/null | sed 's/.*(\(.*\))/\1/' | sort | tr '\n' ','; }
if [ -f "$B/db.js" ]; then
  [ "$(idx_of "$B/db.js")" = "$(idx_of "$DB")" ] \
    && pass "未新建/删除任何索引（CREATE INDEX 集合与备份一致：$(idx_of "$DB"))" \
    || fail "索引集合发生变化：$(idx_of "$B/db.js") -> $(idx_of "$DB")"
else
  warn "无备份可比对索引集合，跳过该项"
fi
[ "$(grep -cF 'usage_events' "$DB")" -ge 1 ] && pass "回落路径仍在（usage_events / sargable）" || fail "回落路径缺失"

# 把「应用后应有的内容」写入备份目录：--rollback 用它确认 live 确实被本单元改过
if [ "$FAILED" -eq 0 ]; then
  (cd "$PKG/lib" && sha256sum db.js client.js) > "$B/POST_SHA256SUMS"
  say "post-sha 已记录：$B/POST_SHA256SUMS"
fi

say ""
if [ "$FAILED" -eq 0 ]; then
  say "===== APPLY 全部 PASS ====="
  say "生效路径（两个半面机制不同，勿混为一谈）："
  say "  · lib/client.js —— **热面**：/plugins/<id>/client.js 每次 GET 从磁盘读 + no-cache，"
  say "    ?rev= 仅 sha1-12 缓存破坏串，dsh-client-hmr 每 500ms 轮询推 rebuilt → 保存后 ≤500ms"
  say "    生效，无需重启、无需手动刷新（浏览器原地热替换）。"
  say "  · lib/db.js     —— **宿主面**：web 层 HMR disabled、兜底 HMR root: []，运行中进程模块缓存"
  say "    不失效 → **必须重启宿主进程**才生效（由主 agent 执行，本脚本不重启宿主）。"
  say "备份根（本单元独占）：$BACKUP_ROOT"
  say "回滚：$0 --rollback --target $TARGET（回滚前会做备份所有权校验）"
else
  say "===== APPLY 存在 FAIL，请立即 $0 --rollback 并上报 ====="
fi
exit "$FAILED"
