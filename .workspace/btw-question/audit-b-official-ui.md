# 审计 B — 官方 `dsh-client-ui-user-questions` 契约与 btw 复用可行性

- 档：审计（只读，未改任何代码/settings/服务）
- 日期：2026-09-23
- 范围：反向工程官方问答 UI 的组件契约、数据字段、视觉/aria 语义；评估 btw 抽屉直接复用官方组件的可行性；给出对齐官方观感的最小改动面。
- 证据纪律：`[验证]` = 已读源文件/产物并带 file:line；`[推断]` = 由已验证事实推导，未端到端跑；`[未验证]` = 未查。

主要证据文件（下称简称）：
- `OQ = /home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-user-questions/lib/client.js`（37586 B，`window.__ModuleLoader__` 包裹的 CJS 工厂）
- `OQT = 同包 lib/types/**`（反编译产物自带的 `.d.ts`，等价于 src 的类型面）
- `UQT = .../dsh-user-questions/lib/types/types.d.ts`（**线上数据结构真源**）
- `CONV = .../dsh-client-ui-conversation/lib/client.js`
- `CONVT = .../dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts`
- `LAY = .../dsh-client-ui-layout/lib/types/client/index.d.ts`
- `REND = .../dsh-client-ui-renderer/lib/client.js`
- `RUNTIME = .../dsh-client-runtime/lib/client.js`
- `APIP = .../dsh-host-apiproxy/lib/index.js`（宿主机问答 provider）
- `BTW_SURFACE = /home/CNS2026495165/dsh/dsh-btw/src/client/SideChatSurface.tsx`
- `BTW_CSS = /home/CNS2026495165/dsh/dsh-btw/src/client/side-chat.module.css`
- `BTW_SHARED = /home/CNS2026495165/dsh/dsh-btw/src/shared/remote.ts`
- `BTW_SVC = /home/CNS2026495165/dsh/dsh-btw/src/host/side-chat-service.ts`

---

## 1. 官方组件契约清单

### 1.1 导出面（**决定复用可行性的第一条硬证据**）

官方 client 半的模块导出只有三个 `[验证]`：`OQ:730-732`

```
exports.PendingQuestion = PendingQuestion;   // 无头领域对象（class）
exports.apply = apply;                       // 插件体：注册 locale 字典 + composer 链条目
exports.inject = inject;                     // ["slots", "locale"]
```

**`QuestionComposer` / `QuestionFlow` / `PlanReviewPanel` / `AnswerField` / `parseRecommendedLabel` 全部是模块私有，未导出**（`OQ:348,360,474`… 无对应 `exports.` 赋值）。`package.json` 的 `exports` 只有 `.`（宿主半，空实现 `apply(){}`，`lib/index.js:14`）、`./invariant`、`./client`。

`OQT/lib/types/client/index.d.ts:17-19` 只声明导出 `PendingQuestion`（value）、`PlanReview`/`QuestionAnswer`/`QuestionComposerProps`/`QuestionWait`/`QuestionKey`（type）。**类型面与运行时面一致：组件不可 import。**

### 1.2 slot 注册名与 owner/claim 机制

```
ctx.effect(() => ctx.locale.register("question", {zh, en}))            // OQ:719-722
ctx.slots.inject("conversation.composer", () => ctx.slots.register({
  name: "conversation.composer",
  select: selectQuestion,        // OQ:709-711
  locale: "question",            // OQ:726
}, QuestionComposer))                                                     // OQ:723-727
```

- **slot 名**：`conversation.composer`（不是 `slot://` URI；仓库用点分键 + `data-slot="conversation.composer"` DOM 属性，见 `dsh-btw/src/client/use-overlay-placement.ts:165` 的 `[data-slot="shell.overlay"]` 同款约定）。
- **slot 声明** `[验证]` `CONVT:199-203`：`kind: 'chain'`、`scope: 'session'`、`owner: ComposerChainProps`。
- **"claim the composer while a question wait is pending" 的确切含义** `[验证]`：chain 型 slot 用 `renderSlotChain` 派发，条目用**纯函数 selector** 竞选；第一个返回非 null 的条目当选，其返回值成为组件的 `matched` prop（`dsh-btw/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/types/index.d.ts:212-223`）。selector 必须**纯、只能读 owner props**（不能读外部可变状态、不能有副作用）。
  - `selectQuestion = ({interactions}) => interactions.find(i => i.kind === 'question') ?? null` `OQ:709-711`。
  - 官方**不夺焦、不改写 pending**：它只是"在这一帧渲染里取代默认输入栏"。
  - composer 座位用 `overlay: true` 渲染：默认输入栏被"隐藏（包裹 + display:none）"而非卸载，草稿态得以存活（`ui-slots/lib/types/index.d.ts:200-211`；`CONV:7259-7265`）。
  - 同一切口还有官方自己的审批面板 `ApprovalPanel`（`priority: 1`，`CONV:10155-10160`），即 composer 链天然是"多抢占者竞选"。
- **owner props 货币** `[验证]` `CONVT:652-656`：`ComposerChainProps = { interactions: readonly PendingInteraction[]; session: ConversationSnapshot | undefined }`。派发点 `CONV:7259-7265`：`renderSlotChain("conversation.composer", { interactions: pending, session }, { fallback: composerBar, overlay: true })`。

### 1.3 pending question 的来源（**是否绑定当前会话 id**）

绑定的是**当前会话**，且经 slot 上下文注入，不是 btw 那种 RPC 轮询 `[验证]`：

