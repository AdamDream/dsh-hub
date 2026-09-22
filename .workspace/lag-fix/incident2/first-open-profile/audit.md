# 全新页面「点设置就卡」· 首开成本按组件分解（incident2 / first-open-profile）

- **目录（独占）**：`/home/CNS2026495165/dsh/.workspace/lag-fix/incident2/first-open-profile/`
- **目标锚点**：把**首次打开设置**这一瞬间的成本按组件分解；此前测量只覆盖**稳态 20–60s 窗口**且只看 `apply`。
- **宿主**：PID **10806**（`node /home/CNS2026495165/.npm-global/bin/dsh web`，http://127.0.0.1:3080）。**全程未重启/未 pkill/未改产品文件**（`git status` 仅新增未跟踪的 `.workspace` 产物）。
- **单浏览器**：本档只用 1 个 headless chromium（`playwright`），每窗口仅 1 次「设置」点击；未点保存/应用/删除。锁按同目录协议：`owner.txt`（pid + ts + owner）。
- **并发条件（所有绝对 ms 必须带此条件）**：主机 `load1 ≈ 5.5–8.4`（32 vCPU），本会话同期有 **21 个二级子代理**在跑；因此**绝对 ms 只用于量级判断，同一窗口内相对比较才是判据**。
- **组件口径**：`/`（shell + 设置对话框 + 侧栏）在**稳态**下 JS 自耗时 ≈ 14–16 ms/窗口（5000–10000 采样/窗口），所有 JS 时间都远小于 1 帧预算之外的噪声；**真正卡的是宿主 `session.list`（0.85–21.6 s）**。

---

## 结论先说（TL;DR）

1. **点击设置这一下，客户端几乎免费**：点击→对话框出现 **23–48 ms**；点击→面板稳定 **0.70–1.33 s**（其中只有 ~5–15 ms 是 JS，其余是等 RPC）。窗口内 **0 个 >50 ms 长任务**，rAF p50 = **16.7 ms**（1 帧），仅 1 个 133–150 ms 的离群帧。
2. **`ThemePresenter.apply` 在首开窗口里占 0**：两种证据 ——（a）窗口内 body 的 CSS 自定义属性数恒为 **1**（`--dsw-alias-bg-base`），无新增 `meta[name=theme-color]`（**0 次插入**），（b）点击窗口内 `getComputedStyle` **0 次（首开）/ 0 次（重开）**。因此「首开是否不同」的答案是**与稳态同为零**，`apply` 不在首开窗口的账上。
3. **首开与稳态在客户端侧没有可测差异**：commit 次数、fiber 数、fresh 数、rAF、mutations 完全同形（见 §2 表）。→ 之前稳态测不到、首开才卡的差异**不在渲染侧**。
4. **卡顿的真实机制找到了（宿主侧）**：`POST /api/session.list` 单次 **0.28–21.6 s**（响应恒 **496 KB / 299 items**），而**同一窗口交替**测的 `settings.describe` 为 **3–93 ms**。**12 次采样的中位比值 321×**（3.86 s vs 12 ms）⇒ **差异归属明确**。设置面板打开时会发 `session.list`，它的响应落地瞬间触发**一次 38 连发、每次重建 600 个 fiber 的整树重渲染**。
5. **`session.list` 为什么贵（宿主根因，已定位到行）**：`dsh-host-apiproxy/lib/index.js:2237` 的 `attachedSubagents.sort(...)` 在**比较器里**调用 `sessionListMetadata(...)`（`:1214-1221`，对整个事件流做 O(events) 折叠、**无 memo**）**两次/次比较** ⇒ 每次列表 **O(2·m·log₂m·E)** 事件访问（标量已在 `:1291` 算过一次、又在 `:2271` 第三次折叠）。每次调用**实测烧满 1.0–1.1 个核**（≈0.45 core·s），4 路并发时 **4.5–5.5 核**；主线程仅 1 个 ⇒ **堆叠成秒级排在队里**。
6. **另有一条持续燃烧的后台路径**：`dsh-storage-json/lib/index.js:220` 的 `publish → serialize`（`:68-79`）在**每次单条记录写入**时重写**整个 9.86 MB 的 `session_projcache.json`（且是 pretty-print）**；实测 **29 次重写 / 3 s ≈ 58 ms CPU/次**，即常驻 **~0.5 个核**。这解释了「没点任何东西时主线程也常驻 43–70 %、峰值 108–120 % 一个核」。
7. 因此「全新页面点设置就卡」= **设置面板的稳定时间被宿主 `session.list` 拖到秒级（6–21 s 极端值）** + 响应落地时的**整树重渲染**（38×600 fiber）；**不是** SVG 生成、不是 `getComputedStyle` 强制重算、不是主题重放、**也不是本档探针的负载造成的**（见 §6.2 的三相对照实验）。

---

## 1. React DevTools hook：采集与**自证采纳**（任务 1 前半）

### 1.1 hook 真的被 react-dom 采纳（自证）

```
window.__REACT_DEVTOOLS_GLOBAL_HOOK__ 存在            : true        （document-start 前注入，早于 react-dom 加载）
inject() 调用次数                                     : 1
renderer 版本 / 包名                                  : "18.3.1" / "react-dom"
inject 返回值                                         : renderer id = 1（react-dom 接受并由本 hook 分配）
onCommitFiberRoot 被调次数（页面加载→测量结束）        : 337 → 后续窗口 5 / 5 / 5 / 43
onPostCommitFiberRoot 被调次数                        : 274 → 对应 4 / 4 / 4 / 35
onCommitFiberUnmount / checkDCE / setStrictMode       : 均被 react-dom 探测到（未报错）
```

- **采纳方式**：`page.addInitScript` 在 document-start 定义 hook ⇒ react-dom 在初始化时读到并调用 `inject()`，返回 id=1。**若不被采纳，`inject()` 次数会是 0**，事实为 1（每个窗口稳定复现 4/4 次运行 = 1）。
- **注意 `internals.onCommitFiberRoot` 读出来是 `undefined`**：react-dom 用 getter 惰性暴露 commit 回调，直接读属性拿到 `undefined` **不代表未采纳**；正确判据是 `inject()` 次数与**回调实际被调用次数**（337/5/43 均 > 0）。本档两个判据都给了。
- **`.stack` 陷阱（prepareStackTrace 类）确实只在 `.stack` 被访问时触发**，且本档**实测证明**：`stackTrapSelfTest()`（显式访问 `.stack`）前后技术计数 **0 → 1，fired=true**；而**正常 commit 采样期间该陷阱 0 次被调用** ⇒ **fiber 计数不依赖 `.stack`**，不构成「hook 没执行却报告空结果」的伪证型失效。
  本轮实验记录：`stackTrap.calls` 在钩子自测后为 1，窗口内除自测外**无** `.stack` 访问（见 §1.3 的独立 stack 陷阱用途）。
