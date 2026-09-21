# 性能测量框架硬化审计

- 目录：`.workspace/lag-fix/research-v2/measure-hardening/`（本任务独占）
- 审计性质：**只读**。未改产品源码、未重启宿主、未点保存/应用/删除/刷新。
- 被测 live：`http://127.0.0.1:3080`，宿主 pid **1390375**，`boot_id=dbe2fd56-1424-4921-b1da-c5a2246c633b`，`starttime_ticks=9878669`（全程未变）。
- 客户端 bundle 指纹：`combined_sha256=6f76616e24d935d9f03c675a260fa655bbdd65825455f31fbfb3f34725068ece`

> **⚠️ 采集条件声明（协调者要求，原样）**：
> **本次基线是在并发负载下采集**（同一时刻机器上存在其他线/其他进程的浏览器实例，逐窗口证据见
> `windows[*].concurrency`：`total_browser_instances / own_instances / foreign_instances`，以及 `host_pid`）。
> 因此**绝对值（ms、ms/s、fps、p95/p99、超门槛比例）不可当基线**，不得用于任何门槛判定或前后对比的百分比归因；
> **只有协议（口径、门禁、复算方式）与相对指标（比值、为零、占比、同窗内配对差值）可用。**
> 该声明同时写入每份 artifact 的 `baseline_status`。
>
> **先行声明：本文出现的所有 `PASS` 都只是「测量框架自检/门禁」级的 PASS，不是性能达标。**
> 新探针的退出码 `0` 仅表示门禁全绿；本轮基线退出码是 **2**。
> 性能结论只看 artifact 的 `scenarios[*].verdict`，且必须带工况标签。

---

## 0. 交付物与复算方式

| 文件 | 说明 |
|---|---|
| `probes/harden-measure.mjs` | 硬化后的独立探针（只读）。sha256 = `cef6be49…`（记录在 artifact `provenance.probe_sha256`） |
| `probes/recon.mjs` | wire 形态 / RPC 契约 / DOM 门禁侦察（只读） |
| `probes/recompute-check.py` | **复算校验** + 同事件率配对分析 |
| `runs/run5-unlocked.json` | **权威基线**（run5，16 窗口含 warmup；invalid 全量落盘）+ 环境快照 |
| `runs/run2-clean.json` | 另一次干净运行（同协议、不同负载）——用于检验单轮可复现性 |
| `runs/run6-same-probe.json` | **与权威轮字节完全相同探针**的第二次运行——可复现性的关键对照 |
| `runs/run3-gen-switch.json` | 浏览器被 SIGTERM 后**恢复机制生效**的实证（2 代浏览器、2 条 recovery event） |
| `runs/run4-watchdog.json` | 全局 watchdog 超时轮（逐操作超时硬化之前），保留作为反向证据 |
| `runs/diag-chardata.json` | `--mutation-chardata` 扰动轮：量化文本 churn |
| `runs/recon.json` | 侦察原始数据（2079 帧全部顶层 `server-request`） |
| `probes/integrity-scan.py` + `runs/integrity-scan.json` | 采集窗口完整性扫描（E1–E4 真中断证据 / 事故时段重叠 / 并发观察） |
| `docs/PROTOCOL.md` | 配对协议 + 预注册终点 + 判定语言阶梯 |
| `docs/UNVERIFIED.md` | 未验证 / 不可归因清单 |

```bash
cd .workspace/lag-fix/research-v2/measure-hardening
python3 probes/recompute-check.py runs/baseline-live.json   # 复算 + 配对
```

---

## 0bis. 跨线锁纪律 · 本轮持锁状态（**先读这一节**）

本机同时有另外 4 条线要用浏览器探针。**并发跑会互相污染**，因此纪律要求：启动任何浏览器**之前**
用 `mkdir .workspace/lag-fix/research-v2/.probe.lock` 原子取得独占锁，已存在则每 20–40 s 重试、
最长等 30 min，锁内写 `owner.txt`（agent / PID / 开始时间），跑完 `rmdir` 释放；
**抢占仅当**「锁存在 且 owner 开始 >25 min 且 owner 进程**已确认**不存在」；非浏览器工作不持锁。

### 本轮各批次的持锁状态

| 批次 | 持锁 | 可否用于结论 |
|---|---|---|
| `runs/recon.json`（侦察） | ❌ 未持锁 | **INCONCLUSIVE** |
| `runs/smoke.json`、`runs/diag-mo.json`、`runs/diag-ctp.json` | ❌ 未持锁 | **INCONCLUSIVE**（仅工具自检用） |
| `runs/diag-chardata.json`（扰动轮） | ❌ 未持锁 | **INCONCLUSIVE** |
| `runs/run2-clean.json` | ❌ 未持锁 | **INCONCLUSIVE** |
| `runs/run3-gen-switch.json` | ❌ 未持锁 | **INCONCLUSIVE** |
| `runs/run4-watchdog.json` | ❌ 未持锁 | **INCONCLUSIVE** |
| `runs/run6-same-probe.json` | ❌ 未持锁 | **INCONCLUSIVE** |
| `runs/run5-unlocked.json` | ❌ 未持锁 | **INCONCLUSIVE** |
| `runs/lock-test.json`、`runs/lock-test2.json`（锁行为验证，未启动浏览器） | 取得失败（按预期） | 仅证明锁机制 |
| `runs/baseline-live.json`（持锁轮） | ✅ **全程持锁** | ⚠️ **但仍 INCONCLUSIVE** —— 因为独占**没有真正达成**（见下） |

> **纪律结论：本文 §1/§2/§3 中所有基于上述「未持锁批次」的数字，一律只能读作
> "在无独占、存在并发租户的条件下观测到"，不得作为基线，不得用于门槛判定。**
> 这不推翻 §1 的缺陷确认（那些是**静态文件/代码/算术**证据，与是否持锁无关，依然成立），
> 但 §3 的全部性能数字与 §2.5 的判定翻转都必须在"未持锁"前提下解读。

### ⚠️ 关键结论：**持锁 ≠ 独占**（本轮实测）

我第一次真正取得锁是在 `2026-09-21T07:55:22Z`（`mkdir` 原子取得、`waited_ms=0`、写 owner.txt、跑完 `08:00:32Z` 释放，锁目录已确认消失）。
**但探针的持锁自证字段显示独占并未达成**：

| | at_start | at_end |
|---|---|---|
| `loadavg` | 18.64 | 27.54 |
| `concurrent_browser_processes` | **5** | **5** |

我全程只跑 1 个浏览器 ⇒ **另外 4 个是别的线的**，即他线在我持锁期间照跑不误。
（旁证：当时进程列表里 `node measure-slot.mjs --tag main --window 60000 --nolockwait` —— **显式 `--nolockwait` 绕过锁**，
另有 `capture3.mjs`、`lib/probe.mjs`、`probe-theme-apply3.mjs`、`/tmp/probe2.mjs` 等 4 条驱动。）

⇒ 按本目录自订的自证规则（"`concurrent_browser_processes > 1` ⇒ 本轮降级 INCONCLUSIVE"），
**这一轮尽管全程持锁，测量结论仍然只能是 INCONCLUSIVE。**

**这条比锁本身更重要**：锁是**约定**而非强制机制。要真正拿到独占，光遵守纪律不够，
还需要**所有**线都遵守；因此每轮必须用 `concurrent_browser_processes` **自证**独占，而不是假定锁等于独占。
本轮的教训是：**在我持锁的那 5 分钟里，机器上仍有 4 个他线浏览器在跑。**

### 锁机制已验证（`runs/lock-test2.json`，未启动任何浏览器）

| 验证项 | 结果 |
|---|---|
| 锁已被占用时**不启动浏览器** | ✅ 测试前后 `headless_shell` 数量不变（6→6），`windows=0`，exit 1 |
| 不破坏他人锁 | ✅ 测试后 `react-commit-audit` 的 `owner.txt` 原样存在 |
| 超时记录 owner 信息 | ✅ 记录 owner agent、年龄 21.6 min、`acquired=false`、`mode=timeout` |
| **抢占安全性（测试中发现并修掉的真 bug）** | 对方 `owner.txt` 只有 `host_pid`、没有 `pid` 字段 ⇒ 存活**未知**。原实现把"查不到"当成"已死"，会在 25 min 后**抢占一条仍然活着的锁**。已改为：**未知一律不抢占**，只在"确有 pid 且确认已死"时抢占，并把 `preempt_blocked_reason` 落盘 |

