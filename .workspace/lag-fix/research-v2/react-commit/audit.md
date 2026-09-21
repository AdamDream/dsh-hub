# 设置子树 React commit 实测：R1「无 memo ⇒ 每事件重渲染设置页」裁决

- 审计日期：2026-09-21
- 输出目录：`.workspace/lag-fix/research-v2/react-commit/`
- 原始 JSON：`raw/FINAL.json`（汇总）、`raw/measure-main.json`（8×60s 主窗口）、`raw/ab-nocdp.json`（4×60s 状态依赖实验）、`raw/debug-plain.json`（12s 辅助切片）、`raw/recon.json`（前提自证侦察）、`raw/commitlog-main.json`（逐 commit 日志）、`raw/wsraw-main.json`（WS 帧原始样本）
- 纪律：未点击保存/应用/删除/模型切换/usage 手动刷新；只用「开关设置面板、切换设置导航标签、CDP 断网做安静态对照」这三类本地/可逆操作；单浏览器实例；结束已关闭浏览器。
- 原始 JSON 追加：`raw/measure-locked.json`（B 批，持锁窗口）、`raw/lock-report.json`（锁证据）、`raw/lock-owner.txt`（owner.txt 归档）

---

## 锁状态与数据可信度（必读，先于裁决）

跨线测量纪律要求：**启动任何浏览器之前**用 `mkdir .workspace/lag-fix/research-v2/.probe.lock` 原子取得独占锁，跑完 `rmdir` 释放，`owner.txt` 记录 agent/PID/开始时间。本报告的三批浏览器数据（A/B/H）**都不满足"独占"这一前提**，按纪律**均标 INCONCLUSIVE**。

### 锁时间线（我方）

| 项 | 值 |
|---|---|
| 锁路径 | `.workspace/lag-fix/research-v2/.probe.lock`（原子 `mkdir`） |
| 首次尝试 | 15:17:03 检查 → **锁不存在（free）** |
| 取得 | **15:17:26**（epoch 1789975046），一次 `mkdir` 成功 |
| **是否发生抢占** | **否** —— 锁本来就不存在，不需要按"owner 开始时间 >25 分钟且进程已消失"的规则抢占 |
| `owner.txt` | 已写入并在释放前归档到 `raw/lock-owner.txt` |
| 释放 | **15:44:41**（`rm owner.txt && rmdir`；注意 `rmdir` 要求目录为空，必须先删 `owner.txt`） |
| 持锁总时长 | **1635 秒（27 分 15 秒）** |
| 我方浏览器实例 | 1 个，15:30:16 起，5 个窗口跑完后关闭；**无遗留浏览器进程**（释放后按进程树逐条核对） |

### 我在启动浏览器之前做了什么

取得锁后并未立即启动浏览器：先发现两条**在我取得锁之前就已在进行中**的 peer 浏览器线（`tab-profile` 的 `lib/tab-profile.mjs`，browser PID 1740805，14:55:09 起；`measure-hardening` 的 `probes/harden-measure.mjs`，15:12:43 起），于是**等待约 10 分钟**让它们自然结束。它们结束后，立刻被**其他线**的浏览器取代，且在我整个采样期间持续不断。

### 锁被违反的实测证据（我方持锁期间）

我方 5 个窗口**全部** `lock=true`（锁一直在），但每个窗口的宿主进程普查都发现 **18–31 个外来 Playwright 浏览器进程**，来自 **7 条不同的并行调研线**：

| 并发线（owner 脚本） | 说明 |
|---|---|
| `cpu-profile/scripts/capture3.mjs` | `--scenarios all --reps 4 --win 12000 --stamp cpu2` |
| `cpu-profile/scripts/capture4.mjs` | `--scenarios all --reps 4 --win 12000 --stamp cpu3` |
| `measure-hardening/probes/harden-measure.mjs` | `--label run6-same-probe` |
| `lib/probe.mjs` | `--window=60000 --settle=8000 --cycles=3 --tag=main` |
| **`measure-slot.mjs`** | **`--tag main --window 60000 --nolockwait`** ← **显式绕过锁的 flag** |
| `scripts/probe-theme-apply2.mjs` / `probe-theme-apply3.mjs` | — |
| `scripts/probe-hooks.mjs`、`scripts/probe-threads.mjs`、`/tmp/probe2.mjs` | — |

逐窗口外来浏览器数（窗口起/止）：L1 **18/24**、L2 **24/18**、L3 **18/19**、L4 **24/24**、L5 **30/31**。**达成独占的窗口数：0/5。**

我在 harness 内加了"窗口开始前轮询直到无外来浏览器"的 idle 门（预算 90s/窗口），5 个窗口**全部未能达成**（`idleGateReached=false`），说明这不是偶发竞争，而是**持续性的锁不遵守**。

> 我无法强制互斥：不能去杀别的线的进程。因此**只能如实记录并降级**，而不是把受污染的数据当作独占结果。


### 第二次持锁尝试（比值批次，协调者点名要求的三项）

**取得与释放**：16:00:54 重试后取得（首次尝试时锁被 `measure-hardening` 持有，其 owner 进程 **存活**、锁龄仅 48s ⇒ **不可抢占**；按纪律每 30s 重试，等待 5.5 分钟后取得）；**16:12:45 释放**（`rm owner.txt && rmdir`，已核验目录消失）。本次同样**未发生抢占**。释放后无我方遗留浏览器进程。

> **协调者要求 ①：每窗口并发浏览器实例数与宿主 PID**

| 窗口 | 宿主 PID | `pgrep -c -f headless_shell`（idle 门最后一次采样） | 外来浏览器实例（起/止） | 独占? |
|---|---|---|---|---|
| H1 开/模型 | 1390375 | **9** | **3 → 8** | ✗ |
| H2 开/通用 | 1390375 | **15** | **8 → 7** | ✗ |
| H3 关/活跃 | 1390375 | **15** | **8 → 8** | ✗ |
| H4 开/模型 | 1390375 | 15 → 3 | — | 崩溃 |

宿主 PID **1390375** 全程未变（未重启）。**独占窗口 0/4** ⇒ 按纪律（协调者 ①）**本批 INCONCLUSIVE**。并发方（该批实测）：`cpu-profile/scripts/capture6.mjs`、`/tmp/probe-elem.mjs`、`/tmp/probe-uses2.mjs`、`measure-hardening/probes/harden-measure.mjs` 等。

