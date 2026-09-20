# 独立交叉审计报告 — B2 会话数据清理（phase 1）合规性与可恢复性

- **审计员**：独立审计档（只读）
- **审计时间**：2026-09-20 16:0x–16:2x local（08:0x–08:2x UTC）
- **审计对象**：`bash .workspace/lag-fix/scripts/cleanup-sessions.sh --apply --phase 1 --days 7`
- **被审执行记录**：`reports/cleanup-apply-20260920-074510.log`
  ```
  # apply 2026-09-20T07:45:40.316Z phase=1 days=7
  [phase1] sessions removed=1670 bytes=770143893 skipped=0
  [phase1] legacy projcache removed: files=1597 bytes=4937595 dirs=1
  ```
- **冻结窗口**（来自备份清单 `manifest.json`）：`now = 2026-09-20T07:45:10.527Z`
  → **cutoff = 2026-09-13T07:45:10.527Z**（epoch ms `1789285510527`）
- **纪律遵守**：全程只读。未删/未移/未在 `~/.dsh` 写入任何内容；SQLite 一律 `readOnly:true`；未重启宿主；HTTP 只读探针 **1 次**（≤3）；未使用 `sandbox_permissions`。唯一写入 = 本报告；临时文件在 `/tmp/data-audit/`。

---

## 0. 总体裁决

| 审计问题 | 结论 |
|---|---|
| 备份完整性 | ✅ **通过**（1670 目录 / 1670 文件 / 770,143,893 B 逐字节吻合；tar 可读、结构完全可解释） |
| 规则合规性 | ✅ **通过**（1670/1670 逐条验证合规；**误删 0、漏删 0**） |
| 可恢复性 | ✅ **已证明可还原**（tar 成员与删除清单一一对应，全部 1670 条 zstd 流完整性校验 0 失败，meta 预像 sha256 全匹配） |
| 87 个顶层会话 | ✅ **一条不少**（盘面 87 = 删前宿主探针 87 = 审计时实时探针 87，ID 集合逐条相等） |
| 僵尸/重建目录 | ✅ **未发现**（0 条被删 ID 复活；742 个现存目录首行全部是合法 session header） |
| phase 2 目标量 | ⚠️ **实测：projcache 1,670 条孤儿（吻合）；sync_state 真正悬空 1,670 行（runbook 写的 ~2,334 是错的）** |
| 误删活跃会话迹象 | ✅ **无任何迹象** |

> 唯一实质问题：**phase 2 的验收预期数值（sync_state ~2,334 / 事后 ≈410 行）与实测不符**，代码谓词本身是对的。详见 §4 与 §6。

---

## 1. 备份完整性

**备份目录**：`.workspace/lag-fix/backup/B2/20260920-074510/`（本地时间 15:45 = UTC 07:45，与 `manifest.json.createdAt 2026-09-20T07:45:21.119Z` 一致）

```
$ ls -la .../B2/20260920-074510/
-rw-rw-r--   149324  deletable-dirs.list          (1670 行)
-rw-rw-r-- 774400000  deletable-sessions.tar
-rw-rw-r--  6123520  legacy-projcache-tree.tar
-rw-rw-r--     2165  manifest.json
drwxrwxr-x          meta/   (workspace.json / session_projcache.json / usage.db / sync_state-dsh-rows.json)
总计 762400 (块)          $ du -sb → 826,856,314 B
```

### 1.1 tar 可读性与条目数

```
$ file deletable-sessions.tar → POSIX tar archive (GNU)
$ tar -tf deletable-sessions.tar | wc -l
3340                     # exit=0，无 stderr
$ tar -tvf ... | grep -c '/$'      → 1670     # 目录条目
$ tar -tvf ... | grep -vc '/$'     → 1670     # 文件条目
$ # 非 session.jsonl.zstd 的文件条目数 → 0
```

- **目录条目 1670 = 声称的 1,670 个会话目录**（不是 3340；3340 = 1670 目录 + 1670 内容文件，每个会话目录内**恰好 1 个** `session.jsonl.zstd`）。
- 原始块解析（自写只读 tar 解析器）进一步解释全部字节：`typeflags = {L: 2069, 5: 1670, 0: 1670}` —— 2069 个 GNU LongLink 元数据块是长路径名所需，`tar -tf` 不列出但占空间，恰为文件尺寸与成员和之差。归档数据结束于 offset 774,393,856，其后全 0 至 774,400,000（EOF 块 + 块补齐）。**归档内没有任何未列出的隐藏成员。**

