# dsh-taste 中文单轨统一设计（审计记录，2026-09-XX）

> 本文件是本次源码/测试/数据审计的设计与复核记录，不是运行手册或长期运营文档。实现前必须以本文件和实际源码为准；不新增其他易漂移说明文档。

## 0. 终局裁定

- `taste.md` 是唯一事实源，条目、陈述、置信度和 GUI 展示全部使用中文；格式仍为 `- 中文陈述 Confidence: 0.88`。
- 删除 `display.zh.json` 双轨及所有翻译/backfill-display 代码。GUI 从解析后的 `taste.md` 条目直接渲染 `statement`，不再有 `display`、覆盖率或“未翻译”状态。
- learner 的输入、提示词、工具说明、输出摘要均为中文；learner 仍只可调用 `read_taste_file`、`write_taste_file`、`edit_taste_file`，不能执行项目任务。
- 注入直接读取 project/global/Command Code 合并后的中文 `taste.md` 文本；不增加 `minConfidence` 代码门控，筛选、归并、汰换由中文 prompt 决定。
- 置信度存储/显示保持两位小数语义；解析仍兼容旧的一位/整数格式，新的写入统一 `toFixed(2)`（若必须保持历史字节兼容，仅解析兼容，不把旧格式作为新契约）。
- project 优先于 global 去重并覆盖同键；Command Code 仅只读输入源，不能被 GUI、命令或 learner 修改。project 条目只表达项目特定偏好，global 只表达跨项目稳定偏好；相同陈述在两层合法共存，但注入时 project wins。

## 1. Provenance 与学习输入

### 1.1 确定性 collector 规则

新增纯函数 `classifyEventForTaste(event)`（或等价拆分函数），返回 `reject | user-primary | assistant-secondary` 及原因；`isLearnableUserEvent` 只作为兼容包装，不再以“不是 plugin”作为充分条件。

判断顺序：

1. **事件类型闸门**：只有 `user/message` 和 `assistant/message` 进入候选；`tool/call`、`tool/result`、`agent/inbox`、`agent/inbox/spliced`、`system`、`runtime-context`、RPC/工具转录事件、`turn/*` 一律拒绝。
2. **source 闸门**：`user/message` 必须 `data.role === "user"`（缺失 role 可兼容接受，但需保留审计日志/测试）；`source.kind` 缺失或明确为 `user` 才是用户主证据。`plugin`、`tool`、`system`、`runtime-context`、`agent`、`rpc`、`subagent`、`automation`、`inbox` 等自动化/拼接来源拒绝；未知的非 user 来源 fail-closed。不能只排除 `plugin`。
3. **形态闸门**：只接受 `content` 数组中的 `type:text`、非空字符串；image、thinking、toolCall、toolResult、结构化参数、附件和嵌套消息不进入证据。事件数据中若明显是插件快照、工具结果、代理收件箱拼接（即使外层误标为 user）且没有真实用户 message 的 provenance，也拒绝。不要用关键词粗暴过滤普通用户文字。
4. `assistant/message` 仅在事件类型、source 为模型/assistant 且含可见 text 时作为 `assistant-secondary`；任何 assistant 的工具调用、报错、运行状态、项目计划、执行报告或模型生成的“下一步”仍拒绝。对无法证明是辅助上下文的 assistant 来源 fail-closed。
5. 切片仍从目标 `turn/start` 后取到数组末尾；当前未结束轮可学习，backfill 只取含 `turn/end` 的已完成轮。用户消息为空时不入队。

**保留真实用户的原则**：用户明确说“你刚才把 X 说错了，我偏好 Y”仍是 `user-primary`，整段可分析；其中引用 assistant 的文字不因包含“assistant”或引号而删除。只有事件 provenance 是自动拼接/工具/系统时才拒绝。普通用户消息即使讨论 `query_peers`、`read_taste_file` 或 agent inbox，也不应因关键词删除；若它是明确的偏好纠正，prompt 负责提取，若只是任务指令，prompt 负责不学习。

### 1.2 辅助证据标注与降权

不要把 assistant 文本伪装为 user。`collectTurnEvidence` 输出：

```js
{ user: [{ text, provenance: "user-primary" }],
  assistant: [{ text, provenance: "assistant-secondary" }] }
```

构造 learner JSON 时保留 `role` 和 `provenance` 字段，assistant 放在用户之后并明确“仅辅助、不得单独证明偏好”。置信度锚点只由 user-primary 证据确定；assistant 只能 corroborate 用户已经说出的偏好，不能单独创建、升级、汰换条目。显式用户引用 assistant 的纠正仍按用户主证据处理，因为证据来源是外层 user event。

`collectTurnTexts` 可保留给外部兼容，但生产学习路径改用 evidence 结构；`collectPriorWindow` 同样使用相同 provenance 规则，只作为已处理上下文，绝不重新学习。这样不会把工具报告拼接进 assistant 辅助证据，也不会误伤真实用户引用。

