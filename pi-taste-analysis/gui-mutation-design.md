# dsh-taste GUI 变更设计：条目删除 + Learner 模型路由（gui-mutation-design.md，2026-09-03）

> 范围（用户已确认）：① 条目删除（图形化 forget）——project/global 可删，commandCode 只读源双保险拒删；
> ② learner 模型路由替换——GUI 修改 `observer.modelMode/provider/model`，注册表下拉 + 自由输入兜底。
> 明确不做：图形化新增/编辑条目、翻译触发按钮（见 §7.2）。
>
> 本文所有断言均经亲读源码核实，证据格式 `文件:行号`。基线：`node --test "test/*.test.js"` **212/212 绿**
> （2026-09-03 本机实跑确认；README:123 的 "204" 是陈旧数字，随本变更一并修正）。

---

## §0 已核实事实基线（设计前提）

### 0.1 现有 bridge（lib/bridge.js，193 行）

- `:32` `ENDPOINTS = new Set(["getTree", "getStatus"])` —— 闭合集分发的唯一注册点。
- `:64-74` `handle(endpoint, payload, signal)`：未知端点 → `{ok:false, error:{code:"unknown-endpoint",...}}`；
  try/catch 兜底 → `{code:"internal"}`；**handler 永不向 HTTP 层抛异常**。
- `:69` `payload ?? {}` —— 缺 payload 退化为 `{}`（bridge.test.js:138-139 已钉死）。
- `:84-105` `scopeFiles(dir)`：`loadDisplayMap` 一次 + `listTasteFiles`/`readTasteFile` 白名单读 +
  `statSync` mtime；单文件读失败 `continue`（不炸整棵树）。
- `:128-168` `getTree({cwd})`：三源树 project/global/commandCode，entry 形状 `{statement, confidence, display}`，
  file 形状 `{relPath, mtime, count, entries}`，scope 形状 `{name, dir, present, files, coverage}`。
- `:171-185` `getStatus()`：`await loadConfig(globalDir())` 热读（无缓存）+ `queue.stats()`；
  `:181` 明确注释 "no provider/model names echoed back"（只回 modelMode）。
- `:187-191` `ctx.connection.rpc.handle("/taste", handle, {authority:"loopback"})` + `ctx.effect` 绑定生命周期。
- 模块头 `:21-22` 明言 "No write surface: saveConfig/writeFileAtomicTaste/withTasteLock never enter this
  module" —— **本设计引入受控写面后该注释必须重写**（见 §1.6）。

### 0.2 forget 的删除语义（lib/commands.js:160-212，删除的唯一现成参照）

```
:160  async function forgetPreferences(deps, invocation, argument) {
:163      const entries = await enumerateEntries(deps, invocation);      // project→global 枚举（:41-58）
:165-172  数字/关键词匹配 → matches（无匹配报错）
:173      const { parseTasteFile, renderTasteFile, readTasteFile, withTasteLock,
             writeFileAtomicTaste, normalizePreferenceKey, pruneDisplayMap } = deps.storageFns;
:174-181  byFile: Map<`${dir}\0${relPath}`, {dir, relPath, keys:Set<normalizeKey>}>；
          byScopeDir: Set<dir>（按匹配收集，先于重写）
:183-198  逐文件 withTasteLock(absolute) 内 RMW：
:187-191      readTasteFile 失败 → return（静默跳过）
:192-193      before=parseTasteFile; remaining=before.filter(e => !keys.has(normalizePreferenceKey(e.statement)))
:194          remaining.length===before.length → return（无变化不写）
:195          writeFileAtomicTaste(absolute, renderTasteFile(remaining))   ← 删空 → 写 ""，不删文件
:196          removed += before.length - remaining.length
:199-210  全部文件重写完成后，逐 scope pruneDisplayMap(dir)（try/catch + logger.warn 容错）
:204          `typeof pruneDisplayMap !== "function"` 防御（注入 seam 可能缺）
:211      return { kind:"success", text:`Removed ${removed} preference(s).` }
```

关键结论（逐条亲读核实的答案）：

- **锁**：每文件一把 `withTasteLock`（storage.js:258-260，`<file>.lock`，等待 10s）；写完**释放后**才逐 scope
  调 `pruneDisplayMap`（storage.js:582-593，`display.zh.json.lock`）——**taste 锁 → display 锁单向、不嵌套**
  （commands.js:201-202 注释原文 "no lock nesting"；learner-tools.js:155-157/:230 同序）。
- **定位**：按 `normalizePreferenceKey(statement)`（storage.js:302-309）过滤，**不是行号**；与注入去重
  （storage.js:624-644 `loadTasteSnapshot`）与 display 边车键同源。
- **文件删空**：`renderTasteFile([])` 返回 `""`（storage.js:152-159），照写空文件，**不 unlink**——bridge 的
  deleteEntry 必须对齐此行为。
- **删除对注入即时生效**：注入快照按 mtime+size 指纹每次调用重判（index.js:268-280 `createSnapshotReader`
  → `snapshotStamp`），下一轮注入即读到删后状态。

### 0.3 config / observer（lib/config.js + lib/index.js）

- config.js:65-95 `mergeConfig`：observer 白名单归一——modelMode 只认 `"inherit"|"custom"`（:82-84，其余归
  `inherit`）、provider/model `stringOr`（:85-86）、三个预算 `boundedNumber`（:87-89）；**未知键写回时被丢弃**。
- config.js:108-114 `loadConfig`：缺失/损坏 → 默认副本；:123-125 `saveConfig`：`writeFileAtomic`（rename 原子提交）。
- index.js:396-400 `saveConfigTracked(dir,next)` = `saveConfig` + 立即更新 `configState.value/stamp`——
  **不落任何"事件"**，tracked 指同步内存缓存（stamp 更新避免 currentConfig() 触发一次冗余的异步重读，
  index.js:388-395）。同步守卫路径（注入/钩子）读 `configState`，mtime 变化自愈。
- index.js:443 `runTasteJob` 每 job `await loadConfig(globalDir())` 热读；:629 `enqueueBackfill` 同样热读
  ——**模型改完下个 learner 即生效，无需重启 dsh**（用户前提核实成立）。
- learner.js:198-207：`custom` 需 provider 与 model **同时非空**，否则回退 inherit 并 warn。
- 当前值（用户环境）：observer = `{modelMode:"custom", provider:"adam", model:"gpt-5.6-sol-ultra",
  maxInputChars, timeoutMs, maxTurns}`（用户陈述；config.example.json:8-14 为同形示例）。

### 0.4 现有 client（lib/client.js，464 行，免构建手写 bundle）

- `:18` 单行 `css` 常量 + `:19-26` `document.querySelector("style[data-plugin-css=...]")` 幂等注入
  `<style data-plugin="@deepseek-ai/dsh-taste">` —— 新样式照抄此法追加进同一常量。
- `:30-58` zh / `:59-87` en 双语字典（zh 是键集真源；client.test.js:138 钉死两侧键集一致）。
- `:90-92` `POLL_MS=10_000`、`CHANNEL="/taste"`。
- `:209-233` `TasteEntry({t, entry, scopeName})`：中文优先（:211-212）、两位小数（:213）、
  未翻译标记**排除 commandCode**（:220-221 `scopeName !== "commandCode"`）。
- `:235-246` `TasteFileRow`（持有 `file.relPath`，:244 把 entries map 给 TasteEntry）；
  `:248-260` `TasteCategoryGroup`；`:262-276` `TasteScopeBody`。
- `:300-428` `TastePanel`：state（:308-316 status/tree/error/loading/tab/collapsedKeys）；
  **`refresh`（:320-341）是唯一数据入口**——`Promise.all([rpc.call(CHANNEL,"getTree",{cwd}),
  rpc.call(CHANNEL,"getStatus",{})])`，成功 `setTree/setStatus/setError(null)`，失败置 `error`；
  `:344-356` 打开期间 10s 轮询（`setInterval(tick, POLL_MS)`，关面板清理）；
  `:359-377` Esc/面板外点击关闭；`:386-427` 渲染。
- `:431-458` `inject = ["slots","locale","connection","sessions"]` + `apply`：两个 slot
  （sidebar.footer.action 触发钮 / shell.overlay 面板），面板 inject 契约
  `{useOpen, rpc, onClose, useSessionCwd}`（:456，client.test.js:128 钉死）——**本设计不改该契约**。
- **无任何 modal/confirm 现成模式**（全文件亲读；唯一浮层就是面板本体）——二次确认必须新造（§4.3）。

### 0.5 settings.yaml 模型注册表（~/.dsh/settings.yaml，171 行，亲读）

