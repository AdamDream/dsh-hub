# btw 侧聊面板向 subagent 会话界面靠拢 — 修订执行复核一体（btw UI 线）执行报告

> 执行档子代理（adam/deepseek-v4-flash），两阶段闭环的「修订执行复核一体」档，同一档内完成实现 + 自复核（自裁决 pass），不另派独立复核。
> 依据：需求（用户已对齐，范围不得更改）+ 差距审计（`.workspace/btw-ui-gap-audit.md`，⑤ B 层实现面）+ 实时机制审计（`.workspace/btw-live-stream-audit.md`，方案 A：transcript 挂点 L412-420、step/turn 数据来源、agent.phase、tool/call 事件、220ms 轮询 controller.ts:718）+ 执行基线（`.workspace/btw-upgrade-impl-exec.md`，v2：vitest 173 passed/2 skipped、smoke 10 断言）。
> 红线遵守：只改 `/home/CNS2026495165/dsh/dsh-btw/` 内文件；未改 ~/.dsh 任何文件、未拷贝部署产物、未重启进程、未使用 sandbox_permissions（会话已禁用审批，未发起任何提权）。

---

## 0. 总裁决：**通过（pass，自复核）**

- 三项需求全部落地：①顶部运行横幅（TurnStatus 渐变近似）②消息块保持原样 ③工具调用块（Layer B 扁平摘要 + 客户端 ToolRow 近似件）。
- 八步验证全绿：oxlint 0/0、tsc×3 零错、vitest **21 文件 / 186 passed / 2 skipped**（基线 173 → 186，净增 13，存量全保）、tsdown 构建成功、smoke **10 断言**通过、publint All good（pack 步骤的沙箱处理见 §4 遗留 1）。
- 无单元阻塞；无契约冲突；无超出范围改动；②b 非流式语义、官方包、布局框架、220ms 轮询均未触碰。

---

## 1. 改动文件 + 关键行号

| 文件 | 改动 | 关键行 |
|---|---|---|
| `src/shared/remote.ts` | 新增 `sideChatToolDigestSchema`（callId/name/args/result?/isError?/running?，.strict）、`sideChatCurrentActionSchema`（discriminatedUnion: generating \| tool，含 turn/step）；`sideChatTranscriptMessageSchema` 增 `tools?`；`readSideChatResultSchema.value` 增 `currentAction?` | :69-114（digest/action）、:133-137（message.tools）、:200-201（value.currentAction） |
| `src/host/side-chat-service.ts` | `transcript()` 扩展：①增采 `tool/call`+`tool/result` 扁平摘要（挂到其前的助手消息，对齐官方 ToolCallTree 位置；`tool/result` 的 callId 取自嵌套 `ToolResultBlock.toolCallId`，:426-438）；②`step/start` 记录最新 turn/step（:408-411）；③in-flight 扫描：`runningTool` 语义修正为「当前未结算调用名」（原为"最后一个 tool/call 名"）；④`currentAction`（kind tool/generating + turn/step，tool 优先用调用自身 turn/step，生成用最新 step/start；:473-513）；⑤child idle 时对未结算摘要清 running 旗标（stopped 化，:466-472）；⑥`SideChatCurrentAction`/`SideChatToolDigest` 类型导入（:53-54） | :346-527（transcript 整体） |
| `src/client/controller.ts` | `SideChatClientState` 增 `currentAction?`（:26）；`poll()` 与 `confirmRestore()` 携带/清除 `currentAction`（随 host 下发，未下发即清除防陈旧，:721-739、:641-664）；**轮询延迟 220/700ms 未动**（:720） | :13-29、:709-742 |
| `src/client/SideChatToolRow.tsx` | **新增**：ToolRow 近似件——`DisclosureRow`（官方原语）+ 简化 `toolIconFor`（VARIANT_ICONS 简化版：read/search/write·edit·patch/bash·exec·run/code/others）+ 折叠行（工具名 + 摘要）+ 展开 IN/OUT ioCard（对齐官方 `.ioCard/.ioSection/.ioLabel/.ioText`）；`data-state` running/error/ok；running 摘要显示「运行中…」 | 全文（~80 行） |
| `src/client/SideChatSurface.tsx` | ①顶部运行横幅：transcript 首子元素，`running` 时渲染，`role="status"`，文案 = `输出中… · 当前动作: <tool>`（tool）\| `输出中…`（generating 兜底）（:399-406）；②助手消息块内渲染 `message.tools` → `SideChatToolRow`（:420-433）；消息块本身（MarkdownText/角色标签/图片）未动 | :399-406、:418-434 |
| `src/client/locales.ts` | 新增 3 键 ×en/zh + `SideChatLocaleKey`：`drawer.bannerOutputting`（输出中…/Outputting…）、`drawer.bannerCurrentAction`（当前动作/current action）、`drawer.toolRunning`（运行中…/Running…） | 键:17-18、en:52-53、zh:84-85 |
| `src/client/side-chat.module.css` | ①`.runningBanner/.runningBannerText`：官方 TurnStatus 渐变复刻（`--dsw-static-deepseek-500/200` 渐变 + background-clip:text + 1.8s shimmer，sticky 置顶 + 半透底 chip）；②ToolRow 全套（`.toolRow[data-state=running] .toolRowRow::after` sweep 2.6s、`.toolRowIoCard/.ioSection/.ioLabel/.ioText/.toolRowErrorSummary` 对齐官方 token）；③`prefers-reduced-motion` 关闭 shimmer/sweep | :224-292 |
| `tests/host-activity.spec.ts` | **新增**（5 断言块）：摘要挂载（结算+in-flight）、生成态 currentAction、idle 停用横幅数据+stopped 化、错误结果、无前置助手消息时的 pending 挂载 | 全文 |
| `tests/remote-contract.spec.ts` | +1 块：tools/currentAction round-trip + 严格拒绝（未知 digest 字段/非法 kind/空 tool 名） | 尾块 |
| `tests/controller.spec.ts` | +2 测试：currentAction+tools 经 poll 携带、host 停止下发后陈旧 currentAction 清除；`readResult` 辅助签名放宽 messages.tools | 中段 |
| `tests/side-chat-surface.spec.tsx` | primitives mock 增 DisclosureRow（支持 expandOnRowClick 展开）+ 6 个工具图标 stub；+4 测试：横幅（tool 态含工具名 / generating 态纯输出中 / 回合结束消失）、ToolRow 渲染（ok/running 态、点击展开 IN+OUT、error 摘要） | mock:10-60、测试尾块 |
| `tests/overlay-measurement.spec.tsx`、`tests/presentation.spec.tsx` | primitives mock 补 DisclosureRow + 图标 stub（SideChatToolRow 传递依赖兜底） | mock 块 |

