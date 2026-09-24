# report.md — HMR 热刷新时序缺陷：选型 + 实现 + 真跑验收 + 同档自复核

单元：`.workspace/lag-fix/exec-hmr/`（修订执行复核一体档）
日期：2026-09-22
基线：产品树 `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`（v0.1.1-rc.2，**本单元零写入**）

## 交付清单

| 文件 | 内容 |
|---|---|
| `plan.md` | 第一步：三条修法（A/B/C）逐条比较 + 代码级证据 + 推荐与理由 |
| `patch-hmr-timing.mjs` | 第二步：补丁脚本（dry-run 默认 / `--apply` / `--rollback` / `--self-test`；锚点唯一命中否则全不写；自动 pre-image；`node --check`；幂等） |
| `candidate/A1-renderer.patched.client.js` | 候选字节（A1，必需）39235 → 42999 字节，sha256 `7468f0c67407622f83a483d8d7f1788069ead374218aff2d6ef0b76cd4143172` |
| `candidate/A2-hmr-latch.patched.client.js` | 候选字节（A2，可选加性）3427 → 4219 字节，sha256 `8ea91bb3b48ccb3f2b416739ab9fb305966f442042f5152c4f97b0f9412b1efc` |
| `probe-hmr.mjs` | 第三步：**真的触发热刷新**的验收探针（6 个臂） |
| `iso-main.sh` / `run-arms.sh` | 隔离宿主搭建 + 验收臂批量运行 |
| `DEPLOY.md` | 落地手册（含「**落地后必须强刷**」的原理与流程、回滚、落地自检） |
| `evidence/isolated-host.md` | 隔离宿主与 bundle 路径解析的行号级证据（S1 调查档，全部实测） |
| `evidence/prior-art.md` | 既有结论 + 架构文档 + 产品树逐偏移证据（S2 调查档） |
| `evidence/probe-*.json` / `.log` | 每个验收臂的原始 JSON 与日志 |
| `shots/*.png` | 每个验收臂的实测截图 |
| `preimage-cand/` | 候选生成时用的 pre-image（字节级可回溯） |

---

## 1. 一句话结论

**选定方案 A-2（在槽错误边界上做「窗口期内有界延迟重挂、不 abdicate」）**；
已产出候选件 + 补丁脚本（自测 PASS）；已在**隔离宿主（独立 DSH_HOME + 独立端口 3187 + shadow 副本）**上
**真的触发 `rebuilt` 帧**跑完 6 个验收臂，判据逐条对照见 §5；**产品树零写入、用户 3080 与用户 profile 零触碰**。

---

## 2. 缺陷机制（本单元补充的代码级证据）

完整推导见 `plan.md §0`。要点（每行都有文件:行号依据）：

1. **消费侧是裸 `ctx.get`**：`dsh-client-ui-conversation/lib/client.js:10034-10035`（`conversation.session`）、`:10103`（`conversation.composer.bar`）、
   `:10180` 的 inject 工厂调用 `concreteConversation(ctx)`，后者用 `ctx.get("conversation")`（`:9884-9887`）并在取不到时
   `throw new Error("ui-conversation: conversation service unavailable")`。
   该插件的 `inject` 声明表（`:9838-9853`）**不含 `"conversation"`** ⇒ cordis 依赖图里没有这条边。
2. **provider 被推迟一个微任务**：provider 在 `apply()` **最后一行**才 `ctx.plugin(ConversationController, …)`（`:10225`），
   而 `cordis/lib/index.js:1348-1352` 的 `Fiber._reload()` 以 `await Promise.resolve()` 开头
   ⇒ 构造器（`super(ctx,"conversation")` → `reflect.provide`，`cordis/lib/index.js:1766`）**不在 `apply()` 的同步栈里**；
   而 `slots.register(...)` 是**同步生效**的（版本号自增 → `queueMicrotask(flush)` → uSES → React SyncLane 微任务重渲染）
   ⇒ **竞态**：重渲染跑 inject 时 provider 可能还没注册。
3. **伤害永久**：`SlotErrorBoundary`（`dsh-client-ui-renderer/lib/client.js:518-530`）接住后经 `guarded()` 的
   `reportEntryError(slotKey, entry, error, {abdicate: true})`（`:758-764`，`conversation.session` 是 `kind:"single"`）
   → `SlotCore.reportEntryError` 把 entry 记进 `abdicated`（**`WeakSet`**，shell seed `index-ClqxG24t.js` @190606；
   **全文件无 `delete`/`clear`**，`releaseEntry` @196044 也不触碰）
   ⇒ 该 entry **永久**不再被 `entriesOfSlot` 返回 ⇒ 单元变干 ⇒ `deadCell()` = `<div data-slot-error="…">`
   ⇒ 会话区消失且**不自愈**（唯一复活途径 = 新的 entry 对象 / 整页刷新）。
4. **为什么必须落在 `reportEntryError(abdicate:true)` 之前**：`abdicated` 无法从外部清除（§3 逐偏移证据），
   所以任何「事后补救」都无效；唯一合法的介入点是**决定要不要上报**的那一刻。

