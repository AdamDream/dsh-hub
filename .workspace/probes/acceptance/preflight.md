# 停机前冷面装载预检报告（2026-09-17 批次）

- 执行时间：2026-09-17 17:47–17:51
- 执行者：只读预检档（workspace-write 沙箱，未使用 sandbox_permissions，未重启、未改配置、未 install）
- 工作目录：`/home/CNS2026495165/dsh`
- 方式：每项先读真实文件/代码，再跑真实验证命令，原始命令与原始输出逐条记录

---

## 0. 结论表（go / no-go）

| # | 项目 | 结论 | 关键证据（一句） |
|---|---|---|---|
| 1 | 新插件 `@local/dsh-subagent-model` | **GO** | host `lib/index.js` + `lib/client.js` + `package.json` 三件齐全，部署位与 `.workspace/deploy-subagent-model` 三件 `sha256` 全等；host 入口 `import()` 成功返回 6 个导出；历史「只有 client.js 缺 host index.js」故障形态**不存在** |
| 2 | 宿主 lib 补丁（dsh-tool-subagent / dsh-goal-round-driver） | **GO** | 两处部署位（profiles 与 npm-global）为**同一 inode 硬链**，均与 `.workspace` patched 全文字节相等（sha `65288049…`）；P0' 关键标识在 L107-137 / L527-535；goal L67/82/259-281 有 pendingSubagents 与 pause 分支；`node --check` 双通过；`.rej`/`.orig` 残留 0 |
| 3 | `@local/dsh-btw` 部署位齐全性 + 模型改动 | **GO** | 6 个 `package.json` 入口（main/exports/typert/remote/patch）全部命中；3 个 `node --check` 通过；默认模型 `deepseek-v4.1-flash` 在 L210/350/1698/1705/1720，热读 schema `BTW_SETTINGS_SCHEMA` 在 L1686-1731、热读函数 `readBtwSettings` 在 L246-252 |
| 4 | `~/.dsh/profiles/web/cordis.patch.yml` | **GO** | 末条 insert（L84-86）包名为**bare 包名** `'@local/dsh-subagent-model'`，非文件路径；`web2` 仅出现在 L26 注释中，**未启用**；DSH 自身组合解析成功（`--dump-config` exit=0，`dsh-subagent-model` 在组合树 L547-548 且恰好 1 次） |
| 5 | preset `standard-glm/agent.cordis.yml` | **GO** | 两处子代理模型均为 `adam` / `deepseek-v4.1-flash`（L194-195、L205-206）；YAML 在 `!!js` 标签正确处理下解析成功（16 个顶层条目，2 处 agentOptions 均为目标值） |
| 6 | 备份与回滚路径 | **NO-GO（1 处红灯）** | 5 个回滚目标中 **4 个真实可解析**；但 §3 表格第 4 行 `dsh-tool-subagent.index.js.bak-*.bak` 的 glob **实际解析为 0 个文件**（见 §6 红灯 R1），按字面执行会导致回滚静默失败 |
| 7 | 依赖完整性 | **GO** | 新插件 3 个 peer 依赖全部 RESOLVED；组合树 145 个插件名**全部**从 `~/.dsh/profiles` 可解析，0 个 UNRESOLVED；patched host lib 的 6 个 import 与 goal 的 3 个 import 全部 OK |

**总评：GO（附 1 处回滚红灯）** —— 重启后的**装载路径安全**（无加载失败风险），可以重启；
但 `RESTART-ACCEPTANCE.md` §3 的回滚表必须先修一处 glob 才能保证回滚可用。

### 三类明确区分

- **已验证通过**：第 1、2、3、4、5、7 项全部关键断言（均有原始输出支撑）。
- **无法验证（已说明缺什么）**：
  - **V1** 预检档**不能真正启动** DSH（纪律禁止重启；且沙箱为只读，`--dump-config` 需要写 `cordis.yml`，见 §4.3）。
    因此「重启后无运行期异常」只能靠**组合解析 + 模块解析 + 冒烟导入**三条冷面证据覆盖，**运行期实测未被本档执行**。
  - **V2** 新插件设置页（client `settings.section`）的**浏览器端运行**未验证；本档只能在 Node 里用
    `window.__ModuleLoader__` stub 验证其注册与导出（见 §1.5），真实渲染需重启后人眼确认。
  - **V3** `dsh.client.inject` 所列 `@deepseek-ai/dsh-client-runtime` / `dsh-client-ui-settings`
    是否在 client 侧装载期被正确解析，属浏览器装载链，本档无法验证（宿主侧 `require.resolve` 可达，但不构成等价证据）。
- **发现缺陷**：**R1**（回滚 glob 不匹配，红灯，§6）、**N1**（btw 回滚会连带回退 P0-b 热读，黄灯，§6）。

---

## 1. 新插件 `@local/dsh-subagent-model`

部署位：`~/.dsh/profiles/node_modules/@local/dsh-subagent-model/`

### 1.1 目录内文件清单

```bash
$ find ~/.dsh/profiles/node_modules/@local/dsh-subagent-model -type f | sort
/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-subagent-model/lib/client.js
/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-subagent-model/lib/index.js
/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-subagent-model/package.json
```

产物源目录：`/home/CNS2026495165/dsh/.workspace/deploy-subagent-model/`（含 `lib/index.js`、`lib/client.js`、`package.json` 三件，另有 `dsh-tool-subagent.index.js.patched`、`dsh-tool-subagent.p0.diff`、`evidence/`）

### 1.2 `main` / `exports` / `dsh.client` 指向的文件是否真实存在

`package.json`（部署位全文，`cat` 原文摘录）：

```json
"type": "module",
"main": "lib/index.js",
"exports": {
  ".": "./lib/index.js",
  "./client": "./lib/client.js",
  "./package.json": "./package.json"
},
"dsh": {
  "client": {
    "platform": "web",
    "inject": [
      "@deepseek-ai/dsh-client-runtime",
      "@deepseek-ai/dsh-client-ui-settings"
    ]
  }
}
```

逐一比对指向与实物：

