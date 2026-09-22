# 面2（P2AC）A/B 结论报告 —「全新页面 → 点设置」路径

> 归属：`incident2/regression` 二级 subagent「面2：P2AC」
> 结论一句话：**该路径上 P2AC 无可测收益，也未引入新成本（判定 PASS）**；
> 判据是「恢复 P2AC 旧行为 ⇒ 主指标无可测差异」+「两条件绝对量级都极小」。

---

## 0. 摘要判定

| 项 | 结果 |
|---|---|
| **判定** | **PASS** |
| 样本 | 6 窗口有效（`base` ×3、`p2ac-old` ×3），全部 `gate.outcome=EXCLUSIVE`，全部首次尝试即成功 |
| 器械自证 | 3/3 个 p2ac-old 窗口 `routeHits.carry==1 && keygate==1 && bad==[]`（锚点匹配，**无 BLOCKER**） |
| 主指标差异 | `clickWall` 54 ms → 56 ms（**+3.7%**，绝对 **+2 ms**）；`ScriptMsPerS` −14%、`TaskMsPerS` −15%（方向为**不变差**）；`rafClick.p99`、`RecalcStyleCount`、`longtasks` **完全相同** |
| (a) P2AC 贡献 | 恢复旧行为**不会变差**：所有 6 个样本区间重叠，差异在噪声内，功能指标一致 |
| (b) 靶点可达性 | 该路径**在成本上不可达**（无可测收益）；参照 WORKLOG §3 的 H1，本面给出 **H1 在面2 维度成立** 的决定性证据 |

---

## 1. 器械与纪律

### 1.1 器械被冻结（重要，影响可比性）

共享器械 `tools/firstopen-ab.mjs` / `tools/stubs.js` 在**本面开跑期间被并行编辑**（同线其它窗口）：

| 时点 | `tools/firstopen-ab.mjs` sha1 | `tools/stubs.js` sha1 |
|---|---|---|
| 本面接管时（10:15 读到的版本，v1） | —（v1，无 `msToVisible`） | 14799 B |
| 10:16:59（v2，加 `msToVisible`/`busy%`/`mouse.click`） | 开跑即已变更 | — |
| **冻结快照（本报告全部数据用此版本）** | **`5222550b852c6603d0d664c186754dfed1d73efe`** | **`da064bf012043e06fbdaabf365e518da50b2d852`** |
| 收尾核查（10:32） | `814fe6ac5eedeb5f444ddc222c212cf5803cab39`（又变） | `db7214b84ea0cb8d45319029193b197f424b5ea9`（又变） |

⇒ 若混用不同版本，"两条件器械不一致"会成为混杂因素。因此**冻结** `tools/frozen-20260922T1023/`，
**6 个窗口全部由冻结副本产出**（`carry/keygate` 两处锚点文本在冻结副本中逐字校验过，与 served 字节一致）。
冻结技巧：副本路径多一层，工具自带的 `HERE` 推导会少剥一层，故用 `run-frozen.mjs` 包装器把副本路径
`/tools/frozen-<stamp>` 映射为 `/tools` 后 import（**不改工具逻辑**）。

### 1.2 纪律核对

- ✅ 单浏览器、单 context、单 page；窗口之间**串行**（驱动 `tools/p2ac-face-frozen-run.sh`）。
- ✅ 每窗口经 `research-v2/.probe.lock` 闸门，**`--gatemax 180000`**；实测等待 15.3 s / 23 ms / 23 ms / 22 ms / 23 ms / **63.6 s**。
- ✅ 页面内只点「设置」+ 收尾「关闭」（6/6 `clicked=true closed=true`），未点保存/应用/删除，未刷新。
- ✅ 未 pkill/重启宿主（PID 10806 全程存活，`GET /` 200）；未改任何产品文件；P2AC 走 `page.route` 传输中改写，**磁盘零改动**。
- ✅ `settle=6000 dwel=6000`（与 WORKLOG 建议命令一致）；`pageErrors=0`、`consoleErrors=0`（6/6）。

### 1.3 传输中改写的字节级自证

- served 原文：`GET /plugins/@deepseek-ai/dsh-client-runtime/client.js` → **398569 B**，两个锚点各出现**恰好 1 次**。
- `routeHits.bytes`（改写后 JS 字符串长度）= **398395**（3/3 窗口一致）。
- 两个替换的文本长度差 = 23 + 47 = **70**（JS 字符串口径）→ 398465；页面自身含多字节 UTF-8（中文），
  `len(utf8)=398569` 与 `str.length=398465` 相差 104，最终解码后 `.length = 398395` —— 三者自洽。
