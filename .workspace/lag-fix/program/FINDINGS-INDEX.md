# 程序级发现索引（DSH 性能与操作体验，约 100 条线计划）

> 用途：各波次审计线的**结论落点**，供协调者交叉裁决与执行档取材。每条都必须能回溯到该线自己的 `audit.md` + `raw/`。
> 纪律：**只记有证据的结论**；已撤回项集中登记在 `../incident2/VERDICT.md §二`，不得重复引用。

---

## w13-feedback（反馈面与可恢复性）—— PASS 9 / FAIL 13 / INCONCLUSIVE 5

### 🔴 两处对既有口径的更正（我此前转述有误，以此为准）
1. **`@local/dsh-usage/lib/index.js:220` 的 `.catch` 不存在**，且 timer 不是"被修好"而是**被默认关成死代码**：
   deployed 已使用正确的 `ctx.inject(["timer"], cb)`（`:318-334`），但整体被 `const INGEST_TIMER_ENABLED = false;`（`:67`）包住 ⇒ **timer 是死代码**。
   真实吞异常点是 `:335` / `:184` / `:188` / `:310`。与 `BATCH-PLAN §三bis.3` 铁律一致 ⇒ **U-IG2 未落地、闸门 G1 仍未被回答**。
2. **`syncCompletedNotifications` 不是卡顿立柱（假设被证伪）**：触发频率确为"每事件一次"（`:8251` / `:8089` 在重放循环内 / `:8094`），但**两个独立复刻微基准吻合**：N=1000 → **0.0358 ms / 0.0336 ms**；占单核 1% 需 ~270 帧/s。
   ⇒ **验收必须以"边沿等价"为准，不得用性能收益验收**（绿点依赖 `prevRunning` true→false 边沿，`:8528-8534` 注释自陈朴素合并会折叠它）。

### 四条最硬的 FAIL（产品级缺陷，均有 file:line）
| # | 缺陷 | 证据 |
|---|---|---|
| **F1** | **宿主插件日志没有任何持久出口**（其它缺口的根源）：cordis 唯一 exporter 是 **1000 条内存环形缓冲**，且该 buffer **全树零读取点**（`cordis/lib/index.js:583-602`，仅 `:601` 写入）；`journalctl _PID=301709` 与按 cgroup 均 **No entries**；`~/.dsh/logs` 不存在。进程链实跑 `host ← bash ← terminator ← gnome-shell`。**⚠️ `w20` 更正（比原结论更强）**：`log.warn` **连 cordis 的 1000 条环形缓冲都进不去**——阈值式 `cordis:474` = `levels?.default ?? this.level ?? 1`，而**内置 exporter（`:598-603`）无 `levels`、且三层活跃 patch + home 层全无 `logger:` 条目** ⇒ 阈值 = 1，而级别定义是 `error=0 / info=1 / warn=2 / debug=3` ⇒ **`warn`/`debug` 被级别过滤彻底丢弃**（离线实跑真实 cordis：缓冲只收 `["error","info"]` 长度 2；阳性对照 `levels.default=3` 四级全过）。⇒ 既有 **8 处 `log.warn` 是黑洞**，"沉入 Terminator 回滚缓冲"的措辞**应改为"被完全丢弃"**。ingest 失败 / worker 崩溃 / `bootstrap failed` **就此沉没** | 本线 + E-HOST 档 |
| **F2** | **三条失败通道零 UI 消费**：`listError`（`:8108-8116`→快照 `:8590`）**全仓 0 消费者**；`lastAgentError`（`:7557-7560`→`:7726`）**0 消费者**；断连仅 `handleDisconnected()`（`runtime:10618-10620`），而 primitives 导出的 **`ConnectionBanner`（含现成中文文案 + 全宽横幅 CSS）在 197 个包中 0 引用 = 死导出**。<br>**新增更硬缺陷**：`:8420` 用**原始 Map** `this.sessions.get(...)`，对未实例化会话（**后台子代理正是此类**）`?.` 静默吞掉 ⇒ **连 `lastAgentError` 都不赋值** | 本线复刻 + 静态 |
| **F3** | **传输错误一元化**：`runtime:344-353` 与 `host-apiproxy/lib/types/api/rpc.js:24-29` 把**超时 / HTTP 5xx / 断网全折成 `code:"internal"`** ⇒ UI **结构上无法判可重试性**；`handler.js:116` 的纯文本 500 被 `types/fetch/client.js:162-163` 丢弃。<br>**反面 PASS**：业务码具体（`/usage/nosuch` → `unknown-endpoint`） | 本线 |
| **F4** | **`/usage/status` 在数据停更 3h43m 时仍报 `ok:true`**：`lastIngest` 跨 80s（>45s 周期）**逐字节不变**（三次独立采样）；`statusProvider`（`index.js:236-245`）9 字段**无 staleness / 停用 / 失败告警位**；`failedDsh`/`failedCc` **从未被渲染**（`client.js:1093-1094`）；60s 轮询只调 `loadAll()` **不刷 status** | 本线（沙箱不建 SQLite 临时文件 ⇒ 7 个数据端点**主动不测**，防假失败） |

### 明确 PASS（避免误伤）
连接层退避**齐备且带抖动**（`client.js:9-15` cap 10s、`:107-114` `cap/2+rand*cap/2`；⚠️ attempt **无上限、无放弃终态**）；模型重试 **PASS 且可见**（`dsh-llm/lib/index.js:356-366` 5 次 + 倒计时/明细 `ui-conversation:5158-5220`）；插件加载失败 **PASS 可见可重试**（`ui-settings-plugin-inventory:100-110` + `fiberPhase`；但 host 只投影 4 字段**无 error/message**）；`runningSubagentCount` **PASS**（`apiproxy/index.js:1244-1274` 对除 subagent 外**所有**顶层行无条件赋值 ⇒ 覆盖率 100%）；**证伪**「DSH 调用 NVML」（全树 0 命中）。