| 声明 | 指向 | 实物 | 结论 |
|---|---|---|---|
| `main` | `lib/index.js` | 2211 B | ✅ 存在 |
| `exports["."]` | `./lib/index.js` | 同上 | ✅ 存在 |
| `exports["./client"]` | `./lib/client.js` | 17099 B | ✅ 存在 |
| `exports["./package.json"]` | `./package.json` | 934 B | ✅ 存在 |
| `dsh.client.platform` | `web` | — | ✅ 值合法 |
| `dsh.client.inject` | 2 个 client 包 | 宿主侧可解析 | ✅（浏览器侧见 V3） |
| `dsh.bundle.patch` | **未声明** | 无 `cordis.patch.yml` | ✅ 自洽：该插件经 profile `cordis.patch.yml` 的 insert 挂载，不靠自带 patch |

> 注：本插件把 `dsh.client` 声明为**对象**（含 `platform`/`inject`），与 `dsh-btw` / `dsh-pptmaster` / `dsh-usage` 的声明形态一致，**不是**「`dsh.client` 写成字符串」的形态，无缺陷。
>
> **历史故障形态对照**（本批次重点）：`@local/dsh-subagent-model` **同时具备** host 入口 `lib/index.js`（2211 B）与 client 入口 `lib/client.js`（17099 B），并非「只落 client.js 而 `main` 指向缺失的 index.js」。**该重启级故障形态在本批次不存在。**

### 1.3 与产物源逐字节比对

```bash
$ for f in package.json lib/index.js lib/client.js; do
    cmp <部署位>/$f <.workspace/deploy-subagent-model>/$f && echo "IDENTICAL: $f"; done
IDENTICAL: package.json
IDENTICAL: lib/index.js
IDENTICAL: lib/client.js
```

```bash
$ sha256sum   # 部署位 vs 产物源
package.json   deploy=11df864f7225d90f5ea32ba38cfa1c9513bd0d0a19148a97c0bbd91e243ed0cf
package.json   source=11df864f7225d90f5ea32ba38cfa1c9513bd0d0a19148a97c0bbd91e243ed0cf
lib/index.js   deploy=e93de18da406d3ed71ccf52e95e580174ea687ed69b6c1662b5f1de9026baedc
lib/index.js   source=e93de18da406d3ed71ccf52e95e580174ea687ed69b6c1662b5f1de9026baedc
lib/client.js  deploy=5f16927be1db9f1d7495d50fa4f1f1a277af89b57aed042898f5fb5830c51521
lib/client.js  source=5f16927be1db9f1d7495d50fa4f1f1a277af89b57aed042898f5fb5830c51521
```

**结论：部署位 == 产物（三件全部 sha256 相等）。**

### 1.4 `node --check` 语法检查

```bash
$ cd ~/.dsh/profiles/node_modules/@local/dsh-subagent-model
/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-subagent-model
$ node --check lib/index.js && echo CHECK_OK_index; node --check lib/client.js && echo CHECK_OK_client
CHECK_OK_index
CHECK_OK_client
```

### 1.5 入口冒烟：从插件自身目录执行（确保 peer 依赖可解析）

```bash
$ node -e "...require.resolve(p)..."
RESOLVED @deepseek-ai/schemastery -> .../dsh/node_modules/@deepseek-ai/schemastery/lib/index.cjs
RESOLVED @deepseek-ai/dsh-settings -> .../dsh/node_modules/@deepseek-ai/dsh-settings/lib/index.js
RESOLVED @deepseek-ai/cordis -> .../dsh/node_modules/@deepseek-ai/cordis/lib/index.js
```

**host 入口 ESM 冒烟（真实 `import()`）：**

```bash
$ node --input-type=module -e "
const p='/home/CNS2026495165/.dsh/profiles/node_modules/@local/dsh-subagent-model/lib/index.js';
import(p).then(m=>console.log('IMPORT_OK keys=',Object.keys(m)))..."
IMPORT_OK keys= [ 'Config', 'DEFAULT_ROUTE', 'NS', 'apply', 'inject', 'name' ]
```

✅ host 入口可被 Node 真正求值，`apply`/`inject`/`name` 齐备（DSH 插件面契约满足）。

**client 入口：** 直接 `import()` 会得到

```bash
IMPORT_FAIL ReferenceError window is not defined
```

这是**预期且非缺陷**：该文件是浏览器端模块，首行即 `window.__ModuleLoader__.load({ id: "@local/dsh-subagent-model", factory: (require) => {...} })`，与 `dsh-btw` / `dsh-usage` / `dsh-pptmaster` 三个已知可用插件的 client 产物**形态完全一致**（四者首行均为 `window.__ModuleLoader__.load({`）。用 stub 做等价验证：

```bash
$ node -e "
globalThis.window = { __ModuleLoader__: { load: (def) => { globalThis.__DEF = def; } } };
require('.../dsh-subagent-model/lib/client.js');
const d = globalThis.__DEF;
console.log('REGISTERED id =', d.id);
const exp = d.factory((n)=>require(n));
console.log('FACTORY_OK exports =', Object.keys(exp));
console.log('inject =', JSON.stringify(exp.inject));"
REGISTERED id = @local/dsh-subagent-model
FACTORY_OK exports = [ 'apply', 'inject' ]
inject = ["slots","settingsScope"]
apply type = function
```

✅ client bundle 注册 id 正确、factory 可执行、导出面符合 `dsh.client` 约定。

**host/client 契约交叉验证（关键）**：host `lib/index.js` L19 使用
`import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings"`，
实测该包导出面确实包含这两者：

```bash
$ node --input-type=module -e "const m=await import('@deepseek-ai/dsh-settings'); ..."
installSettingsSection type: function
settingsNamespace type: function
```

且 `installSettingsSection` 自己就是 `ctx.inject(["settings"], ...)` 登记（源码 L618-619），
与插件 `inject = []`（host L23「settings is injected by installSettingsSection」）**自洽**——
**不存在「settings 服务未就绪导致启动抛错」的时序风险**。

---

## 2. 宿主 lib 补丁

### 2.1 ⚠️ 简报给定路径与实际部署位不一致（记录）

简报给的 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js` **不存在**：

```bash
$ ls -la ~/.npm-global/lib/node_modules/@deepseek-ai/dsh-tool-subagent
ls: 无法访问 '.../dsh-tool-subagent': 没有那个文件或目录
[exit code: 2]

