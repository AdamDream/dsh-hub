#!/usr/bin/env bash
# 重启后一键复测：按验收门槛逐项判定
# 用法: bash .workspace/lag-fix/probes/verify-post-restart.sh
set -u
cd "$(dirname "$0")/.."    # -> .workspace/lag-fix
LAGFIX="$(pwd)"
pass=0; fail=0
line() { printf '%-58s %s\n' "$1" "$2"; }
ok()   { pass=$((pass+1)); line "$1" "✅ PASS"; }
no()   { fail=$((fail+1)); line "$1" "❌ FAIL  $2"; }

echo "===== 0) 前置：宿主健康 ====="
code="$(curl -s -o /dev/null -w '%{http_code}' -m 10 http://127.0.0.1:3080/ || echo 000)"
[ "$code" = "200" ] && ok "服务 / -> 200" || no "服务 / -> $code" "GUI 未就绪"
echo "  宿主 PID: $(pgrep -f 'bin/dsh.* web' | tr '\n' ' ')"

echo
echo "===== 1) 服务端过滤（B1）====="
if timeout 300 node probes/session-list-shape.mjs --out reports/probe-post-restart.json > /tmp/vp-b1.log 2>&1; then
  ok "session-list-shape 全项 PASS"
else
  no "session-list-shape 有 FAIL" "$(grep -cE '^\[FAIL\]' /tmp/vp-b1.log) 项"
fi
grep -E '^(条目|字节|\[|顶层 runningSubagentCount|基线)' /tmp/vp-b1.log | head -12 | sed 's/^/    /'

echo
echo "===== 2) 用量插件宿主侧（A）====="
if timeout 300 node probes/usage-host-latency.mjs --pairs > /tmp/vp-a.log 2>&1; then
  ok "usage-host-latency 运行完成"
  grep -iE 'heatmap|冻结|事件循环|周期|stall' /tmp/vp-a.log | head -12 | sed 's/^/    /'
else
  no "usage-host-latency 失败/超时" "见 /tmp/vp-a.log"
fi

echo
echo "===== 3) 客户端负载（C1，20s×3 窗口）====="
if timeout 400 node probes/measure-after-C1.mjs --window 20 --out reports/measure-after-restart.json > /tmp/vp-c1.log 2>&1; then
  ok "measure-after-C1 运行完成"
  python3 - <<'PY' 2>/dev/null || true
import json
d=json.load(open('reports/measure-after-restart.json'))
print(f"    {'phase':22s} {'script/s':>9s} {'p99':>7s} {'>50ms':>6s} {'ws/s':>6s} {'nodes':>6s}")
for w in d['windows']:
    print(f"    {w['phase']:22s} {w.get('script_ms_per_s',0):9.1f} {str(w.get('frame_p99_ms')):>7} "
          f"{str(w.get('frames_over_50ms')):>6} {str(w.get('ws_rate_per_s')):>6} {str(w.get('dom_nodes_total')):>6}")
PY
else
  no "measure-after-C1 失败/超时" "见 /tmp/vp-c1.log"
fi

echo
echo "===== 4) 用量卡片端点（宿主侧真实耗时）====="
RID=$(python3 -c "import uuid;print(uuid.uuid4())")
for ep in heatmap byDay byModel byProject summary; do
  t=$(curl -s -o /dev/null -w '%{time_total}' -m 30 -X POST "http://127.0.0.1:3080/usage/$ep" \
      -H 'content-type: application/json' -H 'origin: http://127.0.0.1:3080' \
      -d "{\"type\":\"client-request\",\"rpcId\":\"$RID\",\"method\":\"$ep\",\"payload\":{\"year\":2026,\"dataSources\":\"all\"}}" 2>/dev/null || echo 9)
  printf '    /usage/%-10s %ss\n' "$ep" "$t"
done

echo
echo "===== 5) B2 phase 2（孤儿索引清理）====="
echo "  按需执行： bash .workspace/lag-fix/scripts/cleanup-sessions.sh --apply --phase 2 --days 7"
echo
echo "============================================================"
echo "结果：PASS=$pass  FAIL=$fail"
[ "$fail" -eq 0 ] && echo "→ 全部通过" || echo "→ 有未达标项，逐条看上面输出与 reports/ 下证据"
