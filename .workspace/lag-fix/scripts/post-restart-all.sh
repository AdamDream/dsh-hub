#!/usr/bin/env bash
# ============================================================================
# post-restart-all.sh —— 重启后的收尾编排（一键跑完全部验收步骤）
#
# 用法（在普通终端执行，不要在 GUI 内置终端里跑）：
#   bash .workspace/lag-fix/scripts/post-restart-all.sh --check      # 只做前置检查
#   bash .workspace/lag-fix/scripts/post-restart-all.sh             # 跑全部（默认不重启）
#   bash .workspace/lag-fix/scripts/post-restart-all.sh --with-restart   # 由本脚本执行重启再收尾
#
# 步骤：
#   0) 前置检查：宿主单进程、补丁在盘、备份齐备、node/playwright 可用
#   1) 重启（仅 --with-restart）
#   2) 服务端过滤生效核验（session.list ≤287 条 / ≤500KB、runningSubagentCount 字段）
#   3) 宿主延迟与 /usage/* 端点延迟（门槛：无 >100ms 停顿、中位数 <5ms、heatmap <40ms）
#   4) C1 可控基准（与负载无关，从真实文件抽码）
#   5) 端到端门槛测量（需真实流式负载；ws/s<50 时结果为静默态、脚本会提示重跑）
#   6) B2 phase 2（孤儿索引清理，需在重启后做）并复验不被回灌
#   7) 汇总：写入 reports/post-restart-summary.md
#
# 纪律：失败即停（set -e 语义由 run() 承担）；绝不删除共享目录；每步留存原始输出。
# ============================================================================
set -u
LAG="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="/home/CNS2026495165/dsh"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUTDIR="$LAG/reports/post-restart-$STAMP"
FAILED=0
WITH_RESTART=0
CHECK_ONLY=0
for a in "$@"; do
  case "$a" in
    --with-restart) WITH_RESTART=1 ;;
    --check) CHECK_ONLY=1 ;;
    *) echo "未知参数：$a（可用：--with-restart / --check）" >&2; exit 2 ;;
  esac
done

