# dsh-taste 注入与 GUI 置信度门控 — 审计与执行方案

- 审计日期：2026-09-08
- 审计对象：`/home/CNS2026495165/dsh/dsh-taste` 工作树（未提交改动后的现状，非 git HEAD）
- 需求：置信度 < 0.70 的 taste 条目 (a) 不再注入 system prompt 上下文，(b) GUI 同步隐藏；阈值落为 `injection.minConfidence` 配置（默认 0.7），`getStatus` 暴露给 GUI
- 基线：`cd /home/CNS2026495165/dsh/dsh-taste && node --test "test/*.test.js"` → **212/212 pass**（本审计实测）
- 硬约束（全程有效）：不改学习/汰换/删除/模型路由逻辑；两位小数置信度契约不变；Command Code 仍只读；不新增易漂移文档；测试最小化、不删既有安全测试；生产 lib/ 无死代码

---

## 0. 审计结论

**verdict = revise（需修改）**。现状与需求差距明确、路径清晰、无设计死结：注入链路（`readSnapshotSync`）与 GUI 数据链路（bridge `getTree`）均无任何置信度过滤；配置面（config.js + index.js 声明式 schema）无 `minConfidence`；快照缓存键不含阈值，阈值热变更不会失效缓存。方案见 §4 交付单元，逐条可执行、含验收标准。无阻塞项。

---

## 1. 现状核实（亲读源码确认，file:line 均为当前工作树）

用户给定的现状全部核实属实，补充细节如下：

### 1.1 注入链路（lib/index.js）

- `injectTasteContext`（418-437 行）：`currentConfig()` → 守卫（learningEnabled/injection.enabled/subagent/in-flight）→ `readSnapshot(projectDirForCwd(cwd))`（428 行）→ `clipText(maxChars)` → sanitize `{{` → `<taste>` 包裹。**无置信度过滤**。
- `readSnapshotSync(globalDir, projectDir)`（239-261 行）：`accumulateScope`（project→global，221-236 行）+ Command Code 双 base 循环（244-259 行），`normalizePreferenceKey` 去重（project 优先），`renderTasteFile(merged)` 渲染。**单点出口 = `renderTasteFile(merged)`，是加门控的理想切点**。
- `createSnapshotReader(globalDir)`（268-280 行）：`cache` 为 Map，**键 = `projectDir ?? ""`**；值 `{stamp, text}`，stamp 为依赖文件 mtime+size 指纹（`snapshotStamp`，207-218 行）。**阈值不在键也不在 stamp 中** → 配置热变更后若文件未动，缓存永远返回旧阈值下的文本。
- `readSnapshot` 唯一消费者是 `injectTasteContext`；`createSnapshotReader` 为模块私有（未导出）。
- 声明式 Config schema（59-79 行）：`injection: { enabled, maxChars, includeSubagents }`，无 minConfidence。`currentConfig()` 的同步缓存以声明式配置为种子，config.json 存在时按 mtime stamp 异步热刷新（`configStampSync`/`refreshConfig`，372-401 行）。

### 1.2 配置层（lib/config.js）

- `DEFAULT_CONFIG`（23-35 行）与 `mergeConfig`（65-95 行）的 injection 节均无 minConfidence。
- **关键陷阱（本审计补充发现）**：`boundedNumber`（59-62 行）带 `Math.round(...)` —— 若 minConfidence 复用它，`0.7` 会被取整成 `1`（全部门控只剩 confidence=1 的条目）。**minConfidence 必须用新的不取整钳位助手**（见 DU-1），并以测试钉死。
- `loadConfig`（108-114 行）缺失/损坏文件回退默认；`saveConfig`（123-125 行）经 `mergeConfig` 白名单归一后落盘 —— `setObserver` 的全量 load→modify→save 会顺带把（默认填充的）minConfidence 物化进 config.json，属无害副作用。

### 1.3 存储层（lib/storage.js）

- `normalizedConfidence`（51-54 行）：钳位 [0,1]，非有限值回退 0.5（pi-taste 语义）。
- `parseTasteFile`（119-129 行）：正则捕获 `(\d*\.?\d+)` **保证 parseFloat 结果必为有限数**（缺 Confidence 标记的行整行丢弃，如 "Confidence: high" 不匹配 → 条目不存在，而非 clamp 0.5）。因此 **0.5 回退在解析路径上几乎不可达**（仅 400 位数字 → Infinity 这类病态输入）；0.5 实际落入文件的路径是渲染/学习写边界（`formatTasteConfidence` 对非有限输入、以及模型写入的置信度经钳位后落盘为 `Confidence: 0.50`）。
- `renderTasteFile`/`formatTasteConfidence`（139-159 行）：两位小数契约所在，**不动**。
- `loadTasteSnapshot`（542-562 行，异步版）：**唯一消费者是 commands.js `showStatus`（65-66 行）的「偏好：N 条」计数**；与注入用的 `readSnapshotSync` 是平行实现。学习侧 `renderTasteTree`（index.js 299-305 行）亦无过滤（学习输入不受门控影响，符合硬约束）。
- Command Code 只读扫描：`loadCommandCodeTaste`（440-462 行）+ index.js `commandCodeBases`/`commandCodeFilePathsSync`（168-191 行）。两处均只读。

### 1.4 GUI 桥（lib/bridge.js）

- `scopeFiles`（112-123 行）：逐文件 `parseTasteFile` → `{relPath, mtime, count: entries.length, entries}` —— **count 本就等于返回条目数**，只要在服务端过滤 entries，count 自动自洽。
- `getTree`（126-166 行）：不读 config；project/global/commandCode 三 scope，commandCode 为伪文件 `{relPath:"(command-code)", mtime:0, count, entries}`（151-163 行）。顶层 payload = `{generatedAt, scopes}`，**无穷举式顶层键断言的测试**（可安全新增顶层字段）。
- `getStatus`（169-183 行）：热读 config，返回 `injection: {enabled, maxChars, includeSubagents}` —— minConfidence 的自然落点。
- `deleteEntry`（193-227 行）：**文件级删除，不经 getTree、不受门控影响** —— GUI 隐藏的条目仍可被 `/taste forget` 删除（命令枚举全量），命令 Code 拒绝（`read-only-source`）保持不变。
- bridge 的所有 storage 函数经 deps 注入（bridge.js 无 storage 直接 import）——新增共享判定函数须走同一注入模式（index.js `registerTasteBridge` deps + bridge.test.js `buildDeps`）。