### 前 5 项改进（含可判定验收，见该线 `audit.md §6`）
`I-1` **宿主日志落地 file exporter + 7 个 ingest 计数器上端点**（**最高优先：是其它项的数据源前提**；验收含"重启后仍在"+ 阈值两侧断言 + `monitorEventLoopDelay` <100ms 且**须避开 `BATCH-PLAN §五.8` 的 reset 陷阱**）
`I-2` 三条零消费通道接 UI（照抄既有 `openError` 内联红字，**零新设计**）
`I-3` 修 `host/agent-error` 惰性丢弃（推荐：manager 级 `agentErrors` Map，与 `pendingInteractions:7803` 同构；验收含"未选中会话"反事实）
`I-4` `status` 增 `timerEnabled`/`staleSeconds` 并渲染 `failed*`
`I-5` 传输错误分类学（超时→`timeout` 等，**不得新造成功路径**）+ Toast 队列（验收含"重建后 served rev == 磁盘 sha1-12"）

### ⚠️ 热面性提醒（影响执行批次划分）
**`dsh-client-ui-primitives`（Toast / ConnectionBanner）不在 197 个包目录里**，而是打进 `dsh-web-frontend/dist/assets/index-ClqxG24t.js` ⇒ **对它的改动不享受"刷新即生效"，需重建 Web 产物**。
另：Toast 容器 CSS 为 `pointer-events:none` ⇒ **「给 Toast 加关闭按钮」结构上不可能**（如需要，要改容器样式）。

### 需协调者裁决 / 排期
1. 🔴 **`session.list` >30s 无响应**：本线与另一档**各自独立**遇到，两档均判 **INCONCLUSIVE**（当时宿主 CPU 46.7%、loadavg 7.47、他线并发）⇒ **不得作性能结论引用**，需**持独占锁、机器安静**的专项复测。
2. **闸门 G1 仍未被回答**（timer 路径需冷面重启才能验证）⇒ 待决定是否排入下一次冷面重启批次。

---

# 波次 1 汇总（w01–w13，全部已交付，`audit.md` 均在盘上）

| 线 | 规模 | 一句话结论 | 最硬的数字 |
|---|---|---|---|
| **w01** 客户端渲染 | 635 行 | 无 keep-alive 的真实机制 = **完整 unmount/remount**；**仓库内已有现成范式可上提**（`settings-plugins:415-427/489-500` 容器 + `dsh-usage:774-810/983` 可见性门控 + `settings-models:1856` 已加载闸门） | 每次切换 mount fiber 通用 **27** / 模型 **34** / **插件 126**；重复点已活动项 = **0**（阴性对照）；**6 个有取数栏目里 5 个每次切回完整重发**（模型是唯一例外） |
| **w02** 宿主 RPC | 311 行 | **残余不是"算的"，是"等的"**：≈**8,490 次串行 await 且零 memo**，延迟 ∝ 拥塞度 | TTFB **512 ms ↔ 238,991 ms（466×）**，而内在工作量仅 **45–70 ms**；序列化+编解码+JSON+排序合计 **1.7 ms（<1%）** |
| **w03** 持久化 | 677 行 | 真靶点 = projcache **整文件重写**，且是**上游 per-record 分片布局的回归** | 单次 **59 ms**（同步 stringify **27.5 ms**）、**10.43 MB/次**、**0.87 次/s**、写放大 **545–1,387×**；**58.5% 孤儿、无淘汰** |
| **w04** 插件/bundle | 499 行 | 启动期 50 bundle 的抓取/求值成本；提出 **`content-visibility:auto`** 等低风险候选 | 该 1 行 CSS：layout **−1.47 ms** / recalc **−1.23 ms** / 帧 **−2.0 ms**，DOM/SVG/监听器/无障碍**逐项不变** |
| **w05** usage/ingest | 319 行 | **G1 活体 PASS（量级判据）⇒ timer 可开**；但发现 `refresh` 不回写 `lastIngest` | 一次真实 **7,835 ms** pass 期间心跳 **max 148.5 ms、0 拍 >200 ms**（比 fold 墙钟低 **52.8×**）；9 路 = **61,556 B**、`sessions` 占 **89.2%**、并发突发 **319–333 ms** |
| **w06** 子代理 | 541 行 | 瓶颈是**宿主那一个 JS 主线程**；`SUBAGENT_LIST_MAX=200` **只挡行不挡扫描** | 主线程 **84–95%**；`subagent.list` **16.2/46.4/167.3 s**；扫描 **6,065 跳**（3,627 open + 1,209 read + 1,209 stat） |
| **w07** 流式 | 459 行 | **逐 token 整树重渲染＝证伪**；真成本面是 **projection 驱动且未合并** | commits÷projection **corr 0.9995**（均值 **1.19**）vs ÷event **0.376**；**84.7% 的投影帧无任何表层读者**却触发整表重建 |
| **w08** 启动 | 381 行 | 首屏被**"50 bundle 拉完才 mountApp"**卡住；另有 `session.list` 并发尾巴 | 扣住 pptmaster +1500ms ⇒ 挂载 **1115.6→1802.1 ms**；关键路径 **11.9 MB 未压缩**、可延迟 **45.7%**；主线程仅 **TaskDuration 534 ms** |
| **w09** btw 加载 | 330 行 | 打开相**与设置弹窗同水平（都不产生长帧）**，设置弹窗的 `backdrop-filter` **在 btw 里载体不存在**；其自提候选 A **被自己 A/B/A 否决**；**700 ms 空闲轮询无条件重渲染 = FAIL** | 候选 A 25.4 vs 25.7 ms（无效）；候选 B/D 低风险待选 |
| **w10** btw 可调宽高 | 631 行 | **可行、纯客户端、热面、零宿主改动**；高度**连参数都没有** | 可照抄 `ui-trajectory:4899-4957` 手柄；**硬风险**：`use-overlay-placement.ts:340` deps 含 `desiredWidth` ⇒ 尺寸必须走 `sizeRef` |
| **w11** 遮罩观感 | 399 行 | **模糊的代价是"逐次重绘"而非持续** ⇒ **环带方案可恢复观感且几乎不付代价** | 静止期 blur 代价 **= 0**；环带观感差 **0.0235% >2/255**（不可辨）而交互相 LoAF **45 → 1**；`blur(0.5px)` **剂量曲线是平的**（否决降半径） |
| **w12** 输入/操作 | 514 行 | 键盘可达性大面积 FAIL：`aria-modal` 只声明不约束、行不可达、唯一全局快捷键**吞键** | Tab 40 次**必然逃逸**（16–17 个落点）；`Ctrl+Shift+.` 在输入框内 **`input` 事件 0 条**；document 级 keydown 监听者实为 **9 个** |
| **w13** 反馈/可恢复 | 710 行 | 业务契约健康，缺的是**"失败之后你能知道什么"** | **宿主日志无持久出口**（**`w20` 更正：`warn` 连环形缓冲都进不去 ⇒ 被级别过滤彻底丢弃**，不是"沉入终端缓冲"）；三条失败通道**零 UI 消费**；传输错误**全折成 `internal`**；`/usage/status` 在停更 **3h43m** 时仍报 `ok:true` |