$ ls ~/.npm-global/lib/node_modules/@deepseek-ai/
cordis-plugin-group
dsh
```

真实布局：包在 `@deepseek-ai/dsh` 内部，且 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-subagent` 是指向它的**符号链接**，两处为**同一 inode**：

```bash
$ stat -c '%i %s %n' <profiles 路径> <npm-global 路径>
33030654 37296 /home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js
33030654 37296 /home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js

$ readlink -f ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-subagent
/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tool-subagent
```

（inode 相同 ⇒ 补这两处任一即等于补两处，**不存在只补一处的风险**。）

### 2.2 与 `.workspace` patched 全文对照

```bash
$ sha256sum .workspace/deploy-subagent-model/dsh-tool-subagent.index.js.patched \
            ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js \
            ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js
65288049b2fada12cb1686c92a0515f54a170b7843ba4c2d6bf988ca6a841214  .../dsh-tool-subagent.index.js.patched
65288049b2fada12cb1686c92a0515f54a170b7843ba4c2d6bf988ca6a841214  .../profiles/.../dsh-tool-subagent/lib/index.js
65288049b2fada12cb1686c92a0515f54a170b7843ba4c2d6bf988ca6a841214  .../npm-global/.../dsh-tool-subagent/lib/index.js

$ cmp <patched> <profiles 部署位> && echo IDENTICAL
IDENTICAL
```

✅ 三处 sha256 全等，部署位 == patched 全文。

### 2.3 关键标识 grep + 行号（settings 层读取 `dsh-subagent` 命名空间的代码）

```bash
$ grep -n 'dsh-subagent\|settingsNamespace\|agentOptions\|settings' \
      ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js
107: * Effective configured child Agent options for one delegation, layering the
108: * hot-reloaded `dsh-subagent` settings namespace over the preset-static
109: * agentOptions: a non-empty settings `provider`/`model` overrides the preset
110: * field; a missing key keeps the preset value; a failed settings read (service
115: * @param runtimeCtx - install context whose `settings` service owns the namespace.
120: function effectiveConfiguredAgentOptions(runtimeCtx, configured) {
122:  const settings = runtimeCtx.get("settings");
123:  settingsValue = settings === void 0 || typeof settings.get !== "function" ? void 0 : settings.get("dsh-subagent");
127: if (settingsValue === void 0 || typeof settingsValue !== "object" || settingsValue === null) return configured;
128: const provider = typeof settingsValue.provider === "string" && ... : void 0;
129: const model = typeof settingsValue.model === "string" && ... : void 0;
290: agentOptions: z.object({
527: // P0' `dsh-subagent` settings default layer: hot, per-dispatch read.
528: // Settings win over the preset-static agentOptions; missing or failed
530: const effectiveAgentOptions = effectiveConfiguredAgentOptions(runtimeCtx, config.agentOptions);
552: ...requestedChildAgentOptions !== void 0 ? { agentOptions: requestedChildAgentOptions } : {},
```

✅ **关键行号**：热读 `settings.get("dsh-subagent")` 在 **L123**；生效装配点在 **L527-535**；回退语义（缺 key 保 preset、读失败不抛）在 **L127-137**。

### 2.4 补丁 delta 与备份对照（确认「补丁确实在部署位」）

```bash
$ diff ~/.dsh/backups/dsh-tool-subagent.index.js.bak-20260917-165928 \
       ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js
[46 行差异]
106a107,137   > function effectiveConfiguredAgentOptions(runtimeCtx, configured) { ... }   ← P0' 新增函数
496c527,531   < const requiresRoutePreflight = ... hasConfiguredLlmSelection(config.agentOptions);
              > const effectiveAgentOptions = effectiveConfiguredAgentOptions(runtimeCtx, config.agentOptions);
499,500c534,535 < ...config.agentOptions ... } : config.agentOptions, modelRequest, modelSelectionEnabled);
                > ...effectiveAgentOptions ... } : effectiveAgentOptions, modelRequest, modelSelectionEnabled);
```

✅ 与 P0' 设计一致：新增热读函数 + 调用点改为经 settings 层解析。备份确为**改动前**状态（sha `1416512c…` ≠ 部署位 `65288049…`）。

### 2.5 `dsh-goal-round-driver` 对应 lib 文件

```bash
$ ls -la ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-goal-round-driver
lrwxrwxrwx ... -> /home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-goal-round-driver
$ ls lib/
index.js (15273)  invariant.js (3932)  types/

$ node --check ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-goal-round-driver/lib/index.js && echo CHECK_OK_goaldriver
CHECK_OK_goaldriver
```

**pause 与 pending-subagent 分支（grep + 行号）：**

```bash
$ grep -n 'pendingSubagents\|pause' .../dsh-goal-round-driver/lib/index.js
67:  pendingSubagents: 0,
82:  return ctx.fiber.state === 2 && !state.stopping && ctx.agents.get(state.agent.id) === state.agent
      && state.agent.status === "idle" && state.pendingSubagents === 0 && !state.competingQueued;
227: ctx.goals.pause(agent, goalRef(goal));
229: ctx.logger.warn(`goal-round-driver: could not pause cancelled goal for agent "${agent.id}": ${...}`);
239: if (change.operation === "pause" && agent.status === "running" && ctx.agents.currentInitiator() !== agent)
        agent.cancel({ kind: "user" }, { keepInbox: true });
259: * Keep one pending-subagent count per parent agent so goal rounds are not
260: * injected while the parent waits for a background subagent to settle.
270: ctx.on("subagent/start", function (info) { ... state.pendingSubagents += 1; });
275: ctx.on("subagent/end", function (info) { ... });
281: if (state.pendingSubagents === 0) state.competingQueued = true;
```

✅ 两个分支均在部署位：**pause 中止**（L227-239）与 **pending-subagent 防空转**（L67/82/259-281，含 `subagent/start`/`subagent/end` 计数与 `competingQueued` 门控）。

部署位 sha 与其自身备份对比（确认部署位是补丁后版本）：