### 1.5 GUI 客户端（lib/client.js，手写无构建 bundle）

- `barClass`（233-239 行）：仅着色（≥0.7 高/0.4-0.7 中/<0.4 低），与门控语义独立。
- `TasteFileRow`（307-322 行）：314 行渲染 `file.count`，316 行直接渲染 `file.entries`。
- `TasteCategoryGroup`（327 行）：`total = Σ file.count`；`TastePanel`（685 行）：`totalEntries = Σ scopes Σ file.count`，仅用于 empty-all 判定（723 行）。
- 状态 chip（698-701 行）：`t("status.injection", {enabled, maxChars})`，字典 zh 33-81 行 / en 82-130 行，`{placeholder}` 由宿主 locale 服务插值；zh/en 键集奇偶校验测试存在（client.test.js 126-127 行）。
- 空 CSS 类可复用：`.ts_hint` 已存在（设置视图在用），新增提示行无需新 CSS。

### 1.6 实际数据与配置（2026-09-08 快照）

- 全局 `~/.dsh/taste/taste.md`：**31 条**，其中 **2 条 0.65（低于阈值，将被门控**：「规划新功能…联网调研」、「视频/媒体样片…~/视频/」**）**，**5 条恰为 0.70（边界含入，保留）**，其余 ≥0.75。
- 项目 `/home/CNS2026495165/dsh/.dsh/taste/taste.md`：3 条（0.75/0.70/0.70），0 条被门控。
- Command Code：`~/.commandcode/taste` 与 `<workspace>/.commandcode/taste` **均不存在**（空源，当前零实际影响）。
- `~/.dsh/taste/config.json` 无 minConfidence 键 → 实现后默认 0.7 自动生效（mergeConfig 回填），**无需手工改线上 config**。
- `config.example.json`（19 行）injection 节需同步补键。
- 部署激活：dsh-taste 经 `~/.dsh/profiles/web/cordis.patch.yml` insert（id: taste）加载；改动生效需重启 dsh 宿主（lib 与 client bundle 同包发布）。

---

## 2. 四项裁决

### 裁决 1：门控作用于 Command Code 只读源 → **是，注入与 GUI 双双门控**

理由：
1. 需求约束的是「taste 条目」整体：「置信度 < 0.70 的条目不再注入 system prompt 上下文」。Command Code 条目经 `readSnapshotSync` 的 commandCode 循环与 `loadCommandCodeTaste` 汇入**同一份**注入快照；豁免它 = 低置信度条目仍有一条泄入 system prompt 的通路，需求 (a) 落空。
2. **只读 = 不写**。门控是读取侧过滤，Command Code 文件一个字节都不动；`deleteEntry` 的 `read-only-source` 拒绝（双保险的后端半）原样保留。不违反「Command Code 仍只读」。
3. GUI 同步语义要求「GUI 展示 = 注入集」：GUI 若豁免 Command Code，会展示不被注入的条目，破坏 (b) 的同步契约。
4. 现实数据：两个 commandcode 目录均不存在，本裁决当前零数据影响，纯粹是契约正确性决策。

### 裁决 2：clamp 0.5（缺失/非法置信度）条目在 0.7 门控下 → **一律门控（隐藏/不注入），无特例**

理由：
1. 0.5 是 pi-taste 语义的「中性/未知」。置信度门控的目的正是只注入证据充分的偏好；中性置信度过不了 0.70 的门槛，这就是门控本身的设计意图，不是副作用。
2. 归一化之后，回退产生的 0.5 与文件里明写的 `Confidence: 0.50` **不可区分**（无来源元数据，且引入元数据会破坏两位小数行格式契约）——任何特例化在技术上不可行。
3. **门控是展示/注入过滤器，不是删除机制**：0.5 条目留在 taste.md、learner 仍可见（`read_taste_file` 不门控，学习逻辑零改动）、`/taste list` 仍全量列出、`/taste forget` 仍可删、后续 learner 有新证据时可把置信度升过阈值重新可见。可逆，无数据损失。
4. 边界语义钉死：**保留条件是 `confidence >= minConfidence`（含边界）**——0.70 恰好等于阈值 → 保留。现网全局有 5 条 0.70、项目 2 条 0.70，全部保留；仅 2 条 0.65 被门控。JS 中 `JSON.parse("0.7")` 与 `parseFloat("0.70")` 产生同一 IEEE double，`0.7 >= 0.7` 恒真，无浮点陷阱；两位小数条目值与阈值比较确定性强。
5. 事实澄清（供执行档知悉，不改动行为）：parseTasteFile 的正则使 0.5 回退在解析路径几乎不可达（见 §1.3）；0.5 条目实际来自学习写边界。裁决覆盖两种来源，统一数值比较。

### 裁决 3：GUI 隐藏后 file.count 与总条数自洽 → **服务端（bridge）过滤，count 天然自洽 + 顶层 gatedCount 兜底空态诚实性**

- **过滤位置**：`getTree` 在 bridge 侧用与注入**同一个共享判定函数**（DU-3 `gateTasteEntries`）过滤 entries。`scopeFiles` 的 `count: entries.length` 与 commandCode 伪文件的 `count: commandCodeEntries.length` 在过滤后**自动等于可见条数**；客户端现有的文件计数（314 行）、分类合计（327 行）、`totalEntries`（685 行）全部基于 `file.count` 求和 → **零客户端计数改动即自洽**，且不存在「宿主与 bundle 两套判定漂移」的风险（bundle 里不复制比较逻辑）。
- **空态诚实性**：getTree 顶层新增 `gatedCount`（各源 解析总数−可见数 之和）。客户端 `totalEntries === 0` 的 empty-all 分支据此区分「确实没有偏好」与「全部被门控」，分别渲染 `empty.all` / 新 `empty.gated`（带阈值）；`totalEntries > 0 && gatedCount > 0` 时在 tab 栏下渲染一行 `ts_hint`（复用现有 CSS）：「已按置信度阈值 0.70 隐藏 N 条低置信度条目」。隐藏因此是**可解释的**而非凭空消失（现网即有 2 条会消失）。
- **不采用客户端过滤**（getTree 全量返回、bundle 自行隐藏）：需要复制判定与重算三处计数，且宿主/bundle 双实现有漂移风险；项目先例（zh-display 的 display join）也是数据塑形放 bridge、bundle 只渲染。
- **明确边界**：GUI 隐藏的条目在 GUI 中不可见 → 不可经 GUI 删除（按钮不存在）；全量管理走 `/taste list` + `/taste forget`（命令侧不门控，见非目标）。GUI = 生效视图（与注入同步），命令 = 全量库管理，两者契约并存。

