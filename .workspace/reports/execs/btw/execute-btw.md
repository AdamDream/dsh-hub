# btw 执行报告（修订并执行阶段产出）

> 依据：`audit-btw-subagent.md`（交叉验证修正版，U0–U10）+ 用户执行指令（包名 `@local/dsh-btw`、五点核心纠正）。
> 上游：`/tmp/side-chat` = @lukeknow0/dsh-side-chat v0.4.0（MIT，未改动，只读）。
> 产物：`/home/CNS2026495165/dsh/dsh-btw/`（可构建、可安装的完整包）+ 本报告。
> 改动规模：**33 个文件修改 + 2 个新增**（src 17、tests 14、构建/脚本 4、README×2、package.json、cordis.patch.yml），全量 `check` 链（typecheck×3 / oxlint / vitest 132 通过 2 跳过 / tsdown build / smoke / publint）全绿。

---

## U0 执行期验证（三项定案）

### V1 运行进程解析树 —— 已定案
- 运行进程：`node ~/.dsh/profiles/web/node_modules/.bin/dsh web`（PID 4113979），解析根 = `~/.dsh/profiles/web/node_modules`，向上回退命中扁平目录 `~/.dsh/profiles/node_modules`（dsh-taste / dsh-vision-adam 真实目录先例）。当前 npx 缓存 `2453649666e7772c` 装的是无关包（@agegr/pi-web），与 DSH 无关。
- `~/.dsh/profiles/node_modules/@deepseek-ai/` 下 `dsh-client-ui-slots` / `dsh-client-ui-primitives` / `dsh-client-web-react` / `dsh-client-web` 确为指向已清除缓存 `1e7f6d9597241db0` 的**死链**（审计 §4.3 属实）；从 web 根 `require.resolve` 四包全部 FAIL，`/plugins/<pkg>/client.js` 均 404。
- **但对本 fork 不构成阻断（对审计 §3.7/§4.3 的重要修正）**：实测浏览器内核（dsh-web-frontend dist 的静态 seed 表 `Jd()`）原生提供 `react`、`react/jsx-runtime`、`react-dom`、`@deepseek-ai/cordis`、**`@deepseek-ai/dsh-client-ui-slots`**、**`@deepseek-ai/dsh-client-ui-primitives`** 六个 seed 模块。且 dsh-client-modules 的 `resolveMeta` 只解析插件**自身**包名、不逐项解析 `dsh.client.inject` 条目（inject 列表只随 boot graph 下发浏览器，由 seed/graph row 满足）——官方 ui-subagent/ui-jobs 的 inject 就带着 primitives 在线上正常运行。因此上游客户端对 primitives 的 `require(...)` 走 seed 分支，**无需替换组件、无需从 inject 列表摘除**。

### V2 typert remote 客户端可用性 —— 已定案：可用（走上游原路径）
- 宿主侧：`SideChatService extends TypertRemoteService` → `typertRemote` 绑定；`dsh-typert-loader`（本地存在）对每个挂载的 loader entry 解析其 `./typert` 导出并注册进 `ctx.typert.local`；`dsh-api-gateway` 以 strict 描述符认领 `sideChat/*` 端点（`/api` RPC 拦截）。约束已核对并满足：manifest 的 `package` 字段必须等于 loader entry 名（= 包名）→ 已统一为 `@local/dsh-btw`；`validateSegment` 允许 scoped 名（官方先例 `@deepseek-ai/dsh-commands`）。
- 浏览器侧：`remote` 服务由 `dsh-api-gateway/lib/client.js` 提供 `$mount(contribution)`（线上 43 个 boot 条目含 api-gateway/api-remotes/typert-registry，`immediately: true`）；`slots` 服务存在（官方 conversation/ui-agent-preset 均注入并在用）；上游用到的两个槽位 `conversation.session.header.actions`（conversation client L7370 渲染，ui-agent-preset 有占用先例）与 `shell.overlay`（layout client L237 渲染）本地都在。
- 结论：**保留上游 slots/typert 客户端方案（审计 §5.2 的方案 B）**，dsh-taste 式自建浮层（方案 A）不需要。

