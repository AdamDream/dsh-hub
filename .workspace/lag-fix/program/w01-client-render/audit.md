# w01-client-render 审计：DSH Web GUI 客户端渲染主干

- 线：`program/w01-client-render/`（独占）
- 审计日期：2026-09-22（本地 CST +08:00）
- 宿主：`http://127.0.0.1:3080`，PID **301709**（`node /home/CNS2026495165/.npm-global/bin/dsh web`，本轮**未重启、未 pkill、未改任何产品文件**）
- 授权：**本轮只读审计**（不改产品文件）+ **最多 2 个二级 subagent**（已用满 2 个：静态耦合档 / live 测量档）
- 范围：客户端渲染主干 ① React 渲染与 store 订阅的真实耦合 ② 8 个设置栏目**无 keep-alive** 的代价与修法 ③ 已撤回/已确证的周边**直接引用不重测** ④ 可测的 top-5 客户端成本项 + 最小修复候选
- 必读遵守：`exec-audit/BATCH-PLAN.md` §五（测量协议 20 条）、`incident2/VERDICT.md`（已确证/已撤回/未决）
- 原始产物：
  - `raw/served-vs-disk.json`（served 字节 == 磁盘字节自证）
  - `raw/referent-hashes.txt`（全部被引 bundle 的 sha256）
  - `raw/w01-static-own.json`（本线自测静态事实 + 不重测清单）
  - `raw/static-coupling.json` + `static-coupling.md`（二级静态档，F1–F6）
  - `raw/w01-*.json`、`raw/w01-run.log`、`raw/measurement-notes.md`（二级 live 档）
  - `raw/concurrency-census.json`（审计窗口期的并发普查）
  - `tools/probe-w01.mjs`、`tools/w01-init.js`（live 探针）

---

## 0. 判据口径与纪律（先声明，再报告）

| 项 | 本轮取值 |
|---|---|
| 主判据 | CDP **`RunTask`**（trace 类别**含** `disabled-by-default-devtools.timeline`）+ **LoAF `duration`** |
| 页内判据 | **wall-clock rAF 间隔**（回调入口 `performance.now()`，**不用 `ts` 参数**）+ **开窗前播种 ≥1 帧并保留块前那一帧** |
| 阳性对照 | **页内 `setTimeout` 注入 120 ms 忙循环**（**禁用** CDP `Runtime.evaluate` 注入作对照——LongTask 对其盲）；另有 `none` 阴性对照 |
| 相对 KPI | `>50ms` 帧计数**只作相对 KPI**，本器械分辨下界 ≈40–50 ms |
| 引擎/DPR | 记录 UA 读回的引擎与版本；**页内读回 `devicePixelRatio`** 并 canvas 自证；**未使用** `--force-device-scale-factor` |
| 并发口径 | cmdline 含 `--remote-debugging-pipe` **且不含** `--type=`，**排除自身**；**禁止** `pgrep -f`（自匹配） |
| 锁 | 只用 `lib/probe-lock.mjs`（存活判据 = `/proc/<pid>/stat` + cmdline；**读取失败一律 ALIVE**；**绝不回收未确证死亡的锁**） |
| 绝对值 | 本轮采集期**非独占**（见 §2.1）⇒ **一切绝对 ms/ms/s/fps/commit/s 标 INCONCLUSIVE**；只有**比值 / 为零 / 占比 / 计数**可作结论 |
| 禁止 | 后台标签页帧统计；以 `visibilityState==='visible'` 当"帧在产出"的证据；只取 `ts` 的"跨块那一对"；把 `>50ms` 帧计数当灵敏度判据；拿 MutationObserver 的 `mutation_count` 当 re-render 证据；挑选最佳窗口 |

---

## 1. 证据基线：served 字节 == 磁盘字节（本线自证，PASS）

**PASS**。用 `curl http://127.0.0.1:3080/plugins/<pkg>/client.js | sha256sum` 与磁盘 bundle 对比，4/4 抽样逐字节一致 ⇒ **本文所有 `file:line` 引用就是浏览器实际执行的字节**（热面口径）。

| 包 | HTTP | served sha256-12 | disk sha256-12 | 一致 |
|---|---|---|---|---|
| `@deepseek-ai/dsh-client-ui-settings-general` | 200 | `bd7edeaec382` | `bd7edeaec382` | ✅ |
| `@deepseek-ai/dsh-client-ui-renderer` | 200 | `4361ea099f70` | `4361ea099f70` | ✅ |
| `@deepseek-ai/dsh-client-runtime` | 200 | `357f17037224` | `357f17037224` | ✅ |
| `@deepseek-ai/dsh-client-ui-layout` | 200 | `84ce5dfebd46` | `84ce5dfebd46` | ✅ |

壳入口 `/assets/index-ClqxG24t.js`；`/plugins/@deepseek-ai/dsh-client-modules/client.js?rev=7eb526320903`。
证据文件：`raw/served-vs-disk.json`、`raw/referent-hashes.txt`。

**活体路径（live bundle 根）**：`~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/*`（核心包）
与 `~/.dsh/profiles/node_modules/{@local/*, @deepseek-ai/*, dsh-workspace-enhancement}`（profile 插件）。
⚠️ **只 grep 核心根会漏掉 4 个栏目注册者**（见 §4.1）——这是本轮静态档修正的一处关键陷阱。

---

## 2. 仪器与协议符合性

### 2.1 并发与锁（本轮实测，**如实记录**）

本审计的采集期**全程非独占**。按协议口径（cmdline 含 `--remote-debugging-pipe` 且不含 `--type=`，排除自身）实测：

| 时刻（CST） | 外来主浏览器实例 | foreign PID |
|---|---|---|
| 14:38:26 | **3** | 767232 768124 769023 |
| 14:38:31 | **3** | 767232 769023 769882 |
| 14:38:36 | **3** | 767232 769023 769882 |

`/proc/loadavg` = **7.07 5.42 3.84**。锁在采集期被**兄弟线依次持有**：`w04-plugin-load`（pid 757555，14:37:02）→ `w08-boot`（pid 767033，14:37:43）。
**本线未回收、未争抢、未删除任何外来锁**（遵守"绝不回收未确证死亡的锁"）。
证据：`raw/concurrency-census.json`、`raw/w01-run.log`。

⇒ **判定：本轮的绝对性能数字一律 INCONCLUSIVE**（与 `MEASUREMENT-STATUS.md` §1/§2 的历史处境同源）。
本报告只用**比值 / 为零 / 占比 / 计数**类结论；所有窗口（含 invalid/CONTENDED）**保留不剔除**。

### 2.2 通道自证（阳性/阴性对照）

见 §3.4 与 §4.4（live 档结果）。

---

## 3. ① React 渲染与 store 订阅的**真实耦合**

### 3.1 store 引擎：`produce` 的引用语义（**代码级 VERIFIED，含一处必须收紧的表述**）

`dsh-client-runtime/lib/client.js:5397` `createSnapshotStore(init, opts)`：

```js
getSnapshot: () => api.getState(),                                    // :5416
update: (mutator) => {                                                // :5418
  api.setState(produce(api.getState(), (draft) => { mutator(draft); }), true);   // :5419-5421
},
```

- **`update` 路径内部没有任何内容等值闸门**（该区域 grep `Object.is`/`isEqual`/`deepEqual`/`structural` 零命中；唯一的 `shallowEqual` 在 `:5363`，是 selector 切片helper，**从不被 update 调用**）。
- ⚠️ **必须收紧的表述（静态档修正）**：`produce` **不是无条件**产新引用——真正的闸门在 zustand 自己的 `setState`：
  `dsh-client-runtime/lib/client.js:4745-4747` `if (!Object.is(nextState, state)) { … listeners.forEach(…) }`。
  immer 的结构共享使**"mutator 一个字段都没写"** ⇒ 返回同一引用 ⇒ `Object.is` 为真 ⇒ **不通知、不重渲染**。
  ⇒ 正确命题是：**"任何至少写入一个 draft 字段的 store action 都会产生新的根引用 ⇒ 每个订阅者都收到通知"**；
  "produce 恒新引用"若不加这个限定就是**过度主张**（本轮不采用）。
- `flush: "raf"` 分支（`:5402-5415`）在本构建中是**死代码**：全部 `createSnapshotStore` 调用点（`:5477` `defineStore`、`:8954` selection、`:8963` list、`:9921`）**均只传 `{persist}`**，无一处传 `flush`（全库 grep `flush:` 零命中）⇒ **零个 store 走 rAF 合批**。

**判据：PASS（代码级机制成立，表述已收紧）。其对 fiber 的后果见 §3.3。**

### 3.2 谁订阅什么（消费者侧）

- 渲染器 `dsh-client-ui-renderer/lib/client.js:154-159` `bindSnapshotSelector` → `useSyncExternalStoreWithSelector(..., sel, eq)`，**`eq` 被原样转发**；**未提供 `eq` 时退回对"裸快照"的 `Object.is`（`:107/:116`），不存在默认可浅比较**（静态档 F4）。
- **全 roster 只有 2 处传了自定义相等函数**：`CV:7490`、`WS:314`。
- 渲染器 `:743` `SlotOutlet` 用 `useSyncExternalStore((fn) => host.subscribe(slotKey, fn), () => host.getVersion(slotKey))` 订阅**整个槽版本**，另 `:744` 订阅 locale revision ⇒ **该槽任何注册/注销/崩溃退休都会让 outlet 重渲染**。

**恒等选择器订阅者（静态档 F4 全表 30 个调用点中筛出，本线逐条复核 `file:line`）**：

| 订阅者 | `file:line` | slice | 后果（口径见 §3.1） |
|---|---|---|---|
| ★ **`AppFrame`** | `dsh-client-ui-layout/lib/client.js:159` `const panels = useStore((s) => s);` | 布局三栏 store | **本 roster 里最有后果的一行**：该 store 任何一次"至少写一个字段"的更新 ⇒ `AppFrame` 重渲染 ⇒ 它渲染 `renderSlot("sidebar")`/`"conversation"`/`"details"`/`"shell.overlay"`（`LY:228/233/237`）⇒ **整棵三栏子树重算**；设置面板开着时也一并被带下来（§3.3 的 memo 缺口） |
| `SessionMaybeProvider` / `SessionProvider` | `dsh-client-ui-renderer/lib/client.js:246`、`:260` `observableHook(useHost().sessions.provideInfo)((s) => s)` | `sessions.provideInfo` | 每个 session 作用域子树重渲染 |
| `SettingsDocumentAction` | `dsh-client-ui-settings-general/lib/client.js:325` `useSnapshot((snapshot) => snapshot)` | 设置文档快照 | 整个 action 重渲染 |
| `Loaded`（模型面板主体） | `dsh-client-ui-settings-models/lib/client.js:1805` | `createSnapshotStore`（`SM:2386`） | 整个模型栏目主体重渲染；且 `load()` **一次写 store 3 次**（`SM:540/557/585`）⇒ **一次挂载引发 3 次整节重渲染** |
| `AgentPresetSection` | `dsh-client-ui-agent-preset/lib/client.js:1152` | agent-presets store | 整个栏目重渲染 |
| `DeepSeekOnboardingDialog` / `WelcomeNotice` | `dsh-client-ui-settings-models/lib/client.js:2207`、`:2290` | 各自 store | 弹窗/通知重渲染 |
| `ConfigurablePluginsTab` | `dsh-client-ui-settings-plugins/lib/client.js:399` | 可配置插件快照 | 整个 `插件配置` tab 重渲染 |

