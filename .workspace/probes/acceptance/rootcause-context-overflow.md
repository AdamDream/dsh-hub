# 根因档：`pi-ai detected context overflow for model "deepseek-v4.1-flash"` + `CONTEXT_WINDOW_EXCEEDED`

- 归档时间：2026-09-17
- 模式：只读根因调查（除本报告外未修改任何文件；未改 settings、未重启、未 install）
- 证据标记：**[代码确证]** / **[实测确证]** / **[推断]** / **[无法确证]**

---

## 0. 结论一句话

`adam/deepseek-v4.1-flash` 的 settings 条目（`~/.dsh/settings.yaml:134-137`）未声明 `contextWindow`，
而 `adam` 是手写路由、pi-ai 内置 catalog 里没有 `deepseek-v4.1-flash`，于是**回落到默认值 `DEFAULT_CONTEXT_WINDOW = 262144`**；
pi-ai 的 `isContextOverflow()` Case 2 是**纯客户端预估**（`stopReason === "stop"` 且 `usage.input + usage.cacheRead > contextWindow`），
该会话真实 prompt 已达 **497,869～504,264 token**（网关实际照常返回成功），于是把一次**完全正常的 `stop` 响应误判成上下文溢出**；
而 overflow 自救的 compaction 摘要请求走同一条路由、用同一个错误阈值，**自救同样报同一个错**，所以失败是终态、每轮末步必复发。

> 触发该 bug 的默认值就是 **262144**（不是别的数），定义处见 §1.3。

---

## 1. 报错来源定位

### 1.1 产生该字符串的确切代码位置 [代码确证]

文件：`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js`

```js
1286: function mapStopReason(message, contextWindow) {
1287: 	const piAiOverflow = isContextOverflow(message, contextWindow);
1288: 	const harnessOverflow = message.stopReason === "error" && message.errorMessage !== void 0 && isContextWindowExceededError(message.errorMessage);
1289: 	if (piAiOverflow || harnessOverflow) return {
1290: 		kind: "error",
1291: 		failure: {
1292: 			message: message.errorMessage ?? `pi-ai detected context overflow for model "${message.model}"`,
1293: 			code: CONTEXT_WINDOW_EXCEEDED_CODE
1294: 		}
1295: 	};
```

- **1292 行** = `pi-ai detected context overflow for model "..."` 的字面来源
- **1293 行** = `CONTEXT_WINDOW_EXCEEDED`（`CONTEXT_WINDOW_EXCEEDED_CODE`，定义于 `dsh-llm/lib/index.js:255`、`dsh-llm/lib/types/error.js:22`）

调用点（拿真实输出对比）：

```js
1433: 				reason: mapStopReason(event.message, contextWindow),
1444: 				reason: mapStopReason(event.error, contextWindow)
```

`contextWindow` 由适配器从**已解析的模型快照**传入：

```js
1745: 				}), model.contextWindow)[Symbol.asyncIterator]();
```

原始命令与输出：

```
$ grep -n "pi-ai detected context overflow" -r .../dsh-llm-pi-ai/lib/index.js
1292:			message: message.errorMessage ?? `pi-ai detected context overflow for model "${message.model}"`,
```

### 1.2 判定函数 [代码确证]

文件：`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@earendil-works/pi-ai/dist/utils/overflow.js:128-154`

```js
128: export function isContextOverflow(message, contextWindow) {
129:     // Case 1: Check error message patterns
130:     if (message.stopReason === "error" && message.errorMessage) {
131:         const isNonOverflow = NON_OVERFLOW_PATTERNS.some((p) => p.test(message.errorMessage));
133:         if (!isNonOverflow && OVERFLOW_PATTERNS.some((p) => p.test(message.errorMessage))) {
134:             return true;
135:         }
136:     }
137:     // Case 2: Silent overflow (z.ai style) - successful but usage exceeds context
138:     if (contextWindow && message.stopReason === "stop") {
139:         const inputTokens = message.usage.input + message.usage.cacheRead;
140:         if (inputTokens > contextWindow) {
141:             return true;
142:         }
143:     }
144:     // Case 3: Length-stop overflow (Xiaomi MiMo style) ...
147:     if (contextWindow && message.stopReason === "length" && message.usage.output === 0) {
148:         const inputTokens = message.usage.input + message.usage.cacheRead;
149:         if (inputTokens >= contextWindow * 0.99) {
150:             return true;
151:         }
152:     }
153:     return false;
154: }
```

**这三个 Case 的性质：**

| Case | 触发依据 | 客户端预估 还是 服务端返回？ |
|---|---|---|
| Case 1（130-136） | 服务端返回的错误**文本**去匹配本地正则表（`OVERFLOW_PATTERNS`，35-61 行） | 文本来自服务端，但**分类在客户端**（本地正则） |
| Case 2（137-143） | 客户端自己算 `usage.input + usage.cacheRead > contextWindow` | **纯客户端预估** |
| Case 3（144-152） | `stopReason==="length"` + `output===0` + usage 填满窗口 99% | 半客户端（信号来自服务端，阈值来自客户端声明） |

**本次故障命中的是 Case 2**——依据是真实事件里 `replayState.response.stopReason === "stop"`，
而 Case 1 要求 `stopReason === "error"` 且 `errorMessage !== undefined`；同时故障消息是 fallback 文案
（`message.errorMessage ?? ...` 走了 `??` 右侧），说明 **`errorMessage` 为 undefined**，Case 1 在结构上不可能命中。见 §3.3。

**所以：本次报错是「客户端按声明 `contextWindow` 做的预估」，不是服务端返回的溢出错误。**
服务端同一请求返回的是 `stopReason: "stop"`（正常完成）。

#### usage 语义（让阈值等价于 prompt 大小）[代码确证]

文件：`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:1058-1078`

```js
1058:    const promptTokens = rawUsage.prompt_tokens || 0;
1059:    const cacheReadTokens = rawUsage.prompt_tokens_details?.cached_tokens ?? rawUsage.prompt_cache_hit_tokens ?? 0;
1060:    const cacheWriteTokens = rawUsage.prompt_tokens_details?.cache_write_tokens || 0;
1069:    const input = Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens);
1075:        cacheRead: cacheReadTokens,
```

即 `input + cacheRead === prompt_tokens - cacheWrite`。**Case 2 的判据实际等价于「请求 prompt 总长 > 声明的 contextWindow」。**

### 1.3 `contextWindow` 未声明时的默认值 = **262144** [代码确证]

文件：`.../dsh-llm-pi-ai/lib/index.js`

