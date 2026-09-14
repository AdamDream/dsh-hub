# dsh-usage：DSH Web 内 token 用量统计插件（设计方案 v1）

> 状态：已与用户对齐（两轮问答定案）。目标 profile：**web2（@deepseek-ai/dsh 0.1.5-rc.2）**。
> 范围：**只统计 token 用量，不做费用**。数据源：dsh 会话 + cc（Claude Code）转录，走统一 data_source 抽象。

---

## 1. 目标

在 dsh web GUI 内（设置页卡片）提供跨会话、跨数据源的 token 用量查询面板：

- 总览：总请求数、输入/输出/缓存读/缓存写四桶 tokens、缓存命中率
- 按日趋势图、GitHub 风格热力图（面板内）
- 按模型 / 按项目(cwd) / 按日聚合表，会话明细下钻（复用现有会话统计条）
- 日期范围选择器、定时刷新（30–60s）+ 手动刷新
- 数据源：dsh 会话 + cc（Claude Code）转录，data_source 抽象可扩展

**明确不做**：费用/定价/余额。

## 2. 现状事实（本机实测）

| 项 | 事实 |
|---|---|
| 运行 profile | **web2**（0.1.5-rc.2），旧 web（0.1.1-rc.2）保留作回退；@local 插件装在 `~/.dsh/profiles/web2/node_modules/@local/` |
| dsh 数据 | `~/.dsh/sessions/**/session.jsonl.zstd`；每条 step 有 `assistant/chunk{type:'usage'}`，usage 形如 `{inputTokens, outputTokens, cacheReadTokens}`；`request/header{config:{provider,model}}`；首行 `session{createdAt,cwd}`。全量可解析（实测 47,811 调用、4.78B tokens） |
| cc 数据 | `~/.claude/projects/**/*.jsonl`；assistant 消息 `message.usage{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}`，`message.model`；主线程与 `subagents/` 子代理分离。全量实测 41,071 消息 |
| tokenUsage 投影 | 存在（聊天统计条在用），但本机 0.1.5 的投影缓存 `session_projcache.json` 中 tokenUsage 值全空 → **不依赖**，从日志折叠 |
| zstd | dsh 0.1.5 用 **`node:zlib` 原生 zstd**（`zstdDecompressSync` 等）→ 插件零额外依赖 |
| SQLite | `node:sqlite`（0.1.5 的 session-query-sqlite 已在用） |
| GUI 扩展点 | 设置页卡片：`ctx.slots.inject('settings.plugin.item', …)`（官方 cookbook）；宿主配置：`ctx.settings.installSection()`；HTTP/RPC：`ctx.webServer.register()`（0.1.5 风格，参考 taste 移植记录 `register(ctx,…)+inject webServer`） |
| 客户端 | 0.1.5 用 `client-store`/`defineStore`（参考 btw/wallpaper 移植记录）；图表库 ECharts（定案） |

## 3. 架构总览

```
┌─ 数据源 ─────────────────────────────┐
│ dsh: ~/.dsh/sessions/**/*.zstd (v0-v3)│
│ cc : ~/.claude/projects/**/*.jsonl    │
└──────────────┬───────────────────────┘
               │ 增量扫描（字节游标/指纹/seq）
┌──────────────▼───────────────────────┐
│ ingest 服务（插件宿主侧）               │
│ 折叠 usage → SQLite 统一事实表 + 日聚合 │
└──────────────┬───────────────────────┘
               │ RPC（Typert/webServer.register）
┌──────────────▼───────────────────────┐
│ 客户端设置页卡片（slots.plugin.item）   │
│ Hero 卡 + ECharts 趋势/热力图 + Tabs   │
│ 会话下钻 → 复用现有 tokenUsage 统计条   │
└──────────────────────────────────────┘
```

## 4. 数据模型（插件自带 SQLite，如 `~/.dsh/storages/usage/usage.db`）

```sql
-- 统一事实表（双源）
CREATE TABLE usage_events (
  id INTEGER PRIMARY KEY,
  data_source TEXT NOT NULL,          -- 'dsh' | 'cc'
  session_id TEXT NOT NULL,           -- dsh: session-uuid；cc: 转录所属 session id
  ts INTEGER NOT NULL,                -- 事件毫秒时间戳
  model TEXT,                         -- dsh: request/header.model；cc: message.model
  provider TEXT,                      -- dsh: adam/opencode-go；cc: 'claude'
  project TEXT,                       -- dsh: cwd；cc: 转录项目路径（去 -home- 前缀）
  turn INTEGER, step INTEGER,         -- cc 源可为 NULL
  input_tokens INTEGER, output_tokens INTEGER,
  cache_read_tokens INTEGER, cache_write_tokens INTEGER,  -- cc 的 cache_creation→cache_write
  UNIQUE(data_source, session_id, turn, step)             -- 去重键
);
CREATE INDEX idx_events_ts ON usage_events(ts);
CREATE INDEX idx_events_model ON usage_events(model);
CREATE INDEX idx_events_project ON usage_events(project);

-- 日聚合（查询加速）
CREATE TABLE usage_daily (
  day TEXT, data_source TEXT, model TEXT, project TEXT,
  requests INTEGER, input_tokens INTEGER, output_tokens INTEGER,
  cache_read_tokens INTEGER, cache_write_tokens INTEGER,
  PRIMARY KEY(day, data_source, model, project)
);

-- 增量同步状态
CREATE TABLE sync_state (
  source TEXT PRIMARY KEY,      -- 'dsh:<session_id>' | 'cc:<file>'
  mtime INTEGER, size INTEGER, fingerprint TEXT, last_seq INTEGER
);
```

