# btw 插件升级 v2 — 修订并执行（btw 线）执行报告

> 执行档子代理（adam/deepseek-v4-flash），本线为三阶段闭环的「修订并执行-btw」档，曾因主 workflow 中断暂停（9/12 14:19-14:26 已实现一部分），本次恢复后继续完成剩余交付单元并自复核。
> 依据：审计交付单元（.workspace/btw-upgrade-impl-audit.md，388 行全文）、方案契约 v2（.workspace/btw-upgrade-plan.md）、现状审计（btw-upgrade-audit.md）、事故教训（incident-piai-model-selection.md）。
> 范围红线遵守：只改 /home/CNS2026495165/dsh/dsh-btw/ 内文件；未改 ~/.dsh 任何文件、未拷贝部署产物、未重启进程、未使用 sandbox_permissions。

---

## 0. 总裁决：通过（自复核）

- 八步验证全绿：oxlint 0/0、tsc×3 零错、vitest 20 文件 / 173 passed / 2 skipped、tsdown 构建成功、smoke（10 断言）过、publint 过。
- 无单元阻塞；无契约冲突；无超出范围改动。

---

## 1. 逐单元状态（对照审计交付单元清单）

| 单元 | 状态 | 说明 |
|---|---|---|
| U-A 协议：send 图片 parts | done（此前已实现，本次核对） | `src/shared/remote.ts`：`sideChatImagePartSchema`(:53-59)、`sendSideChatRequestSchema.images`(:134-141，text 保留必填、空文本+仅图允许)。本次由 remote-contract 新测试块验证 round-trip/拒绝/兼容。 |
| U-B 协议：转录图片引用+readImage+listTree/listProject schema | done（此前已实现，本次核对） | `remote.ts`：`sideChatImageRefSchema`(:62-67)、`sideChatTranscriptMessageSchema.images`(:69-73)、`readSideChatImage*`(:75-88)、`listSideChatTree/Project*`(:243-267)。remote-contract 覆盖。 |
| U-C 接线：descriptor/typert/client/smoke | done（此前已实现，本次核对） | 10 条 directDescriptor（remote-descriptors.ts:37-48，sourceLocation 对齐 host 行号）、typert.host.ts members 10 项（summary 文案符合审计）、client/remote.ts 10 方法 + TypertRemoteMap、smoke-build.mjs 断言 10。 |
| U-D host send() 图片链路（核心） | done（此前已实现，本次核对） | `side-chat-service.ts:808-867`：text 空**且** images 空才拒（invalid-input）；admitEncodedImages 失败→invalid-input 不发送；readImage 取字节→base64→analyzeImages→R1-9 包装；分析失败→`{code:'internal', message:'vision-adam 分析失败: …'}`，不 followup、requestId 不记账（可重试）；成功构建 text-only user message（R1-2）、`imageRefsByMessageId.set`、走原 sentRequests/pending/followup 顺序。host-image.spec 全链验证（含幂等、失败重试、不发送）。 |
| U-E host transcript 图片输出 | done（此前已实现，本次核对） | `transcript()`(:343-423)：user 条目按 event id 查 imageRefsByMessageId → images 数组（exactOptionalPropertyTypes 下不输出 undefined 键）；pending 乐观消息同输出；真实 host 事件路径 host-image.spec「U-E live path」验证（无重复、模板文本+refs）。 |
| U-F host readSideChatImage | done（此前已实现，本次核对） | `readSideChatImage()`(:943-970)：not-open/invalid-input/读取返回 {mediaType,data(base64)}。host-image.spec 覆盖。 |
| U-G-1 btw 内主会话图片变换 handler | done（此前已实现，本次核对） | 新建 `src/host/prompt-transform.ts`（createPromptImageTransformHandler + registerPromptImageTransform）+ `src/index.ts:9` 注册。waterfall 语义 (payload,next)：先 next()、只处理 image part、text 并入「用户原文」、成功返回 `[{type:'text',text:模板}]`、失败 throw。注册用 `ctx.on`（cordis 插件 fiber 销毁自动解绑，与审计所述 ctx.effect 生命周期语义等价——报告备注）。prompt-transform.spec 覆盖（2 图 1 文、前置插件 resolved 内容、失败抛错、纯文本不拦截、非法 mediaType 跳过、注册事件名）。 |
| U-G-2 官方包 patch | 非本线（部署产物已就绪） | `.workspace/deploy/patches/dsh-host-apiproxy.sessions-prompt-transform.patch` 已存在（审计线/部署线产物），本线只读参考；waterfall 名 `session/prompt-image-transform` 与 U-G-1 完全对齐（见 §4）。部署期由主代理备份+应用。 |
| U-H vision-adam 新 lib | 非本线（部署产物已就绪） | `.workspace/deploy/vision-adam/lib/index.js` 已存在；导出 resolveOptions/resolveApiKey/analyzeImageBytes 已实测核对与 btw ambient/调用一致（见 §4）。部署期主代理备份+替换。 |
| U-I btw 内 vision 分析模块 | done（此前已实现，本次核对） | `src/host/vision.ts`：VisionOptions/VISION_DEFAULTS（deepseek-v4.1-flash / opencode / OPENCODE_GO_API_KEY / maxTokens 2000 兜底）/wrapImageDescriptions（R1-9）/analyzeImages（读 settings vision-adam 段→resolveOptions→resolveApiKey→逐图 analyzeImageBytes，凭据失败→「vision-adam 凭据不可用」）；`src/shared/vision-adam.d.ts` ambient；`tsdown.config.ts:73` neverBundle 已含 `@deepseek-ai/dsh-vision-adam`（审计未确认项 2 **关闭**：构建实测通过，退路 createRequire 不需要）。 |
| U-J host listTree/listProject + 索引 v2 | done（此前已实现 + 本次修 1 个存量缺陷） | `btw-registry.ts`：BtwIndexEntry 增 parentTitle/parentCwd/lastPreview（version 保持 1，v1 兼容，parseIndex 容忍缺失）；`side-chat-service.ts`：listTree（listDescendants + 自身 + 索引 join，live 元数据优先）/listProject（sessionQuery.listSessions + sameRealpath cwd 分组）/listEntries/indexExtras/touchIndex。**本次修复**：`lastPreviewOf` 原实现对 `event.data.source` 无防护（host-persistence 存量测试 fixture 暴露 TypeError 导致 resume 静默降级 fork）→ 改结构式防护（side-chat-service.ts:174-192）。host-list.spec 覆盖树/项目/降级/v1 容忍/touch 后新值。 |
| U-K client listTree/listProject + jumpTo | done（此前已实现，本次核对） | `controller.ts`：listTree/listProject（内存缓存 treeByParent/projectByParent，sessions.list 变化即失效）+ readImage + jumpTo（跨会话调用序列：sessions.open → handleSessionChange park/restore → openSubagent 兜底 → controller.open 幂等 → viewStore.show）。本次修 `subagentAddressOf` 的 catalog 快照类型（部署专用包 dsh-client-connection 本工作区不可解析 → 结构式收窄）。controller.spec 新增 jumpTo 3 测试（park+新开、openSubagent 兜底、幂等）+ 1 图片发送 wire 测试。 |
| U-L client UI：跳转列表+附件轨+消息图片渲染 | **部分（此前已实现组件，本次补齐缺失的两块）** | 组件此前已实现：SideChatDrawer（挂 JumpList）、SideChatJumpList（tree/project 双 tab、相对时间、预览、当前高亮、点击 jumpTo）、SideChatSurface（onPaste+附件轨+移除+发送清轨、消息 images 缩略图+点击放大 lightbox、失败保留附件轨并展示 sendError）、view-store（attachments/jumpOpen + add/remove/clear/setJumpOpen）。**本次补齐**：① `src/client/locales.ts` 新增 15 个键（jumpTitle/jumpTree/jumpProject/jumpLoading/jumpEmpty/jumpCurrent/jumpRunning/jumpJustNow/jumpMinutesSuffix/jumpHoursSuffix/jumpDaysSuffix/attachments/attachmentRemove/attachmentOpen）×en/zh + SideChatLocaleKey 类型（此前缺失会导致 client tsc 失败）；② `src/client/side-chat.module.css` 新增 jump*/attachment*/messageImage*/lightbox 样式（此前缺失会导致运行时 css 类 undefined）。 |
| U-M 存量 typecheck 2 错 | done（此前已实现，本次核对） | `entry.modelSelection?.current?.model`（side-chat-service.ts:416 与 :1032 均已是 `?.`，仅类型收窄无运行时变化）；tsc 三路零错确认。 |
| U-N 测试扩展（最小集） | done（本次全部完成） | 见 §2。 |
| U-O 部署 runbook/文档产物 | 非本线 | `.workspace/deploy/`（patches/APPLY.md/settings snippet/README 由部署线维护）；本线在 §4 给出主代理部署期注意点。 |