### 裁决 4：`injection.minConfidence` 默认 0.7 的落点、getStatus 暴露与 client 消费

- **配置落点（两处 + 一处回退常量，均有 keep-in-sync 注释，沿 `CONFIG_FILENAME` 双写先例）**：
  1. `lib/config.js`：`DEFAULT_CONFIG.injection.minConfidence = 0.7` + `mergeConfig` 用**新的不取整钳位助手** `unitIntervalNumber`（非 number/非有限 → 回退默认；否则钳入 [0,1]，**不取整**——`boundedNumber` 的 `Math.round` 会把 0.7 变 1，禁用）。
  2. `lib/index.js` 声明式 Config schema：`minConfidence: z.number().default(0.7)`（沿 maxChars 惯例，不加 min/max 范围装饰；防线在助手钳位）。
  3. `lib/storage.js` `gateTasteEntries` 的防御性回退常量 `DEFAULT_MIN_CONFIDENCE = 0.7`（防声明式路径直传病态值）。
  - 线上 `~/.dsh/taste/config.json` **不改**（缺键 → mergeConfig 回填 0.7，热读自动生效）；`config.example.json` 补 `"minConfidence": 0.7`。
- **getStatus 暴露**：`injection` 对象追加 `minConfidence: cfg.injection.minConfidence`（与 enabled/maxChars/includeSubagents 同源同热读）。
- **client 消费**（bundle 不承担隐藏判定，消费点是展示与解释）：
  1. 注入状态 chip 追加阈值：zh `注入：{enabled}（≤{maxChars} 字符，置信度≥{minConfidence}）` / en `Injection: {enabled} (≤{maxChars} chars, confidence ≥{minConfidence})`，阈值经 `toFixed(2)` 渲染为 `0.70`（与两位小数契约一致）；
  2. 裁决 3 的 `empty.gated` 空态与 `gated.hint` 提示行，同一格式化助手取值（status 缺失时回退 0.70）。
- **边界**：GUI 门控**不依赖** `injection.enabled`——injection 关闭时 GUI 仍按阈值过滤（门控是常设质量过滤，非注入开关的从属）；chip 显示「注入：关」如实反映开关。

---

## 3. 缓存键修正（用户已核实的缺口，方案如下）

`createSnapshotReader` 的缓存键从 `projectDir ?? ""` 扩为 **`${projectDir ?? ""}\u0000${minConfidence}`**（按用户指示进缓存键；阈值变更 → 新键 → 必然重读重算，即使全部依赖文件 mtime+size 未变）。stamp 机制不动（阈值不是文件）。`injectTasteContext` 在调用 `readSnapshot` 时显式传入 `active.injection.minConfidence`。缓存规模上界 32 清空策略不变（阈值反复切换最多多占几个槽位，无害）。

回归钉死（index.test.js 新测试）：taste 文件**一字节不动**，改写 config.json 的 minConfidence 0.7→0.9→0.7，轮询断言注入文本跟随变化（若缓存键漏掉阈值，旧文本将永不过期，waitFor 超时失败）。

---

## 4. 交付单元清单（修订并执行档逐条落地；每单元含验收标准）

> 依赖顺序：DU-1 → DU-2 → DU-3 →（DU-4、DU-5+DU-6 可并行，不同文件）→ DU-7 → DU-8 → 终检。单元内测试随单元落地，验收即测试。

### DU-1 `lib/config.js` — minConfidence 配置面（不取整钳位）
改动：
- `DEFAULT_CONFIG.injection` 追加 `minConfidence: 0.7`（frozen 字面量内直接加）。
- 新增私有助手（放 `boundedNumber` 旁）：
  ```js
  /** Coerce one untrusted probability into [0, 1] WITHOUT rounding; unusable values fall back. */
  function unitIntervalNumber(value, fallback) {
  	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  	return Math.min(1, Math.max(0, value));
  }
  ```
- `mergeConfig` injection 节追加 `minConfidence: unitIntervalNumber(injection.minConfidence, DEFAULT_CONFIG.injection.minConfidence)`。
- **禁用** `boundedNumber`/`BOUNDS` 承接 minConfidence（Math.round 陷阱）。

验收（test/config.test.js）：
- `EXPECTED_DEFAULT.injection` 更新为 `{enabled:true, maxChars:16000, includeSubagents:false, minConfidence:0.7}`；既有全量 deepEqual 处（约 35/47/60-65/90-95/144/148-153 行）同步加键 —— 机械更新，**不删任何既有断言**。
- 新增 1 个 test「minConfidence 钳位不取整」：`0.65→0.65`；`0.7→0.7`（**钉死不被取整为 1**）；`1.5→1`；`-0.2→0`；`"high"`/`NaN`/缺省/`Infinity → 0.7`；`DEFAULT_CONFIG` 深冻结仍成立。

### DU-2 `lib/index.js` — 声明式 Config schema
改动：injection 对象追加 `minConfidence: z.number().default(0.7)`（61-67 行处）。

验收：`index.test.js` 既有用例经 `configWith()`（structuredClone(DEFAULT_CONFIG)）自动携带 0.7，全绿；无新增测试（钳位归 DU-1/du-3）。