H4 因**浏览器被外部关闭**（`Target page, context or browser has been closed`）而崩溃，脚本未写出 `raw/measure-ratio.json`；H1–H3 由日志抢救至 `raw/measure-ratio-salvaged.json`（含 provenance 说明）。

> **协调者要求 ②：关键比值（面板渲染/commit、子树渲染/commit、关闭与断流归零）——跨全部批次汇总**

| 批次·窗口 | 状态 | commit | **面板渲染/commit** | 子树渲染/commit | **面板渲染/session 帧** | 并发条件 |
|---|---|---|---|---|---|---|
| A-W1 | 开/通用 | 1238 | **1.000** | 49.0 | 0.426 | 有 peer 浏览器 |
| A-W2 | 开/模型 | 929 | **1.000** | 30.0 | 0.097 | 同上 |
| A-W3 | **关**/活跃 | 923 | **0** | 0 | **0** | 同上 |
| A-W4 | 开/通用 | 732 | **1.000** | 54.5 | 0.106 | 同上 |
| A-W5 | 开/模型 | 943 | **1.000** | 30.0 | 0.566 | 同上 |
| A-W6 / W7 | **断流** | **0** | n/a | 0 | n/a | 同上 |
| A-W8 | 开/模型 | 425 | **1.000** | 30.0 | 0.036 | 同上 |
| B-L1 | 开/通用 | 616 | **1.000** | **62.0** | 0.105 | 18–24 外来 |
| B-L2 | 开/模型 | 658 | **1.000** | 26.5 | 0.129 | 24–18 外来 |
| B-L3 | **关**/活跃 | 330 | **0** | 0 | **0** | 18–19 外来 |
| B-L4 / L5 | **断流** | **0** | n/a | 0 | n/a | 24–31 外来 |
| H1 | 开/模型 | 755 | **1.000** | （未在日志行内） | 0.078 | 3–8 外来, pgrep 9–15 |
| **H2** | 开/**通用** | 443 | **0** | （同上） | **0** | 7–8 外来 |
| H3 | **关**/活跃 | 662 | **0** | 0 | **0** | 8 外来 |

**跨 3 批 13 个窗口的结构结论全部一致**：设置打开 → 面板渲染/commit = **1.000**（A 批 5/5、B 批 2/2、H 批 1/1）；**设置关闭 → 0**；**断流 → commit 0**；子树渲染/commit 落在 **26.5–62**。**H2 复现了"通用设置约 0"的反例状态**（A4、debug 切片亦同）⇒ 面板根重渲染确为**状态相关**。

> **协调者要求 ③：hook 方案可行性与备选**

**hook 方案可行，本项不需要 CPU profile 备选。** 依据：前提自证 PASS（`inject` ×1，`version:"18.3.1"`/`react-dom`；`onCommitFiberRoot` 累计 **6013 + 4293 + 数千** 次真实回调），且已从 shipped bundle 反证注入契约源码。**本文所有裁决均出自实测计数**（fiber 级 PerformedWork/身份双信号 + WS payload 类型计数 + DOM 面板节点数）；**"无 memo"代码推定在 §6 被明确判 FAIL 并作为反面教材**，未用于支撑任何结论。

> **协调者要求 ③b：需要哪一次独占测量才能定论**

已确认结论**不需要**独占测量即可成立的部分：面板渲染/commit、子树渲染/commit、关闭归零、断流归零、payload 类型分布（比值与结构性事实，跨 3 批不同竞争强度复现）。

**仍需一次独占测量才能定论的，只有以下三项（按优先级）**：

1. **绝对速率基线（最重要）**：`commit/s`、`session 帧/s`、`面板渲染/s`、以及**每 session 帧的 commit 数**的**可外推数值**。当前 0.036–0.566 的跨窗口离散度中，有多少来自竞争、多少来自事件流本身的突发性，**无法区分**。规格：**同一页面、连续 ≥6×60s、外来浏览器实例全程 = 0（`pgrep -c -f headless_shell` 仅含我方）、设置打开/关闭各半**，并同时记录 `session/event` 与 `session/projection` 分项速率。
2. **"通用设置 0 渲染"与"模型 1.000 渲染"的状态边界**：需要在**独占**下重复 general↔models 可逆切换（≥3 轮 ×60s），以排除该差异是竞争时序伪影。规格：同一页面顺序 `git 通用→模型→通用→模型`，每段 60s，全段外来实例 = 0。
3. **单次 session 事件 → 面板 commit 的因果配准**（而非窗口级相关）：规格：独占下按窗口记录每个 commit 的时间戳与紧邻的 `session/event`/`session/projection` 帧时间戳，做**逐帧对齐**（当前工具已具备 `commitLog` 与 `wsFramesRaw`，仅缺独占环境）。这一项能回答"每个事件平均触发几次设置侧 commit"，本报告目前只能给窗口级比值。

### 两批数据的裁决

| 批次 | 窗口 | 全程持锁 | 是否发生过抢占 | 抢占记录 | 裁决 |
|---|---|---|---|---|---|
| **A 批**（`raw/measure-main.json` + `raw/ab-nocdp.json` + `raw/debug-plain.json`） | 8×60s + 4×60s + 4×12s | **否**（跑在锁协议生效之前） | 不适用（不存在锁） | — | **INCONCLUSIVE** |
| **B 批**（`raw/measure-locked.json`） | 5×60s | **是**（15:17:26–15:44:41 全程） | **否**（锁本来空闲，无抢占） | 无 | **INCONCLUSIVE** —— 持锁但宿主从未独占（0/5 窗口达成），锁未提供实际保护 |
| **H 批**（`raw/measure-ratio-salvaged.json`） | 3.5×60s（H4 崩溃） | **是**（16:00:54–16:12:45） | **否**（首次尝试锁被活着的 owner 持有，不可抢占；重试 5.5 分钟后取得） | 无 | **INCONCLUSIVE** —— 按协调者 ①，逐窗口并发浏览器实例 >1（3–8 个），独占 0/4 |

### 尽管标为 INCONCLUSIVE，哪些结论仍然可用（并已跨批次复现）

需要区分两类量：