1. `CONV:7157`：`const pending = useSession((s) => s.pending) ?? []` —— `useSession` 是**会话作用域标准套件**里的选择器钩子，由 slot 渲染器按 `scope:'session'` 注入。
2. `useSession` 只在 `SessionProvider` 子树内可用，越界即抛 `SlotAssemblyError`（`dsh-client-ui-renderer/lib/types/client/session-provider.d.ts:22-27`）；`SessionProvider` 跟随 host 的**当前 provide 源**（当前选中会话），会话切换时 `key={sessionId}` 强制重挂载（同文件 `:49-72`）。
3. pending 数据结构由 client-runtime 的 Session 从 `question/requested` 帧铸出：`RUNTIME:7523-7528`
   ```js
   case "question/requested": { const {type:_t, sessionId:_s, ...payload} = frame;
     this.mint(new PendingWait("question", rpcId, this.sessionId, payload, m => this.api.respond(m))); }
   ```
   `payload` 是**帧去掉 type/sessionId 后的逐字转发**，即 `{ questions }`。settle：`question/resolved` 按 `q:${questionRpcId}` 从 pending map 删除（`RUNTIME:7529-7534`）。
4. **渲染身份 key**：`PendingWait.key = "<prefix>:<rpcId>"`，question 前缀为 `q`（`pending.d.ts:30` 注释 + `RUNTIME:7811` 的 `q:${envelope.rpcId}`）。
5. 组件本身通过 `props.matched` 拿到 carrier（`QuestionComposerProps = PropsRuntime<'conversation.composer'> & { matched: QuestionWait } & PropsLocale<'question'>`，`OQT/client/contract/slots.d.ts:90-92`），再 `useMemo` 包成领域对象 `new PendingQuestion(props.matched)`（`OQ:349`）。

**结论：官方组件不"自取" pending，它由 slot owner（会话根）以 props 货币下发，且货币绑定当前会话的 `session.pending`。** 这决定了 btw 无法在别的渲染面里"顺手"喂它。

### 1.4 领域面 `PendingQuestion`（唯一可复用的官方导出）

`OQ:70-112` / `OQT/client/contract/slots.d.ts:65-82` `[验证]`：

| 成员 | 语义 |
|---|---|
| `get key(): string` | 不透明渲染身份，透传 carrier key（`q:<rpcId>`）；React key / 草稿重挂载轴 |
| `get questions(): AskUserQuestionItem[]` | 透传 `wait.payload.questions` |
| `answer(answer: QuestionAnswer): Promise<void>` | 发 `{ok:true, value:{sessionId, answer}}`；`receipt.accepted === false` 时 **throw** |
| `cancel(): Promise<void>` | 发 `{ok:false, error:{code:'cancelled', …}}`；被拒同 throw |

注释明确一条重要设计（`OQ:336-337`）："**the carrier key keys local drafts, so a same-request replay (same key, new carrier object) preserves them**" —— 这正是官方"轮询/重放不丢选中态"的机制，也是 btw 根因（审计 A）的官方对照面。

### 1.5 官方 pending 数据结构字段表（**线上真源**）

`[验证]` 三处交叉：`UQT:7-61`（类型）、`APIP/lib/types/api/events.d.ts:88-90`（帧）、`APIP/lib/types/api/questions.d.ts:9-17`（应答包装）。

**请求帧** `MuxFrame`：
```ts
{ type: 'question/requested'; sessionId: SessionId; questions: AskUserQuestionItem[] }
```
> 请求级 id **不在 payload 里**：它是 server-request 的 `rpcId`（`questions.d.ts:1-5` 明确"the rpcId is the question's stable logical id"）。这解释了为什么 `PendingQuestion.key` 而非 payload 字段承担渲染身份。

**`AskUserQuestionItem`**（`UQT:31-47`）：
| 字段 | 类型 | 必填 | 备注 |
|---|---|---|---|
| `id` | `string` | ✔ | 调用方给，回显在答案里 |
| `question` | `string` | ✔ | 展示问题 |
| `detail` | `string` | ✕ | 支撑性细节，**选项标签之外**；官方 UI 用 `MarkdownText` 渲染在选项上方（`OQ:518-520`） |
| `header` | `string` | ✕ | 短标题/分组标签 |
| `options` | `AskUserQuestionOption[]` | ✕ | 可无选项（纯自由文本提问） |
| `multiSelect` | `boolean` | ✕ | 默认 false（单选） |
| `intent` | `{kind:'plan-review'; approve:string}` | ✕ | 表现意图；官方据此渲染"计划待审"决策卡 |

**`AskUserQuestionOption`**（`UQT:8-13`）：`label: string`（必填）、`description?: string`。

**应答**（`UQT:49-61`）：
```ts
AskUserQuestionAnswer      = { answers: AskUserQuestionAnswerItem[] }
AskUserQuestionAnswerItem  = { id: string; selected: string[]; custom?: string }
QuestionResponsePayload    = { sessionId: SessionId; answer: AskUserQuestionAnswer }
```
> 注意：**问题对象上没有 `custom` 布尔字段**——自由文本在所有题目上恒可用，`custom` 只出现在**答案项**上。

**模型面工具的字段名与线面不同（关键事实）** `[验证]` `dsh-tool-ask-user/lib/index.js:26-62, 96-104`：
- 模型面 JSON schema 用 **`multi_select`**（snake_case，第 59 行）；
- 进 `ctx.userQuestions.ask()` 前**映射成 `multiSelect`**（第 103 行 `...question.multi_select !== void 0 ? { multiSelect: question.multi_select } : {}`）；
- `header`/`options` 原样带过；**`detail` 与 `intent` 不在工具 schema 里**——它们只由插件内部调用 `ask()` 的调用方（如 plan review）提供。
- 主机 provider 把 `request.questions` **逐字**塞进帧（`APIP:1956-1959`），所以**线面/UI 面看到的永远是 `multiSelect`**。