### DU-3 `lib/storage.js` — 共享门控判定 `gateTasteEntries`
改动：
- 新增导出（放 `formatTasteConfidence` 之后，注释注明与 config.js/index.js 的 0.7 三处 keep-in-sync）：
  ```js
  /** Fallback gate threshold when the caller-supplied value is unusable (keep in sync with config.js / index.js). */
  const DEFAULT_MIN_CONFIDENCE = 0.7;

  /**
   * Entries clearing the injection/GUI confidence gate: confidence >=
   * minConfidence (boundary-inclusive — an entry exactly at the threshold
   * stays). The threshold is defensively clamped into [0, 1]; an unusable
   * threshold falls back to the default. Non-array input yields [].
   */
  export function gateTasteEntries(entries, minConfidence) {
  	const threshold = typeof minConfidence === "number" && Number.isFinite(minConfidence)
  		? Math.min(1, Math.max(0, minConfidence))
  		: DEFAULT_MIN_CONFIDENCE;
  	return (Array.isArray(entries) ? entries : []).filter((entry) => normalizedConfidence(entry?.confidence) >= threshold);
  }
  ```
- `loadTasteSnapshot` JSDoc 追加一句：「**不门控（by design）**：`/taste status` 计全量库；注入侧门控见 index.js readSnapshotSync」——仅注释，零行为变化。

验收（test/storage.test.js 新增 1 个 test，多断言合一）：阈值 0.7 时 `[{0.50},{0.69},{0.70},{0.85},{1}]` → 保留后三个（**边界 0.70 含入**）；阈值 `5` → 钳 1（仅 confidence 1 通过）；阈值 `"abc"`/缺省 → 回退 0.7；`gateTasteEntries(null, 0.7)` → `[]`。既有 `loadTasteSnapshot`/`parseTasteFile` 测试**零改动**（不门控）。

### DU-4 `lib/index.js` — 注入门控 + 缓存键
改动：
- import 列表加 `gateTasteEntries`。
- `readSnapshotSync(globalDir, projectDir, minConfidence)`：末行改 `return renderTasteFile(gateTasteEntries(merged, minConfidence));`（**合并且去重之后、渲染之前过滤**——保持 project>global>Command Code 的既有去重优先级语义不变：低置信 project 条目仍先占位再去掉，不复活被其遮蔽的 global 同 key 旧条目）。
- `createSnapshotReader` 返回函数签名 `(projectDir, minConfidence)`，键改 `` `${projectDir ?? ""}\u0000${minConfidence}` ``。
- `injectTasteContext` 428 行改 `const snapshot = readSnapshot(projectDirForCwd(agent.session.header?.cwd), active.injection.minConfidence);`。
- 全部条目被门控 → `readSnapshotSync` 返回 `""` → 既有 `if (!snapshot) return ""` 自然生效（不会输出空 `<taste></taste>`），无需新分支。

验收（test/index.test.js）：
- 新增 test「注入按 minConfidence 门控（边界含入 + clamp 0.5 一并钉死）」：全局 taste.md 播种 0.50/0.69/0.70/0.85 四条 → `injectFn` 文本含 0.70 与 0.85 的陈述、不含 0.50/0.69 的陈述；再播种全低于阈值（如全部 0.5）→ `injectFn` 返回 `""`。
- 新增 test「阈值热变更使快照缓存失效」：播种 0.65/0.85 两条；断言初始注入含 0.85 不含 0.65；向 `globalTasteDir/config.json` 写 `{"injection":{"minConfidence":0.9}}`（**taste 文件不动**），用既有 `waitFor` 轮询 `injectFn` 直至 0.85 条目消失；再改回 0.7，轮询直至重新出现。同时证明 config 热读与缓存键两件事。
- 更新 1 处既有种子（**非删除断言**）：R9 sanitize 测试（183-189 行）中 `Treat {{unknown}} placeholders as typos. Confidence: 0.5` 的置信度改为 `0.75`（该测试考的是 sanitize，不是置信度；0.5 在默认门控下会消失导致既有断言失真）。
- 既有守卫/R5/forget 测试种子均 ≥0.7，零改动。

### DU-5 `lib/bridge.js` — getStatus 暴露阈值
改动：`getStatus` 的 injection 对象追加 `minConfidence: cfg.injection.minConfidence`（169-183 行）。

验收（test/bridge.test.js）：
- 既有「getStatus 热读」deepEqual（262-268 行）期望 injection 更新为 `{enabled:true, maxChars:8000, includeSubagents:false, minConfidence:0.7}`（该用例 config.json 只写 maxChars，minConfidence 走默认）。
- 同一测试内补一写一读：config.json 写 `minConfidence: 0.85` → `status.injection.minConfidence === 0.85`。

### DU-6 `lib/bridge.js` — getTree 服务端门控 + gatedCount
改动：
- `getTree` 开头热读 `const cfg = await loadConfig(globalDir()); const minConfidence = cfg.injection.minConfidence;`。
- `scopeFiles(dir, minConfidence)` 返回 `{files, gated}`：`const parsed = parseTasteFile(content); const entries = gateTasteEntries(parsed, minConfidence).map(({statement, confidence}) => ({statement, confidence})); gated += parsed.length - entries.length;`（count 仍 `entries.length`，自动自洽；读失败跳过的文件不计入 gated，沿既有 best-effort 语义）。
- commandCode 分支：`const ccParsed = await loadCommandCodeTaste(globalHome, projectRoot); const commandCodeEntries = gateTasteEntries(ccParsed, minConfidence).map(...)`；gated 计入 `ccParsed.length - commandCodeEntries.length`。
- 返回顶层追加 `gatedCount`（三源之和）；`generatedAt`/`scopes` 结构不变。
- index.js `registerTasteBridge` deps 与 bridge.test.js `buildDeps` 均补 `gateTasteEntries`（沿 deps 注入惯例，bridge 不直接 import storage）。
- bridge 模块 docblob（§安全包络）补一句门控说明（getTree 按注入同款置信度门控过滤，只读过滤不引入写原语）。

