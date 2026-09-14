# dsh-taste 中文显示 + 置信度两位小数 可执行设计

> 目标：taste.md 文件本体保持英文（注入精度优先），中文陈述只进 GUI 显示层（边车存储）；置信度从「一位小数」升级为「两位小数」并在 GUI / 命令 list 按原值两位显示。
>
> 基线：`cd /home/CNS2026495165/dsh/dsh-taste && node --test "test/*.test.js"` → **162/162 pass**（本设计前已复跑确认）。
>
> 文中所有文件路径均相对 `/home/CNS2026495165/dsh/dsh-taste`；`dsh-tools` 指 `../node_modules/@deepseek-ai/dsh-tools`。

---

## 0. 关键实证结论（先给裁决依据）

### 0.1 `defineTool` 参数 DSL 对 object/record 的支持面（已读源码实证）

`dsh-tools/lib/index.js` 的参数 schema 编译器 / 校验器：

- 支持的类型全集 `SCHEMA_TYPES = ["object","array","string","number","integer","boolean","null"]`（`index.js:48-56`）。作者 DSL 还额外接受 `type:"json"`（`index.js:686-689`），它被编译成「无 `type` 的 annotation-only schema」，即**不约束值的任意 JSON**（`checkSchemaNode` 对「无 `type`/`oneOf` 且无 sibling 关键字（如 `properties`/`required`）」的 annotation-only 节点放行，`index.js:214-217`）。
- `object` 类型：作者 DSL 允许 `type/properties/additionalProperties`（`index.js:690-710`）。**`additionalProperties` 必须显式给 boolean**——编译器 `index.js:697` 断言 `typeof input.additionalProperties !== "boolean"` 即 `authorError`；原始 schema 校验器 `checkObjectSchemaTail` 同样断言 `additionalProperties must be a boolean`（`index.js:158`）。
- **因此「typed record / `map<string,string>`」不可表达**：`additionalProperties` 不能是子 schema（`{type:"string"}` 会被 697 行拒绝）。自由键值对象只有一种写法：`{ type:"object", additionalProperties: true }`。
- 运行期校验 `checkValue` 的 object 分支（`index.js:446-475`）：只对 `properties` 里**显式声明**的键做子校验；`additionalProperties:false` 时才拒绝未声明键。**`additionalProperties:true` 时，未声明键的值完全不被校验**（可以是 string/number/array/object/任意 JSON）。

结论：**「自由对象」可以表达（`additionalProperties:true`），但其 value 是无类型的**；「强类型 record」不可以用 DSL 表达。

### 0.2 因此的选型

| 候选 | DSL 可行性 | 结论 |
|---|---|---|
| `display` 为自由对象 `{type:"object", additionalProperties:true}` | ✅ 可编译（value 无类型） | **选定为 write/edit 的 display 参数**；value 的无类型由 execute 层防御性净化兜底（见 §2.3） |
| `display` 为 `array [{en,zh}]` | ✅ 完全可表达且强类型（items 用 `object`+`properties`+`additionalProperties:false`，`index.js:711-729`） | 备选；缺点是英文陈述要写两遍（content 一遍、`en` 一遍）有漂移风险，且 map 形状与边车 `{normalizeKey: 中文}` 更契合 |
| 独立第四工具 `set_display` / `write_display_file` | ✅ | **选作用于 translate 命令**（§4）：translate 必须「只写边车、绝不碰 taste.md」，见 §0.3 |

> 备选 `array [{en,zh}]` 的另一隐藏代价：作者 DSL 的 `object` 类型键集（`index.js:691-696`）**不含 `required`**，故 `{en,zh}` 两个字段无法在 DSL 层标记必填，仍需 execute 层兜底校验。此点仅影响「备选是否真的更优」的论据，不改变选型结论（已选自由对象）。

### 0.3 为什么 translate 必须用独立 `write_display_file` 工具（对「工具面相同」建议的论证）

用户建议 translate「同 runLearner 但 input 明确翻译任务且工具面相同」。实测 `write_taste_file` 的合并语义会**改写 taste.md**：`mergeTasteEntries` 把 incoming 排到最前（`learner-tools.js:57-68`，`[...incoming]` 在前），且 `renderTasteFile` 会重排+重渲染置信度。若 translate 让模型用 `write_taste_file(content=原文, display={原文:中文})` 来补翻存量条目：

1. 触发 taste.md 的**条目重排**与置信度重渲染 → 注入快照（`loadTasteSnapshot`→`renderTasteFile`，`storage.js:478-498`）的 bullet 顺序/格式被扰动 → 违反「中文只进边车 / 注入不变」边界；
2. 若模型对英文陈述有**逐字漂移**（paraphrase），会新写入一条近似重复的英文偏好。

因此 translate 的**工具面必须最小化到「只写边车」**：`read_taste_file` + `write_display_file`。机制（`runLearner` 的 agents.create / 路由 / 熔断 / 判重 / in-flight / 队列）完全复用，只有注册的工具集与 prompt 不同。这是对「工具面相同」的**有依据偏离**，理由即上述第 1/2 条；`write_display_file` 的 schema 骨架见 §4.3。

---