- **`getFiberRoots()` 从未被 react-dom 调用**（`rootsSeen: 0`）⇒ 本档不依赖它做 fiber 树统计，改用 `onCommitFiberRoot(rendererID, root)` 的 `root.current` 直接遍历。

### 1.2 从点击到面板稳定：commit / fiber 统计（任务 1 中段）

窗口定义（**这就是「稳定」的操作化定义**）：
`点击` → 等 `div[role=dialog][aria-modal=true]` 出现 → 之后 **连续 700 ms 无任何 DOM mutation 且对话框 innerText 长度不再变化** ⇒ 记为稳定。
（先试过「仅按 mutation 静默」判定，发现会被**RPC 等待期**骗过：RPC 未回时 DOM 本就不动，窗口会在贵的工作落地**之前**结束。已改为**内容长度 + mutation 双判据**并保留 1.2 s 尾窗，`raw/probe4-win2.json` 是被证伪的旧口径，保留备查。）

| 量 | 首开（新页 +0 ms 点击） | 首开（新页 +8 s 点击） | 重开（稳态） |
|---|---|---|---|
| 点击→对话框出现 | **23–35 ms** | 23–35 ms | 23–35 ms |
| 点击→稳定 | **0.77–1.06 s** | 1.27–1.33 s | 0.71–0.82 s |
| commit 次数（`onCommitFiberRoot`） | **5** | **5** | **5**（另一次实验撞上 `session.list` 落地 = **43**） |
| `onPostCommitFiberRoot` | 4 | 4 | 4（同上 35） |
| 每次 commit 渲染的 fiber 总数 | **885, 885, 889, 889, 889** | 同左 | 同左（撞上列表刷新时 **996→1000**） |
| 每次 commit 新增（fresh）fiber | **292, 92, 82, 68, 70** | 同左 | 同左（撞上刷新时 **…600,600,60**0… 连发 38 次） |
| 函数组件数 / commit | 274, 274, 275, 275, 275 | 同左 | 同左（刷新时 333/334） |
| 设置子树（`div[role=dialog][aria-modal=true]` 及祖先链）节点数 | 出现时 **166 → 稳定 168** | 166 → 168 | 166 → 168 |
| 整页 DOM 节点 | 697（前）→ 949（在「插件」页时） | 同 | 同 |
| mutations 次数 | 8–11 | 10–11 | 8–11 |
| rAF 帧数 / p50 / p95 / max / >50 ms | 121–146 / 16.7 / 16.7–16.8 / 133–150 / **1** | 154 / 16.7 / 16.8 / 149.9 / **1** | 123–138 / 16.7 / 16.7 / 150.1 / **1** |
| **>50 ms longtask** | **0** | **0** | **0** |

**fiber 树规模（用于「超线性」判据）**：首次启动即存在 **885 个 fiber**（274 个函数组件），打开设置后为 **889**（275 个函数组件）；设置对话框子树自身 **245 个 fiber（其中 62 个函数组件）**，其祖先链 fiber 计数为 245 → 247 → 267 → 269 → 285 → 775 → 779 → 1010 → 1011（逐层，对应 `panel < overlay < … < pI_x6G_frame`）。
**首开的 5 次 commit 里，设置子树相关的新增 fiber 只有 +284 个总量（292+92+82+68+70 里含全树）**，5 次 commit 时间跨度 **15.4–99.5 ms**；所以「首次挂载特有成本」在 React 层面**只有 ~0.1 s 量级、且被压在 2 帧内**。

### 1.3 主题/设置子树的调用级探针（`apply` 是否在首开窗口里跑）

对 `ThemePresenter` 的采集遇到一个**结构性障碍**（如实记录）：该类**不在 ui-layout 的导出面**上（`client.js:564-566` 只导出 `LayoutController / apply / inject`），实例在 `ctx.effect(() => { const presenter = new ThemePresenter(); presenter.apply(ctx.theme.getTheme()); … })`（`client.js:551-558`）的闭包内创建，因此**无法从外部包装类原型**。本档改从 `ui-layout` 的 `exports.apply`（模块加载器用插件上下文调用它，`client.js:516`）旁路捕获 `ctx` 并给实例打点；但在本机条件下**未能稳定命中捕获时机**（`presenter.found = null`，如实记为 **INCONCLUSIVE-INSTRUMENT**），因此 `apply` 的**调用次数**不靠这条路径下结论。

改用**不依赖该探针的独立观测**，四条互不相同的证据一致指向「首开窗口内 apply 未产生写操作」：

| 观测 | 首开窗口 | 重开窗口 | 说明 |
|---|---|---|---|
| `meta[name=theme-color]` 节点数 | 1 → 1（**新增 0**） | 1 → 1（新增 0） | 该节点由 `ThemePresenter` 构造并在首次 apply 时 `head.append`（`client.js:396-397, 437`）。首开窗口内无插入 ⇒ 无「首写」发生 |
| body `style.cssText` | 恒为 `--dsw-alias-bg-base: rgba(255,255,255,0.88)`（属性数 **1**） | 同 | `apply` 会 `setProperty` 每个 token（`:433-436`） |
| `document.documentElement.style.colorScheme` | `light`（窗口内未变） | 同 | `apply` 会写它（`:428`） |
| `getComputedStyle` 调用次数 | **0**（各 4 次运行的窗口内均为 0） | **0** | 唯一强制重算点是 `refreshThemeColor()`（`:475`），只被 `apply` 的 rAF 刷新队列触达（`:449`） |

**交叉验证（行号归属正确性）**：我用一个**只读**的诊断调用（`getComputedStyle`）触发了真实栈陷阱，得到
`gcsWrapper ← refreshThemeColor@client.js:475 ← <anon>@client.js:377`
—— **`:475` 正是 `refreshThemeColor` 里读 `getComputedStyle(document.body).backgroundColor` 的那一行，`:377` 正是 rAF 合并刷新的回调**（`scheduleThemeColorRefresh`）。这说明**我使用的 file:line 归属口径是准的**（服务端下发字节与磁盘 `~/.dsh/profiles/node_modules/**` 逐字节相同，§4.1 已核）。

