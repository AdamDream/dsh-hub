# preset 热重载决策简报

- 结论对象：**是否要做「preset 热重载」**——改 `~/.dsh/.agent-presets/standard-glm/agent.cordis.yml` 后，新派发的子代理立即用新 model，且不重启进程。
- 证据基线（只读、本会话实测）：DSH 实现 checkout `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/`；下文所有路径若以 `@/` 开头，均指该 checkout 下的 `node_modules/@deepseek-ai/`。
- 标注约定：**【代码确证】**＝有原文支撑；**【推断】**＝由原文推导、未直接观测；**【无法确证】**＝本次未找到代码或运行时证据。

---

## 0. 结论速览

1. **机制假设成立**：子代理派发确实走「复用父 standing mount」的 `composeFrom`，绕开 `ensureStanding` 的 stamp 重挂载检查。**【代码确证】**
2. **但「改 preset 文件不热」这个全称表述不准确**：`ensureStanding` 里**有** stamp 检查（`@/dsh-agent-presets/lib/index.js:1130-1159`），**新建会话**走 `AgentPresets.mount()` → 会重新挂载 → 拿到新 model。不热的是**编辑前已存在的会话**（及其子代理）。**【代码确证】**
3. 因此「preset 热重载」要真正生效于已存在会话，唯一途径是**中途给活会话换组合**；而这正是仓库明示拒绝的操作（`recompose` 只允许「未产生任何内容」的会话，apiproxy 用 `agent-preset-locked` 拦住）。**【代码确证】**
4. **推荐：不做**。若组织上必须让 preset 文件成为唯一真源，只做路线 C 的最小形态（单文件、热、小工作量），其收益与现有 settings 层重叠。

---

## 1. 机制实锤

### 1.1 关键纠正：`ensureStanding` 的 stamp 重挂载检查**存在**，且对 `mount()` 路径有效

`@/dsh-agent-presets/lib/index.js:1129-1159`（原文）：

```js
1129:  /** Resolve (or create, single-flight) the standing mount of one preset. */
1130:  async ensureStanding(preset) {
1131:    const pending = this.standing.get(preset.id);
1132:    if (pending !== void 0) {
1133:      const mounted = await pending;
1134:      const current = await compositionStamp(preset.path);
1135:      if (current === void 0 || sameStamp(mounted.stamp, current)) return mounted;
1136:      if (this.standing.get(preset.id) === pending) this.standing.delete(preset.id);
1137:      return this.ensureStanding(preset);
1138:    }
1139:    const created = (async () => {
1140:      const key = { agentPreset: preset.id };
1141:      const scope = createScope(this.selfCtx, key);
1142:      try {
1143:        const stamp = await compositionStamp(preset.path);
1144:        if (stamp === void 0) throw new PresetMountError(preset.id, `composition file is unreadable: ${preset.path}`);
1145:        await mountPreset(scope.ctx, preset);
```

配套的 stamp 定义 `@/dsh-agent-presets/lib/index.js:1161-1176`：

```js
1161: /** Read one composition file's stamp, or undefined when it cannot be statted. */
1162: async function compositionStamp(path) {
1164:    const { mtimeMs, size } = await stat(path);
1175: function sameStamp(a, b) {
1176:   return a.mtimeMs === b.mtimeMs && a.size === b.size;
```

设计意图在类的 docstring 里写得很直白 `@/dsh-agent-presets/lib/index.js:922-932`：

```
923:  * Standing mounts by preset id, single-flight so two agents racing the
926:  * settled success serves until the composition FILE visibly changes — each
927:  * generation records its file stamp, and a stale stamp starts the next
928:  * generation for sessions created afterwards. Sessions already joined keep
930:  * the generation they run on; a superseded one is never disposed while the
931:  * process lives (reclaimed only by whole-tree teardown), so editing files
932:  * is bounded by how often compositions change, not by session count.
```

**注意 928 行「for sessions created afterwards」和 929-930 行「Sessions already joined keep the generation they run on」**——这就是全部真相：文件变化只对**之后创建的会话**生效。

`ensureStanding` 的生产调用点（`mount()` 路径）`@/dsh-agent-presets/lib/index.js:954-960`：

```js
954:  async mount(agentCtx, id) {
957:    const preset = await this.resolveMountable(id);
958:    const standing = await this.ensureStanding(preset);
959:    this.bindings.set(agentKey, bindScopeParent(agentKey, standing.key));
```

而 `mount()` 在本部署里只有一处生产调用者——会话创建装配 `@/dsh-host-apiproxy/lib/index.js:1775-1785`：

