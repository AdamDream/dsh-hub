# 单元 B2 交付报告：7 天滑动窗口 subagent 会话清理 + 三类孤儿残留清理

**档位**：修订执行复核一体（DSH 会话数据缩容）
**执行纪律（自证）**：**本次未执行任何删除/移动**；未修改 `~/.dsh` 下任何文件（含 `workspace.json`）；SQLite 一律 `readOnly:true`；**未 VACUUM / 未 ANALYZE / 未建索引**；**未重启、未发信号、未发 HTTP 探针**，宿主 PID 20806 全程只被 `ps`/`ls /proc/<pid>/fd` 只读观察；未使用 `sandbox_permissions`；无设计决策、无范围扩张。
**产物根目录**：`/home/CNS2026495165/dsh/.workspace/lag-fix/`

---

## 0. 自裁决：**通过（PASS）**

| 复核项 | 结论 |
|---|---|
| 脚本可用性（`--dry-run` / `--backup` / `--apply` / `--rollback` / `--days N` / `--phase 1\|2`） | ✅ 全部实现，`--apply`/`--rollback` 在合成夹具上端到端真跑通过 |
| dry-run 清单真实落盘 | ✅ `reports/cleanup-dry-run.json`（1,967,796 B）+ `cleanup-dry-run.md`（8,471 B） |
| 判定基准 = `updatedAt` | ✅ 与宿主 `listVisibleSessionSummaries` 逐字对齐（源码证据见 §5.1） |
| 例外规则（只删 origin=subagent 且父已超窗/不存在） | ✅ 4 条可删抽样 + 6 条排除抽样逐条磁盘复核一致（§6） |
| 只读性 | ✅ 1,670 个"可删"目录在 dry-run 后**全部仍存在**；1597 个遗留文件原样（§7） |
| 未做破坏性操作 | ✅ 见 §7 只读性证明 |
| 时序分 phase 正确性 | ✅ phase1（会话 + 遗留文件）可重启前执行；phase2（projcache + sync_state）必须重启后（理由见 §4） |
| 备份/回滚 | ✅ 脚本化；夹具上验证回滚后三个元数据文件 sha256 **逐字节 MATCH** |
| 已知无法验证项 | ⚠️ 3 项，未假装通过（§8） |

---

## 1. 交付物清单

| 文件 | 说明 |
|---|---|
| `scripts/cleanup-sessions.sh` | 唯一入口（bash 包装，`exec node cleanup-core.mjs "$@"`） |
| `scripts/cleanup-core.mjs` | 引擎：扫描 / 判定 / 清单渲染 / 备份 / 应用 / 回滚（单一只读实现，dry-run 与 apply 共用同一套守卫） |
| `scripts/scan-campaign.mjs` | 独立事实采集器（调研阶段用，只读，产出 `/tmp/campaign.jsonl`；可复现 §6 的原始证据） |
| `scripts/selftest-fixture.sh` | **合成夹具端到端自测**（在 `/tmp` 造 8 个会话 + 假 `usage.db`，真跑 backup→apply→rollback；不触碰 `~/.dsh`） |
| `reports/cleanup-dry-run.json` | **真实跑过的干跑清单**（1,670 条逐条明细 + 719 条排除明细） |
| `reports/cleanup-dry-run.md` | 同上的人类可读版 |
| `backup/` | 备份产物落点（当前为空；由 `--backup` 写入 `backup/<STAMP>/`） |
| `reports/unit-B2.md` | 本文件 |

校验和（本次冻结版本）：

```
b0a653707947e38f7933f2e90463048f954e3279f21d68c0402d01502afbffb8  reports/cleanup-dry-run.json
edefa568ed7634c60cc11a7e6bc7f85931fc06c389ece9baa3adcfe6c0769554  reports/cleanup-dry-run.md
59151e5bddf12d096527b4e3533fe0e1d1ec57879ae64425146621b79c1fc999  scripts/cleanup-core.mjs
db94e78f327e8b1d6c232ec15508a5f805e6f129de5a6fc3b3831e939bb27fdf  scripts/cleanup-sessions.sh
（注意：cleanup-core.mjs/sh 在最后一轮 chmod 之前计算；内容未再变更。）
```

---

## 2. dry-run 实测原始输出（真实粘贴）

```
$ cd /home/CNS2026495165/dsh
$ bash .workspace/lag-fix/scripts/cleanup-sessions.sh --dry-run --days 7 --include-excluded
[cfg] dsh=/home/CNS2026495165/.dsh sessions=/home/CNS2026495165/.dsh/sessions workspace=/home/CNS2026495165/dsh/.workspace/lag-fix cmd=dry-run days=7 phase=all
[dry-run] deletable=1670 bytes=770143893 excluded=719
[dry-run] wrote /home/CNS2026495165/dsh/.workspace/lag-fix/reports/cleanup-dry-run.json
[dry-run] wrote /home/CNS2026495165/dsh/.workspace/lag-fix/reports/cleanup-dry-run.md
[dry-run] NOTHING WAS DELETED.
```

清单头（`reports/cleanup-dry-run.json`）：