---

## 2. 测试改动清单（本次完成，U-N）

**更新（存量）**
- `tests/remote-contract.spec.ts`：+4 测试块（image part 合法/拒绝、send 带 images 兼容旧 payload、transcript images/readImage round-trip、listTree/listProject round-trip）。
- `tests/package-contract.spec.ts`：方法列表断言 7→10。
- `tests/controller.spec.ts`：+4（jumpTo park+新开、openSubagent 兜底、jumpTo 幂等、图片发送 wire 形状）。
- `tests/side-chat-surface.spec.tsx`：+3（粘贴→附件轨→移除→发送携带 images 并清轨、失败保轨+sendError 展示、readImage 渲染消息图+lightbox）；修正存量 send 断言为双参（`send(text, attachments)`）。
- `tests/view-store.spec.ts`：+2（add/remove/clearAttachments、jumpOpen toggle 去重）；存量 toEqual 断言补新状态键（vitest toEqual 严格匹配键集）。
- `tests/overlay-measurement.spec.tsx`：3 处 SideChatDrawer 的 controller stub 补 listTree/listProject（Drawer 现挂载 JumpList 的存量回归修复）。

**新增**
- `tests/vision-template.spec.ts`（5）：R1-9 模板 1 图/2 图/空原文（无尾部空行）/原文 trim/默认值。
- `tests/host-image.spec.ts`（8）：U-D/E/F 全链——含图 send→分析参数透传（settings 读值→resolveOptions→resolveApiKey→analyzeImageBytes 收验证后字节的 base64）→followup 收 text-only 模板；分析失败不发送且 requestId 可重试；空消息 invalid-input；admission 失败 invalid-input 不发送；requestId 幂等；转录 images + readSideChatImage 回读/未知 id；真实 host 事件路径；未 open → not-open。
- `tests/host-list.spec.ts`（6）：listTree 树成员+索引 join+live 元数据（running/title/cwd/preview）、descendant 服务降级仅自身、listProject cwd 分组/无 cwd 空、v1 索引容忍+set/touch 携带 v2 字段、touch 后 listTree 新值。
- `tests/prompt-transform.spec.ts`（6）：U-G-1 纯逻辑（2 图 1 文模板、前置插件 resolved 内容、失败抛错、纯文本 undefined、非法 mediaType 跳过、事件注册）。
- `tests/jump-list.spec.tsx`（3）：R0-3/4/5——双 tab 渲染+条目+预览、当前项高亮+点击 jumpTo+show、project tab 切换。