- `:5` `llm-pi-ai:`（缩进 0）→ `:6` `providers:`（2）→ `:7` `opencode-go:`（4，models 于 :9）→
  `:74` `adam:`（4）→ `:78` `models:`（6）→ `:79` 起 `- id: X`（8）。
  adam 段含 `gpt-5.6-sol-ultra`(:116)、`deepseek-v4-pro`(:149)、`glm-5.3`(:157)、`glm-5.3-flash`(:158) 等。
- **解析陷阱实证**：`:139-142` `gemini-3.6-flash` 条目带嵌套 `input:` 块（`- text`，缩进 12）——行扫描必须
  用"块路径栈 + 列表项缩进钉死"防止嵌套列表污染（§3.3 用例 2）。
- `:161-163` `agent-default-model:`（缩进 0）出现在 adam 段之后——顶层 dedent 正确退出收集状态。
- DSH_HOME 优先级：`@deepseek-ai/dsh-home-paths/lib/index.js:73` `resolveDshHome`——
  显式配置 > 非空白 `$DSH_HOME` > `~/.dsh`；`:82` `dshHomePath(...)` 即 join 到该根。
  DSH 官方 settings 文档默认路径 = `join(resolveDshHome(...), "settings.yaml")`
  （dsh-settings-file/lib/index.js:31）——**dsh-taste 用 `dshHomePath("settings.yaml")` 与官方完全一致**。
- index.js:5 已 import `dshHomePath`，:353 已用于 `globalDir = dshHomePath("taste")`。
- **零新依赖约束**：dsh-taste/package.json:21-31 peerDeps 无 `yaml`；官方用 `yaml` 包解析
  （dsh-settings-file），本插件必须手写行扫描（本文 §3）。

---

## §1 bridge 扩展：deleteEntry / getSettings / setObserver

### 1.1 端点闭合集与分发结构

`lib/bridge.js:32` 改为：

```js
const ENDPOINTS = new Set(["getTree", "getStatus", "deleteEntry", "getSettings", "setObserver"]);
```

`handle`（:64-74）追加三分发行 + 受控错误映射：

```js
const handle = async (endpoint, payload, signal) => {
	if (!ENDPOINTS.has(endpoint)) {
		return { ok: false, error: { code: "unknown-endpoint", message: `taste: unknown endpoint "${endpoint}"` } };
	}
	try {
		if (endpoint === "getTree") return { ok: true, value: await getTree(payload ?? {}) };
		if (endpoint === "getStatus") return { ok: true, value: await getStatus() };
		if (endpoint === "deleteEntry") return { ok: true, value: await deleteEntry(payload ?? {}) };
		if (endpoint === "getSettings") return { ok: true, value: await getSettings() };
		if (endpoint === "setObserver") return { ok: true, value: await setObserver(payload ?? {}) };
	} catch (error) {
		if (error instanceof TasteBridgeError) {
			return { ok: false, error: { code: error.code, message: error.message } };
		}
		return { ok: false, error: { code: "internal", message: describeError(error) } };
	}
};
```

受控错误载体（模块内新增，3 行）：

```js
/** Endpoint-level validation failure carrying a stable wire error code. */
class TasteBridgeError extends Error {
	constructor(code, message) { super(message); this.code = code; }
}
```

> 用 `instanceof` 而非 `error.code` 探测：node fs 错误自带 `.code`（如 ENOENT），裸读会把它泄漏成端点码。
> 现有 hostile 测试（bridge.test.js:142-153，`deps.queue = undefined` 强制 TypeError）仍落 `internal`。

### 1.2 错误码约定（全集）

| code | 触发 | HTTP 层效果 |
|---|---|---|
| `unknown-endpoint`（既有） | endpoint 不在闭合集 | `{ok:false}` 信封，不变 |
| `internal`（既有） | 非 TasteBridgeError 的任何抛出 | 同上 |
| `invalid-payload` | scope 非 `global/project`；relPath 非白名单；statement 空/归一化空；project 缺 cwd；modelMode 非枚举；provider/model 非字符串；custom 缺 provider 或 model | 新增，同一信封 |
| `read-only-source` | `scope === "commandCode"` 的删除请求（与 UI 不渲染按钮构成双保险） | 新增 |
| `not-found` | deleteEntry 目标 key 在目标文件中 0 命中（含并发下已被 learner/forget 删掉）；scope 目录整体不存在（§1.3 锁定前 `existsSync` 预检——否则 `withTasteLock` 因父目录缺失抛 ENOENT、落 `internal`） | 新增 |

所有 message 以 `taste: ` 前缀（与 `:66` 既有格式一致）。`{authority:"loopback"}` 信封、`{ok,value|error}`
形状、fullResponse 包装全部不变。

### 1.3 deleteEntry

**payload**（client 从 getTree 行数据即可组装，无新增读面）：

```ts
{ scope: "project" | "global", relPath: string, statement: string, cwd?: string }
```

- `cwd` 仅 project scope 需要（与 getTree:130 同一 `projectDirForCwd(cwd)` 解析）。
- **无路径直通**：`relPath` 先过 `isValidTasteFilePath`（storage.js:168-172），实际读仍走
  `readTasteFile → resolveTastePath`（storage.js:183-199，权威反穿越门）。

**返回**：成功 `{ ok:true, value:{ removed:number } }`（≥1；同文件同 key 多条防御性全删并计数）。

**实现**（bridge.js 新增函数，约 30 行）：

```js
async function deleteEntry({ scope, relPath, statement, cwd }) {
	if (scope === "commandCode") {
		throw new TasteBridgeError("read-only-source", "taste: the Command Code source is read-only; deletion is refused");
	}
	if (scope !== "global" && scope !== "project") {
		throw new TasteBridgeError("invalid-payload", 'taste: scope must be "global" or "project"');
	}
	if (typeof relPath !== "string" || !isValidTasteFilePath(relPath)) {
		throw new TasteBridgeError("invalid-payload",
			`taste: relPath ${JSON.stringify(String(relPath ?? ""))} refused; expected "taste.md" or "{category}/taste.md"`);
	}
	if (typeof statement !== "string" || !statement.trim()) {
		throw new TasteBridgeError("invalid-payload", "taste: statement must be a non-empty string");
	}
	const scopeDir = scope === "global" ? globalDir() : projectDirForCwd(cwd);
	if (scopeDir === undefined) {
		throw new TasteBridgeError("invalid-payload", 'taste: deleting from the project scope requires a "cwd" string');
	}
	if (!existsSync(scopeDir)) {
		// 锁定前预检：withTasteLock 以 wx 建锁文件，父目录缺失时 ENOENT 直接抛（非竞争），
		// 会把"无物可删"误报成 internal——预检归位 not-found（existsSync 已在 bridge.js:1
		// 现有 import 中，无需新增）。残余竞态（检查之后目录才被删）仍落 internal，
		// 与既有 hostile 兜底一致，可接受。
		throw new TasteBridgeError("not-found", `taste: ${scope} scope directory does not exist`);
	}
	const key = normalizePreferenceKey(statement);
	if (!key) throw new TasteBridgeError("invalid-payload", "taste: statement normalizes to an empty key");
	const removed = await deleteTasteEntries(
		[{ scopeDir, relPath, keys: [key] }],
		(message) => logger?.warn?.(message),
	);
	if (removed === 0) {
		throw new TasteBridgeError("not-found",
			`taste: no entry in ${scope} ${JSON.stringify(relPath)} matches the statement key`);
	}
	return { removed };
}
```

语义与 forget **同一实现**（§2）：锁内 RMW → 删空写 `""` → 释放 taste 锁后 prune 该 scope 边车。
定位用 normalizeKey；同文件同 key 多条全删（`removed` 反映条数）；**跨文件同 key 不联动**（getTree 每行
对应一个 (scope, relPath)，用户点哪行删哪处，另一处是独立行）。

### 1.4 getSettings

**payload**：`{}`（忽略）。**返回**：

```ts
{
	observer: { modelMode, provider, model, maxInputChars, timeoutMs, maxTurns },  // 当前 observer 全段
	modelsByProvider: Record<string, string[]>,   // settings.yaml 注册表；任何失败 → {}
}
```

- "当前 config 来源（custom/inherit 现值）"即 `observer.modelMode`（getStatus:181 只回该值的原因即此）。
- `modelsByProvider` 给**全量 provider 映射**而非单列表：client 端 provider 文本变化时本地重筛下拉，
  免二次 RPC；注册表每次 getSettings 现读文件（无缓存）→ **注册表更新自动跟随**。
- UI 下拉默认选中当前 model：client 用 `observer.model` 作初值（§4.4）。

**实现**（约 8 行）：

```js
async function getSettings() {
	const config = await loadConfig(globalDir());        // 热读（与 getStatus:172 同法）
	const modelsByProvider = await readProviderModels(settingsPath);  // {} on any failure
	return { observer: config.observer, modelsByProvider };
}
```

