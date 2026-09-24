# w17-tools 审计：**工具执行路径**（宿主侧成本链 / 长任务与后台作业 / 输出体量与截断 / 审批权限 / 失败与超时可观测性）

- 线：`w17-tools`（独占 `.workspace/lag-fix/program/w17-tools/`）
- 日期：2026-09-22（跨冷面重启：宿主 **301709 → 2988915**，18:11:49 重启）
- 纪律：**全程只读**；未改任何产品文件/profile；未传 `sandbox_permissions`；未 kill/pkill/重启任何进程；未回收任何锁；测试载荷只落本线临时目录
- 产品包根 `$PKG = /home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`（197 包）
- 原始数据：`raw/measurements.json`；探针与证据：`raw/probe/`；两个子代理产物：`raw/subagent-A-jobs.md`（351 行）、`raw/subagent-B-approval-observability.md`（347 行）

---

## 0. 方法与口径（先读，否则数字会被误用）

**宿主进程是单 Node 进程，且本窗严重受污染。** 采样 216 s 实测：

| 标定项 | 实测 |
|---|---|
| 宿主 CPU | **182.90 cpu-s / 216.0 s = 84.7% 单核**（持续） |
| 宿主线程数 | 12（恒定） |
| 宿主 RSS | 5966 MB → 6705 MB（**+738 MB / 167 s**） |
| 同窗兄弟线 | 11 条以上审计/执行档在飞（peer board） |

⇒ 依 `BATCH-PLAN §五.7`（受污染实测膨胀 Script 4.5–10.3× 等）与 §五.2：
**任何"每次工具调用的宿主侧绝对 CPU"在本窗不可归因** —— 我把采样到的"调用间隙 CPU/wall 比"逐个算过，落在 **0.52–0.94**，与 0.847 的基线一致，即间隙 CPU **全部是背景负载**，不是该调用造成的。
所以本报告的所有量化结论只用两类判据：**① 结构性（file:line 代码路径）② 比值/为零/精确恒等式**。唯一例外是 §3 的截断链，它是我用**精确算术闭合**验证的（预测值 = 实测值，跨两个宿主实例复现）。

**"同窗对照"我用的是：同一条助手消息内的 N 个同类调用**（同一窗口、同一宿主、同一负载），因此比值不受绝对污染影响。

---

## 1. ① 每次工具调用的宿主侧成本链（逐段 file:line + 实测）

### 1.1 成本链全段（12 段，全部落到行）

| # | 段 | file:line |
|---|---|---|
| 1 | 解析/参数校验 | `dsh-agent-loop/lib/index.js:193` → `dsh-tools/lib/index.js:3091,3094`；`:3045` `snapshotJsonValue` + `:3049` `deepFreeze`；工具自身 `dsh-tool-bash/lib/index.js:119-125` `validateBashArgs` |
| 2 | `tools/pre-execute` 瀑布 | `dsh-tools/lib/index.js:3105` `ctx.waterfall(carrier,"tools/pre-execute",exec,…)` |
| 3 | 审批（仅 `gate.kind==="ask"`） | `dsh-tools/lib/index.js:3106` `serviceAsk`；bash 升级 `dsh-tool-bash/lib/index.js:238-241` → `dsh-sandbox/lib/index.js:94-108` → `dsh-user-approval/lib/index.js:146,188` |
| 4 | 守卫否决 | `dsh-tools/lib/index.js:3113` `guardReason` |
| 5 | 沙箱策略解析（盖章 mode+workspaceRoot） | `dsh-tool-bash/lib/index.js:245` `resolveSandboxPolicy` → `dsh-sandbox-policy/lib/index.js:138-142` |
| 6 | **spawn** | `dsh-bash-local/lib/index.js:236`（前台）/ `:273`（后台）；`dsh-subprocess-local/lib/index.js:803` `detached: platform !== "win32"` |
| 7 | 输出捕获（内存尾窗 + spill） | `dsh-subprocess-local/lib/index.js:601-613,624-672,693-702`；spill 目录 `:597-600` `mkdtempSync(tmpdir()+"/dsh-subprocess-")` |
| 8 | **截断 L1** 尾窗 | `dsh-bash-local/lib/index.js:133` `maxOutputBytes` 默认 `64e3`；`:181-184` `collect()`；`:191` stderr 亦用 `maxOutputBytes` |
| 9 | 渲染 + **截断 L3** 标记 | `dsh-tool-bash/lib/index.js:41` `` `${output.text}\n[output truncated; full output: ${spillPath}]` ``（实测 **108 B**） |
| 10 | **截断 L4** spill-policy 预览 | `dsh-spill-policy/lib/index.js:96-135`；cap `dsh-base/cordis.patch.yml:352` `maxInlineBytes: 50000` |
| 11 | 结果回传/落账 | `dsh-tools/lib/index.js:3198` `dispatchScheduledExecution` → `:3202` `tools/execute` 瀑布 → `finalizeScheduledExecution`；`dsh-agent-loop/lib/index.js:180` `appendToolResult` |
| 12 | spill 落盘 | `/tmp/dsh-spill-<mkdtemp>/session-<sid>/<callId>-<tool>.txt`（`dsh-spill-policy:118` + `dsh-spill-local`） |

### 1.2 实测：**沙箱封装 = 0 个额外进程（spawn 深度 1）**

进程树实测（`ps -eo pid,ppid,args --forest`）：

```
2988915  node .../bin/dsh web          ← 宿主
 3017230  bash -c cd ... && printf ...  ← ppid 直接 = 宿主
```

⇔ **宿主 → bash，中间无任何 wrapper 进程**。`dsh-bash-sandbox` 是 `class SandboxBashExecutor extends LocalBashExecutor`（`dsh-bash-sandbox/lib/index.js:110`）**进程内**包装，不 fork 中间层。
⇒ **"沙箱封装"这一段在 spawn 成本上是零**（这是 PASS，不是缺口）。

