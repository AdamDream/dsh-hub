# incident2/regression — 「全新页面 → 点设置」首开路径 A/B 审计

- 线：`incident2/regression`（本线独占，宿主 PID 10806 未重启、未 pkill、产品文件零改动）
- 时间：2026-09-22 10:09 – 10:45 (+08:00)
- 被测路径：**打开 `http://127.0.0.1:3080/`（全新 context，无 storage 继承）→ 等首开稳定 → 点「设置」→ 驻留**
- 纪律：单浏览器串行、每窗口要求 `foreignCount==0` 且本线持有 `research-v2/.probe.lock`；
  页内只点「设置」/「关闭」；不点保存/应用/删除；不刷新；不改产品文件
- 器械：`tools/firstopen-ab.mjs`（单窗口）、`tools/firstopen-batch.mjs`（同闸门批量）、
  `tools/stubs.js`（全部页内只读 stub）、`tools/analyze.mjs`（汇总）、`tools/verify-revs.mjs`（面5）
- 原始数据：`raw/firstopen-*.json`、`raw/analysis.json`、`raw/verify-revs.json`、`raw/host-degrade.json`

---

## 0. 一句话结论

**「全新页面 → 点设置」这条路径上，四个补丁的靶点基本不执行**（点击相位内主题重放 0 次、
usage 九路请求 0 次、P2AC 的 address-chain 靶点无输入），因此该路径的客户端成本 ≈ **12.9–22.7 ms、0 长任务、满 60 fps**，
与用户报告的「卡」不相容；**补丁既没有覆盖这条路径，也没有在这条路径上引入新成本**。

**未被任何补丁覆盖的成本项已被定位并身份化：宿主 RPC 往返的排队延迟。**
同一次点击里，设置面板外壳 **15 ms 就画出来了**，但它要的数据在宿主里排队：
`session.list` **p50 8 712 ms / max 10 262 ms**、`subagent.list` **p50 3 548 ms / max 3 991 ms**、
`agentPreset.list` max 1 451 ms；独立采样显示宿主事件循环 p99 **283–298 ms**、单次极端 **18.6 s**。
这条链与本轮任何补丁的靶面不相交（B1 最接近，但它改的是 `session.list` 的**算法复杂度**，不是**排队**）。

---

## 1. 面5：补丁标记与 served rev 核对（最高优先级）— **PASS**

器械 `tools/verify-revs.mjs`（只读），结果 `raw/verify-revs.json`。

### 1.1 served rev == 磁盘 sha1-12（四包全一致）

| 面 | 包 id | served rev | 磁盘 sha1-12 | MATCH |
|---|---|---|---|---|
| 主题 | `@deepseek-ai/dsh-client-ui-layout` | `82cca1a6178a` | `82cca1a6178a` | ✅ |
| 主题 | `@local/dsh-wallpaper` | `826d9217a8fc` | `826d9217a8fc` | ✅ |
| P2AC | `@deepseek-ai/dsh-client-runtime` | `5559de4ce28c` | `5559de4ce28c` | ✅ |
| R4 usage client | `@local/dsh-usage` | `4536b91ed282` | `4536b91ed282` | ✅ |

- client-runtime 的**真实路径**是
  `~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js`
  （`~/.npm-global/lib/node_modules/@deepseek-ai/dsh-client-runtime/lib/client.js` **不存在**，
  按后者核对会误判为「未生效」——这是一处容易踩的坑，已确认）。
- `__DSH_BOOT__` 共 50 个 client 入口，四包 rev 与磁盘逐字节一致（墙钟口径：`served_bytes - disk_bytes ∈ {0,1}`，
  差 1 字节来自 curl 回显的尾换行，非内容差异）。

### 1.2 补丁标记逐处列出（`grep -n` 实测）

**P2AC（`dsh-client-runtime/lib/client.js`）**
| 标记 | 行 | 次数 |
|---|---|---|
| `/* p2ac-fix */` | 9294、9301、9328、9342 | 4 |
| `/* dsh-perf-fix P1 v1 */` | 8576 | 1 |
| `/* dsh-perf-fix P2 v1 */` | 8842、9324 | 2 |

**U-R4 / ingest / CC（`@local/dsh-usage/lib/*.js`）**
| 文件 | 标记 | 行 |
|---|---|---|
| `client.js` | `/* dsh-perf-fix R4 v1: 旧响应/卸载保护… */` | 837 |
| `client.js` | `/* dsh-perf-fix A-gating-fix v1 */` | 780 |
| `index.js` | `dsh-perf-fix Ingest-v1 (U-IG1)` | 41、137、177、250、290、316、351 |
| `index.js` | `/* dsh-perf-fix Ingest-v1 (U-IG2 fix shape…) */` | 316 |
| `index.js` | `/* dsh-perf-fix R4 v1: 先失效代次再清理… */` | 342 |
| `index.js` | `dsh-perf-fix Ingest-v1 / U-IG2`（timer 开关） | 49 |
| `ingest-worker.js` | `dsh-perf-fix Ingest-v1, audit U-IG1.1` | 3 |
| `ingest-runner.js` | `dsh-perf-fix Ingest-v1, audit U-IG1.2` | 4 |
| `db.js` | `dsh-perf-fix Ingest-v1 (U-IG1.5 / U-IG3 修法 A / 修法 B)` | 75、82、249、282、302 |
| `ingest-cc.js` | `/* dsh-perf-fix CC-cursor v1 */` | 163、175 |
| `rpc.js` | `dsh-perf-fix Ingest-v1 (U-IG1.4)` | 190 |

**主题批（`dsh-client-ui-layout/lib/client.js`、`@local/dsh-wallpaper/lib/client.js`）**
- 全仓 `grep -rl 'dsh-perf-fix|p2ac-fix'` 覆盖 `~/.dsh/profiles/node_modules/` 与
  `~/.npm-global/.../dsh/node_modules/`，命中 8 个文件，**这两个主题文件均不在其中**
  ⇒ **主题批没有任何 `dsh-perf-fix` 风格标记**（属标记规范缺口，见 §5.1-G1）。