> ⚠️ **与 slot-churn 实测的"表面矛盾"必须写明**：slot-churn §2.2 在**设置 dwell 窗**里实测 `AppFrame` 渲染/commit = **0.000**，而本线把 `LY:159` 列为"最有后果的恒等选择器"。
> **两者不矛盾**：`AppFrame` 的渲染**由布局 store 的写入驱动**，而设置 dwell 窗内**没有布局 store 写入**（设置面板是 overlay，不改三栏布局）⇒ 实测 0 是正确的。
> ⇒ 正确表述是：**"`LY:159` 是条件性放大器——只要布局 store 被写（侧栏折叠/宽度/选中态变化等），整棵三栏 shell 就会被重渲染，且因为 §3.3 的 memo 缺口会把开着的设置面板一起带下来"**。本轮的 live M1 只覆盖 home-idle 与 settings-dwell 两类窗，**不足以**判定布局写入场景；该场景需另设"切换侧栏折叠/拖动分栏"的窗（**本线未做，列为未决**）。

**看似恒等选择器但实测安全的例外（**不再重测**）**：`SettingsRoot`（`SG:188/189`）与 `PluginsSettingsSection`（`SP:417`）—— 它们坐在**签名记忆键**的 `getSnapshot` 上。
`settings-general:496-509` 以 `(ctx.slots.getVersion("settings.section"), ctx.locale.getSnapshot().revision)` 为键、未变时**返回同一个 `rows` 数组**；`settings-general:521-531` 只以 version 为键。⇒ 全 roster **唯一**的记忆键快照。
实测侧引用：`root-subscriptions/audit.md` items 5/15/16 —— **6329 次渲染中输出引用变化 0 次**（本线在代码侧复核了其成因，未重测）。

### 3.3 `produce` 新引用 × 恒等选择器 × 缺 memo 边界 ⇒ 每 commit 整树重渲染（**已确证的历史证据 + 本轮结构复核**）

**已被三条独立线确证的事实（引用，不重测）**：

| 事实 | 证据 |
|---|---|
| 设置面板根 `SettingsPanel` / `SettingsRoot` **每 commit 渲染 1.000**，而其上方 `SidebarRoot`/`RootEntry`(侧栏)/`AppFrame` **0.000**，DOM 文本哈希变化 **0 / 9052 commit** | `research-v2/slot-churn/audit.md` §2.2（三次独立运行 1501/972/6138 commit，比值完全可复现） |
| 设置段 `RootEntry`/`SlotErrorBoundary`/`SlotOutlet` 渲染/commit = **0.706–0.833**（三者严格同步 ⇒ 同一次版本重投影） | 同上 |
| 历史"每事件重渲染"= **266–281 fiber/commit、7.8 commit/s**；`fps ↔ fiber/窗 r=−0.81` | `MEASUREMENT-STATUS.md` §3.1（**绝对值 INCONCLUSIVE**，相关性中等可信） |
| 设置子树渲染/commit：通用 **62.0**（62 fiber 全渲染）、模型 26.5；设置打开时面板根 渲染/commit = **1.000**（横跨 A/B/H 三批） | `MEASUREMENT-STATUS.md` §3.0 |
| `session.list` 落地瞬间触发 **38 次连发 commit × 每次重建 600 fiber（整树重渲染）** | `incident2/FINDINGS-SUMMARY.md`（元凶①；宿主侧比较器已由协调者修复落地） |

**本轮新增的结构性确证（无 memo 边界，静态档 F2/F5 实测计数）**：

| 事实 | `file:line` |
|---|---|
| `SettingsPanel` / `SettingsRoot` **均非 `react.memo`**，且每渲染新建对象/闭包：`{ close: onClose }`、`onSelect: setActiveId` | `dsh-client-ui-settings-general/lib/client.js:96`、`:176`、`:164`、`:217` |
| `RootEntry` 是**普通函数组件**；`SlotErrorBoundary` 是**普通 class** | `dsh-client-ui-renderer/lib/client.js:711`、`:518` |
| **设置打开路径的整条祖先链上 `react.memo` 计数 = 0**（renderer / settings-general / settings / layout / sidebar / runtime / settings-models / settings-plugins / settings-plugin-inventory / agent-preset / workspace-enhancement / ssh-gui / vision-adam / subagent-model **全部 0**） | 静态档 F5（模式 `react\.memo`） |
| ⚠️ **计数陷阱（采纳静态档更正）**：**朴素 grep `memo(` 对每个 bundle 都返回 0**，因为发射形态是 `(0, react.memo)(…)` ⇒ 任何用 `memo(` 得到的"无 memo 推定"都是**假阴性**。本报告一律用 `react\.memo` 模式计数 | 静态档 F5 |
| 对照：`conversation` 15 处、`tool` 2、`goal` 1、`trajectory` 1 ⇒ **会话路径有 memo 边界，设置路径完全没有** | 同上 |

⇒ **耦合结论（本线裁决）**：设置页的重渲染**不是**"某个 slice 变化驱动某个组件"的精细订阅关系，而是
**"任何一次 store 通知 / 槽版本 bump / locale revision ⇒ `SettingsRoot` 自更新 ⇒ 经无 memo 的 `SettingsRoot → SettingsPanel → renderSlot` 结构向下放大到整棵已挂载子树"**。
"设置打开 = 面板根 1.000 渲染/commit 而 DOM 文本零变化"是本条的决定性内证（9052 commit 样本）。

**判据：PASS（机制 + 结构 + 独立实测三重一致）。**
**未决**：`SettingsRoot` **自渲染的最终点火源未钉死**（`root-subscriptions/audit.md` item 10 判 INCONCLUSIVE：22 槽 hook 取值逐字节相同、父链静默、store 静默）；父驱动路径的点火源曾被指向 `SlotOutlet` 的 locale revision（该线 item 12，但该线与 locale 记忆键之间存在张力，`MEASUREMENT-STATUS.md` §6.0.bis.2 明确"不得把 locale revision 当作既定点火源"）。**本线不重新裁决，标记未决。**

### 3.4 live 复核（commit/fiber 按组件名普查）

**条件**：引擎 `HeadlessChrome/131.0.6778.33`（UA 读回，**headless** ⇒ 无 GPU 合成，绝对 ms 只对主线程 JS/布局成立）；
**页内读回 `devicePixelRatio = 1`**，且 canvas backing/CSS = **100/100 px**（**DPR 自证成立**，**未使用** `--force-device-scale-factor`）。
**全部窗口 `valid:false, reason:CONTENDED`**（锁被兄弟线轮流持有、每窗口外来主浏览器 2–4 个，`lockMine:false`）⇒ **本节的绝对值一律 INCONCLUSIVE，只保留计数与比值。**

#### 3.4.1 通道自证（**PASS，三通道 3/3**）

阳性对照为**页内 `setTimeout` 注入**（**未使用** CDP `Runtime.evaluate` 注入），忙循环实测 120.0–120.1 ms：

| rep | 注入实测 | **CDP `RunTask` max** | **LoAF `duration` max** | **wall-clock rAF 跨块间隔** |
|---|---|---|---|---|
| 1 | 120.1 ms | **120.49 ms**（`over40ms=1`） | **121 ms**（n=1） | **121.9 ms** |
| 2 | 120.0 ms | **120.18 ms** | **121 ms** | **121.2 ms** |
| 3 | 120.0 ms | **120.09 ms** | **121 ms** | **121.7 ms** |
| **阴性对照**（`none`，同 20 s，2 窗） | — | **0.75 / 2.70 ms**（`over40ms=0`） | **0**（无条目） | **17.4 / 17.7 ms** |

**窗口播种要求可见地满足**：rAF 序列实为 `[16.7, 121.9, 0.7, 10.9, 16.6, 16.6, …]`
—— **块前那一帧（16.7）被保留** ✓，块本身以 121.9 出现 ✓，随后 0.7 + 10.9 为追帧对 ✓。
`RunTask` 在每窗非空（11 088–12 133 条，`p95 = 0.12–0.23 ms`）⇒ **类别 `disabled-by-default-devtools.timeline` 写对，不存在"通道静默清空"**。
⇒ **本节所有依赖通道的结论都有同批通过的阳性对照支撑。**

#### 3.4.2 空闲态基线（**本线新增的关键阴性结果**）

| 场景 | commits / 20 s | fibers/commit pw | RunTask max | `over40ms` | rAF max | LoAF |
|---|---|---|---|---|---|---|
| `home-idle`（无活跃事件流） | **3** | 176 | **3.05 ms** | **0** | 18.9 ms | 0 |
| `settings-open-dwell`（设置面板开着、静置 20 s） | 2 / 238 / 339（三次） | 160–215 | **3.05 ms**（一次测得 20.3 ms 的切换被单列） | **0** | **33.6 / 38.8 ms** | 0 |
| `neg-none` | **0** | – | 0.75–2.70 ms | 0 | 17.4–17.7 ms | 0 |

⇒ **空闲（无活跃会话事件流）时，客户端渲染主干自身不产生任何长任务/长帧**：`RunTask max = 3.05 ms`、`over40ms = 0`、`rafMax ≤ 38.8 ms < 50 ms`。
**这条阴性证据与既有结论一致且互补**：客户端渲染主干的成本是**事件驱动 + `ThemePresenter.apply` 驱动**的，不是结构本身固有（也与既有 D4"点击设置本身廉价"、S6"打开/切换 0 例 >100 ms"同向）。

#### 3.4.2bis ★ 新发现：**「设置打开」不是一个状态**（同场景同长度窗口之间暴走 ~100×）

全部 `settings-open-dwell` 窗口长度相同（20 s），但 commit 数呈**双峰**：

| 窗口 | commits / 20 s | commits/s | RunTask sum | rAF max | 采集时机（探针记录） |
|---|---|---|---|---|---|
| A | **2** | 0.10 | 394 ms | 18.9 ms | 面板已开 **≈1 分钟** |
| B | **238** | 11.9 | 1809 ms | 33.6 ms | **刚打开面板**（该窗口 `lockMine=true`） |
| C | **339** | 16.9 | 1753 ms | 38.8 ms | **刚打开面板**（该窗口 `lockMine=true`） |

⇒ **同一场景、同一长度，commit 数相差 ~100×**。观察到的**顺序相关**（刚打开 ≫ 静置后），**但本轮未证明因果**：
两种读法都与数据相容 —— ①「打开动作触发一次写入风暴（各栏目取数响应落地 → store 多次写 → 每写一次整树重渲染），随后归于安静」；
② 面板开着时有周期性重渲染源（如 `dsh-usage` 的 `setInterval` 轮询，其自带注释称每周期约 0.3–0.5 s 宿主阻塞）。
**决定性实验（未做，列为待排期 M-oscillate）**：固定"打开后 T 秒"作为自变量（T = 0/20/40/60/120 s），每档 ≥3 个等长窗口，随机化顺序，同时记录 WS `payload.type` 速率与 `dsh-usage` 轮询触发计数 —— 才能把"打开风暴"与"周期轮询"分开。