---

## 1. 逐条缺陷确认（用真实文件核对，非照抄描述）

### D1 — session.list 抓取缺 DSH RPC 信封 → 恒 680B / `items:null`，且不硬失败

**裁决：FAIL（历史数据）· PASS（信封修复）· FAIL（硬失败缺失，旧探针）· PASS（新探针）**

1. **历史数据确认（5/7 份 artifact 中招）**：

   | 文件 | mtime | session_list |
   |---|---|---|
   | `measure-after-C1.json` | 15:40:40 | `items=null, bytes=680` |
   | `measure-after-C1-v2.json` | 15:43:49 | `items=null, bytes=680` |
   | `measure-after-N734.json` | 15:57:23 | `items=null, bytes=680` |
   | `measure-after-N734-active.json` | 15:58:58 | `items=null, bytes=680` |
   | `audit-cross-client-measure.json` | 16:20:43 | `items=null, bytes=680` |
   | `measure-live-now.json` | 16:08:38 | `items=742` ✅ |
   | `measure-after-restart.json` | 18:40:50 | `items=290` ✅ |

   即**所有"打补丁后"的主对比 artifact 都没有真正测到 N**；`BEFORE-AFTER.md` 表头的 N=734 / 2,396 均非探针测得——该文件 §四 亦自认此事。

2. **机制已在本机 live 上复现**（只读，`curl`）：

   ```
   POST /api/session.list  body='{}'                      → HTTP 200, 680 B,
     {"type":"server-response","rpcId":"invalid-request",
      "result":{"ok":false,"error":{"code":"bad-request",
        "message":"invalid client-request message", ...}}}
   POST 正确信封 {type:client-request,rpcId,method,payload} → HTTP 200, 510209 B,
     result.ok=true, items=297
   ```

   → **比原描述更严重的一点：这个失败是 HTTP 200。** 任何只看 `res.status`/`res.ok` 的写法都会把它当成功。缺陷只能靠检查信封与 `result.ok` 发现，而旧探针两者都没查。

3. **代码现状**：`probes/measure-after-C1.mjs` 已在 commit `604e38f2` 补上信封（第 133–141 行），实测有效（`measure-live-now.json` 起）。

4. **但硬失败仍然缺失**：该文件对 `items===null` 没有任何报错路径——`items` 只是被塞进 report，`main()` 继续跑完三个窗口；全文件唯一的 `process.exit(1)` 在第 251 行（顶层 catch）。**这正是"不可自欺"要堵的口子。**

5. **新探针**：RPC 返回做四项契约检查（`type===server-response` / `rpcId` 回显 / `result.ok===true` / `items` 是数组），任一不满足 → run 级 FATAL（`exit 1`）或 window 级 `invalid`，并**每窗口结束（计时区间之外）各采一次 N 快照**。本轮 16/16 窗口 N=297，`spread=0`。

---

### D2 — `ws_rate_per_s` 用装置安装时刻做分母（分子每窗清零）

**裁决：FAIL（历史数据）· PASS（现代码）· PASS（新探针）**

1. **算术锁定**：旧式分母 = 安装时刻起的累计时间，于是"分子/速率"反推出的隐含分母必然等于该窗口的累计终点。实测**完全吻合**：

   | 文件 | 窗口 | ws 总数 | 记录速率 | 隐含分母 | 真实窗口 | 膨胀 |
   |---|---|---|---|---|---|---|
   | `measure-after-C1-v2.json` | idle | 2316 | 92.5 | 25.04 s | 20 s | **1.25×** |
   | 同上 | settings-open | 3850 | 82.6 | 46.61 s | 20 s | **2.33×** |
   | 同上 | settings-dwell | 1085 | 16.3 | 66.56 s | 20 s | **3.33×** |
   | `measure-after-N734-active.json` | settings-dwell | 110 | **1.7** | 64.71 s | 20 s | **3.24×** |
   | `audit-cross-client-measure.json` | settings-dwell | 1085 | 16.3 | 66.56 s | 20 s | **3.33×** |
   | `measure-after-restart.json`（18:40，已修） | idle / open | 1541 / 675 | 77 / 33.7 | 20.01 / 20.03 s | 20 s | **1.00×** ✅ |
   | `measure-live-now.json`（16:08，已修） | 三窗 | — | — | 5.00 s | 5 s | **1.00×** ✅ |

   膨胀系数严格是 1.25 / 2.33 / 3.33（第 1/2/3 个窗口），与"分母=安装时刻累计"完全一致，**不是随机误差**。

2. **代码修复确认**：commit `604e38f2` 引入 `windowStart`，`measure-after-restart.json`/`measure-live-now.json` 两轮实测 1.00×。

3. **但修复并未覆盖全部产出**：16:20 生成的 `audit-cross-client-measure.json` **仍是旧分母**（0.80/0.43/0.30）——说明当时有并行的未修副本在跑。

4. **后果（比原描述更严重）**：`BEFORE-AFTER.md` §一 的 `ws 帧/s` 列把失真值当成可比性输入：记 16.3 实为 **54.2**；记 82.6 实为 **192.5**（= 基线 73/s 的 **2.6×**）；记 135.2 实为 **169.2**。该文件第 29 行把"ws 必须与基线 73 同量级才可比"立为纪律，但**执行纪律用的数字本身错了最多 3.3×**，因此这条纪律在实践上无法识别"其实不可比"的行。

5. **新探针**：每个计数器记录自己的 `t_start_ms/t_end_ms/span_ms`，速率按自身区间算；另给所有计数器区间的**交集** `common_interval`（rAF/WS/mutation 可在交集内**精确重切**计数，CDP 因跨时钟不能重切，已注明）。`recompute-check.py` 会对每个窗口反算 `count/(span/1000)` 与记录值比对，本轮 16/16 通过。

---

### D3 — `ws_by_type` 按信封顶层 type 统计，与基线口径不一致

**裁决：FAIL（历史 after）· FAIL（历史 baseline，且是"非划分"）· PASS（新探针）**

1. **线上实测 wire 形态**（`runs/recon.json`，2079 帧全量）：

   ```
   keySets: {"type,rpcId,method,payload": 2079}   ← 100% 统一
   byTop:   {"server-request": 2079}              ← 顶层 type 恒为同一值（退化）
   byPayload: {"session/event":1813, "session/projection":248,
               "session/subscribed":13, "session/queue":5}  ← 和 = 2079 ✅ 真正的划分
   ```
   且 `method` 与 `payload.type` 一致；两条 socket：`events.mux`（全部业务帧）与 `events.host`（`host/session-status`、`host/session-removed`）。

2. **历史 after**：`ws_by_type` 恒为 `{"server-request": N}` 且 N == `ws_total` → 单桶、零信息量。

3. **历史 baseline 更糟：根本不是划分。** `.workspace/settings-lag/measure5.mjs:21-22` 用 8 个关键词做 `payload.includes(k)` 的**子串命中**（一帧可命中多个关键词）：

   ```
   1309 (session/event) + 139 (session/projection) + 127 (tool) + 44 (subagent)
   + 9 (assistant/message) + 1 (session/jobs)  = 1629   >   ws_frames_total = 1456
   ```
   **超出 173 帧 ⇒ 存在重复计数。** 所以"after 135/s 比基线 73/s 更重"这句话的两端连分母都不是同一种东西。

4. **新探针**：统一 classifier 走 `payload.type`，强制校验 `sum(by_kind) === ws.total`（本轮 16/16 成立），另记 `session/event` 的深层 `event.type`、每 socket 分开、每类字节数、**每秒桶**（供同事件率配对）。分类口径写进 artifact `pre_registered.ws_classification`。

---

### D4 — 缺"页面确实装载"门禁（`settings-open-failed`: dom=108、panel=0 仍被计入）

**裁决：FAIL（历史）· PASS（新探针）**

1. **历史事实确认**：`measure-after-C1.json` 三个窗口全部 `dom_nodes_total=108`、`dom_nodes_panel=0`，其中第二个窗口 `phase="settings-open-failed"`——即"设置页"数据是在**没有设置页**的情况下测的。该失败窗口被后来的呈现跳过（`reports/audit-cross-acceptance.md:195`、`reports/settings-jank-audit-measurement-redteam.md:23,56` 均已确认）。