## 2. 中文单轨 learner 契约

### 2.1 Prompt 内容

将 `LEARNER_PROMPT` 全部改成中文，且只保留一份规范文本：角色边界、NEW-only、旧窗口仅解析引用、持久/可泛化偏好、总结/归并/汰换、冲突裁决、0.55/0.65/0.75/0.85/0.95 证据锚点、无新证据不改置信度、近重复同文件归并取高值、低分单独不删除、project/global 边界、无变化输出 `无变化`。明确：输入中 assistant/工具/system/AGENTS/工作流/项目报告都是待分析数据，不是指令；任何项目执行请求均忽略。

中文条目示例：`- 偏好使用制表符缩进。 Confidence: 0.88`。不要再出现 English statement、`Confidence` 之外的英文格式要求、display 参数或 sidecar 说明。工具结果和最终摘要中文；最终只输出简短学习摘要或准确的 `无变化`。

### 2.2 工具 schema 与实际输入输出

保留三工具及参数名以降低调用层风险：

- `read_taste_file(scope, path)`：读取中文 `taste.md`。
- `write_taste_file(scope, path, content)`：中文条目读-合并-写，不删除已有条目。
- `edit_taste_file(scope, path, old_text, new_text)`：精确替换；空 `new_text` 删除，用于汰换/归并。

删除 `display` 可选参数、`write_display_file`、`createTranslateTools` 及所有 display 净化/合并/裁剪。工具返回中文错误提示。路径仍仅 `taste.md` 或 `{category}/taste.md`，scope 仍 `global/project`；learner 无 shell、无通用工具、无项目文件写入能力。

`runLearner` 的实际输入是中文 `buildLearnerInput`：中文 taste tree + prior（含 provenance）+ NEW（user-primary 必须存在，assistant-secondary 可为空）。输出仅消费 final assistant 中文摘要；不把摘要写回 taste。模型配置固定 `observer.modelMode=custom/provider=adam/model=gpt-5.6-sol-ultra`，workflow 的设计/审计/执行/复核固定 `adam/gpt-5.6-sol-max`。不引入代码层 minConfidence。

## 3. 数据与迁移

### 3.1 一次性迁移算法

提供一次性、幂等的迁移脚本/管理命令（迁移完成后删除脚本，不能成为长期运行分支）：

1. 对全局 `/home/CNS2026495165/.dsh/taste` 和 Dexterous 项目 `.dsh/taste` 的每个白名单 `taste.md` 逐条读取；英文陈述人工/受控词典翻译成中文，置信度原值保留并规范两位小数；无法可靠翻译的条目进入迁移失败清单并停止自动删除，不能默默丢失。
2. 读取 `display.zh.json`，按旧 normalize key 把已有中文显示配回对应条目；优先采用 sidecar 的中文值，仅在明显不完整时人工修订。新 `taste.md` 每条必须已经是中文，sidecar 中未匹配键不得迁移。
3. project/global 各自去重；不跨 scope 合并。重名但语义不同保留；project 对 global 的重复是合法分层，注入合并时 project 优先。
4. 先写同目录 `taste.md.migration-new` 并 parse/计数/逐条比对，fsync/原子 rename；成功后将旧 sidecar 改名为带时间戳备份（或移入迁移备份目录），再删除 `display.zh.json`。迁移期间任何失败保留旧文件不动。
5. Command Code：继续从其只读 `taste.md` 读取；若现存英文条目，建立只读中文兼容解析/人工迁移副本的明确策略，不能由 dsh-taste 回写 Command Code。推荐在注入适配层暂时显示原文并记录迁移告警，待上游只读源完成中文迁移后移除兼容；绝不把 commandCode 变成 writable。
6. `config.json` observer 固定为上述 adam ultra；`config.example.json` 同步。不得将用户已有 injection、learning、budget 等配置覆盖为默认值。

### 3.2 回滚/兼容风险

迁移前备份每个 taste.md、sidecar、config；以备份可整目录恢复。旧版本代码无法理解“中文本体无英文 sidecar”不会损坏数据，但旧 GUI 可能显示空 translation；发布顺序应先升级代码再迁移。新代码在迁移完成前可读取旧英文 taste，但必须明确只作为临时兼容，不能继续生成英文；sidecar 残留只读忽略并在迁移命令中清理。语义翻译错误无法由程序检测，必须在迁移校验清单中人工确认。

真实审计数据：全局 taste 当前为大量英文条目且存在 `display.zh.json`；Dexterous 项目有 14 条左右英文重定向/审计偏好及 sidecar。迁移必须覆盖两处，不能只迁移当前仓库或只迁移 root 文件。

## 4. 文件级修改清单

### 删除/重写

