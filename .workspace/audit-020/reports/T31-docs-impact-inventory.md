# T31 · 文档与清单面影响盘点（0.2.0 迁移审计轨道）

> **性质**：只读审计轨道产物。**本档未修改任何文件**（除本报告自身；`docs/program-notebook.md` 归 `program-notebook` skill，其他文档由后续执行档统一更新）。
> **目标锚**：迁移目标 = `0.2.0-rc.1`（由 `0.1.7-rc.2` 改锚）。现役 `0.1.1-rc.2`(3080) 与隔离 `0.1.7-rc.2`(3097) 均在运行，本档未触碰。
> **证据纪律**：所有行号/现值均为**本档当轮实测**（`grep -n` / `read` / `stat` / `md5sum`）。本档**未启动任何服务、未发起任何模型请求、未写 `~/.dsh/**`**。
> **来源基线**：协调者实测档 `.workspace/audit-020/reports/MEASURED-BASELINE.md`（dist-tags：`latest=0.1.7-rc.2`、`next=0.2.0-rc.1`；**无稳定 0.2.0**）。
> **不含**：会话正文、密钥、原始会话 id、本档私有计数之外的任何凭据。文档中出现的 `ask_user_question` id 为既有文档原文引用，非凭据。
> **第二轮追加**：§0.5 为协调者插播校正的落地（2026-09-29 第二轮实测）；其中所有包级结论按 `【lib全等】` / `【源码实读】` / `【宿主先例推定】` 三类依据显式标注，**未标注者不得据以放行**。

---

## 0. 结论摘要

1. **需要更新的权威文档 = 16 份**（另加 `docs/program-notebook.md` 归 skill 管辖，共 17 份口径面）。
   - Tier 0：`README.md`；Tier 2：`FEATURE-MAP.md`；架构 6 份（`01`–`05` + `office-handoff.md`）；runbooks 6 份（`README.md`、`verify-runbook.md`、`switch-web2-runbook.md`、`port-taste.md`、`port-tokps-web2.md`、`port-vision-adam.md`、`port-wallpaper.md`）；反代线 3 份（`workbuddy-reverse-proxy/README.md`、`UPGRADE-STOP-0.1.7.md`、`RUNBOOK.md`）；`DOC-STYLE.md` 是唯一**零版本断言**的权威文档（无需改）。
2. **硬编码断言位置 = 209 处 / 17 份文件**（按行去重后：`README.md` 6、`FEATURE-MAP.md` 5、`01-arch` 4、`02-plugin` 2、`03-model` 1、`04-ops` 10、`office-handoff` 23、`runbooks/README` 1、`verify-runbook` 3、`switch-web2` 22、`port-taste` 17、`port-tokps-web2` 11、`port-vision-adam` 21、`port-wallpaper` 17、`WRP/README` 4、`UPGRADE-STOP` 7、`WRP/RUNBOOK` 11 ≈ 165 行级位置、逐项计值 209 处）。**分类**见 §2。
3. **最关键的三条发现**：
   - **① `docs/runbooks/switch-web2-runbook.md:97` 的 `dsh-vision-adam-0.2.0` 是插件自身版本号，与 DSH 版本无关 ⇒ 不得改。** 实测 `~/dsh-upgrade-backup/dsh-vision-adam-0.2.0/package.json:2-4` = `@deepseek-ai/dsh-vision-adam` / `version: 0.2.0`；同值另见 `~/dsh-upgrade-backup/20260925-110042/local-plugins/dsh-vision-adam/package.json:4`。**它是全仓唯一一个"0.2.0 不是迁移目标版本"的陷阱**（`grep -rn '0\.2\.0-rc\.1'` 在权威文档中 **0 命中**，11 个命中全在 `.workspace/` 与 `_audit/` 下的 0.2.0 包树内）。
   - **② `workbuddy-reverse-proxy/README.md:118` 的 engines 断言语义已过期但结论方向仍成立、而 `:134` 的复述已彻底失效。** 实测插件 1.3.19 的 `dsh.engines.dsh`（`_audit/plugin-1.3.19/package/package.json` 与 `_audit/ghn-package.json`，后者 = GitHub HEAD，逐字相同）为三段 OR：`>=0.1.2-alpha.2 <0.2.0 || >=0.1.5-rc.3 <0.1.5 || >=0.1.7-rc.1 <0.1.7`。用现役 `0.1.1-rc.2` 自带 `semver` 实跑：`0.1.1-rc.2 → false`、`0.1.7-rc.2 → true`、`0.2.0-rc.1 → false`（`{includePrerelease:true}` 下为 `true`，即**取决于 DSH 侧是否带该标志**，本档未定位到校验点，见 §6 未验证项 1）。⇒ `:118` 的"三段式"描述应先于结论修正、且缺 **0.2.0 不许装** 这一新约束；`:134` 的"本机 0.1.1-rc.2 不满足"**已被版本演进作废**（`0.1.7-rc.2` 满足第 3 段），但它属于"某个历史时点的实测记录"，**必须标注时点或改写为历史档**，不能留着当现行结论。
   - **③ `verify-runbook.md` 的 md5 验收指纹在 0.2.0 下必然不成立，且它现在就已经漂移。** 实测 `md5sum`：仓库 `dsh-btw/lib/client.js` = `925c435537d7820372eb5da4d20c11c1` / **368 509 B**（mtime 2026-09-25 10:34），部署位 = `66beb3455c59f4991355f3918228e495` / 365 269 B（mtime 2026-09-23 18:23）⇒ **`cmp` 报告 DIFFERS**，即 `docs/architecture/05-performance-and-ux-program.md:160/:83` 与 `FEATURE-MAP.md:25` 反复断言的「**served == 部署位 == 仓库**」**当前即为假**（仓库构建比部署位新、比文档记录值新）；`dsh-btw/lib/index.js` 同形（仓库 `c1d5ef2c507ba97f9ccbf358b66d6143` / 70 356 B vs 部署位 `e1437b3ba7de953811e65c47d5b392e5` / 67 542 B）。所以 `docs/runbooks/verify-runbook.md:63` 的「**应为** `66beb345…`」是不可执行配方，0.2.0 重建 bundle 后会再变一次。

---

## 0.5 协调者插播校正（2026-09-29 追加，第二轮实测）

> **性质**：协调者插播证据校正的落地。本节全部为新跑实测，**修正本档 §0/§6 中依赖 `MEASURED-BASELINE.md`/`PLAN.md` 转述的表述**。本档为 **T31（文档/清单面）**，非 T30；故本节只处理**会传播进文档的结论**，btw 代码面裁决归 T30。

### 0.5.1 两类依据的强制区分（本档后续所有结论按此标注）

| 标记 | 含义 | 强度 | 本档用例 |
|---|---|---|---|
| `【lib全等】` | `diff -r <017>/<pkg>/lib <020>/<pkg>/lib` 无输出 ⇒ **推定未变**（哈希/逐文件比对层面） | 中：排除改动，不证明语义；**未读源码** | `dsh-tool-subagent`=0、`dsh-tool-subagent-control`=0、`dsh-tools`=0、`dsh-settings`=0、`dsh-client-connection`=0、`dsh-attachment`=0、`cordis` 全等 |
| `【源码实读】` | 打开 0.2.0 文件读了具体代码/注释/导出 | 高：可据以写契约 | `dsh-agent-loop/lib/index.js`（`ToolCallRecovery` 接线）、`dsh-session/lib/types/repair.js`（`CLOSER_TEXT`/`results()`/两个码常量） |
| `【宿主先例推定】` | 用"现役 0.1.1-rc.2 上某插件实际加载成功"反推校验语义 | 中高：实测现象 + 语义推论 | §0.5.4 的 `includePrerelease` 结论 |

**禁止**：把 `【lib全等】` 当作"契约未变"的充分证据；按 lib 口径判定，`package.json` 里只有版本号字符串的差异**不算改动**。

### 0.5.2 校正 #3 落地核实：`dsh-tool-subagent-control` **不是 0.2.0 新增包**（`【源码实读】`+目录实测）

实测（两棵树同时存在、版本号不同）：

| 事实 | 实测值 |
|---|---|
| 0.1.7 树内该包 | `~/.npm-global-dsh017/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tool-subagent-control/package.json` → `version: 0.1.7-rc.2` |
| 0.2.0 树内该包 | `.workspace/iso-020/npm-global/node_modules/@deepseek-ai/dsh-tool-subagent-control/package.json` → `version: 0.2.0-rc.1` |
| 该包 `lib/` 逐文件比对 | `diff -r` = **0 条差异** ⇒ `【lib全等】` 推定未变 |
| `package.json` 层面差异 | **仅 `version` 字符串**（依赖键集合相同） |

**同法实测的包名集合增量**（`comm` 两棵树目录名）——**真正新增的 `@deepseek-ai/*` 只有 5 个**（另 1 个 `dsh` 是 CLI 顶层）：
`dsh-client-product-analytics`、`dsh-client-ui-settings-session-log`、`dsh-experimental-schedule-bundle`、`dsh-host-product-telemetry-otel`、`dsh-otel`。
**`dsh-skill-office`、`dsh-tool-subagent-control`、`dsh-workflow-ptc` 三个"被写成新增"的包，实测 0.1.7 已存在** ⇒ 与 `.workspace/audit-020/churn-lib-017-020.txt` 末尾 `ANOMALOUS` 行（只列 5 个 `[NEW-PKG]` + `dsh-web-frontend`/`libreoffice-kit-wasm`/`node-addon-system-linux-x64` 为 `[NO-LIB-BOTH]`）**一致**。
⇒ **`PLAN.md:13`「0.2.0-rc.1 相对 0.1.7 新增依赖：`dsh-skill-office`、`dsh-tool-subagent-control`、`dsh-workflow-ptc`」是错的**（同句尾括注「另有一批已在 0.1.7 存在」与之自相矛盾），**`MEASURED-BASELINE.md` §3 的同类转述亦须更正**；否则执行档会把这条错误事实写进 notebook 与架构文档（见 §5 N-09）。
**处置**：重叠关系必须以 `【lib全等】` 判定——`dsh-tool-subagent-control` 在 0.1.7→0.2.0 **代码未变**，故**不是** btw 的重构起点。

### 0.5.3 校正 #5 落地核实：release note 的修复**确实落在 `dsh-agent-loop`**，且机制已 `【源码实读】` 确认

release note 原文（`MEASURED-BASELINE.md` §5）：「修复工具调度异常后对话无法继续的问题；**已执行但结果未知的操作会提示先核实副作用，不盲目重试**」——**在 0.2.0 代码里找到逐字对应的实现**：