- **不受 CPU 竞争影响的量**：帧计数比例（面板渲染/commit、子树渲染/commit、祖先链渲染/commit）、事件→commit 的**因果结构**（关面板→0、断流→0）、WS payload 类型分布、fiber 拓扑。这些在两批数据、两种不同竞争强度下**给出同一结论**，属于结构事实。
- **受 CPU 竞争影响的量**：绝对速率（commit/s、session 帧/s、每 session 帧的 commit 数）。**这些不得当作基线**（与主 agent"最终报告里把所有绝对性能数字标为'并发负载下、不可当基线'"的口径一致）。

B 批对 A 批的**独立复现**（不同竞争强度下）：

| 窗口 | 导航节 | commit | 面板渲染/commit | 子树渲染/commit | chain（idx0=SettingsRoot） | session 帧 |
|---|---|---|---|---|---|---|
| L1 活跃+开 | 通用设置 | 616 | **1.000** | **62.0**（62 个组件 fiber 全部） | 仅 idx0 = 616，idx1+ = 0（**自驱动**） | 5852 |
| L2 活跃+开 | 模型 | 658 | **1.000** | 26.5 | 仅 idx0 = 658，idx1+ = 0（自驱动） | 4096 |
| L3 活跃+**关** | — | 330 | **0** | 0 | — | 4098 |
| L4 安静+开 | 模型 | **0** | n/a | 0 | — | **0** |
| L5 安静+关 | — | **0** | n/a | 0 | — | **0** |

结论方向与 A 批完全一致：**设置打开时面板根每 commit 重渲染（1.000）、关闭后为 0、断流后 commit 为 0**；且 L1 出现了比 A 批更强的形态——**整个面板子树 62 个组件 fiber 每 commit 全部重渲染**。

---

## 0. 裁决摘要（先给结论）

| 命题 | 裁决 |
|---|---|
| **R1：设置子树在活跃会话事件流下会被放大器式重渲染** | **PASS（证实）** —— 设置打开时 SettingsPanel/SettingsRoot 与 React commit **1:1**，每 session 帧 **0.130** 次 commit；设置关闭后同一事件流下渲染 **0** 次；切断事件流后 commit **0** |
| **R1 的机制表述「无 memo ⇒ 每个 session 事件都重渲染设置页」** | **FAIL** —— 缺 memo 只是"允许"重渲染，不是"原因"；存在 60s 尺度可复现的反例状态：**0/191 commit** 重渲染，而事件流同样密集 |
| **执行前复核（selector 返回 boolean / bindSnapshotSelector / SessionMaybeProvider 稳定）** | **PASS 但不充分** —— 该推理**正确排除了 `useSessions` 选择器这条路**，但漏掉了实际点火的两条路径（见 §5） |
| **hook 前提自证（react-dom 确实调用该 hook）** | **PASS** |
| 设置面板装载判据（`div[role="dialog"][aria-modal="true"]` 节点数 > 0） | **PASS** —— 5 个"设置打开"窗口起止计数均为 **1**；3 个"设置关闭"窗口均为 **0**（见 §3 表） |
| ≥3 个 60 秒窗口、活跃态与安静态各一组、无效窗口全部保留 | **PASS**（A 批 8×60s + B 批 5×60s + 4×60s 状态实验；原始窗口与无效标记全部保留） |
| **跨线独占锁：窗口是否全程持锁** | **FAIL** —— A 批**未持锁**（跑在锁协议生效前）；B 批持锁 **1635s 全程**，但**宿主从未独占（0/5 窗口）**，锁被 **7 条并行线的 18–31 个外来浏览器**违反 |
| **期间是否发生抢占** | **否**（锁本来空闲，一次 `mkdir` 取得；无需按 `owner>25min 且进程已消失` 规则抢占） |
| **按纪律的数据裁决** | **A 批 INCONCLUSIVE（未持锁）**；**B 批 INCONCLUSIVE（持锁但宿主不独占）**；**H 批 INCONCLUSIVE（持锁但逐窗口并发实例 3–8 > 1）**。结构类/比值类结论跨 **3 批 13 窗口**复现仍可用；**绝对速率不得当基线** |

**一句话**：设置页在活跃事件流下**确实**被放大——但放大发生在**整棵设置子树**（每 commit 26.5–62 个组件 fiber），而**面板根自身的重渲染是状态相关的**，不是"无 memo"的必然结果。

> ⚠️ 前置限定（务必随结论一起引用）：三批浏览器数据（A/B/H）**均未在独占宿主下取得**，因此按纪律**标 INCONCLUSIVE**。可用的是**不受 CPU 竞争影响的结构性/比例性结论**（面板渲染/commit、子树渲染/commit、祖先链信号、关闭与断流的归零、payload 类型分布），它们已在两种不同竞争强度下独立复现；**不可用的是绝对速率**（commit/s、帧/s、每帧 commit 数）。

---

## 1. 前提自证：hook 在当前构建下确实被 react-dom 调用

任务要求先证明 `__REACT_DEVTOOLS_GLOBAL_HOOK__` 真的被调用，否则判 INCONCLUSIVE 并改用 CDP Profiler。**本项 PASS，备选方案不需要启用。**

实现方式：`page.addInitScript({ path: 'lib-init.js' })`，在 document-start 定义 hook（此时 `index-ClqxG24t.js` 尚未求值）。

事后从 shipped bundle 反证注入契约（`/assets/index-ClqxG24t.js`）：

```js
internals = { ... reconcilerVersion:"18.3.1-next-f1338f8080-20240426", getCurrentFiber:null }
if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u") {
  var ki = __REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!ki.isDisabled && ki.supportsFiber) try { rendererID = ki.inject(internals), injectedHook = ki } catch {}
}
// 每次 commit：
function onCommitRoot(root,...) {
  if (injectedHook && typeof injectedHook.onCommitFiberRoot == "function")
    try { injectedHook.onCommitFiberRoot(rendererID, root, void 0, (root.current.flags & 128) === 128) } catch {}
}
```

实测回调计数：

| 项 | 启动后 ~6s | 全程结束 |
|---|---|---|
| `inject` | 1 | 1 |
| `onCommitFiberRoot` | 164 | **6013** |
| `onPostCommitFiberRoot` | 142 | **5108** |
| `onCommitFiberUnmount` | 16 | 756 |

`inject` 上报 `version:"18.3.1"`、`rendererPackageName:"react-dom"`、`bundleType:0`。**commit 计数确实增长 ⇒ 前提自证 PASS。**