## 波次 2（w14–w26）+ 执行档：**于 2026-09-22 15:2x 被一次系统级中断集体切断**

- **宿主未重启**（PID 301709），波次 1 的 13 份 `audit.md` **全部存活**；各执行档的候选件/脚本/pre-image/evidence **均在盘上**。
- 处置：按纪律**恢复原档**（`send_message`，保留上下文与证据，不重派、不重做），已唤醒 10 条执行档（`hostrpc`/`keepalive`/`masklook`/`usage9`/`btw-resize`/`proj`/`boot`/`virtual`/`a11y`/`cold-batch`）。
- **错峰规则（本轮确立）**：恢复波次 2 的 11 条审计时**分两批（每批 5–6 条）**，不再一次性上 20+ 并发。
- **冷面批次已就绪并攒批中**：`U-CB1`（`lastIngest` 回写）+ `U-CB2`（开 45s timer）+ `exec-hostrpc`（F1 memo + F2 signal）+ `db.js` 反写 + `deploy-side` 闸门 → **一次重启**；重启后第一件事跑 `verify-deployed-manifest-v1.mjs --phase expected-after-cold-batch`，再 `g1-live.mjs`（期望 `lastIngest 推进=true`）与 `accept-U-CB2-timer.mjs`（期望 ACCEPT）。

## ★ w14-residual-env（波次 2 中唯一在被切断前完成的线）：**"火狐也卡" = 环境为主因（已定量）**

有头 Gecko、真实合成、同机同显示器，**含 0 行 DSH 代码的极简页**，同 rep 相邻配对 × 3 rep：

| 档位 | 背衬 | 极简页帧 p50 | **等效帧率** | 空白页 |
|---|---|---|---|---|
| **H = 用户真实配置**（CSS 2560×1440 **@DPR2**） | **5120×2880 = 14.746 Mpx** | **23.40 / 25.34 / 22.74 ms** | **42.4 / 40.2 / 43.3 Hz** | 17.04（60Hz） |
| L = 对照（CSS 1440×900 **@DPR1**） | 1.296 Mpx | 17.02 / 17.04 / 17.04 ms | 59.5 / 57.6 / 60.0 Hz | 17.04（60Hz） |

⇒ **帧时间 ×1.37、掉帧 27.2%、3/3 复现**；空白静态页 4 档 12 窗口 p50 恒 17.04 ms、>33ms 帧恒 0（阴性对照成立）。

**★ 放大器是 DPR2，不是面积、也不是 mutter 降采样**（同 14.746 Mpx 背衬、同一 mutter 5120→3840 降采样，只换 DPR）：
**DPR1 = 17.06 ms（≈空白页 +0.02，免费）** vs **DPR2 = 22.47 ms** ⇒ **Δ = +5.41 ms/帧** ⇒ **mutter 降采样被该对照直接免责**。
> **协调者对 incident2 口径的更正**：此前"每帧多付 78% 填充 + 全屏重采样"的说法**撤回**——代价在 **DPR2 的光栅/合成路径**上，与帧缓冲面积/降采样无关。

**DSH 自身持续帧成本 ≈ 0**（DSH 页 vs 空白页：H 档 **−0.06 ms/帧**、L 档 −0.10）；DSH 独有的 ~1 秒偶发停顿判 **INCONCLUSIVE**（无 DSH 的对照组也出现过 1 次 951.6 ms；n=3、loadavg 6.3、peer 在跑）。
机制旁证：掉帧窗内 ff 10–12%、mutter 4.5–7%、Xorg 2.6–5.5%（单核百分比）**无一方饱和** ⇒ 瓶颈在 **GPU 侧的 DPR2 路径**（排除法推断，GPU 耗时只读不可得）。

**最小干预（该线未执行任何系统变更）**：
1. **I1（首选）**：显示器缩放 **150% → 100%** ⇒ 预期 **42 Hz → ≈60 Hz、回收 100% 掉帧**；回滚 = 设置改回 150%（`monitors.xml` 的 `<scale>1.5</scale>`），**即时生效、无需重启**。
2. **I2（不改桌面）**：窗口不拉满全屏，控制到 ≈1.296 Mpx 档（实测 **0 代价**）。
3. I3（假设、未验证）：接 4090；上界 = DPR2 相对 DPR1 的 +5.41 ms，**该线无跨 GPU 数据、不做幅度承诺**。
4. **被否决**：❌ mutter 降采样为主因；❌"均匀税、任何动画都卡"（空白页与小窗口档全组 60 Hz）。

