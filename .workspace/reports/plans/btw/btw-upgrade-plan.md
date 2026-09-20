# btw 插件升级方案 v2（需求变更后对齐契约）

> 状态：2026-09-12 用户变更需求，经 grill-me 两轮重新对齐（R0 保留项 + R1 新裁决）。事实与实测齐备（含 opencode deepseek-v4.1-flash 真实 API 验证）。进入三阶段闭环实现。
> 契约对象：审计 → 修订并执行 → 复核 各阶段子代理，全部路由 adam/deepseek-v4-flash。

## 0. 用户裁决记录（v2）

| # | 主题 | 裁决 |
|---|---|---|
| R1-1 | 图片输入范围 | **主会话输入框 + btw 侧聊对话框**均支持截图/图片粘贴导入（附件区：预览/移除/多图/随消息发送）；主壳粘贴原生已支持（零改动），btw 自建附件轨 |
| R1-2 | 图片处理机制 | **宿主侧转文本**：发送前把图片交给 vision-adam 分析，分析文本包装后拼进消息，对话模型只收文本——**无视对话模型图片门禁**，任何模型可用 |
| R1-3 | 主会话接入 | **宿主侧消息管线 hook**：拦截主会话含图用户消息，先 vision-adam 转文本再进模型；若 btw 插件面无 hook 点 → **patch 官方包**（agent-loop/host-apiproxy，本部署有 patch 先例） |
| R1-4 | 识图模型 | **opencode 网关 `deepseek-v4.1-flash`**（真实 API 实测：存在、支持图片、真实看图成功，非假成功） |
| R1-5 | vision-adam 改造 | **配置化**：settings 可配 baseURL/认证/模型 id，默认 opencode + deepseek-v4.1-flash；改部署副本前先备份 |
| R1-6 | 旧裁决废弃 | **全部废弃**：R0-8（发图走当前模型+报错引导）、R0-9（选择器加第 4 视觉选项）、settings 给模型加 input 声明 |
| R1-7 | 转文本时序 | **同步**：发送前等待 vision-adam 分析完成再进对话；**分析文本需包装**，让模型知道是用户文本的配套图片描述 |
| R1-8 | 失败降级 | vision-adam 调用失败 → **报错提示，不发送，可重试** |
| R1-9 | 文本格式 | 「用户附带了 N 张图片，以下为各图片的描述（vision-adam 生成）：[图片 1] … [图片 2] … 用户原文」逐图分段拼接 |
| R1-10 | 转录显示 | btw 转录区显示**原图缩略图（可点击大图）+ 分析文本** |
| R0-3 | 快速跳转 | 沿用：btw 抽屉内统一侧聊列表（主会话+当前会话树下子代理），点选一键切换，可折叠 |
| R0-4 | 全局实现 | 沿用：会话级列表+跳转；项目级「项目全部」tab（btw 抽屉内），点开激活并跳转继续对话 |
| R0-5 | 列表条目 | 沿用：标识 + 最后活跃时间 + 最后一条消息预览（截断） |

## 1. 实测结论（真实 API，测试结果优先，禁止用记忆/联网替代）

- adam 网关（llmapi.roboscience.xyz）：deepseek-v4-flash **不支持图片**（HTTP 200 假成功，图片降级为截断 base64 文本）；deepseek-v4-flash-vision-exp 报 `model_price_error`（账号未放行）；glm-5.3-flash **支持图片**（真实看图成功）。→ adam 网关不再作为识图通道。
- **opencode 网关（opencode.ai/zen/go/v1）：`deepseek-v4.1-flash` 存在（37 模型目录）且支持图片、真实看图成功**（v4f-test.png：绿底/红方块/V4F-73 全部识别正确；含图 prompt_tokens 243 vs 纯文本 38；finish_reason=stop；无 base64 降级）。**识图模型定稿 = deepseek-v4.1-flash（opencode）**。
- 认证（opencode，三头缺一不可）：`authorization: Bearer <OPENCODE_GO_API_KEY>` + `x-api-key: <同 key>` + `x-opencode-session: <随机 UUID>`；key 取 `~/.dsh/.credentials.yaml` 的 `OPENCODE_GO_API_KEY`。请求格式：OpenAI 兼容 `/chat/completions`，图片 `{"type":"image_url","image_url":{"url":"data:image/png;base64,…"}}`，`max_tokens` ≥ 2000。
- 证据：`.workspace/opencode-deepseek-v4-flash-probe.md`（+ oc_* 原始产物）；`.workspace/vision-flash-test.md`、`vision-exp-probe.md`、`glm53-flash-image-smoke.md`。
- 基线（改动前）：`pnpm run check` 本环境不可用（pnpm store SQLite 被沙箱挡）→ 用 `node_modules/.bin` 直接二进制；存量 typecheck 2 错：`side-chat-service.ts:309/:799`（`entry.modelSelection?.current.model` possibly undefined）→ 实现阶段一并修复。