## 1. 边车格式与存储 API

### 1.1 位置与形状

- 边车文件：`<scopeDir>/display.zh.json`，**每个 scope 一个文件**（scope 即 `globalDir = dshHomePath("taste")`，`index.js:348`；`projectDir = <git-root>/.dsh/taste`，`index.js:136`）。
- JSON 形状：`{ "<normalizePreferenceKey(statement)>": "<中文陈述>" }`。键用 `normalizePreferenceKey`（`storage.js:285-292`：NFKC 归一 + 小写 + 去尾部 `Confidence:` + 标点/空白折叠）——与 taste.md 的全局去重键一致，天然 1:1 对应去重后的陈述集合。
- 项目 scope 的 `display.zh.json` 自动被 `.gitignore`(`*`) 覆盖（`ensureProjectTasteDir`，`storage.js:319-325`），不进版本库。

### 1.2 新函数签名（`lib/storage.js`）

```js
export const DISPLAY_FILENAME = "display.zh.json";

// 读：损坏容错，永远 resolve 一个对象（缺失/不可读/非对象/JSON 解析失败 → {}）
export async function loadDisplayMap(scopeDir) // -> Promise<{[normalizeKey]: string}>

// 原子写（整文件覆盖），内部用 display 专用锁
export async function writeDisplayMap(scopeDir, map) // -> Promise<void>

// 读-合并-写（overlay 覆盖同键，保留未提及键），在 display 锁内原子完成
export async function mergeDisplayMap(scopeDir, overlay) // -> Promise<{[normalizeKey]: string}>

// 裁剪：在 display 锁内解析本 scope 的 live 键并删除不在其中的键（锁内「读 liveKeys + 删」同一临界区，杜绝 TOCTOU）
export async function pruneDisplayMap(scopeDir) // -> Promise<{[normalizeKey]: string}>

// 本 scope 全部 whitelisted 文件的 live 去重键集（供 prune / translate 用）
export async function scopeStatementKeys(scopeDir) // -> Promise<Set<string>>
```

`loadDisplayMap` 容错实现要点：`readFile` 失败、`JSON.parse` 抛错、解析结果非 plain record（`typeof !== "object" || Array.isArray`）均 `return {}`；逐条只保留 `typeof v === "string" && v.trim()` 的值（净化与 `config.js:37-40` 的 `isRecord` 一致口径）。`scopeStatementKeys` 复用现有私有 `readScopeEntries`（`storage.js:453-464`）逐文件 `parseTasteFile` 后 `Set(normalizePreferenceKey)`。

> 三个写函数 `writeDisplayMap` / `mergeDisplayMap` / `pruneDisplayMap` 进 display 锁前均需 `mkdir(scopeDir, { recursive: true, mode: 0o700 })`：`withFileLock` 要求锁 sibling 所在目录已存在，而 global scope 目录在无 `config.json` 时可能不存在（同 `executeWrite` 前 `mkdir` 的既有约定，`learner-tools.js:95` 注释）。

### 1.3 原子写 + 锁策略（与 taste.md 写的关系）

- **独立锁**：`mergeDisplayMap` / `pruneDisplayMap` / `writeDisplayMap` 内部使用 `withTasteLock(join(scopeDir, DISPLAY_FILENAME))`（即 `<scopeDir>/display.zh.json.lock`），复用现有 `withFileLock`（`storage.js:241-243`，10s 预算）。
- **为什么独立锁而不是复用餐 md 的锁**：taste.md 锁是**按文件**（`withTasteLock(absolute)` 锁 `<文件>.lock`），而 `display.zh.json` 是**按 scope**。同一 scope 的 `taste.md` 与 `{category}/taste.md` 用两把不同的 taste 锁，却共享一个 `display.zh.json`；若用 taste 锁保护 display 写，跨文件并发会互相覆盖。所以 display 必须有一把**scope 级**锁。
- **顺序约定（无死锁）**：learner 工具内 taste.md 写与 display 写**串行、不嵌套**——先在 taste 锁内完成 taste.md 的 RMW，释放后再在 display 锁内完成 display 的 RMW。锁图无环：display 锁是唯一共享锁，任何调用都只按 `taste锁 → display锁` 的单向顺序——translate 只取 display 锁；forget 先 taste 锁（重写 taste.md）再 display 锁（prune），串行不嵌套。故无死锁。
- **不同步窗口**（写入 taste.md 与写入 display 之间的毫秒~秒级窗口，`getTree` 轮询 10s 内不可见，见 §10 风险表 R3）：此时新条目在 GUI 显示英文、暂无中文；下一次轮询补齐。可接受。

---

## 2. learner 工具扩展（display 参数）

### 2.1 选型（基于 §0）

`write_taste_file` / `edit_taste_file` 各加一个**可选** `display` 参数：

```js
display: {
  type: "object",
  additionalProperties: true,
  description:
    "Optional Chinese display map {exact English statement: Chinese statement}. " +
    "Keys must be the statement text exactly as written in `content`; entries whose key " +
    "does not match a statement in this write are ignored. Chinese goes ONLY here — the " +
    "taste file itself must stay English.",
}
```