### 目标 fiber 的识别（不依赖 DOM class 名，靠结构）

设置面板 DOM 锚点唯一且稳定：`div[role="dialog"][aria-modal="true"]`（由 `SettingsPanel` 渲染，见 `dsh-client-ui-settings-general` 的 `SettingsPanel`）。从该 DOM 节点的 `__reactFiber$*` 属性向上走 `return`，实测得到：

```
host:div(dialog) → host:div(overlay) → SettingsPanel → SettingsRoot
   → RootEntry → SlotErrorBoundary → host:div → SlotOutlet → host:div → host:div → SidebarRoot → …
```

`SettingsPanel` / `SettingsRoot` 由结构位置（DOM 锚点上方第 1 / 第 2 个组件 fiber）确定，运行期 `type.name` 复核一致。**注意：SettingsRoot 的父链并不止于侧栏，而是穿过 `SlotOutlet`（索引 4）——这条链在第 5 节成为关键证据。**

### 两个独立的重渲染信号（互为交叉验证）

React 双缓冲使每个组件纤维在两个对象间交替，因此对任一目标同时持有 `{f, f.alternate}`，每次 commit 用「向上走到 root 比对 `root.current`」选出真正的 current 再判读：

- `id`（**主判据**）：`alternate === null || memoizedProps !== alternate.memoizedProps || memoizedState !== alternate.memoizedState`。对使用 hooks 的组件，渲染必然新建 hooks 链 ⇒ 该判据语义精确；bailout 时 `createWorkInProgress` 按引用拷贝 ⇒ 为假。
- `pw`（**保守佐证**）：`(flags & 1) === 1`，即 React DevTools `didFiberRender` 使用的 PerformedWork 位。

逐 commit 交叉验证（`raw/commitlog-main.json`，2814 个"面板存在"的 commit）：

| pw & id | 仅 pw | 仅 id | 两者皆否 |
|---|---|---|---|
| 1845 | **0** | 803 | 166 |

**`pw` 单独为真的次数为 0** ⇒ 两个信号从不互相矛盾；`pw` 是 `id` 的严格子集（在本构建中保守少报约 29%）。因此**以 `id` 为主判据**；若只看 `pw` 会**低估**放大器强度。所有裁决性对比在窗口粒度上两个信号方向一致。

---

## 2. 环境与输入记录

| 项 | 值 |
|---|---|
| 宿主进程 PID | **1390375**（`node /home/CNS2026495165/.npm-global/bin/dsh web`；ppid 1390374=`sh -c dsh web`，1390362=`npm exec @deepseek-ai/dsh web`）。窗口期间全程存活未重启（35 分钟后仍在） |
| URL | `http://127.0.0.1:3080` |
| 浏览器 | HeadlessChrome/131.0.6778.33，1440×900，单实例，结束已关闭 |
| Node | v22.23.2 |
| 未改配置/未重启/未写产品源码 | 是 |

### 下发 bundle rev/hash（运行期从页面 `__DSH_BOOT__` 读取，非文档抄录）

| 包 | rev |
|---|---|
| `__DSH_BOOT__.rev`（boot 清单） | `102e374d338e`（50 个条目） |
| `@deepseek-ai/dsh-client-runtime` | `a0fb4bb225d3` |
| `@deepseek-ai/dsh-client-ui-workspace` | `5596cec54007` |
| `@deepseek-ai/dsh-client-ui-settings-general` | `f733efde3f2f` |
| `@deepseek-ai/dsh-client-ui-renderer` | `79b59d365f3b` |
| `@local/dsh-usage` | `4536b91ed282` |

（同批还有 `dsh-client-ui-settings`=`5d1695c62b38`、`dsh-client-ui-settings-models`=`f12fb342db3b`、`dsh-client-connection`=`23a7e79f44f6`。）

### 当前会话规模 N

用**正确的 RPC 信封**实测（先验证过）：
`POST /api/session.list`，body `{"type":"client-request","rpcId":"<uuid>","method":"session.list","payload":{}}`，响应 `{"type":"server-response","rpcId":…,"result":{"ok":true,"value":{"items":[…]}}}`。

| 时刻 | items（总） | 顶层 | 子代理 | running | 带 projections |
|---|---|---|---|---|---|
| W1 起 | **297** | 104 | 193 | 13 | 297 |
| W3 起 | 297 | 104 | 193 | 13 | 297 |
| W5 起 | 297 | 104 | 193 | 12 | 297 |
| W7 起 | 297 | 104 | 193 | 11 | 297 |
| W8 起 | 297 | 104 | 193 | 11 | 297 |

**N ≈ 297（顶层 ≈ 102–104，子代理 ≈ 193–195）。** 每次窗口起止各采一次，全程稳定，未见会话增删导致的规模漂移（仅 running 数在 11–13 间变动）。

### WS 帧按 **payload 类型**计数（不是信封 type）

信封恒为 `server-request`，因此只按信封统计会得到"一种帧"的无用结论。按 `payload.type` 统计，"活跃流+设置打开"5 窗口合计：

| payload.type | 帧数 |
|---|---|
| `session/event` | 29292 |
| `session/projection` | 3615 |
| `session/queue` | 17 |
| `session/jobs` | 12 |
| `host/session-status` | 3 |
| `host/session-removed` | 2 |
| `question/requested` | 2 |
| **session/\* 合计** | **32907**（310 秒采样） |

实测 WebSocket 只有两个：`ws://127.0.0.1:3080/api/events.mux`（承载上表全部帧）与 `ws://127.0.0.1:3080/api/events.host`（全程 0–11 帧）。mux 在 6 秒内即推 196 帧 ⇒ 本机常年处于高事件流状态（同时有 11–13 个 running 会话，含本次审计自身与并行 peer）。

---

## 3. 主测量（A 批）：8 × 60 秒窗口（全部保留，含无效标记）

> ⚠️ **本批未持跨线锁**（跑在锁协议生效之前），按纪律整批标 **INCONCLUSIVE**。窗口期间有并发 peer 浏览器（见 §8.2）。下文的比例类结论已由 B 批（`raw/measure-locked.json`）独立复现；绝对速率不得当基线。

窗口定义：`active` = 页面自身 `/api/events.mux` 正常接收；`quiet` = **同一页面**用 CDP `Network.emulateNetworkConditions({offline:true})` 切断网络（可逆、不改产品状态），采样后恢复。