**⚠️ 安全警告（须随结论转达）**：Sessions 树「工作区行」的**内层按钮打开的是 `Rename / Delete workspace` 菜单** ⇒ 只点行标签，**勿点行内按钮**（参考其 `recipes/GUI-RECIPE.md` 的 NEVER-CLICK 清单）。已转达给驱动 GUI 的执行档。

**边界**：Gecko 无 LongTask/LoAF 通道 + Firefox 155 移除 CDP ⇒ 该引擎**主判据 `RunTask` 不可用**，改用页内 wall-clock rAF + 播种（40/40 窗口、阳性对照 4/4）；`>50ms` 判据在此例**会假阴性**（A@H 有 10–38 帧 >33ms 却 0 帧 >50ms）；**"滚动长会话列表"与"打开 btw"两条均未测到**（会话视图无深链）；有头 Chromium 本机 100% 起不来 ⇒ 跨引擎对照仍缺。

---

# ★★ 跨线重大发现 1：**HMR 热刷新时序缺陷**（2026-09-22 活体实测确证，影响**每条写客户端插件的线**）

**症状**：写任一客户端插件的 `lib/client.js` 后，用户**已打开的页面**里**该插件的消费者崩掉**。实测表现：**整个会话区不可见、只剩 tool 界面**。

**完整因果链（每环均有客观证据）**
1. 写文件 ⇒ rev 变（实测：**只追加一个注释**即 `3f0397866d990e6e` → `e1541193dca271c8`，447932 → 447960 B）。
2. 宿主经 SSE `/plugins/events` 推帧 —— **实测原始帧**：`{"type":"rebuilt","id":"@deepseek-ai/dsh-client-ui-conversation","rev":"cd154d866bc6"}`。
3. `dsh-client-hmr/lib/client.js`：`case "rebuilt": queue.then(() => reload(frame.id))` → `reload()`：`invalidate` → 预取 → **先清 `entry.fiber`（连带注销它注册的服务）** → **`removeOwnedStyles(id)`（删它自带的 `<style>`）** → `entry.refresh()` 重新 import/apply。
4. **依赖该服务的 slot 条目在这个窗口内先重挂** ⇒ 抛错。**实测 Console 原文**：
   `Error: ui-conversation: conversation service unavailable` at `concreteConversation (client.js?rev=cf4575517765:9886:39)` ← `inject` ← `runInject` ← `SessionEntry`
5. 槽错误边界接住 ⇒ `slot entry crashed in 'conversation.session'` / `'conversation.composer.bar'` ⇒ **会话区整片不渲染，其它插件照常**。

**为何多线 A/B 都看不到**：探针**从不写插件文件**（候选字节用 `context.route` 喂进新 context）⇒ **永不产生 `rebuilt` 帧、永不走 `reload()`**。⇒ **"不写文件的 A/B"结构上看不到该类故障**（这是本程序最重要的一条方法论教训）。

**排除项（六臂渲染级二分，`exec-a11y`）**：`none`（其代码全缺席）/ `all` / `a11y1` / `a11y2` / `a11y12` / `btw-org` 六臂在节点数、最大可见盒、`pageerror`、`console.error`、插件失败界面、`inert` 残留上**逐项一致**（唯一差异是设计内 roving）⇒ **a11y 那批补丁字节渲染中性，不是致因**。

**处置**：已派 `exec-hmr`（选型 A 依赖方等待/重试 或 B HMR 时序；**必须不吞真实错误**+必须有"真缺失仍报错"的阴性对照）。
**运维纪律（立即生效）**：① **每次写客户端插件后必须强刷**（落地时明确告知用户）；② **客户端写入尽量攒批，只让用户刷一次**；③ 部署期间可考虑暂停 `dsh-client-hmr`（兜底）。

---

# ★★ 跨线重大发现 2：**全 DSH 只有 7 个模糊载体**（`w29` 普查，两法集合一致）

静态全树 grep ↔ 运行时 **95 张样式表**普查**结果完全一致**（**95 张全是运行时注入的 `<style data-plugin>`；只有壳层是 `<link>`**——这解释了"源码改了但服务旧产物"的坑为何只可能出现在壳层）。

| 载体 | 值 | 视口占比 | 位置 | 分类 |
|---|---|---|---|---|
| `._mask_15u5s_14` | `var(--dsw-mask-blur)` | **1.00** | 壳层 primitives `Modal`（dist CSS off 10128） | **A ★核心** |
| `.VOzbGW_ring`(+4) | 同 token | 0.853 | settings-general:28 off 2305 | A（**已被 `exec-masklook` 环带覆盖**） |
| `.BInVoG_mask` | **`blur(10px)`** | **1.00** | `attachment/lib/client.js:196` off 10038 | **A（半径最重；未实测）** |
| `.fNh4Da_mask` | token | 1.00 | `attachment:382` off 18245 | A（未实测） |
| `.SalQ5q_lightboxMask` | token | 1.00 | `@local/dsh-btw:935` off 51036 | A（未实测） |
| `._onboardingMask_1cfrq_10` | `blur(2px)` | 0.944 | dist off 11587 | C（无法复现） |
| HeroGlow `feGaussianBlur` | SVG 滤镜 | 局部 | conversation:7061 | B（静态无害） |

**机制（`w11`+`w28`+`w29` 三线互证）**：`backdrop-filter` 的代价**不是持续的，是"逐次重绘"付的**；**仅 2×2 px 的 opacity 变化就足以逼出 90.2% 的 `>33ms` 帧**。
**主凶驱动**：`_dsh-state-dot-chase`（`._cell_10orb_54{animation:…1s infinite}`，8 个 2×2 `<rect>`、只动 opacity）。其余：`SalQ5q_btw-banner-shimmer`、`SalQ5q_btw-tool-row-sweep`、`o3BgMG_dsh-tool-row-sweep`、`iWrAna_dsh-skill-row-sweep`、`uV2eYG_input-pending`、5 条 composer transition。