要点：`additionalProperties: true` **必须显式**（否则 `defineTool` 编译抛错，`dsh-tools index.js:697`）。value 无类型 → 由 execute 层净化（§2.3），这是与「注入精度优先、宁可漏译不可坏数据」一致的防御式取舍。

### 2.2 参数 schema 骨架（完整，含现有参数）

```js
// write_taste_file 参数（learner-tools.js:200-225 之上加 display）
parameters: {
  scope:  { type: "string", required: true, enum: SCOPE_VALUES, description: "..." },
  path:   { type: "string", required: true, description: 'Relative taste path: "taste.md" or "{category}/taste.md".' },
  content:{ type: "string", required: true, description: 'Full target content as taste entries ("- statement. Confidence: 0.88" lines).' },
  display:{ type: "object", additionalProperties: true, description: "Optional {statement: 中文} map; keys must match statements written in content." },
}

// edit_taste_file 参数（learner-tools.js:228-258 之上加 display）
parameters: {
  scope:    { type: "string", required: true, enum: SCOPE_VALUES, description: "..." },
  path:     { type: "string", required: true, description: "..." },
  old_text: { type: "string", required: true, description: "..." },
  new_text: { type: "string", required: true, description: "..." },
  display:  { type: "object", additionalProperties: true, description: "Optional {statement: 中文} map for the statement produced by this edit." },
}
```

### 2.3 锁内合并语义（精确规则）

`write_taste_file`（`executeWrite`，`learner-tools.js:88-122`）在现有 taste 锁 RMW 之后，追加 display 合并：

1. `incoming = parseTasteFile(args.content)`；`incomingKeys = Set(incoming.map(e => normalizePreferenceKey(e.statement)))`。
2. 净化 `args.display`（若缺失则跳过——schema 层已保证「非缺失时必为 object」：传 `null`/非对象会被 `defineTool` 校验拒绝整调用，故 execute 层无需处理「非对象」分支）：
   - 逐条 `[k, v]`：`typeof v !== "string" || !v.trim()` → **丢弃**并 `deps.log(...)`；
   - `key = normalizePreferenceKey(k)`；`key ∉ incomingKeys` → **丢弃**并 log（「display key 不对应本次写入的 statement」）。
   - 否则保留 `{ key, zh: v.trim() }`。
3. 无保留条目 → 不碰边车；否则 `await mergeDisplayMap(scopeDir, kept)`。

**裁决规则（回答「必须对应本次写入否则丢弃 vs 全收」）**：**必须对应本次写入的 statement，否则丢弃**。理由：display 是某条陈述的中文译文，若键不对应任何本次写入的陈述，它是孤儿/伪造翻译，会污染 GUI（错译、幽灵条目）。全收会在后续 statement 变更时残留错误映射。想让 learner 补翻存量条目，走 `/taste translate`（§4），不通过 write 工具。

`edit_taste_file`（`executeEdit`，`learner-tools.js:128-168`）：

1. 现有 taste 锁内 RMW 完成后，**若 `args.display` 存在**：净化同上，但 `incomingKeys` 取 `normalizePreferenceKey(parseTasteFile(编辑后的新内容))`（即编辑产生的 statement 集合）；保留键匹配者并 `mergeDisplayMap`。
2. **迁移规则（旧 key 删除/保留）**：**删除（裁剪）**。edit 是原始字符串替换，statement 文本一变其 `normalizeKey` 即变；旧中文是旧英文的译文，不能自动挂到新文本上。实现为：edit 改写了文件且**新旧内容 statement 集有差异**时，`await pruneDisplayMap(scopeDir)`（在 display 锁内自行解析 scope 全量 live 键并裁剪，锁内「读 live 键 + 删」同一临界区，避免与后台 learner merge 的 TOCTOU 丢译），把失效键清掉；若 learner 通过 `display` 给了新译文则同时合并（顺序：先 prune 再 merge，都在 display 锁内完成一次 RMW 亦可）。
   - 只改置信度不改 statement 的 edit：新旧 statement 集相同 → prune 空操作 → 旧中文保留；若提供 `display` 则覆盖（支持「改置信度时更新 display」，§3）。

> 补充：`forget` 命令（`commands.js:143-181`）删除 statement 时也应对应裁剪其 display 键——与 edit 同一套 `pruneDisplayMap(scopeDir)`（锁内解析 live 键，不预读）。此为一致性补充，列入 §9 改动但非需求硬性项。

---

## 3. LEARNER_PROMPT 修订（learner.js:30-41）

### 3.1 两位小数示例（替换 learner.js:40）

原文：`  - Prefers tabs over spaces. Confidence: 0.9`
改为：`  - Prefers tabs over spaces. Confidence: 0.88`

并同步改工具 description 里的示例（`learner-tools.js:25` `UNPARSABLE_HINT` 与 `:203`/`:219` 的 `0.9` 文案，及 `parseTasteFile` JSDoc 示例 `storage.js:110-114` 中「0.9」字样，统一为 0.88/两位）。解析无需改：`parseTasteFile` 正则 `(\d*\.?\d+)`（`storage.js:120`）本就兼容一位/两位/整数。

