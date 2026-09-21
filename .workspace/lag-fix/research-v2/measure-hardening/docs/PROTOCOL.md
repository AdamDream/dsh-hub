# 性能测量协议 v1（可复算 / 不可自欺）

> 适用对象：DSH Web GUI（`http://127.0.0.1:3080`）的设置页与会话列表卡顿类性能结论。
> 参考实现：`probes/harden-measure.mjs`（本目录；sha256 记录在每份 artifact 的 `provenance.probe_sha256`）。
> 本协议是**判定纪律**，不是结论。任何结论都必须能由本目录内的 artifact 复算出来。

---

## 0. 四条不可协商的底线

1. **脚本退出码 0 ≠ 性能通过。** `harden-measure.mjs` 的退出码只描述"测量框架自检"：
   `0` = 门禁全绿且无指标超门槛；`2` = 有 invalid 窗口 / 场景 INCONCLUSIVE / 有指标超门槛；
   `1` = 框架级 FATAL（RPC 契约不满足、页面从未 ready、watchdog 超时）。
   **性能结论只能来自 artifact 的 `scenarios[*].verdict` + 门槛块，且必须带上工况标签。**
2. **没有"同工况"证书，就没有百分比归因。** 跨 N、跨事件率、跨宿主实例、跨 bundle 的差值
   一律记为「未归因」，不得写成"修复带来 X% 改善"。
3. **invalid 窗口必须落盘并计入分母。** 只报有效窗口、隐去失败窗口 = 选择性呈现。
4. **"并发负载下采集的绝对值不可当基线"。** 锁是**约定而非强制**——实测出现"锁为 free 但系统上仍有
   19 个浏览器""持锁期间仍有 4 条他线浏览器在跑"的情况。因此每轮必须用系统级读数**自证独占**
   （见 §0bis 的并发门禁）。并发负载下：**绝对值（ms、ms/s、fps、p95/p99、超门槛比例）不可当基线**，
   不得用于门槛判定或前后对比的百分比归因；**只有协议（口径、门禁、复算方式）与相对指标
   （比值、为零、占比、同窗内配对差值）可用**。该声明必须原样写入 artifact 的 `baseline_status`。

---

## 0bis. 跨线浏览器独占锁（强制前置条件）

本机同时有多条线要用浏览器探针；**并发跑会互相污染**（实测：并发租户下 loadavg 20→56、
同协议四批次的 `idle` 判定在 PASS/FAIL/MIXED 之间翻转）。因此：

| 项 | 规定 |
|---|---|
| 锁路径 | `.workspace/lag-fix/research-v2/.probe.lock`（目录） |
| 取得 | **在启动任何浏览器之前** `mkdir`（原子操作，失败即 EEXIST=已被占用） |
| 重试 | 已存在则每 **20–40 s** 重试，**最长等 30 min**（`--lock-wait-ms`） |
| owner.txt | 必须写 `agent` / `pid` / `started_at` / `started_epoch` / `purpose` |
| 释放 | 浏览器全部关闭后 `rmdir`（探针在 `process.on('exit')` 亦有兜底释放） |
| 抢占 | **仅当**：锁存在 **且** owner 开始时间 **>25 min** **且** owner 进程**已确认不存在**。抢占必须写进报告 |
| 未知存活 | owner.txt 缺 `pid` 时存活=**未知** → **一律不抢占**（安全默认；已实测守住） |
| 非浏览器工作 | **不需要持锁**（分析、复算、写文档都不持锁） |
| 未持锁批次 | 结论一律标 **INCONCLUSIVE**，artifact `framework.lock.acquired=false` |

探针已内置该纪律：**未取得锁就不会启动浏览器**（实测：锁被占用时 `windows=0`、exit 1、
文件系统里浏览器进程数不变），并把 `framework.lock.events`（acquired / waiting / preempting /
released）与 `environment.concurrent_browser_processes` 一并落盘，用于事后证明"这一轮确实独占"。

### 0bis.1 并发门禁（把"自证"变成判据）

**持锁 ≠ 独占**（锁是约定，不是强制）。因此把"自证"落成门禁，而不是停留在提示：