**实测对照（`>33ms` 帧占比）**：全视口 blur(2px) **90.2%** / M2 环带 **9.7%** / **M1 掐驱动 3.4%**；整屏运动层：99.0% / **100%（M2 失效）** / **0.0%**；**无载体+16 条动画 = 0.0%**（⇒ 动画本身便宜）。
**M2 观感硬证据（两线互证）**：差 **0.0272% >2/255、max 7/255**、NULL CONTROL 全 0、面板 core 差 0；`w11` 独立测得 0.0235%/max 8。
**已验证"无效"（不要重试）**：M3 背景提层/`will-change`（100%→100%；唯一有效的形状**不可迁移到真实 SVG opacity 驱动** 37.5%→36.1%）；**降半径**（0.5px 仍 93.9%）；**放慢动画**（节流 8s 仍 100%）⇒ **必须"暂停"**。

**协调者裁决**：① 主凶 `_dsh-state-dot-chase` **仅在"全视口遮罩可见"期间暂停**（它在遮罩背后 ⇒ 观感零代价），**成对恢复**；② **不得用"删除 blur"作方案**（用户硬约束：保观感）；③ 通用机制由 `exec-blurfix` 实现（覆盖所有 A 类载体），**不与 `exec-btwclose`（btw 确认框那一例）重复**；④ 载体 4/5/6 **必须先实测再定**，不得以推断当结论。

---

# ★★★ 用户报告的四个问题全部闭环（2026-09-22 18:2x，重启后由用户亲口确认）

**冷面重启**：旧宿主 301709（已跑 6h）→ SIGTERM **6 s 退出** → 新宿主 **pid 2988915 @18:11:49** → **2 s 冒烟 HTTP 200**。

| # | 用户原话 | 根因 | 处置 | **重启后实测** | 用户确认 |
|---|---|---|---|---|---|
| 1 | 设置页卡顿 | 全视口 `backdrop-filter` 遮罩 | 先移除、后由**环带方案**恢复观感（观感差 0.0235% 不可辨） | — | ✅「消失」 |
| 2 | **刷新后会话列表加载很慢/加载不出**（含子代理界面） | `session.list` ≈**8 490 次串行 await 且零 memo** + `signal` 被丢导致放弃后仍跑完 | `U-HR1` memo + `U-HR2` signal（2 处）+ `U-HR3` 单次折叠 + `U-HR4` 冷扫描有界并发 | **单发 32.6 s/超时/35.3 s → 0.36–0.51 s（≈70×）**；**并发 4 路全超时 → 0.90–0.92 s 全部 200**；`host.describe` 1.52 s → **18 ms**；返回 **300 行 / 495 KB** | ✅「秒开」 |
| 3 | **btw 点 X 关闭很卡** | X = 「结束 btw」→ 确认框的**全视口 blur** + 背后**无限追灯动画**（仅 2×2 px 的 opacity 变化即可逼出 90.2% 掉帧） | `exec-blurfix` **通用 M1 控制器**（遮罩可见期暂停背后可暂停的驱动，**`blur(2px)` 原样保留**） | 真实壳层遮罩 **71.1% → 0.3%**、fps **16.2 → 59.2**、ΣLoAF 7185 → 614 ms；观感**点阵外整页逐字节相同** | ✅「不卡了」 |
| 4 | 输入框内多出**蓝色矩形框** | 我在批次里误将已被用户否决的 `U-A11Y4`（焦点环）重新落地 | 立即回滚（`conversation` → `3f0397866d990e6e`，`served` 同步） | 标记残留 0 | ✅「消失」 |

**另两条已实测**：`lastIngest 推进=true`（`U-CB1` 生效；`eventsDsh` 124 709→124 714）；启动解绑 `U-BOOT2`（扣住 4.1 MB 非首屏包 +1.5 s ⇒ 挂载位移 **+1481 ms → −56 ms**，阴性对照仍 +1341 ms）。
**如实标注**：`g1-live` 的字面判据 `心跳 max < 100ms` 仍 FAIL（本次 **275.3 ms**）——该字面阈值在本机**不可判定**（静默噪声地板 336–446 ms），成立的是量级判据（本次 pass 仅 **1 486 ms**，而历史最响的真实 pass 是 7 835 ms / 心跳 148.5 ms）。

**待办（已在盘上，未落）**：`exec-btw-resize` R2（可调宽高，41/41 真机 PASS）、`exec-btwclose` U3/U4（U4 = 每次抽屉打开都发一条**不可见** `sideChat/listTree`，13 次 / 单次最长 **22 237 ms** / Σ≥**56.3 s** 宿主工作）、`U-BOOT1` 压缩（−61.93% 字节）、`exec-hmr` HMR 时序缺陷修复（在跑）。
**⚠️ 未落的 btw 三项需协调一次源码重建**（`dsh-btw/src` 里已同时含 resize 与 a11y U-A11Y3 的改动）⇒ 应"改 src → 重建 → 只拷 lib 到 **profile 挂载位** → 核响应体哈希"，不要直接落镜像产物。

**基础设施修复**：探针锁死锁已修（旧版在属主确证死亡时也拒绝回收 + `ageMs` 恒 0 ⇒ 全线死锁）；`deploy-side.sh` 默认 dry-run + 事前/事后闸门。**注意：现另有一台隔离测试宿主在 3187 端口**（`exec-hmr` 起的，父进程 = 新宿主 2988915），用完即关。

---

# 待落地清单（重启批次的输入）与按住项

