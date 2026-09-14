# btw「子代理会话无法打开」P0 诊断报告（只读诊断，未改代码）

- 路由：adam/deepseek-v4-flash ｜ 现象：跳转列表/侧聊打开子代理 btw →「btw 无法打开」+「The parent conversation is not live.」+ 重试按钮。
- 结论一句话：btw host 要求 parent **Agent 进程内 live**（`ctx.agents.get(parentId)`），而子代理会话绝大多数时候不是 live 的（仅其 Activation 驻留期间 live）；跳转列表却无条件展示这些条目，点击必然撞硬门。

---

## ① 错误串抛出点与判定逻辑

| 项 | 位置 | 内容 |
|---|---|---|
| 错误串（源） | `dsh-btw/src/host/side-chat-service.ts:573` | `failure('parent-not-found', 'The parent conversation is not live.')` |
| 判定（源） | `side-chat-service.ts:571-572` | `const parentId = SessionId(request.parentSessionId)` → `const parent = this.ctx.agents.get(parentId)`；`parent === undefined` 即抛 |
| 部署版（同逻辑） | `~/.dsh/profiles/node_modules/@local/dsh-btw/lib/index.js:661`（index.js:659-660 判定） | 与源完全一致；部署 bundle 为 09-12 18:04 构建 |
| live 定义 | 官方 `dsh-agent/lib/index.js:688-689` | `get(id) { return this.store.get(id)?.agent }` —— **进程内已注册的 live Agent 注册表**，持久化会话不算 live；agent 随其 owner scope 卸载而注销（`register`/`enter` 生命周期，同文件 580-626） |

**判定逻辑拆解**：`start()` 先查 live 注册表（572）→ 不在即失败（573）；该门在 `registry.get`（578）与 `startResumed` 之前，**与 btw index 是否已有该 parent 的条目无关**——即使 index 里有子代理键，只要子代理不 live 也直接失败。失败早于 `registry.remove`（584），故陈旧条目不会被清理，重试（client `controller.ts:290-307` 的 `retry()`：close→open→同一 `remote.start`）永远复现同一错误。

---

## ② parent 链与 registry 实盘形态（~/.dsh，DSH_HOME=/home/CNS2026495165/.dsh）

实盘会话目录 `~/.dsh/sessions/--home-CNS2026495165-dsh--/`（会话按 cwd 分组，日志 `session.jsonl.zstd`，头部 zstd 可读）：

```
主会话   session-bc0b7655-8e6a-4d10-9d91-03888c3e57ce/  （header: 顶层, delegationDepth:0, 无 origin）
  └─ 子代理 076c09be-…/ 0b09bfa8-…/ 等 20+ 个            （header: origin:"subagent", parentSession:"session-bc0b7655…", 大多 mode:"continuable"）
       └─ btw 子会话 4748f375-bd03-…/                     （header: origin:"subagent", delegationDepth:1, **无 parentSession 字段**——btw 刻意剥离持久 parent 链）
```

- btw 子会话与父的映射**只存在**于 `~/.dsh/btw/index.json`（v1，键=parentSessionId，值={childSessionId,…}），与 `btw-registry.ts:8-13` 注释一致（隐藏子会话于常规/子代理目录之外）。
- `~/.dsh/btw/index.json` 当前 4 个键：`session-bc0b7655…→4748f375…`、`session-0ed107d4…`、`session-61ee47df…`（math 目录顶层会话）、`parent-3`（孤儿，无对应会话日志）。**没有任何子代理 UUID 键 → 本部署中子代理 btw 从未成功打开过**（registry 只在失败 resume 时删键，若曾成功则条目必留存）。
- 另发现两个不在 index 的孤儿 btw 子会话（`83d9e651…`、`c59c3503…`，09-08 创建）。

**client 打开链路（传的 id = 点击条目的 parentSessionId / 当前会话 id，即“目标会话 id”，不是其 btw 子会话 id）**：
- 跳转列表：`SideChatJumpList.tsx:77-84` `jump()` → `controller.jumpTo(entry.parentSessionId)`（`controller.ts:405-421`：`sessions.open(parentSessionId)` + `open(parentSessionId)`）→ `controller.ts:142` `remote.start({ parentSessionId: String(parentSessionId), chatToken })`。
- 头部按钮（当前正看子代理时）：`SideChatButton.tsx:35` `presentation.toggle(String(sessionId))`，sessionId=子代理会话 id → 同一 `open()`。
- host 列表来源：`side-chat-service.ts:1075-1091` `listTree()` = 当前会话自身 + `subagents.listDescendants(...)`（**含持久化冷子代理**）∩ btw index；`listEntries`（1171-1195）**无 live 过滤**（`agents.get` 仅用于 running 徽标与 cwd）。

---

## ③ 根因结论