```js
1782:        setup: async (agentCtx) => {
1783:          installSelection(agentCtx);
1784:          await presets.mount(agentCtx, resolvedId);
```

### 1.2 子代理路径：`composeFrom` 是 **bind，不是 mount**，天然绕开 stamp 检查

`@/dsh-agent-presets/lib/index.js:962-995`（docstring 原文，984-994 为函数体）：

```
963:  * Join one agent to the SAME standing composition another already runs on.
965:  * This is how a child agent inherits its parent's capabilities. It is a bind,
966:  * not a mount: the parent's generation is already composed, so the child gets
967:  * that exact instance — the same plugin objects, the same tool registrations,
968:  * the same prompt sections. Re-resolving the parent's preset by id instead
969:  * would re-read the roster, and a composition file edited since the parent
970:  * started would hand the child a DIFFERENT generation than the one its
971:  * parent's history was produced under (and a preset deleted since would fail
974:  * Synchronous, and with no composition failure mode of its own — it reads no
975:  * roster, mounts nothing, and touches no file — which is what lets a child
976:  * creation window use it: the two in-process subagent drivers compose their
977:  * children inside a synchronous `setup`.
988:  composeFrom(agentCtx, parentCtx) {
991:    const standing = standingMountFor(parentCtx);
992:    if (standing === void 0) return void 0;
993:    this.bindings.set(agentKey, bindScopeParent(agentKey, standing.key));
994:    return standing.presetId;
```

`standingMountFor` 按 scope parentage 找**已挂载的实例**（不碰文件）`@/dsh-agent-presets/lib/index.js:610-616`：

```js
610: function standingMountFor(agentCtx) {
613:   const standingKey = scopeParentOf(agentKey);
615:   return livePresetMounts().find((candidate) => candidate.key === standingKey);
```

**本部署两条子代理工具链的调用点（本部署 preset 用的是 `provider: spawn` 与 `provider: fork`）**：

- `spawn`：`~/.dsh/.agent-presets/standard-glm/agent.cordis.yml` 中 `provider: spawn` → `@/dsh-subagent-spawn-in-process/lib/index.js:13` `providerName: z.string().default("spawn")` → `@/dsh-subagent-in-process-driver/lib/index.js` 的 `startInProcessRun`。
- `fork`：`@/dsh-subagent-fork-in-process/lib/index.js:49` `return startInProcessRun(request, {...seed})` —— 同一函数。

`@/dsh-subagent-in-process-driver/lib/index.js:166-188`（同步 setup 窗口，原文）：

```js
166:  const setup = (childCtx) => {
167:    appendDelegatedPolicyOverrides(childCtx.agent.session, inherited);
168:    applyChildComposition(childCtx, parent, {
169:      persona: request.persona,
170:      toolFilter: request.toolFilter
171:    });
...
181:  return drivePublishedRun(await parent.ctx.agents.create({
182:    sessionId: childId,
183:    meta: childSessionMeta(parent, childDepth, activationBoundary),
185:    agentOptions: resolveChildAgentOptions(parent, request.agentOptions, childDepth),
186:    signal: request.signal,
187:    setup
```

`@/dsh-subagent/lib/index.js:597-599`：

```js
597: function applyChildComposition(childCtx, parent, composition) {
598:   childCtx.get("agentPresets")?.composeFrom(childCtx, parent.ctx);
```

冷恢复（continuable 子代理重新物化）也走同一条 `@/dsh-subagent/lib/types/continuation.js:736`：

```js
736:            applyChildComposition(childCtx, parent, inputs.composition);
```

这套契约还被写成面向模型的 API 说明 `@/dsh-tool-cordis/lib/index.js:129`（签名原文含同一段「edited since the parent started would hand the child a DIFFERENT generation」论述）——**即：这条设计是公开契约，不是遗漏。**

### 1.3 子代理的 model 值从哪里来（把「文件 → 子代理 route」接起来）

- preset 里的两处静态值：`~/.dsh/.agent-presets/standard-glm/agent.cordis.yml` 的 `tool-subagent` / `tool-subagent-fork` 行 `config.agentOptions.{provider,model}`。每个 standing mount 生成一个**新的工具插件实例**，其 `config.agentOptions` 在 mount 时固定。
- 派发时读取 `@/dsh-tool-subagent/lib/index.js:530`：

```js
530:   const effectiveAgentOptions = effectiveConfiguredAgentOptions(runtimeCtx, config.agentOptions);
```

