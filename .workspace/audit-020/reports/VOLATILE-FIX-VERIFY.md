# WP3 · 两个「模型路由插件」settings 页修复 —— 独立复核 + 全 profile 条目可服务性登记

- **工单号**：WP3（dsh-020 迁移轮 · 执行档）
- **状态**：**完成**（A/B/C/D 四项都有实跑或源码结论；1 项 `[未验证]`；1 项**重启前置风险**需协调者知悉）
- **复核对象**（协调者已改，本档只读）：
  - `$A/home/profiles/node_modules/@local/dsh-subagent-model/lib/index.js`
  - `$A/home/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js`
  - 改前原件：`.workspace/audit-020/volatile-fix-backup/*.orig`
- **写入边界**：只写了 `reports/VOLATILE-FIX-VERIFY.md` 与 `verify-volatile/**`。
  **未改任何插件源码、未改 `cordis.patch.yml`、未起任何服务、未重启 3080/3097/3098、未写 `~/.dsh/**` 与 `~/.dsh-017/**`。**
- **实跑命令**（全部可复现；`verify-volatile/node_modules` 是指向 `$A/home/profiles/node_modules` 的软链，用于解析 `@deepseek-ai/*`）：

```bash
cd /home/CNS2026495165/dsh/.workspace/audit-020/verify-volatile
node a-volatile-form-parity.mjs     # A：改前/改后 describe() 收录 + 每条写入路径 isVolatilePath
node b-runtime-unwrap.mjs           # B：运行时读值语义（真跑 apply/execute/消费侧函数）
node c-serviceability.mjs           # C：200 条 profile 条目「设置页可服务性」登记表
node d-restart-compatibility.mjs    # D 附录：重启时的 peerDependencies 兼容闸门
```

- **证据路径**：
  - `verify-volatile/out/a-parity.txt`、`out/b-runtime.txt`、`out/c-serviceability.txt`、`out/d-restart-compatibility.txt`
  - `verify-volatile/describe-live.json`（现役 3098 `/api/settings/describe` 实抓）、`out/live-3098-namespaces.txt`
  - `verify-volatile/out/evidence-boot-and-drill.txt`（宿主 boot 时间线与 3099 drill 只读摘录）
  - `verify-volatile/before/*.mjs`（改前原件的 byte-identical 副本，sha256 见 §A）

> `$A = /home/CNS2026495165/dsh/.workspace/audit-020/assembly-020`；
> `$B = $A/prefix-cli-rc2/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai`。
> 结论强度标注：`[实跑]` 有命令输出、`[源码]` 只有源码行号、`[未验证]` 明确未验。

---

## A. 修复前 / 修复后对照（用 dsh-settings **自己的源码文本**判定）

**做法（避免"凭记忆复刻"）**：`a-volatile-form-parity.mjs` 在运行时从
`$B/dsh-settings/lib/index.js` 切出 **第 97–158 行源码文本**（`plainConfig` / `plainSchema` / `volatileForm` /
`projectForm` / `isVolatilePath`），用真实依赖（`z` = `@deepseek-ai/schemastery`、`isVolatile` = `@deepseek-ai/cosmokit`、
`redactSecrets` = dsh-settings 导出的同一个函数）经 `new Function` 实例化后调用。
即：**判定函数与被复核的 0.2.0 运行时是同一份字节**。 `[实跑]`

对照用的"改前"文件是 `.orig` 的 **byte-identical 副本**（只改了扩展名 `.orig → .mjs`，Node 才能 import）：

| 副本 | sha256 | 原 `.orig` sha256 |
|---|---|---|
| `verify-volatile/before/subagent-model.index.mjs` | `044e05ca…bfc00` | `044e05ca…bfc00`（相同） |
| `verify-volatile/before/vision-adam.index.mjs` | `9ccf8911…1d05` | `9ccf8911…1d05`（相同） |

另经比对：`subagent-model.client.js` / `vision-adam.client.js` **与 `.orig` 逐字节相同**（本轮修复只动宿主半，
两个设置页的客户端代码一行未改）。`[实跑]`

### A.1 对照表

| 条目 | 文件 | `volatileForm(schema)===undefined`（⇒ 被 `describe()` 整条跳过，`lib/index.js:418-419`） | 设置页要写的路径 → `isVolatilePath` | 判定 |
|---|---|---|---|---|
| `subagent-model` **改前** | `.orig` | **undefined（跳过）** | `provider` ✗、`model` ✗ | **缺口**：命名空间不进 served 列表 ⇒ 客户端 `status:"unavailable"`（就是用户看到的那句话）；写还会抛 `has no volatile fields` |
| `subagent-model` **改后** | 现文件 | `{provider:string, model:string}` | `provider` ✓、`model` ✓ | **修复生效（代码面）** |
| `vision-adam` **改前** | `.orig` | **undefined（跳过）** | `model` ✗、`baseURL` ✗、`apiKeyEnv` ✗、`maxTokens` ✗ | **缺口**（同上） |
| `vision-adam` **改后** | 现文件 | `{apiKeyEnv:string, baseURL:string, model:string, maxTokens:number}` | 四条全 ✓ | **修复生效（代码面）** |
| 对照：`agent-default-model`（官方同形参考） | `$B` | 有表单 | `provider`/`model`/`reasoningEffort` ✓ | 官方先例，构成正确 |
| 对照：`@local/dsh-wallpaper`（上一轮同规则修好） | 现文件 | 有表单 | `global`/`pages` ✓ | 先例仍然正常 |
| 对照：`@local/dsh-ssh-gui`（上一轮同规则修好） | 现文件 | 有表单 | `file.maxBytes`/`exec.timeoutMs`/`security.confirmExec` ✓ | 先例仍然正常 |
| 对照：`@local/dsh-logfile`（无 volatile） | 现文件 | undefined | `level` ✗ | 预期：该插件没有设置页，不构成缺口 |

### A.2 修复没有"顺手扩大可写面"

`vision-adam` 的非设置页字段（`apiKey` 密文、`maxBytes`、`maxVideoBytes`、`xApiKey`、`sessionHeader`）
在改后 schema 里 `isVolatilePath` 仍为 **false** ⇒ 设置页**无法**通过 configForms 触达它们
（`write()` 会抛 `Config field "…" is not volatile`），仍然是 ordinary configuration、走 `cordis.patch.yml` 原生编辑。
这与客户端页面自己声明的"这 5 个键不在本页编辑"一致。`[实跑]`