1. **硬门过严**：`side-chat-service.ts:572-573` 要求 parent **Agent 进程内 live**（`ctx.agents` 注册表），不是“会话存在”。
2. **live 的只有两类**：① 当前打开的主会话 Agent（根 Agent，常驻）；② Activation 驻留中的子代理（`dsh-subagent/lib/index.js:1234-1239` 经 `ownerCtx.agents.resume/create` 注册；`dispose` 于 1420-1464）。**主机重启后一切子代理冷掉**；one-shot 子代理跑完即销毁；子代理 Activation 被回收（父会话切换/关闭、drain、显式 dispose）后也冷掉。
3. **client 侧选择子代理（`sessions.selectSubagent`）不 materialize 其 Agent**——仅为视图导航（官方 RPC 仅 `subagent.list/history/prompt/interrupt`，只有 `prompt` 投递消息才冷恢复）。因此“正在看子代理”≠“子代理 live”。
4. 跳转列表（tree 含全部子代理后代、project 含同 cwd 其它顶层会话）对不 live 的 parent **照常展示**，点击 → 硬门 → 错误；重试同路必败。
5. 官方既有先例：`dsh-api-remotes/lib/index.js:101-160` 会话解析器对普通会话 **冷恢复**（`agents.resume`），对子代理会话**拒绝直连**（`ApiRemoteSubagentSessionOwnership`：“use subagent delivery for this child session”）——btw host 未采用任一先例，只查 live 注册表。

---

## ④ 最小修复面（按用户裁决：打开**不要求 parent 当前激活、存在即可**）

**核心改动点（1 处）**：`dsh-btw/src/host/side-chat-service.ts:572-573` 把“live 门”替换为“会话存在 + 必要时冷恢复 parent”，再继续现有 `parent.session.events` seed 与 `parent.ctx.agents.create` fork 流程：

1. parent 已在 live 注册表 → 走现路径（零改动）。
2. parent 是持久化的**普通（顶层）会话** → `ctx.agents.resume({ resumeSessionId: parentId, agentOptions, setup })` 冷恢复（先例：`dsh-api-remotes` 解析器）。恢复后即 live，可继续 fork。
3. parent 是持久化的**子代理会话**（header `origin:"subagent"`，可从 `ctx.sessions`/`sessionPersistence` 读）→ 官方禁止直接 `agents.resume`（`ApiRemoteSubagentSessionOwnership`）；子代理运行时 `coldResume`（`dsh-subagent/lib/index.js:1144-1180`）无公开“不带消息的 materialize”API。两条落地路线：
   - **路线 a（推荐，语义最正）**：在 `dsh-subagent` 暴露一个“仅 materialize 不投递”的公开方法（或 btw 复用其内部 `coldResume` 空消息变体），btw 挂到该子代理下，继承其真实上下文。
   - **路线 b（零新 API 的最小 hack）**：对冷子代理 parent，退化为挂到其**最近 live 祖先**（沿 `header.parentSession` 上溯，通常是常驻主会话），seed 用祖先 completed turns + 注入“指向该子代理”的 digest；索引键可保持子代理 id。语义近似但 btw 上下文不是子代理的。
4. 会话不存在的兜底（如孤儿键 `parent-3`）才返回失败（文案区分“会话不存在”与“已归档”）。

**附带（可选，非必须）**：`listEntries`（1171-1195）增补 live 状态字段供 UI 置灰/标注；`locales.ts:69` error 文案区分“该会话未在线”。

**影响面**：
- 首次打开冷子代理 btw 会触发一次 parent 冷恢复（持久化 inspect + Agent 重建，**不跑模型轮**，秒级内）；恢复的 parent 会驻留，行为与现主会话 btw 一致。
- btw 子会话生命周期仍随 parent scope：parent 冷后 live 状态消失，但**持久化 log 与 index 条目保留**，再次打开走 `startResumed` 成功路径——正是 U5 设计的 resume 语义，无需改 child 侧。
- 不触碰：`btw-registry.ts`（键语义不变）、client 跳转逻辑、模型路由；仅 `side-chat-service.start()` 一处判定 + 必要时 `dsh-subagent` 新增公开方法。
- 回归风险低：主会话 btw 路径（live 分支）不变；其余失败码/重试逻辑不变。

---

## ⑤ 附：证据文件索引（只读，未改代码）

- 错误抛出：`/home/CNS2026495165/dsh/dsh-btw/src/host/side-chat-service.ts:571-573`；部署版 `~/.dsh/profiles/node_modules/@local/dsh-btw/lib/index.js:659-661`
- live 注册表语义：`/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-agent/lib/index.js:684-689`（`get`）、580-626（register/enter 生命周期）
- 子代理 Activation 生命周期：`…/@deepseek-ai/dsh-subagent/lib/index.js:1234-1239`（materialize）、1420-1464（dispose）、1144-1180（coldResume）
- 官方会话解析先例：`…/@deepseek-ai/dsh-api-remotes/lib/index.js:101-160`
- client 打开/跳转：`dsh-btw/src/client/controller.ts:126-142, 290-307, 405-421`；`SideChatJumpList.tsx:77-84`；`SideChatButton.tsx:35`
- host 列表：`side-chat-service.ts:1075-1091`（listTree）、1171-1195（listEntries，无 live 过滤）
- registry：`dsh-btw/src/host/btw-registry.ts:103-129`（get/set，键=parentSessionId）
- 实盘：`~/.dsh/btw/index.json`；`~/.dsh/sessions/--home-CNS2026495165-dsh--/{session-bc0b7655…,076c09be…,4748f375…}/` header
- UI 文案：`dsh-btw/src/client/locales.ts:69`（drawer.error「btw 无法打开」）、`SideChatSurface.tsx:408-414`（错误态+重试按钮）