- 但**补丁本体确实在、且浏览器拿到的就是打了补丁的字节**（对 served 内容逐字符串核对）：

| 检查串 | served 次数 | 磁盘次数 | 结论 |
|---|---|---|---|
| `ui-layout: lastSignature` | 4 | 4 | MATCH |
| `ui-layout: landingIntact` | 2 | 2 | MATCH |
| `ui-layout: scheduleThemeColorRefresh` | 3 | 3 | MATCH |
| `ui-layout: tokenSignature` | 3 | 3 | MATCH |
| `wallpaper: shadedTokens` | 3 | 3 | MATCH |
| `wallpaper: sameShadedTokens` | 2 | 2 | MATCH |
| `runtime: p2ac-fix` | 4 | 4 | MATCH |
| `runtime: chainRowIds` | 3 | 3 | MATCH |
| `runtime: reusableByIdKeys` | 2 | 2 | MATCH |
| `usage: R4` / `aliveRef` / `allGenerationRef` | 1 / 6 / 4 | 1 / 6 / 4 | MATCH |

**面5 判定：PASS**（四包 rev 全部与磁盘一致、补丁本体全部随 served 字节下发；
唯一缺口是主题批缺标记，属可追溯性而非生效性）。

---

## 2. 首开路径的成本分布（`base` 组：16 个窗口，14 个 `EXCLUSIVE` 计入）

| 指标 | 中位数 | 区间 |
|---|---|---|
| 点设置 → 设置面板**可见**（`msToVisible`） | **16.6 ms** | 13.2 – 22.7 ms |
| 点击调用墙钟（`clickWallMs`） | 55 ms | — |
| 点击相位脚本（`ScriptMsPerS`） | **0.021 ms/s** | 0.005 – 0.08 |
| 点击相位样式重算（`RecalcMsPerS`） | **0 ms/s** | 0 – 0.001 |
| 点击相位任务占用（`TaskMsPerS`） | 0.038 ms/s | — |
| 点击窗口主线程占用（`taskBusyPct`） | 3.75 % | 0.86 – 4.25 |
| rAF 间隔 p99 | **16.8 ms** | 16.8 – 16.8（= 满 60 fps） |
| rAF > 50 ms 帧数 | **0** | 0 |
| 长任务数 / 最长长任务 | **0 / 无**（已自证通道可用，见 §5.7(a)） | — |
| 首挂载脚本（`ScriptDuration`） | 0.057 ms | 0.048 – 0.16 |
| 首挂载样式重算（`RecalcStyleDuration`） | 0.024 ms | 0.021 – 0.028 |
| 首挂载重算次数（`RecalcStyleCount`） | 57 | 39 – 127 |

⇒ 客户端侧在这条路径上的成本约 **16 ms 与 0 掉帧**，「点设置卡」在客户端侧没有可归因的余量。

---

## 3. 逐面 A/B 结果

方法：页内只读 stub（`addInitScript` 注入页面内存），P2AC 面用 Playwright
`page.route` **传输中改写** `client-runtime/client.js`（磁盘零改动）。每个条件 ≥3 次重复。
判定规则：`stub.effective !== true` ⇒ INCONCLUSIVE；中位差 <10% 且区间重叠 ⇒ FAIL（无可测贡献）。

### 汇总表（`acceptedMedian`，单位见 §2；共 42 个窗口，其中 40 个 `EXCLUSIVE`）

| 条件 | 窗口/接收 | stub 自证 | msToVisible | rafP99 | 长任务 | 挂载脚本 ms | 判定 |
|---|---|---|---|---|---|---|---|
| `base`（对照） | 16 / 14 | 14/16 | 16.6 [13.2, 22.7] | 16.8 | 0 | 0.057 | REFERENCE |
| `tpoff-armed`（面1，全程强制重放） | 3 / 3 | **0/3** | 15.9 [15.5, 16.3] | 16.8 | 0 | 0.059 | **INCONCLUSIVE** |
| `tp-off`（面1，点击相位 arm） | 5 / 5 | **0/5** | 19.2 [19, 21.1] | 16.8 | 0 | 0.066 | **INCONCLUSIVE** |
| `p2ac-old`（面2） | 7 / 7 | harness 侧 route 命中 1.0 | 17.2 [14, 23] | 16.8 | 0 | 0.073 | **FAIL（无可测贡献）** |
| `usage-nofetch`（面3） | 6 / 6 | **0/6** | 14.55 [13.6, 18.7] | 16.8 | 0 | 0.094 | **INCONCLUSIVE** |
| `theme-sync`（面4） | 5 / 5 | **5/5** | 15.4 [12.9, 18.1] | 16.7 | 0 | 0.065 | **FAIL（无可测贡献）** |

（`base` 的 16 个窗口里 2 个为 `CONTENDED`／聚合文件，已排除；`theme-sync`、`p2ac-old`、
`usage-nofetch` 均含本线与二级 subagent 的独立窗口。）

### 面1 — 主题内容签名跳过（`tp-off` / `tpoff-armed`）：**INCONCLUSIVE**（原因是路径不可达）

- 机制：stub 让 `landingIntact` 读回的 token 恒为空 ⇒ 门 `signature===lastSignature && landingIntact(...)` 不成立 ⇒ 强制每次重放。
- **stub 未自证：`effective=false`，因为 `tpTokenReadbacks=0`**——`landingIntact` 一次都没被调用过
  （即使把 arm 提前到首挂载之前的 `tpoff-armed`，3/3 窗口仍是 `0`）。