### A.3 `describe()` 的 `value` 是**已解包**的普通值（源码链 + 实跑复核）

`[源码]` `$B/dsh-settings/lib/index.js:436`：

```js
const value = projectForm(form, plainConfig(entry.fiber.config));
```

- `:97-102 plainConfig`：`if (isVolatile(value)) return plainConfig(value.get())`（**逐层解包 cosmokit 引用**），
  数组/对象递归；
- `:141-147 projectForm`：只保留表单声明的字段（本例就是那 4 个 / 2 个 volatile 字段）。

`[实跑]` `a-volatile-form-parity.mjs` 用真实 schemastery 把 plain 配置解析成运行时 config
（此时 volatile 字段的 `typeof` 是 `object`、`isVolatile=true`），再走同一条投影链：

```
subagent-model  运行时 volatile 字段 = [provider, model]   (typeof = object,object)
                describe().value = {"provider":"adam","model":"deepseek-v4-pro"}     全部叶子为普通标量 = true
vision-adam     运行时 volatile 字段 = [apiKeyEnv, baseURL, model, maxTokens] (object×4)
                describe().value = {"apiKeyEnv":"ADAM_API_KEY","baseURL":"https://x/v1","model":"…","maxTokens":100}  全部标量 = true
```

---

## B. 运行时读值语义不回归（关键项）

### B.1 `.volatile()` 在运行时到底变成了什么 `[实跑]`

`$B/schemastery/lib/index.mjs:265-273` `[源码]`：

```js
if (schema.meta?.volatile) {
  const inner = Schema(schema);  inner.meta = { ...schema.meta, volatile: false };
  const [value, adapted] = Schema.resolve(data, inner, options, strict);
  return [createVolatile(value), adapted];   // ← 变成 cosmokit 引用对象
}
```

`[实跑]` 用插件自己 import 的那一份 schemastery 解析其 Config：

```
subagent-model 运行时 config：provider typeof=object isVolatile=true get()="adam"；model typeof=object isVolatile=true
```

⇒ **`.volatile()` 之后 `apply()` 收到的 `config.provider` 是引用对象，不是字符串**，这正是两个插件
改后各自加 `plain()` / `plainConfigOf()` 的原因。

### B.2 `subagent-model.apply()` 日志 `[实跑]`

把**同一份 volatile 运行时 config** 分别喂给改前 / 改后模块的 `apply()`，抓日志：

| 组合 | `ctx.logger.info` 实际输出 |
|---|---|
| 改前模块 + 改前 schema（修复前真实形态，普通字符串） | `… effective route = adam/deepseek-v4-pro` ✅（修复前不坏，因为根本没有 volatile） |
| 改前模块 + volatile 运行时 config | `… effective route = **[object Object]/[object Object]**` ❌（证明"加 volatile 必须配套解包"） |
| 改后模块 + volatile 运行时 config | `… effective route = adam/deepseek-v4-pro` ✅ |

⇒ 协调者的"加 `.volatile()` 同时加 void 引用解包"是**必要且正确**的（不是可选加固）。

### B.3 `vision-adam.current()` 两条路径都返回普通标量 `[实跑]`

真跑 `apply(ctx, volatileConfig)` → 抓 `ctx.tools.register` 注册的 `analyze_image` → stub
`ctx.fs` / `globalThis.fetch` → 调 `tool.execute({file_path:"probe.png"})`，从**真实发出的请求**上读数
（这是 `current() → resolveOptions() → analyzeImageBytes` 的完整真实路径）：

| 路径 | 观察点 | 结果 |
|---|---|---|
| ① 有 settings 描述符（`{ns:"vision-adam", value:{…gpt-6-astra→from-settings…}}`） | URL / body | `https://settings.example/v1/chat/completions`（尾斜杠已归一）、`body.model="from-settings"`（string）、`body.max_tokens=4242`（number）✅ |
| ② **无** settings 描述符（`ctx.get("settings") === undefined`，走回落） | URL / body | `https://llmapi.roboscience.xyz/v1/chat/completions`、`body.model="gpt-6-astra"`、`body.max_tokens=393216` ✅ |
| ③ 无 literal apiKey（走 `credentials.resolve`） | 实参 | 收到的是 **普通字符串** `"SETTINGS_KEY"`（`typeof=string`，非引用对象）✅ |

**反证（证明解包是必需的）**：把未解包的运行时 config 直接交给导出的 `resolveOptions()`：

- `credentialRef(refObject)` ⇒ `TypeError: credential ref "[object Object]" must match /^[A-Za-z_]…/`；
- `resolveOptions({...runtime, apiKeyEnv:"ADAM_API_KEY"})` ⇒ `baseURL/model/maxTokens` 仍是 `object`，
  且 `typeof baseURL.replace === "undefined"` ⇒ `analyzeImageBytes` 的 `baseURL.replace(/\/+$/,"")` 必然 TypeError。

⇒ 改后的 `plainConfigOf` 是**拦在真实故障前面的**，两条路径返回同形普通标量。

对照：改前模块 + 改前 schema（普通字符串）在同一 harness 下也工作正常 —— 说明**修复前不是功能回归，
而是设置面缺口**，修复没有引入新的运行时风险。

### B.4 消费侧：加 `.volatile()` 之后子代理路由的实时读取链路**仍然拿到字符串** `[实跑]+[源码]`

`[源码]` 消费者是 `$B/dsh-tool-subagent/lib/index.js:68-88` 的 `effectiveConfiguredAgentOptions()`：

```js
const settings = runtimeCtx.get("settings");
const row = … settings.describe().find((candidate) => candidate.ns === "subagent-model");
settingsValue = row === void 0 ? void 0 : row.value;      // ← 用 describe() 的 value
…
const provider = typeof settingsValue.provider === "string" && …  // 非字符串直接忽略
```

链路闭合证明：

1. `describe()` 的 `value` 已解包（`:436` + `plainConfig` `:97-102`，A.3 已实跑复核）；
2. 消费侧读的就是 `value`，并且**只接受 `typeof === "string"`**（非字符串会静默忽略 → 回落 preset）；
3. `[实跑]` 把该消费函数的**源码文本直接实例化**（`b-runtime-unwrap.mjs` B4），喂入由真实
   volatile config 经 `describe()` 投影链得到的 `value`：

