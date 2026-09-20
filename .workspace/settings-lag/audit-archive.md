# 会话归档 / 清理机制 事实调研（只读）

调研对象：运行中的 DSH Web GUI（`node /home/CNS2026495165/.npm-global/bin/dsh web`，PID 20806，**全程未重启/未干扰**）
调研方式：源码静态定位 + 只读磁盘扫描（zstd 流式解压到管道）+ 索引文件只读解析
纪律确认：**未对 `~/.dsh` 下任何文件做写/删/移**；SQLite 一律 `readOnly:true`（`node:sqlite` DatabaseSync）；HTTP 探针 **0 次**（未使用，结论全部由源码 + 磁盘证据支撑）；未使用 `sandbox_permissions`。
唯一写入：本报告 + 只读扫描脚本 `scan_sessions.sh`（均落在允许工作区 `/home/CNS2026495165/dsh/.workspace/settings-lag/`），以及 `/tmp` 下的临时中间结果。

**完整性自检**：调研结束时用 `find ~/.dsh -newermt` 复核，确实存在 14:44–14:47 的近期 mtime —— 但这些**全部由活着的 host 进程 20806 自己产生**（`dsh--` 工作区下新出现两个会话目录 `dd9bbbe3-…`/`d3ad78bc-…`、`session_projcache.json`、`storages/`、`workspace.json`），因为该 GUI 正在同时服务**其它并发会话**（含产生本报告的主 agent 会话）。本次调研的所有读写都经过只读命令（`find`/`stat`/`zstdcat`/`grep`/`node readOnly`），**未对 `~/.dsh` 产生任何写入**。旁证：host RSS 在调研期间从 670 MB 涨到 1.18 GB —— 是 host 在干活，不是我在动它。

---

## 0. 结论摘要（先看这个）

| 问题 | 结论 | 一句话依据 |
|---|---|---|
| 1. 有归档机制吗 | **有，但只是"每会话一条布尔标记"** | 归档 = 往 `workspace.json` 的 `archivedSessionIds` 数组追加一个 id，**磁盘上零动作** |
| 1. 可逆吗 | **代码设计上可逆，但当前部署无实现入口** | 全量安装树内 grep `unarchive` **零命中**；RPC 只有 `workspace.archiveSession` |
| 2. 归档能降低 `/api/session.list` 的 N 吗 | **不能。0 收益。** | `listVisibleSessionSummaries()` 里**完全没有** archived 过滤；过滤只发生在浏览器 render 期 |
| 2. 归档的有效性在哪 | 只让**前端侧边栏行数**下降，**不减少一次性 payload 与前端快照重建成本** | 见 §2 |
| 3. 有受支持的删除入口吗 | **没有**（无 `session.delete` RPC / 无 CLI 子命令 / 无 UI 入口） | 52 个 RPC 方法全量枚举，无删除会话方法 |
| 4. 可清理的 blank 会话量级 | **≈ 4 个 / 4.7 KiB（0.17%）—— 几乎为零** | 全量 2371 个会话逐一流式扫描 |
| 4. 真正的大头 | **subagent 会话 2287/2371 = 96.5%，902.4 MiB** | 前端 `sessionVisible()` 本来就不显示它们 |
| 5. 备份最小代价 | 元数据层 **12 KiB**（2 个索引文件）/ 单工作区 tar **~584 MiB** / 全量 tar **~1.19 GiB** | 见 §5 |

> **给裁决的一句话**：本次调研**推翻**了"归档是缩容路径"这一前提——归档对 `/api/session.list` 的 N 是**零收益**；真正能降 N 的只有**物理删除 subagent 会话目录**，而 DSH **没有提供任何受支持的删除入口**，且 96.5% 的会话是 subagent（前端本来就不渲染）。可安全下手的"空会话"量级只有 **4 个**，收益可忽略。

---

## 1. 归档机制：产生端、消费端、触发方式、磁盘动作、可逆性

### 1.1 产生端（事件从哪来）

三层链条，全部在同一文件体系内：

**(a) RPC 入口** — `dsh-host-apiproxy`
```
profiles/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js:2526   async archiveSession(request) {
profiles/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js:2529       await ctx.workspaceRegistry.archiveSession(sessionId);
profiles/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js:2542   return ok(request, { archivedSessionIds: [...] });
```
方法名注册：`dsh-host-apiproxy/lib/index.js:4710  "workspace.archiveSession": {...}`
请求/响应 schema：`dsh-host-apiproxy/lib/index.js:4241-4244`

**(b) registry 实现** — `dsh-workspace`（**最终真相在这里**）
```
profiles/node_modules/@deepseek-ai/dsh-workspace/lib/index.js:422-432
    archiveSession(sessionId) {
        return this.enqueueOperation(async () => {
            if (this.requireState().archivedSessionIds.includes(sessionId)) return;   // 幂等
            if (!await this.sessionKnown(sessionId)) throw new WorkspaceUnknownSessionError(sessionId);
            const state = this.requireState();
            await this.setState({ ...state, archivedSessionIds: [...state.archivedSessionIds, sessionId] });
        });
    }
```
镜像实现（同一份代码的 `.d.ts` 侧）：`dsh-workspace/lib/types/index.js:204-215`
状态 schema：`dsh-workspace/lib/types/spec.js:45`
关键注释（`dsh-workspace/lib/index.js:406-411`，逐字）：
> "The registry-global archive set: sessions hidden from every grouping surface. **Archiving never touches workspace accounting** — an archived session keeps its `sessionIds` slot so unarchiving restores its position."

