# T23 · 办公入口 / office-handoff 在 0.2.0 的兼容性与迁移方案（审计档）

> **轨道**：T23（审计阶段 · 只读）｜**审计日期**：2026-09-29｜**迁移目标**：`0.2.0-rc.1`
> **纪律**：本档除 `.workspace/**` 外未写入任何路径；未修改、未回写 `~/.dsh/office-handoff/**`（仅只读读取文件结构、哈希与元数据）；
> 未启动任何监听端口的服务；未发起模型请求；未执行任何 office-handoff 命令（理由见 §7 未验证项）。
> **脱敏**：本档不含 journal 条目内容、不含任何 secret 值或凭据、不含会话正文与原始会话 id。
> 所有结论绑定本轮实测；"实测"与"源码推断"在文中逐条标注。

---

## 0. 结论摘要

| # | 问题 | 结论 | 证据强度 |
|---|---|---|---|
| C1 | `~/.dsh/office-handoff/` 归属 | **本地自研的独立 CLI 接收器 `dsh-office-handoff@0.1.0`**（零插件 Route A）。**不是** DSH 插件、**不是**官方包、**不是** skill。 | 源码 + 安装足迹 + 归属标记（实测） |
| C2 | `journal/*.json` 性质 | 每文件 = 一次"投递/回滚"决策的**可审计记录**；`v=1`；含绝对路径与内容哈希（**隐私相关，非凭据**）。 | 结构实测 + 写入者源码 |
| C3 | `journal.secret` 作用 | `op_seal`（HMAC-SHA256）的**密钥**；32 字节随机；`0600`。**不是鉴权**，只挡"手写一条 journal 让工具代删文件"的武器化路径 + 让篡改可检测。 | 源码（`lib/journal.js`） |
| C4 | **0.2.0 下是否仍可用** | **不可用（fail-closed 拒绝，零复制）**。且**断点在 0.1.7 而非 0.2.0** —— 0.2.0 只是继承了 0.1.7 的破坏。**三处独立破坏**，见 §4。 | 源码 + 生成物 + 隔离实测 |
| C5 | 与 `@deepseek-ai/dsh-skill-office` 的关系 | **毫无关系（命名撞车）**；该包是 Word/PowerPoint/Excel 文档处理 skill，且 **0.1.7-rc.2 就已存在**（不是 0.2.0 新增）。**无接管、无并存、无数据互通问题。** | 包内容 + 依赖清单（实测） |
| C6 | 是否必须迁移 `journal.secret` | **取决于是否保留 journal**：保留记录 ⇒ **必须与 `journal/` 一起迁移**（否则既有记录 seal 全部失效、回滚全部 fail-closed）；**不可重建**；权限必须 `0600`、长度必须 32 字节。丢弃记录 ⇒ 可一并丢弃。 | 源码（`lib/journal.js`） |
| C7 | 版本升级本身是否需要迁数据 | **不需要**。状态根是 `$DSH_HOME/office-handoff`，**与 DSH 版本无关**；只有 `$DSH_HOME` 变化才需要整体搬迁。 | 源码（`lib/state.js`） |
| C8 | 首要必修项 | **① 鉴权（401）② 端点命名（`/` 分隔）③ 锁标记重录**。前两项需改接收器代码（属方案，不属本档执行）。 | §4 / §6 |

**一句话**：办公入口是一个**自研的零插件桌面投递器**，它的全部宿主契约（无鉴权的 loopback `/api`、点号方法名 `workspace.list`/`workspace.create`）**在 0.1.7 就被官方一起换掉了**；0.2.0 沿用新形态。因此它在 0.2.0 上**必须重新设计接入方式**，而不是"改个版本号就行"。

---

## 1. 证据

### 1.1 状态根文件结构（只读实测，不含内容）

```
~/.dsh/office-handoff/            0700  CNS2026495165:CNS2026495165
├── journal/                      0700  dir
│   ├── 2026-09-28T02:37:13.107Z-<uuid>.json   0600  1182 B
│   ├── 2026-09-28T03:19:55.775Z-<uuid>.json   0600  1162 B
│   ├── 2026-09-28T03:19:58.785Z-<uuid>.json   0600   725 B
│   ├── 2026-09-28T03:20:30.858Z-<uuid>.json   0600  1162 B
│   └── 2026-09-28T03:20:45.594Z-<uuid>.json   0600  1162 B     （共 5 条）
└── journal.secret                0600  32 B    mtime 2026-09-28T10:37:13
```

- 命名规则 `<ISO8601>-<uuid>.json` 与源码 `lib/journal.js:156` 逐字一致（`${new Date(ts).toISOString()}-${opId}.json`）。
- `journal.secret` 大小 **恰为 32 字节**、权限 **恰为 0600**，与 `SECRET_BYTES = 32` / `openSync(file,"wx",0o600)` 一致（实测 + 源码）。
- **无 `spool/`、无 `lock.lock`、无 `README.md`、无状态根标记文件** —— 说明当前**无遗留锁**（不会卡死后续投递）、spool 干净。
- `journal.secret` 的 mtime（10:37:13）与最早一条 journal（10:37:13.107Z）同刻 ⇒ **secret 是在首次写 journal 时惰性创建的**（与 `ensureJournalSecret` 的调用点一致）。

### 1.2 写入者归属：源码级证据（这是本轮的核心归属证据）

**写入者 = 仓库内自研的独立 CLI 包，不是 DSH 插件。**

