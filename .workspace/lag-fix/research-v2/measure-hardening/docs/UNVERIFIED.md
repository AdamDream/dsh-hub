# 未验证 / 不可归因清单

> 生成于本轮测量框架硬化。每条都给出「为什么无法验证」与「若要验证需要什么」。
> 这份清单的作用是**防止把未知写成已知**：任何 L2/L3 级结论都必须先把这里清空。

---

## A. 结构性无法验证（本机 + 只读约束下做不到）

### A1 无法人为制造可控流式负载 ← **最严重的限制**

- **现象**：`session/event` 流由宿主上真实运行的会话产生，探针只能**观测**不能**注入**。
  本目录基线实测（`runs/baseline-live.json`）单轮内 `session/event` 速率跨度 **3.1 ~ 110 /s**；
  另一轮（`runs/run2-clean.json`）跨度 2.6 ~ 212 /s。跨轮极值可达 **276 /s**。
- **已现场证明"想做也做不到"**：run5 的 idle 速率区间 `[66.4, 110.1]` 与 settings-dwell
  区间 `[3.1, 11.8]` **完全不相交** ⇒ 该轮**不存在任何同事件率配对**（`probes/recompute-check.py`
  会直接报 `❌ 区间不相交`）。配对能否成立取决于运气。
- **后果**：
  1. "同事件率配对"只能**事后按桶筛选**，不能事前保证样本量；
  2. 某些事件率桶（尤其 `very-high >150/s`）可能需要长时间等待自然负载落入，
     本轮若未落入，该桶的结论必须是 `INCONCLUSIVE`；
  3. 无法做"把事件率固定为 R，再比较 before/after"的干净因果实验。
- **要验证需要**：一个能按指定 rate 向 mux socket 投递**合成** `session/event` 帧的
  replay generator（需要宿主侧或一个假宿主；本轮**未实现、未尝试**）。
- **本轮裁决**：`不可归因` —— 任何 before/after 的端到端差值都不能声称"在同等负载下测得"。

### A1b 环境不独占（并发租户）

- 测量期间机器上同时跑着其他 agent 的 Playwright 浏览器。基线 artifact 如实记录：
  `at_start loadavg=19.97`、`concurrent_browser_processes=2`；
  `at_end loadavg=35.51`、`concurrent_browser_processes=4`（32 核）。
- 后果：**"同工况"在单轮内部都难以维持**；跨轮的绝对差值不可比。
- 要验证/解除：测量前确认 `concurrent_browser_processes ≈ 1` 且 loadavg 处于预注册区间，
  并把快照写进 artifact（`harden-measure.mjs` 已自动记录 start/end 两处）。

### A2 无第二台独立环境 → 无法做 L3

- 单机、单宿主实例、单浏览器。无独立复现方，因此协议中 L3（"已消除用户可感卡顿"）
  **在本环境内不可达**。

### A3 无用户可感终点

- 未采集真实用户交互延迟（点击→呈现）、未采集输入延迟、未做主观卡顿评分。
- 因此 primary 终点里的 `frames_over_50ms_ratio` / `long_task_total_ms_per_s`
  是**代理指标**，其与"用户觉得卡"的关系**在本轮完全未验证**。

### A4 宿主侧冻结不在覆盖范围

- usage 插件同步 SQLite 导致的宿主事件循环停顿（历史证据 297.5/476.5ms）发生在**宿主进程**，
  浏览器 CDP/rAF 指标**看不见**。
- 本探针不含宿主 RPC latency / 停顿探针 → 本轮 artifact **不能**用于任何宿主侧结论。

### A5 headless 环境偏差

- headless Chromium 的 rAF 由 CPU 合成器节拍驱动，与有头窗口 + 真实显示器刷新率/合成路径不同。
- 本轮的绝对 ms 值**不可**直接外推到用户的有头环境；只可用于**同环境内**的相对比较。

---

## B. 口径与精度上的未验证

### B1 `script_ms_per_s < 60` / `frame_p99 < 50ms` 的门槛合理性未验证

- 两个数值来自历史验收文档（`reports/BEFORE-AFTER.md` §三），
  没有任何用户可感终点与之做过相关性/校准。
- 也就是说：**即使这两个门槛全绿，也不能推出"用户不卡"**——历史上正是"指标通过但仍卡"。
- 本轮把它们的地位降为 **secondary**（见 `docs/PROTOCOL.md` §3.2）。

### B2 N 是快照量

- `session.list` 快照在每个窗口采一次；窗口期间 N 可能变化（会话被创建/归档/子代理增删）。
- 单次快照是近似；真正的 N 应在窗口内多次采样取中位数（**本轮未做**）。

### B3 CDP 指标跨时钟映射误差

- CDP `Performance.getMetrics` 与页面 `performance.now()` 是不同时钟。
  本探针用 node `Date.now()` 做一次映射，`clock.offset_uncertainty_ms` 为半 RTT。