### 3.2 新增 display 指令（追加到 LEARNER_PROMPT 工具说明段之后）

```
When you record a NEW preference, also pass its Chinese rendering in the optional
`display` parameter of write_taste_file / edit_taste_file: an object mapping the exact
English statement text to its Chinese statement, e.g.
  display: {"Prefers tabs over spaces.": "偏好使用制表符缩进。"}
Rules:
- The taste file content itself must stay ENGLISH — never write Chinese into `content`;
  Chinese goes ONLY into `display`.
- `display` keys must be the statement exactly as written in `content`; other keys are ignored.
- When you only raise/lower an existing learning's confidence, you MAY re-provide its
  `display`; omit `display` to keep the existing translation unchanged.
- When you have no Chinese rendering to provide, OMIT `display` entirely — never pass
  `null` or an empty value (the tool rejects null).
```

### 3.3 改置信度时 display 是否更新

**默认不更新（省略即保留旧译文）；显式提供则覆盖**。理由：置信度变化不改变 statement 文本（`normalizeKey` 不变），旧译文仍有效；强制要求会引入无谓 token 与漂移。故规则是「可选覆盖」。

---

## 4. `/taste translate` 命令

### 4.1 参数与命令面

- 语法：`/taste translate [global|project|both]`，缺省 `both`（`parseTranslateArg`，纯函数，放新 `lib/translate.js`，风格同 `parseBackfillArg` `backfill.js:40-47`：空→`both`，非法 token→error）。
- 前置闸门（照抄 `backfillCommand`，`commands.js:229-241`）：`learningEnabled` 关闭→拒；熔断冷却→拒；`translateProgress.active`（复用 §4.2 单例）→拒；`enqueueTranslate` 未注入→拒。
- 幂等：命令先算「未翻译条目」= 本 scope 内 `scopeStatementKeys` 中去掉 `loadDisplayMap` 已有中文键者；**为空 → 返回「已全部翻译，覆盖率 100%」**，不入队。
- 入队返回：`已排入翻译 N 条（scope），learner 后台翻译；结果见 GUI 中文显示。`

### 4.2 入队模式复用 backfill（job 捕获 invocation.agent）

- `index.js` 新增 `translateProgress = { active:false, total:0, done:0 }`（镜像 `backfillProgress`，`index.js:526`）与 `enqueueTranslate({ agent, scope })`（镜像 `enqueueBackfill`，`index.js:601-615`）。
- **单 job 入队**（与 backfill 多块瀑布不同）：未翻译条目打包成一个 translate job 推入共享 `queue.push`（`cap:3` 串行，`queue.js:44-112`），`job = { agent, kind:"translate", translateEntries:[{scope, relPath, statement, confidence}], cwd, onSettled }`；`onSettled` 用 `try/finally` 清 `translateProgress.active = false`（**成功与失败两条路径都清**），失败路径照常喂共享熔断计一次，避免失败后门禁永久卡死。条目超 `observer.maxInputChars` 时按 `min(条目数, 预算)` 截断，超出部分本次不排（返回已排 N 条，其余提示再次运行——translate 幂等，重跑补完）。
- `runTasteJob`（`index.js:435-470`）分派：`job.kind === "translate"` 时，`input = buildTranslateInput(job.translateEntries)`，且 `runLearner(..., promptText: TRANSLATE_PROMPT, toolsFactory: createTranslateTools)`；否则走现有 `buildLearnerInput` + `LEARNER_PROMPT` + `createTasteTools`。

### 4.3 translate job 与学习 job 的区分（论证 + 工具面）

- **区分方式 = prompt 变体 + 专用输入 + 专用工具面**（`job.kind:"translate"` 打标）。
- 论证为何**必须 prompt 变体**（不是「同 prompt 不同 input」）：`LEARNER_PROMPT` 的「record DURABLE preferences / do NOT re-record existing」措辞与「翻译存量条目」任务语义相悖，直接复用会把翻译任务误导向「学习」，故需独立 `TRANSLATE_PROMPT`。
- 论证为何**工具面不同**（`createTranslateTools` = `read_taste_file` + `write_display_file`，而非 write/edit）：见 §0.3 —— 复用 write/edit 会改写 taste.md（重排 + 置信度重渲染 → 注入扰动）并暴露逐字漂移风险。
- `runLearner` 改动：新增 `promptText = LEARNER_PROMPT` 与 `toolsFactory = createTasteTools` 两个参数（`learner.js:113-237`），在 `:205`（工具注册循环）与 `:208`（`systemPrompt.section({ text })`）处用参数替换硬编码。默认值保持不变 → 学习 job 零行为变化。

`write_display_file` 工具 schema 骨架（`lib/learner-tools.js` 新增，与 `stringOutput` 复用 `learner-tools.js:170-174`）：

```js
defineTool({
  name: "write_display_file",
  description: "Write Chinese display translations for EXISTING taste entries into the scope's display sidecar (display.zh.json). Never touches taste.md.",
  parameters: {
    scope:   { type: "string", required: true, enum: SCOPE_VALUES, description: 'Taste scope: "global" or "project".' },
    display: { type: "object", additionalProperties: true, description: "Map {exact English statement: Chinese translation}. Keys must match an existing statement in this scope; others are ignored." },
  },
  output: stringOutput,
  execute: (args) => executeWriteDisplay(deps, args),
});
```

