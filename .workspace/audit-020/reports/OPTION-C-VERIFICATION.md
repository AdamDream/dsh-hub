# 选项 (c) 形态验收记录（协调者实测）

裁决来源：用户 2026-09-29 明示「选c」—— 0.1.1 管历史、0.2.0 管新会话、零数据改写。

## 1. 立论实证（同一份真实文件双向对照）
| 侧 | 读取 0.1.1 写出的会话日志 |
|---|---|
| **0.1.1** | ✅ **完全可读** —— 22.8 MB / 82 430 行样本：`decodeStorageRecord` 零错误展开 **65 145 个打包行 → 1 364 372 个事件**（`reasoning-chunks 53 042` / `tool-call-chunks 7 593` / `text-chunks 4 510`），另 17 285 行普通事件 |
| **0.2.0** | ❌ 抽样 200 份仅 **3%** 通过；修 descriptor `2→3` 后 **60%**；余 40% 卡在三种打包行 |

⇒ (c) 是**唯一能让历史 100% 可读**的路径，非「保守选择」。

## 2. 数据面隔离（已完成）
- 为 N17 验证而复制进新根的 **2 460 份日志 + 205 MB 附件副本已移出** → `.workspace/audit-020/n17-evidence/`
- 新根 `home/` 现仅 `logs/ profiles/ storages/ wallpapers/`，**无 `sessions/`、无 `attachments/`**
- 现役历史语料**原地未动**：**2 466 日志 / 21 工作区 / 991 附件（205 MB）**；会话期间日志数 2 460→2 466 ⇒ 现役仍在活跃写入

## 3. (c) 形态冷启动验收（空历史根）
| 判据 | 结果 |
|---|---|
| peer-gate 静默禁用 | **0**（期望 0）✅ |
| URL 发放 | `http://127.0.0.1:3098` ✅ |
| 未激活条目 | **2**（`dsh-vision-adam`、`dsh-session-board` = 已知 settings 断层）✅ |
| 是否继承/自建历史会话目录 | **未建 `sessions/`**（首条新会话时才建）✅ |
| 停栈 | 端口 FREE ✅ |
| 现役未污染 | patch `513413e7…` / settings `0f19b0fe…` 与开工逐位一致；3080/3097 在线 ✅ |

## 4. 待办（本形态下仍需处理）
- **3 个插件**的 settings 断层改造：`dsh-subagent-model` / `dsh-session-board` / `dsh-vision-adam`
- **N10 已裁定方案 B**（丢弃私有依赖岛）；三条前提已查清
- 办公入口 Route A 失效后的 A/B/C/D 待裁决
- `remoteHosts` 回归是否找回 —— 待裁决
- taste 语言基线（已中文单轨）是否更新偏好 —— 待确认
- **建议并行报官方 issue（b2）**：0.1.1 合法写入的三个打包行类型未被 v0 迁移清单登记

---

## 5. 协调者在 (c) 形态下修复的四项缺陷（含我自己造成的两处）

切换预案档在编写中发现的问题，经协调者实测确认并修复：

| # | 问题 | 实测证据 | 修复 | 影响 |
|---|---|---|---|---|
| 1 | **`zod` 软链跨版本泄漏** | 原软链指向 `~/.dsh/profiles/node_modules/zod`（= **0.1.1 前缀，4.6.2**），而 0.2.0 前缀自带 **4.6.5** | 改指向 `$ROOT/prefix-cli/.../zod`（**4.6.5**） | 这是我搭建时的取巧；会让 `dsh-btw` 在 0.2.0 上跑 0.1.1 的 zod |
| 2 | **缺 `.agent-presets/`** | 新根无该目录，但 `default: standard-glm` 已在组合树中 ⇒ **「起来了≠定制生效」的现场实例** | 已从现役迁入 `standard-glm`（2 文件） | 缺它则 default preset 静默回落 `standard` |
| 3 | **preset 内 `persona.config.text` 非法** | `dsh-persona` Config schema 实测只认 **`prefix` / `suffix` / `complete` / `includeRuntimeContext`** | 改为 `prefix:`（备份存 `preset-fix-backup/`） | 非法则 **preset 激活失败** |
| 4 | **preset 引用已停发的包** | `@deepseek-ai/dsh-workflow-worker-thread` 在 0.2.0 闭包内**不存在**（0.1.5-rc.3 后停发） | 移除该行，注明能力由官方 bundle 自带的 `workflow-ptc` 提供 | 非法则该 preset 行解析失败 |

