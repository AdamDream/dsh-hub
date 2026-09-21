# 模型标签为什么最慢：成本归因与最小修复设计

> ## ⚠️ 状态：本文件的动态部分已冻结，请优先读两份新件
>
> **协调者冻结令（立即生效）**：本机 7 条线各开浏览器、独占窗口 0/5、持锁期间仍有 18–31 个外来 Playwright 进程 ⇒ 我这条线的"固有 vs 放大"问题**不可能靠自采得到可信定量**。
>
> - **已停止一切新浏览器/新采集窗口**；我这侧进程已确认清零（无 `probe.mjs`/`verify*.mjs`/`diag-fiber`/`ws-shape` 存活，浏览器已 `browser.close()`）。
> - **本文件 §5–§7 的全部动态数字采集于冻结令之前（07:34–07:55）**，是在**4–6 个并发浏览器、load1 12–27** 下得到的。根据协调者要求，**这些绝对 ms/fps 只作内部比值使用，不得当作基线**；结构性结论（为零 / 比值 / 占比）仍然成立。
> - **请改读两份新交付**：
>   - `structure.md` —— 第 (a) 段：**静态源码 + 已有数据**的结构结论（渲染结构、每次 commit 重建什么、模型行数量级、memo/虚拟化，全部 path:line）
>   - `experiment-design.md` —— 第 (b) 段：**分离固有与放大所需的受控实验设计**（同标签内变事件率、窗口数、判据、器械缺陷修法），交协调者统一串行执行
> - 本文件保留作为**原始证据与内部比值**的出处（`raw/phase-main.json` 等原始件不删不改）。
> - 纪律：未点保存/应用/删除；未 pkill/kill 任何共享资源。


- 工作区：`.workspace/lag-fix/research-v2/model-tab/`（本档独占）
- 被测对象：活体 GUI `http://127.0.0.1:3080`（宿主 PID 1390375，**未重启、未改配置**）
- 纪律遵守：未点保存/应用/删除/模型切换；只点了设置页导航标签与「编辑」展开按钮（只读披露开关）；**未 pkill 任何进程**；单浏览器实例（我自己的，运行结束已 `browser.close()`）
- 采集期：2026-09-21 07:25–07:55（UTC+8）smoke 校准 + 07:34–07:47 主扫描 + 07:51–07:55 展开态复核
- 产品文件写入证据：`settings.yaml` sha256 前 16 位 `75718baaaddff265`，**复核前后完全一致**（`raw/verify2.json → settingsUnchanged: true`）

---

## 0. 一句话结论

**「模型」标签停留期的成本不是它自己的渲染成本——它在事件洪流下根本不重渲染。**

我用 React DevTools hook 在「模型」标签自己的 DOM 子树（`[role="dialog"] .panel`，即 `VOzbGW_panel`，含 nav 120 个节点）和整个设置对话框上分别统计每次 commit 真正渲染的 fiber：**12 个窗口中，模型子树内的 fiber 渲染数恒为 0**（展开 provider 编辑卡后同为 0），而同时刻全应用每次 commit 渲染约 266–281 个 fiber、11/s 次 commit。模型面板的 store 只在挂载时和 4 条配置失效信号上重载（`client.js:2772-2778`），**与 session 事件流完全解耦**。

因此：

| 成本项 | 是否被证据支持 | 量级 |
|---|---|---|
| a) 模型面板自身内容重渲染（行级 map / provider 行 / 模型行） | **否**（0 fiber/window，12/12 窗口） | ~0 ms/s |
| b) 被事件 churn 放大 | **是，但放大的是"全应用"而非"模型面板"** | 关掉事件流后 Script −0.036 ms/s、Task −0.092 ms/s、帧率 +9.7 fps（37x / 87% 的加速） |
| c) 模型标签在事件流关掉后的固有成本 | **≈0** | Script 0.001 ms/s、Recalc 0.004 ms/s、LongTask 0、59.8 fps（基线地板） |
| d) 同负载下与「通用设置」的差 | **≈0**（在噪声内） | fps −5.8（−10%）、Script +0.012 ms/s；但**两标签的 commit/fiber 工作量不同**（事件率 35.7 vs 20.2/s），用工作量归一后差距消失 |

**裁决**：**模型标签不是"被 churn 放大"的重灾，也几乎没有"固有成本"。** 它的 13–42 fps 观测来自**宿主并发负载**与**全应用级的每事件重渲染**，两者对所有标签一视同仁。**行级 memo / 列表虚拟化 / 展开态惰性化在证据上都无效**——因为面板本来就不参与 churn。详见 §4.4 与 §6。

---

## 1. 交付物与复算入口