`executeWriteDisplay`：resolve scope 目录 → 净化 display（string-only）→ `liveKeys = await scopeStatementKeys(scopeDir)` → 保留 `normalizePreferenceKey(k) ∈ liveKeys` 者 → `mergeDisplayMap(scopeDir, kept)` → 返回 `wrote N display entries` 文本。

### 4.4 输入构造（buildTranslateInput，`lib/translate.js`）

`TRANSLATE_PROMPT` + 条目清单（逐字原文、不 paraphrase）：

```
You are the taste-translation agent for DSH. Translate ONLY the listed English preference
statements into Chinese for GUI display. Do NOT add, change, or "learn" any preference.
Never translate the taste file content itself; Chinese goes only into write_display_file.
For each entry call write_display_file with scope and display: {"<exact statement>": "<中文>"}.
Skip entries you cannot translate confidently; leave them out.

Untranslated entries:
- [global|project] <relPath>: <statement> (Confidence: 0.88)
  ...
```

### 4.5 status 显示翻译覆盖率

`/taste status`（`showStatus`，`commands.js:59-80`）新增一行：`translation: <translated>/<total> (global/project 可写 scope 合计)`。数据源：`loadDisplayMap` + `scopeStatementKeys`。GUI 侧覆盖率见 §5/§6。

---

## 5. bridge getTree 扩展（lib/bridge.js）

`scopeFiles`（`bridge.js:66-83`）在解析每个文件后，为每条 entry 附加 `display`：

```js
const displayMap = await loadDisplayMap(dir);          // 每个 scope 读一次（提升到 scopeFiles 外层）
// entry 组装：
entries.push(...parsed.map(e => ({
  ...e,
  display: displayMap[normalizePreferenceKey(e.statement)] ?? null,  // 中文 | null
})));
```

`getTree`（`bridge.js:86-119`）每个 scope 对象加 `coverage: { translated, total }`：

```js
// project/global 两个可写 scope：
coverage: { translated: 有中文的条目数, total: 条目数 }
// commandCode scope（只读、无边车）：每条 entry 显式 display: null（字段形状一致），
coverage: { translated: 0, total: commandCodeEntries.length }
```

- commandCode 分支（`bridge.js:104-116`）不经 `scopeFiles`，需在 getTree 内对 `commandCodeEntries` 每条补 `display: null`（避免 `undefined`；显式 null 与「只读、永不可翻译」语义一致）；client 侧对 `scope.name === "commandCode"` 不打「未翻译」标记（§6.1）。
- 依赖注入：`registerTasteBridge` 的 deps 增加 `loadDisplayMap` 与 `normalizePreferenceKey`（`bridge.js:48-49` 解构处），`index.js:632-641` 传入。
- 无新写面、无路径透传：仍只经 `listTasteFiles/readTasteFile/loadDisplayMap` 白名单读取，保持 `bridge.js:12-23` 安全包络。

---

## 6. client.js 渲染（lib/client.js）

### 6.1 中文优先 + 未翻译标记（TasteEntry，client.js:195-211）

```js
function TasteEntry({ t, entry }) {
  const value = Number(entry?.confidence);
  const hasZh = typeof entry?.display === "string" && entry.display.trim().length > 0;
  const text = hasZh ? entry.display : entry?.statement;      // 中文优先，英文回退
  const conf = Number.isFinite(value) ? value.toFixed(2) : "0.00";  // 原值两位小数
  const pct = Math.round((Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0) * 100);
  return jsxs("div", { className: "ts_entry", children: [
    jsx("div", { className: "ts_entryText", children: [
      text,
      !hasZh ? jsx("span", { className: "ts_untranslated", children: t("untranslated") }) : null,
    ] }),
    jsxs("div", { className: "ts_entryMeta", children: [
      jsx("span", { className: "ts_entryConfLabel", children: `${t("confidence")} ${conf}` }),  // 替换 ${pct}%
      jsx("div", { className: "ts_barTrack", children: jsx("div", {
        className: `ts_barFill ${barClass(entry?.confidence)}`,
        style: { width: `${pct}%` },          // 进度条保留百分比
      }) }),
    ] }),
  ] });
}
```

要点：**文字标签改两位原值（0.88 式），进度条宽度仍用 `pct%`**（`client.js:203` 的 `${pct}%` 文案被替换；`barClass` 阈值逻辑 `client.js:186-192` 不变）。`ts_untranslated` 新增一条 CSS（data-plugin style 内，`client.js:18` 的 css 串尾追加）。`TasteEntry` 需感知 scope：新增 `scopeName` prop（由 `TasteScopeBody` 传入），当 `scopeName === "commandCode"` 时不渲染 `ts_untranslated`（其 `display` 恒为 null、只读不可翻译，见 §5）。

### 6.2 覆盖率行（TasteScopeBody / TastePanel）

