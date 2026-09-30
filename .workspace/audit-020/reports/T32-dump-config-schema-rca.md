# T32 — `--dump-config-schema` rc=1 机制级根因定位（只读调查）

- 轨道：T32（缺陷根因定位）
- 结论时间：本轮实测（2026-09-29）
- 被测对象：`@deepseek-ai/dsh` **0.2.0-rc.1**（global 布局：`.workspace/audit-020/assembly-020/prefix-cli/lib/node_modules/`）
- 对照对象：`@deepseek-ai/dsh` **0.1.7-rc.2**（`~/.npm-global-dsh017/lib/node_modules/@deepseek-ai/dsh/`）
- 本轮原始证据：`.workspace/audit-020/t32/out/`（见 §9 证据清单，含 md5）
- 约束遵守：仅在本轨道目录 `.workspace/audit-020/t32/**` 下写入；未改动 `assembly-020/`、`~/.dsh/**`、`~/.npm-global*/**`；未启动任何监听端口的服务；未发起模型请求。

---

## 1. 结论摘要

**判定：这是 0.2.0（以及 0.1.7-rc.2）的官方缺陷，不是本机 patch 层写法问题。**

三条独立证据链：

1. **纯官方复现成立**：一个全新的空 `DSH_HOME`（CLI 自动初始化官方模板，**零本机 patch**）执行 `--dump-config-schema` 同样 rc=1，报**完全相同的 4 条** `unrecognized Loader tree carrier`，报错索引 `/179../182`，JSON 体积 841098 B（= 841 KB，与协调者观测的「约 841KB」一致），stderr 恰好 2 条 warning。→ 本机 patch 的增删对该 4 条报错**零影响**。
2. **最小复现把触发条件收敛到单个官方插件**：一个只含 1 行 `name: '@deepseek-ai/dsh-agent-preset'` 的极简 profile 即 rc=1，报 `[/0] unrecognized Loader tree carrier`；把该行换成 `cordis:group` 则完全正常。 → 触发要素 = 官方插件 `@deepseek-ai/dsh-agent-preset` × 官方采集器 `dsh-app-boot` 的「原生载体白名单」，与 web bundle、与本机 patch 都无关。
3. **0.1.7-rc.2 同样 rc=1**：同一条纯官方命令在 0.1.7-rc.2 上也是 rc=1，同样 4 条、同样 2 条 warning，索引为 `/178../181`（因 0.1.7 在它们之前少 1 个条目，整体后移 1）；**同一份最小复现在 0.1.7 与 0.2.0 上产出的 JSON 字节完全相同（md5 一致）**。 → 该缺陷**不是 0.2.0 新引入**，而是 0.1.7 起就存在的官方既有问题（0.2.0 未修）。

对迁移验收的影响：**`--dump-config-schema` 的退出码不可用作「配置可校验」判据**。原因不止上述 4 条 error —— 即便这 4 条消失，官方 web profile 仍有 2 个 `partial` 条目（`ui-settings-account`、`ui-chat`）会让 `x-cordis.complete` 恒为 `false`，在 0.1.7 与 0.2.0 上皆然。替代判据见 §7。

同时必须区分口径：**协调者此前记录到的「4 条 error + 2 条 warning / 约 841KB」精确等于「纯官方 profile」的数字**。带本机 patch 的 profile 实测是 **7 条 error + 4 条 warning / 959861 B**（多出 `/183`、`/188`、`/198` 与 `/186` 两条）。多出来的 3 条**与本题的 carrier 缺陷无关**，是另一类问题（见 §8 附带发现），不能混进本结论。

---

## 2. 复现命令与原始输出

所有命令均使用 0.2.0 的 CLI 启动器：
`$R/prefix-cli/lib/node_modules/@deepseek-ai/dsh/lib/bin.js`（`$R = .workspace/audit-020/assembly-020`）。

### 2.1 A 组：带本机 patch 的 profile（复制自 `assembly-020/home/profiles`，未改动原件）