### 1.6 选项选中态渲染与交互语义

`[验证]` `OQ:474-661`（`QuestionFlow`）：

| 维度 | 官方实现 |
|---|---|
| 容器 | `<section className=card aria-labelledby={"question-"+pending.key+"-"+index}>`（`OQ:477-479`），标题是 `<h2 id=…>{question.question}</h2>`（`OQ:487-491`） |
| 选项容器 | `role={multiSelect===true ? "group" : "radiogroup"}`（`OQ:523`） |
| 选项元素 | `<button type="button" role={multiSelect===true?"checkbox":"radio"} aria-checked={selected} aria-label={display.label}>`（`OQ:527-536`）——**用 `aria-checked`，不用 `aria-pressed`**；`role` 与容器匹配（合法 ARIA radio/checkbox 语义） |
| 单选选中态视觉 | 行底色 `--dsw-alias-interactive-bg-hover` + 边框 `--dsw-alias-border-l2`；**仅单选时加 `optionSelected` 类**（`OQ:529`：`selected && question.multiSelect !== true && optionSelected`） |
| 多选选中态视觉 | 行**不加** `optionSelected`；改由左侧方框 `.checkboxChecked` 表达（`.checkboxChecked:before` → 底色/边框 `--dsw-alias-label-primary`，勾色 `--dsw-alias-label-primary-foreground`，`IconCheckOutline14 size=12`）（`OQ:542-548`） |
| 单选左侧配件 | 序号徽标 `.number`（`1..n`，`optionIndex+1`）（`OQ:546-548`） |
| 多选左侧配件 | 方框 `.checkbox`（14×14，radius 4，边 `--dsw-alias-border-l4`） |
| 推荐位 | `parseRecommendedLabel` 剥掉 `(Recommended)`/`(推荐)`/全角括号变体，改为 `.badge` 文案 `t('option.recommended')`（`OQ:285-294, 526, 558-561`） |
| 单选点选后 | **自动跳到下一题**（`if (question.multiSelect !== true && index < questions.length-1) setIndex(+1)`，`OQ:403`） |
| 自定义输入 | `AnswerField`：`<textarea rows=1>` + 隐藏 mirror 撑高（自动增高、`Shift+Enter` 换行、IME 组合保护 `isComposing`）（`OQ:295-334, 446-459`）。有选项时它是选项列表里的**额外一行**（左侧编辑图标 / 多选时方框）；无选项时是 `.customBlock` 大块并 `autoFocus`（`OQ:570-599`） |
| 导航 | 上一题/下一题图标按钮 + 进度 `index+1 / questions.length`（`OQ:604-637`）；收起/展开卡片、**放弃整组问题**（`OQ:492-514`） |
| 跳过 | `action.skip` "跳过本题"：清空该题草稿并打 `skipped`，最后一题时直接提交（`OQ:460-473`） |
| 提交按钮 busy | `disabled = busy !== null`；文案 `busy==="answer" ? t("submitting") : 末题 ? t("submit") : t("action.next")`（`OQ:651-656`）。**⚠️ `submit`/`submitting` 两个 key 在 `question` 字典里不存在**（zh/en 见 `OQ:667-701`，只有 `action.next`）→ 见 §6 未验证项 |
| 错误态 | `role="status"` 的 `.feedback`（`OQ:639-643`），文案两类：`error.incomplete`（"请先完成这道问题。"）、`error.unanswered`（"请选择一个选项或填写自定义答案。"）；服务端拒收时显示 `cause.message` |
| 提交前置校验 | 空题不允许继续（`continueFlow` 里 `!answered(draft)` → `error.unanswered`）；批提交时若有未完成题 → 跳回该题 + `error.incomplete`（`OQ:407-413, 434-445`） |
| 提交禁用 | `disabled = busy!==null || !answered(draft)`（`OQ:653`） |
| 答案编码（**语义要点**） | 单选题若填了 custom，则 **`selected` 被清空**，只留 `custom`：`selected: custom==="" || multiSelect===true ? value.selected : []`（`OQ:423`）；跳过的题发 `{id, selected: []}`（`OQ:416-419`） |
| 取消整组 | `pending.cancel()` → 线面 `{ok:false, error:{code:'cancelled'}}`（`OQ:375-382, 101-111`） |

> 另有一个 `PlanReviewPanel`（`intent.kind==='plan-review'` 时接管）：`planReviewOf` 只在"单题 + 有 intent + 有 detail + 有 approve 标签 + ≤2 选项 + 非多选"时收窄，否则**退回通用问答流**（`OQ:44-61`）。这是"未知 intent 渲染成通用流"的官方范例。

---

## 2. btw vs 官方：结构与字段差异表

### 2.1 字段逐项对照

btw 侧真源 `BTW_SHARED:136-162`（zod，全部 `.strict()`）`[验证]`：

