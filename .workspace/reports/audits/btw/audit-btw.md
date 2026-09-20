# btw 审计报告（Fork @lukeknow0/dsh-side-chat + 补三缺口）

> ⚠️ **已被交叉验证版取代**：见 `audit-btw-subagent.md`（子代理源码级复核）。本报告三处错误已纠正：①缺口 3"白名单加 ask_user_question"无效（DELEGATED_CALLER + 客户端 scope 双重硬阻断，须自建问答通道）；②交付单元 4"child meta 存 parentSessionId"会破坏隐藏机制（改独立索引 `~/.dsh/btw/index.json` + `agents.resume`）；③peerDeps 是全线 semver prerelease 冲突（元组 0.1.1≠0.1.0，不止 slots 一个）。执行阶段以 `audit-btw-subagent.md` 为准。

## 审计结论
**需修改。** @lukeknow0/dsh-side-chat v0.4.0 与需求高度吻合（侧栏只读并发对话、四层只读、fork 主会话、父模型继承），三处缺口（持久化/进行中摘要/grill-me）均可补。fork 所需本地 API 在 0.1.1-rc.2 全部存在。

## 已验证机制（源码 /tmp/side-chat/lib/index.js，共 510 行）
- **只读白名单** L8-33 `READ_ONLY_TOOL_CANDIDATES`：含 `web_search`(L15)、`skill`(L16)，**无 `ask_user_question`**；L34 再加 `run_code`；L35-37 判定；L38 拒绝文案。
- **四层只读** L237-240 `sandboxMode:"read-only"` + `approvalPolicy:"never"`；L241-244 `applyChildComposition({persona, toolFilter:{allow}})`；L245 `tools.guard(isSideChatToolAllowed → READ_ONLY_DENIAL)`。
- **fork** L80-84 `completedTurnSeed`（切到最后一个 `turn/end`）；L210 `childId=randomUUID()`；L230-247 `parent.ctx.agents.create({sessionId, seed, meta, agentOptions, signal, setup})`；L234 `resolveChildAgentOptions(parent,…)` 继承父模型/composition。
- **30min 清理** L43 `SIDE_CHAT_IDLE_TTL_MS=18e5`(30min)；L459-479 `scheduleExpiry`（父/子都非 running 且 wasBusy 后到期 → close）；L378-434 `close` = `handle.dispose()` + `workspaceRegistry.archiveSession`(L394-396)。
- **隐藏子会话** L394-396 `archiveSession`；L88-91 `hiddenSideChatMeta` 去掉 durableParentLink。
- **喂消息** L252-263 注入 `SIDE_CHAT_BOUNDARY`；L267/L346 `handle.agent.followup(message)`。
- **依赖** package.json L95 peerDep `@deepseek-ai/dsh-client-ui-slots`（本地 0.1.1-rc.2 缺失，需处理）；L26 node ^22.19（本地 v22.23.2 满足）。

## 三处缺口与改法
1. **持久化（去 30min 清理）**：L43+L459-479 是"临时 Codex 式"设计。改：取消 idle 自动 close；close 仅关 UI，不 dispose 不 archive；`childSessionId↔chatToken↔parentSessionId` 内存 Map（L172-173）改为持久（child meta 存 parentSessionId，或 workspace 恢复查询）。验收：闲置 30min 不消失；重启 DSH 后按父会话找回历史。
2. **进行中进度摘要**：L80-84 seed 只含已完成回合。改：创建 child 时（或 read 时）注入一条摘要（"主 agent 当前 running/tool X/最近动作"），数据源 `parent.agent.status`（L466 已在用）+ parent.session.events 最后未终结 turn 的 partial（参考 L105-169 `transcript` 对 child 的 partial/runningTool 算法，改造成对 parent 采样）。验收：主 agent 执行中，btw 能答"它现在在干嘛"。
3. **grill-me / 反向提问**：白名单无 `ask_user_question`。改：把问题工具名加入 L8-33 白名单；`skill` 已在(L16)，可 `skill("grill-me")`。验收：btw 内可反向提问澄清。

## fork 结构建议
- 新包名 `dsh-btw`，复制 @lukeknow0/dsh-side-chat，改 lib/index.js + lib/client.js。
- 本地接线：`dsh.client.inject`(package.json L72-79) 保留；`dsh-client-ui-slots` peerDep 若真被引用需降级到 dsh-client-runtime 的 slots 契约。

## 交付单元（细粒度）
1. [lib/index.js L43] 禁用 idle TTL 触发的自动 close —— 验收：闲置 30min 不 close。
2. [lib/index.js L459-479] `scheduleExpiry` 改为仅显式 close 才清理 —— 同上。
3. [lib/index.js L378-434] 拆"UI 关闭"与"销毁"：UI 关闭不再 dispose/archive —— 验收：关侧栏重开历史仍在。
4. [lib/index.js L172-173] 持久映射（child meta 存 parentSessionId）—— 验收：重启后可按父会话恢复。
5. [lib/index.js L80-84/L230] 注入 parent 进行中摘要 —— 验收：见缺口 2。
6. [lib/index.js L8-33] 白名单加 `ask_user_question` —— 验收：见缺口 3。
7. [package.json] 对齐 `dsh-client-ui-slots` peerDep 到本地版本 —— 验收：pnpm 装包无 peer 冲突。