```bash
cd /home/CNS2026495165/dsh/.workspace/audit-020/t32
R=/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020
CLI=$R/prefix-cli/lib/node_modules/@deepseek-ai/dsh/lib/bin.js
env -u DEEPSEEK_API_KEY -u ADAM_API_KEY \
  HOME=$PWD/home DSH_HOME=$PWD/home DSH_TELEMETRY_DISABLED=1 \
  node $CLI --profile web --dump-config-schema >out/schema-020.json 2>out/schema-020.err
echo "rc=$?"
```

`rc=1`，stderr 全文（原样）：

```
dsh: warning: [/112] config/contactFormUrl: regular-expression syntax or Unicode semantics require native validation
dsh: warning: [/149] config/transcriptView: loose validation can replace invalid values with defaults
dsh: error: [/179] unrecognized Loader tree carrier; use cordis:group or cordis:include for native child collection
dsh: error: [/180] unrecognized Loader tree carrier; use cordis:group or cordis:include for native child collection
dsh: error: [/181] unrecognized Loader tree carrier; use cordis:group or cordis:include for native child collection
dsh: error: [/182] unrecognized Loader tree carrier; use cordis:group or cordis:include for native child collection
dsh: error: [/183] The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'installSettingsSection'
dsh: warning: [/186] config/global/darkMask: fractional or offset numeric step requires native validation
dsh: warning: [/186] config/global/opacity: fractional or offset numeric step requires native validation
dsh: error: [/188] The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'installSettingsSection'
dsh: error: [/198] unrecognized Loader tree carrier; use cordis:group or cordis:include for native child collection
```

stdout：959861 B，合法 JSON（`json.load` 通过），`x-cordis.complete = false`，`diagnostics = 11`，`entries = 199`。
**该子命令从不写 stdout 之外的东西**：`lib/dump-config-schema-DhhNOaro.js:27` 在采集期间把普通 stdout 临时改道到 stderr，采集结束后 `:33` 一次性打印 JSON。因此 rc=1 时 stdout **仍是完整合法的 JSON 文档**，不是半截输出。

### 2.2 B 组：纯官方 profile（关键判定组，零本机 patch）

```bash
cd /home/CNS2026495165/dsh/.workspace/audit-020/t32
R=/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020
CLI=$R/prefix-cli/lib/node_modules/@deepseek-ai/dsh/lib/bin.js
mkdir -p home-official                      # 全新的空 DSH_HOME，事先不存在
env -u DEEPSEEK_API_KEY -u ADAM_API_KEY \
  HOME=$PWD/home-official DSH_HOME=$PWD/home-official DSH_TELEMETRY_DISABLED=1 \
  node $CLI --profile web --dump-config-schema >out/schema-020-pure.json 2>out/schema-020-pure.err
echo "rc=$?"
```

CLI 在该空 home 下自动铺设官方模板（生成 `profiles/web/{cordis.yml,cordis.patch.yml,package.json,pnpm-workspace.yaml}`），**用户层为空**。
`rc=1`，stderr 全文（原样）：

```
dsh: warning: [/112] config/contactFormUrl: regular-expression syntax or Unicode semantics require native validation
dsh: warning: [/149] config/transcriptView: loose validation can replace invalid values with defaults
dsh: error: [/179] unrecognized Loader tree carrier; use cordis:group or cordis:include for native child collection
dsh: error: [/180] unrecognized Loader tree carrier; use cordis:group or cordis:include for native child collection
dsh: error: [/181] unrecognized Loader tree carrier; use cordis:group or cordis:include for native child collection
dsh: error: [/182] unrecognized Loader tree carrier; use cordis:group or cordis:include for native child collection
```

stdout：841098 B（841 KB），合法 JSON，`complete = false`，`diagnostics = 6`，`entries = 183`。

### 2.3 对照命令（均 rc=0，证明缺陷仅限 schema 子命令）

| 命令 | rc | 输出 |
|---|---|---|
| 0.2.0 `--profile web --dump-config`（A 组 home） | **0** | 1695 行 YAML，stderr 空 |
| 0.2.0 `--profile web --dump-default-config`（B 组 home） | **0** | 1259 行 YAML，stderr 空 |
| 0.2.0 最小 profile `--profile min020 --dump-config-schema` | **1** | 见 §4 |

（`--dump-config` / `--dump-default-config` / `--dump-config-schema` 三者互斥，见 `lib/bin.js:75`。）