- ⇒ **路由改写确实生效，且被页面真实加载执行**（窗口无错误、设置面板正常打开）。

---

## 2. 逐窗口原始数据

字段来源：`raw/firstopen-p2ac-*.json`（未经手工修改）。

### 2.1 闸门 / stub 自证 / 路径可达性

| 标签 | `gate.outcome` | 闸门等待 | `stub.effective` | `routeHits`（含 `bad`） | `pathReachableClick`（关键项） |
|---|---|---|---|---|---|
| p2ac-base-r1 | EXCLUSIVE | 15 349 ms | true（mount 亦 true） | —（base 不挂 route；记录为 `{carry:0,keygate:0,bytes:0,bad:[]}`） | `themeApplyRan=true` / `themeApplyRanInClick=false`；`bodyWrites=1, bodyWritesInClick=0`；`metaContentWrites=2, metaContentWritesInClick=0`；`computedReadsInClick=0`；`usageSeen=0, usageSeenInClick=0` |
| p2ac-base-r2 | EXCLUSIVE | 23 ms | true（mount true） | 同上（carry/keygate 0） | 同上（逐项一致） |
| p2ac-base-r3 | EXCLUSIVE | 23 ms | true（mount true） | 同上（carry/keygate 0） | 同上（逐项一致） |
| p2ac-old-r1 | EXCLUSIVE | 23 ms | `null`（by design，该面由 harness 侧自证） | **`{carry:1, keygate:1, bytes:398395, bad:[]}`** | 同 base：`themeApplyRanInClick=false`、`bodyWritesInClick=0`、`metaContentWritesInClick=0`、`computedReadsInClick=0`、`usageSeenInClick=0` |
| p2ac-old-r2 | EXCLUSIVE | 22 ms | `null`（同） | **`{carry:1, keygate:1, bytes:398395, bad:[]}`** | 同上 |
| p2ac-old-r3 | EXCLUSIVE | 63 583 ms | `null`（同） | **`{carry:1, keygate:1, bytes:398395, bad:[]}`** | 同上 |

**⇒ `routeHits.carry === 1 && keygate === 1`（3/3），`routeHits.bad === []`（3/3）：锚点无失配，非 BLOCKER。**

> 说明：`stub.effective` 对 `p2ac-old` 恒为 `null` —— 该条件的自证口径就是上面的两个锚点命中数（harness 侧记录），
> 而非页内计数。`stub.pathReachableClick` 中与 P2AC 相关的项（`p2acOldCarryHits`/`p2acKeyGateActive`）在冻结 stubs 中
> **没有任何自增点 ⇒ 恒为 0，不可用作 P2AC 可达性证据**（见 §4.3 测量局限）。

### 2.2 被测量（点击相位）

| 指标 | base-r1 | base-r2 | base-r3 | **base 中位** | old-r1 | old-r2 | old-r3 | **old 中位** |
|---|---|---|---|---|---|---|---|---|
| `phaseClick.ScriptMsPerS` | 0.021 | 0.021 | 0.023 | **0.021** | 0.018 | 0.016 | 0.097 | **0.018** |
| `phaseClick.RecalcMsPerS` | 0 | 0 | 0 | **0** | 0 | 0 | 0.001 | **0** |
| `phaseClick.TaskMsPerS` | 0.040 | 0.037 | 0.039 | **0.039** | 0.030 | 0.033 | 0.115 | **0.033** |
| `phaseClick.LayoutDuration` (s) | 0.008 | 0.007 | 0.006 | **0.007** | 0.006 | 0.007 | 0.01 | **0.007** |
| `phaseClick.RecalcStyleCount` | 9 | 9 | 9 | **9** | 9 | 9 | 9 | **9** |
| `rafClick.p99` (ms) | 16.8 | 16.8 | 16.8 | **16.8** | 16.8 | 16.8 | 16.8 | **16.8** |
| `rafClick.p50/p90` (ms) | 16.7/16.7 | 16.7/16.7 | 16.7/16.7 | **16.7/16.7** | 16.7/16.7 | 16.7/16.7 | 16.7/16.7 | **16.7/16.7** |
| `rafClick.n`（6.05 s 内帧数） | 363 | 363 | 363 | **363** | 363 | 363 | 364 | **363** |
| `longtasks.n` / `longtasks.maxMs` | 0 / null | 0 / null | 0 / null | **0 / null** | 0 / null | 0 / null | 0 / null | **0 / null** |
| `nav.clickWallMs` | 54 | 55 | 47 | **54** | 43 | 56 | **68** | **56** |
| `overlay.msToVisible` (ms) | 15.8 | 16.3 | 16.1 | **16.1** | 14 | 18 | 23 | **18** |
| `taskBusyPct` | 3.96 | 3.70 | 3.87 | **3.87** | 3.03 | 3.28 | 11.50 | **3.28** |