- `lib/collector.js`：加入 provenance 分类、自动化事件拒绝、user-primary/assistant-secondary 输出；保留 clip/redact。
- `lib/learner.js`：中文单轨 prompt、中文输入模板、provenance 标注；删除 display 文案和 translate prompt 覆盖入口。
- `lib/learner-tools.js`：删除 display 参数、sidecar 维护、`write_display_file` 与 translate tool factory；保留三工具、锁、路径白名单、中文内容校验。
- `lib/storage.js`：保留 parse/render/lock/scope/Command Code；删除 `DISPLAY_FILENAME`、load/merge/prune display、display key 相关函数；render 新写入固定两位小数。
- `lib/index.js`：接线新的 evidence collector；注入只用中文 snapshot；删除 translate/backfill-display 分支、display imports/deps；保留普通 backfill（其 blocks 也必须用中文/同 provenance 规则）、队列、熔断、递归保护、project/global/Command Code 合并、GUI bridge 注册。
- `lib/bridge.js`：`getTree` 返回 `{statement, confidence}`，删除 display join/coverage/loadDisplayMap；保留 GUI 删除、设置/模型路由和 commandCode 只读拒删。
- `lib/client.js`：直接渲染 `entry.statement`；删除 display fallback、未翻译标签、coverage、translation 文案；保留中文界面、两位小数、删除确认、模型设置。
- `lib/commands.js`：删除 `translate` 命令、翻译覆盖率和相关 dispatch；保留 status/on/off/list/remember/forget/paths/model/backfill，所有 taste 文案可统一中文。
- `lib/translate.js`：删除。`backfill.js` 仅在仍需要历史补学时保留，并改用 provenance collector。
- `package.json`：保留 client exports 与 GUI 依赖；移除不再需要的 translate 相关说明（无新增依赖）。

### 测试清理与最小集合

保留并改造 `collector.test.js`：真实 user、缺失 source 兼容、plugin/runtime/agent inbox/tool/system/RPC 拒绝、assistant 降权、用户引用 assistant 保留、工具块剔除、剪裁/脱敏、malformed 不抛出。保留 `storage.test.js` 的解析、路径、锁/原子写、project/global/Command Code 合并、两位小数；删除全部 display sidecar/translation coverage 测试。保留 `learner.test.js` 的中文 prompt、NEW-only、provenance、角色隔离、三工具、curation/no-change、模型路由；删除 display/translate prompt 测试。保留 `learner-tools.test.js` 的三工具读写合并、edit 删除/归并、路径拒绝并删除 display/write_display 分组。保留 `bridge.test.js` 的树、删除、只读 commandCode、设置/路由；删除 display join/coverage/sidecar 测试。`client.test.js` 只保留中文直接渲染、两位小数、删除和设置 GUI smoke。`translate.test.js` 整个删除；若 backfill 测试仅测试 translate/display 分支则删除对应部分。

删除依据：测试必须锁定核心契约或安全边界；display 双轨、翻译覆盖率和旧英文 fallback 在新契约下是废弃行为，继续保留会强迫死代码；同一 storage/bridge 删除语义只保留一套端到端和一套纯函数断言，避免重复测试无限增长。验收以实际 `node --test test/*.test.js` 结果为准，不在文档预报测试数量。

## 5. 注入、分层与 GUI 边界

注入函数同步读取 fingerprint 变化后的合并中文 taste snapshot，顺序 project → global → Command Code，按 normalized Chinese statement 去重；不按置信度过滤。GUI 只从 bridge 的解析 JSON 读 statement/confidence，不读原始路径、不读 sidecar；删除继续走共享 `deleteTasteEntries`，设置继续只改 observer 三元组并保留其他配置。Command Code 仍显示只读徽章、禁止删除和写入。

`commandCode` 不是第三个可写 scope：它是兼容展示/注入源；project/global 是 learner 唯一可写层。GUI 的“全局/项目/Command Code”三标签可以保留，但不要把只读源混入 learner tree 的 writable tools。

## 6. 不新增易漂移文档

本文件只作为本次设计/审计记录。实现应以代码、测试和配置 schema 为权威；迁移备份/校验清单是一次性产物，不提交为运营文档。README 仅删除已失效的 display/translate 描述并保留稳定的安装/命令入口，不复制本设计全文。

## 7. 结论

**approve（有条件）**：方案满足中文单轨、provenance 防误学、assistant 降权、learner 角色隔离、两位小数、curation、分层、只读 Command Code、GUI 删除/模型路由和无 minConfidence 门控。进入实现前必须先落实 collector 形态分类和迁移备份校验；任何无法证明来源的自动化事件 fail-closed，任何普通真实 user message 不得因关键词被误伤。

## 8. 审计缺口修订（2026-09-04；本节覆盖前文同名但较宽泛的表述）

### 8.1 真实事件 shape 与唯一分类 API