2. **代码原因**：旧探针只 `waitForTimeout(5000)`，既不检查 runtime ready、也不检查 session.list 成功、也不检查 dialog/panel 是否存在。

3. **新探针门禁（两层）**：
   - **run 级 ready 门禁**：DOM ≥ 300 节点、app root 有子节点、至少 1 条 WS 通道、RPC 四项契约、无 page error。失败 → `exit 1` FATAL，不产出任何"正式"窗口。
   - **window 级 phase 门禁**：`idle` 必须 `dialog_count===0`；`settings-open/dwell` 必须 `dialog_count>=1 且 panel_nodes>0`；另加 `visibility==="visible"`、rAF 帧数 ≥ 20、WS 信封零违规、划分必须成立、`common_interval` 必须存在。
   - 任一门禁不过 → 窗口 `valid:false` + `invalid_reasons[]`，**仍然落盘**，但不进统计。

4. **阈值有效性验证**：失效页 108 节点 vs 健康页 605–606（home）/ 777（面板打开），阈值 300 有充分分隔；本轮基线 16/16 全部门禁通过，`panel_nodes=168`、`dialog_count=1`。

---

### D5 — 正式结果只挑最佳窗口，未保留 invalid runs

**裁决：FAIL（历史）· PASS（新探针）**

1. **代码层确认**：`probes/measure-after-C1.mjs` **没有任何 invalid 概念**。点击失败时只是把 phase 改名成 `settings-open-failed`（第 174 行），窗口照样 push 进 `windows[]`，并且会被 `compare()` 按 phase 匹配（第 224–243 行）。旧探针也不输出 best-window 字段——**挑选发生在呈现层**。

2. **呈现层确认**：`reports/audit-cross-acceptance.md:195` 指出失败运行在证据表中"被跳过"；`reports/BEFORE-AFTER.md:74` 自认结论"只对单一挑选窗口成立"；`reports/settings-jank-audit-measurement-redteam.md:23` 判定"历史报告没有选择性呈现 → FAIL"。

3. **新探针**：
   - `windows[]` 保留**全部**窗口（本轮 16 个，含 warmup），invalid 窗口同时进入 `invalid_runs[]`；
   - 每个场景报 `windows_total / windows_valid / windows_invalid / invalid_fraction`；
   - `valid < n_min(3)` → 场景判定 `INCONCLUSIVE(insufficient-valid-windows)`；
   - **不输出 best-window**：只输出分布；
   - 统计：每场景 n≥3（默认 5），逐窗口指标报中位数 / IQR / p95 / p99 / 超门槛比例，尾部额外给**跨窗口池化**分布（尾样本才够）。
   - 每个窗口带 `page_generation`、`window_sec`、`session_list`，使"跨浏览器代数 / 跨窗口长度 / 跨 N"这类混入**自证可见**。

---

## 2. 本轮新发现的额外问题（原描述未提）

### 2.1 我自己探针的两个 bug（自查发现，已修，如实披露）

按"不可自欺"的标准，这两个必须写进来：

| # | 现象 | 根因 | 处置 |
|---|---|---|---|
| M1 | `mutation_count` 全程为 0 | 默认口径只有 `childList`；实测本应用流式渲染是**原地改文本节点**，`childList` 每窗口仅 6–8 次 | 保留默认口径但**显式标注它测不到 re-render**，并加 `--mutation-chardata` 开关；见 2.2 |
| M2 | `click_to_paint` 恒为空 | 点击后 rAF 记录进了 `clickToPaint`，但下一个窗口的 `RESET` 先把它清空了 | 改为在 `openSettings` 返回前取样（本轮实测 **1.3 ms**） |

### 2.2 DOM mutation 计数在本场景**根本不是 re-render 代理**（实测）

- 默认口径（childList）：每窗口 **0–4** 次。
- 打开 `--mutation-chardata`（扰动轮，`runs/diag-chardata.json`）后：每窗口仍只有 **0–5** 次。
- 对照：仅页面 boot 阶段的 `<head>` 插件注入就产生 **93** 次 mutation（`docMut=93` vs `bodyMut=6`）。

**结论**：在这套应用的"首页 + 设置面板"场景下，流式事件**几乎不产生可观测的 DOM 变更**（很可能因为收到的 `session/event` 大多属于**未被打开的会话**，UI 只更新内部状态）。因此
**`mutation_count` 不得用作渲染成本证据**，历史红队要求的"panel MutationObserver / commit 计数"若照原样实现，在本场景同样会得到一个接近 0 的假信号。
本轮**未解决**该问题（正确仪器是 React commit 计数，属别的调研线），已列入 UNVERIFIED B9。

### 2.3 环境不独占 —— 并发租户会直接污染测量

测量期间机器上同时存在**其他 agent 的 Playwright 浏览器**（`campaign.mjs`、`debug-target.mjs` 等，父进程非本会话）。本轮基线 artifact 如实记录：

```
at_start: loadavg "19.97 45.19 35.54"  cpu_count 32  concurrent_browser_processes 2  mem_used 19834 MB
at_end:   loadavg "35.51 35.73 33.71"  cpu_count 32  concurrent_browser_processes 4  mem_used 22925 MB
```

→ **测量窗口期间负载从 20 涨到 35.5、并发浏览器从 2 增到 4。** 这使"同工况"在单轮内部都难以维持。
本目录的边界（`.workspace/lag-fix/research-v2/measure-hardening/`）保证了我独占**文件**，但不保证独占**机器**。任何引用本轮绝对值的结论都必须带这条。

### 2.4 一次浏览器被 SIGTERM（exit 143）与一次 watchdog 超时 → 驱动轮子改成有界超时

- `runs/run3-gen-switch.json`：运行中浏览器进程 `<process did exit: exitCode=143>`（= SIGTERM，非 crash；`/dev/shm` 31G 空闲、无 OOM 记录）。事后定位为**我自己在后台 job 期间继续发其他命令**导致的进程树回收——改为**前台独占运行**后不再复现（`recovery_events: []`、`browser_generations: 1`）。
- `runs/run4-watchdog.json`：高负载下一次 `fetch`/`evaluate` 长时间挂起，触发全局 watchdog（丢掉了最后一个窗口）。
- **处置（对应"有界超时"要求）**：新增 `withTimeout()`，把 `reset / window-wait / snapshot / cdp / rpc / count-in-range / goto / ready / close` 全部套上**逐操作上限**；超时 → 抛错 → 走恢复路径记 `recovery_event` 或 `invalid`，而不是让整个 run 被全局 watchdog 杀掉。恢复过程（重建浏览器代数、settings 重开）**全部落盘**。

### 2.5 同协议多次运行，同一个 `idle` 场景给出 **PASS / FAIL / FAIL / MIXED**

在**同一宿主实例**（pid 1390375、boot_id 与 starttime 未变）、**同一客户端 bundle**（`6f76616e…`）、
**同一 N=297**、**同一 n=5**、**同一窗口长度 15 s** 下：

| 运行 | 探针 sha256 | idle | settings-open | settings-dwell | idle p99 中位数 | idle `>50ms` 占比中位数 | idle session/event 中位数 |
|---|---|---|---|---|---|---|---|
| `run2-clean.json` | `18c38c80…` | **PASS** | FAIL | FAIL | 33.4 | 0.005 | 123.6 /s |
| `run3-gen-switch.json` | `18c38c80…` | **FAIL** | FAIL | FAIL | 77.3 | 0.022 | 76.4 /s |
| `baseline-live.json`（run5） | `662a6770…` | **FAIL** | FAIL | FAIL | 66.7 | 0.014 | 86.8 /s |
| `run6-same-probe.json` | `662a6770…` | **MIXED** | MIXED | FAIL | 33.4 | 0.003 | 109.8 /s |
| `run7-locked-nogate.json`（持锁轮①） | `c3fad6c2…` | **FAIL** | FAIL | FAIL | 132.1 | 0.077 | 109.4 /s |
| `baseline-live.json`（持锁轮②） | `35a31cd1…` | 全部窗口 invalid | — | — | — | — | 109.4 /s |

**五轮全部结论：INCONCLUSIVE。** 前四轮未持锁；第五轮全程持锁但独占未达成（§0bis）。
而且第五轮并不是"更好"的一轮 —— 它是最差的一轮（idle p99 中位数 132.1 ms），恰因当时并发最重。