```bash
$ sha256sum .../dsh-goal-round-driver/lib/index.js ~/.dsh/backups/goal-round-driver.index.js.*.bak
c4f3ea68c56f51a11818bb5da096367fb65a711fa29bb70ed3f8384af9cf8973  .../dsh-goal-round-driver/lib/index.js
0fe69e0fc97b1eb23e40b7365bdd142ef18e284e81e9a58b97a4e4de474f9227  .../goal-round-driver.index.js.P0A.bak
ce17b05008cabf70de00fd1f5f7040b42d39671648fd64b21674a137ecb6d69a  .../goal-round-driver.index.js.pending-subagent.bak
```

（两备份分别为 P0-A 前 / pending-subagent 前的历史态，均与部署位不同 ⇒ 部署位是叠加补丁后的版本。）

### 2.6 `.rej` / `.orig` 残留

```bash
$ find ~/.npm-global/lib/node_modules/@deepseek-ai ~/.dsh/profiles/node_modules \
       \( -name '*.rej' -o -name '*.orig' \) 2>/dev/null
[无输出]
$ find ... -name '*.rej' -o -name '*.orig' | wc -l
0
```

✅ **0 个残留**，无半成品补丁。

附带发现（**非本批次、非缺陷**）：live node_modules 内另有 2 个历史 `.bak`
（`@local/dsh-workerspace/lib/index.js.bak`、`@local/dsh-pptmaster/lib/client.js.bak`），
既不被 `main`/`exports` 指向，也不干扰装载。

### 2.7 patched host lib 的依赖闭包

```bash
$ cd .../dsh-tool-subagent && grep -o 'from "[^"]*"' lib/index.js | sed ... | while read m; do
    node --input-type=module -e "await import('$m')" && echo OK $m; done
OK @deepseek-ai/dsh-llm
OK @deepseek-ai/dsh-scope
OK @deepseek-ai/dsh-subagent
OK @deepseek-ai/dsh-tools
OK @deepseek-ai/schemastery
OK zod
```

✅ 6 个 import 全部可解析（goal driver 的 `@deepseek-ai/dsh-llm` / `dsh-scope` / `node:util` 同样全 OK）。

---

## 3. `@local/dsh-btw`

### 3.1 部署位文件清单与入口齐全性

```bash
$ B=~/.dsh/profiles/node_modules/@local/dsh-btw
$ for f in lib/index.js lib/client.js lib/typert.host.js lib/typert.remote-client.js cordis.patch.yml lib/index.d.ts; do
    [ -f "$B/$f" ] && echo "OK   $f" || echo "MISS $f"; done
OK   lib/index.js
OK   lib/client.js
OK   lib/typert.host.js
OK   lib/typert.remote-client.js
OK   cordis.patch.yml
OK   lib/index.d.ts
```

`package.json` 声明的入口 → 实物：`main` `lib/index.js` ✅；`exports["."]` ✅；
`exports["./client"]` `./lib/client.js` ✅；`exports["./typert"]` `./lib/typert.host.js` ✅；
`exports["./remote"]` `./lib/typert.remote-client.js` ✅；`exports["./cordis.patch.yml"]` ✅；
`dsh.bundle.patch` `./cordis.patch.yml` ✅。**7/7 命中，无悬空入口。**

语法检查：

```bash
$ for f in lib/index.js lib/client.js lib/typert.host.js; do node --check $B/$f && echo "CHECK_OK $f"; done
CHECK_OK lib/index.js
CHECK_OK lib/client.js
CHECK_OK lib/typert.host.js
```

host 入口 ESM 冒烟（`import()` 真求值成功，13 个导出，含 `apply` / `name` / `BTW_SETTINGS_SCHEMA`）。

### 3.2 默认模型改为 `deepseek-v4.1-flash`（grep + 行号）

```bash
$ grep -rn 'deepseek-v4\.1-flash' $B/lib/
lib/index.js:210:  model: "deepseek-v4.1-flash",              ← VISION_DEFAULTS（识图默认，非本次改动）
lib/index.js:345:  "deepseek-v4.1-flash",                     ← BTW_FALLBACK_MODELS 首项
lib/index.js:350:const BTW_FALLBACK_DEFAULT_MODEL = "deepseek-v4.1-flash";
lib/index.js:353:* created before the v4-flash → v4.1-flash switch (2026-09-16) keep their
lib/index.js:360:const BTW_LEGACY_MODEL_MAP = { "deepseek-v4-flash": "deepseek-v4.1-flash" };
lib/index.js:1698:  default: z.string().default("deepseek-v4.1-flash"),      ← schema 内层 default
lib/index.js:1705:  default: "deepseek-v4.1-flash",                         ← schema model 段默认
lib/index.js:1720:  default: "deepseek-v4.1-flash",                         ← 整个 schema 默认
lib/remote-Dv1GpyGK.js:22:  "deepseek-v4.1-flash",
lib/client.js:1131:  const BTW_DEFAULT_MODEL = "deepseek-v4.1-flash";
lib/client.js:1134:  "deepseek-v4.1-flash",
lib/client.js:1647:  value: state.model ?? settings.model?.default ?? "deepseek-v4.1-flash",
lib/client.js:8278/8282: (legacy 注释 + 常量)
```

✅ 默认模型 = `deepseek-v4.1-flash`，且 **legacy 映射** `deepseek-v4-flash → deepseek-v4.1-flash` 在 L360（部署位代码里确实存在）。

### 3.3 `model.default` / `model.options` 热读 schema（grep + 行号）

```bash
$ grep -n 'function readBtwSettings' -A 8 $B/lib/index.js
246:function readBtwSettings(ctx) {
247:  try {
248:    const section = ctx.get("settings")?.get?.("dsh-btw");
249:    if (section !== null && typeof section === "object") return section;
250:  } catch {}
251:  return {};
252:}
```

```bash
$ sed -n '1686,1731p' $B/lib/index.js        # BTW_SETTINGS_SCHEMA
1686: const BTW_SETTINGS_SCHEMA = z.object({
1687:   ui: z.object({ banner/modelSelect/imageBadge ... }),
1696:   vision: z.object({ autoTransform: ... }),
1697:   model: z.object({
1698:     default: z.string().default("deepseek-v4.1-flash"),
1699:     options: z.array(z.string()).default([
1700:       "deepseek-v4.1-flash", "glm-5.3", "deepseek-v4-pro"
1703:     ])
1704:   }).default({ default: "deepseek-v4.1-flash", options: [...] })
1712: }).default({ ui: {...}, vision: {...}, model: { default: "deepseek-v4.1-flash", options: [...] } });
```