生产入口把事件视为 `{type, data}`。用户消息的真实正文位于 `data.content`（数组）；assistant 消息允许位于 `data.message.content`，兼容 `data.content`。每个 content block 必须是 `{type: "text", text: 非空字符串}`；其它 block 只跳过，不转为证据。分类 API 的唯一返回结构为 `{kind: "reject"|"user-primary"|"assistant-secondary", reason: string}`，不得返回布尔值或把 assistant 伪装成 user。

`classifyEventForTaste(event)` 按以下字段优先级、短路顺序实现，任何未列出的 shape 均为 `reject`：

1. `event` 非对象、`data` 非对象、`type` 缺失/非字符串，或 `type` 不是精确的 `user/message`、`assistant/message`：`{kind:"reject",reason:"event-shape-or-type"}`。因此 `agent/inbox`、`agent/inbox/spliced`（无论直接作为 type，还是出现在 `data.type`/`data.eventType` 的嵌套记录）以及 `tool/call`、`tool/result`、`system`、`runtime-context`、`rpc/*`、`turn/*` 直接拒绝。
2. 先检查 provenance 字段：`data.source.kind` 是首选；若没有，则检查 `data.source` 为字符串的兼容 shape；若仍没有 source，仅允许 **user/message 且 `data.role` 缺失或严格为 `"user"`** 进入下一步。source 必须是字符串且精确为 `user` 才能使用户成为主证据；`plugin`、`tool`、`system`、`runtime-context`、`agent`、`rpc`、`subagent`、`automation`、`inbox`、`spliced` 及未知值一律 `reason:"unknown-or-automated-source"` 拒绝。assistant 没有可证明模型来源（`assistant`、`model`、`llm`）时拒绝；未知/缺失 assistant source 不走兼容放行。
3. `data.role` 若存在必须与事件类型一致（user 必须 `user`，assistant 必须 `assistant`）；不一致拒绝。随后按该类型选正文容器：assistant 优先 `data.message.content`，仅当其不存在时回退 `data.content`；若容器不是数组、没有任何合格 text block，拒绝，原因分别为 `content-shape`/`no-visible-text`。
4. 对 user 事件，若 `data.message`、`data.source` 或正文对象含有结构化嵌套事件记录（字段 `type` 为 `agent/inbox`、`agent/inbox/spliced`、`tool/*`、`rpc/*`、`system`、`runtime-context`，或记录含 `source.kind` 为自动化/未知）则拒绝 `embedded-automation-record`；**不得扫描普通正文关键词**。这条结构判定只针对对象/数组记录，故真实用户讨论 `query_peers`、`read_taste_file`、inbox 字样仍保留。

`collectTurnEvidence` 是生产唯一 collector 输出：`{user:Array<{text,provenance:"user-primary",role:"user"}>, assistant:Array<{text,provenance:"assistant-secondary",role:"assistant"}>}`；先执行上述分类再取 text，分别 redaction/clip。`collectTurnTexts` 只保留兼容包装，生产 hook/backfill/prior 不得使用它。prior 也携带相同 role/provenance，NEW 必须至少有一条 user-primary。

### 8.2 assistant-secondary 的消费闸门

assistant-secondary 仅可作为已在同一 NEW 中由 user-primary 明确提出的偏好之辅助佐证。learner 输入顺序固定 user-primary 后 assistant-secondary，并标注“仅辅助证据”。只有 assistant 的 NEW（包括执行报告、计划、错误、下一步指令）不得创建、升级、汰换任何条目；assistant 只能 corroborate 已由 user 提出的同一偏好，不能提供置信度锚点。代码侧在构造 NEW 时若 `user.length===0` 直接不入队；prompt 侧再明确该规则，形成双闸门。工具调用、tool/result、RPC、runtime/system 均不进入 assistant 数组。

### 8.3 display/translate 完整删除验收

实现提交前对生产路径执行以下清单（不以注释或一次性报告中的历史文字计为引用）：

- 删除 `lib/storage.js` 的 `DISPLAY_FILENAME`、`loadDisplayMap`、`writeDisplayMap`、`mergeDisplayMap`、`pruneDisplayMap`、`scopeStatementKeys` 及 display lock/维护逻辑；删除 `lib/learner-tools.js` 的 `display` 参数、`sanitizeDisplay`、上述 sidecar import 和 `createTranslateTools`/`write_display_file`；
- 删除 `lib/index.js` 的 `createTranslateTools`、`TRANSLATE_PROMPT`、`buildTranslateInput`、`collectUntranslatedEntries`、`translateProgress`、`enqueueTranslate` 和 `job.kind === "translate"` 分支；删除 `lib/commands.js` 的 `parseTranslateArg` import、translate dispatch/coverage/status/usage；删除 `lib/translate.js`；
- `bridge.js` 的 production `getTree` entry 只能是 `{statement, confidence}`（scope metadata 可保留），不得有 `display`/`coverage`；`client.js` 不得读取 `entry.display`、`coverage`、`untranslated`、`translated` 或 translation fallback；
- 生产 `lib/` 的 grep 验收：`grep -RInE 'display\.zh\.json|loadDisplayMap|writeDisplayMap|mergeDisplayMap|pruneDisplayMap|scopeStatementKeys|write_display_file|createTranslateTools|TRANSLATE_PROMPT|buildTranslateInput|collectUntranslatedEntries|parseTranslateArg|translateProgress|enqueueTranslate|coverage|untranslated|translate' lib` 结果为空（允许普通语言学意义的 `translate` 不存在；历史设计引用也不得留在生产注释）。package/README 同样不得声明 translate/display 功能。测试只保留本节 8.5 指定核心回归，不以旧测试兼容为由保留死 API。

