#!/usr/bin/env bash
# release-probe-lock.sh — 释放独占锁。
#
# 坑（实测踩到）：本纪律要求锁目录内写 owner.txt，所以纯 `rmdir` 会因「目录非空」失败
# （第一次释放即踩到）。必须先删 owner.txt 再 rmdir。
#
# 安全性：只删自己写的那一个文件；若目录里出现**别人**的文件（说明有 line 把锁目录当队列用），
# 则拒绝自动清理并列出来，交人工判断——避免误删他线的记账。
set -u
LOCK="/home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock"
AGENT="${1:-}"
if [ ! -d "$LOCK" ]; then echo "no lock to release"; exit 0; fi

owner_agent=$(sed -n 's/^agent=//p' "$LOCK/owner.txt" 2>/dev/null | head -1)
if [ -n "$AGENT" ] && [ "$owner_agent" != "$AGENT" ]; then
  echo "REFUSE: lock owner is '${owner_agent}', not '${AGENT}' — 不是我的锁，不释放"
  exit 3
fi

extra=$(find "$LOCK" -mindepth 1 -maxdepth 1 ! -name owner.txt)
if [ -n "$extra" ]; then
  echo "REFUSE: lock dir contains files that are not mine — 交人工判断，不自动清理："
  echo "$extra"
  exit 4
fi

rm -f "$LOCK/owner.txt"
rmdir "$LOCK" && echo "RELEASED lock (owner was '${owner_agent}')" || { echo "rmdir still failed"; exit 5; }