```js
847: /** Context capacity assumed for a model neither configuration nor the catalog sizes. */
849: const DEFAULT_CONTEXT_WINDOW = 262144;
850: /** Output capability assumed for a model neither configuration nor the catalog sizes. */
851: const DEFAULT_MAX_TOKENS = 32768;
```

`grep` 原始输出：

```
$ grep -n "DEFAULT_CONTEXT_WINDOW" .../dsh-llm-pi-ai/lib/index.js
849:const DEFAULT_CONTEXT_WINDOW = 262144;
940:	defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
1024:			defaultContextWindow: source.defaultContextWindow ?? 262144,
```

类型声明处：`.../dsh-llm-pi-ai/lib/types/config.d.ts:38: export declare const DEFAULT_CONTEXT_WINDOW = 262144;`

**生效链路（三段回落）：**

```js
639: 		const contextWindow = entry.contextWindow ?? base?.contextWindow ?? request.defaultContextWindow;
640: 		if (!Number.isInteger(contextWindow) || contextWindow <= 0) invalid(provider, `model "${entry.id}" contextWindow must be a positive integer`);
641: 		const maxTokens = entry.maxTokens ?? base?.maxTokens ?? request.defaultMaxTokens;
```

逐段核实：

1. **`entry.contextWindow`** → `~/.dsh/settings.yaml:134-137` 的 `deepseek-v4.1-flash` 条目**没有**该字段：
   ```yaml
   134:        - id: deepseek-v4.1-flash
   135:          input:
   136:            - text
   137:            - image
   ```
2. **`base?.contextWindow`**（pi-ai 内置 catalog）→ **为 undefined**，两条独立证据：
   - `adam` 不在内置 catalog 的 provider 里，`catalogModels()` 直接返回空 Map：
     ```js
     355: function catalogModels(provider) {
     356: 	if (!catalogProviders().has(provider)) return /* @__PURE__ */ new Map();
     357: 	const models = getBuiltinModels(provider);
     358: 	return new Map(models.map((model) => [model.id, model]));
     359: }
     ```
   - 即使按 model id 全局找，pi-ai 目录里也不存在 `deepseek-v4.1-flash`：
     ```
     $ grep -rl "v4\.1-flash" .../node_modules/@earendil-works/pi-ai/dist/
     （无输出 = 不存在）
     ```
     而 `deepseek-v4-flash` 是存在的：`dist/providers/data/deepseek.json` 里 `"contextWindow":1000000,"maxTokens":384000`。
3. **`request.defaultContextWindow`** → `settings.yaml` 的 `llm-pi-ai:` 段**没有** `defaultContextWindow`（`grep` 无命中），
   所以落到 `z.number()...default(DEFAULT_CONTEXT_WINDOW)` = **262144**。

**结论：`adam/deepseek-v4.1-flash` 解析后的 `contextWindow = 262144`，`maxTokens = 32768`。**

对照：同 provider 的 `deepseek-v4-flash` 显式声明（`settings.yaml:78-80`）：

```yaml
78:        - id: deepseek-v4-flash
79:          contextWindow: 1000000
80:          maxTokens: 990000
```

### 1.4 `maxTokens` 与 `contextWindow` 在判定里各起什么作用 [代码确证]

**(a) `maxTokens` 完全不参与溢出判定。** `isContextOverflow(message, contextWindow)` 的签名里没有 maxTokens，`mapStopReason(message, contextWindow)` 也没有。调用点在 `index.js:1745` 只传 `model.contextWindow`。

**(b) `maxTokens` 的唯一作用是「输出上限」，并且被静默夹取（不报错）。**

文件：`.../@earendil-works/pi-ai/dist/api/simple-options.js:2-9`

```js
2: const CONTEXT_SAFETY_TOKENS = 4096;
3: const MIN_MAX_TOKENS = 1;
4: export function clampMaxTokensToContext(model, context, maxTokens) {
5:     if (model.contextWindow <= 0)
6:         return Math.max(MIN_MAX_TOKENS, maxTokens);
7:     const available = model.contextWindow - estimateContextTokens(context).tokens - CONTEXT_SAFETY_TOKENS;
8:     return Math.min(maxTokens, Math.max(MIN_MAX_TOKENS, available));
9: }
```

**(c) `maxTokens > contextWindow` 会不会单独引发校验错误？→ 不会。**

- 唯一的校验只查正数：`index.js:641-642`（`maxTokens must be a positive integer`），没有跨字段比较。
- 历史实测反证（见 §5）：「adam 之前的 maxTokens 是 786432，也 > 262144，而它一直工作」。原文：
  > "Wait — but before my change adam's maxTokens was 786432 — ALSO > 262144. And it worked. So no rejection. OK."

**所以：本次故障与 `maxTokens` 无关；`maxTokens > contextWindow` 的内部不一致本身不会触发任何校验错误，只会被 `clampMaxTokensToContext` 静默压低。**

---

## 2. 复现路径

### 2.1 必然触发的条件 [代码确证 + 实测确证]

对 `adam/deepseek-v4.1-flash`（解析 `contextWindow = 262144`），一个步骤在其响应满足**同时**下列两点时必触发：

```
① usage.inputTokens + usage.cacheReadTokens > 262144        （≈ prompt_tokens，见 §1.2）
② 该步骤终态 replayState.response.stopReason === "stop"
```

**可验证判据（直接查 session 事件）**：在 `session.jsonl.zstd` 里对同一 `turn`/`step` 找两条相邻事件：

```bash
zstdcat session.jsonl.zstd | grep -o '"turn":N,"step":M,"chunk":{"type":"usage","usage":{[^}]*}'
zstdcat session.jsonl.zstd | grep -o '"turn":N,"step":M,"chunk":{"type":"finish".\{0,200\}'
```

`usage` 那条的 `inputTokens + cacheReadTokens` 越过 `262144`，且 `finish` 那条的 `stopReason` 是 `stop` → 必现。

**为什么「只在长会话 / 大量工具输出」时出现**：阈值是 prompt 总长。只有当会话累积历史（含大段工具输出）把 prompt 顶到 26 万 token 以上才可能越线。本次会话到 turn 87 时 prompt 已在 49 万量级。

**为什么「只在某些步骤」出现（关键细节）**：Case 2 要求 `stopReason === "stop"`，即**该步是这一轮的收尾步（模型停止调用工具、直接给最终回答）**。
同一会话里同样 50 万 token 的**工具调用步**（`stopReason === "toolUse"`）**不会**触发。实测数据完全吻合——见 §3.4 表格：
`500,160`（toolUse）成功，而 `500,159`（stop）报错；`497,870`（toolUse）成功，而 `497,869`（stop）报错。
**所以表现形态是「每一轮的最后一个 step 必失败」。**