### 2.4 一个口径提醒

「`[/179..182]`」不是 CLI 的区间压缩写法，而是 4 条独立诊断行。CLI 的格式化模板是
`lib/dump-config-schema-DhhNOaro.js:35`：`` `${NAME}: ${diagnostic.level}:${location} ${diagnostic.message}` ``，`location = " [" + diagnostic.path + "]"`。
真实路径写法一律是 `/<index>`（顶层）或 `/<index>/config/<index>`（嵌套），即 `/179`、`/180`、`/181`、`/182` 四条。

---

## 3. 报错源码位置与触发条件

### 3.1 抛错点（官方代码）

`.../node_modules/@deepseek-ai/dsh-app-boot/lib/index.js`（0.2.0-rc.1）：

- `:3005-3022` `const carrier = async (plugin, baseUrl) => { ... }`
- `:3006` `if (plugin === Group) return "group";`
- `:3007` `if (plugin === Include) return "include";`
- `:3008` `if (!objectLike(plugin) || !Reflect.get(plugin, EntryGroup.key)) return void 0;`
- `:3019` `const native = await resolved;`（动态 import `@deepseek-ai/cordis-plugin-group` / `-include`，按 `baseUrl` 解析）
- **`:3022` `throw new Error("unrecognized Loader tree carrier; use cordis:group or cordis:include for native child collection");`**
- 调用点：`:3131` `const kind = await carrier(plugin, baseUrl);`，位于 `walk()` 内，异常被 `catch` 后 `report(path, error)` → 成为 `error` 级诊断（只记录，不中断其它条目）。

对照 0.1.7-rc.2：同一文件 `:3004-3021`，抛错在 `:3021`，逻辑逐字相同。

### 3.2 精确触发条件（三段合取）

设 `plugin = unwrapExports(await loader.import(row.name, baseUrl, {}))`，`k = Symbol.for("cordis.group")`（`cordis-plugin-loader/lib/index.js:47` 定义 `EntryGroup.key`）：

1. `plugin !== Group` 且 `plugin !== Include`（不是 `cordis:` 内建的 Group/Include 类本身）；
2. `Reflect.get(plugin, k)` 为真 —— 即该插件**自声明为 loader 树载体**（`static [EntryGroup.key] = true`）；
3. `plugin` 也不等于从 `baseUrl` 动态解析出的 `@deepseek-ai/cordis-plugin-group` / `-include` 的导出。

三条同时成立 ⇒ 抛错。注意第 2 条是**必要条件**：普通插件（无该 static 标记）走 `:3008` 直接 `return undefined`，**不会**报此错。所以这条错误信息不是「配置坏」，而是「采集器遇到一个它不认识的树载体实现」。

### 3.3 本缺陷的具体肇事插件（官方包）

`.../node_modules/@deepseek-ai/dsh-agent-preset/lib/index.js:12`：

```js
var AgentPreset = class {
	ctx;
	config;
	static inject = ["agentPresets"];
	/** Preserve child expressions until their own plugins activate. */
	static [EntryGroup.key] = true;      // ← 第 12 行：自声明为树载体
	static Config = z.object({ id, name, description, order, plugins: z.array(z.any()).required() });
	...
};
export { AgentPreset as default };
```

它**不是** `Group` 的子类，只是打了同一个 `Symbol.for("cordis.group")` 标记，因此命中上面第 1、2、3 条 ⇒ 必抛。
0.1.7-rc.2 的同名文件第 12 行完全相同。

结论：**`--dump-config-schema` 的采集器与官方自家 `dsh-agent-preset` 插件不兼容**——采集器只承认 `cordis:group` / `cordis:include` 两种载体，而官方 agent-preset 用的是第三种「自带 group 标记的业务载体」。这是官方内部两处设计不同步，属官方缺陷。

---

## 4. 涉及的 4 个条目定位

`--dump-config`（rc=0）与 `--dump-config-schema` 的采集走同一份 `composeEntries(layers)`，顶层顺序一致，故诊断里的 `/N` 可直接按 YAML 顶层数组下标定位。本轮 `--dump-config` 顶层共 **199** 项（A 组）/ **183** 项（B 组），用 `t32/pick2.py` 按下标抽取：