- 覆盖规则 `@/dsh-tool-subagent/lib/index.js:104-136`（**每次派发热读 settings 命名空间**）：

```
108:  * hot-reloaded `dsh-subagent` settings namespace over the preset-static
109:  * agentOptions: a non-empty settings `provider`/`model` overrides the preset
113:  * Read per dispatch, so editing settings.yaml takes effect on the next
119: function effectiveConfiguredAgentOptions(runtimeCtx, configured) {
123:     settingsValue = ... settings.get("dsh-subagent");
127:   if (settingsValue === void 0 || ...) return configured;
128:   const provider = typeof settingsValue.provider === "string" && ... ;
129:   const model = typeof settingsValue.model === "string" && ... ;
130:   if (provider === void 0 && model === void 0) return configured;
133:     ...(model === void 0 ? {} : { model })
```

- 该值经 `@/dsh-subagent/lib/index.js:522-539` `resolveChildAgentOptions(parent, requested, childDepth)`（533 行 `...requested` 覆盖父 route）落到子代理的 `agentOptions`。

### 1.4 完整因果链（编号）

1. 部署默认 preset = `standard-glm`（`~/.dsh/settings.yaml:150-151` `agent-presets: default: standard-glm`；`~/.dsh/profiles/web/cordis.patch.yml:11-13` 同值）。
2. **会话创建时**：apiproxy `composeAgent` → `presets.mount(agentCtx, id)`（`@/dsh-host-apiproxy/lib/index.js:1784`）→ `ensureStanding`（`index.js:958`）。此处**有** stamp 比对：文件变了 → 删 map 条目 → 递归重挂载新 generation（`index.js:1134-1137`），新 generation 的 `tool-subagent` 实例带新 `agentOptions`。→ **新会话热。**
3. **子代理派发时**：`dsh-tool-subagent.execute` 读自己的 `config.agentOptions`（**本 generation 的值**，`dsh-tool-subagent/lib/index.js:530`），settings 命名空间为空时原样返回（`:127`）→ `agents.create({ setup })`。
4. `setup` 是同步回调（`dsh-subagent-in-process-driver/lib/index.js:166`），里面调 `applyChildComposition` → `composeFrom(childCtx, parent.ctx)`（`dsh-subagent/lib/index.js:598`）。
5. `composeFrom` 沿父的 scope parentage 取**父所在的旧 generation**（`dsh-agent-presets/lib/index.js:991` `standingMountFor(parentCtx)`），把子代理绑上去（`:993`）。**全程不读文件、不查 stamp、不涉及 roster**（docstring `:974-978` 明说）。
6. 结果：编辑 preset 文件后，**只要父会话是编辑前创建的**，其子代理永远拿到父那一代的 `agentOptions` → 旧 model。进程重启前不会变。

已实测「41 秒后派发的子代理仍用旧 model」与该链条**完全一致**：那 41 秒里的派发属于编辑前创建的父会话。**【推断】**（运行时状态未在本次会话中直接观测；机制层面为【代码确证】）

### 1.5 与上一段假设的差异（按要求直说）

| 假设 | 代码裁决 |
|---|---|
| 「子代理派发走 `bindScopeParent` 复用父 standing mount，绕开 `ensureStanding` 的组合文件 stamp 重挂载检查」 | **完全成立【代码确证】**（`index.js:593→991` + `:1130-1159`；调用点 `dsh-subagent/lib/index.js:598`、driver `:172`） |
| 「改 preset 文件后新派发的子代理仍用旧模型」→ 因此「preset 文件不热」 | **需要限定**：不热的是**编辑前已存在的会话**。**新建会话是热的**（stamp 检查在 `mount()` 路径上真实生效）【代码确证】。原表述把「会话级作用域」误当成「进程级作用域」。 |

顺带修正一处**部署内注释**：`~/.dsh/profiles/web/cordis.patch.yml:10` 写「组合变更需重启 DSH 后对新会话生效」——与上面代码不符（对 preset 组合而言，新会话无需重启；对 patch 层而言 HMR 本就热重载，见 `dsh/lib/profile-boot-DG5t9aNs.js:264-273`）。**【推断】**（注释未随 stamp 检查更新；未找到该注释的维护记录）

### 1.6 附带发现（对路线选择有直接影响）