调用点（证明**每次调用都重读**，即真热读）：

```bash
$ grep -n 'readBtwSettings(ctx)' $B/lib/index.js
366:  const options = readBtwSettings(ctx).model?.options;
374:  return sanitizeBtwModel(readBtwSettings(ctx).model?.default, btwRoutableModels(ctx));
```

✅ schema 内 `model.default` / `model.options` 在部署位（L1697-1711），热读函数在 L246-252，
两个消费点 **L366 / L374** 每次调用重读 ⇒ 改 `dsh-btw.model.default` 热生效（重启后可用）。

依赖：

```bash
$ node --input-type=module -e "for (const p of ['@deepseek-ai/schemastery','zod']) ..."
RESOLVED @deepseek-ai/schemastery keys= 1
RESOLVED zod keys= 260
```

---

## 4. `~/.dsh/profiles/web/cordis.patch.yml`

### 4.1 末尾 insert 条目：包名逐字核对（bare 包名）

```bash
$ cat -n ~/.dsh/profiles/web/cordis.patch.yml | tail -6
82  # dsh-subagent-model（子代理默认模型设置页 + dsh-subagent 设置命名空间，P0'/P0）；
83  # settings 命名空间 dsh-subagent 由插件自注册（默认 = preset 固定路由 adam/deepseek-v4.1-flash）
84  - insert:
85      - id: dsh-subagent-model
86        name: '@local/dsh-subagent-model'
```

**逐字核对**：`name:` 取值 = `@local/dsh-subagent-model`
- 首字符 `@`（bare scope 包名），**不含** `/` 开头的绝对路径、**不含** `file:` 前缀、**不含** `.js`/`.yml` 文件后缀 ⇒ **是 bare 包名**，符合历史教训（写成文件路径会导致实例 import 不执行并整次回滚）。

对照同文件其它 insert 一律同为 bare 包名（如 L19 `'@local/dsh-btw'`、L29 `'@local/dsh-usage'`、L80 `'@local/dsh-ssh-gui'`），形态一致。

该插件**未**额外声明 `dsh.bundle.patch`（§1.2）⇒ 只能靠此 insert 挂载，而 insert 已就位。

### 4.2 误启用 `web2`？

```bash
$ grep -rn 'web2' ~/.dsh/profiles/web/cordis.patch.yml ~/.dsh/profiles/web/cordis.yml
~/.dsh/profiles/web/cordis.patch.yml:26:# usage 插件（token 用量统计，web2 同款 @local/dsh-usage v0.1.0）；...
```

✅ 唯一命中是 **L26 的注释文字**，**没有任何 insert 行启用 web2**。归档目录 `~/.dsh/profiles-archive/web2-20260915-105429` 保持归档态，`~/.dsh/profiles/` 下无 web2 目录。**未误启用。**

### 4.3 用 DSH 自身解析入口验证（`!!js` 是自定义标签，不是真错）

**（a）Python 的报错属预期，未据此改文件：**

```bash
$ python3 -c "import yaml; yaml.safe_load(open('.../agent.cordis.yml'))"
SAFE_LOAD_FAIL: ConstructorError could not determine a constructor for the tag
'tag:yaml.org,2002:js' in ".../agent.cordis.yml", line 46, column 13
```

⇒ 仅在 **L46 / L50 的 `disabled: !!js ...`** 处报 unknown tag；这是 DSH 自定义标签，**不是语法错误**，**未对文件做任何改动**。

**（b）改用 DSH 自身的组合解析入口**（真实、权威）：

```bash
$ dsh --profile web --dump-config
[exit=1]
Error: EROFS: read-only file system, open '/home/CNS2026495165/.dsh/profiles/web/cordis.yml'
    at prepareProfile (.../profile-boot-DG5t9aNs.js:143:2)
```

原因：`prepareProfile` 会**重写 profile 根的 `cordis.yml`**（源码注释：该文件只是 Loader 的 include 锚点，每次启动都被重写成空数组再次组合）。
本档为只读纪律，**未写真实 profile 目录**；改为把 `DSH_HOME` 指向 `.workspace/acceptance-probe/mirror`（软链 `node_modules`，拷贝 `cordis.patch.yml`/`package.json`），**对同一份 patch 做等价组合解析**：

```bash
$ DSH_HOME=<mirror> node <dsh>/lib/bin.js --profile web --dump-config > dump.txt 2>dump.err
[exit=0]
--- stderr ---
(空)
--- stdout lines: 548 ---
```

✅ **exit=0、stderr 全空、548 行组合树** ⇒ 该 YAML（含 `!!js`）**能被 DSH 自身解析并完成整棵组合**，无自定义标签错、无组合错。

**新插件确实进入组合树且只进入一次：**

```bash
$ grep -n -B2 -A2 "id: dsh-subagent-model" dump.txt
545-- id: ssh-gui
546-  name: '@local/dsh-ssh-gui'
547-- id: dsh-subagent-model
548-  name: '@local/dsh-subagent-model'
```

```bash
$ for id in dsh-subagent-model btw usage wallpaper ssh-gui workerspace dsh-pptmaster session-status-board; do
    printf '%-24s ' "$id"; grep -c "id: $id\$" dump.txt; done
dsh-subagent-model       1 occurrence(s)
btw                      1 occurrence(s)
usage                    1 occurrence(s)
wallpaper                1 occurrence(s)
ssh-gui                  1 occurrence(s)
workerspace              1 occurrence(s)
dsh-pptmaster            1 occurrence(s)
session-status-board     1 occurrence(s)
```

✅ **无重复 insert**（历史上有重复 id 导致 insert 第二次报错的隐患，此处恰好 1 次）。

同批次相关行也确认在组合树中生效：

```bash
$ grep -n -A6 "id: agent-presets" dump.txt
504-- id: agent-presets
505-  name: '@deepseek-ai/dsh-agent-presets'
506-  config:
507-    default: standard-glm
```

---

## 5. preset `~/.dsh/.agent-presets/standard-glm/agent.cordis.yml`

### 5.1 两处子代理模型