```
[改后（volatile）] describe().value = {"provider":"adam","model":"deepseek-v4-pro"}
                   ⇒ consumer 结果 = {"provider":"adam","model":"deepseek-v4-pro"}   ✅ 覆盖成功
[改前（普通字符串）] volatileForm === undefined ⇒ describe() 不产出该 ns
                   ⇒ consumer 结果 = {"provider":"preset-provider","model":"preset-model"}  （原样回落，不报错）
```

**明确回答：是。** 加 `.volatile()` 之后，子代理路由的实时读取链路（`settings.describe()` → `value.provider/model`）
拿到的仍然是**字符串**；`write()` 之后 `describe()` 重新投影，下一次派发即读到新值。

### B.5 最小单测（不起服务）`[实跑]`

`b-runtime-unwrap.mjs` 本身就是这条最小单测，且用的是**插件自己的导出与 `apply()`**（两个解包助手
`plain` / `plainConfigOf` 都是模块内部函数、未导出，所以只能通过 `apply()` 驱动，这比直接调助手更接近真实）：

```js
// 1) 构造真实 volatile 引用（由插件自己的 Config 经真实 schemastery 解析得到）
const runtime = z.resolve({provider:"adam", model:"deepseek-v4-pro"}, SubagentModelConfig)[0];
assert(typeof runtime.provider === "object" && isVolatile(runtime.provider));   // 引用对象
// 2) 跑插件的解包路径
SubagentModel.apply({logger:{info:(m)=>log.push(String(m))}}, runtime);         // 改后模块
assert(/route = adam\/deepseek-v4-pro$/.test(log[0]));                          // 断言得到标量
```

vision-adam 侧的等价断言是 B.3 的 `body.model === "from-settings"` / `body.max_tokens === 4242`（真请求报文）。
`b-runtime-unwrap.mjs` 退出码 0，**全项 PASS**。

---

## C. 全 profile 条目「设置页可服务性」登记表

**扫描面**：`$A/logs/dump020.yaml`（协调者用 0.2.0 自己的 dump-config 产出的**组合后 profile**，
顶部注释标注 `patched by …/home/profiles/web/cordis.patch.yml`）里的 **200 条顶层条目**，
覆盖 `cordis.patch.yml` 全部 insert 的本地/第三方插件与全部官方条目（含补丁按 id 覆盖的行）。

**每条三个判据**：

1. **是否有 Config** `[实跑]`：真跑 `import(<条目 name>)`，按 `mod.Config` / `mod.default.Config` /
   类静态 `Config` 取 schemastery schema（注意：schemastery 的 Schema 实例 `typeof === "function"`，
   第一版脚本按 `object` 判会全表假阴性，已修正并复跑）。
2. **`volatileForm` 是否 undefined** `[实跑]`：用 §A 同一份 dsh-settings 源码切片判定
   （undefined ⇒ `describe()` 整条跳过、`write()` 抛错）。
3. **有客户端设置页吗** `[实跑·静态]`：`package.json` 的 `dsh.client` + `lib/client.js` 是否注册
   `settings.section` + `configForms.get(<命名空间>)` 的字面量/常量命名空间
   （`const X_NS = "…"` 会解析成字面量；`configForms.get(entryId)` 记作通用动态页）。

**判定口径（工单）**：**客户端有设置页 且 宿主 Config 全非 volatile ⇒ 缺口**。

### C.1 结论数字

| 指标 | 数量 |
|---|---|
| 扫描条目总数（顶层 profile 条目） | **200** |
| 有客户端设置页的命名空间（字面量索引） | **17 个字面量 + 1 个通用动态页（entryId）**（见 C.3） |
| **磁盘现状缺口（修复后）** | **0 条** |
| **修复前缺口（用 `.orig` schema 重算）** | **2 条**：`subagent-model`、`vision-adam` |
| 有设置页但**现役 3098 未 served**（重启后应消失） | **3 条**：`subagent-model`、`vision-adam`（本轮修复）+ `pwsh-sandbox`（Windows-only 行，Linux 不加载，属预期） |
| 磁盘判定应 served vs 现役 3098 实抓 served | 29 vs 25；差集 = `pwsh-sandbox`(Linux 不加载)、`product-analytics`(`disabled: profileContext?.name!=='desktop'`，web profile 不加载)、`vision-adam`、`subagent-model`(本轮修复，宿主未重启)；**反向差集为空** |

