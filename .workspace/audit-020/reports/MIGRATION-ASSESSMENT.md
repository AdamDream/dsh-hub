# DSH 0.2.0 迁移评估报告（协调者裁决版）

- 采样时刻：2026-09-29（本轮全部实测）
- 仓库根：`/home/CNS2026495165/dsh`
- 现役（**全程未触碰**）：`3080` = DSH `0.1.1-rc.2`
- 隔离旧目标：`3097` = DSH `0.1.7-rc.2`
- **迁移目标：`@deepseek-ai/dsh@0.2.0-rc.1`**

---

## 0. 一句话结论

**0.2.0 这个升级比交接件预设的 0.1.7 迁移小得多，且已在隔离组合内实测跑通。**
权威依据：**`@deepseek-ai/dsh` 的整个 `lib/**` 在 0.1.1-rc.2 / 0.1.7-rc.2 / 0.2.0-rc.1 三版逐字节相同**；
在 280 个官方包里 **225 个 `lib/` 代码逐字节相同，仅 55 个有真实代码改动**。
迁移面被压缩为 **4 类共 9 条**改动（见 §4），其中 **只有 2 条需要改代码**。

---

## 1. 目标版本裁定

| 项 | 实测值 |
|---|---|
| npm `dist-tags` | `latest=0.1.7-rc.2`、**`next=0.2.0-rc.1`**、`alpha=0.1.7-alpha.2` |
| **是否存在稳定 0.2.0** | **不存在**。0.2.0-rc.1 是 0.2.0 系列首发 RC |
| GitHub releases 最新项 | `dsh-v0.2.0-rc.1`，published `2026-09-28T12:36:21Z` |
| 0.2.0-rc.1 tarball sha256 | `ceb66bebe8117044e05f6932deaca15daea6a1ae1d0cffad079e33895f10d216` |
| 闭包包数 | 0.1.7 为 503 → 0.2.0 为 **530**（`-g` 安装实测 546 包 / 521–540 MB / 5–23 s） |

> **裁定**：目标只能锁 `0.2.0-rc.1`。若上游发布稳定 `0.2.0`，下方 Runbook 的 `VERSION` 变量可直接替换，其余不变。

---

## 2. 颠覆性事实：CLI 引导层零变化

`@deepseek-ai/dsh` 的 `lib/**` 共 15 个文件，在 **0.1.1-rc.2 / 0.1.7-rc.2 / 0.2.0-rc.1** 三个版本间 **sha256 全部相同**
（证据：`.workspace/audit-020/h-011-cli.txt`、`h-017-cli.txt`、`h-020-cli.txt`）。

⇒ 迁移的全部差异都在**依赖包集合**，不在 profile 引导、plugin 管理、`dump-config` 等 CLI 代码。
⇒ 交接件中关于 0.1.7 的「引导层适配」工作量在 0.2.0 上**为 0**（T02 独立同结论）。

---

## 3. 真实改动面（代码级，非版本号级）

对 `lib/` 逐文件 sha256 对比（工具 `.workspace/audit-020/churn-lib.mjs`，原始数据 `churn-lib-017-020.txt`）：

- **225 / 280 个包 `lib/` 代码逐字节相同**；**55 个包有真实代码改动**。
  > T01 用独立方法（两棵真实安装树逐文件字节比对、限定 `lib/**`）复算出**恰好 55**，包名集合与本表双向差集均为空 ⇒ 该数字已交叉验证。
- ⚠️ **`churn%` 百分比列不可用作「改动强度」**：其分母口径有偏差（例：`dsh-client-ui-sidebar` 记 25% 而真实只差 2/8 文件；`dsh-agent-preset` 记 33.3% 而 `lib/` **零改动**）。
  **可靠的是「changed 包名单」本身**；百分比仅作相对排序参考，不得单独引用。
- **55 个改动包的语义三分类（T01 机器判定 + 导出面/签名/schema 扫描）**：**改契约 7~8 个**、**加功能约 24 个**、**修 bug/加固约 20 个**、**重构/职责外移约 4 个**。
- **对外可见的契约变更只有 6 个包**，且**除 2 处外全部为加性**：
  | 包 | 变更 | 性质 |
  |---|---|---|
  | `dsh-session-telemetry-otel` | 注入新增 `otel` 依赖 + 新增 `maxRequestBytes` | 加性/需挂载 |
  | `dsh-web-search-deepseek` | 新增 `resolveAccountToken` / `x-dsh-auth-token` | 加性 |
  | `dsh-session` | 新增导出 `ToolCallRecovery` | 加性 |
  | `dsh-sandbox-windows-acl` | 新增 `ACL_DIAGNOSIS_SKILL` / `registerAclDiagnosisSkill` | 加性 |
  | `dsh-client-ui-primitives` | 新增 `pointerModality` | 加性 |
  | `libreoffice-kit` | 新增 `ENGINE_VERSIONS` | 加性 |
  | **`dsh-session-log-deepseek`** | **`enabled` 变 `volatile`、`maxBytes` 变必填** | **非加性（但有 default）** |
  | **`dsh-llm-deepseek`** | **`remove`/`invalidate` 位置参数改数组** | **非加性（签名）** |
- **绝对禁止的误判**：`exports` 映射在 55 个改动包中**只有 1 个变化**且是**纯新增**（`dsh-client-ui-schedule` 增 `./locale/*.json`），**0 个子路径被删**；入口导出名 **0 个被移除**。
- **与本机定制强相关但零代码改动的包**：`dsh-tool-subagent`、`dsh-settings`、`dsh-skill`/`dsh-skill-filesystem`/`dsh-skill-office`、`dsh-home-paths`、`dsh-tool-fs`、`dsh-client-modules`、`dsh-plugin-manager`、`dsh-client-ui-cordis`、**`dsh-agent-preset`（`lib/` 零改动；其 6 个 modified 是 README×3 + 2 份 skills 文档，2 added 为新增 `agent-experience` 技能目录）**、`dsh-session-query`/`-projection`、`dsh-web-app`、`dsh-persona`、`dsh-plan-mode`、全部 `dsh-tool-*`、`dsh-compaction-*`、`dsh-skill-filesystem`。
  ⇒ **权威机制：一个契约点只要落在「`lib/` 哈希全等」的包上，就必然未变**，无需逐条读源码。T13 已独立复算确认自建 preset 引用的 **21 个包全部 `lib/` 零改动**。
- **口径陷阱（两处，必须遵守）**：
  1. **唯一可靠口径是 `lib/`**。整包 `modified` 未必是 `package.json`（`dsh-agent-preset` 的 6 个 modified 全在 `lib/` 之外），也未必是行为改动（`dsh-subagent` 的 `lib/typert.host.js` 是 `dsh-typert-generator` 生成物，两侧各仅 2 行差异 = `SessionEventMap` 成员**声明顺序**不同；`dsh-tool-subagent`/`dsh-session-reference`/`dsh-client-file-upload` 的 `typert.host.js` 同属此类）。
  2. **两树皆不存在的包，churn 口径会给出误导性的「零改动」**（例：`dsh-workflow-worker-thread` 在两树皆无、从未被比较；正确表述是「`0.1.5-rc.3` 后停发，0.1.7 时点已消失」）。引用 churn 结果时必须先确认该包**两树都存在**。
- **`dsh-client-ui-chat` 为真改动**（94 文件中 2 added / 7 modified）：官方 release note 的「调整工作过程展示默认值」落在此包，定量为 **Web/非桌面 `standard → detailed`、桌面显式钉 `standard`**。它影响会话渲染默认细节级别（**进而影响模型可见上下文**），但**不影响 preset / subagent 路由语义**。

### 3.1 契约回归结论（T01 四条独立实测，**这是本次迁移最重要的单项结论**）
> **不存在会破坏本机 9 个本地插件或既有 settings / patch 的破坏性契约变更。**

| 检验 | 方法 | 结果 |
|---|---|---|
| E1 导入面 | 提取 9 个插件的全部 `import {...} from '@deepseek-ai/*'`（**54 模块 / 71 命名导入**），双树逐一解析导出名 | **REGRESSIONS = 0**（`REMOVED-IN-020 = 0`、`MODULE-GONE-IN-020 = 0`）；53 项 ok，18 项属「两树都不存在」的**既有**状况，与 0.2.0 无关 |
| E2 `exports` 映射 | 55 个改动包 | 仅 1 个变化且为**纯新增**；**0 子路径被删** |
| E3 入口导出名 | 全包 | **0 个导出被移除**；仅 4 个包**纯新增** |
| E4 settings | 存储层 + 12 个命名空间逐段核对 | `dsh-settings` 全树仅版本串不同（**存储层零变化**）；`llm-pi-ai`/`dsh-subagent` schema **逐字节相同**；两个「新必填」字段实测**都带 default**（`maxBytes` `default(8*1024*1024)`、`promptTailGraceMs` `default(0)`）⇒ **无升级后校验失败风险** |

### 依赖集合差异
- 伞包直接依赖 81 → 82，**新增 `@deepseek-ai/dsh-experimental-schedule-bundle`**（唯一依赖边新增）。
- 闭包新增 `@deepseek-ai/*` 5 个：`dsh-otel`、`dsh-host-product-telemetry-otel`、`dsh-client-product-analytics`、`dsh-client-ui-settings-session-log`、`dsh-experimental-schedule-bundle`。
- 移除 `@opentelemetry/exporter-logs-otlp-http@0.220.0`；新增第三方 HTTP 栈 `got@14.6.6` + 19 个传递依赖。

> **勘误（三轨独立互证）**：`dsh-skill-office`、`dsh-tool-subagent-control`、`dsh-workflow-ptc` **在 0.1.7-rc.2 已存在**，**不是** 0.2.0 新增包。`MEASURED-BASELINE.md` §3 早期记述与 `PLAN.md` 均已按此更正。

---

## 4. 迁移面总清单（9 条，权威）

### A. 组合层（3 条，patch/config）
| # | 内容 | 依据 |
|---|---|---|
| A1 | `session-telemetry-otel` 新增必挂的 `id: otel`（`@deepseek-ai/dsh-otel`）行；**自建 composition 漏挂会加载失败而非静默降级** | T01 |
| A2 | 遥测端点默认值变更：`harness-telemetry.deepseeksvc.com` → **`dsh-otel-collector.deepseeksvc.com`**；新增 `maxRequestBytes` | `--dump-config` 实测 |
| A3 | Web 组合 **3 撤 3 增**：删 `time-context`、`schedule`、`ui-schedule`（自动化任务降级为可选 bundle）；增 `otel`、`desktop-product-telemetry`（desktop 门控）、`product-analytics`（desktop 门控）、`ui-settings-session-log`（**Web 无条件启用**） | T01 + `--dump-config` diff |