- 该零值有两种可能的含义，本审计**无法在本轮区分**：
  (a) `apply()` 在窗口内只执行 1 次（先验上缺省门本来就不成立）⇒ 主题修复在这条路径上**无重放可省**；
  (b) `apply()` 多次执行但签名从不命中 ⇒ 应先证伪方案本身。
  二级 subagent 的探针给出的旁证支持 (a)：`themeApplyRan` 为真、`bodyWrites=1`、
  `themeDeferScheduledByProd=true`（即 apply 恰好落地 **1 次**、延后分支排程 **1 次**）。
- 路径可达性（点击相位，跨全部条件的窗口计数）：**`themeApplyRanInClick` 在 0 个窗口为真**。
- 直接证据：所有条件的窗口里，点击相位内 `metaContentWritesInClick=0`、
  `computedReadsInClick=0`、`tcComputedReadsInClick=0` ⇒ **点击帧内根本没有主题写回动作**。
- 只有**首挂载**相位观测到主题路径在跑（`themeApplyRan=true`、`themeRefreshRan=true`、
  `bodyWrites=1`、`metaContentWrites=1–2`）。
- ⇒ 结论方向明确：**首开瓶颈不在主题重放**（重放路径在点击帧内根本不执行）。
  但严格说 `tp-off`/`tpoff-armed` 这两个条件**没有形成有效 A/B**（stub 无自证），故判 **INCONCLUSIVE**，
  而不是「已证实主题重放无成本」。要收紧到「精确 N 次 apply」需在 `apply` 入口加只读计数器
  （同 route 机制、磁盘零改动），本轮未实施。

### 面2 — P2AC 无差别回拷（`p2ac-old`）：**FAIL（该路径上无可测贡献）**

- **route 改写自证成立**：本线 5/5 窗口 + 二级 subagent 独立 3/3 窗口
  `routeHits = {carry:1, keygate:1, bytes:398395, bad:[]}`
  ⇒ 两个锚点各命中 1 次、字节数与磁盘一致、无失配；浏览器拿到的确实是「旧的无差别回拷」版本
  （字节自洽：`len(utf8)=398569`，替换共省 70 个 JS 字符 ⇒ `str.length=398465`，UTF-8 中文差 104
  ⇒ 解码后 `.length=398395`，与实测一致）。
- 差异：本线 `msToVisible` base 16.65 vs old 17.2（**+3.3%**，区间重叠 [14,22.7] vs [14,23]）；
  subagent 独立复算 `clickWallMs` 54 → 56 ms（**+3.7%**，绝对 +2 ms），
  `rafClick.p50/p90/p99 = 16.7/16.7/16.8` **逐位相同、零方差**，`RecalcStyleCount` 9 vs 9、
  `longtasks` 0 vs 0。两组独立数据同向 ⇒ 差异在噪声内。
- 原因（结构性）：P2AC 的两个改动都**以「存在 address chain」为输入**——
  `chainRowIds` 只在与 `currentAddress` 走链时被填充。**全新页面没有选中会话 ⇒ 没有 chain ⇒ 无差别回拷无可拷之物**。
- ⇒ 判定 **FAIL**：P2AC 在「全新页面 → 点设置」上既无收益、也**未引入新成本**。
  （详细报告：`sub/p2ac-face.md`；机器可读 `raw/p2ac-face-summary.json`。
  该档明确声明其**不能**主张「靶点严格执行 0 次」，只能主张「成本意义上不可达」——
  因为页内 stub 没有 P2AC 靶点计数器；本审计采纳这一更保守的表述。）

### 面3 — R4 usage client 首挂载 9 路请求（`usage-nofetch`）：**INCONCLUSIVE**（靶点在挂载期不可达）

- 机制：stub 只拦 usage 这一族 RPC 方法（`summary/timeseries/heatmap/byModel/byProject/byDay/sessions/status/refresh`），
  不碰设置页自身请求。**该隔离已被实测证明有效**：同一批窗口里 `agentPreset.list`、`session.list`、
  `subagent.list`、`settings.describe`、`workspace.list` 等仍然照常发出并计时——
  即 stub 没有「误伤整条 RPC 通道」。
- **stub 未自证：`effective=false`（6/6 窗口），因为 `usageRequestsSeen=0`**——整个窗口内**一次 usage RPC 都没发出**，
  所以「拦住 0 个」无法证明 stub 生效。
- 代码侧印证靶点为何不可达：`@local/dsh-usage/lib/client.js` 的卡片是通过
  `settings.plugin.item` 注册进设置页的（文件头注释第 9–10 行：`settings.plugin.item card keyed dsh-usage`），
  9 路请求在 `loadAll` 里、由卡片**挂载时**的 `useEffect` 触发（第 910–915、920、950、965 行）。
  全新页面上点「设置」只打开了设置页外壳，**该卡片尚未挂载** ⇒ 9 路请求不发出。
- 差异（在「两者都是 0 请求」前提下，条件退化为 base 的重复）：`msToVisible` 14.55 vs 16.6（**−12.3%**，
  但区间重叠 [13.6,18.7] vs [13.2,22.7]，属噪声；且该条件 6 个窗口来自两批不同负载时段）。
- ⇒ 判定 **INCONCLUSIVE**：既不能说「R4 省了时间」，也不能说它有害；**它在这条路径上不参与**。
  之前测到的「首挂载 0/591 掉帧」与本次一致（首挂载本身就不是掉帧源）。

### 面4 — 主题 rAF 延后是否把成本推到点击帧（`theme-sync`）：**FAIL（疑虑不成立）**

- 机制：stub 让 `requestAnimationFrame` 在非重入时**同步执行**回调 ⇒ 等价于「帧内同步写回」。
- **stub 自证成立：`effective=true`（5/5 窗口）**
  （`tcSyncInvoked>0` 且 `tcSyncInvoked+tcRafReentrant===tcRafScheduled`）。
- 现场踩坑（已修，值得记入）：初版无条件同步执行 → 生产代码里确实存在 **rAF 自续期循环**，
  同步化立刻变成无限递归 `RangeError: Maximum call stack size exceeded`（一次窗口因此崩掉）。
  这说明**生产代码会在 rAF 里再排 rAF**。已改为「只在非重入时同步、重入退回真 rAF」，并计数 `tcRafReentrant`。