### 2.2 为什么偏偏 v4.1-flash 中招，v4-flash 没有

**同一段代码、同一个检测函数、同一个会话、同一个网关**——唯一差别是**声明的数字**：

| | 声明来源 | 解析后 contextWindow | 同一 ~50 万 token prompt |
|---|---|---|---|
| `adam/deepseek-v4-flash` | `settings.yaml:78-80` 显式 `contextWindow: 1000000` | **1000000** | 500,000 < 1,000,000 → **不触发** |
| `adam/deepseek-v4.1-flash` | `settings.yaml:134-137` 未声明 → 默认值 | **262144** | 500,000 > 262,144 → **触发** |

而且 `deepseek-v4.1-flash` 恰好是 `agent-default-model`（`settings.yaml:142-144`）与 `agent-presets.standard-glm`（150-151 + 143-144）指向的**主会话默认模型**：

```yaml
142: agent-default-model:
143:   provider: adam
144:   model: deepseek-v4.1-flash
```

即：**默认模型 + 唯一一个没声明窗口的高频长会话模型 = 最容易被真实打到。**
v4-flash 在 2026-09-17 打补丁时被显式加了 `contextWindow: 1000000`（见 §5），v4.1-flash 被漏掉，
**这不是新 bug，而是已记录在案的漏修**——上一轮 agent 自己写下过风险原文：

> "按源码无校验会通过，但溢出检测用的窗口仍是 262144；若希望上下文窗口也按 1M 计，可给该条目补 `contextWindow: 1000000`——需你确认（会改变溢出阈值语义）"

（出处：`/home/CNS2026495165/dsh/.workspace/incident-piai-model-selection.md` 第 51-54 行，见 §5 原文引用。）

### 2.3 放大因素：compaction 自救也坏在同一个根因 [实测确证]

`dsh-compaction-basic` 本来有 `agent/request-error` 兜底：命中 `CONTEXT_WINDOW_EXCEEDED` 就压缩上下文并重试。

文件：`.../dsh-compaction-basic/lib/index.js:801-825`

```js
801: 		ctx.on("agent/request-error", async ({ agent, failure, signal }, next) => {
802: 			if (failure.code !== CONTEXT_WINDOW_EXCEEDED_CODE || signal.aborted) return next();
...
807: 			const policy = resolveTargetPolicy(this.config, target);
808: 			const retries = this.overflowRetries.get(agent) ?? 0;
809: 			if (retries >= policy.maxOverflowRetries) return next();
...
813: 				result = await this.compactIfNeeded(agent, "context-overflow", signal);
```

默认 `auto: true`、`maxOverflowRetries: 1`（`lib/index.js:72`、`:76`）。

**但实测显示压缩本身用同一条路由、同一个错误阈值，于是压缩请求也报同一个错**（§3.5 原始事件）：

```json
{"type":"compaction/end","seq":277494,"time":1789638460577,"data":{"compactionId":"fbd931fd-cbba-4719-aec1-f91c633398b6","turn":87,"error":"pi-ai detected context overflow for model \"deepseek-v4.1-flash\""}}
```

→ 兜底路径被同一根因堵死，`maxOverflowRetries=1` 很快耗尽，**失败变成终态**，且每轮重来一次（turn 87 / 88 / 89 连续三轮）。

---

## 3. 实测取证：真实失败的那个会话

### 3.1 判定方法（如何区分「agent 讨论该字符串」与「该错误真的发生」）

**判别依据（4 条，全部可机械复核）：**

1. **所在 JSON 位置**：真故障的字符串位于会话事件流的**结构化字段** `data.chunk.reason.failure.{message,code}` 内，
   事件型别是 `assistant/chunk` + `chunk.type === "finish"`；
   而「讨论」形态位于 `role:"assistant"` / `role:"user"` 消息的 `content[].text` 或 `content[].thinking` 里，
   或位于 `read`/`bash` 工具的 `tool-result` 文本里。
2. **有配对的 token 记账**：真故障在**同一 turn/step、seq 相邻、时间差 1ms** 处有一条 `chunk.type === "usage"` 事件（判定所用的 usage）。
   讨论形态没有这种配对。
3. **带 `replayState.response.stopReason`**：真故障带完整 `replayState.response`，能看出服务端返回的是成功还是错误。
4. **全局穷举计数**：对全部会话做一次穷举，逐条判断落在哪一类。

**穷举原始命令与结果：**

```
$ cd /home/CNS2026495165/.dsh/sessions && find . -name "session.jsonl.zstd" -print0 \
    | xargs -0 -P 8 -I{} sh -c 'zstdgrep -l "pi-ai detected context overflow" {} 2>/dev/null'
./--home-CNS2026495165-dsh--/d237aa05-ec9a-4d73-aca9-d7f64a72df68/session.jsonl.zstd
./--home-CNS2026495165-dsh--/session-cb106ec3-2628-43f5-8403-13f6c836a8dd/session.jsonl.zstd
./--home-CNS2026495165-dsh--/b16204ad-47f0-45dd-bf9e-aa00bcd9b407/session.jsonl.zstd
./--home-CNS2026495165-dsh--/session-6a7367fe-7bd8-4b8d-b3fa-7c22a7d9b616/session.jsonl.zstd
./--home-CNS2026495165-dsh--/c59c3503-6928-482c-9af4-c9849d93cd80/session.jsonl.zstd
./--home-CNS2026495165-dsh--/c71c59cf-fab0-4cc4-af6d-38aa38e1304e/session.jsonl.zstd
./--home-CNS2026495165-dsh--/d5dba2f3-a138-40d4-9c1c-03c6179f2b9d/session.jsonl.zstd
./--home-CNS2026495165-dsh--/dca3c859-ea23-41d6-b8fb-b8de6a29faf8/session.jsonl.zstd
./--home-CNS2026495165-dsh--/41508b92-13cc-4f94-96e2-9b6785605d70/session.jsonl.zstd
./--home-CNS2026495165-dsh--/504f6f1f-32b3-4a49-8c3d-d6a087a060bd/session.jsonl.zstd
./--home-CNS2026495165-dsh--/da2b8033-1097-436b-8ece-37440a84f339/session.jsonl.zstd
./--home-CNS2026495165-dsh--/83d9e651-4455-4857-af82-a91fc83b2c6c/session.jsonl.zstd
./--home-CNS2026495165-dsh--/0a64cf25-0d84-4d7b-90e6-77f9e4e26977/session.jsonl.zstd
./--home-CNS2026495165-Dexterous_Hand_23Dof--/session-6b9b6c3f-6ed5-4063-9122-c219be7afa16/session.jsonl.zstd
```

