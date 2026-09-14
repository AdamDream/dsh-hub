# dsh-hub — 高度个人定制化的 DSH 插件工作区

> ⚠️ **本仓库是高度个人定制化版本**，不是通用发行版。
> 它是为**作者本人这台机器的 DSH 部署**逐项调优的成果：包含大量针对本机
> profile 布局、符号链接农场、特定网关（adam / opencode 中转）与个人工作流的
> 定制与补丁。**直接 clone 到别的环境大概率不能开箱即用**，部署前务必先审计
> 本文件与各目录文档。

## 仓库内容

| 目录 | 说明 |
|---|---|
| `dsh-btw/` | btw 侧边对话插件（@local/dsh-btw）：图片经 vision-adam 转文本、侧聊跳转列表、项目总览、面板对齐 subagent 会话呈现（运行横幅/工具行） |
| `dsh-taste/` | taste 偏好记忆插件（@deepseek-ai/dsh-taste，本地 fork/port） |
| `dsh-usage/` | API 用量统计插件（@local/dsh-usage）：面积/柱状/热力图（自绘 SVG，蓝单色系） |
| `dsh-wallpaper-local/` | 壁纸插件本地 fork（@local/dsh-wallpaper，静态图版） |
| `session-board/` | 会话状态看板（@deepseek-ai/dsh-session-board） |
| `pi-taste-analysis/` | taste 条目分析工具与 pi-taste 调研文档 |
| `cc-switch-src/` | 第三方 vendored 项目（cc-switch，非自研） |
| `.workspace/` | 审计/诊断/部署产物与证据（探针、Runbook、事故记录、重放脚本等） |

## 运行时依赖（不在本仓库，需本机具备）

- DSH 本体（当前 0.1.1-rc.2，全局安装于 `~/.npm-global/...`；`~/.dsh/profiles/*` 为符号链接农场）
- **API 密钥全部在 `~/.dsh/.credentials.yaml`**（`ADAM_API_KEY` / `OPENCODE_GO_API_KEY` / `DEEPSEEK_API_KEY`），**永不入库**；settings.yaml 只存 `apiKeyEnv` 环境变量名
- 网关：adam（llmapi.roboscience.xyz）+ opencode 中转（opencode.ai/zen/go/v1，web 搜索与识图 vision-adam 走此）

## 官方包补丁（重装全局树后需重放）

部署位直接修改过以下官方包（重放脚本：`.workspace/deploy-lag/replay-lag-fix.sh`，含备份/应用/校验/回滚）：

- `dsh-agent-loop`：②b 子代理非流式（isSubagent，防事件风暴）
- `dsh-host-apiproxy`：`session/prompt-image-transform` 图片变换 waterfall + SSE mux 订阅过滤 + FrameQueue 有界（应答帧永不丢弃）
- `dsh-subagent`：仅 materialize 不投递的冷恢复公开方法（btw 打开冷子代理会话）
- `dsh-client-ui-subagent` / `dsh-web-search-deepseek`：tok/s 显示、x-opencode-session 头

## 方法论

- 两阶段闭环（审计 → 修订执行复核一体），详见本机 `~/.dsh/AGENTS.md`（不入库）
- 模型路由：workflow/subagent/btw 统一 `adam/deepseek-v4-flash`；识图 = opencode `deepseek-v4.1-flash`（网关实测 max_tokens 上限 393216）

## 部署前必读

1. 先读 `.workspace/` 下对应 Runbook（如 `btw-v2-runbook.md`、`combined-restore-runbook.md`）
2. 审计各插件与补丁是否适配你的 DSH 版本
3. 切勿把 `~/.dsh` 下的 settings/credentials/会话数据带入任何环境