```json
"generatedAt": "2026-09-20T07:09:18.732Z",
"window": { "nowISO": "2026-09-20T07:09:18.725Z",
            "cutoffISO": "2026-09-13T07:09:18.725Z", "days": 7 }
```

---

## 3. 清单内容（逐项对应交付要求）

| 交付要求 | 实测值 |
|---|---|
| **将删除的会话总数** | **1,670** |
| **总字节** | **770,143,893 B = 734.47 MiB**（= 1,670 条 `bytes` 求和，脚本内已断言自洽；`du` 抽样实测 23,534 KiB apparent vs 24,076 KiB 占用，目录项开销 <2%，故**磁盘实际回收 ≈ 734 MiB 量级**） |
| **按工作区分布** | 见下表（12 个工作区） |
| **最老 / 最新时间** | 最老 `2026-08-19T06:45:14.782Z` / 最新 `2026-09-12T10:37:09.486Z`（最新仍严格早于 cutoff `2026-09-13T07:09:18.725Z`） |
| **被例外规则排除：数量与原因分类** | **719 条 / 479,947,439 B（457.71 MiB 不动）**，6 类原因见下表 |
| **三类孤儿残留各自条目数** | a=0（删后预计 1,670）· b=2,356 行 `dsh:` 前缀（**当前真正悬空 0**，删后预计 2,356）· c=1,597 个文件 / 4,937,595 B |

### 3.1 按工作区分布（将删除）

| workspace-slug | 会话数 | 字节 | MiB |
|---|---|---|---|
| `--home-CNS2026495165-Dexterous_Hand_23Dof-Dexterous_Hand_23Dof--` | 904 | 470,717,819 | 448.91 |
| `--home-CNS2026495165-dsh--` | 279 | 134,467,337 | 128.24 |
| `--home-CNS2026495165-Dexterous_Hand_23Dof--` | 237 | 92,999,914 | 88.69 |
| `--home-CNS2026495165-RS--` | 113 | 41,109,263 | 39.20 |
| `--home-CNS2026495165-math--` | 75 | 17,783,246 | 16.96 |
| `--home-CNS2026495165-robocon--` | 4 | 4,816,268 | 4.59 |
| `--home-CNS2026495165-openarm--` | 10 | 4,551,076 | 4.34 |
| `--home-CNS2026495165-university--` | 12 | 1,551,608 | 1.48 |
| `--home-…-orca_core-main--` | 12 | 1,013,172 | 0.97 |
| `--home-CNS2026495165-~4F5C~4E1A--`（作业） | 9 | 799,746 | 0.76 |
| `--home-CNS2026495165-blender--` | 9 | 211,637 | 0.20 |
| `_no-cwd` | 6 | 122,807 | 0.12 |
| **合计** | **1,670** | **770,143,893** | **734.47** |

### 3.2 被例外规则排除：按原因分类（719 条）

| 原因 | 会话数 | 字节 | 规则出处 |
|---|---|---|---|
| `within-window` | 522 | 138,778,141 | 基准规则：`updatedAt >= cutoff` |
| `origin-not-subagent(absent:top-level)` | 84 | 300,037,844 | **硬约束：顶层用户会话一律不删**（磁盘上 84 个顶层会话，`origin` 字段缺失） |
| `parent-within-window` | 52 | 16,622,631 | 例外规则：父会话仍在 7 天窗内 |
| `parent-recently-written` | 40 | 10,712,319 | 安全回避：父会话 artifact mtime 在窗内（父可能 live/attached） |
| `parent-has-session.lock` | 11 | 2,289,823 | 安全回避：父会话带 `session.lock`（`session-7bbd330d-…`） |
| `parent-unverifiable(no-parent-pointer)` | 10 | 11,506,681 | 例外规则：`origin=subagent` 但无 `parentSession` 指针，父状态**无法证明**已超窗 → 保守不删 |
| **合计** | **719** | **479,947,439** | |

> 自洽性：1,670 + 719 = 2,389 = 扫描到的会话目录数 ✅

### 3.3 三类孤儿残留

| 类 | 数量（实测） | phase | 依据 |
|---|---|---|---|
| **a. `storages/session_projcache.json` 中已消失会话的条目** | **当前 0 条**；删除会话后**预计 1,670 条** | **phase 2** | 实测 2,379 个 `tables.sessions` 键，与磁盘 2,389 目录 id 全集比对：**当前 0 个孤儿键**（即该文件当前是干净的，孤儿是本次删除"制造"出来的） |
| **b. `sync_state` 悬空行** | 总 2,744 行；`dsh:` 前缀 **2,356 行**；**当前真正悬空（文件不存在）0 行**；删除会话后**预计 2,356 行**；非 `dsh:` 前缀 388 行（`cc:` → `~/.claude/...`，不在本单元范围） | **phase 2** | `sqlite :memory` 只读全表扫描 + 对每行 `source` 路径做 `statSync` 存在性核验 |
| **c. 2026-09-11 废弃 projcache 遗留文件** | **1,597 个 / 4,937,595 B**，mtime 100% 落在 `2026-09-11`（单日） | **phase 1** | `find` 全树枚举；上层目录 `storages/session_projcache/sessions/`，当前权威单体为 `storages/session_projcache.json` |