14 个会话命中。逐条核对命中上下文后的分类：

| 会话 | 命中次数 | 性质 | 判别证据 |
|---|---|---|---|
| `41508b92` / `504f6f1f` / `da2b8033` / `83d9e651` / `0a64cf25` / `d237aa05` / `b16204ad` / `session-6a7367fe` / `c59c3503` / `c71c59cf` / `d5dba2f3`（11 个，mtime 09-08 ~ 09-11） | 各 2 | **false：只是读源码** | 命中上下文是带行号的源码文本，如 `289: \tif (piAiOverflow \|\| harnessOverflow) return {\n1290: ...` 与结构化 `{"number":1292,"text":"\t\t\tmessage: message.errorMessage ?? \`pi-ai detected context overflow...\`"}` —— 是 `read` 工具输出 |
| `dca3c859`（09-17 17:53） | 12 | **false：本轮调查产生** | 命中上下文是本次调查自身的 bash 命令行文本与 brief 的 prompt 原文 |
| `session-cb106ec3`（09-17 17:53） | 8 | **false：agent 讨论** | 命中上下文是推理散文，如 `"Interesting: the error \`pi-ai detected context overflow\` — the client-side estimator detected..."`、`"the user's note said: 别的会话触发了本轮运行失败..."` |
| **`session-6b9b6c3f-6ed5-4063-9122-c219be7afa16`**（09-17 17:53） | **3** | **TRUE：真故障 ×3** | 命中上下文是 `assistant/chunk` → `chunk.type:"finish"` → `reason.failure.{message,code}`，且带 `replayState.response.stopReason:"stop"`；同 step 有配对 usage 事件 |

`session-cb106ec3` 的「讨论」原文（反例，证明判别标准有效）：

```
"Interesting: the error `pi-ai detected context overflow` — the client-side estimator detected context overflow. If contextWindow for v4.1-flash defaults to something small (e."
"er's round-3 answers were about how to restart — now moot. And user's latest custom answer says: \"不接真机，同时别的会话触发了本轮运行失败 pi-ai detected context overflow for model deepseek-v4.1-flash CONTEXT_WINDOW_EXCEEDED\".\n\nThat last part is critical new information: another session"
```

—— 这两条都在 assistant 的**推理/正文**里，**不是** `finish` 事件，故**不算真发生**。

### 3.2 真实失败会话信息 [实测确证]

- **会话 id**：`6b9b6c3f-6ed5-4063-9122-c219be7afa16`
- **工作区**：`/home/CNS2026495165/Dexterous_Hand_23Dof`
- **文件**：`/home/CNS2026495165/.dsh/sessions/--home-CNS2026495165-Dexterous_Hand_23Dof--/session-6b9b6c3f-6ed5-4063-9122-c219be7afa16/session.jsonl.zstd`
- **模型/路由**：`provider: adam` / `model: deepseek-v4.1-flash`（网关回报 upstream `responseModel: "deepseek/deepseek-flash"`）
- **真故障次数**：**3 次**（不是 1 次；连续三轮同一步骤失败）

```
时间戳换算原始命令：
$ for t in 1789638522576 1789638766440 1789638984736; do date -d @$((t/1000)) '+%Y-%m-%d %H:%M:%S %Z'; done
2026-09-17 17:48:42 CST
2026-09-17 17:52:46 CST
2026-09-17 17:56:24 CST
```

| # | turn/step | 时刻 (CST) | seq | prompt token (input+cacheRead) | stopReason | 结果 |
|---|---|---|---|---|---|---|
| 1 | 87 / 3 | **2026-09-17 17:48:42** | 279513 | 74189 + 423680 = **497,869** | `stop` | ❌ CONTEXT_WINDOW_EXCEEDED |
| 2 | 88 / 2 | **2026-09-17 17:52:46** | 280124 | 1983 + 498176 = **500,159** | `stop` | ❌ CONTEXT_WINDOW_EXCEEDED |
| 3 | 89 / 2 | **2026-09-17 17:56:24** | 280xxx | 6472 + 497792 = **504,264** | `stop` | ❌ CONTEXT_WINDOW_EXCEEDED |

### 3.3 原始错误事件 JSON 片段（turn 87 step 3，逐字）[实测确证]

```json
{"type":"assistant/chunk","seq":279513,"time":1789638522576,"data":{"turn":87,"step":3,"chunk":{"type":"finish","reason":{"kind":"error","failure":{"message":"pi-ai detected context overflow for model \"deepseek-v4.1-flash\"","code":"CONTEXT_WINDOW_EXCEEDED"}},"replayState":{"response":{"kind":"pi-ai","version":2,"api":"openai-completions","provider":"adam","model":"deepseek-v4.1-flash","responseModel":"deepseek/deepseek-flash","responseId":"4ac3c32b-b609-4148-bdf0-a70fab159fc0","stopReason":"stop"},"blocks":[{"type":"reasoning","thinkingSignature":"reasoning_content"},{"type":"text"}]}}}}
```

紧邻其前的 token 记账事件（**seq 279512，时间戳仅差 1ms**）：

```json
{"type":"assistant/chunk","seq":279512,"time":1789638522575,"data":{"turn":87,"step":3,"chunk":{"type":"usage","usage":{"inputTokens":74189,"outputTokens":704,"cacheReadTokens":423680}}}}
```

**74189 + 423680 = 497869 > 262144** ← 阈值越线的确凿算术。

另两次的 finish 片段（键字段）：

```json
{"type":"assistant/chunk","seq":280124,"time":1789638766440,"data":{"turn":88,"step":2,"chunk":{"type":"finish","reason":{"kind":"error","failure":{"message":"pi-ai detected context overflow for model \"deepseek-v4.1-flash\"","code":"CONTEXT_WINDOW_EXCEEDED"}},"replayState":{"response":{"kind":"pi-ai","version":2,"api":"openai-completions","provider":"adam","model":"deepseek-v4.1-flash","responseModel":"deepseek/deepseek-flash","responseId":"bdc96635-5850-4827-a230-b763223574f2","stopReason":"stop"},"blocks":[{"type":"reasoning","thinkingSignature":"reasoning_content"},{"type":"text"}]}}}}
```

