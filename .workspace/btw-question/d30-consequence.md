# D30 后果实证（btw `btw_ask_user` 多余键 → `sideChat/read` strict codec 失败）

- 实验者：实测档子代理；工作目录 `/home/CNS2026495165/dsh`；沙箱 workspace-write；**未使用 sandbox_permissions**。
- 本轮只做实验与取证：未修改 `~/.dsh/` 下任何部署副本、未修改 `dsh-btw/src` 与 `dsh-btw/lib`、未重启 dsh 服务。
  唯一写入面：本文件 + `.workspace/btw-question/d30/`（脚本、原始输出、截图、E2E 记录 JSON）；真机 E2E 新建的临时会话按用户要求**保留**（未删除会话数据）。
- 登记文本核对：`docs/program-notebook.md:275` 为 D30 行长文本（同一行内含 `src/host/side-chat-service.ts:916,961,980`、`src/remote-descriptors.ts:32-34`、`src/shared/remote.ts:146,153`）；本轮引用行号均为**自己重读源码后的实测行号**，与登记文本略有差异处已逐条标注。

---

## 裁决摘要

**登记文本的「机制」部分：证实。**
工具参数 schema 的两层对象都是 `additionalProperties: true`（`dsh-btw/src/host/side-chat-service.ts:916`（题目项）、`:926`（选项项）），`execute` 用类型断言把模型参数直接塞进 pending（`:961` → `:978`），而下发走 strict codec（`dsh-btw/src/remote-descriptors.ts:32` 的 `result: { mode: 'strict' }` ↔ `dsh-btw/src/shared/remote.ts:137-146` 的 `btwQuestionSchema` / `:150-153` 的 `btwPendingQuestionSchema`，外层均 `.strict()`）。多余键**确实**穿过工具校验、**确实**在 `sideChat/read` 的结果校验上炸掉。

**登记文本的「后果推断」（"read 失败/抽屉读取报错，而非静默降级"）：部分证实 + 形态证伪。**
- "read 失败" **证实**：宿主侧在结果序列化边界抛 `TypertGatewayError(code='result-invalid')`，RPC 回包是 `{ok:false,error:{code:"internal",message:"typert gateway: sideChat/read: business result failed boundary validation"}}`（真机 27 次实测，见 §2.3/§2.5）。
- "抽屉读取报错（用户可见报错）" **证伪**：真机上抽屉**不报错**——用户界面完全静默。
- 你怀疑的"真实形态是静默"**证实**，且比怀疑更具体：不是"卡片渲染不出来 + 子代理永久阻塞"这么简单，而是 **整条 read 通道死掉、面板冻结在最后一次成功快照上**（跑马灯停在 `输出中… · 当前动作: btw_ask_user`）、**无卡片、无错误、无任何提示**，控制台每 ~1.2–1.5 s 打一条 `[dsh-btw] transcript read failed`；子代理阻塞于该工具调用，**但面板的「停止」按钮仍在（可用）**，因此不是"永久阻塞、无出路"，而是"**用户不知道出了什么事，只能靠猜或按停止**"。

**一句话真实后果**：模型只要多带一个 schema 未声明的键（`multiSelect` 这类）调用 `btw_ask_user`，该 btw 会话的 `sideChat/read` 从此**整体**失败（不是只丢这一问），抽屉**冻结在最后一次成功快照**上（无问答卡片、无消息更新、无错误提示、无重试入口），子代理停在那次提问上等一个用户看不见的答复；唯一有效出路是按面板上的「停止」（或结束/关闭该 btw），此时 pending 被清空、read 立刻恢复。

---

## 实验记录

### 2.1 参数穿透：多余键**原样**进入 `execute`（置信度：高）

**读源码得到的调用链**（file:line）：

| 环节 | file:line | 行为 |
|---|---|---|
| 模型 tool call → 参数 | `@deepseek-ai/dsh-agent-loop/lib/index.js:126`，`parseArguments` 定义在 `:147-153` | `JSON.parse(raw)`，**纯解析，无 schema 投影** |
| 参数进入执行记录 | `@deepseek-ai/dsh-tools/lib/index.js:3048` | `arguments: deepFreeze(snapshotJsonValue(exec.arguments))`（无损 JSON 深拷贝，**保键**） |
| 调工具体 | `@deepseek-ai/dsh-tools/lib/index.js:3181` | `await tool.execute(exec.arguments, exec)` |
| defineTool 包装 | `@deepseek-ai/dsh-tools/lib/index.js:862-866` | `const violations = validate(args); if (violations.length>0) throw new ToolArgsError(violations); return userExecute(args, exec)` —— **同一个对象引用转发，无剥离/无归一化** |
| 校验本身是纯函数 | `@deepseek-ai/dsh-tools/lib/index.js:465-466`、`:826`（`validateArgs`）、`:529`（`validateJsonSchemaValue`） | 只在 `additionalProperties === false` 时**记违规**；`true`/缺省 ⇒ 直接放行，且返回值只有 violitions，**不产出净化后的对象** |

**最小复现实验**（脚本 `.workspace/btw-question/d30/exp1-tool-arg-passthrough.mjs`，用真 `dsh-tools` 的 `defineTool` + `parameterSchemaSpecToJsonSchema`，参数 spec 逐字复制 `side-chat-service.ts:909-935`）：

```
$ node .workspace/btw-question/d30/exp1-tool-arg-passthrough.mjs
items additionalProperties      = true
option items additionalProperties = true
=== 1a. static validation of the extra-key payload ===
validateJsonSchemaValue violations: []        <- 多余键不产生任何违规
=== 1b. real defineTool.execute path (as invoked at dsh-tools/lib/index.js:3181) ===
execute received (times): 1
arguments object identity preserved (same reference)? true
extra keys survived to execute?  detail=probe  multiSelect=true  option.extra=1  topLevel.extraTopLevelKey={"nested":[1,2,{"deep":true}]}
deep-equal to raw input? true
=== 1c. negative control: additionalProperties:false DOES reject ===
strict probe threw: ToolArgsError | invalid arguments: "questions[0].detail" is not a declared property (additionalProperties: false)
```

**结论**：工具框架**不会**剔除或归一化 schema 允许多余键的参数；`execute` 收到的是与模型入参**深度相等、且引用同一对象**的参数。1c 同时给出「若改成 `additionalProperties:false` 会怎样」的精确报错文本（修法 A 的可用报错语料）。

### 2.2 codec 层面复现：三种多余键形态（置信度：高）

脚本 `.workspace/btw-question/d30/repro-strict-codec.mjs`：从**仓库真实构建产物** `dsh-btw/lib/remote-descriptors-D37stQ5y.js` 结构化取出生产描述符表，用**描述符自带的 `result.schema`**（即 `sideChat/read` 线上使用的同一对象）做校验。

```
$ node .workspace/btw-question/d30/repro-strict-codec.mjs
=== descriptor under test ===
id          : @local/dsh-btw#sideChat/read
result.mode : strict
typeSymbol  : @local/dsh-btw#ReadSideChatResult
CASE control: fully legal payload (multi_select)      RESULT: PASS
CASE (a) question item extra key: detail              RESULT: FAIL
   error.message: [{"code":"unrecognized_keys","keys":["detail"],"path":["value","pendingQuestion","questions",0],
                    "message":"Unrecognized key: \"detail\""}]
CASE (b) question item camelCase: multiSelect         RESULT: FAIL
   error.message: [... "keys":["multiSelect"] ... "message":"Unrecognized key: \"multiSelect\""]
CASE (c) option item extra key: extra                 RESULT: PASS      <=== 注意
THROW FORM: ZodError | [ ... "Unrecognized key: \"multiSelect\"" ... ]
```