有效性门（**修正后**；原始 JSON 里 `invalidReasons` 保留的是修复前的门，修复点见 §9 末备注）：面板节点数>0、面板在整个"有 commit 的秒"内挂载、关闭窗口面板数=0、活跃窗口必须有 session 帧、安静窗口必须无 session 帧、窗口时长≥54s。

| 窗口 | 导航节 | 面板节点 | 采样秒 / 有commit秒 | commit | session 帧 | **面板根渲染/commit** | 子树渲染/commit | 全树渲染/commit | 面板渲染/帧 | 有效 |
|---|---|---|---|---|---|---|---|---|---|---|
| W1 活跃+开 | 通用设置 | 1→1 | 61 / 52 | 1238 | 2906 | **1.000** | 49.0 | 303.9 | 0.426 | ✔ |
| W2 活跃+开 | 模型 | 1→1 | 61 / 41 | 929 | 9591 | **1.000** | 30.0 | 268.0 | 0.097 | ✔ |
| W3 活跃+**关** | — | 0→0 | 60 / 45 | 923 | 9020 | **0**（面板不存在） | 0 | 235.1 | 0 | ✔ |
| W4 活跃+开 | 通用设置 | 1→1 | 66 / 43 | 732 | 6915 | **1.000** | 54.5 | 302.2 | 0.106 | ✔ |
| W5 活跃+开 | 模型 | 1→1 | 61 / 50 | 943 | 1667 | **1.000** | 30.0 | 269.0 | 0.566 | ✔ |
| W6 **安静**+开 | 模型 | 1→1 | 61 / 0 | **0** | **0** | n/a | 0 | n/a | n/a | ✔ |
| W7 **安静**+关 | — | 0→0 | 61 / 0 | **0** | **0** | n/a | 0 | n/a | n/a | ✔ |
| W8 活跃+开 | 模型 | 1→1 | 61 / 33 | 425 | 11828 | **1.000** | 30.0 | 267.3 | 0.036 | ✔ |

采样窗口起止（epoch ms / ISO）逐窗口记于 `raw/FINAL.json` 的 `windows[].startEpochMs/startIso/endEpochMs/endIso`（例：W1 = `2026-09-21T06:53:5x` 起，`elapsedMs:60816`）。

### 3.1 判据裁决（任务给定的两条互斥判据）

> 判据 A：**若 SettingsPanel/SettingsRoot commit 与 session/projection 事件同阶，且设置关闭后显著消失 ⇒ 证实放大器（给出每事件的 commit 数）**

**成立，判据 A 命中：**

- 活跃+开 5 窗口合计：**commit 4267，session 帧 32907，面板根渲染 4267**。
- **面板根渲染 / React commit = 1.000**（每个 commit 都重渲染面板根）。
- **面板根渲染 / session 帧 = 0.130**（≈ 每 7.7 个 session 帧 1 次）。
- **设置子树渲染 / commit = 39.7 个组件 fiber**（面板子树共 62 个组件 fiber ⇒ **每次 commit 重渲染其中 64%**）。
- **设置子树渲染 / session 帧 = 5.15 个组件 fiber**。
- **关闭对照**：W3 在 **9020 条 session 帧**下，SettingsPanel 渲染 **0** 次 —— 同一事件流、同一时段，"设置关闭后显著消失"成立。
- **安静对照**：W6/W7 断流后 commit = 0、渲染 = 0，说明 commit 由事件流驱动而非自循环。

> 判据 B：**若 commit 与事件流无关（例如只在该子树自身状态变化时 +1）⇒ 否决 R1**

**不成立**（commit 与事件流强相关：断流即归零、关面板即归零）。故**不否决 R1**。

### 3.2 但"每个 session 事件都重渲染"并非无条件——60 秒尺度的反例状态

见 §4。

---

## 4. 状态依赖性实验（4 × 60 秒，同一页面顺序走过 4 个状态）

同一条代码路径、同一事件流，只改设置面板状态：

| 状态 | 导航节 | commit | **面板根渲染/commit** | 祖先链渲染/commit（idx0=SettingsRoot,1=RootEntry,2=SlotErrorBoundary,3=host:div,4=SlotOutlet,5=host:div,6+=侧栏以上） | 子树渲染/commit | 重挂载探测器 |
|---|---|---|---|---|---|---|
| A1 首次打开→点击"通用设置" | 通用设置 | 493 | **1.000** | 0..5 **全为 1.000**，6+ ≈0 | 49.0 | altNull=0, DOM未替换, 目标集未增长 |
| A2 关→重开→点击"通用设置" | 通用设置 | 460 | **1.000** | 0..5 **全为 1.000** | 54.5 | 同上 |
| A3 点击"模型" | 模型 | 339 | **1.000** | **仅 idx0 = 1.000**，其余 0 | 30.0 | 同上 |
| A4 从"模型"切回"通用设置" | 通用设置 | 191 | **0.000** | **全为 0** | **44.5** | 同上 |

**A4 是 R1 机制表述的反例**：191 次 commit、事件流同样密集（`session/event` 185 + `session/projection` 153），**面板根一次都没重渲染**；**而子树仍然每 commit 渲染 44.5 个组件 fiber**。

> 链索引布局：idx0=SettingsRoot、idx1=RootEntry、idx2=SlotErrorBoundary、idx3=host:div、idx4=SlotOutlet、idx5=host:div、idx6/idx7=host:div、idx8=SidebarRoot、idx9=RootEntry…。其中 `host:div` 为宿主 fiber，结论只依据组件 fiber（见 §5 末注）。

重挂载探测器（`alternate===null`、对话框 DOM 对象被替换、目标集增长）全为 0 ⇒ A4 的 0 不是"取到了错误缓冲的旧 fiber"，是真实的不渲染。

12 秒辅助切片（`raw/debug-plain.json`，仅用于刻画状态，不计入 60s 窗口集）复现同一规律：

| 切片 | commit | 面板根渲染 | 子树渲染 | 说明 |
|---|---|---|---|---|
| 默认节（未点击） | 102 | **0** | 4386 | 首次打开但未点导航 |
| 点"模型" | 129 | 129 | 3815 | |
| 切回"通用设置" | 148 | **0** | 6586 | …与 A4 一致 |
| 再点"模型" | 167 | 167 | 5010 | 可逆 |