1. **stamp 只覆盖顶层 `agent.cordis.yml`**：`preset.path = join(directory, COMPOSITION_FILE)`（`@/dsh-agent-presets/lib/index.js:249-255`），而 `mountPreset` 用 `Include` 子类加载（`:707-713`、`:469`）。若某 preset 用 `include:` 引用外部文件，改被引用文件**不会**改 stamp。本部署 `standard-glm/agent.cordis.yml` 自包含（无 include），故当前无影响。**【代码确证】**（stamp 语义）+**【推断】**（include 场景后果）
2. **旧 generation 在被取代后永不 dispose**：`:1136` 只删 `standing` map 条目，`:929-931` 明说「never disposed while the process lives」。这是**冷读旧 transcript 仍能解析 tool presenter** 的前提（`standingKeyFor` `:1125-1128` → `ensureStanding`；`livePresetMounts` `:550-553`）。→ 任何「就地替换 generation」的改动都会打断冷读。**【代码确证】**

---

## 2. 要做热重载，最小改动是什么（路线对比）

> 前置约束（决定路线可行性的硬边界）：子代理创建窗口**必须同步**（`dsh-subagent-in-process-driver/lib/index.js:166` 的 `setup` 是同步箭头函数；`dsh-agent-presets/lib/index.js:974-978` 明确说明 `composeFrom` 之所以能用于该窗口，正因为它同步、不碰文件）。

### 路线 A：子代理路径也走 stamp 检查 / 让子代理绑到「最新 generation」

**A1 —— 把 stamp 检查塞进 `composeFrom`：不可行。** stamp 检查是 `stat`+可能的重挂载，重挂载是异步且可能失败（`:1145` `await mountPreset`）。同步函数里做不到；改成 async 就要改 `agents.create({setup})` 的契约，波及 `dsh-subagent`（`lib/index.js:597`、`lib/types/continuation.js:736`）、`dsh-subagent-in-process-driver`（`:166`）、`dsh-subagent-spawn-in-process`、`dsh-subagent-fork-in-process`。**冷面/热面**：本身热，但改的是**宿主包**（`node_modules` 内），本部署实际生效需重启进程（模块已加载）。**【代码确证】**（同步约束）+**【推断】**（改 npm 包必须重启）

**A2 —— 在 `execute` 里先异步解析「最新 generation」，再把子代理绑上去（可行形态）：**

- 改点：
  - `@/dsh-agent-presets/lib/index.js` 新增/复用异步入口：`standingKeyFor(id)` 已存在且**就走 stamp 检查**（`:1125-1128`）；只需再给 `composeFrom` 加一个「指定 standing key」重载，约 **10-15 行**。
  - `@/dsh-tool-subagent/lib/index.js` 在 `execute` 内（`:530` 附近，异步区）先 `await agentPresets.standingKeyFor(composedPreset)`，把 key 放进 `request`，约 **10-15 行**。
  - `@/dsh-subagent/lib/index.js:597` / driver `:172` 透传 key，约 **5-10 行**。
  - 合计 **约 30-45 行，跨 3 个包**。`agentPresets` 在 preset 子树内可见是**代码确证**（`@/dsh-subagent/lib/index.js:559` 用 `parent.ctx.get("agentPresets")`，而 `parent.ctx` 正是 preset 子树下的 agent ctx）。
- 冷面/热面：改的是已安装 npm 包 → **需重启**（同 A1 理由）。
- 机制代价：**直接违反** `composeFrom` 的设计意图（`:969-972`：文件已改则「hand the child a DIFFERENT generation than the one its parent's history was produced under」）。子代理会在父的旧组合之外运行新组合，同一血缘里出现两套工具/prompt。
- 性能：每次派发 **1 次 `stat`**（stamp 比对）；仅在文件变化时多一次 mount。可忽略。

### 路线 B：给 preset 文件加 watch 失效

- 机制与可实现性：进程内**已有** HMR 能力且有现成先例——`@/dsh/lib/profile-boot-DG5t9aNs.js:257-262` 在 boot 时装载 `@deepseek-ai/cordis-plugin-hmr`（`config: { root: [] }`），并用 `watchUserPatches` 精确监听两个 patch 文件（`:264-273`）。`@/cordis-plugin-hmr/lib/index.js:107-165` 的 `registerConfig(filename, refresh)` 就是「watch 单个精确路径 + 串行回调 + 可 disposer」的公开 API（`:119` 签名、`:125` `watch(root,{...depth})`、`:139-141` add/change/unlink、`:146-162` disposer）。**代码确证**
- 改点：在 `@/dsh-agent-presets/lib/index.js` 的 `AgentPresets` 里，对每个已发现 preset 调 `ctx.get("hmr")?.registerConfig(preset.path, () => this.standing.delete(preset.id))`，约 **15-25 行**（含 roots 遍历与 disposer 管理）。冷面/热面：改宿主包 → 本部署需重启一次；之后 watch 生效无重启。
- **关键裁决：单独做 B 收益为零。** 因为 `ensureStanding` 已经在下一次 `mount()` 时自检 stamp（`:1134-1137`），watch 只是**提前**删掉 map 条目，而 map 条目的删除对**已绑定的父会话**没有任何影响（父的 scope chain 指向旧 generation 对象，不查 map）。→ 对「41 秒后派发的子代理」这个目标场景**零改善**。**【代码确证】**
- 性能：每 preset 一个 chokidar watcher（`@/cordis-plugin-hmr/lib/index.js:3` `import { watch } from "chokidar"`），深度为文件所在层；空闲开销为 fs 事件监听，可忽略。