**(c) 事件生产** — `host/archived-sessions-changed`
```
profiles/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js:3218-3225
    if (state.archivedSessionIds.length !== archivedSessionIds.length
        || state.archivedSessionIds.some((id, index) => id !== archivedSessionIds[index])) {
        archivedSessionIds = state.archivedSessionIds;
        queue.push(frame({ type: 'host/archived-sessions-changed', archivedSessionIds: [...state.archivedSessionIds] }));
    }
```
触发源是其上的 `ctx.on('domain/changed', ...)`（`api-proxy.js:3191`）且 `change.domain === 'workspace'` 且 `change.table === ''` 且 `change.operation === 'put'`——**即：只有 workspace 域全局状态被重写时才发帧**。事件 schema：`dsh-host-apiproxy/lib/types/api/events.schema.js:76`。

### 1.2 消费端

```
profiles/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js:9637
    } else if (envelope.payload.type === "host/archived-sessions-changed") this.installArchived(envelope.payload.archivedSessionIds);
profiles/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js:9673-9679  installArchived(archivedSessionIds) { ... this.notifier.markDirty(); }
profiles/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js:9511  // workspace.list 响应里也带 archivedSessionIds（重连基线）
profiles/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js:9621-9623  async archiveSession(sessionId) { ... this.api.workspace.archiveSession({sessionId}) }
```
渲染期消费（**这就是唯一真正"过滤"的地方**）：
```
profiles/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js:101
    function sessionVisible(session, current, archived) {
        return session.origin !== "subagent" && !archived.has(session.id) && (!session.blank || session.id === current);
    }
profiles/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js:191-192   deriveGroups()
profiles/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js:222-223   deriveFlat()
profiles/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js:252       deriveSearchResults()
profiles/node_modules/@deepseek-ai/dsh-client-ui-workspace/lib/client.js:1653      const archivedSessionIds = useWorkspaces((state) => state.archivedSessionIds);
```
注意这一行同时说明了一个**更重要的事实**：`session.origin !== "subagent"` 与 archived 并列——**subagent 会话本来就不显示**。

### 1.3 触发方式（UI 入口 / RPC / CLI）

| 通道 | 是否存在 | 证据 |
|---|---|---|
| UI 右键菜单 | **存在** | `dsh-client-ui-workspace/lib/client.js:706-714`（`id:"archive"`，`label: t("menu.archiveSession")`）；中文文案 `client.js:2255 "menu.archiveSession": "归档会话"`；绑定 `client.js:2419-2420`、`client.js:1846-1849 onSessionArchive` |
| RPC | **存在** | `workspace.archiveSession`（见 §1.1a） |
| CLI | **不存在** | `dsh/lib/bin.js:91` 只有子命令 `web`，`bin.js:96` 只有子命令 `plugin`（转发 pnpm）。CLI 全域无 session 管理子命令 |
| HTTP 直调 | 理论存在但需浏览器侧鉴权，**本次未探测（0 次 HTTP）** | — |

### 1.4 归档在磁盘上做了什么？——**什么都没做**

代码事实：`archiveSession()` 只在 workspace 域的**全局状态记录**里往数组追加一个 sessionId，然后 `setState` 持久化该域（`dsh-workspace/lib/index.js:427-430`）。**没有** mkdir/rename/unlink/写标记文件/改 session 日志。

实测磁盘证据：
```
$ node -e '...readFileSync("~/.dsh/storages/workspace.json")...'
archivedSessionIds count: 67
all: ["session-1946dc41-...","session-fb66d6d2-...", ...]   # 67 项，全部 session- 前缀
```
- 归档集合的落盘位置：`~/.dsh/storages/workspace.json`（7802 B），路径 `global.archivedSessionIds`。
- **归档的会话目录原地不动**：例 `session-1946dc41-84c2-495d-bdd8-a6a1fb4a02bd` 仍存在于
  `~/.dsh/sessions/--home-CNS2026495165-Dexterous_Hand_23Dof-Dexterous_Hand_23Dof--/session-1946dc41-84c2-495d-bdd8-a6a1fb4a02bd/`，
  且其 `session.jsonl.zstd` 完整保留。
- `~/.dsh/sessions/` 下**不存在**任何归档专用目录/后缀/标记文件：全树文件只有
  `session.jsonl.zstd`×2370、`session.v3.jsonl.zstd`×3、`session.lock`×3（共 2376 个文件，无第 4 种命名）。

### 1.5 是否可逆（能否取消归档）？——**设计可逆，实现缺失**

- 设计意图明确可逆：`dsh-workspace/lib/index.js:408-409` 注释称 "an archived session keeps its `sessionIds` slot so **unarchiving** restores its position"；客户端注释 `dsh-client-ui-workspace/lib/client.js:96-97` 同样提到 "**while their accounting slots remain so unarchiving restores position**"。
- **但实现不存在**：在**整棵安装树**内搜索
  ```
  grep -rn "unarchive\|unArchive\|UNARCHIVE" --include=*.js \
      ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-*/lib/
  → 零命中
  ```