**已落地在线（热面）**：设置遮罩环带、插件列表虚拟化、keep-alive 三段（5 文件）、usage 九路、btw 快捷键不吞键（U-A11Y3）。

**已落盘待重启激活（冷面）**：`U-HR1`（memo）/`U-HR4`（有界并发）/`U-HR2`（signal，2 处）/`U-HR3`（单次折叠）→ `dsh-session-persistence-jsonl` + `dsh-host-apiproxy`；`U-CB1`（`lastIngest` 回写）+ `U-CB2`（45s timer）→ `@local/dsh-usage`；`CB3b`（deploy-side 闸门）。

**按住未落（客户端，热面）**：`U-A11Y1/2/4`（六臂证明渲染中性；§5.7 裁决 B 的 `Shift+F10` 候选 revision 3 也未落）、`exec-btw-resize` R2（`ca6cc0ec…`，41/41 真机 PASS）、`U-PROJ1`（投影 rAF+闸门，1.196→0.246）。**`U-BOOT1`（压缩 −61.93%）建议单独一批**以免效果归因混淆。

**U-BOOT2（启动解绑）已 PASS 10/10 待落，附一条审计前提更正**：审计的"首屏闭包 = **12 条 / 1.30 MB**"**实测不可用**——`tier="wire12"` 下 50 包全 active 但 shell 抛 `'root' has no registration` ⇒ **整屏只剩壁纸**（DOM 114 节点、正文 0 字）。根因：那 12 条只覆盖 wire `inject` 的**服务依赖**，**漏掉槽位注册**（`ui-layout` 的 `root@520` 在 wire 图里不可见；审计自己的 inventory 已标其 `shell_essential` ⇒ **审计内部两处口径不一致**）。**裁定采纳保守切分**：**必需 = 30 条**、**延后 = 20 条 / 5,431,021 B**（与 `w08` 的"可延迟 5.43 MB = 45.7%"一致 ⇒ 收益未缩水），未知 id 一律必需，`tier="wire12"` 保留为**诊断模式**（保留证伪能力）。实测：扣住 4.1 MB 非首屏包 +1.5 s ⇒ 挂载位移 **+1481 → −56 ms**；**阴性对照仍 +1341 ms**（断言未被弱化）；整屏可渲染 12/12；50 包零回归。⚠️ **只能改 dist**（升级静默覆盖，靠 `ANCHOR_FAIL` 拦）+ **无 `cache-control`/`ETag` 且改内容不改名 ⇒ 必须硬刷新**。落地后**强制自检**（复用 `exec-a11y/probes/verify-render.mjs`，不过即回滚），步骤见 Runbook §1.6。


**⭐ 重启批次计划（用户选择"等执行档收口后再重启"）**：① 落地上述客户端补丁（会触发 HMR，可能短暂异常）；② **冷面重启**（Runbook：`.workspace/lag-fix/COLD-RESTART-RUNBOOK.md`，§2 为 `setsid` 分离式重启命令）；③ 用户刷新/重连（把"必须刷新"这个代价合并掉）；④ 验收链：manifest → `g1-live`（`lastIngest` 应推进）→ `accept-U-CB2-timer`（3 窗×120s、0 拍 >1000ms）→ hostrpc 冒烟 + 完整并发矩阵（**绝对量为主**：单发 ≤150 ms、4 路 ≤300 ms）。

**基础设施修复（已完成）**：`.workspace/lag-fix/lib/probe-lock.mjs` —— 旧版在属主**确证死亡**时也拒绝回收并返回误导性的 `BUSY_UNKNOWN_LIVENESS`（导致全线死锁，`exec-a11y` 白等 900 s），且 `ageMs` 恒为 0（`minAgeMs` 是死代码）；新版改为**整行全局正则解析**（值含空格不再截断）+ **默认按确证死亡回收** + **真实 `ageMs` 抗竞态护栏**（实测：死属主默认回收 ✓、活属主仍 `BUSY/ALIVE` ✓）。




---

# ⚠️ 波次 2「更正清单」（防止继续引用已撤回/已收紧的结论）

**使用规则**：本清单里的条目**优先级高于**波次 1 的原始表述；引用前先在此核对。