**run5 与 run6 用的是字节完全相同的探针**（`probe_sha256` 都是 `662a6770…`），却给出 `FAIL` vs `MIXED`。
run2/run3 用的是略早一版探针（差异只在调试字段、click 取样位置、逐操作超时、环境快照与注释；
**不影响任何被统计的指标口径**），因此四轮的可比性成立。

**这是本轮最重要的结果**：在同一代码、同一 N、同一仪器下，`idle` 的结论在四个值之间翻转
（PASS / FAIL / FAIL / MIXED）。原因不是探针不稳（探针如实报告了它的不可复现），
而是**被测系统的自然负载不受控**——单轮内 `session/event` 速率跨度可达 3.1 ~ 276 /s（约 **89×**），
跨轮中位数也在 76 ~ 124 /s 之间漂移。

### 2.6 且"机器更忙"并不等于"客户端更差"——事件率也不是可靠的代理

run6 的宿主负载**比 run5 更高**（loadavg 起始 56.33 / 结束 28.09，并发浏览器 4→7，而 run5 是 19.97→35.51、2→4），
`session/event` 中位数也**更高**（109.8 vs 86.8 /s），但它的客户端指标**明显更好**：

| | loadavg 起始 | 并发浏览器 | idle se/s 中位数 | idle p99 中位数 | idle 判定 |
|---|---|---|---|---|---|
| run5 | 19.97 | 2 | 86.8 /s | 66.7 ms | FAIL |
| run6 | **56.33** | 4 | **109.8 /s** | **33.4 ms** | **MIXED** |

→ **在本次观测范围内，"事件率更高 ⇒ 更卡"这一简单模型被反例证伪**（或至少说明事件**条数**是糟糕的代理）。
真正驱动尾部的量还没被识别出来（候选：单帧体积、某些 `session/event` 子类型的处理成本、
GC、其他租户的长任务抢占）。**本轮不做归因**，只登记这个反例。

### 2.7 唯一跨 4 轮一致的信号，却有致命的顺序混淆

`settings-dwell` 在四轮里**全部 FAIL**，是唯一稳定的信号；且 run6 中 dwell 的掉帧占比最高
（0.108 / 0.105 / 0.144，而 idle 只有 0.001–0.011）。

**但必须同时说明**：四轮里 `settings-dwell` **永远排在最后**。任何"越跑越热"的漂移
（缓存、GC、宿主长尾、其他租户累积）都会伪装成 dwell 效应。
协议 §2.5 要求的**随机化 open/closed 顺序**本轮**没有执行**，因此
**"设置面板停留导致卡顿"目前是候选，不是结论**。

## 3. 未持锁轮观测（`runs/run5-unlocked.json`）—— **INCONCLUSIVE（未持锁）**

> ⚠️ 本节全部数字取自**未持锁**批次（当时有 2→4 个并发浏览器租户，loadavg 20→35.5）。
> 按 §0bis 纪律，**只能读作"无独占条件下的观测"，不是基线**。持锁轮的对应结果见 §3bis。

**框架自检**：`exit_code=2`，`self_check.ok=true`（0 invalid 窗口、0 mutation violation、0 recovery event、1 个浏览器代数），`watchdog_fired=false`，`duration 274 s`。
**ready 门禁**：`ok=true`（dom=605、app_root=1、WS 2 条、RPC 四项契约全 true、page_errors=[]）。
**只读证明**：`mutation_guard = READ-ONLY-CONFIRMED`（0 violation、0 suspicious、4 个 unclassified 非 GET：`session.history` / `session.models` / `llm.providers` / `dsh-wallpaper/media/cleanup` —— 均为 GUI 自身加载路径，**未逐条裁定**，见 UNVERIFIED B8）。
**N**：每窗口 297，`spread=0` → 同 N 成立。

### 3.1 全部窗口（含 warmup；invalid 全量落盘，本轮 0 个）

| phase | i | N | dom | panel | ws 帧 | se/s | proj/s | script ms/s | 帧 p99 | >50ms 占比 | LT ms/s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| warmup | 0 | 297 | 606 | 0 | 1550 | 89.7 | 17.4 | 60.3 | 33.4 | 0.009 | 0 |
| idle | 0 | 297 | 606 | 0 | 1677 | 89.1 | 23.4 | 77.8 | 78.4 | 0.013 | 10.0 |
| idle | 1 | 297 | 606 | 0 | 1287 | 66.4 | 19.0 | 76.5 | 66.6 | 0.014 | 0 |
| idle | 2 | 297 | 606 | 0 | 1610 | 86.8 | 20.1 | 70.0 | 40.2 | 0.005 | 0 |
| idle | 3 | 297 | 606 | 0 | 1376 | 79.8 | 14.5 | 65.0 | 66.7 | 0.015 | 0 |
| idle | 4 | 297 | 606 | 0 | 1671 | 110.1 | 15.6 | 69.4 | 78.3 | 0.016 | 5.9 |
| settings-open | 0 | 297 | 777 | 168 | 766 | 36.5 | 17.6 | 66.8 | 83.3 | 0.034 | 0 |
| settings-open | 1 | 297 | 777 | 168 | 1263 | 66.1 | 18.3 | 66.7 | 66.7 | 0.018 | 0 |
| settings-open | 2 | 297 | 777 | 168 | 399 | 7.0 | 20.8 | **158.5** | 197.2 | **0.267** | 25.2 |
| settings-open | 3 | 297 | 777 | 168 | 346 | 5.8 | 17.5 | **158.0** | 200.1 | **0.371** | 32.5 |
| settings-open | 4 | 297 | 777 | 168 | 239 | 5.4 | 15.7 | 48.4 | 62.6 | 0.011 | 0 |
| settings-dwell | 0 | 297 | 777 | 168 | 281 | 5.1 | 14.4 | 63.4 | 85.4 | 0.024 | 0 |
| settings-dwell | 1 | 297 | 777 | 168 | 346 | 11.8 | 14.7 | 55.0 | 66.7 | 0.022 | 3.9 |
| settings-dwell | 2 | 297 | 777 | 168 | 184 | 3.1 | 9.3 | 37.5 | 50.1 | 0.011 | 0 |
| settings-dwell | 3 | 297 | 777 | 168 | 193 | 3.3 | 10.1 | 87.3 | 221.9 | **0.259** | 24.2 |
| settings-dwell | 4 | 297 | 777 | 168 | 172 | 3.1 | 9.4 | **118.4** | **308.4** | **0.714** | 47.9 |

- 两张 socket 都已分类：`events.mux`（session/event、projection、queue、jobs）+ `events.host`（host/session-status、host/session-removed）。
- 信封违规 **0**；每个窗口 `sum(by_kind) === ws_total`（划分成立）。
- 观察到的深层 `session/event` 子类型与 `session/projection` 的 `key` 分桶已落盘（`ws_detail.session_event_kinds`）。
- 关键反差：`settings-dwell#4` 在 **3.1 次/s** 的低事件率下仍有 **p99=308 ms、71% 掉帧** —— 单纯"事件少"并不能保证不卡；反过来 `settings-open#0` 在 36.5 次/s 下 p99 仅 83 ms。**事件率不是唯一驱动量**，这一点单看"帧率当可比证书"永远看不到。

### 3.2 场景汇总（判定 = 只看 valid 窗口分布）

| 场景 | n | 判定 | script ms/s 门槛 60 | 帧 p99 门槛 50 | >50ms 占比门槛 0.02 | LT 门槛 100 |
|---|---|---|---|---|---|---|
| idle | 5/5 | **FAIL** | 5/5 超 | 4/5 超 | 0/5 超 | 0/5 超 |
| settings-open | 5/5 | **FAIL** | 4/5 超 | 5/5 超 | 3/5 超 | 0/5 超 |
| settings-dwell | 5/5 | **FAIL** | 3/5 超 | 5/5 超 | 4/5 超 | 0/5 超 |

窗口级分布（中位数 / IQR）：

| 场景 | script ms/s（中位数 / IQR） | 帧 p99 (ms) | >50ms 占比 | 池化 p99（全帧，n≈3–4k） |
|---|---|---|---|---|
| idle | 70.0 / [69.4, 76.5] | 66.7 / [66.6, 78.3] | 0.014 / [0.013, 0.015] | **66.6** |
| settings-open | 66.8 / [66.7, 158.0] | 83.3 / [66.7, 197.2] | 0.034 / [0.018, 0.267] | **166.6** |
| settings-dwell | 63.4 / [55.0, 87.3] | 85.4 / [66.7, 221.9] | 0.024 / [0.022, 0.259] | **200.0** |