| 项 | 规定 |
|---|---|
| 判据 | 采集**前**与**后**各断言一次：`系统上的主浏览器实例数 - 自身实例数 == 0` |
| 计数命令 | `pgrep -fc "headless_shell --disable-field-trial-config"`（**主浏览器进程**；不含 renderer/gpu/zygote） |
| 模式 | `--concurrency-gate strict`（默认，不满足即该窗口 **invalid**）／`record`（只记录）／`off` |
| 落盘 | 每窗口 `concurrency.{host_pid, own_instances, at_window_start, at_window_end, foreign_instances_max, gate_passed}`；场景级 `concurrency.windows_exclusive / exclusive_fraction` |
| 同时记录 | 每窗口记录**宿主 PID**（`windows[*].host_pid`），用于跨轮确认没有重启 |
| 量纲警告 | 本计数是**主浏览器进程**；与他线按"chromium 全家族（含子进程）"计数的数字**不可混用或互相印证** |
| 未达标的处置 | strict 下该窗口 invalid ⇒ 若全部窗口 invalid，场景判定为 `INCONCLUSIVE`，**不得**改用 record 模式来"救"结论 |

---

### 0bis.2 完整性门禁 + **绝对禁止 kill 共享资源**（协调者纪律）

某线曾在 15:04–15:13 执行 `pkill -f playwright_chromiumdev_profile`，**误杀兄弟线 Chromium**，
并泄漏一个浏览器存活 24 分钟。据此立两条硬纪律：

**（a）禁止 kill 任何共享资源。**
禁止 `pkill` / `killall` / 对**非自己创建**的进程投递任何信号（含浏览器、node、宿主）。
- 关闭浏览器只允许 Playwright 的 `browser.close()`，且只关**自己开的**实例。
- `process.kill(pid, 0)`（信号 0 = 纯存活探测，不投递信号）是允许的唯一例外。
- 发现异常进程（僵尸浏览器、泄漏实例、疑似误杀）**只记录 PID 与父子关系**，交由协调者处理。

**（b）完整性门禁：中断窗口一律 invalid。** 下列任一命中 ⇒ 该窗口（或整批）标 **INVALID**，不计入结论：

| 判据 | 内容 |
|---|---|
| E1 | artifact 级 `recovery_events` 非空 / `signalled` / 浏览器代数 >1 / `watchdog_fired` |
| E2 | 该窗口的采集尝试被中断（代际切换后重试）或 invalid_reasons 含 crash/closed/abort/attempts/timeout |
| E3 | **连接中断**：同一 socket URL 出现 >1 实例（重连），或收到 `close`/`error`（`ws_detail.socket_instances` / `reconnects`） |
| E4 | **数据缺失**：`metrics` 空 / rAF 缺失 / `common_interval` 缺失 / activity=unknown |
| E5 | 窗口墙钟落在**已通报的事故时段**内（环境不可控），即使本进程未观测到中断 |

**并须在报告中写明**：中断时刻（墙钟）+ 原因 + 该窗口的并发实例数。
墙钟由 `clock.offset_page_minus_node_ms` 把页面 `performance.now()` 换算成绝对时间得到。
扫描工具：`probes/integrity-scan.py`（输出 `runs/integrity-scan.json`）。

**⚠️ 反误判条款（本线 v1 扫描器踩过）**：
- `session/subscribed` 帧 **不是**重连证据（新会话出现也会触发）；
- WS 每秒桶空洞 **不是**中断证据（空闲秒本来就没有帧）；
- `per_socket` 里 `events.host` 时有时无 **不是**异常。
只有 E3 的"**同 URL 第二个 socket 实例**"和 close/error 事件才算连接中断。
**旧批次没有连接仪表 ⇒ 只能记 `not-instrumented`，不得读作"无中断"。**

## 1. 必须统一的口径（缺一项即不可配对）