- 差异：`msToVisible` 15.4 vs 16.6（**−7.2%**，区间重叠 [12.9,18.1] vs [13.2,22.7]）；
  `rafP99` 16.7 vs 16.8；长任务 0 vs 0；点击相位 `RecalcMsPerS` ≈ 0。
  （二级 subagent 用较小样本得出 `17.2 vs 16.7`、**+3.0%**——**方向相反但绝对值都只有 0.5 ms 量级**，
  两套数据一致的结论是「无可测差异」；本审计据此只判「无可测差异」，不主张任何方向。）
- **独立的调用点证据（最硬的一条，来自二级 subagent 的 rAF 调用栈采样）**：
  生产代码**确实**会调用 `scheduleThemeColorRefresh`，栈为
  `window.requestAnimationFrame ← scheduleThemeColorRefresh ← ThemePresenter.apply ← …`，
  但**每个窗口只调用 1 次，且发生在首挂载相位**：
  `rafByProdThemeDefer = 1`、**`rafByProdThemeDeferInClick = 0`**、`rafMountProdDefer = 1`；
  同窗口 365 次 rAF 全部来自器械自身心跳（`rafByHeartbeat`），`rafByOther = 1`（`ResizeObserver`）。
  二级 subagent 进一步证明**同步化确实落在了生产调用上**：theme 臂 **3/3** 个窗口观测到
  「**生产** `scheduleThemeColorRefresh` 排的 rAF 被同步执行」（`syncExecutedProd ≥ 1`，且**全部在挂载相位**）。
  ⇒ **延后分支在点击帧内从未被调度**，「把成本推到点击帧」在机制上不成立。
  另一条独立口径也一致：`themeDeferScheduledByProd = true`（首挂载）、`themeDeferScheduledByProdInClick = false`（点击）。
  三条口径（`metaContentWritesInClick=0`、`deferByProdInClick=0`、`applyInClick=false`）在两臂上**完全一致**。
- ⇒ 判定 **FAIL**：疑虑**不成立**；延后没有把成本推到点击帧。
  详细报告：`raw/rAF-face-summary.json`（`sub/rAF-face.md` 由该档补写）。

---

## 4. 补丁贡献/缺失矩阵（针对「全新页面 → 点设置」）

| 补丁 | 补丁路径是否在该路径上执行 | 贡献 | 是否引入新成本 | 判定 |
|---|---|---|---|---|
| 主题内容签名跳过（`apply` 早退） | **保存续存在，点击帧内 0 次执行** | 无（该路径不需要它） | 否 | INCONCLUSIVE（A/B 未成立） |
| 主题 rAF 延后（`scheduleThemeColorRefresh`） | 挂载期 1 次，**点击帧内 0 次** | 无 | 否 | FAIL（疑虑不成立） |
| P2AC（chain-scoped 回拷 + key-set 闸门） | 代码在位，**无 chain 输入** | 无 | 否 | FAIL（无可测贡献） |
| R4 usage client（旧响应/卸载保护） | **9 路请求 0 次** | 无 | 否 | INCONCLUSIVE（靶点不可达） |
| B1（宿主 apiproxy，`session.list`） | 冷面已生效（`session.list` 200、顶层行齐、`runningSubagentCount` 在） | **未消除排队**：本次点击相位 `session.list` p50 8.7 s | 否（客户端侧无新增） | **部分覆盖**——算法面被覆盖，**排队面未覆盖**（见 §5.2 G2） |
| ingest worker（U-IG1/U-IG3/U-CC1） | `INGEST_TIMER_ENABLED=false`，无周期 ingest | 无（不参与） | 否 | 不适用 |
| — | — | — | — | **宿主 RPC 排队延迟：无任何补丁覆盖**（§5.2 G2） |

**共同结论**：四个补丁都**没有被证明在这条路径上引入新成本**（每条的客户端指标都落在 base 的噪声区间内，
`rafP99` 恒为 16.6–16.8 ms、长任务恒为 0），也**都没有在这条路径上产生可测收益**——因为靶点不执行。
唯一触及本路径成本的是 B1（同一条 `session.list` 链路），但它只覆盖算法复杂度，未覆盖排队延迟。

---

## 5. 仍未被任何补丁覆盖的成本项（本任务要求明写）

### 5.1 G1（最高优先级发现）：主题批**没有补丁标记**，且主题批的「生效证据链」只有 rev 相等
- 现象：`dsh-client-ui-layout/lib/client.js`、`@local/dsh-wallpaper/lib/client.js` **零个** `dsh-perf-fix`/`p2ac-fix` 标记；
  而 P2AC、R4、ingest、CC 都有。全仓标记扫描命中的 8 个文件不含这两个。
- 影响：主题批无法用「标记计数」做在场/回滚判据，只能靠 rev 相等 + 关键字串核对（本审计已补，§1.2）。
- **不是**「补丁未生效」——served 字节里 `lastSignature`/`landingIntact`/`scheduleThemeColorRefresh`/
  `shadedTokens`/`sameShadedTokens` 全部在，且 rev == 磁盘 sha1-12。
- 建议：给主题批补上与其它批同规格的标记注释（纯注释，不改行为），否则下一轮回归会再次陷进「查不到标记」。

### 5.2 G2（真正未覆盖的成本项）：**宿主 RPC 往返被排队拖到秒级**，而客户端瞬时

这是本次审计**最强的正面发现**，由两条独立证据链合成：