- **接线点（`【源码实读】`）**：`.workspace/iso-020/npm-global/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js`
  - import 行新增 `ToolCallRecovery`（相对 0.1.7 的同一行：`... canonicalHeader, headerEquals, interruptedTurnClosers, isReplacementSurfaceEvent` → 插入 `ToolCallRecovery`）。
  - 步骤失败路径新增守卫：`const toolRecovery = new ToolCallRecovery(); const stopRecovery = this.ctx.on("session/event", (session, event) => { if (session === this.session) toolRecovery.observe(event); });`
  - `catch` 分支内：把 `toolRecovery.results()` 逐条 `this.session.append("tool/result", event.data, { surfaceOp: "append", ...sourceEventSeqs })`；写入失败则抛 `AggregateError([error, recoveryError], "Step failed and its pending tool results could not be recorded")`。
  - 代码注释的变化方向（0.1.7「**without fabricating tool results**」→ 0.2.0「the owning step records conservative recovery results before closing」）**证明这是行为反转，不是纯重构**。
- **被写出的内容（`【源码实读】`）**：`dsh-session/lib/types/repair.js`
  - `export const TOOL_NOT_STARTED = 'TOOL_NOT_STARTED'`（`:11`）、`export const TOOL_OUTCOME_UNKNOWN = 'TOOL_OUTCOME_UNKNOWN'`（`:13`），经 `dsh-session` 顶层导出（`lib/index.js:1933`；`types/index.d.ts:21` 从 `./repair.ts` 再导出）。**0.1.7 的 `dsh-session/lib/index.js` 中该标识符出现 0 次** ⇒ 三个符号为 0.2.0 新增公共面。
  - `ToolCallRecovery.results()`（`lib/types/repair.js:~134-170`）对每个未收到匹配结果的待决 `tool/call` 产出**合成 `tool/result` 事件**：`role:'tool'`、`isError:true`、`source:{kind:'tool',callId}`、`content:[{type:'text', text: started ? text.started : text.notStarted}]`、`error: {name:'ToolOutcomeUnknownError', code:TOOL_OUTCOME_UNKNOWN}` 或 `{name:'ToolNotStartedError', code:TOOL_NOT_STARTED}`、`surfaceOp:'append'`、`started` 时附 `sourceEventSeqs:[callSeq]`。
  - `CLOSER_TEXT` 的**模型可见文案**（en）逐字取自 `:15-24`：`interrupted.started` = 「…no result was durably recorded. **Its outcome is unknown.** Decide whether to retry from the tool semantics: retry only if the operation is read-only or idempotent; **if it may have side effects, first verify external state or ask the user. Do not retry blindly.**」（`forked` 变体同义）——**这就是 release note 那句话的实现**。
- **"部分改动"文件清点（`【lib全等】`否定式 + 文件名实测）**：`dsh-agent-loop` = 10 文件中 2 改（`lib/index.js`、`lib/types/tool-calls.d.ts`）；`dsh-session` = 24 文件中 5 改（`index.js`、`types/{index,repair}.{js,ts}`）；`dsh-session-log-deepseek` = 8 中 3 改（`index.js` + 2 个 types）；`dsh-client-ui-conversation` = 72 中 7 改 + 1 新增（`client.js`、若干 `types/**/*.d.ts`、新增 `types/client/input/submission-analytics.d.ts`）；`dsh-session-reference` = 19 中 1 改（`typert.host.js`）。**与协调者给的比率逐条相符。**

**对 btw 插播/结论回传路径的影响（跨轨道观察，`【源码实读】`+`【lib全等】`，最终裁决归 T30）**：

1. `btw_ask_user` 是经 `tool/call` 登记的宿主工具 ⇒ **当该步骤以调度异常终止时，会话里会出现一条 btw 从未产生的合成 `tool/result`**（`isError:true`），文案不含用户答复。
2. btw 宿主侧**已能正确处理该事件形状**（`./dsh-btw/src/host/side-chat-service.ts:598-606`：从 `event.data.message.content[0]` 取 `block.toolCallId` 关联 → `digest.result = contentText(block.content)`、`digest.isError = block.isError === true`、`delete digest.running`）——**恰好只依赖 0.2.0 合成事件同样具备的 `toolCallId` / `content[].text` / `isError` 三个字段** ⇒ `【源码实读】` 层面**未发现需要改代码的契约缺口**。
3. 但**语义面存在一处需 T30 确认的行为缺口**：合成结果的文案是给**模型**的"不要盲目重试"指引，而 btw 抽屉是**给人**看的；用户可能看到一条"操作结果未知"的红字而不知其原因。`【lib全等】`+`grep` 实测：编译产物 `dsh-btw/lib/index.js`、`lib/client.js` 中 `TOOL_OUTCOME_UNKNOWN` / `ToolCallRecovery` 出现 **0 次** ⇒ btw **目前不会**把该情形与"用户答了/没答"区分开。
4. btw 的 peer 面已实测（见 §0.5.4）：`@deepseek-ai/dsh-session = ">=0.1.1-rc.2 <0.2.0"` **拦不住 0.2.0-rc.1**，这与 `dsh-session` 正是本次改动包（`20.8%`）叠加 ⇒ **「btw 需重点关注的第一处 = dsh-session 的 peer + 合成结果语义」**。

### 0.5.4 由实测衍生的一条新硬发现：本地插件 peer 区间对本迁移的拦截量（`【宿主先例推定】`）

逐包实测现役 `~/.dsh/profiles/node_modules/@local/*` 的 `peerDependencies`（**只统计 harness 自身包**，第三方 stable 单列）：

| 包 | harness peer 条目 | 默认语义不满足 | 含 prerelease 不满足 |
|---|---|---|---|
| `@local/dsh-btw` | 16 | 16 | **0** |
| `@local/dsh-pptmaster` | 16 | 16 | **16** |
| `@local/dsh-ssh-gui` | 2 | 2 | **0** |
| `@local/dsh-subagent-model` | 1 | 1 | **0** |
| `@local/dsh-usage` | 2 | 2 | **0** |
| `@local/dsh-wallpaper` | 5 | 5 | **0** |
| `@local/dsh-web-search-sse` | 4 | 4 | **4** |
| `@local/dsh-workerspace` | 6 | 6 | **6** |
| **合计** | **52** | **52** | **26** |

- **26 项属"纯锚定更新"**：区间形如 `>=0.1.1-rc.2 <0.2.0`，把上界放到 `0.2.1` 即可接受 `0.2.0-rc.1`；`dsh-btw` 的 16 项**全部**属此类（⇒ btw 的 peer 面**没有硬冲突**，这是**缩小**工作量的证据）。
- **26 项是"改区间本身"**：区间形如 `^0.1.1-rc.2`（`dsh-pptmaster` 16 项、`dsh-web-search-sse` 4 项、`dsh-workerspace` 6 项）——`^0.1.1-rc.2` 对 `0.2.0-rc.1` **在两种语义下都为 false**（实测），**必须**改写为 `^0.2.0-rc.1` 或 `<0.2.0` 等价新锚。
- **第三方 stable peer 不是阻断**（实测）：`@deepseek-ai/cordis ^4.0.1`、`@deepseek-ai/schemastery ^3.18.1` 在两棵树内分别为 **4.0.4 / 3.18.4（未变）**，且 `cordis/lib/` `【lib全等】`，仍落在范围内 ⇒ 上一版本档若把它们计入"不满足"会**虚增 13 项**，现更正。
- **判定 `includePrerelease` 语义的实证**（`【宿主先例推定】`）：`@local/dsh-btw` 现役 peer 为 `>=0.1.1-rc.2 <0.2.0`，而实测 `>=0.1.1-rc.2 <0.2.0` 对**自身版本 `0.1.1-rc.2` 在默认语义下为 `true`**、对 `0.1.7-rc.2` **只在 `includePrerelease` 下为 true**。结合「现役插件在这两个版本树上都实际加载成功」这一现象 ⇒ **加载器的实际行为与 `includePrerelease` 一致**（仅现象+推论，**未读到校验代码**；本档 §6 未验证项 1 维持）。

### 0.5.5 工作量结论：**较 0.1.7 那轮的"改写文档"工作量显著更小**（如果证据支持就明说）

**证据支持"更小"，且给出可核查的边界**：

| 维度 | 0.1.7 那轮的形状（据 `office-handoff.md` §5.2 等既有档） | 0.2.0 的实测形状 | 判定 |
|---|---|---|---|
| 内核代码面 | 会话格式 v0→v3/v4 硬阻断、decriptor v2 故障 1679 例、btw 18 破坏点 | CLI 引导层三版本逐字节相同、`225/280` 包 `lib/` 全等、仅 55 包有真实改动 | **显著更小** |
| btw 相关包 | btw 自身 18 破坏点 + seed/header ABI 迁移 | `dsh-tool-subagent`/`dsh-tool-subagent-control`/`dsh-tools`/`dsh-settings`/`dsh-client-connection`/`dsh-attachment` 全部 `【lib全等】`；仅 `dsh-session`(5/24)、`dsh-client-ui-conversation`(7+1/72)、`dsh-session-log-deepseek`(3/8) 有改动 | **更小但非零**；焦点收敛到 3 个包 |
| 插件 peer 面 | 需整包迁移/替换（btw 整目录换 D7） | 52 项不满足中 **26 项纯锚定**、26 项需改区间；**无第三方 stable 阻断** | **更小**（仍是工作量主体） |
| 文档面 | 新建 `office-handoff.md` 等大量新档 | 只需 17 份文档改版本锚 + 4 份 0.1.5 轮次档整体历史档化 | **更小**（机械改动为主） |

**但文档面的绝对量仍不可省**：本档 §2 的 209 处断言中，**≈150 处是"版本基线段 + 历史档时点标注"这类必须逐条过一遍的机械改动**（`README.md`/`FEATURE-MAP.md`/`01`–`04` 文档/`office-handoff.md` 的 5 个版本行 + 4 份 `port-*.md` + `switch-web2` 的横幅）。**可由"更小"推出的具体削减项 = 3 条**：① 不需为 55 包中与本机定制无关者写兼容说明；② btw 的 peer 面按 §0.5.4 只做锚定更新、无需重构；③ `dsh-tool-subagent-control` 不构成新增重叠面（§0.5.2）⇒ **不写"0.2.0 新增 subagent-control ⇒ btw 需重构"这类伪需求**。

---

## 1. 权威文档盘点表