### 1.3 实测：串行化 —— **最重的一条宿主侧成本**

**实验 B**：一条助手消息里发 **6 个 `bash` 调用**，每个载荷 `printf marker; sleep 1; printf marker`（载荷自带 1 s，标记用 `$EPOCHREALTIME` 写文件，`printf` 是内建、无 fork）。

| 指标 | 实测 |
|---|---|
| 整批 span | **8574.3 ms** |
| 各调用自身耗时 | 1115.2 / 1086.1 / 1001.6 / 1091.0 / 1001.8 / 1001.5 ms |
| **调用间间隙** | 990.7 / 218.4 / 360.8 / 212.8 / 494.4 ms（**中位 360.8**） |
| 调用自身开销（扣掉 1 s 载荷） | 115.2 / 86.1 / **1.6** / 91.0 / **1.8** / **1.5** ms |
| Σ 各调用耗时 | 6297.0 ms |
| span / Σ | **1.362** |
| **若 6 路真并行应为** | ≈ 1050 ms |
| **串行化惩罚比值** | **8574 / 1050 = 8.17×** |
| 重叠 | **零**（每一次的 start 都晚于上一次的 end） |

**实验 A**（对照，放大到 12 个）：12 个**空载荷** `bash` 调用，span = **22203.7 ms**，标记偏移
`0 / 5478 / 9118 / 9626 / 10105 / 10895 / 12047 / 12826 / 13586 / 16490 / 18248 / 22204` ms —— **同样零重叠、逐个点火**。

⇒ 结论：**"同一条消息里 10 个并行工具调用"对 bash 而言不存在**。载荷本身只要 1.5–1.8 ms（bash 内建 `printf`），剩下的 200–1000 ms/次**全是宿主侧编排**（准备、策略、spawn、捕获、截断、落账、下一个调用的起调），而且**无法重叠**。

### 1.4 根因（file:line，决定性）

```
dsh-tools/lib/index.js:2940-2948
  executionMode(exec) {
      const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== void 0);
      if (!tool?.isConcurrencySafe) return { kind: "exclusive" };     // :2942 ← 默认独占
      try { return tool.isConcurrencySafe(exec.arguments) === true ? { kind: "parallel" } : { kind: "exclusive" }; }
      catch { return { kind: "exclusive" }; }                         // :2945 fail-closed
  }
```

`dsh-agent-loop/lib/index.js:135-136`：

```js
const mode = ctx.tools.executionMode(first.exec).kind;
const outcome = await runGroup(ctx, turn, step, mode === "parallel" ? planned.slice(next) : [first], mode, signal, acceptContext);
```

`dsh-agent-loop/lib/index.js:229-233`（`fillPool`）：

```js
while (!aborted && nextToStart < group.length && inFlight.size < maxParallelToolCalls) {
    const nextCall = group[nextToStart];
    if (nextToStart > 0 && mode === "parallel" && ctx.tools.executionMode(nextCall.exec).kind !== "parallel") break;  // :231
    await startCall(nextToStart);   // :234  ← 串行 await
```

**全树递归 grep `isConcurrencySafe` 的声明点只有 5 处**（`dsh-tools` 自身分类器与 `d.ts` 除外）：

| 包 | file:line | 工具 |
|---|---|---|
| `dsh-tool-fs` | `:415` | `read`（文本） |
| `dsh-tool-fs` | `:1028` | `read`（图片） |
| `dsh-tool-subagent` | `:521` | `subagent` / `subagent_fork` |
| `dsh-tool-web` | `:302`、`:778` | web 抓取/搜索 |

**`dsh-tool-bash` = 0 处；`dsh-tool-str-replace-editor`（write/edit）= 0 处；`dsh-tool-fs-search`（grep/glob）= 0 处。**
⇒ **bash / write / edit / grep / glob 全部是 `exclusive`**，在一条消息里**逐个 barrier 串行**。`maxParallelToolCalls`（默认 10，`dsh-agent-loop:922`）**对 bash 完全无效**。

> **判据（只读可复现）**：`grep -rn "isConcurrencySafe" $PKG --include=*.js | grep -v declaration:` → 5 个声明点；
> `grep -n "maxParallelToolCalls" $PKG/dsh-agent-loop/lib/index.js` → `:922/:963/:988/:1007/:1012`，全部只影响 `inFlight.size` 比较。

---

## 2. ② 长任务与后台作业（continuable job / 两旋钮语义 / 全局闸门 / 排队可观测性）

### 2.1 两个旋钮的语义（file:line）

| | `maxParallelToolCalls` | `maxConcurrentJobsPerOwner` |
|---|---|---|
| 生效值 | **10**（`dsh-agent-loop:922` `value ?? 10`；schema `:963,:988`；getter `:1012-1013`） | **10**（`dsh-jobs-local:77` `DEFAULT_MAX_CONCURRENT_TASKS_PER_OWNER = 10`；schema `:102`；赋值 `:127`） |
| 作用域 | **每条助手消息的 tool-call 组 × 每 agent**（`inFlight` 是 `runGroup` 局部量 `:189`，随栈帧销毁） | **每个 owner agent 对象**（引用相等：`activeTaskCount` `:281-287` `job.owner === owner`，仅计 `running\|stopping`） |
| 单位 | 工具调用**结算** | **运行中作业数** |
| 配置覆盖 | 无（`~/.dsh/settings.yaml` 无 `agent-loop:` 段；`profiles/web/*` 零命中） | 无（无 `jobs:` 段） |
| 超限行为 | 不适用（仅压制起调） | **同步抛错、不排队、不 spawn**：`:137` 位于 `:138 spec.run()` **之前** |

**⇒ 语义不一致（FAIL）**：两者**闸的不是同一个资源**（"调用结算" vs "运行中作业"），且**都不是全局**。

### 2.2 后台作业**真的"后台"**（PASS）—— 不占工位

