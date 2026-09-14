#!/usr/bin/env bash
# ============================================================================
# replay-lag-fix.sh — subagent 多开卡顿修复 重放脚本（U-1..U-8 全量固化 + P0 btw 子代理打开修复）
# ============================================================================
# 规格：lag-fix-audit.md §4（交付单元 U-9）；btw-open-p0-diagnosis.md ④（路线 a，P0 单元）
# 目标：live 全局树 4 包（dsh-agent-loop / dsh-client-ui-subagent /
#       dsh-web-search-deepseek / dsh-host-apiproxy）+ 官方 dsh-subagent（P0 materialize 补丁）
#       + ~/.dsh/settings.yaml
# 覆盖：U-1..U-3 恢复 3 个丢失补丁（tgz 解包 cp + sha256 校验）
#       U-4/U-5/U-5b 加固 apiproxy（patch 应用，dry-run 预检；U-5b=应答帧永不丢弃守卫）
#       P0 dsh-subagent materializeContinuableChild 公开方法（patch 应用，dry-run 预检；备份/回滚覆盖）
#       U-6..U-8 settings 改写（python3 pyyaml 结构化改写 + 解析断言）
# 模式：
#   ./replay-lag-fix.sh            默认执行（备份 -> 应用 -> 校验）
#   ./replay-lag-fix.sh --dry-run  只打印将执行的步骤 + 全部前置校验，不写任何文件
#   ./replay-lag-fix.sh --rollback 用最新备份还原（还原后需重启 DSH）
# 幂等：每单元已应用（锚点命中/字节全等/值正确）则跳过并提示 SKIP
# 环境变量覆盖：
#   DSH_ROOT        全局树 @deepseek-ai 目录（默认 $HOME/.npm-global/...）
#   PATCH_TGZ       补丁 tgz（默认 $HOME/dsh-upgrade-backup/patched-official-files.tgz）
#   SETTINGS_FILE   settings.yaml 路径（默认 $HOME/.dsh/settings.yaml）
#   LAG_BACKUP_DIR  备份根目录（默认本脚本所在目录）
# 依赖：bash / tar / sha256sum / cmp / grep / cp / mv / patch / diff /
#       node（--check）/ python3 + pyyaml。本环境 pnpm 不可用，勿依赖。
# ============================================================================
set -u

MODE="${1:-run}"
case "$MODE" in
  --help|-h)
    sed -n '2,28p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    echo
    echo "Runbook（应用后）：重启 DSH（npx @deepseek-ai/dsh web），派一个 subagent 调研，"
    echo "期望：子代理会话 0 条 assistant/chunk、1 条 assistant/message；主会话打字机照常"
    echo "（复用 execution-2b.md L33-44 模板）。重装全局树后重跑本脚本即可恢复全部补丁。"
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
TGZ="${PATCH_TGZ:-$HOME/dsh-upgrade-backup/patched-official-files.tgz}"
SETTINGS="${SETTINGS_FILE:-$HOME/.dsh/settings.yaml}"
BACKUP_ROOT="${LAG_BACKUP_DIR:-$SCRIPT_DIR}"
KNOWN="$SCRIPT_DIR/known-sha256.txt"
PATCHES="$SCRIPT_DIR/patches"