验收（test/bridge.test.js）：
- 新增 test「getTree 按置信度门控且计数自洽」：全局播种 0.65/0.70/0.90 → entries 仅含后两条、`count===2`、顶层 `gatedCount===1`（边界 0.70 含入）；再在 commandcode base 播种一条 0.6 → 该条不出现在 commandCode scope、`gatedCount` 计入。
- 更新 2 处既有种子（保持测试原意，非删除）：commandCode 合并测试（207 行）`0.6→0.8`；shape 测试（221 行）`0.50→0.80`。
- **既有 deleteEntry 测试（0.5/0.6 种子）零改动** —— 删除是文件级、不经 getTree，天然不受门控影响（这本身钉死了「不改删除逻辑」约束）。

### DU-7 `lib/client.js` — chip 阈值 + 隐藏提示 + 门控空态
改动：
- view helpers 区新增 `thresholdText(status)`：`Number(status?.injection?.minConfidence)` 有限则钳 [0,1] 后 `toFixed(2)`，否则 `"0.70"`。
- chip（698-701 行）传参追加 `minConfidence: thresholdText(status)`；zh/en `status.injection` 字符串按裁决 4 更新。
- `ts_body` 内 tab 栏之后追加提示行（复用 `.ts_hint`，零新 CSS）：`tree?.gatedCount > 0` 时渲染 `t("gated.hint", {count: tree.gatedCount, minConfidence: thresholdText(status)})`。
- empty-all 分支（723-724 行）拆分：`tree.gatedCount > 0` → `t("empty.gated", {minConfidence})`，否则 `t("empty.all")`。
- zh/en 字典同步新增（键集奇偶测试强制双语对齐）：
  - zh `gated.hint`: `"已按置信度阈值 {minConfidence} 隐藏 {count} 条低置信度条目"` / en: `"{count} entries below the {minConfidence} confidence threshold are hidden"`
  - zh `empty.gated`: `"所有偏好条目的置信度都低于注入阈值 {minConfidence}，已全部隐藏。"` / en: `"Every entry is below the injection confidence threshold {minConfidence}; all are hidden."`
- **不动** `barClass`（着色分档与门控阈值语义独立；阈值 <0.7 时中/低档仍可达）。

验收（test/client.test.js）：扩展既有 mutation-surface 字符串门测试（或新增 1 个小 it）：bundle 含 `"minConfidence"`、`"gatedCount"`、`"empty.gated"`、`"gated.hint"`；zh/en 键集奇偶测试保持绿；负向门（不引用宿主模块）不变。

### DU-8 `config.example.json` + `README.md` — 用户面配置示例
改动：example injection 节补 `"minConfidence": 0.7`；README「工作原理」或「Web GUI」节补 2-3 行（注入与 GUI 按 `injection.minConfidence`（默认 0.7，边界含入）过滤低于阈值的条目；命令侧全量）。

验收：`node -e "JSON.parse(...)"` 合法；README 提及 `injection.minConfidence` 一次且语义与实现一致。

### 终检（执行档收尾必做）
1. `cd /home/CNS2026495165/dsh/dsh-taste && node --test "test/*.test.js"` 全绿（基线 212 → 预计 ~217，只增不删）。
2. `node --check lib/client.js` 通过（手写 bundle 语法门）。
3. 死代码检查：`grep -rn "gateTasteEntries\|unitIntervalNumber\|DEFAULT_MIN_CONFIDENCE" lib/` —— 三者均被真实消费（storage 导出→index/bridge 经 deps；config 私有→mergeConfig；常量→gateTasteEntries）。
4. `git -C /home/CNS2026495165/dsh diff --stat -- dsh-taste/` 复核改动面与本清单一致，无越界文件。

---

## 5. 测试增删总表

| 文件 | 新增 | 更新（机械/种子） | 删除 |
|---|---|---|---|
| test/config.test.js | 1（minConfidence 钳位不取整，含 0.7≠1 钉死） | EXPECTED_DEFAULT + ~5 处全量 deepEqual 加键 | 0 |
| test/storage.test.js | 1（gateTasteEntries 边界/钳位/回退/防御） | 0 | 0 |
| test/index.test.js | 2（门控+空注入；阈值热变更失效缓存） | 1 处种子 0.5→0.75（sanitize 测试） | 0 |
| test/bridge.test.js | 1（getTree 门控/count/gatedCount/commandCode） | getStatus deepEqual 加键；2 处种子（0.6→0.8、0.50→0.80） | 0 |
| test/client.test.js | 1 小 it 或扩展现有字符串门 | 0 | 0 |

所有既有安全测试（R9 sanitize、守卫顺序、白名单包络、deleteEntry 全套拒绝路径、hostile 容错）**原样保留**。

---

## 6. 明确不做（非目标，执行档不得顺手实现）

- **不改**学习/汰换/删除/模型路由：learner.js、learner-tools.js、queue.js、model-registry.js、collector.js、deleteTasteEntries 零改动；learner 输入树（renderTasteTree）与 `read_taste_file` 不门控。
- **不门控命令侧**：`/taste list`、`/taste forget`、`/taste status` 计数保持全量（GUI=生效视图、命令=全量管理的双契约，见裁决 3）。
- **不新增** GUI 阈值编辑器 / setThreshold RPC（用户已定 0.70，经 config.json 手工调；`getSettings`/`setObserver` 面不动）。
- **不改** `barClass` 着色分档、两位小数渲染契约、`loadTasteSnapshot`（异步版）行为。
- **不改**线上 `~/.dsh/taste/config.json`（缺键回填默认即生效）。
- **不新增**任何文档文件；本方案为唯一落盘文档，复核结论追加于文末。

---

## 7. 验证 Runbook（可直接复制执行）

```bash
# 1. 全量测试（工作树内；peer deps 自上层 node_modules 解析）
cd /home/CNS2026495165/dsh/dsh-taste && node --test "test/*.test.js"

# 2. 手写 bundle 语法门
node --check lib/client.js

# 3. 死代码消费检查（三者都应有 lib 内多处命中）
grep -rn "gateTasteEntries" lib/ ; grep -rn "unitIntervalNumber" lib/ ; grep -rn "DEFAULT_MIN_CONFIDENCE" lib/

# 4. 改动面核对（应仅命中本清单 DU-1..DU-8 涉及文件）
git -C /home/CNS2026495165/dsh diff --stat HEAD -- dsh-taste/
```