### V3 peerDeps 改写后安装实测 —— 已通过
- devDeps 全部改钉 `0.1.1-rc.2`（npm registry 均存在，逐一核实），`npm install`（`legacy-peer-deps`，因保留的 dsh-better-sidebar devDep 带 `^0.1.0-rc.8` peer；仅影响构建树，部署为目录拷贝不走 npm）→ 367 包装毕。
- `tsc -p tsconfig.json / tsconfig.client.json / tsconfig.tests.json` 全过；`tsdown` 构建产出 `lib/`（index.js 66.76 kB ESM + client.js 274.56 kB CJS ModuleLoader bundle）；`node require` 冒烟：部署位 `lib/index.js` 以**真实运行树**导入成功（name=dsh-btw、TYPERT package=@local/dsh-btw、6 个 invocation、guard 断言通过）；六个描述符的 zod schema 样例往返全过。

---

## U1 fork 骨架 —— ✅ 落地
- `/tmp/side-chat` → `/home/CNS2026495165/dsh/dsh-btw/` 整目录拷贝（剔除 `.git`；后剔除陈旧 `pnpm-lock.yaml`）。MIT LICENSE / THIRD_PARTY_NOTICES.md / 署名全保留；README.md 与 README.zh.md 顶部加 fork 说明（含三项增强与上游致谢）。
- 改名：package.json `@local/dsh-btw` v`0.4.0-btw.1`（**用户指令优先于审计 §5.1 的 `@deepseek-ai/dsh-btw` 建议**，typert package 字段随之 `@local/dsh-btw`）；插件名 `dsh-side-chat`→`dsh-btw`、client 名→`dsh-btw/client`；tsdown `PLUGIN_ID='@local/dsh-btw'`（bundle banner id 必须等于 graph row id，dsh-taste 先例核实）；slot id `dsh-side-chat.action/drawer`→`dsh-btw.*`；`SIDE_CHAT_TAB_TYPE`→`dsh-btw:conversation`；DOM 属性 `data-dsh-side-chat-*`→`data-dsh-btw-*`；CSS 变量 `--dsh-side-chat-reserve-*`→`--dsh-btw-reserve-*`；locale 命名空间 `side-chat`→`btw`；console 前缀 `[dsh-btw]`。
- 验收自查：`grep -rn "dsh-side-chat" src/ tests/ scripts/` 仅剩 README 引用的安装命令字符串与 sign-contract 里的上游命令断言（README 致谢/上游原文性质），满足「grep 上游名仅 README 命中」精神。

## U2 依赖对齐本地 —— ✅ 落地
- **全部** `@deepseek-ai/*` peerDeps 由 `>=0.1.0-rc.7 <0.2.0` 改为 **`>=0.1.1-rc.2 <0.2.0`**（含 slots/primitives——保留为 peer 是忠实上游，浏览器侧由内核 seed 满足，npm 侧 0.1.1-rc.2 在 registry 存在可满足）；`@deepseek-ai/cordis ^4.0.1`、`react ^18.2.0` 不变；engines `^22.19.0 || >=24.0.0` 保留（本地 v22.23.2 ✓）。
- **移除** `dsh-better-sidebar` peerDep + peerDependenciesMeta.optional（本地未装，必走 overlay 抽屉——上游 fallback 本来就是它）；保留在 devDependencies 仅供 typecheck/测试（presentation 代码的类型引用是 type-only，构建产物无此依赖）。
- devDeps `@deepseek-ai/*` 钉 `0.1.1-rc.2`（与本地运行时同版构建）。
- 验收自查：树内构建成功产出 lib/ ✓；node require 冒烟（部署位 + 真实运行树）✓；package-contract.spec 增加 peer 范围断言（全部 rc.2 区间、无 better-sidebar）✓；publint "All good!" ✓。

## U4 移除 30min 清理（缺口 1a）—— ✅ 落地
- `src/host/side-chat-service.ts`：删除 `SIDE_CHAT_IDLE_TTL_MS`、`SIDE_CHAT_LEASE_POLL_MS`、`evaluateSideChatLease`、`SideChatLeaseInput/Decision`、`LiveSideChat.expiresAt/expiryTimer/leaseBusy`、`touch()`、`scheduleExpiry()` 及全部调用点；`read()` 不再是"续租心跳"。
- `src/client/controller.ts`：删除 `EXPIRED_MESSAGE`、`expiredState()`、`errorKind`、state 与 fixtures 里的 `expiresAt`；`not-open` 改为通用错误态（`NOT_OPEN_MESSAGE`，提示历史已保存、点重试恢复）+ 重试（重试→close→open→start→走 U5 resume）。
- `src/client/locales.ts`：`drawer.discard` 改"跨任务、跨重启保留"；删除 expiredTitle/expiredBody/restart 三键。
- 线协议（`src/shared/remote.ts`）：start/read 值删除 `expiresAt`、start 值删除 `cleanupMode`；错误码枚举删除 `no-completed-turn`（配合 U6）。
- 测试：`host-lease.spec.ts` 重写为"无租约"断言（fake timers 推进 31/60 分钟后 read 仍 ok、start 值无过期字段）；controller/overlay-measurement 的 expired 用例改为 not-open 用例。
- 验收自查：测试绿（闲置 31 分钟不 close、read 持续可用——host-lease.spec 3 例）；`grep -n "expir\|TTL\|Lease" src/` 仅剩注释性说明。