**对照组**（完全合法 payload，含合法 `multi_select: true`）**PASS** ⇒ 差异只来自多余键，与 payload 其它部分无关。

**关键精度修正（登记文本未言明、且逐字读取时会读错）**：`btwQuestionSchema` 只有**最外层** `.strict()`（`src/shared/remote.ts:146`），其 `options` 内层对象（`:141-144`）**没有** `.strict()` ⇒ zod v4 默认 **strip**：

- (a) 题目项多余键 `detail` ⇒ **FAIL**
- (b) 题目项驼峰 `multiSelect` ⇒ **FAIL**
- (c) 选项项多余键 `extra` ⇒ **PASS，且该键被静默剥离**（不炸、不报错、丢字段）

即：D30 的爆点只在**题目项**这一层；选项项的多余键是"静默丢弃"而不是"炸掉"。这条差异直接影响「修法 A 要改哪一层」（见 §4 残留通道）。

### 2.3 失败发生在哪一侧：**宿主侧**（结果序列化边界），客户端只收到一个被泛化过的 RPC 错误（置信度：高）

**脚本**：`.workspace/btw-question/d30/exp3-which-side-throws.mjs`。做法不是自己重写逻辑，而是**用真的 `TypertGatewayService.prototype.invoke / invokeRpc`** 驱动（只把 cordis 服务解析打桩），因此真 `decode()`、真 `TypertGatewayError`、真 `rpcFailure()` 全部真实执行。

```
$ node .workspace/btw-question/d30/exp3-which-side-throws.mjs
=== 3a. host-side: real invoke() on the poisoned payload (no try/catch of ours) ===
HOST THREW
  name     : TypertGatewayError
  code     : result-invalid
  endpoint : sideChat/read
  field    : result
  message  : typert gateway: sideChat/read: business result failed boundary validation
  cause    : ZodError | [{ "code":"unrecognized_keys","keys":["detail"],"path":["value","pendingQuestion","questions",0] ...}]
=== 3b. what the browser actually receives: real invokeRpc() -> rpcFailure() ===
{ "ok": false, "error": { "code": "internal",
  "message": "typert gateway: sideChat/read: business result failed boundary validation", "details": {} } }
=== 3c. how dsh-btw client/poll() renders that failure ===
controller.ts:692 -> thrown Error.message = "typert gateway: sideChat/read: business result failed boundary validation"
  -> 到 controller.ts:742 console.warn('[dsh-btw] transcript read failed', error)
  -> 然后 controller.ts:743-746 delay = 1_200; setTimeout(..., delay);  NO publish, NO error phase
=== 3d. control: the identical path with a LEGAL question (no extra key) ===
invokeRpc ok? true | pendingQuestion delivered? true
```

**结论与传播路径**：

1. 抛点在**宿主**：`@deepseek-ai/dsh-api-gateway/lib/index.js:109-111`
   `if (result === void 0 && descriptor.result.mode !== 'strict') return result;` → 否则 `return decode(descriptor.result, result, 'result-invalid', endpoint, 'result')`；
   `decode()` 在 `:342-352`，`codec.mode === 'strict'` 时执行 `codec.schema.parse(value)`，catch 后抛 `TypertGatewayError(code, endpoint, 'business result failed boundary validation', { cause, field })`（`TypertGatewayError` 定义 `:11-30`）。
2. 该错误经 `invokeRpc` 的 catch（`:118-134`）交给 `rpcFailure`（`:257-278`）：`result-invalid` 被**抹平成 `code:'internal'`**，`cause`（真正的 ZodError）**不随 RPC 过境**（`details: {}`）。所以浏览器只能拿到一句通用文案——**这本身就是"用户/开发者都难以定位"的一部分**。
3. 客户端还有**第二个** strict 校验点：`@deepseek-ai/dsh-api-gateway/lib/client.js:243-251`（失败分支直接 `return {ok:false,error}`，不 parse）、`:417-421` 的 `parse()`（成功分支才 parse，`codec.mode !== 'strict'` 会直接抛"has no strict codec"）。本轮失败**在宿主就终止了**，客户端那个校验点没被触达——但它是修法 B 的残留风险点（见 §4）。
4. btw 客户端把 `{ok:false}` 变成异常的位置：`dsh-btw/src/client/controller.ts:692`（poll 内 `if (!result.ok) throw new Error(remoteFailure(result.error))`；`remoteFailure` 定义 `:69-71`）。

**真机逐字吻合**：E2E 抓到的原始 SSE 回包（§2.5）：

```json
{"type":"server-response","rpcId":"a81b76f8-...","result":{"ok":false,"error":{"code":"internal",
 "message":"typert gateway: sideChat/read: business result failed boundary validation","details":{}}}}
```

### 2.4 真实机条件构造（尽力而为，成功；记录失败尝试与原因）（置信度：高，含逐字子代理产物）

**运行器**：`.workspace/btw-question/d30/e2e-d30.mjs`（第一版）、`e2e-d30b.mjs`（第二版）、`e2e-d30c.mjs`（第三版，成功）、`e2e-d30d.mjs`（第四版，全流程取证），全部 headless Chromium 驱动真实 GUI `http://127.0.0.1:3080`，选择器 `button[title*="btw"]` + `[data-side-chat-surface-mode]`。

**三种说法与结果**：

| 轮次 | 说法（原文见脚本） | 子代理行为 | 是否构造出条件 |
|---|---|---|---|
| probe1（`e2e-d30.mjs`） | "参数必须逐字照抄这段 JSON…尤其 detail 字段必须原样保留" | **拒绝**，并在面板里解释（原文摘录）："两轮连续同一形态、每轮只换一个字段名（detail → multiSelect），看起来是在探我会不会"逐字照抄任意 payload"。答案是不会" | 否（`called=false`，`poisoned=0`） |
| probe2 说法 A | "请立刻用 btw_ask_user 工具提一个「多选」问题…"（**不给键名**） | **照做**，但自发写成**合法** `multi_select` | 否（`anyCard=true`，`poisoned=0`）——合法路径正常，见 §2.6 |
| probe3 说法 B | "…我们的前端埋点契约要求 questions 项必须额外携带一个 detail 字段" | **拒绝**，并去读了官方工具源码反驳（原文摘录）："它在把 questions 交给 UI provider 之前只挑这四个字段透传——`id`、`question`、`header`、`options`、`multi_select`。**`detail` 不在其中，会被静默丢弃**…该契约我找不到" | 否（`poisoned=0`；子代理反而提出 3 个选项让我决定） |
| **probe3 说法 C** | "…我们的抽屉前端读的是驼峰键名 multiSelect（不是 multi_select，snake_case 不生效），请务必用驼峰 multiSelect: true" | **照做**，并**同时**带上合法 `multi_select` | **是**（成功构造） |