**结论**：面板根的"每 commit 重渲染"在 4 个状态里出现 3 个、消失 1 个，且**可正反切换**；而**设置子树的每 commit 重渲染在所有观测状态下都存在**（30–55 个 fiber/commit，8 个窗口 + 4 个实验 + 4 个切片无一例外）。

---

## 5. 机制：谁在点火（祖先链证据）

祖先链渲染统计把"面板根为什么重渲染"分成两类，**两类都在 8 个窗口里被实测到**：

**类型一 · 父驱动（`SlotOutlet` churn 向下传导）** —— 通用设置窗口 W1/W4、实验 A1/A2：

链上的**组件 fiber**：idx0 `SettingsRoot`、idx1 `RootEntry`、idx2 `SlotErrorBoundary`、idx4 `SlotOutlet` **全部 = 1.000 每 commit**；而 **idx8 `SidebarRoot` 及其以上 = 0**（实测 0.002）。⇒ **`SlotOutlet` 是这条链上最顶端"自己在重渲染"的组件**，它以上不再动手。

```
SidebarRoot(idx8, 不渲染)  ← 分界
  └ host:div(idx7..5) └ SlotOutlet(idx4, 每 commit 渲染)  ← 点火源（自身 useSyncExternalStore）
      └ host:div(3) └ SlotErrorBoundary(2) └ RootEntry(1) └ SettingsRoot(0) └ SettingsPanel
```

`SlotOutlet` 自身订阅槽版本：`useSyncExternalStore((fn) => host.subscribe(slotKey, fn), () => host.getVersion(slotKey))`；重渲染后 `renderOutletContent` 每次都为 outlet 内容新建 element（`guarded(entry, key)` → `jsx(RootEntry, …)`，无通用 memo 边界），于是整条链连同 `SettingsRoot`、`SettingsPanel` 一起被重渲染。**点火源在 SettingsRoot 之上的槽机制，不在 SettingsRoot 自身。**

**类型二 · 自驱动（SettingsRoot 自己的订阅结果变化）** —— 模型窗口 W2/W5/W8、实验 A3：

```
idx0 SettingsRoot = 1.000，idx1 RootEntry = 0，其余组件 fiber 全 = 0
```

`SettingsRoot` 的父组件（`RootEntry`）**没有**重渲染，说明是它自己的订阅（`useSections((s) => s)` / `useOnboardingSteps((s) => s)` / `useSessions(boolean)` 之一或其组合）在每次 commit 上给出"变了"的结果，从而自我触发。

> 注：祖先链里的 `host:div` 条目来自宿主 fiber，其 `memoizedProps` 身份信号不如组件 fiber 可靠（实测出现"SlotOutlet 渲染而它的 host 父节点也记为渲染"这种宿主侧假象）。因此**结论只建立在组件 fiber（tag 0/11/14/15）上**：类型一的分界是 idx4 `SlotOutlet`，类型二的分界是 idx0 `SettingsRoot`，两者都清晰可判。

**归因（面板子树内渲染最频繁的组件，按"渲染次数 / commit 数"归一）：**

W1（通用设置，1238 commit，子树共 62 个组件 fiber）：

| 组件 | 渲染次数 | 每 commit |
|---|---|---|
| `RootEntry` | 9285 | 7.5 |
| `SlotErrorBoundary` | 8047 | 6.5 |
| `F9` | 6190 | 5.0 |
| `SlotOutlet` | 4952 | 4.0 |
| `hs` | 4952 | 4.0 |
| `Vu` | 3095 | 2.5 |
| `Slider` | 1857 | 1.5 |
| `HeaderContent` `V7` `M7` `u7` `SettingsDocumentAction` `ps` `Ru` `CloseLabel` `PermissionRow` `rf` `$u` `AppearanceRow` `b7` `H7` `I7` | 各 1238 | **各 1.0（每 commit 恰一次）** |
| `GeneralSection` `AgentPresetRow` `PresetMenu` `LanguageRow` `EnterBehaviorRow` `WallpaperRow` | 各 619 | 各 0.5 |

W2（模型，929 commit，子树共 30 个组件 fiber）：

| 组件 | 渲染次数 | 每 commit |
|---|---|---|
| `F9` | 4645 | 5.0 |
| `SlotOutlet` `SlotErrorBoundary` `RootEntry` | 各 3716 | 各 4.0 |
| `Z9` | 1858 | 2.0 |
| `HeaderContent` `V7` `M7` `u7` `SettingsDocumentAction` `ps` `Ru` `CloseLabel` `ModelsSection` `Loaded` `$u` | 各 929 | **各 1.0（每 commit 恰一次）** |

即：**设置面板自有的页眉、关闭按钮、文档动作等 chrome 组件（每 commit 恰一次），加上当前节的容器与全部行组件，在每个 session 事件引发的 commit 上都会重新执行。**

---

## 6. 「无 memo 推定」错在哪

原审计（`reports/settings-jank-audit-client-render.md:13,46-48`）的推理是：
> `SettingsRoot` 订阅 sessions、直接创建普通 `SettingsPanel`，全文件无 `memo`；因而当 sessions snapshot 真正变化时，设置子树有结构性机会跟随重渲染。

实测表明这句话**作为机制命题不成立**：

1. **缺 memo 不是原因，只是"允许"。** React 不会因为缺少 memo 而重渲染一个组件；它只在**父组件重渲染并给出新 element**，或**该组件自身订阅的快照变化**时重渲染。A4 的 0/191 就是直接证据：事件流同样密集、面板同样挂载、无 memo 条件完全相同，面板根却一次都没渲染。
2. **真正的两条点火路径都不在"SettingsRoot 有没有 memo"上**：
   - 父驱动路径的点火源是 **SettingsRoot 之上的 `SlotOutlet`**（`dsh-client-ui-renderer` 的 `function SlotOutlet`：`useSyncExternalStore(() => host.subscribe(slotKey, fn), () => host.getVersion(slotKey))`），其 `renderOutletContent` 每次新建 element、无通用 memo 边界 —— 这条链即使给 SettingsPanel 加 `memo` 也挡不住（父传的新 `rows`/`renderSlot` 引用会变）。
   - 自驱动路径的点火源是 **SettingsRoot 自己的订阅结果**，与 memo 无关。