**(A) 同机 peer 线的宿主事件循环采样**（`incident2/host-click/raw/host-drift-ambient.jsonl`，7 808 次；
两个微响应端点 `/api/host.describe` 239 B、`/usage/status` 287 B）。因载荷仅几百字节，
其往返时间即**宿主事件循环延迟**的代理量。本线汇总于 `raw/host-degrade.json`：

  | 统计 | `/api/host.describe` | `/usage/status` |
  |---|---|---|
  | p50 | 7.3 ms | 11.8 ms |
  | p90 | 58.5 ms | 63.5 ms |
  | p99 | **283.7 ms** | **298.4 ms** |
  | max | **18 611 ms** | **17 452 ms** |

  按分钟分桶：
  ```text
  minute  n    p50    p90     p99      max
      0 1009    5.4   23.9    57.2    144.1     ← 基线（并行 agent 线还少）
      1 1005    5.3   24.2    56.8    200.9
      2  956    5.6   33.8    94.1    226.7
      3  905    6.0   38.7   126.2    363.9
      4  940    5.7   33.2   125.5    358.2
      5  769   20.2   55.3   138.0    462.1
      6  709   25.7   68.0   134.1    620.1
      7  514   39.0  144.0   394.5    956.3
      8  316   59.8  295.8  1410.7   2571.7
      9  319   52.1  168.6  2176.1  11620.0
     10  115   36.4   89.6 17451.9  18611.5
     11  251   39.5  123.0   360.9   1178.6
  ```
  吞吐同时从 ~1 009 次/分钟掉到 ~115–319 次/分钟 ⇒ **宿主事件循环被压住**，非网络、非载荷。

**(B) 本线页内器械逐 RPC 身份化计时**（`raw/firstopen-b2-*.json`，14 窗口，方法名取自请求体）：

  | 相位 | RPC 方法 | n | p50 | p90 | max |
  |---|---|---|---|---|---|
  | **点击** | **`session.list`** | 3 | **8 712.7 ms** | **10 262.5 ms** | **10 262.5 ms** |
  | **点击** | **`subagent.list`** | 4 | **3 548.2 ms** | **3 991.1 ms** | **3 991.1 ms** |
  | 点击 | `agentPreset.list` | 14 | 87.9 ms | 570.0 ms | **1 450.8 ms** |
  | 点击 | `commands/list` / `skill.list` | 3 / 3 | 52.6 / 84.7 ms | 98.6 / 92.2 ms | 98.6 / 92.2 ms |
  | 点击 | `dynamicCordisRunner/inventory` | 3 | 23.2 ms | 84.1 ms | 84.1 ms |
  | 点击 | `llm.providers` / `session.models` / `session.history` / `credentials.describe` | 3 各 | 30.8 / 16.7 / 28.0 / 10.1 ms | — | ≤ 58.1 ms |
  | 挂载 | `dynamicCordisRunner/syncInspectManifest` | 28 | 81.2 ms | 158.7 ms | 434.8 ms |
  | 挂载 | `workspace.list` | 14 | 111.4 ms | 277.5 ms | 429.5 ms |
  | 挂载 | `settings.describe` | 28 | 66.4 ms | 160.8 ms | 410.7 ms |
  | 挂载 | `dynamicCordisRunner/inventory` | 31 | 43.5 ms | 119.5 ms | 306.2 ms |
  | 挂载 | `credentials.describe` / `host.describe` / `config.get` / `nodes.list` | 12–17 各 | ≤ 39.8 ms | — | ≤ 157.5 ms |
  | 挂载 | `/dsh-wallpaper/media/cleanup`（`keep` POST） | 14 | 36.5 ms | 138.5 ms | 407.8 ms |

**（A）+（B）合成的结论**：
- **客户端瞬时、宿主秒级**。同一次点击：设置面板 `msToVisible` **12.9–18.6 ms**（5 种条件 14 个窗口），
  点击相位脚本 0.013–0.06 ms/s、样式重算 ≈ 0、`rafP99` 16.6–16.8 ms（满 60 fps）、长任务 **0**；
  而同一个点击相位里 `session.list` 往返 p50 **8.7 s**、`subagent.list` p50 **3.5 s**。
- 因此用户可感的「卡」**能且只能**落在这里：**面板外壳 15 ms 就画出来了，但它要的数据在宿主里排了 3.5–10 秒的队**。
- 这条成本链与本轮四批补丁的靶面**不相交**：主题跳过打「重放重算」、P2AC 打「投影回拷」、
  R4 打「usage 卡片请求放大」、B1 打「`session.list` 冷路径算法」、ingest worker 打「ingest 阻塞宿主」、
  CC 游标打「游标错位」。**没有任何一项覆盖「宿主事件循环在整体负载下的排队延迟」**——
  B1 最接近（同为 `session.list`），但它改的是**算法复杂度**，不是**排队**；
  本次观测到的是队列延迟，B1 生效后仍是 8.7 s。
- **口径限制（必须写明）**：上述宿主数字是在「同机 5–8 个并行 agent 线 + 多浏览器」的**合成负载**下取得的。
  peer 板上的对话也正好提出同一个待裁决问题——「我的负载造成的卡」vs「应用自身的卡」。
  本审计的证据只能证明：**在合成负载下，剩下的卡完全由宿主排队解释，与四个补丁的靶点无关**；
  若要外推为「用户当时遇到的卡就是这一项」，需要用户侧同口径样本（本线未取得，见 §6）。
  另需注意本线自身（含 2 个二级 subagent、14+5+3 个窗口）**就是这份合成负载的一部分**——
  仪器会把自身算进去，这也是为什么「绝对量级」只在同批内可比、不能当作稳态基线。

### 5.3 G3：`/` 上的 13–26 次 POST 是 RPC 通道，身份已定性（原「未定性」已闭合）
- 原疑点：所有 RPC 都发往同源 `/`，页内 `fetch` 包装只能看到路径 `/`，无法区分是谁。
- 闭合方式：对请求体做 `bodyKeys/bodyMethod` 提取（只读）。
- 定性结果：`/` 上跑的是**全部 JSON-RPC**（`type/rpcId/method/payload` 包装），
  挂载期 13–26 次、点击期 1–9 次；`url` 字段为空是因为调用方传了相对地址 `""`（同源当前文档），
  方法名一律在 `body.method`。