| 证据 | 位置 | 说明 |
|---|---|---|
| 包定义 | `workbuddy-reverse-proxy/office-handoff/package.json` | `"name":"dsh-office-handoff"`, `"version":"0.1.0"`, `"private":true`, `bin: {dsh-office-handoff: ./bin/dsh-office-handoff}` |
| 状态根解析 | `lib/state.js:21-29` | `$STATE = ${DSH_OFFICE_HANDOFF_STATE:-$DSH_HOME/office-handoff}`，`$DSH_HOME` 默认 `~/.dsh` ⇒ **精确解释 `~/.dsh/office-handoff/` 的来源** |
| journal 目录 + 文件名 | `lib/journal.js:24-28,144-171` | `JOURNAL_DIRNAME="journal"`、`SECRET_FILENAME="journal.secret"`、`RECORD_VERSION=1`、`<ISO>-<opId>.json`（`0600`）、原子写（`.tmp`→fsync→rename→fsync(dir)） |
| secret 语义 | `lib/journal.js:84-135` | `ensureJournalSecret`：32 字节随机、`0600`、长度/权限不符 ⇒ **fail-closed 且不自动重建** |
| seal 语义 | `lib/journal.js:58-82` | `sealOf` = HMAC-SHA256(canonicalize(record \ {op_seal,file}))；`sealMatches` 常量时间比较 |
| 实际安装足迹 | `~/.local/lib/dsh-office-handoff/`（bin/lib/README/归属标记）+ `~/.local/bin/dsh-office-handoff` → 符号链接 + `~/.local/share/nautilus/scripts/DSH-纳入工作区` | `install.sh` 头部注释逐条列出这些目标 |
| 归属标记 | `~/.local/lib/dsh-office-handoff/.dsh-office-handoff-owner` | `owner=` / `version=` / `installed_at=` / `manifest:`（逐文件 sha256）/ `lock_module=` / `lock_module_sha256=` |
| 交付件与安装件一致 | 实测 sha256 逐文件相等 | `lib/api.js` `f102fcee…`、`lib/journal.js` `05fa6608…`、`lib/lock.js` `dd3ad1bc…`、`lib/cli.js` `bddb71a9…`、`bin/dsh-office-handoff` `ccf5bb86…` —— 交付件与已安装件**逐字节相同**，故源码即运行态 |

**反向排他（重要）**：
- `~/.dsh/profiles/node_modules/@local/` 下 9 个本地插件（`dsh-btw`/`dsh-logfile`/`dsh-pptmaster`/`dsh-ssh-gui`/`dsh-subagent-model`/`dsh-usage`/`dsh-wallpaper`/`dsh-web-search-sse`/`dsh-workerspace`）中 **没有** office-handoff 相关项 ⇒ **它不注册任何 DSH 插件、不进 cordis 组合**。
- 仓库内 `grep -rn "office-handoff"` 命中集中在 `workbuddy-reverse-proxy/office-handoff/**`（自研交付树）、`reports/**`（报告）与 `docs/architecture/office-handoff.md`（文档）；**没有**任何 `@deepseek-ai/*` 官方包引用它。
- `workbuddy-reverse-proxy/office-handoff/` 在 git 中 **既未被跟踪也未被忽略**（`git ls-files` = 0，`git check-ignore` 无命中）——它是一个**未入库的自研交付树**；`~/.dsh/office-handoff/` 亦不在仓库内，**无 journal 泄漏进仓**（全仓未发现 `journal.secret` 或符合 journal 命名模式的 json）。

**触发路径**：Nautilus 右键脚本（`~/.local/share/nautilus/scripts/DSH-纳入工作区`）→ `exec "$HOME/.local/bin/dsh-office-handoff" --source=right-click -- "$@"`。脚本自身只转发、不 eval、不改盘。

### 1.3 它依赖的宿主契约（0.1.1 实测基线）

接收器对宿主**只有两处**依赖，都在 `lib/api.js` / `lib/lock.js`：

**(a) HTTP `/api` 通道**（`lib/api.js`）
- URL：`POST ${origin}/api/${method}`，`origin` 解析序 `--url` > `$DSH_WEB_URL` > **`http://127.0.0.1:3080`**（实测 `resolveOrigin({env:{}})` → `{"origin":"http://127.0.0.1:3080","source":"default"}`）。
- 信封：请求 `{type:"client-request", rpcId, method, payload}`；成功判定 = `type==="server-response" && rpcId 匹配 && result.ok===true && "value" in result`。
- 只用两个方法：`workspace.list`（探针，要求 `value.items` 与 `value.archivedSessionIds` 皆为数组）与 `workspace.create`（`payload={path}`，要求 `value.workspace.workspaceId`）；`workspace.delete` 仅用于隔离验收。
- **纪律**：请求头只发 `content-type: application/json`，**不发** `Origin` / `Sec-Fetch-Site`。

**(b) 跨进程锁模块**（`lib/lock.js`）
- 复用宿主 `@deepseek-ai/dsh-atomic-write` 的 `withFileLock`（自研锁被明令否决）。
- 解析序：① `$DSH_OFFICE_HANDOFF_ATOMIC_WRITE` → ② **安装期记录**（归属标记里的 `lock_module` + `lock_module_sha256`，路径由 `import.meta.url` 推导）→ ③ `PATH`/`$DSH_INSTALL_ROOT` 兜底 → ④ fail-closed。
- 记录解析到但 **sha256 不符 ⇒ 具名拒绝 `lock-module-changed`（退出码 10），绝不静默降级**。

### 1.4 隔离实测（全部在 `.workspace/audit-020/t23/sim/` 内，无网络、无服务、无模型请求）

