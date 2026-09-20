# vision-adam lib/index.js — v2 变更说明（btw 插件升级）

> 本文件为 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-vision-adam/lib/index.js`（v0.2.0 部署副本，源已丢失）的**配置化改造产物**。
> 基线 = 部署副本全文（248 行，逐函数对照改造），依据 = `.workspace/btw-upgrade-impl-audit.md` §2.2 / U-H 与方案契约 v2 裁决 R1-4/R1-5。
> 部署方式：由主代理在部署期 `cp` 备份原文件后整体替换（见执行报告 §部署）。

## 变更清单（相对 v0.2.0 部署副本）

| # | 变更 | 说明 |
|---|---|---|
| 1 | **默认网关切换** `baseURL` → `https://opencode.ai/zen/go/v1`（原 `https://llmapi.roboscience.xyz/v1`） | R1-5；adam 网关 deepseek-v4-flash 不支持图片（假成功），opencode 网关 deepseek-v4.1-flash 实测真实看图成功 |
| 2 | **默认模型** `model` → `deepseek-v4.1-flash`（原 `gemini-3.6-flash`） | R1-4；probe §二/三 实测 ground truth 全对 |
| 3 | **默认凭据引用** `apiKeyEnv` → `OPENCODE_GO_API_KEY`（原 `ADAM_API_KEY`） | .credentials.yaml 实测存在该 ref |
| 4 | **默认 maxTokens** → 2000（原 1024） | probe 实测 completion 含 reasoning，≥2000 才够 |
| 5 | **Config 新增 2 字段**：`xApiKey: z.boolean().default(true)`、`sessionHeader: z.boolean().default(true)` | opencode 三头认证开关；显式 `false` 关闭对应头（回退 adam 网关时用） |
| 6 | **认证头改造**（`analyzeImageBytes`）：`authorization: Bearer <key>` + `x-api-key: <同 key>`（xApiKey 未关时）+ `x-opencode-session: <crypto.randomUUID()>`（sessionHeader 未关时）+ content-type + user-agent | probe §一 实测三头缺一不可；UUID 每次请求生成（`node:crypto` randomUUID） |
| 7 | **新增可复用导出**：`analyzeImageBytes(opts, apiKey, mediaType, base64, question, signal)`、`resolveOptions(config)`、`resolveApiKey(opts, ctx, signal)` | 现 `adamAnalyze` 纯函数化（本就收 base64，现正式导出）；`resolveOptions` 去掉未使用的 `ctx` 形参；供 btw 插件 U-D/U-G-1 运行时导入 |
| 8 | **新增常量/映射导出**：`IMAGE_TYPES`、`VIDEO_TYPES`、`DEFAULT_BASE_URL`、`DEFAULT_MODEL`、`DEFAULT_API_KEY_ENV`、`DEFAULT_MAX_TOKENS`、`DEFAULT_MAX_BYTES`、`DEFAULT_MAX_VIDEO_BYTES` | 审计 §2.2「export … IMAGE_TYPES, DEFAULT_*」 |
| 9 | **错误文案去 adam 化**：`adam image analysis error (HTTP …)` → `vision analysis error (HTTP …)`；`adam returned no text for …` → `vision model returned no text for …` | 仅措辞；错误语义/抛错类型不变（普通 Error，含网关 detail） |
| 10 | 保留项：`analyze_image` 工具注册（名称/描述/参数/output/render 逐字节不变）、`reasoning_content` 回退（:161-164 语义）、图片 `image_url` data URL 格式、视频 `video_url`（Zhipu 风格）格式、`maxBytes`/`maxVideoBytes` 限制、`apiKey` 字面覆盖、凭据解析链（字面 → credentials service → launch env）、`Config/VISION_ADAM_SETTINGS_NAMESPACE/apply/inject/name` 导出、settings 热加载（`installSettingsSection`） | 现有调用方（工具调用、settings 旧键 `{model,maxTokens}`）完全兼容 |

## 兼容性说明

- **旧 settings 形态** `vision-adam: {model, maxTokens}` 继续有效：显式值优先，其余字段回落新默认值（opencode/deepseek-v4.1-flash/OPENCODE_GO_API_KEY）。
- **现 settings.yaml 值** `{model: glm-5.3-flash, maxTokens: 100000}` 若不做任何更新：model 显式覆盖为 glm-5.3-flash，但 baseURL 默认已切 opencode —— glm-5.3-flash 是否在 opencode 网关可用未验证。**部署步骤必须同步更新 settings.yaml vision-adam 段**（`.workspace/deploy/settings-vision-adam.snippet.yaml`）。
- 若部署后仍走 adam 网关（用户自配 baseURL）：可显式 `xApiKey: false, sessionHeader: false` 关闭附加头（adam 忽略未知头，属未确认项 6，见审计 §9.6）。
- 导出签名变化：`resolveOptions(ctx, config)` → `resolveOptions(config)`（ctx 本未使用；仅内部 `apply` 调用点受影响，工具行为不变）。`adamAnalyze` 更名为 `analyzeImageBytes` 并导出（原未导出，无外部调用方）。

## 已知风险（如实标注）

1. 视频（`video_url` 格式）经 opencode 网关的可用性未实测（probe 仅测图片）；默认配置下视频分析失败属预期外风险，报错会透传网关消息。
2. `randomUUID` 依赖 `node:crypto`（Node ≥14.17），部署位 Node 版本满足（本环境 v22）。
3. 本产物仅做语法校验（node --check），**未做真实 API 冒烟**（网络调用不属于修订并执行档范围）；真实冒烟由部署后验收执行（审计 U-H 验收 2：v4f-test.png + 新默认配置 → 描述含「V4F-73/绿底/红方块」）。
