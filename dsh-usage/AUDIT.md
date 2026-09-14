# dsh-usage 审计报告（AUDIT）

> 阶段：三阶段闭环 · 审计（deepseek-v4-flash）
> 日期：2026-09-12（环境实测于当日）
> 目标：为 `@local/dsh-usage`（dsh web 内 token 用量统计，dsh+cc 双源，不计费）产出「修订方案 + 细粒度交付单元」
> 审计方式：全部结论来自真实文件/实测（见 A 节证据），禁止凭记忆；无法验证项显式标注。
> 裁决：**needs-revision** —— DESIGN.md 架构成立、数据形态描述大体准确，但存在 1 处格式关键错误（多帧 zstd）、1 处去重键失效（cc NULL）、若干口径/API 细节需修正，均以交付单元落实，不修改 DESIGN.md 本身（发现保留在本报告 B 节）。

---

## A. 环境预检（结论 + 证据）

### A1. Node 运行时能力（node v22.23.2）

实测（`node -e`）：

```
zstdDecompressSync: function
createZstdDecompress: function
zstdCompressSync: function
node:sqlite OK: [ 'DatabaseSync', 'StatementSync', 'constants', 'backup' ]
```

- `node:zlib` 原生 zstd 三件套齐全（`zstdDecompressSync` / `createZstdDecompress` / `zstdCompressSync`）。
- `node:sqlite` 可用（`DatabaseSync` 等），带 ExperimentalWarning 但不影响使用（0.1.5 宿主同款用法，见 A6）。
- **结论：DESIGN §2 的「node:zlib zstd + node:sqlite → 插件零额外依赖」成立。**
- ⚠️ 但 `zstdDecompressSync` 只能解**单帧**（见 A2 关键发现），不能直接整文件解压。

### A2. 0.1.5 会话日志格式（真实解压 1,656 个文件验证）

取 `~/.dsh/sessions/**/session.jsonl.zstd`，用 node 脚本（node:zlib）实测。

**关键发现（DESIGN 未描述）——文件是多帧 zstd 拼接容器：**
- 实测 22.8MB 的 `session-6a7367fe-…/session.jsonl.zstd`：`zstdDecompressSync(整文件)` 只解出 **190 字节**（第 1 帧，即 session 头），流式 `createZstdDecompress` 同样停在首帧。
- 用帧结构扫描（解析 zstd 帧头/块头，`0x28B52FFD` magic）得到 **69,229 个完整帧**，逐帧解压共 51.7MB / 82,430 行 JSON，parse errors = 0。
- 宿主侧同款实现：`@deepseek-ai/dsh-session-persistence-jsonl` 的 `scanZstdFrames(buffer)`（结构扫描出 `{start,end}` 帧范围）→ 逐帧 `zstdDecompressSync(subarray(start,end))`；追加写入是「每批 durable 事件独立压缩成一帧再拼接」（`compressZstdFrame`，带 checksumFlag）。写入中的**撕裂末帧**（torn frame）被结构扫描识别并跳过。
- **推论：dsh 源解析必须「结构扫描找完整帧 → 逐帧解压 → 拼接文本 → 逐行 JSON」；不能对整文件单次解压。** 字节游标续传以「最后一个完整帧的结束偏移」为准。

**记录类型（0.1.5 真实形态，与 DESIGN §2 的差异见 B 节）：**
- 顶级类型统一为 `{type, seq, time, data}`（部分带 `surfaceOp`），`time` 为毫秒时间戳。
- 实测单会话记录类型全集：`session`、`turn/start`、`step/start`、`user/message`、`request/header`、`request/context`、`assistant/chunk`、`reasoning-chunks`、`tool-call-chunks`、`text-chunks`、`assistant/message`、`tool/call`、`tool/result`、`step/end`、`turn/end`、`compaction/summary`、`session/title`、`session/title-llm-request`、`llm/retry`、`llm/retry-started`、`web/deepseek-search-llm-request`、`goal/change`、`todo/write`、`approval/*`、`sandbox/mode`、`permission/preset`、`approval/policy`、`agent/inbox/spliced`、`command/*`、`tool-workflow/*`、`session/end-seed`、`subagent/descriptor` 等。
- 首行 `session`：`{type:'session', version:0, id, createdAt, cwd, parentSession?, origin?, delegationDepth, agentPreset}` ✓（与 DESIGN 一致；cwd 恒在，`_no-cwd` 目录内会话 cwd 仍存在）。
- `request/header`：**非每请求一条**（单会话 866 个 step、871 个 usage，request/header 仅 24 条，出现在 provider/model/系统提示变更时）；形态 `data.header.config.{provider, model}`（DESIGN 写 `request/header{config:{provider,model}}`，实际多一层 `data.header.`）。**归属需「last-seen 归属」：按 seq 顺序把 usage 归到最近一次 request/header。** 实测单会话 provider/model 取值：`adam/glm-5.3`、`adam/deepseek-v4-pro`、`adam/deepseek-v4-flash`。
- usage 承载记录（真实形态，均为 `data` 层）：
  - `assistant/chunk`：`data.chunk.type === 'usage'` → `data.chunk.usage = {inputTokens, outputTokens, cacheReadTokens}`（DESIGN 的 `assistant/chunk{type:'usage'}` ✓；无 cacheWrite、无 uncached 字段）。
  - `assistant/message`：`data.usage = {inputTokens, outputTokens, cacheReadTokens}` —— 与同 (turn,step) 的 usage chunk **数值相同**，属重复记录（chunk 871 条 vs message 859 条）。
  - chunk 类型全集：`block-start / reasoning-delta / tool-call-delta / block-end / usage / finish / text-delta`。
  - `compaction/summary` 也带 `data.usage`（整段压缩聚合，**必须排除，否则双计**）。
- 旧会话（8 月、0.1.1 时代，如 `6d8324ff-…`）为**同构顶级类型**，usage chunk 形态一致（实测 `01e4316b-…/session.jsonl.zstd` 的 usage chunk 与 0.1.5 完全相同）→ 解析器无需分版本。