| 路径 | id | name | 来源层（YAML 注释头） | 类别 |
|---|---|---|---|---|
| `/179` | `preset-standard` | `@deepseek-ai/dsh-agent-preset` | `# == @deepseek-ai/dsh-web-app` | **官方 bundle 条目** |
| `/180` | `preset-ptc` | `@deepseek-ai/dsh-agent-preset` | `# == @deepseek-ai/dsh-web-app` | **官方 bundle 条目** |
| `/181` | `preset-minimal` | `@deepseek-ai/dsh-agent-preset` | `# == @deepseek-ai/dsh-web-app` | **官方 bundle 条目** |
| `/182` | `preset-cordis` | `@deepseek-ai/dsh-agent-preset` | `# == @deepseek-ai/dsh-web-app` | **官方 bundle 条目** |

四者都是官方 profile bundle `@deepseek-ai/dsh-web-app` 里的**官方 agent preset 声明**，形式为
`{ id: preset-*, name: '@deepseek-ai/dsh-agent-preset', config: { id, order, plugins: [...] } }`。

**为什么不接受**：不是因为「patch 插入形式」或「`cordis:group`/`cordis:include` 载体差异写法」，而是 §3.3 的类身份问题——官方 agent-preset 用自声明 group 标记实现了「第四种载体」，采集器的白名单里没有它。同一 profile 中真正用 `cordis:group` 的条目（如 `preset-standard` 内的 `id: planning` / `id: compaction` / `id: delegation`）**没有任何诊断**，反而证明了采集器对 `cordis:group` 完全正常。

补充：`--dump-default-config`（**不含用户层**）输出里同样含这 4 条（顶层下标同为 179..182），再次排除了「本机 patch 引入」的可能。

索引偏移解释：0.1.7-rc.2 顶层 182 项，同一批报错落在 `/178../181`；0.2.0-rc.1 顶层 183 项，报错落在 `/179../182`。差值来自 0.2.0 在它们之前新增了 1 个条目，**不是**条目本身变了。

---

## 5. 纯官方复现结果（关键判定）

三组纯官方实验，均为「无任何本机 patch」：

| 实验 | 构造 | rc | 诊断 |
|---|---|---|---|
| B 组：空 home + `--dump-config-schema` | CLI 自动铺官方模板，用户层空 | **1** | 2 warning + **4 条 carrier error（/179../182）**，841098 B |
| `--dump-default-config` | 官方 bundle 层，无用户层 | 0 | 无诊断；含 `preset-standard/ptc/minimal/cordis` |
| **最小复现**（见下） | 极简 profile，仅 1 行 `@deepseek-ai/dsh-agent-preset` | **1** | 1 条 carrier error（`/0`） |

最小复现（`t32/minhome/`，与本机 patch 完全无关的独立 fixture）：

```bash
# profiles/min020/package.json -> { "dsh": { "profile": { "bundles": [] } } }
# profiles/min020/cordis.yml  -> []            （profile 根永远是空表，见文件头注释）
# profiles/min020/cordis.patch.yml ->
#   - insert:
#       - id: probe-preset
#         name: '@deepseek-ai/dsh-agent-preset'
#         config: { id: probe, plugins: [] }
#   - insert:
#       - id: probe-group
#         name: cordis:group
#         group: true
#         config: [ { id: probe-child, name: '@deepseek-ai/dsh-tool-todo' } ]

env HOME=$PWD/minhome DSH_HOME=$PWD/minhome DSH_TELEMETRY_DISABLED=1 \
  node $CLI --profile min020 --dump-config-schema
```

`rc=1`，stderr：`dsh: error: [/0] unrecognized Loader tree carrier; ...`
同一输出的 `x-cordis.entries`：

```json
[{"path":"/0","id":"probe-preset","name":"@deepseek-ai/dsh-agent-preset","status":"schema","configRef":"#/$defs/config0"},
 {"path":"/1","id":"probe-group","name":"cordis:group","status":"absent","tree":"group","configRef":"#/$defs/entryList"},
 {"path":"/1/config/0","id":"probe-child","name":"@deepseek-ai/dsh-tool-todo","status":"schema","configRef":"#/$defs/config1"}]
```