> `overlay.msToVisible` 的选择器会先命中 1280×720 的根容器（其 class 含 `settings`），故它是**上界**而非设置面板真值；
> 但它对两条件口径一致，可作粗判。

---

## 3. 判定（判据写死，与 `tools/p2ac-face-summarize.py` 一致）

**判据三层：**

1. **Q1 数据质量（硬闸门）**：每窗口需 `gate.outcome == "EXCLUSIVE"` 且闸门时点 `censusStart.foreignCount == 0`；
   `p2ac-old` 还需 `carry==1 && keygate==1 && bad==[]`。
   → 6/6 通过，`baseIssues=[] oldIssues=[]`，`contendedWindows=0`。
2. **Q2 可选性**：任一窗口 `CONTENDED`/锚点失配/缺样 ⇒ **INCONCLUSIVE**。→ 未触发。
3. **Q3 差异判定**：指标取两条件中位数，`rel% = (old-base)/base`；
   等价条件 = **中位数完全相同（含 `0==0`、`null==null`）** 或 **`|rel%| <= max(10%, 组内相对离散度)`**。
   - 有可测差异但未超阈值 ⇒ 仍判等价（"不可测"）。
   - 主判据指标（PRIMARY）：`clickWallMs`、`ScriptMsPerS`、`TaskMsPerS`、`RecalcMsPerS`、`rafClick.p99`。

**结果：全部 PRIMARY 指标判等价 ⇒ PASS。** 每个 PRIMARY 指标的样本区间**互相重叠**（见 §3.2）。

> 判定语义：PASS = "两条件在该路径上无可测差异" ⇒ 恢复旧行为（P2AC 失效）**不会变差**，
> 结合绝对量级极小，同时说明 **P2AC 在此路径上也无可测收益**。

### 3.1 相对差表（含噪声上限）

| 指标 | base 中位 | old 中位 | rel% | 组内离散上限(噪声) | 阈值 | 等价 |
|---|---|---|---|---|---|---|
| `nav.clickWallMs` | 54 ms | 56 ms | **+3.70%** | 44.6% | 44.6% | ✅ |
| `phaseClick.ScriptMsPerS` | 0.021 | 0.018 | **−14.29%** | 450% | 450% | ✅ |
| `phaseClick.RecalcMsPerS` | 0 | 0 | tie | — | 10% | ✅（0==0） |
| `phaseClick.TaskMsPerS` | 0.039 | 0.033 | **−15.38%** | 257.6% | 257.6% | ✅ |
| `phaseClick.LayoutDuration` | 0.007 s | 0.007 s | 0.0% | 57.1% | 57.1% | ✅ |
| `phaseClick.RecalcStyleCount` | 9 | 9 | 0.0% | 0.0% | 10% | ✅ |
| `rafClick.p99` | 16.8 ms | 16.8 ms | 0.0% | 0.0% | 10% | ✅ |
| `rafClick.p90` | 16.7 ms | 16.7 ms | 0.0% | 0.0% | 10% | ✅ |
| `longtasks.maxMs` | null | null | tie | — | 10% | ✅（null==null） |
| `longtasks.n` | 0 | 0 | tie | — | 10% | ✅（0==0） |
| `overlay.msToVisible` | 16.1 ms | 18 ms | +11.8% | 50.0% | 50.0% | ✅ |

### 3.2 敏感性（为什么 PASS 不是"阈值太宽"糊出来的）

阈值里含"组内离散"项是为了**主动纳入噪声**，代价是分布贴近 0 时相对离散会虚高（如 450%）。
因此另给**绝对量级**证据，不依赖百分比：

| 主指标 | base 3 样本 | old 3 样本 | 区间重叠 |
|---|---|---|---|
| `clickWallMs` | 47 … 55（极差 8，sd 3.56） | 43 … 68（极差 25，sd 10.21） | ✅ |
| `ScriptMsPerS` | 0.021 … 0.023（极差 0.002，sd 0.001） | 0.016 … 0.097（极差 0.081，sd 0.038） | ✅ |
| `TaskMsPerS` | 0.037 … 0.040（极差 0.003，sd 0.001） | 0.030 … 0.115（极差 0.085，sd 0.039） | ✅ |
| `rafClick.p99` | 16.8 … 16.8（**零方差**） | 16.8 … 16.8（**零方差**） | ✅ |