### 1.5 setObserver

**payload**（三字段**全部必填**：client 恒发三字段（§4.4 save）；省略 provider/model **不回退现值**、
直接 `invalid-payload`——与下方校验及 §6.3.18 用例同一读法，契约无歧义）：

```ts
{ modelMode: "inherit" | "custom", provider: string, model: string }
```

**返回**：成功 `{ ok:true, value:{ observer } }`（写回后的 observer 全段，含未动的预算字段）。

**校验**（非法拒并返回错误消息；服务端为权威，client 预校验仅 UX）：

- `modelMode` 必须 `"inherit"|"custom"`，否则 `invalid-payload`
  （`taste: modelMode must be "inherit" or "custom"`）。
- `provider`/`model` 必填且必须字符串（`typeof !== "string"` 即拒——`undefined` 亦拒，**不回退现值**），
  否则 `invalid-payload`。
- `modelMode === "custom"` 时 trim 后两者必须非空，否则 `invalid-payload`
  （`taste: modelMode "custom" needs both provider and model`，与 learner.js:204-206 回退警告同语义）。
- `inherit` 时 provider/model 原样保留（惰性字段，切回 custom 不丢原值）。

**实现**（约 18 行）——读改写**整份** config，budgets/injection/storage/learningEnabled 全保：

```js
async function setObserver({ modelMode, provider, model } = {}) {
	if (modelMode !== "inherit" && modelMode !== "custom") {
		throw new TasteBridgeError("invalid-payload", 'taste: modelMode must be "inherit" or "custom"');
	}
	if (typeof provider !== "string" || typeof model !== "string") {
		throw new TasteBridgeError("invalid-payload", "taste: provider and model must be strings");
	}
	const providerText = provider.trim();
	const modelText = model.trim();
	if (modelMode === "custom" && (!providerText || !modelText)) {
		throw new TasteBridgeError("invalid-payload", 'taste: modelMode "custom" needs both provider and model');
	}
	const dir = globalDir();
	const config = await loadConfig(dir);                     // 整份读（含其余全部段）
	config.observer = { ...config.observer, modelMode, provider: providerText, model: modelText };
	await saveConfig(dir, config);                            // saveConfigTracked seam（§1.7）
	return { observer: config.observer };
}
```

`saveConfig` 内部再过一遍 `mergeConfig` 白名单（config.js:124），未知键写不进去；三个预算字段来自
loadConfig 的归一结果，原值透传不丢。

### 1.6 与 getTree/getStatus 的关系（不改既有返回）

- getTree/getStatus 的返回形状、键集、时序**零改动**（bridge.test.js:134/:221-234/:249-255 全部继续成立）。
- 模块头安全信封注释（bridge.js:4-30）重写为"read + curated mutations"：
  - getTree/getStatus 仍纯读；
  - getSettings：回显 observer 路由三字段（modelMode/provider/model）+ 三预算，系**有意变更**（设置
    表单回填需要；getStatus:181 仍维持只回 modelMode 的最小回显姿态——一个面向表单、一个面向状态条，
    两者不矛盾）；回显范围仍无任何密钥、无文件路径（settings.yaml 侧只读 models[].id，apiKeyEnv/
    baseURL 等一概不入结果）；
  - deleteEntry：无路径直通（relPath 白名单 + resolveTastePath 权威门）、statement 仅作 normalizeKey 查找
    永不当路径、commandCode 拒删；
  - setObserver：固定三字段白名单，其余 config 段经 load→modify→save 全保；
  - **所有写均经由注入的既有 storage/config seams（deleteTasteEntries/saveConfig），bridge 不引入新写原语**。

### 1.7 deps 形状扩展（registerTasteBridge）

bridge.js:51-62 解构追加 6 个 seam；index.js:759-770 注入：

```js
registerTasteBridge(ctx, {
	queue,
	globalDir: () => globalDir,
	projectDirForCwd,
	loadConfig,
	listTasteFiles, readTasteFile, parseTasteFile,
	loadCommandCodeTaste, loadDisplayMap, normalizePreferenceKey,
	// ↓ 新增
	isValidTasteFilePath,          // storage.js:168（deleteEntry 预校验）
	deleteTasteEntries,            // §2 提取的共享删除核心
	saveConfig: saveConfigTracked, // index.js:396（与 commands 同一 tracked seam）
	settingsPath: settingsYamlPath,// apply() 时 dshHomePath("settings.yaml") 钉死（同 :353 globalDir 手法）
	readProviderModels,            // §3 的容错读
	logger: ctx.logger,            // prune 警告落 host 日志（可选，调用侧 ?. 守卫）
});
```

index.js 顶部 import 扩展：storage import 块（:8-25）加 `deleteTasteEntries, isValidTasteFilePath`；
新增 `import { readProviderModels } from "./model-registry.js";`；
apply() 内 `:353` 旁加 `const settingsYamlPath = dshHomePath("settings.yaml");`。

---

## §2 删除语义复用：forget → deleteTasteEntries 单一实现

### 2.1 提取方案

forget 的删除核心目前内联在 commands.js:174-210（byFile/byScopeDir 分组 + 锁内 RMW + 逐 scope prune）。
提取为 **storage.js 新导出 `deleteTasteEntries`**（放 §边车 region 之后、`loadTasteSnapshot` 之前，
即 storage.js:610 附近），命令与 bridge 共用，**单一实现**：