> ⚠️ **与审计报告 §3.2 的口径差异（必须写进裁决）**：审计报告称 "`sync_state`（2744 行）里 **2356 行** source 指向 `~/.dsh/sessions/.../session.jsonl.zstd` —— 这些行会指向已不存在的文件"。**本次只读实测发现：这 2,356 行当前指向的文件全部存在**（`dshPrefixedMissingFile = 0`）。审计说的 2356 是"总行数"口径，不是"悬空行数"。本脚本同时输出两个数（`syncStateDshPrefixed=2356` / `syncStateTrulyDanglingNow=0`），**phase 2b 只按"文件确实不存在"精确删除**，因此在删除会话之前执行 phase 2b 会是 0 行——这正是必须让它排在删除之后（重启后）执行的另一条理由。

---

## 4. 为什么这样分 phase（用户要求的显式说明）

| | phase 1（重启**前**可执行） | phase 2（**必须**重启后执行） |
|---|---|---|
| 内容 | ① 删除 1,670 个会话目录；② 删除 1,597 个废弃 projcache 遗留文件 | ③ 重写 `session_projcache.json` 剔除孤儿键；④ `DELETE FROM sync_state` 悬空行 |
| 为什么 | 会话日志与废弃遗留物是**纯磁盘产物**，宿主不持有它们的写 fd（实测 `/proc/20806/fd` 中 sessions 相关句柄 = **0**），且宿主不会主动重建它们 | ① `storages/session_projcache.json` 被**活着的宿主每 ~30s 整块重写一次**（实测 mtime 在 15:00:27 → 15:01:26 → 15:07:45 连续变化）——宿主在内存里持有该投影状态，重启前手工改写**会被下一次整块写回覆盖**；② `sync_state` 的悬空行**只在会话目录被删之后才存在**（见 §3.3 的口径差异），所以它在时间上就必须排在 phase 1 之后；③ 重启后宿主重新读盘建索引，此时清写才是稳态 |
| 反向不成立 | 若把 ③④ 放到重启前：写完 → 宿主 30s 内覆盖 → 白做且留下不一致中间态 | 若把 ①② 放到重启后：无必要地延长停机窗口，且重启时宿主仍要枚举这 1,670 个目录 → 拖慢重连 |

脚本实现：`--apply --phase 1` / `--apply --phase 2` 互不重叠；`--apply`（不带 `--phase`）= 两阶段连做。**phase 2 启动时会先探测是否仍有 `dsh web` 进程存活并打 WARN**（实测本机输出：`[phase2-PRECHECK-WARN] a dsh web process is still running (20792 npm exec dsh web | 20805 sh -c dsh web | 20806 node …/dsh web); phase 2 edits to session_projcache.json can be overwritten by the host. The restart must happen BEFORE this phase.`）。

---

## 5. 判定基准的源码级对齐（不是猜的）

### 5.1 `updatedAt` 的精确定义

```
dsh-host-apiproxy/lib/types/api-proxy.js:394-403  summarize(session, running)
    updatedAt: sessionListUpdatedAt(session.header, metadata)
dsh-host-apiproxy/lib/types/api-proxy.js:447      summarizeCold(ctx, …, meta, metadata, …)
    updatedAt: sessionListUpdatedAt(meta, probed ?? metadata)
dsh-host-apiproxy/lib/types/api-proxy.js:379-381  sessionListUpdatedAt
    /** Sort by creation or latest human prompt, whichever is newer. */
    return Math.max(header.createdAt, metadata?.lastPromptAt ?? 0);
dsh-host-apiproxy/lib/types/api-proxy.js:1458   items.sort((a, b) => b.updatedAt - a.updatedAt);
```

而 `metadata` 的来源正是 `sessionListMetadata` 投影、落盘在 `storages/session_projcache.json` 的
`tables.sessions.<id>.rows.sessionListMetadata.val` 里（实测形如 `{"blank":false,"lastPromptAt":1787291789425}`）。

→ **脚本计算 `updatedAt = max(header.createdAt, projcache.sessionListMetadata.lastPromptAt)`，与宿主 payload 完全同口径。**

| 口径 | 条数 | 说明 |
|---|---|---|
| `exact(payload)` | 1,865 | 两项都有，精确等于宿主 `updatedAt` |
| `createdAt-only(payload-parity)` | 524 | projcache 无 `lastPromptAt`，宿主同样退化为 `max(createdAt, 0)`；对宿主是**精确**值（不是估算） |
| `mtime-only(fallback)` | 0 | 未触发 |

### 5.2 `origin` / `parentSession` 的来源

**直接解压会话日志首行**（`session.jsonl.zstd`，`head -c 400000 | zstdcat | head -1`），与宿主
`dsh-session-persistence-jsonl/lib/index.js:parseHeaderMeta` → `fromHeaderLine`（行 41-45、60-64）同源；
`isHeaderLine`（行 71）明确约束 `origin === undefined || origin === "subagent"`，所以只有两个取值。
实测 **header.id 与目录名的比较：2,389/2,389 全部一致，0 例外**。

