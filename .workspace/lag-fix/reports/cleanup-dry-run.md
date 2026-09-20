# B2 干跑清单（7 天滑动窗口 · subagent 会话 + 三类孤儿残留）

- 生成时间：**2026-09-20T07:44:54.022Z**  ·  命令：`bash scripts/cleanup-sessions.sh --dry-run --days 7`
- 窗口：now = 2026-09-20T07:44:54.016Z  ·  cutoff = **2026-09-13T07:44:54.016Z**（7 天）
- 判定规则：`delete iff origin==="subagent" AND max(header.createdAt, sessionListMetadata.lastPromptAt) < now - days`
- 例外规则：parent session must itself be out of the window (parent-within-window => excluded); no parent pointer => excluded (unverifiable)
- 纪律：**本次未删除/未移动任何文件**；SQLite 全部 `readOnly:true`；宿主未触碰（无信号/无重启/无 HTTP 探测）。

## 1. 汇总

| 指标 | 值 |
|---|---|
| 扫描到的会话目录 | 2,402 |
| **将删除的会话数** | **1,670** |
| **将回收字节** | **770,143,893 B = 734.47 MiB** |
| 被例外规则排除的会话数 | 732（465.05 MiB 不动） |
| 扫描到的 origin 分布 | `subagent`=2315 · `<absent:top-level>`=87 |
| 孤儿 a：projcache 中已消失会话条目 | 0（删除会话后预计 1,670） |
| 孤儿 b：sync_state 行 | 总数 2,744（`dsh:` 前缀 2,356，**当前真正悬空 0**，删除会话后预计 2,356） |
| 孤儿 c：废弃 projcache 遗留文件 | 1,597 个 / 4,937,595 B |

- 最老候选 updatedAt：**2026-08-19T06:45:14.782Z**
- 最新候选 updatedAt：**2026-09-12T10:37:09.486Z**（仍严格早于 cutoff 2026-09-13T07:44:54.016Z）

## 2. 按工作区分布（将删除）

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
| `--home-CNS2026495165-Dexterous_Hand_23Dof-Dexterous_Hand_23Dof-orca_core-main--` | 12 | 1,013,172 | 0.97 |
| `--home-CNS2026495165-~4F5C~4E1A--` | 9 | 799,746 | 0.76 |
| `--home-CNS2026495165-blender--` | 9 | 211,637 | 0.20 |
| `_no-cwd` | 6 | 122,807 | 0.12 |

## 3. 被例外规则排除：按原因分类

| 原因 | 会话数 | 字节 | 样例（id / updatedAt / detail） |
|---|---|---|---|
| `within-window` | 532 | 144,395,554 | `00e834e8-f95…` 2026-09-14T08:25 updatedAt=2026-09-14T08:25:57.214Z >= cutoff=2026-09-13T07:44:54.016Z<br>`011075f2-802…` 2026-09-15T05:59 updatedAt=2026-09-15T05:59:43.265Z >= cutoff=2026-09-13T07:44:54.016Z<br>`024f0959-807…` 2026-09-14T03:19 updatedAt=2026-09-14T03:19:31.145Z >= cutoff=2026-09-13T07:44:54.016Z<br>`027ac39b-e49…` 2026-09-18T02:54 updatedAt=2026-09-18T02:54:03.091Z >= cutoff=2026-09-13T07:44:54.016Z<br>`02a540a1-295…` 2026-09-14T08:31 updatedAt=2026-09-14T08:31:06.245Z >= cutoff=2026-09-13T07:44:54.016Z |
| `origin-not-subagent(absent:top-level)` | 87 | 302,108,266 | `session-3bcc…` 2026-09-14T06:25<br>`session-4422…` 2026-09-14T03:11<br>`session-4ca4…` 2026-09-20T07:12<br>`session-60ce…` 2026-09-11T07:30<br>`session-6b9b…` 2026-09-17T10:07 |
| `parent-within-window` | 52 | 16,622,631 | `01b0cb59-233…` 2026-09-12T09:34 parent=session-3bccc385-53f6-480b-bc7a-68e16e18d3e2 parentUpdatedAt=2026-09-14T06:25:46.055Z<br>`060704dd-79f…` 2026-09-12T08:23 parent=session-3bccc385-53f6-480b-bc7a-68e16e18d3e2 parentUpdatedAt=2026-09-14T06:25:46.055Z<br>`0d96bf09-ecb…` 2026-09-12T05:40 parent=session-3bccc385-53f6-480b-bc7a-68e16e18d3e2 parentUpdatedAt=2026-09-14T06:25:46.055Z<br>`376377f4-e6b…` 2026-09-12T10:17 parent=session-3bccc385-53f6-480b-bc7a-68e16e18d3e2 parentUpdatedAt=2026-09-14T06:25:46.055Z<br>`3fd666c6-e78…` 2026-09-12T08:31 parent=session-3bccc385-53f6-480b-bc7a-68e16e18d3e2 parentUpdatedAt=2026-09-14T06:25:46.055Z |
| `parent-recently-written` | 40 | 10,712,319 | `01c40bf8-d9e…` 2026-09-12T09:57 parent=session-0ed107d4-779a-4f58-a92a-de9474416f7c parentArtifactMtime=2026-09-14T02:01:48.734Z<br>`01f1e375-222…` 2026-09-12T09:50 parent=session-0ed107d4-779a-4f58-a92a-de9474416f7c parentArtifactMtime=2026-09-14T02:01:48.734Z<br>`09c52fcb-d1c…` 2026-09-12T05:36 parent=session-0ed107d4-779a-4f58-a92a-de9474416f7c parentArtifactMtime=2026-09-14T02:01:48.734Z<br>`1219cd0d-e64…` 2026-09-12T09:30 parent=session-0ed107d4-779a-4f58-a92a-de9474416f7c parentArtifactMtime=2026-09-14T02:01:48.734Z<br>`1e2253a0-78d…` 2026-09-12T09:52 parent=session-0ed107d4-779a-4f58-a92a-de9474416f7c parentArtifactMtime=2026-09-14T02:01:48.734Z |
| `parent-has-session.lock` | 11 | 2,289,823 | `0ab8b8b1-97e…` 2026-09-12T03:52 parent=session-7bbd330d-027d-4758-b66b-e46a63cc9384<br>`241b8422-598…` 2026-09-12T04:51 parent=session-7bbd330d-027d-4758-b66b-e46a63cc9384<br>`2e2bc951-39f…` 2026-09-12T02:34 parent=session-7bbd330d-027d-4758-b66b-e46a63cc9384<br>`7687aa8d-fa1…` 2026-09-12T03:11 parent=session-7bbd330d-027d-4758-b66b-e46a63cc9384<br>`a56be102-521…` 2026-09-12T02:34 parent=session-7bbd330d-027d-4758-b66b-e46a63cc9384 |
| `parent-unverifiable(no-parent-pointer)` | 10 | 11,506,681 | `52362a7b-331…` 2026-09-11T03:26 origin=subagent but no parentSession field; cannot prove the parent is stale<br>`a0ffe75f-ab1…` 2026-09-08T08:50 origin=subagent but no parentSession field; cannot prove the parent is stale<br>`bbd049cd-770…` 2026-09-08T06:29 origin=subagent but no parentSession field; cannot prove the parent is stale<br>`f875084a-b70…` 2026-09-11T10:24 origin=subagent but no parentSession field; cannot prove the parent is stale<br>`83d9e651-445…` 2026-09-08T09:55 origin=subagent but no parentSession field; cannot prove the parent is stale |