| 文件 | 内容 |
|---|---|
| `audit.md` | 本文件 |
| `raw/phase-main.json` | **主扫描原始件**：12 个 60s 窗口，每窗含 CDP 累计原值、WS 分类计数、React commit 明细、进程/负载采样 |
| `raw/analysis.json` | `analyze.mjs` 从原始累计快照**独立重算**的全部结果（逐窗 + 聚合 + 对比 + 相关性 + 完整性校验） |
| `raw/verify.json` | 复核 1（展开 DeepSeek 官方 provider，3 模型行；settings sha 证据） |
| `raw/verify2.json` | 复核 2（展开 opencode-go pi-ai provider，16 模型行 / 34 input；settings sha 证据） |
| `raw/fiber-diag.json` | fiber/DOM 归属器械的校准证据（含 `contentAncestorChain`，证明设置面板位于同一 React root） |
| `raw/ws-shape.json` | 事件流 payload 形态与字节数（判别符、每类载荷大小） |
| `raw/phase-smoke*.json` | 校准轮（**不计入结论**，仅用于器械自检；已单列） |
| `raw/main.stderr` / `main.stdout` | 主扫描运行日志 |
| `raw/verify*.stderr` | 复核轮日志 |
| `lib/init.js` | 页内器械：WS 投递闸门、rAF/LongTask、HTTP/XHR、定时器、React commit 剖析、DOM 归属 |
| `lib/probe.mjs` | 主扫描驱动（单浏览器、交替窗口、外部负载采样） |
| `lib/verify.mjs` / `lib/verify2.mjs` | 展开态复核驱动 |
| `lib/ws-shape.mjs` | 只读事件流旁路采样（作为对等客户端连 `ws://127.0.0.1:3080/api/events.mux`） |
| `lib/analyze.mjs` | 独立重算器（不信任采集期算的数） |
| `lib/init3.js` / `lib/diag-fiber.mjs` | fiber 归属校准探针 |

复算：

```bash
cd .workspace/lag-fix/research-v2/model-tab
node lib/analyze.mjs              # 读 raw/phase-main.json，重算全部 delta 与对比
```

`analyze.mjs` 会把每个窗口的 `ScriptDuration/TaskDuration/RecalcStyleDuration/LayoutDuration` 从 `cdpRawStart`/`cdpRawEnd` 两个累计快照**重新相减**，并与自身口径比对；累计值回退会被记入 `integrity.cdpBackward`。本次结果：**12 窗口、0 回退、0 issues**。

---

## 2. 判据（先声明）

| 判据 | 阈值 | 说明 |
|---|---|---|
| 帧率崩塌 | 持续 < 45 fps | 同页基线 57.2 fps（tab-profile 口径） |
| 面板"固有成本" | 事件流关掉后仍 > 基线 1.5x 的 ms/s | 关流条件见 §3.2 |
| 面板"churn 放大" | 关流后成本显著下降且**面板子树 fiber 渲染 > 0** | 两者缺一即不成立 |
| 面板参与 churn 的硬证据 | 该窗内 `fibersPanelInWindow > 0` | 本次 12/12 为 0 |
| 卡顿帧 | >50ms 帧 ≥ 3/100 且 > 基线 1.5 倍 | 基线 1.049/100 |
| 差异可裁决 | 标签间差 ≥ 两组窗的窗间离散度 | 本次窗间离散很大（见 §3.3），故凡差值在离散内一律记 INCONCLUSIVE |

---

## 3. 方法：事件率对照是怎么做的（含必须披露的混杂因子）

### 3.1 我做不到"低事件率 vs 高事件率"的**人为**对照——只能做"投递 vs 不投递"

用户要求在同一标签内做低/高事件率各 ≥3×60s。**我无法在客户端凭空制造事件**（事件由宿主上其他活跃 agent 会话产生，非我可控）。因此我把对照设计成**因果可裁决的形式**：

- **自然窗**：事件流按原样投递（事件率由环境决定，本次 1.6–75.9 /s）
- **闸流窗**：在**页内 WebSocket `message` 监听器里**对 `session/event` + `session/projection` 调用 `stopImmediatePropagation()`，即**帧到达但应用收不到** → 应用侧事件率 = **0**

这样得到的是"**全量 vs 零**"的因果对照（能回答"成本是不是事件驱动的"），而不是"低 vs 高"的剂量-反应曲线。**这是本档的设计限制，必须明示。**

> 闸流是**测试器械**，只作用于我自己的浏览器实例；不动宿主、不动产品、不写文件。副作用：受闸的标签内容会短暂停在最后一帧（这正是"应用收不到事件"的证明）；复核轮结束时无任何异常页内错误（`runs[*].errors == 0`）。

### 3.2 窗口序列（交替，非成块）

```
cyc1: models-natural → general-natural → models-allmute → general-allmute
cyc2: models-natural → general-natural → models-allmute → general-allmute
cyc3: models-natural → general-natural → models-allmute → general-allmute
```
每窗 60s，窗间 settle 8s，**模型与通用在同一 cycle 内紧邻**（宿主负载非平稳，紧邻才可比）。12 窗全部保留，无一作废。

### 3.3 混杂因子（必须在先读）

1. **宿主是共享的，负载非平稳且量级很大。** 我的每次窗口边界都采样了 `/proc/loadavg` 与浏览器进程数：
   - 窗口起始时**并发浏览器 4–6 个**（均值 5.08，其中我自己 1 个，**兄弟线 3–5 个**）
   - `load1` 从 **11.9 到 27.4** 波动；`load5` 一度 41.5，`runnable` 4453 线程
   - 校准轮（smoke）里同一「模型」标签在负载 34 时是 **7.9 fps**，在负载 24 时是 **60.0 fps** —— 同一标签、同样的面板结构，**7.6 倍的差异**。这是本档最重要的方法学事实：**绝对帧率在本机不可当作标签属性**。
   - 进程侧核对：采集期存在兄弟线的 3 个浏览器启动进程（`node scripts/capture3.mjs`×2、`node probes/harden-measure.mjs`×1），外加我 1 个。**我未杀任何进程**（记录 PID：2104881、2302907、2302653 及各自 launcher 的 node 父进程）。