- `dsh-tool-bash/lib/index.js:403-427`：`run_in_background===true` 分支是**同步 `return { kind:"background", jobId }`**（无 `await`）；`:419` `ctx.shell.start(...)` 同步完成 spawn；`:422` `done: proc.done.then(...)` **未 await**。
- `dsh-jobs-local/lib/index.js:138` `const hooks = spec.run();` → `:167-172` 只挂结算回调 → `:174` `return id`。
- 对照前台：`dsh-tool-bash/lib/index.js:429-431` `const result = await ctx.shell.run(...)` —— **前台真 await**。
- 槽位时序：`dsh-agent-loop:209` `inFlight.set` → `dispatch` 在 `dsh-tools:3198-3201`（`tools/execute` 返回时）resolve → `:245` `inFlight.delete`。**与作业是否结束无关。**
- 比值表述：后台调用占槽时长 / 命令总时长 ≈ spawn 开销 / 总时长 ≪ 0.01，**不是 1**。

**实测**：一条消息里发 10 个 `run_in_background`，每个都**立刻**返回 `started background job bash-25 … bash-33`。

### 2.3 全局闸门：**不存在**（FAIL）

`grep -rln "semaphore\|Semaphore\|globalLimit\|processWideLimit\|concurrencyLimit" $PKG/*/lib/index.js` → **零命中**。
`dsh-jobs-local` 的 `store.size` 从不与任何阈值比较（只被 `disposeAll` 使用）。

⇒ **宿主侧并发 ≈ Σ over agents (≤10)**，随 subagent 数**线性放大**，无背压、无熔断。本线有**三个**默认 10 的并发旋钮互不约束：`maxParallelToolCalls`、`maxConcurrentJobsPerOwner`、以及 code-mode 的 `maxParallelSubCalls`（`dsh-tools:2544-2547,2561,2594,2676`）。

### 2.4 排队可观测性：**为零**（FAIL）

| 通道 | 工具池 | jobs |
|---|---|---|
| ① 持久日志出口 | 无 | 无（见 §5）|
| ② RPC 帧 | **完全没有面**（`maxParallelToolCalls` 在 `dsh-client-*` 零引用） | 有 `session/jobs` 帧（`dsh-host-apiproxy:3706-3721`，字段 `:1186-1197` 仅 id/kind/label/status/detail/startedAt/finishedAt）|
| ③ 事件 topic | 无（`dsh-agent-loop` 无池事件）| 无（`dsh-jobs-local` 全文 `ctx.emit` 零命中，只走 `onJobsChanged` 回调）|
| ④ UI | 无 | 有 `JobListAction`（`dsh-client-ui-jobs/lib/client.js:111-145`），但 `:139` `if (jobs.length === 0) return null;` ⇒ 零 job 时控件不存在；无 limit/配额/队列 |

**缺什么（明确）**：未起调的调用只存在于局部变量 `nextToStart`（`dsh-agent-loop:168`），**从不写 session**（`appendToolCall` 只在真正起调时于 `:192` 写）⇒ 会话里连"已发起"都不算；无 `queued`/`queuePosition`/`waitingOn` 字段；无 `inFlight.size` 暴露；无"当前 x/10"；无"被闸门拒绝次数"。**用户/上层无法区分"没在跑"与"被闸门压住起不来"。**

### 2.5 实测：作业闸门会触发，且**不挂起、不排队**（PASS）

一条消息内发 10 个 `sleep 40` 后台作业（此时本线 sampler 作业仍存活 ⇒ 已占 1 个配额）：前 9 个返回 jobId，**第 10 个新调用返回**：

```
Error: background job limit reached for this owner (limit: 10); use job_kill to stop an unneeded job, wait for it to finish, then retry
```

（文本与 `dsh-jobs-local/lib/index.js:137` 逐字一致）
⇒ **立即 per-call `isError`、无排队、无挂起、无副作用（未 spawn）**；且同批其余 9 个调用**正常提交**。

作业完成通知也确实送达（9 个作业结束时运行时逐个推送了完成通知），即 `completionDelivery:"wakeup"` 路径工作正常（`dsh-tool-jobs:24-25`，`maxConsecutiveWakes` 默认 3；超预算退化为静默 `owner.inject`，`dsh-tool-jobs:221,225`）。

### 2.6 作业记录与输出资源（FAIL，承子代理 A §5）

- 唯一删除点是**生命周期销毁**（`dsh-jobs-local:397-404 disposeOwned`、`:413-422 disposeAll`），**无 TTL、无数量裁剪**；`settle`（`:357-389`）不删；配额只数活跃（`:281-287`）⇒ **终态记录 + 闭包 + 输出尾窗随累计启动数单调增长**。
  比值判据：`grep -c "this.store.set"` = **1**（`:164`）vs `grep -c "this.store.delete"` = **2**（`:401,:418`，均绑销毁）⇒ 无 dispose 期间写入/删除比 = **∞**。
- **无会话级租约**：取消只挂 agent fiber（`:378-388` `owner.ctx.effect`）；`dsh-host-apiproxy` 的 `session/disposed` 处理器**只做 `openCalls.delete`**（1 处命中），**不碰 jobs**。
- bash job 的 `job.output` **恒 `undefined`**（`dsh-tool-bash:21-30` `processOutcome` 无 output 字段），读取走 `:423` 闭包读进程采集器；job 层**无输出上限**。
- `job_output wait:true`：默认 **30 s**、硬上限 **600 s**（`dsh-tool-jobs:22-23` 定义行，`:272-274` `Math.min`）；**超时只 resolve 等待、不改作业状态**（`dsh-jobs-local:255-258`），作业继续跑且完成后仍会唤醒（与 `dsh-tool-jobs:239` 描述一致）。
- 宿主优雅退出有 `disposeAll`（`:129`）；但 spawn 是 `detached`（`dsh-subprocess-local:803`）⇒ SIGKILL/崩溃**无孤儿清理兜底**。

**INCONCLUSIVE（1 条）**：归档/结束会话是否 dispose agent 实例 ⇒ 决定是否存在"进程还活着但无任何 UI 入口"的孤儿窗口。需读 `dsh-host-apiproxy` 的归档路径判定，超出本线边界。