- `TasteScopeBody`（`client.js:240-248`）在文件树顶部加一行覆盖率：`t("coverage", { translated: scope.coverage?.translated ?? 0, total: scope.coverage?.total ?? 0 })`。
- `TastePanel`（`client.js:356` 附近）`totalEntries` 旁可再聚合一条全局覆盖率 chip（可选）。

### 6.3 zh 字典新 key（zh: client.js:30-56 / en: client.js:57-83）

新增：`"untranslated": "未翻译"` / `"untranslated": "untranslated"`；`"coverage": "翻译覆盖：{translated}/{total}"` / `"coverage": "Translated: {translated}/{total}"`。zh 为键集源（`client.js:28` 注释约定），en 同步补齐。

---

## 7. commands list 两位小数（lib/commands.js:100）

`listPreferences` 的渲染行 `entry.confidence.toFixed(1)` → `toFixed(2)`（`commands.js:100`）。同理 `rememberPreference` 返回文案 `Confidence: 1.0`（`commands.js:134`）→ `1.00`（一致性，非硬性）。

（`/taste list` 是否追加中文译文：需求未要求，**本轮不做**，保持英文陈述 + 两位置信度。）

---

## 8. 测试清单（`test/*.test.js`，`node --test "test/*.test.js"`）

1. **storage（storage.test.js 扩展）**
   - `loadDisplayMap`：缺失→`{}`；非法 JSON→`{}`；非对象（数组/字符串）→`{}`；混合 value（字符串保留、非字符串丢弃）。
   - `writeDisplayMap` / `mergeDisplayMap`：原子写、覆盖同键、保留未提及键；`pruneDisplayMap` 删失效键、留 live 键；`scopeStatementKeys` 跨 root+category 去重。
   - `renderTasteFile` 一位或两位：`0.88→"0.88"`、`0.95→"0.95"`、`0.9→"0.9"`（不变）、`1→"1.0"`（不变）；`parseTasteFile` 兼容 `0.9 / 0.88 / 1`。
2. **learner-tools（learner-tools.test.js 扩展）**
   - write 带 `display`：键匹配 incoming → 写入边车；键不匹配 → 丢弃；非字符串 value → 丢弃；无 display → 边车不变。
   - edit 改 statement：旧键被 prune；改置信度（statement 不变）→ 旧中文保留；edit 带 display → 新译文覆盖。
   - 锁：并发 write 不同文件共享 display.zh.json 不丢条目（display 锁串行）；并发「merge 新键」与「prune 用陈旧 liveKeys 快照」交叠，断言新键译文**不被误删**（配合 §1.2 锁内 liveKeys 修复）。
3. **learner prompt（learner.test.js 扩展）**
   - 断言 `LEARNER_PROMPT` 含 `Confidence: 0.88`（两位示例）；含 `display` 与「content 保持英文」指令。
4. **translate（新 translate.test.js + commands/index 扩展）**
   - `parseTranslateArg`：空→both、非法→error。
   - 未翻译清单构造：已有中文的跳过（幂等）。
   - `enqueueTranslate`：0 条→null/拒绝；有→入队且 job.kind="translate"；`translateProgress` 门禁。
   - `buildTranslateInput` 含逐字 statement 与 scope/relPath。
5. **bridge（bridge.test.js 扩展）**
   - getTree 的 entry 带 `display`（中文|null）；scope 带 `coverage:{translated,total}`；commandCode coverage=0/total。
6. **client（client.test.js，不强求）**：若现有 render 层可注入 fake entry，则测「中文优先/英文回退+未翻译标记/置信度 toFixed(2)」；否则留回归基线。

**回归护栏**：所有既有 162 断言不回归。`renderTasteFile` 改「一位或两位」后存量 `0.9→"0.9"`、`1→"1.0"` 字节不变，`loadTasteSnapshot` 既有 `Confidence: 0.9/1.0` 断言**保留不动**（不改为 0.90/1.00）；仅新增 `0.88→"0.88"`、`0.95→"0.95"` 用例。

---

## 9. 改动清单（逐文件 + 行数预估）与明确不做

| 文件 | 改动 | 预估行 |
|---|---|---|
| `lib/storage.js` | `DISPLAY_FILENAME`、`loadDisplayMap/writeDisplayMap/mergeDisplayMap/pruneDisplayMap/scopeStatementKeys`；`renderTasteFile` `toFixed(1)`→「一位或两位」格式化器（:140，存量 0.9/1.0 字节不变）；display 写函数进锁前 `mkdir(scopeDir,{recursive:true,mode:0o700})` | +60 |
| `lib/learner-tools.js` | write/edit 加 `display` 参数与净化合并；新增 `write_display_file` + `createTranslateTools`；示例文案 `0.9→0.88` | +90 |
| `lib/learner.js` | `LEARNER_PROMPT` 两位示例+display 指令；`runLearner` 加 `promptText`/`toolsFactory` 参数 | +20 |
| `lib/translate.js`（新） | `TRANSLATE_PROMPT`、`parseTranslateArg`、`buildTranslateInput`、未翻译清单构造（纯函数，可独立测） | +100 |
| `lib/commands.js` | `translate` 子命令+dispatch+USAGE（:219/:265）；`list` 两位（:100）；`status` 覆盖率行；`remember` 文案（:134） | +50 |
| `lib/index.js` | `translateProgress`、`enqueueTranslate`、`runTasteJob` 分派、注册 deps（commands/bridge 传 `loadDisplayMap` 等） | +70 |
| `lib/bridge.js` | `scopeFiles` 加 display 查询、`getTree` 加 `coverage`；deps 加 `loadDisplayMap/normalizePreferenceKey` | +25 |
| `lib/client.js` | TasteEntry 中文优先+未翻译标记+两位置信度；覆盖率行；zh/en 字典新 key；`ts_untranslated` CSS | +40 |
| `test/*.test.js` | §8 清单；更新既有两位小数相关断言 | +180 |