AGENT_LOOP="$ROOT/dsh-agent-loop/lib/index.js"
UI_CLIENT="$ROOT/dsh-client-ui-subagent/lib/client.js"
WEB_SEARCH="$ROOT/dsh-web-search-deepseek/lib/index.js"
APIPROXY="$ROOT/dsh-host-apiproxy/lib/index.js"
SUBAGENT_JS="$ROOT/dsh-subagent/lib/index.js"
SUBAGENT_TYPES="$ROOT/dsh-subagent/lib/types/index.d.ts"
# P0 官方补丁（btw 子代理打开修复，路线 a）存放于 deploy-p0；可用 P0_PATCH 覆盖
P0_PATCH="${P0_PATCH:-$SCRIPT_DIR/../deploy-p0/dsh-subagent.materialize.patch}"

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
  local tool missing=0
  for tool in tar sha256sum cmp grep cp mv patch diff node python3; do
    command -v "$tool" >/dev/null 2>&1 || { warn "缺少工具：$tool"; missing=1; }
  done
  [ -f "$TGZ" ] || { warn "补丁 tgz 不存在：$TGZ（可用 PATCH_TGZ 覆盖）"; missing=1; }
  [ -f "$KNOWN" ] || { warn "known-sha256.txt 不存在：$KNOWN"; missing=1; }
  [ -d "$ROOT/dsh-agent-loop/lib" ] || { warn "全局树不存在：$ROOT（可用 DSH_ROOT 覆盖）"; missing=1; }
  [ -f "$P0_PATCH" ] || { warn "P0 补丁不存在：$P0_PATCH（可用 P0_PATCH 覆盖）"; missing=1; }
  [ -f "$SETTINGS" ] || { warn "settings.yaml 不存在：$SETTINGS（可用 SETTINGS_FILE 覆盖）"; missing=1; }
  if ! python3 -c 'import yaml' 2>/dev/null; then
    warn "python3 缺少 pyyaml（settings 改写需要）"; missing=1
  fi
  [ "$missing" -eq 0 ] || return 1
  # tgz 内 3 个补丁 sha256 预检（防 tgz 损坏/被换）
  local tmp
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/lagfix-pre.XXXXXX")"
  if tar -xzf "$TGZ" -C "$tmp" 2>/dev/null; then
    local entry got want
    for entry in dsh-agent-loop/lib/index.js dsh-client-ui-subagent/lib/client.js dsh-web-search-deepseek/lib/index.js; do
      got="$(sha256sum "$tmp/$entry" | awk '{print $1}')"
      want="$(awk -v e="$entry" '$2==e{print $1}' "$KNOWN")"
      if [ -z "$want" ]; then
        warn "known-sha256.txt 缺条目：$entry"; missing=1
      elif [ "$got" != "$want" ]; then
        warn "tgz 内 $entry sha256 与 known 不符（tgz 可能损坏或被换）"; missing=1
      fi
    done
  else
    warn "tgz 解包失败：$TGZ"; missing=1
  fi
  rm -rf "$tmp"
  [ "$missing" -eq 0 ] || return 1
  return 0
}

# ---------------------------------------------------------------------------
# 单元状态判断（幂等锚点，只读）
# ---------------------------------------------------------------------------
u1_applied() { grep -q "isSubagent" "$AGENT_LOOP" 2>/dev/null; }
u2_applied() { grep -q "formatTokensPerSecond\|decodeTokensPerSecond" "$UI_CLIENT" 2>/dev/null; }
u3_applied() { grep -q "x-opencode-session" "$WEB_SEARCH" 2>/dev/null; }
u4_applied() { grep -q "if (!subscribed.has(session.id)) return;" "$APIPROXY" 2>/dev/null; }
u5_applied() { grep -q "MAX_QUEUED_FRAMES" "$APIPROXY" 2>/dev/null; }
u5b_applied() { grep -q "isAnswerableFrame" "$APIPROXY" 2>/dev/null; }
p0_applied() {
  grep -q "materializeContinuableChild" "$SUBAGENT_JS" 2>/dev/null \
    && grep -q "materializeContinuableChild" "$SUBAGENT_TYPES" 2>/dev/null
}

settings_check() {
  # 两条全部满足返回 0；否则返回 1
  python3 - "$SETTINGS" <<'PYEOF' 2>/dev/null
import sys, yaml
d = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
a = {m["id"]: m for m in d["llm-pi-ai"]["providers"]["adam"]["models"]}
ok = (
    a.get("deepseek-v4-flash", {}).get("maxTokens") == 990000
    and a.get("deepseek-v4-flash", {}).get("contextWindow") == 1000000
    and d["vision-adam"] == {"model": "deepseek-v4.1-flash",
                             "baseURL": "https://opencode.ai/zen/go/v1",
                             "apiKeyEnv": "OPENCODE_GO_API_KEY",
                             "maxTokens": 393216}
)
sys.exit(0 if ok else 1)
PYEOF
}

# ---------------------------------------------------------------------------
# 备份（真实执行时：任一单元需要应用即先全量快照 4 包 + settings）
# ---------------------------------------------------------------------------
backup_all() {
  local stamp
  stamp="$(date +%Y%m%d-%H%M%S)"
  BACKUP_DIR="$BACKUP_ROOT/backup-$stamp"
  mkdir -p "$BACKUP_DIR"
  for pkg in dsh-agent-loop dsh-client-ui-subagent dsh-web-search-deepseek dsh-host-apiproxy dsh-subagent; do
    if [ -d "$ROOT/$pkg" ]; then
      cp -r "$ROOT/$pkg" "$BACKUP_DIR/$pkg"
    else
      warn "备份跳过缺失包：$pkg"
    fi
  done
  cp "$SETTINGS" "$BACKUP_DIR/settings.yaml"
  say "备份完成：$BACKUP_DIR"
}