```
$ zstdcat session.jsonl.zstd | grep -c '"chunk":{"type":"finish","reason":{"kind":"error","failure":{"message":"pi-ai detected context overflow'
3
```

### 3.4 上下文 token 规模——关键佐证：网关**照常服务**了这些请求 [实测确证]

同一会话、同一路由、同一时间段内，**被网关成功服务**（返回 `toolUse`，模型正常发起工具调用）的 prompt 规模：

| turn/step | input + cacheRead | stopReason | 结果 |
|---|---|---|---|
| 87 / 1 | 495509 + 128 = **495,637** | `toolUse` | ✅ 成功 |
| 87 / 2 | 561 + 495872 = **496,433** | `toolUse` | ✅ 成功 |
| 88 / 1 | 206 + 497664 = **497,870** | `toolUse` | ✅ 成功 |
| 89 / 1 | 192 + 499968 = **500,160** | `toolUse` | ✅ 成功 |
| 87 / 3 | 74189 + 423680 = **497,869** | `stop` | ❌ 被判溢出 |
| 88 / 2 | 1983 + 498176 = **500,159** | `stop` | ❌ 被判溢出 |
| 89 / 2 | 6472 + 497792 = **504,264** | `stop` | ❌ 被判溢出 |

**这张表同时证明了两件事（非常重要）：**

1. **网关的真实窗口远大于 262,144**——最保守的下界是**≥ 504,264 token**（网关对这些请求未返回任何错误，且 500,160 那次返回了正常的 `toolUse`）。
   262,144 相对真实窗口**至少低估 92%**。
2. **触发变量不是「上下文有多大」，而是「该步的 stopReason 是不是 stop」**——
   `497,869`（stop）失败而 `497,870`（toolUse）成功；`500,159`（stop）失败而 `500,160`（toolUse）成功。
   同一尺寸一个失败一个成功，唯一差别就是 Case 2 的 `stopReason === "stop"` 前置条件。
   → 这是「**判定是客户端启发式产物、而非服务端能力边界**」的直接实验证据。

### 3.5 网关真实窗口的取证尝试与边界 [部分实测 / 无法确证]

```
$ python3 -c "...GET https://llmapi.roboscience.xyz/v1/models..."
total models: 45
{"id": "deepseek-v4.1-flash", "object": "model", "created": 1626777600, "owned_by": "openai", "supported_endpoint_types": []}
{"id": "deepseek-v4-flash", "object": "model", "created": 1626777600, "owned_by": "openai", "supported_endpoint_types": ["openai"]}
{"id": "deepseek-v4-flash-vision-exp", "object": "model", "created": 1626777600, "owned_by": "openai", "supported_endpoint_types": []}
```

- **网关元数据不暴露窗口**：`/v1/models` 的 model 对象只有 `id/object/created/owned_by/supported_endpoint_types`，**没有 `context_length`**。
- 其它探测：`GET /v1/model/info` → `404 Not Found`；`GET /v1/models/deepseek-v4.1-flash` → `{"error":{"message":"The model 'deepseek-v4.1-flash' does not exist",...,"code":"model_not_found"}}`（虽然列表里有它）；`GET /model/info` → 返回网关前端 HTML（该网关是「统一的 AI 模型聚合与分发网关」）。
- **`deepseek/deepseek-flash` 是独立 upstream**，并非 v4-flash 的同一后端 [实测确证]：
  ```
  "provider":"adam","model":"deepseek-v4.1-flash","responseModel":"deepseek/deepseek-flash"
  "provider":"adam","model":"deepseek-v4-flash","responseModel":"deepseek-flash"
  "provider":"adam","model":"deepseek-v4-flash","responseModel":"deepseek-v4-flash-0731"
  "provider":"adam","model":"deepseek-v4-flash","responseModel":"deepseek-v4-flash-202605"
  "provider":"adam","model":"deepseek-v4-pro","responseModel":"deepseek-v4-pro-202606"
  ```
  → **不能**用「v4-flash 声明了 1M」直接推出 v4.1-flash 也是 1M（同一个上游）。§2.2 的对齐是**配置惯例上的对齐**，不是同后端证明。

**结论（诚实分档）：**
- **[实测确证]** 真实窗口 **≥ 504,264 token**（网关成功服务过这个规模）。
- **[无法确证]** 真实窗口的**上界**（网关元数据不暴露，未做 >50 万 token 的加压探测）。
- **[无法确证]** `adam` 网关对 `deepseek-v4.1-flash` 的 `max_tokens` 上限。

---

## 4. 修复方案对比（**仅出方案，未做任何修改**）

### 4.0 前置：这些改动的热/冷属性 [代码确证]

**三个方案都是「热」——不需要重启。** 机制（全部代码确证）：

1. 适配器把 `llm-pi-ai` 命名空间注册到 settings seam 上，并把用户层源实时写入 `current`：

   `.../dsh-llm-pi-ai/lib/index.js:2472-2491`
   ```js
   2472: 	installSettingsSection(ctx, NS, Config, config, {
   2473: 		validate: assertServiceable,
   2474: 		setSource: (source) => {
   2475: 			current = source;
   2476: 		},
   2477: 		onChange: () => {
   2478: 			try {
   2479: 				ensureRegistrationFacts();
   ...
   2491: 	});
   ```
   （`const NS = settingsNamespace("llm-pi-ai");` 在 `index.js:2346`）

2. 配置**每次操作**通过 thunk 重新读，不是构造期冻结：

   `.../dsh-llm-pi-ai/lib/index.js:2400`
   ```js
   2400: 		const raw = current();
   ```
   且每个操作在首个 `await` 前捕获一份不可变快照：`current()` 出现于 `index.js:1662 / 1674 / 1694 / 1701`。

3. `~/.dsh/settings.yaml` 被 chokidar 监听：

   `.../dsh-settings-file/lib/index.js:3`：`import { watch } from "chokidar";`
   `.../dsh-settings-file/lib/index.js:37`：`watch: config.watch ?? true,`
   `.../dsh-settings-file/lib/index.js:74`：`watch: z.boolean().default(true),`
   `.../dsh-settings-file/lib/index.js:179`：`const watcher = this.spec.watch ? watch(await canonicalizeWatchPath(this.spec.filename), {`

4. 插件 README 明文（`.../dsh-llm-pi-ai/README.md:114-116`）：

   > "The adapter reads its profiles through a thunk **once per operation** instead of freezing them at construction. The plugin registers the `llm-pi-ai` namespace on the optional `ctx.settings` seam ... a user can add a route, override one field of a composition route, or point a route at another proxy, all **effective on the next request with no restart**."