### 1.2 总字节

```
$ tar -tvf deletable-sessions.tar | awk '{s+=$3} END{print s}'
770143893                # ← 与 apply 日志 bytes=770143893 逐字节相等
$ stat -c %s deletable-sessions.tar
774400000                # = 738.53 MiB ← 与声称「738.53 MiB」相等
```
✅ **声称的 770,143,893 B 与 tar 内实际成员字节和完全一致**（非估算）。

### 1.3 遗留 projcache 归档

```
$ tar -tf legacy-projcache-tree.tar | wc -l          → 1599
$ tar -tvf ... | awk '!/^d/{s+=$3;n++} END{print n, s}' → 1597 4937595
```
✅ **1,597 文件 / 4,937,595 B 与 apply 日志完全一致**；成员均为 `session_projcache/sessions/*.json`（mtime 2026-09-11 15:23，与干跑记录的 `mtimeDays {2026-09-11: 1597}` 一致）；恢复路径 `tar -C /home/CNS2026495165/.dsh/storages` 正确。

### 1.4 meta 预像校验（sha256）

```
1e071538...5626  meta/workspace.json           = manifest ✓
1cc08576...e408  meta/session_projcache.json   = manifest ✓
800c4c4f...a58e7 meta/usage.db                 = manifest ✓
```
✅ 三份 meta 预像哈希全部与 manifest 声明匹配；另有 `meta/sync_state-dsh-rows.json`（599,566 B，phase 2b 的逆转预像）。

### 1.5 备份额外佐证（独立于清单）

`tar -tvf` 的**宿主原始 mtime** 范围：`2026-08-19 14:45` → `2026-09-12 19:34`（本地时间）。
即**全部 1670 个被备份/被删会话文件在删除前的最后写入时间都早于 cutoff（2026-09-13 15:45:10 local）**，最晚者仍早于 cutoff 约 23 小时。这是与规则完全独立的第二重窗口证据。

**§1 结论：备份完整、可读、可校验，数量与字节与声称逐字节吻合。**

---

## 2. 规则合规性

### 2.1 随机抽检 12 条（seed=20260920，只读提取 tar 内 header + 备份 meta 预像）

cutoff = 2026-09-13 07:45:10 UTC。`lock?` 由「该目录在 tar 内的成员是否只有 `session.jsonl.zstd`」判定（有锁的会话目录在归档时必然带 `session.lock`，其成员会有第 2 个文件）。

| # | session id | origin | updatedAt(宿主探针) | updatedAt(备份projcache) | createdAt(header) | session.lock | 父会话 | 父会话状态 | 判定 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `b53c7eb1-6410` | subagent | 2026-09-08 02:51 | 2026-09-08 02:51 | 2026-09-08 02:51 | 无 | `session-91f816dd` | 在盘且超期（09-08 02:53） | **PASS** |
| 2 | `c47ea87a-4563` | subagent | 2026-08-27 06:16 | 2026-08-27 06:16 | 2026-08-27 06:16 | 无 | `session-3dd0a29b` | 在盘且超期（08-27 06:12） | **PASS** |
| 3 | `e1632c16-82f5` | subagent | 2026-08-26 04:49 | 2026-08-26 04:49 | 2026-08-26 04:49 | 无 | `session-f2c0880e` | 在盘且超期（08-28 09:34） | **PASS** |
| 4 | `54c1444a-8744` | subagent | 2026-09-05 09:36 | 2026-09-05 09:36 | 2026-09-05 09:36 | 无 | `session-9b1319d7` | 在盘且超期（09-05 10:07） | **PASS** |
| 5 | `25e23fc5-0ad7` | subagent | 2026-09-03 10:01 | 2026-09-03 10:01 | 2026-09-03 10:01 | 无 | `session-e0ed4420` | 在盘且超期（09-05 05:15） | **PASS** |
| 6 | `8d1095b2-b643` | subagent | 2026-09-08 09:02 | 2026-09-08 09:02 | 2026-09-08 09:02 | 无 | `session-d8bb7bfc` | 在盘且超期（09-11 02:13） | **PASS** |
| 7 | `ff46cd18-679a` | subagent | 2026-08-24 10:46 | 2026-08-24 10:46 | 2026-08-24 10:46 | 无 | `session-aa169d83` | 在盘且超期（08-25 02:55） | **PASS** |
| 8 | `7f98b056-71e0` | subagent | 2026-08-26 04:55 | 2026-08-26 04:55 | 2026-08-26 04:55 | 无 | `session-25d8addd` | 在盘且超期（08-27 02:42） | **PASS** |
| 9 | `6b149a8e-b6de` | subagent | 2026-09-01 07:58 | 2026-09-01 07:58 | 2026-09-01 07:58 | 无 | `session-d38ab97b` | 在盘且超期（09-03 08:29） | **PASS** |
| 10 | `49f55f56-81bb` | subagent | 2026-09-03 07:45 | 2026-09-03 07:45 | 2026-09-03 07:45 | 无 | `82b09ac1-2677` | 本次同批删除（自身已验证） | **PASS** |
| 11 | `88dfb88e-5bb5` | subagent | 2026-09-12 05:47 | 2026-09-12 05:47 | 2026-09-12 05:47 | 无 | `ab3acc6c-3fbf` | 在盘且超期（09-12 05:45） | **PASS** |
| 12 | `6b402da5-e821` | subagent | 2026-09-07 09:16 | 2026-09-07 09:16 | 2026-09-07 09:16 | 无 | `session-6a7367fe` | 在盘且超期（09-11 08:22） | **PASS** |