### C.2 完整登记表（200 条）
| entry id | 包名 | 有 Config | volatileForm==undefined | 客户端 dsh.client | lib/client.js 注册 settings.section | 设置页命名空间 | 该条目有设置页 | 现役 3098 已 served | 判定 |
|---|---|---|---|---|---|---|---|---|---|
| tool-plugin-manager | @deepseek-ai/dsh-plugin-manager/tools | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| plugin-manager | @deepseek-ai/dsh-plugin-manager | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| timer | @deepseek-ai/cordis-plugin-timer | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| hmr | @deepseek-ai/dsh-hmr | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| llm | @deepseek-ai/dsh-llm | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| deepseek-llm-api-extensions | @deepseek-ai/dsh-deepseek-llm-api-extensions | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| session | @deepseek-ai/dsh-session | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| session-log-deepseek | @deepseek-ai/dsh-session-log-deepseek | 是 | 否 | — | — | — | 是 | 是 | OK：有设置页且可服务 |
| typert | @deepseek-ai/dsh-typert-registry | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| typert-loader | @deepseek-ai/dsh-typert-loader | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| typert-gateway | @deepseek-ai/dsh-api-gateway | 是 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| session-title | @deepseek-ai/dsh-session-title | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| session-title-llm | @deepseek-ai/dsh-session-title-first-prompt-llm | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| user-questions | @deepseek-ai/dsh-user-questions | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| agent | @deepseek-ai/dsh-agent | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| plugin-package-inventory-deepseek | @deepseek-ai/dsh-plugin-package-inventory-deepseek | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| agent-default-model | @deepseek-ai/dsh-agent-default-model | 是 | 否 | — | — | — | — | 是 | OK：宿主已 served（通用/自动表单） |
| jobs | @deepseek-ai/dsh-jobs-local | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| llm-retry | @deepseek-ai/dsh-llm-retry | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| config-editor | @deepseek-ai/dsh-config-editor | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| settings | @deepseek-ai/dsh-settings | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| authorization | @deepseek-ai/dsh-authorization | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| deepseek-account | @deepseek-ai/dsh-deepseek-account-platform | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| credentials | @deepseek-ai/dsh-credentials-local | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| llm-pi-ai | @deepseek-ai/dsh-llm-pi-ai | 是 | 否 | — | — | — | 是 | 是 | OK：有设置页且可服务 |
| session-persistence-jsonl | @deepseek-ai/dsh-session-persistence-jsonl | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| attachment-local | @deepseek-ai/dsh-attachment-local | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| session-query-sqlite | @deepseek-ai/dsh-session-query-sqlite | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| session-projection | @deepseek-ai/dsh-session-projection | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| storage | @deepseek-ai/dsh-storage | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| storage-json | @deepseek-ai/dsh-storage-json | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| storage-domain | @deepseek-ai/dsh-storage-domain | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| session-projection-cache | @deepseek-ai/dsh-session-projection-cache | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| otel | @deepseek-ai/dsh-otel | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| session-telemetry-otel | @deepseek-ai/dsh-session-telemetry-otel | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| subprocess | @deepseek-ai/dsh-subprocess-local | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| sandbox | @deepseek-ai/dsh-sandbox-local | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| sandbox-policy | @deepseek-ai/dsh-sandbox-policy | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| bash-sandbox | @deepseek-ai/dsh-bash-sandbox | 是 | 否 | — | — | — | 是 | 是 | OK：有设置页且可服务 |
| pwsh-sandbox | @deepseek-ai/dsh-pwsh-sandbox | 是 | 否 | — | — | — | 是 | 否 | OK：有设置页且可服务 |
| approval | @deepseek-ai/dsh-user-approval | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| permission | @deepseek-ai/dsh-permission-presets | 是 | 否 | — | — | — | — | 是 | OK：宿主已 served（通用/自动表单） |
| shell-env | @deepseek-ai/dsh-shell-env | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| tool-bash | @deepseek-ai/dsh-tool-bash | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| tool-pwsh | @deepseek-ai/dsh-tool-pwsh | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| tool-jobs | @deepseek-ai/dsh-tool-jobs | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| fs-observation-policy | @deepseek-ai/dsh-fs-observation-policy | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| tool-fs | @deepseek-ai/dsh-tool-fs | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| tool-fs-search | @deepseek-ai/dsh-tool-fs-search | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| agent-instructions | @deepseek-ai/dsh-agent-instructions | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| skill | @deepseek-ai/dsh-skill | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| skill-filesystem | @deepseek-ai/dsh-skill-filesystem | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| skill-badge | @deepseek-ai/dsh-skill-badge | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| tool-skill | @deepseek-ai/dsh-tool-skill | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| commands | @deepseek-ai/dsh-commands | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| command-feedback | @deepseek-ai/dsh-command-feedback | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| goal | @deepseek-ai/dsh-goal | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| goal-round-driver | @deepseek-ai/dsh-goal-round-driver | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| command-goal | @deepseek-ai/dsh-command-goal | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| plan-mode | @deepseek-ai/dsh-plan-mode | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| token-meter | @deepseek-ai/dsh-token-meter | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| compaction-basic | @deepseek-ai/dsh-compaction-basic | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| command-compact | @deepseek-ai/dsh-command-compact | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| subagent | @deepseek-ai/dsh-subagent | 是 | 否 | — | — | — | 是 | 是 | OK：有设置页且可服务 |
| subagent-spawn-in-process | @deepseek-ai/dsh-subagent-spawn-in-process | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| subagent-fork-in-process | @deepseek-ai/dsh-subagent-fork-in-process | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| tool-subagent-control | @deepseek-ai/dsh-tool-subagent-control | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| tool-subagent-list-agents | @deepseek-ai/dsh-tool-subagent-control/list-agents | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| tool-subagent | @deepseek-ai/dsh-tool-subagent | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| tool-subagent-fork | @deepseek-ai/dsh-tool-subagent | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| ptc-runtime | @deepseek-ai/dsh-ptc-runtime-node | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| workflow-ptc | @deepseek-ai/dsh-workflow-ptc | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| tool-workflow | @deepseek-ai/dsh-tool-workflow | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| timeout-policy | @deepseek-ai/dsh-tool-call-timeout-policy | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| spill-local | @deepseek-ai/dsh-spill-local | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| spill-policy | @deepseek-ai/dsh-spill-policy | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| session-checkpoint-policy | @deepseek-ai/dsh-session-checkpoint-policy | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| tool-result-pruner | @deepseek-ai/dsh-compaction-tool-result-pruner | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| image-offload | @deepseek-ai/dsh-compaction-image-offload | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| tool-todo | @deepseek-ai/dsh-tool-todo | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| tool-goal | @deepseek-ai/dsh-tool-goal | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| tool-ralph | @deepseek-ai/dsh-tool-ralph | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| repeat-tool-reminder | @deepseek-ai/dsh-repeat-tool-reminder | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| web | @deepseek-ai/dsh-web | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| web-search-deepseek | @deepseek-ai/dsh-web-search-deepseek | 是 | 否 | — | — | — | 是 | 是 | OK：有设置页且可服务 |
| web-fetch-http | @deepseek-ai/dsh-web-fetch-http | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| tool-web | @deepseek-ai/dsh-tool-web | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| mcp-resources | @deepseek-ai/dsh-mcp-resources | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| tools | @deepseek-ai/dsh-tools | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| system-prompt | @deepseek-ai/dsh-system-prompt | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| agent-loop | @deepseek-ai/dsh-agent-loop | 是 | 否 | — | — | — | 是 | 是 | OK：有设置页且可服务 |
| fs-sandbox | @deepseek-ai/dsh-fs-sandbox | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| llm-deepseek | @deepseek-ai/dsh-llm-deepseek-api-key | 是 | 否 | — | — | — | — | 是 | OK：宿主已 served（通用/自动表单） |
| llm-deepseek-account | @deepseek-ai/dsh-llm-deepseek-account | 是 | 否 | — | — | — | — | 是 | OK：宿主已 served（通用/自动表单） |
| desktop-product-telemetry | @deepseek-ai/dsh-host-product-telemetry-otel | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| product-analytics | @deepseek-ai/dsh-client-product-analytics | 是 | 否 | 有 | — | — | — | 否 | OK：可 served（本宿主未加载/未收录） |
| subagent-model-selection-settings | @deepseek-ai/dsh-tool-subagent/model-selection-settings | 是 | 否 | — | — | — | 是 | 是 | OK：有设置页且可服务 |
| message-feedback | @deepseek-ai/dsh-message-feedback | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| session-log-download | @deepseek-ai/dsh-session-log-export | 是 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| open-in-app | @deepseek-ai/dsh-host-open-in-app | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| ui-open-in-app | @deepseek-ai/dsh-client-ui-open-in-app | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| workspace | @deepseek-ai/dsh-workspace | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| session-reference | @deepseek-ai/dsh-session-reference | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| file-reference-local | @deepseek-ai/dsh-file-reference-local | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| session-stats | @deepseek-ai/dsh-session-stats | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| session-turn-outline | @deepseek-ai/dsh-session-turn-outline | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| directory-picker | @deepseek-ai/dsh-host-directory-picker-auto | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| plugin-inventory | @deepseek-ai/dsh-host-plugin-inventory | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| session-controller | @deepseek-ai/dsh-api-session-controller | 是 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| job-controller | @deepseek-ai/dsh-api-job-controller | 是 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| terminal-controller | @deepseek-ai/dsh-api-terminal-controller | 是 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| workspace-files | @deepseek-ai/dsh-api-workspace-files | 是 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-settings-account | @deepseek-ai/dsh-client-ui-settings-account | 是 | 否 | 有 | 是 | ui-settings-account / ui-chat | 是 | 是 | OK：有设置页且可服务 |
| account-controller | @deepseek-ai/dsh-api-account-controller | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| settings-controller | @deepseek-ai/dsh-api-settings-controller | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| workspace-controller | @deepseek-ai/dsh-api-workspace-controller | 是 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| cordis-host-runner | @deepseek-ai/dsh-cordis-host-runner | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| cordis-inspect-providers | @deepseek-ai/dsh-tool-cordis/host | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| web-startup | @deepseek-ai/dsh-web-app/startup | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| webserver | @deepseek-ai/dsh-host-webserver | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| web-runtime | @deepseek-ai/dsh-web-app | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| client-hmr | @deepseek-ai/dsh-client-hmr | 是 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| modules | @deepseek-ai/dsh-client-modules | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| connection | @deepseek-ai/dsh-client-connection | 是 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| file-upload | @deepseek-ai/dsh-client-file-upload | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| api-remotes | @deepseek-ai/dsh-api-remotes | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| cordis-client-runner | @deepseek-ai/dsh-cordis-client-runner | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-theme | @deepseek-ai/dsh-client-ui-theme | 是 | 否 | 有 | — | <dynamic:entryId> / ui-theme | 是 | 是 | OK：有设置页且可服务 |
| locale | @deepseek-ai/dsh-client-locale | 是 | 否 | 有 | — | locale | 是 | 是 | OK：有设置页且可服务 |
| shortcuts | @deepseek-ai/dsh-client-shortcuts | 是 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-shortcuts | @deepseek-ai/dsh-client-ui-shortcuts | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-layout | @deepseek-ai/dsh-client-ui-layout | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-renderer | @deepseek-ai/dsh-client-ui-renderer | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-session | @deepseek-ai/dsh-client-ui-session | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| resources | @deepseek-ai/dsh-client-resources | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-sidebar | @deepseek-ai/dsh-client-ui-sidebar | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-sidebar-right | @deepseek-ai/dsh-client-ui-sidebar-right | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| office-to-pdf | @deepseek-ai/dsh-office-to-pdf | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| ui-sidebar-documentpreview | @deepseek-ai/dsh-client-ui-sidebar-documentpreview | 是 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-sidebar-browser | @deepseek-ai/dsh-client-ui-sidebar-browser | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-sidebar-terminal | @deepseek-ai/dsh-client-ui-sidebar-terminal | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-sidebar-files | @deepseek-ai/dsh-client-ui-sidebar-files | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-settings | @deepseek-ai/dsh-client-ui-settings | 是 | 否 | 有 | — | — | — | 是 | OK：宿主已 served（通用/自动表单） |
| ui-settings-general | @deepseek-ai/dsh-client-ui-settings-general | 是 | 否 | 有 | 是 | — | 是 | 是 | OK：有设置页且可服务 |
| ui-settings-models | @deepseek-ai/dsh-client-ui-settings-models | 是 | **是** | 有 | 是 | ui-settings-general | — | 否 | 无设置页（不适用） |
| ui-plugin-manager | @deepseek-ai/dsh-client-ui-plugin-manager | 是 | **是** | 有 | — | <dynamic:id> | — | 否 | 无设置页（不适用） |
| ui-settings-plugin-inventory | @deepseek-ai/dsh-client-ui-settings-plugin-inventory | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-conversation | @deepseek-ai/dsh-client-ui-conversation | 是 | 否 | 有 | — | ui-conversation | 是 | 是 | OK：有设置页且可服务 |
| ui-approval | @deepseek-ai/dsh-client-ui-approval | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-chat | @deepseek-ai/dsh-client-ui-chat | 是 | 否 | 有 | — | ui-chat | 是 | 是 | OK：有设置页且可服务 |
| ui-brand-official | @deepseek-ai/dsh-client-ui-brand-official | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-attachment | @deepseek-ai/dsh-client-ui-attachment | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-tool | @deepseek-ai/dsh-client-ui-tool | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-cordis | @deepseek-ai/dsh-client-ui-cordis | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-deliverables | @deepseek-ai/dsh-client-ui-deliverables | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| workspace-changes | @deepseek-ai/dsh-workspace-changes | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| ui-workspace | @deepseek-ai/dsh-client-ui-workspace | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-workflow-run | @deepseek-ai/dsh-client-ui-workflow-run | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-input-trigger | @deepseek-ai/dsh-client-ui-input-trigger | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-commands | @deepseek-ai/dsh-client-ui-commands | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-skill | @deepseek-ai/dsh-client-ui-skill | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-subagent | @deepseek-ai/dsh-client-ui-subagent | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-reference | @deepseek-ai/dsh-client-ui-reference | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-jobs | @deepseek-ai/dsh-client-ui-jobs | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-goal | @deepseek-ai/dsh-client-ui-goal | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-message-feedback | @deepseek-ai/dsh-client-ui-message-feedback | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-model-selection | @deepseek-ai/dsh-client-ui-model-selection | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-permission | @deepseek-ai/dsh-client-ui-permission-presets | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-agent-preset | @deepseek-ai/dsh-client-ui-agent-preset | 否 | **是** | 有 | 是 | — | — | 否 | 无设置页（不适用） |
| ui-settings-session-log | @deepseek-ai/dsh-client-ui-settings-session-log | 否 | **是** | 有 | — | session-log-deepseek | — | 否 | 无设置页（不适用） |
| ui-settings-plugins | @deepseek-ai/dsh-client-ui-settings-plugins | 否 | **是** | 有 | 是 | — | — | 否 | 无设置页（不适用） |
| ui-settings-shell | @deepseek-ai/dsh-client-ui-settings-shell | 否 | **是** | 有 | — | bash-sandbox / pwsh-sandbox | — | 否 | 无设置页（不适用） |
| ui-settings-agent-loop | @deepseek-ai/dsh-client-ui-settings-agent-loop | 否 | **是** | 有 | — | agent-loop | — | 否 | 无设置页（不适用） |
| ui-settings-subagent | @deepseek-ai/dsh-client-ui-settings-subagent | 否 | **是** | 有 | — | subagent / subagent-model-selection-settings | — | 否 | 无设置页（不适用） |
| ui-settings-web-search | @deepseek-ai/dsh-client-ui-settings-web-search | 否 | **是** | 有 | — | web-search-deepseek | — | 否 | 无设置页（不适用） |
| ui-plan | @deepseek-ai/dsh-client-ui-plan | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-user-questions | @deepseek-ai/dsh-client-ui-user-questions | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| ui-trajectory | @deepseek-ai/dsh-client-ui-trajectory | 否 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| agent-preset-registry | @deepseek-ai/dsh-agent-preset-registry | 是 | 否 | — | — | — | — | 是 | OK：宿主已 served（通用/自动表单） |
| preset-standard | @deepseek-ai/dsh-agent-preset | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| preset-ptc | @deepseek-ai/dsh-agent-preset | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| preset-minimal | @deepseek-ai/dsh-agent-preset | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| preset-cordis | @deepseek-ai/dsh-agent-preset | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| vision-adam | @deepseek-ai/dsh-vision-adam | 是 | 否 | 有 | 是 | <dynamic:entryId> / vision-adam | 是 | 否 | OK：有设置页且可服务 |
| taste | @deepseek-ai/dsh-taste | 是 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| btw | @local/dsh-btw | 是 | 否 | 有 | — | — | — | 是 | OK：宿主已 served（通用/自动表单） |
| wallpaper | @local/dsh-wallpaper | 是 | 否 | 有 | — | wallpaper | 是 | 是 | OK：有设置页且可服务 |
| usage | @local/dsh-usage | 是 | 否 | 有 | 是 | — | — | 是 | OK：宿主已 served（通用/自动表单） |
| session-status-board | @deepseek-ai/dsh-session-board | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| ssh-remote | dsh-workspace-enhancement | 是 | **是** | 有 | 是 | — | — | 否 | 无设置页（不适用） |
| directory-picker-ssh | dsh-workspace-enhancement/picker | 是 | **是** | 有 | 是 | — | — | 否 | 无设置页（不适用） |
| ssh-web-channel | dsh-workspace-enhancement/web | 是 | **是** | 有 | 是 | — | — | 否 | 无设置页（不适用） |
| workerspace | @local/dsh-workerspace | 是 | 否 | — | — | — | — | 是 | OK：宿主已 served（通用/自动表单） |
| dsh-pptmaster | @local/dsh-pptmaster | 是 | **是** | 有 | — | — | — | 否 | 无设置页（不适用） |
| directory-picker-browse | @deepseek-ai/dsh-host-directory-picker-browse | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| ssh-gui | @local/dsh-ssh-gui | 是 | 否 | 有 | 是 | — | — | 是 | OK：宿主已 served（通用/自动表单） |
| subagent-model | @local/dsh-subagent-model | 是 | 否 | 有 | 是 | <dynamic:entryId> / subagent-model / llm-pi-ai | 是 | 否 | OK：有设置页且可服务 |
| logfile | @local/dsh-logfile | 否 | **是** | — | — | — | — | 否 | 无设置页（不适用） |
| web-search-sse | @local/dsh-web-search-sse | 是 | 否 | — | — | — | — | 是 | OK：宿主已 served（通用/自动表单） |
| preset-standard-glm | @deepseek-ai/dsh-agent-preset | 是 | **是** | — | — | — | — | 否 | 无设置页（不适用） |