```js
/**
 * Shared deletion core (`/taste forget` + GUI deleteEntry): for each target
 * file, remove every entry whose normalizePreferenceKey is in that target's
 * keys — one locked read-modify-write per file — then prune every targeted
 * scope's display sidecar. Lock order is one-way: each taste lock is released
 * before any display lock is acquired (never nested). An emptied file is
 * written as "" (never unlinked), matching forget's historical behavior.
 * @param {Array<{scopeDir: string, relPath: string, keys: Iterable<string>}>} targets -
 *   callers pass ALREADY-NORMALIZED keys (normalizePreferenceKey).
 * @param {(message: string) => void} [warn] - optional diagnostic sink for prune failures.
 * @returns {Promise<number>} total entries removed (0 = nothing matched).
 */
export async function deleteTasteEntries(targets, warn) {
	const byFile = new Map();
	const byScopeDir = new Set();
	for (const target of Array.isArray(targets) ? targets : []) {
		if (typeof target?.scopeDir !== "string" || !target.scopeDir) continue;
		if (typeof target?.relPath !== "string" || !target.relPath) continue;
		const fileKey = `${target.scopeDir}\u0000${target.relPath}`;
		if (!byFile.has(fileKey)) byFile.set(fileKey, { scopeDir: target.scopeDir, relPath: target.relPath, keys: new Set() });
		const file = byFile.get(fileKey);
		for (const key of target.keys ?? []) if (typeof key === "string" && key) file.keys.add(key);
		byScopeDir.add(target.scopeDir);
	}
	let removed = 0;
	for (const file of byFile.values()) {
		const absolute = join(file.scopeDir, file.relPath);
		await withTasteLock(absolute, async () => {
			let content;
			try {
				content = await readTasteFile(file.scopeDir, file.relPath);
			} catch {
				return;
			}
			const before = parseTasteFile(content);
			const remaining = before.filter((entry) => !file.keys.has(normalizePreferenceKey(entry.statement)));
			if (remaining.length === before.length) return;
			await writeFileAtomicTaste(absolute, renderTasteFile(remaining));
			removed += before.length - remaining.length;
		});
	}
	for (const dir of byScopeDir) {
		try {
			await pruneDisplayMap(dir);
		} catch (error) {
			warn?.(`taste: display prune skipped: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return removed;
}
```

与 forget 现行为的逐点对齐（除下表末行明示的空串 key 防御收紧外，零语义漂移）：

| forget 现行为（行号） | deleteTasteEntries |
|---|---|
| fileKey = `` `${dir}\0${relPath}` ``（:177） | 同（键名换 scopeDir，语义同） |
| keys 为 normalizeKey 集（:179） | 同（调用方传归一化 key） |
| 读失败静默 return（:187-190） | 同 |
| 无变化不写（:194） | 同 |
| 删空写 `""` 不删文件（:195 + storage.js:154-155） | 同 |
| removed 计数（:196） | 同 |
| **全部重写后**逐 scope prune（:199-210，先 taste 锁后 display 锁，单向） | 同（prune 所有 target scope——与 forget"按匹配收集 byScopeDir"一致，无论是否实际删除；prune 幂等） |
| prune 失败 warn 不炸（:205-209） | 同（`warn?.()`；commands 传 `deps.logger?.warn`，bridge 传 `logger?.warn`） |
| `typeof pruneDisplayMap !== "function"` 防御（:204） | 消失——helper 与 pruneDisplayMap 同模块（storage.js），seam 缺失防御移到"helper 本身缺失则整条路不可用"，由 index.js 真实注入保证 |
| keys 集**不滤空串**（:179 直接 `keys.add(normalizePreferenceKey(...))`——纯标点陈述归一化为 `""` 时也入集、forget 关键词命中即删，病态数据边角） | **有意防御收紧**：helper 的 `if (typeof key === "string" && key)` 丢弃空串 key——与 `scopeStatementKeys`（storage.js:606 `if (key)`）、`coverageOf`（bridge.js:117 `if (!key) continue`）的空 key 跳过手法一致；bridge 路径无感（§1.3 已拒归一化空 statement），forget 命令侧仅在该病态边角从"旧码会删"变为"不删并返回 `Removed 0`"，方向更安全 |

（边车重写注记：`pruneDisplayMap` **无条件**重写边车（storage.js:590）——0 命中（not-found）路径也会
字节等价重写 `display.zh.json`，仅 mtime 抖动；与 forget"按匹配收集 byScopeDir 即 prune"的语义一致、
幂等无害。裁定：**接受现状**，保持与 forget 完全同构，不在 `removed === 0` 时跳过 prune 循环。）

### 2.2 commands.js forget 改造（净 -15 行）

forgetPreferences（:160-212）的 `:173-210` 替换为：

```js
const { normalizePreferenceKey, deleteTasteEntries } = deps.storageFns;
const targets = matches.map((match) => ({
	scopeDir: match.dir,
	relPath: match.relPath,
	keys: [normalizePreferenceKey(match.statement)],
}));
const removed = await deps.storageFns.deleteTasteEntries(
	targets,
	(message) => deps.logger?.warn?.(message),
);
return { kind: "success", text: `Removed ${removed} preference(s).` };
```

（`matches`/`enumerateEntries`/参数校验/无匹配报错段 `:161-172` 原样不动；helper 内部按 fileKey 重新分组，
与原 byFile 等价。）`registerTasteCommands` 的 storageFns JSDoc（commands.js:345）补 `deleteTasteEntries`；
index.js:737-748 storageFns 对象补该键。

注记（硬依赖变化，§2.1 对齐表末行的展开）：helper 化后 forget 不再有 `typeof pruneDisplayMap !==
"function"` 的残缺注入降级——commands 侧现**硬依赖** `storageFns.deleteTasteEntries`：测试注入残缺
storageFns（缺该键）时，forget 从"降级可用（跳过 prune）"变为整条报错。index.js:737-748 恒全量注入，
真实路径不受影响；§6.4 回归用例走 apply() 真注入即已钉住该依赖。

### 2.3 并发正确性（与 learner 写同文件）

- learner 的 `write_taste_file`/`edit_taste_file` 同样在 `withTasteLock(absolute)` 内 RMW
  （learner-tools.js:133/:202）；deleteEntry 与之在同名 `<file>.lock` 上串行，10s 等待预算内互斥。
- 先后交错均为"读-改-写"且读在锁内：learner 先落 → delete 重读后按 key 过滤（或 not-found）；
  delete 先落 → learner 的 `edit_taste_file` old_text 未命中会拿到 `error: old_text not found`
  （learner-tools.js:211-213），learner 自行重读自纠，无损坏。
- 锁序不变式：taste 锁（per file）→ 释放 → display 锁（per scope），全代码库单向
  （commands.js:201-202、learner-tools.js:155-157/:230、本 helper 同构）——**无嵌套即无死锁**。

---

## §3 settings.yaml 模型注册表解析器（lib/model-registry.js，新文件）

### 3.1 函数签名与放置

```js
// lib/model-registry.js —— 零依赖（仅 node:fs/promises），~120 行含文档
/** 行扫描 llm-pi-ai.providers.<name>.models[].id；纯函数，任何结构意外 → 缺失项。 */
export function parseProviderModels(text) → Record<string, string[]>

/** 容错读：<filePath> 读失败/缺文件/坏 UTF-8 → {}（GUI 回退自由输入）。 */
export async function readProviderModels(filePath) → Promise<Record<string, string[]>>
```

- 返回映射而非单列表：getSettings 一次给全量（§1.4），provider 文本变化时 client 本地重筛。
- 每个 provider 的列表**去重 + `localeCompare` 排序**；只收录拥有 `models:` 块的 provider
  （无 models 的 provider 不出现在映射里）。

### 3.2 路径与 DSH_HOME 解析

- `settingsPath` 由 index.js apply() 钉死：`dshHomePath("settings.yaml")`
  （dsh-home-paths/lib/index.js:73/:82：非空白 `$DSH_HOME` > `~/.dsh`，空串视为未设置）。
  与 `globalDir = dshHomePath("taste")`（index.js:353）同一手法、与官方 settings 文档默认路径
  （dsh-settings-file/lib/index.js:31）同根——**DSH_HOME 优先级免费获得且与 DSH 全局一致**。
- 测试隔离照抄现有模式：bridge.test.js:73-74 / index.test.js:78-79 先设 `process.env.DSH_HOME` 再
  register/apply，临时 home 里放 settings.yaml fixture 即可命中。

### 3.3 行扫描算法（块路径栈状态机）

对每行：① 空行/首非空白字符为 `#` 的注释行跳过；② 缩进含 `\t` 的行跳过（YAML 禁 tab 缩进，防
"\tllm-pi-ai:" 假顶层）；③ `indent` = 前导空格数；④ 先弹栈：`while (stack.length && indent <= top.indent) pop`。

维护**全量块键栈**（每个"空值键行"入栈，即 `key:` 后为空或注释——有标量值的键如 `apiKeyEnv: X`、
`baseURL: https://...` 不入栈，其不可能有块子节点）：

```js
const KEY_RE = /^([^\s:]+)\s*:\s*(#.*)?$/;                       // 块键（空值）
const ID_RE = /^-\s+id\s*:\s*(?:"([^"]*)"|'([^']*)'|([^#\s]+))\s*(?:#.*)?$/;  // 列表项 id（容引号/尾注释）
```

- 栈空时仅 `indent === 0` 且 content 匹配 `llm-pi-ai:` 入栈（顶层精度门，`llm-deepseek:`(:3) 这类自然排除）。
- 每次块键入栈后检查路径后缀：`stack[-4].key==="llm-pi-ai" && stack[-3].key==="providers" &&
  stack[-1].key==="models"` → 记录 `currentProvider = stack[-2].key`，`listIndent = -1`。**这是 listIndent
  的唯一重置点**——除四级路径注册外，任何块键的入栈/弹栈都**不触碰** listIndent；收集条件恒为
  "栈顶为已登记 `models` 块 && `indent === listIndent`"（`-1` 表示待钉死）。
- `- id: X` 行：当栈顶为某个已登记的 `models` 块（路径后缀同上）时收集——`listIndent === -1` 则钉死为
  本列表项缩进，之后仅 `indent === listIndent` 的 id 项入集（防更深嵌套列表冒充）。
- id 取捕获组：引号形式（双/单）去引号后 trim，非空即收——**引号内含空格合法保留**（引号形式已被
  ID_RE 完整匹配验证，不是"残串"）；裸形式捕获（第三组）**首或尾字符为 `"`/`'` 时丢弃**（未闭合引号的
  malformed 残串，宁缺勿假）；裸捕获由 `[^#\s]+` 定义天然不含空白。
- 顶层 `agent-default-model:`（settings.yaml:161，indent 0）触发全栈弹出 → 收集自然终止。

**嵌套陷阱的免疫证明**（settings.yaml:139-142 实形）：`gemini-3.6-flash` 条目下 `input:`（indent 10）是
空值块键 → 入栈（**不触碰 listIndent**——重置仅发生在四级路径注册；此时 listIndent 保持先前 `- id:` 项
钉死的 8）→ 其子 `- text`（indent 12）不匹配 ID_RE、且栈顶为 `input` 非 `models`；伪 `- id: fake` 钉在
`input:` **同缩进**（indent 10）时——弹栈规则先弹掉 `input`（10 ≤ 10）露出 `models` 栈帧，但 `10 ≠
listIndent(8)` → 拒收（**此例是"仅四级注册重置"与"任意块键入栈重置"两种读法的分水岭**：后一读法会把
listIndent 重置后重钉 10、错误收集，已由 §6.1.2 用例钉死排除）；钉在更深层（indent 12）时栈顶为 `input`
非 `models` → 拒收。下一 `- id: gemini-3-flash-preview`（indent 8）先弹掉 `input` 栈帧（8 ≤ 10），
`8 === listIndent(8)`（未被重置、命中已钉死值）→ 正常收集。
同理 `credentials:` 之类假设性嵌套块（provider 段内、models 之前）会被入栈，其内部 `models:` 的路径后缀
为 `[providers, <provider>, credentials, models]` ≠ 四级目标路径 → 不收集。