**修复后复核**：`--dump-config` **rc=0 / 199 条目**；preset 内非法键计数 `text:0 / prefix:1`；YAML 经 DSH 自身（支持 `!!js`）解析通过。

**另：`settings.yaml` 已做保留式暂存** —— 复制为 `$ROOT/home/settings.yaml.import-source`（252 行），**刻意不命名为 `settings.yaml`**：
因为机制是「读一次即改名 `.imported`」，**必须先备好 profile patch 再投放**，否则该段只留在 `.imported` 且**不重试**（详见 RUNBOOK §9 的 12 段处置表）。

## 6. ⚠️ 生产形态必须去掉网络隔离（切换预案档发现，重要）
用 `unshare -rn` 是为了本轮的**零外呼验收**；但生产里**用户浏览器根本访问不到 netns 内的端口**。
⇒ **正式运行必须去掉 `unshare -rn`**，零外呼改由三者共同保证：
1. `env -i` 清空环境凭据（**无 key ⇒ 源码级必然零外呼**，`MISSING_CREDENTIAL` 在 `fetch` 之前抛出且不可重试）；
2. `DSH_TELEMETRY_MODE=DISABLED` 关闭远端遥测；
3. 凭据面裁决（是否投放 `settings.yaml` 中的模型配置）。
**注意**：去掉 netns 后，`unshare` 提供的「物理不可能外呼」这一层保障消失 ⇒ **遥测与凭据是两个必须由用户裁决、不得默认代决的开关**。

---

## 7. 阶段二工单档发现的**我自己的 Runbook 缺陷**（已修复）

工单档（`STAGE2-WORK-ORDER.md`）在汇编时实测发现：**Runbook §2.3/§4.2/§4.4 的插件复制源写的是 `~/.dsh/profiles/node_modules`（0.1.1 现役根），而不是已迁移件树。**
协调者独立复核确认：

| 插件 | 现役根 sha256 | 已迁移件 sha256 | 现役根真 import `installSettingsSection` | 迁移件 |
|---|---|---|---|---|
| `@local/dsh-ssh-gui` | `ccb51faf…` | `e060db97…` | **1** | **0** |
| `@local/dsh-workerspace` | `4362201d…` | `839116b3…` | **1** | **0** |
| `@local/dsh-wallpaper` | `05d42901…` | `068f94e7…` | 0 | 0 |
| `@local/dsh-btw` | `9634c6ea…` | `64435358…` | 0 | 0 |

⇒ **按原路径复制会把 `ssh-gui`/`workerspace` 退回未修状态，失败爆炸半径由 3 个插件扩大到 7 个。**

### 已修复
1. §0 新增 `MIGRATED` 变量，指向**已迁移件树**（`_audit/unified-assembly-20260929-121756/home/profiles/node_modules`）。
2. §2.3 备份段与 §4.4 组装段的 **4 处复制源**全部改为 `$MIGRATED`。
3. §4.5 的 `zod` 改为指向 **0.2.0 前缀自带那份（4.6.5）**，切断原先指向 0.1.1 前缀（4.6.2）的跨版本泄漏。
4. 新增 **§4.5b 来源闸门**（必须过）：打印三个插件的真 import 计数与 zod 版本。
   **实跑结果**：`dsh-ssh-gui 0` / `dsh-workerspace 0`（已迁移✅）、`dsh-subagent-model 1`（待改造，符合预期）、`zod: 4.6.5` ✅

### 另一条由工单档否掉的我方结论
`MIGRATION-ASSESSMENT` 的「客户端残留表」**漏登了 taste 的 1 处 `dsh-client-runtime`**；
且部署件里的该残留**全是注释、非 `require`**（wallpaper `client.js:17`、taste `client.js:185`）⇒ 影响面比表格所示更小。