### C.3 客户端设置页索引（命名空间 ← 提供方包）与反查

`[实跑]` 反查结果：**17 个有设置页的字面量命名空间，全部在磁盘模块上可 served**
（`agent-loop`、`bash-sandbox`、`llm-pi-ai`、`locale`、`pwsh-sandbox`、`session-log-deepseek`、`subagent`、
`subagent-model`、`subagent-model-selection-settings`、`ui-chat`、`ui-conversation`、`ui-settings-account`、
`ui-settings-general`、`ui-theme`、`vision-adam`、`wallpaper`、`web-search-deepseek`；另 `entryId` 为通用动态页）。
⇒ **没有第二条"有页面但 Config 无 volatile"的同类缺口**（修复后）。

### C.4 缺口清单（全部列出）

- **修复后（磁盘现状）：0 条。**
- **修复前：2 条**
  - `subagent-model`（`@local/dsh-subagent-model`）← 设置页 `@local/dsh-subagent-model/lib/client.js`
    （`configForms.get("subagent-model")`，写 `provider`/`model`）
  - `vision-adam`（`@deepseek-ai/dsh-vision-adam`）← 设置页 `@deepseek-ai/dsh-vision-adam/lib/client.js`
    （`configForms.get("vision-adam")`，写 `model`/`baseURL`/`apiKeyEnv`/`maxTokens`）