分类图例：**A** = 版本基线段（写死现役版本，必改）；**B** = 部署/路径/进程断言段（端口、profile、符号链接农场、PID）；**C** = 产物指纹段（md5/字节/`?rev=`）；**D** = 历史档（应标时点/归档，不改数值）；**E** = 迁移对象本身（0.2.0 要改写其内容，不仅是改版本号）。

| # | 文件 | 记录了什么 | 0.2.0 迁移会作废/改写什么 | 类 |
|---|---|---|---|---|
| 1 | `README.md` | 仓库定位、状态词汇、文档分层、部署 Runbook 索引、**运行时依赖 = DSH 本体当前版本** | **L16**「与它实际运行的 DSH 构建版本（当前 `0.1.1-rc.2`）保持一致」= 全仓版本锚点；**L162**「DSH 本体（当前 `0.1.1-rc.2`，全局安装于 `~/.npm-global/...`）」；**L125** 冒烟 URL 写死 3080；**L24**「延期（如 0.1.5 的 S15/S16 workspace UI）」；**L120/L140** 0.1.5 借码批次的现行性。⇒ L16/L162 必改；L120/L140/L24 需加"历史批次"时点或保留（不改数值） | A B D |
| 2 | `FEATURE-MAP.md` | Tier 2 能力状态表（每项带日期与证据指针） | **L17** 页首「部署基线：DSH `0.1.1-rc.2`（profile web）」；**L25** btw 行内 4 处产物 md5/字节/`?rev=`（`66beb345…`/365 269 B/`887a12106dcd`、`88de97e6…`/`363 814 B`、`e1437b3b…`/67 542 B）+ 部署命令 `cp -a dsh-btw/lib/client.js ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/client.js`；**L42/L44** 0.1.5 借码批次与 `dsh-tool-subagent` P0' 补丁的现行性（其中「该开关要求的宿主半边模块在本版本树（**0.1.1-rc.2**）不存在」是**版本绑定的事实断言**，0.2.0 上不成立） | A C D E |
| 3 | `docs/architecture/01-architecture-overview.md` | 归属表、仓库布局、模块清单、数据流、生命周期 | **L5** 页首基线 `0.1.1-rc.2`；**L90/L91** `deploy-lag`/`deploy-015`「0.1.5 借码」的现行性；**L108** 数据流图 `Web GUI 127.0.0.1:3080`。⚠️ **L58–L67 自装插件表写死各插件版本（`0.4.0-btw.1`/`0.1.0`/`0.5.0`）与 peer 面** —— 0.2.0 若改 peer 区间，此表同步失效（本档未逐条改，见 §5） | A B |
| 4 | `docs/architecture/02-plugin-system.md` | 插件契约、settings 槽、组合图装载、冷热边界、部署形态 | **L5** 页首基线；**L157–L163**「部署形态」表写死 `~/.dsh/profiles/node_modules/@local/`、实体清单、符号链接农场；⚠️ **L189**「包版本 `0.1.1-rc.2`」（`dsh-skill-filesystem` 的 provider 发现，**包版本号写死**）；**L165/L173** 两条硬约束（绝不 npm/pnpm install）**不随版本变化，应保留** | A B |
| 5 | `docs/architecture/03-model-routing-gateway.md` | provider 清单、settings 字段分布、子代理路由合并层、图像能力 fail-closed 链、vision-adam | **L5** 页首基线（**全文件唯一版本断言**）。§4.3「本部署的实际生效路由（与旧文档冲突，以本节为准）」是活的 settings 值，**与本迁移解耦但需重取** | A |
| 6 | `docs/architecture/04-ops-deploy.md` | 脚本清单、fail-closed 契约、`dsh-restart.sh` 五道闸、端口/profile/符号链接农场、验收矩阵、备份布局 | **L5** 基线；**L33** `patch-official-015.sh`「`0.1.5-rc.2` 增量借码重放」；**L39** `apply-restore.sh`「web profile `0.1.1-rc.2`」；**L47** `baseline-011/fetch.sh`「批量下载 `0.1.1-rc.2` 各包 tgz」；**L113** `DSH_WEB_URL` 默认 `http://127.0.0.1:3080/`；**L137** 默认端口 3080 且「冒烟 URL 在脚本里固化」；**L149/L161/L172** 3080 单进程判定法与 PID 纪律；**L240**「`~/.dsh/profiles/web2/`（据称 0.1.5 归档树、已废弃）的存在性与状态未核实」⇒ **本档已核实：不存在**（见 §3.2） | A B D |
| 7 | `docs/architecture/05-performance-and-ux-program.md` | 性能/体验专项因果总图、五条跨线发现、**更正清单（引用前必查）** | **零版本断言**（`grep 0.1.x` = 0 命中）是它的优点，但 **L81/L83/L160** 的产物指纹与「served == 部署位 == 仓库」断言（含 `cp -a` 回滚配方）在 0.2.0 重建后失效，且**现已与实测不符** | C |
| 8 | `docs/architecture/office-handoff.md` | **办公投递（Route A）+ 升级闸门**：已裁决前提 N1/N2/Q1/Q2/Q3、当前状态、证据索引、维护触发条件 | **本档是 0.2.0 迁移的"改写对象"而非"改版本号对象"**。写死 `0.1.7-rc.2` 为升级线目标（**L178**「NOT READY / STOP（`0.1.7-rc.2`）」）、写死 `~/.dsh-017`+`~/.npm-global-dsh017` 为隔离面（**L27 / L187 / L254**）、写死 3097 `LISTEN`、写死「任何新插件/新 patch 行落地前必须先过 **0.1.7** 兼容核对」（**L204**）、写死 Q3「在隔离 **0.1.7** 副本迁移本地 SSE 插件」（**L127 / L206**）、以及 **L269** 的维护触发条件本身（"升级线状态变化 ⇒ 更新 §5.2/§5.3"）会被 0.2.0 触发 | E A B C |
| 9 | `docs/runbooks/README.md` | Runbook 索引（场景→入口→回答什么）+ 三条使用前必读 | **零版本断言**，但 **L33** 的 PID 判定法（「3080 由单一进程持有 + HTTP 200 + 旧 PID 消失」）依赖 3080 语义；三条必读里的第 3 条「绝不执行 npm/pnpm install」**应保留**。**索引表第 1 行指向 switch-web2（见 §3.2）需要重新定性** | B D |
| 10 | `docs/runbooks/verify-runbook.md` | btw + 壁纸端到端验收（重启后执行）：0 重启 / 1 btw 十步 / 2 壁纸十二步 / 3 故障排查 | **L11 / L54** 刷 3080；**L63** btw 客户端 bundle **md5 判据**（`66beb345…` / 365 269 B / `?rev=887a12106dcd`，并给两个回溯档）+ 部署位 `~/.dsh/profiles/node_modules/@local/dsh-btw/lib/` 的 `cp -a` 配方。⇒ **0.2.0 重建后 md5/字节/rev 全变、部署位形态若变则 `cp -a` 配方失效**；且本档实测仓库构建已不同于该 md5 | C E |
| 11 | `docs/runbooks/switch-web2-runbook.md` | 「web2(0.1.5-rc.2) 切换 Runbook（已验证版）」：移植清单、已知行为差异、3081 独立验收、**切换 web2 接管 3080**、回退、备份与安全 | **整份被 0.2.0 取代**：L1/L3 目标 = 切到 `0.1.5-rc.2`；L11/L14/L15/L17/L22/L24/L25 全是 0.1.5 引入的行为差异（浏览器认证、v0→v3 迁移链）；L30/L74 `cd ~/.dsh/profiles/web2`（**不存在**）；L66–L90 切换/回退动 3080（**0.2.0 不得照抄**）；**L97 `dsh-vision-adam-0.2.0`（不得改，见 §3.1）** | E D |
| 12 | `docs/runbooks/port-taste.md` | `dsh-taste` 宿主 bridge `0.1.1 → 0.1.5` 移植报告（API 差异、安全围栏映射、线上格式比对） | 17 处版本断言全部是 `0.1.1/0.1.5` 对比；**L47** `cd /home/CNS2026495165/.dsh/profiles/web2`（**不存在**）；**L58** 写死 pid `1811911`。⇒ 作为历史移植档**保留数值 + 加时点**，或整体标"0.1.5 时代，0.2.0 未复核" | D B |
| 13 | `docs/runbooks/port-tokps-web2.md` | 子代理 tok/s 显示 `0.1.1-rc.2(web,已打补丁) → 0.1.5-rc.2(web2)` 移植报告 | 11 处版本断言；**L4/L35/L68** 目标文件写死 `/home/CNS2026495165/.dsh/profiles/web2/node_modules/@deepseek-ai/dsh-client-ui-subagent/lib/...`（**目录不存在**）。⇒ 同上：历史档化 + 更正路径 | D B |
| 14 | `docs/runbooks/port-vision-adam.md` | vision-adam 宿主侧 `0.1.1-rc.2 → 0.1.5-rc.2` 移植报告（`installSettingsSection` 被删、`installSection` 替代、peer 未改） | 21 处版本断言；**L5/L82/L89** 路径写死 `~/.dsh/profiles/web2/...`（**不存在**）；**L128/L129**「与 0.1.5 实际安装版本（`^0.1.5-rc.2`）兼容；如需严格化可上调为 `^0.1.5-rc.2`（任务只允许改 index.js，故未动）」⇒ **0.2.0 下这个"未动"的 peer 会变成加载闸门**（见 §5 交付单元 T31-U07） | D B E |
| 15 | `docs/runbooks/port-wallpaper.md` | `@local/dsh-wallpaper` 移植报告 `0.1.1-rc.2 → 0.1.5-rc.2` | 17 处版本断言；**L16/L17/L84** 路径写死 `~/.dsh/profiles/web2/...`（**不存在**）；**L107/L108**「`"@deepseek-ai/dsh-settings": ">=0.1.1-rc.2 <0.2.0"` … `0.1.5` 落在该范围内，无需改；**若后续 0.2.0 破坏兼容再收紧**」⇒ **这句就是本迁移的预言，现在必须执行它** | D B E |
| 16 | `workbuddy-reverse-proxy/README.md` | WorkBuddy 反代调研主报告（历史调研存档）+ §2.5 第三方插件对比表 | **L3** 顶部警示「目标改为 DSH `0.1.7-rc.2` + 第三方 WorkBuddy 插件，但升级被…阻断」；**L96**「端口 7863/7864 空闲（**3080 是 DSH GUI，勿撞**）」；**L118** engines 断言（详见 §3.3）；**L134** engines 断言复述「要求 DSH ≥0.1.2-alpha.2（本机 0.1.1-rc.2 不满足）」 | E D |
| 17 | `workbuddy-reverse-proxy/UPGRADE-STOP-0.1.7.md` | **升级线权威安全闸门**：已验证/未完成清单、允许继续的工作、验收必含项 | **L1** 标题「DSH 0.1.7-rc.2 升级：当前禁止切换现役实例」；**L7** 旧安装 85 文件 MD5 复验；**L8** 3099；**L9** 旧会话硬阻断计数（1889/1680）；**L10** 插件硬阻断（btw 0.1.7 seed/header）；**L11** 配置硬闸（0.1.7 读 `settings.yaml` 前改名 `.imported`）。⇒ **闸门本体必须由用户裁决后重锚到 0.2.0，本档不得代改** | E D |
| 18 | `workbuddy-reverse-proxy/RUNBOOK.md` | 反代线总 Runbook（44 617 B）+ fail-closed 阻断横幅 | **L3** 「🔴 FAIL-CLOSED 阻断（DSH **0.1.7** 升级线）」；**L6** 指向 0.1.7 验收/切换 Runbook 正本；**L13** 会话 descriptor v2 故障计数（**0.1.1-rc.2 写 v2，0.1.7 读取器只认 v3**）；**L16** `v3→v4` 未实跑；**L440** `dsh --version # 本机实测：0.1.1-rc.2`；**L445** 插件表 | E D A |
| — | `DOC-STYLE.md` | 文档风格约定（语言、归属表、状态词汇、Tier、来源纪律） | **零版本/端口/路径断言**（实测 `grep 0.1.x` = 0 命中）⇒ 0.2.0 **不需要改**。但其 §6「状态词汇必须带日期」是后续所有更新的**格式约束**，执行档须遵守 | — |