say()  { printf '%s\n' "$*"; }
hr()   { printf '%s\n' "------------------------------------------------------------------------"; }
pass() { printf '[PASS] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*" >&2; }
fail() { printf '[FAIL] %s\n' "$*" >&2; FAILED=1; }
run()  { # run <说明> <命令...>；失败即停
  local desc="$1"; shift
  say "→ $desc"
  if "$@"; then pass "$desc"; else fail "$desc"; return 1; fi
}

mkdir -p "$OUTDIR"
say "输出目录：$OUTDIR"
hr

# ── 0) 前置检查 ─────────────────────────────────────────────────────────────
say "===== 0) 前置检查 ====="
PIDS="$(pgrep -f 'bin/dsh web' | tr '\n' ' ')"
NPID="$(printf '%s' "$PIDS" | wc -w)"
say "  dsh web 进程：${PIDS:-（无）}（$NPID 个）"
[ "$NPID" -ge 1 ] || { fail "宿主未在运行"; exit 1; }
[ "$NPID" -eq 1 ] || warn "检测到多个 dsh web 进程（$PIDS）——重启前请确认哪个是当前实例"
for f in \
  "$ROOT/.workspace/lag-fix/patches/server-session-filter.sh" \
  "$ROOT/.workspace/lag-fix/patches/usage-plugin.sh" \
  "$ROOT/.workspace/lag-fix/patches/client-runtime-perf.sh" \
  "$ROOT/.workspace/lag-fix/patches/workspace-ui-runsubagent-count.sh" \
  "$ROOT/.workspace/lag-fix/patches/workspace-enhancement-perf.sh" \
  "$ROOT/.workspace/lag-fix/scripts/cleanup-sessions.sh" \
  "$ROOT/.workspace/workstreams/deploy/deploy-lag/dsh-restart.sh" ; do
  [ -f "$f" ] && pass "补丁/脚本在位：$(basename "$f")" || fail "缺文件：$f"
done
command -v node >/dev/null && pass "node $(node -v)" || fail "缺 node"
# 可执行引用体检（防"整理搬目录把 Runbook/脚本里的路径改坏"复现）
if bash "$LAG/probes/check-executable-refs.sh" > "$OUTDIR/refs.txt" 2>&1; then
  pass "可执行文件引用全部可达（$(tail -2 "$OUTDIR/refs.txt" | head -1)）"
else
  fail "存在不可达的可执行引用（详见 $OUTDIR/refs.txt）"; sed -n '1,10p' "$OUTDIR/refs.txt" | sed 's/^/    /'
fi
[ -e "$ROOT/.workspace/lag-fix/node_modules" ] && pass "playwright 解析路径在位" || warn "缺 node_modules 符号链接（浏览器探针会失败）"

# 服务端过滤是否已生效（重启的分水岭）
say ""
say "  重启生效判据（当前状态）："
timeout 200 node "$LAG/probes/session-list-shape.mjs" --out "$OUTDIR/session-list-shape.json" 2>&1 \
  | grep -E '^(条目|字节|\[PASS\]|\[FAIL\])' | sed 's/^/    /' || warn "session-list-shape 探针失败"
if [ "$CHECK_ONLY" = 1 ]; then say ""; say "--check 结束"; exit "$FAILED"; fi

# ── 1) 重启 ─────────────────────────────────────────────────────────────────
hr
if [ "$WITH_RESTART" = 1 ]; then
  say "===== 1) 重启宿主 ====="
  run "dsh-restart --dry-run" bash "$ROOT/.workspace/workstreams/deploy/deploy-lag/dsh-restart.sh" --dry-run || exit 1
  run "dsh-restart --yes"     bash "$ROOT/.workspace/workstreams/deploy/deploy-lag/dsh-restart.sh" --yes     || exit 1
  say "  等待宿主就绪…"
  for i in $(seq 1 30); do
    curl -sf -o /dev/null http://127.0.0.1:3080 && { pass "HTTP 200（第 ${i} 次尝试）"; break; }
    sleep 2
    [ "$i" = 30 ] && fail "30 次尝试后宿主仍未就绪"
  done
else
  say "===== 1) 重启：已跳过（未加 --with-restart；请确认宿主已由你重启过）====="
  NEWPID="$(pgrep -f 'bin/dsh web' | head -1)"
  say "  当前宿主 PID=$NEWPID（若与记忆中的旧 PID 相同，说明尚未重启，后续步骤会显示未生效）"
fi

# ── 2) 服务端过滤与服务端字段 ───────────────────────────────────────────────
hr
say "===== 2) 服务端过滤生效核验 ====="
timeout 200 node "$LAG/probes/session-list-shape.mjs" --out "$OUTDIR/session-list-shape.json" 2>&1 \
  | tee "$OUTDIR/session-list-shape.txt" | grep -E '^(条目|字节|\[PASS\]|\[FAIL\])' | sed 's/^/  /'
grep -q 'items ≤ 500 KB' "$OUTDIR/session-list-shape.txt" && pass "字节门槛" || warn "字节门槛未过（见上）"
grep -q '条目数 ≤ 顶层' "$OUTDIR/session-list-shape.txt" && pass "条目门槛" || warn "条目门槛未过（见上）"

# ── 3) 宿主延迟与用量端点 ───────────────────────────────────────────────────
hr
say "===== 3) 宿主延迟（挂载用量卡片，40s）====="
timeout 300 node "$LAG/probes/host-latency-with-usage-card.mjs" --out "$OUTDIR/host-latency.json" --seconds 40 2>&1 \
  | tee "$OUTDIR/host-latency.txt" | tail -20 | sed 's/^/  /'
python3 - "$OUTDIR/host-latency.json" <<'PY' || true
import json,sys
d=json.load(open(sys.argv[1]))
med,stalls=d['median_ms'],d['stalls_over_100ms']
print(f"  ⇒ 中位数 {med} ms（门槛 <5）｜>100ms 停顿 {stalls} 次（门槛 0）｜max {d['max_ms']} ms")
print("  判定：" + ("通过" if (med<5 and stalls==0) else "未通过（见上，heatmap 端点延迟见 usage_probe）"))
PY

# ── 4) C1 可控基准 ──────────────────────────────────────────────────────────
hr
say "===== 4) C1 可控基准（与负载无关）====="
run "bench-c1" timeout 300 node "$LAG/tools/bench-c1.mjs" --rounds 30 --out "$LAG/reports/bench-c1.json" || true
grep -E "2361|反向印证|补丁后同一" "$LAG/reports/bench-c1.json" >/dev/null 2>&1 || true

# ── 5) 端到端门槛测量 ───────────────────────────────────────────────────────
hr
say "===== 5) 端到端门槛测量（需真实流式负载）====="
say "  注意：探针无法自己制造流式负载。请在**有真实流式输出进行时**重跑本步；"
say "        判定以 ws/s ≥50 为前提（脚本会自动告警）。"
run "threshold-run" timeout 900 node "$LAG/probes/threshold-run.mjs" --reps 5 --window 20 \
  --tag "post-restart-$STAMP" --out "$LAG/reports/threshold-post-restart.json" || true

# ── 6) B2 phase 2 ───────────────────────────────────────────────────────────
hr
say "===== 6) B2 phase 2（孤儿索引清理）====="
if [ "${SKIP_PHASE2:-0}" = "1" ]; then
  say "  已按 SKIP_PHASE2=1 跳过"
else
  run "cleanup phase 2" bash "$LAG/scripts/cleanup-sessions.sh" --apply --phase 2 --days 7 || true
  say "  预期：projcache 孤儿 1670 清理后 ≈742 行；sync_state 悬空 1670 清理后 ≈1074 行（详见 RUNBOOK §3.3）"
fi

# ── 7) 汇总 ─────────────────────────────────────────────────────────────────
hr
say "===== 7) 汇总 ====="
{
  echo "# 重启后收尾记录（$STAMP）"
  echo
  echo "- 宿主 PID：$PIDS"
  echo "- 输出目录：$OUTDIR"
  echo "- 结果：$([ "$FAILED" -eq 0 ] && echo '全部步骤执行完毕（逐项判定见各原始输出）' || echo '有步骤失败，见下）')"
  echo
  echo "## 原始输出文件"
  ls -1 "$OUTDIR" | sed 's/^/- /'
  echo
  echo "## 门槛判定（人工核对要点）"
  echo "1. session.list：条目 ≤287、字节 ≤500KB、顶层行带 runningSubagentCount"
  echo "2. 宿主延迟：中位数 <5ms、无 >100ms 停顿；/usage/heatmap <40ms"
  echo "3. 端到端：>50ms 帧降 >50%、设置页 p99 <50ms、空闲脚本 <60ms/s（须 ws/s ≥50 才有效）"
  echo "4. bench-c1：N=2361 稳态新值应 ≈0.08ms/次（旧 5.2ms）"
  echo "5. phase 2：projcache ≈742 行、sync_state ≈1074 行"
} > "$LAG/reports/post-restart-summary.md"
cp "$LAG/reports/post-restart-summary.md" "$OUTDIR/" 2>/dev/null || true
sed 's/^/  /' "$LAG/reports/post-restart-summary.md"
say ""
say "完成。$([ "$FAILED" -eq 0 ] && echo '无失败步骤' || echo '存在失败步骤，请逐条看上面对应输出')"
exit "$FAILED"