复刻并运行了 `lib/lock.js` 与 `lib/api.js`（注入 `fetchImpl`，未发真实请求）：

| 实验 | 输入 | 实测输出 | 含义 |
|---|---|---|---|
| A · 当前真实归属标记 | 标记原样（记录 0.1.1 的 `lock_module` + sha `da4f2c9f…`） | `{"available":true,"source":"recorded","changed":false,"path":"~/.npm-global/…/dsh-atomic-write/lib/index.js"}` | **今天标记是一致的**（0.1.1 树仍在原位）⇒ 桌面投递的锁路径**当前可用** |
| B · 桌面场景（`PATH=/usr/bin:/bin`，无 `dsh`） | 同上 | 仍 `source:"recorded"` | **记录优先于 PATH** ⇒ 只要记录路径还在，PATH 无关紧要 |
| C · 显式覆盖指向 0.2.0 的 atomic-write | `DSH_OFFICE_HANDOFF_ATOMIC_WRITE=<aw020 路径>` | `{"available":true,"source":"env-or-path"}`，且 `import` 成功，**导出 `withFileLock, writeFileAtomic`** | **0.2.0 的锁模块 API 兼容**（实测） |
| D · 陈旧标记（记录 0.1.1 的 sha，磁盘为 0.2.0 文件） | 伪造 stale 标记 | `{"available":false,"changed":true, recordedSha256:"da4f2c9f…", actualSha256:"5f07978e…"}`；`locateAtomicWriteModule` **抛 `lock-module-changed`，exitCode=10** | **一旦记录路径的内容变了 ⇒ 全量 fail-closed，不降级** |
| E · 现行 probe 面对 0.2.0 语义（注入 fetch） | 忠实复刻 `endpointFromPath` + `claimsEndpoint` + 404 | `probe()` → `{"ok":false,"reason":"not-a-dsh-instance","httpStatus":404}` | 探针**失败**（详见 §4） |
| F · 换算成 0.2.0 wire 形态后 | `POST /api/workspace.list` / `/api/workspace.create`（点号） | 两者皆 **404 `not found`** | **点号形态在 0.2.0 上完全不被认领** |
| G · 斜杠形态 | `POST /api/session/list`、`POST /api/workspace/create` | 皆 **200 + 合法信封**（`session/list` → `value.items` 数组；`workspace/create` → `value.workspace.workspaceId` + `value.created`） | **迁移目标形态可行**；两方法在 0.1.1/0.1.7/0.2.0 三版都在 |

> E/F/G 的"注册面"取自 **0.2.0 生成的 Typert FaceModel**（真实端点清单，见 §4.2），不是臆造。

---

## 2. 机制归属结论

**`~/.dsh/office-handoff/` 完全属于本地自研的独立 CLI 接收器 `dsh-office-handoff@0.1.0`，与 DSH 官方包、官方 skill、任何本地插件的代码归属无关。**

分工上：

| 层 | 归属 |
|---|---|
| 数据（`$STATE/journal/*` + `journal.secret`） | 自研接收器私有格式（`v=1`），由 `lib/journal.js` 独占读写 |
| 逻辑（确认 / 复制 / 校验 / 回滚 / spool） | 自研接收器（`lib/*.js`，含 `zenity`/`notify-send` 的 OS 级确认通道） |
| 触点（Nautilus 右键） | `~/.local/share/nautilus/scripts/DSH-纳入工作区`（自研，零 MIME 关联足迹） |
| 宿主契约（唯一外部依赖） | `@deepseek-ai/dsh` 的 `/api` HTTP 通道 + `@deepseek-ai/dsh-atomic-write` 的 `withFileLock` |

⇒ **"办公入口"是"零插件 Route A"设计**：接收器不装插件、不改组合、不重启 DSH，只当一名"本地 HTTP 客户端 + 文件系统写入者"。

---

## 3. journal schema 说明（仅结构，不含内容）

**每条记录 = 一个文件；字段（并集，实测自 5 条记录）：**

| 字段 | 类型 | 出现 | 语义 |
|---|---|---|---|
| `v` | number | 5/5 | 记录结构版本，**全部为 `1`**（`RECORD_VERSION`） |
| `op_id` | string | 5/5 | 操作 id（uuid）；同 id 同时出现在文件名里 |
| `ts` | number | 5/5 | epoch ms；文件名的时间戳即由它 `toISOString()` 得来 |
| `op_seal` | string | 5/5 | `sealOf()` 的 HMAC-SHA256 十六进制摘要（**keyed MAC，不是明文可逆**） |
| `decision` | string | 5/5 | 决策类别枚举：本轮样本中为 **`copy`（4 条）** 与 **`rollback`（1 条）** 两类 |
| `result` | string | 5/5 | 结果枚举：本轮样本中全部为 `ok` |
| `workspace_root` | string | 5/5 | 目标工作区根（**绝对路径**） |
| `delivery_mode` | string | 4/4（仅 copy） | 投递模式，样本值 `copy` |
| `entry_source` | string | 4/4（仅 copy） | 入口来源，样本值 `right-click` |
| `atime_preserved` | boolean | 4/4（仅 copy） | "源文件元数据未变"验收位，样本全 `true` |
| `renamed` | boolean | 5/5 | 目标同名时是否自动另名（未覆盖） |
| `source` | object | 4/4（仅 copy） | 源侧身份：`bytes,dev,ino,mode,mtime_ns,path,realpath,sha256,uid` |
| `dst` | object | 5/5 | 目标侧身份：`bytes,dev,ino,path,realpath,sha256`（rollback 记录**无 `mode`**） |
| `rollback_of` | string | 1/5（仅 rollback） | 指向被回滚的 `op_id`（`isRolledBack` 据此判定"已回滚"） |
| `reason` | string | 1/5（仅 rollback） | 回滚原因短标识 |