12/12 PASS。四要件（`origin==subagent`、`updatedAt<cutoff`、无 `session.lock`、父会话同样超期或不存在）逐条成立。

### 2.2 全量（1670 条）规则验证 —— 不是抽样，是穷举

**(A) 来自备份 tar 自身（自写只读 tar 解析器，解压全部 1670 个 header）**

| 检查项 | 结果 |
|---|---|
| `header.type == "session"` | 1670 / 1670 |
| `header.id == 目录名`（G0） | 1670 / 1670，0 例不符 |
| `origin == "subagent"`（G1） | **1670 / 1670** |
| `header.createdAt < cutoff`（G2 下界） | 1670 / 1670；最晚 `2026-09-12T10:37:09Z` |
| 无 `session.lock`（G3） | 1670 / 1670（每个目录在 tar 内仅 1 个成员） |
| 有 `parentSession` 指针（G5 前提） | 1670 / 1670（0 例 no-parent-pointer） |
| 父会话状态（规则 3） | 1,453 在盘且超期 · 217 本次同批删除 · **0 例 parent-within-window / 父锁 / 父近期写入** |
| delegationDepth 分布 | 0:332 · 1:1115 · 2:140 · 3:75 · 4:8 |

**(B) 与宿主权威数据的独立交叉验证**（`reports/probe-post-codeapply.json`，抓取于 2026-09-20 15:44 local = **删除前约 1 分钟**，2,396 条，含宿主自算的 `updatedAt` / `origin` / `running` / `parentSessionId`）

- 1,670 条被删会话中 **1,664 条**在该探针内；
- 这 1,664 条：**1,664 / 1,664 全部合规，违规 0**。逐条校验：
  - `origin == "subagent"`：全通过；
  - 宿主 `updatedAt < cutoff`：全通过；
  - `running == true`（=当时被宿主判定在运行）：**0 条**；
  - 父会话（`parentSessionId`）在探针内者，其宿主 `updatedAt` 全部 `< cutoff`：通过；
  - **父会话 `running == true` 的：0 条**。
- 不在探针内的 6 条：全部属 `_no-cwd` 桶（宿主 `session.list` 不暴露无 cwd 的会话），已用 tar header + 备份 projcache 逐条核验：`origin=subagent`、`createdAt` 2026-09-01/02（远早于 cutoff）、父会话在盘且超期。**6/6 合规。**

### 2.3 反证一：误删（被删但按规则不该删）

**未发现。数量 = 0。**

- 1,670/1,670 `origin == subagent` → 规则 2（绝不删顶层）零违反；
- 1,670/1,670 `updatedAt`（宿主算法 `max(createdAt, lastPromptAt)`）`< cutoff`，且 1,670/1,670 文件 mtime 也 `< cutoff`（双基准一致）；
- 0 例带 `session.lock`；
- 0 例父会话处于窗口内；
- 0 例在删除前被宿主标记 `running`，且 0 例其父会话被标记 `running`。

### 2.4 反证二：漏删（仍在盘但按规则本应被删）

**未发现。数量 = 0。**

对**当前盘面全部 742 个会话目录**重放完整守卫组（G1 origin / G2 窗口 / G3 锁 / G5 父会话 / G6 自身写入时间 / G7 投影活性信号）：

```
校验通过且仍应被删的会话：0
```

