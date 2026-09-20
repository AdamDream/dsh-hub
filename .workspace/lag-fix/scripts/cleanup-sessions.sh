#!/usr/bin/env bash
# cleanup-sessions.sh — B2 单元操作入口（7 天滑动窗口 subagent 会话清理 + 三类孤儿残留清理）
#
# 用法:
#   bash scripts/cleanup-sessions.sh --dry-run  [--days 7]                  # 只读：生成清单，绝不删除
#   bash scripts/cleanup-sessions.sh --backup   [--days 7]                  # 生成回滚产物到 backup/B2/<STAMP>/
#   bash scripts/cleanup-sessions.sh --apply --phase 1 [--days 7]           # 真删：会话目录 + 废弃 projcache 遗留文件
#   bash scripts/cleanup-sessions.sh --apply --phase 2 [--days 7]           # 真删：projcache 陈旧条目 + sync_state 悬空行（须在重启后）
#   bash scripts/cleanup-sessions.sh --rollback --backup-dir backup/<STAMP> # 从备份恢复
#
# 其他开关:
#   --include-excluded   在 JSON 清单里包含全部被排除会话的逐条明细
#   --skip-scan          复用 .state/ 里上次扫描结果（只改报告时用）
#   --out-json PATH / --out-md PATH
#   --backup-dir PATH    apply / rollback 指定备份目录（apply 缺省取最新一个）
#
# 纪律:
#   * --dry-run / --backup 不删任何东西；
#   * SQLite 一律 readOnly 打开，不 VACUUM / 不 ANALYZE / 不建索引；
#   * --apply 拒绝在没有备份清单、或备份未覆盖全部目标时执行；
#   * --apply 在真正 unlink 前对每个目标重新跑一遍全部守卫（窗口 / origin / lock / 父会话 / mtime）。
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$HERE/cleanup-core.mjs" "$@"