**关于"是否含敏感信息"（明确回答）**：

| 类别 | 是否含 | 说明 |
|---|---|---|
| 文件**内容** | **否** | 只有 metadata，正文从不入库 |
| 凭据 / token / 密码 | **否** | 无任何凭据字段 |
| `journal.secret` 的值 | **否** | `op_seal` 是 HMAC 输出；32 字节随机密钥**不可由 seal 反推** |
| **绝对路径（源 + 目标 + realpath + workspace_root）** | **是** | ⚠️ 会暴露"用户投递过哪些文件、放在哪里、目标工作区绝对路径" ⇒ **隐私敏感** |
| **内容哈希 sha256 + dev/ino + uid + mode + mtime_ns** | **是** | 可用于**跨位置关联同一文件**（私有指纹语义） |
| 会话正文 / 会话 id | **否** | journal 里不存在任何会话字段 |

⇒ **处置纪律**：journal **不是"含密钥文件"，但属"隐私敏感元数据"**。不得入库、不得贴进报告/工单、不得跨用户复制；备份件同样按 `0700/0600` 保护。

**`journal.secret` 的保护方式与性质（源码级，`lib/journal.js`）**：
- 32 字节 `randomBytes`，`openSync(file,"wx",0o600)` 创建（`wx` ⇒ 不覆盖既有文件）。
- 每次取用都校验**长度必须 32**、**权限必须恰为 `0600`**、**父目录 0700 且属主 == euid**；任一不符 ⇒ 具名拒绝（`journal-secret-malformed` / `journal-secret-permissions` / `state-root-not-owned`）**且不自动重建**（源码注释明写：重建会让既有记录全部无法校验并掩盖异常）。
- **它在设计上不是安全边界**（模块头注释 + `rollback.js` 注释 + 一条**故意演示可伪造**的测试用例）：secret 与 journal 同 UID 可读 ⇒ 同 UID 进程**可以**伪造出通过 seal 的记录，也**本来就能直接 unlink** 目标文件。seal 的真实价值只有两条：挡掉"手写一条 journal 让工具替我删文件"的武器化路径；让"记录被改过"**可被检测**。

---

## 4. 0.2.0 可用性判定

### 判定：**不可用**。三处**独立**破坏，其中第一处（鉴权）直接否决每一次请求。

> ⚠️ **断点勘误（重要）**：破坏发生在 **0.1.7-rc.2**，**不是** 0.2.0 引入的。0.2.0 只是继承了 0.1.7 的 `/api` 形态。历史报告 `reports/19-17-breaking-changes.md:135` 已记载 `dsh-host-apiproxy`「**下线**（末版 0.1.5-rc.3，组合行 `api-gateway` 同删）」。本轮以**当轮实测**独立复核并**补齐了它没覆盖的 `/api` 语义变化**。

### 4.1 破坏一：`/api` 变成**浏览器会话鉴权门**（HTTP 401）——最先触发

| 版本 | `/api` 鉴权 | 实测/源码 |
|---|---|---|
| 0.1.1-rc.2（现役 3080） | **无** | `dsh-client-connection/lib/index.js` 中 `browserAuth`/`isAuthenticated` **命中数 = 0**；其 `createSharedFetchHandler(channel, fallback)` 带 **fallback**（落到 apiproxy，即点号方法名） |
| 0.1.7-rc.2（隔离 3097） | **有（cookie）** | `dsh-client-connection/lib/index.js:412,424,433,449,588`：`browserAuth` + `isAuthenticated` + `"dsh web authentication required; reopen the URL printed by dsh web."` |
| 0.2.0-rc.1 | **有（cookie）** | 同上 `:433-443`、`:586-594`、`:829-845` |

0.2.0 的 `/api` 前缀路由（`dsh-client-connection/lib/index.js:829-845`）：

```js
const fetchHandler = connection.createSharedFetchHandler(API_PATH);
const route = { kind:"prefix", path: API_PATH, handler: async (req,res) => {
    const admission = connection.admit(req);
    if ("rejection" in admission) { res.writeHead(admission.rejection); ... return; }   // 403 / 401
    await webCtx.waterfall("connection/request", req, res, () => bridge(req,res,fetchHandler, ...));
}};
```
`admit` → `requestRejection`（`:586-594`）：`isTrustedApiRequest` 不过 ⇒ **403**；过了但 `browserAuth.isAuthenticated` 为假 ⇒ **401**。

`isAuthenticated`（`:433-443`）**只**接受 **authority 绑定的浏览器 cookie**：必须有 `cookie` 头、必须有 `dsh-auth-<authority>`、必须由本次激活的签名密钥签出、且未过期。**没有 cookie ⇒ 直接 false ⇒ 401。**

而 `apply()`（`:812-819`）**无条件**构造 `BrowserAuth.create(ctx.root, ctx.credentials, …)`；`Config` schema（`:799-804`）**只有** `recovery / trustedHosts / cookieMaxAgeDays / maxRequestBodyBytes`，**没有任何开关能关掉浏览器鉴权**。

签名密钥来自凭据存储（`initializeSecret`，`:325-342`）：`credentialKey("client-connection","browser-session")` 的 `grant` 记录；实测 `~/.dsh/.credentials.yaml` 中**存在** `client-connection` 这一 key（**仅核对 key 名，未读取任何值**）。