即：官方 `@deepseek-ai/dsh-agent-preset` 报错，`cordis:group` 正常（`tree:"group"` 且子条目被正常下钻）。

**判定：官方缺陷。** 记录为已知问题，**不应作为迁移失败判据**。

另外两点机制性结论（支撑上面的「不应作为判据」）：

- **不影响启动**：全树只有 `lib/dump-config-schema-DhhNOaro.js:3,29` 引用 `generateConfigSchema`；boot 路径（`lib/profile-boot-*.js`）不引用。rc 只在 `:38` 由 `if (!dump["x-cordis"].complete) process.exitCode = 1;` 置位，纯退出码语义。
- **对嵌套 preset 子插件无 schema 损失（官方场景）**：`dsh-agent-preset` 的 `Config.plugins` 是 `z.array(z.any())`（见最小复现的 `$defs.config0`），子插件本就不在 schema 覆盖范围内；carrier 抛错只是少了这些子条目的 `x-cordis.entries` 索引，没有真实的校验覆盖缺失。

---

## 6. 0.1.7 对照结果

CLI：`~/.npm-global-dsh017/lib/node_modules/@deepseek-ai/dsh/lib/bin.js`（`0.1.7-rc.2`，嵌套 283 包，未受污染；其 `lib/*.js` 启动器与 0.2.0 字节相同）。

```bash
env HOME=$PWD/home-official017 DSH_HOME=$PWD/home-official017 DSH_TELEMETRY_DISABLED=1 \
  node $CLI017 --profile web --dump-config-schema       # 全新空 home，纯官方
```

`rc=1`，stderr 全文：

```
dsh: warning: [/111] config/contactFormUrl: regular-expression syntax or Unicode semantics require native validation
dsh: warning: [/148] config/transcriptView: loose validation can replace invalid values with defaults
dsh: error: [/178] unrecognized Loader tree carrier; use cordis:group or cordis:include for native child collection
dsh: error: [/179] unrecognized Loader tree carrier; use cordis:group or cordis:include for native child collection
dsh: error: [/180] unrecognized Loader tree carrier; use cordis:group or cordis:include for native child collection
dsh: error: [/181] unrecognized Loader tree carrier; use cordis:group or cordis:include for native child collection
```

stdout 833612 B，合法 JSON，`complete=false`，`entries=182`。

最小复现在 0.1.7 上：`rc=1`，`dsh: error: [/0] unrecognized Loader tree carrier; ...`；且
`out/schema-min017.json` 与 `out/schema-min020.json` **md5 完全相同**（`c02af969d2b5152c4e66020b0f1c442d`，均 18136 B）。

**结论：该 rc=1 不是 0.2.0 新引入的回归，0.1.7-rc.2 已存在且行为完全一致。** 迁移验收中不得把它计为 0.2.0 的失败项。

---

## 7. 迁移验收建议

### 7.1 直接结论

**`--dump-config-schema` 的退出码 `rc` 不可用作「配置可校验」判据。** 理由（两条独立、且都在两个版本上成立）：

1. 官方 web profile 必然产出 4 条 `unrecognized Loader tree carrier` error（§4/§5），来自官方自家 `@deepseek-ai/dsh-agent-preset`，无法通过改本机配置消除；
2. 即便这 4 条消失，`x-cordis.complete` 仍恒为 `false`：`dsh-app-boot/lib/index.js:2929` 的 `complete` 公式为
   `!diagnostics.some(level==="error") && !entries.some(status ∈ {partial,unsupported,error}) && !names.some(size>1)`，
   而官方 web profile 实测有 2 个 `partial` 条目（0.2.0：`/112 ui-settings-account`、`/149 ui-chat`；0.1.7 为 `/111`、`/148`），对应 2 条「regex/loose validation needs native validation」warning。

   实测状态分布（纯官方）：0.2.0 `{absent:82, schema:99, partial:2}`；0.1.7 `{absent:81, schema:99, partial:2}`。

   也就是说 `complete=false` 是官方 profile 的**常态**，与「配置是否被本机改坏」无关。

### 7.2 推荐替代判据（按优先级）