> ⚠️ 本单元开始时把 `abdicated` 记为 `Set`（`plan.md` 初稿），
> 由 `evidence/prior-art.md §4` 逐字节偏移核正为 **`WeakSet`**，已回改 `plan.md`；结论不变（可被 GC ≠ 可恢复）。

---

## 3. 三条修法对比（摘要；完整版见 `plan.md §1`）

| 方案 | 作用域 | 是否通用 | 核心风险 | 结论 |
|---|---|---|---|---|
| **A-1 在 `runInject` 里同步重试** | renderer | — | — | **结构上不可能**：inject 在 React render 同步栈里跑，provider 在**微任务**上注册，同步自旋会独占调用栈并阻塞微任务队列，永远等不到 |
| **A-2 边界上有界延迟重挂 + 窗口期不 abdicate**（**选定**） | renderer（+ 4 行加性 HMR 闩锁） | **通用**：任何插件的任何槽条目、任何 kind、inject 期或 render 期 | 假阳性窗口 ≤3s 延迟上报（不吞错） | **推荐** |
| **B-1 provider 先注册** | 逐插件 | ✗ | 不闭合窗口（`await Promise.resolve()` 把 provider 挡在 `apply()` 之外；渲染是独立微任务） | 否决 |
| **B-2 `reload()` 等 provider 就绪再返回** | hmr | ✗ | 渲染不挂在 `reload()` 的 promise 链上，拖长它不改变微任务次序 | 否决 |
| **B-3 新旧 provider 交叠交接** | cordis | ✗ | **结构上不可能**：`Service` 构造器即 `reflect.provide`，同名服务一主一从；HMR `.d.ts` 明确「registry-first teardown」是承重顺序 | 否决 |
| **B-4 连带刷新依赖方** | hmr | ✗ | **依赖图不可判定**：cordis 级联唯一门是 `cordis/lib/index.js:836` `if (!(name in fiber.inject)) continue;`，而本缺陷消费**未声明**（补声明⇒自依赖死等；无差别级联⇒影响面失控且内部重演同一竞态） | 否决 |
| **C 部署期停用 `dsh-client-hmr`** | 流程 | 仅覆盖它自己那次写 | 鸡生蛋；收益被强刷吃掉；只防手写、缺陷仍潜伏 | **仅兜底建议** |

**为什么 A 能覆盖「任何插件」而不只是 conversation**：
判据不依赖 `conversation` 的任何特殊性——它只依赖三件**通用**事实：
(i) 失败发生在**槽条目注入/渲染**这条共同路径上（`SlotErrorBoundary` 是 single/keyed/chain/list + root 的**唯一漏斗**）；
(ii) 失败的消息形状是服务缺席（全仓 10 处同形抛出点）；
(iii) 当时处于插件重建窗口（边界实例刚挂载 / HMR 闩锁说 in-flight 或刚完成）。
⇒ 任意插件 X 提供 service S、任意插件 Y 的槽条目在 inject 期需要 S，都走同一条恢复路径。

---

## 4. 实现

### 4.1 补丁件（字面锚点替换，纯加性，不改 shell）

**A1（必需）`dsh-client-ui-renderer/lib/client.js`**，三处锚点（全部唯一命中）：
- `A1-utils`：在 `entryKeyOf` 之后加模块级判据工具
  （`TRANSIENT_GRACE_MS=3000` / `TRANSIENT_DEADLINE_MS=3000` / `TRANSIENT_MAX_ATTEMPTS=8` /
  `TRANSIENT_BACKOFF_MS=[0,16,32,64,128,256,512,1024]` / `TRANSIENT_ERROR_RE=/service unavailable|resolved no scope/i` /
  `isTransientServiceAbsence` / `hmrRebuildRecent` / `recordTransientRecovery`），并把标记 `/*__DSH_SLOT_TRANSIENT_RETRY__*/` 写进文件（幂等键）。
- `A1-doc`：更新 `SlotErrorBoundary` 的类文档，写明「瞬态例外」。
- `A1-boundary`：`SlotErrorBoundary` 加 `attempt` / `mountAt` / `retryTimer`；
  `componentDidCatch` 先判据：**窗口期 ∧ 形状匹配 ∧ 未超预算** ⇒ 记一条恢复记录 + `setState({attempt+1})` +
  `setTimeout(() => setState({failed:false}), backoff)` 后 **return（不调 `onEntryError`）**；
  否则**逐字**走原路径 `console.error("slot entry crashed in '<key>':", error)` + `this.props.onEntryError(error)`；
  加 `componentWillUnmount` 清定时器。

**A2（可选、严格加性）`dsh-client-hmr/lib/client.js`**，两处锚点：
- `A2-rename`：`async function reload(id)` → `async function reloadEntry(id)`（函数体**逐字未动**）；
- `A2-wrapper`：发布 `globalThis.__DSH_HMR__ = {rebuilds,inFlight,lastRebuiltAt}` 并用 try/finally 包一层 `reload(id)`。
  ⇒ **`reload()` 的控制流未变**，只是把「热刷新窗口」变成可直接观测的事实（供 A1 判据与验收探针使用）。
  A1 不依赖 A2：A2 缺失时判据退化为「边界实例刚挂载」，仍覆盖真实竞态。

### 4.2 脚本保证（每一条都有实测）