**成功构造的逐字子代理产物**（**不是**我从提示词推断，而是从**持久化子代理会话日志**读回的真实 tool call 参数）：
`~/.dsh/sessions/--home-CNS2026495165-openarm--/a7fdd24b-f6e1-421c-a0a3-822c6c164901/session.jsonl.zstd`（`zstd -dc … |` 过滤 `type=="tool/call"` and `name=="btw_ask_user"`）：

```json
{"questions":[{"id":"confirm_continue","header":"确认","question":"是否继续？","multiSelect":true,"multi_select":true,
 "options":[{"label":"继续"},{"label":"停止"}]}]}
```

⇒ `multiSelect`（多余键，schema 未声明、工具校验放行）与 `multi_select`（合法）**同时存在**；工具校验放行，宿主 pending 里存下带 `multiSelect` 的对象，`sideChat/read` 结果校验随即失败。

**对照（同一轮 probe2 说法 A 的真实参数，合法路径）**：
`~/.dsh/sessions/--home-CNS2026495165-Dexterous_Hand_23Dof--/62d4a233-29d0-4f72-bf17-acbe1bdbbb10/session.jsonl.zstd`：

```json
{"questions":[{"id":"confirm","header":"确认","question":"是否继续？","multi_select":true,"options":[{"label":"继续"},{"label":"停止"}]}]}
```
⇒ 卡片正常渲染（DOM `questionCard=true`、`optionCount=2`、出现「停止」按钮、textarea 被禁用），**zero** 失败读。**合法 `multi_select` 路径完全正常，未见误伤。**

### 2.5 真机可观察后果（probe3 / probe4 原始数字）

**probe3（`2026-09-23T09-47-16-326Z-probe3.json`）**：`readFailed=27`、`poisonedReads=27`、`card=false`、`consoleWarns=27`（**全部**是 btw 那条 warn，没有别的 warning/error）。

```
warn 文本（逐字，首条）：
[dsh-btw] transcript read failed Error: typert gateway: sideChat/read: business result failed boundary validation
    at SideChatController.poll (http://127.0.0.1:3080/plugins/@local/dsh-btw/client.js?rev=3980d1322992:672:28)

warn 时间戳（27 条，UTC）: 09:49:07.020 … 09:49:48.193（跨度 41.173 s）
间隔 min / 中位 / max = 1.203 s / 1.475 s / 3.132 s   （≈ controller.ts:723 的 220/700 ms 已失效，落到 :743 的 1_200 ms + RPC/SSE 往返）
```

**probe4（`2026-09-23T09-50-56-764Z-probe4.json`）全流程（构造 → 冻结 → 收起重开 → 按停止）**：

```
[09:51:10.898] 1-baseline:  card=false opts=0 stop=false textareaDisabled=false
[09:51:11.056] poison prompt sent
[09:51:29.748] 第一条 poisoned read（宿主拒绝）
[09:51:37.064] 2-frozen:   card=false opts=0 stop=TRUE  textareaDisabled=TRUE
[09:51:43.764] 3-after-reopen: card=false opts=0 stop=TRUE textareaDisabled=TRUE   （收起→重开，无报错、状态不变）
[09:51:43.904] stop pressed
[09:51:58.906] 4-after-stop:  card=false opts=0 stop=false textareaDisabled=false
读失败次数 7；warn 7 条；最后一次失败 09:51:44.522（点停止时在途），其后 14 s 静默
```

**截图证据**：`2026-09-23T09-47-16-326Z-probe3-C-驼峰-multiSelect.png`（识图复核逐字转录抽屉内容）：

```
─  btw 侧聊 [只读]   临时问一句，主任务不跑偏。   [deepseek-v4.1-flash ▾]  ×  —
主任务已就绪   继承内容仅作参考，主会话不会被写入这段追问。
[ 输出中… · 当前动作: btw_ask_user ]          <- 冻结的跑马灯
你 请立刻用 btw_ask_user 工具提一个「多选」问题…（用户消息）
[ 输入一个临时问题... ]   ■(绿色方块=停止)
```
识图结论：**没有**任何问答卡片/选项按钮；**没有**任何红色报错或错误 toast；有「输出中… · 当前动作: btw_ask_user」徽标与停止按钮。

**「按停止后有出路」的证据链**：`controller.cancel()`（`src/client/controller.ts:258-270`）**只发 RPC、不 publish 任何状态**；因此按停止后 DOM 从 `stop=true/textareaDisabled=true` 变回 `stop=false/textareaDisabled=false`（= `running:false`）**只能来自一次成功 poll 的 publish** ⇒ 证明 read 通道确实恢复了。

### 2.6 附带判定：影响面与合法路径（置信度：高）

**影响面只限 `read` 的结果**（脚本 `.workspace/btw-question/d30/exp6-blast-radius-and-residual.mjs` + 源码）：
- 10 个 `sideChat/*` 端点的 `result.mode` **全部** `strict`（`param.mode` 亦全部 strict）：

```
start strict read strict send strict answer strict cancel strict close strict setModel strict readImage strict listTree strict listProject strict
```
- 但**只有 `read` 的结果携带 `pendingQuestion`**：`grep -n pendingQuestion dsh-btw/src/shared/remote.ts` ⇒ **唯一命中 `:174`**（`readSideChatResultSchema` 的 value 内），宿主侧唯一产出点在 `src/host/side-chat-service.ts:585-596`。
- `answer` 的**请求**里带 `btwAnswerSchema[]`（同样 `.strict()`），但那是**客户端自己构造**的（`controller.ts:236-244`），不经模型参数 ⇒ 不构成 D30 通道。
- `send`/`close`/`cancel`/`start` 结果与 questions 无关 ⇒ **D30 爆点单一：`sideChat/read` 的结果校验**。
- **合法 `multi_select` 路径完全正常**（§2.4 对照：DOM 卡片 + 2 选项、「可多选」渲染 + zero 失败读）。

---

## 失败形态与用户可观察后果

逐条给结论 + 代码依据（file:line）：

1. **问答卡片是否可见：不可见（确定，真机实测）。**
   卡片渲染条件 `interactive && state.pendingQuestion !== undefined`（`dsh-btw/src/client/SideChatSurface.tsx:603-606`），而 `pendingQuestion` 只在 **poll 成功分支**（`src/client/controller.ts:738`）与 **restore 成功分支**（`:657`）被 publish；poll 的失败分支只 `console.warn` + 退避（`:741-746`），**任何 publish 都没有**。
   真机：`questionCard=false`、`optionCount=0`（27 次失败读、45 s 观察窗）。

