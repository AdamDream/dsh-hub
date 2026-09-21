# 测量状态与数据可信度（先读这一页，再读任何性能数字）

- 日期：2026-09-21
- 适用：`research-v2/` 下各线的一切性能数据，以及所有历史性能材料

## 1. 结论一句话

**本机在本轮全程不独占。** 7 条并行线各自启动浏览器，任何单线持锁都拿不到独占；
因此 **所有绝对性能数字（ms、ms/s、fps、p95/p99、commit/s）一律 INCONCLUSIVE，不得当基线**。
**可用的只有结构类与比值类结论**（哪些东西为零、哪些比例恒定、哪条链在每次 commit 必然发生）。

## 2. 协议失败的实测证据

| 观测 | 值 | 来源 |
|---|---|---|
| 某线**持锁** 1635 秒期间的窗口普查 | 每窗 **18–31 个外来 Playwright 进程**，来自 **7 条并行线**；**独占窗口 0/5** | `react-commit/raw/lock-report.json` |
| 另有线**未持锁**先跑完 4 个窗口 | 已自主降级 INCONCLUSIVE | `r4-live-verify/audit.md` §0.1 |
| 绕过手段 | `measure-slot.mjs --nolockwait` 显式跳过锁等待 | 同上 |
| pkill 事故 | 一条线用 `pkill -f playwright_chromiumdev_profile` **误杀兄弟线浏览器**；另有浏览器泄漏存活 24 分钟 | `tab-profile/audit.md` |
| 并发驱动数（另一次独立观测） | 同一时刻 **4 个 peer 测量驱动**在跑；loadavg 20→35 | `measure-hardening/audit.md` |

**处置**：协调者已下令全部线**停止新开浏览器**，改为"已有数据结构分析 + 由协调者统一串行做决定性测量"。

### 2.1 协议修复（硬化线实测，已采纳）

1. **并发普查必须按单位声明**：`pgrep -fc "headless_shell --disable-field-trial-config"` = **主浏览器进程**（不含 renderer/gpu/zygote）；
   而"chromium 全家族"另有一个更大的数（实测同一时刻 7 vs 39）。**两者不是同一把尺子**，已在 baseline JSON 逐样本随附 `unit` 字段。
2. **并发门禁已从"提示"升级为"闸门"**（`--concurrency-gate strict` 为默认）：采集窗口**前/后各断言一次**
   `系统主浏览器实例数 − 自身实例数 == 0`，不满足即该窗口 **invalid**。
   实测效果：某一轮 **16/16 窗口全部 invalid**、`exclusive_fraction=0`，三场景降级为 `INCONCLUSIVE(insufficient-valid-windows)`，
   **没有任何窗口被"抢救"成结论** —— 这是"记录而不自欺"的目标形态。**禁止改用 `record/off` 模式来救结论。**
3. **锁回收规则修正（重要）**：原规则"锁年龄 >25 min 且 owner 进程不存在才可抢占"会导致
   **死进程永不释放锁 → 后续全线停摆**（本轮实测被堵 500 s 空等）。
   ⇒ 新规则：**owner `pid` 已确认不存在即可回收**（不必等 25 min）；`owner.txt` **必须写 `pid` 或 `owner_pid`**（`host_pid` 不是持有者）。
4. **信号处理缺失是孤儿进程/死锁的根因**：Node 的 `SIGTERM` **默认不触发 `'exit'` 事件** ⇒ 只靠 `process.on('exit')` 兜底的探针
   被信号杀死时**既不释放锁也不关浏览器**（实测一次孤儿浏览器存活 24 分钟）。
   ⇒ 所有探针**必须显式接管 `SIGINT/SIGTERM/SIGHUP`**：先关浏览器 → 再释放锁 → 落盘 → 退出（建议 9 s 硬上限）。
5. **本机"真独占"可能不可得**：实测即使在**锁空闲且 loadavg≈10** 时，逐窗口外来实例仍恒为 **2**；
   其中一个是**由 GUI 宿主自身派生的 `headless_shell`**（父进程 = `node …/bin/dsh web`）——即宿主侧还有别的工具会在跑浏览器。
   ⇒ **不得再假设"没人在跑"**；一切性能采集都要以**逐窗口自证**为准。

## 3. 仍然可用的结构/比值结论（跨批、跨竞争强度复现）