# ---------------------------------------------------------------------------
# U-1..U-3：tgz 解包 + sha256 校验 + cp 覆盖
# ---------------------------------------------------------------------------
restore_unit() {
  local name="$1" tgz_path="$2" live="$3" known_sha="$4" anchor_hint="$5"
  if [ "$name" = "dsh-agent-loop" ] && u1_applied; then skip "U-1 $name 已应用（isSubagent 命中）"; return 0; fi
  if [ "$name" = "dsh-client-ui-subagent" ] && u2_applied; then skip "U-2 $name 已应用（formatTokensPerSecond 命中）"; return 0; fi
  if [ "$name" = "dsh-web-search-deepseek" ] && u3_applied; then skip "U-3 $name 已应用（x-opencode-session 命中）"; return 0; fi
  if [ "$DRY" -eq 1 ]; then
    dry "U-1/2/3 将解包 $tgz_path 校验 sha256 后 cp 覆盖 $live"
    return 0
  fi
  local tmp
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/lagfix.XXXXXX")"
  tar -xzf "$TGZ" -C "$tmp" || { fail "U-$anchor_hint $name tgz 解包失败"; rm -rf "$tmp"; return 1; }
  local got
  got="$(sha256sum "$tmp/$tgz_path" | awk '{print $1}')"
  if [ "$got" != "$known_sha" ]; then
    fail "U-$anchor_hint $name sha256 不符（期望 $known_sha 实得 $got），中止"
    rm -rf "$tmp"; return 1
  fi
  cp -f "$tmp/$tgz_path" "$live" || { fail "U-$anchor_hint $name cp 覆盖失败"; rm -rf "$tmp"; return 1; }
  rm -rf "$tmp"
  return 0
}