### 3.4 失败容错矩阵

| 输入 | 结果 |
|---|---|
| 文件缺失 / 不可读 / 坏编码（readProviderModels） | `{}`（GUI 回退自由输入） |
| 无 `llm-pi-ai` / 无 `providers` / 流式风格 `providers: {}` / 锚点引用 | `{}` 或缺项（任何"看不懂"一律不产出） |
| provider 无 `models:` 块 | 该 provider 不在映射中 |
| `models:` 与列表项**同缩进**（`models:\n- id: x`，合法 YAML 风格） | 弹栈规则先弹出 `models` 帧（`indent <= top.indent`）→ 该 provider 缺失，GUI 回退自由输入。真实文件与官方写入器均为两步进缩进，当前无害；如欲支持需把 `- ` 列表项行的弹栈条件改为 `indent < top.indent` 并另行验证，**非本轮范围** |
| `- id:` 带引号 / 尾注释 | 去引号、去注释后收 |
| `- id: "two words"`（引号内含空格） | 去引号后**保留**（引号形式已被 ID_RE 完整匹配验证，非"残串"） |
| `- id: "unclosed` / `- id: bare'`（引号未闭合） | 裸捕获首或尾字符为 `"`/`'` → 丢弃，该行不产出（宁缺勿假） |
| 同 id 重复 | Set 去重 |
| tab 缩进行 / 注释行 / 空行 | 跳过，不断链 |
| 非法 provider 键名（`"adam":` 带引号） | 不匹配 KEY_RE → 该 provider 缺失 |

---

## §4 client.js 交互设计

### 4.1 组件结构与 prop 线传

```
TastePanel  （新增 state：settingsOpen, settings, settingsLoadError, confirmingKey, deleting, actionError）
├─ header：title + [刷新(既有)] + [⚙ 模型设置(新)] + [关闭(既有)]
├─ status 条（不动；保存成功后 refresh() → modelMode chip 更新）
├─ actionError 行（新：删除失败回显，类名 ts_actionError，复用 ts_error 视觉）
├─ settingsOpen === true
│   └─ TasteSettings（新组件）{ t, rpc, data, loadError, onSaved, onRetry }
│       ├─ 路由模式分段钮（inherit / custom，复用 ts_tab 样式）
│       ├─ provider 文本输入
│       ├─ model 双模式：注册表 <select> ⇄ 自由 <input>（含切换钮）
│       ├─ 提示行（注册表来源 / 注册表空回退说明）
│       └─ 保存行（保存按钮 + savedFlash + saveError 回显）
└─ settingsOpen === false
    └─ ts_body（tabs + TasteScopeBody，均新增 deleteControl 下传）
        └─ TasteScopeBody → TasteCategoryGroup → TasteFileRow → TasteEntry（另传 relPath）
```

- `deleteControl = { confirmingKey, busy, onBegin(key), onConfirm({scopeName, relPath, statement}), onCancel() }`
  —— 单一 prop 沿 ScopeBody→CategoryGroup→FileRow→Entry 线传（与既有 `collapsedKeys/onToggleKey`
  同法，client.js:313-316）；`relPath` 由 TasteFileRow（:244 map 处）新增下传。
- **面板 slot inject 契约（:456）与 bundle inject 列表（:431）零改动**——所有新状态面板内部消化。

### 4.2 删除按钮与 commandCode 只读标记（TasteEntry 改造）

- `scopeName !== "commandCode"` 的条目：`ts_entryMeta` 尾部（bar 之后）追加
  `<button className="ts_iconBtn ts_deleteBtn" aria-label/title={t("delete")} disabled={busy}>` 内放
  `IconTrashOutline16`（已核实存在于 `@deepseek-ai/dsh-client-ui-primitives`，官方 conversation bundle
  同用法；**无新 require 说明符**，client.test.js:39-42 的 requireMock 需补该图标导出）。
- `scopeName === "commandCode"`：不渲染删除钮，改在 `ts_entryText` 内陈述后渲染
  `<span className="ts_readonly">{t("readonly")}</span>`（占位与 `ts_untranslated` 同槽位、同排版手法，
  client.js:220-222）——**UI 只读标记 + 后端 `read-only-source` 拒绝 = 双保险**。
- entryKey = `` `${scopeName}\0${relPath}\0${statement}` ``（confirmingKey 的匹配键；跨文件同陈述不串）。

### 4.3 二次确认（现有代码无 modal 可复用，采用内联两步式）

确认条渲染在 `ts_entry` 内第三行（flex 容器自然堆叠）：

```
[删除这条偏好？] [确认删除] [取消]      ← ts_confirm / ts_confirmOk / ts_confirmCancel
```

- 点「删除」→ `onBegin(entryKey)` 置 `confirmingKey`（同时清 `actionError`）；同一时刻仅一条确认
  （单值 state，切换目标即切换确认行）；「取消」/确认执行后清空。无定时器——确定性、可测。
- `onConfirm` → 面板 `confirmDelete`（§4.5）异步执行；`busy` 期间三钮全 disabled。
- zh 文案见 §4.6（`delete.confirm` / `delete.ok` / `cancel`）。

### 4.4 TasteSettings（模型设置区）

- **数据**：settingsOpen 翻开时 `useEffect` 触发 `reloadSettings()`（`rpc.call(CHANNEL,"getSettings",{})`，
  成功 `setSettings(value)`，失败 `setSettingsLoadError`；重开面板必重拉——注册表自动跟随）。
- **表单状态**（组件内部 useState）：`{ modelMode, provider, model }` + `inputMode`("registry"|"free") +
  `saving/savedFlash/saveError`。`data` 引用变化时 useEffect 重同步表单（保存成功后 reload 回填权威值）。
- **路由模式**：两个分段钮（`ts_tab`/`ts_tabActive` 复用，client.js:418-424 的既有 tab 形态）。
- **provider**：`<input type="text" className="ts_input">`，受控。
- **model 双模式**：
  - `registry = data?.modelsByProvider?.[form.provider] ?? []`；
  - 生效模式 `effectiveMode = inputMode === "registry" && registry.length === 0 ? "free" : inputMode`
    （**注册表空 → 自动回退自由输入**，满足"自由输入兜底"）；
  - registry 模式：`<select className="ts_input">`，options = registry（已排序去重）；当前 model 不在表内时
    头部插一枚 `${model}（当前）` 的 pinned option（切模式不丢值）；原生 `<select>+<option>` 是官方
    DSH UI 既有模式（dsh-client-ui-settings-models/lib/client.js:1240/:1625/:2007）；
  - free 模式：`<input type="text">` 受控；
  - 切换钮（`ts_modeToggle`）：文案在 `settings.mode.registry`（"从列表选择"）与 `settings.mode.free`
    （"手动输入"）间切换；
  - **下拉默认选中当前 model**：表单初值即 `observer.model`（select 的 value 绑定）。
- **保存**（组件内 `save`，面板无关状态不外泄）：

```js
const save = async () => {
	setSaving(true); setSaveError(null);
	try {
		const result = await rpc.call(CHANNEL, "setObserver", {
			modelMode: form.modelMode, provider: form.provider, model: form.model,
		});
		if (result?.ok) { setSavedFlash(true); await onSaved(); }        // 乐观反馈：已保存 flash + 权威回填
		else setSaveError(result?.error ?? { code: "internal", message: "unknown rpc failure" });  // 失败回显
	} catch (cause) {
		setSaveError({ code: "transport", message: String(cause?.message || cause) });
	} finally { setSaving(false); }
};
```

  - `onSaved = async () => { await reloadSettings(); void refresh(); }`（refresh 即面板 :320-341 的既有
    useCallback——status 条 modelMode chip 即时更新）；
  - 保存按钮 disabled：`saving || (modelMode === "custom" && (!provider.trim() || !model.trim()))`
    （镜像服务端校验；服务端仍权威）；
  - savedFlash 在任一表单字段编辑时置 false（无定时器）。
- **加载失败态**：面板内渲染 `settings.loadError` + 详情 + `retry` 按钮（`onRetry = reloadSettings`）。

### 4.5 删除执行与刷新触发（TastePanel 新增处理器）

```js
const confirmDelete = async ({ scopeName, relPath, statement }) => {
	if (!rpc || typeof rpc.call !== "function") return;
	setDeleting(true);
	try {
		const result = await rpc.call(CHANNEL, "deleteEntry", { scope: scopeName, relPath, statement, cwd });
		if (result?.ok) { setConfirmingKey(null); setActionError(null); }
		else { setConfirmingKey(null); setActionError(result?.error ?? { code: "internal", message: "unknown rpc failure" }); }
		void refresh();   // 成功与失败都刷新：成功即见删除，失败重同步（例如并发下已被 learner 删掉 → not-found）
	} catch (cause) {
		setActionError({ code: "transport", message: String(cause?.message || cause) });
	} finally { setDeleting(false); }
};
```