**⇒ 结论**：接收器**只发 `content-type`**（这是它刻意的纪律），因此拿不到 cookie。**每一次 `POST /api/*` 都会在进入路由前被 401 拒**。这不是端点问题，是**通道问题**：
- 唯一合法凭证是（i）**进程启动令牌**——`PROCESS_LAUNCH_TOKENS` 的 WeakMap，**进程内内存态**，只出现在 `dsh web` 打印的 URL（`authenticatedUrl`，`:374-378`）里，**不落盘、不可从文件系统发现**；或（ii）**已签发的浏览器 cookie**。
- 于是"**零插件 Route A**"（裸 loopback + 只发 content-type）在 0.1.7+ **结构性地不再成立**。

### 4.2 破坏二：方法名从**点号**改为**斜杠**（`namespace/method`），且 `workspace.list` 被删除

**端点清单（0.2.0 生成的 Typert FaceModel，权威）**：`dsh-api-workspace-controller/lib/typert.host.js` 中 `WorkspaceController` 的 Remote 条目为
`workspace/create`、`workspace/delete`、`workspace/rename`、`workspace/initializeDefault`、`workspace/insertBefore`、`workspace/insertSessionBefore`、`workspace/archiveSession`、`workspace/unarchiveSession`、`workspace/pinSession`、`workspace/unpinSession`、`workspace/follow`(**stream**) —— **没有 `workspace/list`**。

- 组合规则（`dsh-typert-registry/lib/index.js:28-35`）：`typertEndpoint(d) => \`${d.namespace}/${d.method}\`` ⇒ **端点 = `workspace/create`（斜杠）**。
- 认领判据（`dsh-api-gateway/lib/index.js:690-697`）：`endpoint.split("/").length !== 2 ⇒ false` ⇒ **点号单段的 `workspace.create` 永不被认领**。
- 未认领的结局（`dsh-client-connection/lib/index.js:608-620`）：`return new Response("not found", { status: 404 })` ⇒ **404**。
- 端到端交叉核对（实测）：`grep -rl 'workspace\.list'` → 现役 **0.1.1 安装树 17 个文件**；而 `~/.npm-global-dsh017`（**正在服务 3097 的 0.1.7 实装树**）与 0.2.0 全树 **各 0 个文件**；`#workspace/list` 条目在 017/020 的 `typert.host.js` 中**均为 0**。

**⇒ 结论**：
| 接收器调用 | 0.1.1 | 0.1.7 / 0.2.0 |
|---|---|---|
| `POST /api/workspace.list`（探针） | 200 + `{items,archivedSessionIds}` ✅ | **不存在该端点 + 分隔符不符 ⇒ 404** ❌ |
| `POST /api/workspace.create`（登记工作区） | 200 + `{workspace,created}` ✅ | **分隔符不符 ⇒ 404** ❌ |

**失效顺序（对用户可见的形态）**：`cli.js:811` 的 `probe()` 先跑，失败即走 `api-unreachable` 分支（`cli.js:815-847`）⇒ **只入 spool + 一条桌面通知 + 非零退出（9），零复制、零登记**。因此**不会出现"复制了但没登记"的中间态**（fail-safe，这点值得肯定）；但同时意味着 **0.2.0 下办公投递 100% 不可用**。

### 4.3 破坏三：锁标记陈旧风险（条件触发，且**不降级**）

- 归属标记当前记录的 `lock_module` 指向 **0.1.1 实装树**内的 `@deepseek-ai/dsh-atomic-write/lib/index.js`，`lock_module_sha256 = da4f2c9f…`（实测，与磁盘该文件**当前一致** ⇒ 今天标记有效，实验 A）。
- 0.1.7 与 0.2.0 的该文件 **sha256 = `5f07978e…`**（实测；两者**互为逐字节相同**，`diff` 无差异；导出仍为 `withFileLock` + `writeFileAtomic`）。
- ⇒ **若** 0.2.0 是**原地覆盖/移除**该路径（in-place 升级，或卸载 0.1.1），标记立刻**陈旧** ⇒ 实验 D 实测：`changed:true` ⇒ `locateAtomicWriteModule()` **抛 `lock-module-changed`，退出码 10，且明令不静默退回其它候选**。
- ⇒ **若** 0.2.0 装在**另一个根**且 0.1.1 树保留原位（本次迁移是"全新隔离根"），则标记**继续有效**、锁路径**照常工作**（实验 A/B）。
- 附带发现：`install.sh` 的状态根判定（`install.sh:204-210` → `scripts/ownership.sh:143-153`）要求 `$STATE` 里有**标记文件**或**与交付 README 逐字一致的 README.md**；而 `~/.dsh/office-handoff/` **两者都没有** ⇒ 重装时 `STATE_ACTION=skip`（不 chmod、不写 README，仅提示）。**这是良性的**（不拒绝、不报错），且**不影响**锁标记重录——因为锁标记在 `~/.local/lib/dsh-office-handoff/`，不在 `$STATE`。

### 4.4 附带的契约漂移（供后续改造一并处理，非本次阻断项）

| 项 | 0.1.1 | 0.2.0 | 影响 |
|---|---|---|---|
| 错误码命名 | `workspace-not-found`、`workspace-invalid-path`、`bad-request`（连字符） | `workspace/not-found`、`workspace/invalid-path`、`workspace/name-conflict`、`gateway/bad-request`（**斜杠命名空间**） | 接收器 `deleteWorkspace` 里 `code === "workspace-not-found"` 的"已消失"判定将不再命中（仅用于隔离验收路径） |
| `workspace.list` 的继任者 | — | `workspace/follow`（`invocation: {kind:"stream"}`，走 **WebSocket `/api/remote.mux`**）；baseline 帧 `{items, archivedSessionIds, pinnedSessionIds}` | 探针若改用它，需实现 **WS 流客户端**（重量级） |
| rpcId 校验 | `z.string()` | `z.string()` | **无变化**，`dsh-office-handoff-1` 仍合法（实测比对源码） |
| 信封形状 | `client-request`/`server-response` + `result.ok/value` | **同**（`clientRequestSchema`/`fullResponse`） | **无变化** |