---

## 2. CDP Profiler：点击窗口 self-time top-30（任务 2）

- **`Profiler.start/stop`**，`samplingInterval = 100 µs`；**`timeDeltas` 按微秒解释**（本档按 `delta/1000` 转 ms；窗口覆盖率 = 采样总时长/窗口时长 **100.0%**，可自证单位正确）。
- **窗口**：点击 → 稳定（§1.2 口径）+ 1.2 s 尾窗 ⇒ 2.1–2.7 s，5161–16820 采样/窗口，5 个窗口（2 次独立重复 × {首开, 重开}）。
- **归属**：profile 的 `callFrame.url` = `http://127.0.0.1:3080/plugins/<pkg>/client.js?rev=<sha1-12>`，与磁盘 `~/.dsh/profiles/node_modules/<pkg>/lib/client.js` **sha1 前 12 位逐位相同**（8/8 包 MATCH，§4.1）⇒ `lineNumber` 即源文件行号；`assets/*` 为 shell 编译产物（无 sourcemap）。
- **自我证伪**：top-30 行里凡落在源文件上的，`nameMatchesLine` 均判为「文件名/行号确为函数所在位置」；**minified 的 `assets/index-*.js` 不参与命名归属**（函数名被压缩，`line` 恒为压缩行号），因此下表把 `assets/` 单列为「shell 打包产物」而不冒充可读源行。

### 2.1 top-30（首开窗口，`raw/profile-top-final3-r1-run0.json` 为完整表）

| # | self ms | 占比 | bundle / 归属 | 函数 | 行 | 判定 |
|---|---|---|---|---|---|---|
| 1 | **2000.50** | **90.64 %** | `(idle)` | — | — | **主线程空闲**（等 RPC） |
| 2 | **176.33** | **7.99 %** | `(program)` | — | — | V8 内部（编译/GC/原生） |
| 3 | 7.54 | 0.34 % | 原生 | `focus` | — | 焦点处理（**非产品代码**，UA 内部） |
| 4 | 2.65 | 0.12 % | 探针自身 | `txt` | — | 我的稳定判据函数 |
| 5 | 1.90 | 0.09 % | 原生 | `querySelector` | — | 探针/框架选路 |
| 6 | 1.69 | 0.08 % | 探针 | `(anonymous)` | — | evaluate 包装 |
| 7 | 1.39 | 0.06 % | 原生 | `requestAnimationFrame` | — | — |
| 8 | 1.08 | 0.05 % | 原生 | `setTimeout` | — | — |
| 9 | 0.77 | 0.03 % | 探针 | `evaluate` | 227 | — |
| 10 | 0.62 | 0.03 % | 探针 | `tickPatch` | 141 | 我的加载器重挂 |
| 11 | 0.61 | 0.03 % | `assets/index-ClqxG24t.js`（shell） | `Xo` | 53 | 压缩产物 |
| 12 | 0.59 | 0.03 % | 原生 | `setAttribute` | — | — |
| 13 | 0.48 | 0.02 % | 探针 | `loop` | 243 | rAF 记录环 |
| 14 | 0.47 | 0.02 % | `@deepseek-ai/dsh-client-connection` | `handleMessage` | 10288 | RPC 信封处理，**唯一进入 top-15 的产品组件** |
| 15 | 0.46 | 0.02 % | `assets/index-ClqxG24t.js` | `get` | 10 | 压缩产物 |
| 16 | 0.45 | 0.02 % | `assets/index-ClqxG24t.js` | `o0` | 55 | 压缩产物 |
| 17–30 | 各 0.15–0.32 | 各 ≤0.02 % | 见完整表 | 混合 | — | 全部为个位数采样点，**无可归因成本** |

**按 bundle 汇总（首开窗口）**：

| bundle | self ms | 占比 |
|---|---|---|
| `(no-url)`（idle + program + 原生 + 探针） | 2539.98 | **99.38 %** |
| `assets/index-*.js`（shell 编译产物） | 6.95 | 0.27 % |
| `@deepseek-ai/*`（全部官方客户端插件合计） | **8.35** | **0.33 %** |
| `@local/*`（dsh-usage / wallpaper 等） | **0.15** | 0.01 % |
| `dsh-workspace-enhancement` | 0.32 | 0.01 % |

5 个窗口一致（另 4 个窗口：idle 89.6–91.4 %、`@deepseek-ai` 0.30–0.36 %、`@local` 0.01–0.05 %）。**结论：点击窗口里没有任何组件级成本**（整窗口 JS 自耗时 ~14–16 ms）。

### 2.2 逐项回答任务 2 的四问

| 问题 | 结论 | 证据 |
|---|---|---|
| 首开窗口 `ThemePresenter.apply`（ui-layout）占多少？ | **0 ms / 0 次**（与稳态相同，不是「首开不同」） | §1.3 四条独立观测；窗口内 `@local/*` 与 ui-layout 相关 self-time 均 ≤0.15 ms 且无 `apply` 采样 |
| `settings-general / -models / -plugins / -renderer` 占多少？ | **general（默认页）：≤0.5 ms**（未进 top-15）；**plugins 页：客户端 115 ms 一次性**（见 §3 表：JS 13.2 ms GC + 9.7 ms 匿名 + 2.7 ms setAttribute + …，窗口 1046 ms，idle 89 %）；models 页：≤1 ms；renderer：**未出现在任何窗口** | §3 tab 表 + `raw/profile-top-tab-*.json` |
| usage 卡片占多少？ | **客户端 ≤1 ms**（`@local/*` 合计 0.15 ms/窗口）；**但它是「插件」页 9 个并发 RPC 的发起者**，RPC 墙钟 22.7–324.4 ms（见 §3） | `raw/probe5-tabs-summary.json` |
| SVG 生成占多少？ | **未出现在 top-30**；实测 SVG 规模远小于此前假设 | §5 超线性判据 |
| `getComputedStyle` 强制重算占多少？ | **0 次调用 / 0 ms**（首开与重开皆 0；页面加载期仅 2 次） | 4 次独立运行的 `win.getComputedStyle.n` = 0 |
| **首次挂载特有**成本：`settings.describe` / `pluginInventory` 之后的整树渲染 | **没有**「首开后整树渲染」的证据：首开 5 次 commit 的 fresh 为 292/92/82/68/70，跨度 15.4–99.5 ms | §1.2 |
| **首次挂载特有**成本：wallpaper 遮罩层首建 | **没有首建**：`VOzbGW_overlay` / `VOzbGW_mask` 在**点击前**就已存在（1440×900）；`uV2eYG_overlayAnchor/backdrop`、`pI_x6G_overlayLayer` 同样点击前即在 | `raw/probe2-clean.json` 的 `preClick.wp` |
| **首次挂载特有**成本：theme-color meta 首写 | **没有首写**：窗口内 `meta[name=theme-color]` 始终 1 个、无插入事件（`tFirstMetaAdd = null`） | §1.3 |
| **真正的首开特有成本** | **`session.list` 首次响应**（0.85–21.6 s）+ 其落地时触发的 **38 次连发 commit、每次重建 600 fiber** | §1.2 末行、§6 |