- **删除/保存成功即触发刷新**：删除走 `refresh()`（树+状态并行重拉，entry 即时消失即反馈）；
  保存走 `reloadSettings() + refresh()`。`refresh` 是既有 useCallback（:320-341），无需改造——
  **变更操作触发即时刷新 = 直接调用该函数**，10s 轮询（:344-356）保持不动。
- 无乐观树改写（不做本地 remove entry）：以 RPC 结果 + 立即 refresh 为准，规避轮询竞态下的闪变
  （§8 风险 4）。
- `actionError` 行渲染在 status 条与 body 之间（`t("error.action")` + `ts_errorDetail` 详情，复用
  :409-412 的双行结构，类名 `ts_error ts_actionError`）；下一次成功操作清除。

### 4.6 zh 字典新增（en 严格同键镜像；client.test.js:138 奇偶校验自动覆盖）

| key | zh | en |
|---|---|---|
| `settings` | 模型设置 | Model settings |
| `settings.title` | 学习模型路由 | Learner model route |
| `settings.mode` | 路由模式 | Route mode |
| `settings.mode.inherit` | 跟随主模型 | Follow main model |
| `settings.mode.custom` | 指定模型 | Custom model |
| `settings.provider` | Provider | Provider |
| `settings.model` | 模型 ID | Model ID |
| `settings.mode.registry` | 从列表选择 | Pick from list |
| `settings.mode.free` | 手动输入 | Type manually |
| `settings.hint` | 列表来自 ~/.dsh/settings.yaml 的 llm-pi-ai 注册表；保存后下个 learner 生效。 | List from the llm-pi-ai registry in ~/.dsh/settings.yaml; applies from the next learner. |
| `settings.registryEmpty` | 未解析到该 provider 的模型注册表，可直接输入模型 ID。 | No registry parsed for this provider; type the model ID directly. |
| `settings.save` | 保存 | Save |
| `settings.saving` | 保存中… | Saving… |
| `settings.saved` | 已保存，下个 learner 生效 | Saved; applies from the next learner |
| `settings.loadError` | 设置加载失败。 | Failed to load settings. |
| `retry` | 重试 | Retry |
| `delete` | 删除 | Delete |
| `delete.confirm` | 删除这条偏好？ | Delete this preference? |
| `delete.ok` | 确认删除 | Confirm delete |
| `cancel` | 取消 | Cancel |
| `readonly` | 只读 | read-only |
| `error.action` | 操作失败，请重试。 | Action failed. Please retry. |

（23 键 ×2 字典；插在 zh/en 各自 `close` 键前后，保持两字典书写顺序对齐。）

---

## §5 样式

- **照抄现有做法**（client.js:17-27）：全部新规则追加进 `:18` 的单行 `css` 常量，`ts_` 前缀，
  仅使用文件内已出现的 `--dsw-*` token（border-l1/l2、specific-menu、label-primary/secondary/tertiary/caption、
  interactive-bg-hover、state-success/warn/error-primary、button-ghost-active-fill、border-inverted、
  `--ds-font-family-code`），**不发明新 token**；`data-plugin-css` 幂等注入机制（:19-26）不动。
- 新增规则清单（~22 条）：

```css
.ts_iconBtnActive{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.ts_deleteBtn{flex:none;color:var(--dsw-alias-label-tertiary)}
.ts_deleteBtn:hover:not(:disabled){color:var(--dsw-alias-state-error-primary)}
.ts_readonly{color:var(--dsw-alias-label-caption);background:var(--dsw-alias-interactive-bg-hover);border-radius:8px;padding:0 6px;margin-left:6px;font-size:10px;line-height:14px;display:inline-flex;vertical-align:1px}
.ts_confirm{align-items:center;gap:8px;flex-wrap:wrap;border-top:1px dashed var(--dsw-alias-border-l2);padding-top:6px;display:flex}
.ts_confirmText{color:var(--dsw-alias-state-warn-primary);flex:none;font-size:11px}
.ts_confirmOk{color:var(--dsw-alias-state-error-primary);background:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;cursor:pointer;padding:2px 8px;font:inherit;font-size:11px}
.ts_confirmOk:disabled{opacity:.4;cursor:default}
.ts_confirmCancel{color:var(--dsw-alias-label-secondary);background:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;cursor:pointer;padding:2px 8px;font:inherit;font-size:11px}
.ts_confirmCancel:disabled{opacity:.4;cursor:default}
.ts_actionError{margin:8px 12px 0;margin-bottom:0}
.ts_settings{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding:12px}
.ts_settingsTitle{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500}
.ts_field{display:flex;flex-direction:column;gap:4px}
.ts_fieldLabel{color:var(--dsw-alias-label-secondary);font-size:11px}
.ts_fieldRow{align-items:center;gap:8px;display:flex}
.ts_input{box-sizing:border-box;width:100%;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 8px;font:inherit;font-size:12px}
.ts_modeRow{gap:4px;display:flex}
.ts_modeToggle{color:var(--dsw-alias-label-secondary);background:none;border:none;cursor:pointer;padding:0;font:inherit;font-size:11px;text-decoration:underline}
.ts_hint{color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
.ts_saveRow{align-items:center;gap:8px;display:flex}
.ts_saveBtn{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-ghost-active-fill);border:1px solid var(--dsw-alias-border-inverted);border-radius:999px;cursor:pointer;padding:4px 14px;font:inherit;font-size:12px}
.ts_saveBtn:disabled{opacity:.4;cursor:default}
.ts_saved{color:var(--dsw-alias-state-success-primary);font-size:11px}
```

（`.ts_confirmOk/.ts_confirmCancel/:disabled` 等hover 细节实现时可按既有钮风格微调，token 约定不变。）

---

## §6 测试清单（逐文件逐断言；跑法 `cd /home/CNS2026495165/dsh/dsh-taste && node --test "test/*.test.js"`）

### 6.1 test/model-registry.test.js（新建，~13 用例）

**parseProviderModels（纯函数）**：
1. 真形 fixture（复刻 settings.yaml:5-160 缩进结构，adam + opencode-go 双 provider）→
   `deepEqual(Object.keys(map).sort(), ["adam","opencode-go"])`；`map.adam` 含
   `"gpt-5.6-sol-ultra"/"glm-5.3"/"glm-5.3-flash"/"deepseek-v4-pro"`；`map.opencode-go` 含 `"minimax-m3"`。
2. 嵌套免疫：fixture 内嵌 `gemini-3.6-flash` + `input:` + `- text`（:139-142 实形）→ `"gemini-3.6-flash"`
   恰好一次；伪 `- id: fake` **钉两处、均断言不入集**：① 钉在 `input:` **同缩进（indent 10）**——弹栈后
   栈顶虽为 `models`，但 `10 ≠ listIndent(8)` → 拒收（**区分"仅四级注册重置"与"任意块键入栈重置"两种
   读法的关键用例，必须钉在 10，不得写成 12**）；② 钉在更深层（indent 12）——栈顶为 `input` 非
   `models` → 拒收（两种读法都拒，完整性对照）。
3. 排序+去重：乱序 + 重复 id 输入 → 输出 `localeCompare` 升序且无重复（与
   `["a","b"].sort((x,y)=>x.localeCompare(y))` 对拍）。
4. 缺 `llm-pi-ai` 段 → `{}`；`llm-pi-ai` 无 `providers` → `{}`；`providers: {}` 流式 → `{}`。
5. provider 无 `models:` 块（只有 apiKeyEnv/baseURL）→ 该 provider 不在映射。
6. 顶层后继段（`agent-default-model:`，仿 :161）正确终止收集。
7. 注释行/空行穿插不断链；`- id: "quoted"` 与 `- id: bare # note` → 去引号去注释；`- id: "two words"`
   （引号内含空格）→ 去引号后**保留**；`- id: "unclosed` / `- id: bare'`（引号未闭合）→ **不入集**。
8. tab 缩进行（`"\tllm-pi-ai:"`）不产生假顶层；非 2 步进缩进（3 空格层级）仍正确嵌套。
9. 非字符串/undefined/空文本 → `{}`。
10. 同名 provider 出现两次 → 列表合并去重。

**readProviderModels（fs）**：
11. 缺文件 → `{}`；路径是目录 → `{}`。
12. fixture 文件 → 与 parseProviderModels 同映射。
13. 权限拒绝（chmod 000，非 root 环境）→ `{}`（若 CI 环境跳过条件可接受，主断言 11/12）。

### 6.2 test/storage.test.js 追加 describe "deleteTasteEntries"（~7 用例）