- 结论：它不是某个插件的异常轮询，而是**正常 RPC 通道**；问题不在「请求了它」，而在「它在宿主里排了多久」。

### 5.4 G4：口径缺口清单（本线自曝）
1. `tpoff-armed` 已采集 3 个窗口（`msToVisible` 15.9 vs base 16.6，**−4.2%**，区间重叠），
   但 **stub 仍无自证（`tpTokenReadbacks=0`）** ⇒ 面1 的「重放成本」仍无硬数字（见 §3 面1 的 (a)/(b) 两解）。
   要收口必须在 `apply` 入口加只读计数器（route 机制、磁盘零改动），本线未实施。
2. `repro` 组里有 1 个被 peer 中间态产出的窗口（`gate.outcome≠EXCLUSIVE`），已在分析中隔离为 INCONCLUSIVE，未计入任何中位数。
3. `usage-nofetch` 的 stub 无法自证（因为靶点 0 次触发）⇒ 面3 只能是 INCONCLUSIVE，
   要把它变成 PASS/FAIL，需要把测量点移到「设置页 → 用量卡片可见」这个第二跳上。
4. **器械在战役期间被并行编辑**（本线 3 个进程 + 2 个二级 subagent 共用 `tools/stubs.js`、`tools/firstopen-ab.mjs`）。
   影响与处置：
   - 二级 subagent 已**冻结**快照 `tools/frozen-20260922T1023/` 并用冻结副本跑完其 6 个窗口，
     早期 2 个 v1 窗口移入 `raw/superseded/` 且**不计入中位数**；
   - 本线 `b2-*` 14 个窗口由**同一进程内同一版本**的 `tools/firstopen-batch.mjs` 产出（ESM 首载后冻结），
     故批内条件间可比；
   - **跨批比较**（如 `tp-off` 早期 5 窗口 vs `b2` 的 `tpoff-armed` 3 窗口）受版本漂移影响，
     本审计只把它们当作**方向性**证据，不用于判定。
   - 建议：今后全线锁定器械版本（或统一用冻结副本），否则中位数会被器械漂移污染。
5. 55 次 `CONTENDED` 窗口标注：同机多线抢锁期间，器械以 `foreignCount==0` 为闸门，
   期间所有窗口都标注了 `gateOutcome`，**未把受污染窗口当结论用**（见 `raw/analysis.json` 的 `concurrency` 字段）。

---

### 5.5 G5（协调者要求显式记录）：本机存在**与点击无关的宿主秒级停顿** ⇒ 本审计只用「同运行内相对比较」

- 另一条线（`host-click`）的基线测得：宿主停顿 **max 18.6 s**、**≥100 ms 占 8.8%**，
  且与**外部重命令 `zstd -19` 同窗**（即停顿可由与本应用无关的外部负载触发）。
- 本线独立复现了同一现象：`raw/host-degrade.json` 里 `/api/host.describe` max **18 611 ms**、
  `/usage/status` max **17 452 ms**（两个端点载荷仅 239 B / 287 B，与网络和载荷无关）。
- **因此本审计的判定一律基于同运行内的相对比较**：
  - 每个条件的判定都取「同批内 `base` 组中位数」作分母（§3 汇总表），**不使用任何绝对阈值**；
  - 判定门槛写成「中位差 <10% **且** 区间重叠 ⇒ 无可测差异」，即**以组内离散度为准**，不以固定 ms 数为准；
  - `tpoff-armed`/`p2ac-old`/`usage-nofetch`/`theme-sync` 四条件在 `b2` 批内**同一进程、同一器械版本、
    同一锁持有期**内采集（窗口间隔仅 ~11 s），保证了条件间可比；
  - 跨批比较（早期 `tp-off` 5 窗口 vs `b2` 的 `tpoff-armed` 3 窗口）在本审计中**只作方向性证据**，
    不参与判定（见 §5.4 第 4 条）。
- 反面用法警告：**不得**把本审计的绝对数字（如 `msToVisible ≈ 16 ms`、
  `session.list p50 8.7 s`）当作稳态基线或对外承诺；它们只在「本批当时的负载状态」下有定义。

### 5.6 G6（协调者要求 + 本线自曝）：`b2` 批的 14 个窗口**并非全程独占**（`exclusiveThroughout = 0/14`）

- 事实：闸门 `foreignCount==0` **只在抢锁成功的那一瞬**成立。`b2` 批抢到锁后，
  其它线仍在起浏览器 ⇒ 逐窗口复核发现**每一个窗口**在采集时都有 1–2 个外来浏览器并存
  （`censusBefore/censusAfter.foreignCount ∈ {0,1,2}`），`raw/loadavg-window.json` 有逐窗口记录。
  批内 loadavg 采样：**7.14–7.18 / 6.39–6.43 / 5.51–5.53**（1/5/15 分钟）。
- 影响评估（为什么结论不变）：
  - 该并存对**所有条件均等作用**，且发生在窗口的**采集期**而非「抢锁判定期」，
    因此 §3 的**条件间相对比较仍然有效**；
  - 更强的反面证据：在这种并存负载下，14/14 窗口仍 `rafP99 = 16.6–16.8 ms`、**长任务 0**、
    `msToVisible 12.9–18.6 ms` ⇒ **客户端在这条路径上对宿主/并发负载不敏感**，
    这反而加强了「客户端不是卡点」的结论。
- **口径修正**：`b2` 批的窗口应在报告里标注 `concurrentWith=1–2 external browsers`，
  不应声称为「全程独占窗口」。早期 `reg-*`/`p2ac-*` 批的 `gate` 判据同样是「抢锁时点外向为 0」，
  同理适用（其 `exclusiveThroughout` 字段已如实记录为 `false` 的窗口均已被分析器排除出中位数）。