> **这组 FAIL 不得读作"设置页卡顿已确证由设置页引起"**：本轮负载从 20 涨到 35.5、并发租户从 2 增到 4（§2.3），且 `idle` 自己在同协议下前一轮还是 PASS（§2.5）。正确读法是：
> **在本轮工况（N=297、session/event 3–110 /s、宿主负载 20–35、有并发浏览器租户）下，三个场景的门槛均未通过；归因不成立。**

### 3.3 同事件率配对：能不能配对全看运气，且配对后的效应量跨轮不一致

`probes/recompute-check.py` 会直接给出速率区间的重叠判定。四轮结果：

| 运行 | idle vs settings-open | idle vs settings-dwell |
|---|---|---|
| `run5`（权威） | `[66.4, 110.1]` vs `[5.4, 66.1]` → ❌ **不相交，无法配对** | `[66.4, 110.1]` vs `[3.1, 11.8]` → ❌ **不相交** |
| `run2-clean` | `[78.7, 211.8]` vs `[22.6, 207.1]` → ✅ 重叠 | — |
| `run6-same-probe` | `[55.5, 154.0]` vs `[60.7, 127.3]` → ✅ 重叠 | `[55.5, 154.0]` vs `[26.8, 104.2]` → ✅ 重叠 |

**权威轮（run5）根本配不上对**——idle 的事件率区间与 settings 两场景完全不相交，
任何 idle↔settings 差值都混着最多 35× 的负载差。这正是 UNVERIFIED A1 的现场证据：
**"同事件率"不是一种可以事先安排的条件，而是一种要靠运气碰到的巧合。**

在两轮**碰巧**能配对的数据里，效应量还互相打架：

| 运行 | 配对（tight） | idle → settings-open 的 Δp99 |
|---|---|---|
| `run2-clean` | 5 对，事件率差 0.1%–7.5% | **+33.3 / +33.3 / +127.2 / +127.5 / +133.3 ms（全部为正、幅度大）** |
| `run6-same-probe` | 5 对，事件率差 3.3%–17.3% | **+16.7 / −24.7 / 0.0 / +33.5 / +16.6 ms（含负值、幅度小）** |
| `run6-same-probe` | 2 对 tight（dwell） | idle → settings-dwell：+25.2 / +29.4 ms（均为正） |

即：同为"同 N、同浏览器代数、同窗口长度、同事件率"的配对，**run2 认为打开设置使 p99 恶化 33–133 ms，
run6 认为只恶化约 0 至 +33 ms 且出现过改善**。差距约 4×。

**因此结论只能是 INCONCLUSIVE**，理由三条：
1. 权威轮无法配对（负载区间不相交）；
2. 能配对的两轮效应量不一致（差约 4×，且符号会变）；
3. 配对**未随机化**——idle 窗口在时间上永远先于 settings 窗口，"时间"与"面板状态"完全共线；
   且 p99 存在 16.7 ms 量化（33.4 = 2 帧、66.7 = 4 帧），n=5 下判定力有限。

## 3bis. 持锁轮①结果（`runs/run7-locked-nogate.json`）—— 全程持锁，但 INCONCLUSIVE

**锁**：`acquired=true`、`mode=mkdir-atomic`、`waited_ms=0`、owner.txt 已写、`released_at=08:00:32Z`、锁目录已消失。
**框架自检**：`exit_code=2`、`self_check.ok=true`（0 invalid、0 mutation violation、0 recovery event、1 个浏览器代数）、`watchdog_fired=false`、`duration 310 s`。
**N**：每窗口 **298**，`spread=0`（同 N 成立）。
**只读证明**：`READ-ONLY-CONFIRMED`。**除"独占"外，所有门禁全绿**（本轮 16/16 窗口通过门禁）。

| phase | i | N | dom | panel | ws 帧 | se/s | script ms/s | 帧 p99 | >50ms 占比 | LT ms/s |
|---|---|---|---|---|---|---|---|---|---|---|
| warmup | 0 | 298 | 605 | 0 | 2681 | 204.1 | 27.1 | 160.5 | 0.018 | 60.2 |
| idle | 0 | 298 | 605 | 0 | 6183 | **392.3** | 76.9 | 150.0 | 0.044 | 35.8 |
| idle | 1 | 298 | 606 | 0 | 3253 | 184.7 | 126.7 | 132.1 | 0.077 | 100.0 |
| idle | 2 | 298 | 606 | 0 | 1395 | 65.8 | 144.0 | 133.4 | 0.082 | 63.0 |
| idle | 3 | 298 | 605 | 0 | 1845 | 109.4 | 132.3 | 116.7 | 0.061 | 14.6 |
| idle | 4 | 298 | 605 | 0 | 470 | 8.7 | 161.3 | 116.7 | 0.095 | 70.0 |
| settings-open | 0 | 298 | 776 | 168 | 476 | 8.1 | 159.8 | 183.4 | 0.161 | 71.9 |
| settings-open | 1 | 298 | 776 | 168 | 420 | 6.9 | 140.1 | 166.7 | 0.129 | 23.8 |
| settings-open | 2 | 298 | 776 | 168 | 294 | 4.8 | 155.8 | 200.0 | **0.422** | 44.1 |
| settings-open | 3 | 298 | 776 | 168 | 1706 | 105.8 | 111.8 | 138.0 | 0.092 | 28.0 |
| settings-open | 4 | 298 | 776 | 168 | 960 | 49.2 | 92.9 | 183.3 | 0.096 | 119.1 |
| settings-dwell | 0 | 298 | 776 | 168 | 1824 | 108.4 | 94.1 | 133.4 | 0.075 | 62.5 |
| settings-dwell | 1 | 298 | 776 | 168 | 325 | 5.7 | 95.7 | 180.9 | 0.105 | 58.6 |
| settings-dwell | 2 | 298 | 776 | 168 | 366 | 6.4 | 97.5 | 169.5 | 0.070 | 45.7 |
| settings-dwell | 3 | 298 | 776 | 168 | 245 | 5.1 | 90.8 | 170.6 | 0.134 | 40.9 |
| settings-dwell | 4 | 298 | 776 | 168 | 304 | 5.1 | 72.8 | 163.3 | 0.081 | 103.5 |

| 场景 | n | 判定 | script(60) | p99(50) | o50(0.02) | LT(100) |
|---|---|---|---|---|---|---|
| idle | 5/5 | FAIL | 5/5 超 | 5/5 超 | 5/5 超 | 0/5 超 |
| settings-open | 5/5 | FAIL | 5/5 超 | 5/5 超 | 5/5 超 | 1/5 超 |
| settings-dwell | 5/5 | FAIL | 5/5 超 | 5/5 超 | 5/5 超 | 1/5 超 |

**这是所有轮次里最差的一轮**（idle p99 中位数 132 ms、掉帧占比中位数 0.077、LT 峰值 100 ms/s），
而不是"更干净的一轮"。原因直白：**它是在并发程度最高的时候跑的**（4 条他线浏览器同时在线，
`idle#0` 的 session/event 速率达 **392 /s**）。

⇒ 因此**不能**把这一轮当作"更可信的基线"；它恰好反证了：**在独占未达成时，锁给不了任何可信度**。

## 3ter. 主 artifact：逐窗口并发记录 + 并发门禁（`runs/baseline-live.json`）

**这是协调者三项指令落实后的产物**，也是本目录当前的主 artifact。

- **锁**：`acquired=true`（`mkdir` 原子，`waited_ms=0`），跑完正常 `released`，锁目录已消失。
- **探针**：`probe_sha256=6a0cecd2…`（含信号兜底，见 §3ter.1）。
- **门禁模式**：`--concurrency-gate strict`（`pre_registered.concurrency_gate.mode = "strict"`）。
- **结果**：16 个窗口**全部 invalid**，原因逐窗写明 `concurrent-foreign-browsers(start=..,end=..,own=1)`。
- **`baseline_status`**：`CONCURRENT-LOAD`、`usable_as_baseline=false`、`host_pid=1390375`、
  `windows_with_foreign = 16/16`、`max_foreign_instances = 2`。