| 要求 | 实现 | 实测证据 |
|---|---|---|
| dry-run 默认 | 无 `--apply/--rollback/--self-test` 即只打印计划 | `node patch-hmr-timing.mjs` 输出 `[ok]` + 「nothing is written」 |
| 锚点唯一命中否则一个文件都不写 | 先对全部单元算 anchor 命中数；任一 ≠1 ⇒ exit 2 且不写 | 故意篡改一个锚点后 `--apply`：`[anchor-miss] A1-renderer … matched 0 time(s)`、`ABORT`、**exit code = 2**、另一单元（A2）虽 `[ok]` 也**未被写入**（`diff` 与产品树一致、pre-image 目录未创建） |
| 自动 pre-image | 写到 `<preimage-dir>/<unit>.<sha8>.orig` + 索引 `state.json`（含 sha256Before/After、时间） | `preimage-cand/A1-renderer.4361ea09.orig`、`A2-hmr-latch.b4b41453.orig` |
| `node --check` | 每次写入后立刻校验；失败自动还原并 exit 3 | 两个候选均 `node --check: OK` |
| 幂等 | 以标记串判「已打补丁」 | `--self-test`：二次规划报 `already-applied`，标记恰好 1 次 |
| `--rollback` | 按 `state.json` 用 pre-image 还原并校验 sha256 | `--self-test`：还原后 sha256 与基线**逐字节相同**（`4361ea099f70` / `b4b414537f41`） |

`node patch-hmr-timing.mjs --self-test` 的 15 项断言全 PASS（见 §5.6）。

### 4.3 判据「如何区分热刷新窗口与真缺失」的最终实现（三重合取，全部有界）

```
重试 ⇔ attempt < 8
      ∧ (now - boundary.mountAt) ≤ 3000ms                    // 时间预算
      ∧ ( mountAge ≤ 3000ms ∨ HMR 闩锁说 inFlight>0 或 lastRebuiltAt ≤ 3000ms )   // 窗口归属
      ∧ /service unavailable|resolved no scope/i.test(error.message)              // 形状
否则 ⇒ 立即、逐字走原路径（console.error + onEntryError ⇒ abdicate）
```
- **不吞真实错误**：窗口外**零延迟**照旧；窗口内也只在预算内重试，耗尽后**用原始 error 对象**走原路径。
- 每次恢复都进有界环（`globalThis.__DSH_SLOT_TRANSIENT__`，≤50 条），验收可证「是重试救回来的」而不是「碰巧没崩」。
- 重试路径**不打 console.error**（React 是生产构建：`dsh-web-frontend/dist/assets/index-ClqxG24t.js` 含 `react-dom.production`、
  `"Warning: "` 命中 0 次、`"The above error occurred in the"` 命中 0 次 ⇒ 被边界捕获的错误不会自动打日志）
  ⇒ 判据②可达，且**不是靠静音**（耗尽时照打）。

---

（§5 验收、§6 失败/invalid 保留、§7 第二类缺陷登记、§8 同档自复核 见下文）

---

## 5. 第三步：真跑验收（**真的触发了热刷新**）

### 5.1 隔离环境（不触碰 3080、不触碰用户 profile、**产品树零写入**）

| 项 | 值 |
|---|---|
| 隔离 DSH_HOME | `.workspace/lag-fix/exec-hmr/iso-home/`（profile 副本 + 5 个树外插件**只读符号链接** + 会话/存储副本） |
| 宿主 | `DSH_HOME=$PWD/iso-home node ~/.npm-global/…/dsh/lib/bin.js web --port 3187 --host 127.0.0.1 --no-open --trusted-host 127.0.0.1:3187` |
| 确切 URL | **http://127.0.0.1:3187** （受管后台作业 `bash-3`） |
| 用户 GUI | http://127.0.0.1:3080 全程 **200**（起实例前后各测一次，见下） |
| shadow 目录 | `iso-home/profiles/web/node_modules/@deepseek-ai/`（`dsh-client-ui-conversation`、`dsh-client-ui-renderer`） |
| **零产品树写入** | 收尾复核：`sha256(dsh-client-ui-renderer/lib/client.js)=4361ea09…`、`sha256(dsh-client-hmr/lib/client.js)=b4b41453…`，与 §1 基线**完全一致**（mtime 仍为 `2026-09-12 14:56:14`） |

**为什么 shadow 就够（关键机制，决定"能不能真跑 HMR 而不打断用户"）**：
`/plugins/<id>/client.js` 的**路由**与 HMR 的**stat 轮询**读的是同一个 `clientModules.clientPath(id)`
（`dsh-client-modules/lib/index.js:317,480` / `dsh-client-hmr/lib/index.js:95,58,82`），
而该路径由 `createRequire(<profileDir>)` 解析（`dsh-client-modules/lib/index.js:274-276`）
⇒ **写 shadow 字节只让隔离宿主推 `rebuilt`，3080 收不到任何帧**（S1 实测，见 `evidence/isolated-host.md §3.2/§3.3`）。

**触发方式（这就是上一批缺失的那一步）**：对 shadow 里的 `dsh-client-ui-conversation/lib/client.js`
**追加一行无害注释**（`// __PROBE_TRIGGER__ …`），宿主 500 ms 内 stat 发现 ⇒ `clientModules.rebuilt(id)` ⇒
SSE 推帧。**实测抓到的原始帧原文**（页内 EventSource 记录）：