## 4. 三类孤儿残留

### 4a. projcache 中已消失会话的条目（phase 2）

- 当前条目数：**0**
- 删除会话后预计：**1670**
- 处置：重启后重写 `tables.sessions`，剔除磁盘上已不存在 id 的条目。

### 4b. sync_state 悬空行（phase 2）

- 总行数：2,744；`dsh:` 前缀行：2,356
- **当前真正悬空（文件已不存在）：0**
- 删除会话后预计悬空：**2356**（= 被删会话对应的 `dsh:` 行）
- 非 `dsh:` 前缀行（不清理）：388
- ⚠️ 与审计报告口径差异见 §6。

### 4c. 废弃 projcache 遗留文件（phase 1）

- 根目录：`/home/CNS2026495165/.dsh/storages/session_projcache`
- 文件数 **1,597** / 字节 4,937,595
- mtime 分布：`2026-09-11`=1597
- 子目录：`/home/CNS2026495165/.dsh/storages/session_projcache/sessions`

## 5. 宿主事实（只读采集）

```
20792 日 9月 20 11:47:23 2026   03:57:30 79620 npm exec dsh web
  20805 日 9月 20 11:47:23 2026   03:57:30  1476 sh -c dsh web
  20806 日 9月 20 11:47:23 2026   03:57:30 1123872 node /home/CNS2026495165/.npm-global/bin/dsh web
```
- `/proc/<pid>/fd` 中 sessions 相关句柄计数：20792:0 | 20805:0 | 20806:0 | 564638:0
- host was NOT touched: no signal, no restart, no HTTP probe

## 6. 无法验证的风险（保守处理，不假装通过）

- Host in-memory attach set is not queryable read-only (no HTTP probe, no IPC). Mitigations applied: updatedAt<cutoff, artifact-mtime<cutoff, no session.lock, parent likewise stale.
- session_projcache.json is rewritten by the live host every ~30s; its content is a moving target. Phase 2 must run after a host restart.
- The audit report describes sync_state as 2356 "dangling" rows; measured read-only, all 2356 dsh: rows currently resolve to existing files. They become dangling only after the session purge. Both numbers are reported.
- session_projcache.json carries no lastPromptAt for 524 sessions; for those, updatedAt falls back to header.createdAt, which is a lower bound (conservative: it can only over-estimate deletion eligibility for sessions whose only later activity was a non-user event).

## 7. 主 agent 执行序列

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix
bash scripts/cleanup-sessions.sh --backup --days 7
bash scripts/cleanup-sessions.sh --apply --phase 1 --days 7
# → 重启宿主（由主 agent 决定时机）
bash scripts/cleanup-sessions.sh --apply --phase 2 --days 7
```

> 完整机器可读清单：`reports/cleanup-dry-run.json`（含 1,670 条 `deletableSessions` 逐条明细）