- 52 个 RPC 方法全量枚举（从 `dsh-host-apiproxy/lib/index.js` 抽取）：
  ```
  session.list  session.search  session.create  session.history  session.models  session.selectModel
  session.rename  session.fork  session.prompt  session.attachment  session.updateQueue  session.cancel
  subagent.list  subagent.history  subagent.prompt  subagent.interrupt
  host.describe  host.pickDirectory  host.listDirectory  host.createDirectory  host.openPath
  workspace.list  workspace.create  workspace.rename  workspace.delete  workspace.insertBefore
  workspace.insertSessionBefore  workspace.archiveSession
  skill.list  agentPreset.list/.select/.read/.copy/.openDocument/.remove
  goal.create/.edit/.pause/.resume/.complete/.clear
  settings.describe/.openDocument/.update/.replace/.mutate
  credentials.describe/.set/.unset  llm.providers  llm.models  llm.discoverModels
  ```
  → **有 `workspace.archiveSession`，没有 `workspace.unarchiveSession`；也没有任何 `session.delete` / `session.remove`。**
- 另外注意 `workspace.list` 的响应里也带 `archivedSessionIds`（`api-proxy.js:2427`），即**重连时整集合会重新下发给前端**——也就是每次页面刷新都会重新拉取归档集合。

**可逆性实操判断**：唯一"取消归档"的办法是**直接编辑 `~/.dsh/storages/workspace.json` 的 `global.archivedSessionIds` 数组**（删掉对应 id），然后让 host 重读该域。**这不是受支持路径**，风险：该域是 storage-domain 中介的整块状态，外部改写与内存态会产生版本/时序冲突，且文件 `-rw-------` 是落盘权威，任何并发写入会覆盖你的手工修改。本次调研**未尝试**。

---

## 2. 归档能否让 `/api/session.list` 的条目数下降？——**不能**

### 2.1 服务端实现定位

```
profiles/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js:1658-1660
    async list(request) {
        return ok(request, { items: await listVisibleSessionSummaries() });
    },

profiles/node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api-proxy.js:1406-1460
    async function listVisibleSessionSummaries(signal) {
        signal?.throwIfAborted();
        const summarizeAttached = (session) => {...};
        const items = ctx.sessions.list().map(summarizeAttached);          // ← 附加会话全量
        ...
        const persistence = ctx.get('sessionPersistence');
        if (persistence !== undefined) {
            const cold = (await persistence.list(signal))
                .filter(meta => !attached.has(meta.id) && meta.cwd !== undefined);   // ← 冷会话全量（只按 cwd 过滤）
            ...  // 分批 summarizeCold
        }
        items.sort((a, b) => b.updatedAt - a.updatedAt);
        return items;
    }
```
（`dsh-host-apiproxy/lib/index.js:2177` / `:2414` 是同一份源码的可读副本，行号略有偏移。）

### 2.2 过滤条件结论

对 `listVisibleSessionSummaries` 全函数体（行 1406-1460）逐行核查，**过滤条件只有两个**：
1. 冷会话需 `meta.cwd !== undefined`（行 1422）——即"没有 cwd 的日志不服务"；
2. 与已附加（attached/in-memory）会话去重（`!attached.has(meta.id)`，行 1422）。

**`archivedSessionIds` 在整个函数体与整个 `sessions.list` 处理路径中一次都没有出现。** 该文件里 `archiv` 的全部命中（`api-proxy.js` 中仅 2427 / 2542 / 3169 / 3218-3223 五处）分别属于：`workspace.list` 响应、`archiveSession` 返回值、以及 host 事件流基线——**没有一处在 session 列表过滤中**。

对照镜像文件 `dsh-host-apiproxy/lib/index.js`：`archiv` 命中为 3036（workspace.list）、3114-3126（archiveSession）、3639-3694（host 事件流）、4206/4241-4244/4710（schema 与注册）——同样**无列表过滤**。

### 2.3 因此的真实行为

| 维度 | 归档后是否下降 |
|---|---|
| `session.list` 一次拉取的 `items.length` | **不下降**（27 个归档会话照旧在内） |
| 前端收到的 metadata 总量（字节） | **不下降** |
| 前端快照/派生结构重建成本（随 N 增长的那部分） | **不下降** |
| 侧边栏可见行数 | **下降**（`sessionVisible()` 在 render 期把归档 id 排除） |
| `session.search` 内容搜索命中 | **下降**（行 1683 `visibleIds` + 行 262 `!sessionVisible(...)`） |

**判定：归档对本问题（N² 前端列表重建）零收益。** 它只清理了侧边栏视觉噪音。

### 2.4 实测归档现状（顺带发现）

- 归档集合共 **67** 个 id，**全部带 `session-` 前缀**（即全部是顶层用户会话，`bare-uuid` 的 subagent 一个都没有被归档）。
- 磁盘上顶层会话（`session-*` 目录）共 81 个 → **归档 67 个后，侧边栏理论上只剩 14 个顶层会话可见**。
- 这解释了"用户觉得列表乱"的现象来源：**用户已经手工归档了 67 个**，但 `session.list` 的 payload 与前端重建成本**一点都没降**（N 仍是全部 2371）。

---

## 3. 删除会话的正确语义

### 3.1 有没有受支持的删除入口？——**没有**

- RPC：见 §1.5 的 52 方法全量清单 —— **无 `session.delete` / `session.remove` / `session.archive` 之外的任何删除器**。
- HTTP 路由：`grep "session.delete|session/delete|deleteSession|session.remove|removeSession"` 命中 0 条（唯一相关命中是事件名 `host/session-removed`，它是**内存态销毁通知**，不是持久化删除）。
- CLI：`dsh/lib/bin.js:91,96` 仅 `web` / `plugin`。**无删除子命令**。
- UI：会话右键菜单只有 `rename` / `fork` / `archive`（`dsh-client-ui-workspace/lib/client.js:700-714`）；`deleteTarget`/`deleteWorkspace` 是**工作区**删除，不是会话。
- 关于 `host/session-removed`：生产端 `api-proxy.js:3182-3184`，绑在 `ctx.on('session/disposed', ...)` 上——**只表示某个 Session 从进程内存里摘除**，磁盘日志不受影响。别把它误当成删除。