```json
{"type":"rebuilt","id":"@deepseek-ai/dsh-client-ui-conversation","rev":"1994229226e9"}
```

每个臂写 3 次、每次间隔 2.5 s + 沉降 3.5 s；臂结束时按 sha256 **还原原始字节**
（`selfreload` 臂的还原校验：`{"restored": true, "hash": "4361ea099f70506010482babd7075dc700e0f94485e71f0c989b68e4e278c229"}`）。

### 5.2 判据逐条对照（**不可放宽**地逐条给结论）

判据器械说明：`data-slot` 锚点本身用 `display:contents`（`dsh-client-ui-renderer/lib/client.js:740`
`const ANCHOR_STYLE = { display: "contents" }`），**宿主盒恒为 0×0 是设计如此**，所以「面积 > 0」按
**子树内最大可见盒 `maxArea`** 判定（这是既有的、被前几批接受的量法）。

| # | 判据 | 结果 | 证据 |
|---|---|---|---|
| **①** | 施加「无害字节写入 ⇒ 触发 `rebuilt`」后**会话区不消失**：关键 `data-slot` 存在、面积 >0、**打开会话后子树节点 >0** | ✅ **PASS** | `fix` 臂 3 轮全部：`conversation.session` = **2751 节点 / maxArea 25,960,544 px²**；`conversation.composer.bar` = **58 节点 / 165,312 px²**；`conversation` = 2875 节点；`data-slot-error` **0 个**。对照 `repro` 臂同一次触发后：session **1 节点 / maxArea 0**、bar **1 节点 / 0**、`data-slot-error=["conversation.session","conversation.composer.bar"]`。所开会话为**带内容**会话（`conversation.view` = 2749 节点 / 文本 23,642 字符），标题 `会话删除更新误删全部会话…`，**只用「点行标签」打开**（NEVER-CLICK 合规） |
| **②** | `pageerror`/`console.error` 中不再出现 `slot entry crashed in …` 与 `… service unavailable` | ⚠️ **部分 PASS（含一条"字面不可达"的子句，见 §5.3）** | `slot entry crashed in …`：`repro` 6 行 → **`fix` 0 行** ✅。<br>`… service unavailable`：`repro` 12 行 → `fix` **6 行**（每轮 2 行）。**这 6 行的栈已抓取**，源是 **React 自己的「捕获错误」上报路径**，不是本补丁：<br>`at ul (index-ClqxG24t.js:56:161)` ← `at H3.a.componentDidCatch.r.callback (index-ClqxG24t.js:56:676)` ← `u3` ← `s0` ← `l0`。<br>且**未打补丁的对照臂同样每轮 2 行**（`repro` 12 = 6 崩溃行 + 6 同样的 React 行）⇒ 本补丁**没有新增**任何日志。`pageErrors`：两臂**均为 0** |
| **③** | **阴性对照**：让**真的**服务缺失 ⇒ **仍必须如实报错** | ✅ **PASS（两条独立的阴性对照）** | **NC-1 `neg-service`**（route 拦截把 `super(ctx,"conversation")` 改名 ⇒ 服务**真的不存在**）：补丁**在位**，`slot entry crashed in 'conversation.session'` 与 `'conversation.composer.bar'` **照旧出现**（2 行）、`data-slot-error` 两者都出现、`__DSH_SLOT_TRANSIENT__` = **16 条**（= 2 槽 × 8 次上限）⇒ **有界重试耗尽后逐字走原路径、错误原样上报、entry 照样被 abdicate**，**没有任何吞错**。<br>**NC-2 `neg-other`**（inject 抛**非服务**错误 `probe: deliberate non-service failure`）：`__DSH_SLOT_TRANSIENT__` = **0 条**、`slot entry crashed in 'conversation.session'` **1 行**、**零延迟**上报 ⇒ 判据①的形状过滤真的在起作用，**不是无条件重试** |
| **④** | 正常（非 HMR）启动路径**零回归** | ✅ **PASS（同宿主 A/B；口径已在 §6 说明）** | 全部 6 个臂的 `bootSnapshot` 完全一致：`__DSH_BOOT__.entries.length = 42`、`__ModuleLoader__.mode = "live"`、`Failed to load plugins` = `false`、`buttonCount = 38`、`bodyTextLen = 234`（`neg-service` 因服务被破坏为 190/33，预期内）。⇒ **打了补丁与没打补丁的启动路径**在同一个宿主上**逐项相同**。<br>⚠️ 隔离宿主是 **42** 行，用户 3080 新宿主是 **50** 行 —— 差异**与补丁无关**（每个臂都一样），原因与影响见 §6 |
| **⑤** | 修复本身经热刷新**不得自崩** | ✅ **PASS** | `selfreload` 臂：3 次「写到 **renderer 自己** 的 bundle ⇒ 触发它的 `rebuilt`」（`__DSH_HMR__.rebuilds` 1→2→3）后，`crashLines=0`、`unavailableLines=0`、`data-slot-error=[]`、`conversation.session` **仍 2751 节点**、`pageErrors=0` |