**⇒ 0.2.0 数据格式是否需要迁移**：**不需要**。journal 是接收器私有格式，`v=1` 且与 DSH 版本无耦合；DSH 升级不改也不读它。需要改的是**接收器的宿主接入代码**，不是数据。

---

## 5. 与 `@deepseek-ai/dsh-skill-office` 的关系

### 结论：**毫无关系（命名撞车）**。无"接管"、无"并存"、无"数据互通"问题。

**证据（均实测）**：
1. **它是什么**：`pkg020/x-deepseek-ai-dsh-skill-office-0.2.0-rc.1/package/package.json` → `"description": "Bundled Word, PowerPoint, and Excel workflows and structural checks"`；资产为 `assets/office-pptx|office-docx|office-xlsx/SKILL.md` + `assets/scripts/check_office.py`；README 自述"Mount this provider beside the skill registry and `dsh-tool-skill` to expose `office-docx`, `office-pptx`, `office-xlsx` in the session catalog"，依赖 `@deepseek-ai/libreoffice-kit`。
   ⇒ 它是**"文档格式读写 skill"**（模型在会话内生成/编辑 Office 文件），与**"把办公文件从桌面投递进工作区"**是**两个完全不同的方向**。
2. **它不是 0.2.0 新增**：`lib/index.js` 在 **0.1.7-rc.2 与 0.2.0-rc.1 中 sha256 完全相同**（`203d1680ef0f6f35f5885aa2b6050a33ef0294ed0aa5ec9441dada9e0b987d84`，两者 `3981` 字节）；且它是伞包 `@deepseek-ai/dsh` 的依赖 **两版都在**（0.1.7 `0.1.7-rc.2` / 0.2.0 `0.2.0-rc.1`）。
3. **它不可能接管**：`@deepseek-ai/dsh-skill-office` 只暴露 skill 资产，**不注册任何 `/api` 端点、不写 `$STATE`、不碰 Nautilus、不认识 `journal/`**；`~/.dsh/office-handoff/` 与它**零交集**。
4. **0.2.0 也没有原生替代**：0.2.0 的"办公"相关官方能力方向是 **DSH → OS**（如 `session/openWorkspacePath`：请求 `{path, action?:'reveal', application?}`、返回 `{opened:true}` —— 让宿主用本机程序**打开**工作区里的文件），**不是** OS → DSH 的**投递**。实测 `@deepseek-ai/dsh-base@0.2.0-rc.1` 的 93 个依赖中**没有任何 office/pdf/libre 相关宿主包**。⇒ **0.2.0 没有可"接管"办公入口的官方机制。**

### ⚠️ 顺带勘误（对协调者 PLAN.md 的前提修正，实测）

`PLAN.md`「已核实事实」称 *"0.2.0-rc.1 相对 0.1.7 新增依赖：`dsh-skill-office`、`dsh-tool-subagent-control`、`dsh-workflow-ptc`"* —— **与实测不符**。对伞包 `@deepseek-ai/dsh` 的 `dependencies` 做 0.1.7-rc.2 → 0.2.0-rc.1 全量 diff：

- **ADDED（1 个）**：`@deepseek-ai/dsh-experimental-schedule-bundle@0.2.0-rc.1`
- **REMOVED（0 个）**
- 上述三个包在 **0.1.7-rc.2 就已存在**：`dsh-skill-office@0.1.7-rc.2`、`dsh-tool-subagent-control@0.1.7-rc.2`、`dsh-workflow-ptc@0.1.7-rc.2`。

（`dsh-base` 的 diff 同样只有 `+@deepseek-ai/dsh-otel`。若 PLAN 的口径来自 npm 上新发布的包列表而非伞包依赖，请以本条实测口径校正表述。）

---

## 6. 迁移保留方案与命令

### 6.1 决策矩阵（建议）

| 事项 | 建议 | 理由 |
|---|---|---|
| journal 数据 | **原地保留，不迁移** | `$STATE` 由 `$DSH_HOME` 决定，**与 DSH 版本无关**；DSH 升级不动 `$DSH_HOME` ⇒ 数据无需移动（C7） |
| `journal.secret` | **与 `journal/` 同生共死**：保留记录 ⇒ **必须一起备份/迁移**；丢弃记录 ⇒ 可一并丢弃 | 不可重建；丢失 ⇒ 既有记录 `journal-seal-mismatch` ⇒ 回滚全部 fail-closed（C6） |
| 锁标记 | **必须重录**（且要确保探针解析到目标版本的 atomic-write） | 0.2.0 的 `dsh-atomic-write/lib/index.js` 与 0.1.1 不同源（`5f07978e…` vs `da4f2c9f…`）；不重录则原地升级后必抛 `lock-module-changed`（§4.3） |
| 接收器代码 | **必须改造**（鉴权 + 端点命名），或在改造完成前**明确停用办公入口** | §4.1 / §4.2：0.2.0 下 100% 失败 |
| 改造前的用户可见行为 | 已是 fail-safe：**只入 spool + 桌面通知 + 退出码 9，零复制零登记** | `cli.js:815-847`；无中间态、无数据损坏 |