生效验证（实现完成后）：重启 dsh 宿主 → GUI 打开偏好库 → 状态 chip 显示「注入：开（≤16000 字符，置信度≥0.70）」→ 全局页签应只见 29 条（31−2），tab 栏下出现「已按置信度阈值 0.70 隐藏 2 条低置信度条目」；`/taste status` 仍报「偏好：31 条」（全量口径，by design）。

---

## 8. 风险与边界

- **浮点比较**：阈值与条目置信度同为两位小数语义，`JSON.parse` 与 `parseFloat` 对同一字面量产生同一 double，`>=` 判定确定；不引入 `Math.round(x*100)` 类换算（避免引入新的浮点误差面）。
- **缓存键膨胀**：阈值反复切换在 32 槽上界内多占槽位，触发整清后重算，无正确性影响。
- **getStatus/getTree 并行刷新**：client `refresh()` 用 `Promise.all` 同批落地树与状态，无阈值-树错配窗口；status 缺失时 `thresholdText` 回退 0.70。
- **全部门控的注入**：`readSnapshotSync` 返回 `""`，既有空快照短路输出 `""`，不产生空 `<taste>` 包裹（DU-4 验收覆盖）。
- **声明式配置直传病态值**（schema 无范围装饰）：`gateTasteEntries` 的钳位+回退兜底；mergeConfig 路径已归一。
- **`setObserver` 物化 minConfidence**：全量 load→modify→save 会把默认 0.7 写进 config.json —— 语义等同（mergeConfig 本就会回填），无行为差异，不需规避。

---

## 执行证据（修订并执行档，2026-09-08 落地）

**DU-1..DU-8 全部落地，无越界文件；测试 218/218 全绿（基线 212，+6 新增，0 删除）。**

### 交付单元落地清单

| 单元 | 文件 | 落地内容 |
|---|---|---|
| DU-1 | lib/config.js | `DEFAULT_CONFIG.injection.minConfidence = 0.7`；新增 `unitIntervalNumber`（不取整钳位 [0,1]，注释点名 boundedNumber 的 Math.round 陷阱）；`mergeConfig` 注入节追加 `minConfidence: unitIntervalNumber(...)` |
| DU-2 | lib/index.js | 声明式 schema injection 追加 `minConfidence: z.number().default(0.7)`（无范围装饰，keep-in-sync 注释） |
| DU-3 | lib/storage.js | 导出 `gateTasteEntries(entries, minConfidence)`（边界含入 ≥、阈值防御性钳位、不可用回退 `DEFAULT_MIN_CONFIDENCE = 0.7`、非数组→[]）；`loadTasteSnapshot` JSDoc 补「不门控（by design）」 |
| DU-4 | lib/index.js | `readSnapshotSync(globalDir, projectDir, minConfidence)` 末行 `renderTasteFile(gateTasteEntries(merged, minConfidence))`（合并且去重之后、渲染之前，保持 project>global>Command Code 优先级）；`createSnapshotReader` 键改 `` `${projectDir ?? ""}\u0000${minConfidence}` ``；`injectTasteContext` 显式传 `active.injection.minConfidence`；全部门控→`""`→既有 `if (!snapshot)` 短路生效 |
| DU-5 | lib/bridge.js | `getStatus` injection 追加 `minConfidence: cfg.injection.minConfidence`（同源热读） |
| DU-6 | lib/bridge.js | `getTree` 开头热读 config 取阈值；`scopeFiles(dir, minConfidence)` 返回 `{files, gated}`（count 自动自洽，读失败文件不计 gated）；commandCode 伪文件同门控；顶层新增 `gatedCount`（三源之和）；docblob §安全包络补门控说明；index.js deps 与 bridge.test.js `buildDeps` 均补 `gateTasteEntries`（deps 注入惯例，bridge 零 storage import） |
| DU-7 | lib/client.js | `thresholdText(status)`（钳位 [0,1] 后 `toFixed(2)`，缺 status 回退 `"0.70"`）；chip 传参追加阈值；`ts_body` tab 栏后新增 `.ts_hint` 提示行（`tree?.gatedCount > 0` 时渲染 `gated.hint`）；empty-all 分支按 `gatedCount > 0` 拆分 `empty.gated`/`empty.all`；zh/en 字典同步更新 `status.injection` 并新增 `gated.hint`/`empty.gated`（键集奇偶测试绿）；`barClass` 未动 |
| DU-8 | config.example.json + README.md | example injection 补 `"minConfidence": 0.7`；README「工作原理」补置信度门控 3 行 bullet（提及 `injection.minConfidence` 一次，语义与实现一致），「Web GUI」状态条行同步措辞 |

### 测试增删（对照 §5 总表，零删除）

- test/config.test.js：+1「injection.minConfidence clamps into [0, 1] WITHOUT rounding...」（0.65/0.7/0.69 不取整钉死、1.5→1、-0.2→0、"high"→0.7、缺省→0.7、NaN/Infinity 经 saveConfig 入口→0.7、深冻结仍成立）；EXPECTED_DEFAULT 与 3 处全量 deepEqual 机械加键。
- test/storage.test.js：+1「gateTasteEntries …（boundary-inclusive/clamps/falls back defensively）」（0.70 边界含入、阈值 5→钳 1、`"abc"`/undefined/null/NaN→回退 0.7、null→[]）；导出面清单加 `gateTasteEntries`。
- test/index.test.js：+2「injection confidence gate」describe——① 门控+边界+全门控空注入（0.50/0.69 出局、0.70/0.85 保留、全 0.5→`""`）；② 阈值热变更失效缓存（taste 文件不动，config.json 0.7→0.9→0.70，`waitFor` 轮询 0.85 条目消失/回归；回写用 `0.70` 字面量使字节数不同，排除同毫秒 mtime+同 size 的 stamp 碰撞）；R9 sanitize 测试种子 `0.5→0.75`（该测试考 sanitize 非置信度）。
- test/bridge.test.js：+1「gates the tree by the confidence threshold and keeps every count coherent」（全局 0.65/0.70/0.90→count 2+gatedCount 1；commandCode 0.6→count 0+gatedCount 2）；getStatus 热读 deepEqual 加 `minConfidence: 0.7` 并同测一写一读 0.85；commandCode 合并测试种子 `0.6→0.8`、shape 测试种子 `0.50→0.80`；`buildDeps` 补 `gateTasteEntries`。
- test/client.test.js：+1 小 it「confidence-gate display markers」（bundle 含 `minConfidence`/`gatedCount`/`"empty.gated"`/`"gated.hint"`/`ts_hint` 字符串门）。
- 既有安全测试（R9 sanitize、守卫顺序、deleteEntry 全套拒绝路径、hostile 容错、zh/en 奇偶）原样保留、全绿。