## 5. 采集链路

**dsh 源**（每 30–60s 定时 + 手动触发）：
1. 枚举 `~/.dsh/sessions/**/session.jsonl.zstd`；按 mtime/size 过滤已同步会话。
2. `zstdDecompressSync` 解压 → 逐行解析；按 `last_seq` 续传（增量只读新增行）。
3. 折叠：`session{createdAt,cwd}`、`request/header{provider,model}`、`assistant/chunk{usage}`；每步一行写入 usage_events。
4. 容错：解析失败/格式变化 → 跳过该会话并记 sync_state 指纹，下轮重试；库可整体重建（幂等）。

**cc 源**（同节奏）：
1. 枚举 `~/.claude/projects/**/*.jsonl`（含 subagents/）；字节游标 + mtime/大小指纹。
2. 逐行取 `message.usage` + `message.model` + `timestamp` + 所属 session/project。
3. 主线程与子代理同表（project 相同、session_id 区分）；可选加 `is_subagent` 标记列（v1 合并展示，后续可加开关）。

**统计口径（面板透明展示口径说明）**：
- 请求数 = 含 usage 的 step（dsh）/ 含 usage 的 assistant 消息（cc）
- 输入 = 未缓存输入（uncachedInputTokens / input_tokens）
- 总 tokens = 输入 + 输出 + 缓存读 + 缓存写（四桶和）
- 缓存命中率 = cacheRead / (uncachedInput + cacheRead)（dsh 语义；cc 同理含 cache_creation）
- 项目 = dsh cwd / cc 转录项目目录

## 6. 查询 API（宿主侧 RPC，0.1.5 `webServer.register` 风格）

| 方法 | 返回 |
|---|---|
| `usage.summary {from?, to?, dataSources?}` | 请求数、四桶 tokens、缓存命中率 |
| `usage.timeseries {granularity:'day', from, to}` | 按日四桶序列（趋势图数据） |
| `usage.heatmap {year?}` | 按日总量网格（热力图数据） |
| `usage.byModel / usage.byProject / usage.byDay {range}` | 各维度聚合表 |
| `usage.sessions {project?, model?, range}` | 会话列表（session_id、总量、ts）→ 下钻跳现有会话统计条 |

## 7. GUI（设置页卡片 `settings.plugin.item`，命名空间 `dsh-usage`）

- **Hero 卡**：总请求数 / 输入 / 输出 / 缓存读 / 缓存写 / 缓存命中率；数据源切换（dsh / cc / 全部）
- **趋势图**：ECharts 面积/柱状，按日，可切换四桶与数据源；日期范围选择器
- **热力图**：GitHub 风格 按日×周 网格（面板内一块）
- **Tabs**：按模型 / 按项目 / 按日 / 会话明细（表格 + 日期筛选 + 刷新间隔 0/5/30/60s + 手动刷新）
- **下钻**：会话行 → 打开该会话视图，统计条已展示其 tokenUsage（复用，不重复造）

## 8. 关键决策与理由

| 决策 | 理由 |
|---|---|
| 从会话日志折叠，而非 tokenUsage 投影 | 本机实测投影缓存 tokenUsage 为空，不可靠；日志折叠已验证（全量 47,811 调用一致） |
| 直接解析 cc 转录，而非 cc-switch.db | cc-switch.db 仅覆盖 ~1/3 请求且随其版本改 schema；转录最全且与 dsh 侧架构对称 |
| 自带 SQLite + 日聚合双层 | 跨会话聚合/热力图/日期筛选快；学 cc-switch 明细+rollup 防双算（UNIQUE 去重键） |
| node:zlib zstd + node:sqlite | 0.1.5 同款，零新增依赖 |
| 不依赖官方投影缓存存储 | 该缓存当前不可靠（见上），且官方升级可能改格式 |
| 客户端复用现有会话统计条下钻 | 不重复造单会话展示 |

## 9. 落地路径

- **P0 预检冒烟（半天）**：
  1. 最小解析脚本：对当前 0.1.5 会话日志 + cc 转录抽 usage，与既有手工聚合（47,811 / 41,071）对账；
  2. 验证 `node:zlib` zstd + `node:sqlite` 在本机 Node 可用；
  3. 验证 @local 插件在 web2 的安装方式（参考 btw：拷贝进 `web2/node_modules/@local/dsh-usage` + cordis.patch.yml insert）与 0.1.5 `installSection`/`webServer.register`/`slots.inject` 用法（参考 taste/btw 移植记录）。
- **P1 插件实现（1–2 天）**：ingest 服务 + SQLite + RPC + 客户端设置页卡片（ECharts），装入 web2，重启生效。
- **P2 增强（可选）**：cc 子代理开关、CSV 导出、热力图细化、会话明细页。

**验收标准**：聚合数与手工对账误差 <1%；冷启动全量扫描 ≤ 2 分钟；增量扫描 ≤ 2s；GUI 各视图/筛选/下钻可用；重启 web2 后插件正常加载且不干扰现有 btw/wallpaper/taste。

## 10. 风险与开放问题

- 会话日志格式版本（v0–v3）与未来升级：解析按 usage 键通用提取 + 指纹容错重扫；升级 web2 需重装/保留 @local 插件（记录在案）。
- cc 转录格式随 Claude Code 版本变化：增量同步失败自动重扫该文件。
- 浏览器认证（0.1.5 默认 token）不影响插件。
- 开放：热力图按日口径（自然日 UTC vs 本地时区——默认本地时区，可配）。