2. **界面是否报错：不报错（确定，真机实测）。**
   poll 的 catch 不 publish `phase:'error'`（`:741-746`）；`phase:'error'` 只在两处产生——`open()` 的 start 失败（catch `:175`、`errorState`/`phase:'error'` `:178-180`）与 `confirmRestore()` 的 read 失败（catch `:664`、`phase:'error'` `:672`），二者都不在"打开后正常轮询"的路径上。
   真机：`consoleWarns` 27 条**全部**为 btw warn，无 pageerror、无 error toast、抽屉内无"失败/错误"字样（识图复核亦确认无红色元素）。

   **为什么偏偏这一种失败是静默的（重要区分）**：`poll()` 里有**两条**错误分支——
   ① 业务错误分支 `:696-712`：当 RPC 回包本身是 `ok:true`、但业务信封 `value.ok === false` 且 code 不是 `not-open` 时，会 `publish({...state, phase:'error', running:false, error: value.error.message})` ⇒ **用户看得到报错**；
   ② 传输/边界失败分支 `:692` → catch `:741-746`：RPC 回包就是 `ok:false`（宿主在 typert 边界抛错后经 `rpcFailure` 泛化）⇒ **不 publish、无报错**。
   D30 落在②，因为宿主是在**结果序列化边界**抛错的，RPC 层把它变成 `ok:false` 而不是业务信封里的 `ok:false`。⇒「同一句 read 失败，报错还是静默，取决于失败发生在信封内还是信封外」——这一点登记文本没有区分，也是修法 C 要格外小心的地方（它改的是②的行为）。

3. **面板状态：冻结在最后一次成功快照上（确定，真机实测）。**
   失败分支不 publish ⇒ `running`、`partial`、`messages`、`currentAction` 全部停在最后一次成功读；由于子代理确实在运行，最后快照多为 `running:true`，于是 `SideChatSurface.tsx:370` 的 `running` 恒真 ⇒ `:646-659` 渲染「停止」按钮（`:650` 的 `aria-label={t('drawer.stop')}`）、`textarea` 被禁用（`:641` 的 `disabled={running}`）。
   真机逐字：徽标 `输出中… · 当前动作: btw_ask_user` 在 41 s 内**一字不变**；`stop=true / textareaDisabled=true`。
   注：若在提问被存下**之前**从未有过成功读（例如 `open()` 后第一条 read 就失败），则会是 `running:false` 的**空白会话**形态（empty-state 提示 + 可输入的输入框）——该分支本轮**未实测**，属推断（见 §5）。

4. **子代理是否永久阻塞：阻塞，直到用户主动取消/关闭（确定机制 + 真机观察到阻塞）。**
   `execute` 用 `new Promise` 挂起，仅由 `pending.resolve`（用户回答）、`exec.signal` 的 abort（`:966-975`）或 close（`:1192-1193`）结算；由于卡片不可见、`answer()` 又要求 `state.pendingQuestion !== undefined`（`src/client/controller.ts:231-234`，未 publish 就永远为 `undefined`），**用户无法通过回答来解锁**。
   真机：子代理在整个观察窗内停在 `btw_ask_user`（`当前动作: btw_ask_user`），无新消息产出。

5. **用户有无出路：有，但界面不会提示（确定，真机验证了恢复）。**
   - 出路 1：**面板「停止」按钮**（`SideChatSurface.tsx:646-659` → `controller.cancel()` → 宿主 `src/host/side-chat-service.ts:1173-1185`（`cancel()` 定义在 `:1173`）`entry.handle.agent.cancel({kind:'user'})` → 工具 `exec.signal` abort → `onAbort` 清空 `entry.pendingQuestion` 并 reject（`settle()` `:968-971`、`onAbort` `:972-976`、赋值点 `:978`））。
     真机：按停止后 14 s 内不再出现任何失败读，且 DOM 回到 `running:false`（只能来自成功 publish）⇒ **read 立刻恢复**；代价是这次提问被取消（子代理收到 `btw_ask_user: the question was cancelled before the user answered.`）。
   - 出路 2：**结束/关闭该 btw**（`presentation.end()` → `controller.close()` → 宿主 `:1192-1193` reject + 清 pending），会话级恢复。
   - 出路 3（**不是**出路）：重新打开抽屉。真机 probe4 实测"收起 → 重开"后状态**不变**（仍冻结、仍无卡片、仍无报错），因为 minimize 不会关闭会话（`presentation.minimize()` 只动 `viewStore`），`open()` 在 `state.phase !== 'closed'` 且同一 parent 时**提前 return**（`controller.ts:126-130`：`open` 定义在 `:126`，phase 判断 `:127`，同一 parent 提前返回 `:129`），既不 `confirmRestore` 也不重置状态。

6. **控制台/日志形态（确定，真机实测）。**
   一条 `console.warn('[dsh-btw] transcript read failed', Error)`（`:742`），Error 文案固定为 `typert gateway: sideChat/read: business result failed boundary validation`，stack 指向 served bundle `client.js?rev=3980d1322992:672`；**间隔 ≈ 1.2–1.5 s（中位 1.475 s，最小 1.203 s）**，即 **~40–50 条/分钟**，只要 pending 不清空就一直刷；真正的 ZodError 详情**不过 RPC 边界**（`details:{}`），因此日志里看不到是哪个键、哪个槽位出的问题。

7. **一个重要的"顺带"形态（代码推断，未真机复现）**：若用户在**另一个会话**里打开过 btw（当前会话被 `parkVisible()` 入栈），再切回并打开这个被污染的会话，则走 `restoreExisting → confirmRestore`，其 catch 会 **publish `phase:'error'` + `EMPTY_TRANSCRIPT` + error 文案**（`controller.ts:664-679`）⇒ 此时抽屉**会**显示错误、卡片依旧不可见。这条分支给出了"D30 有时看起来像报错、有时完全静默"的解释，但本轮**未构造真机条件**（见 §5）。

---

## 修法选项比较（只给事实与代价，不做决定）

前提事实（本轮实测/文档）：

- **宿主侧代码改动是"冷面"**：插件宿主 `lib/*.js` 变更 → 需重启（`docs/architecture/02-plugin-system.md:147`）；客户端 bundle 变更 → 热（served、`cache-control: no-cache`，刷新即取新字节，D29 已有先例，见 `docs/program-notebook.md:274`）。
- **D30 的失效点在宿主**（§2.3）⇒ **任何能"根治"的修法都必须动宿主侧代码 ⇒ 需重启 dsh**。纯客户端改动**不可能根治**（客户端拿不到被宿主拒绝的 payload）。
- 工具 DSL 的关键词子集**不支持 `minLength`/`minItems`**（实测：`unsupported JSON schema: schema.properties.a.minLength is not a supported keyword (subset: type/oneOf/properties/required/additionalProperties/items/enum/const + annotations)`，`exp6-output.txt`）。