**热载的两个附带条件（重要）：**

- **对在跑会话的影响**：快照是「每操作冻结」的（README:144「switching models mid-reply takes effect on the next step, never inside the one in flight」）。
  所以**正在流的那个 step 不受影响**，**该会话的下一个 step/下一次请求起生效**。
  对本案有用的推论：修完后，那个正在失败的工作区会话不必重开，**下一轮就会用新阈值**。
- **外部编辑的兜底语义**：若外部改 `settings.yaml` 导致某段不可服务，settings seam 会**保留 last-good 值并告警**
  （`dsh-settings-file/lib/index.js:222-234`：`this.ctx.logger.warn("settings-file: reload failed at %s; keeping the last good document", ...)`）。
  本方案只增加正整数 `contextWindow`/`maxTokens`，是可服务值（`index.js:640-642` 校验通过），**不触及该兜底路径**。

### 4.1 方案对比表

| | **方案 A**：加 `contextWindow: 1000000` + `maxTokens: 990000` | **方案 B（推荐）**：只加 `contextWindow: 1000000` | **方案 C**：不改，依赖默认值 |
|---|---|---|---|
| **改哪一行** | `~/.dsh/settings.yaml:134-137`，在 `input:` 前后追加两行：<br>`- id: deepseek-v4.1-flash`<br>`  contextWindow: 1000000`<br>`  maxTokens: 990000`<br>`  input: [text, image]` | 同位置，**只追加一行**：<br>`  contextWindow: 1000000`<br>（`maxTokens` 保持未声明 → 解析为 `DEFAULT_MAX_TOKENS = 32768`） | 不改 |
| **冷面/热面** | **热**（见 §4.0），不重启 | **热**，不重启 | — |
| **对在跑会话的影响** | 不打断在流 step；**下一个 step 起生效**（§4.0） | 同 A | 无影响 = 继续每轮末步失败 |
| **溢出判定阈值变化** | 262144 → 1000000（Case 2 与 Case 3 同步放宽） | 同 A | 不变（262144） |
| **本故障是否修好** | ✅ 修好（50 万 << 100 万） | ✅ 修好 | ❌ 不修；且 compaction 自救同因失效 → 每轮复现 |
| **风险①：过量声明 contextWindow** | 有。**实测只证到 ≥504,264**，声明 1000000 是把窗口抬到已证下界的约 2 倍。**50 万～100 万区间变为「无客户端护栏」**：真的超限时不会再有干净的客户端溢出 + compaction 兜底，而会以网关 400 / 静默截断的形式暴露 | 同 A（同样的过量声明风险） | 无此风险（但代价是持续故障） |
| **风险②：`max_tokens` 被网关拒** | **有（新增暴露面）**。历史实测：**opencode 网关**对 `deepseek-v4.1-flash` 的 `max_tokens` 硬上限是 `[1, 393216]`，`990000` 被拒（`invalid_request_error: Invalid max_tokens value, the valid range of max_tokens is [1, 393216]`）。`adam` 网关对**该模型**的上限 **[无法确证]**；且声明 `defaultMaxTokens: 990000` 后（`index.js:1685-1687` 会把 `entry.maxTokens` 暴露成 `modelInfo.defaultMaxTokens`），上层可能真的发出 `max_tokens=990000`。同时 `clampMaxTokensToContext` 在 contextWindow=1000000 下不再压低它（`available ≈ 995,904`） | **无新增**。`maxTokens` 保持 32768，配合 `contextWindow=1000000`，`clampMaxTokensToContext` 结果仍是 32768，**请求线上传的 `max_tokens` 不变**，网关侧行为零变化 | 无 |
| **风险③：引入 `maxTokens > contextWindow` 的新不一致** | **不引入**。990000 < 1000000（一致）。<br>注：此不一致**本来也不会报错**（§1.4(c)），只是语义不干净 | **不引入，且更干净**。32768 << 1000000 | 维持现状。注意现状下 v4.1-flash 是 `maxTokens=32768 < contextWindow=262144`，**本来就不存在**该不一致（历史上 990000 > 262144 的不一致属于 `deepseek-v4-flash`，已于 09-17 用补 `contextWindow: 1000000` 消解） |
| **回归半径** | 溢出阈值 + 输出上限（两个变量同时动） | **只动溢出阈值一个变量**（最小回归面） | 0 |
| **与既有配置的一致性** | 与 `deepseek-v4-flash`（`settings.yaml:78-80`）逐字段对齐 | 与 v4-flash **在关键字段（窗口）上对齐**；输出上限故意不动 | 与 46/50 个 adam 条目「一样」——但那个「一样」正是缺陷本身 |

### 4.2 补充：这不是孤例（影响面提示）

`adam` 路由 **50 个条目中有 46 个未声明 `contextWindow`**，全部回落到 262144：

```
$ python3 -c "...读取 settings.yaml 统计..."
adam 条目总数: 50
未声明 contextWindow 的条目数: 46
已声明: [('deepseek-v4-flash', 1000000, 990000), ('glm-5.3', 1000000, 1000000), ('glm-5.3-flash', 1000000, 1000000), ('gpt-6-astra', 1000000, 1000000)]
未声明(全部落到 262144):
   deepseek-v4-pro, glm-5.1, glm-5.2, glm-4.7, glm-5, kimi-k3
   qwen3.7-max, qwen3.7-plus, qwen3.8-flash, qwen3.8-max, claude-haiku-4-5-20251001, claude-opus-4-5-20251101
   claude-opus-4-6, claude-opus-4-7, claude-opus-4-8, claude-opus-5, claude-sonnet-4-5-20250929, claude-sonnet-4-6
   claude-sonnet-5, gpt-5.4, gpt-5.4-mini, gpt-5.4-openai-compact, gpt-5.5-openai-compact, gpt-5.6-sol
   gpt-5.6-terra, gpt-5.5, gpt-5.6-luna, gemini-3.1-* , gemini-3.5-* , gemini-3.6-flash, gemini-3-flash-preview
   gemini-3-pro-image-preview*, gemini-3-flash, kimi-k2.7-code, kimi-k2.7-code-highspeed
   veo3.1-fast, veo3.1-pro, deepseek-v4.1-flash, deepseek-v4-flash-vision-exp
```