- 现存 655 个 subagent 中，542 条在 7 天窗口内（正常保留）；
- 113 条 `updatedAt < cutoff` 但被保守守卫拦下，**每条都有明确且正当的理由，0 条无理由**：
  - 40 条：父会话近期被写入（parent-recently-written）
  - 34 条：父会话同时「持有锁 + 近期写入 + 在窗口内」
  - 18 条：父会话近期写入 + 在窗口内
  - 11 条：父会话持有 `session.lock`（= 父会话正是当前 GUI 挂载中的活跃会话）
  - 10 条：无 `parentSession` 指针 → 规则 3 的保守例外（父不可验证，永久排除）
- 3 个带 `session.lock` 的目录**全部是顶层会话**，规则 4 生效、一条未动。

### 2.5 87 个顶层会话确认

```
当前 ~/.dsh/sessions 下：742 个目录 = 87 个非 subagent（顶层） + 655 个 subagent
```
- **删前宿主探针**（`probe-post-codeapply.json`，07:44Z）：顶层 **87**，与当前盘面 87 条 **ID 集合逐条相等**（`probe-only = []`，`current-only = []`）；
- **审计时实时宿主探针**（本审计唯一一次 HTTP：`POST /api/session.list`，HTTP 200，1,239,055 B）：**742 条 = 655 subagent + 87 顶层**，与盘面 742 目录 **1:1 精确对应**（互相都没有多余/缺失条目）；
- 实时列表中**被删 ID 出现 0 次** → 宿主内存列表里不存在任何被删会话。

**与探针产物的对照（重要更正）**：
- `evidence/probe-simulated-post-patch.json` 只有 **285 条 = 85 顶层 + 200 subagent**，**不是 87**。原因已查明：它是基于 **07:17Z 的旧快照**（`evidence/probe-pre-patch.json`，2,386 条 = 85 顶层 + 2,301 subagent，其最大 `updatedAt = 07:17:21Z`）离线套用 B1 过滤补丁算出的；盘面上多出的 2 个顶层会话创建于 **07:32Z**（`session-2472df40…`、`session-5918aedb…`），晚于该快照。**该探针与 87 不冲突，但它也不足以证明 87 —— 证明 87 的是上述两个全量 session.list 探针。**
- `reports/probe-post-restart.json`：**不存在**（`ls` 报 No such file or directory）。任务描述中提到的这份产物缺失 → 列为未验证项。与「宿主尚未重启」一致：`PID 20806` 自 `2026-09-20 11:47:23 local` 起运行，审计时已运行 4h18m，**清理前后未重启**。

---

## 3. 可恢复性（只读证明，未做覆盖式还原）

1. **清单 ↔ tar 一一对应（集合论证明）**
   ```
   $ comm -23 list-dirs.txt tar-dirs.txt   → 0 条（清单里的目录 tar 全有）
   $ comm -13 list-dirs.txt tar-dirs.txt   → 0 条（tar 里没有清单外的目录）
   $ tar 目录条目去重后重复数                 → 0
   ```
   ✅ `deletable-dirs.list`（1670 行）与 tar 内 1670 个目录条目**完全同一集合**，无遗漏、无多余、无重复。

2. **真实还原演练（解到 /tmp，绝不覆盖 `~/.dsh`）**
   ```
   $ tar -C /tmp/data-audit/restore-test -xf deletable-sessions.tar     # exit 0，0.36s
   目录 1670 · 文件 1670 · 字节 770143893        ← 与声明逐字节相等
   $ for f in $(find … -name '*.zstd'); do zstd -t "$f"; done
   zstd -t 失败数 = 0 / 1670                     ← 全部会话日志都是完整合法的 zstd 流
   ```
   ✅ 不仅 tar 结构可读，**1670 个会话日志的压缩流内容全部通过完整性校验**（0 损坏、0 截断）。解出物保留在 `/tmp/data-audit/restore-test/`（可随时 `rm -rf` 该临时目录）。

3. **meta 预像**：3 份 sha256 与 manifest 全匹配（§1.4），manifest 内 `restoreCommands` 的目标路径逐条正确；`cmdRollback` 代码路径存在且会先还原 sessions 再回写 meta、并复算 sha256 与 `sync_state` 行数。
4. **遗留 projcache（phase 1b）**：备份 tar 与已删内容在文件数（1597）与字节（4,937,595）上完全一致；原 `storages/session_projcache/sessions/` 现为空目录，可原样还原。
5. **phase 2 的逆转预像**：`meta/usage.db`（删除前整库）+ `meta/sync_state-dsh-rows.json`（dsh 行快照 599,566 B）+ `meta/session_projcache.json`（删除前 2,400 行）齐备。