- 三个场景判定均为 `INCONCLUSIVE(insufficient-valid-windows)`。

### 逐窗口证据（`windows[*].concurrency` + `windows[*].host_pid`）

| phase | i | host_pid | own | 起始总数 | 起始外来 | 结束外来 | 门禁 | valid |
|---|---|---|---|---|---|---|---|---|
| warmup | 0 | 1390375 | 1 | 3 | 2 | 2 | ✗ | false |
| idle | 0–4 | 1390375 | 1 | 3 | 2 | 2 | ✗ | false |
| settings-open | 0–4 | 1390375 | 1 | 3 | 2 | 2 | ✗ | false |
| settings-dwell | 0–4 | 1390375 | 1 | 3 | 2 | 2 | ✗ | false |

（16/16 窗口外来实例恒为 **2**；整轮共出现 18 个不同的外来浏览器 PID，说明其中一条 `capture6.mjs`
驱动在同轮内反复重启浏览器。）

场景级：三个场景均 `concurrency.{windows_sampled:5, windows_with_foreign:5, windows_exclusive:0, exclusive_fraction:0}`，
`foreign` 中位数均为 **2**。
当时在场的外来浏览器包括 `node scripts/capture6.mjs --scenarios all --reps 2 …`，
以及一个由 GUI 宿主自身派生的 `headless_shell`（父进程 `node …/bin/dsh web`）。

### 这一轮证明了什么（这才是它的价值）

1. **即使锁是 free、负载已降到 loadavg≈10，仍然凑不出一个"独占窗口"** ——
   逐窗口外来实例数从未为 0，`exclusive_fraction = 0`。
   ⇒ 协调者说的"锁未被所有线遵守"在本轮被**逐窗口量化**了。
2. **门禁是按指令真的会开枪的**：16/16 窗口被判 invalid，而不是被"抢救"成结论。
   场景判定随之降为 INCONCLUSIVE，**没有**任何数字被当作基线。
3. **值仍在、只是被标注**：每个窗口的 `metrics` 照常采集并落盘（可在 `windows[*].metrics` 复算），
   只是**不可用于结论**——这正是"记录而不自欺"的目标形态。

### 3ter.1 顺带修掉的一个**操作性缺陷**：被信号杀死的探针会泄漏锁 + 留下孤儿浏览器

本轮遇到真实事故：`cpu-profile` 持锁进程（`pid 3074138`）在 16:12 被确认**已死**，但锁仍留在盘上
（`owner.txt` 仍在），`linux` 规则下要等到 25 min 才可能被抢占 ⇒ **它把后面所有线的浏览器工作全部堵住**。
旁证：我 16:09:34 那次调用也**被 SIGTERM 打断**（`[killed by signal: SIGTERM]`），与同期的他线进程死法一致。

根因：**Node 的 `SIGTERM` 默认不触发 `'exit'` 事件**，所以只靠 `process.on('exit')` 兜底的探针
被信号杀死时**既不会释放锁、也不会关浏览器**。已修：

- 显式接管 `SIGINT` / `SIGTERM` / `SIGHUP`：**先关浏览器 → 再释放锁 → 落盘已采数据 → 退出**，并设 9 s 硬上限防挂死。
- 实测验证（`runs/sigtest.json`）：TERM 前 `lock=HELD`、浏览器 1→2；TERM 后 **`lock=released`、浏览器回到 1（无孤儿）**，
  artifact 记 `signalled=SIGTERM`、`lock.events=[acquired, released]`。
- 意义：这一处正是"锁协议在实践上失败"的一个具体成因（他线文档也记录过一次浏览器泄漏存活 24 分钟）。

> 因此本轮主 artifact 的产出不是"一份更好的基线"，而是**一份证明"当前条件下拿不到基线"的 artifact**。
> 要得到可用基线，前置条件仍是：`windows[*].concurrency.foreign_instances` 全为 0
> （即 `exclusive_fraction = 1`），而不是"我拿到了锁"。

## 4. 逐条裁决总表

| 编号 | 缺陷 | 历史材料 | 旧探针代码 | 新探针 | 备注 |
|---|---|---|---|---|---|
| D1a | session.list 缺 RPC 信封 | **FAIL** | PASS（commit 604e38f2 已补） | **PASS** | 5/7 份 artifact 中招；失败是 **HTTP 200**，只看 status 会放过 |
| D1b | `items===null` 不硬失败 | **FAIL** | **FAIL**（至今无报错路径） | **PASS** | 改为契约四项检查 + FATAL/invalid + 每窗口 N 快照 |
| D2 | `ws_rate_per_s` 分母 | **FAIL**（膨胀 1.25/2.33/3.33×） | PASS（`windowStart`） | **PASS** | 但 16:20 的 `audit-cross-client-measure.json` 仍是旧分母 → 当时有未修副本 |
| D3 | WS 分类口径 | **FAIL**（after 单桶；baseline 非划分，和 1629>1456） | **FAIL** | **PASS** | 统一走 `payload.type` 并强校验划分成立 |
| D4 | 页面装载门禁 | **FAIL**（dom=108/panel=0 计入） | **FAIL**（只 sleep 5s） | **PASS** | run 级 + window 级两层门禁 |
| D5 | invalid 未保留 / 挑最佳窗口 | **FAIL** | **FAIL**（无 invalid 概念） | **PASS** | 全量落盘 + invalid_runs + 无 best-window + 分布统计 |
| D6 | 有界超时 | — | **FAIL**（只有顶层 catch） | **PASS** | 逐操作超时 ；两次真实挂起各留一份 artifact |
| D7 | 跨轮可复现性 | **FAIL** | — | **FAIL（如实暴露）** | 同一 `idle` 场景四轮给出 PASS/FAIL/FAIL/MIXED；run5 与 run6 探针字节相同仍不一致 |
| D8 | 环境独占性 | — | — | **FAIL（如实记录）** | 未持锁批次期间有 2→4 个并发浏览器租户，loadavg 20→56 |
| D9 | 跨线独占锁（纪律） | — | **FAIL（无此机制）** | **PASS** | 探针内置：取锁前不启动浏览器；未持锁批次一律 INCONCLUSIVE（§0bis） |
| D10 | 独占是否真正达成 | — | — | **FAIL（如实暴露）** | 持锁轮① 并发 5（我 1 + 他线 4，其一带 `--nolockwait`）；持锁轮② 逐窗外来 2–3、`exclusive_fraction=0` ⇒ 持锁≠独占 |
| D11 | 逐窗口并发记录 + 宿主 PID | — | **FAIL（无）** | **PASS** | `windows[*].concurrency`（own/foreign/start/end/gate_passed）+ `windows[*].host_pid`；场景级 `exclusive_fraction` |
| D12 | 并发门禁（判据而非提示） | — | **FAIL** | **PASS** | `--concurrency-gate strict`（默认）：断言 `主浏览器实例数 - 自身 == 0`，不满足即该窗口 invalid；本轮 16/16 被开枪 |
| D13 | "并发负载下绝对值不可当基线"声明 | — | **FAIL** | **PASS** | 原样写入 artifact `baseline_status`（`usable_as_baseline=false`）+ PROTOCOL §0 底线④ + 本文开头 |
| — | 同工况可配对性 | **FAIL** | — | **INCONCLUSIVE** | 权威轮区间不相交；能配对的两轮效应量差约 4×（A1） |
| — | 性能是否达标 | **不可判定** | — | **INCONCLUSIVE** | 见下 |

**关于"性能是否通过"**：**既不能说通过，也不能说不通过——只能是 INCONCLUSIVE。**
理由五条，缺一不可：
1. 同协议四轮运行的 `idle` 判定为 PASS / FAIL / FAIL / MIXED，其中两轮探针**字节完全相同**（§2.5）→ 单轮结论不可复现；
2. 测量期间存在并发浏览器租户，宿主负载在 20→56 之间漂移（§2.3、§2.5）→ 工况未受控；
3. 权威轮无法构造同事件率配对，能配对的两轮效应量差约 4×（§3.3）；
4. 没有用户可感终点，"p99<50ms / script<60ms/s 是否等价于不卡"完全未验证（UNVERIFIED A3）；
5. **上列所有轮次均未持跨线独占锁**（§0bis）⇒ 按纪律一律 INCONCLUSIVE；只有持锁轮可作结论。