### 终检结果（全部通过）

1. `node --test "test/*.test.js"` → **218 pass / 0 fail**（212 基线 + 6 新增）。
2. `node --check lib/*.js` → 全部通过（含手写 bundle client.js）。
3. `node -e "import('./lib/index.js')"` → import ok。
4. 死代码 grep：`gateTasteEntries`（storage 导出→index.js 注入/缓存键消费 + bridge.js 两处消费）、`unitIntervalNumber`（config.js 定义→mergeConfig 消费）、`DEFAULT_MIN_CONFIDENCE`（storage.js 定义→gateTasteEntries 消费）——三者均被真实消费，无死代码。
5. `git diff --check` → 无空白错误。`git diff --stat HEAD` 显示的额外文件（REVIEW.md、collector/commands/learner*、scripts/ 等）为审计基线（§1 注明「工作树未提交改动后的现状」）既有改动，本会话未触碰；本会话改动面 = DU-1..DU-8 清单文件 + §5 测试表文件，无越界。
6. `config.example.json` JSON.parse 合法，injection 含 `minConfidence: 0.7`。
7. 线上真实数据只读冒烟（生效预演）：合并去重后 34 条（全局 31 + 项目 3）→ 阈值 0.7 可见 **32** 条、门控 **2** 条（「规划新功能…」「视频/媒体样片…」，与 §1.6 预测逐字吻合）、恰为 0.70 保留 **7** 条（全局 5 + 项目 2，边界含入实证）。

### 执行档两点说明（供复核知悉）

- **线上 `~/.dsh/taste/config.json` 未落盘改动**（按本方案 §1.6/§6）：文件缺键 → `mergeConfig` 回填 0.7 → getStatus/injectTasteContext 热读即刻生效，有效值即 0.7，语义与「config.json 携带 injection.minConfidence=0.7」等价；显式键已落在 `config.example.json`。若复核要求线上文件显式带键，一行即可补上（值与默认相同，零行为差）。
- **生效方式**（§1.6）：dsh-taste 经 cordis.patch.yml insert 加载，lib 与 client bundle 同包发布——GUI chip/隐藏提示需重启 dsh 宿主 + 刷新浏览器后可见；注入侧同样随宿主重启生效。`/taste status` 的「偏好：N 条」计数走 `loadTasteSnapshot`（不门控，by design），仍报全量 34。

---

## 9. 复核结论（复核阶段追加于此后，勿另建文件）

### 9.1 独立复核（2026-09-08，只读+测试，未改任何代码）

**verdict = pass（通过）**。六条验收标准全部满足；执行证据与工作树现状逐项吻合；无越界改动、无死代码、无既有测试删除。以下为亲测证据（file:line 均为复核时工作树）。

#### 亲跑四项检查（全部通过）

| 检查 | 结果 |
|---|---|
| `node --test "test/*.test.js"` | **218 pass / 0 fail**（46 suites；基线 212 + 6 新增，与 §5 总表一致） |
| `node --check lib/*.js` | 12 个文件全部 OK（含手写 bundle client.js） |
| `node -e "import('./lib/index.js').then(()=>console.log('ok'))"` | ok |
| `git diff --check` | 无空白错误 |

#### 逐条验收

1. **<0.70 不再注入 + 缓存键含阈值** ✓
   - `readSnapshotSync(globalDir, projectDir, minConfidence)`（index.js:252-274）：合并去重（project>global>Command Code 优先级保持）之后、`renderTasteFile` 之前经 `gateTasteEntries(merged, minConfidence)` 过滤（:273）；全部门控 → `""` → 既有 `if (!snapshot)` 短路（:445），无空 `<taste>` 包裹。
   - `createSnapshotReader` 缓存键 `` `${projectDir ?? ""}\u0000${minConfidence}` ``（index.js:287）；`injectTasteContext` 显式传 `active.injection.minConfidence`（:444）。
   - 钉死测试 index.test.js:244-265「invalidates the snapshot cache when the threshold changes hot」：taste 文件一字节不动，config.json 阈值 0.7→0.9→0.70，`waitFor` 轮询注入文本跟随变化——若缓存键漏掉阈值，旧文本永不过期、该测试必然超时失败。实测通过。
2. **GUI 同步隐藏 + count/gatedCount 自洽** ✓
   - `getStatus` 追加 `minConfidence: cfg.injection.minConfidence`（bridge.js:195，与 enabled/maxChars 同源热读）；bridge.test.js:254-275 钉死（缺省 0.7 + 一写一读 0.85 热回显）。
   - `getTree` 服务端门控（bridge.js:136-183）：`scopeFiles(dir, minConfidence)` 过滤后 `count: entries.length` 天然自洽；commandCode 伪文件同门控；顶层 `gatedCount` = 三源之和（:152）。bridge.test.js:277-306 钉死（0.65 出局/count=2/gatedCount=1；commandCode 0.6 → count=0、gatedCount=2）。
   - client bundle 只消费展示、不复制判定（零宿主/bundle 漂移）：chip 阈值（client.js:713-717 + `thresholdText` :251-254，缺 status 回退 "0.70"）、`.ts_hint` 提示行（:751-754）、`empty.gated`/`empty.all` 拆分（:739-742）；`refresh()` 以 `Promise.all` 同批取树与状态（:575-578），无阈值-树错配窗口。