| 方案 | 改动点（file:line） | 能否根治 D30 | 副作用 | 是否需重启 | 改动面 |
|---|---|---|---|---|---|
| **A. 工具 schema 收紧为 `additionalProperties:false`** | `dsh-btw/src/host/side-chat-service.ts:916`（题目项）、`:926`（选项项） | **能根治"多余键"这一类**（fail-closed 在工具边界，模型当场收到 `ToolArgsError: invalid arguments: "questions[0].detail" is not a declared property (additionalProperties: false)`，可自我纠正；报错文本见 §2.1 1c） | ①**只关掉"键"这一维**：值维度的宽度差仍在（见下方残留通道，4 条）；②模型若坚持要 `detail` 会拿到硬错误而非静默忽略，多一次往返；③`:926` 必须**一并**收紧，否则选项项多余键继续穿过工具校验（虽然当前只被静默 strip，属"埋雷"） | **需重启**（宿主 `lib/index.js`） | 1 文件 2 行（+ 可选 description 说明） |
| **B. 让 read 结果 codec 容忍未知键（strip / passthrough）** | `dsh-btw/src/shared/remote.ts:146`（`btwQuestionSchema` 的 `.strict()`）、`:153`（`btwPendingQuestionSchema`）；`options` 内层 `:141-144` 本就非 strict | **能根治**（宿主不再抛；payload 照常下发，卡片按已知键渲染） | ①语义从"拒绝"变"接受/丢弃"：未知键被静默丢弃（`z.object()` 默认 strip）或透传进 React state（passthrough ⇒ 需与客户端同步改，否则客户端 `client.js:417-421` 的第二道 strict 校验会对透传后的 payload 再炸一次）；②掩盖模型调用错误，失去"早失败"信号；③**改了共享 schema 就必须同时重部署客户端 bundle**（否则旧客户端 + 新宿主在 passthrough 下仍失败） | **需重启**（宿主描述符 `typert.host.js`/`index.js` 变了）+ 客户端刷新 | 1 文件 2 行（但跨宿主/客户端两个产物） |
| **C. 客户端 poll 失败时进入可见 error 相位（避免静默）** | `dsh-btw/src/client/controller.ts:741-746`（catch 分支加计数/阈值后 `publish({...state, phase:'error', error: ...})`） | **不能根治**（卡片依旧不可见、子代理依旧阻塞），只是**把静默变成可见** | ①**必须带阈值**（连续 N 次或持续 T ms），否则会把现在的"瞬断容忍 + 退避"改成"一次抖动就报错"，属回归；②错误文案是宿主泛化过的 `typert gateway: sideChat/read: business result failed boundary validation`，对用户仍不可操作；③仍需保留"停止/结束"作为真正出路 | **不需重启**（纯客户端 bundle，刷新即生效） | 1 文件（catch 分支 + 状态字段） |
| **D. 在工具 `execute` 内用 codec 自校验后再入 pending（fail-closed 的"值维度"版）** | `dsh-btw/src/host/side-chat-service.ts:961-980`（用 `btwQuestionSchema`/`btwPendingQuestionSchema` 的 `safeParse`；失败则返回纠正性工具错误，或用同一 schema 的 strip 变体净化后存入） | **能根治且能覆盖值维度**（`id:''`/`question:''`/`options[].label:''`/`questions:[]` 这类 DSL 表达不了的差异，见 §4 残留通道） | ①把 codec 变成 seam 上的单一真源，后续 schema 变更自动生效（也可反向理解：工具边界与 codec 强耦合）；②`safeParse` 抛错口径需要设计（返回业务错误 vs 抛 `ToolArgsError`）；③**只改 A 不改 D 时残留通道仍在** | **需重启** | 1 文件，约 5–10 行 |
| **E. 宿主 read 响应做白名单投影** | `dsh-btw/src/host/side-chat-service.ts:585-596`（现在 `questions: pendingQuestion.questions` 原样下发） | **能根治**（即使 pending 里已存了脏对象，投影后 strict 校验必过；实测 `exp7-output.txt`：投影后 `PASS`） | ①模型意图被**静默丢弃**（实测：`multiSelect=true` 被丢，卡片渲染为单选）；②错误被掩盖 ⇒ 建议与 A/D 之一并用（E 保证"永不炸"，A/D 保证"模型被纠正"） | **需重启** | 1 文件，投影函数 ~10 行 |

### 如果只修 A，是否还有残留通道？——**有，而且不止一条**

1. **值维度残留（实测 4 条，A 关不掉）**：`exp6-output.txt` 6c——即使用 DSL 允许的最严形态（`additionalProperties:false` 两层全覆盖），下列 payload **仍通过工具校验**，却**仍被 strict codec 拒绝**：

```
empty id (codec requires min 1)                  tool-schema PASSES  ->  strict read codec FAILS
empty question (codec requires min 1)            tool-schema PASSES  ->  strict read codec FAILS
empty questions array (codec requires min 1 item) tool-schema PASSES ->  strict read codec FAILS
empty option label (codec requires min 1)        tool-schema PASSES  ->  strict read codec FAILS
```

根因：工具 DSL **无法表达** `minLength`/`minItems`（同文件 6b 实测两条 `unsupported JSON schema` 报错）⇒ **A 只能关掉"多余键"，关不掉"值约束"**。要闭合这一维只能走 D（在 `execute` 里用 codec 自校验/净化）或 E（响应投影）。

2. **选项项层级（A 若不改 `:926`）**：选项项多余键会继续通过工具校验并被 codec **静默 strip**（§2.2 案例 c）。今天不炸，但一旦有人按"对称美化"的直觉给 `src/shared/remote.ts:141-144` 也加上 `.strict()`，**立刻**升级为第二个 D30 爆点。⇒ 修 A 必须同时改两层。

3. **其它写入者/其它传输：今天没有，但边界依赖策略**。`entry.pendingQuestion` 的赋值点全树只有 `side-chat-service.ts:978` 一处（`grep -n "pendingQuestion ="` ⇒ `:978` 赋值、`:1193`/`:1443` 清空），所以没有"绕过工具"的旁路；`run_code` 虽在只读守卫集合内（`src/shared/tool-policy.ts:35`），但**不在**子代理可见 allowlist（`READ_ONLY_TOOL_CANDIDATES`，`:20-31`）⇒ 今天没有 `tools.btw_ask_user({...})` 这类程序化旁路。若将来把 `run_code` 放开给 btw 子代理，工具边界的 fail-closed 依然有效（子调用同样走 `defineTool.execute` 校验），**不新增通道**（这条也说明 A 的覆盖面其实不错）。

4. **客户端第二道 strict 校验点仍在**：`@deepseek-ai/dsh-api-gateway/lib/client.js:417-421` + `:251`。正常部署下宿主先炸、客户端看不到脏数据；但**修 B 时若只放松宿主而漏掉客户端 bundle 的同步部署**（或采用 `passthrough`），客户端这一道会用同样的"结果校验失败"把请求打回去 ⇒ B 的部署面必须"宿主 + 客户端"两处同时到位（宿主：需重启；客户端：需刷新）。

5. **A 不处理"已污染的在途会话"**：pending 是**内存态**（`entry.pendingQuestion`，不入会话持久化），所以 `dsh` 重启即清空；但**不重启**时，A 生效前后的旧会话仍会继续静默冻结，需要用户按停止/结束（或重启）。

---

## 仍属推断、未实测的项