含义：
- `deepseek-v4-pro / glm-5.2 / kimi-k3 / qwen3.7-max / qwen3.7-plus / qwen3.8-* / gemini-3.x / gpt-5.6-*` 等**真实窗口 ≥ 1M** 的条目，都会以 262144 参与判定 → **同类误判随时可在这些模型上复现**。
- 反向也有：`claude-*`（真实 200,000）、`glm-4.7`/`glm-5`/`glm-5.1`（真实 ~202,752~204,800）落到 262144 是**略微过量声明**，反而更危险（客户端护栏偏松）。
- **建议的粒度是 per-model，不要设 provider 级 `defaultContextWindow`**：一个路由级默认值会同时把 claude 类（200K）与 gemini 类（1M）都拉到同一个数，必然对其中一半是错的。
- 本次任务范围内**只**要求 A/B/C 三案；上面这段是影响面提示，**未擅自扩范围**。

---

## 5. 历史决策上下文（按要求读清）

出处文件：`/home/CNS2026495165/dsh/.workspace/incident-piai-model-selection.md`（第 47-54 行，
以及 `session 30f4c698-120b-49d4-9efc-3282a5b015d0` 里写入该文件的 `edit` 工具调用原文）

**（1）上一轮 agent 面对同一取舍时的推理原文（逐字）** [实测确证：session 事件]

> "ring contextWindow → potential silent context overflow (bad); under-declaring → premature compaction (annoying but safe). Given uncertainty about the adam gateway's true window, the SAFE choice is to leave contextWindow untouched (262144 default) and only set maxTokens 990000 (what the user asked). Hmm — but then maxTokens (990000) > contextWindow (262144), which is internally inconsistent and might itself cause validation errors somewhere else (pi-ai?) — it didn't before with 786432 though.
> Decision: keep it minimal and consistent with the pre-incident pattern: only maxTokens: 990000 for adam's deepseek-v4-flash"

—— 即：**「不改 contextWindow」曾被判断为 SAFE，理由是「宁可提前压缩，也不要静默溢出」**。
该判断成立的前提是「默认 262144 ≤ 真实窗口」。**本次故障证伪了这个前提**：真实窗口 ≥504,264，
于是 262144 不再是「保守」而是**错误**——它不再导致「提前压缩」（`annoying but safe`），
而**直接导致正常响应被误判为溢出并终止**（`not safe at all`）。这是决策依据需要被推翻的关键点。

**（2）用户当时的裁决与最终值（逐字）** [实测确证]

> "2. adam `deepseek-v4-flash` 的 `maxTokens: 990000` 大于该 provider 的默认 `defaultContextWindow: 262144`。
>    **用户裁决：补 `contextWindow: 1000000`**（与 opencode 侧同模型的 catalog 声明一致、匹配 0.99M 上限），
>    已应用到 live settings 并固化进 `replay-lag-fix.sh`（apply + assert 同步），演习端到端全绿。
>    最终值：`{contextWindow: 1000000, maxTokens: 990000}`。"

—— 裁决逻辑是**与 opencode 侧同模型 catalog 声明对齐到 1000000**。这正是方案 A/B 取 1000000 的先例依据。

**（3）同一次会话里上一轮 agent 写下的、被漏掉的那半边（逐字，见 §2.2）** [实测确证]

> "2. adam `deepseek-v4-flash` 的 `maxTokens: 990000` 大于该 provider 的默认 `defaultContextWindow: 262144`
>    （adam 为手写路由、条目未声明 contextWindow）。按源码无校验会通过，但溢出检测用的窗口仍是 262144；
>    若希望上下文窗口也按 1M 计，可给该条目补 `contextWindow: 1000000`——需你确认（会改变溢出阈值语义）。"

—— **诊断完全正确、只修了 `deepseek-v4-flash` 一个条目**；`deepseek-v4.1-flash`（默认模型！）未修。本次故障即该漏修的现实化。

**（4）`max_tokens` 上限的实测数据点（方案 A 风险的唯一硬依据）** [实测确证]

> "3. **opencode 网关 max_tokens 硬上限（2026-09-12 真实 API 实测，测试结果优先）**：
>    `deepseek-v4.1-flash` 的有效 max_tokens 范围 **[1, 393216]**，`990000` 会被拒绝
>    （`invalid_request_error: Invalid max_tokens value, the valid range of max_tokens is [1, 393216]`）。
>    **用户裁决：vision-adam 段 `maxTokens: 393216`**（已应用 live + 固化脚本/断言/diff）。
>    同一实测中 **adam 网关接受 `max_tokens=990000`**（`finish_reason: stop`），adam 侧 0.99M 保持。
>    真实识图冒烟（`v4f-test.png`，maxTokens 393216）：耗时 3.3s，正确识别 ... 全链路可用。"

并可核对的旁证：`~/.dsh/settings.yaml:145-149` 的 `vision-adam` 段确实写着 `maxTokens: 393216`
（这正是那次实测得出的网关上限值），而该段的 `maxTokens` 与 `adam` 路由的 `models[].maxTokens` 是**两套独立配置**。

**注意（诚实分档）**：那次 `[1, 393216]` 的测量对象是 **opencode 网关**（对应 pinned diff 里的
`baseURL: https://opencode.ai/zen/go/v1` + `OPENCODE_GO_API_KEY`）。**`adam` 网关对 `deepseek-v4.1-flash`
的 `max_tokens` 上限没有直接实测数据**（"adam 网关接受 990000" 那条实测的模型对象在记录里含混）。
→ 方案 A 的 max_tokens 风险因此标记为 **[部分确证/无法确证]**，不作为推荐依据但必须列入风险。

---

## 6. 推荐

### 推荐：**方案 B —— 只给 `deepseek-v4.1-flash` 补 `contextWindow: 1000000`，不动 `maxTokens`**

- **改哪一行**：`~/.dsh/settings.yaml`，在 `134:  - id: deepseek-v4.1-flash` 与 `135: input:` 之间插入一行
  ```yaml
          contextWindow: 1000000
  ```
  （`maxTokens` 保持未声明）
- **目标值**：`contextWindow: 1000000`
- **一句话理由**：溢出判定**只**吃 `contextWindow`、完全不吃 `maxTokens`（§1.4(a)），所以只动这一个变量就能修掉误判，
  同时避开方案 A 把 `max_tokens` 抬到未经证实的 990000、可能被网关以 `invalid_request_error` 拒绝的新增暴露面。
- **风险等级：中（Moderate）**
  - 残余风险就是「过量声明」：实测只证到真实窗口 **≥504,264**，声明 1000000 把 50 万～100 万这一段变成无客户端护栏区间；
    若该段真的越限，会以网关 400 或静默截断暴露，而不是干净的客户端溢出 + compaction 兜底。
  - 但相比方案 C 的「每轮末步必失败 + compaction 自救同因失效」的**确定性故障**，方案 B 严格更优；相比方案 A 少了 max_tokens 网关拒斥风险。