### 3.2 直接删目录会留下什么残留（逐项核实）

把 `~/.dsh/sessions/<workspace-slug>/<sessionId>/` 删掉后：

| 残留/对象 | 是否断裂 | 证据与后果 |
|---|---|---|
| **启动报错 / 列表崩溃** | **不会** | `dsh-session-persistence-jsonl/lib/index.js:1076-1077` — `if (!pathExists) continue;`；行 1078-1079 header 读不到也 `continue`；`parseHeaderMeta` 解析失败**静默返回 undefined**（`index.js:325-334`，`catch { return; }`）。`listArtifacts` 的硬错误只有三种：opposite-encoding 存在（`:1073-1075`）、重复 id（`:1090`）、project 根下有遗留 flat `.jsonl`（`:1393-1394`）——**删一个会话目录三者都不触发**。 |
| `~/.dsh/storages/session_projcache.json`（8.3 MB） | **留下陈旧条目** | 实测 2369 个 session 条目；**无 GC/无 prune**：`grep -in "max\|limit\|cap\|gc" dsh-session-projection-cache/lib/index.js` 仅命中 `this.dirty.delete(session)`（:222，脏标记清理，与容量无关）。陈旧行只是浪费字节，不参与 `session.list` 正确性。 |
| `~/.dsh/storages/session_projcache/sessions/*.json` | **陈旧文件（已废弃层）** | 实测 **1597 个文件 / 6.8 MB**，**全部 mtime = 2026-09-11**，此后无更新 → 是旧 JSON per-key 后端的遗留物，当前权威是那个单体 `session_projcache.json`。删除会话不会动它们，可视为纯垃圾。 |
| `~/.dsh/storages/usage/usage.db`（36.7 MB） | **留下孤立行，无完整性风险** | `usage_events.session_id` 是普通 `TEXT NOT NULL`：**无 FOREIGN KEY、无 REFERENCES、无 UNIQUE 引用**（`sqlite_master` 实测 DDL + 索引只有 `idx_events_ts/model/project`）。删除会话只是把该 session 的历史计费行留成孤儿；`is_subagent` 为独立列。`sync_state`（2744 行）里 **2356 行** source 指向 `~/.dsh/sessions/.../session.jsonl.zstd` —— 这些行会指向已不存在的文件；同步器按 stat 增量比对，无害（只是永不收敛的陈旧记录）。 |
| 其它索引 | **不存在** | 全 `~/.dsh` 下 `find -name '*.db' -o -name '*.sqlite*'` 只命中 **1 个**：`storages/usage/usage.db`。session 搜索索引（`dsh-session-query-sqlite`，用 `persisted_sessions` 表）在本部署**未挂载**（`cordis.patch.yml` 里无 session-query 配置）。 |
| 归档集合 `workspace.json:archivedSessionIds` | **会变成悬挂 id** | `archiveSession` 只要求 `sessionKnown`（`:425`），之后集合里会留一个磁盘上不存在的 id。无校验、无害，但不可逆残留。 |

### 3.3 真正的风险点（比残留重要得多）

**(R1) 删除"当前 live 会话"会造成目录复活 + 半截日志。**
`appendLines()`（`dsh-session-persistence-jsonl/lib/index.js:1200-1227`）每次 append 都 `open(path,"a")`（**不是持有 fd**），而 `materializePosix` 路径会 `mkdir(project,...)` + `mkdir(dir,...)` **recursive**。所以删掉一个仍在内存里挂着的会话目录后，下一次 append 会**重新 mkdir 并新建一个只含后续事件的 `session.jsonl.zstd`**——该文件首行不是 header，`parseHeaderMeta` 返回 undefined，`listArtifacts` 永远 `continue` 跳过它 → **一个永久不可见的僵尸目录**。
**因此：删除前必须确认目标会话不在 host 的内存附加集合里**（`ctx.sessions.list()`，对应 `host.describe` 的 `attachedSessions`）。本次调研的 host PID 20806 已运行 2:58:04、RSS 670 MB，说明**存在活跃会话**。
**(R2) `session.lock` 的存在说明有会话被独占。** 实测 3 个会话目录含 `session.lock`，删这类目录需格外谨慎。
**(R3) 不可回滚性。** 归档可回滚（改一个数组），删除**不可回滚**（日志是唯一的会话真相，别处没有副本）。
**(R4) 前端仍在为 subagent 付费。** 即使你删了 subagent 会话，只要还留着某个顶层会话，它所属的 subagent 血缘也会……不，subagent 是按 `origin` 排除的——所以删 subagent 会话是**唯一真正降 N 的手段**，但代价是丢失 subagent 的全部轨迹（`subagent.history` 将报错）。

---

## 4. 量化：会话磁盘布局、blank 会话量级、可清理量

### 4.1 单个会话的磁盘布局（实测）

