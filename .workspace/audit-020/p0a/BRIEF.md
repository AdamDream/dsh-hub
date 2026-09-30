# dsh-020 接手轮 · 执行档共享简报（协调者维护，v1 · 2026-09-30）

> 本文件是**所有执行档 subagent 的共同事实基线**。执行档只读本文件 + 自己工单里点名的路径，
> 不要凭记忆推断、不要重开已裁决事项。产出全部用中文。

## 0. 硬约束（违反即返工）

1. **只读源**：`/home/CNS2026495165/.dsh/**` 与 `/home/CNS2026495165/.dsh-017/**` **一律只读**。
   需要改的东西只允许改隔离根 `/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020/**`。
2. **不得停改任何实例**：`3080`（0.1.1 现役）、`3097`（0.1.7）、`3098`（0.2.0-rc.2，**本会话的宿主**）。
   **特别注意：不要 kill/restart 3098 —— 本会话就跑在它的进程里，重启会把会话本身杀掉。**
   若工单要求起验证实例，只能用 **端口 3099** 且必须是"同一条命令内起→curl→kill"。
3. **写入边界**：每个执行档**只能写自己工单里列出的路径**。越界写会与其他执行档冲突，一律返工。
4. **证据纪律**：
   - 结论必须来自**实跑命令输出**或**源码行号**；标注 `[实跑]` / `[源码]` / `[未验证]`。
   - **不得把"资料缺失"当"验证通过"**，也不得为了好看而重试到通过。
   - 失败就如实写失败，给出可复现命令。
5. **不重开**：`reports/DECISIONS-BEFORE-CUTOVER.md` 的 D1–D25 不得重开（唯一例外：D1 已被
   2026-09-30 用户裁决「尝试把历史全部迁到 0.2.0」取代，见交接件 §4）。

## 1. 隔离根布局（所有路径以 $A 代称）

```
$A = /home/CNS2026495165/dsh/.workspace/audit-020/assembly-020
$A/prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/          # 0.2.0-rc.2 CLI（真件）
$A/home/                                                       # 伪装 DSH_HOME
$A/home/profiles/web/cordis.patch.yml                          # profile patch（**协调者独占写入**）
$A/home/profiles/node_modules/                                 # 本地插件（@local/* 与手写 @deepseek-ai/*）
$A/home/skills/                                                # 用户级技能根（本轮新建）
$A/home/sessions/                                              # 会话根（本轮待填）
$A/home/attachments/v1/                                        # 附件存储（本轮待填）
$A/logs/                                                       # dump-config 等证据
```

0.2.0 官方件源码根（只读）：

```
$B = $A/prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai
```

## 2. 本轮已核实的关键事实（可直接引用，不必重查；要引用就照抄此处）

### 2.1 会话历史（P0-A）—— **N17 的根因已被本轮改写**

- 对象：`~/.dsh/sessions` = **2508 份 `.zstd` 日志 + 3 个 `session.lock`**，1.23 GB；
  工作区目录 20 个 + `_no-cwd`。头部版本：**v0 = 2505，v3 = 3**。
- 基线（0.2.0 真实 catalog 读打开，`recovery:'recoverable'`，`validation:'current'`）：
  **可读 229 / 2508 = 9.1%**，拒绝 2279。拒因只有两类：
  - `subagent/descriptor` 版本 2 → **2275 份**；
  - `agent/inbox/spliced` 的插件来源缺 `sections` 数组 → **4 份**（其余同因文件被上面那类先挡住）。
- **交接件 §2 P0-A 里说的"三种打包行 `text-chunks`/`reasoning-chunks`/`tool-call-chunks` 是第二道硬闸"不成立。**
  0.2.0 的 v0 codec **本来就支持**打包行：`$B/dsh-session-format-v0-to-v1/lib/index.js:1610-1614`（`PACKED_TAGS`）、
  `:1656-1690`（`scanRows` 的 packed 分支）、`:1796-1808`（`decodePackedRun`，`eventCount = payload.length`）、
  `:1809-1843`（`expandAssistantChunkRun` ⇒ 展开成 `assistant/chunk`）。语料里 349 份含打包行，其中多份在基线下就是可读的。
- **真正的第二道闸是"插件消息来源缺 `sections`"**，且它在 v0 里出现在**三处**消息位置：
  `user/message.data.source`、`agent/inbox/spliced.data.inserted[].source`、带 `message` 包装的 `[].message.source`。
  - 判定点：`$B/dsh-session-format-v0-to-v1/lib/index.js:942-947`（`form === "snapshot"` ⇒ `sections` 必须是数组）。
  - 为什么这是"写入侧既有形态"而非数据损坏：**emit 侧至今这么写**，且 0.1.1 与 0.2.0 的
    `dsh-taste/lib/learner.js` **逐字节相同**，`:219` 就是 `source: { kind: "plugin", plugin: "taste", form: "snapshot" }`（无 sections）。
  - 故修复取"最小结构补全"：`sections: []`（不新增任何内容），**不删字段、不改 `form`**。