| 维度 | 字段（artifact 路径） | 统一要求 |
|---|---|---|
| 代码身份 | `provenance.probe_sha256`、`provenance.bundle.combined_sha256` | before/after 必须**各自**记录；`bundle` 不同 = 不同代码，允许比较但必须声明"代码已变" |
| 宿主身份 | `target.host.{boot_id,pid,starttime_ticks}` | `boot_id` 或 `pid` 或 `starttime_ticks` 任一变化 = **宿主已重启** → 必须作为区组(block)因子配对，不得直接相减 |
| 规模 N | `scale_snapshot.{items,items_bytes,top_level,subagent,running}` + 每窗口 `ws_detail` | 必须用 **DSH RPC 信封**测量；`items===null` 或信封契约不满足 = **FAIL，整轮不得继续** |
| 事件率 | `windows[*].ws_detail.by_kind`、`per_second_by_kind` | 必须按 **`payload.type`** 分类且是**划分**（`sum(by_kind) === ws.total`）；不平即窗口 invalid |
| 页面状态 | `windows[*].page_state.{dom_nodes_total,dialog_count,panel_nodes,active_tab,tab_labels,visibility}` | `settings-*` 场景必须 `dialog_count>=1 且 panel_nodes>0`；`idle` 必须 `dialog_count===0` |
| 窗口分母 | `windows[*].counters.*.{t_start_ms,t_end_ms,span_ms}` + `common_interval` | 每个计数器记录**自己的**真实起止；速率必须用自身区间。所有计数器的**共同区间**单独给出 |
| 负载性质 | `windows[*].activity_class`（`silent` / `streaming`） | 这是**条件标签**，不是有效性判据；silent 与 streaming 不可混入同一统计 |
| 环境独占性 | `environment.at_start/at_end`（loadavg、`concurrent_browser_processes`、mem） | **必须有**。存在并发租户时，任何绝对差值都不可跨轮比较 |
| **每窗口并发实例数** | `windows[*].concurrency.*`（含 `host_pid`、`own/foreign_instances`、`gate_passed`） | **必须有**。并发门禁的输入；`foreign>0` 的窗口在 strict 模式下 invalid |
| 采集条件声明 | `baseline_status.{status,usable_as_baseline,statement}` | **必须原样写入**：并发负载下的绝对值不可当基线 |
| 连接完整性 | `windows[*].ws_detail.{socket_instances,reconnects}` | 必须仪表化；有重连/close/error ⇒ 该窗口 invalid。**旧批次 not-instrumented 不得当作"无中断"** |
| 有界超时 | `framework.recovery_events`、`watchdog_fired` | 单轮内的挂起/重建必须落盘；`recovery_events` 非空即说明该轮跨了浏览器实例 |

### 1.1 WS 分类口径（历史最大坑）

线上实测（见 `runs/recon.json`）：mux socket 上**每一个**帧的键集恒为
`{type, rpcId, method, payload}`，顶层 `type === "server-request"`（2079/2079），
真正有区分度的是 **`payload.type`**（`session/event` / `session/projection` / …）。

- ❌ 历史 after 探针取 `data.type` → 全部落进 `{"server-request": N}` 单桶，**信息量为零**。
- ❌ 历史基线（`.workspace/settings-lag/measure5.mjs:21-22`）用 8 个关键词做
  `payload.includes(k)` **子串命中**，一个帧可被多个关键词同时命中 →
  `session/event 1309 + session/projection 139 + tool 127 + subagent 44 + assistant/message 9 + session/jobs 1 = 1629`
  **大于**帧总数 `1456`（差 173）→ **不是划分，且存在重复计数**。
- ✅ 本协议：**唯一合法口径 = `payload.type` 的划分**。禁止把上面任何一种历史口径的数字
  与本协议产生的数字放进同一张表做"同量级"判断。

---

## 2. before/after 配对协议

### 2.1 配对键（block key）

一次可配对的 before/after 观测对，必须满足：

```
block_key = {
  宿主实例:   boot_id + host.pid + host.starttime_ticks,
  代码身份:   bundle.combined_sha256,
  运行环境:   playwright 版本 + 浏览器版本 + viewport + headless + window_sec,
  页面状态:   场景(idle|settings-open|settings-dwell) + dialog_count + active_tab,
  规模桶:     N_bucket(items),
  事件率桶:   rate_bucket(ws_session_event_rate_per_s)
}
```