| 结论 | 证据 | 可信度 |
|---|---|---|
| 设置**打开**时面板根 **渲染/commit = 1.000** | A 批 5/5 窗口、B 批 2/2 窗口 | 高（比值，跨两批一致） |
| 设置**关闭**时设置侧渲染 **= 0**（同样 session 帧数下） | 关闭对照 9020 帧 / B-L3 4098 帧 → 0 | 高 |
| **CDP 断网**后 commit **= 0**、渲染 = 0 | B-L4/L5 且 session 帧=0 | 高 |
| 设置子树**渲染/commit**：通用 **62.0**（62 fiber 全渲染）、模型 26.5 | B 批 | 中高 |
| 祖先链信号是**状态相关**的：B-L1 通用为自驱动（仅 idx0 SettingsRoot），A 批通用为父驱动（idx0..5 全渲染） | 两批对照 | 中（方向一致，机制待钉行） |
| WS 真实划分在 **`payload.type`**（顶层 `type` 恒为 `server-request`，退化） | 2079 帧全量：`session/event 1813 + projection 248 + subscribed 13 + queue 5` | 高 |
| `mutation_count` 对本应用**无解释力**（0–5/窗口；boot 注入即 93） | 硬化线实测 | 高（**禁止**用 panel MutationObserver 当 re-render 证据） |

## 3.-1 【首位成本项】`ThemePresenter.apply` —— 推翻"会话链为首要机制"

### ★ 3.-1.0 独占批（`cpuX`，7/7 两端门禁通过）——**比值可用；(b) 类绝对值仍不可用**

> ⚠️ **门禁判别力有限（该线自陈，已采纳）**：`cpuX` 的门禁只在**开窗前 + 收窗后**两个瞬时点采样，
> **无法证明整窗无外来实例**（协调者实测持锁期间曾同时有 18–31 个外来进程）。
> ⇒ 因此：**`cpuX` 的比值类结论保留（且与受污染批 `cpuL` 同向）**；
> **其绝对 ms/ms/s 仍归 (b) 类 INCONCLUSIVE**；要拿到可用的绝对基线，须**连续门禁**（M0）或**隔离环境**（另机/容器），**不建议在本机反复重试**。

门禁：`Profiler.start` 前必须 `foreignCount==0 && lockHeldByMe==true`，否则每 4s 重试（上限 120s）。
结果 **7/7 窗口 EXCLUSIVE**（`startForeign=0 / endForeign=0 / mine=1 / lockMine=true / hostPid=1390375`）。
取锁 16:24:54（**未抢占**，轮询 26–37s×8）→ 16:27:37 正确顺序释放。

| 符号 | 命中窗口 | 自时间 | 峰值 ms/s |
|---|---|---|---|
| **`ThemePresenter.apply` @`dsh-client-ui-layout:366`** | **7/7** | **6 208.0 ms** | **150.6** |
| `projectList` @`runtime:9272` | 7/7 | 62.8 ms | 1.61 |
| `buildListSnapshot` @`runtime:8553` | 6/7 | 50.0 ms | 1.48 |
| `flattenLineage` @`runtime:5603` | 6/7 | 15.9 ms | 0.40 |
| `ensureFresh` @`runtime:5689` | 5/7 | 9.6 ms | 0.27 |
| `querySelectorAll`（V8 内建） | 3/7 | 8.5 ms | 0.40 |
| `rebuildRemote`（C2） | 1/7 | 1.07 ms | 0.13 |
| `markDirty` / `getListSnapshot` / `applyMutation` / `recordMutation` / `syncCompletedNotifications` / SVG 生成 | **0/7** | **0** | **0** |
| 设置各包 | 仅 `settings-general` **0.093 ms/s**，其余 **0** | | |

**比值**：`apply ÷ 非 idle = 72.9%`；**`apply ÷ 整条会话链 = 44.9×`**（逐窗 27.7–66.0×）；`apply ÷ ScriptDuration = 2.62×`；
**会话链 ÷ 非 idle = 1.6%**；Script/Task 21.7%、**Recalc/Task 42.9%**、Layout/Task 14.8%。
⚠️ **`apply` 每窗以两个 profile 节点出现（两个调用上下文），必须相加**，否则低估约一半。

### 3.-1.0bis 独占 vs 受污染：**历史绝对值的膨胀倍数**（首次量化）