```
~/.dsh/sessions/<workspace-slug>/<sessionId>/
└── session.jsonl.zstd            ← 唯一内容文件（zstd 压缩的 JSONL 事件流）
[可选] session.lock               ← 独占锁（实测 3 个会话有）
[旧格式] session.v3.jsonl.zstd     ← v3 格式变体（实测 3 个会话用这个）
```
- `<workspace-slug>` = `projectKey(cwd)`：cwd 中 `/ \ :` 压成 `-`，非 `[A-Za-z0-9._-]` 字符转 `~XXXX`（UTF-16 码位十六进制），截断 251 字符，包在 `--...--` 里（`dsh-session-persistence-jsonl/lib/index.js:106-125`；`cwd === undefined` → `_no-cwd`，行 133-135）。
- **每个会话目录恰好一个文件**：实测 2376 个文件 = 2370 + 3 + 3，**没有任何第 4 种文件名**。
- 首行是 header（`{"type":"session","version":0,"id":...,"createdAt":...,"cwd":...,"parentSession":...,"origin":...,"delegationDepth":...,"agentPreset":...}`），其后是事件行（`turn/start` / `step/start` / `user/message` / `assistant/message` / `tool/call` / `tool/result` / `session/title` …）。
- **"有内容" vs "空会话"的判定**（代码权威定义）：
  ```
  dsh-host-apiproxy/lib/types/api-proxy.js:350-358
  function sessionBlank(session) { return !session.events.some(event => event.type === 'turn/start'); }
  ```
  即 **blank ⇔ 从未跑过任何一个 turn**（`/plan`、`/goal`、命令生命周期、标题都**不算**打开 turn——注释 :351-354 明确说明）。冷会话侧同理，`summarizeCold`（`:441-455`）在 `metadata?.blank === false` 时不探测，否则靠 `probeColdSessionMetadata` 在**尺寸阈值内**读日志验证（`coldBlankProbeMaxBytes`，`api-proxy.js:824`），且**读失败/超阈值一律回退为可见 `false`**（注释 :404-409：宁可显示也不隐藏会话）。

### 4.2 全量实测扫描方法与结果

**方法**（不遍历文件内容到磁盘，全程流式 → 管道；不使用写操作）：
```
find ~/.dsh/sessions -mindepth 2 -maxdepth 2 -type d -print0 \
 | xargs -0 -P 8 -I{} bash -c '<对每个目录：取 session*.zstd，stat 取字节数，zstdcat | awk 统计 turn/start 与 user/message 行数>'
```
脚本落盘在工作区：`/home/CNS2026495165/dsh/.workspace/settings-lag/scan_sessions.sh`（只读，已实测 5.6 秒跑完 2370 个会话 / 1.19 GiB 压缩数据的解压统计）。
中间结果：`/tmp/scan2.tsv`（blank 判定）、`/tmp/scan4.tsv`（origin 分类 + 尺寸）。

**总量**
| 指标 | 数值 |
|---|---|
| workspace-slug 目录数 | 16（含 `_no-cwd`） |
| 会话目录数 | 2370（顶层 `sessions/` 直方图另计出 2371 行，多 1 行为空行/扫描伪影；权威口径以 2370 目录为准） |
| 内容文件数 | 2376（`session.jsonl.zstd` 2370 + `session.v3.jsonl.zstd` 3 + `session.lock` 3） |
| 内容文件总字节 | **1,243,901,331 B = 1186.28 MiB** |
| `du -sh ~/.dsh/sessions` | **1.2 GB**（与上一致，目录开销可忽略） |
| 单个会话均值 | **512.3 KiB**（中位数 246.8 KiB） |
| 分位 | min 311 B / p25 99.8 KiB / **median 246.8 KiB** / p75 539.2 KiB / p90 967.5 KiB / p99 5.1 MiB / max 21.8 MiB |
| ≥5 MiB 的会话 | **24 个（1.0%）占 197.5 MiB = 总量的 16.6%** |
| 会话年龄 | 512 个 2026-08 创建，1859 个 2026-09 创建（最早 2026-08-25，最新 2026-09-20）——**全部是最近 4 周内产生的** |

**按工作区（前 5 大）**
| workspace-slug | 会话数 | 字节 |
|---|---|---|
| `--home-CNS2026495165-Dexterous_Hand_23Dof-Dexterous_Hand_23Dof--` | 935 | 583.7 MiB |
| `--home-CNS2026495165-dsh--` | 481 | 250.9 MiB |
| `--home-CNS2026495165-Dexterous_Hand_23Dof--` | 572 | 212.6 MiB |
| `--home-CNS2026495165-RS--` | 115 | 45.3 MiB |
| `--home-CNS2026495165-math--` | 113 | 33.8 MiB |

**blank（空）会话量级 —— 本问的关键数字**
| 判定 | 数量 | 占比 | 字节 |
|---|---|---|---|
| 无 `turn/start` **且** 无 `user/message`（最严格的"完全空"） | **4** | **0.17%** | **4,786 B（4.7 KiB）** |
| 有 `user/message` 但无 `turn/start` | 0 | — | — |
| 其余（跑过至少一个 turn） | 2367 | 99.83% | 1,185.6 MiB |

> **结论：blank 会话清理的收益 ≈ 0（4 个 / 4.7 KiB / 0.17%）。**
> 交叉验证（另一条独立证据链）：`session_projcache.json` 中 `sessionStats.turns === 0` 的条目为 **38 个**——但 `turns` 与 `turn/start` 事件不是同一口径（`turns` 是统计投影，且该缓存无 GC、含历史陈旧行），且前端对 blank 的处理**只隐藏"非当前会话"的 blank 行**（`sessionVisible`: `(!session.blank || session.id === current)`）。**无论取 4 还是 38，相对于 2371 都是可忽略量级。**

