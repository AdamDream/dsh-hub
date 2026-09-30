# 规划 A 完成：3 个 settings 断层插件全部修复

## 根因与解法（本轮查清）
0.1.7+ 删除了 `installSettingsSection` / `settingsNamespace`，而这三个插件在**模块顶层具名导入**它们 ⇒ ESM 链接期失败、整行不加载。

**0.2.0 的替代机制（本轮源码核实）**：settings 面改为「**profile 条目 id** 为命名空间 + 插件导出 `Config` 自动表单」。
`SettingsDescriptor` 携带 **`value` / `revision` / `applies:'live'`** ⇒ 通过
`sctx.get('settings').describe().find(r => r.ns === ENTRY_ID)?.value` **实时读回**，**语义等价于旧 `setSource(() => scope.get())` 且天然热生效**。

> **这同时解开了此前卡住的 N2 障碍** —— 当时判断「热切换无落点」，是因为没想到 `describe()` 就是那条通道。

## 三处改动
| 插件 | 改动 | 验证 |
|---|---|---|
| `@local/dsh-subagent-model` | 重写为导出 `Config` + `ENTRY_ID="subagent-model"`；默认路由按 D9 统一为 `adam/deepseek-v4-pro`；去掉旧 import 与自注册 | `import` OK；导出 `Config,DEFAULT_ROUTE,ENTRY_ID,apply,default,name` |
| `@deepseek-ai/dsh-session-board` | 去掉旧 import；`installSettingsSection` 块 → 按 id `session-status-board` 的 live reader；`current()` 调用点**零改动** | `import` OK；`--check` 通过 |
| `@deepseek-ai/dsh-vision-adam` | 去掉旧 import；`settingsNamespace("vision-adam")` → 字面量；同上 live reader；`resolveOptions(current())` **零改动** | `import` OK；`--check` 通过 |

**共同设计**：live reader 读失败一律回落组合基线、**绝不抛**（沿用原补丁的容错语义）。

## profile patch 改动
新增 `subagent-model` 条目（原先**不存在**，旧机制靠插件自注册命名空间）：
```yaml
- insert:
    - id: subagent-model
      name: '@local/dsh-subagent-model'
      config:
        provider: adam
        model: deepseek-v4-pro
```
`vision-adam` 与 `session-status-board` 条目**原本已在位**，无需改。

## 端到端验收（实测）
| 判据 | 结果 |
|---|---|
| `--dump-config` | rc=0 / **200** 条目（199 + 新增 subagent-model） |
| 三个条目 config | `subagent-model` 见上；另两个按插件默认 |
| **`disabling`（peer 闸门）** | **0** |
| **未激活条目** | **0** ← （此前基线 2；WE 升级期间一度 5） |
| URL 发放 | `http://127.0.0.1:3098` |
| 停栈 | 端口 FREE |

## 备份
三份原件在 `planA-backup/`（`subagent-model.index.js.orig`、`session-board.index.js.orig`、`vision-adam.index.js.orig`、`cordis.patch.yml.orig`）。

## 未做
- **N2 宿主补丁**（`dsh-tool-subagent`）：机制已解（用 `describe()` 读 `subagent-model` 条目），但**补丁本身尚未写入**。
  ⇒ 当前 `subagent-model` 的设置页存在、值可读，但**尚无消费者**，子代理路由仍走 preset 静态值。
- **btw**：未动。

---

## 补充完成：N2 宿主补丁已写入并验证

此前标记「未做」的 N2 宿主补丁，本轮已落地。

### 补丁内容（写入 0.2.0 官方件 `dsh-tool-subagent/lib/index.js`，662 → **701** 行）
1. **新增** `effectiveConfiguredAgentOptions(runtimeCtx, configured)`（插在 `requestedAgentOptions` 前）：
   读 `runtimeCtx.get('settings').describe().find(r => r.ns === 'subagent-model')` 的**实时** `value`，
   用非空 `provider`/`model` 覆盖 preset 静态 `agentOptions`；读失败一律回落、**永不抛**。
2. **接入派发路径**：`effectiveAgentOptions = effectiveConfiguredAgentOptions(runtimeCtx, config.agentOptions)`，
   并在 `providerRouteDefaults` 分支中替换原 `config.agentOptions`。

### 关键作用域核实
`runtimeCtx` 是 `install(runtimeCtx, modelSelectionPolicy)` 的形参（`:423`），而我们所在的 `execute()` 闭包在其内部
⇒ **`runtimeCtx` 在作用域内**（`grep` 确认该文件内 23 处引用同一标识符）。**不是** `apply(ctx, …)` 的 `ctx`。

### 热生效机制（此前判定「无落点」的障碍已解）
0.2.0 的 `SettingsDescriptor` 携带 `value` / `revision` / `applies:'live'`，且 `describe()` 每次调用**重新计算**；
补丁在**每次派发**时读一次 ⇒ **改设置后下一次派发即生效、无需重启**。
> 此前卡住的根因是我没想到 `describe()` 就是那条通道（旧机制用 `setSource(() => scope.get())`）。

### 验收
| 判据 | 结果 |
|---|---|
| `node --check` | 通过 |
| 函数插入 | 1 处；派发接入 | 1 处（`grep` 另含 1 处形参声明） |
| 冷启动 | `disabling=0` / 未激活 **0** / 无新错误 / URL 发放 |
| 条目值可读 | 组合树内 `subagent-model` 含 `provider: adam` + `model: deepseek-v4-pro` |
| 停栈 | 端口 FREE |

**备份**：官方原件的 diff 前副本在 `planA-backup/tool-subagent.index.js.official`。