合计约 **+635 行**（含测试）。

**明确不做（本轮）**：
- GUI 触发翻译按钮（仅展示覆盖率 + `/taste translate` 提示，不做无 parentAgent 的 GUI 触发复杂度）。
- 自动翻译（不做学习 hook 自动补翻；翻译只由 `/taste translate` 显式触发）。
- taste.md 中文化、注入快照中文化（`loadTasteSnapshot` 只读 taste.md，绝不读 display.zh.json）。
- `loadTasteSnapshot` 输出字节不变（`renderTasteFile` 对存量 0.9/1.0 保持一位渲染；新学 0.88 才两位，见 §10 R4）。
- 零新依赖、零官方包改动。

---

## 10. 风险表

| # | 风险 | 论证/缓解 |
|---|---|---|
| R1 | **DSL 不支持 typed record**（`additionalProperties` 只能 boolean，`dsh-tools index.js:697/:158`） | 已实证；选 `{type:"object",additionalProperties:true}` + execute 层净化（string-only + 键匹配过滤）。自由 value 的无类型由防御式丢弃兜底，不会坏边车。备选 `array[{en,zh}]` 已论证并保留为二档方案。 |
| R2 | **display 与 taste.md 写不同步窗口** | learner 工具内 taste 锁 → display 锁**串行不嵌套**，两段 RMW 各原子；窗口内新条目短暂无中文，`getTree` 10s 轮询后自愈（`client.js:86 POLL_MS=10_000`）。无死锁（§1.3 顺序约定）。 |
| R3 | **translate 误改 taste.md** | 独立 `write_display_file` 只写边车（§0.3/§4.3），translate 工具面不含 write/edit，从机制上杜绝重排/置信度重渲染/逐字漂移污染 taste.md 与注入快照。 |
| R4 | **`renderTasteFile` 渲染对 `loadTasteSnapshot` 的影响** | `loadTasteSnapshot`（`storage.js:478-498`）经 `renderTasteFile`（`storage.js:497`）渲染。`renderTasteFile` 改用「一位或两位」格式化器：round 到两位后，精确十分位 `toFixed(1)`、否则 `toFixed(2)`，故 `0.9→"0.9"`、`1→"1.0"`、`0.88→"0.88"`、`0.95→"0.95"`。存量 0.9/1.0 注入快照字节不变、merge 路径不回写文件；新学 0.88 不被舍入为 0.9。GUI/命令 list 的两位补零由 `client.js`/`commands.js` 的 `toFixed(2)`（显示层）承担，符合边界 2「渲染层补零、不回写文件」。 |
| R5 | **translate job 与学习 job 并发判重 / in-flight** | 二者都走 `executeJob`（`index.js:473-485`），每次 `randomUUID()` 生成独立 sessionId 加入 `inFlightLearners`，共享 `cap:3` 串行队列（`queue.js:44-112`）保证不重叠；`job.kind` 区分分派。熔断（3 连败）与 `translateProgress.active` 双重门禁防并发翻译。 |
| R6 | **存量 8 条英文条目无中文** | `/taste translate` 显式补翻通道（§4），幂等（已有中文跳过），覆盖率在 `status` 与 GUI 展示。GUI 仅提示覆盖率，不自动触发（§9 明确不做）。 |
| R7 | **normalizeKey 非单射**（不同陈述碰撞同键） | 系统以 `normalizePreferenceKey` 为去重身份（`mergeTasteEntries`、`loadTasteSnapshot:483`、`forget`、`remember` 均按它去重），scope 内同键只存活一条；display 键同构，故 1:1，无错译映射。 |
| R8 | **两位小数解析兼容性** | `parseTasteFile` 正则 `(\d*\.?\d+)`（`storage.js:120`）天然兼容 `0.9/0.88/1`；`normalizedConfidence`（`storage.js:51-54`）clamp 到 `[0,1]` 不变。旧一位数据 GUI 显示 `0.90` 由 `toFixed(2)` 渲染层补零，不回写文件。 |

---

## 附：本次落地签名再证（文件:行号证据汇总）