3. **clamp 0.5 与 Command Code 边界符合审计裁决** ✓
   - 裁决 2（0.5 一律门控，无特例）：`gateTasteEntries` 经 `normalizedConfidence`（不可用→0.5）后 `>= threshold` 统一数值比较（storage.js:158-163），回退 0.5 与明写 0.50 不可区分地同被门控；storage.test.js:185-211 与 index.test.js:219-242（0.50/0.69 出局）双钉死。
   - 裁决 1（Command Code 注入与 GUI 双门控、只读不破）：注入侧 cc 条目并入 `merged` 后统一过滤（index.js:257-273）；GUI 侧 `ccParsed` 同门控（bridge.js:146-147）；`deleteEntry` 对 commandCode 的 `read-only-source` 拒绝原样保留（bridge.js:212-213），Command Code 文件零写入。
   - 边界含入：`>=` 语义，0.70 恰等阈值保留——storage/bridge/index 三处 0.70 断言 + 线上实证（7 条 0.70 全保留）。
4. **学习/汰换/删除/模型路由/两位小数无回归** ✓
   - 改动面隔离（mtime 证据）：本会话（09-08 11:22-11:31）仅触碰 DU-1..DU-8 的 lib/config.js、storage.js、bridge.js、index.js、client.js、config.example.json、README.md 与 §5 表的 5 个测试文件；learner.js / learner-tools.js / queue.js / collector.js / commands.js / model-registry.js / backfill.js 及其测试全部停留在 09-01/09-03——学习/汰换/删除核心/模型路由承载文件零触碰，其测试套件在 218/218 中全绿。
   - 两位小数契约：`formatTasteConfidence` 恒 `toFixed(2)`（storage.js:139-143），round-trip 测试钉死 `Confidence: \d\.\d{2}$` 与 `0.90`/`1.00` 渲染；本会话未触碰该函数（DU-3 仅在其后插入门控块）。
   - 命令侧全量：`loadTasteSnapshot` 不门控（JSDoc 已注明 by design，storage.js:557-558）；learner 输入树 `renderTasteTree` 无过滤；`/taste forget`/GUI `deleteEntry` 文件级删除不经 getTree，deleteEntry 既有 0.5/0.6 种子测试零改动全绿（bridge.test.js:400）——低位条目仍可经命令全量管理，可逆无数据损失。
5. **阈值可调 + 缺键回退 0.7** ✓
   - `unitIntervalNumber`（config.js:72-75）不取整钳位 [0,1]；`boundedNumber` 的 Math.round 陷阱被测试钉死（config.test.js:156-185：0.65/0.69/0.7 原样保留、1.5→1、-0.2→0、"high"/NaN/Infinity→0.7、缺键→0.7、深冻结成立）。
   - 声明式 schema `z.number().default(0.7)`（index.js:70）；`gateTasteEntries` 防御性回退 `DEFAULT_MIN_CONFIDENCE=0.7`（storage.js:146,161）。
   - `config.example.json` injection 节含 `"minConfidence": 0.7` 且 JSON 合法；端到端可调性由 index 热变更测试（0.9 生效）与 bridge getStatus 一写一读（0.85 回显）共同证明。
6. **无死代码、测试最小、核心回归在** ✓
   - grep 实证三者均被真实消费：`gateTasteEntries`（storage 导出 → index.js:273 注入消费 + bridge.js:126/147 经 deps 注入消费）、`unitIntervalNumber`（config.js:89 mergeConfig）、`DEFAULT_MIN_CONFIDENCE`（storage.js:161）。
   - 新增测试恰 6 个（config 1 + storage 1 + index 2 + bridge 1 + client 1），与 §5 总表一一对应，无多余；0 删除；R9 sanitize 仅种子 0.5→0.75（断言原样，index.test.js:187）；zh/en 键集奇偶、deleteEntry 全套拒绝路径、hostile 容错等既有安全测试原样全绿。
   - README「置信度门控」bullet（README.md:18-21）语义与实现一致（默认 0.7、边界含入、GUI 提示、命令侧全量）。

#### 线上真实数据只读冒烟（复核重跑，与执行证据逐字吻合）

合并去重后 **34** 条（全局 31 + 项目 3；两处 Command Code 目录仍不存在）→ 阈值 0.7 可见 **32**、门控 **2**（「规划新功能…联网调研」「视频/媒体样片…视频目录」，均 0.65），恰为 0.70 保留 **7** 条（边界含入实证）；当前库内无 clamp-0.5 条目（与 §1.3 解析路径分析一致）。

### 9.2 观察与遗留（均不构成返工）

1. **线上 `~/.dsh/taste/config.json` 已显式带键**（mtime 09-08 11:39:55，晚于执行窗口 11:22-11:31）：执行档「未落盘改动」的陈述在执行时点属实；此后宿主活动（`setObserver` 全量 load→modify→save，§1.2/§8 预判的无害物化副作用）把 `minConfidence: 0.7` 写进了线上文件。值与默认相同，零行为差异，无需处理。
2. **`formatTasteConfidence`/`renderTasteFile` 的 JSDoc 滞后（既有问题，非本次引入）**：JSDoc 仍描述 zh-display 时代的「第二位为 0 则一位小数（`0.9→"0.9"`、`1→"1.0"`）」，而代码自 unified-chinese-taste 会话（09-03）起恒输出两位（`toFixed(2)`，测试钉死 0.90/1.00），改造时注释未同步。该函数在本任务中属「不动」面，行为与测试一致、无功能影响；仅建议后续会话顺手修正注释文本。
3. **生效需重启 dsh 宿主**（§1.6 既有部署事实）：lib 与 client bundle 同包发布，GUI chip/隐藏提示与注入门控随宿主重启生效；属运维事项，非代码问题。

### 9.3 最终裁决

**pass（通过）**。DU-1..DU-8 与 §5 测试表全部按审计方案落地，四项裁决（Command Code 双门控、clamp 0.5 一律门控、服务端过滤 + gatedCount 兜底、配置三处 keep-in-sync）逐条兑现，硬约束（学习/汰换/删除/模型路由零改动、两位小数契约不变、Command Code 只读、测试只增不删、生产 lib 无死代码）全部守住。无需返工。