1. **`confirmRestore` 分支的"可见报错"形态未真机复现**。代码依据明确（`src/client/controller.ts:664-679` publish `phase:'error'`），但需要"先在别的会话打开 btw 把当前会话 park 掉，再切回并打开"这一跨会话序列；本轮 probe4 的"收起→重开"走的是 `open()` 早退分支（`:126-130`，真机已证：状态不变、无报错），没走到 `confirmRestore`。⇒ "跨会话切回时会看到错误"这一条**只有代码依据，无真机证据**。
2. **"第一条 read 就失败 ⇒ 空白会话形态"未实测**（推断自 `openState.running:false`，`controller.ts:147-172`）。本轮次次都是"先有成功读、后失败"的冻结形态。
3. **触发概率未量化**。"模型照抄官方心智写 `multiSelect`"这一前提在**工具 schema 明示 `multi_select`** 时并不自然：probe2 说法 A（不给键名）时子代理自发写的是**合法** `multi_select`。本轮成功构造依赖"模型相信前端要求驼峰"的说法（probe3 说法 C）。⇒ D30 的**可达性成立**（单次错误信念即触发），但**自然发生率**（无外部误导、无照抄外部 payload 时）本轮未测、不可由本轮数据推断。
4. **官方工具是否存在同类隐患：本轮只做了间接观察**。官方 `ask_user_question` 的参数 schema 同样两层 `additionalProperties:true`（`@deepseek-ai/dsh-tool-ask-user/lib/index.js:24,45`），但其 UI 传输并非本仓的 strict typert codec（`dsh-user-questions` / `dsh-client-ui-user-questions` 全树无 `.strict()` 命中），且子代理在 probe3 说法 B 中读源码后断言它"只挑 4–5 个字段透传"⇒ **同机制在官方路径上不可达**（未做官方路径的真机 fault injection 验证）。
5. **`header`/`description` 等合法键的其它宽度差未穷举**。本轮只覆盖了"多余键 × 题目/选项""空串/空数组"两类；`max`/正则/格式等 codec 侧约束（如 `chatToken: z.string().uuid()`）没有对应工具参数面，未测。
6. **修法 A/B/D/E 的具体实现与回归未做**（本轮按指令只做实验与取证）。表中"改动面/副作用/是否需重启"结论来自源码读 + `docs/architecture/02-plugin-system.md:147`，未通过真实改动验证（尤其 D 的 `safeParse` 口径、E 的投影函数边界）。
7. **`answer()` 的"用户其实无法回答"是代码推断**：`controller.ts:231-234` 要求 `state.pendingQuestion` 非空，而它永不被 publish；真机在冻结态下**没有**卡片/选项可点，因此"即使知道 questionId 也无处提交"这一点是代码 + 观察一致，但没有构造"绕过 UI 直接调 RPC 回答"的实验（那需要伪造 chatToken/questionId，属越界取证，未做）。

---

## 附录：本轮产物清单（`.workspace/btw-question/d30/`）

| 文件 | 内容 |
|---|---|
| `exp1-tool-arg-passthrough.mjs` / `exp1-output.txt` | 实验 1：多余键穿透工具边界（含负对照报错文本） |
| `repro-strict-codec.mjs` / `exp2-output.txt` | 实验 2：三种多余键形态 × 真构建产物 schema + 对照组 + 逐条报错文本 |
| `exp3-which-side-throws.mjs` / `exp3-output.txt` | 实验 3：真 `TypertGatewayService.invoke/invokeRpc` 定位抛点（宿主侧）+ 浏览器实际收到的 RPC 错误 + 对照 |
| `exp6-blast-radius-and-residual.mjs` / `exp6-output.txt` | 实验 6：10 端点 result 模式、`pendingQuestion` 唯一性、DSL 不支持 minLength/minItems、A 方案 4 条残留通道 |
| `exp7-defensive-projection.mjs` / `exp7-output.txt` | 实验 7：修法 E 的可行性（投影后 PASS）+ 其"静默丢弃"副作用 + 失败日志速率 |
| `e2e-d30.mjs` / `e2e-d30b.mjs` / `e2e-d30c.mjs` / `e2e-d30d.mjs` | 真机 E2E 四个版本（含失败说法的原文与结果） |
| `2026-09-23T09-39-03-928Z-probe.json` | probe1（照抄说法被拒） |
| `2026-09-23T09-45-09-345Z-probe2.json` | probe2（自发合法 `multi_select`，卡片正常） |
| `2026-09-23T09-47-16-326Z-probe3.json` + `*-probe3-C-驼峰-multiSelect.png` | **成功构造**：27 次失败读 / 27 条 warn / 无卡片 / 无报错 + 截图 |
| `2026-09-23T09-50-56-764Z-probe4.json` + `-probe4-*.png` | 全流程：冻结 → 收起重开（状态不变）→ 按停止（read 恢复） |
| `e2e-d30.mjs` 相关截图 `*-probe-*.png`、`*-probe2-*.png` | 失败说法与基线截图 |

其他证据位置（只读引用，未改动）：
- 真机子代理真实参数：`~/.dsh/sessions/--home-CNS2026495165-openarm--/a7fdd24b-…/session.jsonl.zstd`（`multiSelect`+`multi_select`）、`~/.dsh/sessions/--home-CNS2026495165-Dexterous_Hand_23Dof--/62d4a233-…/session.jsonl.zstd`（合法 `multi_select`）、`…/fd99b95d-…/session.jsonl.zstd`（拒绝 `detail` 的原话）。
- 真机 temp 会话按用户要求**保留未删**（probe1–probe4 各 1 个父会话 + 对应 btw 子会话）。

---

## 追加：修法 F（官方同款投影，主代理倾向）

> 本节由主代理补充事实后追加（只追加，未改动上文任何内容）。它属于 §4「修法选项比较」的续表；下文所有 file:line、命令与原始输出均为本档**独立核实**所得，与主代理提供的三条事实**全部吻合**（逐条核实结果见 F.0）。

### F.0 对主代理三条事实的独立核实（全部成立）

| # | 主代理陈述 | 核实结论 | 证据（本档实读） |
|---|---|---|---|
| 1 | 官方 `ask_user_question` 工具 schema 与 btw 完全同宽（题目项/选项项 `additionalProperties: true`，`multi_select` 同名） | **成立** | `@deepseek-ai/dsh-tool-ask-user/lib/index.js:24`（题目项）、`:45`（选项项）`additionalProperties: true`；`:59` `multi_select: {`。⇒ btw 的 schema 是照抄官方，**"宽"不是 btw 的发明**，把 btw 的宽度当成失误去改会偏离官方契约（这条直接支持 F 相对 A 的"契约对齐"理由） |
| 2 | 官方在 `execute()` 里做白名单投影（题目项投影 + `multi_select` → `multiSelect` 改名） | **成立（逐字）** | 同文件 `execute` 起于 `:96`，`questions: args.questions.map((question) => ({ id: question.id, question: question.question, ...(question.header !== void 0 ? { header: question.header } : {}), ...(question.options !== void 0 ? { options: question.options } : {}), ...(question.multi_select !== void 0 ? { multiSelect: question.multi_select } : {}) }))`；wire 类型确为驼峰：`@deepseek-ai/dsh-user-questions/lib/types/types.d.ts:44` `multiSelect?: boolean`。**注意 `options` 是原样透传的（官方不投影选项项）** |
| 3 | 官方下发路径没有 strict 校验；只有"答案"有严格校验 | **成立** | 推送帧 `@deepseek-ai/dsh-host-apiproxy/lib/index.js:1950-1960`：`payload: { type: 'question/requested', sessionId, questions: request.questions }` ⇒ **原样透传，无 codec**；答案侧 `askUserQuestionAnswerSchema`（`:688-691`，zod `.object`，**连 `.strict()` 都没有**）+ 语义校验 `matchesQuestions`（`:1379-1393`）；`@deepseek-ai/dsh-user-questions/lib/index.js` 全文件 **0 处 `.strict()`**。⇒ 官方**不存在** D30 这类"下发结果 codec 炸掉"的通道，D30 是 btw 自建 remote codec 独有 |