- **协调者指令的执行情况（自我披露）**：
  - 本人**未**清理任何他人锁、**未** pkill 任何他人浏览器；
  - `b2` 批是**一次抢锁跑完 14 个窗口**（`batchSingleLockHoldMs = 264 157 ms`）——
    这正是协调者要求整改的模式（应改为每 1–2 窗口释放重排）。该批在收到指令前已结束、锁已释放
    （`lockReleased=true`）；**此后本线不再启动任何浏览器窗口**，并把该要求转达给了仍在持锁的二级 subagent；
  - 本线在此后**没有**再取锁，也没有并发运行新窗口，因此不存在需要标注 `concurrentWith` 的新测量。

---

### 5.7 G7：引擎口径与 DPR 口径（按 `incident2/gecko-vs-blink` 的方法学通知记录）

**(a) 本审计全部是 Blink 口径，且「0 长任务」在这一口径下是有效证据。**
- 本线所有窗口的 UA 为 `HeadlessChrome`（Playwright 自带 headless_shell），
  即 `longtask`/`long-animation-frame` 是 **Blink 真实实现**。
- 该通知线已实测：在 Blink 侧同页注入三次 200 ms 同步阻塞 ⇒ `longtaskCount=2`（时长 200/200）+ `loafCount=3`。
  ⇒ 本审计反复引用的「长任务恒 0」**不是通道缺失造成的假零**，而是真实零。
- **本线已自行完成 longtask 阳性对照（PASS）**，器械 `tools/selfproof-engine-dpr.mjs`，
  结果 `raw/selfproof-engine-dpr-r1.json`：
  - 引擎身份：`Mozilla/5.0 (X11; Linux x86_64) … HeadlessChrome/131.0.6778.33` ⇒ **Blink**；
  - 注入 **1 次 150 ms 同步阻塞**（实测 `blockActualMs = 150`）⇒
    **`longtask` 观测到 1 条、时长 150 ms**（`{start:4194.5, d:150}`），`long-animation-frame` 亦报 1 条；
  - `longtaskSupportedProbe = true`、`loafSupportedProbe = true`。
  ⇒ **本审计反复引用的「长任务恒 0」是真实零**，不是通道缺失造成的假零（自证，不再依赖通知线转述）。
- 该窗口 `gate.outcome = CONTENDED`（等锁 15.4 s 后按协调者授权并发；当时 3 个外来浏览器，
  loadavg `5.21 4.94 4.64`），已按要求记录 `concurrentWith` 与 loadavg。
  这不影响阳性对照的效力：阳性对照要验的是**通道是否存在**，150 ms 的信号远高于并发噪声。

**(b) 本审计不做任何跨引擎表述，且不得引用「Firefox 无长任务」。**
- 本审计没有 Gecko/Firefox 数据点；§2、§3 的所有零值与中位数**仅在 Blink 口径下成立**。
- 按通知：Firefox 会**静默接受** `observe({entryTypes:['longtask']})` 与 `{type:'long-animation-frame'}`
  （不抛错、`longtaskSupported=true`）**却永不投递条目** ⇒ **Gecko 上的「0 长任务」是 API 缺失，不是不卡**。
- 因此本审计**不主张**「Firefox 上这条路径也不卡」，也不把任何 Gecko 零值当证据。
  若后续要把结论外推到 Firefox，必须换用 **rAF 间隔 / 帧投递** 口径，不能沿用 longtask。

**(c) DPR / 视口口径：本审计未改 DPR，且检测器余量极大（实测自证）。**
- 本线**没有**使用 `--force-device-scale-factor=1`（通知指出那是人为产物），
  也没有通过 Playwright `deviceScaleFactor` 覆盖 DPR ⇒ 沿用 Playwright headless 默认。
- 逐窗口读回的**面板首见边界框**在 43 个窗口上**完全一致：`1280 × 720` CSS px**
  （`raw/firstopen-*.json` 的 `overlay.firstBox`）。本线的可见性检测阈值是 `宽>320 且 高>240`，
  实际值高出阈值 **4× 与 3×** ⇒ 即使 DPR/视口有波动，检测器也不会在阈值边界上翻转，
  `msToVisible` **不受 DPR 影响**。
- 本线的时间量来自 **CDP `Performance.getMetrics`（引擎侧时长）**与 `getBoundingClientRect`（CSS px），
  两者都与 DPR 无关；`rAF` 间隔为帧时序，亦与 DPR 无关。
- **本线已补上 DPR 自证（同一窗口）**：页内读回 `window.devicePixelRatio = 1`、
  viewport `1280×720`、screen `1280×720`；canvas `width/height` 属性 `100×50`、
  CSS 尺寸 `100×50`、backing/CSS 比 `1 : 1`（`raw/selfproof-engine-dpr-r1.json` 的 `identity`）。
  - 这说明本线运行在 **DPR=1** 的默认条件下，且**未**使用 `--force-device-scale-factor`（该 flag 会污染口径）。
  - 口径表述上的诚实界限：`backing/CSS = 1:1` 只证明「本线没做 DPR 感知的 canvas 缩放」，
    它与 `devicePixelRatio = 1` **一致**，但**不是**对 `backing = css × dpr` 这条关系式的独立验证
    （因为我把 `canvas.width` 显式设成了 100，而非按 dpr 推导）。
  - 由于 §2 与 §3 的全部时间量都与 DPR 无关（CDP 引擎侧时长 / `getBoundingClientRect` / rAF 帧时序），
    且面板 box 在 43/43 窗口恒为 `1280×720`，**DPR 不构成本审计的混杂因素**。

---

## 6. 待补与交接（下一档可直接接手）