### 路线 C：preset 模型解析改为「每次派发热读文件」（最贴目标，且真·热）

- 改点：`@/dsh-tool-subagent/lib/index.js:119-136` 的 `effectiveConfiguredAgentOptions` 之前/之内，增加一个「从 preset 文件热读 route」的来源：
  1. 用 `composedPreset(runtimeCtx)` 拿 preset id（`@/dsh-agent-presets/lib/index.js:1005-1007`）；
  2. `agentPresets.read(id)`（`:1027-1029`）→ `readFile(preset.path)`（`:333-335`）；
  3. `js-yaml` 解析 → 找 `config.toolName === 本实例 toolName` 的行 → 取 `config.agentOptions`。
  约 **40-60 行，单文件**。
- 冷面/热面：**真·热**——`readFile` 每次派发新读，不需要重启、不需要新会话、不需要动 mount（与 settings 层同一机制：`runtimeCtx.get(...)` + 每派发求值）。**【代码确证】**（同层 `settings.get` 的既有热语义，`@/dsh-tool-subagent/lib/index.js:113`「Read per dispatch, so editing settings.yaml takes effect on the next delegation without a restart.」）
- 性能：每派发 **1 次 `readFile` + 一次 YAML 解析**（现文件 13,431 字节）。量级 **≈1-3 ms**，相对一次子代理派发可忽略；但**若用 `read(id)` 会先走 `resolve` → `list()` → `discoverPresets`，即每次派发都 `readdir` 全部 preset root 并对每个 preset 读 `preset.yml`**（`index.js:270-276`、`236-264`）——这条路必须**缓存 `preset.path`**，只热读文件内容。
- 定位风险：靠 `toolName` 匹配行属于**约定式定位**（`tool-subagent` / `tool-subagent-fork` 两行靠 `config.toolName` 区分），不如「改 settings」干净。

### 路线 D（现状）：不动代码，继续用 settings 层 / 设置页

- 改点：**0 行**。
- 命名空间 `dsh-subagent`（仅 `provider` / `model` 两键）：`~/.dsh/profiles/node_modules/@local/dsh-subagent-model/lib/index.js:29` `DEFAULT_ROUTE = { provider: "adam", model: "deepseek-v4.1-flash" }`、`:39-40` `provider: z.string(), model: z.string()`；读取侧 `@/dsh-tool-subagent/lib/index.js:119-136`，**每派发热读**。
- 冷面/热面：**热**，机制理由同上。
- 当前部署状态：`~/.dsh/settings.yaml` **没有 `dsh-subagent` 顶层键**（grep 无匹配），故今天子代理实际走的仍是 preset 静态值（`:127` 原样返回 `configured`）。**代码确证 / 配置确证**

### 路线对比表

| 路线 | 改点/行数 | 冷/热（机制理由） | 每派发开销 | 对目标场景有效？ |
|---|---|---|---|---|
| A1 composeFrom 内查 stamp | 4+ 包，50+ 行 | 冷（改 npm 包需重启）；且技术上需破坏同步契约 | +1 stat | ✗（不可行） |
| A2 execute 预解析 generation | 3 包 ~30-45 行 | 冷（改 npm 包需重启） | +1 stat | ✓ 但违反设计不变量 |
| B watch 失效 | 1 包 ~15-25 行 | 冷改一次，之后热 | fs 事件 | **✗（与现有 stamp 检查重复，零改善）** |
| C 每派发热读 preset 文件 | 1 文件 ~40-60 行 | **热**（值级求值，不走 mount） | +1 readFile + YAML | ✓ |
| D 保持 settings 层 | 0 | **热** | 0 | ✓（=现状） |