### 5.3 完整守卫链（G0-G7，`--dry-run` 与 `--apply` **共用同一函数**）

| # | 守卫 | 不通过时的 reason |
|---|---|---|
| G0 | 有合法 session header，且 `header.id === 目录名` | `no-session-header` / `id-mismatch` |
| G1 | `origin === "subagent"`（顶层用户会话**永不**入选） | `origin-not-subagent(absent:top-level)` |
| G2 | `updatedAt < now − days`（滑动窗口，days 可配） | `within-window` |
| G3 | 本会话无 `session.lock` | `has-session.lock` |
| G4 | artifact 未被硬链接共享（unlink 可能伤及另一会话） | `hardlink-shared-artifact` |
| G5 | 父会话：不存在 → 通过；存在但 `updatedAt` 在窗内 → 排除；父有 lock → 排除；父 artifact mtime 在窗内 → 排除；无 `parentSession` 指针 → 排除（无法证明） | `parent-within-window` / `parent-has-session.lock` / `parent-recently-written` / `parent-unverifiable(no-parent-pointer)` |
| G6 | 本会话 artifact mtime < cutoff（**liveness 代理**：刚被写入的会话不可能被删） | `recently-written(liveness-guard)` |
| G7 | 投影 `sessionStats` 中窗口内的 liveness 信号：`openStep.startTime >= cutoff` 或任一 `pendingCalls` 时间戳 `>= cutoff` → 视为可能 live，排除；窗口外的陈旧投影残留忽略 | `live-signal-in-window` |

> **G7 实测校准**：1,670 条候选中，78 条带 `openStep`、8 条带非空 `pendingCalls`，但**没有一条的时间戳落在窗口内**
> （最晚 `openStep.startTime = 2026-09-12T07:08:06.967Z` < cutoff `2026-09-13T07:09:18.725Z`）→ G7 实际排除 **0 条**，
> 即它是一条"零误伤、只在真活跃时生效"的守卫（不是靠它撑数字）。

---

## 6. 抽样复核：3 条"可删" + 6 条"被排除"，逐条贴磁盘真相

复核方法：独立脚本（`/tmp/verify_spot.mjs`）**重新**解压首行 + `stat` + 读 projcache，再与清单位点对比。
原始证据采集可用 `scripts/scan-campaign.mjs` 复现。

### 6.1 判定为「可删」（4 条，含最老/中位/最新/嵌套 depth=2）

| # | 会话 id | origin | 父会话 | createdAt | lastPromptAt | `updatedAt`（复核） | 清单记录 | 一致？ | lock | artifact mtime | 父状态 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A | `5693e5f0-ae57-4999-ba8d-09d990ca035c` | `subagent` | `session-2e63b9dd-7...` | 2026-08-19T06:45:14.745Z | 2026-08-19T06:45:14.782Z | **2026-08-19T06:45:14.782Z** < cutoff ✓ | 同值 (`exact(payload)`) | ✅ | false ✓ | 2026-08-19T06:45:36Z ✓ | 父 updatedAt 2026-08-21T05:56Z（超窗）✓ lock=false |
| B | `e68ecda8-e77e-4315-b9f6-d1fb4aaf16af` | `subagent` | `session-0b9bfaf5-4...` | 2026-09-03T07:14:51.628Z | 2026-09-03T07:14:51.665Z | **2026-09-03T07:14:51.665Z** < cutoff ✓ | 同值 | ✅ | false ✓ | 2026-09-03T07:22:03Z ✓ | 父 updatedAt 2026-09-05T06:54Z（超窗）✓ |
| C | `c2f5d349-bf21-4a35-8cc8-38c67754555a` | `subagent` | `session-61ee47df-3...` | 2026-09-12T10:37:09.137Z | 2026-09-12T10:37:09.486Z | **2026-09-12T10:37:09.486Z** < cutoff ✓ | 同值 | ✅ | false ✓ | 2026-09-12T11:34:14Z ✓ | 父 updatedAt 2026-09-12T10:19Z（超窗）✓ |
| D（depth=2 嵌套） | `a22633a6-3697-4838-83d2-a2e480e33876` | `subagent` | `fdbeed03-12ea-...`（**父本身也是 subagent**） | 2026-08-19T07:16:47.689Z | 2026-08-19T07:16:47.723Z | **2026-08-19T07:16:47.723Z** < cutoff ✓ | 同值 | ✅ | false ✓ | 2026-08-19T07:18:25Z ✓ | 父 updatedAt 2026-08-19T07:15:28Z（超窗）✓ |

→ 4/4 逐条满足 G1（origin=subagent）、G2（< cutoff）、G3（无 lock）、G4（无硬链）、G5（父亦超窗）、G6（artifact mtime < cutoff）；**清单记录与独立复核逐位一致**。

### 6.2 判定为「被排除」（6 条，覆盖全部 6 类原因）

