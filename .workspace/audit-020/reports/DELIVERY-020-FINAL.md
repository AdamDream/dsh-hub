# 0.2.0 迁移交付（B → A → btw 全部完成）

## 一条命令启动

```bash
R=/home/CNS2026495165/dsh/.workspace/audit-020/assembly-020
setsid env -i HOME="$R/home" DSH_HOME="$R/home" PATH=/usr/bin:/bin \
  DSH_TELEMETRY_MODE=DISABLED \
  node "$R/prefix-cli/lib/node_modules/@deepseek-ai/dsh/lib/bin.js" \
  --profile web --port 3098 --no-open
```
> **不要加 `unshare -rn`** —— 那是零外呼验收用的，生产下你的浏览器会访问不到 3098。
> 零外呼改由：`env -i`（无环境凭据 ⇒ 源码级必然零外呼）+ `DSH_TELEMETRY_MODE=DISABLED` + 凭据面自主控制。

## 实测验收（多次冷启动一致）
| 判据 | 结果 |
|---|---|
| 版本 | `0.2.0-rc.1` |
| 组合条目 | **200**（199 + 新增 `subagent-model`） |
| peer 闸门静默禁用 | **0**（6 条 `compatibility.json` 豁免生效） |
| **未激活插件** | **0** |
| URL 发放 | `http://127.0.0.1:3098` |
| 停栈 | 端口 FREE |
| 现役未污染 | patch `513413e7…` / settings `0f19b0fe…` 与开工逐位一致；3080/3097 在线 |

## 三批工作

### 规划 B：`dsh-workspace-enhancement` 升级
- **目标版本改为 0.2.2**（registry latest，2026-09-26 发布，**在 0.2.0 内核之后**）。
  比原定 0.1.4 更好：**3 个抽象成员（`readByteRange`/`terminalEnvironment`/`resize`/`inspectActivity`）已全部实现**，原定手写缺口作废。
- **契约零变化**：`lib/index.d.ts` 在已迁移的 0.1.2 与 0.2.2 之间 **sha256 完全相同** ⇒ ssh-gui 的 `remoteWorkspacesRoot` 依赖安全。
- **补丁 P1 回流**：0.2.2 仍保留 O(k²) 去重 ⇒ 应用 `Array.from(new Set(ids))`，**保留类型守卫**（`noUncheckedIndexedAccess`）。替换 4 处（`client.js` ×2 + `client/row-badges.js` ×2）。
- **peer 范围放宽**：13 条 `^0.1.5-rc.1` → `^0.1.5-rc.1 || ^0.2.0-rc.1`。
- **补 `ssh2`**（0.2.2 的唯一真实 dependency）。
- 结果：SSH 族（`ssh-remote`/`ssh-web-channel`/`ssh-gui`）**全部激活**。

### 规划 A：3 个 settings 断层插件修复
根因：0.1.7+ 删除了 `installSettingsSection`/`settingsNamespace`，三插件在模块顶层具名导入 ⇒ 链接期失败、整行不加载。

**解法（本轮查清的关键机制）**：0.2.0 的 settings 面以「**profile 条目 id**」为命名空间，`SettingsDescriptor` 携带
`value` / `revision` / `applies:'live'` ⇒ 用 `ctx.get('settings').describe().find(r => r.ns === ID)?.value` **实时读回**，
**语义等价于旧 `setSource(() => scope.get())`，且天然热生效**。

| 插件 | 改动 |
|---|---|
| `@local/dsh-subagent-model` | 重写：导出 `Config` + `ENTRY_ID="subagent-model"`；默认路由按 D9 统一 `adam/deepseek-v4-pro` |
| `@deepseek-ai/dsh-session-board` | 去旧 import；live reader 替换；`current()` 调用点零改动 |
| `@deepseek-ai/dsh-vision-adam` | 去旧 import；`settingsNamespace(...)` → 字面量；live reader；`resolveOptions(current())` 零改动 |

live reader 读失败一律回落基线、**绝不抛**（沿用原补丁容错语义）。
profile patch 新增 `subagent-model` 条目（原机制靠插件自注册，该条目原先不存在）。

### N2 宿主补丁（已写入并验证）
官方件 `dsh-tool-subagent/lib/index.js` 662 → **701** 行：
- 新增 `effectiveConfiguredAgentOptions(runtimeCtx, configured)`：读 `describe()` 里 `subagent-model` 的实时 value，用非空 provider/model 覆盖 preset 静态 `agentOptions`；读失败回落、永不抛。
- 接入派发路径（`execute()` 闭包内，`runtimeCtx` 是 `install(runtimeCtx, …)` 的形参，作用域正确）。

### btw（侧聊）——**实际比预期好得多**
| 项 | 结果 |
|---|---|
| 宿主半 `import` | **OK**（导出 `BtwRegistry`/`SideChatService`/`Config` 等） |
| 部署件 `dsh-client-runtime` 引用 | **0**（T30 报的 14+2 处是**工作区源码** `078ef49d`，不是部署件 `606f53f1`） |
| 部署件退役图标 | **0**（工作区源码有 18 处） |
| `Session.events` / `conversationEvents` / `settingsScope` | **0 引用** |
| `prompt-image-transform` | 1 处，但**以 `ctx.on` 注册**，而 0.2.0 全树 **0 emit** ⇒ 无害 no-op |
| 组合树中 | **已激活**（`id: btw` / `name: '@local/dsh-btw'`） |

⇒ **T30 的「26 条不兼容 / 21 个单元」是针对工作区源码得出的，不适用于已迁移的部署件。**
**btw 当前在 0.2.0 上加载并激活成功**。其客户端 UI 的完整行为（侧聊面板、JumpList）需 GUI 实测确认，尚未验证。

## 备份
所有改动前的原件在 `planA-backup/` 与 `we-build/we-0.1.2-migrated-backup/`。

## 尚未验证 / 尚未做
1. **GUI 层实测**：以上全是进程级验证（import / 组合 / 启动 / 无错误）。浏览器内的实际交互（会话看板渲染、识图工具调用、btw 侧聊面板、SSH 远端子功能）**未做**。
2. **ssh-gui 的 `/dsw` 通道**：WE 0.2.2 下 ssh-gui 加载成功，但远端子功能是否对得上未实测。
3. **办公入口 Route B**：官方已有现成件 `@deepseek-ai/dsh-webhook`（可直接复用），但**尚未接入**。
4. **`remoteHosts` 回归**：未处理（侧栏「分布式节点」树在 0.2.0 官方面上不存在）。
5. **必要 settings 段迁移**（D14 的 9 段）：未做，新实例目前跑 profile patch 的 config。
6. **最终切换**：3080（含 2 474 份历史会话）**未动**，历史仍在其上完整可读。