**本线对这条发现的定性**：它给"用户可感卡顿时好时坏"提供了一个**客户端侧的候选解释**（设置面板在"近乎静默"与"持续重渲染"两种状态间振荡），**但本轮不足以定案**，因此**不进入结论表，只作未决项**。

#### 3.4.3 commit 与 WS 帧的关系（比值类）

⚠️ **口径偏差（测量档自陈，本线如实转记）**：本轮的入站 mux 帧是按信封 **`method`** 分类的（其分类器先测 `method` 再测 `payload.type`），**不是**协议要求的 `payload.type` 划分 ⇒ 本节只使用**帧总数**这一不受分类口径影响的部分，**不使用**其按类拆分。

`wsInN` 各窗 12.2–21.6 帧/s，而 commits/s ≈ 0–0.15 ⇒ **约 126–245 个入站 WS 帧才对应 1 次 commit**（"每帧一次 commit"不成立）。
同时 **DOM 文本长度在每个窗口内 distinct-count = 1**（550→550、927→927）⇒ **commit 发生时可见内容未变**，即"有 churn、无内容变化"（与 slot-churn §2.2 的 `0/9052` 相互印证，本线用不同器械独立复现）。

#### 3.4.4 M2（`produce` 后果的**通知级**量化）—— **INCONCLUSIVE**

探针按**形状**（hook `memoizedState` 携带 `{getSnapshot, subscribe, value}`）搜索 uSES 订阅者，**命中 0 个**
⇒ **既未使用也未确认 `{7,12,17}` 假设**（未硬编码下标）。因此**没有拿到"每次 store 写的重渲染次数"**这一通知级数字。
替代的**非归因性**旁证：全局 `Object.is` 对象-对象比较 1088–1842 次/20 s，其中 **83–88% 为同一引用、12–17% 为不同引用**。
⇒ **§3.1/§3.3 的机制结论保持"代码级确证"，但其在 live 上的通知级量级仍为 INCONCLUSIVE**（不编造）。

#### 3.4.5 逐组件名渲染计数（结构性，PASS）

`hook` 采纳自证：`inject=1`、`internals.version="18.3.1"`、`hookPreexisting=false`、`onCommitFiberRoot` 启动即 10–12 次且每窗非空。
分类规则显式声明（不猜）：对每个渲染 fiber F，取最近渲染祖先 A —— A 存在且（props 身份不变 ∧ state 变）⇒ self-driven；A 存在（其余）⇒ parent-driven；无 A ∧ props 不变 ⇒ self-driven；无 A ∧ props 变 ⇒ `root-props-changed`；`alternate==null` ⇒ mount。
本批 1790 个已归因 fiber：**self 3.1% / parent 79.2% / root-props-changed 17.6% / mount 0%**（此批为此前的 mount 计数器缺陷期，见 §4.4.3）。
渲染次数 top：`SlotOutlet` 202（12.2%）、`SlotErrorBoundary` 150（9.1%）、`R7` 144、`Z9` 144、`Vu` 134、`RootEntry` 134（各 8.1–8.7%）、`K9` 132、`z9` 132、`ProjectRowItem` 88、`tf` 88。
⇒ **槽渲染管线三元组（`SlotOutlet` + `SlotErrorBoundary` + `RootEntry`）合计 ≈ 29% 的已归因渲染** ⇒ **重渲染成本由"槽/渲染器管线"主导，且其中绝大部分是父驱动**（渲染器链自己重渲染其子元素）——与 §3.3 的裁决同向。
⚠️ **归因限制（如实标注）**：`R7`/`Z9`/`Vu`/`K9`/`z9`/`uf`/`F9`/`hs`/`tf`/`M7` 等是**生产构建下的压缩名**，无法按名字定位到源文件 ⇒ 本项只能给出"管线 vs 业务组件"的量级对比，**不能**给出业务组件级的点名单。


---

## 4. ② 8 个设置栏目**无 keep-alive**（`renderSlot({only: active})`）的代价与修法

### 4.1 栏目清单：**恰好 8 个**（静态档 F1，PASS）

`settings.section` 声明为 `kind:"list", scope:"root"`（`dsh-client-ui-settings-general/lib/client.js:555-558`）。

| # | id | order | 包 | 注册点 | 面板组件 |
|---|---|---|---|---|---|
| 1 | `general` | 0 | dsh-client-ui-settings-general | `:585/:586` | `GeneralSection` `:295` |
| 2 | `models` | 10 | dsh-client-ui-settings-models | `:2784/:2785` | `ModelsSection` `:1792` → `Loaded` `:1802` |
| 3 | `plugins` | 15 | dsh-client-ui-settings-plugins | `:1276/:1277` | `PluginsSettingsSection` `:414` |
| 4 | `agent-presets` | 20 | dsh-client-ui-agent-preset | `:1706/:1707` | `AgentPresetSection` `:1150` |
| 5 | `dsh-workspace-enhancement` | 40 | **dsh-workspace-enhancement（profile 根，未 scope）** | `:5376/:5377` | `RemoteWorkspaceSettingsPage` `:4553` |
| 6 | `@local/dsh-ssh-gui` | 50 | @local/dsh-ssh-gui | `:987/:988` | `DistributedControlSettingsPage` `:532` |
| 7 | `@deepseek-ai/dsh-vision-adam` | 60 | @deepseek-ai/dsh-vision-adam | `:201/:202` | `VisionAdamSection` `:84` |
| 8 | `@local/dsh-subagent-model` | 70 | @local/dsh-subagent-model | `:309/:310` | `SubagentModelSection` `:119` |

**修正本线自己的早期误判**：我最初只 grep 了 `$L`（核心包）与 `$P/@local/**`、`$P/@deepseek-ai/**`，得到 **7** 个注册者，并据此怀疑"早先记录的 8 行多了一行"。
实际第 8 个来自 **未 scope 的 `~/.dsh/profiles/node_modules/dsh-workspace-enhancement/lib/client.js:5377`** ⇒ **错误在我这一侧的检索面，不在历史记录**。
早先 `tab-profile` 记的 `remote-workspace` 行 = 该包的 `RemoteWorkspaceSettingsPage`（id 是 `dsh-workspace-enhancement`），`distributed` 行 = `@local/dsh-ssh-gui`（label 字面量 `"分布式控制 · dsh-ssh-gui"`）。**8 行得到确认。**

**两处 grep 计数陷阱（静态档记录，供后续复用）**：
1. **`grep 'name: "settings.section"'` 返回 12 处**，因为 `~/.dsh/profiles/node_modules/@deepseek-ai/` 下**另有一份 4 个核心 UI 包的副本**；本线已核**这些副本与 `$L` 字节相同**（`settings-general` 两份 sha256-12 均为 `bd7edeaec382`，见 `raw/referent-hashes.txt` 末行）⇒ 12 处 = **8 个不同 id**，重复解析根无害。
2. **只 grep `$L` 会得到 4 个**（恰好一半），会做出"8 个里缺 4 个"的错误结论。**live 插件根必须同时包含 `~/.dsh/profiles/node_modules/` 的 scoped 与 unscoped 两处。**

### 4.2 无 keep-alive 的**真实机制**：不是"渲染 8 个只藏 7 个"，而是**"只渲染 1 个、其余被 React 卸载"**

| 环节 | 事实 | `file:line` |
|---|---|---|
| 调用点 | `active !== void 0 && renderSlot("settings.section", { close: onClose }, { only: active })` | `dsh-client-ui-settings-general/lib/client.js:164` |
| 过滤 | `if (opts?.only !== void 0) list = list.filter((item) => item.id === opts.only);` | `dsh-client-ui-renderer/lib/client.js:845` |
| key | `list.map((item,i) => item.entry !== void 0 ? guarded(item.entry, \`e${entryKeyOf(item.entry)}\`) : …)` | `dsh-client-ui-renderer/lib/client.js:847` |
| entry 身份 | `entryKeyOf` 稳定（per-entry） | `dsh-client-ui-renderer/lib/client.js:500-509` |

⇒ 切栏目时**旧 keyed child 从 list 中消失、新 keyed child 出现** ⇒ **React 卸载旧面板、挂载新面板**。
⇒ **组件 `useState`、DOM 子树、已取到的数据全部丢弃；不存在任何 keep-alive 机制**（全库 `keepAlive|keep-alive` 零命中）。
⇒ 副产物：**list 分支本就支持渲染全部 entry**（不带 `only` 时会把 8 个条目全部渲染并按 entry 身份 keyed）——这使"保留面板"的修法在渲染器侧**不需要新增能力**。

**同一 idiom 在其他位置复用**（修法若做在渲染器/调用层即可一次覆盖）：
`settings-general:226`（`settings.onboarding`，`only: onboardingStep.id`）、`dsh-client-ui-settings-plugins/lib/client.js:497`（`settings.plugins.tab`，`only: row.id`）、`dsh-client-ui-conversation/lib/client.js:7424`（`{ only: active.id }`）。

### 4.2bis ★ 仓库内**已经存在**可用的 keep-alive 与副作用门控（本线独立复核，**这是 K1 的关键依据**）

修法不需要发明新机制——**同一个代码库里已经有两处现成模式**，且都是"热面、单文件、可锚点补丁"：

| 模式 | 位置 | 事实 |
|---|---|---|
| **① keep-alive 容器（访问过即保留）** | `dsh-client-ui-settings-plugins/lib/client.js:415-427` + `:489-500` | `const [visitedIds, setVisitedIds] = useState(() => new Set())`；渲染时 `rows.filter((row) => row.id === active \|\| visitedIds.has(row.id))`，每个 panel 用 `<div role="tabpanel" aria-labelledby={…} hidden={!selected}>{renderSlot("settings.plugins.tab", {}, { only: row.id })}</div>`。**注意 `only` 传的是该行自己的 `row.id`（不是全局 active）⇒ 每个保留的 panel 渲染的是它自己的内容，非活动的只是被 `hidden` 隐藏 ⇒ 这是真正的 keep-alive**（首次访问才挂载 = lazy + keep）。完整机制（逐行核对）：`useId()` 生成 panel id（`:416`）→ `useEffect` 在 `active` 变化时把 `active` 并入 `visitedIds`（`:420-427`，且 `has(active)` 时不换引用）→ 渲染 `filter(active || visitedIds.has(id))` 的 wrapper（`:489`），每个 wrapper 带 `role="tabpanel"`/`aria-labelledby`/`hidden={!selected}`（`:491-496`）→ wrapper 内 `renderSlot("settings.plugins.tab", {}, { only: row.id })`（`:497`）。另含完整的键盘语义（`:470-487` 的 Arrow/Home/End + `tabRefs` 聚焦），说明该模式已在生产通过 a11y 使用。 |
| **③ "已加载即不再取数"闸门（保留数据）** | `dsh-client-ui-settings-models/lib/client.js:1856` | `if (state.status === "idle") controller.load();` —— 数据在 `createSnapshotStore`（`SM:2386`）里跨卸载存活，挂载时只在 `idle` 才重新 `load()`。**live 实测这是唯一一个"第二次访问 RPC = 0"的栏目**（§4.4.3）。 |
| **② 副作用（轮询）可见性门控** | `@local/dsh-usage/lib/client.js:774-810` + `:983` | `const [pollVisible, setPollVisible] = useState(true)` + `IntersectionObserver`（`:795-799`）驱动；轮询 effect 首行 `if (!pollVisible \|\| document.hidden) return;`（`:983`）。**该处代码自带注释**：*"the card is a settings-page section — while it is scrolled out of view (or the tab is in the background) it must not poll at all: **every cycle costs the host ~0.3-0.5 s of blocked event loop**. Only the timer is gated; the initial load and the manual refresh stay unconditional."* 并且同一段注释记录了历史上的一次教训：该门控曾因 `if (setPollVisibleRef.current)` 恒假而**完全失效成死代码**（`:781`）。 |