- **不属于缺口但需要知悉的同类风险**（都不是"客户端有页面 + Config 无 volatile"，但同属"设置页看不到东西"）：
  - `session-status-board` / `session-board` / `logfile` / `taste` / `dsh-pptmaster`：
    宿主 Config 全非 volatile（或根本没有 Config 导出，如 `@local/dsh-logfile` 只有 `DEFAULT_CONFIG` 普通对象）
    ⇒ 不会被 settings 面收录；但它们**没有客户端设置页**，因此不是本次口径下的缺口。
    其中 `@local/dsh-logfile` 的配置只能走 `cordis.patch.yml` 原生编辑（**架构性限制**，不是本轮回归）。
  - `pwsh-sandbox`：有设置页（`dsh-client-ui-settings-shell` 同时看 `bash-sandbox`/`pwsh-sandbox`）且
    Config 有 volatile，但在 Linux 上该行 `disabled: !!js process.platform !== 'win32'` ⇒ 本机不 served（预期）。
  - `product-analytics`：Config 有 volatile，但该行 `disabled: !!js ctx.get('profileContext')?.name !== 'desktop'`
    ⇒ web profile 不加载（预期）。

### C.5 交叉核对：磁盘判定 vs 现役 3098 实抓 `[实跑]`

现役 3098 宿主的 `/api/settings/describe` 实抓（只读，未重启）返回 **25** 个 served 命名空间，
**不含 `vision-adam`、`subagent-model`**，而 `wallpaper`/`ssh-gui`/`usage`/`btw`/`workerspace`/`web-search-sse`
六个本地插件命名空间都在 ⇒ 这是"**这一台老进程加载的是旧模块**"的直接证据（见 §D.2）。