### 5.3 关于判据 ② 的诚实裁定（**这是本档最重要的一个"不完全"**）

- 判据 ② 的字面要求「console 里不再出现 `… service unavailable`」在**当前产品里不可达**：
  该文本由 **React 自己**在捕获到 render 错误时打出（栈已证），与槽系统、与本补丁无关；
  且**未打补丁的对照臂每轮同样出现 2 行** ⇒ 本补丁**净新增日志 = 0**。
- 要真正消除它，唯一办法是**让 inject 在窗口期根本不抛**（即推迟条目的重挂，而不是接住错误），
  那属于方案 B/A-1 的范畴（§3 已逐条否决：微任务竞态 + 同名服务一主一从 ⇒ 结构上做不到）。
  另一条更激进的可选变体（**窗口期抑制 outlet 的槽版本通知**）会让「这次重渲染」根本不发生，
  但它改的是 `useSyncExternalStore` 语义、影响所有槽，**超出本单元范围**，**只登记不实现**（见 §7.2）。
- **因此本档采用的等价可判定判据**（建议主 agent 采纳为今后口径）：
  `slot entry crashed in …` 计数 = 0 ∧ `data-slot-error` 计数 = 0 ∧ 会话区 `maxArea`/节点数**不下降** ∧ `pageErrors` = 0。
  `fix` 臂在这四条上全部满足；`repro` 臂全部违反（6 / 2 / 2751→1 / —）。

### 5.4 六臂原始数字（每臂 3 次真实 `rebuilt`）

| 臂 | 补丁 | `rebuilt` 帧 | `_hmr_node` `rebuilds` | `slot entry crashed` | `service unavailable` | `data-slot-error` | `conversation.session` 节点/maxArea | 恢复记录 |
|---|---|---|---|---|---|---|---|---|
| `recon` 基线 | — | 0 | – | 0 | 0 | [] | 2751 / 25,960,544（开臂时） | 0 |
| **`repro` 对照** | **无** | 4 | – | **6** | 12 | **session, composer.bar** | **1 / 0** | 0 |
| **`fix` 修复** | **A1+A2** | 4 | 3 | **0** | 6（React 自打） | **[]** | **2751 / 25,960,544** | **6** |
| `selfreload` 自刷 | A1+A2 | 4 | 3 | 0 | 0 | [] | 2751 / 25,960,544 | 0 |
| `neg-service` 阴性①| A1+A2 | 1（graph） | 0 | **2** | 20 | **session, composer.bar** | 1 / 0 | **16**（耗尽） |
| `neg-other` 阴性② | A1+A2 | 1（graph） | 0 | **1**（非服务错误） | 0 | session | 1 / 0（该槽） | **0**（不重试） |

**恢复记录原文**（`fix` 臂，证明"是重试救回来的"而不是"碰巧没崩"）：

```json
{"slotKey":"conversation.session","message":"ui-conversation: conversation service unavailable",
 "attempt":1,"ageMs":2,"delayMs":0,"viaHmr":true,"at":1790072364053}
{"slotKey":"conversation.composer.bar","message":"ui-conversation: conversation service unavailable",
 "attempt":1,"ageMs":2,"delayMs":0,"viaHmr":true,"at":1790072364053}
```

读法：边界实例挂载后 **2 ms** 就撞上窗口（`ageMs:2`，与 §0.2 的微任务竞态量级一致）；
**第 1 次重试（delay 0 ⇒ 下一个宏任务）就成功**（`attempt:1`，此后该轮不再有记录）；
`viaHmr:true` ⇒ A2 闩锁在撞上的那一刻确实报 `inFlight>0`/刚完成，**窗口归属判据按设计生效**。

### 5.5 交叉复现（两次独立的宿主进程，数字一致）

`fix` 臂在**两个不同的隔离宿主进程**上各跑过一次（宿主重启前后）：

| 运行 | 证据文件 | rebuilds | crash | slotErr | session 节点 | transient |
|---|---|---|---|---|---|---|
| 18:11 | `evidence/probe-fix-2026-09-22T10-11-14-317Z.json` | 3 | 0 | [] | 2751 | 6 |
| 18:19 | `evidence/probe-fix-2026-09-22T10-19-13-826Z.json` | 3 | 0 | [] | 2751 | 6 |

`repro` 对照同样两次复现（3/3 轮次次崩溃）⇒ **不是偶发**。

### 5.6 脚本与自测（`--self-test` 15 项全 PASS）

```
PASS  anchor resolution: A1-renderer (3 edits, each matched exactly once)
PASS  anchor resolution: A2-hmr-latch (2 edits, each matched exactly once)
PASS  apply A1-renderer / A2-hmr-latch      (node --check OK)
PASS  idempotency: A1-renderer / A2-hmr-latch  → already-applied
PASS  marker-once: A1-renderer / A2-hmr-latch  → 1
PASS  renderer: transient gate present / no abdication on the transient path / original report still reachable
PASS  hmr: latch published / reloadEntry wrapper keeps reload() name
PASS  rollback A1-renderer / A2-hmr-latch byte-identical (4361ea099f70 / b4b414537f41)
SELF-TEST: PASS
```