**额外发现（主代理未提，但影响 F 的对比）**：官方答案侧除了宽度校验，还有**语义校验** `matchesQuestions`（`:1379-1393`）：答案条数必须等于题数、逐条 `id` 顺序一致、`selected` 不得重复、`custom` trim 后不得为空、非多选时最多 1 项且不得与 custom 并存、`selected` 的每个 label 必须存在于该题 `options[].label` 集合中。btw 的 `answer`（`dsh-btw/src/host/side-chat-service.ts:1157-1172`，方法起于 `:1157`，唯一的校验是 `:1162-1164` 的 `pending.questionId !== request.questionId`）**只校验 `questionId` 是否匹配**，没有上述任何一条 ⇒ 答案方向的**宽度一致但语义校验缺失**（详见 F.4）。这与 D30 无直接因果，但属于"照抄官方时有一步没抄"的同类清单。

### F.1 btw 需要投影到哪一层？D30 是否结构性消失？

**实测**（`.workspace/btw-question/d30/exp8-projection-fixF.mjs` + `exp8-output.txt`；校验对象是**生产产物**里的 `readSideChatResultSchema`，即真机上炸掉的那个 checkpoint；投影按官方 `execute` 的写法复刻，btw 无需改名）：

```
=== 8a. adversarial KEY inputs: raw vs question-level projection vs deep projection ===
camelCase multiSelect            raw=FAIL  projectQuestion=PASS  deep=PASS
official-only detail             raw=FAIL  projectQuestion=PASS  deep=PASS
official-only intent             raw=FAIL  projectQuestion=PASS  deep=PASS
nested junk object               raw=FAIL  projectQuestion=PASS  deep=PASS
question extra + option extra    raw=FAIL  projectQuestion=PASS  deep=PASS
option extra only                raw=PASS  projectQuestion=PASS  deep=PASS      <- 本来就不炸（被 codec 静默 strip）
```

**结论 1（投影层级）**：btw 的 `.strict()` 只在**题目项外层**（`src/shared/remote.ts:146`），`options` 内层（`:141-144`）非 strict、默认 strip ⇒

- **必须投影题目项**（`id / question / header / options / multi_select`）——这一层不投影就会炸（8a 前五行 raw=FAIL）。
- **选项项投影不是"必需"、但建议一并做**（2 行）：8a 最后一行证明"只多带选项项键"今天**不会**炸（codec 静默 strip），所以只投影题目项即可**关闭 D30 今天的全部键类通道**；但选项项投影能提前拆掉一颗雷——一旦有人按"对称美化"的直觉给 `remote.ts:141-144` 补上 `.strict()`（我在 §4 残留通道第 2 条已标出该风险），不投影选项项就会立刻出现第二个爆点。**注意这与官方不同：官方只投影题目项，是因为它下游根本没有 strict codec；btw 下游有，所以"照抄官方"这一步在 btw 上应当多走一层。**
- btw 版 F 比官方版 F **更简单**：官方需要 `multi_select → multiSelect` **改名**（因为它的 wire 类型是驼峰，`dsh-user-questions/lib/types/types.d.ts:44`），而 btw 的工具 schema 与 `btwQuestionSchema` **同名同形**（都是 `multi_select`）⇒ btw 的 F 是**纯白名单、零改名**。

**结论 2（是否结构性消失）**：**键类通道结构性消失，值类通道不消失。** 投影后对象图在**键**这一维恒满足 `btwQuestionSchema`（8a 全 PASS），所以"模型多带一个键"这一整类（含 `multiSelect` / `detail` / `intent` / 任意嵌套垃圾）在**该工具的唯一写入路径**上不再可能触发 read 失败——因为 `entry.pendingQuestion` 全树唯一写入点就是 `:978`（见 F.4），投影正落在它上游 `:961`。**但投影不校验值**，8b 实测投影后仍然 FAIL：

```
=== 8b. boundary: projection does NOT fix VALUE-constraint width gaps ===
empty id            after projection: FAIL
empty question      after projection: FAIL
empty option label  after projection: FAIL
empty questions array after projection: FAIL
```

⇒ 若要的是"**read 永不再因模型输入失败**"，F（与 A 一样）**不够**，必须叠加 D（在 `execute` 里以 codec 自校验/净化，覆盖 `min(1)`/`min(1)` 这类工具 DSL 表达不了的约束）或 E（read 响应白名单投影，作为不变量兜底）。F 的准确表述是：**"关闭 D30 登记的那一类（多余键），与官方行为对齐"**，而不是"关闭所有宽度不一致"。

### F.2 与 A / B / C 的对比（事实与代价）

| 维度 | **F（官方同款投影）** | A（工具 schema 收紧） | B（relax codec） | C（客户端可见 error） |
|---|---|---|---|---|
| 新增**模型面拒绝面** | **无**：工具 `parameters` 一字不改（`:909-935` 保持与官方同宽），模型看到的契约不变 ⇒ 不会出现"照官方心智调用却被硬拒"的新摩擦 | **有**：多余键从"放行"变 `ToolArgsError`（实测文本 `invalid arguments: "questions[0].detail" is not a declared property (additionalProperties: false)`）⇒ 模型需多一次往返自我纠正（好处：意图不丢） | 无 | 无 |
| 是否保留 **strict 契约** | **保留**：`remote.ts:146,153` 的 `.strict()` 原样不动（因此也能继续当"契约漂移探测器"） | 保留 | **放弃**（宿主侧不再对结果做严格校验，这正是它"能治"的原因，也是它掩盖错误的代价） | 保留 |
| 未知键去向 | **工具边界丢弃**（不落进 `entry.pendingQuestion`，故内存态也是干净的） | **被拒**（模型可重发正确形态） | codec strip 或 passthrough（`z.object()` 默认 strip / `.passthrough()` 透传进 React state） | 不变（仍丢弃/仍炸） |
| 可否 `log.warn` 记录未知键 | **可以，且已实测有效**：cordis API 为 `ctx.logger(name)` / `ctx.logger.warn`（`@deepseek-ai/cordis/lib/index.js:579`）；D19 已修 ⇒ 本档实测 `~/.dsh/logs/dsh-host.jsonl` **确在落盘 warn**（`"type":"warn","level":2` 共 **207** 条，含具名 logger `usage`/`agent-registry`/`agent-presets` 等）。⚠️ 但 **btw 宿主目前 0 处日志调用**（`grep -n "logger\|console\." dsh-btw/src/host/*.ts` 为空）⇒ 这是给 btw 加**第一个** logger（新增可观测面，属净收益） | 报错本身即在工具结果里可见，无需额外日志 | 建议同样 `log.warn`（否则连"模型写了什么"都查不到） | 不适用 |
| 副作用 | ①**fail-open**：模型若真想表达 `multiSelect: true`，投影后卡片会**静默变成单选**（意图丢失、用户无从得知）；②与官方行为一致，故不算"新缺陷"，但仍属"静默"谱系（建议用 `log.warn` 补回可观测性） | ①不接受任何未声明键（含官方 `detail`/`intent`，若将来有人照官方心智调用会撞错）；②**必须同时改 `:926`**，否则选项项层级继续靠 strip 兜着 | 掩盖模型调用错误、失去早失败信号；最坏形态（passthrough）会让脏键进 React state | 只治可见性：卡片仍不可见、子代理仍阻塞；**必须加连续失败阈值**否则把瞬断容忍改成"抖一次就报错"（回归） |
| 是否需重启 | **需要**（改 `src/host/side-chat-service.ts` = 宿主 `lib/index.js`，`docs/architecture/02-plugin-system.md:147` 判为冷面） | 需要 | 需要（宿主描述符）+ 客户端刷新 | **不需要**（纯客户端 bundle，刷新即生效） |
| 改动面（file:line） | `src/host/side-chat-service.ts:961`（投影替换类型断言）+ 顶部加 helper（紧邻既有 helper，如 `:154` 的 `visibleReadTools`）；若连选项项一起投影再 +2 行 | `src/host/side-chat-service.ts:916` + `:926` | `src/shared/remote.ts:146` + `:153`（客户端第二道校验点 `api-gateway/lib/client.js:417-421` 需随包刷新） | `src/client/controller.ts:741-746` |
| 附带收益 | **顺手消掉"零投影类型断言"这个缺陷本体**：`:961` 的 `(args as { questions: BtwQuestion[] }).questions` 会变成显式投影，类型断言不再承担"信任模型输入"的职责（D30 的登记描述里点名的就是这个断言） | 无（schema 收紧，断言仍在） | 无 | 无 |