| 官方 | btw | 差异性质 |
|---|---|---|
| 渲染身份 = RPC envelope `rpcId`，**不在 payload 里**；UI key `q:<rpcId>` | `pendingQuestion.questionId: string(uuid)`，**在 payload 里**；UI key = questionId | 角色等价，机制不同。btw 的 uuid 由宿主铸（`BTW_SVC:967`），应答前不变 ⇒ **已具备稳定身份**，可作草稿轴的唯一依赖（审计 A 的修复锚点） |
| `questions[].id: string` | `id: string(min 1)` | 同名同义 |
| `questions[].question: string` | `question: string(min 1)` | 同名同义 |
| **`questions[].detail?: string`** | **无此字段** | **缺能力**：官方把 detail 用 Markdown 渲染在选项上方；btw 既无 UI 也无宿主/工具字段（`BTW_SVC:909-937` 工具 schema 也没有） |
| `questions[].header?: string` | `header?: string` | 同名，**但渲染样式完全不同**（见 §3） |
| `questions[].options?: {label, description?}[]` | 同 | 完全一致 |
| **`questions[].multiSelect?: boolean`** | **`multi_select?: boolean`** | **命名风格分叉**（camel vs snake）。今日**不产生用户可见语义差**：btw 的工具 schema 与 UI 都读 `multi_select`，自洽（`BTW_SVC:933` ↔ `BTW_SURFACE:123,132,141`）。风险见 §4.3 |
| **`questions[].intent?: {kind:'plan-review'; approve}`** | **无** | btw 无"计划待审"决策卡；官方对未知 intent 也退回通用流，故行为上不算违背 |
| 答案项 `{id, selected: string[], custom?: string}` | `btwAnswerSchema` 完全相同 | 一致 |
| 请求级 `{sessionId, answer:{answers:[]}}` | `{chatToken, questionId, answers:[]}` | 传输封装不同（btw 用自己的 RPC/chatToken），语义等价 |
| 官方 wire 的 item schema `additionalProperties: true`（工具侧） | btw 的 `btwQuestionSchema` **`.strict()`** | 见 §4.3 的健壮性缺口 |
| 问题对象无 `custom` 开关（自由文本恒可用） | 同（无字段，UI 恒渲染输入框） | 一致 |
| **无 skip 概念**（skip 是纯 UI 态，编码为 `{id, selected: []}`） | 无 skip UI，也无等价编码 | **缺能力** |

### 2.2 结构与交互对照

| 维度 | 官方 | btw |
|---|---|---|
| 落位 | **占据 composer 座位**（chain 抢占，`overlay:true`，默认输入栏被隐藏不卸载），居中，`max-width: var(--dsh-chat-content-width)`（748px），左右 padding `calc(var(--dsh-composer-side-clearance) + 16px)` `[验证]` `OQ:233` | 抽屉内 `.questionCard`，`margin: 0 14px 12px`，宽度随抽屉（可调宽），位于 transcript 与 btw 自己的 composer 之间（`BTW_SURFACE:583-591`）——**结构位置近似，宽度/环境完全不同** |
| 一次显示 | **一题一屏** + 分页（`1 / N`） | **一次平铺全部题** |
| 单选点选 | 自动进下一题 | 停留原地 |
| 容器语义 | `<section aria-labelledby=…>` + `<h2 id>` | `<section aria-label={t('drawer.questionTitle')}>` + `<div class=questionHead><strong>`（标题是"侧边助手正在向你提问"，**不是问题文本**；无 `h2`、无 `labelledby`）`BTW_SURFACE:111-115` |
| 选项容器 | `role=group\|radiogroup` | 同 `BTW_SURFACE:123` |
| 选项元素 | `role=radio\|checkbox` + `aria-checked` | **`aria-pressed`，无 `role=radio/checkbox`** `BTW_SURFACE:127-133` ⇒ 容器 `radiogroup` 的子节点缺失 `role=radio`，**ARIA 结构不合法** |
| 多选/单选区分 | 方框勾 vs 序号徽标 + 行高亮 | **既无序号也无方框**，只有一行小字提示"可多选"（`BTW_SURFACE:141`，`.questionHint`） |
| 自定义输入 | textarea（自动增高 / Shift+Enter / IME 保护），有选项时是列表内一行 | `<input type="text">` 单行，每题恒在题下（`BTW_SURFACE:144-163`），`Enter` 直接提交 |
| 推荐位 | 剥离后缀 → "推荐"徽标 | **原样显示 `(Recommended)` 文本** |
| 跳过 | 有 | 无 |
| 翻页/进度 | 有 | 无 |
| 收起/放弃整组 | 有 | 无（btw 只能整个抽屉关掉，等于放弃会话而非放弃问题） |
| 提交禁用 | `busy || !answered` | **仅 `sending`**（`BTW_SURFACE:168`）⇒ 可提交"全空答案" |
| 错误态 | `role="status"`，含"请先完成这道问题/请选择…"两类引导文案 | `.questionError`（`BTW_SURFACE:167`），**只回显宿主错误字符串**（`result.error`），无引导文案 |
| 答案编码差异 | 单选+custom ⇒ `selected: []`，只发 `custom`（`OQ:423`） | 单选+custom ⇒ **同时发** `selected:[…]` **和** `custom`（`BTW_SURFACE:97-103`）⇒ **模型收到的语义不同** |
| 取消语义 | `pending.cancel()` 走线面 `code:'cancelled'`，工具调用被判 cancelled | 无对应 UI；只能靠关闭会话/abort（`BTW_SVC:970-977`） |

---

## 3. 视觉差异量化

两侧都是 CSS Module 内联进 bundle（官方类名被 lightningcss 哈希成 `Mbwy4a_*` 前缀）`[验证]` `OQ:233`（通用问答卡）/ `OQ:115`（计划审阅卡）；btw 侧 `BTW_CSS:327-355`。