## U5 持久化索引与 resume（缺口 1b）—— ✅ 落地
- 新增 `src/host/btw-registry.ts`：`BtwRegistry` 管理 `~/.dsh/btw/index.json`（`DSH_HOME ?? ~/.dsh`；实测进程未设 DSH_HOME → `~/.dsh/btw/index.json`）。结构 `{version:1, entries:{[parentSessionId]:{childSessionId,createdAt,lastActiveAt}}}`；读取容忍缺失/损坏→空索引；**原子写**（唯一临时文件 + `rename`，失败清理临时文件；写链串行化防交错）；`get/set/touch/remove`。
- `start()`（side-chat-service.ts）：活表去重/换 token 逻辑保持后，**先查索引**：命中 → `startResumed()` 用 `parent.ctx.agents.resume({resumeSessionId, agentOptions: resolveChildAgentOptions(...), signal, setup: composeChild(同一四层只读+persona+guard+btw_ask_user)})` 恢复；`seedLength` 取持久会话头 `header.seedLength ?? 0`（`childSessionMeta` 在 seedLength>0 时持久化，空 seed 时 0 亦正确）；resume 成功后仅注入**新的进行中摘要**（持久日志里已有 boundary，不重复注入）、投递排队消息、`touch` 索引。resume 失败 → 清索引 → 降级新建（"resume 失败清索引降级新建"）。新建路径在 handle 就绪后 `registry.set` 落索引。
- `close()`：**不再 `archiveSession`**、不再走 workspaceRegistry 分支——dispose 运行时句柄、reject 未决问题、forget 映射，返回 `cleanup:'kept'`；**索引条目保留**（重开即 resume 历史；见待澄清 ①）。`disposeAll()` 同步去掉 archive。
- 隐藏机制保持：`hiddenSideChatMeta` 仍剥离 `parentSession`（注释明确"映射放 sidecar，绝不写回 child header"）。
- 测试：新增 `tests/host-persistence.spec.ts` 4 例（命中索引→resume 不新建+不重复注入 boundary；新建后索引落盘；resume 失败→降级新建+清索引；close 不 archive 且索引保留），DSH_HOME 隔离到 mkdtemp 临时目录、父会话 id 逐测试唯一防串扰。
- 验收自查：单测覆盖四条路径 ✓。**跨真机重启的端到端（开→重启 dsh→刷新重开→transcript 完整、无新 fork、子会话仍隐藏）未执行**——重启宿主进程会终止本执行会话自身，留待主 agent/用户重启后手工验收（见文末步骤）。

## U6 进行中摘要（缺口 2）—— ✅ 落地
- `side-chat-service.ts` 新增导出 `buildProgressDigest(parent)`（外层 try/catch 降级为纯状态行）：
  - 状态：`parent.status`（'running'|'idle'）；
  - **边界**：原始日志 `findLast(turn/end)` 之后的后缀（无 turn/end 则全长——配合空 seed）；
  - 最近用户指令：优先**读 surface**（`session.surface.nodes` 逆序找 user/message），surface 不可用时回退原始后缀（测试替身路径）；
  - 进行中工具：后缀内 `tool/call`（名称 + 参数 JSON 摘要截断 120 字符，最多列 5 个）；
  - 未定稿输出：后缀内 `assistant/chunk` 按 turn:step 聚合、剔除已 `assistant/message` 定稿的步骤；
  - **替换事件去重说明**：摘要字段只取 `turn/end`（log-only）、`tool/call`（log-only，永不被 pruner 替换）、`assistant/chunk`（log-only）与 surface 投影的 user/message，**完全不读 `tool/result`**（pruner 只替换 tool/result），故剪枝替换不可能双计（审计 §4.4 的要求以构造方式满足）。