```bash
$ grep -n 'provider\|model: deepseek' ~/.dsh/.agent-presets/standard-glm/agent.cordis.yml | sed -n '10,20p'
194:          provider: adam
195:          model: deepseek-v4.1-flash
205:          provider: adam
206:          model: deepseek-v4.1-flash
```

原文上下文：

```yaml
    - id: tool-subagent                     # L186
      config:
        provider: spawn
        toolName: subagent
        backgroundMode: continuable
        # 子代理固定走 adam 网关的 deepseek-v4.1-flash，不随主会话模型变化。
        agentOptions:
          provider: adam                     # L194
          model: deepseek-v4.1-flash         # L195

    - id: tool-subagent-fork                # L197
      config:
        provider: fork
        toolName: subagent_fork
        backgroundMode: continuable
        # 同上：fork 子代理固定 deepseek-v4.1-flash。
        agentOptions:
          provider: adam                     # L205
          model: deepseek-v4.1-flash         # L206
```

✅ **两处均为 `adam` / `deepseek-v4.1-flash`**（旧值 `deepseek-v4-flash` 已无残留；对照备份 `agent.cordis.yml.preset-20260917-164911.bak` L195/L206 仍为旧值，证实改动已落盘）。

### 5.2 文件能否被 YAML 正常解析

```bash
$ python3 - <<'EOF'
class L(yaml.SafeLoader): pass
L.add_constructor('tag:yaml.org,2002:js', lambda l,n: '<js:%s>'%l.construct_scalar(n))
d=yaml.load(open(P), Loader=L)
print('PARSE_OK top-level entries:', len(d))
# 递归抽取所有含 agentOptions 的行
EOF
PARSE_OK top-level entries: 16
  id=None                 agentOptions={'provider': 'adam', 'model': 'deepseek-v4.1-flash'}
  id=None                 agentOptions={'provider': 'adam', 'model': 'deepseek-v4.1-flash'}
total rows with agentOptions: 2
```

✅ 在把 `!!js` 当不透明标量处理后，**结构解析成功**（16 个顶层条目），且**恰好 2 处** `agentOptions`、值均为目标路由。
（`!!js` 出现于 L46 / L50 的 `disabled:` 字段；不经 DSH 标签的场景下必须按上述方式处理，`safe_load` 会因未知标签报错——**已知且非缺陷**，未改文件。）

---

## 6. 备份与回滚路径（本轮重点）

### 6.1 本批次备份实物清单（文件名 + 大小）

`~/.dsh/backups/`（本批次相关，`ls -la` 原始）：

| 文件 | 大小 | 用途 |
|---|---|---|
| `agent.cordis.yml.preset-20260917-164911.bak` | 13423 | preset 改前备份 ✅ |
| `dsh-tool-subagent.index.js.bak-20260917-165928` | 35309 | subagent 补丁改前备份 ✅ |
| `cordis.patch.yml.bak-20260917-165928` | 2862 | profile patch 改前备份 ✅ |
| `settings.yaml.bak-20260917-165928` | 4797 | settings 改前备份 ✅ |
| `settings.yaml.mmt-20260917-164000.bak` | 4688 | settings（vision 网关）改前备份 ✅ |
| `goal-round-driver.index.js.P0A.bak` | 13687 | goal P0-A 改前 ✅ |
| `goal-round-driver.index.js.pending-subagent.bak` | 13858 | goal 方案A 改前 ✅ |
| `btw-p0b-prev.tar.gz` | 97542 | btw P0-b 改前 tar ✅ |
| `dsh-btw.lib.bak-20260916-112529/`（8 目录项） | — | btw lib 历史备份 ✅ |

`.workspace/backup-*`（本批次相关）：

| 目录 | 内容与大小 |
|---|---|
| `backup-btw-20260917-170146/` | **btw 整目录**（CHANGELOG 2352、CONTRIBUTING 473、cordis.patch.yml 53、docs/、.github/、.gitignore 87、lib/（10 文件：index.js 61458、client.js 334453、remote-DxLkxvnp.js 10367 等）、LICENSE 1083、package.json 4773、README 10838、README.zh 10512、scripts/、src/、tests/、tsconfig\*、tsdown.config.ts 4094、vitest.config.ts 151） |
| `backup-btw-20260917-172915/` | btw 整目录（**172915 部署前快照**；lib/index.js 62095、client.js 334622） |
| `backup-subagent-model-20260917-165928/` | `cordis.patch.yml` 2862、`dsh-tool-subagent.index.js` 35309 |

**逐项核对你点名的 5 类：**

| 点名项 | 实物 | 状态 |
|---|---|---|
| btw 整目录 | `backup-btw-20260917-170146/`、`backup-btw-20260917-172915/` | ✅ 均存在且内容完整 |
| dsh-tool-subagent index.js.bak | `dsh-tool-subagent.index.js.bak-20260917-165928`（35309） | ✅ 存在 |
| agent.cordis.yml.preset bak | `agent.cordis.yml.preset-20260917-164911.bak`（13423） | ✅ 存在 |
| settings.yaml.mmt bak | `settings.yaml.mmt-20260917-164000.bak`（4688） | ✅ 存在 |
| cordis.patch.yml.bak | `cordis.patch.yml.bak-20260917-165928`（2862） | ✅ 存在 |

**备份有效性抽样（是「改前」而非「改后」）：**

```bash
$ grep -n 'model: deepseek' <preset bak> <live preset>
<bak>:195:          model: deepseek-v4-flash      ← 改前
<bak>:206:          model: deepseek-v4-flash
<live>:195:          model: deepseek-v4.1-flash     ← 改后
$ grep -n -A6 'vision-adam' <settings.mmt bak> | head
139:vision-adam:
140-  model: deepseek-v4.1-flash
141-  baseURL: https://opencode.ai/zen/go/v1     ← 改前网关
142-  apiKeyEnv: OPENCODE_GO_API_KEY
（live 为 https://llmapi.roboscience.xyz/v1 + ADAM_API_KEY）  ← 改后
$ sha256sum <subagent bak> <live subagent lib>
1416512c…（改前） ≠ 65288049…（改后）
```

✅ 三个抽样备份均确为**改动前**状态。

### 6.2 `RESTART-ACCEPTANCE.md` §3 回滚表逐行核对（**红灯所在**）