**全量对账（本审计实测，冷启动 30.2s，1,656 个文件，parse errors = 0）：**

| 口径 | 数量 |
|---|---|
| 去重(会话\|turn\|step) 的 usage chunk 事件 | 45,007 |
| 去重(会话\|turn\|step) 的 assistant/message usage | 47,752 |
| 并集（chunk ∪ message） | 47,846 |
| 输入桶（chunk 口径，未缓存） | 446,312,068 |
| 输出桶 | 56,014,760 |
| 缓存读桶 | 3,981,531,504 |
| 无 usage 的会话（错误/中断会话） | 116 |

- DESIGN §2 声称「47,811 调用、4.78B tokens」：47,811 ≈ message 级口径（47,752，差 59 个，0.1%）；4.78B ≈ input+output 之和（446M+56M=502M 仅未缓存输入+输出，不含 3.98B 缓存读 → 全口径 4.48B 与 4.78B 同量级）。**结论：DESIGN 数字是历史某时刻的口径，插件应以真实全量扫描为准；交付单元按「chunk 优先、message 兜底、并集去重」实现（见 D 节 U06）。**

### A3. cc（Claude Code）转录格式

取 `~/.claude/projects/**/*.jsonl`（主线程 + `subagents/agent-*.jsonl`）实测：

- 目录编码：`-home-CNS2026495165-Dexterous-Hand-23Dof/` 对应 `/home/CNS2026495165/Dexterous_Hand_23Dof`（`_`→`-`）；但每条记录带权威 `cwd` 字段（含子代理文件），**项目归属直接用 `cwd`，目录名解码仅作兜底**（`cwd` 缺失时按 `-home-` 前缀逆编码）。
- 记录形态：`{type:'assistant', message:{type:'message', model, usage, role, id:'chatcmpl-…'}, uuid, timestamp:'2026-09-07T04:03:28.141Z', session_id / sessionId, cwd, userType, entrypoint, version:'2.1.263', isSidechain?, agentId?, …}`。
- `message.usage` 字段名（与 DESIGN 一致）：`input_tokens / output_tokens / cache_read_input_tokens / cache_creation_input_tokens`（另有 output_tokens_details、cache_creation 等扩展字段，可忽略）。
- 会话归属：主线程文件 `sessionId`（= 顶层字段，也与文件名 uuid 相同）；子代理文件 `sessionId` = 父会话 uuid、`isSidechain:true`、`agentId` 在文件名 `agent-<id>.jsonl`。
- 全量对账：**41,071 条带 usage 的 assistant 消息，与 DESIGN §2 的 41,071 完全一致** ✓。
- 口径关键实测：**cc 的 `input_tokens` 含缓存**（缓存读+创建占 input_tokens 之和的 35.5%；全库无一例 cache 之和 > input_tokens）。故「未缓存输入」需 `input_tokens − cache_read − cache_creation`（clamp ≥ 0），不能直接拿 `input_tokens` 当未缓存（详见 B3）。

### A4. @local 安装机制与客户端 bundle 构建

- `~/.dsh/profiles/web2/node_modules/@local/dsh-btw` 是**目录拷贝**（`readlink` 验证非符号链接），内容为**已构建产物**：`lib/`（index.js、client.js、typert.*、d.ts）+ `package.json` + `cordis.patch.yml` + README/LICENSE 等。源码仓库 `/home/CNS2026495165/dsh/dsh-btw` 另有 `src/`、`tests/`、`tsdown.config.ts`（构建工具 tsdown，工作区无 tsdown 安装，未重跑构建）。
- `package.json` 关键声明（dsh-btw 实样）：
  - `main: "lib/index.js"`、`exports: {".": …, "./client": "./lib/client.js", "./cordis.patch.yml": …, "./package.json": …}`；
  - `"dsh": {"bundle": {"patch": "./cordis.patch.yml"}, "client": {"inject": [客户端模块包名清单], "platform": "web"}}`；
  - `engines: {"node": "^22.19.0 || >=24.0.0"}`、`license: "MIT"`、`type: "module"`。
- 客户端 bundle 机制（读宿主源码确认，非推测）：
  - `@deepseek-ai/dsh-client-modules` 在启动时扫描 Loader 条目中声明 `dsh.client.platform === 'web'` 的包，直接读取其 `exports['./client']` 指向的**已构建文件**（`lib/client.js`），内容哈希后组入 `window.__DSH_BOOT__` 引导图，经 `/plugins/??…&rev=…` combo 路由下发并注入 index。**没有运行时编译；bundle 缺失 = 启动期 loud error（提示 "run pnpm run build before launch"）。**
  - 客户端产物必须是 **lazy-CJS factory artifact**：`window.__ModuleLoader__.load({id: '<pkg>', factory: (require) => { …; return module.exports; }})`，内部 `require('react')` 等（btw 客户端仅 require `react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives`）。
  - **两种产出方式均验证可行**：(a) tsdown 构建（btw）；(b) **手写 bundle**（`@deepseek-ai/dsh-taste` 的 lib/client.js 就是手写 ModuleLoader 包装 + 手写 CSS/locale，注释明确 "handwritten, build-free client bundle"，已在本 profile 稳定运行）。官方 cookbook 亦明言「No published preset exposes this package, so a package outside this repository has to reproduce the same output format itself」。
  - 宿主 RPC 通道（taste 实测）：`ctx.connection.rpc.handle('/usage', handler, {authority:'loopback'})`（handler 形如 `(endpoint, payload, signal) => ({ok, value} | {ok, error})`）；客户端 `ctx.connection.rpc.call('/usage', endpoint, payload)`。宿主侧插件声明 `inject: ['connection']`。
  - 客户端注入服务以 bundle 内 `exports.inject = ['slots','connection','sessions',…]` 声明（cordis 按此放行 `ctx.<svc>`）；`settings.plugin.item` 为 keyed slot，**key 必须等于宿主 settings 服务注册的 namespace**（cookbook + `dsh-client-ui-settings-plugins` 源码双重确认：Plugins 页按 `settingsScope.describe()` 的 namespace 分发 key，无 namespace 服务则不渲染卡片）。
  - 定时轮询：**静态 bundle 内是普通浏览器作用域**（闭包陷阱只属于 cordis-client-runner 的动态包路径），taste 在 `useEffect` 里直接 `setInterval` 轮询 10s 即为此先例 → 客户端刷新轮询照抄该模式。