3. **执行前复核的推理本身是对的，但覆盖面不够。**「`useSessions` selector 返回 boolean 且 `useSyncExternalStoreWithSelector` 会按选择结果比较」这条分析是**正确的，并被实测支持**：一个 boolean 选择结果不可能每 commit 都翻转，因此它**不可能是本观测到的每 commit 重渲染的来源**——祖先链证据也印证了这一点，W1/W4 是**父驱动**（`SettingsRoot` 由上方 `SlotOutlet` 带下去，它自己的订阅根本没参与），A4 则完全不渲染。
   但复核**只检查了 sessions 这一条订阅**，没有检查 `SettingsRoot` 上另外两个订阅 `useSections((s) => s)`（返回整个 sections 行数组对象）与 `useOnboardingSteps((s) => s)`，也没有向上看 `SlotOutlet` 的槽版本 churn。而 W2/W5/W8/A3 的祖先链显示 **`SettingsRoot` 在父组件 `RootEntry` 未渲染的情况下自己渲染**（类型二）⇒ 点火源只能是它**自己的某个订阅**；既然 sessions boolean 已被排除，那就在 sections / onboarding 这两条上（`sections.getSnapshot` 以 `slots.getVersion("settings.section")` + locale revision 为记忆键，槽版本每次变都会给出新 `rows` 数组）。**本次未把这条链定位到具体槽版本，属未决项（见 §8.1）。**
   **结论：复核"不能由无 memo 直接推定"这一点是对的；但它据此"推翻 R1"的方向是错的**——它只排除了一条不存在的路径，而真实的两条路径都在它没看的地方。
4. **归因措辞建议**：把"SettingsRoot/SettingsPanel 无 memo 是放大器"改为"**`sidebar.settings` 槽的 `SlotOutlet` 每 commit churn + SettingsRoot 的 sections/onboarding 订阅，共同把设置整棵子树（每 commit 30–55 个组件 fiber）挂在会话事件流上；面板根是否也重渲染取决于当前槽/订阅状态**"。

---

## 7. 逐条 PASS / FAIL / INCONCLUSIVE

| # | 检查项 | 裁决 | 证据 |
|---|---|---|---|
| 1 | hook 在当前构建下确实被 react-dom 调用（前提自证） | **PASS** | `inject` ×1（`version:"18.3.1"`, `react-dom`），`onCommitFiberRoot` 164→**6013** |
| 2 | 宿主 PID 记录 | **PASS** | **1390375**，未重启、未改配置 |
| 3 | 下发 bundle rev/hash 记录（client-runtime / ui-workspace / settings-general / renderer / dsh-usage） | **PASS** | §2 表，运行期读 `__DSH_BOOT__` |
| 4 | 当前会话规模 N（正确 RPC 信封调 session.list） | **PASS** | items **297**，顶层 104，子代理 193 |
| 5 | WS 帧按 payload 类型计数 | **PASS** | §2 表；`session/event` 29292、`session/projection` 3615（信封恒为 `server-request`） |
| 6 | 采样窗口起止 | **PASS** | `FINAL.json` 每窗口 `startEpochMs/startIso/endEpochMs/endIso/elapsedMs` |
| 7 | 「页面确实装载了设置面板」判据（panel 节点数 > 0） | **PASS** | 所有 open 窗口起止 `div[role="dialog"][aria-modal="true"]` 计数 = 1；closed 窗口 = 0 |
| 8 | ≥3 个 60 秒窗口 | **PASS** | 8 个 60s 主窗口 + 4 个 60s 状态实验（另 4 个 12s 切片仅作辅助） |
| 9 | 活跃流与安静态各跑一组 | **PASS** | 活跃 W1–W5/W8；安静 W6/W7（CDP 断网，断流后 session 帧 = 0、commit = 0） |
| 10 | 无效窗口全部保留 | **PASS** | 8 个窗口全部在 `FINAL.json`；修复前的门给出的 `invalidReasons` 原样保留在 `harnessValidityNotes`，修复后 8/8 有效 |
| 11 | **R1 判据 A：面板 commit 与 session/projection 同阶 + 关闭后显著消失 ⇒ 证实放大器** | **PASS（证实）** | 面板根渲染/commit = **1.000**；面板根渲染/session 帧 = **0.130**；子树渲染/commit = **39.7**；子树渲染/session 帧 = **5.15**；W3 关闭后 0/9020 帧 |
| 12 | **R1 原始机制表述「无 memo ⇒ 每个 session 事件都重渲染设置页」** | **FAIL** | A4：**0/191 commit**，事件流密集、面板挂载、无 memo 条件相同；重挂载探测器全 0 |
| 13 | 执行前复核「推翻 R1」 | **FAIL（方向错误）** | 复核正确排除了 sessions-selector 路径，但漏掉 `SlotOutlet` 槽 churn 与 `useSections((s)=>s)`；实测放大器在多数状态下真实存在 |
| 14 | 备选方案（CDP Profiler CPU 自时间） | **未启用（不需要）** | 前提自证 PASS，首选方案有效；任务规定的触发条件（hook 收不到回调）未出现 |
| 15 | 设置子树是否**无条件**每 commit 重渲染 | **PASS（成立）** | 12 个测量单元中，除面板关闭（W3）与断流（W6/W7）外，**9 个"打开态且有 commit"的单元子树渲染/commit 恒为 30–55**（W1 49.0、W2 30.0、W4 54.5、W5 30.0、W8 30.0、A1 49.0、A2 54.5、A3 30.0、A4 44.5），无一例外 |
| 16 | 面板根重渲染是否**无条件** | **FAIL（不成立）** | A4 = 0/191；另 3 个辅助切片中 2 个为 0 |
| 17 | 启动浏览器前取得独占锁（原子 mkdir） | **PASS** | 15:17:03 检查为 free；15:17:26 一次 `mkdir` 成功；`owner.txt` 写入并归档 |
| 18 | 跑完释放锁（rmdir） | **PASS** | 15:44:41 `rm owner.txt && rmdir` 成功，`.probe.lock` 已消失；持锁 1635s |
| 19 | 期间是否发生抢占 / 是否有遗留浏览器 | **PASS（无抢占）** | 锁为 free，未触发 `>25min` 抢占规则；释放后按进程树核对，**无我方遗留浏览器进程** |
| 20 | 是否曾"未能持锁就跑" | **FAIL（A 批如此）** | A 批（8×60s + 4×60s + 4×12s）跑在锁协议生效前，**未持锁** ⇒ 按纪律标 **INCONCLUSIVE** |
| 21 | 持锁窗口是否真独占 | **FAIL** | B 批 5 窗口 `lock=true` 但外来浏览器 18–31 个（7 条并行线），独占 **0/5**；含显式 `--nolockwait` 的线 ⇒ B 批 INCONCLUSIVE |
| 23 | 协调者①：逐窗口记录并发浏览器实例数 + 宿主 PID | **PASS** | H 批逐窗口记录 `pgrep -c -f headless_shell`（9/15/15）与外来实例数（3–8）；宿主 PID **1390375** 全程未变；B 批另有 census（18–31） |
| 24 | 协调者②：关键比值跨窗口可比 | **PASS** | 面板渲染/commit = 1.000（开）、0（关）；子树渲染/commit 26.5–62；断流 commit = 0；**跨 3 批 13 窗口一致** |
| 25 | 协调者③：hook 不可行时判 INCONCLUSIVE 并给 CPU profile 备选 | **PASS（前提成立，无需备选）** | hook **可行**：前提自证 PASS（`inject` ×1 / `onCommitFiberRoot` 6013+4293+ 次）；全部裁决出自实测计数；**"无 memo"推定已在 §6 判 FAIL，未用于支撑结论** |
| 22 | 结构类结论跨竞争强度复现 | **PASS** | A 批面板渲染/commit = 1.000（5/5 窗口），B 批 = 1.000（2/2 开面板窗口）；关闭/断流归零两批一致；子树渲染/commit A 批 30–54.5、B 批 26.5–62 |