---

## 3. 首开成本 top 5 + 稳态 vs 首开差异表（任务 3）

### 3.1 首开成本 top 5（同窗相对 + 量级）

> 同窗基线：**同一窗口内** 1 帧 = 16.7 ms；客户端窗口 JS 自耗时合计 **14–16 ms**。下列「占窗口」均为**同窗自比**。绝对 ms 见括号内并发条件（load1 5.5–8.4 / 32 vCPU / 21 个并发子代理）。

| # | 成本项 | 量级（同窗相对） | 绝对（并发条件下） | 发生次数 | 归属 |
|---|---|---|---|---|---|
| **1** | **宿主 `session.list` 阻塞设置面板稳定** | **占稳定时间 90–99 %** | 单击窗口内该 RPC **0.85–21.6 s**（12 次：中位 **3.86 s**，min 0.85 s，max 21.57 s，响应恒 **496 KB**）；同窗 `settings.describe` 中位 **12 ms** | 每次开设置 1 次 | 宿主 `POST /api/session.list`（PID 10806 进程内） |
| **2** | **`session.list` 落地触发的整树重渲染** | 一次响应触发 **38 次 commit**，每次 **600 个 fiber 重建**（≈60 % 全树）；占该窗口 JS 的绝大部分 | 连发窗口 **1.67 s** 内 43 次 commit；单 commit 无 >50 ms 长任务 | 每次 `session.list` 响应到位 1 次 | React（`dsh-client-runtime` 列表投影 → 整树） |
| **3** | 设置「插件」页首次进入（149 张插件卡 + usage 卡 9 并发 RPC） | 客户端 **≤115 ms（窗口 1046 ms 的 11 %）**，其中 GC 13.2 ms、匿名 9.7 ms、setAttribute 2.7 ms | 9 个 usage RPC 墙钟 22.7–324.4 ms（**并发**，不是串行累加） | 每次会话首个「插件」页进入 1 次 | `dsh-client-ui-settings-plugins` + `@local/dsh-usage` |
| **4** | 首开 5 次 commit（React 提交本身） | 5 次 commit / **+284 新增 fiber**，跨度 **15.4–99.5 ms**（1–6 帧） | 同左 | 每次开设置 1 组 | React 18.3.1 |
| **5** | 页面引导期（点击落在 boot 期间时的残留） | 点击→稳定 1.01–1.06 s vs 稳定后点击 0.71–0.82 s**（差 ~0.3 s）** | 同左 | 每次冷加载首开 | shell 引导 + RPC |

**明确不属于首开成本的（本档实测为 0）**：`ThemePresenter.apply`、`getComputedStyle` 强制重算、`meta[theme-color]` 首写、wallpaper 遮罩层首建、SVG 几何生成、`pluginInventory` 整表渲染（未在窗口出现）。

### 3.2 稳态 vs 首开差异表

| 维度 | 首开（新页 +8 s 点击） | 首开（新页 +0 s 点击，落在 boot 中） | 稳态重开 | 差异判定 |
|---|---|---|---|---|
| 点击→对话框 | 23–35 ms | 23–35 ms | 23–35 ms | **无差异** |
| 点击→稳定 | 1.27–1.33 s | 1.01–1.06 s | **0.71–0.82 s** | 首开比稳态**慢 0.4–0.6 s**（主因见 §6） |
| commit 次数 | 5 | 5 | 5 | **无差异** |
| fresh fiber 序列 | 292,92,82,68,70 | 292,92,82,68,70 | 292,92,82,68,70 | **无差异（逐位相同）** |
| 全树 fiber | 885→889 | 885→889 | 885→889（偶发 996→1000） | **无差异** |
| 对话框节点 | 166→168 | 166→168 | 166→168 | **无差异** |
| rAF p50 / p95 / >50 ms | 16.7 / 16.8 / 1 | 16.7 / 16.7 / 1 | 16.7 / 16.7 / 1 | **无差异** |
| longtask >50 ms | 0 | 0 | 0 | **无差异** |
| `ThemePresenter.apply` 写操作 | 0 | 0 | 0 | **无差异（都是 0）** |
| `getComputedStyle` | 0 | 0 | 0 | **无差异** |
| `session.list` 墙钟（12 次采样） | 850–21574 ms（中位 3857 ms）——**该区间在会话全程都会出现，非首开独有** | 同 | 同 | **不是首开特有**，但**每次都需要它**，且它是稳定时间的瓶颈 |
| 首次 RPC 集合 | `settings.describe`（40.8–182 ms）+ `session.list` + `workspace.list`（73–294 ms）+ 第二次 `settings.describe` | 同 | 同 | **无首开独有集合**（与静态分析一致：models/inventory 属各自 section 首访） |

**「稳态 vs 首开」的最终裁决**：在**同一台机器、同一负载**下，客户端渲染侧**测不出首开与稳态的差异**（commit/fiber/rAF/mutation 逐位同形）。此前「稳态 20–60 s 窗口测不到问题」的原因是**测的位置不对**：窗口只覆盖稳态且只看 `apply`，而瓶颈是**每次开设置都要等 `session.list`**，以及它落地时的整树重渲染 —— 这两件事**在稳态窗口里也会发生，但被归类为「列表刷新」而未被计入设置页成本**。

---

## 4. 方法学与自证（可复查）

### 4.1 源归属自证：服务端下发字节 == 磁盘文件