1. 单删：种子 2 条 + 归一化 key 定位删 1 → 返回 1；文件剩 1 条（readFileSync + parseTasteFile 对拍）。
2. **删空行为**：文件仅 1 条删之 → 返回 1，`readFileSync === ""`（**文件保留**，与 forget 对齐）。
3. **边车同步 prune**：display.zh.json 种 A/B 两 key，删 A → 边车仅剩 B（loadDisplayMap 对拍）。
4. not-found：key 不在文件 → 返回 0，文件字节不变，边车 map 不变。
5. 多 target 同文件（同 fileKey）→ keys 并集、一次生效，返回总数。
6. 目标文件缺失/不可读 → 返回 0 不抛。
7. 同文件同 key 双条（防御）→ 返回 2，文件空。

### 6.3 test/bridge.test.js 追加（~18 用例；buildDeps 补 6 seam，setupBridge 复用）

buildDeps（:34-47）追加：`isValidTasteFilePath, deleteTasteEntries`（真实现）、
`saveConfig`（真 saveConfig 或 spy 包装）、`settingsPath: join(home,"settings.yaml")`、
`readProviderModels`（真实现）、`logger: undefined`。

**dispatch**：
1. 三新端点均在闭合集：`handler("deleteEntry",{...合法}) / "getSettings" / "setObserver"` 返回
   `ok:true`；`handler("evil",{})` 仍 `unknown-endpoint`（既有用例 :127-140 不动即证）。
2. hostile：`deps.deleteTasteEntries = undefined` → `deleteEntry` 落 `{code:"internal"}`（instanceof 门）。

**deleteEntry**：
3. global 正常删 + 边车 prune（种子同 6.2.1/6.2.3）→ `value {removed:1}`；文件/边车对拍。
4. project scope：镜像 :174-188 的 seeding（`projectRootFor(work)` 下建 taste 目录）→ `cwd: work` 删除成功。
5. `scope:"commandCode"` → `{code:"read-only-source"}`（**双保险后端侧**）。
6. `scope:"bogus"` / 缺 scope → `invalid-payload`。
7. `relPath:"../../etc/passwd"` 与 `"notes.txt"` → `invalid-payload`。
8. statement 空/纯符号（归一化空）→ `invalid-payload`。
9. 不存在 key → `not-found`；scope 目录整体不存在（删掉临时 global taste 目录后再调）→ 同 `not-found`
   （§1.3 `existsSync` 预检路径——不钉则该边角落落 `internal`、回归无感）。
10. project 无 cwd → `invalid-payload`。
11. 删最后一条 → 文件 `""`（readFileSync 对拍）。
12. 同 key 双条 → `{removed:2}`。

**getSettings**：
13. 无 settings.yaml → `{observer: DEFAULT_CONFIG.observer, modelsByProvider:{}}`（observer 全字段对拍）。
14. 临时 home 放 settings.yaml fixture（adam 段）→ `modelsByProvider.adam` 与 parser 输出一致；
    热读：注册后再写 fixture 再调 getSettings → 反映新文件（无缓存）。
15. 种子 config.json（custom + 独特预算）→ `observer` 精确回显（modelMode/provider/model/三预算）。

**setObserver**：
16. 合法 custom：`{modelMode:"custom",provider:"adam",model:"glm-5.3"}` → `ok`，返回 observer 全段；
    **落盘 config.json 断言**：种子先写 `learningEnabled:false` + `injection.maxChars:8000` +
    `observer.maxInputChars:24000` → 保存后三值原样保留（其他字段不丢）。
17. 合法 inherit + provider/model 透传 → `ok`，两字段按 trim 落盘。
18. 非法：`modelMode:"bogus"` / custom 空 model / custom 空 provider / provider 非字符串 /
    **`{modelMode:"custom"}`（省略 provider 与 model 两字段）** → 全 `invalid-payload` 且**不落盘**
    （config.json 不变；省略字段用例钉死"必填、不回退现值"，防实现成可选回退）。

**apply() 接线（扩展 :259-311 既有用例或新增）**：
19. 通过 apply() 注册的真实 handler 走通 `getSettings`（临时 home 的 settings.yaml fixture）与
    `setObserver`（写真实 `<home>/taste/config.json`，再 `getStatus` 回读 modelMode 已变）与
    `deleteEntry`（真实文件+边车）。

### 6.4 test/index.test.js 追加（forget 提取回归，~3 用例；复用 :64-137 setup harness）

1. `h.state.commands[0].handler({rawInput:"forget <关键词>", agent: topLevelAgent({cwd:h.work})})`：
   种子 2 条删 1 → 结果 `kind:"success"`、text `Removed 1 preference(s).`、文件剩 1、边车 prune。
2. 数字定位 `forget 1` → 同上；无匹配 → `kind:"error"`。
3. 跨 scope（project+global 同关键词）→ 两文件各删、返回总数（byScopeDir 多 scope prune 路径）。

（命令行为此前无直接测试——backfill.test.js:393/translate.test.js:241 是仅有的 handler 级测试先例；
本次提取必须把 forget 行为钉死。）

### 6.5 test/client.test.js 追加（~3 用例，字符串门 + mock 补齐）

1. requireMock 的 primitives 表（:32-37）补 `IconTrashOutline16`/`IconSettingsOutline16`（防未来渲染级测试踩空）。
2. 新字符串门（仿 :71-83 模式）：`code.includes('deleteEntry')`、`'setObserver'`、`'getSettings'`、
   `'ts_deleteBtn'`、`'ts_confirm'`、`'ts_readonly'`、`'ts_settings'`、`'scopeName !== "commandCode"'`（既有 :81
   继续成立）、`'readProviderModels' 不出现于 client`（bundle 无 host 模块引用——负向门，防误 import）。
3. 既有全部用例（factory/inject 契约/slot 键/zh-en 键集奇偶 :91/:115/:128/:138）不动即绿——
   **面板 inject 契约未变是设计约束，测试即证据**。

### 6.6 回归底线

- 既有 212 用例零回归（尤其 bridge.test.js:127-257 的形状/白名单/热读断言、client.test.js 全部、
  storage.test.js 既有 prune/边车断言）。
- 新增预估 +44（13+7+19+3+2 ≈ 44）→ 总数 ~256；README:123 测试数同步改为实际值。

---

## §7 改动清单

### 7.1 逐文件（预估行数，实现后校准）

| # | 文件 | 改动 | 预估 |
|---|---|---|---|
| 1 | `lib/model-registry.js` | **新建**：`parseProviderModels` + `readProviderModels` + 文档 | +120 |
| 2 | `lib/storage.js` | 新增导出 `deleteTasteEntries`（§2.1，插在 :610 边车 region 与 loadTasteSnapshot 之间） | +60 |
| 3 | `lib/commands.js` | forget 内联删除循环（:173-210）替换为 helper 调用；storageFns 解构/JSDoc 更新 | -25/+10 |
| 4 | `lib/bridge.js` | ENDPOINTS+3、TasteBridgeError、分发扩展、deleteEntry/getSettings/setObserver、模块头安全信封重写、deps JSDoc | +130 |
| 5 | `lib/index.js` | import 扩展（storage 2 函数 + model-registry）、`settingsYamlPath`、两处 deps 注入（commands storageFns + bridge） | +12 |
| 6 | `lib/client.js` | css 常量追加 ~22 规则；zh/en 各 +23 键；TasteSettings 新组件；TasteEntry 删除/确认/只读；面板新 state 与处理器；deleteControl/relPath 线传 | +260 |
| 7 | `test/model-registry.test.js` | **新建**（§6.1） | +200 |
| 8 | `test/storage.test.js` | 追加 describe（§6.2） | +75 |
| 9 | `test/bridge.test.js` | 追加 describe ×4 + buildDeps 扩展（§6.3） | +185 |
| 10 | `test/index.test.js` | 追加 forget 回归（§6.4） | +45 |
| 11 | `test/client.test.js` | requireMock 补图标 + 字符串门（§6.5） | +30 |
| 12 | `README.md` | GUI 段（:50-75）重写为"查看·删除·模型设置"；安全段（:67-71）补受控写面说明；命令表 forget 行（:44）注"与 GUI 删除共用 deleteTasteEntries"；:123 测试数 204→实际；:138 路线图 P1 "settings 界面"标注 learner 路由部分已交付 | ~30 处 |

净增 ~920 行（其中测试 ~535）。**零官方包改动、零新依赖**（model-registry.js 仅 node 内置；
peerDependencies 不动）。

### 7.2 明确不做（本轮边界）