⇒ **判定**：`settings.section` 目前**没有**这套机制（`:164` 只有 `only: active`，`renderer:845` 直接过滤），
但 **`settings.plugins.tab`（同一设置面板的第二层）与 `dsh-usage`（同一栏目的卡片）都已经有**。
**所以"8 个栏目无 keep-alive"是同一面板内两种实现并存的不一致，而不是能力缺失** —— 这把 K1 从"设计一个新机制"降级为"**把已有模式上提一级**"，风险面显著缩小。

### 4.3 切换的**代价**（"保留数据不保留副作用"的证据基线，静态档 F1）

**全部 8 个栏目的页面状态都是组件本地 `useState`**（无一个用 store 承载页面状态）⇒ 卸载即丢失。两处例外（数据在 store、卸载后仍在，但**挂载时仍会重新 `load()`**，故只保住数据、没保住 RPC 成本）：

| 栏目 | 数据归属 | 每次挂载的取数（`file:line`） | 副作用与清理 |
|---|---|---|---|
| `general` | `settings.general.item` 行的本地 state | **0 个自有 RPC**（`SG:295-300`）；代价是 **6 个 `settings.general.item` 行组件随栏目一起卸载/重挂**，每行各有自己的 effect | — |
| `models` | `useSnapshot((s)=>s)`（`settings-models:1805`）over `createSnapshotStore` `:2386` + `ModelsSettingsStore` `:2742` | **2 个 RPC**：`api.llm.providers` `:548` + `credentials.describe` `:578`（`describeFace.ensure()` 也在 `:548` 的 `Promise.all` 内） | **`load()` 一次写 store 3 次**（`:540/557/585`）⇒ 恒等订阅下的**3 次整节重渲染**；generation 计数器只排序响应、**不取消** |
| `plugins` | 本地 state `:418-419`；子标签用 `visitedIds`+`hidden` **已 keep-alive**（§4.2bis） | **0 个自有 RPC**；代价来自其内挂的 4 张卡片（下述），其中 `dsh-usage` 一张 = 9 个 `/usage/*` | 见 §4.2bis |
| `agent-presets` | `useAgentPresetSection((s)=>s)` `:1153`（数据在 store `AP:731`） | **1 个 RPC**：`agentPresets.list`（`AP:535` / `:1441`）；每次挂载 `load()` `:1157` | 数据可存活，**RPC 成本不存活** |
| `dsh-workspace-enhancement` | 本地 `:4555-4560` | **1 个 RPC**：`machines.list` `:4562`（挂载 effect `:4570`） | **无 cleanup 返回**（in-flight promise 落进已死组件） |
| `@local/dsh-ssh-gui` | 本地 `:534-545` | **4 + 2N 个 RPC**：`nodes.list`/`keyref.list`/`config.get`/`serial.ports` `:549-552`，**加逐节点第二波** `conn.status`/`node.status` `:566-580`（N = 节点数） | **完全无 cleanup**（`useEffect(()=>{void refresh(false)},[])` `:587` 不返回任何东西） |
| `@deepseek-ai/dsh-vision-adam` | 本地 `:86-90` | **0 个 RPC** | ✅ 返回 unsubscribe `:91-115` |
| `@local/dsh-subagent-model` | 本地 `:121-126` | **0 个 RPC** | ✅ 返回 unsubscribe `:127-152` |

**所有设置 bundle 内都没有虚拟化**：`settings-plugin-inventory:150` 是裸 `filteredEntries.map((entry) => {…})`（即 1820 节点 / 192 SVG 的现场）；全工程**只有 `dsh-client-ui-trajectory` 用 `@tanstack/react-virtual`**（静态档 F6）。

**设置壳自身的副作用**：`SettingsPanel:99-107` 装 `document` keydown 监听并**有** cleanup（`:104-106`）；`:109-111` `closeButton.current?.focus()` **无** cleanup。
`dsh-workspace-enhancement` 的徽标子系统在**模块级**装 `MutationObserver(document.body)` `:4445/:4450` + `document.addEventListener("click",…,true)` `:4455` + `setInterval` `:4456` + `setTimeout` `:4407`（**不是** per-mount，卸载设置面板不会带走）。
另：`@local/dsh-wallpaper` 注册的是 `settings.general.item`（order 30，`:591-594`），不是 section；`dsh-usage` 注册 `settings.plugin.item`（`:1232`）。

> ⚠️ **本线对二级静态档的一处更正**：静态档 F6 曾把"`/usage` 9 RPC 页面"记为 `settings.general.item` 的一行。
> 本线复核 **`settings.general.item` 的全部注册者 = 6 个**（`dsh-client-locale`、`dsh-client-ui-agent-preset`、`dsh-client-ui-conversation`、`dsh-client-ui-permission-presets`、`dsh-client-ui-theme`、`@local/dsh-wallpaper`），**没有 `dsh-usage`**。
> 9 个 `/usage/*` 的真实来源是 **`settings.plugin.item` 的 `dsh-usage` 卡片**（`@local/dsh-usage/lib/client.js:1232`，`key: "dsh-usage"`），挂在**「插件」栏目**的 `插件配置` 子标签内 —— 与 `incident2/VERDICT.md` D1 的观测一致。
> ⇒ 该更正**不改变**"无 keep-alive ⇒ 切回重取数"的结论，只更正成本归属（属 `plugins` 栏目，不属 `general` 栏目）。

**「插件」栏目内部的第二层无 keep-alive**：`dsh-client-ui-settings-plugins/lib/client.js:497` `renderSlot("settings.plugins.tab", {}, { only: row.id })` ⇒ `插件配置`(order 0) 与 `插件列表`(order 10) **互相切换也走 unmount/remount**（与 `BATCH-PLAN` §五.14 "导航项与 tab 是两件事"相互印证）。

**「插件」栏目进入一次的确定性工作量（本线新增，只读 RPC 取证，**计数类不受并发污染**）**：
`ConfigurablePluginsTab`（`dsh-client-ui-settings-plugins/lib/client.js:397-405`）对 **`ctx.settingsScope.describe()` 的每个 namespace** 各发一次 `renderSlot("settings.plugin.item", {}, { entryKey: ns })`。
本线只读调用 `/api/settings.describe` 实测 **`result.value.namespaces` = 20 个**（`raw/settings-describe.json`、`raw/configurable-namespaces.json`）⇒ **进入「插件」栏目 = 20 次 keyed 分发**；其中 **4 个 key 命中并同时挂载卡片**：
`shell`（BashCard）、`agent-loop`（AgentLoopCard）、`web-search-deepseek`（WebSearchCard）（注册于 `:1302-1314`）+ `dsh-usage`（UsageCard，`@local/dsh-usage/lib/client.js:1232-1245`，`key: "dsh-usage"`）。
⇒ **4 张卡片同时挂载、同时取数**，其中 `dsh-usage` 一张就扇出 9 个 `/usage/*`（下述）。
⚠️ 注意 `ConfigurablePluginsTab:399` 的 `useConfigurablePlugins((snapshot) => snapshot)` 是**恒等 selector 订阅整个快照** ⇒ 该 store 任何一次"至少写了一个字段"的更新都会让整个 tab 重渲染（§3.1 的口径）。

**「插件」栏目切回的固定成本已定位到调用点**（本线新增，代码级）：`@local/dsh-usage/lib/client.js` 以 `settings.plugin.item` 注册（`:1232`）挂在 `插件配置` 子标签内，其数据加载 `loadAll`（`:890`）一次性扇出
`summary`/`timeseries(day)`/`heatmap`/`byModel`/`byProject`/`byDay`（`:910-915`）+ `timeseries(hour)`（`:920`）+ `sessions`（`:950`）+ `status`（`:965`）—— 即 `incident2/VERDICT.md` D1 观测到的"9 个 `/usage/*`"（8 vs 9 的差异只在是否把 hour 变体单列，见 `BATCH-PLAN` §五.14 对账）。
该组件**有**正确的 cleanup 与 generation 守卫（`:844-851`、`:891-892`：卸载时 `aliveRef=false` + 三个 generation 自增 ⇒ 晚期响应被丢弃），且轮询 `setInterval` 在 `:986` 受门控（对应 `MEASUREMENT-STATUS` §3.2 的 S9"切走后轮询 0 次"）。
⇒ **`@local/dsh-usage` 是本项目里"取消/失效语义"的正确样板**；`@local/dsh-ssh-gui:587` 与 `dsh-workspace-enhancement:4570` 缺的正是这套守卫（见 §6.2 K1a 风险 4）。

**代价的结构刻画**：8/8 栏目"切回 = 完整重挂 + 重新取数"，其中 4 个自带取数（`general` 的 item 行、`plugins` 的 `/usage` 族、`workspace-enhancement` 的 `machines.list`、`ssh-gui` 的两波节点扇出）。
**已确证的历史量化**（引用，不重测）：点导航「插件」固定重发 **9 个 `/usage/*` RPC**，`/usage/sessions` 单响应 **54,062 字节**，click+6~11 ms 并发发出、25→352 ms 到齐（`incident2/VERDICT.md` D1）；
「插件列表」子标签 **1820 节点 / 192 SVG**（D2）；切走后轮询 **0 次**（`MEASUREMENT-STATUS.md` §3.2 S9 —— 即**存在成熟的"不可见即停轮询"模式，keep-alive 修法必须保住它**）。

**判据：PASS（机制与代价均已代码级落地；绝对值待 §4.4 的 live 数据）。**

### 4.4 live 复核（逐栏目切换表）

#### 4.4.1 导航行清单：**8 行（live DOM 权威枚举，PASS）**

探针在真实 DOM 上读回（`navClass=VOzbGW_nav`）：
`["通用设置","模型","插件","Agent 预设","远程工作区","分布式控制 · dsh-ssh-gui","vision-adam 识图设置","子代理模型"]` ⇒ **count = 8**
⇒ **§4.1 的 8 个代码级注册者与 live DOM 的 8 行一一对应；早先"7 vs 8"的差异彻底闭合。**
（日志三次独立读回完全一致，见 `raw/w01-run.log` 的 `NAV-ROWS count=8`；独立落盘证据 `raw/settings-nav-rows.json`，选择器 `div[role="dialog"][aria-modal="true"] nav button`，**三个独立会话一致**。附：每行是 `button.VOzbGW_navCell`，**无** `role`/`aria-selected`/`data-state`，仅第 0 行带 `VOzbGW_active` —— 这对 K1 的 a11y 验收（A4）是必要背景。）

#### 4.4.2 逐次切换（2 个完整 cycle、共 16 次切换；cycle 2 逆序 7→0）