| 指标 | 独占 | 受污染 | 膨胀 |
|---|---|---|---|
| Script ms/s（home / long-idle） | 11.8 / 9.3 | 53.2 / 95.9 | **4.5× / 10.3×** |
| `apply` ms/s | 10.9 / 34.7 | 105.0 / 712.6 | **9.6× / 20.5×** |
| Task ms/s | 44.5 / 66.6 | 141.0 / 551.6 | 3.2× / 8.3× |
| Recalc ms/s | 10.0 / 38.0 | 55.5 / 352.7 | 5.6× / 9.3× |
| **Layout ms/s** | **22–46（设置态）** | **≈0** | 受污染批把 Layout 测成 0 ⇒ **该指标只有独占批可用** |

⇒ **历史"设置页 script 80–190 ms/s"这类绝对值，至少要先除以 3–10 才可能与独占条件可比。**

### 3.-1.0ter 确定性方向结论（与绝对数字无关，两批同向）

1. **`apply` 是第一位成本项**：独占 7/7 窗第一非 idle 热点，逐窗占该窗非 idle **54%–81%**；受污染批 14/14 同向 ⇒ **不是负载伪影**。
2. **裁决 B 被证伪**：会话链独占仅占非 idle **1.6%**（`buildListSnapshot` 峰值 1.48 ms/s），`apply` 比整条链大 **44.9×**。
3. **`apply` 不由 session 事件率驱动**：独占 7 窗拟合 slope 0.63 ms/s per frame/s、**r²=0.454 且非单调**（13.5 帧/s→118.7 ms/s 高于 85.6 帧/s→84.2 ms/s）；触发源是**主题快照订阅回调**（栈 `layout client.js:440`）。
4. **`apply`/ScriptDuration = 2.5–3.8×** ⇒ 其自时间含 **Blink 为强制重算付出的时间**（根级自定义属性失效 + `getComputedStyle` 同步重算），**不是纯 JS 语句成本**；只能读作"归因帧占比"。

## 3.-1.2 批次完整性分级（cpu-profile 线自核，机读版 `out/integrity-audit.json`）

| 批次 | 本地时间 | 窗口 | 判定 |
|---|---|---|---|
| `s1` | 14:53–15:01 | 28 | **INVALID**（采集侧主动 `job_kill` 让位给锁协议；叠加已知器械缺陷；**数值从未进入任何结论**） |
| `cpu1` | 15:06–15:14 | 28 | 完整但无锁 ⇒ INCONCLUSIVE |
| `cpu2` | 15:21–15:32 | 32 | 完整、无锁 ⇒ INCONCLUSIVE |
| `cpu3` | 15:34–15:41 | 32 | **INVALID**（1 次页面错误 `Cannot read properties of null (reading 'style')`，**成因是该线自己的 init 打桩**：首帧 `document.body === null`；32 窗仅 1 次且不可复现，仍按纪律整批作废） |
| `cpu4` | 15:50–16:00 | 32 | 完整、无锁 ⇒ INCONCLUSIVE |
| `cpuL` | 16:07–16:12 | 14 | 完整、持锁但外来实例并存 ⇒ INCONCLUSIVE |
| **`cpuX`** | **16:24–16:27** | **7** | **★ EXCLUSIVE，7/7 可用（唯一权威批）** |

- 无短窗、无零样本、无 integrity 失败、无序号断档、无 socket 关闭。
- **pkill 事故窗（15:04–15:13）未污染该线数据**：`cpu1`（15:06–15:14）完全落在窗内，但 28/28 窗口墙钟恰为 12.00s、零页面错误、无零帧窗；
  相邻窗最大间隔 44.7s 由**设计中的流探测序列**解释。
- **该线未参与 pkill**：15:04–15:13 零动作；其历史 `kill` 仅针对**自己**的 3 个孤儿浏览器（~14:53）、自己的重复 `census.sh`（~15:56）与自己的 `capture6` job（16:0x），并已主动披露。
- 并发口径警告再次确认（并入协议 §五.1）。


来源：cpu-profile 线（持锁批 `cpuL`，14 窗口；绝对 ms 标 INCONCLUSIVE，比值可用）
证据：`.workspace/lag-fix/research-v2/cpu-profile/audit.md`、`out/analysis-cpuL.json`、`raw/profile-cpuL-*.json`