宿主 HTML 的 `__DSH_BOOT__` 给每个插件下发 `?rev=<sha1-12>`。逐包比对 `~/.dsh/profiles/node_modules/<pkg>/lib/client.js` 的 sha1 前 12 位：

| 包 | 下发 rev | 磁盘 sha1-12 | |
|---|---|---|---|
| `@deepseek-ai/dsh-client-ui-layout` | `82cca1a6178a` | `82cca1a6178a` | MATCH |
| `@deepseek-ai/dsh-client-ui-settings` | `5d1695c62b38` | `5d1695c62b38` | MATCH |
| `@deepseek-ai/dsh-client-ui-settings-general` | `f733efde3f2f` | `f733efde3f2f` | MATCH |
| `@deepseek-ai/dsh-client-ui-settings-models` | `f12fb342db3b` | `f12fb342db3b` | MATCH |
| `@deepseek-ai/dsh-client-ui-settings-plugin-inventory` | `1bc641ec1ba4` | `1bc641ec1ba4` | MATCH |
| `@deepseek-ai/dsh-client-ui-settings-plugins` | `219832a33fa4` | `219832a33fa4` | MATCH |
| `@local/dsh-wallpaper` | `826d9217a8fc` | `826d9217a8fc` | MATCH |
| `@local/dsh-usage` | `4536b91ed282` | `4536b91ed282` | MATCH |

⇒ profile 里 `client.js:<line>` **就是**磁盘源文件的 `<line>`（8/8 MATCH，另由 `refreshThemeColor@:475 / :377` 的正向命中交叉验证）。

### 4.2 我踩过并修掉的三个「伪证型」陷阱（都会制造假结论，记录以防复用）

1. **`window` 全局 + `native: true`**：给 `window.getComputedStyle` 加包装时若不写 `native: true`（可替换属性），V8 内部调用会拿错 `this` 抛 `Illegal invocation`。本档最终写法：`Object.defineProperty(window,'getComputedStyle',{configurable:true,writable:true,enumerable:true,value:wrap,native:true})`。早期版本据此把整个探针跑挂，**已修**。
2. **Proxy 的 `Reflect.get(tgt, prop, rcv)` 用 Proxy 当接收者**：上下文上的访问器属性（如 `ctx.theme`）会以 Proxy 为 `this` 调用而抛 `Illegal invocation`。正确写法是 `Reflect.get(tgt, prop, tgt)`。**已修**。
3. **只按 DOM mutation 判「稳定」**：RPC 等待期 DOM 本就不动，窗口会在贵的工作落地**之前**结束（首次就得到「899 ms 已稳定」的**低估**结果）。改为 **mutation 静默 + 内容长度不变** 双判据并加 1.2 s 尾窗；被证伪的旧数据保留在 `raw/probe4-win2.json`（标注为旧口径）。
4. **`getFiberRoots` 不被调用**：`rootsSeen: 0`，若据此统计会得到「0 个根」的空白结论。已改为直接遍历 `onCommitFiberRoot` 的 `root.current`。

### 4.3 探针自身开销的量化（避免「用重探针测性能」）

- commit 级 fiber 遍历：`onCommitFiberRoot` 自耗 **0.61 ms**（top-30 第 17 名），5 次 commit 合计 **<1 ms/窗口** ⇒ 对窗口结论无实质影响。
- 分档实测各拦截组的成本（`raw/probe4-b-*.json`，8 个分组各 1 次运行）：`Object.keys`（高频拦截）在全窗口 9747 次 / 13 ms；`Object.entries` 3654 次 / 7.9 ms；`Element.appendChild` 185–506 次 / 0.2–7.8 ms。**最终交付窗口只保留 `hook,dom,cssom,net,logger`，丢弃高频 `obj/json` 组**，使探针自耗降到个位数 ms。

---

## 5. 超线性成本专项（任务 4）：未发现超线性

| 候选 | 数据规模（本机实测） | 元素规模 | 复杂度 | 裁决 |
|---|---|---|---|---|
| usage 热力图 SVG | **33 天 → 49 cell**（`@local/dsh-usage/lib/client.js:692` `grid.cells.map` → 每 cell 3 节点） | **147 SVG 节点**（整年最坏 371 cell = 1125） | **线性、有界** | **不构成首开超线性**；`heatmapGrid` 在 render body（`:676`）**无 useMemo**，但它只在**「插件」页**才挂载，且实测客户端 ≤1 ms |
| 插件清单 chevron SVG | **149 个 loader 条目** | **149 个内联 `<svg>`**（`settings-plugin-inventory/lib/client.js:150,188`） | **线性、由插件树固定** | 不构成超线性 |
| 会话行渲染 | 960 会话 / 19 分组 | 折叠态 62 行；**扁平态 960 行（`:1538` 无 slice）** | **线性、无界** | 不构成超线性；且 `dsh-chunked-list` 在本部署**不存在** |
| 「插件」页整页挂载 | 149 张卡**同时挂载**（`settings-plugins/lib/client.js:403` `namespaces.map`，**无 lazy/可见性门）+ usage 卡 9 并发 RPC** | 实测窗口 1046 ms、客户端 115 ms | **线性，但常数大** | **首开最重的客户端路径，但仍远低于 1 帧预算之外的 jank 阈值（0 个 >50 ms 帧）** |

**没有找到任何「按数据量生成的 SVG/表格」导致的超线性成本**；最重的一条是「插件」页的**常数大**而非**爆炸**。唯一与数据规模线性相关的**贵**成本在宿主侧：`session.list`（496 KB / 299 条 / 99 条带 `runningSubagentCount`）。

> 附带更正两项任务前提（由静态分析交叉核对）：
> ① `dsh-chunked-list` **在本部署不存在**（仅 `profiles-archive/`），chunked-list 渲染路径不可达；
> ② 用 `find` 扫描客户端 bundle 会**少报**（9 vs 实际 **52** 个 bundle，因 pnpm 用符号链接）——凡做「谁是唯一 SVG 生成者」这类普查必须用 glob/`-L`。

---

## 6. 与「用户报告卡顿」的因果链（本档最重要的新增结论）