**清单与 tar 不一致之处：未发现。**

---

## 4. 当前一致性（phase 2 目标量实测）

### 4.1 `session_projcache.json`（只读 JSON 解析）

```
文件 mtime = 2026-09-20T08:05:55Z（宿主在清理后仍在重写，约 30s 节奏）
行数 total = 2410
指向已不存在会话目录的行 = 1670        ← phase 2a 目标量
  其中属本次删除的 = 1670；清理前既有的孤儿 = 0
盘面上缺少 projcache 行的会话 = 2（刚创建的新会话，无害）
```
- 与 `cleanup-dry-run.json → orphans.a_projCacheRowsOfMissingSessions.predictedAfterDelete = 1670` **完全吻合**；
- 与 B2/runbook 声称的 **~1,670 吻合** ✅；
- 备份预像（删前）2,400 行 → 现 2,410 行（宿主新增 10 行，**0 行被删**）→ 反证 phase 1 未触碰该文件。

### 4.2 `usage.db / sync_state`（`readOnly:true`）

```
sync_state 总行数 = 2744
  dsh:% 行 = 2356（经核验：2356 行全部是 /sessions/<slug>/<id>/session.jsonl.zstd 路径）
  其它来源（cc:）= 388
  dsh 行中目标文件已不存在（真正悬空）= 1670   ← phase 2b 的真实目标量
     · 1670 行 100% 可归因于本次删除（悬空且路径 id ∈ 被删集合）；不可归因的悬空 = 0
     · 仍有效（文件在盘）= 686
```

**⚠️ 数值不符（本次审计最重要的发现之一）：**

| 口径 | 数值 | 评价 |
|---|---|---|
| runbook / NEXT_SESSION_PROMPT 声称 | 悬空 ~**2,334**，事后 sync_state ≈**410** 行 | ❌ **与实测不符**。2,334 显然由 `2744 − 410` 反推而来，而「事后 410 行」这个前提本身就是错的 |
| `cleanup-dry-run.json` 预测 | `predictedAfterDelete = 2356`（= 全部 dsh 行），`trulyDanglingNow = 0` | ❌ 高估 686 行（删 1,670 个会话不可能让 2,356 行悬空；且自身也写了「当前真正悬空 = 0」） |
| **本审计实测** | 真正悬空 **1,670** 行 | ✅ 与删除数一致 |
| phase 2b 代码实际行为 | `!fs.statSync(path).isFile()` 过滤 dsh 行 → **恰好删 1,670 行** | ✅ **代码谓词正确** |
| 清理后 sync_state 实为 | **1,074 行**（686 dsh 有效 + 388 cc），不是 ~410 | — |

同理，`session_projcache.json` 清理后实际 ≈ **740 行**（runbook 写 ≈732，量级正确、会随宿主新会话继续增长）。

> 结论：**代码是对的，写进 runbook 的验收数字是错的。** 若照 runbook 的「sync_state ≈410」去验收，phase 2 会被误判失败；若被误判后采取「删掉全部 dsh:% 行」的错误补救，会连带删掉 686 行指向**仍然存活**会话的同步状态（后果 = 这些会话被全量重扫/重同步，不是数据丢失，但会重新引入卡顿）。

---

## 5. 僵尸目录（删后被宿主重建）

结论：**未发现。**

```
被删 ID 现仍存在于盘面的条数 = 0                      ← 无任何目录复活
现存 742 个会话目录中，首行不是合法 session header 的 = 0
现存目录中首行 JSON type != "session" 的           = 0
现存目录中没有 .zstd 文件的 / 空目录                = 0
```
- 「删掉后又被宿主重建」的典型表现（目录内只剩非 header 首行的日志、或空目录）在盘面上 0 例；
- 742 目录中，仅 10 个是在 apply（07:45:40Z）之后创建的**真新会话**（`07:47–08:03Z`，全部位于活跃工作区 `--home-…-dsh--` 与 `--…-~9762~8BD5--`，首行均为合法 header，且是该 slug 下最新的会话），属于正常增量，不是僵尸；
- 被删会话全部不再出现在宿主实时 `session.list`（0 次）→ 宿主内存未持有它们，也就不会在后续 flush 中重建。

---

## 6. 风险与遗留（phase 2 执行前）