| 指标 | 实测 |
|---|---|
| **`dsh-client-ui-layout` `ThemePresenter.apply`（`theme-presenter.js:366`）** | 占**非 idle 主线程 CPU 78.6%**；**14/14 窗口第一热点**；**是整条会话链的 75.7×** |
| 强制重算点 | `:375` `setProperty` + `getComputedStyle(body).backgroundColor` |
| 触发点 | `:440`（**主题快照订阅回调**，非 session 事件） |
| cost/script 比 | 首页 **0.98×** → 长会话 **3.5–3.9×** → 设置态 **4.1–4.9×**（随 **DOM 规模**单调放大） |
| 主线程 Task 构成 | `RecalcStyle` **60.0%**、Script 16.8%、Layout 2.2% |
| 可感后果 | rAF 59.1 → **35.6–49/s**；>50ms 帧 6 → **42–80**；LongTask 0 → **15/18** |
| 会话投影链合计 | **3.2–10.1 ms/s（非 idle 的 ~1.0%）** |
| `buildListSnapshot` / `projectList` / `list.set` 通知链 | 1.4–4.2 / 1.3–3.4 / **0–0.53** ms/s |
| 设置各包 | **≤0.14%**（仅 settings-models 0.094 ms/s） |
| C2 `rebuildRemote` / SVG 生成 | **0 命中** |

**推翻**：①「**首要**残余客户端机制 = session/event→buildListSnapshot→projectList→list.set→下游渲染链」**证伪**（占非 idle 1.0%，被 `apply` 大 75.7×）；
②「SettingsRoot/SettingsPanel 无 memo 是活跃流放大器」在**函数级自时间上未证实**（≤0.14%；不否证其导致的重渲染次数）；
③ C2 body observer 同步成本**未证实**；④「after 仍有 80–90 ms/s ⇒ 剩余瓶颈在下游会话链」的归因方向**部分证伪**。

**证实**：设置页是放大器**但放大器易位**——设置打开并非增加设置包 CPU（0 命中），而是把 DOM 节点 3 748→4 638，抬高同一个 `apply` 的 cost/script 比。

**必须同读的边界**：78.6% 是"归因到 `apply` 的主线程 CPU"，**含 Blink 为其强制重算付的时间**，不等于 JS 语句成本；
**未做因果 A/B**（两次打桩未挂上原型）⇒ **只主张归因，不主张"改它即好"**；
**最大未决点**：60% 的 `RecalcStyle` 中"多少由 `apply` 引起、多少由事件驱动 DOM 更新引起"**本轮无法分离**。

**候选最小修（待审计）**：(i) 快照内容签名相同则不重放；(ii) 去掉/延后 `:375` 的 `getComputedStyle` 强制重算；(iii) 逐属性 `setProperty` 合并为一次 style 文本写入。
**决定性实验（待串行排期）**：M-A（独占下签名相同即跳过的 A/B 交替 ≥3 轮）、M-B（阻断 session 事件但保留 apply 重放）、M-C（修 `capture5.mjs` 的 `takePreciseCoverage` 取回时机以取得 apply 调用次数/s）。



### 3.0 三批 13 窗口的比值一致性（react-commit 线收口，最终口径）

| 状态 | 面板渲染/commit | 子树渲染/commit | 断流 |
|---|---|---|---|
| **设置打开** | **1.000**（A 批 5/5、B 批 2/2、H 批 1/1） | 26.5 – 62 | commit = 0 |
| **设置关闭** | **0** | 0 | — |
| 面板渲染/session 帧 | 0.036 – 0.566（跨窗口离散，**不得当基线**） | — | — |

- **状态相关性已被独立复现**：H2 重现了"通用设置 = 0 渲染"的状态（A4 与 debug 切片亦同）⇒ 面板根重渲染**不是"无 memo"的必然结果**，是状态相关的。
- **三批全部 INCONCLUSIVE（绝对速率）**：A 未持锁；B/H 持锁但宿主从未独占。**可用＝比值/结构/归零类；不可用＝一切绝对速率。**
- 前提自证充分：`inject` ×1（react-dom 18.3.1）、`onCommitFiberRoot` 6013+4293+… 次真实回调；"无 memo 代码推定"在该线报告中被明确判 **FAIL 并列为反面教材**。
- **唯一仍缺的测量**：独占条件下的**绝对速率基线**（同页面连续 ≥6×60s、外来实例全程 0、设置开/关各半、分列 `session/event` 与 `session/projection` 速率）。它只用于区分"跨窗离散里多少来自竞争、多少来自事件流自身突发性"，**不阻塞修复决策**。