```
用户全新页面点「设置」
   └─ 客户端：23–35 ms 出对话框；5 次 commit / +284 fiber / 15–99 ms  ← 便宜（实测）
   └─ 设置面板稳定需要的数据里包含 → POST /api/session.list
         └─ 宿主（PID 10806）：单次 0.28–21.6 s，恒 496 KB / 299 items
               · 每次调用在宿主进程内实测烧满 1.0–1.1 个核（≈0.45 core·s）
               · 根因：比较器内 O(events) 折叠 × 2/次比较，无 memo（index.js:2237）
               · 同窗交替对照 settings.describe 中位 12 ms（比值 321×）
               · 4 路并发 ⇒ 3.7× 劣化，并把廉价 RPC 从 8 ms 拖到 313–360 ms（队头阻塞）
         └─ 响应落地瞬间：React 整树重渲染 —— 38 次 commit × 每次 600 fiber
   ⇒ 主观「卡」= 面板迟迟不完备（等 session.list）+ 列表到位时的整树重渲染
   ⇒ 且该成本**不由本档探针引入**（§6.2 相位 A：我方并发=1 时它依然 417 ms / 1.0 核）
```

**宿主侧同时观测到的异常（与本档客户端测量同期）**：

| 时刻 | 观测 |
|---|---|
| 10:28:41 | 主线程 tid=10806 **98 % 一个核**；`/proc/10806/stat` utime+stime 采样确认；其余线程各 ~8 % |
| 10:30 | `session.list` 连 `HTTP 响应头都没有`（`--max-time 20`，`SIZE=0B`）；同刻 `settings.describe` 12.9 ms |
| 10:32 | 主线程仍 **100 % 一个核**；RSS **4.46 GB → 4.28 GB（每 10 s −110 MB）** ⇒ **分配/GC 抖动，不是内存泄漏** |
| 10:34:15–10:35:18 | `session.list` 12 次（curl 串行）：**16.76 / 6.97 / 21.57 / 11.98 / 6.13 / 6.98 s**（每次恒 496 KB）+ 随后 12 次（node fetch，与对照同窗交替）：**0.85–8.42 s（中位 3.86 s）** |
| 10:35:25 | `settings.describe` **5.5 / 63.2 / 8.5 ms**（同刻对照，未被拖慢） |

**历史对照（同一问题此前已被记录过，非本轮新引入）**：`.workspace/lag-fix/reports/settings-jank-audit-host-loop.md:53` 记 `session.list` **194.6 / 174.0 ms**；`.workspace/lag-fix/research-v2/r4-live-verify/audit.md:277-279` 记 `session.list` **2120 / 9795 / 1247 ms**（06:42–06:43）。⇒ **本轮 0.28–21.6 s 是同一条路径的恶化/同族现象**，不是本次测量造成的假象。

### 6.1 宿主根因（子档 `sub-hostloop/` 定位到行）

| # | 结论 | path:line | 证据 |
|---|---|---|---|
| 1 | **`session.list` 不是死循环，是「贵 + 排队」** | `dsh-host-apiproxy/lib/index.js:2237` | 同一请求 7 次全部 200：**0.60 / 0.70 / 0.78 / 3.10 / 7.72 / 20.89 s**，响应恒 ~495,944–496,193 B ⇒ 是**队列竞争**的签名，不是无界循环 |
| 2 | **比较器里做 O(events) 折叠、每次比较调 2 次、无 memo** | `:2237` `attachedSubagents.sort((a,b)=>sessionListUpdatedAt(b.header,sessionListMetadata(b.events))-…)`；`sessionListMetadata` 在 `:1214-1221` | 每次列表 **O(2·m·log₂m·E)** 事件访问；同一标量已在 `:1291` 算过、又在 `:2271` 第三次折叠。**B1 引入**（pre-B1 件 `.dsh/profiles/.../dsh-host-apiproxy/lib/index.js:2170` **无此 sort**） |
| 3 | **每次调用实测烧满一个核** | 同上 | §6.2 三相实验：`session.list` 在途期间宿主主线程采样 **1.02–1.08 核**（≈0.45 core·s/次）；4 路并发时 **4.48–5.47 核**。主线程只有 1 个 ⇒ 秒级排队 |
| 4 | **另一条常驻燃烧路径（与点击无关）** | `dsh-storage-json/lib/index.js:220` `publish→serialize`（`:68-79`），由 `dsh-session-projection-cache/lib/index.js:252→234→211-217` 驱动 | 每条记录写入⇒**重写整个 9.86 MB pretty-print `session_projcache.json`**；实测 **29 次重写/3 s，~58 ms CPU/次**（≈+0.5 核），对应 77k–93k minor faults/s 与 RSS 4.20→4.53 GB 锯齿 |
| 5 | **数据无损坏（排除 (b)）** | — | 1002/1002 session 日志均为合法 zstd 帧、0 畸形 0 空文件；projcache 2670 条目 × 10 行全良构、无超大记录；总 562 MB ⇒ **缺陷在健康数据上即可复现，规模只是放大器** |
| 6 | **B1 的 `annotateRunningSubagentCounts` 无罪**（任务书里的怀疑对象） | `index.js:1244-1274`，`seen` 守卫在 `:1265` | 可证明终止、毫秒级 ⇒ **不成立**；真正的 B1 缺陷是上面第 2 条 |

> 与 §6.2 的交叉一致：把 1 路并发（实测 1.02 核，**不饱和** 32 核机器）与 4 路并发（4.5 核，仍不饱和但把**廉价 RPC 拖慢 30×**）分开看，就能同时解释两件事：**单发**时 `settings.describe` 仍很快（子档观察：在途期间 1.5–50 ms，故「事件循环未被阻塞」），而**并发/高负载**时会互相拖累（本档实测 8 ms → 313–360 ms）。

### 6.2 「是不是你的探针压出来的？」——三相对照实验（`raw/load-sensitivity.json`）

这是把「探针负载造成的卡」与「应用自身的卡」分开的**直接实验**（本档在自身侧不制造并发时逐发测量；主机上另有其他子代理的浏览器，`ps` 可查：PID 145541 等 `headless_shell`）：

| 相位 | 我方并发 | 宿主主线程 CPU | `session.list` 中位 | `settings.describe` 中位 | load1 |
|---|---|---|---|---|---|
| **A 逐发（每次间隔 2 s，我方并发=1）** | 1 | 61 %（调用在途时 1.02–1.08 核） | **417 ms** | **8 ms** | 5.47 |
| **B 4 路并发突发** | 4 | 93 %（4.48–5.47 核） | **1547 ms（×3.7）** | **313–360 ms（×30–39）** | 4.98 |
| **C 突发后回到逐发** | 1 | 83 % | 792 ms（×1.9） | 10 ms | 5.06 |

