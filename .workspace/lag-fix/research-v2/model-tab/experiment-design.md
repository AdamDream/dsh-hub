# 受控实验设计：分离「模型标签固有渲染」与「churn 放大」

- 工作区：`.workspace/lag-fix/research-v2/model-tab/`
- 用途：**交给协调者统一串行执行**。本档**不自行采集**（协调者冻结令：本机 7 条线各开浏览器、独占窗口 0/5）。
- 可直接复用件：`lib/init.js`（页内器械）、`lib/probe.mjs`（交替窗口驱动）、`lib/analyze.mjs`（独立重算）。**执行前把 `probe.mjs` 的 `scenarioDefs` 换成下面 §3 的序列即可**（其余不动）。

---

## 1. 要裁决的两个假设（互斥，可判伪）

| 假设 | 内容 | 判伪条件 |
|---|---|---|
| **H1 固有成本** | 模型标签停留期的成本来自"面板自身内容渲染"（行级 map / provider 行 / 展开卡），与事件流无关 | 把应用侧事件率打到 0 后，模型标签成本**仍显著高于**同条件下的通用标签 → H1 成立；若两者都归零 → H1 伪 |
| **H2 churn 放大** | 成本来自"每事件触发的重渲染"，模型标签只是被卷入 | 面板子树 fiber 渲染数随事件率变化而变化 → H2 成立；若**恒为 0** → H2 在"面板层"伪（成本只能在面板之外） |

**关键**：H1 与 H2 都可以在**不制造事件率**的前提下裁决——因为"关掉投递"就是事件率的一个端点。

---

## 2. 自变量与判据（必须在采集前钉死）

### 2.1 自变量：**应用侧事件投递**（不是"宿主事件率"，后者不可控）

| 条件 | 实现 | 说明 |
|---|---|---|
| `FULL` | 什么都不做 | 帧原样投递 |
| `ZERO` | 页内 WebSocket `message` 监听器里对 `session/event` + `session/projection` 调 `stopImmediatePropagation()` | 帧到达但应用收不到；**只作用于测试浏览器**，不动宿主、不写文件（`lib/init.js` 的 `S.windowStart([...])` 已实现） |

> 另有第三种可选条件 `DOCZERO`（只闸 `settings/document-updated`），用于检验 §4 的机制雷——**只有在该消息类型真的出现时才值得跑**（本档 12 窗内 0 次，故默认不跑）。

### 2.2 因变量（每窗必采，全部按窗口 delta 计算）

| 组 | 指标 | 器械字段 |
|---|---|---|
| 帧 | frames/窗、fps、帧间隔 p50/p95/p99/max、>50ms 帧数、LongTask 个数与 max | `frames`、`frameGap`、`longtasks` |
| CPU | Script/Task/RecalcStyle/Layout（ms 与 ms/s，**一律窗口 delta**） | `cdp*`（由 `cdpRawStart/End` 重算） |
| 面板渲染 | **面板子树 fiber 渲染数**、整对话框 fiber 渲染数、**每次 commit 的全应用 fiber 数**、commit 数、panelSetSize/dlgSetSize | `react.fibersPanelInWindow`、`fibersDlgInWindow`、`fibersPerCommitAll`、`commitsInWindow` |
| 面板变化 | 面板 DOM mutation（text/child）、面板文本长度、`modelEntry` 行数 | `mutations`、`panelTextLen`、`panelRows` |
| 事件 | `session/event`、`session/projection` 帧数（**原始帧率**，逐窗记录） | `ws.byType` |
| 环境 | 窗口起止的并发浏览器数、`load1/load5`、宿主 PID/启动时刻、bundle mtime | `externalLoad`（**执行前需修一处**：见 §5 缺陷 D1） |

### 2.3 判据（阈值，先声明）

| 判定 | 阈值 |
|---|---|
| 面板参与 churn | `fibersPanelInWindow > 0`（≥ 3 个窗重复出现） |
| 固有成本存在 | `ZERO` 条件下模型标签的 Script ms/s **≥ 1.5 ×** 同 `ZERO` 条件下通用标签；或帧率比 ≤ 0.9 |
| 放大存在（面板层） | `FULL` 与 `ZERO` 之间 `fibersPanelInWindow` 有显著差（即 >0 与 0 之别） |
| 放大存在（面板之外） | `FULL` 与 `ZERO` 之间 `fibersPerCommitAll`/`commitsInWindow` 显著差，且面板 fiber 恒 0 |
| 负载混淆 | 同 cycle 内相邻窗的 `load1` 差 **> 30%** 时，该对比标 `LOAD-CONFOUNDED`，不得用于裁决 |
| 可裁决 | 每个对比需 **≥3 个可用的配对窗**（未标 `LOAD-CONFOUNDED`、无页内错误、面板自证已挂载） |

---

## 3. 窗口序列与数量（最小充分）

**同标签内变事件率** + **同条件跨标签** 两者都要，故用「配对交替」：每个 cycle 内 4 个窗，模型/通用各 2 个（FULL、ZERO），紧邻 = 负载可比。

```
cycle k (k = 1..3):
  W1  models-FULL     模型   投递全部
  W2  general-FULL    通用设置 投递全部
  W3  models-ZERO     模型   闸 session/event + session/projection
  W4  general-ZERO    通用设置 闸同上
```