---

## D. 「修复是否足够」——明确结论

> ### 结论：**足够但需重启宿主才生效**（代码面已足够；现役 3098 进程内尚未生效）

**必须分开陈述的两件事**（工单要求）：**"代码正确"** 与 **"已生效"** 是两件独立的事。

### D.1 代码面：足够 `[实跑]+[源码]`

- `volatileForm !== undefined` ⇒ 两个条目都会进 served 列表（A，用 dsh-settings 自己的源码判定）；
- 设置页要写的**每一条**路径都 `isVolatilePath === true`，非设置页字段仍不可写（A.2）；
- 运行时解包正确：`subagent-model.apply()` 日志恢复为 `adam/deepseek-v4-pro`；`vision-adam`
  两条路径（有/无 settings 描述符）的 `baseURL/model/maxTokens/apiKeyEnv` 全是普通标量（B）；
- 消费侧链路仍是字符串（B.4），且写后 `describe()` 重新投影 ⇒ **子代理路由下一次派发即读到新值**；
- 无回归面：两个插件的 `apply()` 对"普通字符串 config"依然工作（B.3 对照），
  `plain`/`plainConfigOf` 对非引用值是 passthrough；两个插件没有其它宿主侧消费者
  `[实跑]`（全树 grep：只有 `dsh-tool-subagent/lib/index.js:74` 读 `subagent-model` 命名空间；
  `vision-adam` 命名空间没有第三方宿主消费者）。

### D.2 生效面：现役 3098 仍是旧模块，**必须重启宿主** `[实跑]`

| 证据 | 内容 |
|---|---|
| 宿主 boot 时刻 | `$A/home/logs/dsh-host.jsonl` 最后一个 `host log exporter active` = **2026-09-30T02:34:48.411Z = 10:34:48 +0800**，其后 76 条同进程日志一直写到 11:19（无新 boot marker）⇒ **本会话所在的 3098 宿主启动于 10:34:48** |
| 修复落盘时刻 | `subagent-model/lib/index.js` mtime **10:50:48.486**、`vision-adam/lib/index.js` mtime **10:51:19.481** ⇒ **晚于宿主启动 16 分钟** |
| 该进程未被禁用任何行 | `$A/logs/web-3098.log`（3098 launcher 的 tee）里 `disabling profile plugin row` = **0 条** ⇒ vision-adam 行是**加载了**的（本会话工具目录里也确实有 `analyze_image`，正是该插件注册的工具） |
| 但设置面不收录 | 该进程 `/api/settings/describe` 实抓 **25 个命名空间，不含 `vision-adam` / `subagent-model`** |
| 模块不会热重载 | `$B/dsh-hmr/lib/index.js:239` `root` 默认 `["."]`，本 profile 给的是 **`root: []`**（boot 日志 `hmr … watching []`）⇒ 只 `watchConfig` 监视 profile patch 做**配置**刷新，**不监视/不失效任何模块**；11:03 改 `cordis.patch.yml` 后宿主确实重读了 patch（web-3098.log 出现新的 YAML 警告）但模块未重载 |

⇒ 若进程内加载的是磁盘上的新版（schema 带 volatile），`describe()` **必收录**（A 的源码判定 + D.3 的实跑），
现在不收录 ⇒ **进程内模块 ≠ 磁盘模块** ⇒ **重启 3098 才会生效**。

### D.3 重启后确实会生效 `[实跑·旁证，另一执行档的 3099 drill，本档只读引用]`

`$A/logs/drill-3099-b.log`（drill-home 副本，boot 于 11:09:20.962，**在代码修复之后**）：

```
[settings-probe] SERVED-COUNT 27
[settings-probe] WATCH subagent-model => served revision=0 applies=live value={"provider":"adam","model":"deepseek-v4-pro"}
[settings-probe] WATCH vision-adam    => served revision=0 applies=live value={"apiKeyEnv":"ADAM_API_KEY","baseURL":"https://llmapi.roboscience.xyz/v1","model":"gpt-6-astra","maxTokens":393216}
```

27 = 现役 25 **+ 恰好这 2 个**；`value` 是普通标量且等于 `cordis.patch.yml` 里 P0-B 投放的原值
（不是插件默认的 opencode 网关）⇒ 与本档 §A/§B 的静态结论互为独立验证。

### D.4 ⚠️ 重启前置风险（本轮新发现，协调者必须知悉）：`vision-adam` 行靠 `compatibility.json` 豁免才允许加载

`[实跑]` `d-restart-compatibility.mjs` 用官方 `@deepseek-ai/dsh-app-boot` 导出的
`evaluatePluginCompatibility()` 跑真实清单：