2. **"低事件率窗"不是"安静的宿主"。** 闸流窗里宿主仍在推事件（我统计到 106–3827 帧/60s），只是应用收不到。所以闸流窗的**帧率改善不能读成"宿主变安静了"**，只能读成"应用侧的每事件工作量被移除"。
3. **绝对毫秒数在并发负载下采集，不可当基线。** 本档所有 ms/s 值只在**同批窗之间**可比。

---

### 3.4 器械自检与"采集器缺陷"（本档自己踩到的三个坑，全部已披露）

测量一个"几乎不重渲染的面板"时，最大的风险是**器械自己制造假 0**。我在校准轮里抓到并修掉了三处，校准证据在 `raw/fiber-diag.json` 与 `raw/phase-smoke*.json`：

1. **面板容器取浅了。** 最初取 `nav.nextElementSibling`（49 节点），把 3 行凭证卡片误当成"模型行"（`modelEntry=0` 却被读成"模型行没渲染"）。修正为**向上取节点数最多的祖先**后正确锁定 `div.VOzbGW_panel`（120 节点）。
2. **归属判定失效。** 早期用"DOM fiber 森林"做子树匹配，`namesInPanel` 曾出现 `ModelsSection: 52 / Loaded: 52`，而同时刻 `fibersPanelInWindow=0`——自相矛盾。改为**宿主元素 Set + `fiber.stateNode` 匹配**，并同时统计"面板子树"与"整个对话框"两个层级。
3. **校准证明器械不是瞎的。** `raw/fiber-diag.json` 显示：设置面板与 dialog 同一 React root（`contentAncestorChain` 里有 `SettingsPanel → SettingsRoot → RootEntry → SlotOutlet → AppFrame → … → HostRoot`），且**面板挂载那一次 commit 匹配到 167 个 fiber**。也就是说：**当面板真的渲染时，器械能看见**；12 个 60s 窗里看到 0，是面板真的没渲染。

另有两处已披露的口径问题：**我自己的 fiber 遍历会占用主线程**（`walkMsPerWindow` 中位 <1ms，对结果影响可忽略，但同批窗都带同样开销，故只影响绝对值不影响对比）；**muted 窗的浏览器 CPU jiffies 采集返回 0**（`/proc/<pid>/cmdline` 的 exe 字段含参数导致字典键分裂），故"我自己的浏览器 CPU"未计入，**并发负载只用 `/proc/loadavg` 与并发浏览器进程数报告**。

## 4. 静态读：模型标签的真实渲染结构

被测 bundle：`/home/CNS2026495165/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js`
（符号链接 → `/home/CNS2026495165/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-models/lib/client.js`，2812 行，mtime 2026-09-12；宿主 09-21 14:37 启动 = 早于我全部测量，**未重载**）

### 4.1 组件树与"每次 commit 创建多少元素"

| 组件 | 位置 | 说明 |
|---|---|---|
| `ModelsSection` | `client.js:1792` | slot 入口，仅做注入检查后渲染 `Loaded` |
| `Loaded` | `client.js:1803`，订阅在 **1805** | `const state = injected.useSnapshot((snapshot) => snapshot)` —— **整快照标识选择器**（等于无选择器） |
| provider 行 map | **`client.js:1909`** `configured.map((row) => {…})` | 每行 `li.rowCard` → `div.rowHead` → `span.rowIdentity`（`span.rowName` + 可选 `span.rowTag` + 可选凭证点）+ `span.rowActions`（`button` 编辑 + 可选 `button` 删除） |
| `renderProviderEditor` | `client.js:1714` | 展开时把 `ProviderEditor` 塞进该 `li` 的第二子节点 |
| `ProviderEditor` | `client.js:1393`，JSX 在 **1656** | 26 处 `jsx/jsxs` 调用；3 处 `useMemo`（**1402/1403/1412**，仅 root/node/protocols） |
| `ModelListEditor` | `client.js:754`，模型行 map 在 **896** | 33 处 `jsx/jsxs`；每行 `div.modelEntry` → `div.modelRow`（2×(input+button+svg)）+ 展开时 `div.modelAdvanced` |
| `DeepSeekModelsEditor` | `client.js:256`，模型行 map 在 **372** | 19 处 `jsx/jsxs` |
| `CustomProviderCard` | `client.js:1092` | 24 处 `jsx/jsxs` |
| `WelcomeNotice` | `client.js:2288` | 订阅同一 store |
| `OnboardingModal` | `client.js:2137` | 3 处 |

**每行创建的元素数（静态可数）**：

- 折叠态 provider 行：`li` + `div` + `span` + 2–3 `span`（+凭证点）+ `span` + 1–2 `button` ≈ **9–11 个元素/行**
- 展开态模型行（`ModelListEditor`，`client.js:896`）：`div.modelEntry` + `div.modelRow` + 2 `input` + `button`(chevron) + `svg` + `path` + `button`(trash) + `svg` + `path` ≈ **10 个元素/模型行**（另有可选 `div.modelAdvanced`）

实测吻合：折叠态 `li=3 / button=17 / svg=11 / input=0`；展开 opencode-go 后 `modelEntry=16 / input=34 / svg=43`，整对话框节点 120 → 303。

### 4.2 memo / 虚拟化 / 订阅