### 3.1 成本归属的结构结论（model-tab 线，2026-09-21）

| 结论 | 证据 | 可信度 |
|---|---|---|
| **模型面板自身渲染成本 ≈ 0**：每次 commit 在模型面板子树渲染的 fiber **12/12 窗口恒为 0**（展开 provider 编辑卡后仍为 0） | React DevTools hook 双层统计；校准证明器械能看见面板渲染（挂载那次 commit 匹配 **167 fiber**）⇒ 12 窗的 0 是真 0 | 高 |
| 闸流（应用侧事件率 0）下模型标签：Script **0.001 ms/s**、Recalc 0.004、LongTask 0、**59.8 fps**（本机上限） | phase-main | 高 |
| 全应用级**每事件重渲染**才是主成本：**266–281 fiber/commit、7.8 commit/s**；fps↔fiber/窗 **r=−0.81**、fps↔commit/窗 **r=−0.82**（强于任何标签身份量） | phase-main 12 窗相关 | 中高（相关性，非因果） |
| 模型包与 session 事件流**结构解耦**：面板 store 只在挂载与 4 条配置失效信号上重载；窗内 `settings/document-updated` **0 次**、HTTP 0 次、面板 mutation 0、面板文本长度恒定 144 | `client.js:1805`、`2772-2778` | 高 |
| **"模型标签是唯一稳定重灾"被否证**：同一标签在 load1=34 时 7.9 fps、load1=24 时 60.0 fps（**7.6×**）⇒ tab-profile 的模型窗恰落高负载时段且未配对 | model-tab 校准轮 | 高 |
| **不应对 `dsh-client-ui-settings-models` 投入行级 memo/虚拟化/展开惰性化**：作用不到任何被观测到的成本 | model-tab 裁决 | 高 |

**推论（靶点收敛）**：修复资源应投向**渲染器/订阅层的"每事件重渲染"**，而不是任何单个设置标签的内容渲染。

### 3.1bis 机制（代码级，model-tab 线 `structure.md`）

| 事实 | path:line |
|---|---|
| 设置模型包内 **`react.memo` 0 处、`createContext` 0 处、虚拟化标记 0 处**；`useMemo` 仅 3 处（全在 `ProviderEditor`） | settings-models `1402/1403/1412`；列表全裸 `.map()`（`Loaded:1909`、`ModelListEditor:896`） |
| 订阅用**恒等选择器**（整快照） | `client.js:1805` `useSnapshot((s) => s)` → renderer `:154 → 92/158` 的 `useSyncExternalStoreWithSelector`，比较方式 **`Object.is`** |
| **store 引擎每次 update 用 `produce` 产新对象 ⇒ 引用必变 ⇒ 内容没变也重渲染** | `dsh-client-runtime/lib/client.js:5397`（引擎）、**`:5418`（update）** |
| 模型包的 store 唯一写入口只挂在**挂载**与 4 条配置失效信号上；**session 事件不在其中** | `ModelsSettingsStore.load()` `client.js:538`；挂载 `1856`；失效信号 `2772 / 2775 / 2776 / 2777` |
| 每次 commit 重建整棵已挂载子树（合成 fiber ≈45/次）；DOM：折叠 ≈50–56、展开 16 行 ≈265–270、adam 50 行 ≈500 | `structure.md`；行级 map 仅展开时执行（`Loaded:1984`） |

> ⇒ **主候选机制**：`produce` 每次产新快照 + 消费者用恒等选择器 + 缺 memo 边界 = **每个 session 事件都可能引发一次全应用级重渲染**。
> 修复方向因此有三处可选（需 M6 定量后择一或组合）：**(i) 订阅收窄为字段选择器；(ii) 在渲染器/设置子树加 memo 边界；(iii) 内容未变时不产新对象（结构化共享/等值闸门）。**

### 3.2 标签排名被撤回（tab-profile 持锁批次，2026-09-21 15:44–15:55）

