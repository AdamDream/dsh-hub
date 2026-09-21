#!/usr/bin/env bash
# acquire-probe-lock.sh — 跨线浏览器探针独占锁（原子 mkdir，fail-closed）
#
# 纪律：
#   - mkdir 是原子的，成功即持锁；
#   - 已存在则每 20–40s 重试，最长等 30 分钟（1800s）；
#   - **只有**「owner 开始时间 > 25 分钟 且 其 PID 已不存在」才允许抢占，且抢占必须记账；
#   - 锁目录内写 owner.txt（agent 名 / PID / 开始时间 / 主机名）。
# 用法：acquire-probe-lock.sh <agent-name>
set -u
LOCK="/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock"
AGENT="${1:-unknown-agent}"
MAX_WAIT=1800
STALE_SECS=1500          # 25 分钟
attempt=0
waited=0
preempted=""

while true; do
  attempt=$((attempt+1))
  if mkdir "$LOCK" 2>/dev/null; then
    printf 'agent=%s\npid=%s\nstarted_at=%s\nhost=%s\nattempts=%s\npreempted=%s\n' \
      "$AGENT" "$$" "$(date '+%F %T %Z')" "$(hostname)" "$attempt" "${preempted:-none}" > "$LOCK/owner.txt"
    echo "ACQUIRED lock on attempt $attempt after ${waited}s wait"
    echo "--- owner.txt ---"; cat "$LOCK/owner.txt"
    exit 0
  fi

  # 锁被占用：读 owner，判断是否满足抢占条件
  owner_pid=""; owner_start=""
  if [ -f "$LOCK/owner.txt" ]; then
    owner_pid=$(sed -n 's/^pid=//p' "$LOCK/owner.txt" | head -1)
    owner_start=$(sed -n 's/^started_at=//p' "$LOCK/owner.txt" | head -1)
  fi
  age="?"
  if [ -n "$owner_start" ]; then
    s=$(date -d "$owner_start" +%s 2>/dev/null || echo "")
    [ -n "$s" ] && age=$(( $(date +%s) - s ))
  fi
  alive="no"
  if [ -n "$owner_pid" ] && kill -0 "$owner_pid" 2>/dev/null; then alive="yes"; fi

  echo "[wait $waited s] lock held: pid=${owner_pid:-?} start=${owner_start:-?} age=${age}s process_alive=$alive"

  # 抢占闸门：必须同时满足 年龄>25min 且 进程已不存在
  if [ "$age" != "?" ] && [ "$age" -gt "$STALE_SECS" ] && [ "$alive" = "no" ]; then
    echo "PREEMPT: owner age ${age}s > ${STALE_SECS}s AND pid ${owner_pid} is gone -> stealing lock"
    preempted="yes(from pid=${owner_pid} age=${age}s start=${owner_start})"
    rm -rf "$LOCK"
    continue
  fi

  if [ "$waited" -ge "$MAX_WAIT" ]; then
    echo "TIMEOUT: waited ${waited}s (max ${MAX_WAIT}s) without acquiring; NOT taking the lock"
    exit 2
  fi
  sleep $(( 20 + RANDOM % 21 ))   # 20–40s 随机退避
  waited=$((waited+30))
done