可以说的只有三句：
- **权威轮（run5）工况下，三个场景的预注册门槛均未通过**（§3.2）——这是"在该工况下观测到"，不是系统判定；
- **`settings-dwell` 是唯一跨四轮一致的 FAIL**，但它在四轮里都排在最后，顺序混淆未排除（§2.7）；
- **`settings-open`/`settings-dwell` 的尾部方向性证据存在，但归因不成立。**

---

## 5. 对既有结论的影响（建议撤回/降级）

| 既有说法 | 处置 | 依据 |
|---|---|---|
| "三项门槛通过"（历史 v1） | **已撤回，维持撤回** | `BEFORE-AFTER.md:66-74` 自认；本节 §2.5 进一步证明单轮不可复现 |
| `BEFORE-AFTER.md` 表的 `ws 帧/s` 列 | **整列降级为不可用** | 最多失真 3.3×（§D2）；其"可比性纪律"用失真数字执行 |
| 基线 `ws_by_keyword` 分类 | **作废** | 非划分、重复计数（§D3） |
| after 四份 artifact 的 `ws_by_type` | **作废** | 顶层 type 恒 `server-request`（§D3） |
| 历史表的 N 列（734 / 2396） | **作废** | 5/7 份 artifact `items:null`（§D1） |
| ">50ms 帧 22→4" | **不可归因** | 跨 N、跨负载、跨窗口长度 |
| 历史 `settings-open-failed` 窗口 | **invalid，不得计入** | dom=108、panel=0（§D4） |
| `measure-live-now.json` 的 5 s 窗口 | **不得与 20 s 窗口同表** | 窗口长度也是口径；该文件 `window_sec=5`，其余为 20 |

---

## 6. 未验证 / 不可归因（详见 `docs/UNVERIFIED.md`）

| # | 项 | 裁决 |
|---|---|---|
| A1 | **无法人为制造可控流式负载** | 结构性限制。本轮 §3.3 现场证明：同事件率配对**想做也做不到** |
| A2 | 无第二台独立环境 | 协议里的 L3（"已消除用户可感卡顿"）本环境不可达 |
| A3 | 无用户可感终点 | `frame_p99<50ms` / `script<60ms/s` 是否等价"不卡"**完全未验证** |
| A4 | 宿主侧冻结（usage 同步 SQLite） | 不在本探针覆盖范围，浏览器指标看不见宿主事件循环阻塞 |
| A5 | headless 偏差 | 绝对值不可外推到有头环境 |
| B1–B9 | 门槛合理性 / N 快照 / 跨时钟 / 共同区间 / 窗口长度 / 中文选择器 / 只读启发式 / unclassified 未裁定 / **mutation 口径盲** | 见 UNVERIFIED.md |
| C | 历史失效项 | 见上表 §5 |

---

## 7. 剩余风险

1. **并发租户（未解决）**：锁是约定而非强制。实测我持锁期间仍有 **4 个他线浏览器**在跑（其中一条驱动显式 `--nolockwait`）。因此
   **正式测量的前置条件是 `concurrent_browser_processes ≈ 1`，而不是"我拿到了锁"**。
   目前探针只**记录**该值，**不会拒绝**运行 —— 建议下一步改成硬门禁（`>1` 即拒绝启动并退出），
   否则任何一轮都可能重演"持锁却被污染"。
2. **本轮结果是"脏环境下的诚实测量"**，不是"干净基线"。若要干净基线，需要在无并发租户、loadavg 稳定时重跑 `harden-measure.mjs` —— 探针已就绪，命令见 `docs/PROTOCOL.md` §7。
3. **`mutation_count` 目前无解释力**（§2.2），不要用它做任何结论；正确仪器是 React commit 计数。
4. **`click_to_paint` 只有 1 个样本**（1.3 ms），不构成 primary 终点。
5. 探针自身的 `probe_sha256` 一变，旧 artifact 就不能与新一轮直接配对——这是刻意设计（见 §D5）。
6. **本目录早期迭代中有 1 份 artifact（label `baseline-live-final`）被后续覆盖丢失**；它也是 idle=FAIL 的一轮，与 run3/run5 同向，故不影响上述任何结论。为避免同类混淆，现存 artifact 已改名成 `run2-*` / `run3-*` / `run4-*` + 权威 `baseline-live.json`。

---

## 8. 供 `research-v2/MEASUREMENT-STATUS.md` 增补的条目（**建议，未改动共享文件**）

> 共享事实源由协调者维护，本线不并发写入（单一写入者边界）。以下为**建议增补**，证据均在本目录。

### 8.1 §2 增补：一条**持锁**批次仍被污染的直接读数（独立于 react-commit 的普查）

| 观测 | 值 | 来源 |
|---|---|---|
| 硬化线**持锁**轮①（15:55:22–16:00:32，`mkdir` 原子取得、owner.txt 已写、正常释放） | `concurrent_browser_processes` **start 5 / end 5** | `measure-hardening/runs/run7-locked-nogate.json` `environment` |
| 硬化线**持锁**轮②（16:13:57–16:18:17，锁 free 时取得） | 逐窗外来实例 **2–3**；**exclusive_fraction = 0**；16/16 窗口被并发门禁判 invalid | `measure-hardening/runs/baseline-live.json` `windows[*].concurrency` |
| 同轮我自己的浏览器数 | **1** ⇒ 外来 **4** | 同上 |
| 同刻旁证 | `measure-slot.mjs --tag main --window 60000 --nolockwait` 等 4 条外来驱动 | 进程表 |

**⚠️ 计数单位提醒（避免与 react-commit 的数字混用）**：react-commit 报的是"每窗 **18–31 个外来 Playwright 进程**"，
本线报的是 `pgrep -fc "headless_shell --disable-field-trial-config"` = **主浏览器进程数**（前者很可能含 renderer/gpu/zygote 子进程）。
两者**都支持"独占失败"**，但**不是同一量纲，不要平均或互相印证数值**。建议统一写明单位。

### 8.2 §6 增补：硬化探针已内建**锁纪律**与**独占自证**

`harden-measure.mjs` 除 §6 已列能力外，还有：

- **锁纪律（强制前置）**：`mkdir .workspace/lag-fix/research-v2/.probe.lock` 原子取得；已存在则每 **20–40 s** 重试、最长 30 min；
  owner.txt 写 `agent`/`pid`/`started_at`；跑完 `rmdir`；**未取得锁则不启动任何浏览器**（实测：锁被占用时 `windows=0`、exit 1、浏览器数不变）。
- **抢占安全**：仅当「锁存在 且 owner 开始 >25 min 且 owner 进程**已确认**不存在」才抢占；
  **owner.txt 缺 pid ⇒ 存活未知 ⇒ 一律不抢占**（本线实测该规则挡住了对手上活锁的误杀）。
- **独占自证字段**：`environment.concurrent_browser_processes`（start/end）。**这是发现"持锁仍被污染"的器械**。
- **建议升级为硬门禁**：`concurrent_browser_processes > 1` 时**拒绝启动**（现在只记录不拒绝）。

### 8.3 互操作建议（各线 owner.txt 统一字段）

| 字段 | 必须 | 原因 |
|---|---|---|
| `agent` / `line` | 是 | 归属 |
| **`pid`（或 `owner_pid`）** | **是** | **没有它，"owner 进程已不存在"永远无法被证实** ⇒ 泄漏的锁**永远不可安全回收**（本线遇到两次：react-commit 两次写入的 owner.txt 都只有 `host_pid`） |
| `started_epoch` | 是 | 计算锁年龄（>25 min 判据） |
| `host_pid` | 可选 | 仅供提示；**不可**当作锁持有者（本线解析器已显式排除 `host_pid`） |

### 8.4 本线当前状态

- 全部浏览器批次（含持锁轮）**结论 INCONCLUSIVE**（详见 §0bis）。
- **不再新开浏览器**（除非协调者明确要求重采）：仅在收到明确指令时才做一次性重采。

### 8.5 已落实（协调者 2026-09-21 指令）