只有 `block_key` 相同的 before/after 窗口才允许做**配对差值**；否则只能并列展示，标注「条件不同，不比较」。

### 2.2 同 N

- N 由**每窗口一次**的正确信封 RPC 快照给出（不是轮级一次），并记录 `items_bytes`。
- **同 N 判定**：`|Δitems| / items ≤ 2%` **且** `|Δitems_bytes| / items_bytes ≤ 5%`。
- 超出即落入不同 N 桶，不得配对。
- 后果说明：历史基线 `N=2361`（`measure3/5.json`）与当前 live `N=297`
  （本目录 `runs/baseline-live.json` 实测）相差 **7.9×**。在 O(N²) 候选机制下，
  **这两个 N 之间的任何 script_ms/s 差值都不能归因给代码**。

### 2.3 同事件率

- 事件率 = `windows[*].counters["ws_kind:session/event"].rate_per_s`，**同窗口、同分母**。
- 预注册分桶（左闭右开，单位 帧/s）：

  | 桶 | 区间 | 语义 |
  |---|---|---|
  | `silent` | `0` | 无流式负载 |
  | `low` | `(0, 10]` | 偶发 |
  | `mid` | `(10, 50]` | 常态 |
  | `high` | `(50, 150]` | 活跃 |
  | `very-high` | `> 150` | 高活跃（基线 73 帧/s 落在此桶） |

- 只有**同桶**才允许配对；同桶内若跨度仍大（例如 150–400），必须改用回归
  `script_ms_per_s ~ event_rate` 取同 rate 处的预测值，或做 rate 分层。
- **硬约束**：`activity_class === "silent"` 的窗口不得与 `streaming` 窗口混入同一均/中位数。
- 现实提醒：自然流式负载**不可控**——本目录基线实测 15s 窗口的
  `session/event` 速率跨度达一个数量级以上（见 `runs/baseline-live.json` 的
  `scenarios.idle.per_window.ws_session_event_rate_per_s`）。因此"同事件率"只能
  **事后按桶筛选**，不能事前保证；筛选后若某桶样本不足，结论必须是 INCONCLUSIVE。

### 2.4 同标签状态

- `settings-dwell` 与 `settings-open` 必须分别统计，不可合并。
- 每次窗口记录 `dialog_count` / `panel_nodes` / `active_tab` / `tab_labels`；
  `active_tab` 不同 = 不同标签状态，不得配对。
- 禁止在测量期间点击任何"保存/应用/删除/刷新/进入 usage 插件"；探针的
  `mutation_guard` 必须为 `READ-ONLY-CONFIRMED`，否则该轮作废。

### 2.5 时序与顺序

- 同一轮内固定顺序：`warmup`（不计入）→ `idle` ×n → 打开设置（仅点入口）→
  `settings-open` ×n → `settings-dwell` ×n。
- 若要对比"设置开/关"的因果，必须**随机化**每轮的 open/closed 先后顺序，
  否则"后测的更热"会与状态混淆。
- 窗口间不插入额外操作；窗口长度与数量全部预注册（本实现：`--window`、`--n`）。

### 2.6 环境独占性（新增，血泪条款）

- 测量前/后各记一次 `loadavg + concurrent_browser_processes + mem`。
- **有并发浏览器租户时，本轮不得作为权威基线**；只能作为"脏环境下仍自证的测量"。
- 实测反例：权威轮的 loadavg 从 19.97 涨到 35.51、并发浏览器从 2 增到 4 —— 同一轮内部的工况都在漂移。

### 2.7 样本量

- 探针默认 `n = 5`/场景（**下限 n≥3** 才允许出场景判定）。
- 正式结论建议 `n ≥ 8`/cell，且**每个 cell 的窗口必须全部落盘**。
- 尾部指标（p95/p99）在小 n 下不可信：n=5 时"p95"实际接近 max。
  因此本实现同时给出
  ① `per_window.*`（窗口级指标在 n 个窗口上的中位数/IQR/p95/p99）
  ② `pooled_frames`（把所有有效窗口的 rAF 帧间隔**池化**后再算 p95/p99，尾样本数≈数千）。
  **引用尾部数字时必须说明用的是哪一种。**