---

## 3. ③ 输出体量与截断策略（五层链，**精确算术闭合**）

### 3.1 五层链

| 层 | 机制 | file:line | 实测值 |
|---|---|---|---|
| **L1** | 每流**内存尾窗**，超限从头丢 | `dsh-bash-local:133`（默认 `64e3`）→ `dsh-subprocess-local:641-658` | 载荷 **800000 B** → 可见首行恰为 `0092000`，即 `800000 − 64000 = 736000 = 92000 × 8` ⇒ **保留窗口 = 精确末 64000 B** ✅ |
| **L2** | 全量 spill 到 tmp | `dsh-subprocess-local:597-600,660-672`；cap `dsh-bash-local:90,134` = 64 MiB | 文件 `/tmp/dsh-subprocess-WmEc5L/dsh-subprocess-2988915-4-97b6ee379e73-stdout.log` = **800086 B**（全量） |
| **L3** | 追加截断标记 | `dsh-tool-bash:41` | 标记 **108 B** |
| **L4** | spill-policy head/tail 预览 + 遗漏声明 | `dsh-spill-policy:96-135`；cap `dsh-base/cordis.patch.yml:352` = **50000 B** | 见 3.2 |
| **L5** | 压缩期 head/middle/tail 剪枝 | `dsh-compaction-tool-result-pruner:31-33`；调用点 `dsh-compaction-basic:867,873` | **仅压缩期触发，非每结果**；`thresholdChars 8192 / head 4096 / tail 1024`（`agent-presets/standard/agent.cordis.yml:150-154`）|

### 3.2 L4 精确闭合（**预测 = 实测，两个宿主实例复现**）

格式化结果 = `64000（L1 窗口）+ 1（换行）+ 108（L3 标记）= 64109 B`（spill 工件实测 **64109**，恒等式成立）。

`dsh-spill-policy:96-135`：`reserve = byteLength(notice(count=totalBytes)) + 2 = 188 + 2 = 190` ⇒ `budget = 50000 − 190 = 49810` ⇒ `headBytes = ceil/2 = 24905`、`tailBytes = floor/2 = 24905`。

| 量 | 预测（我按真实模块复算） | **活体实测** |
|---|---|---|
| 保留字节 | 49810 | — |
| **遗漏字节** | `64109 − 49810 = 14299` | **`(Omitted 14299 bytes. …)`** ✅ |
| head 末个完整行号 | **95112** | **0095112** ✅ |
| 窗口首行 | 92000 | 0092000 ✅ |
| 尾部片段 | 尾部起于行中（非行首） | `0900`（行中截断）✅ |

**跨实例复现**：同一命令在**重启前的 301709** 与**重启后的 2988915** 上给出**逐字节相同**的 `Omitted 14299 bytes`、首行 0092000、head 末行 0095112。

**spill 悬崖**：`dsh-spill-policy:142` `if (totalBytes <= maxInlineBytes) return decision;` ⇒ 悬崖在 **50000（含）**：50000 不 spill、50001 spill。

### 3.3 是否流式？**否**

`dsh-bash-local:92-99` `finalOutput(reader)` 把整个保留窗口**物化**为 `{ text, truncated, spillPath }`；`:246-247` 前台返回该物化对象。前台**不流式**。后台走 `readFrom(offset)` 增量（`:297-310`），那是 `job_output` 的拉取语义，不是推流。

### 3.4 大输出对宿主/客户端的影响

- **两条独立的 tmp spill 层在膨胀且从不清理**（实测）：
  - `/tmp/dsh-subprocess-*`：**56 → 58 个文件，28,598,408 B**
  - `/tmp/dsh-spill-*`：**72 → 74 个文件，3,179,819 B**
  - **跨冷面重启存活**：`/tmp/dsh-subprocess-C2X3bt/dsh-subprocess-10806-*.log`（旧宿主 10806）在 18:11 重启后**仍在**。⇒ **保留期无限，磁盘单调增长**（FAIL）。
- **L5 剪枝器的 `Array.from` 成本**（`codePointLength = Array.from(text).length`，`:31-33`）实测：8192 字符 0.0504 ms / 50000 → 0.2652 ms / 64000 → 2.0153 ms / 300000 → 1.3971 ms；对比 `.length` 在 300k 字符的比值 = **6653×**。
  ⚠️ 64000 样本（2.0153 ms）反而大于 300000 样本（1.3971 ms）⇒ **JIT/GC 噪声主导，只可当量级**（不写成精确收益）。
- **一条 800 KB 输出的完整链成本**（我的复算）：L4 预览 `spillPreview 0.0666 ms` + `byteLength 0.0058 ms/次` ⇒ **截断算法本身不是瓶颈**；真正的成本是 **800 KB 的管道搬运 + 128 KB（64109 B → 64K 字符）的 `Array.from` 式物化 + 一次 tmp 全量写盘**。

### 3.5 一处**内部不一致**（新发现，低危）

`dsh-bash-local/lib/index.js:165` 前台 `stdoutMaxBytes = request.stdoutMaxBytes ?? this.config.maxOutputBytes`（尊重调用方覆盖）；
但 `:273` **后台** `startArgv` 硬用 `this.config.maxOutputBytes`，**忽略 `spec.stdoutMaxBytes`**。
⇒ 后台路径无法按请求调整 stdout 窗口（前台可以）。判 **FAIL（一致性）**，影响面小。

---

## 4. ④ 审批 / 权限路径（核对"已知 `never` 硬编码"与"自动拒绝不挂起"）

### 4.1 枚举与配置