### 6.1 最大风险：**phase 2 的预期数字是错的，可能引发错误补救**

- 实测相位 2 目标：projcache **1,670** 行 + sync_state **1,670** 行（合计 3,340 行），**不是** runbook 的「~1,670 + ~2,334」；
- 风险路径：按 runbook 验收 → 看到 sync_state 剩 1,074 行 ≠ ≈410 → 误判失败 → 采取「把 dsh:% 行全清」的过度补救 → 连带删掉 686 行**有效**同步状态 → 存活会话被全量重同步，卡顿复发。
- **建议**：执行 phase 2 前把 runbook 的验收值改为 `projcache 1670 → 剩 740`、`sync_state 1670 → 剩 1074`；不要使用 `predictedAfterDelete = 2356` 这个 B2 笔误值。

### 6.2 次大风险：宿主存活会覆写这两个索引

- `session_projcache.json` mtime = 08:05:55Z（清理后 20 分钟仍在被宿主重写）→ 不重启就做 phase 2a，改写会被宿主覆盖（代码已内建 `[phase2-PRECHECK-WARN]` 告警）；
- `usage.db` 由 usage 插件持续写入 → phase 2b 必须在重启后执行，且需在 `sync_state` 写操作上保证事务（代码已用 BEGIN/COMMIT/ROLLBACK）；
- **重启后必须复验**：重读 `session_projcache.json` 行数（应 ≈740，且不再回到 2,410）与 `sync_state` 行数（应 ≈1,074），确认宿主没有把行重新灌回来。备份预像齐备，可回滚。

### 6.3 「误删发生在仍活跃会话上」的迹象：**无**

| 迹象检查 | 结果 |
|---|---|
| 删除前 1 分钟宿主判定在运行的被删会话 | 0 条 |
| 被删会话的父会话当时在运行 | 0 条 |
| 被删会话文件删除前最后写入时间晚于 cutoff | 0 条（最晚 2026-09-12 19:34 local，早于 cutoff 约 23h） |
| 带 `session.lock` 的被删会话 | 0 条 |
| 现存会话的父指针指向被删会话（= 清理造成的悬空/孤儿链） | 0 条 |
| 被删会话在实时 `session.list` 中仍可见 | 0 条 |
| 被删目录被宿主重建 | 0 条 |

7 项独立信号全部为 0/无，**没有发现任何误删活跃会话的迹象**。

### 6.4 遗留与未验证项

1. **`reports/probe-post-restart.json` 不存在** —— 任务描述中引用的这份产物缺失（宿主未重启，本也不该存在）。
2. **宿主内存 attach 集合不可只读查询** —— 无 HTTP/IPC 接口可枚举宿主当前挂载的会话；本审计用 4 个替代信号覆盖（`running` 标志 / 文件 mtime / `session.lock` / 删除后无复活），全部通过。仍属「原理上不可直接证否」的残余不确定性。
3. **10 个（另 103 个被父会话守卫拦下）超期 subagent 永远不会被本规则回收** —— 其中 10 个因缺 `parentSession` 指针被 G5 永久排除（11.5 MB）。这是**规则 3 保守例外的既定代价**，不是违例；如需回收需另行裁决。
4. **projcache 有 2 个新会话暂无行**（宿主投影延迟），无害。
5. **未做真实覆盖式还原**（遵纪律），但已用「/tmp 解包 + 全量 zstd 完整性校验 + sha256 预像比对 + 集合一致性」四重只读证据替代。
6. 本次审计未触碰 `~/.dsh` 任何写入，未重启宿主，HTTP 只读探针共 1 次。

---

## 附：本审计使用的证据文件（均在 `/tmp/data-audit/`）

| 文件 | 内容 |
|---|---|
| `b2-tar-list.txt` / `b2-tar-tv.txt` | tar 成员清单 / 含尺寸与宿主 mtime 的清单 |
| `deleted-headers.json` | 从备份 tar 中只读提取的 1670 条 session header |
| `current-scan.json` | 当前 742 个会话目录的 header / 锁 / mtime / updatedAt 全量扫描 |
| `sync_state_all.json` / `sync_state_dsh.json` | sync_state 全表只读导出 |
| `live-session-list.json` | 本次唯一一次实时 `session.list` 探针响应（742 条） |
| `restore-test/` | tar 解出的 1670 目录（完整性演练产物，可删） |
| `scan-disk.mjs` / `tar-headers.mjs` | 只读扫描脚本（可复跑复现全部数字） |