- **生效方式**：**热载，无需重启**（§4.0 代码确证）。改动会写入 `current` 并在**下一次请求/下一个 step** 生效——
  那个正在失败的工作区会话（`6b9b6c3f`）**不需要重开**，下一轮即用 1000000 判定。
- **可选的后续加固（本次未做、需另行裁决）**：
  1. 用一次受控加压探测把 `adam` 网关对 `deepseek-v4.1-flash` 的**真实窗口下界**从 50 万往上顶（例如逐级 600K/700K/800K），
     再据实测值收紧到「已证下界」而非 1000000；
  2. 按 §4.2 清单对其它高频 `deepseek-v4-pro / glm-5.2 / kimi-k3 / qwen3.7-* / gemini-3.x` 条目逐个补 per-model `contextWindow`
     （**不要**设 provider 级 `defaultContextWindow`，会同时错配 claude 类与 gemini 类）。

---

## 附：本次调查用到的关键命令（可复现）

```bash
# 1) 报错字符串与 code 的代码位置
grep -rn "pi-ai detected context overflow" <dsh>/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js
grep -rn "CONTEXT_WINDOW_EXCEEDED_CODE"   <dsh>/node_modules/@deepseek-ai/dsh-llm/lib/index.js

# 2) 默认窗口 / 默认输出上限
grep -n "DEFAULT_CONTEXT_WINDOW\|DEFAULT_MAX_TOKENS" <dsh>/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js
grep -rn "262144" <dsh>/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/types/config.d.ts

# 3) 检测逻辑本体
sed -n '128,154p' <dsh>/node_modules/@earendil-works/pi-ai/dist/utils/overflow.js

# 4) usage 语义（input = prompt - cacheRead - cacheWrite）
sed -n '1058,1079p' <dsh>/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js

# 5) maxTokens 静默夹取（不报错）
sed -n '1,9p' <dsh>/node_modules/@earendil-works/pi-ai/dist/api/simple-options.js

# 6) pi-ai catalog 里没有 deepseek-v4.1-flash
grep -rl "v4\.1-flash" <dsh>/node_modules/@earendil-works/pi-ai/dist/     # 无输出

# 7) 全局找出真故障会话（讨论 vs 真发生）
cd ~/.dsh/sessions && find . -name "session.jsonl.zstd" -print0 \
  | xargs -0 -P 8 -I{} sh -c 'zstdgrep -l "pi-ai detected context overflow" {} 2>/dev/null'

# 8) 真故障事件的完整 JSON + 配对 usage
cd ~/.dsh/sessions/--home-CNS2026495165-Dexterous_Hand_23Dof--/session-6b9b6c3f-6ed5-4063-9122-c219be7afa16
zstdcat session.jsonl.zstd | grep '"turn":87,"step":3,"chunk":{"type":"finish"' | head -c 4000
zstdcat session.jsonl.zstd | grep '"turn":87,"' | grep '"type":"usage"'

# 9) compaction 自救同样失败
zstdcat session.jsonl.zstd | grep -o '"type":"compaction/\(start\|end\)".\{0,300\}'

# 10) 热载机制
grep -n "installSettingsSection" -A 20 <dsh>/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js | tail -25
grep -n "watch" <dsh>/node_modules/@deepseek-ai/dsh-settings-file/lib/index.js | head
```

（`<dsh>` = `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh`）

---

## 附：论断分级汇总

| 论断 | 分级 |
|---|---|
| 报错由 `dsh-llm-pi-ai/lib/index.js:1287-1295` 产生，`CONTEXT_WINDOW_EXCEEDED` 在 1293 行 | **[代码确证]** |
| 本次命中 `isContextOverflow` 的 **Case 2**（纯客户端预估），服务端返回的是 `stop` | **[代码确证]**（事件里 `stopReason:"stop"` + `errorMessage` 缺失使 Case 1 结构上不可能） |
| 未声明时默认 `contextWindow = 262144` | **[代码确证]**（`index.js:849` + 三段回落 639 行） |
| `adam/deepseek-v4.1-flash` 解析结果 = `contextWindow 262144` / `maxTokens 32768` | **[代码确证]**（`adam` 不在 catalog + 条目未声明 + 无 defaultContextWindow） |
| v4-flash 因显式声明 1000000 而不触发；差异纯粹来自声明值 | **[代码确证]** + **[实测确证]**（`settings.yaml:78-80`） |
| `maxTokens` 不参与溢出判定；`maxTokens > contextWindow` 不报错，只被静默夹取 | **[代码确证]** |
| 真故障会话 = `6b9b6c3f-6ed5-4063-9122-c219be7afa16`，3 次失败：17:48:42 / 17:52:46 / 17:56:24 CST | **[实测确证]** |
| 失败时 prompt = 497,869 / 500,159 / 504,264 token，均 > 262,144 | **[实测确证]**（配对 usage 事件） |
| 其余 13 个含该字符串的会话均为「讨论/读源码」，不是故障 | **[实测确证]**（逐条提取命中上下文分类） |
| 网关真实窗口 **≥ 504,264 token** | **[实测确证]**（同尺寸 toolUse 步成功、stop 步失败） |
| 网关真实窗口的**上界** | **[无法确证]**（`/v1/models` 不暴露 `context_length`；未做加压探测） |
| `adam` 网关对 `deepseek-v4.1-flash` 的 `max_tokens` 上限 | **[无法确证]**（仅有 opencode 网关 [1,393216] 实测；adam 侧数据点对象含混） |
| compaction 自救失败于同一根因（摘要请求走同一路由同一阈值） | **[实测确证]**（`compaction/end` 携带同一 error 字符串）+ **[推断]**（"摘要请求本身溢出"的机制解释） |
| 46/50 个 adam 条目同样回落到 262144，存在同类隐患 | **[代码确证]** + **[实测确证]**（读 settings 统计） |
| 值级改 settings **热载、无需重启**，下一 step 生效 | **[代码确证]**（`installSettingsSection` setSource + thunk per operation + chokidar watch）+ 插件 README 明文 |
| 溢出检测用的窗口仍是 262144 是上一轮 agent 已写下但只修了 v4-flash 的漏修 | **[实测确证]**（历史 session 事件 + `.workspace/incident-piai-model-selection.md` 51-54 行） |