- 注入：新建路径在 `SIDE_CHAT_BOUNDARY` 后追加第二条 plugin notice（`summary: 'Main conversation progress snapshot'`）；**resume 路径也注入**（每次重启后重开拿到"现在在干嘛"的最新快照——见待澄清 ②）。同一活条目内重复 start（duplicate/adoptToken）早退不重复注入，不会刷屏。
- **允许空 seed**：删除 `no-completed-turn` 拒绝（原 L261-264）；主会话首回合进行中即可开 btw，digest 提供线索。
- 测试：host-opening 新增"空 seed + running 父会话"用例（start ok、seedLength 0、boundary+digest 两次注入、digest 含 running 状态与工具名）。
- 验收自查：单测 ✓；"主 agent 运行中打开 btw 能答现在在干嘛"依赖运行时模型行为，重启后手工验收。

## U7 插件内问答通道（缺口 3a）—— ✅ 落地（按修正方案，非加白 ask_user_question）
- 工具注册：`composeChild()`（create 与 resume 共用 setup）内 `childCtx.tools.register(defineTool({name:'btw_ask_user', ...}))`——参数/输出 schema 逐字段对齐本地 `dsh-tool-ask-user` 的 ask_user_question（questions[{id,question,header?,options?[{label,description?}],multi_select?}] → answers[{id,selected[],custom?}]）；**实测通过本地 dsh-tools 的 defineTool 校验**。作用域注册不受 `tools.restrict({allow})` 全局过滤影响（dsh-tools L2775 注释"scoped registrations remain visible"），也不进 restrict 名单（否则会因"unknown global tool"抛错）。
- execute：挂起等 host 侧 Promise；`exec.signal` abort（Stop/取消/dispose）→ 清 pending、reject；**同一面板同时只允许一个未决问题**，第二个调用立即报错提示等待（见待澄清 ③）。
- 白名单/守卫：`btw_ask_user` 加入 `READ_ONLY_TOOL_SET`（守卫层放行）；**不进** `READ_ONLY_TOOL_CANDIDATES`（可见层=白名单∩父代理全局工具，btw_ask_user 是子作用域注册，进名单反而会在 restrict 校验炸）；`ask_user_question` 维持拒绝（DELEGATED_CALLER+无 scope 双重硬阻断，加了也静默失败——审计 §3.6）。
- 线协议：`sideChat/read` 值新增 `pendingQuestion:{questionId,questions[]}`（optional）；新增 `sideChat/answer` remote（request `{chatToken,questionId,answers[]}` / value `{chatToken,questionId,accepted:true}`）；描述符/typert host 模型/client 命名空间同步（6 个 invocation）。
- 宿主 `answer()`：匹配 entry 的未决 questionId → resolve；失配 → `invalid-input`。
- 客户端：controller 新增 `answer(answers)`（成功后本地清除 pendingQuestion）；`SideChatSurface.tsx` 新增 `QuestionCard`（问题卡：选项按钮（单选 radiogroup/多选 group + aria-pressed）、自定义输入、提交/发送中/错误态，`side-chat.module.css` 新增 `.question*` 样式簇）；read 轮询合并 pendingQuestion。
- 测试：controller 新增 2 例（read 浮现 pendingQuestion→answer 回传→清除；无未决时拒绝）；tool-policy 新增 btw_ask_user 放行 + 不在全局候选断言 + ask_user_question 仍拒；remote-contract 新增 answer 往返 + close `kept`。
- 验收自查：单测 ✓；`btw 内模型发问→面板问题卡→回传→模型继续`全链路需重启后手工验收；"写类工具仍被拒"由 tool-policy/safe-boundary 断言（write/edit/bash/ssh_exec/subagent/mnemon_remember/ask_user_question 全拒）✓；取消不悬挂：abort 路径 + close/disposeAll reject 未决问题 ✓（代码路径，运行时待验收）。

## U8 grill-me 注入（缺口 3b）—— ✅ 落地
- `persona()`：基础 persona（新增 btw_ask_user 使用指引"需要澄清先问，别瞎猜"）+ 懒加载一次性 `readFileSync(~/.dsh/skills/grill-me/SKILL.md)`（**剥掉 YAML frontmatter**——`disable-model-invocation: true` 只约束 skill 工具加载，内联后若不剥会误导模型忽略这段文本；见待澄清 ⑧），以 `<grill-me>...</grill-me>` 包裹拼入，并给出"grill me 触发时用 btw_ask_user 按轮次编号提问+推荐答案"的衔接指引；文件缺失/为空 → 优雅降级为纯 persona。
- 不依赖 skill 工具加载；实测本地文件存在且剥壳后正文以 "Interview the user relentlessly…" 开头。
- 验收自查：代码路径 ✓（单测覆盖 persona 组装外的行为层）；"grill me 触发分轮编号提问+推荐答案"的模型行为重启后手工验收；缺文件降级路径已实现（无独立单测，待澄清 ⑦ 备注）。