- **结论：照抄 btw/taste 的「构建产物目录拷贝」形态；客户端采用 taste 的「手写、免构建」方式（零构建链），宿主侧采用 taste 的「手写 ESM」方式（lib/*.js 直接手写，无编译步骤）。** 安装 = 把 `dsh-usage/` 的 `lib/ + package.json + cordis.patch.yml + LICENSE + README.md` 拷贝进 `web2/node_modules/@local/dsh-usage` + 在 `web2/cordis.patch.yml` 加 insert 条目（见 D 节 U11/U12）。

### A5. 图表库与联网能力

- `web2/node_modules` 与 `/home/CNS2026495165/dsh/node_modules`：**均无** echarts / recharts / esbuild（`ls -d` 验证）；工作区亦无 tsdown。
- 联网实测：`npm ping` PONG（466ms）；`npm view echarts version --cache <可写目录>` 与 `pnpm view echarts version` 均返回 **6.1.0** → **registry 可达、可在线安装**（但注意 ~/.npm 缓存目录在我沙箱只读，需指定可写 cache；宿主无此限制）。
- **决策（落死）：客户端图表采用「零新增依赖、自绘 SVG」的确定性方案**（面积趋势图 / 柱状图 / GitHub 风格热力图全部用原生 SVG + React 渲染）。理由：(1) 审计规则明确「优先零新增依赖」；(2) 引入 echarts 需将其 alwaysBundle 进 client.js（~1MB 且未来重构建依赖网络），或改造模块图（echarts 不在 boot graph，无法 external）；(3) 手写 SVG 使整个插件**完全免构建、离线可用**，与 taste 的 build-free 先例一致；(4) 统计数据规模（按日四桶 + 热力网格）完全在 SVG 手绘能力内。交付单元 U10 落死：`lib/client.js` 内实现 `charts.js`（SVG 生成函数），禁止引入任何图表库。

### A6. 宿主侧 SQLite 与落库路径

- 0.1.5 宿主用法（`dsh-session-query-sqlite/lib/index.js` 实读）：
  - `await import("node:sqlite")`（动态导入）→ `new DatabaseSync(path)`；
  - 建库：`mkdir(dirname(path), {recursive:true, mode:0o700})` + `open(path,'wx',0o600)` 创建文件 → `PRAGMA journal_mode=WAL` → `db.exec(CREATE TABLE … STRICT)`；
  - 版本管理：`PRAGMA application_id`（防他库误开）+ `PRAGMA user_version`（schema 迁移）；
  - 操作串行化（tail-promise 队列），读 `db.prepare(...).get()/.all()`、写 `.run()`。
- 落库路径：`~/.dsh/storages/` **存在且宿主持续写入**（`session_projcache.json`、`workspace.json` 今日 11:02 仍在更新；`~/.dsh/sessions` 每轮都在追加）→ 宿主进程对 `~/.dsh` 可写。
- ⚠️ 我的审计沙箱（workspace-write）对 `~/.dsh` 报 `只读文件系统`（EROFS，`mkdir ~/.dsh/storages/usage` 失败）——**这是沙箱隔离，不是宿主限制**（宿主进程同一路径正常写入）。因此「插件运行时在 `~/.dsh/storages/usage/usage.db` 建库」**无法在本沙箱直接实测**，结论依据宿主既有写入行为推断为可行，并按 DESIGN 建议 + 防御性回退链落实：`dshHomePath('storages','usage','usage.db')`（`@deepseek-ai/dsh-home-paths` 的 `dshHomePath(...)` 已确认存在，解析 `$DSH_HOME`，默认 `~/.dsh`）→ 失败回退 `~/.dsh/usage/usage.db` → 再失败回退插件内 `data/` 目录（`dsh-usage` 包目录下，随包可写）。验收标准含「回退链生效路径可观测」（见 U05/U09）。

---

## B. 预检发现（设计缺陷 / 修正建议，不改 DESIGN.md，交付单元已按修正落实）

| # | 发现 | 证据 | 修正（落到交付单元） |
|---|---|---|---|
| B1 | **多帧 zstd 拼接**：DESIGN §5「`zstdDecompressSync` 解压」对整文件只解出第一帧 | 22.8MB 文件 sync/流式均只出 190 字节；宿主 `dsh-session-persistence-jsonl` 用 `scanZstdFrames` 结构扫描逐帧解压；追加写入逐批一帧 | U04 `lib/zstd.js`：帧结构扫描 + 逐帧解压 + 撕裂末帧跳过；字节游标 = 末完整帧结束偏移 |
| B2 | cc 去重键失效：`UNIQUE(data_source, session_id, turn, step)` 中 cc 的 turn/step 为 NULL，SQLite NULL≠NULL → 永不去重 | SQLite 语义 + DESIGN §4 表结构 | U05：新增 `dedup_key TEXT NOT NULL`（dsh=`turn:step`，cc=`message.id ?? uuid`），`UNIQUE(data_source, session_id, dedup_key)`；turn/step 列保留供展示/cc 置 NULL |
| B3 | cc 口径：DESIGN §5「输入 = 未缓存输入（…/ input_tokens）」——cc 的 `input_tokens` **含缓存**，直接使用会与缓存桶双计 | 全库 41,071 条无一例 cache 之和 > input_tokens，缓存占比 35.5%；Anthropic 语义 | U07：cc 未缓存输入 = `max(0, input_tokens − cache_read − cache_creation)`；dsh 的 `inputTokens` 即未缓存（宿主 token-meter 源码 `uncachedInputTokens: inputTokens` 佐证）；命中率 = `cacheRead/(uncachedInput+cacheRead)`（两源统一） |
| B4 | request/header 非每请求一条；provider/model 需 last-seen 归属 | 单会话 24 条 header vs 871 usage | U06：按 seq 顺序维护 current header，usage 归属最近一次 |
| B5 | usage 双载体（chunk 与 message 同值重复），DESIGN 数字 47,811 是 message 口径 | chunk 45,007 / message 47,752 / 并集 47,846；同 (turn,step) 两记录数值相同 | U06：chunk 优先 + message 兜底 + `INSERT OR IGNORE` 并集去重（同一键值，先写先赢） |
| B6 | `compaction/summary` 带 usage 且会被误读为请求 | 实测 13 条带 usage | U06：显式排除 `compaction/summary`（同样排除 `session/title-llm-request`、`web/deepseek-search-llm-request` 等无 step 上下文记录，仅按 step 上下文归属） |
| B7 | dsh usage 无 cacheWrite 字段 → 四桶中的「缓存写」dsh 源恒 0；cc 的 cache_creation → cache_write | usage 键集实测 `cacheReadTokens,inputTokens,outputTokens` | U05/U06/U07：写库时 dsh 源 cache_write 写 0，cc 源 cache_creation→cache_write；四桶和 = input+output+cacheRead+cacheWrite |
| B8 | settings API 细节：0.1.5 有两种注册（`settings.register(ns,schema)` 与 `settings.installSection(owner,ns,schema,entry,hooks)`）；DESIGN 只写 installSection | dsh-settings 源码两函数均在；wallpaper 用 register；cookbook 用 installSection | U09：无配置项 → 用 `settings.register('dsh-usage', z.object({}).default({}))`（wallpaper 验证路径，无需 hooks）；卡片 key = `dsh-usage` |
| B9 | 客户端轮询/定时：DESIGN 未区分静态 bundle 与动态包定时限制 | taste 静态 bundle 在 useEffect 内 setInterval 正常 | U10：轮询照 taste 模式（useEffect + setInterval + cleanup），不用全局定时器 |
| B10 | 图表引入决策与 DESIGN §2「ECharts（定案）」冲突 | echarts 未安装；在线可装但需 alwaysBundle ~1MB；审计规则优先零依赖 | U10：**推翻「ECharts 定案」，改为自绘 SVG**（本报告 A5 决策，理由见 A5）；热力图默认本地时区（DESIGN §10 开放问题 → v1 定死本地时区，README 注明） |

---

## C. 修订方案（架构 + 文件清单）

### C.1 架构（与 DESIGN §3 一致，仅修正实现层）

```
数据源
  dsh: ~/.dsh/sessions/**/session.jsonl.zstd（多帧 zstd，帧结构扫描）
  cc : ~/.dsh/projects/**/*.jsonl（含 subagents/，cwd 归属，message.id 去重）
        │  ingest 服务（宿主侧，30–60s 定时 + RPC 手动触发）
        ▼
  SQLite（~/.dsh/storages/usage/usage.db，回退链见 A6）
  usage_events（dedup_key 修正版）+ usage_daily + sync_state
        │  ctx.connection.rpc.handle('/usage', …)（taste 0.1.5 同款）
        ▼
  客户端设置页卡片（settings.plugin.item，key='dsh-usage'）
  Hero + 自绘 SVG 趋势图/热力图 + Tabs + 轮询/手动刷新 + 下钻 ctx.sessions.select