1. **主判据：诊断基线差分（推荐）**
   对同一 CLI 分别跑「纯官方 profile」与「待验 profile」的 `--dump-config-schema`，比较 `x-cordis.diagnostics` 的集合差，并要求：
   - 集合差中**没有新增 `level=error`**；
   - 新增 `level=warning` 必须逐条给出理由并归档。
   本轮实测该差分对 A/B 两组给出的正是可用信号：A 组相对 B 组恰好多出 **3 条 error（`/183`、`/188`、`/198`）+ 2 条 warning（`/186`×2）**。
   实现要点：`--dump-config-schema` 即使 rc=1 也打印完整合法 JSON，所以**解析 stdout 即可，不要看 rc**。可加 `--ignore-baseline-ids preset-standard,preset-ptc,preset-minimal,preset-cordis` 之类的白名单，把 4 条官方 carrier error 固化为已知基线。
2. **辅助判据：`--dump-config`（rc=0）+ 结构断言**
   `--dump-config` 在 0.1.7/0.2.0 上均 rc=0、stderr 空。适合做迁移验收的“组合正确性”闸门：断言顶层条目数、关键 `id → name` 映射、以及本机 patch 的 insert/override 是否落位（例如本次 A 组 199 项 vs 官方 183 项）。
3. **辅助判据：JSON Schema 可用性（不看 complete）**
   断言 payload 可 `JSON.parse`、`$defs` 非空、`x-cordis.entries` 长度等于 `--dump-config` 顶层条目数、且关心的 `id` 的 `configRef` 指向原生 schema（`native: true`）而非 `#/$defs/unknownConfig`。这才是「配置可校验」真正想验的东西。
4. **不要用**：`--dump-config-schema` 的 rc、`x-cordis.complete`、以及「stderr 非空」。

---

## 8. 附带发现（与本缺陷无关，供其它轨道接手）

A 组（带本机 patch）相对 B 组（纯官方）多出的 3 条 error，**根因与 carrier 无关**，指向另一类问题——按阻塞程度排序：

- `/183` `vision-adam`（`name: '@deepseek-ai/dsh-vision-adam'`）与 `/188` `session-status-board`（`name: '@deepseek-ai/dsh-session-board'`）：
  `The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'installSettingsSection'`。
  实测：`installSettingsSection` / `settingsNamespace` / `deepEqualJson` / `SettingsProvider` **在两棵官方安装树里都不存在**（0.2.0-rc.1 与 0.1.7-rc.2 的全树 grep 均 0 命中；两者的 `lib/index.js:544` 都只导出 `{SettingsConflictError, SettingsForms, SettingsForms as default, redactSecrets}`）。真实生效的那个 `@deepseek-ai/dsh-settings` 是 0.1.1-rc.2 世代的**另一份构建**（`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-settings` → 软链到 `~/.npm-global/...`，即 `@deepseek-ai/dsh@0.1.1-rc.2`，`lib/index.js:638` 导出含 `installSettingsSection`）。
  即：本机 `@local/*` 生态里若干插件依赖的是 0.1.1 世代的 settings 导出命名，对**任何**官方安装树都会导入失败（0.1.7 亦不成立）。
  assembly-020 的 `home/profiles/node_modules/@deepseek-ai/` 共 291 项，其中 **288 项是指向 0.2.0 安装树的软链**，只有 **3 项是从本机 profile 原样带过来的实体目录**：`dsh-session-board`、`dsh-taste`、`dsh-vision-adam`（也正是 `/188`、`/183` 的肇事者）。即这三者一旦按 `@deepseek-ai/dsh-settings` 向上解析，就会拿到官方 0.2.0 构建而导入失败——装配结构决定了它在此处暴露。
  **这是真实迁移风险，不是纯装配假象**（装配只决定它何时暴露）；需要单独一条轨道按「改动 `@local/*` 导入面」或「继续钉住 fork 版 dsh-settings」两个方案裁决。