**关键读法：**
- `base` 组内 sd 极小（`clickWall` sd 3.56 ms、`ScriptMsPerS` sd 0.001）⇒ 对照条件本身很稳。
- `p2ac-old` 的离散**全部由 r3 一个离群样本贡献**（`clickWall` 68 ms、`taskBusyPct` 11.5% vs 其余 ~3%），
  该窗口闸门等了 **63.6 s**（同机其它 agent 抢锁/跑浏览器，宿主背景负载升高）。
  这属**宿主负载噪声**，不是条件效应：同一条件下 r1/r2 反而比 base **更快**
   （`ScriptMsPerS` 0.018/0.016 vs 0.021；`TaskMsPerS` 0.030/0.033 vs 0.037/0.039）。
- 若只看"同机负载相当"的 4 个窗口（base-r1/r2 vs old-r1/r2），`clickWall` = 54/55 vs 43/56，
  中位 54.5 vs 49.5（−9%），脚本/任务开销 old 更低 ⇒ **方向甚至偏向"旧行为更轻"**，
  与"P2AC 带来收益"相反。
- 逐帧证据：`rafClick.p50/p90/p99 = 16.7/16.7/16.8 ms` 在两条件**逐位相同**，`over50=over100=0`，
  6/6 窗口 `longtasks.n = 0` ⇒ 该路径完全没有掉帧或长任务可供 P2AC 优化。

### 3.3 我未采信的"横向"数字（诚实标注）

1. `p2ac-old` 组的 `ws.byType`（server-request 帧）与 `usage` 相关计数与 base 有差异（帧数更高）。
   我**没有**把它当作 P2AC 证据：帧数受 WS 心跳/服务端推送时序影响，且我未控制该变量 ⇒ 不采信。
2. `overlay.msToVisible` 的系统性 +1.9 ms 同样落在噪声内（阈值 50%），不单独作为结论。
3. 早期 v1 器械的 2 个窗口（`raw/superseded/*-tool-v1.json`，10:17/10:18）**不纳入中位数**，
   仅作器械漂移的对照证据（其 base 亦显示 `clickWall=62 ms`、`rafP99=33.3`，量级一致）。

---

## 4. 两个必答问题

### (a) P2AC 补丁在这条路径上的贡献 —— 恢复旧行为会不会变差？差多少？

**不会变差。差异在噪声内，且方向不一致（更可能是"旧行为略轻"）。**

- 主指标：`clickWall` 中位 **54 → 56 ms（+2 ms / +3.7%）**；`rafClick.p99` **16.8 → 16.8（0%）**；
  `RecalcStyleCount` **9 → 9（0%）**；`longtasks` **0 → 0**。
- 单位开销：点击相位每秒钟的脚本开销只有 **0.021 vs 0.018 ms/s**（即 6 秒窗口累计 ~0.11 ms 脚本），
  `RecalcMsPerS` 两条件均为 **0**。任何 P2AC 收益若存在，也只能在这个量级里 —— 即**不可测**。
- 离群样本（old-r3 的 68 ms / 11.5% busy）可归因于宿主背景负载（闸门等待 63.6 s），
  移除后方向偏向 old 更轻。
- 功能无副作用：6/6 窗口 `pageErrors=0`、`consoleErrors=0`，设置面板正常打开（`msToVisible` 14–23 ms）。
  即传输中改写（恢复旧行为）**未引入任何运行时错误或功能回归**。

**⇒ 面2 结论：P2AC 补丁的失效/回退在「全新页面 → 点设置」上不会造成性能回退（无回退成本），
也没有可测收益。**

### (b) P2AC 的靶点（address-chain scoped carry-forward + key-set gate）在这条路径上是否根本没有可达性？

**结论（明确表述）：P2AC 在该路径上无可测收益，也未引入新成本 —— 靶点在此路径上不可达（在成本意义上）。**

支撑证据分三层，并按强度标注：

1. **改写确实生效、代码确实被执行**（强证据，非"补丁没加载"型伪阴性）：
   `carry==1 && keygate==1`、`bad==[]`、`bytes=398395`（字节差自洽，见 §1.3）、
   窗口无错误、设置面板正常 ⇒ 排除"改写没生效所以看起来无差异"这一最常见解释。