## U9 白名单本地核对 —— ✅ 落地
- 对照本地部署实际注册工具（grep 本地 dsh-tool-* / dsh-tools / dsh-terminal 包）：**白名单 ∩ 本地注册 = read, read_image, glob, grep, lsp, web_search, skill, job_list, job_output, get_goal**（+ 守卫层 run_code；+ 子作用域注册的 btw_ask_user）。`view_image / session_event_* / session_* / terminal_* / list_agents / mnemon_*` 本地未注册，由 `visibleReadTools(parent)` 运行时交集自然滤除——正是"可见工具 = 白名单 ∩ 本地注册"的设计行为，白名单无需删名。
- `web_search` 可用 ✓（dsh-tool-web 注册）；写类全拒 ✓（见 U7 测试断言）。
- `READ_ONLY_DENIAL` 文案更新为 btw 语境并指路 btw_ask_user。

## U10 部署接线与端到端 —— ⚠️ 部署完成，重启+手工验收待主 agent/用户执行
- 真实目录拷贝（**非 symlink**，遵循 install-plugins.sh 明训）：`~/.dsh/profiles/node_modules/@local/dsh-btw/`（剔除 node_modules/.npmrc/lockfile；含 lib/、src/、tests/、cordis.patch.yml、LICENSE、THIRD_PARTY_NOTICES、docs）。
- `~/.dsh/profiles/web/cordis.patch.yml` 追加 `- insert: [{id: btw, name: '@local/dsh-btw'}]`（YAML 解析验证 ✓；与 dsh-side-chat 上游"insert 无端口钉死"结论一致——审计 §4.5 未发现端口钉死，本次核查亦未见）。
- 部署位冒烟：`require.resolve('@local/dsh-btw/package.json')` 从 web 根 ✓；部署位 `lib/index.js` 以真实运行树导入 ✓（name=dsh-btw、guard 断言、btwIndexPath=`~/.dsh/btw/index.json`）；`typert.host.js` 6 个 invocation 的 schema 样例往返 ✓；`defineTool` 校验 ✓。
- **未做**：重启 `npx @deepseek-ai/dsh web`——重启会终止承载本次执行会话的宿主进程（以及主 agent 会话本身）。重启后验收步骤：
  1. `npm exec dsh web`（或既有启动方式）重启，观察启动日志无 btw/client-modules/typert-loader 报错；
  2. 浏览器刷新 `http://127.0.0.1:3080`，`window.__DSH_BOOT__.entries` 应含 `@local/dsh-btw`；Console 无红错；
  3. 任一会话页头出现 btw 按钮 → 开面板 → 问一句（只读工具可用）；
  4. 让主 agent 跑长任务时打开 btw 问"它现在在干嘛"（进行中摘要）；
  5. 问一个含糊问题诱导 `btw_ask_user` → 面板出问题卡 → 选择/作答回传 → 模型继续；
  6. 面板闲置 >30 分钟重开：历史仍在（不消失）；
  7. 重启 DSH → 刷新 → 重开 btw：transcript 完整、无新 fork（`~/.dsh/btw/index.json` 命中 resume）、子会话不在任何目录；
  8. End 关闭：面板关闭、索引保留、子会话数据仍在磁盘。

---

## 待澄清项（执行中的理解与判断，未拍板改方案）