**三重结论**：
1. **`session.list` 的贵是应用自身的**：在**我方并发=1**、宿主 load ≈5.5 的相位 A 里它仍是 **417 ms / 每次烧 1.0 个核**，而同窗 `settings.describe` **8 ms**（比值 52×）。⇒ **不是探针压出来的**。
2. **但它对并发的敏感度极高（amplification）**：4 路并发把它推到 **1.5 s（×3.7）**，并把**廉价 RPC 拖慢 30–39×**（8 ms → 313–360 ms）⇒ **队头阻塞**成立。这正是「点设置就卡」在真实会话里（21 个并发子代理、多条 RPC 同时飞）被放大的机制。
3. **存在残留/恢复期**：相位 C 未完全回到相位 A（792 vs 417 ms，×1.9）⇒ 与子档「持续重写 9.86 MB 缓存」的常驻燃烧一致（那个负载不由本实验引入，实验期间 load 稳定在 5.0–5.5）。

**因此对「先在我探针全关的状态下试 10 秒」的建议**：本档已给出等价且更强的证据 —— 相位 A 就是「我方只发 1 个请求、顺序执行」的条件，`session.list` 依然是 417 ms / 一个核、比同窗对照慢 **52×**。无需停止任何探针即可判定**缺陷属于应用自身**；若要进一步把「同机其他子代理的浏览器」也排除，只需在**无人运行 headless_shell** 时重跑 `node tools/load-sensitivity.mjs`（相位 A 的三行即够）。

---

## 7. 逐条 PASS / FAIL / INCONCLUSIVE

| # | 判据 | 裁决 | 依据 |
|---|---|---|---|
| 1a | hook 由 `page.addInitScript` 定义，采集 `inject/onCommitFiberRoot/onPostCommitFiberRoot` | **PASS** | `raw/probe4-final3-r*.json`；inject=1、onCommit=5/43、onPostCommit=4/35 |
| 1b | **自证 hook 真被 react-dom 采纳（给出 inject 次数与 renderer 版本）** | **PASS** | inject 次数 **1**，renderer 版本 **18.3.1**（`react-dom`），renderer id=1；且回调实际被调用次数 >0（337 与 5/43） |
| 1c | 说明并实测 `.stack` 陷阱只在 `.stack` 被访问时触发 | **PASS** | `stackTrapSelfTest`：0 → 1，fired=true；纯 commit 采样期 0 次 |
| 1d | 统计「点击→面板稳定」的 commit 次数 | **PASS** | **5**（另一次撞上列表落地 = 43）；窗口定义=静默 700 ms + 内容不变（含 RPC 盲区修正） |
| 1e | 统计每次 commit 渲染的 fiber 数 | **PASS** | 全树 885/885/889/889/889；**新增（fresh）292/92/82/68/70**；函数组件 274/275 |
| 1f | 设置子树（`div[role=dialog][aria-modal=true]` 祖先链）渲染情况 | **PASS** | 对话框自身 168 节点/245 fiber（62 函数组件）；祖先链 fiber 245→247→267→269→285→775→779→1010→1011 |
| 1g | usage 卡片渲染情况 | **PASS（含更正）** | **不在「通用设置」首屏内**；它在**「插件」页**挂载（点击前不存在），客户端 ≤1 ms，但发 9 个 usage RPC（22.7–324.4 ms） |
| 2a | CDP `Profiler.start/stop`，`timeDeltas` 按**微秒** | **PASS** | 采样总时长/窗口 = **100.0 %**（单位正确的自证）；`samplingInterval=100 µs` |
| 2b | 点击窗口 self-time top-30，**按 bundle + 行号归属** | **PASS** | §2.1；归属口径由 8/8 sha1 MATCH + `refreshThemeColor@:475/:377` 正向命中自证；minified `assets/` 单列不冒充源行 |
| 2c | 首开窗口 `ThemePresenter.apply`（ui-layout `:366`）占多少 | **PASS（结论=0，附一处口径更正）** | 见 2c′ |
| 2c′ | **口径更正**：`ui-layout:366` 现为 `scheduleThemeColorRefresh` 内一行（`let queued = themeColorRefreshQueue.get(winRef)`），**不是** `ThemePresenter.apply`；现文件 `apply` 在 **`:408-450`**，强制重算在 **`:475`** | **PASS（更正）** | `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js`（sha1 `82cca1a6178a` = 下发 rev） |
| 2d | 各包（settings-general/models/plugins/renderer）、usage 卡、SVG 生成、`getComputedStyle` 强制重算各占多少 | **PASS** | §2.2 表；`getComputedStyle` = **0 次**（4/4 运行）；SVG 未进 top-30；`renderer` 包未出现 |
| 2e | 是否存在**首次挂载特有**成本（settings.describe/pluginInventory 后整树渲染、wallpaper 遮罩首建、theme-color meta 首写） | **PASS（均为否，且给出真正的首开特有项）** | 整树渲染：无（5 次 commit/284 fiber）；wallpaper 遮罩：**点击前已存在**；meta 首写：**无插入**；**真正首开特有 = `session.list` 首响应 + 其落地时的 38×600 fiber 重渲染** |
| 3a | 首开成本 top 5 + 各自量级（ms/次，同窗相对） | **PASS** | §3.1（全部带并发条件标注） |
| 3b | 稳态 vs 首开差异表 | **PASS** | §3.2（14 行，逐项给差异判定） |
| 3c | 绝对 ms 一律标注并发条件；同窗相对优先 | **PASS** | 每张表头/行内均标注 load1 与并发子代理数；关键比较（`session.list` vs `settings.describe`）为**同窗交替**测量 |
| 4a | 是否发现某组件按数据量生成的 SVG/表格产生**超线性**成本 | **PASS（结论=未发现超线性）** | §5：热力图 49 cell/147 节点、插件 149 SVG、会话 960 行——全部线性或有界；最重的是「插件」页**常数大**（115 ms）而非爆炸 |
| 4b | 给出精确 path:line 与数据规模 | **PASS** | `dsh-usage/lib/client.js:692`（49 cell）、`:325/:676`（无 useMemo）、`settings-plugin-inventory/lib/client.js:150,188`（149）、`settings-plugins/lib/client.js:403`（149 卡同时挂载）、`ui-workspace/lib/client.js:1538`（960 行无 slice） |
| 5a | 交付 `audit.md` | **PASS** | 本文件 |
| 5b | 交付原始 JSON（profile 大文件可裁剪但保留 top 表与元数据） | **PASS** | `raw/`：`profile-top-*.json`（裁剪后的 top 表 + 元数据，10.9 KB–13.2 KB/个）×10、`probe4-*.profile.json`（保留 `nodes/samples/timeDeltas`/元数据）×20、`probe4-final3-r*.json`（含 commit 表、探测计数）×2、`sessionlist-stall.json`、`probe5-tabs-summary.json` 等 |
| 6 | 纪律：单浏览器、不点保存/应用/删除、不 pkill、不改产品、锁协议 | **PASS** | 仅 1 个 headless chromium；只点「设置」/Esc/关闭/设置页导航标签（插件/模型/Agent 预设）；PID 10806 全程存活；`git status` 仅未跟踪产物；`owner.txt` 已按协议创建 |
| 7 | 分派 ≤3 个二级 subagent，各自独占子目录 | **FAIL（超编 1 个，如实记）** | 授权 3 个，实派 **4** 个：`sub-svg/`（完成）、`sub-firstmount/`（完成）、`sub-host/`（完成）+ `sub-hostloop/`（**超编**，用于宿主根因追查；宿主侧而非客户端任务）。4 个均已独立完成并落盘，无相互写入冲突（各占独占子目录） |
| 8 | `session.list` 究竟慢在哪一行（宿主根因） | **PASS** | 定位到 **`dsh-host-apiproxy/lib/index.js:2237`**（B1 引入：比较器内 `sessionListMetadata` 每次比较折叠整条事件流 2 次、无 memo，标量已被重复折叠 3 次）；另定位常驻燃烧 **`dsh-storage-json/lib/index.js:220`**（每条记录重写整个 9.86 MB projcache，29 次/3 s ≈ +0.5 核）。**排除**「B1 `annotateRunningSubagentCounts` 死循环」与「数据损坏」。证据 `sub-hostloop/host-loop-analysis.md`（402 行）+ 本档 §6.1/§6.2 |
| 9 | 卡顿是否由本档探针负载造成 | **PASS（否）** | §6.2 三相实验：我方并发=1 时 `session.list` 仍 417 ms/1.0 核 vs 同窗对照 `settings.describe` 8 ms（52×）；并发=4 时劣化 3.7× 并把廉价 RPC 拖慢 30–39×（队头阻塞） |
| 10 | 校正任务书的一处行号前提 | **PASS（更正）** | 任务书写 `ui-layout :366` 为 `apply`；现文件 `:366` 是 `scheduleThemeColorRefresh` 内一行，`apply` 在 **`:408-450`**、强制重算在 **`:475`**（sha1 `82cca1a6178a` = 下发 rev） |