---

## 3. 预注册终点

在**测量开始前**固定（本实现的常量写在 `harden-measure.mjs` 顶部 `THRESHOLDS`，并复制进 artifact 的 `pre_registered`）。

### 3.1 Primary（用于判定"卡不卡"）

| 终点 | 门槛 | 现状 |
|---|---|---|
| `frames_over_50ms_ratio`（掉帧比例） | ≤ 0.02 | 本探针预注册 |
| `long_task_total_ms_per_s` | ≤ 100 | 本探针预注册 |
| `settings-open` 的 click-to-next-paint p95 | ≤ 100 ms | **待补**：本探针目前只记录 click→下一帧，样本少，暂列为 secondary |

### 3.2 Secondary（诊断用，不单独作为通过依据）

| 终点 | 门槛 | 说明 |
|---|---|---|
| `script_ms_per_s` | ≤ 60 | 历史验收口径（`BEFORE-AFTER.md` §三）；**其"用户体验充分性"未经任何验证** |
| `frame_p99_ms` | ≤ 50 | 同上 |
| `task_ms_per_s`、`recalc_style_ms`、`layout_ms` | 无门槛 | 仅用于定位 |

### 3.3 超门槛的判定规则

- 逐窗口对每个终点做 `value > limit` 判定，输出 `over/total` 与 `ratio`。
- 场景判定：
  - `valid_windows < n_min(3)` → `INCONCLUSIVE(insufficient-valid-windows)`
  - 全部有效窗口所有终点均不超 → `PASS`
  - 任一终点**超过半数的有效窗口**超门槛 → `FAIL`
  - 其余 → `MIXED(some-windows-over-threshold)`
- **`MIXED` 不是"通过"。** 它精确对应历史上的病灶："某个/某些窗口好看，就宣称系统通过"。

### 3.4 预注册效应量（做 before/after 归因时）

- 只有当初级终点在**同 block_key** 下改善 ≥ 20%（相对），且配对窗口数 ≥ 5 时，
  才可写"有改善"；否则只写"方向一致，未达预注册效应量"。

---

## 4. 判定语言阶梯（"只能说单工况通过"的边界）

| 级别 | 允许的措辞 | 需要的证据 |
|---|---|---|
| **L0** | 「某窗口观测到 X」 | 1 个 valid 窗口 |
| **L1** | 「**在工况 C 下（N≈…、session/event≈…/s、标签=…）单工况通过**」 | 同 block_key 内 n≥3 valid 窗口，全部终点 PASS，invalid 率 0 |
| **L2** | 「跨工况稳定」 | ≥3 个事件率桶 × ≥2 个 N 桶均为 L1 PASS |
| **L3** | 「已消除用户可感卡顿」 | L2 + 用户可感终点（click-to-paint / 长任务 / 宿主 freeze）+ 宿主侧同测 + 独立复现 |

**硬性禁止的措辞**：
- 把 L0 写成"通过"。
- 把 L1 写成"修复有效 / 门槛已通过"（必须带工况限定词）。
- 在 N、事件率、页面标签、宿主实例任一发生变化时给百分比归因。
- 用 `script_ms_per_s` 单独宣布通过（它只是 secondary；历史上"通过但仍卡"正是由此产生）。

---

## 5. 反自欺检查单（每份结论发布前逐条打勾）

1. [ ] artifact 里有 `provenance.probe_sha256` 与 `bundle.combined_sha256`，且与比较对象都记录在案？
2. [ ] `framework.gates.ready.ok === true`，且 RPC 四项契约检查全 true？
3. [ ] `scale_snapshot.items` 是**数字**（不是 `null`）？`items_bytes` 与 `bytes:680` 这类 bad-request 值不同？
4. [ ] 每个窗口 `counters.*.t_start_ms/t_end_ms` 非空，且 `common_interval` 存在？
5. [ ] `ws_detail.by_kind` 之和 == `ws.total`（划分成立）？`envelope_violations === 0`？
6. [ ] `invalid_runs` 已列出且**计入分母**（`invalid_fraction` 已报）？
7. [ ] 场景 `windows_valid ≥ 3`？
8. [ ] 引用过尾部指标时，说明了是 per-window 还是 pooled？
9. [ ] `mutation_guard.verdict` 是 `READ-ONLY-CONFIRMED`？
10. [ ] 结论措辞落在 §4 的正确级别，工况标签齐全？
11. [ ] 没有把退出码 0 当作性能通过？
12. [ ] **`framework.lock.acquired === true`**，且 `environment.concurrent_browser_processes ≈ 1`
       （证明本轮确实独占）？未持锁 ⇒ 结论只能写 INCONCLUSIVE。
