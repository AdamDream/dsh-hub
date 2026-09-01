# dsh-plugins

个人 DeepSeek Harness（DSH）插件与扩展工作区。每个子目录是一个独立成果，
由不同 DSH 会话并行开发（会话状态板 `dsh-session-board` 提供跨会话进度协调）。

## 目录

| 目录 | 说明 | 状态 |
|---|---|---|
| `session-board/` | **dsh-session-board** 会话状态板插件：同 repo（worktree 归一）会话间轮末自动发布状态、轮初注入 ≤500 token 极简状态板 + `query_peers` 工具。`dsh-session-board/` 子目录为插件本体，`PROPOSAL.md`/`AUDIT.md`/`ADJUDICATION-NOTES.md` 为设计-审计-裁决文档链 | 已实现并安装挂载 |
| `dsh-taste/` | **dsh-taste** 本地偏好学习插件（pi-taste 移植） | 见目录内文档 |
| `pi-taste-analysis/` | pi-taste 源码分析与 DSH 架构调研文档 | 已完成 |

## 安装与挂载（通用模式）

1. `bash <插件目录>/install.sh` —— 拷入 `~/.dsh/profiles/node_modules/@deepseek-ai/`（扁平回退目录，peer 依赖可解析）；
2. `~/.dsh/profiles/web/cordis.patch.yml` 顶层加 `- insert: [{ id: <插件id>, name: '<包名>' }]`；
3. 重启 DSH 生效。

> 本仓库当前仅本地（仓库名预留 **dsh-plugins**）；接远程时：
> `git remote add origin git@github.com:AdamDream/dsh-plugins.git && git push -u origin main`
> （GitHub SSH 已验证可用；需先在网页上创建同名 Private 空仓）