§3 原文（5 行）：

| 行 | §3 写的回滚命令 | 按字面 glob 展开 | 结论 |
|---|---|---|---|
| 1 | `cp ~/.dsh/backups/goal-round-driver.index.js.*.bak <包>/lib/index.js` | `goal-round-driver.index.js.P0A.bak`(13687)、`goal-round-driver.index.js.pending-subagent.bak`(13858) | ✅ 可解析（2 命中） |
| 2 | `cp -r .workspace/backup-btw-20260917-170146/* ~/.dsh/profiles/node_modules/@local/dsh-btw/` | `GLOB_OK` | ✅ 目录存在且 glob 命中 |
| 3 | `cp ~/.dsh/backups/agent.cordis.yml.preset-*.bak .../agent.cordis.yml` | `agent.cordis.yml.preset-20260917-164911.bak`(13423) | ✅ 可解析 |
| 4 | `cp ~/.dsh/backups/dsh-tool-subagent.index.js.bak-*.bak <包>/lib/index.js` | `ls: 无法访问 '.../dsh-tool-subagent.index.js.bak-*.bak': 没有那个文件或目录` | ❌ **不能解析（0 命中）= 红灯 R1** |
| 5 | `cp ~/.dsh/backups/settings.yaml.mmt-*.bak ~/.dsh/settings.yaml` | `settings.yaml.mmt-20260917-164000.bak`(4688) | ✅ 可解析 |

原始输出（第 4 行 vs 修正后模式）：

```bash
$ ls -la ~/.dsh/backups/dsh-tool-subagent.index.js.bak-*.bak
ls: 无法访问 '/home/CNS2026495165/.dsh/backups/dsh-tool-subagent.index.js.bak-*.bak': 没有那个文件或目录
[exit code: 2]

$ ls -la ~/.dsh/backups/dsh-tool-subagent.index.js.bak-*
-rw-rw-r-- 1 CNS2026495165 CNS2026495165 35309  9月 17 16:59 /home/CNS2026495165/.dsh/backups/dsh-tool-subagent.index.js.bak-20260917-165928
```

### 6.3 第 2 行回滚目标的内部一致性 + 语义核查（黄灯 N1）

**内部一致性（可回滚性）**：✅ 自洽

```bash
$ grep -o 'from "\./[^"]*"' <b170146>/lib/index.js
from "./remote-DxLkxvnp.js"
$ grep -o 'from "\./[^"]*"' <b170146>/lib/typert.host.js
from "./remote-descriptors-xg8tvseq.js"
$ # 逐一存在性检查
OK   lib/remote-descriptors-xg8tvseq.js
OK   lib/remote-DxLkxvnp.js
$ # package.json 入口 vs 备份实物
OK   lib/index.js        OK   lib/client.js      OK   lib/typert.host.js
OK   lib/typert.remote-client.js                OK   cordis.patch.yml
```

⇒ 回滚目录**引用的 chunk 全在**，入口全在 ⇒ 该目录**能构成一个可装载的包**（不会出现悬空 import）。

**语义核查（回滚会退到什么版本）**：

```bash
$ grep -c 'deepseek-v4.1-flash' <b170146>/lib/index.js
1        # 且经定位，该 1 处是 VISION_DEFAULTS（L210），与侧聊模型无关
$ grep -c 'deepseek-v4.1-flash' <b172915>/lib/index.js
4
$ grep -c 'deepseek-v4.1-flash' <live>/lib/index.js
10
```

⇒ **`backup-btw-20260917-170146` 是「v4.1-flash 侧聊改动之前」的更早状态**。
因此 §3 第 2 行「btw 模型」回滚到 170146 **语义正确**（确实退掉 v4.1 改动）；
代价是**连带退掉一批后续已部署的工作**：该批次自己的执行记录写明
`backup-btw-20260917-172915（部署前整目录快照，回滚用后者即可覆盖两单元）`
（`btw-model-v41-exec.md` L142），而 **172915 仍比 live 旧**（`diff -rq` 显示
`lib/index.js` 62095→64280、`client.js` 334622→335348、`index.d.ts` 15562 均不同，含 P0-b 热读函数）。
即：**现存两个 btw 备份都不等于 live 当前态**，回滚任一个都会丢一部分已部署功能（可用性不受影响，功能会退化）。

---

## 7. 依赖完整性（未跑任何 install）

**组合树全量插件名解析（重启装载面的决定性检查）：**

```bash
$ grep -o "name: '[^']*'" dump.txt | sed "s/name: '//;s/'//" | sort -u | wc -l
145
$ cd ~/.dsh/profiles && while read -r n; do node -e "require.resolve('$n')" && echo "OK $n" || echo "UNRESOLVED $n"; done < names.txt
... （145 行，全部 OK）
OK           @local/dsh-subagent-model
OK           @local/dsh-btw
OK           @local/dsh-usage
OK           @local/dsh-ssh-gui
OK           @local/dsh-pptmaster
OK           @local/dsh-wallpaper
OK           @local/dsh-workerspace
OK           @deepseek-ai/dsh-tool-subagent
OK           @deepseek-ai/dsh-goal-round-driver
```

✅ **145/145 可解析，0 个 UNRESOLVED**（未执行 `npm`/`pnpm install`，仅用 `node require.resolve` / `import()` 直解析）。

**新插件 peer 依赖**（从插件自身目录解析，见 §1.5）：`@deepseek-ai/schemastery` ✅、`@deepseek-ai/dsh-settings` ✅、`@deepseek-ai/cordis` ✅。

**被打补丁包依赖**（见 §2.7）：`dsh-tool-subagent` 6/6 ✅、`dsh-goal-round-driver` 3/3 ✅。

**btw 依赖**：`@deepseek-ai/schemastery` ✅、`zod` ✅（`require.resolve('react')` 亦可达：`.../dsh/node_modules/react/index.js`）。

---

## 8. 红灯 / 黄灯清单

### 🔴 R1（红灯 — 会导致**回滚失效**，必须修）