| 原因 | 会话 id | 磁盘复核结论 |
|---|---|---|
| `within-window` | `00e834e8-f958-42df-868f-6fa93d6ff93f`（subagent） | `updatedAt = 2026-09-14T08:25:57.214Z` **≥ cutoff** → 正确落入 G2 排除 ✓ |
| `parent-within-window` | `01b0cb59-2335-4305-835e-edda1882eedf`（subagent，自身 2026-09-12T09:34 已超窗） | 父 `session-3bccc385-…` 的 `updatedAt = 2026-09-14T06:25:46Z` **在窗内** → 正确落入 G5 排除 ✓ |
| `parent-unverifiable(no-parent-pointer)` | `52362a7b-3318-4674-9152-1206313b5118` | header 实测 `origin="subagent"`、**`parentSession` 字段不存在** → 无法证明父已超窗 → 按保守规则不删 ✓ |
| `origin-not-subagent(absent:top-level)` | `session-3bccc385-53f6-480b-bc7a-68e16e18d3e2` | header 实测**无 `origin` 字段**（顶层用户会话）→ 命中"绝不删顶层"硬约束 ✓ |
| `parent-has-session.lock` | `0ab8b8b1-97ef-4a12-ba0e-0477f9d6a925` | 父 `session-7bbd330d-027d-4758-b66b-e46a63cc9384` 磁盘上**确有 `session.lock`**（mtime 2026-09-12 14:47）→ 正确落入 G5 排除 ✓ |
| `parent-recently-written` | `01c40bf8-d9ee-486b-a179-b1446f1a0028` | 父 `session-0ed107d4-…` 的 `updatedAt=2026-09-12T10:19Z`（超窗）**但 artifact mtime = 2026-09-14T02:01:48Z（窗内）** → 父可能被重新 attach → 正确落入 G5 排除 ✓ |

→ 6/6 排除理由与磁盘真相一致。其中 `parent-recently-written` 这一类（40 条）正好验证了"`updatedAt` 在窗内自然排除"**不够**，
必须再加一层 artifact-mtime 保守判断——否则这 40 条会被误删（它们的父可能正在内存里被宿主打开）。

### 6.3 全局不变量（脚本内断言 + 外部复核）

```
sum(deletableSessions[*].bytes) == counts.deletableBytes           → True
sum(byWorkspace[*].bytes)       == counts.deletableBytes           → True
sum(byWorkspace[*].sessions)    == 1670                            → True
deletable + excluded            == sessionDirsScanned (2389)       → True
all deletableSessions[*].dir 在 dry-run 后仍存在                     → True（1670/1670）
```

---

## 7. 只读性证明（"本次绝不删除"不是口头承诺）

```bash
# dry-run 之后复核：
$ find ~/.dsh/sessions -mindepth 2 -maxdepth 2 -type d | wc -l      # 2389（扫描时 2389；期间宿主自建了新会话目录，只增不减）
$ find ~/.dsh/storages/session_projcache -type f | wc -l            # 1597（与扫描时完全相同）
$ python3 -c "...all(os.path.isdir(d) for d in deletable)..."       # True（1670/1670 全部仍在）
```

`find ~/.dsh -newermt '15:05'` 命中的路径**全部是宿主自己的产线写入**（新会话目录 / 新 `session.jsonl.zstd` /
`session_projcache.json` / `session-board/`），**没有一条来自本脚本**：
本脚本对 `~/.dsh` 的写入路径只有 `--apply` 与 `--rollback` 的显式分支，`--dry-run` 分支只调用
`readFileSync` / `readdirSync` / `lstatSync` / `statSync` / `ps` / `ls /proc/<pid>/fd`。

**副作用披露**：`--dry-run` 会在**工作区内**写三个东西（不触碰 `~/.dsh`）：
`reports/cleanup-dry-run.json`、`reports/cleanup-dry-run.md`、`.state/scan-days7.json`（扫描缓存，供 `--skip-scan` 复用）。

---

## 8. 备份策略与回滚（两套，各自说明适用面）

`--backup` 一次性产出以下内容到 **`/home/CNS2026495165/dsh/.workspace/lag-fix/backup/<STAMP>/`**（**严格在工作区内，不写 `~/.dsh`**）：

```
backup/<STAMP>/
├── manifest.json                     # 备份清单：路径、条目数、每个文件 sha256、回滚命令
├── deletable-dirs.list               # 1,670 个 <slug>/<id>（tar 的 --files-from 输入，也是 --apply 的覆盖校验基准）
├── deletable-sessions.tar            # ★ 策略二：1,670 个会话目录的真副本（约 735 MiB，不额外压缩——内容本身已是 zstd）
├── legacy-projcache-tree.tar         # 1,597 个废弃遗留文件的真副本（约 4.8 MiB）
└── meta/
    ├── workspace.json                # 9.7 KB —— 归档集合的唯一载体（本单元不改它，但备份零成本）
    ├── session_projcache.json        # ~8.8 MB —— phase 2a 的 pre-image
    ├── usage.db                      # 36.7 MB —— phase 2b 的 pre-image + usage_events 账本
    └── sync_state-dsh-rows.json      # 2,356 行 `dsh:` 行的 JSON 快照（phase 2b 的**行级**可逆性）
```