- **`react.memo`：整个 bundle 0 处**（`grep -n "react\.memo" client.js` 无输出）。
- **`useMemo`：仅 3 处**，全在 `ProviderEditor`（1402/1403/1412），用于 schema 重水化与协议选项；**不在行级**。
- **虚拟化：无**。两处列表都是裸 `.map()`（`client.js:1909`、`896`、`372`），全量渲染。
- **订阅**：`Loaded` 用恒等选择器取整快照（1805）。store 是 `createSnapshotStore`（`dsh-client-runtime/lib/client.js:5397`），其 `update`（**5418**）走 `produce(...)` 后 `setState(..., true)`；hook 经 `bindSnapshotSelector`（`dsh-client-ui-renderer/lib/client.js:154`）落到 `useSyncExternalStoreWithSelector`（**92/158**），默认 `Object.is`。**⇒ 只要 store 发一次 update，`Loaded` 必重渲染一次（即使内容逐字节相同）。** 这是"内容没变也会重渲染"的机制性原因（回答任务 3 的第三问）。
- **面板根与导航同一容器**：实测 `[role="dialog"]` = `div.VOzbGW_panel`（120 节点，含 `nav` 69 节点 + 内容 49 节点），父节点 `div.VOzbGW_overlay`。

### 4.3 展开/折叠与编辑态差异

- 折叠态：**模型行 map 完全不执行**（`open` 为假时不调用 `renderProviderEditor`）。实测折叠态 `modelEntry=0`。
- 展开态：`ProviderEditor` 挂载 → `ModelListEditor`（`client.js:1279`）→ 每个模型一行（`896`）。实测 opencode-go 展开后 `modelEntry=16`（两个 provider 各 8 行）、`input 0→34`。
- **展开态还会发一次凭证描述请求**：`ProviderEditor` 的 `useEffect`（**1417–1427**）在挂载时 `api.credentials.describe({refs:[keyRef]})`。
- 编辑态（`ModelListEditor` 的 `expanded`/`editing` state，`760/761`）是**组件本地 state**，按行懒建（`Set`），不进入面板 store。

### 4.4 面板何时才会重渲染（**关键**）

`store` 只在这些时机改变（`client.js:2712-2778`）：

| 触发 | 位置 | 频率证据 |
|---|---|---|
| 首次挂载 | `Loaded:1856`（`status === "idle"`） | 每次进标签 1 次 |
| `settings/document-updated` | **2772** | **本次 12 窗全程 0 次**（`ws.sub` 分类里从未出现该类型；整包 `grep` 也证明它只在 `dsh-settings` 文档真正变更时 emit，且其 `Loaded` 不受其影响） |
| `credentials/reference-updated` | 2775 | 0 次 |
| `llm/adapters-updated` | 2776 | 0 次 |
| `connection/reset` | 2777 | 0 次 |

**⇒ 面板重渲染与 session 事件流在结构上无关。** 下面动态测量证实了这一点。

---

## 5. 动态归因（主扫描：12 × 60s）

### 5.1 逐窗口原始数（全量，无挑选）

| 标签 | cyc | fps | frames | 帧p50 | 帧p95 | >50ms/100 | LongTask | Script ms/s | Recalc ms/s | Task ms/s | session/event /s | projection /s | commits | **面板fiber** | 全应用fiber | 节点 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 模型·自然 | 1 | 41.8 | 2508 | 16.7 | 83.3 | 6.9 | 2 | 0.064 | 0.078 | 0.170 | 75.9 | 9.1 | 651 | **0** | 173 785 | 729 |
| 通用·自然 | 1 | 51.1 | 3067 | 16.7 | 33.4 | 3.0 | 2 | 0.037 | 0.053 | 0.113 | 36.1 | 6.6 | 477 | **0** | 133 619 | 777 |
| 模型·闸流 | 1 | 59.8 | 3586 | 16.7 | 16.8 | 0 | 0 | 0.001 | 0.005 | 0.017 | 2.4 | 7.0 | 1 | **0** | 279 | 729 |
| 通用·闸流 | 1 | 59.5 | 3570 | 16.7 | 16.8 | 0 | 0 | 0.002 | 0.005 | 0.019 | 63.8 | 4.6 | 3 | **0** | 805 | 777 |
| 模型·自然 | 2 | 55.7 | 3341 | 16.7 | 16.8 | 1.0 | 0 | 0.022 | 0.029 | 0.068 | 1.6 | 4.8 | 342 | **0** | 91 422 | 729 |
| 通用·自然 | 2 | 58.1 | 3488 | 16.7 | 16.8 | 0.4 | 0 | 0.018 | 0.026 | 0.059 | 1.5 | 4.2 | 300 | **0** | 84 570 | 777 |
| 模型·闸流 | 2 | 59.8 | 3589 | 16.7 | 16.7 | 0 | 0 | 0.001 | 0.004 | 0.013 | 13.2 | 2.8 | 0 | **0** | 0 | 729 |
| 通用·闸流 | 2 | 54.5 | 3270 | 16.7 | 16.8 | 1.7 | 0 | 0.002 | 0.004 | 0.016 | 54.5 | 3.7 | 1 | **0** | 293 | 777 |
| 模型·自然 | 3 | 52.8 | 3170 | 16.7 | 16.8 | 2.1 | 2 | 0.026 | 0.034 | 0.080 | 29.6 | 5.4 | 402 | **0** | 106 534 | 729 |
| 通用·自然 | 3 | 58.4 | 3506 | 16.7 | 16.8 | 0.2 | 0 | 0.019 | 0.027 | 0.060 | 23.0 | 4.4 | 321 | **0** | 90 057 | 777 |
| 模型·闸流 | 3 | 59.7 | 3582 | 16.7 | 16.8 | 0 | 0 | 0.001 | 0.004 | 0.013 | 1.8 | 5.3 | 1 | **0** | 279 | 729 |
| 通用·闸流 | 3 | 59.9 | 3595 | 16.7 | 16.7 | 0 | 0 | 0.002 | 0.004 | 0.016 | 60.7 | 5.4 | 3 | **0** | 805 | 777 |