- **窗口时长：60 s**（`--window=60000`）；窗间 settle **8 s**（`--settle=8000`）
- **cycle 数：3** ⇒ 共 **12 窗 / ≈ 13.6 分钟纯采集**（+ 导航与 settle ≈ 2 分钟）
- 若协调者只能给更紧的独占窗口：**最小可接受为 1 个 cycle + 1 次重复（8 窗 / ≈9 分钟）**，但 §2.3 的"≥3 配对"将降级为"≥2 配对"，裁决置信度下调一档并必须标注
- 归属器械同时统计**面板子树**与**整对话框**两层（防止"面板取浅"的假 0，见 §5 缺陷 D3）

**为什么必须配对而不是成块**：本档已实测宿主 `load1` 在 12–27 之间漂移、并发浏览器 4–6 个；成块（先跑完 FULL 再跑 ZERO）会让"条件"与"时段"完全混淆。

---

## 4. 可选补充条件（仅当 §3 出现"面板 fiber > 0"时才需要）

若 `FULL` 下出现 `fibersPanelInWindow > 0`，说明**配置失效信号在该窗内真的发生了**（因为结构上只有 4 条失效信号能驱动面板）。此时追加：

1. 记录 `ws.sub` 里是否出现 `settings/document-updated`（帧计数即可判定）
2. 加跑 `DOCZERO` 条件（只闸该类型）——若面板 fiber 随之归零，则确认"面板成本 = 配置失效驱动的整树重建"，可据此量出**每次重建的 ms 成本**（= FULL − DOCZERO）。
3. 该情形下 §5 的修复建议（`1805` 窄选择器 + `5418` 快照引用复用）才**有实测收益**。

---

## 5. 执行前必须修的三处器械缺陷（本档自曝，避免下一档重踩）

| 编号 | 缺陷 | 现状与修法 |
|---|---|---|
| **D1** | **并发浏览器计数恒为 0** | `procSnapshot()` 用 `/proc/<pid>/cmdline` 的第 0 段当可执行名，但该段在 Playwright 子进程里是整段参数（如 `playwright_chromiumdev_profile-XXXX --remote-debugging-pipe --no-startup-window`）。修法：把"键以 `playwright_chromiumdev_profile` 开头"的计数求和（本档事后重算：窗口起始 **4–6** 个，含自己 1 个）。`browserJiffies` 同理失效，需改用 `/proc/<pid>/stat` 定位父浏览器进程再取 utime+stime |
| **D2** | 面板"每次 commit 全应用 fiber"归属标签恒为 `no-dom` | 因为被计入的多为合成 fiber（`stateNode` 为 null）。若需要**具体归属区域**，需在 walk 时按 fiber 祖先链找最近宿主节点并归类；否则只能断言"不在面板子树内"（本档即此口径） |
| **D3** | 面板容器定位 | `nav.nextElementSibling` 只到内容头（49 节点），曾导致"模型行 = 凭证卡片"的误读。修法：从该节点**逐级向上取节点数最多的祖先**（现 `lib/init.js` 的 `panelFind()` 已修正，会返回 `chain` 供核对） |
| **D4** | LongTask/mutation 只统计在面板上 | 面板 mutation 为 0 时无法反证"全应用无 DOM 变化"；若结论需要，追加全 `document.body` 的 mutation 计数 |

---

## 6. 执行方式（可直接照跑）

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/model-tab
# 前提：独占窗口已授予；仅此一条线在跑浏览器
node lib/probe.mjs --window=60000 --settle=8000 --cycles=3 --tag=serial --heartbeat=20000
node lib/analyze.mjs serial        # 独立重算 + 对比 + 相关性
```

**纪律（沿用本档已执行的口径）**：
- 只点设置页导航标签与"编辑"**只读披露**开关；**绝不**点保存/应用/删除/模型切换
- 采集前后对 `~/.dsh/settings.yaml` 取 sha256，必须一致（本档证据：`75718baaaddff265` → 一致）
- 单浏览器实例；**绝不 pkill/kill** 任何进程（发现异常进程只记 PID）
- 结束必须 `browser.close()`（`probe.mjs` 的 `finally` 已保证）
- 若 `problems` 数组非空（面板未自证挂载、页内异常、面板不在场），该窗作废并如实保留

---

## 7. 结果如何裁决（把数字变成结构结论）

分析器已内置这些派生量，执行后按下表直接读：

| 观察 | 结论 |
|---|---|
| `ZERO` 下模型与通用 Script ms/s **都 ≈0**、LongTask **0**、帧率回到上限 | **固有成本 ≈ 0**（两个标签都没有） ⇒ H1 伪 |
| `FULL` 下 `fibersPanelInWindow == 0`（模型与通用皆然） | **面板层无 churn 放大** ⇒ H2 在面板层伪；放大只发生在面板之外（用 `fibersPerCommitAll` 与 `commitsInWindow` 的 FULL/ZERO 比给出） |
| `FULL` 下模型与通用的 `fibersPerCommitAll` **基本相同**（比值 ≈1）而帧率仍差 | 差异来自**环境负载/事件量**，与标签身份无关（用同 cycle 相邻窗的事件率比与 `load1` 差核查） |
| `FULL` 下 `fibersPanelInWindow > 0` | 面板真的被卷入了 ⇒ 转 §4，量出"每次整树重建"的成本 |

**报告口径（协调者要求）**：只给**比值 / 为零 / 占比**类结构结论；绝对 ms 与 fps 在并发负载下**不得作基线**（本档全部绝对值均已如此标注）。