- **位置**：`.workspace/RESTART-ACCEPTANCE.md` §3 回滚表第 4 行
- **现状**：`cp ~/.dsh/backups/dsh-tool-subagent.index.js.bak-*.bak <包>/lib/index.js`
- **问题**：glob `*.bak` 要求文件名以 `.bak` 结尾，实际文件名是
  `dsh-tool-subagent.index.js.bak-20260917-165928`（以时间戳结尾）
  ⇒ **glob 展开 0 个文件**，`cp` 会因源路径字面量不存在而失败（`exit 2`）。
  这与「路径写错 = 回滚失效」同性质，属红灯。
- **最小修复**（改文档一行，不动任何文件）：
  `sed -i 's|dsh-tool-subagent.index.js.bak-\*.bak|dsh-tool-subagent.index.js.bak-*|' .workspace/RESTART-ACCEPTANCE.md`
  或直接把该行写成确定路径：
  `cp ~/.dsh/backups/dsh-tool-subagent.index.js.bak-20260917-165928 <包>/lib/index.js`
- **影响面**：仅本行；第 1/2/3/5 行已实测可解析。

### 🟡 N1（黄灯 — 不会导致重启失败，但回滚会丢已部署功能）

- **位置**：§3 第 2 行（btw 回滚目标 `backup-btw-20260917-170146`）
- **问题**：该备份是 v4.1-flash 之前的更早态（`deepseek-v4.1-flash` 计数仅为视觉默认的 1 处），
  回滚语义正确但会连带退掉后续已部署单元；而另一个备份 `backup-btw-20260917-172915`
  也**不等于 live 当前态**（`diff -rq` 三文件不同，缺 P0-b 热读）。
  ⇒ **当前不存在「与 live 等价的 btw 快照」**；回滚可用，但功能会退化。
- **最小修复**：重启**之前**先补一份 live 快照（只增不改，不违反只读纪律的执行者需获准）：
  `cp -r ~/.dsh/profiles/node_modules/@local/dsh-btw/ .workspace/backup-btw-live-20260917/`
  并在 §3 第 2 行注明「此行为退回到 v4.1 之前」。
- **说明**：本档**未执行**该 cp（纪律：除报告外不改任何文件），仅提示。

### 其余检查项

- 🔴 **无**其它红灯。**第 1、2、3、4、5、7 项均无红灯**。
- 特别确认：**历史重启级故障形态（新插件缺 host `lib/index.js`）在本批次【不存在】** ——
  `@local/dsh-subagent-model` 的 host 与 client 入口均真实存在、语法通过、可被 Node 求值、字节等于产物。

---

## 9. 复现命令汇总（可整段复制）

```bash
# 1) 新插件三件齐全 + 与产物字节比对
P=~/.dsh/profiles/node_modules/@local/dsh-subagent-model
S=~/.dsh/../CNS2026495165/dsh/.workspace/deploy-subagent-model
find $P -type f | sort
for f in package.json lib/index.js lib/client.js; do cmp $P/$f $S/$f && echo "IDENTICAL: $f"; done
node --check $P/lib/index.js && node --check $P/lib/client.js
(cd $P && node --input-type=module -e "import('$P/lib/index.js').then(m=>console.log(Object.keys(m)))")

# 2) 宿主 lib 补丁
sha256sum $S/dsh-tool-subagent.index.js.patched \
          ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js
node --check ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js
node --check ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-goal-round-driver/lib/index.js
grep -n 'settings.get("dsh-subagent")\|effectiveConfiguredAgentOptions' \
     ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js
grep -n 'pendingSubagents\|goals.pause' \
     ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-goal-round-driver/lib/index.js
find ~/.npm-global/lib/node_modules/@deepseek-ai ~/.dsh/profiles/node_modules \
     \( -name '*.rej' -o -name '*.orig' \)      # 预期：空

# 3) btw
B=~/.dsh/profiles/node_modules/@local/dsh-btw
for f in lib/index.js lib/client.js lib/typert.host.js lib/typert.remote-client.js cordis.patch.yml; do
  [ -f "$B/$f" ] && echo "OK $f" || echo "MISS $f"; done
grep -n 'BTW_FALLBACK_DEFAULT_MODEL\|BTW_LEGACY_MODEL_MAP\|function readBtwSettings' $B/lib/index.js

# 4) cordis.patch.yml 末条 + web2 + DSH 自身组合解析
tail -6 ~/.dsh/profiles/web/cordis.patch.yml
grep -n 'web2' ~/.dsh/profiles/web/cordis.patch.yml        # 预期：仅注释行
# （只读环境：mirror 到工作区再 dump，避免写真实 profile 的 cordis.yml）
DSH_HOME=<mirror> node ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/lib/bin.js --profile web --dump-config

# 5) preset
grep -n 'model: deepseek' ~/.dsh/.agent-presets/standard-glm/agent.cordis.yml

# 6) 回滚表逐行核对
ls -la ~/.dsh/backups/dsh-tool-subagent.index.js.bak-*.bak   # ← 预期失败（红灯 R1）
ls -la ~/.dsh/backups/dsh-tool-subagent.index.js.bak-*
ls -la ~/.dsh/backups/goal-round-driver.index.js.*.bak
ls -la ~/.dsh/backups/agent.cordis.yml.preset-*.bak
ls -la ~/.dsh/backups/settings.yaml.mmt-*.bak
ls /home/CNS2026495165/dsh/.workspace/backup-btw-20260917-170146/* >/dev/null && echo GLOB_OK
```

---

## 10. 最终裁决

**go / no-go：GO（附 1 处回滚红灯 R1 必须先修）**

- **装载路径（重启会不会挂）**：**不会挂**。新插件 host+client 双入口齐全并与产物字节相等；
  组合树成功解析（548 行、exit 0、stderr 空）且新条目恰好出现 1 次；
  145/145 插件名可解析；0 个 `.rej`/`.orig`；patched 宿主 lib 语法与依赖闭包均通过。
  **历史上「只有 client.js 缺 host lib/index.js」的重启级故障形态本批次不存在。**
- **回滚路径**：第 1/2/3/5 行可用；**第 4 行 glob 与实物不符（R1，红灯）**，须先修
  `RESTART-ACCEPTANCE.md` §3 第 4 行（去掉多余的 `.bak`）再重启，否则该行回滚会失败。
- **黄灯 N1**：btw 回滚会退回 v4.1 之前状态（非致命，但会丢功能）；建议重启前补一份 live 快照。
