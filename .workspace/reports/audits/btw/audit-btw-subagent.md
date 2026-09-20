# btw 功能审计报告（子代理交叉验证版）

> 审计阶段子代理产出，独立于主 agent 冻结的 `audit-btw.md`，用于交叉验证。
> 审计对象：Fork `@lukeknow0/dsh-side-chat` v0.4.0 + 补齐三处缺口（契约基线：`btw-wallpaper-plan.md`）。
> 证据源：
> - 上游源码 `/tmp/side-chat`（GitHub Lukeknow0/dsh-side-chat master，MIT，package.json v0.4.0）
> - DSH 官方 master `c389f96`（`/tmp/dsh-repo`）
> - **本地部署 `@deepseek-ai/dsh` 0.1.1-rc.2**（`~/.dsh/profiles/`，实测）
>
> 方法：源码级逐行核对（src/*.ts），并与本地已安装包（lib/*.d.ts + lib/*.js）互证，不凭记忆。

---

## 1. 审计结论

**需修改（fork 路线成立）。** 契约基线三处缺口全部属实，但缺口 3（grill-me / 反向提问）的改法必须修正：**加白名单 `ask_user_question` 无效**，会被 DSH 运行时双重硬阻断（§3.6），须改为插件内自建问答通道。另有部署级陷阱（peerDep semver prerelease 冲突、死链包、compaction 有损剪枝）见 §4。

---

## 2. 已读关键文件

**上游插件（/tmp/side-chat，源码级）**
- `src/host/side-chat-service.ts`（全文 516 行，核心机制所在）
- `src/shared/tool-policy.ts`（全文 17 行，白名单）
- `src/index.ts`、`cordis.patch.yml`
- `src/client/index.ts`（86 行，客户端接线）、`src/client/controller.ts`（全文 603 行，状态机）
- `package.json`（peerDeps / exports / dsh 元数据 / MIT license）
- `docs/ARCHITECTURE.md`（与源码逐条互证）

**DSH 官方 master（/tmp/dsh-repo，c389f96）**
- `packages/core/agent/src/index.ts`（AgentRegistry：create L399 / resume L418 / enter L468 / roots L607；CreateAgentOptions 的 seed 合法性约束 L92-101）
- `packages/core/agent-loop/src/index.ts`（工厂 ownership：`agents.enter(agent, ownerCtx.agent)` L666；persistence 落盘 createStoredSession L715-745）
- `packages/subagent/subagent/src/child-agent.ts`（全文：childSessionMeta L138-156 / applyChildComposition L199-218 / appendDelegatedPolicyOverrides L258-268）
- `packages/subagent/subagent-in-process-driver/src/index.ts`（官方 subagent 的 create 模式，上游 host 与之同构）
- `packages/interaction/user-questions/src/index.ts`（DELEGATED_CALLER 守卫 L94-107）
- `packages/interaction/tool-ask-user/src/index.ts`（ask_user_question 工具定义）
- `packages/client/ui-user-questions/src/client/index.ts`、`packages/api/session-controller/src/client/scope.ts`、`client/sessions/service.ts`（客户端问答 scope 机制：eligible() L571-574 只为列出的会话铸 scope）
- `packages/api/remotes/src/remote-events.ts`（user-questions/request 转发白名单 L34）
- `packages/workspace/workspace/src/index.ts`（archiveSession L243-266：durable 隐藏，数据保留）

**本地部署（~/.dsh）**
- `profiles/web/package.json`、`profiles/web/cordis.patch.yml`、`settings.yaml`、`install-plugins.sh`
- `skills/grill-me/SKILL.md`（含 `disable-model-invocation: true` frontmatter）
- `dsh-taste`（本地唯一跑通的 client 插件先例：`lib/client.js` 手写 `window.__ModuleLoader__.load` bundle + fixed 浮层）
- 本地包面核对：`dsh-agent` / `dsh-agent-loop` / `dsh-subagent` / `dsh-workspace` / `dsh-user-questions` / `dsh-typert-protocol` / `dsh-client-runtime` / `dsh-client-modules` / `dsh-compaction-tool-result-pruner` 等的 lib 实测（grep/readlink/node require）

---

## 3. 已确认机制（文件 + 行号，全部源码级）

### 3.1 fork seed 构造
- `completedTurnSeed()`：`src/host/side-chat-service.ts` **L119-123** — `events.findLast(turn/end)` 取 `events.slice(0, lastTurnEnd.seq + 1)`；无已完成回合返回 `[]`。
- 空 seed 直接拒绝：**L261-264**（`'no-completed-turn'`）→ 主会话无已完成回合时 btw 打不开。
- DSH 对 seed 的硬约束（master `core/agent/src/index.ts` **L92-101**）：必须是 balanced completed-turn prefix、contiguous from seq 0、**无 open turn/step、无 dangling tool call** → **进行中的事件不能进 seed**，"进行中摘要"只能以注入消息实现（缺口 2 改法的依据）。

### 3.2 隐藏子会话创建 + 消息喂入 + 隐藏原理
- `start()` **L285-304**：`parent.ctx.agents.create({ sessionId: 随机UUID, seed, meta: hiddenSideChatMeta(...), agentOptions: resolveChildAgentOptions(parent, undefined, childDepth), signal, setup })`。
- `hiddenSideChatMeta` **L129-133**：取官方 `childSessionMeta()` 后**剥离 `parentSession`、保留 `origin: 'subagent'`** → 不进普通目录也不进子代理目录（ARCHITECTURE.md 与源码互证）。
- ownership：经 `parent.ctx.agents.create` → cordis traceable → ownerCtx = parent.ctx → agent-loop `enter(agent, ownerCtx.agent)`（master agent-loop **L666**）→ **子代理 owner=parent、非 root**（§3.6 的关键前提）。
- 消息：创建成功后 `handle.agent.inject(SIDE_CHAT_BOUNDARY)` **L309-312**；用户消息 `handle.agent.followup(message)` **L373**；打开期排队 **L313-317**。本地 API 存在性：`followup` / `agent.status`（dsh-agent `lib/types/runtime-types.d.ts` **L115 / L70**）✓。

### 3.3 四层只读策略（全部属实）
`start()` 的 setup 回调内（side-chat-service.ts）：
1. `sandboxMode: 'read-only'` — `appendDelegatedPolicyOverrides(...)` **L294-297**
2. `approvalPolicy: 'never'` — 同 **L296**
3. 只读工具白名单 — `applyChildComposition(childCtx, parent, {persona, toolFilter: {allow: allowedTools}})` **L298-301**；`visibleReadTools(parent)` **L125-127** = 白名单 ∩ 父代理实际注册工具
4. 执行期守卫 — `childCtx.tools.guard(execution => isSideChatToolAllowed(...) ? undefined : READ_ONLY_DENIAL)` **L302**（deny-by-default）

### 3.4 只读工具白名单具体内容
`src/shared/tool-policy.ts` **L1-11**：
- 可见层 `READ_ONLY_TOOL_CANDIDATES`：`read, read_image, glob, grep, lsp, view_image, web_search, skill, session_event_read, session_event_search, session_event_trace, session_search, session_trace, job_list, job_output, terminal_list, terminal_read, list_agents, get_goal, mnemon_document_search, mnemon_memory_bodies, mnemon_recall, mnemon_related, mnemon_status`
- 守卫层 `READ_ONLY_TOOL_SET` = 上述 + `run_code`
- **含 `web_search` ✓、含 `skill` ✓；不含 `ask_user_question` ✓**

### 3.5 30 分钟闲置清理
- `SIDE_CHAT_IDLE_TTL_MS = 30*60*1000`：**L44**
- `evaluateSideChatLease()` **L62-89**：父或子 running → 续满且不倒计时；busy→idle 转换 → 重新续满；双方 idle 到期 → expire
- `scheduleExpiry()` **L467-488**（1s 轮询，到期 `close()`）；`touch()` **L462-465**
- 客户端：`EXPIRED_MESSAGE` controller.ts **L48**；park/restore 快照纯内存（`parkedByParent`），页面刷新靠新 token 由 host `adoptToken` **L454-460** 采纳同一 retained 子会话；**无跨 host 重启恢复**
- `close()` **L397-438**：`handle.dispose()` + `workspace.archiveSession(childSessionId)` **L409-424**；`disposeAll()` **L501-515** 同样 archive。archive 语义（workspace L243-266）：durable 隐藏（进 archivedSessionIds），数据保留，可 unarchive。

### 3.6 ask_user_question 的双重硬阻断（缺口 3 改法修正的依据）
1. **DELEGATED_CALLER 守卫（本地 0.1.1-rc.2 确认存在）**：`userQuestions.ask()` 要求调用 agent 是注册表 live **root**；master `interaction/user-questions/src/index.ts` **L94-107**；**本地同款**：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-user-questions/lib/types/index.js` **L72**（"human interaction is unavailable while the calling agent is owned by another live agent" → DELEGATED_CALLER）。btw 子代理 owner=parent（§3.2）→ 非 root → **加白也必被拒**。
2. **客户端无应答 scope**：客户端只为会话列表/当前会话铸造 agent scope（master `session-controller/client/sessions/service.ts` **L571-574** `eligible()`）；问题经 agent-scoped waterfall（`user-questions/request`）路由到该 scope；隐藏子会话不在列表 → 无 scope → `NO_PROVIDER`。
→ **结论：缺口 3 不能靠加白名单；须插件内自建问答通道**（自定义 `btw_ask_user` 工具 + `sideChat/answer` remote + 面板内问答 UI）。

### 3.7 本地 0.1.1-rc.2 API 实况（fork 依赖逐项核对）
| 依赖 | 本地状态 |
|---|---|
| `ctx.agents.create` | ✓ `dsh-agent/lib/types/index.d.ts` L288 |
| `ctx.agents.resume({resumeSessionId,...})` | ✓ 同文件 **L296**（**持久化恢复的关键 API，本地已存在**） |
| `roots()` | ✓ L370 |
| `Agent.followup` / `agent.status` | ✓ runtime-types.d.ts L115 / L70 |
| `archiveSession` | ✓ dsh-workspace lib |
| `TypertRemoteService`（host 服务基类） | ✓ dsh-typert-protocol |
| `childSessionMeta / applyChildComposition / resolveChildAgentOptions / resolveChildDepth / appendDelegatedPolicyOverrides / captureDelegatedPolicyOverrides` | ✓ dsh-subagent `lib/types/index.d.ts` **L52** 全量导出 |
| `ctx.sidebarRightTabs` | ✗ 不存在（全树 grep 无命中）——但**上游插件本来也不用它**（用 header 按钮槽 + overlay 抽屉槽），不阻塞 |
| `dsh-better-sidebar`（上游可选 peer） | ✗ 未安装 → overlay 抽屉形态（上游的 fallback 本来就是它） |
| `dsh-client-ui-slots` / `dsh-client-ui-primitives` / `dsh-client-web-react` | ⚠️ **`~/.dsh/profiles/node_modules/@deepseek-ai/` 下为指向已清除 npx 缓存（`1e7f6d9597241db0`）的死链**；web profile 实装目录也无此三包（详见 §4.4） |

### 3.8 本地客户端插件加载机制
- host 侧 `dsh-client-modules`（`lib/index.js` **L276**）：用 `require.resolve(`${spec}/package.json`)` 从 **node 解析树**解析插件 `dsh.client.inject` 声明的包，构建浏览器模块图。
- 浏览器侧 `dsh-client-runtime/lib/client.js` 内有 `require('@deepseek-ai/dsh-client-ui-slots')` 且运行中 GUI 正常渲染 → 运行进程的解析根与 `~/.dsh/profiles/node_modules`（死链所在）**不是同一棵树**（当前 npx 缓存为 `2453649666e7772c`）。执行期须定位运行进程的实际解析根（V1）。
- 本地跑通的先例 **dsh-taste**：`lib/client.js` 为手写 build-free 的 `window.__ModuleLoader__.load({id, factory})` bundle，UI 为 fixed 浮层，不依赖 slots 注册。→ fork 客户端半边的保底形态。

### 3.9 "主 agent 进行中状态"读取入口（缺口 2 依据）
稳定入口 = 会话事件流 + 状态镜像（与"以落盘为事实基准"一致）：
- `parent.session.events`：最后一个 `turn/end` 之后的后缀 = 进行中 turn（最近 `user/message`、进行中 `tool/call`、未 finalize 的 `assistant/chunk` 增量）。
- `parent agent.status === 'running'`（`agent/status` 事件镜像）。
- goal：子代理可自调 `get_goal`（白名单已含）。
- 上游 `transcript()` **L151-209** 就是对事件流的同款投影（用于子会话），可直接复用其模式写 `buildProgressDigest(parent)`。
- **注意有损性**：见 §4.5 —— 读事件流需处理 compaction 替换事件，建议读 surface 或去重，避免双计。

---

## 4. 部署级问题与调研差异（交叉验证重点）

### 4.1 对契约基线（btw-wallpaper-plan.md）的验证
| # | 基线说法 | 实测 | 裁定 |
|---|---|---|---|
| 1 | 四层只读策略 | 属实（§3.3） | 无差异 |
| 2 | 30min 闲置清理 | 属实（§3.5），细节：父或子忙碌即续满，仅双方 idle 才倒计时 | 无差异 |
| 3 | 只 fork 已完成回合前缀 | 属实（§3.1），且是 DSH seed 合法性硬约束 → 摘要只能注入消息 | 基线未言明原因 |
| 4 | 白名单未验证含问答工具 | **已验证：无 `ask_user_question`；有 `web_search`、`skill`**；且加白无效（§3.6） | **重大差异：缺口 3 改法需修正** |
| 5 | 接线用 `ctx.sidebarRightTabs` | 本地无此 API；上游也不用（header 槽 + overlay 槽） | 差异：改 overlay 形态 |
| 6 | fork 上游直接可用 | peerDeps semver prerelease 冲突（§4.2）+ 客户端包链死链（§4.4） | 需适配 |

### 4.2 peerDep 版本：semver prerelease 冲突（主 audit 未提）
上游全部 peerDeps 为 `>=0.1.0-rc.7 <0.2.0`；本地为 `0.1.1-rc.2`。npm semver 规则：**prerelease 版本只有当区间存在同 [major,minor,patch] 元组的 comparator 时才可匹配**——`0.1.1-rc.2`（元组 0.1.1）对 `>=0.1.0-rc.7`（元组 0.1.0）**不满足** → 安装时全线 peer 冲突。fork 时必须把所有 peerDeps 改为 `>=0.1.1-rc.2 <0.2.0` 或精确 `0.1.1-rc.2`。

### 4.3 死链包与安装方式（主 audit 只说"缺失"，未点明性质）
`~/.dsh/profiles/node_modules/@deepseek-ai/` 下 `dsh-client-ui-slots`、`dsh-client-ui-primitives`、`dsh-client-web-react` 是**指向已清除旧 npx 缓存 `1e7f6d9597241db0` 的 broken symlink**（readlink 实测）。含义：
- host 侧解析（dsh-client-modules 的 `require.resolve`）会因此失败 → 任何 `dsh.client.inject` 引用这三包的插件无法加载客户端。
- 安装 fork 包必须**拷贝真实目录**（install-plugins.sh 已有明训："DSH 启动时只给官方包重指符号链接、从不剪枝非官方条目，所以这里放真实目录是安全的"），严禁符号链接。
- 运行中进程的解析根另在一处（§3.8），执行期首步验证（V1）。

### 4.4 数据有损压缩（compaction / tool-result-pruner，主 audit 未提）
本地实测 `dsh-compaction-tool-result-pruner/lib/index.js`：
- `pruneSession(session)`（**L136-169**）：对 session 的 **surface** 节点逐个检查，超预算的 tool result 被**替换**——追加 `compaction/prune` 事件 + 替换版 `tool/result` 事件，替换文本含标记 `"\n\n[... tool result middle pruned ...]\n\n"`（**L7**）。
- `dsh-compaction-basic` 的 compaction 也是 append 模式（`compaction/start` / `compaction/end` 追加，不删历史）。
含义：
- **durable 日志 append-only，无破坏性丢失**；但**有效上下文（surface）是有损的**：大工具输出中段被剪、前缀可能被 compaction 摘要取代。
- 对 btw：fork seed 原样继承父事件（含 compaction 事件），btw 子代理看到的父上下文是**剪枝/摘要后的 surface**，不是全量原始输出。对"参考上下文"用途通常可接受，但**不得宣称"完整原始主会话记录"**；契约里"完整只读主会话记录"应理解为 surface 语义。
- 缺口 2 的 `buildProgressDigest` **必须读 surface（或对替换事件去重）**：naive 读 `session.events` 会把原始 tool/result 与替换版**双计**。

### 4.5 cordis.patch.yml 端口钉死：**未发现**（交叉验证结论）
- `~/.dsh/profiles/web/cordis.patch.yml` 全文已读：仅 vision-adam insert、agent-presets default 换 standard-glm、taste insert，**无任何端口配置**。
- `dsh-vision-adam/lib/index.js`（真实目录实测）无 listen/端口钉死；`dsh-taste` 的 bridge.js 走 `ctx.connection.rpc`（`rpc.handle`，注释 ISSUE-5），无独立端口。
- 若主 agent 侧另有"端口钉死"证据，不在我核查的这批文件内——**此项存疑待主 agent 提供线索**，我不确认也不否认。

### 4.6 其它执行期注意
- 上游 `engines.node: ^22.19.0 || >=24.0.0`，本地 node v22.23.2 ✓ 满足。
- 上游带完整测试（`tests/host-lease.spec.ts`、`tool-policy.spec.ts`、`safe-boundary.spec.ts` 等），fork 应保留并扩展。
- license：上游 MIT（package.json + LICENSE），fork/修改/再分发允许，保留版权与许可声明 + THIRD_PARTY_NOTICES.md 即可。

---

## 5. 修订后的方案（要点）

### 5.1 Fork 包结构
- 源 `/tmp/side-chat` v0.4.0 → `/home/CNS2026495165/dsh/dsh-btw/`；包名 `@deepseek-ai/dsh-btw`（本地自建包 scope 先例），version `0.4.0-btw.1`。
- 保留 `src/`（TS 源）+ tsdown 构建管线 + `tests/`；产物 `lib/`。保留 MIT LICENSE + THIRD_PARTY_NOTICES.md，README 注明 fork 来源与三处增强。
- `cordis.patch.yml`：`{insert: [{id: btw, name: '@deepseek-ai/dsh-btw'}]}`。

### 5.2 客户端接线（按本地实况，二选一，V1 定案）
- **方案 A（保底，推荐）**：dsh-taste 先例——手写/构建后单文件 ModuleLoader bundle（`window.__ModuleLoader__.load`）+ fixed 侧滑浮层 + 自建悬浮触发钮，不依赖 slots 注册与 Better Sidebar；host 通信优先 typert remote（`ctx.remote.$mount`），不通则 `ctx.connection.rpc`（V2）。
- **方案 B**：V1 验证运行进程解析树可用后，保留上游 `ctx.slots.inject('conversation.session.header.actions' / 'shell.overlay')` 写法。

### 5.3 缺口 1：持久化
1. 删 30min TTL（`evaluateSideChatLease`/`scheduleExpiry`/`touch` 的过期路径；client 移除 expired 态）。
2. `close()` 不再 `archiveSession`（隐藏已由 origin:'subagent'+无 parentSession 天然达成，数据留 persistence）。
3. 新增 `~/.dsh/btw/index.json`（parentSessionId → {childSessionId, createdAt, lastActiveAt}，原子写）；`start()` 命中索引 → **`ctx.agents.resume({resumeSessionId, setup: 重放四层只读+persona+guard})`**（本地 L296 已确认存在）；resume 失败清索引降级新建。
4. **不要把 parentSessionId 写回 child meta**（会破坏 §3.2 的隐藏机制）——映射放独立索引文件。

### 5.4 缺口 2：进行中进度摘要
1. `buildProgressDigest(parent)`：读 **surface**（或事件流去重替换事件）中 seed 边界后的后缀——最近 user/message、进行中 tool/call（名称+参数截断）、未 finalize 的 assistant/chunk、status。
2. `start()` 在注入 SIDE_CHAT_BOUNDARY 后追加一条 plugin notice 携带 digest。
3. 删除 `no-completed-turn` 拒绝，允许 seed=[]（digest 提供线索），主会话首回合进行中也能开 btw。

### 5.5 缺口 3：反向提问 + grill-me
1. 插件内问答通道：setup 内注册自定义工具 `btw_ask_user`（参数同 ask_user_question：questions[{id,question,header?,options?,multi_select?}]）；execute 挂起等待 host 侧 Promise；`sideChat/read` 返回值加 `pendingQuestion`；新增 `sideChat/answer` remote 回传；取消走既有 abort。白名单与守卫放行 `btw_ask_user`；persona 补"需要澄清时用 btw_ask_user 反向提问"。面板渲染问题卡（选项/多选/自定义输入）。
2. grill-me：host 读 `~/.dsh/skills/grill-me/SKILL.md` 文本拼入 persona（缺文件优雅降级）；**不依赖 skill 工具加载**，`disable-model-invocation: true` 不构成阻断（文本注入路径不受影响）。
3. `web_search` 已在白名单，无需改。

### 5.6 部署
- 拷贝真实目录到 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-btw`（严禁 symlink）；`~/.dsh/profiles/web/cordis.patch.yml` 加 insert；重启 `npx @deepseek-ai/dsh web` 验证。

---

## 6. 细粒度交付单元清单（10 + 1 条）

**U0 执行期验证** — V1 运行进程解析树（定客户端方案 A/B）；V2 typert remote 客户端可用性（否则 connection.rpc）；V3 peerDeps 改写后安装实测 ｜ 结论记录到本文件 ｜ 三项定案。

**U1 fork 骨架** — `dsh-btw/` 新目录 ｜ 拷贝 src/tests/构建配置/package.json/LICENSE/THIRD_PARTY_NOTICES；改名 `@deepseek-ai/dsh-btw` v0.4.0-btw.1；patch.yml insert ｜ 结构完整，grep 上游名仅 README 致谢命中。

**U2 依赖对齐本地** — `package.json` peerDeps ｜ 全部改 `>=0.1.1-rc.2 <0.2.0`（或精确版）；移除 dsh-better-sidebar 可选依赖 ｜ 本地树内构建成功产出 lib/；node require 冒烟通过。

**U3 客户端接线** — `src/client/*` ｜ 按 U0 结论走方案 A（ModuleLoader bundle + fixed 浮层）或 B（slots 槽位）｜ 重启后浏览器加载无报错，浮层可开合。

**U4 移除 30min 清理（缺口 1a）** — side-chat-service.ts L44/L62-89/L462-488 + controller.ts L48 及 expired 路径 + tests/host-lease.spec.ts ｜ 删过期路径 ｜ 闲置超 30min 不 close、read 持续可用（测试绿）。

**U5 持久化索引与 resume（缺口 1b）** — 新增 `src/host/btw-registry.ts`；改 `start()`/`close()` ｜ `~/.dsh/btw/index.json` 原子读写；命中 → `agents.resume` 重放 setup；close 不 archive ｜ 开 btw→重启 dsh→刷新重开：transcript 完整、无新 fork、子会话仍隐藏。

**U6 进行中摘要（缺口 2）** — side-chat-service.ts 新增 `buildProgressDigest`；改 start() L261-264/L306-317 ｜ surface 后缀投影为 digest，以 plugin notice 注入；允许 seed=[] ｜ 主 agent 运行中打开 btw 能答"现在在干嘛"；全新会话首回合进行中可打开。

**U7 插件内问答通道（缺口 3a）** — `src/shared/remote.ts`、side-chat-service.ts、tool-policy.ts、面板 UI ｜ §5.5.1 全套 ｜ btw 内模型发问→面板问题卡→回传→模型继续；取消不悬挂；写类工具仍被拒（safe-boundary.spec 扩展）。

**U8 grill-me 注入（缺口 3b）** — side-chat-service.ts persona ｜ SKILL.md 文本拼入 persona，缺文件降级 ｜ "grill me" 触发分轮编号提问+推荐答案；缺文件时 btw 正常。

**U9 白名单本地核对** — tool-policy.ts ｜ 对照本地实际注册工具 ｜ 可见工具 = 白名单 ∩ 本地注册；web_search 可用；写类全拒。

**U10 部署接线与端到端** — install-plugins.sh、cordis.patch.yml ｜ 真实目录拷贝 + insert ｜ 重启后全链路手工验收：开→问→只读→反向提问→进行中摘要→闲置>30min 存活→重启恢复→End 关闭。

---

## 7. 与主 agent 冻结版 audit-btw.md 的交叉验证（错误 / 遗漏清单）

| # | 主 audit 内容 | 交叉验证结果 |
|---|---|---|
| 1 | 缺口 3 改法："把问题工具名（ask_user_question）加入 L8-33 白名单"；交付单元 6 同 | **错误（最关键）**。双重硬阻断：DELEGATED_CALLER（本地 dsh-user-questions lib/types/index.js **L72** 实测存在，btw 子代理 owner=parent 非 root）+ 客户端 scope 路由（隐藏子会话无 scope → NO_PROVIDER）。加白无效，须插件内自建问答通道（§5.5.1）。**若"修订并执行"阶段按主 audit 落地此条，反向提问功能会静默失败（工具调用永远报错）** |
| 2 | 交付单元 4："持久映射（child meta 存 parentSessionId）" | **危险**。上游 hiddenSideChatMeta（L129-133）刻意剥离 parentSession 正是为了隐藏；写回会令子会话可能出现在子代理目录。映射应放独立索引文件（§5.3.4） |
| 3 | 交付单元 7："对齐 dsh-client-ui-slots peerDep" | **遗漏全局问题**：所有 peerDeps `>=0.1.0-rc.7` 对本地 `0.1.1-rc.2` 按 npm semver prerelease 规则均不满足（元组 0.1.1≠0.1.0），全线冲突（§4.2） |
| 4 | "dsh-client-ui-slots 本地缺失，需处理" | **不精确**：是**指向已清除 npx 缓存的 broken symlink**（三个包：slots/primitives/web-react），且运行进程的解析根在另一棵树；安装必须真实目录、严禁 symlink（§4.3） |
| 5 | （未提） | **遗漏**：`ctx.agents.resume({resumeSessionId})` 本地存在（dsh-agent L296），是重启恢复的正道；主 audit 的"workspace 恢复查询"含糊 |
| 6 | （未提） | **遗漏**：`no-completed-turn` 拒绝（源 L261-264）——主会话无已完成回合时 btw 根本打不开；缺口 2 需含"允许空 seed" |
| 7 | （未提） | **遗漏（数据有损压缩）**：compaction-tool-result-pruner 会以追加替换事件的方式剪掉大工具输出中段（`[... tool result middle pruned ...]`，pruner L7/L136-169）；btw 继承的是剪枝/摘要后的 surface；digest 构建必须去重替换事件，否则双计（§4.4） |
| 8 | （未提） | **小遗漏**：peer `dsh-better-sidebar` 本地未安装 → 必然走 overlay 抽屉形态；上游 engines.node 本地满足 ✓ |
| 9 | 主 audit 行号基于 lib/index.js（构建产物） | 提示：fork 修改对象是 src/*.ts；本报告提供 src 级行号（§3） |
| 10 | 主 audit 的白名单内容、四层只读、30min 位置、fork seed、archiveSession 语义 | **与源码级复核一致，无误** |

### 关于"cordis.patch.yml 端口钉死"
**我在核查范围内未发现**（§4.5）：cordis.patch.yml 无端口配置；vision-adam 与 taste 均无 listen/端口钉死，taste 走 ctx.connection.rpc。若主 agent 有具体证据（哪个文件钉了哪个端口），请提供线索，我不就此项下结论。

---

## 8. 是否卡住
**未卡住。** 核心机制全部查清，方案完整。遗留 3 项执行期验证（U0/V1-V3：运行进程解析树、typert remote 客户端可用性、peerDeps 安装实测），均为"修订并执行"阶段首步动作，不阻塞方案成立。