---

## 3. 改动文件（本次会话）

| 文件 | 改动 |
|---|---|
| `src/client/locales.ts` | +15 键 ×en/zh + SideChatLocaleKey 类型 |
| `src/client/side-chat.module.css` | +jump/attachment/messageImage/lightbox 样式 |
| `src/host/side-chat-service.ts` | lastPreviewOf 结构式防护（event.data.source 缺省不崩，修存量回归） |
| `tests/remote-contract.spec.ts`、`tests/package-contract.spec.ts`、`tests/controller.spec.ts`、`tests/side-chat-surface.spec.tsx`、`tests/view-store.spec.ts`、`tests/overlay-measurement.spec.tsx` | 存量测试更新/扩展 |
| `tests/vision-template.spec.ts`、`tests/host-image.spec.ts`、`tests/host-list.spec.ts`、`tests/prompt-transform.spec.ts`、`tests/jump-list.spec.tsx` | 新增测试文件 |

另：`dsh-btw/node_modules` 补了 233 个 @deepseek-ai 包（符号链接指向 `~/.dsh/profiles/node_modules/@deepseek-ai/<pkg>`，与运行态版本一致；npm 额外装了 peer `dsh-scope@0.1.1-rc.2`）——**纯本地验证环境修复**（原 node_modules 缺大量 peer，host 测试无法加载 dsh-tools/dsh-llm 等；未动 package.json/package-lock、未改 ~/.dsh）。

---

## 4. 验证输出摘要

```
oxlint src tests tsdown.config.ts vitest.config.ts      → 0 warnings / 0 errors
tsc -p tsconfig.json                                     → 0 errors
tsc -p tsconfig.client.json                              → 0 errors
tsc -p tsconfig.tests.json                               → 0 errors
vitest run                                               → 20 files / 173 passed / 2 skipped
tsdown                                                   → ESM(node 9 产物) + CJS(client.js) 构建成功
node scripts/smoke-build.mjs                             → smoke ok（10 invocations / 10 descriptors）
publint --level error                                    → All good
```
（基线 132 passed / 2 skipped → 现 173 passed / 2 skipped，净增 41 断言通过，存量全部保持。）

---

## 5. 与部署产物的对接点（已核对一致）