### 8.4 中文单轨迁移事务

迁移是一次性命令/脚本，不进入运行时分支。执行前先锁定并盘点每个 scope：全局 `/home/CNS2026495165/.dsh/taste`、当前 Dexterous 项目 `.dsh/taste`，以及各自递归白名单 `taste.md`（根和一级 category，若实现递归发现则记录全部相对路径）。盘点报告只作为一次性证据，逐文件记录条目数、规范化键集合、sidecar 键数、精确匹配数、未匹配键、缺失 sidecar、规范化碰撞和翻译失败。

先在 scope 独立 staging 目录生成所有新 `taste.md`，逐文件 parse 后断言条目数相等、每条原文/sidecar/受控翻译来源唯一且可追溯、输出置信度统一 `formatTasteConfidence` 为 `0.90`/`1.00`/`0.88` 两位。sidecar 不全匹配、幽灵键、多键归一化到同一条、同一条候选翻译冲突或翻译失败，均写失败清单并使该 scope staging 失败；失败 scope 不 rename、不删除任何旧文件。所有 scope staging 和全量校验成功后，按 scope 原子 rename 提交；提交前每个 scope 目录进入带时间戳临时备份（taste、sidecar、config），记录 manifest/hash。任一 rename/校验失败立即停止提交并按 manifest 回滚已提交 scope；旧 sidecar 只在全部提交成功后改名为时间戳备份，不直接 unlink。staging、备份、失败清单路径输出给人工复核；迁移幂等，二次执行遇到已中文本体不得生成新差异。

全局当前已盘点 24 条、sidecar 16 键（因此至少 8 条未匹配）；项目约 14 条、sidecar 14 键，但仍须逐条校验，且 category 文件不可遗漏。Command Code 发现路径为空也必须记录“未发现”；若发现，只读扫描、报告英文/中文状态和上游迁移责任，dsh-taste 绝不回写，兼容显示英文必须明确标记为未完成中文单轨。

### 8.5 中文入口与最小测试集合

自然语言、prompt、工具描述/错误、输入包装、NEW/prior/final 摘要全部中文；协议字段名、工具名、路径名和 `Confidence` 语法可保持英文。`backfill` 与实时入口统一传 evidence，不再自行收集 assistant 文本；prior 仅历史参考，NEW 仅当前轮且 user-primary 必须存在；`no changes` 只接受并归一为最终中文 `无变化`，其它最终摘要必须是简短中文 taste 变更总结，禁止项目任务结果。

删除明确旧测试：`translate.test.js` 全部；`collector/learner-tools/storage/bridge/client/index` 中所有 display sidecar、coverage、`display` 参数、write_display、translate 命令/工厂断言；删除只为旧英文 prompt/英文陈述服务的断言。保留最小核心：collector 的真实 user（含 query_peers/read_taste_file/inbox 字样）、用户引用 assistant 纠正、agent/inbox/spliced 内外层、tool call/result、RPC、system/runtime fixture、未知 source fail-closed、assistant-secondary 结构和 assistant-only 无 NEW；backfill/prior provenance 顺序；learner 中文 prompt/三工具/角色隔离/curation/no-change；storage 两位输出、解析兼容、锁/原子写、分层与 Command Code；bridge/client 无 display 字段且删除/模型路由；迁移 fixture 覆盖 sidecar 不全匹配、碰撞/幽灵键、一级 category、失败保留旧文件、staging 回滚。不得新增冗余测试，核心污染回归必须保留。

## 9. 源码复验结论（修订后亲读；2026-09-04）