- `dsh-tools` DSL：`SCHEMA_TYPES` `index.js:48-56`；object 编译 `:690-710`（`additionalProperties` 必须 boolean `:697`）；array+items `:711-729`；`checkObjectSchemaTail` `additionalProperties` boolean `:158`（经 `checkSchemaNode` 的 object-tail 任务调用）；`checkValue` object 分支（additionalProperties:true 值不校验）`:446-475`；`defineTool` `:836-882`；`parameterSchemaSpecToJsonSchema` `:800-809`。
- `storage.js`：`parseTasteFile` `:117-127`（正则 `:120`）；`renderTasteFile` `:135-142`（当前 `toFixed(1)` `:140`，改为「一位或两位」格式化器）；`normalizePreferenceKey` `:285-292`；`writeFileAtomicTaste` `:228-230`；`withTasteLock` `:241-243`；`readScopeEntries` `:453-464`；`loadTasteSnapshot` `:478-498`；`ensureProjectTasteDir` `:319-325`。
- `learner-tools.js`：`mergeTasteEntries` `:57-68`；`executeWrite` `:88-122`（verbatim `:107`、merge `:116`）；`executeEdit` `:128-168`；`writeTasteFileTool` `:200-225`；`editTasteFileTool` `:228-258`；`createTasteTools` `:270-277`；`SCOPE_VALUES` `:22`；`stringOutput` `:170-174`。
- `learner.js`：`LEARNER_PROMPT` `:30-41`（示例 `:40`）；`runLearner` `:113-237`（工具注册 `:205`、prompt section `:208`）；`buildLearnerInput` `:75-86`。
- `commands.js`：`list` `toFixed(1)` `:100`；`remember` 文案 `:134`；`showStatus` `:59-80`；`backfillCommand` `:229-241`；dispatch `:250-271`；USAGE `:219`；`registerTasteCommands` `:288-296`。
- `bridge.js`：`scopeFiles` `:66-83`；`getTree` `:86-119`；`getStatus` `:122-136`；deps 解构 `:48-49`。
- `index.js`：`globalDir` `:348`；projectDir 解析 `:131-141`（`:136`）；`runTasteJob` `:435-470`；`executeJob` `:473-485`；queue `:487`；`backfillProgress` `:526`；`startBackfill` `:540-586`；`enqueueBackfill` `:601-615`；注册 commands `:617-628`、bridge `:632-641`。
- `client.js`：TasteEntry `:195-211`（`pct` `:197`、`${pct}%` `:203`）；zh 字典 `:30-56`；en 字典 `:57-83`；`POLL_MS` `:86`；`barClass` `:186-192`；`groupFiles` `:168-184`；`TasteScopeBody` `:240-248`。
- `queue.js`：串行链 `:67-95`；`push` `:103-112`；`stats` `:144-146`。

---

## 修订记录（依据 REVIEW-zh-display.md 修订，只改被点名问题）

| 修订项 | 对应 review | 修订内容 |
|---|---|---|
| `renderTasteFile` 格式化器 | ISSUE-A（blocker） | 由 `toFixed(1)→toFixed(2)` 改为「一位或两位」格式化器：round 到两位后，精确十分位 `toFixed(1)`、否则 `toFixed(2)`（`0.9→"0.9"`、`1→"1.0"`、`0.88→"0.88"`、`0.95→"0.95"`）。§8 测试期望、§8 回归护栏、§9 表格、§9「明确不做」、§10 R4、§附 同步修订；删除 R4「待用户裁决」稻草人措辞；`loadTasteSnapshot` 既有 `0.9/1.0` 断言保留不动。 |
| `pruneDisplayMap` 签名 | ISSUE-B（medium） | 改为 `pruneDisplayMap(scopeDir)`，在 display 锁内自行解析 live 键，「读 liveKeys + 删」同临界区杜绝 TOCTOU。§1.2 签名、§2.3 edit/forget 调用处同步改为不预读；§8 新增并发竞态测试。 |
| §1.3 锁序措辞 | ISSUE-C（low） | 「translate/forget 只取 display 锁」改为「translate 只取 display 锁；forget 先 taste 锁再 display 锁（串行不嵌套）」。 |
| `translateProgress.active` 清零点 | ISSUE-D（low） | §4.2 明确 `onSettled` 用 `try/finally` 在成功/失败两条路径都清 `active`，失败照常喂熔断。 |
| commandCode `display` 字段 | ISSUE-E（low） | §5 给 commandCode 分支每条 entry 显式 `display: null`；§6.1 `TasteEntry` 增 `scopeName`，`commandCode` 不渲染「未翻译」标记。 |
| `display: null` 措辞 | ISSUE-F（low） | §2.3 收紧为「缺失则跳过（schema 已拒 null/非对象）」，删「非对象则跳过」；§3.2 prompt 增「省略则不传 display，不要传 null」。 |
| display 写函数 mkdir | ISSUE-H（low） | §1.2 增注：`writeDisplayMap`/`mergeDisplayMap`/`pruneDisplayMap` 进锁前 `mkdir(scopeDir, {recursive:true, mode:0o700})`；§9 表格同步。 |
| DSL 措辞瑕疵 | 审计 §1 两处 | §0.1「直接放行」改为「annotation-only 放行（无 type/oneOf 且无 sibling 关键字）」；§附 `checkSchemaNode:158` 改为 `checkObjectSchemaTail:158`。 |
| `array[{en,zh}]` 隐藏代价 | 审计 §1 备注 | §0.2 补注：DSL object 键集无 `required`，`{en,zh}` 无法在 DSL 层标记必填。 |