- 后果：CDP delta **无法**在"共同区间"内重切，只能按 CDP 自身区间报速率。
  共同区间内的精确计数只对 rAF / WS / mutation 成立。

### B4 共同区间计数 vs 整窗口计数

- `windows[*].metrics` 用**各自计数器自己的区间**（WS 用 WS 区间、CDP 用 CDP 区间）。
- `windows[*].common_interval` 用**所有计数器区间的交集**，可重切者对不上整窗口数字是正常的。
- 混用两者会引入偏差；引用时必须说明用的是哪一个。

### B5 窗口长度与 p99 的统计功效

- 15s 窗口 ≈ 900 帧。p99 只由约 9 个尾样本决定，单个长任务即可改变它。
- 因此**窗口级 p99 不具备判定力**；必须用池化 p99（`pooled_frames`）或增大 n。

### B6 设置入口的选择器依赖中文文案

- 探针按 `role=button` + 精确文本「设置」定位入口；若界面语言/文案变化，门禁会失败（并据此报 invalid，而不是静默降级）。

### B7 `mutation_guard` 是启发式

- 按动词正则把非 GET 请求分类为 read / destructive / suspicious / unclassified。
  词表之外的方法会落进 `unclassified`（**不**阻断自检，但需人工过目）。
- 它证明的是"探针未发起写操作"，不是"系统未发生任何写入"。

### B8 分类为 `unclassified` 的请求尚未逐一裁定

- 见 artifact `mutation_guard.unclassified`。权威轮出现 4 个：
  `session.history`、`session.models`、`llm.providers`、`dsh-wallpaper/media/cleanup` ——
  均为 GUI 自身加载路径。它们是否严格只读，**本轮未逐条审计**。

### B9 `mutation_count` 对本应用**没有解释力**（实测，重要）

- 默认口径（`document.body` childList+subtree）：每 15s 窗口 **0~4** 次。
- 打开 `--mutation-chardata` 扰动轮（`runs/diag-chardata.json`）：每窗口仍只有 **0~5** 次。
- 对照：仅页面 boot 阶段 `<head>` 的插件注入就产生 **93** 次 mutation（`docMut=93` vs `bodyMut=6`）。
- 解释（**未证实**）：收到的 `session/event` 多半属于**未被打开的会话**，UI 只更新内部 JS 状态、
  不写 DOM；也可能更新走的是我未观察的通道（attributes/style）或已被虚拟化复用。
- **后果**：`mutation_count` **禁止**用作渲染成本 / React commit 证据。历史红队要求的
  "panel MutationObserver / commit 计数"若照原样实现，在本场景同样会得到接近 0 的假信号。
- 要验证需要：React commit 计数（profiler / fiber 挂钩），属其他调研线；本轮**未做**。

### B10 单轮判定不可复现（同协议四轮运行的实证）

- 同一探针协议、同一宿主、同一客户端 bundle、同一 N=297、同一 n=5、同一窗口长度 15 s：
  `idle` 判定 = **PASS(run2) / FAIL(run3) / FAIL(run5) / MIXED(run6)**；
  idle 帧 p99 中位数 = 33.4 / 77.3 / 66.7 / 33.4 ms。
- **run5 与 run6 的 `probe_sha256` 字节完全相同**仍给出 FAIL vs MIXED ⇒ 不是探针版本差异。
- 这是 A1 + A1b 的直接后果，不是探针缺陷：探针**如实报告**了它的不可复现。
- 要解除：先把 A1（可控负载）与 A1b（独占环境）解决，否则任何门槛判定只能到 L1（单工况）。

### B10b 锁是约定而非强制 —— 持锁 ≠ 独占（实测）

- 我按纪律全程持锁（`mkdir` 原子取得、写 owner.txt、跑完 rmdir，`runs/baseline-live.json` 的
  `framework.lock.acquired=true`），但同一轮 `environment.concurrent_browser_processes` **start/end 都是 5**
  ⇒ 我 1 个 + **他线 4 个**。
- 旁证：他线驱动 `node measure-slot.mjs --tag main --window 60000 --nolockwait` **显式绕过锁**；
  另有 `capture3.mjs`、`lib/probe.mjs`、`probe-theme-apply3.mjs`、`/tmp/probe2.mjs`。
- ⇒ **每轮必须自证独占**（看 `concurrent_browser_processes`），不得假定"持锁=独占"。
- 要解除：需要所有线共同遵守，或改用**强制性**机制（例如探针启动前要求 `pgrep -c headless_shell == 0`，
  不满足就直接拒绝运行 —— 本探针目前只是**记录**，尚未**拒绝**，见 §D 解除条件）。

### B10c 锁会**泄漏**，且泄漏的锁按规则要堵 25 分钟（实测事故）

- 事故：`cpu-profile` 持锁进程 `pid 3074138` 在 16:12 被确认**已死**，`owner.txt` 仍在盘上；
  规则只允许在"锁存在 **且** 年龄 >25 min **且** owner 进程已不存在"时抢占
  ⇒ 该锁在 16:04:58–16:13 之间**堵住所有线的浏览器工作**（我的两次持锁尝试共空等 500 s）。
