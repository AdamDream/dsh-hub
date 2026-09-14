# @deepseek-ai/dsh-session-board

跨会话状态板插件：在同一 git 仓库（按 cwd → `git rev-parse --git-common-dir` → realpath 归一分组）下并行工作的多个 DSH 会话，各自在 `turn/end` 时把零成本机械提取的目标 / 待办 / 最近文件 / 助手回复尾部快照，经文件锁 + 原子写落盘到 `~/.dsh/session-board/peers/`（7 天 retention 清理），并把其他活跃 peer 的单行摘要渲染为一块只读「peer board」注入到当前会话——支持默认的 runtime-context（systemPrompt context，内容不变不重复注入）与可选的 pre-step（每轮追加 user 消息）两种通道；另提供 `query_peers` 工具按关键字查询更完整的 peer 详情。全程无额外 LLM 调用，subagent 会话在发布侧被排除。

## 配置

| 字段 | 默认值 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关；关闭后不发布、不注入 |
| `maxBoardTokens` | `500` | 注入板 token 预算上界；字节硬限 = `maxBoardTokens×3 − 128`（默认 1372B），3B/token 为工程近似上界 |
| `injection` | `"runtime-context"` | 注入通道：`runtime-context`（systemPrompt context，retained 快照语义）或 `pre-step`（每轮追加，per-turn 幂等） |
| `activeWindowMinutes` | `30` | peer 活跃判定窗口（毫秒时间戳差 ≤ 窗口才进板）；过期条目仍可被 `query_peers` 以 `active:false` 返回 |
| `refreshIntervalSeconds` | `10` | 镜像周期刷新间隔（从组文件整体重建，避免残留过期 peer） |
| `queryLimit` | `5` | `query_peers` 默认返回条数上限（可被调用参数 `limit` 覆盖） |
| `queryDetailBytes` | `2048` | 存储级单字段截断（goal.objective / recentAssistantTail 等） |
| `queryTotalBytes` | `8192` | `query_peers` 详情渲染总字节预算 |
| `maxPeerEntries` | `8` | recentFiles / todos.items 的最大条数与环形缓冲容量 |

## 挂载方法

1. 安装：`bash install.sh`（拷到 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-session-board`）。
2. 在 `~/.dsh/profiles/web/cordis.patch.yml` 顶层数组追加条目：

```yaml
- insert:
    - id: session-status-board
      name: '@deepseek-ai/dsh-session-board'
```

3. 重启 dsh（`npx @deepseek-ai/dsh web`），新会话生效。后续按 id 覆盖配置，例如：`- id: session-status-board\n  config: { maxBoardTokens: 500 }`。

## 已知限制

- **3B/token 为工程近似上界**：字节硬截断以 UTF-8 字节为准（M1），并不对任意 tokenizer 提供硬保证；对 DeepSeek/GPT 系（含 CJK）保守。
- **快照累积靠 compaction 收敛**：`pre-step` 通道下 500 token 为单快照硬上限而非累计预算，板高频变化时快照线性累积，依赖会话 compaction 收敛（必要时可评估提高 compaction 触发或引入 snapshot replace）。
- 状态板为非权威账本：落盘不做 fsync，JSON 损坏按空骨架容忍，锁孤儿需按 `dsh-atomic-write` 语义由操作者清理。
- **repo 身份变更/组迁移**：分组键按 cwd → `git rev-parse --git-common-dir` → realpath 归一分组，带 TTL（默认 60s，模块常量，不入配置）再解析。当同一 cwd 下 `.git` 出现/消失或 worktree 迁移时，会话会在下一个 TTL 窗口内重新解析到新分组键；活跃 peer 在 TTL 窗口后收敛到新键并互相可见，切换窗口内可能出现短暂「新键文件为空」，属预期过渡态。旧键落盘文件不再被写入（retention 清理仅在 `upsertPeer` 锁内、即同键下一次发布时触发），故其孤儿条目不会被自动清理，而是永久留存；但组迁移后无会话再读旧键，属无害死文件（若干 KB），无需数据迁移，如需回收可手动删除 `~/.dsh/session-board/peers/<旧键哈希>.json`。