| 要求 | 落实 |
|---|---|
| 每窗口记录并发实例数与宿主 PID | ✅ `windows[*].concurrency.{total_browser_instances, own_instances, foreign_instances, foreign_pids_sample, at_window_start, at_window_end, gate_passed}` + `windows[*].host_pid`；场景级 `scenarios[*].concurrency.{windows_exclusive, exclusive_fraction}` |
| 协议增加**并发门禁** | ✅ `--concurrency-gate strict\|record\|off`（**默认 strict**）：采集前/后断言 `主浏览器实例数 - 自身实例数 == 0`，不满足即该窗口 **invalid**；已写入 `docs/PROTOCOL.md` §0bis.1 |
| 明确"并发负载下绝对值不可当基线" | ✅ 原样写入 artifact `baseline_status`（`usable_as_baseline=false`）+ `docs/PROTOCOL.md` §0 底线第 4 条 + 本文开头采集条件声明 |

---

## 9. 数据完整性通告核查（协调者：tab-profile 在 ~15:04–15:13 `pkill -f playwright_chromiumdev_profile`）

**方法**：`probes/integrity-scan.py`（只读）扫描全部 artifact 的**每一个窗口**，判据 **E1–E4**：

- **E1** artifact 级：`recovery_events` 非空 / `signalled` / 浏览器代数 >1 / `watchdog_fired`
- **E2** 该窗口的采集尝试被中断（代际切换后重试），或 `invalid_reasons` 含 crash/closed/abort/attempts/timeout
- **E3** 连接中断：同一 socket URL 出现 >1 个实例，或收到 `close`/`error` 事件
- **E4** 数据缺失：`metrics` 空 / rAF 缺失 / `common_interval` 缺失 / activity=unknown

墙钟映射：窗口记录含 `clock.offset_page_minus_node_ms`，可把页面 `performance.now()` 换算成绝对时间，
因此**每个窗口都有精确的墙钟起止**，可判定是否落在事故时段内。

### 9.1 我**先推翻了自己 v1 扫描器的两处误判**（否则会误报）

| v1 判据 | 为什么是错的 | v2 处置 |
|---|---|---|
| `session/subscribed` 帧 = "mux 重连" | 它是「客户端订阅了某个会话」；**新会话出现也会触发**。本机他线频繁新建会话 ⇒ 属常态。run2-clean 在 14:56 出现过 1 帧，但同窗口 socket **实例数仍为 1** ⇒ 不是重连 | 降级为「仅供参考」，不计入中断证据 |
| WS 每秒桶"空洞" | 空闲秒本来就没有帧；主 artifact 16 个窗口全被 v1 标了空洞，纯属噪声 | 仅作参考 |
| `per_socket` 里 `events.host` 时有时无 | 该 socket 只在**有帧**时才进入聚合，属常态 | 移除该判据 |

### 9.2 最终判定：**真中断证据只有 2 条**，且**都不在事故时段内**

| 批次 | 墙钟跨度 | 真中断证据 | 判定 |
|---|---|---|---|
| `smoke.json` | 14:43:36–14:44:15 | 无 | INCONCLUSIVE（未持锁） |
| `run3-gen-switch.json` | 14:50:04–14:54:16 | **E1/E2：14:53:20 浏览器被 SIGTERM（exitCode=143），代际 1→2 后重试** | **INVALID** |
| `run2-clean.json` | 14:55:12–14:59:12 | 无 | INCONCLUSIVE（未持锁） |
| `diag-mo.json` | **15:07:51–15:08:35** | 无（但 10/10 窗口落在事故时段） | **INVALID（环境不可控）** |
| `diag-ctp.json` | **15:10:14–15:10:52** | 无（10/10 落在事故时段） | **INVALID（环境不可控）** |
| `diag-chardata.json` | **15:11:10–15:12:27** | 无（10/10 落在事故时段） | **INVALID（环境不可控）** |
| `run4-watchdog.json` | 15:12:54–15:20:28 | **E1：全局 watchdog 超时**（1/15 窗口与事故时段重叠） | **INVALID** |
| `run5-unlocked.json` | 15:21:46–15:26:01 | 无 | INCONCLUSIVE（未持锁） |
| `run6-same-probe.json` | 15:31:23–15:35:38 | 无 | INCONCLUSIVE（未持锁） |
| `run7-locked-nogate.json` | 15:55:34–16:00:27 | 无 | INCONCLUSIVE（持锁但并发 4–5） |
| `baseline-live.json`（主 artifact） | 16:32:35–16:36:54 | **E3 已仪表化且为 0** | **INVALID（并发门禁 16/16）** |
| `sigtest.json` | — | E1：我**主动**做的 SIGTERM 测试 | N/A（工具测试） |

**关键结论**：
1. **14:53:20 的那次浏览器死亡早于事故时段（15:04）** ⇒ **不能归因于 tab-profile 的 pkill**；
   它是**我自己**在后台 job 期间继续发其他命令导致的进程树回收（改前台独占后未再复现）。
2. **事故时段内我的 3 个诊断批次（30 个窗口）全部落在此区间** ⇒ 一律标 **INVALID**。
   它们本来就已经是 INCONCLUSIVE（未持锁），**从未被用于任何结论**，所以此判定**不改变任何既有结论**，
   只是把"环境不可控"这一理由显式登记。
3. **除上述之外，没有任何窗口出现 E3/E4 证据**（无连接中断、无数据缺失）。
4. `run4-watchdog` 的 watchdog 超时发生在 15:20，**紧邻**事故时段之后；**是否与 pkill 造成的资源扰动有关，本轮无法判定**（不做归因）。

### 9.3 连接完整性：主 artifact 已仪表化并实测为 0

原始批次**没有**连接仪表，所以我**不能**断言它们"无中断"——只能记 `reconnect:not-instrumented`。
为此给探针加了 socket 级仪表（`open`/`close`/`error` + 同 URL 实例计数），并在主 artifact 上实测：

| 指标 | 结果 |
|---|---|
| `ws_detail.socket_instances` | 已仪表化（主 artifact） |
| 同 URL 出现 >1 实例（重连） | **0 例 / 16 窗口** ✅ |
| socket `close` + `error` 事件 | **0 / 16 窗口** ✅ |
| 原批次 | `not-instrumented`（**不得**读作"无中断"） |

> 过程中还修掉一个**自己造成的静默缺陷**：新字段加进了页面侧 `SNAPSHOT`，却忘了在
> `w.ws_detail = {...}` 的投影里透传 ⇒ 采了但没落盘。已修（"采到 ≠ 落盘"是本目录反复出现的坑）。

### 9.4 并发实例数观察（协调者要求注明）

| 观测 | 值 | 来源 |
|---|---|---|
| 主 artifact（16 窗口，逐窗） | `foreign_instances` **恒为 2**；`windows_exclusive = 0/16`；`exclusive_fraction = 0` | `windows[*].concurrency` |
| 持锁轮①（run7） | 运行级 `concurrent_browser_processes` **5**（我 1 + 外来 4） | `environment` |
| 无仪表批次（15:04–15:13 前后） | **未采样**（当时还没有并发字段） | — |
| 独立普查（16:12–16:13，7 次采样） | 主浏览器进程 **2**；chromium 全家族 **9**；loadavg 9.9–11.4 | 本文 §8.1 |
| 更早一次独立观测 | 主浏览器进程最多 **7**（外来 6，其中 4 个带 `--nolockwait`）；chromium 全家族最多 **39** | 本文 §8.1 |

**量纲提醒（再次）**：协调者通报的"19 个 headless_shell"与本线的"主浏览器进程数"**很可能不是同一把尺子**
（本线只数 `headless_shell --disable-field-trial-config` 主进程，不含 renderer/gpu/zygote）。
同一时刻实测两把尺子的比约为 **1:3.5 ~ 1:5**（2 主进程 vs 9 全家族；7 主进程 vs 39 全家族）。**请勿直接互相印证数值。**

### 9.5 ✅ 纪律确认：本线**从未** pkill/kill 任何共享资源

- 全量检索 `probes/*.mjs`、`probes/*.py`：**无 `pkill` / `killall` / 任何对共享进程的 kill**。
- 探针里唯一的 `process.kill` 出现在 (harden-measure.mjs:988) 的锁存活检查，形式为
  **`process.kill(pid, 0)`——信号 0 是纯存在性探测，不投递任何信号**。
- 关浏览器一律走 Playwright 的 `browser.close()`（只关**自己开的**那个实例），
  信号兜底路径亦是 `browser.close()`；**不触碰别人的进程**。
- **今后**：发现异常进程（僵尸浏览器、泄漏实例、疑似误杀事故）**只记录 PID 与父子关系**，
  交由协调者处理；本线不会执行任何 kill。