**锚点全不写**（故意篡改一个锚点后 `--apply`）：`[anchor-miss] A1-renderer … matched 0 time(s)` +
`ABORT: … no file was written`，**exit code = 2**，另一单元虽 `[ok]` 也**未被写入**（`diff` 与产品树一致、pre-image 目录未创建）。

---

## 6. 失败 / invalid 保留（不隐藏）

| # | 现象 | 判定 | 根因与处置 |
|---|---|---|---|
| F1 | `selfreload` 首轮 `ENOENT … dsh-client-ui-renderer/lib/client.js -> tmp/….probe-backup.orig`（JSON 488 字节，`steps.error`） | **INVALID，保留** | 当时只 shadow 了 `dsh-client-ui-conversation`，renderer 不在 shadow 里 ⇒ 探针连备份都做不了。处置：`./iso-main.sh shadow dsh-client-ui-renderer` 后重跑 ⇒ 通过（§5.2 ⑤）。**这条 invalid 恰恰说明"写 shadow 字节"这条路是探针唯一会碰磁盘的地方，边界可控且可校验还原** |
| F2 | `neg-service` / `neg-other` 首轮 `transient: null`，`slot entry crashed` 照常出现 | **INVALID（作为"补丁在位"的阴性对照）**，保留 | 探针 bug：`SERVE_PATCHED` 只对 `fix`/`selfreload` 生效 ⇒ 那两个臂其实跑的是**未打补丁**的 renderer，无法证明"补丁在位时仍如实报错"。处置：修成 `SERVE_PATCHED_ARMS = {fix, selfreload, neg-service, neg-other}` 后重跑 ⇒ `neg-service` 得到 `transient=16`（有界耗尽）+ 如实上报，`neg-other` 得到 `transient=0`（零延迟上报） |
| F3 | `recon`/`fix` 首轮 `conversation.session` 节点 = 0（甚至 `null`），判据①的"子树节点>0"无法量 | **弱证据，保留** | 隔离宿主的会话树只列**当前工作区**的会话，而当前工作区的**注册表 sessionIds 对应的 `session-*` 目录没有被我复制**（我第一次复制的是 12 个**裸 UUID 记录目录**，不是注册表引用的 `session-<uuid>` 目录）⇒ 打开的是一个空会话。处置：复制该工作区注册表引用的 **17 个 `session-*` 目录** ⇒ 出现可点开的**带内容会话**（2751 节点 / 23,642 字符）⇒ 判据① 得以按字面量到 |
| F4 | 18:11 那批（宿主计划内冷重启）被中断：`recon`/`repro`/`fix` 已落盘有效，`selfreload` 被杀 | **部分有效，保留** | 宿主重启（2026-09-22 18:11:49）终止了在跑的 turn，非本档错误。处置：重启隔离宿主后整批重跑；**并把 18:11 的 `fix` JSON 留作交叉复现**（§5.5：与 18:19 逐项一致） |
| F5 | 隔离宿主 `entries = 42`，用户 3080 新宿主 `entries = 50` | **已解释，非回归** | 差值 9 行全部是 **profile 本地/树外插件**（`@local/dsh-btw`、`@local/dsh-wallpaper`、`@local/dsh-usage`、`@local/dsh-pptmaster`、`@local/dsh-ssh-gui`、`@local/dsh-subagent-model`、`dsh-workspace-enhancement`、`dsh-taste`、`dsh-vision-adam`；隔离宿主另有 1 行 3080 没有的 `dsh-client-ui-directory-picker-native`）。这些插件在**隔离 DSH_HOME 里没有完整挂载**（`/plugins` 图行由 node 侧挂载结果生成，挂不上的行**静默消失**——S1 已在 `dsh-client-modules/lib/index.js:379-385` 记下这个静默分支）。**关键**：该差值与补丁**完全无关**（6 个臂全部 42 行，打补丁与不打补丁一模一样），且缺陷与修复所在的三个包（`ui-conversation`/`ui-renderer`/`client-hmr`）**都在场**。⇒ 判据④ 用**同宿主 A/B** 判零回归，并把 3080 的 50 行作为参照一并报出 |

**环境未被扰动的实测**：`curl -o /dev/null -w '%{http_code}' http://127.0.0.1:3080/` 起实例前后均 **200**；
产品树两个目标文件 sha256 收尾复核 = 基线（§5.1）；全程未对 3080 或用户 profile 做任何写操作；
探针锁按纪律用 `.workspace/lag-fix/lib/probe-lock.mjs` **新版**（期间实测它按"确证死亡"回收了 `exec-blurfix` 的死亡属主锁，**没有**回收过任何存活属主的锁）。

---

## 7. 登记（**只登记，不顺手改**）

### 7.1 第二类缺陷：`<style>` 归属靠"物化时刻"决定 ⇒ 跨插件误删风险

**结论（疑似缺陷，未实测确认）**：`removeOwnedStyles(id)`（`dsh-client-hmr/lib/client.js:26-28`）
逐字比较 `data-plugin` 删除样式，删除动作本身没错；**错在归属**：
全仓**唯一**给 `<style>` 打 `data-plugin` 的地方是
`dsh-client-modules/lib/client.js:135`：