> CDP 口径：Script/Recalc/Task/Layout 全部为**窗口 delta**（由 `raw/phase-main.json` 的 `cdpRawStart`/`cdpRawEnd` 独立重算，`analysis.json → integrity` 12/12 一致）。
> 60s 窗口内 4 个场景的 event/s 为窗口均值；`session/projection` 与 `session/event` 都是**原始帧率**（每帧 1 条载荷，见 §5.6）。

### 5.2 同一标签内的因果对照（关掉事件流）

| 对照 | Script ms/s | Recalc ms/s | Task ms/s | fps | >50ms/100 | LongTask | commits | 全应用fiber | **面板fiber** |
|---|---|---|---|---|---|---|---|---|---|
| 模型 自然 | 0.037 | 0.047 | 0.106 | 50.1 | 3.32 | 1.33 | 465 | 123 914 | **0** |
| 模型 闸流 | 0.001 | 0.004 | 0.014 | **59.8** | 0 | 0 | 0.67 | 186 | **0** |
| **Δ（自然−闸流）** | **+0.036（37×）** | **+0.043（12×）** | **+0.092（7.6×）** | **−9.7** | +3.32 | +1.33 | +464 | +123 728 | **0** |
| 通用 自然 | 0.025 | 0.035 | 0.077 | 55.9 | 1.18 | 0.67 | 366 | 102 749 | **0** |
| 通用 闸流 | 0.002 | 0.004 | 0.017 | 58.0 | 0.55 | 0 | 2.33 | 634 | **0** |
| **Δ（自然−闸流）** | **+0.023（12.5×）** | **+0.031（8.8×）** | **+0.060（4.5×）** | **−2.1** | +0.63 | +0.67 | +364 | +102 114 | **0** |

**读法**：关掉事件流后，「模型」标签的成本**跌到地板**（Script 0.001 ms/s、Recalc 0.004 ms/s、LongTask 0、帧率 59.8 = 本机可达到的上限），说明**模型标签的停留期成本几乎 100% 是"事件投递驱动的"**，不是内容自带的。同时**面板 fiber 渲染在两种条件下都是 0** —— 也就是说这笔成本**不是模型面板产生的**。

### 5.3 逐项差：模型 vs 通用（同条件）

| 条件 | Script Δ | Recalc Δ | Task Δ | Layout Δ | fps Δ | p50 Δ | p95 Δ | p99 Δ | >50ms Δ | LongTask Δ | DOM 节点 Δ | commits Δ | 每次 commit 全应用 fiber Δ | **面板 fiber Δ** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 均为自然（紧邻窗） | +0.012 | +0.012 | +0.029 | 0 | −5.8（−10%） | 0 | 0(p95 中位) | +66.6 | +2.14 | +0.67 | −48 | +99 | −14.4 | **0** |
| 均为闸流（紧邻窗） | −0.001 | 0 | −0.003 | 0 | **+1.8** | 0 | 0 | 0 | −0.55 | 0 | −48 | −1.7 | +2.4 | **0** |

**读法**：闸流条件下（两标签都没有每事件工作量）**模型标签反而略快**（+1.8 fps），说明它没有任何"固有"劣势。自然条件下模型标签慢 10%，但那一组窗的**事件率是通用的 1.77 倍**（35.7 vs 20.2 /s）、**commit 与 fiber 工作量是 1.21 倍** —— 差值可由工作量解释，属于**已记录在案的 app 级每事件成本**在模型窗更重，而不是模型面板自身的问题。

### 5.4 相关性（12 窗，横截面）

| 关系 | Pearson r |
|---|---|
| fps ↔ 全应用 fiber/窗 | **−0.81** |
| fps ↔ commit 数/窗 | **−0.82** |
| fps ↔ session/event per s | −0.50 |
| fps ↔ load1（窗起点） | −0.40 |
| Script ms/s ↔ session/event per s | +0.33（模型子集 r=+0.96；通用子集 r=+0.82） |

**读法**：帧率最紧的相关量是**全应用渲染量**（fiber、commit），不是标签身份（模型与通用的面板 fiber 都是 0）。**这直接否定了"模型标签身份主导"的假设**——注意这与姐妹档 `tab-profile` 的横截面结论相反，原因是那边的窗间负载/事件率差异更大且未做配对（见 §6）。

> ⚠️ **严谨性边界（必须与上一段同读）**：`ownersAll` 的唯一标签是 `no-dom`（全 12 窗合计 682 448 次），意味着被计入的 fiber **没有可归属的宿主 DOM 节点**——它们是合成 fiber（`stateNode` 为 null 或 fiber 节点）。因此"全应用 266–281 fiber/commit"**只能证明"这些渲染不在设置面板子树内"**（与面板 fiber 恒 0、面板 DOM 零 mutation、面板文本长度恒定 144 三者互证），**不能进一步断言它们具体属于哪个区域**。要定位到具体归属需按 fiber 祖先链统计宿主节点，本档未做（属 `root-subscriptions` / `react-commit` 的射程）。