- 枚举：`dsh-user-approval/lib/index.js:36` `const APPROVAL_POLICIES = ["ask","never"];`（schema `:87` 默认 `"ask"`；折叠 `:168-170`；写入校验 `:76-79`）
- **部署层不是硬编码 `never`**：`dsh-base/cordis.patch.yml:189-192`
  `policy: !!js "(process.env.DSH_PERMISSION_MODE ?? 'workspace-write') === 'danger-full-access' ? 'never' : 'ask'"`
  ⇒ 默认走 **`ask`**；本机 `~/.dsh/settings.yaml`（221 行）**零审批/sandbox/permission 配置**。
- **但派发边界是硬编码 `never`**：`dsh-subagent/lib/index.js:624`
  `approvalPolicy: parent.ctx.get("approval") === void 0 ? void 0 : "never"`
  右侧**不读父会话策略**，注释 `:611-616` 自陈 *pinned to `'never'` regardless of the parent's own policy*；**无用户可达设置项/参数入口**。
  ⇒ **核对结果：`never` 在子代理边界是代码钉死，不可继承/覆盖（FAIL，与已知一致）**；在部署层则是条件式配置（与"已知硬编码"的粗略说法**有出入，以此为准**）。

### 4.2 `sandbox_permissions` 自动拒绝**不挂起**（核对：成立，且原因是"早于广播点返回"）

完整链：`dsh-tool-bash:123`（配对校验）→ `:389`（需两参齐备）→ `:238-241` → `dsh-sandbox:94`（严格加宽）`:95`（无审批服务 throw）`:96`（无 agent throw）→ `:97` `await approval.approver.request(...)` → `dsh-user-approval:146`（无开放 turn 立即 throw）`:148`（append `approval/asked`）`:154`（await decide）`:155`（append `approval/decided`）→ **`:188` `if (this.effectivePolicy(session) === "never") return "rejected";`** → `dsh-sandbox:106` `throw new Error(\`the user rejected escalating this ${subject} to "${mode}"\`)`。

- **`:188` 位于 answerer waterfall（`:189`）之前** ⇒ 钉死 `never` 的会话**永不进入**唯一可能停留的 pending 注册表（`dsh-host-apiproxy/lib/index.js:1993-2027`）；`dsh-user-approval:189-201` 全文**无 `setTimeout`** ⇒ **无 pending option、无定时器、无永不 resolve 的 promise（PASS）**。
- **不静默降级**：`allowed-once` 是唯一授权（`:105`），其余分支全 throw；命令**未运行**。
- **denial 文本生成点**：`dsh-sandbox:63-65` `[sandbox: file access denied under <mode> mode]`。
- **审计记录：有但不可归因（FAIL）**：`approval/asked`（`:148`）+ `approval/decided`（`:155`）落 session；但**策略自动拒绝与真实用户拒绝同写 `outcome:"rejected"`**，模型读到假归因文本 *"the user rejected…"*（`:106`）—— 而**根本没有任何用户被问过**。缺 `reason`/`source` 字段。
- **缺口**：`dsh-sandbox:95,96,108` 三条 throw **无结构化 `error.code`**（对比超时有 `TOOL_TIMEOUT`）。
- **INCONCLUSIVE（1 条）**：`ask` 策略下 answerer promise **无超时兜底**，且 `dsh-sandbox:102` 的 signal 是可选展开 ⇒ signal 缺省 + 客户端不响应 = **永久挂起**。本会话不可达（策略非 ask 通道），**未实测**。

---

## 5. ⑤ 失败与超时的可观测性（含 w13 F1 交叉核对）

### 5.1 宿主插件日志：**零持久出口**（w13 F1 **独立复核成立并加强**）

| 断言 | 复核结果 |
|---|---|
| cordis 唯一 exporter 是 1000 条内存环形缓冲 | **成立**：`cordis/lib/index.js:583` `bufferSize = 1e3`；**唯一写入点 `:601`** `self.buffer.push(message)`；`:602` `slice(-bufferSize)` |
| 该缓冲全树零读取 | **成立且更强**：全树 `.exporter(` 注册点共 **3** 处 —— `:598` 唯一真实注册、`:613/:617` 是 API 定义/注释、以及 `dsh-web-frontend/dist/assets/*` 的**浏览器端打包副本** ⇒ **宿主侧零消费型 exporter** |
| 无其它出口 | **成立**：`grep -rn "createWriteStream\|appendFile\|appendFileSync" $PKG --include=*.js \| wc -l` → **0** |
| `journalctl _PID=<host>` 无条目 | **成立**：`journalctl _PID=2988915` → `-- No entries --` |
| `~/.dsh/logs` 不存在 | **成立** |

⇒ **宿主重启后插件日志保留率 = 0%**。ingest 失败 / worker 崩溃 / 插件加载失败**就此沉没**。

### 5.2 超时：**两层，且包装层对本部署 bash 是 INERT**（关键更正）

| 层 | 是否生效 | file:line | 实测值 |
|---|---|---|---|
| **执行器层（真实生效）** | **是**，**会杀子进程** | `dsh-bash-local:235` `deadline(..., "BASH_TIMEOUT")` | — |
| 生效默认超时 | — | **`dsh-base/cordis.patch.yml:178-182` `timeoutMs: 60000`** | **60 s** ⚠️ |
| schema 默认（未生效） | — | `dsh-bash-local:131` `timeoutMs: z.number().default(12e4)` | 120 s |
| 上限 | — | `dsh-bash-local:132` `maxTimeoutMs` 默认 `6e5`；`:164` `clampTimeout` | 600 s |
| **包装层** | **INERT** | `dsh-tool-call-timeout-policy:127-128` 需工具声明顶层 `timeoutMs`；而 `dsh-tool-bash` 的 `defineTool` **无顶层 `timeoutMs`** ⇒ **一个定时器都不武装** | — |
| 包装层不 race | — | `dsh-tool-call-timeout-policy:134-135` `const result = await next();`（模块头 `:7-9` 自陈不 race/不放弃） | — |

> ⚠️ **对子代理 B 的更正**：B 报"生效默认 120 s"。实际部署由 `dsh-base/cordis.patch.yml:182` 覆盖为 **60 s**（B 只读了 schema 默认，漏了 composition 覆盖）。**冷面风险**：任何依赖"120 s"预算的长命令会**提前 60 s 被杀**。