---

## 3. 爆炸半径

### 3.1 影响的所有面（按路线）

- **A2**：
  - 影响**所有 preset**：`standing` map 与 `standingsKeyFor` 都是 per preset id（`index.js:933`、`:1140`）。任何 preset 一旦改动，其子代理都开始「跨代际」。
  - 影响**所有会话类型**：`applyChildComposition` 被 spawn（`dsh-subagent-in-process-driver/lib/index.js:172`）、fork（`dsh-subagent-fork-in-process/lib/index.js:49`）、continuable 冷恢复（`dsh-subagent/lib/types/continuation.js:736`）共用【代码确证】；preset 内的 `tool-ralph`（`subagentProvider: spawn`）经同一 spawn provider 走同一条路，`tool-workflow` 的 worker 路径本次未逐行追踪 → **【推断】**。
  - 影响**依赖 mount 语义的其它插件**：`dsh-tool-cordis` 把 `composeFrom` 的「same generation」契约作为 API 文档发布给模型（`@/dsh-tool-cordis/lib/index.js:129`）——改掉行为即让这份文档失真。
  - 影响**冷读链路**：旧 generation 常驻是冷读 presenter 解析的前提（`index.js:1125-1128`、`:929-931`）。A2 会让「父会话历史用什么组合重建」与「子会话历史用什么组合重建」分叉。
- **B**：影响 `AgentPresets` 服务与其 HMR 依赖（需 `--expose-internals`：`@/cordis-plugin-hmr/lib/index.js` 构造器 `if (!this.ctx.loader.internal) throw`）。功能面影响≈0（见 §2 裁决）。
- **C**：影响面**最小**——只影响子代理 route 这一个**值**；不动 mount、不动 binding、不动工具注册表与 prompt。副作用是「preset 文件」与「settings 文件」争夺同一字段的**优先级语义**需要显式定义（settings 优先？文件优先？），否则会出现两个真源。
- **D**：面为 0。

### 3.2 中间态风险

| 风险 | 裁决 |
|---|---|
| 半重挂载 | **不存在于现状**：`ensureStanding` 失败路径 delete + `await scope.dispose()`（`index.js:1151-1155`），成功路径不 dispose 旧的——不存在「拆一半」。【代码确证】 |
| 旧会话被中途换 model / 换工具集 | **现状不发生**（`:929-930` 明说「Sessions already joined keep the generation they run on」；apiproxy 另有 `agent-preset-locked`：「session ... has already started; its agent preset is fixed」，`@/dsh-host-apiproxy/lib/index.js:3272-3276`）。**A2 会重新引入该风险**；A1 若改成 async 也会。【代码确证】 |
| in-flight 子代理 model 漂移 | **现状不发生**：子代理在 creation window 内一次性绑定（同步 `setup`），此后不再重解析（`dsh-subagent-in-process-driver/lib/index.js:166-188`）。**A2 会让「同一父并发派发的两个子代理」在不同瞬间落在不同 generation**（取决于 stat 时机），这是新的非确定性。【推断】 |
| 「孤儿 generation」常驻内存 | **现状即如此且有文档背书**（`index.js:929-931`「never disposed while the process lives… bounded by how often compositions change」）。反复改 preset 会线性堆积 generation（每个含整套插件实例 + fiber）。这是**既有**成本，不是新风险，但**A2/C 若把「改文件」变成常规操作会放大它**。【代码确证】 |
| prompt/persona 行文本热改 | 若热改 preset 的 prompt 行（如 `persona.text`、plan-mode `section`），会与「model-visible ⟺ logged」冲突（同会话历史 prompt 与新 prompt 混在一份日志）。本次**未在代码里定位到针对 preset 热换 prompt 的显式约束实现** → **【无法确证】**；A2 会实际触发该问题。 |

---

## 4. 与现状的关系：settings 层已能热换子代理模型的前提下，preset 热化还能多解决什么？

先划清能/不能：

- settings 命名空间**只有两个键**：`provider` / `model`（`~/.dsh/profiles/node_modules/@local/dsh-subagent-model/lib/index.js:39-40`；读取侧只取 `provider`/`model`，`@/dsh-tool-subagent/lib/index.js:128-135`）。**【代码确证】**
- 因此 settings **不能**改：`maxDepth`、`persona`、`toolFilter`、`backgroundMode`、`toolName`、`provider`（A2 意义上的 codex/claude-code 后端）、整行的启用/`disabled`。**【代码确证】**

