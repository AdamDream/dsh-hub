# DSH 卡顿修复 · 最终 Runbook（单一入口）

**目标锚点**：`goal-93254121` · **回滚 tag**：`pre-lagfix-20260920-150310`（代码前） / `pre-docs-reorg-20260920-154951`（文档整理前） / `docs-reorg-done-20260920-155524`
**数据时点**：2026-09-20 · **唯一待办**：一次宿主重启（用户自行执行）

---

## 一、这次改了什么（四条线）

| 线 | 改动 | 生效方式 | 状态 |
|---|---|---|---|
| **A** 用量插件主线程冻结 | `queryHeatmap` 分段走 `usage_daily` 预聚合（+ `is_subagent`/`provider` 能力护栏、窗口日对齐、新鲜度闸门）；ingest `rebuildDailyForDays` sargable 化；客户端加 `IntersectionObserver` 可见性门控、轮询 30s→60s（保留"不轮询"项） | **client 半热替换**；**host 半需重启** | ✅ 已落地（source + deployed 双目标） |
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
bash .workspace/deploy-lag/dsh-restart.sh --dry-run     # 预览：应锁定 PID=20806
bash .workspace/deploy-lag/dsh-restart.sh --yes         # 执行：SIGTERM → 启动 → boot OK
```

### 3.2 重启后一键复测

```bash
bash .workspace/lag-fix/probes/verify-post-restart.sh
```

### 3.3 phase 2（孤儿索引清理）

```bash
bash .workspace/lag-fix/scripts/cleanup-sessions.sh --apply --phase 2 --days 7
```

### 3.4 回滚（按需，逐单元独立）

```bash
cd /home/CNS2026495165/dsh
bash .workspace/lag-fix/patches/client-runtime-perf.sh --rollback              # 客户端热面，刷新即生效
bash .workspace/lag-fix/patches/workspace-enhancement-perf.sh --rollback       # 同上
bash .workspace/lag-fix/patches/workspace-ui-runsubagent-count.sh --rollback   # 同上
bash .workspace/lag-fix/patches/server-session-filter.sh --rollback            # 冷面，需再重启
bash .workspace/lag-fix/patches/usage-plugin.sh --rollback --target deployed   # 冷面，需再重启
bash .workspace/lag-fix/scripts/cleanup-sessions.sh --rollback --backup-dir backup/B2/20260920-074510   # 恢复 1,670 个会话
git reset --hard pre-docs-reorg-20260920-154951                               # 文档整理回退
```

> 所有 `--rollback` 均已带**所有权校验**（备份不属于本单元即拒绝执行），每个单元的备份根互相隔离（`backup/C1`、`backup/B1`、`backup/B2`、`patches/backup/C2`、`backup-usage/<target>`）。

---

## 四、验收标准与当前达成情况

| 门槛 | 目标 | 现状 | 判定 |
|---|---|---|---|
| 空闲主线程脚本 | < 60 ms/s | **27.5 ms/s**（基线 121，**−77%**；测于 ws 135 帧/s，比基线更重） | ✅ |
| >50ms 卡顿帧 | 降 >50% | 22 → **4**（**−82%**） | ✅ |
| 设置页帧 p99 | < 50 ms | **49.9 ms**（基线 116.6） | ✅ |
| 宿主延迟 | 无 >100ms 停顿、中位数 <5ms | 中位数 2.1ms ✅；停顿待重启后复测 | ⏳ |
| `session.list` | ≤287 条 / ≤500KB | 736 条 / 1.23MB（**已从 2,396 条 / 3.94MB 降 69%**）；补丁已落盘 | ⏳ 待重启 → 模拟值 285 条 / 472KB |
| `/usage/heatmap` | < 40 ms | 补丁路线实测 **0.046ms**（原件 274.1ms）；宿主侧待重启 | ⏳ |

---

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