### 4.3 真正的大头：origin 分类（**这是本次最重要的量化发现**）

同一轮扫描按首行 header 的 `origin` 字段分类（并用目录命名交叉验证，两类**完全一致**，无歧义）：

| 类别 | 目录命名特征 | 数量 | 占比 | 字节 | 占比 |
|---|---|---|---|---|---|
| **subagent 会话**（`"origin":"subagent"`） | `bare-uuid` | **2287** | **96.5%** | **902.4 MiB** | **76.1%** |
| 顶层用户会话（无 `origin` 字段） | `session-*` 前缀 | **81** | 3.4% | 281.2 MiB | 23.7% |
| 旧版 subagent（无 `origin` 但有 `parentSession`） | `session-*` 前缀 | 3 | 0.1% | 2.6 MiB | 0.2% |
| **合计** | | **2371** | 100% | 1186.1 MiB | 100% |

补充实测：subagent 会话**有** `session/title` 事件（1768 个 `SUBAGENT_TITLED` vs 520 `SUBAGENT_UNTITLED`），所以它们不是"未命名临时物"——它们是真实存在的完整轨迹。

**这对缩容裁决的意义（决定性）**：
- 前端 `sessionVisible()`（`dsh-client-ui-workspace/lib/client.js:101`）**第一条判据就是 `session.origin !== "subagent"`** —— 即 **2287 个 subagent 会话在侧边栏里本来就是一个都不显示的**。
- 但 `session.list` **仍把这 2287 条全量下发给浏览器**（§2.1 无过滤），前端的快照重建/派生仍然为它们付出随 N 增长的成本。
- 所以：**要真正降低 N，唯一有效的靶子是 subagent 会话（2287 条 / 902 MiB）**；而 81 个顶层会话中已有 67 个被归档（视觉上已隐藏），剩 14 个才是用户真正在意的。
- 但同时必须承认代价：删 subagent 会话 = 删掉 `subagent.history` 的全部可读轨迹，且 host 内存里若仍挂着该 subagent（continuable 子代理可冷恢复），会触发 §3.3(R1) 的僵尸目录问题。

---

## 5. 备份与回滚：最小代价方案（命令可直接复制；**本次未执行任何破坏性命令**）

### 5.1 关键前置实测

| 事实 | 实测结果 | 影响 |
|---|---|---|
| 文件系统 | `/dev/nvme0n1p2 ext4`（`/` 挂载点，1.92 TB，已用 7%） | — |
| 硬链接 | **支持**（`ln` 实测 OK，inode 相同，link count=2）；`cp -al` 递归硬链克隆实测 OK | 可用于"零字节"快照 |
| reflink / CoW | **不支持**（`cp --reflink=always` → `不支持的操作`） | 不能用 `--reflink` 做零成本快照 |
| host 是否持有会话 fd | **不持有**：`ls /proc/20806/fd \| grep sessions` = **0**；`appendLines()` 每次 `open(path,"a")` 后 `close()`（`index.js:1200-1227`） | 已冻结（历史）会话可安全复制/硬链；无长期打开的写入 fd |
| 归档是否需要备份 | **只要备份 `workspace.json`（7.8 KB）** | 归档的唯一状态就是那一个数组 |
| `storages` 全局 | 51 MB（其中 `usage.db` 36.7 MB、`session_projcache.json` 8.5 MB、废弃 `session_projcache/` 6.8 MB） | 元数据层备份可选 |

### 5.2 路径 A：归档 —— 备份 / 回滚（**最轻，12 KiB 级**）

```bash
# ── 备份（归档操作的唯一状态载体）───────────────────────────────
mkdir -p ~/dsh-session-backup/$(date +%Y%m%d-%H%M%S)
BK=~/dsh-session-backup/$(date +%Y%m%d-%H%M%S)
cp -a ~/.dsh/storages/workspace.json        "$BK/workspace.json"
cp -a ~/.dsh/storages/session_projcache.json "$BK/session_projcache.json"   # 可选：8.5 MB
ls -l "$BK"                      # 预期：两个文件，workspace.json ~7.8 KB
node -e 'const j=require(process.env.HOME+"/.dsh/storages/workspace.json");
         console.log("archived count =", j.global.archivedSessionIds.length)'
                                 # 预期：archived count = 67（当前基线）
```
**预期输出**：`workspace.json` 7802 B、`session_projcache.json` ~8.7 MB；`archived count = 67`。

```bash
# ── 回滚（撤销归档）──────────────────────────────────────────
# 1) 停风险最小化：确保 host 不会在你改写期间回写 workspace 域
#    （受支持做法：改完让页面刷新即可；host 会重读该域并重新下发归档集合）
# 2) 从备份还原整块状态
cp -a "$BK/workspace.json" ~/.dsh/storages/workspace.json
node -e 'const j=require(process.env.HOME+"/.dsh/storages/workspace.json");
         console.log("restored archived count =", j.global.archivedSessionIds.length)'
                                 # 预期：restored archived count = 67（= 备份时的值）
```
**预期输出**：还原后计数等于备份时快照；浏览器刷新后归档会话重新出现在侧边栏（因为 `workspace.list` 会重下发 `archivedSessionIds`，见 `api-proxy.js:2427`）。
**注意**：这**不是受支持入口**（没有 unarchive RPC，见 §1.5）。若只想"取消某一个会话的归档"，更安全的做法是**只删数组里那一个 id**并保留其余 66 个——但同样属手工改状态文件，有并发覆盖风险。