> **已验证**：现役与 0.1.7 两份 patch 层**都未**引用被删的 `time-context`/`schedule`/`ui-schedule` id（grep no matches）⇒ **无静默失效**。
> 副作用：脚本化「自动化任务」升级后默认不可见，需手动启用。

### B. 插件面（3 条，**其中 1 条要改代码**）
| # | 内容 | 状态 |
|---|---|---|
| B1 | **0.2.0 运行时 peer 闸门会静默禁用本地插件**（`dsh-app-boot` 的 `evaluatePluginCompatibility`，0.1.7 已存在，因内核版本跨过插件的 `<0.2.0` 上界而整体翻转） | **已解决**：写 `<profile>/compatibility.json` 精确版本豁免，实测 `disabling` 由 6 条 → **0 条** |
| B2 | 3 个插件代码级坏在 settings API 断层 | **未解决，须改代码**（见 §5） |
| B3 | 组装须显式提供 `zod`（`@local/dsh-btw` 依赖；现役 profile 有，新组合顶层没有） | 已解决（软链 `zod`） |

### C. 数据面（2 条）
| # | 内容 | 依据 |
|---|---|---|
| C1 | **会话格式未升代**：两版 `SESSION_FORMAT_VERSION = 4`；`dsh-session-format`/`-catalog`/`-persistence-jsonl`/`v0-to-v1`/`v3-to-v4` 五包 `lib/**/*.js` 逐字节相同 ⇒ **会话数据迁移为 no-op** | T29 + churn + T07（0.2.0 链逐字节复现冻结工件） |
| C2 | `settings.yaml` 在 0.1.7+ 只被读一次随即 `rename` 成 `settings.yaml.imported`；0.2.0 中 **settings 命名空间 = profile 插件条目 id**，不再使用 YAML 段名；未知段/未知 target **一律 warn + skip，从不报错**（静默丢失） | T03 + T13 |

### C1 补强（T12 实测，**决定验收判据**）
1. **「能不能恢复」的门槛不在投影链，而在「格式迁移链是否放行」+ 是哪个入口在打开日志。**
   `ctx.sessions` 按设计**没有** resume/reopen/load，唯一公开恢复入口是 `ctx.agents.resume()`；
   后端 `open(id, access)` 两分支行为**完全不同**：`read` 分支**不**做 `claimWrite`/`acquireLease`/`publishStoredMigration`，
   只有 **`write`** 分支才走 claim→lease→`publishStoredMigration`。
   ⇒ **0.2.0 对 v0/v3 老日志的「迁移 + 发布 v4 继任代」只在 agent 级 write open 时发生**；
   **用 `open(id,'read')` 读通不能当作「老会话可冷恢复」**（这正是历史误判 D-01 的机理）。
2. **resume 会 durable 写回**（尾部修复合成事件）⇒ **「resume 后日志字节不变」是错的断言**；
   正确断言是「**源代**字节不变」。
3. **迁移链在本机全部 2455 份 v0 老日志上零拒签项**：按 zstd **帧**逐帧解码（1 459 185 帧）实测，
   42 种事件类型中**清单外且非打包行标签的类型 = 0**；唯一不在清单内的两种**只出现在 v3、v0 中 0 次**。
   所有「疑似拒签」结构都有确定的消费/改名边 ⇒ **判定：需迁移（自动、一次性、源代不可变），无「会失败」项。**
4. **本机已有真实工件证明 write-open 迁移 + 继任代发布跑通**：0.1.7 根存在 8 个 v4 代，其中 **2 个目录同时含 v3 与 v4 两代**
   （源代 mtime 09-12 < 继任代 09-28，552482→553032 B），`session.lock` 恰 8 个。
5. **投影缓存跨格式代按设计作废**（缓存身份含 `formatVersion`，身份闸门要求 `===`）⇒ 后果是**列表/统计首屏变慢（全量冷重放），不是数据错误**；本对版本间 `stateVersion` 无一变更 ⇒ 无「旧语义被误用」的反向风险。
6. **子代理关系是本变更里唯一有硬条件的迁移路径**：v3→v4 不读父日志，而是从**同根内可识别的直接子会话**收集证据，`createStage()` 无显式 child 事实集即报错。
   有利面：本机 2225 条 `subagent/descriptor` **全部 `version:2`**，而白名单是 `[1,2,3]` ⇒ 0.1.1 时代的子关系**具备被自动补建资格**；`count!==1` 时**降级而非失败**。
7. **taste / btw 不在会话日志内**（sidecar：`<DSH_HOME>/taste/`、`<DSH_HOME>/btw/index.json`，两处 `session.append` 均零命中）
   ⇒ 与会话迁移**完全解耦**，但**不受任何会话备份覆盖** ⇒ **迁 `DSH_HOME` 必须单独携带这两棵 sidecar 树**。

### ⚠️ 两条方法学陷阱（会影响任何引用相应编号的结论）
1. **`src-017` / `src-020` 都是不完整解包，不等于「包被移除」**：`src-017` 缺 `dsh-session-checkpoint-policy`/`-reference`/`-projection-cache`（改用 0.1.7 全量安装树后，前两者与 0.2.0 **逐字节相同** ⇒ 照原基线会得出「0.2.0 新增两包」的**假结论**）；`src-020` 还在审计期间被动态增包（45→49）。
   ⇒ 凡以解包样本做「新增/移除包」判定的结论**必须复核**。**本报告的结论全部基于完整安装树，不受此影响。**
2. **读会话日志必须按 zstd 帧逐帧解码**：日志是帧拼接（单文件实测 880 帧），而 `zstdDecompressSync(整文件)` **只解第一帧**（表头约 200 B）——对 12 MB 日志会**静默给出 190 B**。

### D. 安全/纪律面（1 条）
| # | 内容 | 依据 |
|---|---|---|
| D1 | 0.2.0 新增**默认远端遥测外呼**（`endpoint` 硬编码 collector、无 `enabled` 开关） | 见 §5「零外呼」 |

### E. 两条「更安静」的启动语义变化（T06 实测，**改变验收判据**）
| # | 内容 | 影响 |
|---|---|---|
| E1 | 插件兼容性 preflight 对 peer 冲突的行**静默加 `disabled: true`**，仅在 **stderr** 打一行 | GUI 无任何提示 ⇒ **「能启动」不再是迁移通过判据**；必须捕获 stderr 并 `grep disabling` |
| E2 | boot 末尾的 `assertEntriesActivated`（任一 enabled 行未激活即抛错）被换成**非致命的 `auditStartupEntries`**，只有 bootstrap include 与 `{agent-loop, webserver, modules}` 致命 | 插件整批不激活**也不再导致启动失败** ⇒ 必须显式核对插件清单，不能靠「起来了」判定 |

> 两条叠加的后果：**0.2.0 上「服务起来了」与「你的定制生效了」彻底脱钩**。验收必须外部化（见 RUNBOOK §7.2 / §11）。

### F. patch 层草案（T06 交付，可直接采纳）
- 产物：`reports/T06-proposed-cordis.patch.020.yml`（537 行，**16 条生效条目**，经同一 `applyEntryPatches` 算法解析验证：0 warning / 190 行 / 190 id）。
- 处置：**保留 15 条 / 改造 9 条 / 条件 1 条 / 退役 2 条**。
- 两个必须知道的语义细节：
  1. **`config` 是「整体替换」而非「深合并」** ⇒ 覆盖某行时必须**复述该行全部键**（草案已为 `web-search-deepseek` 补回 `apiKeyEnv`）。
  2. `preset-standard-glm` 应以 **0.2.0 官方 `standard` 的 19 行**为基线（0.1.7 层只有 16 行，缺 `present`/`command-goal`/`tool-plugin-manager`），`order` 取 **5** 以避开与官方 `ptc=2` 并列。
- 语义型静默失效（1 条）：`@local/dsh-subagent-model` 的**消费侧是本地改造过的 `dsh-tool-subagent`**（现役安装体 695 行 vs 官方 pristine 0.1.1 的 296 行；0.1.7/0.2.0 官方包均**无读取点**）⇒ 在全新 0.2.0 上单装该插件只会得到一个**无人消费的设置页**；T06 建议**退役**，改由 preset 的 `agentOptions` 钉死子代理路由（与 N2 的降级方案 B 一致）。

---

## 5. 未闭门禁（**不得包装为通过**）

### N1（阻塞级）3 个插件须改代码：settings API 断层
- 失败插件：`@local/dsh-subagent-model`、`@deepseek-ai/dsh-session-board`、`@deepseek-ai/dsh-vision-adam`
- 真因：`installSettingsSection` / `settingsNamespace` **在 0.1.1 存在，在 0.1.7 与 0.2.0 均已删除**（`dsh-settings` 两版逐字节相同）。
- **这不是 0.2.0 引入的，是上一轮 0.1.7 迁移的未闭缺口。**
- 证据：`.workspace/audit-020/reports/PLUGIN-MATRIX.md`（两版对照矩阵）+ 导出面实测（0.1.1 有 7 个导出；0.1.7/0.2.0 仅剩 `SettingsConflictError, SettingsForms, default, redactSecrets`）。
- **修法参考已就绪**：`@local/dsh-ssh-gui`、`dsh-wallpaper`、`dsh-workerspace` 三个插件**已完成同一改造**（其源码中保留「0.1.7 已无 `installSettingsSection`，改用 `liveConfig()`/`cfg()`」的注释），可作样板。