### 5.5 展开态复核（面板本地工作量被强制激活）

| 状态 | 对话框节点 | modelEntry | input | Script ms/s | fps | commits | **面板 fiber** | 全应用 fiber |
|---|---|---|---|---|---|---|---|---|
| 折叠（自然） | 120 | 0 | 0 | 0.008 | 58.8 | 36 | **0** | 9 888 |
| 折叠（闸流） | 120 | 0 | 0 | 0.002 | 60.0 | 0 | **0** | 0 |
| **opencode-go 展开**（自然） | **303** | **16** | **34** | 0.027 | 55.8 | 62 | **0** | 18 606 |
| **opencode-go 展开**（闸流） | 303 | 16 | 34 | 0.002 | 59.5 | 0 | **0** | 0 |
| 自定义添加卡（自然） | 146 | 0 | 4 | 0.010 | 58.8 | 68 | **0** | 18 539 |

展开态帧长分布（per-window，不取中位）：

| 状态 | fps | p50 | p95 | p99 | max | >50ms |
|---|---|---|---|---|---|---|
| 折叠·自然 | 58.8 | 16.7 | 16.8 | 16.8 | 316.7 | 3/1763 |
| 折叠·闸流 | 60.0 | 16.7 | 16.7 | 16.8 | 16.8 | 0/1800 |
| **展开·自然** | 55.8 | 16.7 | 16.8 | **50** | 216.7 | **15/1675（0.9/100）** |
| **展开·闸流** | 59.5 | 16.7 | 16.8 | 16.8 | 166.7 | **2/1784** |
| 自定义卡·自然 | 58.8 | 16.7 | 16.8 | 33.4 | 83.4 | 7/1763 |

**精确表述**：展开 provider 编辑卡后，**p95 与折叠态同为 16.8ms**（即主体帧没有变化），但**尾部分布变差**：p99 16.8 → 50ms、>50ms 帧 3/1763 → 15/1675、Script 0.008 → 0.027 ms/s；闸流条件下>50ms 帧回落到 2/1784。**⇒ 展开态存在一个小而可测的尾部开销（量级 <0.02 ms/s，占比 ≤0.05% 的墙钟时间）**，且面板 fiber 渲染仍为 0 说明它**不是"每次 commit 重渲染 16 行"造成的**（面板在 churn 下不重渲染），更可能来自展开瞬间的一次性 mounted 工作与后续 layout/style 面。样本 1 窗/条件，不足以给量级定值。
展开/折叠可逆：120 → 303 → 120；`settings.yaml` sha256 前后一致（`75718baaaddff265`）。

### 5.6 payload 形态（判据口径）

绕开页面直连 `ws://127.0.0.1:3080/api/events.mux` 采样 20s（`raw/ws-shape.json`）：

| 类型 | 帧数/20s | 平均字节 | 最大字节 |
|---|---|---|---|
| `session/projection` | 81 | **320**（固定 ~300–343） | 343 |
| `session/event` | 27 | **709** | 1434 |
| `session/subscribed` | 17 | 211 | 218 |
| `session/jobs` | 7 | 1370 | 2387 |
| `session/queue` | 6 | 1450 | 2918 |

`session/event` 的内层判别符：`tool/call`、`tool/result`、`assistant/message`、`step/start`、`step/end`。**注意**：本机 GUI 同时挂着 8 个会话（每个会话 1 条 `session/subscribed`），所以事件率是 8 个会话的合计。

---

## 6. 任务 3：hook 器械的三问

| 问题 | 答案 | 证据 |
|---|---|---|
| 模型标签每次 commit 重渲染多少 fiber？ | **面板子树 0 个**；同一 commit 内**全应用 266–281 个**（`flags & 1` 的 function/object 型 fiber） | 12 窗 `react.fibersPanelInWindow = 0`；`commitSample` 例：`{dur:0.2, panel:0, all:288}`、`{dur:0.3, panel:0, all:313}` |
| 其中多少来自模型行 map？ | **0**。折叠态模型行不渲染（`client.js:1984` 的 `open ? … : null`）；展开态（16 行）在自然窗内依然是 0——面板在 churn 下不重渲染，行级 map 根本没跑 | §5.5；`raw/verify2.json → runs[*].react.tagsPanel == {}` |
| 有多少 commit 是"内容没变"触发的？ | **闸流窗：0 次 commit**（12 窗中闸流组共 0.67+2.33+0.67+2.33 ≈ 6 次，全是 mount/连接类）。**自然窗：几乎全部是"模型面板内容没变"的 commit**——面板 fiber 0、DOM 变更 0（`mutations.text=0, child=0`）、面板文本长度恒为 144，而每窗 300–651 次 commit 仍在发生 | `raw/phase-main.json → runs[*].mutations`、`panelTextLen` 中位 144 |

> 关于"内容没变也重渲染"的**机制**（静态可证）：`Loaded` 的恒等选择器（1805）+ `createSnapshotStore.update` 用 `produce` 生成新对象（`dsh-client-runtime/lib/client.js:5418`）⇒ store 一旦 update，`useSyncExternalStoreWithSelector` 的 `Object.is` 必然不等 ⇒ 无条件重渲染。**但本次测量里这条路径未被触发**（无配置失效信号），所以它在本批窗中**零成本**；它是一颗"如果配置/凭证开始频繁失效就会引爆"的雷，不是当前的病灶。