### 5.3 模型能否区分失败类型？**能（PASS）**，但有一个统计陷阱

`dsh-tool-bash:66-71` 四类标记**互斥**：`[sandbox: file access denied under <mode> mode]`（`:67`）/ `[timed out after Nms]`（`:68`）/ `[killed by signal: SIGKILL]`（`:69`）/ `[exit code: N]`（`:70`）；审批拒绝走 `isError`（`dsh-sandbox:106`）；abort `Error: tool call aborted [before dispatch]`（`dsh-tools:3545,3564`）。

**陷阱**：`dsh-tool-bash:16-17,20-30` 明示 *"A nonzero command exit is reported, not failed"* ⇒ **非零退出不是 `isError`**，按 `isError` 统计失败率会**漏掉整类命令失败**。

### 5.4 传输错误折平：**工具路径不受影响（PASS）**

- `dsh-host-apiproxy/lib/types/api/rpc.js:24-29` `error: { code: 'internal', message, details: {} }` —— 复核成立。
- `dsh-client-runtime/lib/client.js:344-353` 是**同一份打包源码的副本**（region 头 `:337` 为证），**不是第二处独立实现**（更正"两处"的说法）。
- **工具侧有独立 code 词表**：`TOOL_ABORTED`（`dsh-tools:2418`）、`TOOL_ABORTED_BEFORE_DISPATCH`（`:2420`）、`TOOL_TIMEOUT`（`dsh-tool-call-timeout-policy:75`）、`CODE_RUN_FAILED`（`dsh-tools:950`）、`BASH_TIMEOUT`（`dsh-bash-local:235`）。
- 唯一交汇点：结果先落为**会话事件 `tool/result`**（`dsh-session/lib/index.js:222,711`）再经 mux 推送；**折的是"结果送不到"，不是"工具失败"**。

### 5.5 唯一持久载体 = 会话事件（实测）

`~/.dsh/sessions` = **1441 个文件 / 716 MB**（1438 zstd + 3 lock，19 个项目目录）。
⇒ **工具失败/超时/沙箱拒绝/审批拒绝不沉没**；但**宿主层失败（插件加载、logger 输出、宿主崩溃）零持久痕迹**。
宿主崩溃时工具链表现为**有 `tool/call` 无 `tool/result` 的悬挂对**，**无正向错误记录**（B10：无悬挂检测器）。

**F1 的三个术语在产品树里不存在**：`bootstrap failed` **0 命中**；`ingest` **仅 1 处 JSDoc 注释**（`dsh-client-runtime/lib/client.js:6022`）。
⇒ 二者不是既有分类，**不得当既有缺陷名引用**。

---

## 6. 前三优化候选（收益 / 风险 / 验收 / 回滚 / 热冷面）

### P1 —— 让 bash 声明**条件式** `isConcurrencySafe`（把"10 路并行"还给最常用的工具）

- **改动**：`dsh-tool-bash/lib/index.js` 的 `defineTool({...})` 增加 `isConcurrencySafe: (args) => <只读命令白名单命中>`，默认 `false`（保持与 `executionMode` 同形 fail-closed，`dsh-tools:2940-2948` 只认精确 `true`）。
- **收益（同窗对照，实测）**：N=6 同载荷 `bash` 调用 span **8574.3 ms → ≈1050 ms**（**8.17×**）；N=12 空载荷 **22203.7 ms → ≈数百 ms**。且**零重叠**的串行结构消失。
- **风险**：bash 可写 ⇒ 并发竞争（两个 `>` 写同一文件、共享 `cwd`、共享临时文件、`git` 索引锁）。
  **缓解**：白名单只收**只读**动词（`cat head tail wc ls stat file grep rg find git status git diff git log node -e` 等）+ **默认拒绝**；`run_in_background` 不受影响。
- **验收**：
  1. 同一条消息 6× `grep -c <pat> <50MB 文件>`：span ≤ **1.5 ×** 单次 span（当前应为 ≥4×）；`unpatched_reproduces_defect=true` 门禁。
  2. **负向对照**：6× `bash -c 'echo x >> f'` **必须仍判 exclusive**（span 比值 ≥4×）⇒ 证明白名单真的在分类，而非把 bash 整体放开。
  3. 回归：`echo`/`printf` 单发行为、`[exit code: N]` 标记、`maxOutputBytes` 尾窗字节数**不变**。
  4. `gateOutcome==EXCLUSIVE`（持锁、机器安静；污染物 `>1` 即该窗 invalid）。
- **回滚**：删除 `isConcurrencySafe` 键（回到 `executionMode` 的 exclusive 默认）。
- **热冷面**：**偏冷（需重启）**。`dsh-tool-bash` 是 `agent-presets/standard/agent.cordis.yml:41-43` 的行，属 standing mount；改包文件会改组合 stamp。⚠️ **落地前必须实测"只改该文件后刷新是否生效"**，不要按"热面"承诺。

### P2 —— 补一个**持久日志 exporter** + 把闸门饱和/审批归因变成字段（本线的"数据源前提"）

- **改动（三处，可拆批）**：
  - 2a `cordis` 组合里注册一个文件 exporter（当前全树 0 个消费型 exporter，`cordis/lib/index.js:598`）；
  - 2b `dsh-user-approval/lib/index.js:188` 与 `:189` 两条路径的 outcome 增加 `reason`/`source`（策略拒绝 ≠ 用户拒绝）；
  - 2c 暴露工具池饱和与作业配额：`inFlight.size/maxParallelToolCalls` 上 RPC 帧（对齐 `dsh-host-apiproxy:3706-3721`）+ `session/jobs` 帧补 `limit`/`active`，并让 `dsh-client-ui-jobs:139` 不再"零 job 就整块消失"。