剩下的「preset 热化独有」场景，**必须同时满足两个条件才有价值**：① 不是 model 值（否则 settings 已覆盖）；② 作用对象是**已存在的会话**（否则新会话本已热，见 §1.1）。逐一核：

1. **给已存在会话的子代理工具热加 `maxDepth` / 改 `persona` / 改 `toolFilter` / 换后端 provider（codex、claude-code）**——A2 能做，但这正是「mid-conversation 换组合」，apiproxy 对会话级的同类操作直接拒绝（`agent-preset-locked`，`@/dsh-host-apiproxy/lib/index.js:3272-3276`），`recompose` 的 docstring 也把它限制在「未产生任何内容」的会话（`@/dsh-agent-presets/lib/index.js:1084-1098`）。→ **能做但违背框架的既有不变量。**
2. **给已存在会话热加/删一整行**（例如加 `tool-ralph`、启用 `tool-subagent-codex`、开 `tool-workflow`）——需要新的工具注册，**只有新 generation 能给**；A2 只能让**子代理**拿到新工具集，父会话仍然没有。→ 场景 2 实际价值≈只惠及子代理。
3. **热改其它行 config**（ralph `maxRounds`、compaction `thresholdChars`、`sampleOverCapGlobResults`）——同上：只对子代理生效，且这些都不是 model 值。
4. **热改 prompt 文本行**（`persona.text`、plan-mode `section`）——收益看似最大（不必为改一段 prompt 而重开会话），但直接撞上「model-visible ⟺ logged」；本次**无法确证**框架是否允许，风险自负。
5. **一个常见的误解场景**：「我在长时间的主会话里想改子代理模型但我现在不想走设置页」——**settings 层已经完全覆盖**（一次 `settings.yaml` 编辑或设置页点击，下一派发即生效）。preset 热化在此**净增量为 0**。

**结论（明确表态）：收益有限。**

- 若「preset 热重载」被理解为「改 preset 文件后不用重启进程」——**这件事对新建会话今天就已经成立**，不需要做任何事。
- 若被理解为「改 preset 文件后**当前这个已开着的会话**的下一轮派发立即生效」——对 **model 值**而言 settings 层已覆盖（净增量 0）；对**非 model 行**而言，能生效的只有「子代理那一侧」，而它要付的代价是打破「child 与 parent 同 generation」的公开契约（`@/dsh-agent-presets/lib/index.js:969-972`、`@/dsh-tool-cordis/lib/index.js:129`）与引入跨代际不一致。**不值得。**

---

## 5. 回滚

| 路线 | 回滚方式 | 粒度 | 是否需重启 | 残留 |
|---|---|---|---|---|
| A1 | 还原 `dsh-agent-presets` / 4 个 subagent 包的 `lib/index.js`（保留改前的 sha 副本） | 包级 | 是（模块已加载） | 无（纯函数逻辑） |
| A2 | 同上，另加 `dsh-tool-subagent`；把 `composeFrom` 的 key 重载与 `request.standingKey` 字段一起删 | 包级（跨 4 包，必须整体回滚，否则参数语义不一致） | 是 | 已绑定到「新代际」的**存量子代理**无法回退（scope 绑定不可逆，只有 `rebind` 能改且需 binding 句柄 `index.js:1109-1111`）；这些子代理会随其会话结束自然消失 |
| B | 删掉 `registerConfig` 调用（约 1 个 hunk）；若 watch 已注册，其 disposer 是 `ctx.effect` 管理的，随插件卸载自动关闭（`@/cordis-plugin-hmr/lib/index.js:146-162`） | 单函数 | 是（改包） | 无 |
| C | 还原 `@/dsh-tool-subagent/lib/index.js` 的 `effectiveConfiguredAgentOptions`（**热**：该函数在派发时求值，但模块已被加载 → 实际仍需一次进程重启才装载旧模块） | 单函数（1 个 hunk） | 是（改包；这是所有路线共同约束） | 无状态残留 |
| D（现状） | 无需回滚 | — | — | — |

> 统一约束：本部署的插件是从 `<checkout>/node_modules/` 加载的 npm 包，**任何宿主包改动都要重启进程才生效**（这也意味着：路线 A/B/C 的「开发成本」之外还有一次重启成本——而重启正是本次想避免的东西；**C 的收益是「此后永不再需要为改 model 重启」，这一点是真实且唯一的净收益**）。**【推断】**

---

## 6. 推荐

### 裁决：**不做**（工作量等级：无）

