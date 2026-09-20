# DSH 卡顿修复 · 最终 Runbook（单一入口）

**目标锚点**：`goal-93254121` · **回滚 tag**：`pre-lagfix-20260920-150310`（代码前） / `pre-docs-reorg-20260920-154951`（文档整理前） / `docs-reorg-done-20260920-155524`
**数据时点**：2026-09-20 · **唯一待办**：一次宿主重启（用户自行执行）

---

## 一、这次改了什么（四条线）

| 线 | 改动 | 生效方式 | 状态 |
|---|---|---|---|
| **A** 用量插件主线程冻结（⚠️ 门控部分见注） | `queryHeatmap` 分段走 `usage_daily` 预聚合（+ `is_subagent`/`provider` 能力护栏、窗口日对齐、新鲜度闸门）；ingest `rebuildDailyForDays` sargable 化；客户端加 `IntersectionObserver` 可见性门控、轮询 30s→60s（保留"不轮询"项） | **client 半热替换**；**host 半需重启** | ✅ 已落地（source + deployed 双目标） |
| **B1** 会话列表全量下发 | `dsh-host-apiproxy/lib/index.js`（**生效件**）+ `lib/types/api-proxy.js` 同改：顶层全发 + subagent 只发**最近 200 条**；新增 `runningSubagentCount` 聚合字段；客户端消费方最小改动 | **需重启** | ✅ 已落地 |
| **B2** 会话数据缩容 | 7 天滑动窗口删除旧 subagent 会话（保守例外：父会话同样超期或无父；避 live/lock）；清 1,597 个废弃 projcache 遗留文件 | 数据操作（已执行 phase 1） | ✅ phase 1 完成；phase 2 待重启后 |
| **C1** 官方客户端运行时 | `dsh-client-runtime`：P1（`entryCache` 清理 O(N²)→Set）+ P2（`list.set` 引用稳定化）。**P4 经实测为负收益，用户裁决弃用**；P3（面板 memo）用户裁决暂缓 | **客户端热替换** | ✅ 已落地生效 |
| **C2** 第三方插件 | `dsh-workspace-enhancement`：`sessions()` 快照记忆化 + `remoteSessionIndex` 去重改 Set | **客户端热替换** | ✅ 已落地生效 |
| **D** 文档整理 | 根目录 27→3 个 `.md`；`.workspace` 顶层 183→6；新建 `docs/program-notebook.md` + `architecture/01..04` + `runbooks/`（按 `program-notebook` skill 规范） | git（3 次提交 + tag） | ✅ 完成 |

---

## 二、交付物索引

| 类别 | 位置 |
|---|---|
| **补丁脚本**（含 `--dry-run`/`--apply`/`--rollback`、备份隔离、回滚所有权校验） | `.workspace/lag-fix/patches/`：`usage-plugin.sh`、`server-session-filter.sh`、`workspace-ui-runsubagent-count.sh`、`client-runtime-perf.sh`、`workspace-enhancement-perf.sh` |
| **前后对比复测数据** | `.workspace/lag-fix/reports/BEFORE-AFTER.md` |
| **复测探针** | `.workspace/lag-fix/probes/`：`verify-post-restart.sh`（一键）、`session-list-shape.mjs`、`usage-host-latency.mjs`、`measure-after-C1.mjs`、`verify-daily-equivalence.mjs` |
| **重启专用 Runbook** | `.workspace/lag-fix/REBOOT-RUNBOOK.md` |
| **决策台账**（10 轮裁决 + 6 项把关） | `.workspace/lag-fix/reports/DECISIONS.md` |
| **诊断报告**（根因/证据） | `.workspace/settings-lag/DIAGNOSIS.md` + `measure*.json` |
| **各单元报告** | `.workspace/lag-fix/reports/unit-{A,B1,B2,C1,C2}.md` |
| **文档整理记录与映射** | `.workspace/reports/docs-reorg/`（`TRACK-D-DONE.md`、`mapping.json`、`inventory.md`、`tools/move_commands.sh`） |

---

## 三、Runbook

### 3.1 重启（唯一待办；请在普通终端执行）

```bash
cd /home/CNS2026495165/dsh
bash .workspace/workstreams/deploy/deploy-lag/dsh-restart.sh --dry-run     # 预览：应锁定 PID=20806
bash .workspace/workstreams/deploy/deploy-lag/dsh-restart.sh --yes         # 执行：SIGTERM → 启动 → boot OK
```

### 3.2 重启后一键复测

```bash
bash .workspace/lag-fix/probes/verify-post-restart.sh
```

### 3.3 phase 2（孤儿索引清理；**必须在重启之后**）