### 6.2 备份（含 secret，保留权限）——**可复制执行**

```bash
# B1. 备份状态根（含 journal/ 与 journal.secret），保留 0700/0600
BK="$HOME/dsh-office-handoff-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BK" && chmod 700 "$BK"
tar -C "$HOME/.dsh" -cpf "$BK/office-handoff.tar" office-handoff
```
**预期输出**：无输出（成功）；`echo $?` → `0`。
```bash
# B2. 校验：归档清单 + 权限位 + 逐条哈希（不打印任何条目内容）
tar -tvpf "$BK/office-handoff.tar"
```
**预期输出**：形如
```
drwx------ … office-handoff/
drwx------ … office-handoff/journal/
-rw------- … office-handoff/journal/2026-09-28T02:37:13.107Z-<uuid>.json
…（共 5 个 .json）
-rw------- … office-handoff/journal.secret      # 大小必须恰为 32
```
```bash
# B3. 内容哈希清单（脱敏：只记路径摘要与哈希，供迁移后比对）
tar -xOf "$BK/office-handoff.tar" office-handoff/journal.secret | sha256sum
find "$HOME/.dsh/office-handoff/journal" -name '*.json' -exec sha256sum {} + | sort -k2
```
**预期输出**：`journal.secret` 一行 32 字节文件的 sha256；5 行 json 的 sha256。**把这两组输出存进 `.workspace/**` 作为迁移前后比对基线（注意：该基线含隐私路径，按 §3 纪律保存，勿入库）。**

### 6.3 重录锁标记（关键步骤，必须让探针解析到 0.2.0 的 atomic-write）

```bash
# L1. 先确认 0.2.0 的 atomic-write 真实位置与其 sha256
find <0.2.0 安装根> -path '*@deepseek-ai/dsh-atomic-write/lib/index.js' -print
sha256sum <该路径>
```
**预期输出**：1 条路径；sha256 = `5f07978ef594a2711b2da301d5cb73a835cf1a48c1f8920ab5c6625137e12029`（本轮实测值；若 0.2.0 最终版有变更，以 L1 实测为准）。

```bash
# L2. 【关键】用显式覆盖让探针指向 0.2.0 —— 否则标记会把 0.1.1 的旧指针再记一遍
export DSH_OFFICE_HANDOFF_ATOMIC_WRITE="<L1 得到的路径>"
"$HOME/.local/bin/dsh-office-handoff" --probe-lock-module
```
**预期输出**：一行绝对路径（等于 `$DSH_OFFICE_HANDOFF_ATOMIC_WRITE`），退出码 `0`。
**失败形态**：stderr `锁模块探针：解析不到 …（无输出）。` + 退出码 `10` ⇒ **不要继续**（标记会缺 `lock_module` 行，桌面路径将 fail-closed）。

> ⚠️ **为什么必须用 L2 的 env 覆盖**：`lockStatus()` 的优先级是 **env 覆盖 > 安装期记录 > PATH**。当前标记记录的是 0.1.1 的指针且该文件仍在 ⇒ 若不设 env，探针会**原样返回 0.1.1 的路径**，重装等于**什么都没修**。同理：`install.sh` 调用探针时会**继承环境**，所以 `DSH_OFFICE_HANDOFF_ATOMIC_WRITE=… bash install.sh` 是能生效的。

```bash
# L3. 重装以重录标记（dry-run 先看，零写入）
DSH_OFFICE_HANDOFF_ATOMIC_WRITE="<L1 路径>" bash <office-handoff 交付树>/install.sh --dry-run
```
**预期输出**：`── 预检（零写入）──` 下逐目标 `OK`（**因交付件与已装件逐字节相同，预检应全 OK**），并出现
`将记录锁依赖    <L1 路径>`；`状态根已存在但**不是本工具的** ⇒ 不 chmod、不写文件，仅提示：…/office-handoff`（良性，见 §4.3）。

```bash
# L4. 正式重装
DSH_OFFICE_HANDOFF_ATOMIC_WRITE="<L1 路径>" bash <office-handoff 交付树>/install.sh
```
**预期输出**：`安装完成` 类收尾；随后标记应含新指针：
```bash
grep -E '^(owner|version|lock_module|lock_module_sha256)=' "$HOME/.local/lib/dsh-office-handoff/.dsh-office-handoff-owner"
```
**预期输出**：4 行；`lock_module=` 为 **0.2.0** 路径，`lock_module_sha256=` 为 **`5f07978e…`**（不再是 `da4f2c9f…`）。

```bash
# L5. 复验（不带 env，模拟桌面进程的真实环境）
env -u DSH_OFFICE_HANDOFF_ATOMIC_WRITE "$HOME/.local/bin/dsh-office-handoff" --probe-lock-module
```
**预期输出**：仍打印 **0.2.0** 的路径，退出码 `0`（证明标记已自洽，不再依赖 env）。

### 6.4 数据完整性校验（迁移/改动前后）

```bash
# V1. journal 可读性 + 记录条数 + secret 在位（只读；不打印内容）
"$HOME/.local/bin/dsh-office-handoff" --list-journal --json | jq '{dir, secretPresent, records: (.records|length), malformed}'
```
**预期输出**：`secretPresent: true`、`records` 计数与文件数一致、`malformed` 为空数组。
> 说明：`--list-journal` 只读读取；`main()` 前置的 `ensureStateRoot` 仅在目录**权限不是 0700** 时才会 `chmod`，当前已是 `0700` ⇒ 实测预期为**零写入**。**本审计档按约束未执行该命令**（§7）。