**计数**：权威文档 **18 份**（含 `DOC-STYLE.md`）；**需更新 = 17 份**（`DOC-STYLE.md` 零命中）。其中 `docs/program-notebook.md` 归 skill，不在本档写入面。

---

## 2. 硬编码版本与路径清单（文件 + 行号 + 现值 + 应改为）

> **应改为的形态**原则（请执行档遵守）：
> - **版本号**：`0.1.1-rc.2`（现役基线）→ **`0.2.0-rc.1`**；`0.1.5-rc.2` / `0.1.7-rc.2`（历史移植基线与旧升级目标）→ **保留数值 + 前置「（历史基线，0.2.0 未复核）」或加日期**，**不要替换成 0.2.0**（否则伪造历史）。
> - **端口**：现役 `3080` 语义保留（它仍是现役 GUI）；`3097` 需标「0.1.7 隔离实例（**该实例非 0.2.0 试验场**）」；**020 试验端口约定 = `31xx`，但本档未定值 ⇒ 见 §6 未验证项 2**。
> - **隔离路径**：`~/.dsh-017` / `~/.npm-global-dsh017` 是 **0.1.7 那一轮**的隔离面，**应保留并明确标注轮次**；0.2.0 需要**新增**一条 `~/.dsh-020` / `~/.npm-global-dsh020`（或工作区内 `.workspace/iso-020/…`）约定 —— 实测权威文档中 **`dsh-020`/`iso-020` 0 命中**，即**尚无约定**（见 §5 T31-U01）。

### 2.1 版本号断言（逐条）

| # | 文件 : 行 | 现值（摘） | 应改为 | 依据 |
|---|---|---|---|---|
| V-01 | `README.md:16` | 「与它实际运行的 DSH 构建版本（**当前 0.1.1-rc.2**）保持一致」 | `0.2.0-rc.1`（并给日期）；若现役尚未切换，写「现役 `0.1.1-rc.2` / 迁移目标 `0.2.0-rc.1`」双值 | 本档实测现役 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/package.json:4 = 0.1.1-rc.2` |
| V-02 | `README.md:24` | 「**延期** …（如 **0.1.5** 的 S15/S16 workspace UI）」 | 保留；加「0.1.5 时代判断，0.2.0 的 UI 面需重判」 | 该句是判断而非版本锚 |
| V-03 | `README.md:120` | `bash patch-official-015.sh  # 0.1.5 借码 12+ 单元` | 保留脚本名；**加"0.1.1→0.1.5 借码批次，非 0.2.0 路径"** | 脚本对象是 0.1.1 树 |
| V-04 | `README.md:140` | 「0.1.5 借码补丁重放（脚本 `--help` 内嵌 Runbook）」 | 同上（标历史批次） | 同上 |
| V-05 | `README.md:162` | 「DSH 本体（**当前 0.1.1-rc.2**，全局安装于 `~/.npm-global/...`）」 | `0.2.0-rc.1`（或双值）；`~/.npm-global/...` 路径**实测成立**应保留 | 同上 |
| V-06 | `FEATURE-MAP.md:17` | 「部署基线：DSH **0.1.1-rc.2**（profile web）」 | `0.2.0-rc.1`（或双值 + 日期） | 同 V-01 |
| V-07 | `FEATURE-MAP.md:44` | 「…该开关要求的宿主半边模块在本版本树（**0.1.1-rc.2**）**不存在**（仅 0.1.5 归档树有）」 | **必须重判**：0.2.0 树是否已含 `./model-selection-settings` export；不改则留下错误版本事实 | 版本绑定事实断言，见 §5 T31-U06 |
| V-08 | `FEATURE-MAP.md:42` | 「**0.1.5 借码批次**（`patch-official-015.sh`）…」 | 保留 + 标历史批次 | 同 V-03 |
| V-09 | `01-architecture-overview.md:5` | 「**部署基线**：`@deepseek-ai/dsh` **0.1.1-rc.2**（profile `web`）」 | `0.2.0-rc.1` / 双值 + 数据时点 | 同 V-01 |
| V-10 | `01-architecture-overview.md:90` | `deploy-lag/` …（**0.1.5** 借码重放） | 保留 + 标历史 | 同 V-03 |
| V-11 | `01-architecture-overview.md:91` | `deploy-015/` | **0.1.5** 借码批次的补丁与完整副本 | 保留 + 标历史 | 同 V-03 |
| V-12 | `02-plugin-system.md:5` | 「**部署基线**：`@deepseek-ai/dsh` **0.1.1-rc.2**（profile `web`）」 | `0.2.0-rc.1` / 双值 | 同 V-01 |
| V-13 | `02-plugin-system.md:189` | 「…包版本 **`0.1.1-rc.2`**，config schema…」（`dsh-skill-filesystem`） | 改为 0.2.0 树内 `dsh-skill-filesystem` 的真实版本（**须重取**） | 包版本随版本树变 |
| V-14 | `03-model-routing-gateway.md:5` | 「**部署基线**：`@deepseek-ai/dsh` **0.1.1-rc.2**（profile `web`）」 | `0.2.0-rc.1` / 双值 | 同 V-01 |
| V-15 | `04-ops-deploy.md:5` | 「**部署基线**：`@deepseek-ai/dsh` **0.1.1-rc.2**（profile `web`）」 | `0.2.0-rc.1` / 双值 | 同 V-01 |
| V-16 | `04-ops-deploy.md:33` | `patch-official-015.sh` \| **0.1.5-rc.2** 增量借码重放脚本（P0/P1/P2 全采纳） | 保留 + 标历史 | 同 V-03 |
| V-17 | `04-ops-deploy.md:39` | `apply-restore.sh` \| 插件恢复应用脚本（web profile **0.1.1-rc.2**） | 保留 + 标「0.1.1 时代」 | 该脚本对象是 0.1.1 树 |
| V-18 | `04-ops-deploy.md:47` | `baseline-011/fetch.sh` \| 批量下载 **0.1.1-rc.2** 各包 tgz | 保留 + 标「0.1.1 基线抓取，不可用于 0.2.0」 | 同 V-17 |
| V-19 | `04-ops-deploy.md:240` | 「`~/.dsh/profiles/web2/`（据称 **0.1.5** 归档树、已废弃）的存在性与状态**未核实**」 | 改为已核实结论：**该目录不存在**（本档实测 `~/.dsh/profiles/` 下仅 `node_modules` 与 `web`） | 本档实测 |
| V-20 | `office-handoff.md:178` | 「### 5.2 升级线：**NOT READY / STOP**（`0.1.7-rc.2`）」 | 升级线目标重锚 `0.2.0-rc.1`；0.1.7 轮次移入历史小节 | 迁移目标改锚（PLAN.md §目标锚点） |
| V-21 | `office-handoff.md:127 / :206` | Q3「在隔离 **0.1.7** 副本**迁移本地 SSE 插件**（保留 SSE/citations）」 | 裁决保留；把「0.1.7 副本」改为「0.2.0 隔离副本」（裁决的**对象**变了，**内容不变**） | 同上 |
| V-22 | `office-handoff.md:129 / :130` | Q1「跟随 **0.1.7** 图标」/ Q2「受审副本安装版本匹配的 **0.1.7** 宿主 peer 包」 | 同上：裁决保留、轮次改 0.2.0 | 同上 |
| V-23 | `office-handoff.md:204 / :275` | 「任何**新插件 / 新 patch 行**在落地前必须先过 **0.1.7** 兼容核对」 | 改为 **0.2.0** 兼容核对（这是**纪律**，必须换版本） | 同上 |
| V-24 | `office-handoff.md:128` | 「现役 3080 与 `~/.dsh` 不得作为升级试验场」 | **保留（仍然成立且更重要）** | 本档实测两实例仍在监听 |
| V-25 | `office-handoff.md:1 / :24 / :182 / :230` | 标题与指针里的 `0.1.7 升级闸门` / `UPGRADE-STOP-0.1.7.md` / `19-5x` 迁移细档 | 顶部加「0.2.0 迁移轮次」小节指向新闸门；旧闸门标注为 0.1.7 轮次 | 闸门换名/换锚 |
| V-26 | `switch-web2-runbook.md:1 / :3` | 「# web2 (**0.1.5-rc.2**) 切换 Runbook（已验证版）」/「…从 profile `web`(`0.1.1-rc.2`) 切到并行 profile `web2`(`0.1.5-rc.2`)」 | **整份归档**（移 `docs/runbooks/archive/` 或顶部加「⛔ 0.1.5 轮次，0.2.0 迁移不得照抄」），并新写 0.2.0 切换 Runbook | 目标版本已改锚 |
| V-27 | `switch-web2-runbook.md:22 / :24 / :25` | §1「已知行为差异（**0.1.5 引入**，非故障）」：浏览器认证、v0→v3 迁移链 | 同上（历史档化）；0.2.0 需**重新实测**自身的迁移链（v3→?） | `MEASURED-BASELINE.md` §5 |
| V-28 | `switch-web2-runbook.md:11 / :14 / :15 / :17` | 移植清单四行（vision-adam `installSection`(0.1.5 真实方法)、btw/wallpaper/taste `client-store`、tok/s → 0.1.5 bundle、agent-loop 补丁「0.1.5 已无 `assistant/chunk`」） | 同上（历史档化） | 同上 |
| V-29 | `port-taste.md:1 / :3 / :8 / :11 / :12(×2) / :22 / :29 / :31 / :33 / :37 / :41(×2) / :42(×2) / :62 / :63` | 全部 `0.1.1` / `0.1.5` 对比断言 | 保留 + 顶部加「⛔ 0.1.5 轮次移植档；0.2.0 未复核」横幅 | 历史档纪律 |
| V-30 | `port-tokps-web2.md:1(×2) / :10 / :17 / :27 / :29 / :61 / :63` | 全部 `0.1.1-rc.2` / `0.1.5` 断言 | 同上 | 同上 |
| V-31 | `port-vision-adam.md:1(×2) / :11 / :17 / :18 / :21 / :37 / :39 / :44 / :50 / :60 / :61 / :73 / :96 / :115 / :128(×2) / :129 / :130 / :132` | 全部 `0.1.1-rc.2` / `0.1.5` 断言 | 同上；**特别注意 `:128-129`**「peer 仍写 `^0.1.0-rc.7`（后述「`^0.1.5-rc.2`」）… 任务只允许改 `index.js`，故未动」⇒ 0.2.0 下**必须动 peer**（§5 T31-U07） | 同上 + engines 闸门 |
| V-32 | `port-wallpaper.md:1(×2) / :5 / :10 / :24 / :31 / :45 / :54 / :55 / :61 / :75 / :89 / :101 / :107 / :108` | 全部 `0.1.1-rc.2` / `0.1.5` 断言 | 同上；**`：107-108` 的"若后续 0.2.0 破坏兼容再收紧"= 本迁移的触发条件，已触发** | 同上 |
| V-33 | `workbuddy-reverse-proxy/README.md:3` | 「目标改为 DSH **`0.1.7-rc.2`** + 第三方 WorkBuddy 插件，但升级被…阻断」 | 改为 `0.2.0-rc.1`；或保留并把整段标注为「2026-09-24 时点」 | 目标改锚 |
| V-34 | `wrp/README.md:134` | 「前者**要求 DSH ≥0.1.2-alpha.2（本机 0.1.1-rc.2 不满足）**」 | **必须改写**（详见 §3.3）：`0.1.7-rc.2` 已满足三段 OR 的第 3 段；现行约束应以 1.3.19 实测 `dsh.engines.dsh` 逐字为准 | 本档实测 |
| V-35 | `UPGRADE-STOP-0.1.7.md:1` | 「# DSH **0.1.7-rc.2** 升级：当前禁止切换现役实例」 | 文件名与标题保留（历史闸门）；**新建** 0.2.0 闸门或在本件顶部加 0.2.0 段 | 闸门换锚 |
| V-36 | `UPGRADE-STOP-0.1.7.md:7 / :8 / :9 / :10 / :11` | 85 文件 MD5 / 3099 / 1889·1680 计数 / btw 0.1.7 seed 硬阻断 / `settings.yaml → .imported` 硬闸 | **全部保留为 0.1.7 轮次记录**；0.2.0 需**逐条重测**（尤其 `.imported` 改名闸：见 §6 未验证项 3） | 每轮必须重取 |
| V-37 | `WRP/RUNBOOK.md:3 / :6 / :13 / :16` | fail-closed 横幅「DSH **0.1.7** 升级线」/ 指向 0.1.7 正本 / descriptor v2 计数 / `v3→v4` 未实跑 | 横幅加 0.2.0 段；`0.1.1-rc.2 写 v2，0.1.7 读取器只认 v3` 保留为历史机制说明，**0.2.0 的 descriptor 版本须重取** | 同 V-36 |
| V-38 | `WRP/RUNBOOK.md:440` | `dsh --version     # 本机实测：0.1.1-rc.2` | 改为「本机现役实测：`0.1.1-rc.2`（采样时点待填）」——本档实测该值**仍为真**，但必须带时点 | 本档实测成立 |
| V-39 | `WRP/RUNBOOK.md:445` | 插件表（含 `@axiaohungry/dsh-llm-workbuddy` v1.3.19） | 与 §3.3 同步修正 engines 表述 | 本档实测 |