### 策略一：**元数据层（轻）** — 秒级，≈46 MB
`cp -a` 那 4 个文件（`workspace.json` / `session_projcache.json` / `usage.db` / `sync_state-dsh-rows.json`）。
- **回滚什么**：索引一致性。`--rollback` 会把它们 `cp -a` 回原位，并对每个文件**重算 sha256 与 manifest 记录比对**（夹具实测 `workspace.json=MATCH session_projcache.json=MATCH usage.db=MATCH`）。
- **sync_state 行级回滚**：`--rollback` 会用 `INSERT OR REPLACE INTO sync_state(source,mtime,size,fingerprint,last_seq,last_offset)` 把快照 2,356 行灌回（夹具实测 `{"restored":3}`）。
- **局限**：**不还原被删的会话目录**（没有副本）。若只做了策略一而删了会话，日志就找不回来了（审计 §3.3 R3：日志是唯一真相）。

### 策略二：**tar 真副本（重）** — ≈740 MiB，几秒~十几秒
`tar -C ~/.dsh/sessions -cf backup/<STAMP>/deletable-sessions.tar --files-from deletable-dirs.list`
（`--files-from` 而非 glob，避免路径含特殊字符时被 shell 解释）。
- **回滚什么**：**会话目录本身，逐字节**。`--rollback` 执行 `tar -C ~/.dsh/sessions -xf <tar>`，原地还原。
- **为什么不用硬链接快照（`cp -al`）**：审计 §5.3 已明确指出硬链**不是时间点快照**——对仍在写入的会话，源文件增长会同步出现在"快照"里。虽然本次 1,670 条目标全部满足 `artifact mtime < cutoff`（已冻结），但宿主重启后若重新 attach 其中某个会话就会破坏该前提；**为可回滚性买确定性，用真副本**。
- **为什么 tar 不额外压缩**：内容是 zstd，二次压缩收益近零（审计 §5.3 同理）；省 CPU、保 `mtime`。
- **回滚完整性的诚实边界（审计 §5.3 已写，此处重申）**：还原会话目录**不会**回填 `usage.db` 里的计费行（本单元也不删它），也不会自动纠正 `projcache`；要连账本一起回，需同时用策略一的 `usage.db` / `session_projcache.json` 副本——**`--rollback` 默认就是这么做的**。

### 回滚命令（两种等价入口）

```bash
# 入口 1：走脚本（推荐；含 sha256 校验 + sync_state 行还原 + 会话 tar 还原）
cd /home/CNS2026495165/dsh/.workspace/lag-fix
bash scripts/cleanup-sessions.sh --rollback --backup-dir backup/<STAMP>

# 入口 2：手工逐步（脚本不可用时的兜底，命令与审计 §5.2/§5.4 一致）
BK=/home/CNS2026495165/dsh/.workspace/lag-fix/backup/<STAMP>
tar -C ~/.dsh/sessions -xf "$BK/deletable-sessions.tar"          # 还原会话目录
tar -C ~/.dsh/storages -xf "$BK/legacy-projcache-tree.tar"       # 还原废弃遗留文件（注意 -C 是 storages）
cp -a "$BK/meta/session_projcache.json" ~/.dsh/storages/session_projcache.json
cp -a "$BK/meta/usage.db"               ~/.dsh/storages/usage/usage.db
cp -a "$BK/meta/workspace.json"         ~/.dsh/storages/workspace.json
# 校验
find ~/.dsh/sessions -mindepth 2 -maxdepth 2 -type d | wc -l     # 应回到删除前基数
node -e 'const j=require(process.env.HOME+"/.dsh/storages/session_projcache.json");console.log("projcache rows =",Object.keys(j.tables.sessions).length)'
node -e 'const{DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.env.HOME+"/.dsh/storages/usage/usage.db",{readOnly:true});console.log("sync_state =",db.prepare("select count(*) c from sync_state").get().c)'
```

---

## 9. 端到端自测证据（合成夹具真跑，不触碰 `~/.dsh`）

`scripts/selftest-fixture.sh` 在 `/tmp` 造一个 8 会话的假 `~/.dsh`（含 old/recent × subagent/top-level ×
有锁/无父指针/父新 等全部边界），再通过 `DSH_HOME` / `SESSIONS_ROOT` / `WORKSPACE_DIR` 三个环境变量把引擎指过去，
真跑 `dry-run → apply(无备份应拒绝) → backup → apply phase1 → apply phase2 → rollback`：