一句话理由：`ensureStanding` 的 stamp 检查**已经**让 preset 改动对新建会话即时生效，而唯一还未热的场景（已存在会话）真正的拦路石不是 stamp，而是「会话中途不可换组合」这一被 `recompose`/`agent-preset-locked` 明示的不变量；用 A2 强拆它换来的只是「子代理拿到新组合、父会话还在旧组合」的跨代际不一致，收益明显低于代价。

### 若必须落地一条最小路线

**只做路线 C 的最小形态**（工作量等级：**小**：`@/dsh-tool-subagent/lib/index.js` 单文件 ~40-60 行，每次派发 1 次 `readFile` + YAML 解析，缓存 `preset.path` 以避开 `read(id)` 的全量目录扫描）——
理由：它是唯一「真·热」且不改 mount / 不改 binding / 不引入跨代际不一致的路线；但**它解决的是 model 值，而 settings 层已解决同一个值**，所以只有在你明确要求「preset 文件必须是唯一真源、settings 段只是覆盖」时才值得做；否则请直接把 §2 路线 D 写进 `AGENTS.md`（现状已如此）作为最终答案。

### 明确不要做

- **路线 B**：与现有 stamp 检查功能重复，对目标场景零改善（§2 裁决）。
- **路线 A1**：技术上要求破坏子代理创建窗口的同步契约。
- **路线 A2**：破坏 `composeFrom` 的公开契约（`@/dsh-agent-presets/lib/index.js:969-972`、`@/dsh-tool-cordis/lib/index.js:129`），是本次唯一会引入「中间态/漂移」的路线。

### 顺手建议（0 风险，不必与本决策绑定）

- 修正 `~/.dsh/profiles/web/cordis.patch.yml:10` 的注释「组合变更需重启 DSH 后对新会话生效」——它与 `@/dsh-agent-presets/lib/index.js:1130-1159` 不符，是「preset 不热」这一误解的传播源之一。**【推断】**

---

## 附：证据索引（全部为本次会话实测读取）

| 主题 | 路径:行 |
|---|---|
| stamp 重挂载检查 | `@/dsh-agent-presets/lib/index.js:1130-1159`、`:1161-1176` |
| 设计意图（新会话才热） | `@/dsh-agent-presets/lib/index.js:922-932` |
| `mount()` → ensureStanding | `@/dsh-agent-presets/lib/index.js:954-961` |
| 唯一生产调用者（会话创建） | `@/dsh-host-apiproxy/lib/index.js:1775-1785`（`presets.mount` 在 `:1782`） |
| `composeFrom`（bind 非 mount） | `@/dsh-agent-presets/lib/index.js:962-995` |
| `standingMountFor` | `@/dsh-agent-presets/lib/index.js:610-616` |
| 子代理同步创建窗口 | `@/dsh-subagent-in-process-driver/lib/index.js:166-188` |
| `applyChildComposition` → composeFrom | `@/dsh-subagent/lib/index.js:597-599`；`:172`（driver）；`@/dsh-subagent/lib/types/continuation.js:736` |
| spawn / fork 后端映射 | `@/dsh-subagent-spawn-in-process/lib/index.js:13`；`@/dsh-subagent-fork-in-process/lib/index.js:49` |
| settings 层（每派发热读，只 2 键） | `@/dsh-tool-subagent/lib/index.js:104-136`、`:530` |
| settings 命名空间定义 | `~/.dsh/profiles/node_modules/@local/dsh-subagent-model/lib/index.js:29,39-43` |
| 当前 settings 无 `dsh-subagent` 段 | `~/.dsh/settings.yaml`（无该键；`agent-presets.default` 在 `:150-151`） |
| 会话中途不可换组合 | `@/dsh-host-apiproxy/lib/index.js:3272-3276`；`@/dsh-agent-presets/lib/index.js:1084-1098` |
| 旧 generation 不 dispose / 冷读依赖 | `@/dsh-agent-presets/lib/index.js:929-931`、`:1125-1128`、`:542-553` |
| preset.path 只指顶层文件 | `@/dsh-agent-presets/lib/index.js:236-264`（`:249`） |
| API 契约对外发布 | `@/dsh-tool-cordis/lib/index.js:129` |
| HMR 可用 + 先例 | `@/dsh/lib/profile-boot-DG5t9aNs.js:257-273`；`@/cordis-plugin-hmr/lib/index.js:107-165` |
| 部署 preset 与工具行 | `~/.dsh/.agent-presets/standard-glm/agent.cordis.yml`（`tool-subagent` / `tool-subagent-fork` 行 `agentOptions`） |