### 2.2 端口 / 路径 / profile 断言（逐条）

| # | 文件 : 行 | 现值（摘） | 应改为 | 依据 |
|---|---|---|---|---|
| P-01 | `README.md:125` | 冒烟「✅ `http://127.0.0.1:3080/` (HTTP 200)」 | 保留（现役 GUI 仍是 3080）；若 0.2.0 换端口则同步 | `ss -ltn` 实测 3080 LISTEN |
| P-02 | `04-ops-deploy.md:113` | `DSH_WEB_URL`（默认 `http://127.0.0.1:3080/`） | 保留 | 同上 |
| P-03 | `04-ops-deploy.md:137(×2)` | 默认端口 **3080**（冒烟 URL 在脚本里固化为 `http://127.0.0.1:3080/`） | 保留；**加一句**「0.2.0 试验实例不得用 3080（见 §5 禁令）」 | 同上 + 隔离纪律 |
| P-04 | `04-ops-deploy.md:149 / :161 / :172` | PID 纪律 / 「**3080 由单一进程持有**」验收判据 / 四条命令 | 保留（判定法仍有效） | 同上 |
| P-05 | `runbooks/README.md:33` | 「由 PID 20806 持有 3080…判定法『3080 由单一进程持有 + HTTP 200 + 旧 PID 消失』」 | 保留判定法；PID 值本就要求标时点 | 同上 |
| P-06 | `verify-runbook.md:11 / :54` | 刷 `http://127.0.0.1:3080` / `curl -sI 127.0.0.1:3080` | 保留（现役验收对象） | 同上 |
| P-07 | `switch-web2-runbook.md:30 / :74` | `cd ~/.dsh/profiles/web2` | **删除/归档**（**该目录实测不存在**） | 本档 `ls -la ~/.dsh/profiles/` = 仅 `node_modules`、`web` |
| P-08 | `switch-web2-runbook.md:34 / :45 / :52 / :55 / :63 / :75` | 3081 独立验收端口 | 归档（0.1.5 轮次）；0.2.0 需新定 31xx | 同上 |
| P-09 | `switch-web2-runbook.md:66 / :71 / :73 / :78 / :86 / :90` | 切换/回退动 **3080** | **归档并加禁令**：0.2.0 迁移期间不得照抄此段 | PLAN.md §纪律 |
| P-10 | `port-taste.md:47` | `cd /home/CNS2026495165/.dsh/profiles/web2 && node ./node_modules/.bin/dsh --profile web2 --port 3081` | 归档 + 标注路径已不存在 | 本档实测 |
| P-11 | `port-taste.md:49 / :58` | 3081 日志行 / 「已 `kill` 进程（pid `1811911`）」 | 归档；PID 值保留为时点记录 | 同上 |
| P-12 | `port-tokps-web2.md:4 / :35 / :68` | `/home/CNS2026495165/.dsh/profiles/web2/node_modules/@deepseek-ai/dsh-client-ui-subagent/lib/...` | 归档 + 标注路径已不存在 | 同上 |
| P-13 | `port-vision-adam.md:5 / :82 / :89` | `/home/CNS2026495165/.dsh/profiles/web2/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js` | 归档 + 标注路径已不存在 | 同上 |
| P-14 | `port-wallpaper.md:16(×2) / :17 / :84` | 同上（`@local/dsh-wallpaper`） | 归档 + 标注路径已不存在 | 同上 |
| P-15 | `02-plugin-system.md:157-163` | 部署形态表：`~/.dsh/profiles/node_modules/@local/`、实体清单 7 项、符号链接农场 | **实体清单须按 0.2.0 隔离面重取**（本档实测现役 `@local/` 为 9 个：`dsh-btw`/`dsh-logfile`/`dsh-pptmaster`/`dsh-ssh-gui`/`dsh-subagent-model`/`dsh-usage`/`dsh-wallpaper`/`dsh-web-search-sse`/`dsh-workerspace`） | 本档 `ls` + 逐包 `package.json` |
| P-16 | `04-ops-deploy.md:240` | `~/.dsh/profiles/web2/` 存在性未核实 | 见 V-19（改为「不存在」） | 本档实测 |
| P-17 | `office-handoff.md:27(×4) / :187(×3) / :254(×3)` | `~/.dsh-017` + `~/.npm-global-dsh017`「当前在位…patch `61adb8ae…`、会话 27 件、3097 `LISTEN 127.0.0.1`」 | **保留为 0.1.7 轮次**（实测**仍成立**：两目录存在、3097 LISTEN）；**新增** 0.2.0 隔离面条目 | `ss -ltn` 实测 3097 LISTEN；`~/.npm-global-dsh017/.../dsh/package.json:4 = 0.1.7-rc.2` |
| P-18 | `office-handoff.md:196` | 现场（2026-09-28 18:28）3080/3097 LISTEN、3098/3099 空闲 | 加 0.2.0 轮的现采样时点；**3098 曾被占用**的既有记载（`_audit/...p0-audit` §9.4.2）须一并保留 | 本档 `ss -ltn`：3080、3097 LISTEN（3098/3099 本采样未出现在 `:30xx` 过滤结果中） |
| P-19 | `office-handoff.md:123` | Route A origin 解析顺序 `--url` > `$DSH_WEB_URL` > `http://127.0.0.1:3080` | 保留（Route A 是**内置 `/api`** 复用，与版本无关）；0.2.0 若改 `/api` 契约则须重核 | PLAN.md / `MEASURED-BASELINE.md` |
| P-20 | `01-architecture-overview.md:108` | 数据流图 `gui[Web GUI 127.0.0.1:3080]` | 保留 | `ss -ltn` |
| P-21 | `wrp/README.md:96` | 「端口 7863/7864 空闲（**3080 是 DSH GUI，勿撞**）」 | 保留（警示仍有效） | 本档实测 3080 仍为 GUI |
| P-22 | `program-notebook.md:47 / :66 / :147 / :285 / :287` | 架构图 `DSH Web GUI 3080` / `0.1.7 隔离升级面（~/.dsh-017 + 3097）` / 冒烟 URL / 隔离面复核定稿 | **归 `program-notebook` skill**，见 §4 | — |
| P-23 | 权威文档全局 | 020 隔离路径约定 `~/.dsh-020` / `~/.npm-global-dsh020` / 工作区 `.workspace/iso-020/` | **权威文档中 0 命中 ⇒ 需新增一节约定**（本档实测 `.workspace/iso-020/npm-global/node_modules/@deepseek-ai/dsh/package.json:4 = 0.2.0-rc.1` 已存在，但未进任何文档） | 本档 `grep` = 空 |