# ---------------------------------------------------------------------------
# U-4/U-5：apiproxy 加固 patch（dry-run 预检 -> 应用 -> 锚点校验）
# ---------------------------------------------------------------------------
patch_unit() {
  local unit="$1" patch_file="$2" anchor_grep="$3"
  if grep -q "$anchor_grep" "$APIPROXY" 2>/dev/null; then
    skip "$unit 已应用（$anchor_grep 命中）"
    return 0
  fi
  if [ "$DRY" -eq 1 ]; then
    dry "$unit 将 patch -p0 应用 $patch_file（先 dry-run 预检）"
    return 0
  fi
  if ! (cd "$ROOT" && patch --batch -p0 --dry-run < "$PATCHES/$patch_file" >/dev/null 2>&1); then
    fail "$unit patch dry-run 未命中（live 文件可能已漂移，需重新锚定），中止"
    return 1
  fi
  if ! (cd "$ROOT" && patch --batch -p0 < "$PATCHES/$patch_file" >/dev/null 2>&1); then
    fail "$unit patch 应用失败"
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# P0：dsh-subagent materializeContinuableChild 公开方法（patch 应用，dry-run 预检）
# ---------------------------------------------------------------------------
patch_subagent() {
  if p0_applied; then
    skip "P0 dsh-subagent 已应用（materializeContinuableChild 双文件锚点命中）"
    return 0
  fi
  if [ "$DRY" -eq 1 ]; then
    dry "P0 将 patch -p0 应用 $P0_PATCH（先 dry-run 预检）"
    return 0
  fi
  if ! (cd "$ROOT" && patch --batch -p0 --dry-run < "$P0_PATCH" >/dev/null 2>&1); then
    fail "P0 patch dry-run 未命中（live dsh-subagent 可能已漂移，需重新锚定 deploy-p0），中止"
    return 1
  fi
  if ! (cd "$ROOT" && patch --batch -p0 < "$P0_PATCH" >/dev/null 2>&1); then
    fail "P0 patch 应用失败"
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# U-6..U-8：settings 结构化改写（python3 pyyaml）+ 写回后解析断言
# ---------------------------------------------------------------------------
apply_settings() {
  if settings_check; then
    skip "U-6/7/8 settings 已应用（三条断言全部满足）"
    return 0
  fi
  if [ "$DRY" -eq 1 ]; then
    dry "U-6/7/8 将 python3 pyyaml 结构化改写 $SETTINGS 并断言"
    return 0
  fi
  python3 - "$SETTINGS" <<'PYEOF' || { fail "U-6/7/8 settings 改写失败（已中止，未写回）"; return 1; }
import sys, yaml
p = sys.argv[1]
try:
    data = yaml.safe_load(open(p, encoding="utf-8"))
except Exception as e:
    print(f"settings.yaml 解析失败：{e}", file=sys.stderr)
    sys.exit(1)
providers = data["llm-pi-ai"]["providers"]
for m in providers["adam"]["models"]:
    if m.get("id") == "deepseek-v4-flash":
        m["contextWindow"] = 1000000
        m["maxTokens"] = 990000
# 注意（2026-09-12 事故教训，勿回退）：绝不向 llm-pi-ai 的 opencode-go 路由添加 catalog 未描述的
# 模型条目（如 deepseek-v4.1-flash）。该路由的 catalog 模型 api 不一致 → sharedCatalogApi() 无解 →
# 新条目解析不出 api/baseUrl → resolveRouteModels 抛 invalid() → 整段 llm-pi-ai 不可服务 →
# adam 与 opencode 模型全部从 web 模型选择器消失（实测事故）。故此处只改 adam 与 vision-adam 段。
# opencode deepseek-v4.1-flash（识图模型）的 maxTokens 取网关实测硬上限 393216（2026-09-12 实测：
# opencode 网关对 max_tokens 的有效范围 [1, 393216]，990000 会被拒绝；adam 网关实测接受 990000）。
data["vision-adam"] = {"model": "deepseek-v4.1-flash",
                       "baseURL": "https://opencode.ai/zen/go/v1",
                       "apiKeyEnv": "OPENCODE_GO_API_KEY",
                       "maxTokens": 393216}
with open(p, "w", encoding="utf-8") as f:
    yaml.safe_dump(data, f, default_flow_style=False, sort_keys=False, allow_unicode=True)
PYEOF
  if ! settings_check; then
    fail "U-6/7/8 settings 写回后解析断言失败"
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# 校验（每单元，任一失败 -> FAIL + 退出非零，不回滚）
# ---------------------------------------------------------------------------
verify_u1() {
  node --check "$AGENT_LOOP" >/dev/null 2>&1 || { fail "U-1 agent-loop node --check 失败"; return 1; }
  [ "$(grep -c isSubagent "$AGENT_LOOP")" -ge 2 ] || { fail "U-1 锚点 isSubagent <2"; return 1; }
  pass "U-1 agent-loop 恢复（node --check + isSubagent×2）"
}
verify_u2() {
  node --check "$UI_CLIENT" >/dev/null 2>&1 || { fail "U-2 ui-subagent node --check 失败"; return 1; }
  [ "$(grep -cE 'formatTokensPerSecond|decodeTokensPerSecond' "$UI_CLIENT")" -ge 2 ] || { fail "U-2 锚点 tok/s <2"; return 1; }
  pass "U-2 ui-subagent 恢复（node --check + tok/s 锚点）"
}
verify_u3() {
  node --check "$WEB_SEARCH" >/dev/null 2>&1 || { fail "U-3 web-search node --check 失败"; return 1; }
  grep -q "x-opencode-session" "$WEB_SEARCH" || { fail "U-3 锚点 x-opencode-session 缺失"; return 1; }
  pass "U-3 web-search 恢复（node --check + x-opencode-session）"
}
verify_u45() {
  node --check "$APIPROXY" >/dev/null 2>&1 || { fail "U-4/5 apiproxy node --check 失败"; return 1; }
  grep -q "if (!subscribed.has(session.id)) return;" "$APIPROXY" || { fail "U-4 锚点订阅过滤缺失"; return 1; }
  [ "$(grep -c MAX_QUEUED_FRAMES "$APIPROXY")" -ge 2 ] || { fail "U-5 锚点 MAX_QUEUED_FRAMES <2"; return 1; }
  grep -q "isAnswerableFrame" "$APIPROXY" || { fail "U-5b 锚点应答帧守卫缺失"; return 1; }
  pass "U-4/U-5/U-5b apiproxy 加固（node --check + 订阅过滤 + MAX_QUEUED_FRAMES×2 + 应答帧守卫）"
}
verify_p0() {
  node --check "$SUBAGENT_JS" >/dev/null 2>&1 || { fail "P0 dsh-subagent node --check 失败"; return 1; }
  [ "$(grep -c materializeContinuableChild "$SUBAGENT_JS")" -eq 3 ] || { fail "P0 锚点 materializeContinuableChild（lib/index.js）≠3"; return 1; }
  [ "$(grep -c materializeContinuableChild "$SUBAGENT_TYPES")" -eq 1 ] || { fail "P0 锚点 materializeContinuableChild（lib/types/index.d.ts）≠1"; return 1; }
  pass "P0 dsh-subagent materializeContinuableChild（node --check + 双文件锚点 3/1）"
}
verify_settings() {
  settings_check && pass "U-6/7/8 settings 三条断言全部满足" || { fail "U-6/7/8 settings 断言失败"; return 1; }
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
  for pkg in dsh-agent-loop dsh-client-ui-subagent dsh-web-search-deepseek dsh-host-apiproxy dsh-subagent; do
    if [ -d "$latest/$pkg" ]; then
      rm -rf "$ROOT/$pkg"
      mv "$latest/$pkg" "$ROOT/$pkg"
      say "已还原 $pkg"
    fi
  done
  if [ -f "$latest/settings.yaml" ]; then
    cp "$latest/settings.yaml" "$SETTINGS"
    say "已还原 settings.yaml"
  fi
  say "回滚完成。请重启 DSH（npx @deepseek-ai/dsh web）使宿主侧改动生效。"
  exit 0
fi

say "===== replay-lag-fix：$( [ "$DRY" -eq 1 ] && echo 'DRY-RUN（不写任何文件）' || echo '执行' ) ====="
say "ROOT=$ROOT"
say "TGZ=$TGZ"
say "SETTINGS=$SETTINGS"

precheck || { fail "前置校验未通过"; exit 1; }
say "前置校验通过"

# 需要应用任何单元？决定是否备份
needs_apply=0
u1_applied || needs_apply=1
u2_applied || needs_apply=1
u3_applied || needs_apply=1
u4_applied || needs_apply=1
u5_applied || needs_apply=1
u5b_applied || needs_apply=1
p0_applied || needs_apply=1
settings_check || needs_apply=1

if [ "$needs_apply" -eq 0 ]; then
  say "全部单元均已应用，无操作。"
  exit 0
fi
if [ "$DRY" -eq 1 ]; then
  dry "将先全量备份 5 包（4 包 + dsh-subagent）+ settings.yaml 到 $BACKUP_ROOT/backup-<时间戳>/"
else
  backup_all
fi

# --- U-1 .. U-3 ---
restore_unit dsh-agent-loop dsh-agent-loop/lib/index.js "$AGENT_LOOP" \
  "$(awk '$2=="dsh-agent-loop/lib/index.js"{print $1}' "$KNOWN")" 1 || exit 1
restore_unit dsh-client-ui-subagent dsh-client-ui-subagent/lib/client.js "$UI_CLIENT" \
  "$(awk '$2=="dsh-client-ui-subagent/lib/client.js"{print $1}' "$KNOWN")" 2 || exit 1
restore_unit dsh-web-search-deepseek dsh-web-search-deepseek/lib/index.js "$WEB_SEARCH" \
  "$(awk '$2=="dsh-web-search-deepseek/lib/index.js"{print $1}' "$KNOWN")" 3 || exit 1
if [ "$DRY" -eq 0 ]; then
  verify_u1 || exit 1
  verify_u2 || exit 1
  verify_u3 || exit 1
fi

# --- U-4 / U-5 / U-5b ---
patch_unit "U-4" "dsh-host-apiproxy.u4.patch" "if (!subscribed.has(session.id)) return;" || exit 1
patch_unit "U-5" "dsh-host-apiproxy.u5.patch" "MAX_QUEUED_FRAMES" || exit 1
patch_unit "U-5b" "dsh-host-apiproxy.u5b.patch" "isAnswerableFrame" || exit 1
if [ "$DRY" -eq 0 ]; then
  verify_u45 || exit 1
fi

# --- P0：dsh-subagent materializeContinuableChild（btw 子代理打开修复）---
patch_subagent || exit 1
if [ "$DRY" -eq 0 ]; then
  verify_p0 || exit 1
fi

# --- U-6..U-8 ---
apply_settings || exit 1
if [ "$DRY" -eq 0 ]; then
  verify_settings || exit 1
fi

if [ "$DRY" -eq 1 ]; then
  say "===== DRY-RUN 完成（未写任何文件）====="
  exit 0
fi

if [ "$FAILED" -eq 0 ]; then
  say "===== 全部单元 PASS ====="
  say "提示：宿主侧改动（agent-loop / host-apiproxy / dsh-subagent / settings）需重启 DSH 生效；"
  say "      ui-subagent（客户端补丁按请求读盘）刷新浏览器即生效。"
  say "      Runbook：npx @deepseek-ai/dsh web 后派一个 subagent 调研，"
  say "      期望子代理会话 0 条 assistant/chunk、1 条 assistant/message；主会话打字机照常；"
  say "      btw 侧：跳转列表/侧聊打开冷子代理不再报 parent-not-found（P0 修复，见 deploy-p0/APPLY-P0.md）。"
else
  say "===== 存在 FAIL 单元（已回滚 = 无，需人工介入或 --rollback）====="
fi
exit "$FAILED"
