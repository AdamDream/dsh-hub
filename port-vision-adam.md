# vision-adam 插件宿主侧代码移植报告（0.1.1-rc.2 → 0.1.5-rc.2）

- 日期：2026-09（web2 profile 并行切换期间）
- 修改文件（唯一被修改的文件）：
  `/home/CNS2026495165/.dsh/profiles/web2/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js`
- 未触碰：`/home/CNS2026495165/.dsh/profiles/node_modules/`（共享扁平层）、
  `/home/CNS2026495165/.dsh/profiles/web/`（旧 profile）

## 0. 问题背景

web2（0.1.5-rc.2）启动时 `@deepseek-ai/dsh-vision-adam` 加载失败：

```
The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'installSettingsSection'
```

根因：0.1.5 的 `@deepseek-ai/dsh-settings` 已删除 `installSettingsSection` 与 `settingsNamespace`
两个导出（0.1.5 只导出 `SettingsProvider` / `SettingsConflictError` / `redactSecrets`），
而 vision-adam 的 `lib/index.js:3` 静态 import 了它们。

## 1. 旧 API 用法盘点（0.1.1-rc.2）

原文件共 3 处用到被删除的 API：

| 位置 | 旧代码 | 作用 |
|---|---|---|
| 第 3 行 | `import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings"` | 模块顶层静态导入（加载失败的元凶） |
| 第 68 行 | `const VISION_ADAM_SETTINGS_NAMESPACE = settingsNamespace("vision-adam")` | 生成设置区命名空间（品牌化字符串，校验 `/^[a-z][a-z0-9-]*$/` 后原样返回） |
| 第 188 行 | `installSettingsSection(ctx, VISION_ADAM_SETTINGS_NAMESPACE, Config, config, { setSource, onChange })` | 注册设置区：schema=`Config`（z.object：apiKey[secret]、apiKeyEnv[credential-ref]、baseURL、model、maxTokens、maxBytes、maxVideoBytes），`entry=config` 作为 composition base 层，`setSource` 把读取函数注入插件局部变量 `current` |

旧 `installSettingsSection` 的实际语义（对照 web profile 的 dsh-settings 0.1.1 源码）：
`ctx.inject(["settings"], (sctx) => { sctx.settings.register(ns, schema, { base: entry }); hooks.setSource(() => scope.get()); ... })`
——即：设置服务存在时用 `register(ns, schema, { base: entry })` 注册并让 `setSource` 指向 `scope.get()`
（解析值 = schema 默认值 → base → 用户文档 section 三层叠加）；设置服务缺失时回退到 `entry`；
命名空间随插件 fiber 生命周期注册/注销。

## 2. 新版 API 研究结论（0.1.5-rc.2）

- `@deepseek-ai/dsh-settings` 0.1.5 的 `SettingsProvider` 类新增了实例方法
  `installSection(owner, ns, schema, entry, hooks)` —— 其函数体与旧版自由函数
  `installSettingsSection(ctx, ...)` **逐行等价**（`ctx.inject(["settings"])` 包装、`register(ns, schema, {base: entry})`、
  `setSource(() => scope.get())`、fiber 卸载时回退 `entry` 并触发 `onChange`、`scope.watch` 驱动 `onChange`），
  只是把 `ctx` 参数改名为 `owner`、把 `sctx.effect` 改为 `this.ctx.effect`。
- 在 0.1.5 中，`ctx.inject(["settings"], ...)` 包装必须由插件自己写
  （见现成范本 `dsh-tool-subagent/lib/model-selection-settings.js`、
  `dsh-web-search-deepseek/lib/index.js`、`dsh-llm-deepseek/lib/index.js`，
  均为 `apply(ctx, config)` 内 `ctx.inject(["settings"], (settingsCtx) => settingsCtx.settings.installSection(ctx, NS, Config, config, {...}))` 形态）。
- 命名空间不再需要 `settingsNamespace()` 品牌函数：`installSection`/`register` 内部
  `parseSettingsNamespace` 会对普通字符串做同样的 `/^[a-z][a-z0-9-]*$/` 校验；
  0.1.5 插件统一用普通字符串常量（如 `"subagent-model-selection"`）。
- 设置区如何被 GUI 消费：设置客户端（`dsh-api-settings-controller` + `dsh-client-ui-settings*`）
  通过 `ctx.settings.describe()` / `describe({redactSecrets:true})` 读取，以 **ns 字符串**为键
  （descriptor 含 `ns / schema / value / revision / base / user / applies / secrets`）。
  ns 字符串保持不变（`"vision-adam"`）即消费方式不变。

## 3. 改动摘要（旧用法 → 新用法逐处映射）

| 旧用法 | 新用法 |
|---|---|
| `import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings"`（第 3 行） | **整行删除**。0.1.5 下插件不再需要 import dsh-settings（`installSection` 是挂在 `ctx.settings` 服务上的方法） |
| `settingsNamespace("vision-adam")`（第 68 行） | 字面量字符串 `"vision-adam"`（0.1.5 由 `parseSettingsNamespace` 在注册时做同样的命名校验；该命名空间名本身不变） |
| `installSettingsSection(ctx, NS, Config, config, hooks)`（第 188 行） | `ctx.inject(["settings"], (settingsCtx) => { settingsCtx.settings.installSection(ctx, NS, Config, config, hooks) })`（第 187–194 行）；hooks `{ setSource, onChange }` 原样保留 |

