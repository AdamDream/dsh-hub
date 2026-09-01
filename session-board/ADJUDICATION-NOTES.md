# 会话状态板 · 主 Agent 独立验证笔记（裁决依据）

> 与 PROPOSAL.md 独立平行 produced；审计 subagent 必须逐条核对方案是否与下列事实一致。
> 源码根：`/home/CNS2026495165/.dsh/profiles/web/node_modules/@deepseek-ai/`

## V1. 轮末发布挂点
- `dsh-agent-loop/lib/index.js:388` — `setPhase()` 在 status 变化时 `dispatch.emit("agent/status", { status })`；
- status 由 phase 派生（381 行）：`idle|maintenance → "idle"`，其余 → `"running"`；
- 即 `running → idle` 的 `agent/status` 事件 ≈ 一轮结束（含 error/abort 终局，因 finally 里有 `turn/end` append）。
- 注意：`agent/status` 每次**变化**才发，连续两轮间必有 idle 过渡（除非 waking send 连续触发——见 V5）。

## V2. 轮初注入挂点
- `dsh-agent-loop/lib/index.js:501` — `await this.dispatch.waterfall("agent/pre-step", {...})`；
- `dsh-session-reference` 的注入范式：`agent/pre-step` 监听器后处理已接受的直发用户消息，在其后插入一条 sourced UserMessage。

## V3. 第二种注入机制（repeat-tool-reminder 范式）
- `tools/post-execute` 决策可携带 `additionalContexts`（UserMessage 数组）；
- `dsh-agent-loop/lib/index.js:685` — `acceptContext = (context) => this.inbox.splice("next-step", ...)`：进入 inbox 的 next-step 队列 → 被认领后进入会话日志 → **持久**；
- `dsh-repeat-tool-reminder/lib/index.js:181-186` — PLUGIN_SOURCE `{ kind: "plugin", plugin: "repeat-tool-reminder" }`，注释明言 label 是 load-bearing（无 label 会渲染成用户 prompt）。
- 结论：**没有易失注入通道**，两种机制都进持久历史；预算设计必须按"每轮注入会累积、靠 compaction 遮蔽"建模。

## V4. 防递归/防二次快照（免费获得）
- `dsh-session-reference/lib/index.js:47` — `projectSessionConversation` 只保留 `source.kind === "user"` 的 user/message（+ compact checkpoint）与 assistant 文本；
- 任何 `kind: "plugin"` / `kind: "session-reference"` source 的注入消息都被排除 → 状态板注入用非 "user" source 即自动：a) 不被 @session 二次快照；b) 不被同管线再提取。
- **审计要点**：方案必须显式用 plugin source，严禁 kind:"user"。

## V5. 幂等与环路风险
- 一轮内：pre-step 每 step 触发一次（非每轮一次！）——注入必须以 turn 为单位去重（检查本 turn 是否已注入）；
- 连续轮次：running→idle→running 交替，agent/status 只在变化时发射；waking send（inbox 有货）会立即再入 running——发布侧须按 turn/end 序号或时间戳幂等；
- 注入内容是纯只读状态快照（无指令语义）→ 无反馈回路；但提取侧若读"最近助手消息"必须排除注入消息自身（V4 的 source 过滤已覆盖）。

## V6. 跨进程存储
- `dsh-atomic-write` 包：`withFileLock(path, fn)` + `writeFileAtomic(path, text, { mode })`——原子替换+文件锁，README 明言支持多进程 read-modify-write；
- board 落盘 `~/.dsh/` 下按分组键哈希分文件即可，写侧锁+原子替换，读侧容忍旧完整内容。

## V7. 分组键（worktree → repo 级）
- 会话 header 含 cwd（session-reference 候选排序 same-cwd/cwd-less/other-cwd 可证）；
- worktree 各自 cwd 不同 → 必须解析 `git rev-parse --git-common-dir`（或 .git 文件里 `gitdir:` 指向的共享 dir）归一到 repo 级；非 git → realpath(cwd)。
- 注意缓存：每会话解析一次即可（会话 cwd 不变）。

## V8. 插件挂载先例
- `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/`：package.json（peerDependencies: cordis/dsh-tools/…）+ lib/index.js（z.object Config + defineTool + ctx.tools.register）；
- `~/.dsh/profiles/web/cordis.patch.yml` 顶层 `- insert: [{id, name}]` 条目；重启生效；
- `~/.dsh/install-plugins.sh` 模式可复用。

## V9. 预算换算
- 500 tokens ≈ 中文 700~900 字节 / 英文 2000 字节；保守按 UTF-8 字节上限 ~2000B 建模（含结构开销）；
- 参照 session-reference 的 `maxReferenceBytes=65536` 单源上限与 dsh-output-retention 头尾截断范式。

## V10. 子代理会话排除
- subagent 会话 header 带 `parentSession`（dsh-subagent 源码多处引用）且 origin==="subagent"（listChildren 过滤条件可证）→ 状态板必须排除 `origin === "subagent"` 或有 parentSession 的会话，只同步顶层会话。

## V11. 状态提取 API（比爬事件日志干净）
- `dsh-session-projection/README.md:13` — `ctx.sessionProjections.stateOf(session, key)` 同步读单 unit 当前状态；
- `dsh-tool-todo/lib/index.js:79-94` — 注册 projection key `"todos"`（todo/write 事件 last-write-wins，turn/start 重置）；
- `dsh-goal/lib/index.js:523-524` — 注册 projection key `"goal"`；
- 即轮末发布可 `stateOf(agent.session, "todos")` + `stateOf(agent.session, "goal")` 直接拿结构化状态，机械提取零 LLM 调用；
- 注意：`ctx.inject(["sessionProjections"], ...)` 可选能力模式——插件须在 registry 缺席时优雅降级（headless 场景）。
- session header 字段验证（dsh-session/lib/types/index.js:41-56）：cwd 必须绝对路径字符串；parentSession 可选字符串；origin 仅允许 "subagent"。

## 待核对项（审计时逐条打勾）
- [ ] 方案注入用 plugin source（V4）
- [ ] 注入按 turn 幂等（V5）
- [ ] 发布挂点选 agent/status running→idle 或等价物（V1）
- [ ] 预算含结构开销且按字节硬截断（V9）
- [ ] 分组键 worktree 归一（V7）
- [ ] 排除 subagent 会话（V10）
- [ ] 存储 withFileLock/writeFileAtomic（V6）
- [ ] 零修改官方包 + patch.yml 挂载（V8）