### 5.3 路径 B：删除 —— 备份 / 回滚（**按工作区粒度，推荐**）

**B-1 最省空间：先把元数据层备份（秒级、12 KiB）——回滚"索引一致性"用**
```bash
BK=~/dsh-session-backup/$(date +%Y%m%d-%H%M%S); mkdir -p "$BK/meta"
cp -a ~/.dsh/storages/workspace.json          "$BK/meta/"
cp -a ~/.dsh/storages/session_projcache.json  "$BK/meta/"
cp -a ~/.dsh/storages/usage/usage.db          "$BK/meta/"     # 36.7 MB；放最后
du -sh "$BK/meta"        # 预期：约 46 MB
```
**预期输出**：`~46M`。

**B-2 单工作区完整备份（推荐粒度，tar 不额外压缩——内容本身已是 zstd）**
```bash
# 以最大的工作区为例：935 个会话 / 约 584 MiB
BK=~/dsh-session-backup/$(date +%Y%m%d-%H%M%S); mkdir -p "$BK"
SLUG='--home-CNS2026495165-Dexterous_Hand_23Dof-Dexterous_Hand_23Dof--'
tar -C ~/.dsh/sessions -cf "$BK/$SLUG.tar" "$SLUG"
tar -tf "$BK/$SLUG.tar" | wc -l        # 预期：约 935（会话目录）→ 实际 936+ 行含目录自身
ls -lh "$BK/$SLUG.tar"                 # 预期：约 584 MiB
tar -tf "$BK/$SLUG.tar" | head -3      # 预期：SLUG/ 、SLUG/<uuid>/ 、SLUG/<uuid>/session.jsonl.zstd
```
**预期输出**：tar 文件 ≈ 584 MiB；`head -3` 显示工作区目录、一个会话目录、其 `session.jsonl.zstd`。

**B-3 零额外磁盘占用的"硬链接快照"（仅适用于已冻结的历史会话；实测支持）**
```bash
# 仅链接文件、不复制字节；已确认 append 是 open→write→close 且 host 不持 fd，
# 因此对"不再写入"的会话，硬链快照与真实副本等价（新数据会写进新 inode）。
BK=~/dsh-session-backup/$(date +%Y%m%d-%H%M%S); mkdir -p "$BK"
cp -al ~/.dsh/sessions "$BK/sessions-hardlink-snapshot"        # 零字节；实测 ext4 上可用
du -sh --apparent-size "$BK/sessions-hardlink-snapshot"        # 预期：1.2G（逻辑尺寸）
du -sh "$BK/sessions-hardlink-snapshot"                        # 预期：约 100MB 级或更低（仅目录开销）
find "$BK/sessions-hardlink-snapshot" -type f | wc -l          # 预期：2376
```
**预期输出**：`du`（无 `--apparent-size`）远小于 1.2 GB（只有目录项开销）；文件数 2376。
**⚠️ 限制（务必写进裁决）**：对**仍在写入**的会话，硬链共享 inode，源文件增长会同步出现在"快照"里 → **不是时间点快照**。所以硬链只适合"删之前给已冻结会话留个退路"，**不能替代 B-2 的 tar 真副本**。本部署 PID 20806 仍在运行且有活跃会话，混用会得到不一致快照。

**B-4 回滚（从 tar 还原）**
```bash
BK=~/dsh-session-backup/<你选择的那个时间戳>
SLUG='--home-CNS2026495165-Dexterous_Hand_23Dof-Dexterous_Hand_23Dof--'
tar -C ~/.dsh/sessions -xf "$BK/$SLUG.tar"          # 原地还原（覆盖同名文件）
# 校验：还原后的会话目录数应与备份时一致
find ~/.dsh/sessions/"$SLUG" -mindepth 1 -maxdepth 1 -type d | wc -l   # 预期：935
find ~/.dsh/sessions/"$SLUG" -name 'session.jsonl.zstd' | wc -l        # 预期：935
```
**预期输出**：935 / 935。
**回滚完整性提示**：还原会话目录**不会**还原 `usage.db` 的计费行，也**不会**清掉 `session_projcache.json` 里的陈旧行——这些层是"只增不减"的派生/账本数据，删除后不会报错（见 §3.2），但也不会自动回填。若要连账本一起回，需同时用 B-1 的 `usage.db` / `session_projcache.json` 副本还原。

**B-5 全量 tar（如需一次性整体快照）**
```bash
tar -C ~/.dsh -cf ~/dsh-session-backup/sessions-full-$(date +%Y%m%d-%H%M%S).tar sessions storages/workspace.json storages/session_projcache.json
ls -lh ~/dsh-session-backup/sessions-full-*.tar     # 预期：约 1.2 GiB
```
**预期输出**：约 `1.2G`。可用空间：ext4 已用 7%、剩余 1.71 TB，代价可接受。

---

## 6. 归档 vs 删除：可行性与风险对照表