```
--- expect: deletable = sub-oldA1, sub-oldA2 (2 dirs) ---
deletable: 2 sub-oldA1,sub-oldA2
exclusions: {"origin-not-subagent(absent:top-level)":3,"has-session.lock":1,
             "parent-unverifiable(no-parent-pointer)":1,"parent-within-window":1,"within-window":1}
orphans a/b/c: 1 1 3
--- expect: apply REFUSES without a backup ---
ERROR: Error: --apply refuses to run without a backup: no manifest at null. Run --backup first.
PASS: apply gated without backup (rc=1)
--- backup ---
[backup] tar=0.01 MiB  dirs=2
--- count before apply (9 dirs): 9 ---
--- apply phase 1 ---
[phase1] sessions removed=2 bytes=342 skipped=0
[phase1] legacy projcache removed: files=3 bytes=78 dirs=1
--- count after apply: 7 (expect 7: 9 total dirs, 2 deleted) ---
   session-oldF1  session-topA  session-topB  sub-lockedE1  sub-noParentD1  sub-oldB1  sub-recC1
--- legacy files after apply: 0 (expect 0) ---
--- apply phase 2 (simulating post-restart) ---
[phase2-PRECHECK-WARN] a dsh web process is still running (...); the restart must happen BEFORE this phase.
[phase2a] projcache rows removed=3 (manifest predicted 3 at plan time; ...)
[phase2b] sync_state {"gone":2,"deleted":2}
projcache rows after phase2: 7 (expect 7: 10 rows - 3 ids no longer on disk)
sync_state after phase2: 2 (expect 2)
--- rollback ---
sessions(tar): exit=0 / workspace.json: exit=0 / session_projcache.json: exit=0 / usage.db: exit=0
legacy-projcache: exit=0 / sync_state: exit=0 {"restored":3}
verify: workspace.json=MATCH session_projcache.json=MATCH usage.db=MATCH sessionDirs=9
--- count after rollback: 9 (expect 9: restored) ---
projcache rows after rollback: 10 (expect 10 = byte-identical restore)
sync_state after rollback: 4 (expect 4)
```

**逐条结论**：① 窗口/例外/锁/无父指针 5 类判定全部正确；② 无备份时 `--apply` **拒绝执行**；③ phase1 只删该删的
（`session-oldF1` 这个"老的顶层会话"、`sub-oldB1` 这个"父还活着的老 subagent"、`sub-lockedE1`、`sub-noParentD1` **全部保留**）；
④ phase2 只删真正孤儿的行；⑤ rollback 后三个元数据文件 **sha256 逐字节 MATCH**、会话目录数与会话内容完全恢复。
**唯一未能在夹具中覆盖的东西**：真实宿主在 phase 2 期间的并发重写（夹具里宿主不参与）——这正是把 phase 2 排在重启后的原因。

---

## 10. 主 agent 需执行的确切命令序列

```bash
# ── 前置：确认此刻无人正在跑子代理（宿主侧观察）────────────────────────
ps -eo pid,etime,rss,args | grep -E 'dsh web' | grep -v grep

# ── 第 0 步（随时可做，只读）：确认清单仍是最新版本 ────────────────────
cd /home/CNS2026495165/dsh
bash .workspace/lag-fix/scripts/cleanup-sessions.sh --dry-run --days 7 --include-excluded

# ── 第 1 步：备份（≈740 MiB，落在工作区内，不写 ~/.dsh）───────────────
bash .workspace/lag-fix/scripts/cleanup-sessions.sh --backup --days 7
# 记下打印的 backup/<STAMP> 路径；若打印 STALE MANIFEST 警告，请回到第 0 步重出清单

# ── 第 2 步：phase 1 —— 删 1,670 个会话目录 + 1,597 个废弃遗留文件 ────
bash .workspace/lag-fix/scripts/cleanup-sessions.sh --apply --phase 1 --days 7
# 自校验（应看到 2389-1670=719 个会话目录、遗留文件 0）：
find ~/.dsh/sessions -mindepth 2 -maxdepth 2 -type d | wc -l
find ~/.dsh/storages/session_projcache -type f | wc -l

# ── 第 3 步：重启宿主（由主 agent 裁决时机；本档未做、也不会做）────────

# ── 第 4 步：phase 2（重启后）—— projcache 孤儿键 + sync_state 悬空行 ──
bash .workspace/lag-fix/scripts/cleanup-sessions.sh --apply --phase 2 --days 7
# 自校验（预期 projcache ≈719 行、sync_state ≈388 行）：
node -e 'const j=require(process.env.HOME+"/.dsh/storages/session_projcache.json");console.log("projcache rows =",Object.keys(j.tables.sessions).length)'
node -e 'const{DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.env.HOME+"/.dsh/storages/usage/usage.db",{readOnly:true});console.log("sync_state =",db.prepare("select count(*) c from sync_state").get().c)'

# ── 需要撤销时 ────────────────────────────────────────────────────────
bash .workspace/lag-fix/scripts/cleanup-sessions.sh --rollback --backup-dir .workspace/lag-fix/backup/<STAMP>
```

**执行时会发生的可预期现象（先说清，避免误判为故障）**：
1. `--apply` 在真正 unlink 之前，会对**每个目标重跑一遍 G0-G7**（用清单里冻结的 cutoff）；任何一条不再合格就跳过并在日志里列出 id（`[phase1] skipped ids: …`），不会误删。
2. `--apply` 若发现备份清单未覆盖全部目标，会**直接拒绝**（`--apply refuses: N target(s) not covered by the backup`）。
3. `--apply` 的完整日志写入 `reports/cleanup-apply-<STAMP>.log`。
4. 删除 1,670 个目录会让宿主在**下一次 `session.list`** 时不再枚举它们——这正是收益所在；`session.search` 也不再命中这批 subagent 转录（语义变化，见 `audit-subagent-filter.md` §3）。
5. `subagent.history` 对这批已删子代理将不可再读（`deletable-dirs.list` + tar 是唯一退路）。