### 3.1 卡片外壳

| 项 | 官方 `.card` | btw `.questionCard` | 差 |
|---|---|---|---|
| 边框 | `1px solid var(--dsw-alias-border-l2-darkmode-thin)` | `1px solid color-mix(in srgb, #b7e85b 45%, var(--dsw-alias-border-l1))` | 官方=主题中性；btw=**硬编码品牌绿混色** |
| 底色 | `var(--dsw-specific-input-major)` | `color-mix(in srgb, var(--dsw-alias-bg-module-platform) 92%, #b7e85b 8%)` | 官方=输入域主题色；btw=模块底色混绿 |
| 圆角 | `20px`（≤720px 时 `16px`） | `12px` | −8px |
| 阴影 | `var(--dsw-shadow-lv2)` | **无** | 官方浮层感，btw 平贴 |
| 最大高 | `max-height: min(60vh, 520px)`，body 内滚 | 无（随内容撑高） | 长问答在 btw 里会把抽屉顶爆 |
| 内边距 | `0 0 10px`（分 header/body/footer 三段） | `12px 14px`（单块 gap:10px） | 结构层级不同 |
| 字色 | `var(--dsw-alias-label-primary)` | 同 | — |

### 3.2 头部

| 项 | 官方 | btw |
|---|---|---|
| header/eyebrow | `11px/16px`，`--dsw-alias-label-tertiary`，**无**text-transform | `10px`，`--dsw-alias-label-quaternary`，`text-transform: uppercase` + `letter-spacing .06em` + **等宽字体**（`.questionHeader`，`BTW_CSS:343`） |
| 标题 | `<h2>` `16px/22px`，`font-weight:500`，内容是**问题原文** | `<strong>` `12px`，内容是**固定提示语**；问题文本在 `.questionText` `13px/20px` |
| 图标区 | 收起/放弃两个 24×24 圆形图标按钮（`--dsw-alias-label-tertiary`，`border-radius:999px`） | 一个 7px 脉冲绿点 `.questionDot`（`#b7e85b` + `btwQuestionPulse` 动画，`BTW_CSS:340-341`） |

### 3.3 选项行

| 项 | 官方 `.option` | btw `.questionOption` |
|---|---|---|
| 布局 | 横向 flex，`align-items:flex-start`，`gap:8px`，`padding:8px 12px 8px 8px`，`min-height:40px` | 纵向 flex（label 上/description 下），`gap:3px`，`padding:8px 11px` |
| 圆角 | `12px` | `10px` |
| 默认边框 | `1px solid transparent`（**隐形**，选中才显） | `1px solid var(--dsw-alias-border-l2)`（**恒显**） |
| 悬挂缩进 | 有（序号/勾选框占位 20px） | 无（无边距层级） |
| 行距/gap | 行间距 `gap:1px`，容器 `padding:4px 12px` | `gap:6px`，无容器内边距 |
| 选中底 | `var(--dsw-alias-interactive-bg-hover)` | `color-mix(in srgb, #b7e85b 12%, transparent)`（`.questionOptionActive`，`BTW_CSS:348`） |
| 选中边 | `var(--dsw-alias-border-l2)` | `color-mix(in srgb, #b7e85b 60%, var(--dsw-alias-border-l1))` |
| 选中文字 | `color: inherit`（不变） | `color: var(--dsw-alias-label-primary)`（抬亮） |
| 标签字号 | `14px/24px`，`font-weight:500` | `12.5px/18px`，default weight |
| 描述字号 | `14px/24px`，`--dsw-alias-label-tertiary` | `11px/16px`，`--dsw-alias-label-tertiary` |
| 过渡 | `background-color .12s, border-color .12s` + `prefers-reduced-motion` 关闭 | 无过渡 |
| 推荐徽标 | `.badge`：底 `--dsw-specific-sidebar-nav-item-active-accent`，字 `--dsw-alias-button-info-fill`，radius 6px，`11px/18px`，`font-weight:600` | 无 |

### 3.4 自定义输入 / 页脚

| 项 | 官方 | btw |
|---|---|---|
| 输入控件 | `textarea rows=1` + 隐藏 mirror，`14px/24px`，mirror `max-height:144px` | `<input type=text>`，`12.5px` |
| 有选项时的形态 | 选项列表内一行（radius 12，min-height 40，左侧编辑图标/方框），`focus-within` 时边 `--dsw-alias-border-l2` | 独立一行，`border-radius:9px`，`:focus` 变绿 |
| 无选项时的形态 | `.customBlock`：边 `--dsw-alias-border-l2`，底 `--dsw-alias-bg-module-platform`，radius 10，`min-height:64px`，`margin:0 12px`，focus 边 `--dsw-alias-state-business-primary` | 与有选项时同款（无形态区分） |
| 页脚 | `margin-top:12px`，`padding:0 10px 0 18px`，`justify-content:space-between`（左翻页 / 中状态 / 右动作） | 无页脚；`.questionError` + 一个 `Button size=sm variant=primary` |
| 按钮 | primitives `Button`（`outline` + `primary`） | primitives `Button`（`sm` + `primary`）——**这一项已经一致** |

### 3.5 主题适配（最关键的一条）

`[验证]`：官方卡片 **只用 `--dsw-*` 主题别名**（`--dsw-alias-border-l2-darkmode-thin`、`--dsw-specific-input-major`、`--dsw-alias-interactive-bg-hover`、`--dsw-alias-border-l2`、`--dsw-alias-bg-overlay`、`--dsw-alias-border-l4`、`--dsw-alias-label-primary-foreground`、`--dsw-specific-sidebar-nav-item-active-accent`、`--dsw-alias-button-info-fill`、`--dsw-shadow-lv2`），这些 token **在 `dsh-client-ui-theme` 里均存在**（逐个 grep 命中 1–8 次），且随亮/暗主题切换。