1. **vision-adam lib**（U-H 产物）：btw 经 lazy `import('@deepseek-ai/dsh-vision-adam')` 调 `analyzeImageBytes(options, apiKey, mediaType, base64, question, signal)` / `resolveOptions(config)` / `resolveApiKey(options, ctx, signal)`——与 `.workspace/deploy/vision-adam/lib/index.js` 导出签名逐字一致（已读该文件核对：resolveOptions 返回 `{apiKeyEnv, apiKey?, baseURL, model, maxTokens, maxBytes, maxVideoBytes, xApiKey, sessionHeader}`，xApiKey/sessionHeader 默认 true）。配置单一源 = `ctx.get('settings')?.get('vision-adam')`；无段时 btw 用 VISION_DEFAULTS（model deepseek-v4.1-flash / baseURL https://opencode.ai/zen/go/v1 / apiKeyEnv OPENCODE_GO_API_KEY / maxTokens 2000）兜底。
2. **官方包 patch**（U-G-2 产物）：waterfall 名 **`session/prompt-image-transform`**，payload `{agent, content}`——与 `.workspace/deploy/patches/dsh-host-apiproxy.sessions-prompt-transform.patch` 内 `ctx.waterfall("session/prompt-image-transform", { agent, content }, () => void 0)` 完全对齐；btw handler 返回 undefined=不拦截（行为=现状）、返回 `[{type:'text',text}]`=变换、throw=host catch 报 agent-busy+reason（不发送）。
3. **索引 v2**：BtwIndexEntry 增 `parentTitle?/parentCwd?/lastPreview?`，文件 version 保持 1（v1 文件可读、字段缺失容忍）——与审计 §3-3/§4 修订一致。
4. **事故红线遵守**（incident-piai-model-selection.md）：未向 settings `llm-pi-ai.providers` 添加任何模型条目；vision-adam 段 `maxTokens: 990000`（0.99M 上限）由部署期 settings 承担，btw 侧只读透传，不动 settings.yaml。

---

## 6. 遗留问题 / 备注（如实）

1. **React act 警告（非失败）**：jump-list 等组件测试中 listTree 的异步 setState 落在 act 外有 "not wrapped in act" 警告——vitest 全绿，属已知测试风格问题，不影响交付；如需消除需在测试内显式 act 包裹异步 resolve（当前实现更贴近真实事件时序）。
2. **运行时未验证项（沿用审计未确认清单）**：`ctx.get('settings')?.get('vision-adam')` 在 btw host 侧运行时可读性（审计未确认 3）、主会话变换失败时主壳 agent-busy+details.reason 展示（未确认 4）、x-api-key/x-opencode-session 对 adam 网关兼容（未确认 6）——均需部署重启后人工/GUI 验收（验收 6.4.a-f）。
3. **vision-adam 调用真实执行**不属 vitest（U-H 验收 2 需真实 API 冒烟，部署后跑）。
4. **工作区 node_modules 依赖部署位符号链接**：仅本地验证用途；若工作区日后重新安装依赖需完整 pnpm/npm 安装（当前沙箱不可用 pnpm）。
5. **U-G-1 注册生命周期**：用 `ctx.on`（cordis 上下文/插件 fiber 销毁自动解绑）实现，未用审计示例的 `ctx.effect`——语义等价（随插件卸载），已在代码注释说明。
6. **descriptor sourceLocation 行号**：指向当前 host 方法行（444/784/793/870/886/899/924/943/977/1000），若后续 host 代码行位移需同步（typert 生成依赖）。

---

## 7. 主代理部署期注意点

1. **btw lib 拷贝目标**：`cp -r lib ~/.dsh/profiles/node_modules/@local/dsh-btw/`（lib 已重建：10 个 remote、client.js 315KB；拷贝前建议备份现有部署位 lib）。
2. **smoke 断言数**：`scripts/smoke-build.mjs` 与 `tests/package-contract.spec.ts` 现均为 **10**（原 7）：start/read/send/answer/cancel/close/setModel/readImage/listTree/listProject。
3. 部署顺序（审计 §8）：备份（btw lib / vision-adam index.js / host-apiproxy index.js）→ 拷 btw lib → 替换 vision-adam（`.workspace/deploy/vision-adam/lib/index.js`）→ 应用 patch（`.workspace/deploy/patches/dsh-host-apiproxy.sessions-prompt-transform.patch`，先验备份可逆）→ 更新 settings.yaml vision-adam 段（model deepseek-v4.1-flash / baseURL opencode / apiKeyEnv OPENCODE_GO_API_KEY / maxTokens 990000 保留）→ 重启 → 验收 6.4.a-f。
4. **勿往 `llm-pi-ai.providers.*.models` 添加 vision 模型条目**（事故教训红线）；vision-adam 段即识图配置。
5. 重启后 GUI 强刷（`__DSH_BOOT__` 中 @local/dsh-btw rev 变化即新 bundle 生效）；主会话发图经 patch 走 U-G-1 变换（日志为纯文本模板，符合验收 6.4.a）。