| 标签 | 无锁批 w1 fps / >50ms 每百帧 | **持锁批** w1 fps / >50ms 每百帧 |
|---|---|---|
| 模型 | 27.2 / 31.94（4/4 饿死） | **57.8 / 0.26（0/4）** |
| 插件 | 36.5 / 19.14（2/4） | **58.4 / 0.35（0/4）** |

- 批次间唯一系统差异 = 并发负载（基线 **Script 0.43×**、环境事件率 **0.10×**）⇒ 无锁批次的"模型/插件卡"是**与并发探针共变的伪影**。
- **两批对"哪个标签卡"的一致标签数 = 0/1** ⇒ **不存在可复现的"最差标签"**。
- 44→42 窗锁认证：**42/42（100%）持锁** vs 无锁批 **0/42**；无锁批全部标 INCONCLUSIVE。

结构化结论（只用比值/为零/占比）：

| # | 结论 |
|---|---|
| S1 | 8 标签中帧干净的 **7/8**（0.96–1.00× 基线 fps） |
| S6 | 打开/切换构成卡顿 **0 例 / 16 次** >100ms（6.6–12.8ms，最大 = 阈值 **0.128×**） |
| S7 | `/usage` 首次 9 路：掉帧 **0/591 = 0%**、饿死窗 0 例 |
| S8 | 宿主 `/usage` 慢 **2.11×** 而客户端帧率 **1.02×（不变）** ⇒ **宿主与客户端解耦** |
| S9 | 切走后轮询请求 **0 次**（门控有效） |
| S12 | 唯一指向退化的标签：子代理模型（持锁批 3/4 窗）**但无锁批 0/4 且首窗 0/595 掉帧** ⇒ **未复现，不定性** |

**⚠️ 对"churn 导致卡顿"的第二处削弱**：Script↔事件率相关性**在两批间符号相反**（持锁 **+0.483** vs 无锁 **−0.183**）。
结合硬化线的反例（更忙的一轮客户端指标更好），**"事件率越高越卡"在本机数据上不成立**。

**需要裁决的张力**（记入待办）：结构性因果成立（**有事件流才渲染**：设置关闭 0 渲染、断网 0 commit；
打开时子树 62 fiber/commit），但**成本量级未被建立**（绝对数字不可用、跨批相关性不稳）。
⇒ 必须在**独占条件**下做同标签 gated vs ungated 的**同窗成本占比**对照（见 §5 的 M6）。

## 4. 必须撤回/降级的历史材料（硬化线 §5，8 项）

1. `BEFORE-AFTER.md` 的 **ws 整列**：分母 bug 使数值膨胀 **1.25×/2.33×/3.33×**（记 16.3 实为 54.2；记 82.6 实为 192.5 = 基线 2.6×）。**用错数字执行"可比性纪律"**。
2. `ws_by_keyword` 分类：关键词子串命中**重复计数**（合计 1629 > 总数 1456），不是划分。
3. N 列（734 / 2396）：**7 份历史 artifact 中 5 份 `items:null, bytes:680`** —— 裸 body 得 **HTTP 200** + `result.ok=false`，只查 `res.status` 的探针会当成功 ⇒ 那些 artifact 从未测到 N。
4. `>50ms 22→4` 的归因（跨 N、跨负载、跨分类口径）。
5. "三项客户端门槛通过"的全部表述。
6. 由 `settings-jank-audit-live.json` 推出的任何"涨幅"：该文件存的是 **CDP 累计值**（0.196→0.653 单调递增），当窗口测量用即伪影。
7. 单轮 20s 判定：同 N、同 bundle、**同探针字节**仍出现 PASS / FAIL / MIXED（run2/3/5/6）。
8. "事件率高 ⇒ 更卡"：反例——更忙的一轮（loadavg 56.3 vs 19.97、事件率 109.8 vs 86.8/s）客户端指标**更好**。

## 5. 需要协调者统一串行执行的决定性测量（待排期）

先决条件：`pgrep -fc "headless_shell --disable-field-trial-config"` ≈ 1、loadavg 稳定、**单命令前台独占**跑
（后台 job 期间再发命令会让浏览器被进程树回收，实测 SIGTERM exitCode=143）。