- 转换器与证据（协调者产出，执行档只读）：
  - `$A/../p0a/census.py`、`p0a/scan.mjs`、`p0a/convert.mjs`
  - 只读预检全量：`p0a/recon/census.jsonl`（逐份类型直方图）、`p0a/recon/scan-before.jsonl`（基线）
  - 语料副本（**转换输入，只读**）：`p0a/corpus/sessions/`、`p0a/corpus/attachments/`
  - 转换产物（**本轮验证对象**）：`p0a/converted/sessions/`、`p0a/recon/convert-report.jsonl`
- **注意**：`session.lock`（0 字节）按字节复制，不重建、不删除（依据 T21 §3.6）。
- **注意**：新根**只能有 `.zstd`**，不得混入未压缩 `.jsonl`，否则整根被判 `legacyLayout` 拒绝
  （`$B/dsh-session-persistence-jsonl/lib/index.js:3429-3455`）。

### 2.2 两个"模型路由插件"的 settings 页不可用（用户点名）

- 现象：设置页显示「设置命名空间未注册（…插件未加载？）」。
- 真因（协调者已定案）：**0.2.0 的设置面只暴露 `.volatile()` 字段**。
  - `$B/dsh-settings/README.md:12,33`：*"Forms expose only volatile fields from active, uniquely addressed profile entries."*
  - `$B/dsh-settings/lib/index.js:418-419`：`volatileForm(schema) === undefined` ⇒ **整条条目被跳过**，不进入 served 命名空间。
  - `$B/dsh-settings/lib/index.js:505-506`：写入还会直接抛 `Plugin entry "<ns>" has no volatile fields`。
  - 客户端 `configForms.get(ns)` 在命名空间不在 view 里时把快照置 `status:"unavailable"`
    （`$B/dsh-client-ui-settings/lib/client.js:1226-1233`），正是用户看到的那句话。
- 协调者已改（**执行档只复核，不要改**）：
  - `$A/home/profiles/node_modules/@local/dsh-subagent-model/lib/index.js`：`provider` / `model` 加 `.volatile()`；`apply()` 增加 void 引用解包。
  - `$A/home/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js`：`apiKeyEnv` / `baseURL` / `model` / `maxTokens` 加 `.volatile()`；`current()` 增加 `plainConfigOf` 解包。
  - 备份：`.workspace/audit-020/volatile-fix-backup/`
- 同形官方参考：`$B/dsh-agent-default-model/lib/index.js:21-25`；
  本机先例：`$A/home/profiles/node_modules/@local/dsh-wallpaper/lib/index.js:110-117`（上一轮已按同规则修好）。

### 2.3 技能迁移现状

- 已完成（协调者）：把 `~/.dsh/skills/{grill-me,ppt-master,program-notebook,session-handoff}`
  复制到 `$A/home/skills/`。**实跑证据**：本轮会话的技能目录当场从 2 条变为 5 条
  （`ppt-master`、`ppt-template-fidelity`、`program-notebook`、`session-handoff`、`workbuddy-ppt`；
  `grill-me` 因 `disable-model-invocation: true` 故不在模型目录里，属预期）。
- 同时补齐：`$A/home/wallpapers/`（壁纸本体）、`$A/home/taste/`（taste 状态）。
- `ppt-design-systems`（`@local/dsh-pptmaster` 的第三个 provider）**不是迁移丢失**：
  它只在 `config.pptDesignSystemRoot` / 环境变量 `DSH_PPT_DESIGN_SYSTEM_ROOT` 存在时注册
  （`$A/home/profiles/node_modules/@local/dsh-pptmaster/lib/index.js:82013-82014`），
  而本机从未设置过（`~/.dsh-017/office-ppt` 为空目录），profile patch 给的是 `root:`（OfficePptStore 用），
  不是 `pptDesignSystemRoot:`。**要在报告里如实区分"迁移丢失"与"从未启用"。**

### 2.4 settings 段投放（P0-B，协调者已做）

现役 `~/.dsh/settings.yaml` 共 12 段，其中需要保留的 9 段（D14）现已在 profile patch 里就位。
本轮新增投放的三段（原值照抄现役）：

| 条目 id | 投放位置 | 取值来源 |
|---|---|---|
| `vision-adam` | `cordis.patch.yml` 顶部 insert 的 `config` | 现役 `settings.yaml` 的 `vision-adam` 段原值 |
| `wallpaper` | 同上 | 现役 `wallpaper` 段原值 + `$A/home/wallpapers/` 本体 |
| `ssh-gui` | 同上 | 现役 `dsh-ssh-gui` 段原值 |

## 3. 交付纪律

- 报告正文放在自己的写入边界内；**不要**改 `reports/` 下别人已写的文件。
- 每份报告开头写：`工单号 / 状态（完成|部分|受阻）/ 实跑命令 / 证据路径`。
- 结尾必须写「未验证项」与「结论强度」，不得用"应该/大概"包装成结论。
- 完成后回报：一段 ≤200 字的摘要 + 关键数字 + 失败清单 + 你**没有**做的事。