```js
const claimStyles = (id) => {
  if (typeof document === "undefined") return [];
  for (const el of document.querySelectorAll("style:not([data-plugin])")) el.setAttribute("data-plugin", id);
  …
};
```

它把**当时文档里所有未打标的 `<style>`** 都记到"**正在物化的那个包**"名下。
实测计数（本次亲自复核，不是引用）：全客户端树里
`setAttribute("data-plugin"` **只出现 1 次**（就是上面这行）；
`data-plugin-css` 出现 **80 次、分布在 31 个 bundle** ⇒ 大量注入点只自证 `data-plugin-css`，
`data-plugin` 完全依赖这一行"补票"。
⇒ 只要某个**不属于插件 X 的**未打标 `<style>` 恰好在 X 物化期间存在（shell/别的插件/懒注入/时序错位），
它就会被记成 X 的；**X 之后任一热刷新都会把它删掉**。这与本缺陷**同处"热刷新顺序"这条路径上，但根因不同**
（本缺陷根因 = 未声明依赖 + 微任务竞态 + `abdicated` 永久；此处根因 = 样式归属的"按时刻认领"）。

**建议的最小确认实验**（本档**未执行**，留给后续线）：
物化 A 前用 `document.head.append(Object.assign(document.createElement('style'),…))` 注入一个未打标样式，
随后触发 A 的 `rebuilt`，观察该标签是否被算到 A 名下并消失。**风险面**：任何插件热刷新都可能带走别人的样式，
表现为"刷新后某块 UI 没样式"。**不修**的理由：与"热刷新窗口"是两条独立缺陷，按纪律不扩范围。

### 7.2 方案 A 的一个可选更强变体（登记，未实现）

判据 ② 的字面子句（React 会打 `service unavailable`）可以用**"窗口期抑制 outlet 的槽版本通知"**根治：
在 `SlotOutlet`（`dsh-client-ui-renderer/lib/client.js:744-753`）的 `useSyncExternalStore` 订阅上，
当 `globalThis.__DSH_HMR__` 报窗口时**推迟一次版本通知**，让"这次重渲染"根本不发生 ⇒ inject 不抛 ⇒ React 无从记录。
**不实现的理由**：（a）改的是 uSES 订阅语义，**影响所有槽与所有插件的更新时序**，影响面远超本缺陷；
（b）它只能挡住"由槽版本变化触发"的重渲染，**挡不住**父级重渲染/其它原因在同一窗口内触发的 inject
（`cachedXInject` 只在成功后才写缓存）⇒ 单独使用不闭合窗口，必须与 A-2 叠加才有意义；
（c）与"不扩范围"冲突。**判定：不作为本批交付，登记备选。**

---

## 8. 同档自复核（修订执行复核一体档自裁决）

### 8.1 逐条对照任务书要求

| 要求 | 自检结论 |
|---|---|
| 第一步：≥3 条修法，逐条给作用域/通用性/风险/验收/回滚 + 代码级消除窗口论证 | ✅ 交付于 `plan.md`（A-1/A-2/B-1..B-4/C，共 7 条变体；B 的否决全部落到 cordis 源码行号） |
| 推荐与理由 + 是否覆盖"任何插件" | ✅ `plan.md §1.4` + `report.md §3`（判据只依赖三条**通用**事实：唯一错误边界漏斗 / 服务缺席消息形状 / 插件重建窗口） |
| 第二步：候选件 + 补丁脚本（dry-run 默认 / `--apply` / 锚点唯一否则全不写 / 自动 pre-image / `node --check` / 幂等 / `--rollback`） | ✅ 全部实现且**逐条实测**（§4.2、§5.6）；另附 `--self-test`（15 项）与 `--no-hmr-latch` |
| 第三步：验收**必须含 HMR 路径本身** | ✅ **真写字节 → 真 `rebuilt` 帧 → 真 `reload()`**（帧原文见 §5.1），6 个臂 × 3 次触发 |
| 判据① 会话区不消失（存在性 + 面积 + 会话子树节点） | ✅ PASS（2751 节点 / maxArea 25.96 M px² vs 对照 1 节点 / 0） |
| 判据② 不再出现 `slot entry crashed in …` 与 `… service unavailable` | ⚠️ **部分 PASS**：崩溃行 0（✅）；`service unavailable` 仍出现，但**来源是 React 自身**（栈已证）且**未打补丁的对照臂同样每轮 2 行** ⇒ 本补丁净新增 0 行。字面子句在现产品下不可达，已给出**等价可判定判据**与可选根治方案（§5.3、§7.2）。**这一条如实标注为不完全** |
| 判据③ 阴性对照：真缺失仍须如实报错 | ✅ PASS（NC-1 服务改名 ⇒ 有界重试 16 次后**逐字原样上报 + 照样 abdicate**；NC-2 非服务错误 ⇒ **零延迟**上报、0 次重试） |
| 判据④ 正常启动零回归 | ✅ PASS（同宿主 A/B 六臂完全一致：42 行 / `mode=live` / 无失败界面 / 关键 UI 文本非空）；50 行口径差异已解释（§6 F5） |
| 判据⑤ 修复自身热刷新不得自崩 | ✅ PASS（`selfreload`：renderer 自己重启 3 次，0 错误、会话区 2751 节点不变） |
| 纪律 1 探针锁用新版、绝不回收未确证死亡的锁 | ✅ 遵循（新版；期间它按"确证死亡"回收了 `exec-blurfix` 的死锁属主，未回收任何存活属主） |
| 纪律 2 不点 Sessions 树行内按钮；打开会话只点行标签 | ✅ 遵循（`openFirstSession` 只 `row.click()`；`工作区"dsh"的操作` 按钮**刻意未点**——它正是 Rename/Delete 菜单） |
| 纪律 3 只交付候选，deployed 写入由主 agent 执行 | ✅ 遵循（**产品树零写入**，sha256 收尾复核 = 基线） |
| 纪律 4 不扩范围；第二类缺陷只登记不改 | ✅ 遵循（§7 只登记两件，未改任何与窗口无关的代码） |
| 停止条件 | 未触发任何一条（A 在不吞真实错误的前提下消除了窗口；未改 shell；"注释字节法"风险被 shadow 隔离完全规避） |
| 不做隔离时用"注释字节法"须先备份字节并告知风险 | ✅ 已升级为**更好的方案**：不需要碰产品树，字节写入落在 shadow（等价隔离），且每个臂结束**自动按 sha256 还原**（`selfreload` 的还原校验已记录） |