### 2.3 产物指纹断言（逐条）

| # | 文件 : 行 | 现值 | 应改为 | 依据 |
|---|---|---|---|---|
| H-01 | `verify-runbook.md:63` | `dsh-btw/lib/client.js` **应为** `66beb3455c59f4991355f3918228e495`（365 269 B，`?rev=887a12106dcd`）+ 回溯 `88de97e6…`、`6c29b98b…` + `cp -a dsh-btw/lib/. ~/.dsh/profiles/node_modules/@local/dsh-btw/lib/` | **改为"按当前构建重取指纹"的判定法**（不要写死 md5）；0.2.0 重建后重取 | 本档 `md5sum`：仓库 `925c4355…`/368 509 B、部署位 `66beb345…`/365 269 B —— **两者 DIFFERS** |
| H-02 | `FEATURE-MAP.md:25` | 4 处指纹（`88de97e6…`/363 814 B、`66beb345…`/365 269 B/`887a12106dcd`、`e1437b3b…`/67 542 B）+「served == 部署位 == 仓库」 | 保留为**历史批次记录**（带日期）；**新增** 0.2.0 轮的指纹位 | 同 H-01 |
| H-03 | `05-performance-and-ux-program.md:81` | 2026-09-23 批：`88de97e6…` / `3980d1322992` / 363 814 B | 保留（带日期，本就是历史批次） | 同 H-01 |
| H-04 | `05-performance-and-ux-program.md:83` | D30 批：`66beb345…` / `887a12106dcd` / 365 269 B +「**已部署且热面已生效**（本档复核：served HTTP 200 / 365 269 B / md5 同值，`served == 部署位 == 仓库`）」 | **必须加注**：该等式在 2026-09-25 10:34 后已不成立（仓库构建 `925c4355…`/368 509 B） | 本档 `md5sum` + `stat` mtime |
| H-05 | `05-performance-and-ux-program.md:160` | 同上等式 + 回滚 `cp -a` 三段配方 | 同上（加注 + 0.2.0 回滚位重取） | 同 H-04 |
| H-06 | `office-handoff.md:187` | 「隔离 patch `61adb8ae…`、隔离会话 **27 件**」 | **保留为 0.1.7 轮次**（本档未复算 patch 哈希与会话计数，见 §6 未验证项 4） | 既有记载 + 本档未复算 |
| H-07 | `office-handoff.md:183` | 「85 个修改文件备份 MD5 复验 **85/85 PASS**」 | 保留为 0.1.7 轮次 | 同上 |
| H-08 | `UPGRADE-STOP-0.1.7.md:7` | 「旧版 85 个修改文件的备份 MD5 复验 **85/85 PASS**」 | 保留为 0.1.7 轮次 | 同上 |
| H-09 | `program-notebook.md:231 / :410 / :411 / :430` | 统一 U seal `393ccfd8…`、D29/D30 指纹与测试计数（260 passed / 2 skipped） | 归 skill，见 §4 | — |

---

## 3. 历史遗留断言核实

### 3.1 `switch-web2-runbook.md` 的 `dsh-vision-adam-0.2.0` —— **与 DSH 版本无关，不得改**

**核实结论**：该字符串是**插件自身版本号**。逐条实测证据：

| 证据 | 实测值 |
|---|---|
| `~/dsh-upgrade-backup/dsh-vision-adam-0.2.0/package.json:2-4` | `"name": "@deepseek-ai/dsh-vision-adam"` / `"version": "0.2.0"` |
| `~/dsh-upgrade-backup/dsh-vision-adam-0.2.0/dsh-vision-adam/package.json:2-4` | 同值 |
| `~/dsh-upgrade-backup/20260925-110042/local-plugins/dsh-vision-adam/package.json:2-4` | 同值 |
| 文档原句 `switch-web2-runbook.md:97` | 「全部移植/补丁的恢复基线在 `~/dsh-upgrade-backup/`（配置 tgz、patched-official-files.tgz、self-built-plugins.tgz、**dsh-vision-adam-0.2.0**）」 |
| 全仓 `grep -rn '0\.2\.0-rc\.1'`（排除 `node_modules`） | 权威文档 **0 命中**；命中集中在 `.workspace/dsh-020-pkgs/**` 与 `workbuddy-reverse-proxy/_audit/office-plugins/dl/catalog/**` 的 0.2.0 包树 |

⇒ **处置**：**保留原值**，但建议在同行加一句消歧：「此处 `0.2.0` 是 `@deepseek-ai/dsh-vision-adam` 的**插件版本号**，与 DSH 内核版本无关（勿与 0.2.0 迁移目标混淆）」。**这是本迁移中最容易误改的一处。**

### 3.2 `~/.dsh/profiles/web2` 全族引用 —— **目录当前不存在**

**核实结论**：`~/.dsh/profiles/` 下实测仅有 `node_modules`、`web`（`ls -la ~/.dsh/profiles/`，2026-09-29）。因此：

- `switch-web2-runbook.md:30 / :74`、`port-taste.md:47`、`port-tokps-web2.md:4 / :35 / :68`、`port-vision-adam.md:5 / :82 / :89`、`port-wallpaper.md:16(×2) / :17 / :84` 的 `cd ~/.dsh/profiles/web2` / 绝对路径**全部不可执行**。
- `04-ops-deploy.md:240` 说该目录「存在性与状态**未核实**」⇒ **本档已核实：不存在**。
- 这与 0.2.0 迁移**不是同一件事**，但 0.2.0 迁移会让这一族文档（`0.1.5` web2 轮次）整体作废，**正好一并归档**。

### 3.3 `workbuddy-reverse-proxy/README.md` 的第三方插件 `engines.dsh` 断言 —— **语义过期，且结论已被版本演进作废（一侧）**

**核实对象**：`@axiaohungry/dsh-llm-workbuddy`。**该插件在本机未安装**（实测：`~/.dsh/profiles/node_modules/` 下无 `@axiaohungry/*`、无 `*workbuddy*`；`~/.dsh-017/profiles/node_modules/`、`~/.npm-global-dsh017/lib/node_modules/` 同样无命中）。

**实测原始约束**（两处逐字相同）：

- `workbuddy-reverse-proxy/_audit/plugin-1.3.19/package/package.json`（= npm 1.3.19 tarball 解包）
- `workbuddy-reverse-proxy/_audit/ghn-package.json`（= GitHub HEAD 抓取）

```json
"dsh": { "engines": { "dsh": ">=0.1.2-alpha.2 <0.2.0 || >=0.1.5-rc.3 <0.1.5 || >=0.1.7-rc.1 <0.1.7" } }
```

**用现役树自带 `semver` 实跑**（`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/semver`）：

| 候选 DSH | `satisfies`（默认） | `satisfies`（`includePrerelease:true`） | 含义 |
|---|---|---|---|
| `0.1.1-rc.2`（现役） | **false** | false | 三段均不命中（第 1 段下界 `>=0.1.2-alpha.2` 高于它，且 prerelease 元组不同） |
| `0.1.5-rc.2` | false | true | 仅带 prerelease 标志时命中第 2 段（`>=0.1.5-rc.3 <0.1.5`） |
| `0.1.7-rc.2`（隔离） | **true** | true | 命中第 3 段（`>=0.1.7-rc.1 <0.1.7` 的 prerelease 元组 = `0.1.7`） |
| `0.2.0-rc.1`（**迁移目标**） | **false** | true | 默认不命中；带 prerelease 标志时命中第 1 段 |
| `0.2.0`（不存在） | false | false | 明确排除 |

**逐条裁决**：

1. `wrp/README.md:118` 写的「其 `dsh.engines.dsh` 要求 `>=0.1.2-alpha.2 <0.2.0`（新版另加 `>=0.1.5-rc.3`、`>=0.1.7-rc.1` 区间）」——**描述方向对、精度错**：真实值是**三段 OR**（而不是"主区间 + 两段附加"），且它把三段写成"新版另加"，掩盖了**前两段与第三段互斥**这一要点。
2. `wrp/README.md:118` 结论「**本机 DSH = `0.1.1-rc.2`**（实测 `dsh --version`）… `10` 个已发布版本（`1.3.10→1.3.19`）都有同样要求 ⇒ 前置条件是把 DSH 升到 **≥0.1.2-alpha.2**」——**对 `0.1.1-rc.2` 成立**（本档 semver 实跑同值 false），**且与 `wrp/RUNBOOK.md:440` 的 `dsh --version = 0.1.1-rc.2` 一致（本档实测该值仍为真）**。⇒ 这一句**不是错误，是"该时点的实测记录"**，但在 `0.1.7-rc.2` 已存在的今天**已不能当作"本机装不上"的现行结论**（因为隔离 3097 就满足）。
3. `wrp/README.md:134` 「前者**要求 DSH ≥0.1.2-alpha.2（本机 `0.1.1-rc.2` 不满足）**」——**这是最需要改的一处**：它只留了半句、丢了 OR 的第 3 段，读起来像"任何 DSH 都装不上"。
4. `wrp/README.md:3` 顶部警示「目标改为 DSH `0.1.7-rc.2` + 第三方 WorkBuddy 插件，但升级被旧会话迁移和本地插件兼容性问题阻断」——0.2.0 改锚后需重写。
5. **对 0.2.0 的新约束（原文档完全没有）**：`0.2.0-rc.1` 在**默认 `semver.satisfies` 下返回 `false`**（仅在 `includePrerelease:true` 下为 `true`）。⇒ 执行档在 0.2.0 上尝试该插件时，**"能不能装"取决于 DSH 侧是否带 prerelease 标志**，这是一个必须实测的闸门，**不得凭本档的 semver 结论放行**（本档未定位到 DSH 侧的校验代码，见 §6 未验证项 1）。另注：`19-15-workbuddy-plugin-0.1.7-intel.md` 已记载社区同型事故的 stderr 形态「`dsh: skipping profile bundle … Plugin … is incompatible with dsh 0.1.7-rc.1: peerDependencies …`」，即**校验失败的后果是整个 bundle 被跳过（provider 与设置页全部消失），而非降级**——这条结论对 0.2.0 **同样适用**，应保留并升级为 0.2.0 口径。

**应改为的形态（建议原文级替换）**：