| 来源 | 被更正的说法 | 实测更正 | 影响 |
|---|---|---|---|
| **w14** | "mutter 的 5120→4K 降采样是主因" | **撤回**：同 14.746 Mpx 背衬下 **DPR1 免费（17.06 ms）vs DPR2 +5.41 ms** ⇒ 放大器是 **DPR2 的光栅/合成路径**，降采样被免责 | 优化方向从"合成链路"改到"DPR2 路径" |
| **w17** | 生效 bash 超时 = 120 s | **60 s**（`dsh-base/cordis.patch.yml:182 timeoutMs: 60000` 覆盖 schema 默认 120000） | 长命令会**提前 60 s 被杀**；Runbook 按 60 s 预算 |
| **w17** | "审批策略硬编码 `never`" | **分面**：派发边界是字面量（`dsh-subagent:624`）；**部署层是条件式**（`cordis.patch.yml:189-192`，默认 `ask`） | 不能一句话概括 |
| **w17** | "一个作业超限会把整组并行调用一起判失败" | **不成立**（子代理首轮推断，已自证推翻）：工具体抛错被 try/catch 收敛为**单调用** `isError`，且 exclusive 工具分组**恰为 1** | — |
| **w18** | **"zod 5.8×"** | **撤回**：≈66% 与 schema 无关（`C_HARNESS` 1.691 / `C_JSON_ONLY` 1.687 vs 5.020）；独立复算真实链 `JSON.parse 0.806 + 外层 0.0007 + 内层 0.295 = 1.138 ms`；`projections.values` **从未被深层校验**（`record(string(), z.unknown())`）⇒ **可优化面 ≈ 0，最小改法 = 不改** | **任何以"zod 5.8×"为依据的批次都不应批准** |
| **w18** | `commits÷投影帧` 上界 `1.19 → 0.18`（阈值①≤0.30） | **上界是 ≈0.85**：闸门实测只滤 **16.1/29.4/28.6%**（帧量被两个**必须放行**的键吃掉：`subagentTiming` 33–66%、`sessionStats` 16–33%）⇒ **阈值①这条腿不可能达标**；`1.196→0.246` 的降幅**归因于 rAF 合并（8.55×），闸门本身贡献 ≈0** | 我此前把两者混述，此处更正 |
| **w18** | "投影键无运行时注册表" | **仅类型层成立**（空接口+声明合并）；**服务层有** `registrations` Map + **引用计数** | 键路由与注册表方案**不冲突** |
| **w20** | "宿主的 `log.warn` 落进 Terminator 回滚缓冲" | **加强为"被完全丢弃"**：阈值=1（内置 exporter 无 `levels`、三层活跃 patch + home 层全无 `logger:` 条目），级别 `error=0/info=1/warn=2/debug=3` ⇒ **`warn`/`debug` 连环形缓冲都进不去**（离线实跑：只收 `["error","info"]`） | 既有 **8 处 `log.warn` 是黑洞**；"加一次性 warn"**收益严格为 0** |
| **w20** | "活跃 patch 文件 = 5 个 `@local/*`" | **活跃 = 3**（base 1 + web-app 29 + profile 17）；**5 个 `@local/*/cordis.patch.yml` 全是死文件**（`web` 的 bundles 只有 base+web-app）⇒ 死文件共 **7** | 改死文件不会有任何效果 |
| **w20** | "静默回滚是 `dsh-usage` 独有" | **`@local/*` 全体通病**：8 包中 **7 包**有 deployed-only 手改；**`deploy-lag/replay-lag-fix.sh` 只覆盖 5 包**，对 `client-runtime`/`ui-settings-general`/`ui-renderer`/`dsh-client-hmr`/`client-modules`/`@local/dsh-usage` **命中全为 0** ⇒ 升级后这 6 类补丁**静默丢失且无校验** | 已派 `exec-logdrift` 做漂移校验器 |
| **w21** | `dsh-session-projection-cache:58-62` "Version bumps discard the whole medium" | **未实现（FALSE）**：bump 实测抛 `version-mismatch` 且**介质逐位不变**，产品**无迁移缝** ⇒ **"分片修复 = bump 版本"不可行** | 修复必须挂"布局声明 + 介质探测" |
| **w21** | "单条 promise 链串行 ⇒ 多 unit 互阻" | **字面不成立**：链是**每域一条**（`DomainImpl.chain`），实测两链重叠；**真正耦合是共享主线程**（心跳 p95 1.076 → **32.711 ms**、max **52.882 ms**） | 优化目标改为降低**主线程**占用 |
| **w21** | projcache 频率 0.870 次/s（起点值） | 本档事件式实测 **1.8417 次/s（2.12×）**、写放大 **21.11 MB/s**；**只报趋势、不否定旧值**（两者互为量纲自证） | 引用时标注口径 |

**另有两处口径纪律（全队适用）**：
- **"机器安静"门禁在本机不成立**（`w21` 实测空闲 20 s 内仍有 24 个事件；`w18` 采样窗宿主 CPU 84.7% 单核、RSS +738 MB/167 s）⇒ **只允许同窗对照/比值/为零类判据**，绝对 ms 必须标注并发条件。
- **`[data-slot]` 运行时多为 `display:contents` ⇒ 可见面积恒为 0**，不能用它判"渲染失败"；改用"root 可见 + 会话区后代 >0 + `pageerror===0`"。

# ★ 最终落地总表（2026-09-23 收尾；本表为"当前线上真实状态"的唯一权威清单）

**宿主**：pid **2649213**（10:09:52 起；前一代 2988915 在 1 秒内优雅退出、boot 2 秒、冒烟 200）。**审计波次已全部交付**：波次 1 = `w01–w13`；波次 2 = `w14` + `w16–w29`。

## A. 用户报告的四个问题（全部由用户当面确认闭环）

| # | 用户原话 | 现在实测 | 用户确认 |
|---|---|---|---|
| 1 | 设置页卡顿 | 全视口 backdrop 移除 → **环带方案恢复观感**（差异 0.0235% 不可辨） | 「消失」 |
| 2 | **刷新后会话列表加载不出** | **单发 32.6 s/超时 → 0.28/0.17/0.11 s**；**并发 4 路全超时 → 0.90–0.92 s 全 200**；`host.describe` 1.52 s → **18 ms** | 「秒开」 |
| 3 | **btw 点 X 关闭很卡** | **71.1% → 0.3%**、fps **16.2 → 59.2**，**`blur(2px)` 原样保留** | 「不卡了」 |
| 4 | 输入框内蓝色矩形框 | 已回滚（我误将已被否决的 `U-A11Y4` 编入批次 ⇒ 已记为本会话的编排失误） | 「消失」 |

## B. 其余落地项（含实测收益与判据）