- **收益**：把当前**三条零取证失败类**（插件加载失败、宿主 logger 输出、宿主崩溃）变成可归因记录；把"是不是被闸门卡住"从**猜测**变成**可读字段**；宿主重启保留率 **0% → >0%**。
- **风险**：热路径 I/O；磁盘增长（必须配轮转/保留期，见 §3.4 已证 spill 会无限增长）；字段变更需同步 `lib/types/*.ts` 与回放规格。
- **验收**：
  1. 人为造一次工具失败 + 一次作业超限后，**日志文件/journald 同时可读到两条**，带**不同 code**（当前：0 条、且无 code）；
  2. **重启后仍在**（保留率 > 0%，当前 0%）；
  3. `~/.dsh/logs` 存在且有保留期 ≤ N 天；
  4. 审批：策略自动拒绝与用户拒绝的 `outcome.source` **不相等**；
  5. 性能回退闸门：`monitorEventLoopDelay` 最大 < 100 ms，且**必须避开 `BATCH-PLAN §五.8` 的 `reset()` 陷阱**（`enable → settle → block`，**不得**在阻塞前 `reset()`）。
- **回滚**：注销 exporter 行 / 卸载 2c 的帧字段（均**冷面**）。
- **热冷面**：2a/2c **冷**（宿主组合 + 客户端插件，客户端插件改动**不享受刷新即生效**，需重建 Web 产物）；2b 的 outcome 字段属 `dsh-user-approval` 宿主插件 ⇒ **冷**。

### P3 —— 修截断链的"重复劳动"与两处内部不一致（低风险、纯算术）

- **改动**：
  - 3a **消掉 L1/L4 的必然冗余**：`maxOutputBytes`（64e3，`dsh-bash-local:133`）当前必然被 L4 的 `maxInlineBytes`（50000，`dsh-base/cordis.patch.yml:352`）**再砍一刀** ⇒ 模型**永远拿不到**那 64000 B，多出的 14109 B 只被生成、搬运、物化、再丢弃。把 L1 对齐到 `maxInlineBytes + 108 + 1`（或反向压低 cap），消除每次数十 KB 的无用物化。
  - 3b **后台路径尊重 `spec.stdoutMaxBytes`**（`dsh-bash-local:273` 硬用 `config.maxOutputBytes`，与前台 `:165` 不一致）。
  - 3c `dsh-compaction-tool-result-pruner:31-33` 的 `codePointLength = Array.from(text).length` 换成代理对感知的**逐码点计数循环**（消除每次压缩对全文的 `Array` 物化；实测比值 **6653×** 于 `.length`）。
- **收益**：每条大输出少搬运/物化约 **14.1 KB**（= 64109 − 50000）；压缩期避免对全结果做 `Array.from` 物化。
- **风险**：**低但不为零** —— 3a 改的是**模型可见输出尺寸**，若 L1 压到 cap 以下，L4 将不再触发 spill，**模型将拿不到 spill 路径**（失去"回读全文"的能力）。⇒ 3a 必须**同时**保证 L1 窗口 > cap，或保留 L4 强制 spill 的显式开关。
- **验收**：
  1. 800 KB 载荷：模型可见字节 ≤ **50000**，且 spill 工件仍含**全文**；`Omitted N == 格式化结果 − 49810` 恒等式**逐字节成立**（本报告已给出可复现基线：`Omitted 14299` / 首行 `0092000` / head 末行 `0095112`）；
  2. 3c：对 8192 / 50000 / 64000 / 300000 字符的 `codePointLength` 结果与旧实现**逐值相等**（等价性先于性能）；
  3. 生成字节数 ≤ L1 窗口 + 1 + 108（无中间放大）。
- **回滚**：配置值回退（`maxOutputBytes` / `maxInlineBytes`）；3b/3c 为代码回退。
- **热冷面**：3a **偏热**（若 `maxOutputBytes` 走 settings 段则可值级热载；若在组合文件里则冷）；3b/3c **冷**（`dsh-bash-local` / 压缩插件均为宿主插件）。

---

## 7. 判定台账（逐条 PASS / FAIL / INCONCLUSIVE）