**保持不变的部分**：`Config` schema（7 个字段名、role、默认值全部原样）、
`resolveOptions` / `resolveApiKey` / `adamAnalyze` / `readImageBytes`、
`inject = ["tools", "fs", "systemPrompt"]`、`name = "vision-adam"`、
`analyze_image` 工具注册与 `systemPrompt.section`、导出列表
（`Config, VISION_ADAM_SETTINGS_NAMESPACE, apply, inject, name` 与原来完全一致）。

行为等价性说明：
- 设置解析层叠顺序（schema 默认值 → composition base=config → 用户 section）与旧版完全一致；
- 设置服务缺失时 `current` 回退到 `config`、设置变更时 `onChange` 通知、命名空间随 fiber 生命周期
  注册/注销的语义均由 0.1.5 `installSection` 原样提供（函数体等价）；
- `VISION_ADAM_SETTINGS_NAMESPACE` 导出值从"品牌化字符串"变为普通字符串，运行时值相同（`"vision-adam"`），
  `describe()` 中 ns 不变，GUI 消费无需任何调整。

## 4. 验证输出

### 4.1 语法检查

```
$ node --check /home/CNS2026495165/.dsh/profiles/web2/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js
CHECK OK
```

### 4.2 模块级 import（依赖解析）

```
$ cd /home/CNS2026495165/.dsh/profiles/web2 && node --input-type=module -e \
  "await import('file:///.../dsh-vision-adam/lib/index.js').then((m) => console.log('import OK; exports:', Object.keys(m).join(', ')))"
import OK; exports: Config, VISION_ADAM_SETTINGS_NAMESPACE, apply, inject, name
```

（import 无任何运行时副作用失败——模块顶层只做常量定义与 export，`apply()` 不会被调用。）

### 4.3 运行时冒烟测试（用真实 0.1.5 dsh-settings + cordis 驱动移植后的接线）

搭建最小 cordis Context + 内存版 SettingsProvider（仿 `dsh-settings-file`：`load/persist`、`writable=true`），
在插件 fiber 内逐字执行移植后的设置注册代码，断言：

```
settings service mounted: true
ns: vision-adam
resolved: {"apiKeyEnv":"ADAM_API_KEY","baseURL":"https://llmapi.roboscience.xyz/v1","model":"smoke-model","maxTokens":1024,"maxBytes":20971520,"maxVideoBytes":52428800}
source() equal: true
after update: {..., "model":"user-model", ...} onChangeCount: 2
describe: ns=vision-adam revision=1 applies=live secretFields=1 userKeys=model
duplicate rejected: settings namespace "vision-adam" is already registered
SMOKE OK
```

覆盖点：①`installSection` 注册成功；②解析值 = schema 默认值 + base(config) 正确层叠；
③`setSource` 注入的读取函数返回解析值；④用户写路径 `update()` → 重解析 → watcher → `onChange`
（计数 1→2）；⑤GUI 消费视角 `describe({redactSecrets:true})` 产出 ns/revision/applies/secrets
（apiKey 的 secret 槽正确上报）；⑥重复注册按 0.1.5 语义 loud fail。
（测试脚本 `/tmp/vision-adam-smoke.mjs`、`/tmp/probe.mjs` 为临时文件，未进入工作区。）

## 5. 遗留风险

1. **未做全量 web2 启动验证**：上述验证覆盖了模块加载与设置接线的运行时语义，但没有在本机
   启动完整 web2 服务走一遍 GUI 设置页。理论上 `dsh-settings-file`（真实 provider，已确认在 web2
   profile 中挂载）与 `describe()` 键均为 ns 字符串 `"vision-adam"`，无消费侧差异，但建议在
   下次 web2 启动时确认设置区出现且可读写。
2. **`settingsNamespace` 品牌的丢失**：旧值带运行时类型品牌（仅类型层面，运行时就是字符串），
   新值为普通字符串；本插件没有其它模块 import `VISION_ADAM_SETTINGS_NAMESPACE`
   （grep web2 全量 node_modules 无 `dsh-vision-adam` 的引用方），故无外部影响。
3. **插件 package.json 未改**：`peerDependencies` 仍写 `@deepseek-ai/dsh-settings: ^0.1.0-rc.7`，
   与 0.1.5 实际安装版本（^0.1.5-rc.2 满足上界）在 npm 语义上兼容；如需严格化可后续将 peerDependencies
   上调为 `^0.1.5-rc.2`（任务只允许改 index.js，故未动）。
4. **`installSection` 未传 `validate` hooks**：与旧版一致（旧版本就不传），0.1.5 下
   schema 校验由 `Config` 本身承担，行为不变。
5. **若 web2 启动后仍报错**，检查是否命中其它 0.1.1→0.1.5 宿主 API 差异（本文件内其余 import：
   `@deepseek-ai/dsh-credentials`、`@deepseek-ai/dsh-launch-environment`、`@deepseek-ai/dsh-tools`
   均为 peerDep 中仍存在的包，模块级 import 已证明可解析；`apply()` 内的 `ctx.tools.register` /
   `ctx.systemPrompt.section` 签名未在本次范围验证）。