- 图形化**新增/编辑**条目（`/taste remember`、edit 语义仍只在命令/learner 工具）。
- **翻译触发按钮**（GUI 触发 translate 维持禁止——zh-display-design §0.3 裁定不变）。
- GUI 修改 learningEnabled / injection / storage 开关、observer 三预算字段（maxInputChars/timeoutMs/maxTurns）。
- 删除 commandCode 条目（只读源，双保险拒绝）。
- 新增 `/taste` 子命令、命令行模型路由修改命令（`/taste model` 仍只读展示，commands.js:239-248）。
- config.json 写锁/串行化机制（风险表 #3 论证维持现状）；10s 轮询节奏、WebSocket/SSE 推送。
- settings.yaml 的**写入**（注册表只读；`agent-default-model` 不读不写）。
- 跨文件/批量删除、删除撤销。

---

## §8 风险表

| # | 风险 | 机理与证据 | 缓解/裁定 |
|---|---|---|---|
| 1 | **并发删除 vs learner 写（锁序）** | 两者同文件 RMW：deleteEntry 与 write/edit_taste_file 都在 `withTasteLock(<file>)` 内读-改-写（storage.js:258-260；learner-tools.js:133/:202）；display 维护一律在 taste 锁**释放后**（commands.js:201-202 "no lock nesting"；learner-tools.js:155-157/:230；§2.1 helper 同构） | 单向锁序（taste→display，不嵌套）无死锁；锁内重读使交错最终一致（learner old_text 未命中自纠，learner-tools.js:211-213）。10s 锁等待超时 → `internal` 错误回显，可重试 |
| 2 | **settings.yaml 格式变化** | 行扫描只认块式 YAML；流式/锚点/引号键名 → 缺项或 `{}`；官方写入器 dsh-settings-file 的 patchNode 保块式注释，实际格式稳定 | 容错矩阵（§3.4）保证任何"看不懂"不产出；空表 → GUI 自动回退自由输入（§4.4 effectiveMode）+ `settings.registryEmpty` 提示；每次 getSettings 现读 → 格式修复后下次打开即恢复 |
| 3 | **saveConfigTracked 半写** | `saveConfig`=writeFileAtomic（rename 提交，config.js:123-125）→ 崩溃无半文件；tracked 更新 stamp（index.js:396-400）→ 同步缓存即刻生效，即使 stamp 丢失也由 mtime 自愈（:388-395）。残余：load→modify→save 窗口内与 `/taste on\|off` 并发 → 整份 last-write-wins，可能丢一次开关翻转 | 与现有命令完全同暴露（setLearning 同窗口），非本变更引入；原子写保证无损坏；单用户 GUI 下窗口毫秒级。**裁定：不加锁**（§7.2），风险表留档 |
| 4 | **UI 乐观更新与轮询竞争** | 10s 轮询（client.js:344-356）与 mutation 后 refresh() 并发：先发的 getTree 可能后到，短暂回显删前树 | 设计上**不做乐观树改写**（§4.5）：以 RPC 结果 + 立即 refresh 收敛；两路 setTree 最后写者胜，下一次轮询（≤10s）或本次 refresh 必收敛；`loading` 仅禁用刷新钮不影响正确性 |
| 5 | **翻译边车残留** | 残留窗口：translate job 的 `executeWriteDisplay` 在 display 锁**外**读 live keys（learner-tools.js:368-369）→ 若其间 deleteEntry 删条目并 prune，随后 `mergeDisplayMap` 可能回写死 key | 与现有 forget 路径同源残留（非新引入）；自愈：该 scope 任一后续 forget/delete/edit 的 prune 清除；**不可见**：getTree display join 按 statement 键查（bridge.js:96），孤儿键无对应行永不显示。裁定：接受 + 留档 |
| 6 | 新旧端点错配 | 新 client（HMR 热更）+ 旧 host（未重启）：`deleteEntry/setObserver/getSettings` → `unknown-endpoint` 回显 | actionError/saveError 显示后端 message，用户可辨识需重启 host；反向（旧 client+新 host）零影响（闭合集只增） |
| 7 | 同文件同 key 多条（理论不可能） | write_taste_file 的 merge 按 key 去重（learner-tools.js:93-104） | 防御性全删 + `removed` 计数（§1.3/§6.2.7），UI refresh 后视图一致 |
| 8 | forget 行为回归 | 删除核心从 commands.js:174-210 移入 storage.js | §6.4 新增 handler 级回归测试钉死（此前 forget 无直接测试，本次补齐反而增强）；§2.2 逐点对齐表评审依据 |

---

## 附：实现顺序建议（供执行者参考，非必须）

1. `lib/model-registry.js` + `test/model-registry.test.js`（纯增量，先行验证解析器）。
2. `lib/storage.js` `deleteTasteEntries` + `test/storage.test.js` 追加。
3. `lib/commands.js` forget 切换到 helper + `test/index.test.js` 回归（此刻全库应仍 212+新增 绿）。
4. `lib/bridge.js` 三端点 + `lib/index.js` 接线 + `test/bridge.test.js` 追加。
5. `lib/client.js` GUI（css → 字典 → Entry 删除/只读 → 面板状态 → TasteSettings）+ `test/client.test.js`。
6. `README.md` 同步 + 全量 `node --test "test/*.test.js"` + 手动装机验证（README:104-117 流程，
   重启 dsh 后浏览器刷新）。

---

## 修订记录

**2026-09-03（第 2 版）**：按独立审计报告 `dsh-taste/REVIEW-gui-mutation.md`（裁决 needs-revision）修订，
**只改被点名问题**（10 项），其余原文未动。修订涉及的事实引用（行号、空 key 跳过、边车无条件重写、
existsSync 既有 import）均已在本轮亲读源码复核。

| issue | severity | 修订位置 | 处置 |
|---|---|---|---|
| #1 | MEDIUM | §3.3、§6.1.2 | 钉死 listIndent **仅在四级路径注册时重置为 -1**（收集条件保持"栈顶为已登记 models 块 && indent === listIndent"）；免疫证明"入栈（重置 listIndent）"改为"入栈（不触碰 listIndent）"，并补伪 id 同缩进（10）拒收推导与"重钉 8"措辞修正；§6.1.2 伪 `- id: fake` **必须钉在嵌套键同缩进（10）**（两读法分水岭用例，明示不得写成 12）+ 另补缩进 12 一例 |
| #2 | MEDIUM-LOW | §1.5、§6.3.18 | payload 契约统一为三字段**必填**（`provider: string, model: string`；省略即 `invalid-payload`、不回退现值）；§6.3.18 追加 `{modelMode:"custom"}`（省略两字段）→ `invalid-payload` 且不落盘 用例 |
| #3 | LOW | §2.1 | 裁定 (a)：helper 丢弃空串 key 为**有意防御收紧**（与 scopeStatementKeys storage.js:606 / coverageOf bridge.js:117 的空 key 跳过一致）；对齐表加行明示，"零语义漂移"表述相应限定（bridge 路径预校验已拒空 key 无感） |
| #4 | LOW | §1.2、§1.3、§6.3.9 | 采纳加固：deleteEntry 锁定前 `existsSync(scopeDir)` 预检，目录不存在 → `not-found`（existsSync 已在 bridge.js:1 现有 import，无需新增）；§1.2 错误码表同步；§6.3.9 补目录不存在断言；残余竞态（检查后目录被删）落 `internal` 可接受 |
| #5 | LOW | §3.3、§3.4、§6.1.7 | (a) 裸捕获首或尾字符为 `"`/`'` → 丢弃（未闭合引号 malformed 残串）；(b) 裁定：引号形式去引号后**保留**（含空格——已被 ID_RE 完整匹配验证，非残串）；"含空白的残串丢弃"改写为按捕获形式分别表述；§3.4 补两行、§6.1.7 补两断言 |
| #6 | LOW | §3.4 | 矩阵补一行：`models:` 与列表项同缩进（合法 YAML 风格）→ 该 provider 缺失、GUI 回退自由输入（真实文件与官方写入器均两步进缩进，当前无害；弹栈规则调整非本轮范围） |
| #7 | INFO | §1.6 | 安全信封补一句：getSettings 回显 observer 路由三字段系**有意变更**（表单回填需要；getStatus:181 仍最小回显，两者不矛盾），仍无任何密钥/路径 |
| #8 | INFO | §2.2 | 注记：commands 侧现**硬依赖** storageFns.deleteTasteEntries（残缺注入从"降级可用"变整条报错）；index.js 恒全量注入 + §6.4 apply() 真注入回归钉住 |
| #9 | INFO | §0.2、§3.2 | 行号修正（亲读复核）：commands.js 匹配段 :165-171 → **:165-172**；index.test.js DSH_HOME :58-59 → **:78-79** |
| #10 | INFO | §2.1 | 注记：pruneDisplayMap 无条件重写边车（storage.js:590），not-found 路径亦字节等价重写（仅 mtime 抖动）；裁定**接受现状**保持与 forget 完全同构，不在 `removed === 0` 时跳过 prune |