> ❌ **当前语义**：其 `dsh.engines.dsh` 要求 `>=0.1.2-alpha.2 <0.2.0`（新版另加 `>=0.1.5-rc.3`、`>=0.1.7-rc.1` 区间），而本机 DSH = `0.1.1-rc.2`，装不上。
> ✅ **建议语义**：其 `dsh.engines.dsh` = `>=0.1.2-alpha.2 <0.2.0 || >=0.1.5-rc.3 <0.1.5 || >=0.1.7-rc.1 <0.1.7`（**三段 OR**，逐字见 `_audit/plugin-1.3.19/package/package.json` 与 `_audit/ghn-package.json`）。**现役 `0.1.1-rc.2` 三段均不命中 ⇒ 装不上（该结论 2026-09-24 实测成立、本档复核仍成立）**；**隔离 `0.1.7-rc.2` 命中第 3 段 ⇒ 满足声明**；**迁移目标 `0.2.0-rc.1` 仅在 `includePrerelease` 语义下命中第 1 段，`0.2.0` 最终版明确排除** ⇒ 0.2.0 上必须实测闸门行为，且**校验失败的表现是整包被跳过（provider 与设置页消失），不是降级**。

### 3.4 `docs/architecture/05-…` / `FEATURE-MAP.md` 的「served == 部署位 == 仓库」—— **现已不成立**

见 §2.3 H-04。实测：仓库 `dsh-btw/lib/client.js` = `925c435537d7820372eb5da4d20c11c1` / 368 509 B / mtime `2026-09-25 10:34:27`；部署位 = `66beb3455c59f4991355f3918228e495` / 365 269 B / mtime `2026-09-23 18:23:20`；`cmp` = **DIFFERS**。这是**迁移前就存在的文档-现实漂移**，且 0.2.0 会再制造一次。⇒ 建议执行档把这类断言改成**判定法**（"取当前构建的 md5 并与 served 比对"）而不是写死常量。

---

## 4. 文档收口清单

> 按文件分组；每条 = **位置 · 现值 · 应改为 · 依据**。执行档可逐条勾。**注意**：本清单**不含** `docs/program-notebook.md`（归 `program-notebook` skill，见 §5）。

### 4.1 高优先（阻断性：错的版本事实 / 错的路径 / 不可执行配方）

| ID | 文件 · 位置 | 现值 | 应改为 | 依据 |
|---|---|---|---|---|
| T31-U01 | `docs/architecture/office-handoff.md` §5.2 全节（L178–L196）+ L27 / L187 / L254 | 升级线目标 `0.1.7-rc.2`；隔离面 = `~/.dsh-017` + `~/.npm-global-dsh017`；3097 LISTEN | **新增 §5.2.0「0.2.0 迁移轮次」**并把 0.1.7 全节标为历史；**明示 020 隔离面约定**（`~/.dsh-020` / `~/.npm-global-dsh020` 或工作区内 `.workspace/iso-020/`，**取值由协调者裁决**） | 本档实测：020 路径在权威文档 0 命中（P-23） |
| T31-U02 | `docs/runbooks/switch-web2-runbook.md` 全份（L1–L97） | 「web2(0.1.5-rc.2) 切换 Runbook（已验证版）」 | 顶部加 ⛔ 横幅「**0.1.5 轮次，已作废；0.2.0 迁移不得照抄 §4 切换 / §5 回退 / §2 起服务**」；`docs/runbooks/README.md` 索引行同步标注 | 目标改锚；§3.2 目录不存在 |
| T31-U03 | `docs/runbooks/verify-runbook.md:63` | btw bundle md5 `66beb345…` / 365 269 B / `?rev=887a12106dcd` 作为「应为」判据 | 改为判定法：「取**当前构建**的 `dsh-btw/lib/client.js` md5 与 served 比对相等」；删去"应为某常量" | 本档 `md5sum` + `cmp` = DIFFERS |
| T31-U04 | `workbuddy-reverse-proxy/README.md:118`（+ `:134`、`:3`） | engines 三段式描述与「本机 0.1.1-rc.2 不满足 ⇒ 升到 ≥0.1.2-alpha.2」结论 | 按 §3.3 「建议语义」原文替换；`:3` 顶部警示改为 0.2.0 口径；`:134` 删去半句版本约束复述 | 本档 semver 实跑 + 两份 manifest 逐字 |
| T31-U05 | `workbuddy-reverse-proxy/UPGRADE-STOP-0.1.7.md` L1–L11 | 「DSH 0.1.7-rc.2 升级：当前禁止切换现役实例」+ 0.1.7 计数/闸门 | **由用户裁决后**新建 0.2.0 闸门（或本件顶部加 0.2.0 段）；0.1.7 内容整段标为历史轮次，**不改数值** | 闸门是权威安全件，须用户裁决 |

### 4.2 版本基线与历史档化（16 份文件的机械改动）

| ID | 文件 | 位置 | 现值 | 应改为 | 依据 |
|---|---|---|---|---|---|
| T31-U06 | `README.md` | L16、L162 | 「当前 `0.1.1-rc.2`」 | `0.2.0-rc.1`（或「现役 `0.1.1-rc.2` / 目标 `0.2.0-rc.1`」+ 日期） | §2.1 V-01/V-05 |
| T31-U07 | `FEATURE-MAP.md` | L17 | 「部署基线：DSH `0.1.1-rc.2`」 | 同 U06 | V-06 |
| T31-U08 | `FEATURE-MAP.md` | L44 | 「该开关要求的宿主半边模块在本版本树（`0.1.1-rc.2`）不存在」 | **重判 0.2.0 树**是否含 `dsh-tool-subagent` 的 `./model-selection-settings` export；据实改写 | V-07 |
| T31-U09 | `01-architecture-overview.md` | L5 | 基线 `0.1.1-rc.2` | 同 U06 | V-09 |
| T31-U10 | `01-architecture-overview.md` | L58–L67 | 自装插件表写死插件版本与 peer 面 | 按 0.2.0 隔离面**重取**（本档实测现役 `@local/` = 9 个包，见 P-15） | 本档实测 |
| T31-U11 | `02-plugin-system.md` | L5 | 基线 `0.1.1-rc.2` | 同 U06 | V-12 |
| T31-U12 | `02-plugin-system.md` | L189 | 「包版本 `0.1.1-rc.2`」（`dsh-skill-filesystem`） | 重取 0.2.0 树内该包版本 | V-13 |
| T31-U13 | `02-plugin-system.md` | L157–L163 | 部署形态表 | 同步 U10 的插件清单 | P-15 |
| T31-U14 | `03-model-routing-gateway.md` | L5 | 基线 `0.1.1-rc.2` | 同 U06 | V-14 |
| T31-U15 | `04-ops-deploy.md` | L5 | 基线 `0.1.1-rc.2` | 同 U06 | V-15 |
| T31-U16 | `04-ops-deploy.md` | L240 | 「`~/.dsh/profiles/web2/`…存在性未核实」 | 「**实测不存在**（2026-09-29）」 | V-19 / §3.2 |
| T31-U17 | `04-ops-deploy.md` | L33 / L39 / L47 | 0.1.5-rc.2 / 0.1.1-rc.2 脚本描述 | 保留 + 加「0.1.1→0.1.5 借码批次，非 0.2.0 路径」 | V-16/17/18 |
| T31-U18 | `README.md` | L120 / L140 / L24 | 0.1.5 借码 / 0.1.5 UI 延期 | 保留 + 标历史批次 | V-02/03/04 |
| T31-U19 | `01-architecture-overview.md` | L90 / L91 | `deploy-lag` / `deploy-015`（0.1.5 借码） | 保留 + 标历史 | V-10/11 |
| T31-U20 | `docs/runbooks/README.md` | 索引表首行（指向 switch-web2） | 「切到 web2 独立实例并验收」 | 改为指向 0.2.0 新 Runbook（或标「0.1.5 轮次，已作废」） | U02 |
| T31-U21 | `docs/runbooks/port-taste.md` | 全份（17 处版本断言 + L47/L49/L58 路径/PID） | 0.1.1→0.1.5 移植记录 | 顶部加 ⛔「0.1.5 轮次，0.2.0 未复核」；L47 路径标「已不存在」 | V-29 / P-10/11 |
| T31-U22 | `docs/runbooks/port-tokps-web2.md` | 全份（11 处 + L4/L35/L68 路径） | 同上 | 同上 | V-30 / P-12 |
| T31-U23 | `docs/runbooks/port-vision-adam.md` | 全份（21 处 + L5/L82/L89 路径 + L128/129 peer） | 同上 | 同上 + **L128/129 的 peer "未动"必须在 0.2.0 轮次里动** | V-31 |
| T31-U24 | `docs/runbooks/port-wallpaper.md` | 全份（17 处 + L16/L17/L84 路径 + L107/108 预言） | 同上 | 同上 + **L107/108「若后续 0.2.0 破坏兼容再收紧」= 触发条件已达成** | V-32 |
| T31-U25 | `workbuddy-reverse-proxy/RUNBOOK.md` | L3 / L6 阻断横幅 | 「DSH 0.1.7 升级线」 | 加 0.2.0 段；保留 0.1.7 为历史 | V-37 |
| T31-U26 | `workbuddy-reverse-proxy/RUNBOOK.md` | L13 / L16 / L440 / L445 | descriptor v2 计数 / `v3→v4` 未实跑 / `dsh --version = 0.1.1-rc.2` | L440 保留值 + **标采样时点**；L13/L16 标历史并**重取 0.2.0 的 descriptor 版本** | V-37/38/39 |

### 4.3 产物指纹与"等式"断言（加注，不改历史值）

| ID | 文件 · 位置 | 现值 | 应改为 | 依据 |
|---|---|---|---|---|
| T31-U27 | `05-performance-and-ux-program.md:83 / :160` | 「`served == 部署位 == 仓库` 已生效」 | 加注：「该等式在 2026-09-25 10:34 仓库重建后**不再成立**（仓库 `925c4355…`/368 509 B vs 部署位 `66beb345…`/365 269 B）」 | H-04/H-05 |
| T31-U28 | `FEATURE-MAP.md:25` | 同上等式 + 4 处指纹 | 保留为 2026-09-23 批次记录；**新增 0.2.0 轮的指纹位** | H-02 |
| T31-U29 | `05-performance-and-ux-program.md:81` | 2026-09-23 批指纹 | 保留（已带日期） | H-03 |
| T31-U30 | `office-handoff.md:183 / :186 / :187` | 85/85 PASS、patch `61adb8ae…`、会话 27 件 | **保留为 0.1.7 轮次**；0.2.0 需新增等价条目 | H-06/H-07 |

### 4.4 不需要改