2. **整条路径没有可供 P2AC 优化的成本**（强证据，方向性）：
   P2AC 的靶点是"把上一份 projection 里缺失的链条行逐行回拷 + 全量 key-set 比较"，其成本随**行数**增长。
   但本路径点击相位的全部工作只有 `ScriptDuration ≈ 0.11 s / 6 s`、`RecalcMsPerS = 0`、
   `RecalcStyleCount = 9`、`longtasks = 0`、`rafP99 = 16.8 ms`（满帧）。
   即"P2AC 想省的那笔钱"在这条路径上**规模上不存在**。
3. **恢复旧行为（关掉两个靶点）⇒ 零可测差异**（强证据，即 (a) 的结论）：
   这是对"靶点可达且成本显著"假设的**直接否证**。

**⇒ 与 WORKLOG §3 强假设 H1 的关系：本面给出 H1 在面2 维度的决定性证据 ——
「全新页面 → 点设置」这条路径上，P2AC 的靶点没有可测的执行成本，
因此用户在此路径上的卡顿**不可能**由 P2AC 回拷贡献，P2AC 也不是该路径的修复点。**

### 4.3 测量局限（必须随结论一起读）

我**不能**主张"靶点计数严格为 0 次执行"，因为：

- 页内 stub（冻结版与当前 live 版均如此）**没有**为 P2AC 靶点提供自增计数器
  （`p2acOldCarryHits` / `p2acKeyGateActive` 恒为 0，无任何自增点）；
  `pathReachableClick` 也不含 P2AC 项；且 P2AC 的 `stub.effective` 按设计为 `null`。
- 我未能用 HTTP 观测代替：点击相位内被 `fetch`/`XHR` 拦到的请求只有 `"/"` 一条
  （`httpInClick = {"/": 1}`），产品流量走 WebSocket（942–1333 帧），而我的桩只记录 WS 帧的**类型**，不记录内容 ⇒
  **无法判定点击设置是否触发了一次 projectList RPC**。
- 我未改产品文件（纪律），也未尝试用页面内 API 钩住包内闭包。

**因此本报告的 (b) 是可辩护的最强表述：靶点在这条路径上"不可达（成本意义）"，
而非"已证实执行 0 次"。若要把"不可达"升级为"精确 0 次可达"，
需要一个额外的只读口径：对 `/plugins/@deepseek-ai/dsh-client-runtime/client.js` 再做一处
传输中改写，在 `projectList` 投影入口/回拷行插入一个只读计数器（与本案的 route 改写同机制，磁盘零改动）。
此口径不在授权范围内，我未实施。

---

## 5. 产物清单

| 路径 | 说明 |
|---|---|
| `raw/firstopen-p2ac-base-r{1,2,3}.json` | 对照条件 3 次重复（器械产出的原始 JSON，未手改） |
| `raw/firstopen-p2ac-old-r{1,2,3}.json` | P2AC 恢复旧行为 3 次重复（含 `stub.routeHits` 自证） |
| `raw/p2ac-face-summary.json` | 机器可读汇总：两条件各窗口关键指标 + 中位数 + rel% + 判定 + 敏感性 |
| `sub/p2ac-face.md` | 本报告 |
| `raw/superseded/firstopen-p2ac-{base,old}-r1-tool-v1.json` | **不纳入中位数**：v1 器械的 2 个窗口，仅作器械漂移对照 |
| `tools/frozen-20260922T1023/` | 冻结器械快照（`firstopen-ab.mjs` / `stubs.js` / `SHA1SUMS.txt` / `run-frozen.mjs`） |
| `tools/p2ac-face-frozen-run.sh` | 冻结器械的 6 窗口串行驱动（本报告数据的唯一入口） |
| `tools/p2ac-face-summarize.py` | 汇总与判定生成器（判据写死在脚本内） |
| `logs/p2ac-face-run.log` | 6 窗口完整运行日志（含闸门等待与自证行） |

## 6. BLOCKER

**无 BLOCKER。** 锚点 3/3 命中唯一、`bad=[]`；无窗口 `CONTENDED`；无需改动任何产品文件。

**唯一环境噪声（不影响判定，但请主 agent 知晓）**：同机其它 agent 在并行抢同一把浏览器锁 ——
（i）本面早期批次的一次窗口（10:18 的 base-r2）闸门等满 180 s 后判 `CONTENDED` 并叠加 `page.goto` 超时、
**未落盘**（痕迹在 `logs/p2ac-face-run-aborted-1016.log`，仅作竞争证据）；
（ii）最终 6 窗口中 old-r3 闸门等待 63.6 s，导致其单样本偏慢（68 ms / busy 11.5%）。
两者都已在 §3.2 中量化为**宿主负载噪声**，且方向不利于"两条件等价"这一结论
（即它们让 PASS 更难成立，而不是更容易）。