## 2. 关键现状事实（审计证据，详见 .workspace/btw-upgrade-audit.md）

- btw 插件源码 `/home/CNS2026495165/dsh/dsh-btw/`；模型路由已落地（默认 deepseek-v4-flash、三选项、provider adam、UI 侧聊头部 select、随对话持久化）。
- DSH 多模态链路全链原生支持（ImageBlock → followup/inject → adapter base64）；主壳主输入框已原生支持粘贴图片（附件轨 + content parts）。
- vision-adam 插件：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js`（v0.2.0，**源已丢失仅部署副本**），defineTool + z.object Config {model,maxTokens}，直连网关 `/chat/completions`（硬编码 adam baseURL :24,:123-129），图片格式写死 OpenAI image_url data URL（:139），**不改配置结构则换网关需改代码**。
- 跳转数据源现成：host `listChildren/listDescendants` + `subagent/catalog`；client `subagentsByParent`/`openSubagent`；btw 索引 `~/.dsh/btw/index.json`；`handleSessionChange` parked/restore 可互跳。
- 项目身份：无 projectId；cwd 分组（`~/.dsh/sessions/--<cwd>--`）+ `sessionQuery.listSessions` + `session/title` + `workspaceTitleOf(cwd)`。
- 主壳：预构建 dist（dsh-web-frontend）无源码；`__DSH_BOOT__` 运行时注入；重启走 `npx @deepseek-ai/dsh web`；部署位 `~/.dsh/profiles/node_modules/@local/dsh-btw/`（真实目录拷贝）。
- 本部署有官方包 patch 先例（`~/dsh-upgrade-backup/patched-official-files.tgz`）。

## 3. 设计决策（v2 实现蓝图）

### A. btw 侧聊图片链路（真正缺口）
1. `src/shared/remote.ts`：`sendSideChatRequestSchema` 增加图片 parts（`{type:'image', mediaType, data(base64), name?}`，对齐主壳 PromptContentPart）；转录消息 schema 增加图片引用（attachmentId/mediaType/名称）供显示。
2. `src/host/side-chat-service.ts` `send()`（:684-720）：
   - 含图时：**同步**调 vision-adam 分析（机制见 C；复用插件导出或同款请求逻辑，单一配置源=settings vision-adam 段）→ 失败返回明确错误（客户端提示重试，不发送）；
   - 成功：按 R1-9 模板包装（N 张逐图分段 + 用户原文）→ `followup(createUserMessage({content:[{type:'text', text}]}))`（**text-only，天然无视门禁**）。
3. `transcript()`（:110-112）：支持图片块渲染（原图引用），分析文本作为普通 user 文本展示。
4. `src/client/SideChatSurface.tsx`：textarea onPaste 图片摄取 + 自建迷你附件轨（缩略图/删除/多图）；错误提示展示（分析失败重试引导）。
5. `src/client/view-store.ts`：draft 增加 images（预览 objectURL 生命周期）。
6. `src/client/controller.ts`：`send()` 带 images 走新协议；loading 态覆盖分析等待。
7. 模型选择器**保持三选项不变**（R1-6 废弃第 4 选项）。

### B. 主会话图片链路（宿主侧 hook）
- 拦截主会话含图用户消息 → 同步 vision-adam 转文本 → 同 R1-9 模板替换进消息 → 进对话模型。
- 挂点由审计确认：优先 btw 插件宿主面（如 parent agent 消息事件/请求管线可挂点）；不可行则产出**最小官方包 patch**（dsh-agent-loop / dsh-host-apiproxy 消息管线，交付为工作区补丁产物 + 应用说明，由主代理部署期应用）。
- 需同时满足：不拦截纯文本消息；多图逐张分析；失败时主会话消息不静默（报错或按审计建议，以 R1-8 精神为准）。

### C. vision-adam 插件配置化（部署产物）
- 改造部署副本 lib/index.js（先备份）：Config 扩展为可配 `model`（默认 `deepseek-v4.1-flash`）、`baseURL`（默认 `https://opencode.ai/zen/go/v1`）、`apiKeyEnv`（默认 `OPENCODE_GO_API_KEY`）、`maxTokens`、认证头（x-api-key 同 key、x-opencode-session 随机 UUID）；保留 analyze_image 工具注册与现有调用方兼容；**导出可复用的分析函数**供 btw/主会话使用（若运行时解析不可行，btw 同款逻辑并注释对齐）。
- 产物形态：因部署位在 ~/.dsh（工作区外），执行阶段把**新 lib 文件落到 `.workspace/deploy/vision-adam/lib/index.js`**（+ diff/patch 说明），由主代理部署期备份+替换。
- settings.yaml vision-adam 段最终形态由审计/执行按插件 Config schema 定稿（含兼容旧键）。