本次修订后再次亲读 `lib/collector.js`、`lib/backfill.js`、`lib/index.js`、`lib/learner.js`、`lib/learner-tools.js`、`lib/storage.js`、`lib/bridge.js`、`lib/client.js`、`lib/commands.js`、`lib/translate.js` 及对应测试和 `git diff`。复验事实仍为实现未改：collector 虽已有同名分类函数，但 source 仅读取 `data.source.kind`，assistant 缺失 source 仍放行，未检查嵌套 inbox/spliced/RPC；backfill 仍用 `collectTurnTexts` 并在 prior 无分类地收集 assistant；index 仍接线 translate 分支和 sidecar；learner-tools/storage/bridge/client/commands 仍保留 display 双轨；`formatTasteConfidence` 对整十分数仍可输出一位；测试仍是旧双轨基线（此前 257/257）。因此本文是可执行的修订设计而非实现完成证明，当前裁决保持 **needs-revision**，不得据绿灯测试 approve。

## 10. 缺口闭环修订记录（2026-09-05）

本节是对独立复核六项缺口的可执行裁定；与前文冲突处以本节为准。

### 10.1 `classifyEventForTaste` 唯一契约与字段优先级

生产只调用 `classifyEventForTaste(event)`；兼容函数 `isLearnableUserEvent` 只能比较其 `kind`，不得另行判断。输入必须是生产真实 shape `{type, data}`：`data.source.kind` 优先于字符串 `data.source`，消息正文 user 取 `data.content`，assistant 先取 `data.message.content`（该字段存在但非数组即拒绝，不回退），仅字段不存在时回退 `data.content`。唯一返回结构严格为：

```js
{ kind: "reject" | "user-primary" | "assistant-secondary", reason: string }
```

短路顺序及 fail-closed 分支固定如下：

1. `event`/`event.data` 不是普通对象、`type` 缺失或非字符串、type 非精确 `user/message` 或 `assistant/message`，返回 `reject/event-shape-or-type`。
2. source 解析只接受 `data.source.kind` 字符串，或兼容的 `data.source` 字符串；若两者都缺失，仅对 user 事件继续（且仅当 role 缺失或为 `user`）。user 的 source 必须精确 `user`；assistant 的 source 必须精确属于 `assistant|model|llm`。自动化枚举 `plugin|tool|system|runtime-context|agent|rpc|subagent|automation|inbox|spliced` 与任何未知值均返回 `reject/unknown-or-automated-source`；assistant 缺失 source 也拒绝。
3. `data.role` 存在时必须和 type 一致，否则 `reject/role-mismatch`。正文容器非数组返回 `reject/content-shape`；过滤后无非空 `{type:"text", text:string}` 返回 `reject/no-visible-text`。只跳过图片、thinking、toolCall/toolResult、结构化参数等 block，不把它们转成文本。
4. user 的 `data.message`、`data.source` 或正文对象/数组中若存在嵌套记录：记录的 `type` 属于 `agent/inbox`、`agent/inbox/spliced`、`tool/*`、`rpc/*`、`system`、`runtime-context`，或记录 source.kind 为自动化/未知，返回 `reject/embedded-automation-record`。只检查对象记录，不扫描字符串关键词；因此真实 user 文本讨论 `query_peers`、`read_taste_file`、inbox 仍被保留。

分类后唯一 evidence shape 为 `{user, assistant}`，每项必须同时有 role、provenance、text：`user` 项为 `{role:"user", provenance:"user-primary", text}`，`assistant` 项为 `{role:"assistant", provenance:"assistant-secondary", text}`。`collectTurnEvidence` 是实时、prior、backfill 的唯一生产收集出口；`collectTurnTexts` 不得被生产入口调用。固定 fixture 必须覆盖上述每一拒绝分支、外层/内层 inbox/spliced、RPC/tool/system/runtime，以及未知 source fail-closed。

### 10.2 assistant-secondary 消费规则

NEW 先列全部 user-primary，再列 assistant-secondary；若 NEW 的 user 数为零，代码不入队。assistant-secondary 只能对同一 NEW 中 user-primary 已明确提出的同一偏好作辅助佐证；其文本不得提供置信度锚点，不能单独创建、升级、汰换。assistant-only、执行报告、计划、错误、下一步指令即使有可见 text，也不得产生任何 taste 写操作。prompt 与测试双重验证该规则；prior 只解析指代，不成为 NEW 证据。

### 10.3 display/translate 删除符号清单与验收

生产 `lib/` 必须对以下 grep 清单返回零行（历史报告/本设计中的文字不计）：`DISPLAY_FILENAME|display\\.zh\\.json|loadDisplayMap|writeDisplayMap|mergeDisplayMap|pruneDisplayMap|scopeStatementKeys|sanitizeDisplay|write_display_file|createTranslateTools|TRANSLATE_PROMPT|buildTranslateInput|collectUntranslatedEntries|parseTranslateArg|translateProgress|enqueueTranslate|coverage|untranslated|translate`。删除 `storage` sidecar API/锁维护，`learner-tools` display 参数及翻译工厂，`index` 翻译 job/deps，`commands` translate dispatch/覆盖率/usage，`lib/translate.js`，以及 bridge/client 的 display/coverage/fallback。`bridge getTree` 每个 entry 只能有 `statement, confidence`；GUI 直接显示 statement。package、README、配置和测试不得宣称该功能。验收另执行 `grep -RInE` 并检查静态 import/export，不能以删测试掩盖死引用。

