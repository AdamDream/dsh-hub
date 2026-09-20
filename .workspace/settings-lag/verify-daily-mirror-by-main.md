# 主 agent 独立交叉验证：usage_daily 镜像前提（只读）

**时间**：2026-09-20 15:0x · **方法**：`sqlite3` 以 `file:...?mode=ro` 只读打开 `~/.dsh/storages/usage/usage.db`，零写入
**目的**：独立复核单元 A 的关键前提（"日粒度查询改走 `usage_daily` 输出逐行一致"），不依赖子代理结论

## 1. 表与索引现状

| 对象 | 内容 |
|---|---|
| `usage_events` | 104,907 行；列含 `ts, model, provider, project, is_subagent, input_tokens, output_tokens, cache_read/write_tokens`；`UNIQUE(data_source, session_id, dedup_key)` |
| `usage_daily` | 296 行；`PRIMARY KEY(day, data_source, model, project)`，含 `requests, input/output/cache_read/cache_write_tokens` |
| `sync_state` | 2,744 行 |
| 索引 | `idx_events_ts ON usage_events(ts)` ✅ 存在、`idx_events_model`、`idx_events_project` |

→ sargable 回退路径（`ts BETWEEN ? AND ?`）可用，**无需建索引**。

## 2. 镜像一致性（近 8 天窗口，逐值对照）

逐日总量 `usage_events` vs `usage_daily`：

| day | events (requests, tokens) | daily (requests, tokens) | 一致 |
|---|---|---|---|
| 2026-09-14 | 6,679 / 35,209,501 | 6,679 / 35,209,501 | ✓ |
| 2026-09-15 | 5,587 / 37,268,123 | 5,587 / 37,268,123 | ✓ |
| 2026-09-16 | 3,826 / 25,344,493 | 3,826 / 25,344,493 | ✓ |
| 2026-09-17 | 3,454 / 15,190,436 | 3,454 / 15,190,436 | ✓ |
| 2026-09-18 | 5,385 / 23,136,694 | 5,385 / 23,136,694 | ✓ |

按维度分组对照：

| 维度 | events 行数 | daily 行数 | events−daily | daily−events |
|---|---|---|---|---|
| `(day, model)` | 12 | 12 | **0** | **0** |
| `(day, project)` | 14 | 14 | **0** | **0** |

**结论：镜像前提成立**（不是抽样，是全窗口逐值）。

## 3. 维度缺口（潜在风险，已写入交付要求）

`usage_daily` 无 `is_subagent`、无 `provider` 列。实测窗口内：

- `is_subagent`：全部 24,931 行均为 `0`；
- `provider`：恒为 `adam`（单一 provider）。

并且 grep 全插件（`lib/db.js` 等）所有 `SELECT`：**没有任何查询按 `is_subagent` 或 `provider` 过滤**（这两列只出现在建表 / INSERT / 迁移路径）。

→ 当前改走 daily **安全**；但**潜在缺口**：若未来新增按 `is_subagent` 过滤的查询，daily 不可直接代用。宿主侧闸门须保留回退到 sargable 的路径。

## 4. 附带发现：ingest 已停摆

```
MAX(ts)              = 2026-09-18 17:42:02
sync_state 最新 mtime = 2026-09-18 17:42:02
（当前时间 2026-09-20 15:0x）
```

近两天**没有任何用量写入**。这解释了主 agent 在 150s 观测窗内（`measure9.json`）为何复现不出审计所称的"45s 同步 ingest 阻塞 924ms"——**该 ingest 当前根本没在运行**。因此：

1. 审计的 924ms 数字**不构成现网成因**（与 `DIAGNOSIS.md` §5 的裁定一致）；
2. 但一旦 ingest 恢复（例如重启后），单周期 578ms 的阻塞会回来 → 单元 A 的"改走 daily + 新鲜度护栏"仍是必需的；
3. **ingest 停摆本身是独立的功能缺陷**（卡片显示的是两天前的数据），超出本次三线范围，已记录待用户裁决，不自行扩范围修复。

## 5. 复现命令

```bash
python3 - <<'PY'
import sqlite3, os
p = os.path.expanduser("~/.dsh/storages/usage/usage.db")
c = sqlite3.connect(f"file:{p}?mode=ro", uri=True)   # 只读
DAY = "strftime('%Y-%m-%d', ts/1000,'unixepoch','localtime')"
W = "ts >= strftime('%s','now','localtime','start of day','-7 days')*1000"
print(c.execute(f"SELECT {DAY} d, COUNT(*), SUM(input_tokens+output_tokens) FROM usage_events WHERE {W} GROUP BY d").fetchall())
print(c.execute("SELECT day, SUM(requests), SUM(input_tokens+output_tokens) FROM usage_daily WHERE day >= strftime('%Y-%m-%d','now','localtime','start of day','-7 days') GROUP BY day").fetchall())
print(c.execute("SELECT datetime(MAX(ts)/1000,'unixepoch','localtime') FROM usage_events").fetchone())
PY
```