---

## 7. 最小修复设计（按证据裁决）

### 7.1 先给结论：**模型标签本身不需要改**

- 模型面板在事件洪流下**重渲染 0 次**（12/12 窗），**行级 memo / 虚拟化 / 展开态惰性化都作用不到任何被观测到的成本**。给一个不重渲染的列表做 memo 不会改变任何一帧。
- 关掉事件流后模型标签**回到地板**（59.8 fps、Script 0.001 ms/s、0 LongTask）⇒ **无固有成本可省**。
- 同负载闸流条件下模型标签**比通用设置还快 1.8 fps** ⇒ 标签间不存在"模型更重"的结构性劣势。

**因此：把"模型标签最慢"当作模型包的性能缺陷来修，是修错对象。**（若采纳，收益 ≈ 0 ms/s；风险却不小，见 §7.3。）

### 7.2 真正被证据支持的最小修复：**收窄全应用级的"每事件重渲染"**

证据链：
1. 每窗 300–651 次 commit、每次 commit 渲染 266–281 个 fiber —— **全部在设置面板之外**（`ownersAll` 唯一的归属标签是 `no-dom`，因为它们是合成 fiber；面板 fiber 恒 0）。
2. 闸流把每秒 commit 从 ~7.8 打到 ~0.04，帧率从 50.1 回到 59.8。
3. 帧率与"fiber 渲染量/窗"的相关 −0.81、与 commit 数 −0.82，远强于与标签身份的关系。

**改动形状（最小、可回滚、只读安全）**：
- **目标**：让"收到 session 事件"不再驱动与事件无关的子树重渲染。
- **入口**：`dsh-client-ui-renderer/lib/client.js:154 bindSnapshotSelector` + 使用侧的**选择器收窄**（把 `useProjection("k")` / `useSession(sel)` 的默认恒等选择器换成窄选择器），以及 `dsh-client-ui-settings-models/lib/client.js:1805` 的 `useSnapshot((snapshot) => snapshot)`。
- **验证期待**：`fibersPerCommitAll`（当前 266–281）应显著下降；fps 在自然窗下向闸流窗的 59.8 靠拢。
- **注意**：这条链路**不在本档工作区内**，且姐妹档（`react-commit`、`root-subscriptions`、`measure-hardening`）已经在做。本档**不重复实现**，只提供"模型标签不是病灶"的排除性证据，避免修复资源投错包。

### 7.3 若仍要动模型包（防御性、非性能）：**唯一**有机制依据的一处

- **位置**：`client.js:1805` `const state = injected.useSnapshot((snapshot) => snapshot);`
- **改动形状**：`useSnapshot(sel, eq)` 本身支持选择器与等价函数（`bindSnapshotSelector` 透传 `useSyncExternalStoreWithSelector`）。最小改法是把恒等选择器换成"只取本页真正渲染的字段"的选择器 + `shallowEqual`，或在 `store.update`（`dsh-client-runtime/lib/client.js:5418`）里**当 mutator 没有实际改变任何字段时复用上一快照对象**（这样 `Object.is` 成立、订阅者不重渲染）。
- **预期收益**：**在当前可观测工况下 ≈ 0 ms/s**（因为没有配置失效信号）。收益只在"配置/凭证频繁失效"时出现，属**未测到的情形**，不得当作本次卡顿的修复卖点。
- **回归风险**（必须覆盖）：
  - 模型列表编辑：`ModelListEditor` 的 `expanded`/`editing` 是本地 state（760/761），不受该选择器影响；但 `ProviderEditor` 的 `draft`（1395）来自 `namespace`，**若把 `namespace` 从选择器里裁掉，编辑态会显示陈旧 draft** → 选择器必须保留 `state.namespaces`。
  - provider 增删：依赖 `state.rows` 与 `state.writable` → 选择器必须保留。
  - locale 切换：文案来自 `ctx.locale.bind(NS)`（`client.js:2743`），走的是独立 locale 服务，不经本 store；但 `Loaded` 若被 memo 住而 locale 变化不触发重渲染，**会出现文案不跟随语言切换** → 若引入 `memo`，必须把 `t` 纳入比较或让 locale 变化走一次强制更新。
  - 只读/可写态：`state.writable` 影响多个 `disabled`（1922/1975/2031…）→ 必须保留。
- **不建议**：行级 `memo`、列表虚拟化。前者收益 0（不重渲染）；后者会改 DOM 结构，回归面（36 个 input 的可访问名、`aria-label` 里的行号 `${index+1}`、删除后的行号重排 `reindexOnRemove`（771））远大于收益。

---

## 8. 逐条 PASS / FAIL / INCONCLUSIVE