| # | 目的 | 设计要点 |
|---|---|---|
| M1 | 分离**模型标签固有渲染 vs churn 放大** | **同标签内**变事件率，各 ≥3×60s；记录每窗 `payload.type` 速率与并发实例数 |
| M2 | 让 `settings-dwell` 的 4/4 FAIL 成为结论或否证 | **随机化阶段顺序**（或加第 4 个等长空场景作对照），消除顺序混淆 |
| M3 | 固定 React commit 比值（哪条链每 commit 必发生） | hook 器械 + 关闭/断流对照，报比值而非速率 |
| M4 | CPU profile top-down 归因 | 独占下取自时间占比（结构结论优先，绝对 ms 仅同窗相对比较） |
| M5 | 可感终点校准 | click-to-next-paint p95 / 长任务比例，替代"script<60ms/s"这类代理门槛 |
| M6 | **裁决"churn 的量级"**（当前最大未决张力） | **同标签** gated vs ungated 各 ≥3×60s，同一窗口长度；报**同窗成本占比**与 fiber/commit 比值，而不是跨窗绝对 ms；需随机化条件顺序 |
| M7 | **宿主停顿 vs 客户端渲染，谁是"用户可感卡顿"** | 独占/并发两条件下测宿主 RPC wall time 分布（p50/p95/max、>100ms、>1s 次数）：R4 实效线在并发下曾实测 status **11.06s**、summary 8.19s、session.list 9.80s。若独占下仍出现秒级停顿 ⇒ 主因在宿主侧（ingest/DB/事件循环），客户端渲染不是用户可感卡顿的来源 |

## 6. 指标口径纠正（必须遵守）

**并发普查的自匹配陷阱（实测）**：`pgrep -c -f "headless_shell --disable-field-trial-config"` 会**匹配执行它的那条命令本身**，
在本机安静时该命令返回 **2**，而按 `/proc/*/exe` 精确计数是 **0**。
⇒ **禁止用"模式串出现在自己命令行里"的 `pgrep -f` 作为并发口径**；必须按 `/proc/<pid>/exe` 统计，或显式排除自身（含父 shell）。
⇒ 各线此前的并发数字（"5 个"、"18–31 个"）因此**含自匹配虚高**；但"不独占"这一结论另有驱动进程名旁证，结论不变。

**M7 宿主停顿实测（协调者，独占：`/proc` 精确计数 0 个浏览器，2026-09-21 16:1x，72 次调用）**

| endpoint | p50 | p95 | max | >100ms | >1s |
|---|---|---|---|---|---|
| `/api/session.list` | **250.5** | 400.1 | 434.9 | **12/12** | 0 |
| `/usage/byDay` | **189.4** | 245.9 | 335.8 | **12/12** | 0 |
| `/usage/summary` | 26.7 | 349.7 | 458.7 | 2/12 | 0 |
| `/usage/status` | 6.3 | 98.5 | 100.7 | 1/12 | 0 |
| `/usage/heatmap` | 1.7 | 2.6 | 83.3 | 0 | 0 |
| `/api/host.describe` | 1.4 | 2.1 | 2.2 | 0 | 0 |

- **静默态 0/72 次秒级停顿** ⇒ 此前 R4 实效线看到的 11.06s/8.19s/9.80s 停顿**由并发负载造成，非常态**（"宿主秒级冻住是常态"这一假设**被削弱**）。
- 但**稳定的数百毫秒级单次成本**仍在：`session.list`（250ms，500KB 载荷）与 `usage/byDay`（189ms）**每次都 >100ms**。
- **timer 二次确认（静默条件）**：`lastIngest` 恒定于 16:04:54，7.7 分钟后仍不变（≥10 个 45s 周期）⇒ **确凿不触发**。

### 6.1 对"用户可感卡顿"的归属更新

| 候选 | 更新后判断 |
|---|---|
| 宿主秒级冻结（常态） | **削弱**（静默态 0/72） |
| 宿主数百毫秒级单次成本（session.list / byDay / summary） | **成立**（可与 60s 轮询或列表刷新叠加） |
| ingest 触发时的 2.7s 同步阻塞（手动 refresh / 若 timer 恢复） | **成立**（量级匹配） |
| 冷启动 ingest 36s | **成立**（首次使用时最明显） |
| 客户端每事件重渲染（62 fiber/commit @≈7.8 commit/s） | **成立**（活跃流下持续成本） |


**时区口径（跨线比较前必做）**：部分线的 harness 用 `new Date().toISOString()` 记录，**记的是 UTC**，而宿主是 **CST(+08:00)**。
⇒ 例如某线报的 `T07:33:48Z` 本地实为 **15:33:48**。**任何跨线"窗口是否重叠／谁在何时跑"的判断，必须先把全部时间换算成本地时刻再比**，否则会系统性差 8 小时。