btw 的 `#b7e85b`：在 `dsh-client-ui-theme` 包内 grep **命中 0 次**（非主题 token），在 `BTW_CSS` 内出现 **24 次**。⇒ btw 问答卡的强调色**在亮色主题下不会自适配**，这是"看起来和主会话不像"的最主要来源，且是**单文件、单色系**的机械改动。

---

## 4. 复用可行性结论

### 4.1 结论：**不可行（直接复用官方 `QuestionComposer` 视觉组件）**

四条独立且每一条都足以否决的硬证据：

**(a) 组件根本没导出** `[验证]` `OQ:730-732`：client bundle 只导出 `PendingQuestion`、`apply`、`inject`。`QuestionComposer`/`QuestionFlow` 是模块私有函数。类型面同样只导出类型（`OQT/client/index.d.ts:17-19`）。⇒ 第三方插件**无论怎么 import 都拿不到组件**。

**(b) `./client` 入口不是 ES 模块，而是自注册脚本** `[验证]` `OQ:1-3`：`window.__ModuleLoader__.load({ id: "@deepseek-ai/dsh-client-ui-user-questions", factory: (require) => {…} })`。即使 `require` 成功，拿到的也只是上面那三个导出。而且 btw 的构建配置**未把它列入 external**（`dsh-btw/tsdown.config.ts:12-22` 的 `CLIENT_EXTERNALS` 是固定白名单），所以任何 value import 会被**内联整包**（连带它自己的 `__ModuleLoader__.load` 包裹层）——这本身就是错误用法。[推断：内联后运行时行为未实测，但形态上必然错。]

**(c) 它需要的 props 货币在 btw 的渲染面里造不出来** `[验证]`：
- 需要 `matched: PendingWait<'question'>`：这个对象只能由 client-runtime 的 `Session` 在收到 `question/requested` 帧时铸造（`RUNTIME:7523-7525`），并且**永远绑定"该帧所属会话"**。btw 的子会话提问走的是**自己的工具 `btw_ask_user`**（`BTW_SVC:903-998`），宿主**从不发出 `question/requested` 帧** ⇒ 没有 `PendingWait` 存在。
- 需要 `PropsRuntime<'conversation.composer'>`：含 owner 货币 `{interactions, session}`（`CONVT:652-656`）+ 会话标准套件。btw 的抽屉注册在 **`shell.overlay`，`scope: 'root'`**（`LAY:77-80`），而渲染器的 `standardProps` 对 root 作用域**只返回 `{useSessions, useWorkspaces}`，不含 `useSession`/`sessionId`**（`REND:613-645`；session 作用域才会合并 `info.hooks` 里的 `useSession`，并在 `entry.locale` 存在时加 `t`，`REND:658-675`）。btw 的 `SideChatDrawerProps` 也确实只声明 `Injected & Partial<PropsStore<…>> & PropsLocale<'btw'>`（`SideChatDrawer.tsx:31-33`），**没有任何会话套件**。
- 需要 `PropsLocale<'question'>` 的 `t`：slot 渲染器只给 `entry.locale` 声明的命名空间发 `t`（`REND:661-665`）；btw 声明的是 `'btw'`。`ctx.locale.bind(ns)` 理论上能另取（`dsh-client-locale/lib/types/client/index.d.ts:169-176`），但这是次要问题。

**(d) 官方问答通路的入口对 btw 是双保险封死的** `[验证]`（这段以前只是 btw 源码注释里的说法，本次给出实证）：
- 工具面：内置 `ask_user_question` 被 btw 的策略明确排除（`dsh-btw/src/shared/tool-policy.ts:14-18`）。
- 核心守卫：`ctx.userQuestions.ask()` 在调用方 agent 被**另一个活着的 agent 拥有**时抛 `DELEGATED_CALLER`（`dsh-user-questions/lib/index.js:60-64`）。
- 主机 provider 守卫：Web provider **强制要求 `request.agent`**，缺失即 `ASK_MISSING_AGENT`（`APIP:1934-1936`）——所以"绕开 agent 参数"这条路也不通。
- ⇒ btw 的子会话（owned child）**在架构上不可能**让官方 UI 出卡；这不是 bug，是 `dsh-btw/src/shared/tool-policy.ts:1-18` 描述的既定设计。

### 4.2 唯一"可复用"的东西：无头领域对象（价值很低）

`PendingQuestion` 是导出的，且 `PendingWait` 的构造签名公开（`pending.d.ts:26-54`）、`RpcId(id: string)` 是运行时品牌构造器（`dsh-host-apiproxy/lib/types/api/rpc.d.ts:16-24`），btw 理论上可以伪造：

```ts
new PendingQuestion(new PendingWait('question', RpcId(questionId), childSessionId, { questions }, respond))
```

但收益为零：btw 已有等价能力（`controller.answer` + 稳定 `questionId`），而 `respond` 还要把 btw 的 RPC 包成 `ClientResponse` 信封。**不建议走这条路。**

### 4.3 附带发现：btw 的字段命名分叉有一个潜在健壮性缺口