- 根因（已在本线修复）：**Node 的 `SIGTERM` 不触发 `'exit'` 事件**，只靠 `process.on('exit')` 兜底的探针
  被信号杀死时既不释放锁、也不关浏览器 ⇒ 泄漏锁 + 孤儿浏览器（他线记录过孤儿存活 24 分钟）。
- 本线修复：显式接管 `SIGINT/SIGTERM/SIGHUP` → 先关浏览器 → 再释放锁 → 落盘 → 退出（9 s 硬上限）。
  实测 `runs/sigtest.json`：TERM 后锁已释放、浏览器无孤儿。
- **建议各线采用同一处理**；否则误杀一次就会造成最长 25 分钟的全局停摆。

### B11 事件率不是可靠的负载代理（反例）

- run6 的宿主负载（loadavg 起始 56.33、并发浏览器 4）与 `session/event` 中位数（109.8 /s）
  **都高于** run5（19.97、2、86.8 /s），但 run6 的 idle 客户端指标**明显更好**
  （p99 中位数 33.4 vs 66.7 ms，掉帧占比 0.003 vs 0.014）。
- ⇒ 「事件条数更高 ⇒ 更卡」在本观测范围内被证伪（或至少说明条数是糟糕代理）。
  真正驱动尾部的量**尚未识别**（候选：单帧体积、特定 `session/event` 子类型的处理成本、GC、租户抢占）。本轮不做归因。

### B12 `settings-dwell` 的一致 FAIL 无法与顺序效应分离

- `settings-dwell` 在四轮里**全部 FAIL**（唯一稳定信号），但四轮中它**永远排在最后**。
- 任何"越跑越热"的漂移都会伪装成 dwell 效应；协议 §2.5 要求的 open/closed **随机化顺序本轮未执行**。
- 要解除：随机化每轮的阶段顺序，或插入等长的"第 4 个空场景"作对照。

---

## C. 历史材料中「已失效、不得复用」的结论

以下不是"未验证"，而是**已知错误或口径不同，明确禁止再用**：

| 项 | 裁决 | 依据 |
|---|---|---|
| 历史 after 探针的 `ws_by_type`（全 `server-request`） | **口径错误，作废** | 顶层 `type` 恒为 `server-request`；见 `runs/recon.json` 实测 2079/2079 |
| 历史基线的 `ws_by_keyword`（关键词子串命中） | **非划分、重复计数，作废** | 和 1629 > 帧总数 1456；`measure5.mjs:21-22` |
| 历史 `ws_rate_per_s`（分母=装置安装时刻） | **系统性偏低，作废** | 分母膨胀 1.25×/2.33×/3.33×（见 `audit.md` §2） |
| `measure-after-C1.json` 的 `settings-open-failed` 窗口 | **invalid，作废** | `dom_nodes=108`、`panel=0`，页面未装载 |
| 任何"三项门槛通过"的表述 | **作废** | n=1/场景、跨 N、跨事件率、单窗口挑选 |
| 历史表的 N 列（734 / 2396） | **非探针测得，作废** | 旧探针 `items:null`（680B bad-request） |

---

## D. 解除条件（要把哪项从未知变成已知，需要做什么）

| 项 | 解除条件 |
|---|---|
| A1 可控负载 | 实现一个可注入指定 rate 的 `session/event` replay（假宿主或宿主侧测试钩子），并验证注入速率与观测速率误差 <5% |
| A3 用户可感终点 | 增加 click→next-paint 与 input latency 采集，并在 n≥8 × ≥2 事件率桶上建立与代理指标的相关性 |
| A4 宿主侧 | 加宿主 RPC latency / event-loop 停顿探针，与浏览器窗口**同轮同窗**采集 |
| A2 独立复现 | 第二台机器/容器按同一 `probe_sha256` + `bundle` 复跑，比 `combined_sha256` 与 block_key |
| B2 N 稳定性 | 窗口内多次 `session.list` 快照取中位数，报告 N 的极差 |
| B7/B8 只读证明 | 用宿主的只读审计日志（若有）交叉验证，而不是只靠客户端启发式 |
| B10b 独占不可达 | 让探针在 `concurrent_browser_processes > 1` 时**拒绝启动**（而非仅记录）；或由编排方在跑测量前强制清场。注：本线已把"断言 `foreign==0`"落成窗口级 invalid 门禁（`--concurrency-gate strict`），实测 16/16 窗口被判 invalid ⇒ **当前条件下确实拿不到独占** |
| B10c 锁泄漏 | 各线探针统一接管 SIGTERM/SIGINT/SIGHUP 释放锁并关浏览器；或加一个"锁年龄 >5 min 且 pid 已死即可回收"的更短阈值（当前 25 min 过长） |
| C 历史失效项 | 见 `audit.md` §5 |