> **出处**：本表取自 `raw/w01-all-2026-09-22T06-52-58-394Z.json`（含两个完整 tab-cycle 轮次，共 32 次切换）；**mount 列不在本表**，其数值来自 mount 计数器修正后的补充窗口 `raw/w01-all-2026-09-22T07-00-08-180Z.json`（见 §4.4.4 第 3 点）。两次窗口的 `click→帧1/帧2` 独立量级一致（另一轮 11.6–20.1 / 28.1–31.2 ms），故并列引用。

| row | label | content 节点 before→after | click→帧1 / 帧2 ms | commits | pw fiber | self/par/rootProps |
|---|---|---|---|---|---|---|
| 0 | 通用设置 | 97→97（**已是活动项**） | 13.4 / 30.2 | 3 | 571 | 8/393/143 |
| 1 | 模型 | 97→**49** | 13.9 / 30.5 | 5 | 964 | 9/749/154 |
| 2 | **插件** | 49→**353** | **18.0** / 31.2 | **6** | **1154** | 11/644/**405** |
| 3 | Agent 预设 | 353→107 | 13.9 / 30.6 | 5 | 976 | 13/606/239 |
| 4 | 远程工作区 | 107→61 | 13.8 / 30.5 | 2 | 373 | 6/300/45 |
| 5 | 分布式控制 | 61→28 | 13.8 / 30.1 | 3 | 554 | 9/441/74 |
| 6 | vision-adam | 28→37 | 14.6 / 31.1 | 2 | 371 | 6/299/45 |
| 7 | 子代理模型 | 37→81 | 15.6 / 31.5 | 2 | 371 | 6/299/45 |

**（第二次独立 tab-cycle 轮次中，cycle 1 与 cycle 2 的结果逐项相同）**：
插件 cycle1 = **353 节点 / 2151 字符 / 6 commits / pwSum 1256**，cycle2 = **353 节点 / 2151 字符 / 6 commits / pwSum 1256**
⇒ **第二次访问与第一次访问在渲染侧完全等价（无缓存命中、无任何保留）**。

**关键计数（不受并发污染的判据）**
1. **`click → 第一帧` = 12.1–20.0 ms（32 次切换），`click → 第二帧` = 28.9–31.5 ms** ⇒ 形态是"**恰丢 ≤1 帧**"，与既有 D4（13.2–19.8 ms、恰丢 1 帧）一致。
2. **每一次切换都不产生长任务**：per-switch `RunTask max ≤ 20.3 ms`（最大值出现在插件）、**LoAF 条目 0**、`rAF max ≤ 23.2 ms`，**没有任何一次切换越过 50 ms**。
   ⇒ **② 的成本形态是"每次都要重复付的**小**成本"，不是"单次切换造成可感卡顿"** ——本报告据此**不宣称** keep-alive 能消除可感卡顿（与 `BATCH-PLAN` §三.6 的纪律一致）。
3. **重挂是真实且每次发生的**（mount-修正后的窗口实测 `mounts` = 通用 27 / 模型 34 / **插件 126** / Agent 预设 25 / 远程工作区 22 / 分布式控制 48 / vision-adam 21 / 子代理模型 39）；
   而**重复点击已活动项 ⇒ `mounts = 0`、`commits = 0`、`pw = 0`**。
   ⇒ **`mounts` 是本轮对"无 keep-alive"最直接的 fiber 级证据，并自带"已活动项 = 0"的阴性内对照。**
4. **只有 1 个面板同时存在**：content 节点数在 8 个栏目各自的水平间**上下波动**（97↔49↔353↔…），而不是单调累加 ⇒ **切走即卸载**（若为 keep-alive，节点数应单调累加）。这是对第 3 条的独立旁证。
5. **各栏目 content 节点特征值**（稳定复现）：通用 **97**、模型 **49**、插件 **353–354**、远程工作区 **61**、分布式控制 **28**、vision-adam **37**、子代理模型 **81**。
   ⚠️ **Agent 预设不稳定（16 / 107 两个值）**⇒ 该数值是**取数时序相关**（数据未到 = loading 态节点更少），**不得**当作固定签名使用。

#### 4.4.3 纠正测量档报告中的一处**实质性错误**（本线独立复核）

测量档的收口报告写有：*"RPC/fetch/XHR outbound during every switch: **0** — no refetch is observed on the client socket; the second-visit cost is therefore re-mount/re-render, **not re-fetch**"*，
并在其表格中把 "RPC out" 一列全部填 **0**。

**该表述与它自己的原始数据矛盾。** 本线直接重读其 `raw/w01-all-*.json` 的 `windows[].switches[].slice.net.fetch`（`fetch`/`XHR` tap，时间戳均落在该次切换的 `[tA, tB]` 区间内），在**三个独立运行的每一个 tab-cycle 窗口、两个 cycle 中完全一致**：

| 栏目 | 每次访问的出站 RPC（`fetch`） | 第 2 次访问是否重发 |
|---|---|---|
| **插件** | **9 个**：`summary, timeseries(day), heatmap, byModel, byProject, byDay, timeseries(hour), sessions, status` | **是（每次都是 9 个）** |
| **分布式控制** | **4 个**：`nodes.list, keyref.list, config.get, serial.ports` | **是（每次都是 4 个）** |
| **远程工作区** | **1 个**：`machines.list` | **是** |
| **Agent 预设** | **1 个**：`agentPreset.list` | **是** |
| **通用设置** | **1 个**：`agentPreset.list`（来自其 `settings.general.item` 的 agent-presets 行） | **是（返回访问时发出）** |
| **模型** | 2 个：`llm.providers`, `credentials.describe` | **否 —— 仅首次访问发出，之后每次 0 个** |
| vision-adam / 子代理模型 | 0（设计上无取数） | – |

（脚本与输出见本线本次核对：`slice.net.fetch` 逐条打印，4/4 个 tab-cycle 窗口全部命中。）

**⇒ 正确结论**：
- 「**插件**」栏目的 9 个 `/usage/*` **每次切回都完整重发** —— 本线用独立器械**确认**了 `incident2/VERDICT.md` D1，并给出了**带名字的清单**（D1 只给了数量）。
- **6 个有取数的栏目里，5 个每次重发**；**唯一例外是「模型」**，因为 `dsh-client-ui-settings-models/lib/client.js:1856` 的 `if (state.status === "idle") controller.load();` **构成了一道有效的"已加载则不再取数"闸门**（数据在 store 里、跨卸载存活）。
  ⇒ **这既是"保留数据"的第三个仓库内先例，也是"第二次访问 ≈ 第一次访问"这一结论的例外**，必须分开陈述。
- 测量档的"no re-fetch"结论**作废**；它据以推出的"第二次访问成本 = 重挂而不是重取数"**只对「模型」成立**。
- 说明：这些 RPC 走的是 `http://127.0.0.1:3080/usage/*`、`/ssh-gui/*`、`/dsw/*`（**不在 `/api/` 下**）⇒ 历史上"CDP Network 只过滤 `/api/`"造成的**捕获盲区**（`incident2` §5.2 已记录）在本轮的 `fetch`/`XHR` tap 下**不存在**。

#### 4.4.4 ② 的代价：**可复现的定量结论（计数类）**

| 判据 | 结果 | 说明 |
|---|---|---|
| 第二次访问同栏目的 **mount fiber 计数** | 与首次**同量级**（如插件 126 → 94；模型 34 → 16；通用 27 → 156） | 非 0 ⇒ **渲染侧无任何保留** |
| 第二次访问同栏目的 **DOM/文本规模** | 插件 **完全一致**（353 / 2151） | 逐项相同 ⇒ **无缓存命中** |
| 第二次访问同栏目的 **RPC 计数** | 插件 **9→9**、分布式控制 **4→4**、远程工作区 **1→1**、Agent 预设 **1→1**；**模型 2→0** | 5/6 重发 |
| 重复点击已活动项 | `mounts=0 / commits=0 / pw=0` | 阴性内对照 ✔ |
| 单次切换的长任务/长帧 | `RunTask max ≤ 20.3 ms`、`LoAF=0`、`rAF max ≤ 23.2 ms` | **不构成单次可感卡顿** |
| 宿主侧连带成本（引用，非本轮实测） | `@local/dsh-usage/lib/client.js:977-982` 自带注释：每次轮询周期 **约 0.3–0.5 s 宿主事件循环阻塞** | ⇒ 重复切回的直接代价**有一半落在宿主**，这是 K1 最可辩护的收益面 |

**判据：② 机制 **PASS**（代码级 + fiber 级 mounts + DOM 逐项复现三重一致）；绝对 ms **INCONCLUSIVE（CONTENDED）**。**


---

## 5. ③ 已撤回 / 已确证的周边：**直接引用，不重测**

| 项 | 状态 | 引用 |
|---|---|---|
| 「**订阅即回调**」导致打开设置就卡 | **已否证** | `incident2/static-events/audit.md:18, §2.1:161-196`；`incident2/FINDINGS-SUMMARY.md:38` —— zustand `fireImmediately` **全库 0 处调用**；locale/registry 订阅均 `Set.add` |
| 打开设置触发 **forced reflow** | **已否证** | `incident2/FINDINGS-SUMMARY.md:39` —— 2 s 窗口内 1 次布局读取、**0 次写后读** |
| 两个 **object selector** 放大整树重渲染 | **已排除** | `root-subscriptions/audit.md` items 5/15/16（6329 次渲染引用变化 0）——本轮 §3.2 已在代码侧复核其**记忆键**成因 |
| 「**输入框每字符重渲染**」 | 任务说明为"已证伪"，但**本轮在工作区未检索到任何落盘证据**：`program/w12-input-ux/` 尚无 `audit.md`；全 `.workspace` grep `每字符`/`keystroke`/`per-key` **零命中** | ⇒ 本线**既不重测也不引用**；**不作为任何结论的支撑**。若要入账需先找到原始证据文件，或由 `w12-input-ux` 线补交 |
| 会话投影链（`buildListSnapshot→projectList→list.set`）是首要成本项 | **已证伪**（占非 idle ~1.0%，被 `ThemePresenter.apply` 大 **75.7×**） | `cpu-profile/audit.md`；`MEASUREMENT-STATUS.md` §3.-1.0ter 裁决 B |
| 设置遮罩 `backdrop-filter: blur(2px)` 是帧级抖动载体 | **未决**（另一线逆序复现失败 ⇒ 四通道仲裁） | `incident2/VERDICT.md` D6 + §5.5；本轮**不触碰**（属 `w11-mask-look`/`exec-mask` 面） |
| `ThemePresenter.apply` = 第一位成本项 | **已确证** | `MEASUREMENT-STATUS.md` §3.-1.0/§3.-1.0ter（独占批 7/7；含 Blink 为其强制重算付的时间 ⇒ 归因非"改它即好"） |
| `settings-models` 行级 memo / 虚拟化 | **已否决** | `MEASUREMENT-STATUS.md` §3.1（12/12 窗模型面板子树渲染 0 fiber）+ `BATCH-PLAN.md` §三.8 |
| `mutation_count` 作 re-render 证据 | **禁止** | `MEASUREMENT-STATUS.md` §3 表 + §4.8 |

---

## 6. ④ 可测的 top-5 客户端成本项 + 最小修复候选

### 6.1 Top-5（按"证据强度 × 可测性 × 客户端归属"排序，非按主观量级）

| # | 成本项 | 归属（`file:line`） | 现状判据 | 本轮可测性 |
|---|---|---|---|---|
| **C1** | **`ThemePresenter.apply`**：快照订阅回调内 `setProperty` + `getComputedStyle` 强制全文档重算 | `dsh-client-ui-layout/lib/client.js:366/375/440` | **已确证**（独占批 7/7 第一热点，占非 idle 54–81%；`apply÷整条会话链 = 44.9×`；`RecalcStyle` 占 Task 60%） | 已有 M-A/M-B/M-C 决定性实验设计（cpu-profile 线）；**本轮不重测**。⚠️ 它与 C4 直接耦合：`cost/script` 比随 **DOM 规模**单调放大（首页 0.98× → 长会话 3.5–3.9× → 设置态 4.1–4.9×） |
| **C2** | ★**`AppFrame` 的恒等选择器**：`useStore((s) => s)` ⇒ 布局 store 任一字段写入 ⇒ **整棵三栏 shell 重渲染** | `dsh-client-ui-layout/lib/client.js:159`，其下游 `renderSlot("sidebar"/"conversation"/"details"/"shell.overlay")` `LY:228/233/237` | **本线新增（代码级确证）**；静态档 F4 判定为"全 roster 最有后果的一行" | ✅ live M1 可按组件名的渲染计数验证（**计数类，不受并发污染**） |
| **C3** | **每次通知 ⇒ 设置子树整树重渲染**：`SettingsRoot` **1.000 渲染/commit** 而 DOM 文本 **0/9052 变化** | `settings-general:96/176/164`；`renderer:711/518/743/748` | **已确证**（slot-churn §2.2，三次独立运行比值完全可复现） | ✅ live M1 复核比值 |
| **C4** | **8 栏目无 keep-alive ⇒ 切回完整重挂 + 重新取数**（`models` 2 RPC / `agent-presets` 1 / `workspace-enhancement` 1 / `ssh-gui` **4+2N** / `plugins` 内 `dsh-usage` **9 个 `/usage/*`**） | `settings-general:164` + `renderer:845/847` | **机制 PASS（代码级）**；**live 已给出逐栏目基线**（mount fiber 27/34/126/25/22/48/21/39；RPC 每次访问 9/0/1/1/4/0/0/1）⇒ **5/6 有取数的栏目每次切回完整重发**（唯一例外：模型，见 §4.4.3） | ✅ live M3 逐栏目切换表（**RPC 计数 = 计数类，不受并发污染**） |
| **C5** | **祖先链无 memo 边界的父路径级联**：设置段 `RootEntry`/`SlotErrorBoundary`/`SlotOutlet` **0.706–0.833 渲染/commit**；设置路径 `react.memo` 计数 **全 0** | `renderer:711/518/743/748` | **已确证**（slot-churn §2.2 三次运行一致） | ✅ 静态已定量；live 仅复核比值 |

**非入榜但已量化的项**（供修复排期参考）：「插件列表」**1820 节点 / 192 SVG**（`incident2` D2，仅支持虚拟化 → K5）；
`session.list` 落地 ⇒ **38 连发 commit × 每次 600 fiber**（`incident2/FINDINGS-SUMMARY.md` 元凶①，宿主侧已修，客户端侧待收窄 → K4）；
`sessions.provideInfo` 恒等选择器（`renderer:246/260`）。

### 6.2 最小修复候选

> 每个候选：**收益 / 风险 / 验收标准 / 回滚 / 热面或冷面**。凡"收益"必须写成**同窗对照的比值或为零判据**，不用跨窗绝对数。

#### K1 — 设置栏目 keep-alive（"保留数据、不保留副作用"）｜**热面** ★**推荐首选**

> **本线的核心裁决**：修法**不需要发明新机制**。同一代码库里 `settings.plugins.tab`（同一设置面板的**下一级**）已经有可用的 keep-alive 容器（`dsh-client-ui-settings-plugins/lib/client.js:419` `visitedIds` + `:489-500` `active || visitedIds.has(id)` + `hidden={!selected}` + `role="tabpanel"`/`aria-labelledby`），
> 同一栏目的卡片也已经有可用的副作用可见性门控（`@local/dsh-usage/lib/client.js:774-810` 的 `IntersectionObserver` → `:983` 的 `if (!pollVisible || document.hidden) return;`）。
> ⇒ **"8 个栏目无 keep-alive"是同一面板内两种实现并存的不一致，而不是能力缺失。K1 = 把这两处已有模式上提一级到 `settings.section`。**

- **形状（三段，必须按序落地）**
  - **K1-①（keep-alive 容器，抄 `SP:489-500`）**：把 `dsh-client-ui-settings-general/lib/client.js:164` 的单条渲染改为按 `rows` 渲染
    `rows.filter((r) => r.id === active || visitedIds.has(r.id))`，每项一个 `<div role="tabpanel" aria-labelledby={…} hidden={!selected}>` 包裹 `renderSlot("settings.section", { close: onClose }, { only: r.id })`。
    **注意 `only` 必须传该行自己的 `r.id`（这正是 `SP:497` 的写法）**：这样每个保留的面板渲染的是它自己的内容，非活动的只是被外层 `hidden` 隐藏 ⇒ **真正的 keep-alive，且首访才挂载（lazy + keep）**。
    ⇒ **不需要改渲染器**（`renderer:845` 保持原样），爆炸半径限制在设置壳内，且**与已在生产运行的 `settings.plugins.tab` 完全同构**。
  - **K1-②（副作用可见性门控，抄 `dsh-usage:774-810/983`）**：给每个 section 传一个 `visible` 信号（由 `active === r.id` 派生，经 ownerProps 下发），各 section 的**轮询 / 订阅 / 观察器**在 `visible===false` 时不得开始。可加一个共享 helper（如 `useVisibleEffect`）。
    **不变量**：首访的初始加载与手动刷新**不受门控影响**（`dsh-usage` 的注释已把这条写成硬约束：*"Only the timer is gated; the initial load and the manual refresh stay unconditional"*）。
  - **K1-③（取消失效语义，抄 `dsh-usage:844-851/891-892`）**：给 `@local/dsh-ssh-gui:587`（4+2N 扇出，**当前零 cleanup**）与 `dsh-workspace-enhancement:4570`（`machines.list`，**当前零 cleanup**）补 `aliveRef` + generation 守卫；`settings-models:538` 的 generation 计数器**只排序不取消**，需补取消。
- **收益（一律写成"为零/比值"；下列**首次访问的实测基线**已由本轮 live 取得，可直接用作 A/B 的 before 值）**
  - K1-①：**二次访问同一栏目的 mount fiber 计数 = 0**（不再重挂）。**首次访问实测基线**（mount 修正窗口）：通用 **27** / 模型 **34** / 插件 **126** / Agent 预设 **25** / 远程工作区 **22** / 分布式控制 **48** / vision-adam **21** / 子代理模型 **39**。
  - K1-①：**二次访问同栏目不再重建 DOM**。首次访问实测基线（内容区节点）：通用 **97** / 模型 **49** / **插件 353（文本 2151 字符）** / 远程工作区 **61** / 分布式控制 **28** / vision-adam **37** / 子代理模型 **81**。
  - K1-①：**二次访问的该栏目 RPC 计数 = 0**。每次访问都会重发的实测基线：**插件 9 个** `/usage/*`（`summary, timeseries(day), heatmap, byModel, byProject, byDay, timeseries(hour), sessions, status`）、**分布式控制 4 个**（`nodes.list, keyref.list, config.get, serial.ports`）、**远程工作区 1 个**（`machines.list`）、**Agent 预设 1 个**（`agentPreset.list`）、**通用设置 1 个**（`agentPreset.list`）。**模型 2→0 已是例外（§4.4.3），不需要修。**
  - K1-①：**宿主侧连带收益**（引用 `@local/dsh-usage/lib/client.js:977-982` 自带注释）：每个 usage 轮询周期约 **0.3–0.5 s 宿主事件循环阻塞** ⇒ 少一次切回即少一轮 9 路 `/usage/*`。**这是 K1 最可辩护、也最容易验证的收益面**（宿主侧可按 w02/w05 线的 RPC wall-time 分布验收）。
  - **⚠️ 不得宣称的收益（本轮有实测反证）**：**单次栏目切换本身不是可感卡顿源** —— 32 次切换的 `RunTask max ≤ 20.3 ms`、`LoAF = 0`、`rAF max ≤ 23.2 ms`，**无一越过 50 ms**。⇒ K1 的收益是"**消除每次都要重复付的小成本**"，**不是**"消除可感卡顿"（与 `BATCH-PLAN` §三.6 纪律一致）。
  - K1-③：快速来回切栏目时，"落进已死组件的 in-flight 响应数" = **0**（当前为每次切换 4+2N 个）。
- **风险（按严重度）**
  1. **`hidden` 不会停掉 effect** —— 这正是必须配 K1-② 的原因；**只做 ① 是净负收益**（8 个栏目的轮询/观察器同时复活，破坏已被确证的 S9"切走后轮询 0 次"）。
  2. **抬高设置态 DOM 常驻量 ⇒ 放大 C1（`ThemePresenter.apply`）**：`apply` 的 `cost/script` 比随 DOM 规模单调放大（首页 0.98× → 长会话 3.5–3.9× → 设置态 4.1–4.9×，已确证）。
     **本轮把该风险量化**：8 个栏目内容区节点之和 = 97+49+353+107+61+28+37+81 = **813**，而现状（只挂 1 个栏目）基线是 **97** ⇒ 若**一次性全挂 8 个**，内容区常驻量 **8.4×**；换算到整份文档：设置打开时文档节点 **4638**（既有实测），+716 ⇒ **≈ +15.4%**。
     ⇒ **保守做法（推荐）**：`visitedIds` **只保留访问过的**栏目（与 `SP:489` 完全一致），不要一开面板就挂 8 个；并在验收里加"`apply` 的 `cost/script` 比不劣化"的同窗判据。**这是 K1 唯一的实质性风险，必须在 A/B 中先量。**
  3. **门控遗漏是静默的**：任一 section 忘记接 `visible` 就泄漏订阅（静态档 F6 指出 ssh-gui 与 workspace-enhancement 是高风险对象）。⇒ 验收必须**逐栏目**做"切走后 60 s 该栏目 RPC = 0"的为正为零断言。
  4. 无障碍/焦点：`role="tabpanel"` + `aria-labelledby` + `hidden` 的组合在 `SP:491-496` 已在用；可聚焦元素建议 `inert`（`settings-models:2139-2146` 有先例）。
  5. `models`/`agent-presets` 的数据本就在 store ⇒ 它们**只省 RPC 往返**，不省重渲染；不要对这两项承诺渲染收益。
- **验收标准**
  - A1（为零）：二次访问同栏目，该栏目 RPC 计数 = **0**；`/usage/*` 计数 = **0**（首访基线 = 上述 9/4/1/1/1）。
  - A2（比值）：二次访问的 mount fiber 计数 ÷ 首访 = **0**（首访基线 = 上述 27/34/126/25/22/48/21/39）。
  - A2b（阴性内对照，必须复现）：**重复点击已活动项仍为 `mounts=0 / commits=0`**（本轮已实测 ✔，见 §4.4.4）。
  - A3（不坏，复现 S9）：切走后 60 s 内该栏目 RPC = **0**，**逐栏目各测一次**（8/8 必须全绿，任一泄漏即 FAIL）。
  - A4（哨兵）：`aria-current="true"` 的 navCell 恒为 **1**；`data-slot="settings.section"` 下可见面板恒为 **1**；语言切换后各栏目 label 正确刷新（防止门控/比较器吞掉 locale）。
  - A5（不坏）：`rafP50` = 16.7 ms 哨兵（同窗对照）；`ThemePresenter.apply` 的 `cost/script` 比**不劣化**；设置态 DOM 节点数在 dwell 期不随时间上升。
  - A6（不坏）：`/usage` 卡片的手动刷新仍无条件生效（`dsh-usage` 注释里的硬约束）。
- **回滚**：K1-① 单点回滚 = `settings-general:164` 还原为单条 `renderSlot(..., { only: active })`；K1-② 回滚 = `visible` 恒传 `true`；K1-③ 回滚 = 移除 `aliveRef` 判据（各自独立，**可分级回滚**：①+/②成一档、③单独一档）。
- **热面/冷面**：**热面**（全部在 client bundle 内，刷新即生效；验收按 `served rev == 磁盘 sha1-12` 核对）。

#### K2 — 给设置段 `RootEntry` 加 memo 边界（断父路径级联）｜**热面**，但**单独做零收益**

- **形状**：`dsh-client-ui-renderer/lib/client.js:711` `RootEntry` 包 `React.memo`。
- **⚠️ 关键前提（必须写进落地单，否则重复"无 memo 推定"式错误）**：`RootEntry` 的 props 含**每次渲染新建**的 `ownerProps`（`SettingsPanel:164` 的 `{ close: onClose }`、`SettingsRoot:175-191` 的 `renderSlot("settings.trigger", { wide })`）⇒ **默认浅比较必然失配 ⇒ 单独加 memo 的收益为零**。要拿到收益必须**同时**稳定 `ownerProps`/`opts` 的对象身份（或给 memo 传自定义比较器）。
- **收益**：设置段 `RootEntry`/`SlotErrorBoundary` 渲染/commit 从 **0.706–0.833 → ≤0.05**（同窗对照；已确证基线）。
- **风险**：自定义比较器若比较不全，会**吞掉真实更新**（最典型是 locale label 与 slot 版本变更）⇒ 必须显式比较 `label`/locale revision/slot version 三项（`root-subscriptions` F3 已指出同一风险）。
- **验收**：A1 = 上述比值达标；A2 = 内容签名对照（DOM 文本哈希在 N 个 commit 上不变 + 一次真实内容变更必须被传播）；A3 = 语言切换回归（切换 locale 后设置页文本 100% 更新）；A4 = `rafP50` 哨兵不变。
- **回滚**：删一行包裹（热面）。
- **热面/冷面**：**热面**。

#### K3 — 钉死 `SettingsRoot` 自渲染的点火源（**测量优先，不是修法**）｜热面（只读探针）

- **形状**：在 `SettingsRoot` 上装**只读**三通道渲染原因探针：① `useSections` 输出引用身份 ② `ctx.locale.getSnapshot().revision` ③ `ctx.slots.getVersion("settings.section")` ④ 父链 `RootEntry.pw`。同窗记录四者在每次自渲染时的取值变化。
- **为什么必须**：`root-subscriptions` item 10 明确判 **INCONCLUSIVE**（22 槽逐字节相同、父链静默、store 静默）；`MEASUREMENT-STATUS.md` §6.0.bis.2 明确禁止把 locale revision 当既定点火源。**在点火源未钉死前，任何"给 SettingsRoot 加内容比较器"的修法都是盲修**（可能修在没点火的那条路上）。
- **收益**：不承诺性能收益；产出的是**可判定的点火源**，把 K1/K2 的收益从"可能"变成"可预测"。
- **风险**：探针自身有成本（读取 hook 槽）⇒ 只读、且必须与 `none` 对照同窗比较以扣除自身成本。
- **验收**：在 ≥2 个独立运行中，四通道之一在**每次**自渲染上取值变化（比值 1.000），或四者全不变 ⇒ **判定"点火源不在订阅层"**（那本身就是可落地的结论，指向 `SlotOutlet` 的 element 重建或 React 调度）。
- **回滚**：移除 init script（热面）。
- **热面/冷面**：**热面**。

#### K4 — sessions 快照 store 的消费者侧收窄｜**热面**

- **形状**：为 `runtime:8963` 的 sessions list store 提供字段级 selector，替换掉恒等选择器消费者；或给消费该快照的列表组件加 memo 边界。
- **依据**：C4（`session.list` 落地 ⇒ 38 连发 commit × 600 fiber）已确证；`update` 路径无内容闸门（§3.1），但**注意 §3.1 的收紧**：只有当 action 真的写了 draft 字段才会通知 ⇒ 收窄 selector 的收益是**减少每次通知的渲染面**，不是"消除通知"。
- **风险**：selector 收窄会引入"漏更新"（选中态/未读标记等边缘字段）；必须在 selector 里显式包含所有渲染用到的字段。
- **验收**：A1 = 该 store 每次通知触发的渲染 fiber 计数比值下降（同窗）；A2 = 会话列表/未读/选中态在真实事件流下逐项回归（含 201 条 running 计数哨兵）；A3 = DOM 文本哈希在"仅运行时长变化"的通知上不变。
- **回滚**：还原为恒等选择器（热面，单行）。
- **热面/冷面**：**热面**。

#### K5 — 虚拟化「插件列表」目录（**已由既有裁决背书**）｜**热面**

- **形状**：`dsh-client-ui-settings-plugin-inventory/lib/client.js:150` 是裸 `filteredEntries.map((entry) => {…})`（每插件一个 `<li>` + 图标，无窗口化、无分页）。改用 `@tanstack/react-virtual` —— **该依赖已安装且已被 `dsh-client-ui-trajectory` 使用**（静态档 F6），无需新增依赖。
- **收益**：`incident2/VERDICT.md` D2 已确证该子标签 **1820 节点 / 192 SVG**（通用设置的 4.3×/13.7×），并明确"**仅支持"客户端列表虚拟化"这一条修复**"。⇒ 本候选与既有裁决一致，非新增主张。
- **风险**：卡片有可展开详情态（`:66`）与 `aria-controls`/锚点（`:156-158`）；窗口化必须保住键盘/a11y 语义与 `data-plugin-entry` 钩子。RPC/缓存类收益**已撤回**（D2），不得夹带。
- **验收**：A1（计数）：同一列表的 DOM 节点数从 1820 降到 ≈ 视口行数 × 常数（目标 ≤300）；A2（不坏）：`svg` 计数与卡片数关系、展开态、`aria-controls` 目标可达性逐项回归；A3（不坏）：列表滚动到底时最后一项与 `pluginInventory.list` 返回条数一致（不得丢行）。
- **回滚**：还原 `.map()` 一行。
- **热面/冷面**：**热面**。

#### K6 — 让高频 store 真正启用已写好的 `flush:"raf"` 合批｜**热面**，**低优先**

- **形状**：`dsh-client-runtime/lib/client.js:5402-5415` 的 `flush:"raf"` 分支是**死代码**（无任何调用点传 `flush`，`:5477`/`:8954`/`:8963`/`:9921` 都只传 `{persist}`）。为高频 store（布局三栏 `LY:278`、sessions list `RT:8963`）开启它，可把一帧内 N 次写合并成 1 次通知。
- **收益**：同窗对照的**通知次数 ÷ 写次数**比值下降（当前恒为 1.000，因为零个 store 走合批）。
- **风险**：`RT:5386-5394` 自陈的既有折衷——**挂载中的组件读到新状态、既有订阅者下一帧才听到 ⇒ 帧级瞬时不一致**。**受控输入（草稿）绝不能合批**（同 tick 回显是硬需求）⇒ 只能用于非输入类 store；且 `raf` 模式在后台帧率 1.5 Hz 时会把通知拖到下一帧（依赖物理帧产出），需与 §0 的"不以 `visibilityState` 当帧在产出证据"口径一起看。
- **验收**：A1（比值）：目标 store 的 通知/写 比值 < 1.000 且 ≥1 帧内合并；A2（不坏）：受控输入逐键回显无丢失（不允许对输入类 store 开启）；A3（不坏）：`rafP50`/内容签名哨兵不变。
- **回滚**：移除调用点的 `flush` 选项（单点）。
- **热面/冷面**：**热面**。

#### 显式**不做**（避免重复劳动）

`settings-models` 行级 memo/虚拟化（已否决）、两个 object selector 的"整对象 selector"方向（已排除）、`cssText` 合并（`BATCH-PLAN` 已定不做）、C2 观察器收窄（收益可忽略）。

---

## 7. 逐条 PASS / FAIL / INCONCLUSIVE 总表

| # | 结论 | 判据 | 依据 |
|---|---|---|---|
| 1 | served 字节 == 磁盘字节（4/4 抽样） | **PASS** | `raw/served-vs-disk.json`；§1 |
| 2 | 并发/锁纪律：全程非独占、外来浏览器 3/窗口、锁被兄弟线持有、本线未回收 | **PASS（如实记录，据此降级绝对值）** | §2.1；`raw/concurrency-census.json`、`raw/w01-run.log` |
| 3 | `settings.section` = `kind:"list"`，`only` 过滤在 `renderer:845` | **PASS** | §4.2 |
| 4 | 切栏目 = **完整 unmount/remount**（keyed by `e${entryKeyOf(entry)}`），**不存在 keep-alive** | **PASS（代码级确定性）** | §4.2；全库 `keepAlive` 零命中 |
| 5 | 8 个栏目**全部**用组件本地 `useState` 承载页面状态；2 个例外数据在 store 但挂载仍重取 | **PASS** | §4.3（静态档 F1） |
| 6 | 设置打开路径祖先链 `react.memo` 计数 = **0**（对照 conversation 15） | **PASS** | §3.3（静态档 F5） |
| 7 | `update` 路径无内容等值闸门；但 zustand `Object.is` 使**零字段写入不通知** ⇒ "produce 恒新引用"须收紧为"至少一次 draft 写" | **PASS（含表述收紧）** | §3.1；`runtime:4745-4747`/`:5418-5421` |
| 8 | `flush:"raf"` 分支是**死代码**（无调用点传 flush）⇒ 零个 store 走 rAF 合批 | **PASS** | §3.1 |
| 9 | 设置页重渲染的真实耦合 = "任意通知/版本 bump ⇒ `SettingsRoot` 自更新 ⇒ 无 memo 结构向下放大整树"，非精细 slice 订阅 | **PASS** | §3.3（9052 commit 三独立运行） |
| 10 | `SettingsRoot` 自渲染的**最终点火源** | **INCONCLUSIVE（沿用前线结论，本轮不重裁）** | §3.3；`root-subscriptions` item 10；`MEASUREMENT-STATUS` §6.0.bis.2 |
| 11 | 每 commit 的绝对 fiber 数 / commit 速率 / 每栏目切换的绝对 ms | **INCONCLUSIVE（并发）** | §2.1 |
| 12 | 「输入框每字符重渲染」的否证证据 | **INCONCLUSIVE（证据缺位）** | §5 —— 工作区无落盘证据，本线不引用 |
| 13 | **live 通道自证**：页内 `setTimeout` 120 ms 忙循环被 **三通道同时如实报出**（RunTask 120.49/120.18/120.09 ms；LoAF 121/121/121 ms；wall-clock rAF 121.9/121.2/121.7 ms），阴性对照（同 20 s、`none`）RunTask max 0.75/2.70 ms、LoAF 0、rAF max 17.4/17.7 ms；`RunTask` 每窗非空（11 088–23 008 条）⇒ 类别写对、无静默空通道；窗口播种可见地满足（块前那一帧 16.7 ms 被保留） | **PASS（3/3 三通道）** | §3.4.1 |
| 13b | **引擎与 DPR 自证**：`HeadlessChrome/131.0.6778.33`（UA 读回）、页内 `devicePixelRatio = 1`、canvas backing/CSS = 100/100 px，**未用** `--force-device-scale-factor`；headless ⇒ 无 GPU 合成，绝对 ms 只对主线程 JS/布局成立 | **PASS** | §3.4 |
| 13c | **空闲态基线（阴性）**：`home-idle` 3 commits/20 s、`RunTask max 3.05 ms`、`over40ms 0`、`rafMax ≤ 38.8 ms`、LoAF 0 ⇒ 无活跃事件流时客户端渲染主干**不产生任何长任务/长帧** | **PASS（阴性）** | §3.4.2 |
| 13d | **commit 与 WS 帧**：约 **126–245 个入站帧对应 1 次 commit**（"每帧一次 commit"不成立）；每窗 DOM 文本长度 **distinct-count = 1** ⇒ churn 发生时可见内容未变（独立复现 slot-churn 的 0/9052） | **PASS（比值/为零）** | §3.4.3 |
| 13e | **重渲染归属**：`SlotOutlet` 202（12.2%）+ `SlotErrorBoundary` 150（9.1%）+ `RootEntry` 134（8.1%）≈ **29%** 的已归因渲染 ⇒ 成本由**槽渲染管线**主导，且 **parent-driven 79.2% / self 3.1% / root-props-changed 17.6%** | **PASS（结构性）**；⚠️ 压缩名（`R7`/`Z9`/`Vu`…）无法定位源文件 | §3.4.5 |
| 13f | **M2 的通知级量化**（每次 store 写的重渲染次数） | **INCONCLUSIVE**（uSES 形状匹配命中 0 个订阅者实例；`{7,12,17}` 假设既未使用也未确认） | §3.4.4 |
| 13g | **live 导航行 = 8 行**，逐字：通用设置/模型/插件/Agent 预设/远程工作区/分布式控制 · dsh-ssh-gui/vision-adam 识图设置/子代理模型（三次独立会话一致）⇒ 与 8 个代码级注册者一一对应，**7 vs 8 差异闭合** | **PASS** | §4.4.1；`raw/settings-nav-rows.json` |
| 13h | **② 的渲染侧代价**：每次切换 **mount fiber 16–156**（插件 126）、content 节点在 8 个栏目各自水平间**上下波动**（97↔49↔353↔…）而**不累加** ⇒ 切走即卸载；**重复点击已活动项 = `mounts 0 / commits 0`**（阴性内对照） | **PASS（fiber 级 + DOM 双证）** | §4.4.2/§4.4.4 |
| 13i | **② 的取数侧代价（本线纠正了测量档的相反结论）**：**插件每次访问重发 9 个 `/usage/*`**、分布式控制 4 个、远程工作区 1 个、Agent 预设 1 个、通用设置 1 个；**唯一例外是模型（2→0）**（`settings-models:1856` 的 `status === "idle"` 闸门）。三个独立运行的每个 cycle 一致 | **PASS（计数类，不受并发污染）**；测量档"no re-fetch"结论**作废** | §4.4.3 |
| 13j | **单次切换的帧级影响**：32 次切换 `RunTask max ≤ 20.3 ms`、**LoAF 0**、`rAF max ≤ 23.2 ms`，**无一越过 50 ms**；`click→帧1` 11.6–20.1 ms、`click→帧2` 28.1–31.5 ms | **PASS** ⇒ 不宣称 keep-alive 消除可感卡顿 | §4.4.2/§4.4.4 |
| 13k | **新观察（未决）**：`settings-open-dwell` **同一场景同长度窗口 commit 数相差 ~100×**（2 vs 238 vs 339）⇒「设置打开」不是一个状态 | **INCONCLUSIVE（顺序相关已观察、因果未证）** | §3.4.2bis |
| 14 | **`AppFrame` 的 `useStore((s)=>s)`（`layout:159`）⇒ 布局 store 任一字段写入即整棵三栏 shell 重渲染** | **PASS（代码级）** | §3.2；静态档 F4 |
| 15 | **仓库内已存在可用 keep-alive（`settings-plugins:419/489-500`）与副作用可见性门控（`dsh-usage:774-810/983`）** ⇒ "无 keep-alive"是**实现不一致**而非能力缺失 | **PASS（代码级，两处均在产运行）** | §4.2bis |
| 16 | **`settings.general.item` 注册者 = 6 个，均非 `dsh-usage`**；9 个 `/usage/*` 属「插件」栏目的 `settings.plugin.item` 卡片（静态档 F6 在此处有误，已更正） | **PASS（本线复核更正）** | §4.3 注；`@local/dsh-usage:1232` |
| 17 | K1–K6 修复候选的收益/风险/验收/回滚 | **给出（未落地，本轮只读）** | §6.2 |

---

## 8. 未决 / 边界（诚实清单）

1. **`SettingsRoot` 自渲染点火源未钉死**（K3 是为此设计的只读探针）。在此之前，K2/K3 的收益**不可先验声明**。
2. **K1b（真 keep-alive）与 C1（`ThemePresenter.apply`）存在对抗关系**：keep-alive 抬高设置态 DOM 常驻量，而 `apply` 成本随 DOM 规模单调放大（已确证）。**K1b 落地前必须有 DOM 规模 × `apply` 成本的 A/B**；在拿到该 A/B 前，只推荐 **K1a**（保数据、不保渲染结构）。
3. **本机并发不可消除**：本轮 3 个外来浏览器 + `loadavg 7.07`。任何"独占窗口"需求必须由协调者串行排期；本线**不宣称**任何绝对性能数字。
4. **`@local/dsh-ssh-gui` 与 `dsh-workspace-enhancement` 的取数 effect 无 cleanup** 是既有缺陷（不是本轮引入，本轮不改）；K1a 落地时必须一并处理，否则会引入"晚期响应覆盖缓存"的竞态。
5. `program/w12-input-ux/` 尚无 `audit.md`；本线无法核实"输入框每字符重渲染已证伪"的原始证据。
6. **`settings-open-dwell` 的双峰（~100× commit 差）未定案**：观察到"刚打开 ≫ 静置后"的顺序相关，但**未证明因果**；需 M-oscillate（固定"打开后 T 秒"为自变量、≥3 等长窗、随机化顺序、同时记录 WS 速率与 `dsh-usage` 轮询触发计数）才能把"打开写入风暴"与"周期轮询"分开。
7. **布局写入场景未测**：`AppFrame` 的恒等选择器（`layout:159`）的后果（整棵三栏 shell 重渲染）需要"切换侧栏折叠 / 拖动分栏"类窗口才能判定，**本轮未做**（§3.2 的限定）。
8. **M2 的通知级量化缺失**：uSES 订阅者按形状匹配命中 0 个 ⇒ "每次 store 写的重渲染次数"没有直接数字；§3.1/§3.3 的机制结论仍只是代码级确证。
9. **入站 mux 帧分类口径偏差（测量档自陈）**：本轮按信封 `method` 而非协议要求的 `payload.type` 分类 ⇒ 本报告只使用帧**总数**，不使用其按类拆分。
10. **全部 live 窗口 `valid:false（CONTENDED）`**：19 个窗口、0 个有效；其中一次拿到锁（`lockMine=true`）仍因外来浏览器普查 1–2 个而未通过 ⇒ 绝对 ms 一律 INCONCLUSIVE（这是本机常态，非本线失误）。
11. **headless 保真度**：本轮引擎为 headless Chromium ⇒ 无 GPU 合成，"无长帧"结论只对**主线程 JS/布局**成立，不代表有头 4K 呈现路径。

---

## 9. 复核与复现方法（供独立核对）

```bash
# 1) 确认引用的 file:line 就是浏览器执行的字节（热面口径）
curl -s http://127.0.0.1:3080/plugins/@deepseek-ai/dsh-client-ui-settings-general/client.js | sha256sum
sha256sum ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js
# 期望两者 sha256-12 均为 bd7edeaec382（其余三个包见 raw/served-vs-disk.json）

# 2) 无 keep-alive 的三行锚点
sed -n '164p' .../dsh-client-ui-settings-general/lib/client.js     # renderSlot(..., { only: active })
sed -n '845p;847p' .../dsh-client-ui-renderer/lib/client.js        # 过滤 + keyed by e${entryKeyOf(entry)}

# 3) 仓库内已有的 keep-alive 与副作用门控先例
sed -n '415,427p;489,500p' .../dsh-client-ui-settings-plugins/lib/client.js
sed -n '774,812p;974,993p' ~/.dsh/profiles/node_modules/@local/dsh-usage/lib/client.js

# 4) produce 的引用语义与唯一闸门
sed -n '5416,5422p' .../dsh-client-runtime/lib/client.js
sed -n '4745,4748p' .../dsh-client-runtime/lib/client.js

# 5) 8 个栏目注册者（注意必须同时含 profile 根的 scoped / unscoped 两处）
grep -rn 'name: "settings.section"' \
  ~/.npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/*/lib/client.js \
  ~/.dsh/profiles/node_modules/@local/*/lib/client.js \
  ~/.dsh/profiles/node_modules/@deepseek-ai/*/lib/client.js \
  ~/.dsh/profiles/node_modules/dsh-workspace-enhancement/lib/client.js

# 6) 「插件」栏目进入一次的分发数（只读 RPC，计数类）
curl -s -X POST http://127.0.0.1:3080/api/settings.describe -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"'"$(cat /proc/sys/kernel/random/uuid)"'","method":"settings.describe","payload":{}}' \
  | python3 -c 'import json,sys;d=json.load(sys.stdin);print(len(d["result"]["value"]["namespaces"]))'   # 期望 20

# 7) live 探针（沿用本线器械；需先按 lib/probe-lock.mjs 取锁）
node tools/probe-w01.mjs --help
node tools/probe-w01.mjs --window 20 --dwell 2.5 --lock-wait-ms 480000
node tools/analyze-w01.mjs
```

**静态耦合全表可重建**：`raw/_gen.py` + `raw/_gen_md.py` 从 live bundle 重新生成 `raw/static-coupling.json` 与 `static-coupling.md`，
可与本报告的 `sha256_12` 逐条对拍（生成后曾重新 hash 22/22 一致、0 漂移）。