`[验证（机制）]`：
- btw 工具的题目项 schema 是 `additionalProperties: true`（`BTW_SVC:916`），只声明 `id/question/header/options/multi_select`；`execute` 用 **类型断言**（不是 parse）把模型参数直接塞进 pending（`BTW_SVC:961`、`980`）。
- 而下发时走的是 strict codec：`source: 'json'` + `codec: {mode:'strict', schema: readSideChatResultSchema}`（`dsh-btw/src/remote-descriptors.ts:28-32, 39`），`readSideChatResultSchema` → `btwPendingQuestionSchema`（`.strict()`，`BTW_SHARED:150-154`）→ `btwQuestionSchema`（`.strict()`，`BTW_SHARED:137-146`）。typert 的 strict codec 语义是 `schema.parse(value)` 边界校验（`dsh-typert-protocol/lib/types/types.d.ts:101-114`）。
- ⇒ 模型若多带一个键（例如照抄官方心智 `multiSelect: true`、或加 `detail: "…"`），它会穿过工具校验、存进 `entry.pendingQuestion.questions`，然后在 `sideChat/read` 的 **结果** strict 校验上炸掉。
- `[推断]`：可观察后果是 `read` 这一步失败（客户端表现为抽屉读取报错/轮询失败），而非静默降级；**未实测**，见 §6。

结论：`multi_select` vs `multiSelect` 今天**不产生用户可见的语义差**（btw 自洽），但它是"模型照抄官方写法就踩雷"的隐性风险点；若要向官方对齐字段名，**必须同时改工具 schema、宿主透传、客户端读取、zod schema 四处**，不能只改一处。

---

## 5. 向官方观感对齐的最小改动面

前提：接受 §4 的结论（不能复用组件），目标是"看起来/用起来和主会话一致"，而非重写。

### 5.1 P0 · 纯 CSS（单文件 `BTW_CSS:327-355`，不动 TSX，零语义风险）

| # | 改动 | 官方依据 |
|---|---|---|
| S1 | `.questionOption` 默认 `border-color: transparent`；选中（或新增 `.questionOptionSelected`）改 `background: var(--dsw-alias-interactive-bg-hover); border-color: var(--dsw-alias-border-l2)`，并去掉 `#b7e85b` 的 `color-mix` | `OQ:233`（`.option` / `.optionSelected`） |
| S2 | `.questionCard` 圆角 12→`20px`（≤720px 时 16px），加 `box-shadow: var(--dsw-shadow-lv2)`，底色改 `var(--dsw-specific-input-major)`，边框改 `var(--dsw-alias-border-l2-darkmode-thin)`（或保留绿边但改用主题 token 派生） | 同上 |
| S3 | 字号对齐：选项 label `12.5px/18px`→`14px/24px`（weight 500）；description `11px/16px`→`14px/24px`；eyebrow/header `10px`→`11px/16px` 且去掉 `text-transform/等宽字体` | 同上 |
| S4 | 选项行：`min-height:40px`、`border-radius:12px`、`padding:8px 12px 8px 8px`、容器 `gap:1px` + `padding:4px 12px`；加 `transition: background-color .12s, border-color .12s` 与 `prefers-reduced-motion` 关闭 | 同上 |
| S5 | `.questionOptionActive` 去掉"文字抬亮"（官方选中不改字色） | 同上 |
| S6 | 把 `#b7e85b` 从选项/输入框的**交互态**里去掉（保留品牌绿于抽屉外壳即可）；`#b7e85b` 非主题 token（§3.5），交互态用绿会导致亮色主题下对比度异常 | `BTW_CSS:334,336,348,353` |

### 5.2 P1 · 结构 + ARIA（`SideChatSurface.tsx` QuestionCard，约 20 行）

| # | 改动 | 官方依据 |
|---|---|---|
| A1 | 去掉 `aria-pressed`，改为 `role={multiSelect?'checkbox':'radio'}` + `aria-checked={active}`（容器已是 `group`/`radiogroup`，改完才是合法 ARIA 结构） | `OQ:530-531` |
| A2 | `<section>` 改 `aria-labelledby`，内部用 `<h2 id={…}>{question.question}</h2>` 承担标题；固定提示语降级为 eyebrow 或去掉 | `OQ:477-491` |
| A3 | 单选左侧加序号徽标（`1..n`，20×20，radius 6，`--dsw-alias-bg-overlay`）；多选左侧加方框（14×14，radius 4，`--dsw-alias-border-l4`；选中填 `--dsw-alias-label-primary` + `IconCheckOutline14 size=12`）——**图标在 btw 已依赖的 primitives 里齐全**（`IconCheckOutline14` 等已导出，`SideChatSurface.tsx:6-8` 已 import 同包） | `OQ:542-548` |
| A4 | 多选提示从独立 `<span class=questionHint>` 改为"方框 + 勾"的图标表达（A3 落地后可删） | `OQ:542-548` |
| A5 | 错误区加 `role="status"`，并补引导文案（"请选择一个选项或填写自定义答案"） | `OQ:639-643`、字典 `OQ:668-669` |
| A6 | 推荐位：复用官方正则剥后缀再渲染 `t('…推荐')`（`/\s*(?:\((?:recommended\|推荐)\)\|（(?:recommended\|推荐)）)\s*$/i`） | `OQ:285-294` |
| A7 | 自定义输入改 `textarea rows=1`（或至少在多选时放进选项列表作为额外一行） | `OQ:315-334` |
| A8 | 提交按钮 `disabled` 增加"未作答"条件 | `OQ:653` |

### 5.3 P2 · 需业务裁决的语义改动（**不建议放在"观感对齐"里顺手做**）

