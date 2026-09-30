# 0.2.0 迁移 — 协调者实测硬基线（所有轨道以此为准，不得凭印象覆盖）

采样时刻：2026-09-29（本轮）。全部为**本轮实跑**结果。

## 1. 目标版本
- npm dist-tags：`latest=0.1.7-rc.2`、`next=0.2.0-rc.1`、`alpha=0.1.7-alpha.2`。**不存在稳定 0.2.0**。
- GitHub releases 最新项：`dsh-v0.2.0-rc.1`，published `2026-09-28T12:36:21Z`（= 0.2.0 系列首个 RC）。
- 0.2.0-rc.1 CLI tarball sha256 `ceb66bebe8117044e05f6932deaca15daea6a1ae1d0cffad079e33895f10d216`。

## 2. 颠覆性发现：CLI 引导层零变化
`@deepseek-ai/dsh` 的 `lib/**` **在 0.1.1-rc.2 / 0.1.7-rc.2 / 0.2.0-rc.1 三个版本之间逐字节相同**（15 个文件 sha256 全等，见 `h-011-cli.txt`/`h-017-cli.txt`/`h-020-cli.txt`）。
⇒ 0.2.0 的全部差异都在**依赖包集合**，不在 CLI/profile-boot/plugin 管理代码。

## 3. 依赖集合差异（0.1.7-rc.2 → 0.2.0-rc.1）
- `@deepseek-ai/dsh` 直接依赖：81 → 82，**新增 `@deepseek-ai/dsh-experimental-schedule-bundle`**（对应 release note「自动化任务改由可选插件包提供」）。
- 包总数 503 → 530。
- 新增 `@deepseek-ai/*`（4）：`dsh-client-product-analytics`、`dsh-client-ui-settings-session-log`、`dsh-experimental-schedule-bundle`、`dsh-host-product-telemetry-otel`、`dsh-otel`（共 5，含 otel）。
- 移除：`@opentelemetry/exporter-logs-otlp-http`（0.220.0）。
- 新增第三方 HTTP 栈：`got@14.6.6` + `cacheable-lookup/cacheable-request/http2-wrapper/keyv/normalize-url/responselike/...`。
- 新增 musl 变体可选原生包：`@img/sharp-linuxmusl-x64`、`@img/sharp-libvips-linuxmusl-x64`。

## 4. 代码级真实改动面（关键）
对 `lib/` 目录做逐文件 sha256 对比（`churn-lib.mjs`）：**225 / 280 个包代码逐字节相同**，仅 **55 个包有真实代码改动**。
- 10 个包在**整包**（含 package.json）层面逐字节相同：`cordis`、`cordis-plugin-group/include/loader/timer`、`cosmokit`、`libreoffice-kit-wasm`、`node-addon-system`、`node-addon-system-linux-x64`、`schemastery`。
- 高改动包（`lib/` churn 降序，前 20）：`dsh-session-telemetry-otel 100%`、`dsh-web-search-deepseek 75%`、`dsh-session-telemetry 66.7%`、`dsh-config-editor 50%`、`dsh-util-values 50%`、`dsh-sandbox-windows-acl 42.9%`、`dsh-native-command 41.2%`、`dsh-terminal-bash 40%`、`dsh-session-log-deepseek 37.5%`、`dsh-client-ui-plugin-manager 33.3%`、`dsh-client-ui-workspace 33.3%`、`dsh-sandbox-local 33.3%`、`dsh-api-remotes 30%`、`dsh-client-ui-model-selection 30%`、`dsh-deepseek-account-platform 27.3%`、`dsh-client-ui-sidebar 25%`、`dsh-client-ui-settings-models 24%`、`dsh-client-ui-settings-account 22.5%`、`dsh-session 20.8%`、`dsh-agent-loop 20%`。
- 与本机定制直接相关的包的 `lib/` churn：`dsh-web-search-deepseek 75%`（本机有 web-search-sse 定制，**最高优先级**）、`dsh-session 20.8%`、`dsh-agent-loop 20%`、`dsh-workflow-ptc 20%`、`dsh-llm-deepseek 16%`、`dsh-client-ui-conversation 11.1%`、`dsh-agent-preset 33.3%`（package.json 层面）、`dsh-session-log-deepseek 37.5%`；而 `dsh-tool-subagent`、`dsh-settings`、`dsh-skill*`、`dsh-home-paths`、`dsh-tool-fs`、`dsh-client-modules`、`dsh-plugin-manager` 等 **`lib/` 零改动**（仅 package.json 版本号变化）。
- 注意：**多数「单文件差异」实为 `package.json` 里的版本号字符串**，不是代码改动；判定改动必须看 `lib/`。

## 5. 官方 release note（v0.2.0-rc.1，GitHub 原文要点）
- 体验：对话实时动画/用时/间距、失效图片重传可靠性、桌面更新提示、无标题会话显示「未命名」、**插件管理界面与内置插件清单布局/安装引导改善**、深色主题开关对比度、**Office 与 PDF 预览文字选区清晰度**、插件配置保存等待时间、创造模式插件开发指引、DeepSeek 账号模型免额外 Key 即可网页搜索。
- 修复：Windows 沙箱权限诊断技能、**工具调度异常后对话无法继续**、桌面弹窗避让标题栏、Windows 资源管理器打开、macOS 录音权限、Safari 流式刷新恢复、**部分 Linux 缺可选原生预构建包时 npm 安装失败**。
- 其他：**自动化任务改由可选插件包提供**；调整不同初始化路径的工作过程展示默认值。

## 6. 既有资产
- 0.1.1 现役：`~/.dsh/profiles/node_modules/@deepseek-ai/`（252 包，0.1.1-rc.2）+ nest 未见于 profile（CLI 另有嵌套树）。
- 0.1.7 隔离：`~/.npm-global-dsh017/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`（283 包，其中 272 个为 0.1.7-rc.2）。
- 0.2.0 已成功安装到工作区隔离 prefix：`.workspace/iso-020/npm-global/`（540MB，flat 布局，`node_modules/@deepseek-ai/` 直接可解析）。