---

## 2. 逐需求状态

### 需求 1：顶部运行横幅 — ✅ 完成
- 子代理回合进行中（`running`）在面板 transcript 顶部渲染「输出中…·当前动作」（sticky 置顶，自动滚动下仍可见）。
- 有工具调用（`currentAction.kind === 'tool'`）→ `输出中… · 当前动作: <工具名>`；纯生成（`kind === 'generating'`，或 currentAction 未下发兜底）→ `输出中…`。en/zh 双语。
- 回合结束（`running=false`）→ 横幅消失；完整消息经既有 220ms 运行态轮询 ≤220ms 落地（controller.ts 轮询延迟**原样未动**，L720 `running ? 220 : 700`）。
- 数据源按实时机制审计方案 A：`running` 来自 `agent.status`（=agent.phase 非 idle 的派生，实时审计 L412-413）；生成/工具细分来自**已落盘** `step/start` + `tool/call`/`tool/result` 事件（②b 不产生 chunk，本方案不创造 chunk）；host transcript 提供 `running`/`runningTool`（runningTool 语义修正为「当前 in-flight 调用」，无既有消费者，安全）。
- 样式 = 官方 TurnStatus 渐变复刻：`--dsw-static-deepseek-500/200` 水平渐变 + `background-clip:text` + `dsh-turn-status-shimmer` 等价动画 + `prefers-reduced-motion` 降级。

### 需求 2：消息块 — ✅ 保持原样（按要求不动）
- 用户/助手消息块、MarkdownText 原语、角色标签、图片块全部原样。
- 未做 reasoning 折叠、未加时间/copy、未加元数据行/状态徽标（这些官方元素按需求明确不做）。

### 需求 3：工具调用块（Layer B）— ✅ 完成
- **host**：`transcript()` 增采 `tool/call`（name/args 原文 IN）+ `tool/result`（contentText OUT/isError），按 `callId`（嵌套 `ToolResultBlock.toolCallId`）配对；扁平摘要挂到**其前的助手消息**（对齐官方 ToolCallTree 位于请求文本之后）；未结算调用带 `running`，child idle 后自动 stopped 化（去 running 旗标）；无前置助手消息时挂到下一个可见助手消息（pending 兜底）。
- **wire**：`SideChatTranscriptMessage.tools?: SideChatToolDigest[]`（callId/name/args/result?/isError?/running?，strict schema）；`read.value.currentAction?`。未搬全量 ToolCallBlock（按审计 B 层"只搬扁平摘要"）。
- **客户端**：`SideChatToolRow` 近似件 = 官方 `DisclosureRow` + 简化 VARIANT_ICONS + 折叠摘要 + 展开 IN/OUT（`ioCard` 结构/`--dsw-alias-markdown-code-block`/`--dsw-font-markdown-code-block-small` 对齐官方）+ `data-state` running/error/ok + running sweep 动画；复杂结果卡（read/diff/terminal/search/web）不做，落 generic IN/OUT（官方本有 GenericToolCard 兜底，审计 B 层第 3 条）。

---

## 3. 验证输出摘要（/home/CNS2026495165/dsh/dsh-btw，直接二进制）