**hook 下标纠正（root-subscriptions 线，器械自证）**：`react-commit` 线所用的 hook 下标映射 **`{5,6,7}` 是错的**，正确为 **`{7,12,17}`**
—— 每个 `use-sync-external-store` shim 展开为 5 槽（`useRef + useMemo + useSyncExternalStore + useEffect + useDebugValue`）。
⇒ **任何基于旧下标的 hook 级结论必须重核**（其自证依据：`hooks[17]` 是 boolean，对应 `useSessions`）。

**两个 object selector 已被实测排除**（不要按"整对象 selector"方向修）：
`useSections((s)=>s)` / `useOnboardingSteps((s)=>s)` 在 **6329 次**真实渲染中输出引用变化 **0 次**、store `subscribe` **0 次**；
原因是两个 store 的 `getSnapshot` **自带记忆键**（`settings-general.js:496-509` / `:521-531`），未变化时直接 `return rows`。

**设置页重渲染的可信落点（供修复批次用）**：
- 父路径放大器**结构确证**：`SlotOutlet` 渲染 ⇒ 无 memo 的 `RootEntry` → `SlotErrorBoundary` → `SettingsRoot` 逐级执行
- 候选修法排序（**已更新**）：**F1** `slot-renderer.tsx` 给 `RootEntry` 加 memo（断父路径级联）→ **F3** `SettingsRoot.tsx:188-189` 内容比较器（**必须比较 `label`**，否则吞掉语言切换）→ ~~F2~~ 稳定 `getSnapshot` 闭包 **已降级为"减负项"**：实测 uSES 内部元组（shim 槽 6/11/16）在**两条路径上都每次重建** ⇒ 它不是自渲染的判别因子，既不能解释也不能单独消除自渲染
- "切回通用 = 0 渲染"是**条件性静默**，不是修复生效（general 290/290 父驱动；models 142/259 自驱动；models-again 155/155 自驱动）
- **自渲染的最终点火源仍未钉死**（INCONCLUSIVE）：145 次自渲染上 22 个 hook 槽逐字节相同、父链与 store 均静默、`useState(open)` 恒 true

### 6.0.bis 两处必须随结论引用的限定（root-subscriptions 线自陈 + 协调者发现的张力）

1. **排除的依据强度**：对两个 object selector 的**排除**基于 **fiber 级读取**，不是 selector 函数级插桩
（函数级插桩 0 条 —— 小对象 selector 在 `Object.is` 命中时 React 直接 bail out、**根本不调用 selector**）。
结论成立，但下游若要依赖它，应补做"`lanes`/`childLanes` 读取 + `RootEntry` 执行口径"两项。
2. **"父路径由 locale revision 触发"与 sections 的记忆键之间存在张力（未裁决）**：
sections 的 `getSnapshot` 记忆键**包含** `locale.getSnapshot().revision`（`settings-general.js:496-509`）。
若该 revision 真在近乎每次 commit 变化（父驱动 144/145 测得 `changedVsAlt=true`），则 sections 的记忆键应被**击穿**、selector 输出身份应变化 ——
但实测 sections 输出引用变化 **0 次**。两者不能同时为真 ⇒ 该归因需与"槽版本恒 35、0 变化"一起重审；
也可能是读取器读到的是**每渲染重建的对象的字段**而非 store 值。**在该矛盾解释清楚前，不得把"locale revision"当作父路径的既定点火源。**

## 7. 硬化探针（可直接复用的资产）

`research-v2/measure-hardening/probes/harden-measure.mjs`：DSH RPC 信封 + 四项契约硬校验、
每窗 N 快照、各计数器自带 t_start/t_end、WS 按 `payload.type` 分类并**校验是否构成划分**、
run 级 ready + window 级 phase 门禁、invalid 全量落盘（无 best-window）、n=5 统计、
9 类操作有界超时。**退出码语义**：`0` = 仅框架自检通过（≠ 性能通过）／`2` = 有 invalid/超门槛／`1` = 框架 FATAL。
`react-commit/scripts/measure.mjs --plan lock` 可逐窗口记录外来浏览器普查，用作锁有效性探测器。