| # | 任务项 | 判定 | 证据 / 说明 |
|---|---|---|---|
| 1a | 列出 provider 行结构 | **PASS** | `client.js:1909`、行内元素 9–11 个/行 |
| 1b | 列出模型行 map | **PASS** | `client.js:896`（pi-ai）、`372`（DeepSeek）、10 个元素/行 |
| 1c | 每行创建的元素数 | **PASS** | §4.1（静态计数）+ 实测 `modelEntry=16 / input=34 / svg=43` |
| 1d | 是否有 memo | **PASS** | **0 处 `react.memo`**；`useMemo` 仅 3 处（1402/1403/1412，`ProviderEditor`） |
| 1e | 是否有虚拟化 | **PASS** | 无；两处均裸 `.map()`（1909/896/372） |
| 1f | 展开/折叠与编辑态差异 | **PASS** | 折叠时模型行 map 不执行；展开 120→303 节点、modelEntry 0→16；展开触发一次 `credentials.describe`（1417–1427） |
| 2a | 同一标签内低/高事件率各 ≥3×60s | **FAIL（设计受限，已明示）** | 无法人为制造事件率；本档改做"**投递 vs 闸流（0/s）**"因果对照，每条件 3×60s。**事件率不是本档的自变量** |
| 2b | 记录每窗 session/event、projection 速率 | **PASS** | §5.1 表；`raw/phase-main.json → runs[*].ws` |
| 2c | 记录并发浏览器实例数 | **PASS** | 每窗边界采样：窗口起始并发浏览器 **4–6**（含我 1 个）→ 兄弟线 3–5 个；`load1` 11.9–27.4 |
| 2d | 裁决"固有内容渲染 vs churn 放大"及各自 ms/s | **PASS** | 固有 **≈0 ms/s**（闸流窗 Script 0.001、Recalc 0.004、0 LongTask、59.8 fps）；churn 归因 **Script +0.036 / Recalc +0.043 / Task +0.092 ms/s、fps −9.7** |
| 2e | 与「通用设置」同条件逐项差 | **PASS** | §5.3 全表（Script/Task/Recalc/Layout delta、p50/p95/p99、>50ms、LongTask、DOM 节点、commit 数、每次 commit fiber 数） |
| 3a | 每次 commit 重渲染多少 fiber | **PASS** | 面板 **0**；全应用 **266–281**/commit |
| 3b | 多少来自模型行 map | **PASS** | **0**（折叠与展开态均为 0） |
| 3c | 多少 commit 是"内容没变"触发的 | **PASS** | 自然窗内全部（面板 fiber 0、DOM mutation 0、面板文本恒定 144）而 commit 300–651/窗；闸流窗 ~0 次 commit。**机制**见 §6 注 |
| 4a | 最小修复设计（选证据支持的那一个） | **PASS** | §7：**模型包不需要改**；真正的修复对象是全应用每事件重渲染（已在姐妹档）；模型包内唯一有机制依据的是 1805 的选择器 + store 快照引用复用，**本次收益 ≈0** |
| 4b | 精确文件/函数/改动形状 | **PASS** | §7.2 / §7.3（含行号） |
| 4c | 预期收益量级 | **PASS** | 模型包改动：**≈0 ms/s（当前工况）**；全应用订阅收窄：目标是把 `fibersPerCommitAll` 从 266–281 降下来，fps 向 59.8 靠拢 |
| 4d | 回归风险（编辑/provider 增删/locale） | **PASS** | §7.3 逐项覆盖；并指出若做行级 memo/虚拟化反而引入回归面 |
| 5 | "模型标签最慢"这一原始观察 | **INCONCLUSIVE** | 我**无法复现**模型标签稳定复现的重灾：闸流条件下模型比通用快 1.8 fps；自然条件下慢 10%，但事件率是通用的 1.77 倍。校准轮里**同一模型标签**在负载 34 时 7.9 fps、负载 24 时 60.0 fps。⇒ 原始 13.2 fps 更可能来自**并发负载 + 该窗事件率**，而非标签身份。**但**我不能排除"更高并发负载下模型标签有额外的放大器"——本档没有把负载作为自变量（做不到，也不该做） |
| 6 | 纪律：未点保存/应用/删除、单浏览器、未 pkill、结束关浏览器 | **PASS** | `settings.yaml` sha 前后一致；`browser.close()` 在 finally；全程未执行任何 kill（兄弟浏览器 PID 已记录于 §3.3） |

---

## 9. 与姐妹档结论的关系（必须并列读）

- `tab-profile` 的结论"模型标签唯一稳定复现的重灾"，其数据中该标签窗恰好落在高负载/高事件率时段（`tab-profile/audit.md` §3 自述：采集期 3 个 Chromium 实例、基线事件率相差 80 倍、其自算相关性显示事件率**不**预测成本）。**本档的配对设计把"事件投递/不投递"变成自变量后，模型标签的劣势消失。**
- `react-commit` 的结论"设置子树每次 commit 重渲染 39.7 个 fiber"与本档不冲突：本档把它**定位**为**面板之外**的渲染（模型/通用面板 fiber 均为 0），即"设置子树"的渲染量来自 slot/框架层与其它面板，而非模型面板本身。
- **建议**：把本档作为**排除性证据**，避免把修复资源投到 `dsh-client-ui-settings-models`；真正的靶点在渲染器/订阅层（姐妹档 `root-subscriptions`、`react-commit` 的射程内）。

## 10. 未测到 / 不能宣称的

1. **高负载下模型标签是否有独立放大器**（本档未把负载当自变量；校准轮只给了 2 个点的观察）。
2. **展开态的成本量级**：只有 1 个窗/条件，只能"未观察到变化"，不能宣称"零成本"。
3. **`useSyncExternalStore` 恒等选择器的真实代价**：机制上存在，但本次工况下 0 次触发，故未测到。
4. **绝对 ms/s 与 fps 不可外推**：全部在并发负载（4–6 个浏览器、load1 12–27）下采集，**不得当作基线**。
5. 本档未进行任何人为负载注入，也未采过 CPU profile（属诊断性侵入手段，本档不含）。