### N2（阻塞级）本地模型路由定制需重新施加宿主补丁
- 现役 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js` 含 **73 行本地补丁**（`effectiveConfiguredAgentOptions()`，`lib/index.js:119-136`，读取点 `:123` = `settings.get("dsh-subagent")`，派发处 `:530` 调用；**现役副本 sha256 `65288049…`，上游两树同为 `26a1e804…`**）。
- **精确口径（T13 独立复算，必须按此表述）**：
  - 「上游 `dsh-tool-subagent` 的 `lib/` 在 0.1.7→0.2.0 未变」= **【H】哈希依据成立**；
  - 「subagent 派发读取 settings 段的宿主逻辑未变」= **不成立**。该逻辑在**上游两侧树里都不存在**（对两树 grep `settings.get` / `effectiveConfiguredAgentOptions` **均 0 命中**）⇒ 「settings 段优先」**本就是现役部署的本地补丁，不是上游能力**【R】。
  - **不得把后者并入前者**，否则迁移排期会漏掉「补丁重打」这一必做项。
- 0.2.0 为全新安装，**补丁不会被继承**；不重新施加则行为退化为「改模型 = 重开会话」（降级方案 B = 只改 preset 静态 `agentOptions`，零宿主补丁）。
- 且 settings 命名空间机制已变（见 C2），配套数据迁移必做（需重写插件两端：宿主半 + 客户端半，客户端 `settingsScope` 服务在 0.1.7 全树 0 命中）。

### N3（需裁决）agent preset
- 第 1 层：`~/.dsh/.agent-presets/standard-glm/agent.cordis.yml` 用 `config.text:`，而 `dsh-persona` 的 Config 是 `{prefix(required), suffix, complete, includeRuntimeContext}` ⇒ **不改则 preset 直接激活失败**。
- 第 2 层：preset 注册表行 id 在 0.1.1 为 `agent-presets`、**自 0.1.7 起改名 `agent-preset-registry`**；现役 `~/.dsh/profiles/web/cordis.patch.yml` 用旧 id ⇒ 迁移后该条**静默不命中**，`default: standard-glm` 失效回落官方 `standard`（技能面无损，损失子代理模型固定）。**隔离根 `~/.dsh-017` 的 patch 已是修正版。**
- 第 3 层：`:230-231` 引用 `@deepseek-ai/dsh-workflow-worker-thread`（最后版本 0.1.5-rc.3，0.1.7/0.2.0 树内均无），须换 `dsh-workflow-ptc`。

### N4（纪律）零外呼不能只靠 `unshare`
- 0.2.0 新增 `dsh-host-product-telemetry-otel`，`endpoint` 默认硬编码 collector URL，**无 `enabled` 开关**，且「卸载时 drain」⇒ **停实例动作本身是潜在外呼时点**。
- **可用开关（本轮实测）**：`DSH_TELEMETRY_MODE` 接受 **`DISABLED`** 与 `FEEDBACK_ONLY`（默认 `FEEDBACK_ONLY`）。
- `desktop-product-telemetry` / `product-analytics` 两行 `disabled: profileContext?.name !== 'desktop'` ⇒ **web profile 下不挂载**。

### N5（未验证）`--dump-config-schema` 恒 exit 1
- 两版**都** `complete=false` + 6 条 diagnostic + **必然 exit 1**（自带 web profile 既有状况）。
- ⇒ **不得**把该命令的退出码当作「配置可校验 / 启动失败」判据。

### N6（未验证）其余
- A 的引用有效性（附件对象未验）；宿主层 S-4「按最高代选代、不校验内容包含」机制已证、未修；`dsh-skill-office` 与全部 `dsh-experimental-*` **未被任何 bundle 挂载**（休眠包）；`office-to-pdf` 是「迁到 0.2.0 才新增」的官方能力。

### N10（阻塞级）`dsh-workspace-enhancement` 是 provider 契约级返工，**不是配置升级**
T24 逐条核验 **75 条契约点**：存在 52 / **签名变化 17** / **消失 5** / 未判定 1 ⇒ **不兼容 22 条**，拆出 **19 个改造单元（U01–U19）**。
- **`ctx.settings.get()` 在 0.2.0 被彻底删除**（`dsh-settings/lib/types/index.d.ts:27` 现为 `SettingsForms`，成员仅 `configure/describe/update/replace/mutate`；旧 `get(ns)` 在旧版 `:239`）。
  插件宿主侧 `locale/host.ts:61` 的 `settings?.get('locale')?.preference` **只护「服务缺失」不护「方法缺失」**，而 0.2.0 的 settings 行仅在缺 `profileContext` 时才禁用（正常 profile 必启用）
  ⇒ **9 个运行时调用点 / 6 个文件必然抛 TypeError**（RPC 错误文案、工具描述、注册表标签、工作区标签）。改造路径 = 改走 `describe()`（U12）。
- **三处「新增抽象方法」直接 TypeError**：`SubprocessRuntime.terminalEnvironment`、`SubprocessTerminalHandle.resize`/`inspectActivity`、`FileSystem.readByteRange`（且 `watch` 新基类实现即 reject）。
  0.2.0 官方消费者**确实在调**（`dsh-api-terminal-controller`、`dsh-api-workspace-files`）⇒ **远程会话 web 终端与远程文件预览/下载直接崩**（U01–U05、U07–U09）。
- **`ctx.connection.rpc.handle()` 由 3 参降为 2 参**，`options.authority:'loopback'` 参数被删除，handler 另加第 4 参 `peer: PeerScope`
  ⇒ 插件传的第 3 参被 **JS 静默忽略**，`/dsw` 通道原有的 **loopback 信任约束静默失效、不报错不告警**（U10；验收记录必须写明约束新归属，否则不予通过）。
- **修正一处基线**：该插件**不是 insert-only** —— 现役 patch `:79-80` 明确 `disabled: true` 禁用了插件自己的 `directory-picker-ssh` 行（另 `:72-73` 禁用官方 `directory-picker`）以免重复注册（U19）。
- **需裁决**：私有依赖岛去留。方案 B（丢弃旧岛、宿主包改 `peerDependencies`、facade 改为「读取官方已挂载 provider 再包一层」）可把 U08/U09 退化为一行转发、恢复官方新增能力；方案 A（保留旧岛）工作量约 2 倍且**无法通过类型检查**。**T24 建议 B。**

### N11（阻塞级）办公入口在 0.2.0 上完全不可用，**断点同样在 0.1.7**
T23：`~/.dsh/office-handoff/` 属**本地自研独立 CLI 接收器** `dsh-office-handoff@0.1.0`（零插件 Route A；源码 `workbuddy-reverse-proxy/office-handoff/`），**不是** DSH 插件、不是官方包、不是 skill。三处独立破坏：
1. **最先触发：`/api` 自 0.1.7 起变为浏览器 cookie 鉴权门** —— 无 cookie 即 **401**，且 **`Config` 无任何开关可关**；接收器刻意只发 `content-type` ⇒ 每次请求在进路由前就被拒。（0.1.1 该文件 `browserAuth` 命中数为 0 ——这正是它当年通过验收的原因。）
2. **端点命名由点号改斜杠**（`namespace/method`），且 **`workspace.list` 在 0.1.7/0.2.0 已不存在**；未认领的 `/api/*` 一律 404。
3. **锁标记陈旧**：标记记录的是 0.1.1 的 `dsh-atomic-write`（`da4f2c9f…`，实测与磁盘一致 ⇒ **今天仍有效**），而 0.1.7/0.2.0 的是 `5f07978e…`；原地覆盖/移除该路径会抛 `lock-module-changed`、退出码 10、**明令不降级**。
- **失效是 fail-safe 的**：`probe()` 先跑，失败即「只入 spool + 桌面通知 + 退出码 9，零复制零登记」，**无中间态、无数据损坏**。
- **迁移要点**：必须**重录锁标记**，且 `install.sh` 前必须显式设 `DSH_OFFICE_HANDOFF_ATOMIC_WRITE=<0.2.0 路径>`（`lockStatus()` 优先级 env > 记录 > PATH；不设 env 会把 0.1.1 旧指针原样再记一遍 = 等于没修）。
- **`journal.secret`**：保留 journal 则必须与 `journal/` 一起迁移（同目录、`0600`、长度须恰 **32 字节**、属主 == euid、父目录 `0700`；**不可重建**，重建会让既有记录 seal 全部失效）。**但版本升级本身不需要迁数据**（状态根由 `$DSH_HOME` 决定，与 DSH 版本无耦合）。
- **需裁决**：「零插件 Route A」在 0.1.7+ **结构性不再成立**。T23 给出 A/B/C/D 四个选项，其中「读凭据存储自签 cookie」会让接收器变成 cookie 伪造器、与其既有设计纪律冲突；Route B（host 侧插件）是**裁决重开**（`docs/architecture/office-handoff.md` §1 记载 Route B 曾被明确否决）。

### N12（须做）taste 图标缺陷与**语言基线更正**
- **图标缺陷真实存在，但归因修正**：5 个 `Icon*Outline16` 断点在 **0.1.1→0.1.7**，**不是 0.1.7→0.2.0**。
  0.1.1 有全部 5 个；**0.1.7 与 0.2.0 各有 0 个**，且两版 `Icon*` 名字集合**逐名差异为 0**。
  替代品 `Icon{Trash,Personalization,Refresh,Settings,Close}OutlineRegular|Medium` 在 **0.1.7/0.2.0 均存在**且签名与 0.1.7 逐字节相同（仍接受 `size`）⇒ **只改 5 处标识符即可，无需动参数**。
  ⇒ 推论：**0.1.7 隔离实例（3097）上的 taste 侧边栏入口按钮自 0.1.7 起就已崩溃**（`TasteTrigger` 常驻渲染，图标为 `undefined`）。
  **本轮已在 0.2.0 组合内修好**（见下）。
- **语言基线更正（与我此前记录的偏好相反，必须纠正）**：现网 `~/.dsh/taste/taste.md` 与 `~/.dsh-017/taste/taste.md` **已是中文单轨** —— 本轮实测 `17002 B / 61 行 / 4482 CJK` 与 `16163 B / 58 行 / 4241 CJK`；
  英文展示层 sidecar `display.zh.json` **已退役为空对象 `{}`**（3 字节），且**运行时无任何代码读取它**。
  taste **从未有**「把英文条目译成中文显示」的运行时逻辑 —— locale 词典（49 键 zh/en）**只翻 UI 骨架文案**，条目正文与真实分类名**逐字原样直显**。
  ⇒ **若按「保持英文」规划，会把现有 48 条中文条目误判为数据污染并触发错误回译。**

### N13（工具链，须做）guard 工具链前向兼容：9 复用 / 13 改造 / 6 已失效
- **决定性好消息（强证据）**：0.2.0-rc.1 的已发布链**逐字节复现**冻结的「官方链修复 v3」工件 —— A/B/C 三件 sha256 与冻结件**完全相同**（`612ec813…`/`8025135e…`/`195222ce…`，`cmp` IDENTICAL）。
  佐以 `SESSION_FORMAT_VERSION` 两版同为 4、`dsh-session-format*` 六包 `lib/` diff = 0、`known-event-types.js` 逐字节相同
  ⇒ **最省姿势是「同样本 + 0.2.0 链」零改造复跑**，不是重造或重冻结。
- **必须改的硬编码**：`lib/dbfold.mjs:18,24` 把口径来源插件**写死为现役 0.1.1 绝对路径**且是模块顶层 `await import()` ⇒ 0.2.0 下会**静默测错对象**（测的是 0.1.1 落库语义）。最小改造 = 一个 env 覆盖。
- **工具链从未验过 v4，而 0.2.0 产的就是 v4**：`~/.dsh-017/sessions` 已有 **8 个 `session.v4.jsonl.zstd`**，而工具链样本只有 v0+v3，且 **16 行代码（24 处字面量）**把「高代」写死为 `session.v3.jsonl.zstd` / `generation: 3`；`header-contract.mjs` 对 v4 工件**实测直接判红**（`version-not-3`，exit 2）。
  白名单侧：`expected.mjs` 条目**不携带机制依据**（A329 仍未落实 `mechanism` 字段）、匹配禁通配（严格 index+type 全等）、`declaresNoDifference` 恒 false；新样本下须**整份重冻结**，并在 `select.mjs` 新增机制类 `stale-generation-id-remint`（判据已给出、仍禁 glob）。
- **⚠️ N-1 静默安全缺口（必踩）**：`run-p7-restore-drill.mjs` 的 `FORBIDDEN_PREFIXES` 与真实库清单**全部由 `$HOME` 派生**，且只列到 `~/.dsh`/`~/.dsh-017`/`~/.npm-global*` —— **没有 `~/.dsh-020`（也没有工作区内隔离根）**。
  实测：`HOME=<伪 home>` 跑时，真实库断言**整段消失**，退出码**仍为 0（PASS）**。而 0.2.0 隔离迁移的天然姿势就是改 `HOME` ⇒ **必踩**。修法：把隔离根**追加**进 `FORBIDDEN_PREFIXES`，并对「断言条数为 0」显式判 FAIL。
- 其余附带发现：`expected.mjs` 的 `kind`/`bytesDelta`/`timeDelta` **从未被任何断言读取**（只比 index+type）⇒ 机制注释可静默漂移；`run-all.sh` **只编排 5 步**，`run-p7-restore-drill.mjs` 与 `run-a329-attribution.mjs` **不在其内** ⇒ 只看 `ALL GREEN` 会漏掉「预映像可恢复」与「A329 机制复算」。
- **口径纪律**：历史 seal **是「迁移副本 seal」而非部署件** —— guard `4c159098…` = `_migration/usage-v4-017/lib/ingest-dsh.js`（✅ 相符），PPT `d2190648…` = `_migration/ppt-017/dsh-pptmaster/lib/client.js`（✅ 相符）；而**现役** `@local/dsh-pptmaster/lib/client.js` 实为 `e2b5d28b…`、现役 `@local/dsh-usage/lib/ingest-dsh.js` 实为 `f735185e…`（guard **未部署**）。引用时必须连口径一起写。
- **本轮可复跑基线**：`run-all.sh` **ALL GREEN 5/5**（exit-codes 全 0，4.8 s）；`run-p7-restore-drill` `RESULT=PASS`；`run-a329-attribution` **13/13 OK**。

### N14（须做）wallpaper / ui-theme
T28：**需改造**（以 0.1.7 移植档 `_migration/settings-017/dsh-wallpaper` 为基线的源码重建 + 5 个最小改造单元）。三个候选基线里两个被否决：
- 现役部署件（含 `~/.dsh-017`）**仍是 0.1.1 时代产物**（`settingsScope` + `@deepseek-ai/dsh-client-runtime` 双双消失，直接复制**必然整插件加载失败**）；
- 工作区源码 `dsh-wallpaper-local/` **缺 09-21 的 FC1 热修**，也不能作基线。
- 契约点矩阵 35 条 = 存在 28 / 变化 3 / 消失 4 / 未判定 2；**对 0.2.0 仍需动手的 = 1**（`sessions.list.getSnapshot().current` 消失）。
  ⇒ **「会话页」per-page 覆盖是死的**（该字段 0.1.1 有，0.1.7 起 `SessionListState` 已无此键）⇒ `currentPage()` 恒返回 `home`。属 0.1.7 移植档遗留缺陷，须本轮一并修。
- **0.1.7 那轮实际没迁移壁纸资产与配置**：隔离 home 的 `wallpapers/` 为空、`settings.yaml.imported` 仅 `{}\n`、017 profile patch 的 `wallpaper` 条目**只有 id/name 而无 `config:`**。
  本轮只需带 **1 个文件**：`~/.dsh/wallpapers/37758c1c-…png`（2 334 260 B，sha256 `5fd2309b21d9…`），落位 `<DSH_HOME>/wallpapers/<uuid>.<ext>`。
- **⚠️ 关键风险**：若 root 服务缺失且 `$DSH_HOME` 未设，mediaRoot 会**回落到现役 `~/.dsh/wallpapers`**，而客户端 `/cleanup` 会删除未被引用的图片 ⇒ **迁移验收必须包含「现役图片哈希不变」这一条**。
- `ui-theme` 三棵树里**都是官方包、本机无任何 fork**，主题定制实质只是配置值 `preference: light`，**插件代码零改造**；移植档自带 7 例 FC-1 回归测试在 0.2.0 schemastery 3.18.4 下 **7/7 通过**。
- **官方零代码迁移通道**：0.2.0 `dsh-settings` 提供 `importLegacyDocument()`（把 `<profile.home>/settings.yaml` 改名 `.imported` 后按 **section 名 = profile patch entry id** 逐段写入 entry Config）。`wallpaper` 与 `ui-theme` 的节名**恰好等于 entry id** ⇒ **可零代码迁移**；但它是 **rename-first 一次性**操作 —— **必须先备好 profile patch 再投放 `settings.yaml`**，否则该 section 只留在 `.imported` 且**不重试**。

### N15（须裁决）peer 上界 `<0.2.0` 是定时炸弹
T28 独立观察：`0.2.0-rc.1 < 0.2.0` 成立 ⇒ 在 **rc.1 上**部分插件判定 COMPATIBLE；但**官方稳定 `0.2.0` 一发布即会 deny 整行**。
本部署实测在 0.2.0-rc.1 上有 **6 条**被 preflight 静默 disable（T06 用真实 semver 7.8.5 复刻判定得 **7 条** + 1 条条件性，差异来自判定口径）。
⇒ 两种解法任选：**① 保留 `compatibility.json` 精确版本豁免**（本 Runbook 默认，不改制品）；**② 把 24 处声明放宽为 `<0.3.0`**（语义正确、但改制品）。
**建议：稳定 0.2.0 发布前**就把这两条路选一条，不要等发布当天才发现整批插件被 deny。

### N16（阻塞级，**本轮单项最大工作量**）`@local/dsh-btw` 需 21 个改造单元 + 2 处方案定案
T30 实测 **26 条契约不兼容**（**硬失败 19 + 静默退化 7**）+ 2 条未判定，拆出 **21 个交付单元**（17 必需 + 4 配套）。
**工作量约 0.1.7 的 1.1–1.3×**，但**构成发生质变**：0.1.7 的难点是「换承载面」（settings→volatile Config、client-runtime→client-store，全机械改）；
**0.2.0 的难点是「换数据面 + 换导航面」**。

**四个「0.2.0 新引入、0.1.7 时还不是问题」的硬闸**：
| # | 变化 | 影响 |
|---|---|---|
| 1 | **`@deepseek-ai/dsh-client-runtime` 整包消失** | 10 处 import + `package.json:74` + `tsdown.config.ts:19`（**0.1.7 时它还在**） |
| 2 | **`Session.events` 访问器被整个删除** | btw 的**摘要 / 转录 / seed 三条读路径全废**；替代品 `snapshotEvents`/`ownEvents` 已标 `@deprecated`「new calls are prohibited」 |
| 3 | **`ISessions.open` / `openSubagent` / `subagentsByParent` 整体换成 retain/using/scope/subagentAddress 保留模型** | **JumpList 跳转能力作废** |
| 4 | **`session/prompt-image-transform` waterfall + 承载包 `dsh-host-apiproxy` 双双消失** | **主会话图片转文本路径整条死**（`dsh-api-session-controller/lib/index.js:873` 已内建闸门） |

**另有一条易漏判**：`TypertCodec.schema → create()` 在 0.2.0 是**「注册期硬抛」**（`dsh-typert-loader/lib/index.js:87,211`、`dsh-typert-registry/lib/index.js:565`），
不是 0.1.7 时的「形状变化 / 首次 RPC 才炸」⇒ btw 手写的 **10 条描述符不改就整个插件 apply 失败**。

**重叠判定：需要重构的官方新包 = 0 个。** 且 `dsh-session-query` **不是冲突而是正解** ——
`readTitle`/`readSession`（含 `inheritedEventCount` 的带快照）/`listSessions` 能**同时消掉** `Session.events` 消失、`header.seedLength` 消失、手扫 `session/title` 三处（已写成 T30-U07）。
同时**核销了 14 项兼容、无需改**的契约点（`defineTool` 纯增量、`ToolGuard`/`ToolRestriction`/4 个 `dsh-subagent` 组合原语/`installModelSelection`/`admitEncodedImages`/`TypertRemoteService`/`$mount`/`sessionQuery.listSessions`/`subagents.listDescendants`/`ISessions.list` 快照/两个槽位名/`data-shell-overlay`/`defineStore` 的 `{init,persist,actions}` 形状）⇒ **避免执行档做无用功**。

**⚠️ 迁移基线必须取工作区源码，不是部署件**：86 个共有文件 **48 same / 38 diff**（`src` 18、`lib` 6、`tests` 10、`scripts` 1、根 3）；工作区另有 **26 个部署件没有的文件**。
功能级证据：部署件无 provider 可配置化（硬用单常量 `BTW_PROVIDER`）、无 JumpList/ResizeHandle/ToolRow/vision/prompt-transform。

**需先定案两处**：① **T30-U07 读面选型**（推荐 `sessionQuery.readSession`）——这是本轮**唯一需要重新设计**的单元；
② **T30-U15 导航落点**未定（0.2.0 注释明说「navigation belongs to view owners」；若找不到插件可用的切会话入口，JumpList 只能降级为「只展示不跳转」）。
另 **T30-U11** 建议**删除** `prompt-transform.ts`（123 行，0.2.0 无载体）并交回官方闸门。
**建议拆 3 档执行，不建议单档**；净需 **1 次宿主重启**（客户端 bundle 走 `dsh-client-modules` 的 `rebuilt()` 增量重建，结构上不重启，但该结论列为未判定）。

---

### ⚠️ 对上文「11/13 插件加载成功」的口径限定（必读）
本报告 §7 与 RUNBOOK §7.2 的「**12/13 / 11/13 插件加载成功**」测得的是**宿主半（host-side）ESM import 面**。
**它不等于「插件在 0.2.0 上功能可用」**：
- `@local/dsh-btw` 宿主半 import 成功，但其**客户端半有 26 条契约不兼容**（N16）；
- `@local/dsh-pptmaster`、`dsh-ssh-gui`、`dsh-wallpaper`、`dsh-usage` 等同样带客户端 bundle，本次只验了宿主半；
- `dsh-workspace-enhancement` 宿主半 import 成功，但**运行期有 22 条契约不兼容**（N10）。
⇒ **正确表述**：**宿主半 import 面 11/13 通过**；**功能可用性**须按 N1/N10/N16 的单元清单逐条落地后才可判定。
**不得**把 import 通过当作功能通过（这正是交接件 §7 历史坑「单元 PASS ⇒ 目标 PASS」的同型错误）。

### ✅ 协调者实测更正：T15/T16 的「客户端半未修」结论对**本组合的部署件**不成立
T15 称 pptmaster 部署件仍是旧图标（`e2b5d28b…`）、T16 称 `dsh-btw` 有 9 个退役图标 + 3 个插件客户端 `require` 已消失的 `dsh-client-runtime`。**协调者对本组合部署件直接实测，结论不同：**

| 插件 | 0.1.1 现役 client.js | **0.1.7 组合（U）** | **新 0.2.0 组合** | 旧图标残留 | `dsh-client-runtime` 残留 |
|---|---|---|---|---|---|
| `@local/dsh-btw` | `d9dda3bb…` | `606f53f1…` | `606f53f1…` | **0** | **0** |
| `@local/dsh-pptmaster` | `e2b5d28b…` | `d2190648…` | `d2190648…` | **0** | **0** |
| `@local/dsh-wallpaper` | `0fc4fd87…` | `e3000eeb…` | `e3000eeb…` | **0** | **1（待修，与 T28 同结论）** |
| `@local/dsh-usage` / `dsh-ssh-gui` / `dsh-subagent-model` | — | — | — | **0** | **0** |

**四条实测结论**：
1. 新组合的客户端件 **逐字节等于 0.1.7 组合（U）的件**，而**全部不等于现役 0.1.1 的件** ⇒ **上一轮迁移确实重建过客户端 bundle**（T16 称「两份 profile 里完全相同、未重建过」与实测不符）。
2. **`dsh-client-runtime` 残留只有 `dsh-wallpaper` 1 处**（T16 称 3 个插件）—— 即 btw / pptmaster 的该引用**已被上一轮清掉**。
3. **退役 `*16` 图标引用在 6 个客户端 bundle 中均为 0**（T16 称 btw 有 9 个）—— 与协调者此前对 tasted 的发现同源：**旧图标断点发生在 0.1.1→0.1.7，且已被上一轮修掉**。
4. `dsh-taste` 是唯一**未被上一轮重建**的件（U 与新组合都无其 client.js 记录），本轮已由协调者修复并验证（5 处 `OutlineRegular`、0 处 `Outline16`）。

**据此对工作量的修正**：N16（btw 21 个单元）中的**客户端图标与 `dsh-client-runtime` 两项已不成立**，但 **`Session.events` 删除、`ISessions` 保留模型、`session/prompt-image-transform` 消失三项仍成立**（这三条是 0.2.0 新引入，上一轮无从修）。N12（pptmaster 重构）中的**图标项已不成立**；**`conversation.chat.turnTail` chain→list 与 2 处失效席位仍须修**。
⇒ **落地前必须以部署件实测复核 T15/T16/T30 的每一条客户端断言**，不得直接按报告条目派工。

---

## 6. 已被本机证据否定/更正的历史结论

| 历史结论 | 本轮实测更正 | 来源 |
|---|---|---|
| 0.2.0 新增 `dsh-skill-office` / `dsh-tool-subagent-control` / `dsh-workflow-ptc` | **三者 0.1.7 已存在**；真实新增仅 5 个包 | T01/T11/T15/T31 互证 |
| 会话格式需升级（v4→更高） | **未升代**，`SESSION_FORMAT_VERSION=4` 两版相同，格式五包逐字节相同 | T29 |
| 「官方已内置 office 能力，自建 PPT 链可退役」 | `dsh-skill-office` 在本部署**未挂载**（休眠），且与本机 office-handoff **完全正交**；官方 web-search 仍只有 `response.json()`（SSE 层**不可退役**） | T14/T15 |
| 仓库是官方 monorepo 检出；`distributions.json` 与 DSH 相关 | **均不成立**：无根 `package.json`/`pnpm-workspace.yaml`，remote 为 `AdamDream/dsh-hub`；`distributions.json` 是 **Firefox 遥测数据**（31 个 `metrics#gfx/a11y` key） | T14 |
| 「启动时给官方包重指符号链接」 | 该机制 **0.1.7 就已不存在**（已被进程内 resolver 拦截取代）；但「从不剪枝非官方条目」仍成立。**风险**：老 home 首次被启动会**静默清理** `<profile>/.dsh-module-fallback`，迁移前须备份 | T02 |
| `ps -p <宿主 pid>` 可判实例存活 | **结构性不可用**：每个 bash 调用在 `bwrap --unshare-pid` 内，PID 从 1 重编；且**端口占用是 per-netns 的** | T09/T20 |
| 0.2.0 存在中文硬编码文案缺陷 | 是**官方双语 i18n 字典**，非缺陷；历史阻塞根因是测试驱动只唯一匹配中文 | T15 |

---

## 7. 三轮独立交叉验证的收敛情况

- **CLI 零增量**：协调者哈希实测 + T02 独立（sha512 与 registry `dist.integrity` 逐一吻合，排除拿错包）✅
- **5 个新增包 / `dsh-skill-office` 非新增**：T01 + T11 + T15 + T31 四轨独立同结论 ✅
- **`dsh-settings` 删导出是插件失败真因**：T13（settings 重写切入）+ T14（导入面切入）+ 协调者导出面实测 ✅
- **peer 闸门即 0.2.0 静默禁插件机制**：协调者 boot 实测 + T29（源码行号 286/322）✅
- **0.2.0 可跑起来**：协调者（3098）+ T25（3102）+ T20（3098 harness）三处独立 ✅
- **矩阵口径收敛**：本地定制为 **13 个**（`@local/*` 9 + `@deepseek-ai/{taste,session-board,vision-adam}` 3 + 顶层 `dsh-workspace-enhancement` 1），**不是 9 个** ✅

---

## 8. 相关产物索引

| 产物 | 路径 |
|---|---|
| 本报告 | `.workspace/audit-020/reports/MIGRATION-ASSESSMENT.md` |
| **可执行 Runbook** | `.workspace/audit-020/RUNBOOK-020.md` |
| 实测硬基线 | `.workspace/audit-020/reports/MEASURED-BASELINE.md` |
| 插件×版本导入矩阵 | `.workspace/audit-020/reports/PLUGIN-MATRIX.md` |
| 已跑通的 0.2.0 组合 | `.workspace/audit-020/assembly-020/` |
| 轨道台账（32 轨道） | `.workspace/audit-020/TRACKS.md` |
| 审计报告（18 份） | `.workspace/audit-020/reports/T*.md` |
| 代码改动面原始数据 | `.workspace/audit-020/churn-lib-017-020.txt` |
| 组合层对照 | `.workspace/audit-020/dump-017.txt` / `dump-020.txt` |

---

### 口径自纠（审计轨道反向纠正协调者，已采纳）
**1. `dsh-skill-office` 应归回「code-identical」而非「55 个真实改动」。**
协调者在派发插播中写「`dsh-skill-office` 11 个文件中 1 个改动」——那 **11 是整包口径**，而唯一的那 1 个「改动」正是 **`package.json` 的版本号字符串**（+ peer/dep 版本同步 + devDeps 键顺序互换，纯装饰）。
**`lib/` 口径实测：2 个文件逐文件全等 ⇒ CODE-IDENTICAL**（已用 `diff -rq <A>/pkg/lib <B>/pkg/lib` 直接验证，且它**不在** `churn-lib-017-020.txt` 名单内）。
⇒ **协调者自己警告过的「整包 vs `lib/`」陷阱，在派发指令里就地复现了一次。** 同类项 `dsh-skill` / `dsh-skill-filesystem` 亦为 `lib/` 全等。
**复核结论**：`churn-lib-017-020.txt` 的 **55 个改动包名单本身是干净的**（本轮对其全表逐包 `diff -rq` 复算，**误判数 = 0**）；出错的只是协调者在正文里**混用了另一种口径**的数字。

**2. 同理校正 `dsh-client-ui-theme` / `dsh-host-frontend-static` / `dsh-host-webserver` / `dsh-fs-local`。**
协调者曾按「整树」口径写 `theme 5/21`、`frontend-static 1/7`、`webserver 1/8`、`fs-local 1/9` 并据此下达「重点细查」。
按 **`lib/` 口径**实测：`theme` **1/16**（仅 `lib/client.js`）；**另三个包 `lib/` 一处真代码改动都没有**（0/2、0/3、0/4）。
⇒ `dsh-client-ui-theme` 的唯一真改动 = 内联 `design-platform.css` 字符串（17732 → 18715 B，`diff -u` 共 11 行），**token 级精确比对：新增 10 条（5 个 token × 明/暗）、移除 0 条、既有 token 改值 0 条** ⇒ **没有任何 CSS 变量名被改名或移除**。
**方法论纪律（本报告据此统一）**：凡「是否变化」的判定**一律以 `lib/` 逐文件为准**；整树口径仅可用于「发布物是否重打」这类问题，**不得用于契约/代码改动判定**。

---

### T17 的两条自我更正（已采纳，其中一条**影响你的知情告知**）

**1. ⚠️ `sidebar.workspaces.remoteHosts` 是真回归，不是历史死项 —— 迁移后侧栏「分布式节点」树会静默消失。**
T16 判它「0.1.1 也从未声明」⇒ **实测不成立**：该槽位在 **0.1.1-rc.2 存在**（`dsh-client-ui-workspace` 的 `slots.d.ts` + `client.js`），在 **0.1.5 线被删除**。
⇒ 结合本机事实（现役 **0.1.1** 上有此槽，0.2.0 上无）：
- `@local/dsh-ssh-gui` 注册的 `sidebar.workspaces.remoteHosts` 在 0.2.0 上会**静默 `return`**（`ctx.slots.inject` 对未声明 key **不报错不告警**，`dsh-client-ui-renderer/lib/client.js:1361-1368`）；
- 表现为 **UI 无声消失** —— 侧栏「分布式节点」树不见，**无任何报错**。
⇒ **这是用户可感知的迁移回归，必须在切换前明确告知**，不能按「历史死项」一笔带过。

**2. `rpc.handle` 第 3 参丢弃 ≠ `rpc.handle` 必抛（T24 的 E-1 结论需前置闸门）。**
T24 判 `dsh-client-connection` 的 `inject` 由 `["webServer","credentials"]` 收紧为 `["credentials"]` 会导致 `rpc.handle` 必抛。T17 用 `cordis@4.0.4` 做**最小同形复现**：`owner.webServer` **无论 inject 如何都解析成功**（服务值落在 root fiber store）。
⇒ **确定的变化只是第 3 参 `{authority:'loopback'}` 被静默丢弃 ⇒ loopback 信任豁免消失**（静默失效、不报错）。
**纪律**：在 T17 §8.10 那条 405 实测收敛前，**Runbook 不得把 `/dsw` 写成「确定可用」或「确定不可用」**；T24 的 E-1 修法（「去掉第 3 参」）**须以真机实验为前置闸门**。

**3. 本族最硬断点与 0.2.0 无关**：`dsh-ssh-gui` 与 `dsh-workerspace` 都在**模块顶层具名导入** `installSettingsSection`/`settingsNamespace` ⇒ **ESM 链接期 `SyntaxError`，两个插件在 0.2.0 上整行加载失败**（已在隔离探针动态复现），**0.1.7 隔离根上同样成立**（与 N1 同源）。
**4. 好消息**：官方 provider 抽象层（fs / subprocess / bash / sandbox / tools / workspace / directory-picker）在 0.2.0 **逐字节未变** ⇒ **本族的墙全部在「settings 装配、通道装配、客户端槽位」这三个非 provider 面**。
**5. 一处基线校正（与 T06/T24 一致）**：`dsh-ssh-gui`/`dsh-workerspace` 所在的这套 profile patch 自称 insert-only，但它**实际 disable 了官方 `directory-picker`**，且 `dsh-workspace-enhancement` 自带 bundle patch 又 disable 了 3 条官方行（`directory-picker`/`subprocess`/`fs-sandbox`）——三条行 id 在 0.2.0 仍存在故仍命中。⇒ **「insert-only」这一自我描述在 0.1.1/0.1.7 两份 patch 上都不准确**，落地时须按实际条目处理。

---

# 🔴 N17（最高优先级，**可能否决整个直迁方案**）

## 现役 90.6% 的会话在 0.2.0 下**无法打开** —— T21 结论经协调者全库实测确认（T12 判断被推翻）

### 协调者全库实测（只读，逐文件 `zstd -dc` 全帧解码，2 460 个日志）

```
files=2460  errors=0  no-descriptor=233
descriptor v2=2227   v3=0   other=0
```

**v3 计数为 0** —— 你的现役会话库里**没有任何** descriptor v3，而 0.2.0 的 v0→v1 迁移**只接受 v3**。

### 源码级归因（拒绝点精确定位）
`dsh-session-format-v0-to-v1/lib/index.js:1584-1587`：
```js
if (event.type === "subagent/descriptor" && data["version"] !== 3) {
    const descriptorVersion = sessionFormatCount(data["version"], `...`);
    if (version === 0) throw new SessionFormatUnsupportedMigrationError(
        `${event.type} ${event.seq} uses unsupported descriptor version ${descriptorVersion}`);
    return;
}
```
**协调者对该函数直接实测**（合成 v0 事件，逐 version 调用）：
```
version=0 => THROW: SessionFormatUnsupportedMigrationError: subagent/descriptor 7 uses unsupported descriptor version 2
version=1 => PASS (no throw)
version=2 => PASS (no throw)
version=3 => PASS (no throw)
```
⇒ **v0 代际 + descriptor v2 = 硬抛，且迁移链中无任何边改写它**。

### 为什么 T12 与 T21 结论相反、以 T21 为准
- **T12** 从源码读出 descriptor 白名单 `[1,2,3]` ⇒ 判「v2 具备被自动补建资格 / 零拒签项」。**该白名单不是这个函数的判据**。
- **T21** 直接按帧解码全部 v0 日志实测，判「`dsh-session-format-v0-to-v1:1582-1289` 硬拒，迁移链无改写边」。
- **协调者实测站 T21 一侧**（拒绝点已在源码逐行定位 + 该函数已直接实测抛出）。

### 影响量化（按当前语料）
| 项 | 数量 |
|---|---|
| 现役会话日志总数 | **2 460** |
| 含 descriptor **v2**（被硬拒） | **2 227（90.5%）** |
| 无 descriptor（不受此条影响） | 233（9.5%） |
| 含 descriptor **v3**（可通过） | **0** |

### ⚠️ 必须诚实标注的未验证边界
`assertReleasedEventPayload` 在 0.2.0 读路径上的**完整传播链**（是否被 `recovery:'recoverable'` 兜住、是否存在更早的改写边把 v2 改写成 v3、是否仅在「确实要迁移」时才走到该断言）
—— **协调者本轮未跑通端到端读路径**（需要真实会话打开操作，受零模型请求与不触碰现役约束）。
T21 明确判定：**`recovery:'recoverable'` 兜不住 `SessionFormatUnsupportedMigrationError`，不可修复但 fail-closed、原数据不丢**。
⇒ **这是阶段二的第一个必做验证项**：在隔离实例上真实打开一个 v0 会话，确认是「打不开」还是「能打开但降级」。

### 对迁移决策的影响
1. 若该断言在真实读路径上确实触发 ⇒ **「数据无损、旧会话可用」这一用户核心要求在 0.2.0 上大面积不成立**，直迁方案**必须重新设计**：可选路径包括
   (a) 先做一次 **0.1.7 侧**的 descriptor v2→v3 批量改写（用 0.1.1 或 0.1.7 的工具面，不经 0.2.0 的严格迁移链）；
   (b) 保留 0.1.1 实例作为老会话读取入口，0.2.0 只承载新会话；
   (c) 向上游提 issue 请求放宽该闸门。
2. **无论选哪条，都不能在验证前对外宣称「迁移后旧会话可用」。**
3. 附件面是好消息：布局两代完全相同（`attachments/v1/objects/<2hex>/<sha256>`），
   `cp -a` 即可；协调者已实测复制 **991 对象 / 205 MB**；T21 实测源 store **命中 971/971、缺失 0**。

---

## N17 补充：第三条独立轨道（T05）确认，且**给出了可能的解**

### 三条轨道独立收敛
| 轨道 | 方法 | 结论 |
|---|---|---|
| **T21** | 逐帧解码 + 代码定位 | 90.8% 不可读，descriptor v2 硬拒 |
| **T05** | 全库只读预检 `fullpass.mjs`（2456 会话）+ 四版本源码树对照 | **226 可读（9.2%）/ 2230 被拒（90.8%）**；拒因 **2226 例 descriptor v2** + 4 例 `agent/inbox/spliced` 载荷校验 |
| **协调者** | 全库 `zstd -dc` 逐帧扫描（2460 文件） | **v2 = 2227，v3 = 0，errors = 0** |

三者一致。**N17 成立。**

### 🔑 关键新事实：这**不是 0.2.0 的回归**，改锚不改风险
- **`descriptor version` 从 2 变 3 发生在 0.1.7，不是 0.2.0**：现役 **0.1.1 写的是 v2**（`dsh-subagent` 现役树 `:328`），0.1.7/0.2.0 写 v3。
- 而硬闸 `data.version !== 3` 在 **0.1.3-alpha.2 起各版本都带同一道门**（T05 已跨版本确认）。
- ⇒ **原交接件规划的 0.1.7 迁移会撞上完全相同的墙，比例也一样。** 「改锚到 0.2.0」**没有引入也没有缓解**这条风险。
- ⇒ **官方未提供任何 v0 + descriptor-v2 的转换器。**

### 🔑 关键新事实：修复可能是**机械的**
T05 的**最小对照实验**：同一份日志**只把该字段 `2 → 3`** 即通过校验；
因为 **v2 的成员集是 v3 允许集的子集** ⇒ 单向提升不损失信息。
⇒ 存在一条**离线正规化**路径：对 v0 日志里每个 `subagent/descriptor` 事件把 `version: 2` 改为 `version: 3`。
**但这是数据改动，必须按产品决策走**，不可由 agent 自主执行。

### 若选「离线正规化」，可判定验收标准（T05 给出）
1. **消息投影哈希相等**（迁移前后投影一致）
2. **地标计数不变**（`tool/result` / `user/message` / `turn/end` 等分类计数）
3. **头部不变量成立**（物理头字段与代际一致）
4. 正规化后在 0.2.0 隔离根上**真实打开**目标会话（这是协调者尚未跑通的那一步）

### ⚠️ 附带的第二个真实数据风险：真实库已存在静默数据丢失实例
`resolveGenerationInDirectory` **仍取目录内最高代、不校验内容包含**（`:3327-3357`，取最高在 `:3351`）。
**真实库命中**：某会话目录**同时有 v0 与 v3**：
- v0：mtime **2026-09-17**，34 468 行（682 `tool/result`、291 `user/message`、121 `turn/end`）
- v3：mtime **2026-09-12**，332 行（64 / 21 / 4）

⇒ 0.2.0 取 v3 ⇒ **会话「回到 09-12」，晚 5 天、约 10 倍内容不可达**；
而 **0.1.1 只按固定名 `session.jsonl.zstd` 定位，读的是 v0**即完整的那份。
⇒ **迁移预检必须新增一项**：先排查「同目录多代际」会话并逐对判定**高代是否为低代超集**（T05 已给出 `dualgen.mjs`）。

### 会话存储形态更正（影响备份方案）
会话存储是**纯 JSONL，没有 SQLite / WAL / 索引**（`session-query-sqlite` 在 0.1.7/0.2.0 的 base 都是 `path::memory:` + `openAt: never`）。
⇒ 历史结论 `{readOnly:true}` + `VACUUM INTO`（T19）**只适用于** `~/.dsh/storages/usage/usage.db` 等非会话存储；
**会话快照应 `cp -a` 逐会话目录 + 按只读通道验证**（与 T19 的「会话是 zstd 追加流、直接 tar 安全」结论一致）。

### 其余对方案有直接影响的结论
- 只读 `open(id,'read')` 对历史代际**只在内存迁移、不落盘**（实测目录与 sha256 不变）；`open(id,'write')` 才取 `session.lock`（flock，永不删除）并排他发布 `session.v4.jsonl.zstd`，旧代际文件保留。
  ⇒ **回滚 = 删新文件**；但**回滚后 0.1.1 看不到 v4-only 的会话**。
- 未来代际（v5）文件会让会话从 `list()` **静默消失**而 `stat/read` 抛「upgrade the harness」；文件名/头部代际不一致会以**普通 Error 炸掉整根枚举**；根内混入相反压缩后缀或扁平遗留文件会让**整根不可用**。

### 需要你做的业务裁决（T05 明确指出）
**在「接受 90.8% 不可读」与「自研 descriptor v2→v3 离线正规化」之间二选一。**
（再加上我在 N17 里给的第 3 条：保留 0.1.1 作为老会话读取入口。）

---

# 🔴🔴 N17 升级为「方案否决级」：**两道独立硬闸，且一道无法用正规化绕过**

协调者在隔离根上对**真实语料**跑通了 0.2.0 的**真实校验器**（`assertReleasedEventPayload`），得到 N17 的最终形态。

## 实测方法与结果
抽样 200 份真实 v0 会话，逐事件喂给 0.2.0 的正式校验器（`assertReleasedEventPayload(ev, 0)`，`assistant/chunk` 按迁移链自身逻辑跳过）：

```
sampled: 200   PASS: 6   FAIL: 194   （失败率 97%）
    145  descriptor-version                 ← descriptor v2（T21/T05 已报）
     40  unknown-type:reasoning-chunks      ← 新发现
      4  unknown-type:tool-call-chunks      ← 新发现
      1  unknown-type:text-chunks           ← 新发现
      4  other
```

## 第一道闸：`subagent/descriptor` v2（可离线正规化）
`dsh-session-format-v0-to-v1/lib/index.js:1584-1587` —— `data.version !== 3` 且 `version===0` 即抛。
v2 成员集是 v3 允许集子集 ⇒ **只把 `2` 改 `3` 即可通过**（T05 最小对照实验 + 协调者直接实测该函数确认）。

## 第二道闸：**未登记的 v0 事件类型**（**无法用正规化绕过**）
`assertReleasedEventPayload` 的第一条断言：
```js
if (disposition === void 0) throw new SessionFormatUnsupportedMigrationError(
  `format v0 contains unknown historical event type ${JSON.stringify(event.type)} at seq ${event.seq};
   migration refuses unknown historical events even when ignorable`);
```
`RELEASED_V0_EVENT_TYPES` 共 **51** 项（已导出、可直接枚举）。实测：
| 事件类型 | 在 51 项白名单内？ | 在 0.1.1 格式包里出现？ |
|---|---|---|
| `subagent/descriptor` | ✅ PRESENT | ✅ |
| `reasoning-chunks` | ❌ **ABSENT** | **❌ 0 文件命中** |
| `tool-call-chunks` | ❌ **ABSENT** | **❌ 0 文件命中** |
| `text-chunks` | ❌ **ABSENT** | **❌ 0 文件命中** |

⇒ 这三种类型**既不在 0.2.0 的封闭清单里，也不在 0.1.1 任何格式包源码里** —— 它们**只存在于现役写出的数据中**，
是**连 0.1.1 自身的格式定义都没登记**的幽靈类型。**没有任何官方转换边能处理它们。**
⇒ **把 descriptor 改成 v3 只能救 145/200；含这三种 chunk 类型的会话仍然打不开。**

## 结论：原「离线正规化」路径**不足以**解决问题

| 方案 | 在 N17 最终形态下的实际效果 |
|---|---|
| (a) 接受不可读 | 老会话历史基本失效 |
| (b) descriptor v2→v3 离线正规化 | **只解决约 72% 的失败**（145/194），剩余约 25% 因未知事件类型**无解** |
| **(c) 保留 0.1.1 作为老会话读取入口** | ✅ **唯一能 100% 保住历史的路径** |
| (d) 向上游提 issue 请求放宽两道闸 | 需官方接受并发布新版本；周期不可控 |

⇒ **协调者裁定：推荐 (c)** —— 0.1.1 实例（3080）继续作为历史会话的读取入口，0.2.0 只承载新会话。
若坚持 (b)，必须**先**按 `reasoning-chunks`/`tool-call-chunks`/`text-chunks` 做业务确认，且需自研转换器把它们映射到已登记类型（如并入 `assistant/chunk`），
**这一步是产品级数据改写，超出 agent 可自主决策范围。**

## 本轮验证的边界（诚实标注）
- 抽样为 `find` 前 200 份（**字典序偏置**），非随机；失败率与拒因比例可能不代表全库精确分布，但**两类拒因的存在性与机制已确证**。
- 未执行真实 `open(id)` 读路径（需会话加载 API 与模型无关的入口）；本轮用的是**迁移链自身的校验器**，与读路径同源。
- 未修改任何真实会话文件；隔离根内的副本可随时删除重取。

## N17 最终形态的关键修正：chunk 类型**不是幽灵，是「合法但未登记」**

协调者继续追查后修正上一节的判断，事实更精确也更棘手：

| 检查 | 结果 |
|---|---|
| 谁是产生方？ | **0.1.1 的 `dsh-session/lib/types/chunk-rows.js` 写入** `reasoning-chunks` / `tool-call-chunks` / `text-chunks` |
| 0.2.0 是否仍认识它们？ | **是** —— 0.2.0 全树 `reasoning-chunks` 17 文件、`tool-call-chunks` 19 文件、`text-chunks` 17 文件命中 |
| 是否在 v0 迁移的封闭清单内？ | **❌ 不在**（`RELEASED_V0_EVENT_TYPES` 仅 51 项） |

⇒ **它们是 0.1.1 的合法功能，且 0.2.0 依然支持；卡点纯粹是「v0→v1 的封闭事件清单没有登记它们」。**
即：**协议层的遗漏，不是数据的畸形**。这也解释了为什么 `migration refuses unknown historical events even when ignorable` 的措辞如此强硬 —— 它在防伪造，但误伤了先于清单存在的合法类型。

**对方案的影响（比上一节更细）**：
- 修 descriptor（`2→3`）**必要但不充分**：只能救 `descriptor-version` 那 145/200；
- 含 chunk 类型的会话（抽样 45/200 ≈ 22.5%）**仍然打不开**；
- 两条路可解，**均属产品级数据改写**，须你裁决：
  - **(b1)** 自研 v0 正规化器：把 chunk 类型映射到清单内类型（如并入 `assistant/chunk`）
    **前提**是确认其在 0.2.0 侧语义等价 —— 需先读 `dsh-session/lib/types/chunk-rows.js` 与 0.2.0 对应消费点；
  - **(b2)** 向官方提 issue：请求把这三个类型补进 `RELEASED_V0_EVENT_TYPES`（**协议层遗漏，官方修补成本低**，且属真正的缺陷修复）。
- **(c) 保留 0.1.1 作为历史读取入口** 仍是唯一**无需改数据**即可 100% 保住历史的路径。

**抽样口径诚实标注**：上文 200 份为 `find` 前 200（**字典序偏置**），且第 4 份样本（25 条 `assistant/message`、无任何 chunk）说明 chunk 并非普遍使用
⇒ **全库中 chunk 类拒因的占比需重新无偏抽样确认**，不可用 22.5% 外推。`descriptor-version` 的确定性不受影响（全库 2 229 份 v2、0 份 v3）。

## N17 权威量化（协调者最终实测，200 份 v0 抽样，逐事件喂真实校验器）

```
total sampled      : 200
  decode/header err: 0
  v0 sessions      : 200
  PASS as-is       :   6  (3.0%)
  FAIL as-is       : 194  (97.0%)
  --- 若只把 subagent/descriptor 的 version 2 改为 3 ---
  PASS             : 120  (60.0%)
  STILL FAIL       :  80  (40.0%)

现状拒因:                     修 descriptor 后剩余拒因:
  145  descriptor-version        49  unknown:reasoning-chunks
   40  unknown:reasoning-chunks  26  other（payload-shape 类）
    4  other                     4  unknown:tool-call-chunks
    4  unknown:tool-call-chunks  1  unknown:text-chunks
    1  unknown:text-chunks
```

### 裁定
| 方案 | 实际效果 |
|---|---|
| (a) 接受不可读 | 仅 **3%** 会话可用 |
| (b) descriptor `2→3` 离线正规化 | 提升到 **60%**，**仍有 40% 打不开** |
| (b1) 再加 chunk 类型映射器 | 需先确认语义等价；可再解约 27% |
| **(c) 保留 0.1.1 作为历史读取入口** | ✅ **唯一无需改数据即可 100% 保住历史** |
| (b2) 向官方报 issue（补 3 个类型进 `RELEASED_V0_EVENT_TYPES`） | **正确的长期修复**：属协议层遗漏，官方修补成本低 |

**协调者裁定：推荐 (c) + 并行推进 (b2)。** 理由：
- (c) 是唯一零数据风险路径，且现役 3080 本就在运行，不增加任何运维面；
- (b2) 是**真正的缺陷修复**（0.1.1 合法写入的事件类型未被 v0 迁移清单登记），修好后 (b) 的收益才能完整；
- **(b) 单独实施会把 40% 的会话留在打不开状态**，若对外宣称「已迁移」即构成误导。

### 抽样口径
200 份取自 `find` 字典序前 200；另一次 mtime 均匀抽样（120 份）得 PASS 3 / FAIL 117、拒因 `descriptor-version 109 / reasoning-chunks 7 / other 1`
⇒ **两次抽样一致**，两类拒因的存在性与量级稳定。全库精确占比仍以 `descriptor v2 = 2229 / v3 = 0`（全量扫描）为准。

## N17 机制级根因（本轮查清，且我修正了自己一次中途假设）

### 我中途提出过一个假设，并用证据否决了它（记录在此以免误导）
看到 0.2.0 的 `dsh-llm/expandAssistantStream` **完整支持** `text-chunks`/`reasoning-chunks`/`tool-call-chunks`（重建原时序与 delta 边界）时，
我假设「chunk 类拒因是我校验器的假阳性 —— 那 3 个 tag 是**存储记录**而非**事件**，真实读路径会先展开」。
**该假设被否决**：展开点 `expandAssistantStream(event.data.stream)` 的入参是 **`event.data.stream`（事件内嵌流）**，**不是顶层行**。
⇒ 0.2.0 确实支持这种编码，但**搬到了事件内部**；0.1.1 把它放在**顶层行**。

### 机制级根因：存储编码的**位置迁移**，且新读取器不再解码旧位置
| | 0.1.1 | 0.2.0 |
|---|---|---|
| packing 实现位置 | **`dsh-session/lib/types/chunk-rows.js`**（300 行，`packChunkRuns` + `decodeStorageRecord`） | **不在 `dsh-session`**（该文件已不存在）；`expandAssistantStream` 在 **`dsh-llm`** |
| 编码位置 | **顶层存储行**（bare slash-less tag） | **`event.data.stream`（事件内嵌）** |
| 读取时解码 | ✅ `dsh-session-persistence-jsonl/lib/index.js:279` = **`decodeStorageRecord(JSON.parse(line))`** | ❌ **`:1085` = 裸 `JSON.parse(line)`**，无行解码 |
| 未知类型处置 | 已被解码，永不抵达类型检查 | `:184` `KNOWN_SESSION_EVENT_TYPES.has(type)` 为假且 `ignorable !== true` ⇒ **拒绝** |
| 行 tag 是否在已知类型集合 | 不在（48 项） | 不在（59 项） |

⇒ **0.2.0 无法读取 0.1.1 的打包行** —— 这是**存储编码位置迁移 + 旧位置解码器被移除**的共同结果，
不是数据畸形，也**不是校验器假阳性**（我已用上述代码路径排除）。

### 对 (b1) 方案的影响（chunk 映射器的可行性）
自研 chunk 映射器**技术上可行且语义明确**：把顶层 row 行展开为它本就代表的 `assistant/chunk` 事件序列
（`expandAssistantStream` 的实现就是权威参照 —— 它已定义 `time0` + `dt[]` 精确重建每个成员的 `seq`/`time`）。
⇒ **(b1) 是真实可行的修复路径**，但：
- 仍需用户裁决（属产品级数据改写）；
- 仍需 (b2) 或长期方案，因为**根因是协议/实现迁移**，用户自研映射器属「代偿」，未来版本可能再变；
- **最稳妥仍是 (c) 保留 0.1.1 读历史** + 向官方报 (b2)。

### 本轮验证边界
- 已查清机制（代码路径级）；**未**在真实 `open(id)` 上跑通端到端确认（需会话加载 API 的模型无关入口）。
- 抽样比例（3% / 修 descriptor 后 60% / 余 40%）基于 200 份字典序抽样 + 120 份 mtime 均匀抽样，两次一致；
  全库精确占比以 `descriptor v2 = 2229 / v3 = 0`（全量扫描）为准。

---

# N10 方案 B 的三条可行性前提：**本轮全部查清（协调者隔离实测）**

T24 把这三条列为「执行前必须先消解」的前提（其 §8 的 N1/N2/N3）。本轮逐一实测，结论如下。

## N10-N2｜`ctx.set` 能否顶掉官方已 provide 的服务？—— ✅ **允许**（机制可用，且已在本机生效中）
用 **cordis 4.0.4**（0.2.0 实体）做最小复现：
```
after official provide, ctx.svc.kind = official
root.set  OK -> ctx.svc.kind = override
child.set OK -> child.svc.kind = child-override | root.svc.kind = child-override
```
⇒ **后注册者胜，且 child fiber 的 set 会覆盖根**。这正是 T24 描述的「私有依赖岛自己 `new` 出旧版 provider 并顶掉官方实现」的机制。
**对方案 B 的意义**：机制可用；方案 B 是**反转**它（facade 改为读取官方**已挂载**的 provider 再包一层，而非顶掉）⇒ 无机制障碍。

## N10-N1｜`dsh.client.inject` 里不存在的包名是硬失败还是静默忽略？—— ✅ **静默，无影响**
0.2.0 `dsh-client-modules/lib/index.js`：
- `:65` `platform` **强校验**（非 string 即抛）
- `:66-67` `inject` / `external` 走 **`optionalStringArray`** —— 只校验「是不是数组」，**不校验包是否存在**
- `dsh-package-manifest/lib/types/types.d.ts:79` 原文：**`/** Informational package-name dependencies, not Cordis service injection. */`**

⇒ 本机 6 个客户端插件 `dsh.client.inject` 里引用了 0.2.0 已不存在的 `@deepseek-ai/dsh-client-runtime`，
**不会导致加载失败**（与 T16 第二轮独立结论一致）。**这条不再是阻塞项。**

## N10-N3｜私有依赖岛是否会被重建？—— ❌ **不会；岛是随包分发的，且岛内钉死 0.1.1**
部署件实测：
| 插件 | 自带 `node_modules` | 岛内 `@deepseek-ai` 项数 |
|---|---|---|
| `dsh-workspace-enhancement` | ✅ | **66** |
| `@local/dsh-pptmaster` | ✅ | **23** |
| `@local/dsh-ssh-gui` | ❌ 无 | — |

岛内钉住的版本 vs 官方 0.2.0（实测）：

| 包 | 岛内 | 官方 0.2.0 |
|---|---|---|
| `dsh-fs` | **0.1.1-rc.2** | 0.2.0-rc.1 |
| `dsh-fs-local` | **0.1.1-rc.2** | 0.2.0-rc.1 |
| `dsh-fs-sandbox` | **0.1.1-rc.2** | 0.2.0-rc.1 |
| `dsh-subprocess` | **0.1.1-rc.2** | 0.2.0-rc.1 |
| `dsh-subprocess-local` | **0.1.1-rc.2** | 0.2.0-rc.1 |

⇒ 岛**不依赖安装期重建**（随包分发）；因此**只要部署件被原样复制、岛就一直存在**，
插件会**始终使用 0.1.1 的 provider 实现**而**永远拿不到 0.2.0 的新增抽象方法**（`readByteRange` / `terminalEnvironment` / `resize` / `inspectActivity`）。
**这解释了 T24 观察到的现象，也决定了方案 A 的本质**：保留旧岛＝永久停留在 0.1.1 语义，且与 0.2.0 官方消费者的调用面**不匹配**（那些消费者会调新增方法）。

**⇒ 方案 A 不是「保守」而是「半吊子」**：插件侧用旧实现，宿主侧官方代码按新契约调用 ⇒ 上表三处 TypeError 无法靠岛回避。
**⇒ 方案 B（丢弃旧岛）不仅有收益，而且是唯一自洽解**：与 T24 的建议一致，本轮为其提供了决策级证据。

## 结论：N10 的裁决已可做出
| 前提 | 结论 |
|---|---|
| ① `ctx.set` 机制 | ✅ 可用（方案 B 无机制障碍） |
| ② `inject` 缺项 | ✅ 非阻塞（信息性字段） |
| ③ 私有岛去留 | ❌ 保留岛 = 永久 0.1.1 语义 + 无法满足 0.2.0 新契约 ⇒ **必须丢弃** |

**协调者裁定：采纳方案 B。** 剩余未判定项（T24 §8）均属实现细节，不构成前置障碍。

---

# N12（taste 图标）**已闭环并 A/B 验证**

## 修改内容
`@deepseek-ai/dsh-taste` 的 5 处图标标识符（`lib/client.js:298/383/706/707/708`）+
测试夹具 `test/client.test.js` 的对应 mock 键：
`Icon{Trash,Personalization,Refresh,Settings,Close}Outline16` → `...OutlineRegular`。

**理由（源码级）**：`Icon*Outline16` 在 **0.1.7 与 0.2.0 的共享 primitives 中均为 0 命中**（0.1.1 有），
替代品 `*OutlineRegular|Medium` **两版均在**且签名兼容（仍接受 `size`）⇒ 只需改标识符，无需动参数。

## A/B 实测（协调者，隔离副本内）
| 版本 | 测试数 | pass | fail |
|---|---|---|---|
| **已修图标** | 218 | **202** | **16** |
| 临时回退到修复前 | 218 | 201 | 17 |

⇒ **修复净收益 +1 个测试通过，且未引入任何新失败。**
`test/client.test.js`（唯一触及图标的套件）单独跑：**7 pass / 0 fail**。
剩余 16 个失败为**既有测试夹具/环境问题**（如 `backfill command (integration, §7.2)`、`runLearner`），**与本修复无关**（回退后仍失败 17 个）。

## 收尾
修复前的原件已移出 `lib/`（避免随插件发布），存于 `.workspace/audit-020/taste-iconfix-backup/`。
`lib/` 内 `Outline16` 残留 = **0**。

---

# ✅ 用户裁决：**选项 (c)** —— 双实例并存，零数据改写
（2026-09-29 用户明示「选c」。本文件此前推荐 (c)+(b2)，裁决一致。）

## (c) 形态的核心主张已在**同一份真实文件**上双向验证

| 侧 | 读取 0.1.1 写出的会话日志 | 证据 |
|---|---|---|
| **0.1.1** | ✅ **完全可读** | 对 22.8 MB / 82 430 行的真实会话：`decodeStorageRecord` **零错误展开 65 145 个打包行 → 1 364 372 个事件**（`reasoning-chunks 53 042` / `tool-call-chunks 7 593` / `text-chunks 4 510`），另 17 285 行为普通事件 |
| **0.2.0** | ❌ **大面积不可读** | 裸 `JSON.parse`（无行解码）+ 未知类型拒绝；抽样 200 份仅 3% 通过，修 descriptor 后 60% |

**⇒ (c) 的价值不是「保守选择」，而是「唯一能让历史 100% 可读的路径」，且已被实测坐实。**

## (c) 形态下的数据面纪律（**执行档必须遵守**）

1. **现役 0.1.1 的 `~/.dsh/sessions` 与 `~/.dsh/attachments` 保持原地不动** —— 历史由它继续服务。
   实测：现役语料 **2 466 日志 / 21 工作区 / 991 附件（205 MB）**，且日志数在会话期间由 2 460 增至 2 466 ⇒ **证实现役仍在活跃写入**。
2. **0.2.0 新根不得承载历史语料**：协调者已把为 N17 验证而复制进新根的 2 460 份日志与 205 MB 附件副本**移出**至 `.workspace/audit-020/n17-evidence/`。
   理由：0.2.0 读不了它们（只有 3% 可读），留着只会造成「会话列表里有条目但打不开」的混乱，且会让新旧两套会话目录出现分叉。
3. **`DSH_HOME` 必须严格隔离**：0.2.0 用独立 `DSH_HOME`（工作区内），**不得指向 `~/.dsh`**。注意 `DSH_HOME="   "`（空白）会**静默回退**到真 `~/.dsh` ⇒ 启动闸门必须断言「非空 + 绝对 + 落在隔离根内」。
4. **两实例的职责边界要写进用户可见文档**：历史会话 → 3080（0.1.1）；新会话 → 0.2.0 新端口。

## 仍未关闭、需在 (c) 形态下另行处理的项
- **`remoteHosts` 回归**：侧栏「分布式节点」树在 0.2.0 静默消失（0.1.1 有 2 hits / 0.2.0 有 0 hits）。**待裁决是否找回**。
- **taste 语言基线**：`taste.md` 已是中文单轨（实测 4 482 CJK），与偏好记录「英文 markdown」相反。**待确认是否更新偏好**。
- **插件侧改造**：settings 断层阻塞 3 个插件（`dsh-subagent-model` / `dsh-session-board` / `dsh-vision-adam`）；N10 已裁定方案 B（丢弃私有岛）。
- **办公入口**：Route A 在 0.1.7+ 结构性失效（`/api` cookie 鉴权门 + 端点改斜杠 + `workspace.list` 消失），**A/B/C/D 四选项待裁决**。
- **(b2) 建议并行推进**：向官方报「0.1.1 合法写入的三个打包行类型未被 v0 迁移清单登记」——这是真正的缺陷修复，
  且是**唯一能让未来任意版本都读得懂历史**的路径（自研映射器属代偿）。