| # | 改动 | 风险 |
|---|---|---|
| D1 | 单选 + custom ⇒ `selected: []`（与官方 `OQ:423` 一致） | **改变模型收到的答案语义**；btw 现有行为"两者都发"可能正是子代理期望的。需用户裁决 |
| D2 | 加"跳过本题"/分页 / 放弃整组 | 改变交互模型与宿主 RPC（skip 需新增编码），非最小改动 |
| D3 | 给 btw 工具加 `detail` | 需同时改工具 schema + 宿主透传 + 客户端渲染；且官方模型面工具**也没有** `detail`，属"超出官方模型面"的增强 |
| D4 | 把 `multi_select` 改名为 `multiSelect` | 需四处同改（§4.3），且会让**已存在的历史/并发会话**（若模型已按旧 schema 生成）失配。收益是"字段名与官方线面一致"（但官方**模型面**本来就是 `multi_select`，所以对齐线面反而与官方模型面不一致）——**建议不动** |

### 5.4 明确**无法**在 btw 里复制的东西

1. **官方 CSS Module 类名与规则**：`Mbwy4a_*` 是官方包构建期由 lightningcss 生成并**内联进自己的 bundle**（`OQ:233`），既不导出也不在全局样式表里，btw 无法引用；只能按 §5.1 逐条复刻数值。
2. **composer 座位的几何环境**：`--dsh-composer-side-clearance`、`--dsh-chat-content-width`(748px)、`--dsh-composer-stack-gap` 由会话根定义（`CONV:7118` 的 `.wSkVaW_root`），是**主会话 composer 座位**的局部变量；btw 抽屉宽度可调（`drawer-size.ts`），因此"最大宽度 748px 居中"这类几何无法照搬，只能取"卡片式 + 20px 圆角 + lv2 阴影"的观感。
3. **plan-review 决策卡（`PlanReviewPanel`）**：未导出、且依赖 `intent`+`detail` 数据字段。
4. **`MarkdownText` 渲染 `detail`**：可复制（primitives 已导出且 btw 已在用），但**没有 `detail` 数据来源**（见 D3）。
5. **抢占 composer 的"输入栏隐藏但保留草稿"语义**：需要 `renderSlotChain(..., {overlay:true})` 与 owner 货币，btw 的 `shell.overlay` 是 list 型 root 作用域（`LAY:77-80`），没有这个座位。

---

## 6. 未验证项 / 证据边界

1. **`sideChat/read` 遇未知字段的实际失败形态**（§4.3）：机制（工具 `additionalProperties: true` + strict result codec）已读源验证；**端到端未跑**，因此"表现为 read 报错"是推断。建议执行档用一个 `detail: "x"` 的 `btw_ask_user` 调用做一次实证。
2. **官方 `t("submit")` / `t("submitting")` 的渲染结果**：`OQ:655` 引用了这两个 key，但 `question` 字典（`OQ:667-701`）里**不存在**。**未读** `dsh-client-locale` 的缺键回退策略，因此不知道界面上是显示字面量 `submit`、还是回退到别的命名空间、还是报错。若要严格对齐官方按钮文案，此项需先确认（若官方实际显示为 `submit`，那"对齐"反而应该**不**照抄）。
3. **官方问答卡在 127.0.0.1:3080 主会话的实际视觉**：本次未截图/未起 Playwright（只读审计，且同工作区已有 e2e 进程在跑）。所有官方视觉数值来自 bundle 内联 CSS，**未做像素级比对**。
4. **profile 副本 vs 安装副本的官方包 md5 一致性**：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-user-questions` 是指向 `dsh/node_modules` 的**符号链接**（已核）；但**未**核对该符号链接目标与其它路径是否存在第二份不同版本。
5. **`useSession` 是否真的被传给 `conversation.composer` 的链条目**：类型面（`scope:'session'` → `SessionStandardProps`）与渲染器 `standardProps` 的 session 分支（`REND:628-643` 合并 `info.hooks`）都指向"是"；但**未**直接读到 composer 链条目派发时注入的 `hooks` 源清单，属强推断。
6. **btw 抽屉是否订阅了子会话的 `session/requested` 帧**（即是否本来就能拿到 `session.pending`）：未核查 `dsh-btw/src/client/controller.ts` 的会话订阅面。即使有，btw 的 `btw_ask_user` 也不产生该帧（`BTW_SVC:903-998`），故不影响 §4 结论。
7. **`shell.overlay` 的 `scope:'root'` 与 btw 实际注入的 `parentSessionId`**：`inject` 回调里手工取 `controller.getSnapshot().parentSessionId`（`dsh-btw/src/client/index.ts:71-73`）——这是 btw 自己接的线，不是框架套件。**未**验证它在所有 presentation 模式下都非空。
8. 本次审计**未**修改任何文件（除本报告）、未改 settings、未重启服务。

---

## 附：给执行档的一句话闸门

- §5.1（S1–S6）与 §5.2（A1–A8）是**可逐条落地的最小改动面**，全部在 `side-chat.module.css` 与 `SideChatSurface.tsx` 的 `QuestionCard` 内，**不改宿主、不改 RPC、不改字段名**。
- §5.3 的 D1–D4 是**语义/契约级改动**，其中 D4（`multi_select` 改名）**建议否决**（官方模型面本来就是 snake_case，改了反而更不一致，且需四处同改并有历史失配风险）；D1 若要做，必须回到用户裁决。
- §4 已足以回答"范围 B（复用官方组件）"：**不可行，且不是工程量问题，是导出面 + 座位 + 架构三重封死**。