```bash
bash .workspace/lag-fix/scripts/cleanup-sessions.sh --apply --phase 2 --days 7
```

**预期（经独立审计更正，1680/1680 穷举核验）**：
- `session_projcache.json` 孤儿键 **1,670** 条（删会话后产生）
- `sync_state` **真正悬空** 1,670 行 —— ⚠️ 先前文档写的 ~2,334 是**错的**：那 2,356 行里绝大多数指向的文件仍存在，悬空是**删完会话才产生**的
- **校验阈值**：projcache ≈ **742** 行（= 现存会话数）、`sync_state` ≈ **1,074** 行（2,744 − 1,670）
- ⚠️ **不要**按错误阈值判失败后去"清空全部 `dsh:` 行"：会连带删掉 **686 行仍指向存活会话**的同步状态，触发全量重同步、卡顿复发
- ⚠️ 宿主仍在校写这两个文件：phase 2 **必须在重启后**执行，并复验"不被回灌"

### 3.4 回滚（**顺序有铁律**）

> ⚠️ `dsh-client-runtime/lib/client.js` 被 **B1 与 C1 两个单元先后修改**（B1 在 entryCache 新鲜度链加了一行、
> C1 做 P1+P2）。**必须先回滚 B1、再回滚 C1** —— C1 的 `--rollback` 会把文件还原到 pristine 基线，
> 连带抹掉 B1 的改动并使 B1 进入 partial（两条恢复路径同时受阻）。该护栏已内置（C1 检测到 B1 标记即拒绝，
> 除非显式 `--force-order`），并已通过沙箱对抗测试。

```bash
cd /home/CNS2026495165/dsh

# ① 先回滚 B1 的客户端半（热面：刷新浏览器即生效）
bash .workspace/lag-fix/patches/workspace-ui-runsubagent-count.sh --rollback
# ② 再回滚 C1 / C2（热面）
bash .workspace/lag-fix/patches/client-runtime-perf.sh --rollback
bash .workspace/lag-fix/patches/workspace-enhancement-perf.sh --rollback
# ③ 冷面单元（回滚后需再重启一次宿主才退出效果）
bash .workspace/lag-fix/patches/server-session-filter.sh --rollback
bash .workspace/lag-fix/patches/usage-plugin.sh --rollback --target deployed
# ④ 数据层：恢复 1,670 个已删会话
bash .workspace/lag-fix/scripts/cleanup-sessions.sh --rollback --backup-dir backup/B2/20260920-074510
# ⑤ 文档整理：完整回退见 .workspace/reports/docs-reorg/TRACK-D-DONE.md §四
git reset --hard pre-docs-reorg-20260920-154951
```

**备份根（各单元独占；回滚带内容校验）**：`backup/C1`、`backup/B1/server`、`backup/B1/client`、
`patches/backup/C2`、`backup-usage/<target>`、`backup/B2`。
B1 两脚本回滚要求 `MANIFEST`（unit + `pre_*`/`post_*` 指纹）与备份内容自校验全部通过，缺一项即拒绝（**未写入任何 live 文件**）。

---

## 四、验收标准与当前达成情况（v2：**收回此前不成立的"三项通过"**）

| 门槛 | 目标 | 现状（多轮实测区间） | 判定 |
|---|---|---|---|
| 空闲主线程脚本 | < 60 ms/s | 16.4 / 27.5 / 45.0 / **45.3** / 审计独立复测 **84.3**（基线 121） | **未成立**（条件不可比 + 单次测量 + 存在超门槛反例） |
| 设置页帧 p99 | < 50 ms | 49.9 / 100 / 16.8 / **50** / 审计独立复测 **66.7**（基线 116.6） | **未成立** |
| >50ms 卡顿帧 | 降 >50% | 1 / 4 / 9 / 24（基线 22）——但同期 N 从 2,361 降到 734（−69%） | **不可归因**（代码补丁与数据缩容混杂） |
| 宿主延迟 | 无 >100ms 停顿、中位数 <5ms | 中位数 2.1 ms ✅；**停顿 2 次（max 170.7ms）** ⏳ | 待重启后复测 |
| `session.list` | ≤287 条 / ≤500KB | 736–742 条 / 1.18MB（已从 2,386–2,396 条 / 3.92MB 降 **−69%**）；服务端过滤补丁已在盘 | ⏳ 待重启（语义模拟值 **285 条 / 472KB**） |
| `/usage/heatmap` | < 40 ms | 补丁路线实测 **0.046ms**（原件 274.1ms）；宿主侧待重启 | ⏳ |

**① 与负载无关的确定性基准（先跑这个）**：

