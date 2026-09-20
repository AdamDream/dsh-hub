# 事故记录：web 模型选择器丢失 adam / opencode 模型（2026-09-12 16:15 发现，16:18 修复）

## 现象
用户重启 DSH 后，web 端模型选择器**无法选择 adam 与 opencode 的模型**（两者同时消失）；应用自身把
`agent-default-model` 回退写成 `provider: deepseek-official`。

## 根因（机制级，含源码定位与正反实验）
我在卡顿修复部署时，往 `~/.dsh/settings.yaml` 的 `llm-pi-ai.providers.opencode-go.models` **新增了一个模型条目**
`deepseek-v4.1-flash`（本意是给识图模型登记 0.99M 上限）。

- `opencode-go` 是 pi-ai **内置 catalog 路由**（38 条路由之一，16 个 catalog 模型）；
- 但这 16 个 catalog 模型的 wire api **并不一致**：`anthropic-messages` / `openai-completions` / `openai-responses` 三种；
- `sharedCatalogApi()`（`dsh-llm-pi-ai/lib/index.js:515-521`）**只有全部一致时才给出答案** → 此处返回 `undefined`；
- 而新增条目 `deepseek-v4.1-flash` **不在 catalog 中** → 源码 `resolveRouteModels`（:604-678）解析：
  `api = route.api ?? catalogModel.api ?? sharedCatalogApi()` → 三者皆空 → 抛
  `llm-pi-ai: provider "opencode-go" model "deepseek-v4.1-flash" needs an api; the installed catalog does not describe it, so set the route's api to the wire protocol its endpoint speaks`；
- `assertServiceable()`（:979-981，注册为 settings namespace 校验器）→ `resolveProfiles()`（:996）**抛错** →
  整段 `llm-pi-ai` 配置**不可服务** → 该插件的**所有 route**（adam 与 opencode-go）一起从模型选择器消失；
  `deepseek-official` 属 `dsh-llm-deepseek` 插件，故仍在（应用遂把默认模型回退到它）。

源码注释原文（:507-514）："A route whose shipped models disagree … has no such answer, so a model it does not describe must name its protocol at the route."——即：路由 catalog 协议不一致时，catalog 未描述的模型必须由**路由级** `api` 指定；而路由级 `api` 会强制覆盖全部模型（`request.api ?? base?.api ?? routeApi`），对 opencode-go 这种混合协议路由不可用。

## 正反实验（`.workspace/diag-piai-route.mjs`，复刻 resolveRouteModels + 真实 catalog）
```
部署后（含新增条目）：[INVALID] opencode-go (models=17, routeApi=(none)) -> model "deepseek-v4.1-flash" needs an api …
                      [OK] adam
移除该条目后：        [OK] opencode-go (models=16)  [OK] adam        == 全部 route 可服务 ==
```

## 修复（外科式，改动面最小）
1. 从 `llm-pi-ai.providers.opencode-go.models` **删除** `deepseek-v4.1-flash` 条目（备份：
   `deploy-lag/backup-20260912-160832/settings.yaml`、`deploy-lag/settings.yaml.bak-piai-incident-20260912-161840`）；
2. `agent-default-model` 还原为事故前值 `provider: adam / model: deepseek-v4-flash`（应用回退写入的
   `deepseek-official` 与 `reasoningEffort: max` 一并还原）；
3. **opencode `deepseek-v4.1-flash` 的 0.99M 上限改由 `vision-adam` 段承担**（`maxTokens: 990000`）——
   vision-adam 的 lib 直连 `https://opencode.ai/zen/go/v1`，`max_tokens` 取自该段，**无需** pi-ai 条目；
4. 用户要求的 adam `deepseek-v4-flash` 0.99M（`maxTokens: 990000`）保持不变。

修复后 live `settings.yaml` 与事故前备份 diff **仅剩两处**（adam 990000、vision-adam 段）；
`diag-piai-route.mjs` 复核：`[OK] opencode-go (16)` + `[OK] adam (46)` → 全部 route 可服务。

## 固化（防复发）
- `replay-lag-fix.sh` 的 `apply_settings` **已删除**"添加 opencode-go 模型条目"逻辑及其断言，并写入事故注释；
- `settings/settings.yaml.diff` 同步更新为只含 adam + vision-adam 两处改动；
- 修正后脚本在演习树**端到端重跑全绿**，产物经 `diag-piai-route.mjs` 回归：全部 route 可服务。

## 遗留（需用户裁决，未擅自处理）
1. `llm-deepseek: {}`：应用在 16:15:45 的自我修复写入中清空了其 `baseURL`（事故前为
   `https://opencode.ai/zen/v1/models`，该 URL 形似模型列表端点、疑似历史遗留）。
   **用户裁决：保持空段**（走 llm-deepseek 插件默认端点）。
2. adam `deepseek-v4-flash` 的 `maxTokens: 990000` 大于该 provider 的默认 `defaultContextWindow: 262144`。
   **用户裁决：补 `contextWindow: 1000000`**（与 opencode 侧同模型的 catalog 声明一致、匹配 0.99M 上限），
   已应用到 live settings 并固化进 `replay-lag-fix.sh`（apply + assert 同步），演习端到端全绿。
   最终值：`{contextWindow: 1000000, maxTokens: 990000}`。
3. **opencode 网关 max_tokens 硬上限（2026-09-12 真实 API 实测，测试结果优先）**：
   `deepseek-v4.1-flash` 的有效 max_tokens 范围 **[1, 393216]**，`990000` 会被拒绝
   （`invalid_request_error: Invalid max_tokens value, the valid range of max_tokens is [1, 393216]`）。
   **用户裁决：vision-adam 段 `maxTokens: 393216`**（已应用 live + 固化脚本/断言/diff）。
   同一实测中 **adam 网关接受 `max_tokens=990000`**（`finish_reason: stop`），adam 侧 0.99M 保持。
   真实识图冒烟（`v4f-test.png`，maxTokens 393216）：耗时 3.3s，正确识别
   "绿色背景、左上红色方块、白色文字 V4F-73"——全链路可用。