| 维度 | **归档（archiveSession）** | **物理删除（删目录）** |
|---|---|---|
| 受支持入口 | **有**：UI 右键菜单 / `workspace.archiveSession` RPC | **无**：无 RPC、无 CLI、无 UI |
| 磁盘动作 | **无**（只改 `workspace.json` 一个数组） | 删除 `<slug>/<sessionId>/` 整个目录 |
| **能否降低 `/api/session.list` 的 N** | **❌ 不能（0 收益，已由源码 + 逐行核查证明）** | **✅ 能**（`listArtifacts` 直接不再枚举该会话） |
| 能否降低浏览器侧快照重建成本 | **❌ 不能**（payload 与派生输入不变） | **✅ 能** |
| 能否降低侧边栏可见行数 | **✅ 能**（render 期过滤） | ✅ 能 |
| 能否降低磁盘占用 | **❌ 不能（0 字节）** | ✅ 能（但 blank 只有 4.7 KiB；大头是 subagent 的 902 MiB） |
| 可逆性 | **设计可逆，当前无入口**：需手工编辑 `workspace.json`（非受支持，有并发覆盖风险） | **不可逆**（日志是唯一真相；恢复只能靠事先备份） |
| 对 `usage.db` / `projcache` 影响 | 无 | 产生孤立行/陈旧条目；**无 FK、无完整性风险、不报错** |
| 是否会导致启动报错 | 否 | **否**（`!pathExists → continue`，`parseHeaderMeta` 静默跳过） |
| 最大风险 | 手工改状态文件与内存态冲突；无 unarchive 入口，误操作难撤销 | **(R1) 删除仍挂在内存中的 live 会话 → 目录被 `mkdir recursive` 复活并生成永不可见的僵尸日志**；**(R2) `session.lock` 会话须避开**；**(R3) 不可回滚** |
| 推荐度 | 仅用于"清理侧边栏视觉噪音" | **唯一能降 N 的路径**，但必须①先确认非 live、②先 tar 备份、③只针对 subagent 会话 |

### 6.1 推荐缩容路径（供裁决）

1. **放弃"用归档降 N"这条路** —— 零收益，已被源码证实。
2. **先做元数据层备份**（B-1，12 KiB~46 MB，秒级），成本几乎为零，建议无条件先做。
3. **唯一有效的降 N 靶子 = subagent 会话**（2287 条 / 902.4 MiB / 占 N 的 96.5%，且**前端本来就不显示它们**）。若接受"丢失 subagent 轨迹"语义，对**最老的、非 live 的** subagent 会话做分阶段 tar 备份 + 删除，可把 N 从 2371 压到 ~84 量级，同时回收最多 900 MiB。
4. **不要为了省空间删顶层会话**：只有 81 个、却是用户的真实资产，且已有 67 个被归档隐藏；剩余 14 个是全部"还看得见的历史"。
5. **blank 清理不值得做**：4 个 / 4.7 KiB。
6. **若目标是"前端卡"而非"省磁盘"**，请以 `audit-client.md` / `audit-server.md`（同目录）的结论为准——本次调研已确认归档不是该问题的解，**真正的解在服务端做 subagent 过滤或分页**（`listVisibleSessionSummaries` 目前无任何分页/上限参数，见 §2.1）。

---

## 7. 明确"未找到"的项（不臆测）

| 事项 | 状态 |
|---|---|
| 取消归档（unarchive）的 RPC / CLI / UI 入口 | **未找到**（全安装树 grep 零命中） |
| 删除会话的受支持入口 | **未找到**（52 RPC 全枚举 + CLI 子命令 + UI 菜单，均无） |
| 会话保留策略 / 自动清理 / 配额配置 | **未找到**（`grep maxSessions\|sessionRetention\|retention\|prune\|vacuum` 在 `@local/*` 与 `dsh-workspace-enhancement` 中零命中；projcache 无 GC 参数） |
| 归档事件的 HTTP 直连验证 | **未执行**（按纪律 HTTP 探针 ≤5，本次选择 **0 次**；以源码 + 磁盘证据为准） |
| `~/.dsh/backups/` 是否包含会话数据 | **未找到**——实测 8.2 MB，内容是 `settings.yaml` / `taste.md` / 插件 lib 的手工 `.bak`，**不含任何会话数据、无自动会话备份机制** |
| `storages/session_projcache/sessions/` 1597 个文件的用途 | **推断为旧 JSON per-key 后端遗留**（全部 mtime = 2026-09-11，此后无写入；当前权威是单体 `session_projcache.json`）。**未找到**其读取方代码路径，无删除风险证据 |

---

## 附：本次调研的全部只读证据命令（可复现）

```bash
# 布局与总量
du -sh ~/.dsh/sessions
find ~/.dsh/sessions -mindepth 2 -maxdepth 2 -type d | wc -l          # 2370
find ~/.dsh/sessions -type f -printf '%f\n' | sort | uniq -c          # 3 种文件名
find ~/.dsh/sessions -type f -printf '%s\n' | awk '{s+=$1} END{print s}'   # 1243901331

# 全量 blank + origin 扫描（只读，5.6s）
/home/CNS2026495165/dsh/.workspace/settings-lag/scan_sessions.sh > /tmp/scan2.tsv

# 索引只读
node -e 'const{DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.env.HOME+"/.dsh/storages/usage/usage.db",{readOnly:true});console.log(db.prepare("select count(distinct session_id) c from usage_events").get())'
node -e 'const j=JSON.parse(require("fs").readFileSync(process.env.HOME+"/.dsh/storages/workspace.json","utf8"));console.log(j.global.archivedSessionIds.length)'

# 源码定位
grep -n "listVisibleSessionSummaries" -A 60 dsh-host-apiproxy/lib/types/api-proxy.js
grep -n "archiv" dsh-host-apiproxy/lib/types/api-proxy.js
grep -n "archiveSession" -A 12 dsh-workspace/lib/index.js
```

**报告作者**：只读调研（未修改 `~/.dsh` 任何数据；未触碰 PID 20806）