### 10.4 中文单轨迁移事务

迁移命令执行前对 global `/home/CNS2026495165/.dsh/taste` 与当前 Dexterous `.dsh/taste` 分别加 scope 锁，递归枚举根及一级 category 白名单 `taste.md`，生成盘点 manifest：每文件条目数/规范化键、sidecar 键数、精确匹配、未匹配、幽灵键、规范化碰撞、多候选翻译冲突、缺失 sidecar、翻译失败。sidecar 不全匹配、碰撞、冲突或无法可靠翻译任一项即该 scope staging 失败；不猜测、不选择、不提交。

每 scope 独立 staging 全部文件，输出每个 confidence 为 `formatTasteConfidence` 的固定两位（如 `0.90`,`1.00`,`0.88`），parse 后断言条目数、键集合和翻译来源逐条可追溯。任何 scope 失败、校验失败、rename 失败，均不提交该 scope；若已有 scope 提交，则按 manifest/hash 从临时备份回滚全部已提交 scope。备份在提交前建立，包含 taste、sidecar、config，带时间戳且保留；成功仅把旧 sidecar 改名为备份，不直接 unlink。所有 staging 完成后才按 scope 原子 rename；staging、manifest、失败清单、备份路径打印给人工复核。二次执行已中文本体必须幂等。Command Code 只读扫描；路径不存在也记为“未发现”，发现英文则报告上游责任和兼容告警，dsh-taste 永不写入。

### 10.5 中文入口契约

自然语言和所有提示、工具 description/schema、错误、`buildLearnerInput` 的 Current/Previous/NEW 标签、backfill blocks、prior evidence、NEW evidence、最终摘要全部中文；仅协议字段名、工具名、路径名和 `Confidence` 语法保留英文。`runLearner` 只接受中文 taste tree + provenance evidence；`no changes` 仅归一为 `无变化`，其它 final 必须是简短中文 taste 变更总结，不能成为项目任务结果。backfill 与实时路径都调用 evidence collector；不传裸 `userText/assistantText`，不把 final 写回文件。

### 10.6 最小测试集合与明确删除项

删除 `translate.test.js` 全部；删除 collector/learner-tools/storage/bridge/client/index 中所有 display sidecar、coverage、display 参数、write_display、translate 命令/工厂和旧英文 prompt/陈述断言。保留一套核心 storage 删除/解析断言和一套 bridge 端到端断言，避免重复。

保留/改造的最小回归为：collector 真实 user（含 query_peers/read_taste_file/inbox 字样）保留；用户引用 assistant 后纠正为 user-primary；外层/内层 agent/inbox/spliced、tool call/result、RPC、system/runtime、未知 source 拒绝；assistant-secondary 的 role/provenance 顺序及 assistant-only 无 NEW；实时/backfill/prior provenance 分界；learner 中文 prompt、三工具、角色隔离、curation/no-change；storage 两位写入/旧格式解析、锁/原子写、project/global/Command Code；bridge/client 无 display 且删除/模型路由；迁移 fixture 覆盖不全匹配、幽灵键/碰撞、一级 category、失败保留旧文件、staging 回滚。不得新增同义测试或以旧 257 绿灯作为验收。

## 11. 修订后源码复验结论（2026-09-05）

亲读 `git diff` 后再读 `lib/collector.js`、`backfill.js`、`index.js`、`learner.js`、`learner-tools.js`、`storage.js`、`bridge.js`、`client.js`、`commands.js`、`translate.js` 及测试。复验结论：六项缺口在当前代码仍未实现，本文仅完成设计修订，裁决为 **needs-revision**：collector 仍允许缺失 assistant source、未做嵌套记录 fail-closed，backfill 仍调用 `collectTurnTexts` 且裸收集 assistant；生产 grep 仍命中完整 display/translate 符号，bridge/client 仍返回/消费 display 与 coverage，translate.js 仍存在；迁移事务脚本、staging/manifest/回滚 fixture 尚未出现；learner 输入标签与 prompt 仍含英文，translate 覆盖入口仍存在；当前 `node --test test/*.test.js` 为 247/257（10 fail），即使修复失败测试也不能证明新契约完成。未修改任何源码、测试或既有 GUI/curation/boundary 变更。

### 10.7 字段优先级歧义消除（2026-09-05）