```bash
# V2. 迁移后逐条比对（权限 + 哈希），与 B3 基线对照
stat -c '%a %U %s %n' "$HOME/.dsh/office-handoff" "$HOME/.dsh/office-handoff/journal" "$HOME/.dsh/office-handoff/journal.secret"
find "$HOME/.dsh/office-handoff/journal" -name '*.json' -exec sha256sum {} + | sort -k2
```
**预期输出**：`700` / `700` / `600`（`journal.secret` 大小 **32**）；5 行哈希与 B3 逐条一致。

### 6.5 改造方向（**方案，不属本档执行**；供协调者裁决）

办公入口在 0.1.7+ 需要重新选型，实测支持的候选：

| 选项 | 内容 | 评价 |
|---|---|---|
| **A. 最小代码改造：改端点 + 拿凭证** | ① 方法名改斜杠形态（`workspace/create`）；② 探针改用**跨三版都存在**的只读方法 `session/list`（payload `{}` → `value.items` 数组；0.1.1/0.1.7/0.2.0 契约**完全一致**，实测比对）；③ 通过读取凭据存储的 `client-connection/browser-session` 密钥**自签 cookie** | 实测 G 证明 ① 可行（200 + 合法信封）；② 探针替换在返回形状上与现行 `probe()` 判定完全对齐。但 ③ 让接收器**变成 cookie 伪造器**，与它"只发 content-type"的既有设计纪律直接冲突，并耦合内部凭据记录格式 ⇒ **需协调者就安全口径裁决** |
| **B. 改走 host 侧插件（Route B）** | 由插件注册本地端点 / 提供文件系统 spool + 观察者 | 与 0.1.7+ 架构对齐；但 `docs/architecture/office-handoff.md` §1 记载 **Route B 曾被明确否决**（"Route A 为 MVP 唯一主线"）⇒ **是裁决重开，不是实现细节** |
| **C. 暂时停用办公入口** | 保留数据、撤下 Nautilus 脚本与入口符号链接，待方案落定再恢复 | 零风险；用户可见行为等价于当前在 0.2.0 上的实际结果（spool + 通知，零投递） |
| **D. 降级为 spool-only** | 去掉 `/api` 依赖，只把候选文件收进 spool，由用户在会话内手工消化 | 保住"文件不丢"，但失去"自动登记为工作区"的核心价值 |

**不推荐**：试图把 `dsh-host-apiproxy`（0.1.5-rc.3 已下线）装回 0.1.7+/0.2.0 来复原点号方法 —— 组合行 `api-gateway` 同删，且会与现行 `api-gateway` 争 `/api` 拦截器（`registerInterceptor` 对同一 channel **只允许一个**，重复注册直接 `throw`）。

---

## 7. 未验证项（明确边界）

| # | 未验证 | 原因 | 影响 |
|---|---|---|---|
| U1 | **未对运行中的 3080 / 3097 发任何请求** | 硬约束"不得触碰现役/隔离实例" | 401 / 404 的**线上实测**未做；§4 的 HTTP 结论为**源码级 + 隔离模拟**（§1.4 E/F/G），非端到端实跑 |
| U2 | **未执行任何 office-handoff 命令** | 硬约束"不得修改 `~/.dsh/office-handoff/**`"；`main()` 前置 `ensureStateRoot` 含 `mkdirSync`/条件 `chmod`，无法从外部绝对证明零写入 | `--list-journal` / `--probe-lock-module` 的**运行时输出**为源码推断；§6 命令的"预期输出"据此标注 |
| U3 | 未验证"读取凭据存储自签 cookie"是否真能通过 `isAuthenticated` | 需读凭据值（本档禁令）且需对活实例发请求 | 选项 A 的 ③ 目前是**源码可行**，未经端到端确认 |
| U4 | 未验证 0.2.0 最终版（非 rc）是否再次变更 `/api` 形态 | 迁移目标为 `0.2.0-rc.1` | 结论绑定 `0.2.0-rc.1` 与 `0.1.7-rc.2` 两个确定版本 |
| U5 | 未验证 `workspace.follow`（WS）能否被非浏览器进程使用 | 需实跑 WS 客户端 + 活实例 | 仅作为"探针继任者"备选项记录，未评估可行性 |
| U6 | 未审计 0.2.0 下 `zenity`/`notify-send` 确认通道与桌面环境交互 | 超出本轨道范围 | 属办公入口的**另一条**兼容轴（OS 侧），建议另立轨道 |
| U7 | 未审计 spool 数据（当前为空）与 `--drain` 语义在 0.2.0 的影响 | 本机 spool 为空、且与 DSH 版本无耦合 | 预期无影响（源码层面 spool 不依赖宿主） |

---

## 附：本轮新增的可复现产物（均在 `.workspace/**` 内）

- `.workspace/audit-020/t23/sim/lib/*.js` —— 自 `~/.local/lib/dsh-office-handoff/lib/` 复制的只读副本（与交付件逐字节相同，sha256 见 §1.2）
- `.workspace/audit-020/t23/sim/lock-probe.mjs` —— 实验 A–D 脚本（锁解析/陈旧标记）
- `.workspace/audit-020/t23/sim/probe-sim.mjs` —— 实验 E–G 脚本（0.2.0 语义下的探针行为，注入 `fetchImpl`，**无网络**）
- `.workspace/audit-020/t23/sim/.dsh-office-handoff-owner` —— 归属标记副本（实验 D 中被改造为 stale；**真实标记未被触碰**）
- 未创建任何监听端口的进程；未产生任何出网请求。