1. **close（End 按钮）后索引条目保留**：审计只说"close 不 archive"，未说是否删索引。我实现为**保留**（重开即 resume 历史，贴合"持久化"目标），并把 End 确认文案改为"历史仍在磁盘、重开可恢复"（en/zh locale `drawer.endBody`）。若期望"End=彻底断开"，删一行（close 里 `registry.remove`）即可。
2. **digest 在 resume 时也注入**（不只新建时）：为满足"重启后主 agent 执行中，btw 能答现在在干嘛"的验收场景。同活条目内重复 start 早退不注入，不会重复刷屏；但每次重启后重开会在子日志追加一条新的快照 notice（plugin source，面板 transcript 不显示）。
3. **btw_ask_user 同时只允许一个未决问题**：第二个并发调用立即报错（"等上一题答完"），配合 read 的单数 `pendingQuestion` 契约与单卡 UI。若要支持并发多问，需把 wire 改数组并重做卡片，超出本单元范围。
4. **线协议简化**：`expiresAt`（start/read 值）与 `cleanupMode` 删除、close `cleanup` 枚举改 `kept|absent`、start 值新增 `resumed`（区分 resume/新建，便于验收"无新 fork"）。两侧同包同装，无兼容负担；`resumed` 是我在 U5 语义内的最小增量。
5. **slots/primitives 保留在 peerDeps**（范围改 rc.2）：忠实上游 + npm 上可满足；V1 实测浏览器内核 seed 兜底，装不装都运行。
6. **dsh-better-sidebar 留在 devDependencies**：presentation 的类型引用与既有测试需要它；构建产物不含（type-only），部署树不含（已排除 node_modules）。审计只要求移除 optional peer，此为最小实现。
7. **sign-contract.spec.ts 的 `trackedPngNames` 由 `git ls-files` 改为列 docs/assets 目录**：fork 无 .git 元数据，git 命令返回空导致断言失败；目录列举语义等价（提交物即目录内容）。macOS-only 的两个资产渲染用例本机（Linux）skip。
8. **grill-me frontmatter 剥离**：SKILL.md 头部 `disable-model-invocation: true` 若随文注入，模型可能误读为"别用这段指令"；剥壳属于"文本注入路径"的忠实意图（该开关只管 skill 工具调用，不管内联）。
9. **start 应答时序微变**：查索引的一次本地 fs 读使 start 比"上游单微任务即应答"多一跳；`host-opening` 的应答时序用例改为 setImmediate 轮询等待（子创建仍未落定时应答）。客户端行为不受影响（'starting' 态本就不等 start 返回）。
10. **README fork 横幅置于标题区**：sign-contract 对 README 的字符串/顺序断言全部保持通过（tagline、Quick install 位置、上游安装命令原文保留在正文中）。

## 遗留与风险
- **重启验收未做**（上述 U10 步骤 1-8）——唯一未闭环项，原因是重启即自杀（宿主进程承载本会话）。
- `btw_ask_user` 的 `timeoutMs` 未声明（对齐 ask_user_question 无截止；取消/关闭路径已覆盖 reject）。若部署挂了 dsh-tool-call-timeout-policy 且希望限时，可后续加。
- resume 依赖本地 `dsh-session-persistence`（WorkspaceRegistry 同款依赖，部署内存在 ✓）；若某环境无持久化，resume 抛错→自动降级新建，功能不中断（持久化语义退化为会话内保留）。
- 上游 `docs/`、品牌资产、`scripts/render-brand-assets.py` 原样保留（sign-contract 的 PNG 哈希断言通过）；fork 的 git 元数据未初始化（无版本管理需求，如需可 `git init`）。

## 验收状态总表
| 单元 | 状态 | 单测/静态验收 | 运行时验收 |
|---|---|---|---|
| U0 V1/V2/V3 | ✅ | 解析树/seed/typert 链路实测定案 | — |
| U1 fork 骨架 | ✅ | grep/构建/命名核查 ✓ | 重启后加载 |
| U2 peerDeps | ✅ | install/build/require/publint ✓ | 重启加载 |
| U3 客户端接线 | ✅（方案 B：保留上游 slots+typert） | bundle externals=seed∩graph ✓ | 重启后按钮/抽屉可开合 |
| U4 去 30min 清理 | ✅ | host-lease 3 例 ✓ | 闲置>30min 手工验证 |
| U5 索引+resume | ✅ | host-persistence 4 例 ✓ | 重启恢复手工验证 |
| U6 进行中摘要 | ✅ | digest 单例（host-opening）✓ | 运行中问答手工验证 |
| U7 问答通道 | ✅ | controller/tool-policy/remote-contract ✓ | 问题卡全链路手工验证 |
| U8 grill-me | ✅ | 文件读取+剥壳实测 ✓ | "grill me"行为手工验证 |
| U9 白名单核对 | ✅ | ∩ 本地注册实证 10 项 ✓ | — |
| U10 部署 | ⚠️ 部署+冒烟完成 | YAML/解析/导入/schema ✓ | **待重启后 8 步手工验收** |