“source 优先”不是回退绕过规则：若 `data` 不是普通对象即立即 `event-shape-or-type`；若存在 `data.source` 字段，则仅当它是普通对象且 `source.kind` 为字符串时读取该 kind，或仅当 source 本身为字符串时读取该字符串；`source` 为对象但缺失/非字符串 `kind` 时直接 `unknown-or-automated-source`，绝不再按“缺失 source”兼容放行。只有 `source` 字段完全不存在，才允许 user/message 在 role 缺失或严格为 user 时兼容放行；assistant/message 无 source 永不放行。`data.role` 与 type 校验在 source 闸门之后执行。正文选择也不允许静默替代：assistant 若 `data.message` 存在而 `content` 非数组，返回 `content-shape`，只有 `message` 字段不存在时才检查 flat `data.content`。

源码复验还确认当前 `storage.formatTasteConfidence` 对 0.9/1 输出一位、`learner.buildLearnerInput` 标签为英文、commands 状态/开关文案为英文，且 `config.example.json` 仍需同步 ultra 路由；这些事实均属于实现阶段阻塞项，不改变本文“不改代码”的范围。

## 12. 六项硬问题复验结论（设计第 2 版；2026-09-05）

本次复验重新对照 `REVIEW-unified-chinese-taste.md` 的六项硬问题，亲读本设计第 2 版新增的 8.1–8.5、10.1–10.7 条款，并抽查当前 `dsh-taste` 源码确认这些条款尚未被代码实现。复验范围是“审计问题是否已在设计中落实”，不是把当前源码误报为已完成实现；未修改源码、测试或 GUI。

| 审计硬问题 | 设计落实核对 | 结论 |
|---|---|---|
| 1. 确定性 provenance/evidence API 与真实事件 fixture | 10.1/8.1 已固定生产唯一 `classifyEventForTaste(event)` 输入 `{type,data}`、唯一三值返回 `{kind,reason}`、source/role/content 字段优先级、短路原因、未知来源 fail-closed、嵌套 inbox/spliced/RPC/tool/system/runtime 拒绝规则；同时明确 `collectTurnEvidence` 的 role/provenance shape、实时/backfill/prior 唯一出口及覆盖每个分支的固定 fixture。 | 已落实 |
| 2. assistant 仅辅助且 assistant-only 不学习 | 10.2/8.2 已规定 assistant 必须是可证明模型来源的 `assistant-secondary`，只能在同一 NEW 中 corroborate 用户已明确表达的同一偏好，不得提供置信度锚点、创建/升级/汰换；代码空 user 不入队，prompt 与测试双闸门，prior 仅解析指代。 | 已落实 |
| 3. display/translate 死引用清单 | 10.3/8.3 已给出生产 `lib/`、package、README、配置和测试的完整符号 grep 零行清单，覆盖 storage、learner-tools、index、commands、bridge、client、`lib/translate.js` 及静态 import/export 验收，并固定 bridge/client 的新 response/render 契约。 | 已落实 |
| 4. 逐 scope 迁移盘点、备份、staging、失败回滚、两位置信度 | 10.4/8.4 已固定 global/project 分 scope 锁与递归根/一级 category 盘点 manifest，记录匹配/未匹配/幽灵键/碰撞/冲突/翻译失败；逐 scope staging、parse/条目与来源可追溯校验、固定两位输出、提交前备份 manifest/hash、全量成功后原子提交、任一失败按 manifest 回滚、失败保留旧文件、Command Code 只读及“未发现”报告。 | 已落实 |
| 5. 中文 prompt/tools/input/output 全入口 | 10.5/8.5 已逐项覆盖自然语言、LEARNER prompt、工具 schema/description/error、taste tree、Current/Previous/NEW、backfill/prior/NEW evidence、final 摘要及 `无变化` 归一；并明确协议字段/工具名/路径/`Confidence` 可保留英文、禁止项目任务结果及 final 回写。 | 已落实 |
| 6. 最小核心测试且不删除安全回归 | 10.6/8.5 已明确删除废弃 display/translate 断言但保留并新增核心污染安全回归：真实用户关键词不误伤、嵌套自动化拒绝、用户引用 assistant 保留、assistant-only 无 NEW、provenance 分界、角色隔离、分层/只读、删除/路由，以及迁移不全匹配/幽灵键/碰撞/category/失败保留/staging 回滚 fixture；并明确不得以旧 257 绿灯验收。 | 已落实 |

### 12.1 复验裁决

六项硬问题在设计层均已形成可执行、可审计、可测试的明确契约，未发现仍需补写的设计缺口，故本次**设计复验结论：approve**。

该 `approve` 仅批准设计已关闭上述六项审计问题，不代表当前源码已实现。源码抽查仍与第 11 节一致：生产 grep 仍命中 display/translate，`backfill` 仍使用裸 `collectTurnTexts`/assistant 文本，迁移事务与 fixture 尚未出现，中文输入标签及示例模型配置仍待实现阶段处理。实现完成后必须按 10.1–10.6 的静态清单、真实 fixture、迁移演练和核心测试重新验收；不得以当前旧版 257/257 基线替代新契约验收。