### D. 跳转列表 + 项目总览（沿用 R0-3/4/5）
- host 新增 remote：`sideChat/listTree(parentSessionId)`（会话树侧聊列表）与 `sideChat/listProject(parentSessionId)`（cwd 分组项目总览）；条目含 parentSessionId/label/childSessionId/lastActiveAt/preview。
- 接线：remote.ts schema、remote-descriptors.ts（7→9）、typert.host.ts members、client/remote.ts、smoke-build.mjs 断言 7→9。
- client：抽屉「当前会话 / 项目全部」视图；点击跳转（当前会话→park/restore；跨会话→sessions.open/openSubagent 后由 handleSessionChange 恢复）。

### E. 存量修复
- side-chat-service.ts:309/:799 TS18048（modelSelection.current possibly undefined）：正确类型修法（不改运行时语义）。

### F. 明确不做
- 不给任何模型加 `input:[text,image]` 声明（R1-6）；不把图片 content parts 发给对话模型；不动主壳前端。

## 4. 交付单元骨架（审计阶段细化）

- U-A btw 协议：send parts + 转录 image 引用（tsc 通过）
- U-B btw host send：vision-adam 同步分析 → R1-9 模板包装 → text followup；失败报错（不发送）
- U-C btw host transcript：图片块渲染
- U-D btw client：onPaste + 迷你附件轨 + viewStore images + loading/错误态
- U-E host remote listTree/listProject（descriptor/typert/remote/smoke 7→9）
- U-F 抽屉列表 UI + 项目全部 tab + 跳转
- U-G 主会话 hook：插件面挂点（在 btw 内）或官方包 patch 产物（`.workspace/deploy/`）
- U-H vision-adam 配置化新 lib 产物（`.workspace/deploy/vision-adam/lib/index.js` + 兼容说明）
- U-I 存量 typecheck 2 错修复
- U-J 测试：图片 send、包装模板、分析失败报错、listTree/listProject、跳转状态
- U-K 全量验证：lint/typecheck×3/vitest/tsdown/smoke/publint 全绿（直接二进制）

## 5. 部署与权限注意

- 工作区内（dsh-btw 源码、deploy 产物）子代理直接写；`~/.dsh/settings.yaml`、`~/.dsh/profiles/node_modules/@local/dsh-btw/`、vision-adam 部署副本**均在工作区外** → 部署步骤（备份+替换 vision-adam lib、改 settings、拷 btw lib、patch 官方包）由主代理执行（必要时提权，用户审批）；重启 3080 由用户按 Runbook 执行。

## 6. 验证 Runbook（最终交付）

```bash
# 1) 构建 + 全量验证（工作区内，直接二进制，勿用 pnpm）
cd /home/CNS2026495165/dsh/dsh-btw
node_modules/.bin/oxlint src tests tsdown.config.ts vitest.config.ts \
  && node_modules/.bin/tsc -p tsconfig.json \
  && node_modules/.bin/tsc -p tsconfig.client.json \
  && node_modules/.bin/tsc -p tsconfig.tests.json \
  && node_modules/.bin/vitest run \
  && node_modules/.bin/tsdown \
  && node scripts/smoke-build.mjs \
  && node_modules/.bin/publint --level error

# 2) 部署（主代理提权执行；或用户手动执行）
cp -r lib ~/.dsh/profiles/node_modules/@local/dsh-btw/          # btw 部署位
cp ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js ~/.dsh/backups/vision-adam.index.js.bak  # 备份
cp .workspace/deploy/vision-adam/lib/index.js ~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js  # 替换
# settings.yaml：vision-adam 段更新（model=deepseek-v4.1-flash / baseURL=opencode / apiKeyEnv=OPENCODE_GO_API_KEY 等，按插件 Config 定稿）
# （若产出官方包 patch）：备份 + 应用 .workspace/deploy/patches/ 下的补丁

# 3) 重启（用户执行）
npx @deepseek-ai/dsh web   # 等 3080 就绪

# 4) 验收
#   a. 主会话粘贴截图 → 发送 → 消息变成「…各图片的描述（vision-adam 生成）…」→ 模型基于描述回答
#   b. btw 侧聊粘贴图片 → 附件轨预览 → 发送 → 转录显示原图+分析文本 → 模型基于描述回答
#   c. vision-adam 分析失败（如断网）→ 报错不发送
#   d. 切任何对话模型（含 deepseek-v4-flash）发图均成功（无视门禁）
#   e. 子代理开侧聊 → 抽屉列表出现 → 一键跳转；「项目全部」tab 列出项目内侧聊 → 点击激活跳转
#   f. 重启后侧聊恢复（index.json lastActiveAt 更新）；vision-adam analyze_image 工具仍可用
```