| 项 | 落点 | 实测 |
|---|---|---|
| usage 九路 | `@local/dsh-usage`(client) | 切走再切回 **9 → 1 请求**；首挂载 **9 req/61.6 KB → 8 req/6.6 KB** |
| keep-alive 三段 | general/plugins/usage/ssh-gui/ws-enh | 二次访问 RPC **0**（8/8 两器械）、DOM 节点身份存活 8/8 |
| 插件列表虚拟化 | settings-plugin-inventory | 面板 DOM **1396 → 186**、SVG **178 → 23**、监听器 **+178 → +27** |
| a11y（1/2/3） | layout / workspace / btw(profile) | 弹窗 Tab×40 逃逸 **16 → 0**、Esc 还焦、树行 roving `{null:11}→{0:1,-1:13}`、快捷键不再吞键；`aria-modal` **由声明变约束** |
| 投影 rAF + 键闸门 | `dsh-client-runtime`（`/* w07-throttle v1 */`×4） | `commits÷投影帧` **1.196 → 0.246**（**主功是 rAF 合并 8.55×**；闸门贡献≈0，见更正清单） |
| **blurfix 通用 M1 控制器** | `dsh-client-ui-theme` | 真实壳层遮罩 **71.1% → 0.3%**；观感**点阵外整页逐字节相同**；落地后 `--no-route` 复核 `served.matchesCandidate=true` |
| **U-BOOT2 启动解绑** | 壳层 `index-ClqxG24t.js`（`29e6dacfe2c4`） | 扣住 4.1 MB 非首屏包 +1.5 s ⇒ 挂载位移 **+1481 → −56 ms**；阴性对照仍 **+1341 ms** |
| **HMR 时序修复** | renderer `7468f0c6…` + hmr `8ea91bb3…` | 写客户端插件不再打断界面（对照臂崩溃 6 次/会话区 2751→1 节点；修复臂 **0 崩溃**、两条阴性对照证明**未吞真实错误**） |
| **btw 批** | profile 挂载位 `6c29b98b645d`(361,702 B) | 拖拽调宽高（960 软上限/窄屏隐藏/顶部锚定）+ U3 复活竞态 + **U4 消掉每次开抽屉那条最长 22 237 ms 的隐形 `listTree`** |
| **子代理计数端到端** | connection `008c4f78408b` + runtime `ce10fbf68bdd` | 字段两处丢弃点全补 ⇒ L1–L4 全通、**低报 0、缺口 0**（审计只找到第一处） |
| **shell 手柄修复** | layout `feaedc5d28fc` | 右键不再改布局、四路径取消语义、卸载残留清除、**死区 170 → 10 px**、手柄**键盘可达 0 → 2** + 可视提示 + 列宽持久化（U-SH4 判定**不落地**：同窗 A/B `AppFrame` 渲染数 32 vs 32） |
| **日志出口复活** | `@local/dsh-logfile` | `log.warn` 从"**完全丢弃**"变为落盘（`~/.dsh/logs/dsh-host.jsonl`，已捕获 warn 级条目）；另含孤儿 settings 段巡检 + **漂移校验器**（52 包/322 文件，发现 17 处漂移/9 包） |
| **projcache 热面两项** | `dsh-storage-domain` + `dsh-session-projection-cache` | 紧凑序列化：**11,496,048 → 5,414,798 B（−52.9%）**；发布合并：同窗 **−90%（1.60→0.16 次/s）**、写量 **−95.4%**、全量 3,119 条 mem==disk 零差异 |
| **bash 条件式并发** | `dsh-tool-bash`（`cb73d3b1…`，44,054 B） | **patched 相位 PASS**：6×只读 **1395 ms / peak 6 / 15-15 重叠**（哨兵 ON 对照 **6515 ms / peak 1 / 0-15**）；**写命令与危险形状仍全 exclusive**；逐字节正确性 3/3 全 identical；开关双向活体生效 |

## C. 基础设施与运维修复

探针锁死锁（旧版在属主确证死亡时也拒绝回收 + `ageMs` 恒 0）· `deploy-side.sh` 默认 dry-run + 事前/事后闸门 · `/tmp` spill 清理 44 MB · 隔离宿主 3187/3188 已关 · btw 空登记清理（备份在盘）· **重启 Runbook**（`.workspace/lag-fix/COLD-RESTART-RUNBOOK.md`）。

## D. 诚实口径（引用本项目数字时必须带上）

1. **加速比只认同窗对照**：`exec-bashconc` 实测同窗真数字为 **4.67×（1 s 载荷）/ 1.44×（50 MB grep）/ 1.19×（瞬时命令）**；审计的 **8.17×** 与跨窗 **22.9×** 是**高负载上限**，不是稳态收益。**与负载无关**的结构性收益：重叠 0/15→**15/15**、峰值 1→**6**、`span/Σ` 1.000→**0.17**、子进程启动跨度 **10.28 s→0.319 s**。
2. **"机器安静"门禁在本机不成立**（空闲 20 s 仍有 24 个事件）⇒ 只允许同窗对照/比值/为零类判据；**45s timer 的首次 REJECT 已确认为我自己的测试负载污染**，安静窗复测 **ACCEPT（worst 678 ms、0 拍 >1000 ms）**。
3. **`[data-slot]` 面积为 0 属正常**（`display:contents`）⇒ 不得据此判渲染失败。
4. **本产品 `log.warn` 的历史黑洞已修**，但**boot 首轮的补丁告警仍抓不到**（插件与告警同轮插入）——不得宣称"boot 期告警可观测"。

## E. projcache 落地后的**线上**实测（区别于执行档的离线 harness 数字，以本条为准）

| 指标 | 落地前（线上） | **落地后（线上，240s 事件式 inotify 窗）** |
|---|---|---|
| 发布频率 | **1.8417 次/s** | **0.3625 次/s（87 次/240 s，−80.3%）** |
| 写放大 | **21.11 MB/s** | **1.96 MB/s（−90.7%）** |
| 文件体积 | 11,496,048 B | **5,418,010 B（−52.9%）** |
| 阳性对照 | — | **20/20 passed**（仪器自证） |
| `workspace` 域 | — | **0 事件**（导航不写盘，与 `w23` 一致） |

到达间隔：min 32.4 ms / p25 161 ms / **median 897.7 ms** / p75 1.89 s / p95 11.0 s / max 28.2 s ⇒ 仍**成簇突发**，但次数与字节各降约一个量级。
原始数据：`program/w21-storage/raw/main-freq.json`。

**⛔ 本条为"程序收尾（2026-09-23）"的最后一次更新**：所有验收项均已闭环，无 PENDING。