```bash
node .workspace/lag-fix/tools/bench-c1.mjs --rounds 30 --out reports/bench-c1.json
```
把两版 P1 清理代码**从 pristine 备份与 live 补丁件程序化抽出**后基准化，给出「代价 vs N」曲线。
2026-09-20 实测（稳态）：N=289 旧 0.219/新 0.028 ms、**N=2361 旧 5.225/新 0.084 ms（62×）**、N=5000 旧 26.97/新 0.19 ms（143×）；
并由 121 ms/s ÷ 5.225 ms 反推**重建速率 ≈23 次/秒**，与 DIAGNOSIS 的事件率同量级 → **定量坐实 O(N²) 快照重建为主因**。

**② 端到端门槛测量（需要真实流式负载）**：

```bash
# 必须在「有真实流式输出」时跑；先看输出的 ws/s 列，>=50 帧/s 才可用
timeout 900 node probes/threshold-run.mjs --reps 5 --window 20 --tag post-restart --out reports/threshold-post-restart.json
```
- 协议内建：每相 5 次重复 → 报告**中位数与 [min,max]**；会话规模 N 实测（分列 items/信封/items_bytes）；
  WS 负载**双口径**（信封类型 + 事件种类，后者与基线口径一致）；**逐帧归一化** `ms/1k帧`（跨负载可比的代理指标）；
  场景数 <60 时打印显式告警。
- ⚠️ 实测教训：探针**无法自己制造流式负载**，静默态下 ws/s≈0（实测 idle 仅 0.3–0.4 ms/s）——
  那不是补丁收益的度量。必须与真实流式输出重叠，并用 ws/s 列自证负载达标。
- 重启前的静默态参考（**非门槛判定用**）：`reports/threshold-pre-restart-loaded2.json` 与
  `reports/threshold-pre-restart-loaded.json` —— 二者均在「无流式负载」时采集，实测 idle 0.3–0.4 ms/s、
  p99 16.8ms、>50ms 0、ws/s≈0（脚本已打印显式告警）。它们记录的是**安静时的下限**，不是补丁收益。

> ⚠️ **A 线门控的功能缺陷与修复（轮 6 发现）**：可见性门控曾经是**死代码**
> （`setPollVisibleRef.current` 从未被赋值 → `pollVisible` 恒为 true → 出视口后照旧每 60s 轮询）。
> 已修（三处同步 + 规格防重放），并以**行为探针**给出前后对比：出视口 70s 内请求 **7 次 → 0 次**。
> 详见 `reports/finding-A-gating-inert.md`；复验命令：
> `node .workspace/lag-fix/probes/verify-usage-gating.mjs`。

**结论**：改善在**所有**运行中方向一致地出现，但**正式门槛判定尚未成立**——需要**匹配条件 + 重复测量**：
重启后固定 N（≤287）、固定负载、每项 ≥3 次，取中位数与区间。详见 `reports/BEFORE-AFTER.md`（v2）。

## 五、已独立复现的证据（由主 agent 亲手执行，非仅采信子代理报告）

| 验证 | 结果 |
|---|---|
| A：`verify-daily-equivalence.mjs` | **ALL PASS**（T1/T2a-c/T3/T4/T5/T6a-c/T7a-d/T8a-c/T9a-e）；原件 274.1ms → daily **0.046ms（×5991）**；T6b 反事实证明朴素日取整**多算 +1.539%** |
| B1：`B1-simulate-post-patch.cjs`（真实 payload） | **285 条（顶层 85 + subagent 200）/ 472,584 B** |
| C1：等价性单测 + dry-run | 全量 10/0/0；P1+P2 子集 7/0/3；dry-run exit 0 |
| C2：dry-run + 对拍 | 6 PASS / 0 FAIL，含 27 项对拍 ALL PASS |
| 客户端热替换 | 四个包 rev 与落地文件 sha1 逐位一致 |
| 文档整理 | 2,229 个跟踪文件**0 丢失**；`git status` 干净 |

---

## 六、待决项（不阻塞重启）

1. 源码 `dsh-usage/` 是否追平部署侧（部署侧是更新超集：hourly 粒度、趋势 gear、`settingsScope`、`peakRing`；9/9 补丁区域两侧逐字节相同、无冲突）。
2. 热力图是否改为尊重范围选择器（范围审计结论：**有条件做**；可见代价是默认"近 7 天"档从 6 列退成 1 列；零重启替代方案＝保留整年 + 标题标注年份）。
3. `deepseek-v4-pro` 图片声明已补，热载状态待用一张截图实测。
4. 用量 ingest 停摆（`sync_state` 停在 09-18）：用户解释为放假；我实测今天有 35 个会话日志写入，登记为遗留项。