```
oxlint src tests tsdown.config.ts vitest.config.ts   → 0 warnings / 0 errors
tsc -p tsconfig.json                                  → 0 errors
tsc -p tsconfig.client.json                           → 0 errors
tsc -p tsconfig.tests.json                            → 0 errors
vitest run                                            → 21 files / 186 passed / 2 skipped
tsdown                                                → ESM + CJS(client.js 326.8KB) 构建成功
node scripts/smoke-build.mjs                          → smoke ok（10 invocations / 10 descriptors，断言数保持 10）
publint --level error                                 → All good（pack 步骤沙箱处理见 §4-1；纯目录 lint `--pack false` 亦 All good）
```
（基线 173 passed / 2 skipped → 现 186 passed / 2 skipped，净增 13 断言通过；存量测试全部保持。）

---

## 4. 自复核（对照需求与审计逐项）

**需求/审计核对**：三项需求逐项 ✓（§2）；审计 Layer B 方案（gap-audit ⑤B：transcript 增采、wire tools?、DisclosureRow ToolRow、IN/OUT、data-state+sweep、generic 兜底）逐条落地 ✓；方案 A（live-stream-audit §2.1：running/runningTool 已存在、输出中/思考中细分、220ms 保持、零官方包改动）✓。

**副作用核对**：
- ②b 非流式语义未动：chunk 处理逻辑（partial/reasoning 聚合）原样，仅新消费已落盘的回合级事件（step/start、tool/call、tool/result）。
- 无官方包改动、无 agent-loop 新事件（方案 B1/B2 明确未做）。
- 布局框架未动：抽屉/跳转列表/图片块/lightbox/composer 均未改结构。
- v2 测试未破坏：186 passed 覆盖全部存量断言；`readResult` 辅助仅放宽 messages 类型（加可选 tools），既有调用不受影响。
- 无范围外改动：未动用户消息/助手消息渲染语义、未加时间/copy/徽标/reasoning 折叠。

**遗留问题（如实）**：
1. **publint pack 步骤的沙箱限制（环境，非代码）**：`publint` 内部跑 `pnpm pack`，在当前 workspace-write 沙箱下无法打开 pnpm 默认 store 的 SQLite DB（`~/.local/share/pnpm/store`）与 npm cacache（`~/.npm`），报 "unable to open database file"/EROFS。工作区验证时用临时 PATH shim（`pnpm --config.store-dir=<工作区内临时目录> pack`）跑通完整 pack 版 lint → All good；纯目录 lint `publint --level error --pack false` 亦 All good。v2 基线直接跑通说明彼时沙箱更宽。临时产物已清理，未留任何仓库改动。
2. `runningTool` 语义从「最后一个 tool/call 名」修正为「当前 in-flight 调用名」：此前无 UI 消费者（controller 仅透传），属语义修正，报告备注。
3. 运行横幅在 `queued`（用户消息已发送未送达、child 未 running）时显示「输出中…」兜底文案（currentAction 仅在 childRunning 时下发）——短暂过渡态，需求未覆盖，可接受。
4. 工具摘要为扁平化：无子调用树（subCalls）、无复杂结果卡、无时间戳——按审计 B 层范围（不做全量 ToolCallBlock）。
5. 官方 TurnStatus 有 ≥15s 秒表，需求未要求，未做。
6. 运行态 ToolRow 的 sweep 动画仅 CSS（`.toolRow[data-state=running]`），与官方同机制；复杂结果卡缺失时结果全部落 generic IN/OUT 文本。

---

## 5. 部署注意点（主代理部署期）

1. **lib 拷贝目标**：`cp -r lib ~/.dsh/profiles/node_modules/@local/dsh-btw/`（lib 已重建：client.js 326.8KB；拷贝前备份现有部署位 lib）。本档未拷贝、未部署。
2. **smoke 断言数保持 10**：`scripts/smoke-build.mjs` 与 `tests/package-contract.spec.ts` 均未增方法，仍为 10。
3. **生效方式**：btw host 无新增 remote/事件，仅 transcript 聚合逻辑在包内 → 替换 lib 后**重启 DSH host**（host 侧 transcript 生效）+ **浏览器强刷**（client rev 变化 → 新 bundle 生效）。无官方包补丁、无 settings 改动。
4. **验收点（部署后 GUI）**：面板顶部子代理回合进行中见渐变「输出中…」横幅；有工具调用时横幅显示「· 当前动作: <工具名>」；回合结束横幅消失、完整消息 ≤220ms 出现；助手消息下方出现可折叠 ToolRow（IN/OUT），运行中行有扫光动画；主会话/子代理会话 UI 与 ②b 非流式语义无任何变化。
5. 部署前可用 `node_modules/.bin/publint --level error --pack false` 快速复核（沙箱内 pack 需 §4-1 shim）。

---

## 6. 与审计/基线的对照索引
- 差距审计 ⑤B 层实现面：B-1（host 增采 + wire tools?）✓、B-2（DisclosureRow ToolRow + IN/OUT + sweep）✓、B-3（generic 兜底、复杂卡不做）✓。
- 实时机制审计 方案 A：transcript 挂点 running/runningTool（L412-420 现状）✓、agent.phase（经 agent.status）✓、step/start 与 tool/call 事件 ✓、220ms 轮询 controller.ts:718 保持 ✓、禁做方案 B1/B2 ✓。
- 执行基线：v2 功能未回退，vitest 173→186、smoke 10 不变。