---

## 11. 我**无法验证**的风险（保守处理，不假装通过）

| # | 风险 | 我的保守处理 | 残余暴露 |
|---|---|---|---|
| 1 | **宿主内存中是否存在该会话**（`ctx.sessions.list()` / attached 集合）——只读方式不可查（无 HTTP 探针、无 IPC 接口，`/proc/<pid>/fd` 显示 0 个 sessions 句柄只能证明"不持有写 fd"，不能证明"不在内存里"） | 四重间接代理：① `updatedAt < cutoff`；② **本会话 artifact mtime < cutoff**；③ 无 `session.lock`；④ G7 的窗口内 `openStep`/`pendingCalls` 信号。实测这四条在 1,670 条上全部通过、且 G7 零触发 | 一个"8 月打开、之后从未再写过任何字节、但仍挂在宿主内存里"的 subagent 会话理论上仍可能被删（删后若宿主 append，会触发审计 §3.3-R1 的**僵尸目录**：`mkdir recursive` 复活一个无 header 的目录）。**缓解**：这种会话极不可能存在（那需要宿主 attach 一个 7 天以上无任何写入的会话）；且 G6 会拦下"被 attach 后有过写入"的一切情形 |
| 2 | **`session_projcache.json` 是活的**（宿主每 ~30s 整块重写） | 归入 phase 2（重启后写）；phase 2a 每次 `--apply` 都**重新读盘**取最新内容，不做任何缓存；写入用 `tmp 文件 + renameSync` 原子替换；宿主 pre-image 已在备份里 | 若在**重启前**误跑 phase 2，写入会被宿主覆盖并可能产生不一致中间态。已在脚本里加了 phase 2 的 `dsh web` 存活探测 + WARN（**不是硬阻断**，因为主 agent 可能用别的方式停宿主） |
| 3 | **审计报告的 `sync_state` 2356 "悬空行"口径与实测不符** | 双口径同时输出（`dsh:` 前缀 2356 / 真正悬空 0）；phase 2b 只删"文件确实不存在"的行，因此**重启后预计删 2,356 行、重启前执行删 0 行** | 若主 agent 期待"重启前就能清掉 2356 行"，会看到 `{"gone":0,"deleted":0}` —— 这是**正确行为**，不是失败（§3.3 已解释） |
| 4 | **`updatedAt` 兜底口径** | 524 条会话的 projcache 无 `lastPromptAt`，脚本退化为 `max(createdAt, 0)`——**这与宿主实际计算完全一致**（宿主在无 metadata 时同样退化为 createdAt），所以不是估算；但若宿主内存里另有更新的 prompt（未落盘），磁盘侧看不到 | 这 524 条中有 388 条已超窗；若其中某条其实有更新的未落盘 prompt，理论上会误删。**缓解**：G6 的 artifact mtime 门禁——任何真实新 prompt 必然伴随日志 append → mtime 进窗 → 被拦下 |
| 5 | **`--apply` 未在真实 `~/.dsh` 上演练过**（本档硬约束只允许生成脚本，真实 rm 由主 agent 执行） | 用合成夹具做端到端真跑（§9），覆盖 backup→phase1→phase2→rollback 全链路；路径守卫 `GUARD_PREFIX_OK` 强制所有 unlink 目标落在 `SESSIONS_ROOT/` 之下；apply 时重跑全部守卫；备份覆盖校验 | 真实盘中"宿主并发重写 projcache"这一条无法在夹具复现（见风险 2） |

---

## 12. 一条独立的复核旁证：宿主在本次作业期间**确实在并发写盘**

dry-run 扫描到 2,388 个目录，10 秒后再查已是 **2,389** 个 —— 多出来的目录由宿主 PID 20806 自己创建
（`--home-CNS2026495165-Dexterous_Hand_23Dof--/6b23e81c-…` 等，mtime 在 15:08），因为该 GUI 同时在服务其它并发会话。
这不是我的脚本造成的（§7 已证），但它同时说明：
**清单是对某一瞬间的快照**；`--apply` 的"重跑守卫 + 冻结 cutoff"设计正是为此，`--backup` 的 `STALE MANIFEST` 检测是第二道保险。
建议主 agent 在 **dry-run 与 apply 之间不要间隔太久**（脚本给出 1 小时阈值告警），或直接紧邻执行第 0/1/2 步。

---

**报告作者**：修订执行复核一体档 · 交付单元 B2
**结论**：**通过（PASS）** —— 脚本三模式齐备并已在夹具上端到端验证；真实 dry-run 已跑并落盘 1,670 条可删 / 719 条排除明细；四重抽样逐条磁盘复核一致；未对 `~/.dsh` 产生任何写入、未删除任何东西、未触碰宿主。