| # | 条目 | 判定 | 关键 file:line / 数值 |
|---|---|---|---|
| W17-01 | 成本链 12 段可逐段定位 | **PASS** | 见 §1.1 |
| W17-02 | `maxParallelToolCalls` 对 bash 有效（"10 路并行"可达） | **FAIL** | `dsh-tools:2942,2944`；`dsh-agent-loop:231,234`；bash 无 `isConcurrencySafe`；实测 span/理想 = **8.17×**，零重叠 |
| W17-03 | 沙箱封装带来额外 spawn 成本 | **PASS（无额外成本）** | `dsh-bash-sandbox:110` 进程内；进程树深度 1 |
| W17-04 | 两并发旋钮语义一致 | **FAIL** | 工具=调用结算×per-agent×per-message；作业=运行中计数×per-owner-object |
| W17-05 | 存在全局并发闸门 | **FAIL** | `semaphore\|globalLimit\|concurrencyLimit` 全树 0 命中 |
| W17-06 | 后台作业真"后台"（不占工具槽位） | **PASS** | `dsh-tool-bash:403-427` 同步 return；`:422` 未 await；`dsh-agent-loop:209/245` |
| W17-07 | 作业超限不挂起、不排队、无副作用 | **PASS（实测）** | `dsh-jobs-local:137` 早于 `:138`；活体复现原文错误文本 |
| W17-08 | 工具池排队有可观测性 | **FAIL** | `nextToStart` 纯局部（`dsh-agent-loop:168`）；无 session/事件/RPC/UI |
| W17-09 | 作业配额有可见性（limit/x-of-N/queued） | **FAIL** | `session/jobs` 帧字段缺 limit/queued（`dsh-host-apiproxy:1186-1197`）|
| W17-10 | job 终态记录有界/有 TTL | **FAIL** | `set:delete = 1:2` 且删除均绑销毁（`dsh-jobs-local:164,401,418`）|
| W17-11 | job 有会话级租约/兜底回收 | **FAIL** | 取消只挂 agent fiber `:378-388`；`session/disposed` 不碰 jobs |
| W17-12 | L1 尾窗字节数精确可预测 | **PASS** | `800000−64000 = 736000 = 92000×8`，首行恰 `0092000` |
| W17-13 | L4 预览/遗漏字节精确闭合 | **PASS** | `64109 − 49810 = 14299`，**跨重启逐字节复现** |
| W17-14 | 输出流式返回 | **FAIL（不流式）** | `dsh-bash-local:92-99,246-247` 物化 |
| W17-15 | tmp spill 有回收/保留期 | **FAIL** | 28.6 MB + 3.2 MB；**跨冷面重启存活** |
| W17-16 | 每流窗口配置在前后台一致 | **FAIL** | 前台 `:165` 尊重 `request.stdoutMaxBytes`；后台 `:273` 忽略 |
| W17-17 | `never` 在派发边界是代码钉死且不可继承 | **FAIL（符合已知）** | `dsh-subagent:624` 字面量；注释 `:611-616` |
| W17-18 | 部署层审批策略是硬编码 `never` | **更正** | 实为条件式：`dsh-base/cordis.patch.yml:189-192`（默认 `ask`）|
| W17-19 | `sandbox_permissions` 自动拒绝会挂起 | **FAIL（不成立）** | `dsh-user-approval:188` 早于 waterfall `:189`；`:189-201` 无 `setTimeout` |
| W17-20 | 审批拒绝可归因（区分策略拒绝/用户拒绝） | **FAIL** | 两者同写 `outcome:"rejected"`；`:106` 假归因文本 |
| W17-21 | 宿主插件日志有持久出口 | **FAIL** | `cordis:583,601,602`；消费型 exporter = **0**；`journalctl` `-- No entries --`；`~/.dsh/logs` 不存在 |
| W17-22 | 工具超时可执行（有真实生效的超时） | **PASS** | `dsh-bash-local:235`；生效默认 **60 s**（`dsh-base:182`）；上限 600 s |
| W17-23 | 超时包装层对本部署 bash 生效 | **FAIL（INERT）** | `dsh-tool-call-timeout-policy:127-128`；bash 无顶层 `timeoutMs` |
| W17-24 | 模型能区分超时/信号/退出码/沙箱拒绝 | **PASS** | `dsh-tool-bash:66-71` 四标记互斥 |
| W17-25 | 非零退出被计入失败 | **FAIL（陷阱）** | `dsh-tool-bash:16-17,20-30` reported-not-failed |
| W17-26 | 工具路径传输错误被折成 `internal` | **PASS（不受影响）** | 工具侧独立 code 词表（`:2418,:2420`；timeout `:75`）|
| W17-27 | `internal` 折平是"两处独立实现" | **更正** | `dsh-client-runtime:344-353` 是同一打包源码副本（region 头 `:337`）|
| W17-28 | 工具失败/超时有持久痕迹 | **PASS** | `tool/result` 为 durable 事件（`dsh-session:222,711`）；1441 文件 / 716 MB |
| W17-29 | 宿主崩溃有正向证据 | **FAIL** | 只有"有 call 无 result"的悬挂对；无悬挂检测器 |
| W17-30 | w13 F1（宿主日志无持久出口）成立 | **PASS（复核成立并加强）** | 见 W17-21 |

**合计：PASS 11 / FAIL 17 / 更正 2 / INCONCLUSIVE 2**（30 条台账行；INCONCLUSIVE 两条不占台账行：归档是否 dispose agent ⇒ 孤儿 job 窗口；`ask` 策略下审批 promise 无超时 ⇒ 理论永久挂起，本会话不可达未实测）。

**对既有结论的三处更正（请协调者采纳）**：
1. **生效 bash 超时是 60 s，不是 120 s**（`dsh-base/cordis.patch.yml:182` 覆盖 schema 默认 `dsh-bash-local:131`）。
2. **"审批策略硬编码 `never`"要分面**：派发边界确为字面量钉死（`dsh-subagent:624`）；**部署层是条件式配置**（`dsh-base/cordis.patch.yml:189-192`，默认 `ask`）。
3. **"一个作业超限会把整组并行调用一起判失败"不成立**（子代理 A 首轮推断，已由其自行核对推翻，本线以**代码 + 活体实测**双重确认）：工具体抛错被 `dsh-tools:3173-3186` 的 try/catch 收敛为**单调用 `isError`**；且 `dsh-agent-loop:135-136` 给 exclusive 工具的分组**恰为 1**。活体：同一条消息 9 个后台作业成功 + 第 10 个返回单条 `isError`。**该放大效应在 bash 上不可达**（bash 恒 exclusive）；只可能在 parallel-safe 工具（read / subagent / web）上出现，且需调度管道本身失败（而非工具体失败）。

---

## 8. 复现清单（全部只读）

```bash
D=/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai
# W17-02 bash 独占（唯一 5 个并行安全声明点）
grep -rn "isConcurrencySafe" $D --include=*.js | grep -v declaration: | grep -v dsh-web-frontend
# W17-05 无全局闸门
grep -rln "Semaphore\|semaphore\|globalLimit\|concurrencyLimit\|processWideLimit" $D/*/lib/index.js
# W17-21 日志零持久出口
grep -rn "exporter(" $D/*/lib/*.js; journalctl _PID=2988915 -n 5; ls -la ~/.dsh/logs
# W17-12/13 截断链闭合（需先跑一次 800KB 载荷）
cat .workspace/lag-fix/program/w17-tools/raw/probe/lines100k.txt
node .workspace/lag-fix/program/w17-tools/raw/probe/harness-truncation.mjs
# 串行化实测（重跑实验 B：一条消息内 6 个调用，各自 printf 标记 + sleep 1）
```

原始 JSON：`raw/measurements.json`；采样原始数据：`raw/probe/host-cpu.ndjson`、`raw/probe/marks.ndjson`。