13. [ ] 若发生过**抢占**，抢占依据（owner 年龄 >25min + 进程已确认不存在）已写进报告？
14. [ ] **每窗口**都有 `concurrency` 与 `host_pid`？`concurrency.windows_exclusive / windows_sampled` 是多少？
15. [ ] `baseline_status.usable_as_baseline` 是否已按实际条件置位，且声明原文进了报告？
16. [ ] 是否跑过 `probes/integrity-scan.py`？E1–E5 命中项**是否都已标 INVALID**，并写明了中断时刻/原因/并发实例数？
17. [ ] 本批**没有**对任何共享资源执行 pkill/kill（除 `process.kill(pid,0)` 存活探测）？

---

## 6. 未验证 / 不可归因清单

见 `docs/UNVERIFIED.md`（与本节同源）。摘要：

1. **无法人为制造可控流式负载** → "同事件率"只能事后筛选；如果某个事件率桶需要更多样本，
   本机无法按需产生，只能等自然负载落入该桶。**这是本测量框架最大的结构性限制。**
2. **`script_ms_per_s < 60` 与 `frame_p99 < 50ms` 是否等价于"用户不卡"——完全未验证。**
   它们来自历史验收文档，没有任何用户可感终点与之做过相关/校准。
3. **宿主侧冻结（usage 同步 SQLite）不在本探针覆盖范围内**：浏览器指标测不到宿主事件循环阻塞。
4. **headless 与有头/真实显示器**：rAF 节拍由 CPU 合成器驱动，与真实刷新率/合成路径不同。
5. **N 是快照量**：窗口期间 `session.list` 可能变化；每窗口一次快照只是近似。
6. **CDP 指标跨时钟映射**：`offset_uncertainty_ms` 量级的误差；CDP delta 不能在共同区间内重切。
7. **单机单浏览器**：无第二台独立复现环境，无法做 L3。

---

## 7. 复算步骤

```bash
cd .workspace/lag-fix/research-v2/measure-hardening
# 侦察（wire 形态 / RPC 契约 / DOM 门禁候选）
node probes/recon.mjs runs/recon.json
# 跨线锁由探针自己取（mkdir 原子 / 20-40s 重试 / 最长 30min / 跑完 rmdir）
# 事前可看一眼是否已有人持锁（非浏览器工作，不需要持锁）：
cat ../.probe.lock/owner.txt 2>/dev/null || echo "lock free"
pgrep -fc "headless_shell --disable-field-trial-config"   # 期望 0（非持锁方不应有浏览器）
# 一轮基线（只读；单浏览器实例；逐操作有界超时；**前台独占运行**，不要与其他命令并行）
# 探针会先取锁再启动浏览器；取不到锁则 exit 1 且不启动任何浏览器
node probes/harden-measure.mjs --window 15 --n 5 --warmup 10 \
     --budget-ms 480000 --lock-wait-ms 1800000 --label baseline --out runs/baseline-live.json
# 复算 + 同事件率配对分析（含"区间是否相交"判定）
python3 probes/recompute-check.py runs/baseline-live.json
```

> **必须在单命令前台跑**：后台 job 期间再发其他命令会导致浏览器进程被进程树回收
> （实测 SIGTERM、exitCode=143；见 `runs/run3-gen-switch.json`）。

验证可复算性的方式：对任意窗口，
`ws_kind:session/event.rate_per_s * span_ms/1000 ≈ ws_detail.by_kind['session/event']`；
`sum(by_kind.values()) == metrics.ws_total`。两条都对上，才说明分母/分类口径没坏。