| 文件 | 结论 |
|---|---|
| `DOC-STYLE.md` | 零版本/端口/路径断言（`grep` 实测）；**但 §6「状态必须带日期」§10「来源必须落盘」是执行档更新的格式约束** ⇒ 所有新增/改写条目必须带日期与证据指针 |
| `02-plugin-system.md:165 / :173` 两条硬约束 | 「绝不对 `~/.dsh/profiles/web` 执行 `npm/pnpm install`」+「部署位包名以 `package.json` 的 `name` 为准」——**与版本解耦，必须原样保留**（0.2.0 迁移只会让它们更重要） |
| `office-handoff.md:99–L118` 权限边界与办公投递已裁决前提（N1/N2、Route A） | 与 DSH 版本解耦；**除非 0.2.0 改 `/api` 契约**（见 §6 未验证项 5） |
| `office-handoff.md:128`「现役 3080 与 `~/.dsh` 不得作为升级试验场」 | **必须保留**（实测两实例仍在监听） |

---

## 5. 建议的下个会话 program-notebook 条目（**只列条目，本档不改文件**）

> 归 `program-notebook` skill 负责。下列条目**建议直接作为 notebook 更新清单**（格式建议沿用其现有表格/Tier 结构，并遵守 `DOC-STYLE.md` §6「带日期」）。

**N-01（事实基线更新 · 必做）**：迁移目标改锚段——从「0.1.7 隔离升级面」改为「**0.2.0 迁移轮次**」；注明 npm dist-tags `latest=0.1.7-rc.2` / `next=0.2.0-rc.1` / **无稳定 0.2.0**，以及 0.2.0-rc.1 CLI tarball sha256（引用 `MEASURED-BASELINE.md` §1，**不复制哈希进 notebook，只给指针**）。

**N-02（图与指针 · 必做）**：更新架构图节点 `upgrade["0.1.7 隔离升级面（试验场在位：~/.dsh-017 + 隔离 3097 监听…）"]`（notebook L66）为**双行**：0.1.7 轮次（历史，`~/.dsh-017` + 3097）+ 0.2.0 轮次（新隔离面，路径待裁决）；同步 L47/L147 的 `DSH Web GUI 3080`（保留）。

**N-03（隔离面登记 · 必做）**：新增「0.2.0 隔离面」条目，登记：工作区内已存在的 0.2.0 安装位（`.workspace/iso-020/npm-global/node_modules/@deepseek-ai/dsh/package.json` = `0.2.0-rc.1`）、以及**待定的** `~/.dsh-020` / `~/.npm-global-dsh020` 约定；**明确写"权威文档此前对该约定 0 命中"**。

**N-04（闸门指针 · 必做）**：notebook L99 / L272 / L344 / L459 指向的 `workbuddy-reverse-proxy/UPGRADE-STOP-0.1.7.md`「升级线权威安全闸门（STOP）」需改为**双闸门**：0.1.7 历史闸门 + **0.2.0 新闸门（待建，须用户裁决）**；并保留「本文件是安全闸门，不是升级授权」这句纪律原文。

**N-05（纪律条目增补 · 必做）**：notebook L290「任何新插件/新 patch 行落地前必须先过 **0.1.7** 兼容核对」/ L461 同义句 ⇒ 增补 **0.2.0** 兼容核对；并新增一条**本地插件 peer 区间**纪律（实测现役 9 个 `@local/*` 的 peer 多为 `>=0.1.1-rc.2 <0.2.0` / `^0.1.1-rc.2`，**对 `0.2.0-rc.1` 均不满足**）——凡装/改插件先核 peer，否则表现为**整包被跳过（功能与设置页消失）**而非降级。

**N-06（文档面纠错登记 · 建议）**：登记 §3.4 的「**served == 部署位 == 仓库**」等式已失效（含三个文件的受影响行号），并要求引用该等式前先复核。**并登记本档 §3.1 的防误改提醒**（`dsh-vision-adam-0.2.0` 是插件版本，勿改成 0.1.7/0.2.0 迁移版本号）。

**N-07（历史档化登记 · 建议）**：登记「0.1.5 轮次四份移植档（`port-taste` / `port-tokps-web2` / `port-vision-adam` / `port-wallpaper`）+ `switch-web2-runbook.md`」已整族作废（且其引用的 `~/.dsh/profiles/web2` 实测不存在），0.2.0 迁移不得据其执行。

**N-08（未验证项登记 · 建议）**：把本档 §6 的 5 条未验证项登记进 notebook 的未验证清单。

**N-09（去伪事实 · 必做，源自 §0.5）**：notebook 若已按 `PLAN.md:13` / `MEASURED-BASELINE.md` §3 写入「0.2.0 相对 0.1.7 **新增** `dsh-skill-office` / `dsh-tool-subagent-control` / `dsh-workflow-ptc`」，**必须更正为**：三者 **0.1.7 已存在**（实测版本号分别为两棵树内同名包，`dsh-tool-subagent-control` 的 `lib/` 逐文件比对 `【lib全等】`）；**真正新增**的 `@deepseek-ai/*` 仅 5 个：`dsh-client-product-analytics`、`dsh-client-ui-settings-session-log`、`dsh-experimental-schedule-bundle`、`dsh-host-product-telemetry-otel`、`dsh-otel`。

**N-10（工具/插件 peer 纪律 · 建议）**：登记「**判定包是否变化一律按 `lib/` 口径**；`package.json` 只差版本号字符串不算改动」这条方法纪律，并附上「本地 9 个 `@local/*` 对 `0.2.0-rc.1` 的 harness peer 拦截量 = 52 项（26 项纯锚定 / 26 项需改区间）」这一实测数字，作为后续插件迁移的起点台账。

**N-11（契约新面登记 · 建议）**：登记 0.2.0 的「步骤失败保守恢复」契约面（`TOOL_OUTCOME_UNKNOWN` / `TOOL_NOT_STARTED`、合成 `tool/result`、模型可见"先核实副作用、不盲目重试"文案；实现位置 `dsh-agent-loop/lib/index.js` + `dsh-session/lib/types/repair.js`，均为 `【源码实读】`），并标注 **0.1.7 无此机制** ⇒ 凡引用"工具结果只在真实执行后产生"的旧表述需加时点。

---

## 6. 未验证项

本档**未声称**以下内容；执行档需另行实测：

1. **DSH 侧 `dsh.engines.dsh` / peer 校验的实现位置与 `includePrerelease` 语义未定位。** 本档在现役 0.1.1-rc.2 树内检索 `engines` 未命中校验代码（`grep -rn --include='*.js' engines <dsh 包根> --exclude-dir=node_modules` = 0 命中），故 §3.3 对 `0.2.0-rc.1` 的 `false`/`true` 两值**只报告范围表达式本身的语义，不代表 0.2.0 上的真实准入结果**。
2. **0.2.0 试验端口未定值。** 本档只确认 3080（现役）、3097（0.1.7 隔离）在监听，`3098`/`3099` 在本次 `ss :30xx` 采样中未出现（既档 `office-upgrade-p0-audit` 曾记载 3098 被占用）。0.2.0 用哪个端口、是否沿用 `31xx`，**本档未裁决**。
3. **`settings.yaml → *.imported` 改名硬闸在 0.2.0 上的行为未验证。** 0.1.7 的该机制见 `UPGRADE-STOP-0.1.7.md:11`；0.2.0 是否同名同形，**未测**（本档未触碰 `~/.dsh/settings.yaml`）。
4. **`office-handoff.md` 内的 patch 哈希（`61adb8ae…`）与隔离会话计数（27 件）未复算。** 本档只做了只读 `ls`/`ss` 层面的存在性核验（两目录存在、3097 LISTEN、`~/.npm-global-dsh017/.../dsh/package.json:4 = 0.1.7-rc.2`），**未重算 patch sha256、未统计会话文件数**。
5. **0.2.0 是否改动宿主内置 `/api` 契约（Route A 依赖）未核。** ⚠️ **注意 `MEASURED-BASELINE.md` §3 与 `PLAN.md:13` 把 `dsh-tool-subagent-control` / `dsh-skill-office` / `dsh-workflow-ptc` 写成"0.2.0 新增依赖"，本档已实测证伪（§0.5.2）**；但**逐条判定 `/api` 的 `workspace.list` / `workspace.create` 契约是否变化仍未做**（`dsh-api-remotes` 的 `lib/` churn 30%、`dsh-api-workspace-controller` 2/26，本档**未读其源码**，只知"有改动"，不知是契约还是内部实现）。
6. **本档未逐条给出 `01-architecture-overview.md:58–67` 插件表的替换值**（只给出"须重取"与现役实测 9 包清单），因为该表依赖 0.2.0 隔离面的 peer 裁决结果。
7. **`docs/program-notebook.md` 的具体行号改动未给出**（按轨道纪律归 skill）；§5 只列条目。
8. **本档未复核 `.workspace/reports/runbooks/master-runbook.md` 等 Tier 1 证据层文档**（不在本次指定的权威文档清单内，且其中大量内容属历史批次记录）。若执行档要求"全仓收口"，需另开轨道盘点 `.workspace/**` 与 `workbuddy-reverse-proxy/reports/**`（后者 `19-*`/`20-*` 共 100+ 份，本档仅按需引用了 `19-15`）。
9. **btw 对合成恢复结果的"人可见语义"是否足够，本档只做到 `【源码实读】`+grep 层面**（§0.5.3 第 3 点）：确认宿主 digest 会把它显示为**错误态工具结果**、且 btw 未区分该情形；**"用户看到什么、是否需要专门文案/闸门"属 T30 与用户裁决面，本档不裁**。
10. **加载器 `includePrerelease` 语义由"现役插件实际加载成功"反推（`【宿主先例推定】`），未读校验代码**（§0.5.4 末）。若该推论成立，则 §0.5.4 表中"含 prerelease 不满足"栏（26 项）才是**真实阻断量**；若不成立，真实阻断量是 52 项。**执行档必须以 0.2.0 实装实测判定，不得据本档表格放行。**
11. **churn 口径下"两棵树可比性"未完全对齐**：0.1.7 侧 `@deepseek-ai/*` 位于 `…/dsh/node_modules/@deepseek-ai/`（嵌套），0.2.0 侧位于 `…/npm-global/node_modules/@deepseek-ai/`（flat）。本档 §0.5.2 的集合增量基于**这两个目录**；若改用"CLI 顶层全树"口径，`dsh-web-frontend` 等 `[NO-LIB-BOTH]` 项会进入差集（`churn-lib-017-020.txt` 已按此登记）。**包名增量的 5 项结论在两种口径下均成立**，但"包总数 503→530"这类数字本档未复算。