| 条目 | 闸门判定（带现状豁免） | 闸门判定（假设无豁免文件） |
|---|---|---|
| `@deepseek-ai/dsh-vision-adam@0.2.0` | issue=有，但 **`exempted=true`**（`$A/home/profiles/web/compatibility.json` 里 `"@deepseek-ai/dsh-vision-adam@0.2.0": ["0.2.0-rc.2"]`）⇒ 允许加载 | **`dsh: disabling profile plugin row "vision-adam"`** ⇒ 整行禁用 |
| `@local/dsh-subagent-model@0.1.0` | issue=**无**（peer 范围写成显式 `>=0.1.1-rc.2 <0.2.0`，`includePrerelease` 下 0.2.0-rc.2 满足） | issue=无（不依赖豁免） |

原因：`^0.1.0-rc.7` 对 0.x 展开上界是 `<0.2.0-0`，`0.2.0-rc.2 > 0.2.0-0` ⇒ 不满足。

`[实跑]` 反例（同一台机、同一 profile 结构的 drill-home）：11:06:40 那次 boot **没有** `compatibility.json`
（该文件的 birth time = 11:09:20，正是下一次 boot 的时刻），官方 stderr 直接打印
`dsh: disabling profile plugin row "vision-adam" … Exact-version exemption: not active.`，
那次 `SERVED-COUNT 24`、`WATCH vision-adam => NOT-SERVED`。

⇒ **重启 3098 前必须确认 `$A/home/profiles/web/compatibility.json` 在位且含该豁免**（现已确认在位：
`readProfileCompatibility()` 读出 6 条豁免、无解析告警）。若丢失，后果不是"设置页不可用"，
而是 **`vision-adam` 整行被禁用、`analyze_image` 工具消失**。
本档未改该文件（不在写入边界内），仅上报。

### D.5 其它需知悉（非阻断）

- 两个设置页的客户端文案仍写「保存到 **settings.yaml** 的 X 段」（0.1.x 措辞），而 0.2.0 的
  `dsh-settings` README 明确 "Changes persist through the active profile's **Cordis patch**"
  （`documentPath` = `configEditor.documentPath`）⇒ 保存实际写回 `cordis.patch.yml`。
  **纯文案不一致，不影响功能**，本档不改代码。
- 重启 3098 会终止本会话（本会话就跑在该进程内），重启动作必须由协调者/用户在会话外执行。

---

## 未验证项（明确列出，不用"应该/大概"包装）

1. `[未验证]` **真实写入链路**：未在真实 `SettingsForms` + `configEditor` 上执行一次
   `configForms.get(ns).update([{op:"set",path:["model"],value:…}])` 并观察其落盘到
   `$A/home/profiles/web/cordis.patch.yml` 与 `revision` 自增 —— 该操作会改 `$A/**`（越界且会污染未重启的现役 profile）。
   已验证的替代证据：`write()` 的前置校验路径（`volatileForm`/`isVolatilePath`，A）与
   写后 `describe()` 投影（B.4）。
2. `[未验证]` 未起任何服务、未重启任何实例（纪律禁止）。"重启后 27 served"的实跑证据来自
   另一执行档的 **drill-home 副本** boot（`drill-3099-b.log`），其 `vision-adam`/`subagent-model` 行配置与
   `$A/home` 相同、豁免内容相同，但**不是 `$A/home` 本体重启**。
3. `[未验证]` 200 条登记表里 81 条"未发现导出 Config"是按"模块导出中能找到 schemastery schema"判定的
   （已知形态：普通对象配置如 `@local/dsh-logfile` 的 `DEFAULT_CONFIG`、纯客户端包等），未逐条人工确证；
   **不影响缺口清单**（C.3 反查显示：所有有设置页的命名空间都判到了）。
4. `[未验证]` 客户端"页面 ↔ 命名空间"关联是 `lib/client.js` 的**静态**解析（含 `const X_NS="…"` 常量解析），
   未在浏览器里逐页点开确认。
5. `[未验证]` 未展开 0.2.0 的 `settings.yaml` 一次性导入逻辑（README 描述的 id 映射导入）；
   本 profile 的 `settings.yaml` 已不在、只余 `settings.yaml.import-source`，判定为"已导入过"，
   与本次修复（加 volatile 标记）无交互。

## 结论强度汇总

| 项 | 强度 |
|---|---|
| A：改前 `volatileForm===undefined`（⇒ 整条跳过）/ 改后收录 + 写入路径全通过 | `[实跑]`（dsh-settings **源码文本**实例化判定） |
| A：修复只开放"设置页要写的那几个字段"，非设置页字段仍不可写 | `[实跑]` |
| B1：`.volatile()` ⇒ 运行时 cosmokit 引用对象 | `[实跑]` + `[源码]`（schemastery:265-273） |
| B2：改前模块吃 volatile config 会拼出 `[object Object]`；改后正确 | `[实跑]` |
| B3：`vision-adam.current()` 两条路径均为普通标量 | `[实跑]`（真跑 `apply`+`execute`，stub 传输） |
| B4：加 `.volatile()` 后子代理路由读取链路仍拿到字符串 | `[实跑]`（消费函数源码文本实例化）+ `[源码]`（`:436`+`:97-102`） |
| C：200 条登记表 / 缺口 = 修复后 0 条、修复前 2 条 | `[实跑]`（逐条真 import）+ `[实跑·静态]`（client.js 解析）；1 条口径外备注见"未验证项 3" |
| D：现役 3098 加载旧模块（代码正确 vs 已生效分开） | `[实跑]`（宿主 boot 时间线 + web-3098.log 0 条 disabling + 实抓 describe 缺两条） |
| D：重启后生效（27 served） | `[实跑·旁证]`（drill-home boot，非本档实跑） |
| D：`vision-adam` 靠 `compatibility.json` 精确版本豁免才能加载 | `[实跑]`（官方 `evaluatePluginCompatibility`）+ `[实跑]`（11:06 drill 反例） |
| 真实写入落盘 | `[未验证]`（见未验证项 1） |

## 本档**没有**做的事

- 没有修改任何插件源码、`cordis.patch.yml`、`compatibility.json`、`$A/**` 下其它文件；
- 没有起服务、没有重启 / kill 3080 / 3097 / 3098 / 3099（3099 是别的执行档的实例，未碰）；
- 没有写 `~/.dsh/**` 与 `~/.dsh-017/**`；
- 没有改 `reports/` 下别人已写的文件（只新建本文件）；
- 没有在报告里把"资料缺失"当"验证通过"：§D.4 的豁免风险与"未验证项"如实列出。