### F.3 能否加"投影后必过 codec"的防漂移单测：能，且已给出可落地的两条断言

**可行性已实测**：zod v4.6.2 的 strict object 暴露 `.shape`（`Object.keys(schema.shape)` 返回声明键）⇒ 漂移锁可写。更进一步，本档**从生产构建产物里 drill 出了 `btwQuestionSchema` 的声明键**，与投影键表**逐一相同**（`exp8-output.txt` 8c）：

```
projection QUESTION_KEYS  : ["id","question","header","options","multi_select"]
codec declared keys       : ["id","question","header","options","multi_select"]
identical? true
```

建议的两条断言（可放 `dsh-btw/tests/`，`btwQuestionSchema` 在 `src/shared/remote.ts:137` 是 **exported** 的，直接可 import；无需像本档那样 drill 构建产物）：

1. **漂移锁（键表集合相等）**：`new Set(Object.keys(btwQuestionSchema.shape))` 必须等于投影函数使用的键表（选项项同理对 `btwQuestionSchema.shape.options.element.shape`）⇒ 将来谁给 codec 加键（或加 `.strict()`）而忘了同步投影，测试即失败。
2. **恒过性（键类对手集）**：对一份对抗语料（驼峰 `multiSelect`、官方 `detail`/`intent`、任意嵌套垃圾、题目项+选项项同时多带、仅选项项多带）断言 `btwQuestionSchema.safeParse(project(input)).success === true`。

**必须写明的能力边界（否则这条测试会给出虚假安全感）**：上述断言只覆盖**键类**；**值类**（空 `id`/`question`/`label`、空 `questions` 数组）投影后仍会被 `.strict()` codec 拒（8b 实测）⇒ 若测试语料里混入空串用例，它会**正确地失败**，说明"投影 ≠ 不变量"；两条断言应分别命名为"投影关闭键类通道"与"值类通道由 D/E 负责"，避免把 F 误当作 D30 的完全修复。

### F.4 顺带核实：是否还有别的写入路径绕过投影？答案方向是否同宽度不一致？

**（a）`pendingQuestion` / `questions` 的写入点：全树唯一，投影放对位置即可覆盖全部模型输入。** 本档全仓 grep（`grep -rn "pendingQuestion\s*=" dsh-btw/src/`）：

```
src/host/side-chat-service.ts:585   const pendingQuestion = entry.pendingQuestion        （读，用于 read 下发）
src/host/side-chat-service.ts:978           entry.pendingQuestion = {                  （唯一写入，逐字）
src/host/side-chat-service.ts:1193          entry.pendingQuestion = undefined          （close 清空）
src/host/side-chat-service.ts:1443          entry.pendingQuestion = undefined          （host shutdown 清空）
src/client/controller.ts:231 / SideChatSurface.tsx:606                                   （客户端只读）
```

`:978` 的 `questions` 值**只**来自 `:961` 的断言（`grep -n "questions:" src/host/side-chat-service.ts` 仅命中 `:910`（schema 声明）、`:961`（断言）、`:595`（read 下发）、`:421`（类型声明））⇒ **投影插在 `:961` 就等于插在唯一入口**，不存在"另一个工具/另一条路径绕过投影"的旁路（这与 §4 残留通道第 3 条一致：`run_code` 不在 btw 子代理可见 allowlist，且即便将来放开，子调用同样走 `defineTool.execute` 校验）。**唯一需要留意的是**：投影只保护"新产生的" pending；对一个**已经**被污染且在途的 pending（修复前的存量会话），F 不生效——但 pending 是纯内存态、不入会话持久化（`entry.pendingQuestion`，重启即清），所以重启（F 本来就需要重启）会一并清掉存量。

**（b）答案方向（客户端 → 宿主 → 工具 output）：宽度一致，无 D30 同类通道；但语义校验比官方少一整套。**
- 工具 output schema（`src/host/side-chat-service.ts:938-957`）：`{ answers: array of { id: string(required), selected: array<string>(required), custom: string(optional) } }`，**两层都 `additionalProperties: false`**。
- 请求 codec（`src/shared/remote.ts:215-219` `answerSideChatRequestSchema`，内嵌 `:157-161` `btwAnswerSchema`）：`{ chatToken, questionId, answers: array of { id: min(1), selected: array<string>, custom?: string } }`，全 `.strict()`。
- 客户端构造（`src/client/controller.ts:239-243`）：`{ id, selected, ...(custom === undefined ? {} : { custom }) }` ⇒ 恰好这三个键。
- 宿主把它变成工具结果前**又显式重建一次**三键对象（`:984-987`）⇒ 即便有脏键也进不了 output。
⇒ **三层同宽 + 双重把关，答案方向不存在 D30 同类不一致**（`selected` 两侧都无 minItems、`custom` 两侧都可选，一致）。**但语义校验缺失**（见 F.0 额外发现）：btw 不校验"答案条数=题数、逐条 id 顺序、selected 去重、非多选最多 1 项、selected 必须是该题 `options[].label` 之一"——官方由 `matchesQuestions` 全查。对 D30 无因果影响（同一批文件里另一处"照抄官方少一步"），但若将来要"与官方对齐"，这份清单可一并处理。

### F.5 一句话结论

**F 能让 D30 在"多余键"这一整类上结构性消失（投影插在唯一写入点 `:961`，生产 codec 实测全 PASS；btw 需投影题目项、建议顺带投影选项项，且无需像官方那样改名），且不引入模型面新拒绝、保留 strict 契约、可 `log.warn` 补回可观测性（D19 已修，warn 确在落盘）——但它与 A 一样对"值维度"（空 id/空 question/空 questions 数组/空 label）无效，因此 F 的准确定位是"与官方行为对齐地关闭 D30 登记的那一类"，不是"read 永不失败"；要后者需叠加 D 或 E。代价：需重启（宿主面），未知键被静默丢弃（模型想表达 `multiSelect` 时会静默变单选，可用 `log.warn` 记录）。**