```

### C.2 文件清单（相对 `/home/CNS2026495165/dsh/dsh-usage/`）

```
dsh-usage/
├── package.json          # @local/dsh-usage，exports ./client，dsh.client 声明
├── cordis.patch.yml      # - insert: - id: usage, name: '@local/dsh-usage'
├── LICENSE               # MIT
├── README.md             # 使用 + 统计口径说明 + INSTALL（web2 挂载步骤，主 agent 执行）
├── lib/
│   ├── index.js          # apply(ctx)：settings.register + RPC + ingest 调度 + 生命周期
│   ├── zstd.js           # scanZstdFrames / decodeSessionFile（帧扫描 + 逐帧解压）
│   ├── db.js             # openUsageDb / schema v1 / prepared 语句 / 聚合查询
│   ├── ingest-dsh.js     # 枚举 + 增量(字节游标) + 折叠 dsh 源
│   ├── ingest-cc.js      # 枚举 + 增量(游标/指纹) + 折叠 cc 源
│   ├── rpc.js            # connection.rpc.handle('/usage') 端点实现
│   ├── charts.js         # 纯函数 SVG 生成（面积图/柱状图/热力图）——供客户端 bundle 内联
│   └── client.js         # 手写 ModuleLoader bundle（含 charts.js 内联 + 卡片 UI）
└── data/                 # 运行时可写目录（回退链末位，.gitignore 不入库）
```

- 不引入任何 npm 依赖（运行时仅 `node:zlib`/`node:sqlite`/宿主 `@deepseek-ai/*` peer 包）；**免构建**（host 手写 ESM、client 手写 ModuleLoader bundle，taste 先例）。
- 交付物 = 源码目录本身；安装 = 拷贝子集（lib/ package.json cordis.patch.yml LICENSE README.md）到 `web2/node_modules/@local/dsh-usage`。

### C.3 统计口径（与 DESIGN §5 对齐 + B3 修正，卡片内展示口径说明）

- 请求数：dsh = 含 usage 的 (turn,step) 数（chunk∪message 并集）；cc = 含 usage 的 assistant 消息数。
- 输入（未缓存）：dsh = `inputTokens`；cc = `max(0, input_tokens − cache_read − cache_creation)`。
- 输出：`outputTokens` / `output_tokens`。
- 缓存读：`cacheReadTokens` / `cache_read_input_tokens`。
- 缓存写：dsh = 0（无字段）；cc = `cache_creation_input_tokens`。
- 总 tokens（四桶和）= 输入 + 输出 + 缓存读 + 缓存写。
- 缓存命中率 = `cacheRead / (输入(未缓存) + cacheRead)`（两源统一；分母为 0 时按 0% 显示）。
- 项目：dsh = `session.cwd`；cc = 记录 `cwd`（兜底：目录名 `-home-…-` 逆编码）。
- 时区：按日聚合/热力图默认本地时区（DESIGN §10 开放问题 → v1 定死本地时区）。

### C.4 RPC 端点（`connection.rpc.handle('/usage', handler, {authority:'loopback'})`）

| endpoint | 参数 | 返回 |
|---|---|---|
| `summary` | `{from?, to?, dataSources?}` | 请求数、四桶、命中率、覆盖会话数 |
| `timeseries` | `{granularity:'day', from?, to?, dataSources?}` | 按日四桶序列（趋势图） |
| `heatmap` | `{year?, dataSources?}` | 按日总量网格（热力图） |
| `byModel` / `byProject` / `byDay` | `{from?, to?, dataSources?}` | 各维度聚合表 |
| `sessions` | `{project?, model?, from?, to?, dataSources?, limit?}` | 会话列表（session_id/ts/四桶/请求数）→ 下钻 |
| `status` | `{}` | 上次 ingest 时间、各源已解析事件数、DB 路径、回退链状态 |
| `refresh` | `{}` | 手动触发 ingest（返回 status） |

错误统一 `{ok:false, error:{code,message}}`；参数校验失败不抛入 HTTP 层（taste 模式）。

---

## D. 交付单元（细粒度，可逐条实现）

> 约定：路径相对 `/home/CNS2026495165/dsh/dsh-usage/`；验收标准均可执行/可检查。实现顺序按编号（U01→U12）。执行档只按本清单落地，不自行扩范围、不决策；有歧义上报本审计澄清。

### U01 `package.json`
- 涉及文件：`package.json`
- 内容：`name: '@local/dsh-usage'`、`version: '0.1.0'`、`license: 'MIT'`、`type: 'module'`、`main: 'lib/index.js'`、`engines: {node: '^22.19.0 || >=24.0.0'}`；`exports`: `{".": "./lib/index.js", "./client": "./lib/client.js", "./cordis.patch.yml": "./cordis.patch.yml", "./package.json": "./package.json"}`；`dsh`: `{"bundle": {"patch": "./cordis.patch.yml"}, "client": {"platform": "web", "inject": []}}`；`files`: `["lib","cordis.patch.yml","README.md","LICENSE"]`；`peerDependencies`: `@deepseek-ai/cordis ^4.0.1`、`@deepseek-ai/dsh-settings >=0.1.1-rc.2 <0.2.0`、`@deepseek-ai/dsh-home-paths`、`@deepseek-ai/schemastery ^3.18.1`（版本区间照抄 dsh-btw/wallpaper 惯例）。无 `dependencies`。
- 验收：`node -e "JSON.parse(require('fs').readFileSync('package.json'))"` 通过；字段与 btw/wallpaper 形态一致（比对 `name/main/exports/dsh.client/engines/license`）。

### U02 `cordis.patch.yml`
- 涉及文件：`cordis.patch.yml`
- 内容：
  ```yaml
  - insert:
      - id: usage
        name: '@local/dsh-usage'
  ```
- 验收：YAML 可解析；`id: usage` 与 web2 profile 现有条目（vision-adam/taste/btw/wallpaper）无冲突。

### U03 `LICENSE`
- 涉及文件：`LICENSE`
- 内容：MIT License 全文（版权人 `CNS2026495165`，年份 2026）。
- 验收：文件存在，首行 `MIT License`。

### U04 `lib/zstd.js`（多帧 zstd 解码）
- 涉及文件：`lib/zstd.js`
- 函数：`scanZstdFrames(buffer) → {frames:[{start,end}], tornStart?:number}`（纯结构扫描：magic `0x28B52FFD`、帧头描述字节、contentSize/字典/校验位、块头循环、checksum 4 字节；块类型 3/保留位/越界 → 抛 `corrupt … at byte N`；结尾不足 → tornStart，不抛）；`decodeSessionFile(filePath) → {text, completeBytes}`（读文件 → scan → 逐帧 `zstdDecompressSync(comp.subarray(f.start, f.end))` → Buffer.concat → utf8；`completeBytes = 末完整帧 end`）；`splitJsonLines(text) → string[]`。
- 改动要点：完整移植宿主 `dsh-session-persistence-jsonl` 的 `scanZstdFrames` 算法（结构一致即可，自写实现）；撕裂末帧静默跳过；帧损坏时抛错由调用方（U06）捕获转 sync_state 指纹容错。
- 验收：
  1. `node -e` 对真实会话文件（如 `session-6a7367fe-…/session.jsonl.zstd`）：`decodeSessionFile` 输出行数 ≥ 82,000，首行 JSON 为 session 记录，`completeBytes < 文件大小` 或相等（无撕裂时）；
  2. 对正在写入的文件（新会话）不抛错、`tornStart !== undefined` 时行数与 `zstdDecompressSync(整文件)`（190B）截然不同；
  3. 用 U06 全量扫描计数做对账（见 U06 验收）。

### U05 `lib/db.js`（SQLite 建库/模式/查询）
- 涉及文件：`lib/db.js`
- 函数：
  - `resolveDbPath(fallbackDirs) → string`：优先 `dshHomePath('storages','usage','usage.db')`（`@deepseek-ai/dsh-home-paths`），mkdir 失败回退 `dshHomePath('usage','usage.db')`，再回退 `data/usage.db`（相对包目录）；返回实际路径 + 来源标记。
  - `openUsageDb(path) → DatabaseSync`：`await import('node:sqlite')` → `mkdir(dirname,{recursive:true,mode:0o700})` → 文件不存在时 `open(path,'wx',0o600)` 占位 → `new DatabaseSync(path)` → `PRAGMA journal_mode=WAL` → `PRAGMA application_id=<dsh-usage 专用 id>` + `PRAGMA user_version` 迁移（v1）。
  - `ensureSchema(db)`：三表 `STRICT`（见下）+ 索引；幂等（`CREATE TABLE IF NOT EXISTS`）。
  - `insertEvent(db, ev)` / `insertDaily(db, day)` / `upsertSyncState(db, row)` / `getSyncState(db, key)` / 聚合查询 `querySummary/Timeseries/Heatmap/ByModel/ByProject/ByDay/Sessions(db, filters)`。
- 表结构（修正版，DESIGN §4 的 B2/B7 修正落在此）：
  ```sql
  CREATE TABLE usage_events (
    id INTEGER PRIMARY KEY,
    data_source TEXT NOT NULL,            -- 'dsh' | 'cc'
    session_id TEXT NOT NULL,
    dedup_key TEXT NOT NULL,              -- dsh: 't<turn>:s<step>'；cc: message.id ?? uuid
    ts INTEGER NOT NULL,
    model TEXT, provider TEXT, project TEXT,
    turn INTEGER, step INTEGER,           -- cc 为 NULL
    is_subagent INTEGER NOT NULL DEFAULT 0,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    UNIQUE(data_source, session_id, dedup_key)
  );
  CREATE INDEX idx_events_ts ON usage_events(ts);
  CREATE INDEX idx_events_model ON usage_events(model);
  CREATE INDEX idx_events_project ON usage_events(project);
  CREATE TABLE usage_daily (
    day TEXT NOT NULL, data_source TEXT NOT NULL, model TEXT, project TEXT,
    requests INTEGER NOT NULL, input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL,
    cache_write_tokens INTEGER NOT NULL,
    PRIMARY KEY(day, data_source, model, project)
  );
  CREATE TABLE sync_state (
    source TEXT PRIMARY KEY,              -- 'dsh:<session-id|file>' | 'cc:<file>'
    mtime INTEGER, size INTEGER, fingerprint TEXT,
    last_seq INTEGER, last_offset INTEGER -- 字节游标（帧容器末完整帧偏移）
  );
  ```
- 验收：
  1. 在可写临时目录（如 `dsh-usage/data/`）`openUsageDb` 成功、重开幂等、`PRAGMA user_version` = 1；
  2. 同 (data_source,session_id,dedup_key) 二次 `insertEvent` 不产生新行（`INSERT OR IGNORE` 或前置查重）；
  3. cc 行 turn/step 为 NULL 且 dedup_key 非空 → 重复 message.id 不双计（模拟两行同 id）；
  4. 表结构含 `dedup_key` 与 `is_subagent` 列（B2/B7 修正可检查）。

### U06 `lib/ingest-dsh.js`（dsh 源）
- 涉及文件：`lib/ingest-dsh.js`
- 函数：
  - `enumerateDshSessions(root=~/.dsh/sessions) → [{file, mtime, size}]`（递归 `**/session.jsonl.zstd`，跳过符号链接外的非常规文件）；
  - `parseDshSession(buf) → {sessionMeta, events:[{turn,step,ts,usage,provider,model}]}`：
    - `decodeSessionFile` → 逐行 JSON；
    - 维护 `currentHeader`（`request/header` 的 `data.header.config.{provider,model}`，按 seq last-seen）；
    - 首行 session 取 `{id, createdAt, cwd}`；
    - usage 事件：`assistant/chunk` 且 `data.chunk.type==='usage'` → `{turn,step,ts:time,usage:chunk.usage}`；`assistant/message` 且 `data.usage` → 同 (turn,step) 兜底（**并集**：事件集合 = chunk 键 ∪ message 键，chunk 优先，message 仅当 chunk 缺失时写入）；
    - **排除** `compaction/summary`、`session/title-llm-request`、`web/deepseek-search-llm-request`（无 step 上下文，非请求 usage）；
    - usage 字段映射：`input_tokens=inputTokens, output_tokens=outputTokens, cache_read_tokens=cacheReadTokens, cache_write_tokens=0`（B7）；
  - `foldDshSource(db, root, {onProgress}) → {scanned, newEvents, failedFiles}`：
    - sync_state 过滤：`mtime/size` 未变 → 跳过；`size < 记录的 last_offset` → 视为被重写 → 整文件重扫；否则按 `last_offset` 从该字节起增量（帧结构扫描自 offset 起，仍须处理「offset 落在帧中间」——安全做法：从 `last_offset - 64KB` 起扫，仅接受完整帧，解码后按行号去重兜底）；
    - 每会话 `INSERT OR IGNORE`（**不删除旧数据**，幂等）；失败 → 记 sync_state fingerprint + `failedFiles`，下轮重试；
    - 全部完成后更新 `usage_daily`（增量聚合：只对新增事件所在天重算或累加）。
- 改动要点：增量 = 字节游标（`last_offset`）+ 去重键兜底，冷启动全量 = 无游标全扫（实测 30.2s 全库）。
- 验收：
  1. 冷启动全量扫描：事件数 ≥ 47,800 且 ≤ 47,900（以本审计实测并集 47,846 为基准，±0.1% 容差），`parseErrors === 0`；
  2. 二次运行新增事件 = 0（幂等）；对同文件追加（写入额外帧）后仅新增部分入库；
  3. 无 usage 会话（错误会话）不报错、不产生事件；
  4. provider/model 归属：抽查 ≥ 100 个事件，其 provider/model 与最近前向 request/header 一致（脚本断言）。

### U07 `lib/ingest-cc.js`（cc 源）
- 涉及文件：`lib/ingest-cc.js`
- 函数：
  - `enumerateCcFiles(root=~/.claude/projects) → [{file, mtime, size, isSubagent}]`（`**/*.jsonl`；路径含 `/subagents/` → isSubagent=true）；
  - `parseCcLine(o) → event|null`：仅 `type==='assistant'` 且 `message.usage`；字段 `model=message.model`、`ts=Date.parse(timestamp)`、`session_id=sessionId ?? session_id ?? 文件名 uuid`、`project=cwd`（缺省 → 目录名 `-home-…-` 逆编码：`-`→`_`，去前导 `-home-` 还原路径，失败置 `(unknown)`）、`dedup_key=message.id ?? uuid`、`is_subagent`、桶映射（B3/B7）：`input=max(0, input_tokens − cache_read − cache_creation)`、`output=output_tokens`、`cache_read=cache_read_input_tokens`、`cache_write=cache_creation_input_tokens`；`provider='claude'`；`turn/step=NULL`；
  - `foldCcSource(db, root, {onProgress}) → {scanned, newEvents, failedFiles}`：sync_state 按文件 mtime/size + 行号游标（或文件末字节游标）增量；`INSERT OR IGNORE`；失败容错重试。
- 验收：
  1. 全量：事件数 = 41,071 ± 10（本审计实测基准），重复 message.id 无双计（去重键生效，B2 验证）；
  2. 抽样 ≥ 50 条：`input+cache_read+cache_write+output` 与 `message.usage` 原始值复算一致（B3 公式）；
  3. subagents 文件事件 `is_subagent=1`、`session_id` 为父会话 uuid；
  4. 二次运行新增 0。

### U08 `lib/rpc.js`（宿主 RPC）
- 涉及文件：`lib/rpc.js`
- 函数：`registerUsageRpc(ctx, deps:{db, ingest, statusProvider})`：
  - `ctx.connection.rpc.handle('/usage', handler, {authority:'loopback'})`，handler = `(endpoint, payload) => {ok,value}|{ok,error}`，端点 C.4 七项 + `refresh` + `status`；
  - 参数校验（from/to 为毫秒时间戳或 ISO、dataSources ∈ {'dsh','cc','all'}、granularity 白名单）；校验失败返回 `{ok:false, error:{code:'invalid-params', message}}`；
  - `sessions` 返回 `[{session_id, data_source, ts, requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, model, project}]`（供下钻）；
  - 所有查询走 U05 聚合函数；`refresh` 调 ingest 后回 `status`。
- 验收：
  1. 用 node 脚本直接构造 ctx stub（含 `connection.rpc.handle` 捕获注册表）→ 对临时库逐端点调用，返回体符合 `{ok,value}` 且与 `sqlite3` CLI 手工查询对账（`summary` 四桶/请求数、`timeseries` 逐日、`byModel` 前 5 行）；
  2. 非法参数返回 `{ok:false,error}` 不抛异常；
  3. `status` 含 dbPath、来源回退标记、各源事件数。

### U09 `lib/index.js`（宿主 apply + ingest 调度）
- 涉及文件：`lib/index.js`
- 内容：
  - `export const inject = ['connection']`（+ 可选 `'settings'` 经 `ctx.inject(['settings'], …)` 惰性获取，照 wallpaper 写法）；
  - `export function apply(ctx)`：
    1. `ctx.inject(['settings'], sc => sc.settings.register('dsh-usage', z.object({}).default({})))`（B8：空 schema；不写 installSection，因无 hooks 需求；namespace 注册后 Plugins 页才会分发 key）；
    2. `resolveDbPath` → `openUsageDb` → `ensureSchema`；
    3. 启动后异步首扫（不阻塞 apply 返回；`queueMicrotask`/`ctx.setTimeout(0)`），定时 `ctx.setInterval(INGEST_INTERVAL_MS=45_000)`（30–60s 区间内取 45s，常量可配）跑 dsh+cc ingest；失败仅告警不退出；
    4. `registerUsageRpc(ctx, …)`；
    5. `ctx.effect(() => () => { clearInterval; db.close(); }, 'dsh-usage: lifecycle')`；
    6. 日志用 `ctx.logger`（prefix `dsh-usage`）。
- 验收：
  1. 在真实 web2 profile 内装入（见 U12 安装）后，宿主日志出现 `dsh-usage` 初始化 + 首扫完成行；`dsh-settings` 的 `describe()` 含 `dsh-usage` namespace；
  2. `ctx.connection.rpc` 能调用 `/usage/status`（浏览器控制台 `rpc.call` 或等价测试）；
  3. 重启 web2 后插件自动加载、不干扰 btw/wallpaper/taste（三者原有日志/UI 正常）；
  4. 卸载/禁用插件后数据库句柄关闭、定时器清理（无内存泄漏告警）。

### U10 `lib/client.js`（客户端 bundle，手写免构建）+ `lib/charts.js`
- 涉及文件：`lib/client.js`、`lib/charts.js`
- 内容：
  - `lib/charts.js`（**纯函数 SVG 字符串/元素生成，零依赖**，在 client bundle 构建时内联为一段源码）：
    - `areaPath(points, w, h, opts)`（面积图 path d）、`barRects(values, w, h, opts)`（柱状）、`heatmapGrid(days, w, opts)`（GitHub 风格：按日×周网格，颜色按桶总量分级，≤7 级）；
    - 全部返回可由 `React.createElement('svg', …)` 直接消费的结构（或字符串 + `dangerouslySetInnerHTML` 二选一，v1 用 createElement 结构）。
  - `lib/client.js`：`window.__ModuleLoader__.load({id:'@local/dsh-usage', factory:(require)=>{…; return module.exports;}})`：
    - `require('react')`（+ 可选 `require('react/jsx-runtime')`，手写则用 `React.createElement` 即可，仅 require react）；
    - `const inject = ['slots','connection','sessions']`；
    - `function apply(ctx)`：
      1. `ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({name:'settings.plugin.item', key:'dsh-usage', locale:'dshUsage', inject: () => ({useStore, rpc: ctx.connection.rpc, sessions: ctx.sessions})}, UsageCard))`；
      2. 卡片组件 `UsageCard`：
         - 数据源切换（dsh/cc/all）、日期范围（预设 7/30/90 天 + 自选）、刷新间隔（0/5/30/60s）、手动刷新按钮；
         - Hero 统计（请求数/输入/输出/缓存读/缓存写/命中率）+ 口径说明行；
         - 趋势图（SVG 面积/柱状，四桶可切换）、热力图（SVG）；
         - Tabs：按模型 / 按项目 / 按日 / 会话明细（表格，含日期筛选）；
         - 会话行点击 → `ctx.sessions.select(sessionId)`（下钻，复用现有会话视图统计条；bundle 内不重复实现单会话展示）；
      3. 数据获取：`ctx.connection.rpc.call('/usage', endpoint, payload)`，`{ok:false}` 时展示错误文案；轮询 = 组件 `useEffect` 内 `setInterval` + cleanup（taste 先例，B9）；手动刷新 = 调 `refresh` 端点后重拉；
      4. 组件状态用 `React.useState/useEffect/useCallback`，**不引入 client-store**（`dsh.client.inject` 保持空数组）；样式内联 CSS 字符串 + `<style data-plugin="…">`（taste/wallpaper 同款），token 用 `var(--dsw-*)`。
  - `package.json` 的 `dsh.client.inject` 维持 U01 的空数组（无 @deepseek-ai 客户端模块 import 依赖；若实现中引入 `@deepseek-ai/dsh-client-ui-primitives` 等，需同步补进该列表——由执行档上报审计，不自行拍板）。
- 验收：
  1. bundle 语法正确（`node --check` 或浏览器控制台无 SyntaxError；`.dsh` 加载后 `__ModuleLoader__` 表含 `@local/dsh-usage`）；
  2. 设置页「插件配置」Tab 出现 dsh-usage 卡片（namespace 分发链：host describe → tab dispatch → key 匹配）；
  3. 三个 SVG 图在卡片内渲染出非空图形节点（DevTools 断言 `svg > path/rect` 数量 > 0）；
  4. 数据源切换/日期/刷新间隔/手动刷新交互后数据变化；会话行点击跳转会话视图；
  5. RPC 失败路径显示错误文案且不白屏（`{ok:false}` 演练）。

### U11 `README.md`（含 INSTALL 说明，本阶段只产文档）
- 涉及文件：`README.md`
- 内容：插件用途/范围（不计费）；统计口径说明（C.3 全文 + B3 公式）；架构简述（引用 DESIGN.md）；**INSTALL（web2 挂载，供主 agent 执行）**：
  1. 构建/校验：无构建步骤（手写产物），`node --check lib/index.js && node --check lib/client.js`；
  2. 拷贝：`cp -r lib package.json cordis.patch.yml LICENSE README.md ~/.dsh/profiles/web2/node_modules/@local/dsh-usage/`（如已存在先备份）；
  3. 在 `~/.dsh/profiles/web2/cordis.patch.yml` 追加（幂等，`grep -q 'name: .@local/dsh-usage.' ||` 追加）：
     ```yaml
     - insert:
         - id: usage
           name: '@local/dsh-usage'
     ```
  4. **重启 DSH（web2 profile）**；重启后验证：宿主日志 `dsh-usage` 初始化；设置页→插件配置出现卡片；
  5. 卸载：移除 insert 条目 + 删除 `@local/dsh-usage` 目录 + 重启（库文件保留，重新挂载即恢复）。
- 验收：文档含可复制的命令与重启提示；与 U12 的安装动作一一对应。

### U12 安装到 web2 的说明/脚本（附送，主 agent 执行）
- 涉及文件：`scripts/install-web2.sh`（新目录 `scripts/`）+ `README.md` 引用
- 内容：幂等安装脚本（拷贝 + patch insert + 打印重启提示），含 `--dry-run`（打印将执行的路径与 patch diff）；`--uninstall`（还原）。
- 验收：`bash scripts/install-web2.sh --dry-run` 输出正确目标路径；主 agent 执行后按 U09 验收 1–4 复核。
- 说明：本阶段仅交付脚本与文档；**实际安装动作由主 agent 在「修订并执行」完成后执行**。

---

## E. 未验证项（如实声明）

1. `~/.dsh/storages/usage/` 在**宿主进程**内的实际可写性：本审计沙箱对 `~/.dsh` 一律 EROFS（沙箱隔离），无法直接实测；依据 = 宿主持续写入 `~/.dsh/storages/*` 与 `~/.dsh/sessions/*`（证据充分），并按 U05 内置三级回退链兜底。若执行后发现宿主亦不可写（极小概率），U05 回退链已覆盖。
2. `ctx.connection.rpc.call` 的客户端超时/取消语义与 `signal` 参数传递：按 taste 用法（不传 signal、等待 resolve）实现，未发现必须使用 signal 的端点。
3. `request/header` 的 `reason` 字段与 `request/context` 记录：不影响 usage 折叠，未深究。
4. cc 转录 `input_tokens` 是否必含 cache_creation：按 Anthropic 语义（含）处理；已用「clamp ≥ 0」防负，且全库实测无「cache 之和 > input_tokens」反例。
5. 会话文件重写/截断（如宿主未来引入日志轮转）是否会发生：当前 1,656 文件均 append-only（mtime 单调，无 size 回退样例）；U06 已内置 `size < last_offset → 重扫` 防御。

## F. 给主 agent / 执行档的约束

- 执行档按 U01→U12 顺序逐条落地，只实现清单内容；每完成一个单元，用其「验收标准」自检并回报。
- 任何与 A/B/C 节冲突的发现（如新 API 签名变化）→ 上报审计澄清，不得自行改写方案。
- 禁止引入未列出的 npm 依赖（图表、构建工具、zstd/sqlite 包装库均禁止）；禁止修改 DESIGN.md。
- 交付后运行全套验收（重点：U06 全量对账 47,846±0.1%、U07 41,071±10、U09 装入重启无干扰），结果写入 `dsh-usage/VERIFY.md`（复核阶段读取）。