### 8.2 自裁决：**PASS（带 1 条已登记的偏差 + 2 条限制）**

- **偏差（不影响可用性，但必须让裁决者看到）**：判据 ② 的字面文本子句不可达（React 自身日志），
  已给出等价可判定判据与可选根治方案，**未擅自放宽判据本身**。
- **限制 L1**：隔离宿主图行 42（用户 3080 为 50），差值 9 行是树外插件在隔离 home 未挂载，
  **与补丁无关**；缺陷/修复所在三个包均在位。
- **限制 L2**：`neg-service` 的 abdication 是**预期**行为（真缺失就该退场），
  与 `fix` 臂的"因窗口而崩溃"是**可区分**的（前者 `transient=16` 耗尽后才 abdicate，后者 `transient=1` 即恢复）。

### 8.3 未覆盖 / 剩余风险

| 项 | 说明 |
|---|---|
| 假阳性窗口 | 插件重建后 ≤3 s 内，**任何**消息形如 `service unavailable` 的真实失败都会被重试至多 8 次 / ≤3 s 后才上报（不丢失，只延迟）。NC-1 已实测这条路径的走向 |
| 组件局部状态 | 重挂会丢弃该子树的组件局部状态——这是 React 错误边界语义本身（今天崩溃时也是整体卸载，不是新增损失） |
| `data-slot-error` 瞬时闪现 | 重试期间崩溃面会闪 ~0–16 ms（实测第 1 次重试即成功，肉眼不可见） |
| 真实浏览器（有头 GUI） | 本机有头 Chromium 100% 起不来（SIGTRAP/DLP，既有结论）⇒ 全部用 headless chromium；**未在 Gecko 侧验证** |
| 未在用户 3080 页面上验证 | 按纪律只交付候选；**落地后必须强刷**（`DEPLOY.md §0`），并在强刷后做一次"无害字节写入"自检（`DEPLOY.md §2/§3.1`） |
| 判据② 的 React 日志 | 见 §5.3 / §7.2 |
| 第二类缺陷 | §7.1（只登记） |

### 8.4 BLOCKED 项

**无。** 全部三步均已完成并落盘：选型（`plan.md`）、实现（`patch-hmr-timing.mjs` + `candidate/`）、
真跑验收（`evidence/probe-*.json` + `shots/`）、落地手册（`DEPLOY.md`）。
唯一**不由本档执行**的是"写产品树/重启用户宿主/要求用户强刷"——那是任务书明确划归主 agent 的落地动作。

---

## 9. 运维提示（给主 agent 收口用）

| 资源 | 说明 | 建议 |
|---|---|---|
| 隔离宿主 http://127.0.0.1:3187 | 本档起的**隔离实例**（受管后台作业 **`bash-3`**，`DSH_HOME=…/exec-hmr/iso-home`）。它**不是**用户 GUI | 本档用完后可直接 `job_kill bash-3`；对 3080 无任何影响 |
| `iso-home/` 141 MB | 隔离 profile + shadow 包 + 复制的会话/存储副本（**都在工作区内**） | 收口后可整目录删除；不影响任何交付物 |
| `/tmp/hmr-iso` 298 MB | 早期尝试的"整棵产品树副本"方案，**已放弃并删除**（改用 shadow，更省且同样隔离） | 已清理 |
| 探针锁 | 本档所有探针退出时都 `release()`；收尾时 `inspect()` = `{held:false}` | 无残留 |
| 探针写入面 | 唯一会写磁盘的是 **shadow 里的那一个 bundle 文件**，每个臂结束按 sha256 还原（`selfreload` 有还原校验记录）；**产品树与用户 profile 全程零写入** | — |

**落地顺序（重申）**：`node patch-hmr-timing.mjs --apply` → **要求用户 Ctrl+Shift+R 强刷一次** → 之后每一次客户端写入都受保护。
细节与自检命令见 `DEPLOY.md`。