- `/198` `preset-standard-glm`：本机 patch 自己 `insert` 的 `@deepseek-ai/dsh-agent-preset`。其报错与官方 4 条**同因同形**——因为本机 patch 完全照官方写法书写。**不构成本机写法错误**，也无需修正写法；它只是把同一官方缺陷又复现了一次（并解释了为何 patch 会把 error 数从 4 抬到 5）。
- `/186` `wallpaper`（`@local/dsh-wallpaper`）的 2 条 `fractional or offset numeric step requires native validation` 是 warning 级，属 schema 生成器的表达能力提示，不阻塞。

明确未做（不在本轨道范围）：`/183`、`/188` 的完整修复方案与 `@local/*` 导入面清单，交 T08/T13 一类的插件兼容轨道。

---

## 9. 证据清单（可复算）

目录：`.workspace/audit-020/t32/`（本轨道自建；`home/` 是 `assembly-020/home/profiles` 的副本，原件未动）

| 文件 | 说明 | 大小 | md5 |
|---|---|---|---|
| `out/schema-020.json` | A 组：带本机 patch，rc=1 | 959861 | `6d61ea97c3365088eb1d697a647260e7` |
| `out/schema-020.err` | A 组 stderr（11 条诊断） | 1262 | `ff00a0b89d9bebc5b13eb10836778727` |
| `out/schema-020-pure.json` | B 组：纯官方，rc=1 | 841098 | `60ccfed6b1818be7895dbdf9810f3963` |
| `out/schema-020-pure.err` | B 组 stderr（6 条诊断） | 683 | `3c43daa7c81621d3c400f24836662fdd` |
| `out/dump-020.yml` | A 组 `--dump-config`，rc=0，1695 行 | 60739 | `6691898876298cedb092ad0d788eca1a` |
| `out/default-020.yml` | `--dump-default-config`，rc=0，183 顶层项 | 45660 | `54ae4a2351a78eb84a5afc631060c784` |
| `out/schema-017-pure.json` | 0.1.7 纯官方，rc=1 | 833612 | `a8a1621bc7b3399aff92c0836e054d10` |
| `out/schema-017-pure.err` | 0.1.7 stderr（6 条诊断） | 683 | `d319bc039ada619060b6c533bb50cd83` |
| `out/dump-017-pure.yml` | 0.1.7 `--dump-config`，rc=0，182 顶层项 | 45065 | `c8dbd3b9ea4b7aa468b2df5b039d89f1` |
| `out/schema-min020.json` | 最小复现 0.2.0，rc=1 | 18136 | `c02af969d2b5152c4e66020b0f1c442d` |
| `out/schema-min017.json` | 最小复现 0.1.7，rc=1（与上一行**字节相同**） | 18136 | `c02af969d2b5152c4e66020b0f1c442d` |
| `pick.py` / `pick2.py` | 按顶层下标抽取 `--dump-config` 条目 | — | — |

全部 5 个 schema JSON 均通过 `json.load` 解析（合法 JSON）。

---

## 10. 未验证项

1. **上游是否已修 / 是否有 issue**：本轮未查上游仓库、变更日志或 issue 跟踪（只读本地安装树）。因此「是否在 0.2.0 正式版修复」无结论；仅能确定 **0.1.7-rc.2 与 0.2.0-rc.1 两版都存在且行为一致**。
2. **修复方案可行性**：把 `carrier()` 的白名单从「类身份相等」放宽为「`EntryGroup.key` 标记 + 声明式子集合」是否安全，未做实验（需改产品代码，超出本轨道范围）。
3. **扁平布局 vs global 布局是否一致**：本轮全部复现使用 global 布局（`assembly-020/prefix-cli`）。`.workspace/iso-020/npm-global/`（flat 布局）未在本轮单独复跑；鉴于其 `@deepseek-ai/dsh` 启动器与 global 布局字节相同、且缺陷在插件/采集器层而非安装布局层，预期一致但**未实测**。
4. **真实 0.2.0 部署下的 `/183`、`/188`**：本轮只在 assembly-020 的 node_modules 装配下观测到。真实迁移中若 `@local/*` 仍解析到 0.1.1 世代的 `@deepseek-ai/dsh-settings`，则不会报错；若解析到官方 0.2.0 构建，则会。两种走向均未实测。
5. **`x-cordis.complete` 的其它消费方**：本轮只确认 CLI 用它置退出码；是否有其它工具/CI 依赖该字段未做全仓检索。