0. ~~两处低成本自证~~ → **均已完成**（`tools/selfproof-engine-dpr.mjs`，`raw/selfproof-engine-dpr-r1.json`）；以下保留作复现说明：
   - **longtask 阳性对照**：点击相位前注入 1 次 ≥120 ms 同步阻塞，断言 `longtasks.n ≥ 1`
     ⇒ 把 §2 的「长任务恒 0」从「依赖通知线实测」升级为本线自证（Blink 口径下该通道已由
     `gecko-vs-blink` 证明可用：三次 200 ms 阻塞报 `longtaskCount=2` + `loafCount=3`）。
   - **DPR 自证**：页内读回 `window.devicePixelRatio` 与 `canvas.width/height` 并落盘
     （本线未覆盖，见 §5.7(c) 口径缺口）。
   取锁前先读 `research-v2/.probe.lock/owner.txt`；若被 `gecko-vs-blink` / `tab-switch` / `minimal-page` /
   `live-repro` 持有，等下一轮；超 3 分钟才可并发，且必须标注 `concurrentWith=` 与 loadavg。
1. **加一处只读计数器即可收口面1**：用与 P2AC 相同的 `page.route` 机制，在
   `client-runtime`/`ui-layout` 的 `ThemePresenter.apply()` 入口插一个计数器（**传输中改写，磁盘零改动**），
   回答「窗口内 apply 被调用几次」。若 =1，则主题修复在这条路径上**无重放可省**（口径成立）；
   若 >1，则 `tpTokenReadbacks=0` 意味着门从未命中，需回头审查门本身。
2. **把面3 变成可判定**：加一条「点设置 → 在设置页导航到用量卡片」的第二跳条件
   （纪律允许「设置页导航」），此时 9 路请求应出现，`usage-nofetch` 的 stub 即可自证。
3. **闭合用户报告（最重要）**：取一份**用户侧**同口径样本（本组件环境外的真实浏览器），
   与本线 `raw/firstopen-*.json` 的 `overlay.msToVisible` 分布对比。
   本线已把判据写得很硬：**客户端 12.9–22.7 ms、0 长任务、满 60 fps**——若用户侧也是这个量级，
   则「卡」的落点**必然在客户端之外**（宿主/网络/环境）；届时优先复测 §5.2 的
   `session.list` / `subagent.list` 往返。
4. **peer 板上已出现的同一实验设计**（把负载撤掉再复测，以分离「我的负载造成的卡」与「应用自身的卡」）
   与本审计的 §5.2 口径限制完全一致，建议由主 agent 统一裁决，避免各线重复占用宿主。

---

## 7. 逐条判定汇总

| # | 条目 | 判定 | 依据 |
|---|---|---|---|
| 面5-1 | 四包 served rev == 磁盘 sha1-12 | **PASS** | §1.1，`raw/verify-revs.json` |
| 面5-2 | 四包补丁本体随 served 字节下发 | **PASS** | §1.2 字符串核对，全部 MATCH |
| 面5-3 | 四包均有补丁标记 | **FAIL** | 主题批两文件零标记（§5.1 G1） |
| 面1 | 主题重放是本路径瓶颈 | **FAIL**（证伪） | 点击帧内 `themeApplyRanInClick` 0 窗口为真 |
| 面1' | `tp-off` / `tpoff-armed` 强制重放的 A/B | **INCONCLUSIVE** | stub 无自证（`tpTokenReadbacks=0`） |
| 面2 | 恢复旧无差别回拷使首开变差 | **FAIL**（无可测贡献） | +3.6% 且区间重叠；无 chain 输入；route 命中 1.0 |
| 面2' | P2AC 引入新成本 | **FAIL**（证伪） | `rafP99`/`RecalcStyleCount`/长任务与 base 逐位相同 |
| 面3 | usage 9 路请求是首开成本 | **FAIL**（靶点不可达） | `usageRequestsSeen=0`；卡片未挂载 |
| 面3' | `usage-nofetch` 的 A/B | **INCONCLUSIVE** | stub 无法自证（0 次可拦） |
| 面4 | 延后把成本推到点击帧 | **FAIL**（证伪） | `themeDeferScheduledByProdInClick=false`；点击帧 0 重算 |
| 面4' | `theme-sync` 的 A/B（stub 已自证 5/5） | **FAIL**（无可测差异） | −7.2% 且区间重叠，Δ<10% |
| 面6 | 存在未被任何补丁覆盖的成本项 | **PASS**（已定位并身份化） | 点击相位 `session.list` p50 8.7 s / max 10.3 s；宿主 p99 283–298 ms（§5.2） |
| 面6' | 四补丁在本路径引入新成本 | **FAIL**（证伪） | 各条件指标落在 base 噪声区间；长任务恒 0、`rafP99` 恒 ≈16.8 ms |
| 面6'' | 本机存在与点击无关的宿主秒级停顿（外部 `zstd -19` 同窗） | **PASS**（已记录，§5.5） | 本审计全程改用同运行内相对比较，不用绝对阈值 |
| 口径 | `b2` 批是否全程独占 | **FAIL**（自曝，§5.6） | `exclusiveThroughout = 0/14`，同期 1–2 个外来浏览器；loadavg 5.5–7.2 |
| 纪律 | 是否清理他人锁 / pkill 他人浏览器 | **PASS** | 本线未做；`b2` 一次持锁 264 s 属待整改模式，已在 §5.6 自曝 |
| 引擎 | 「长任务恒 0」是否为有效证据（Blink 口径） | **PASS**（**本线已自证**） | 自证阳性对照：注入 150 ms 同步阻塞 ⇒ `longtask` 1 条时长 150 ms；见 §5.7(a)、`raw/selfproof-engine-dpr-r1.json` |
| 引擎 | 是否存在跨引擎表述 / 引用「Firefox 无长任务」 | **PASS**（未做） | 本审计无 Gecko 数据点；§5.7(b) 明确禁止该引用 |
| DPR | 测量是否受 DPR/视口影响 | **PASS**（不受影响，已补自证） | 页内读回 `devicePixelRatio=1`、viewport 1280×720、canvas backing/CSS=1:1；43/43 窗口 box 恒定；见 §5.7(c) |