---

## 8. 未决与风险（不得当作已证实）

1. **状态切换的确切条件未定位到代码行**。已实测的映照是：首次打开→点击"通用设置"= 有；打开后不点导航 = 无；"模型"→切回"通用设置" = 无；"模型" = 有。**猜测**（未验证）：与「已访问设置标签只隐藏不卸载」的累积、以及 `activeId` 状态路径有关，但本次没有拿到代码级因果链，不应写入结论。
2. **并发干扰（严重，且锁协议未能生效）**：A 批窗口期间有 peer 浏览器在跑；B 批我持锁全程却实测 **7 条并行线、18–31 个外来浏览器进程**，独占 **0/5**（含显式 `--nolockwait` 的线）；H 批二次持锁独占 **0/4**（并发 3–8）。我无法强制互斥（不能杀别线进程），故按纪律**三批（A/B/H）均标 INCONCLUSIVE**。所有对照（开/关、模型/通用、活跃/安静）都是**同一次运行内**的比较，因此**比例类与结构类**结论不受影响，且已在两种竞争强度下复现；但**绝对速率**（commit/s、session 帧/s、每帧 commit 数）**不得当作基线**。
3. **事件流强度异常高**：本机常年有 11–13 个 running 会话（含本次审计自身与并行 peer），`session/event` 峰值达 194 帧/秒。这**不代表**普通用户会话的负载，因此"每 session 帧 0.130 次 commit"是一个**高负载下的上界观测**，不能外推为常态。
4. **安静态用断网实现**：`Network.emulateNetworkConditions(offline)` 会让页面自身的连接层进入重连路径（会话恢复后 mux 重连，新 socket 出现）。安静窗口内实测 session 帧 = 0、commit = 0，因此"断流 ⇒ 无 commit"结论稳健；但断网期间连接层自身的状态变化未被单独隔离。
5. **`pw` 信号保守少报**：本构建下一次 commit 中 `pw` 有约 29% 的漏报（`id` 独有 803 次，`pw` 独有 0 次）。任何只用 `flags & 1` 的复核会低估放大强度。
6. **本次未测**：CPU 自时间（未启用 CDP Profiler，因为首选方案有效）、长任务/掉帧、内存、以及"进入插件页后 usage 同步 SQLite"这条独立冻结机制（不在本次任务范围）。

---

## 9. 复现方式

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/react-commit

# 前提自证 + 面板 fiber 链侦察（~40s）
node scripts/recon.mjs

# 主测量：8 × 60s 窗口（活跃/安静 × 开/关 × 通用/模型），~10min
node scripts/measure.mjs --window 60000 --tag main     # -> raw/measure-main.json

# 状态依赖性实验：4 × 60s，同一页面走过 4 个状态，~5min
node scripts/ab-diagnostic.mjs --slice=60000           # -> raw/ab-nocdp.json

# 12s 辅助切片（刻画状态，不计入 60s 窗口集）
node scripts/debug-target.mjs                          # -> raw/debug-plain.json

# B 批：持锁窗口（必须先取锁，见下）
mkdir /home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock   # 原子取锁，失败则 20-40s 重试
node scripts/measure.mjs --window 60000 --tag locked --plan lock --idle-budget 90000
rm /home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock/owner.txt && \
  rmdir /home/CNS2026495165/dsh/.workspace/lag-fix/research-v2/.probe.lock   # 释放（rmdir 要求空目录）

# 锁证据
node scripts/lock-report.mjs                           # -> raw/lock-report.json

# 汇总
node scripts/summarize.mjs main                        # -> raw/summary-main.txt
node scripts/consolidate.mjs                           # -> raw/FINAL.json
```

依赖：Playwright from `/home/CNS2026495165/playwright_scratch/node_modules`（`scripts/*.mjs` 用绝对路径 import）。

### 备注：修复前的有效性门缺陷（已修正，原始标记保留）

首轮主运行的 `invalidReasons` 里 5 个窗口带 `"panel not mounted for >10% of sampled seconds"`，**这是本 harness 的门缺陷，不是测量失败**：聚合时把"没有任何 commit、因此没有秒桶"的秒也计入 `panelSecs` 分母（事件流是突发式的，61 秒里只有 33–52 秒有 commit）。修正为 `panelSecs / activeSeconds` 后 **8/8 窗口有效**，且实测 `panelMountedSeconds == commitActiveSeconds`（例：W1 = 52/52、W2 = 41/41、W8 = 33/33）——即**面板在每一个有 commit 的秒里都处于挂载状态**。原始 JSON 的 `invalidReasons` 未删改，修正后的判定写入 `FINAL.json` 的 `valid`/`invalidReasons`，修复前标记保留在同文件的 `harnessValidityNotes`。