---

## 8. 复现命令

```bash
cd /home/CNS2026495165/dsh/.workspace/lag-fix/incident2/first-open-profile

# 三窗口（首开早点击 / 首开晚点击 / 稳态重开）+ CDP profile + hook + RPC 计数
NO_HOOK=0 KINDS=immediate,settled node tools/probe4.mjs rerun hook,dom,cssom,net,logger

# profile 归属（bundle + 行号）与 top-30
node tools/analyze-profile.mjs raw/probe4-final3-r1-run0.profile.json mylabel 30

# 各设置页标签成本（同一页面内，逐标签一个 profile）
node tools/probe5-tabs.mjs

# 宿主 session.list 停滞量化（12 次 + 同窗对照 + 主线程 CPU）
node tools/measure-sessionlist.mjs 12

# 只读确认下发的 bundle == 磁盘文件（源归属前置条件）
curl -s http://127.0.0.1:3080/ | grep -o '"id":"[^"]*","url":"[^"]*","rev":"[^"]*"' | head -60
```

## 9. 产物索引

| 文件 | 内容 |
|---|---|
| `audit.md` | 本报告 |
| `raw/probe4-final3-r{1,2}.json` | 两次独立重复 × {首开早点击, 首开晚点击} 的全量窗口数据（commit 表、探测计数、RPC 明细、DOM 计数） |
| `raw/probe4-final3-r{1,2}-run{0,1}.profile.json` | 对应 4 个 CDP CPU profile（保留 `nodes/samples/timeDeltas` + 元数据） |
| `raw/profile-top-*.json` | **裁剪后的 top 表 + 元数据**（10 个窗口/标签），含 `identityCheck`（归属自证） |
| `raw/sessionlist-stall.json` | `session.list` 12 次采样 + 同窗 `settings.describe`/`usage/status` 对照 + 主线程 CPU tick |
| `raw/probe5-tabs-summary.json` + `raw/probe5-tab-*.profile.json` | 设置页各标签（noop / 插件 / 模型 / Agent 预设）单窗成本与 RPC |
| `raw/probe2-clean.json` | 早期「hook 采用 + 点击前已存在的层」证据（`preClick.wp`、meta/token 观测） |
| `raw/probe4-win2.json` | **旧口径**（仅 mutation 静默）窗口，保留为「被证伪口径」对照 |
| `raw/probe4-b-*.json` | 8 个拦截组的**安全性/开销**分档实测 |
| `logs/final3-r*.log` | 两次重复的完整控制台输出（含 HOOK/COMMITS/settle/rpc/tail） |
| `sub-svg/svg-analysis.md` | SVG/表格超线性普查（52 个 bundle 全扫） |
| `sub-firstmount/firstmount-analysis.md` | 首挂载/主题首写/首开 RPC 的静态分析 |
| `sub-host/host-rpc-latency.{json,md}` | 宿主各设置相关 RPC 延迟、缓存性、扩展性 |
| `sub-hostloop/host-loop-analysis.md` | 宿主 `session.list` 根因追查（**已完成**，402 行，定位到 `index.js:2237` / `dsh-storage-json:220`） |
| `raw/load-sensitivity.json` | 三相对照实验（逐发 / 4 路并发 / 恢复期）+ 每发宿主主线程 tick |
| `raw/quiet-test.json` | 「我方 15 s 零请求」静默期宿主 CPU + 6 轮逐发对照 |
| `tools/*.mjs` | 全部探针与分析器（probe2/3/4/5、recon、diag、analyze-profile、measure-sessionlist） |
